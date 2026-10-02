// B-898 Stage 2: D1 is the only store for votes. A vote is one D1 batch inside
// the request (the user's row in icono_image_votes, an exact delta on the
// asset's icono_vote_asset_summary row, the gene's vote version), then one
// election over the gene's D1 rows with the same pure function every caller
// uses (electGeneAuthorityWinner), then a version-conditioned projection of
// the winner into icono_publish_state with one `publish` event. The caller
// republishes the gene's stable object afterwards; this module never touches
// storage outside D1.
//
// D1 cost fence: every statement here is keyed by gene_symbol (a primary-key
// prefix), by (gene_symbol, asset_sha256, user_id) (the vote identity's unique
// index) or by json_each over an explicit, bounded item list. Nothing reads
// the vote history of a gene: the summary row moves by the exact delta between
// the user's old and new vote, read inside the same transaction, so a vote on
// a gene with ten thousand votes costs what a vote on an empty gene costs.
import { electGeneAuthorityWinner } from "../vote-authority/gene-authority-election.js"
import { CARETAKER_SUPERVOTE_WEIGHT } from "../caretaker/caretaker-supervote.js"
import { GENE_VOTE_VERSION_SQL, geneVoteVersionBumpStatement } from "./gene-vote-version.js"

// The election reads every candidate of one gene. Real genes hold a handful;
// the bound only stops a pathological gene from turning one vote into an
// unbounded read. Past it nothing is projected and the caller is told why.
export const GENE_ELECTION_CANDIDATE_LIMIT = 256
export const GENE_VOTE_ELECTION_ACTOR = "vote_authority"

const SHA256 = /^[a-f0-9]{64}$/

function sha(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
  return SHA256.test(text) ? text : ""
}

function count(value) {
  return Math.max(0, Number(value || 0) || 0)
}

function intOrNull(value) {
  if (value === null || value === undefined || value === "") return null
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function geneVoteCandidateRef(symbol, assetSha256) {
  return `a:${symbol}|${assetSha256}`
}

function caretakerElectionInput(row) {
  const asset = sha(row?.asset_sha256)
  const direction = Number(row?.direction)
  if (
    !asset ||
    Number(row?.active) !== 1 ||
    ![-1, 1].includes(direction) ||
    !["active", "suspended"].includes(String(row?.assignment_status || ""))
  )
    return null
  return { asset_sha256: asset, direction, active: true }
}

/**
 * One D1 batch, one consistent snapshot: the gene's candidates, its vote
 * summaries, the caretaker supervote, the published state and the vote
 * version, then the pure election over them.
 */
export async function readGeneElection(db, symbol) {
  const [candidates, summaries, caretaker, state, version] = await db.batch([
    db
      .prepare(
        `SELECT asset_sha256, status, autopick_eligible, is_stale, is_legacy, created_at,
                vision_id, candidate_image_id
           FROM icono_portrait_assets
          WHERE gene_symbol = ?1
          ORDER BY asset_sha256 ASC
          LIMIT ?2`,
      )
      .bind(symbol, GENE_ELECTION_CANDIDATE_LIMIT + 1),
    db
      .prepare(
        `SELECT asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count
           FROM icono_vote_asset_summary
          WHERE gene_symbol = ?1
          LIMIT ?2`,
      )
      .bind(symbol, GENE_ELECTION_CANDIDATE_LIMIT + 1),
    db
      .prepare(
        `SELECT s.asset_sha256, s.direction, s.active, a.status AS assignment_status
           FROM icono_caretaker_supervote_projection s
           LEFT JOIN icono_caretaker_vote_assignment_projection a ON a.gene_symbol = s.gene_symbol
          WHERE s.gene_symbol = ?1
          LIMIT 1`,
      )
      .bind(symbol),
    db
      .prepare(
        `SELECT current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
           FROM icono_publish_state
          WHERE gene_symbol = ?1
          LIMIT 1`,
      )
      .bind(symbol),
    db.prepare(`SELECT ${GENE_VOTE_VERSION_SQL} AS version`).bind(symbol),
  ])
  const candidateRows = candidates?.results || []
  const summaryRows = summaries?.results || []
  const stateRow = state?.results?.[0] || null
  const currentAssetSha = sha(stateRow?.current_asset_sha256) || null
  const adminOverride = Number(stateRow?.admin_override || 0) > 0
  const caretakerInput = caretakerElectionInput(caretaker?.results?.[0])
  const overflow =
    candidateRows.length > GENE_ELECTION_CANDIDATE_LIMIT ||
    summaryRows.length > GENE_ELECTION_CANDIDATE_LIMIT
  const election = overflow
    ? { winner: null, rows: [] }
    : electGeneAuthorityWinner({
        candidates: candidateRows,
        summaries: summaryRows,
        caretaker: caretakerInput,
        currentAssetSha,
        adminOverride,
      })
  return {
    symbol,
    version: count(version?.results?.[0]?.version),
    current_asset_sha256: currentAssetSha,
    admin_override: adminOverride,
    overflow,
    caretaker: caretakerInput,
    winner: election.winner,
    rows: election.rows,
  }
}

/**
 * Projects an election's winner into icono_publish_state and records one
 * `publish` event, in one batch that applies only while (a) the gene's vote
 * version is still the one the election read, (b) no administrator override
 * pins the gene and (c) the winner is still an eligible candidate. A newer
 * vote or admin change makes this a no-op ("SUPERSEDED"); that newer change
 * runs its own election from fresher rows.
 *
 * The action stays `publish`, as every automatic promotion has always
 * recorded it: the caretaker "supervote lost canon" notification trigger and
 * the admin rollback both key on it, and it is in the publication-affecting
 * set, so the Actions publisher republishes the gene if the in-process
 * republish fails.
 */
export async function projectGeneElection(db, election, { actor, reason } = {}) {
  const symbol = election?.symbol
  const from = election?.current_asset_sha256 || null
  const to = sha(election?.winner?.asset_sha256) || null
  const outcome = (code, extra = {}) => ({
    ok: true,
    changed: false,
    code,
    from_asset_sha256: from,
    to_asset_sha256: to,
    ...extra,
  })
  if (election?.admin_override) return outcome("ADMIN_OVERRIDE")
  if (election?.overflow) return outcome("CANDIDATE_SET_EXCEEDS_BOUND")
  if (!to) return outcome("NO_CANDIDATE")
  if (to === from) return outcome("UNCHANGED")
  const guard = `${GENE_VOTE_VERSION_SQL} = ?3
    AND EXISTS (
      SELECT 1 FROM icono_portrait_assets
       WHERE gene_symbol = ?1 AND asset_sha256 = ?2
         AND lower(status) <> 'rejected' AND autopick_eligible = 1 AND is_stale = 0
    )`
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason)
         SELECT ?1, (SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol = ?1), ?2, 'publish', ?4, ?5
          WHERE ${guard}
            AND NOT EXISTS (
              SELECT 1 FROM icono_publish_state
               WHERE gene_symbol = ?1
                 AND (COALESCE(admin_override, 0) <> 0 OR current_asset_sha256 IS ?2)
            )`,
      )
      .bind(
        symbol,
        to,
        election.version,
        String(actor || GENE_VOTE_ELECTION_ACTOR),
        reason || null,
      ),
    db
      .prepare(
        `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
         SELECT ?1, ?2, ?4, CURRENT_TIMESTAMP, 0 WHERE ${guard}
         ON CONFLICT(gene_symbol) DO UPDATE SET
           current_asset_sha256 = excluded.current_asset_sha256,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP
         WHERE COALESCE(icono_publish_state.admin_override, 0) = 0
           AND icono_publish_state.current_asset_sha256 IS NOT excluded.current_asset_sha256`,
      )
      .bind(symbol, to, election.version, String(actor || GENE_VOTE_ELECTION_ACTOR)),
    db
      .prepare(
        `UPDATE icono_portrait_assets SET status = 'approved'
          WHERE gene_symbol = ?1 AND asset_sha256 = ?2 AND status = 'draft'
            AND EXISTS (
              SELECT 1 FROM icono_publish_state WHERE gene_symbol = ?1 AND current_asset_sha256 = ?2
            )`,
      )
      .bind(symbol, to),
  ])
  const changed = Number(results?.[1]?.meta?.changes || 0) > 0
  return changed
    ? { ok: true, changed: true, code: "PROMOTED", from_asset_sha256: from, to_asset_sha256: to }
    : outcome("SUPERSEDED")
}

/**
 * Elects and projects one gene. Admin-triggered callers pass `bump: true`:
 * the rows they just changed (a rejection, an unstale, a restored keep) are
 * election inputs, so the version advances before the read and any election
 * that read the older rows can no longer project.
 */
export async function electAndProjectGeneWinner(db, symbol, { actor, reason, bump = false } = {}) {
  if (bump) await geneVoteVersionBumpStatement(db, symbol).run()
  const election = await readGeneElection(db, symbol)
  const projection = await projectGeneElection(db, election, { actor, reason })
  return { election, projection }
}

/**
 * The legacy promotion receipt shape the admin routes return.
 */
export function geneElectionReceipt({ election, projection }) {
  const winner = election?.winner || null
  return {
    ...projection,
    image_score: Number(winner?.score || 0),
    weighted_score:
      Number(winner?.score || 0) +
      (winner?.caretaker_supervote
        ? Number(winner.caretaker_supervote_direction || 1) * CARETAKER_SUPERVOTE_WEIGHT
        : 0),
    caretaker_supervote: Boolean(winner?.caretaker_supervote),
    caretaker_supervote_direction: winner?.caretaker_supervote
      ? Number(winner.caretaker_supervote_direction || 1)
      : null,
    image_upvotes: count(winner?.upvotes),
    image_downvotes: count(winner?.downvotes),
  }
}

function voteDelta(value) {
  const vote = Number(value || 0)
  return {
    up: Number(vote === 1),
    down: Number(vote === -1),
    score: vote,
    count: Number(vote !== 0),
  }
}

/**
 * The coordinator's vote rule, as a pure plan: a desired-state command (an
 * identical retry changes nothing), values -1, 0 and 1, and a vision /
 * candidate-image identity that falls back to the user's previous row and
 * then to the asset. The asset must belong to the gene; clearing a vote (0)
 * is always allowed, also for an asset that has since been removed.
 */
function planGeneVote(request, assetRow, currentRow, sanitizeVisionId) {
  const currentValue = Number(currentRow?.vote_value || 0)
  if (!assetRow && request.voteValue !== 0) {
    return {
      ok: false,
      status: 404,
      code: "VOTE_ASSET_NOT_IN_GENE",
      error: "This image is not a candidate of this gene",
    }
  }
  const resolvedVisionId = sanitizeVisionId(
    request.visionId || currentRow?.vision_id || assetRow?.vision_id || "",
  )
  const resolvedCandidateImageId = intOrNull(
    request.candidateImageId ?? currentRow?.candidate_image_id ?? assetRow?.candidate_image_id,
  )
  const changed =
    currentValue !== request.voteValue ||
    (request.voteValue !== 0 &&
      (sanitizeVisionId(currentRow?.vision_id || "") !== resolvedVisionId ||
        intOrNull(currentRow?.candidate_image_id) !== resolvedCandidateImageId))
  return {
    ok: true,
    changed,
    asset_exists: Boolean(assetRow),
    current_vote_value: currentValue,
    final_vote_value: request.voteValue,
    resolved_vision_id: resolvedVisionId,
    candidate_image_id: resolvedCandidateImageId,
  }
}

// The statements that apply one planned vote. The summary moves by the exact
// delta: the new value from the request minus the old value read by the
// UPDATE itself, inside the batch's transaction, before the vote row changes.
// Two concurrent writes by one user serialize in D1 and each moves the
// summary by what it actually changed.
function geneVoteWriteStatements(db, request, plan) {
  const { symbol, asset, userId } = request
  const next = voteDelta(plan.final_vote_value)
  const prior = `FROM icono_image_votes WHERE gene_symbol = ?1 AND asset_sha256 = ?2 AND user_id = ?3`
  const statements = []
  if (plan.asset_exists) {
    statements.push(
      db
        .prepare(
          `INSERT INTO icono_vote_asset_summary (
             gene_symbol, asset_sha256, candidate_ref, vision_id, candidate_image_id,
             upvotes, downvotes, score, vote_count, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, 0, CURRENT_TIMESTAMP)
           ON CONFLICT(gene_symbol, asset_sha256) DO NOTHING`,
        )
        .bind(
          symbol,
          asset,
          geneVoteCandidateRef(symbol, asset),
          plan.resolved_vision_id,
          plan.candidate_image_id,
        ),
    )
  }
  statements.push(
    db
      .prepare(
        `UPDATE icono_vote_asset_summary
            SET upvotes = MAX(0, upvotes + ?4 - COALESCE((SELECT CASE WHEN vote_value = 1 THEN 1 ELSE 0 END ${prior}), 0)),
                downvotes = MAX(0, downvotes + ?5 - COALESCE((SELECT CASE WHEN vote_value = -1 THEN 1 ELSE 0 END ${prior}), 0)),
                score = score + ?6 - COALESCE((SELECT vote_value ${prior}), 0),
                vote_count = MAX(0, vote_count + ?7 - COALESCE((SELECT 1 ${prior}), 0)),
                vision_id = CASE WHEN ?8 <> '' THEN ?8 ELSE vision_id END,
                candidate_image_id = COALESCE(?9, candidate_image_id),
                updated_at = CURRENT_TIMESTAMP
          WHERE gene_symbol = ?1 AND asset_sha256 = ?2`,
      )
      .bind(
        symbol,
        asset,
        userId,
        next.up,
        next.down,
        next.score,
        next.count,
        plan.resolved_vision_id,
        plan.candidate_image_id,
      ),
  )
  statements.push(
    plan.final_vote_value === 0
      ? db
          .prepare(
            `DELETE FROM icono_image_votes
              WHERE gene_symbol = ?1 AND asset_sha256 = ?2 AND user_id = ?3`,
          )
          .bind(symbol, asset, userId)
      : db
          .prepare(
            `INSERT INTO icono_image_votes (
               candidate_ref, gene_symbol, asset_sha256, vision_id, candidate_image_id,
               user_id, vote_value, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT(gene_symbol, asset_sha256, user_id) DO UPDATE SET
               candidate_ref = excluded.candidate_ref,
               vision_id = excluded.vision_id,
               candidate_image_id = excluded.candidate_image_id,
               vote_value = excluded.vote_value,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(
            geneVoteCandidateRef(symbol, asset),
            symbol,
            asset,
            plan.resolved_vision_id,
            plan.candidate_image_id,
            userId,
            plan.final_vote_value,
          ),
  )
  return statements
}

function normalizedVoteRequest(raw, sanitizeVisionId) {
  const voteValue = Number(raw?.voteValue ?? raw?.vote_value)
  const request = {
    symbol: String(raw?.symbol || ""),
    asset: sha(raw?.assetSha256 ?? raw?.asset_sha256),
    userId: String(raw?.userId ?? raw?.user_id ?? ""),
    voteValue,
    visionId: sanitizeVisionId(raw?.visionId ?? raw?.vision_id ?? ""),
    candidateImageId: intOrNull(raw?.candidateImageId ?? raw?.candidate_image_id),
  }
  return request.symbol && request.asset && request.userId && [-1, 0, 1].includes(voteValue)
    ? request
    : null
}

/**
 * Writes one user's vote on one asset of one gene: one read batch, then one
 * write batch (summary delta, vote row, gene vote version). An unchanged vote
 * writes nothing.
 *
 * `sanitizeVisionId` is the runtime's vote vision-id rule (it drops artist
 * metavision ids); stored rows pass through it like request values do.
 */
export async function setGeneVote(db, raw = {}) {
  const sanitizeVisionId = raw.sanitizeVisionId || ((value) => String(value || ""))
  const request = normalizedVoteRequest(raw, sanitizeVisionId)
  if (!request)
    return {
      ok: false,
      status: 400,
      code: "INVALID_VOTE",
      error: "Missing or invalid vote payload",
    }
  const [assetRead, voteRead] = await db.batch([
    db
      .prepare(
        `SELECT vision_id, candidate_image_id FROM icono_portrait_assets
          WHERE gene_symbol = ?1 AND asset_sha256 = ?2 LIMIT 1`,
      )
      .bind(request.symbol, request.asset),
    db
      .prepare(
        `SELECT vote_value, vision_id, candidate_image_id FROM icono_image_votes
          WHERE gene_symbol = ?1 AND asset_sha256 = ?2 AND user_id = ?3 LIMIT 1`,
      )
      .bind(request.symbol, request.asset, request.userId),
  ])
  const plan = planGeneVote(
    request,
    assetRead?.results?.[0] || null,
    voteRead?.results?.[0] || null,
    sanitizeVisionId,
  )
  if (!plan.ok || !plan.changed) return plan
  await db.batch([
    ...geneVoteWriteStatements(db, request, plan),
    geneVoteVersionBumpStatement(db, request.symbol),
  ])
  return plan
}

// Fifty votes per D1 round trip: two set-based reads and at most four
// statements per vote, so a 500-vote import is twenty D1 calls.
export const GENE_VOTE_IMPORT_CHUNK = 50

/**
 * Applies many votes (the workstation's baseline import, an image edit's
 * inherited upvotes). Same rule and statements as setGeneVote; a later item
 * for the same user and asset wins, like replaying the commands in order.
 * Returns per-item outcomes and the genes whose votes changed.
 */
export async function importGeneVotes(db, items = [], { sanitizeVisionId } = {}) {
  const sanitize = sanitizeVisionId || ((value) => String(value || ""))
  const byIdentity = new Map()
  let invalid = 0
  for (const raw of Array.isArray(items) ? items : []) {
    const request = normalizedVoteRequest(raw, sanitize)
    if (!request) {
      invalid += 1
      continue
    }
    const key = `${request.symbol}|${request.asset}|${request.userId}`
    byIdentity.delete(key)
    byIdentity.set(key, request)
  }
  const requests = [...byIdentity.values()]
  const results = []
  const changedSymbols = new Set()
  for (let index = 0; index < requests.length; index += GENE_VOTE_IMPORT_CHUNK) {
    const chunk = requests.slice(index, index + GENE_VOTE_IMPORT_CHUNK)
    const pairs = JSON.stringify(chunk.map((item) => [item.symbol, item.asset, item.userId]))
    const [assetRead, voteRead] = await db.batch([
      db
        .prepare(
          `SELECT pa.gene_symbol, pa.asset_sha256, pa.vision_id, pa.candidate_image_id
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_portrait_assets AS pa
               ON pa.gene_symbol = json_extract(wanted.value, '$[0]')
              AND pa.asset_sha256 = json_extract(wanted.value, '$[1]')`,
        )
        .bind(pairs),
      db
        .prepare(
          `SELECT v.gene_symbol, v.asset_sha256, v.user_id, v.vote_value, v.vision_id,
                  v.candidate_image_id
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_image_votes AS v
               ON v.gene_symbol = json_extract(wanted.value, '$[0]')
              AND v.asset_sha256 = json_extract(wanted.value, '$[1]')
              AND v.user_id = json_extract(wanted.value, '$[2]')`,
        )
        .bind(pairs),
    ])
    const assets = new Map(
      (assetRead?.results || []).map((row) => [`${row.gene_symbol}|${sha(row.asset_sha256)}`, row]),
    )
    const votes = new Map(
      (voteRead?.results || []).map((row) => [
        `${row.gene_symbol}|${sha(row.asset_sha256)}|${row.user_id}`,
        row,
      ]),
    )
    const statements = []
    const chunkSymbols = new Set()
    for (const request of chunk) {
      const plan = planGeneVote(
        request,
        assets.get(`${request.symbol}|${request.asset}`) || null,
        votes.get(`${request.symbol}|${request.asset}|${request.userId}`) || null,
        sanitize,
      )
      results.push({ symbol: request.symbol, asset_sha256: request.asset, ...plan })
      if (!plan.ok || !plan.changed) continue
      statements.push(...geneVoteWriteStatements(db, request, plan))
      chunkSymbols.add(request.symbol)
    }
    for (const symbol of chunkSymbols) {
      statements.push(geneVoteVersionBumpStatement(db, symbol))
      changedSymbols.add(symbol)
    }
    if (statements.length) await db.batch(statements)
  }
  return { invalid, results, changed_symbols: [...changedSymbols] }
}

function zeroSnapshot(symbol, asset, visionId) {
  return {
    image_upvotes: 0,
    image_downvotes: 0,
    image_score: 0,
    user_vote: 0,
    vision_upvotes: 0,
    vision_downvotes: 0,
    vision_score: 0,
    candidate_ref: geneVoteCandidateRef(symbol, asset),
    vision_id: visionId,
    caretaker_supervote: false,
    caretaker_supervote_direction: null,
    caretaker_supervote_weight: 0,
    weighted_score: 0,
  }
}

/**
 * Vote snapshots for an explicit item list, in the coordinator's snapshot
 * shape: per-asset counts, the caller's own vote, the per-gene vision totals
 * and the caretaker decoration. Three statements in one batch whatever the
 * list size: the summaries of the named genes (a primary-key prefix each), the
 * caller's votes on exactly the named assets (the unique vote identity, one
 * probe per item) and the named genes' caretaker rows. A guest (no `userId`)
 * skips the vote probe.
 */
export async function readGeneVoteSnapshots(
  db,
  { userId = "", items = [], sanitizeVisionId = (value) => String(value || "") } = {},
) {
  const wanted = []
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = String(item?.symbol || "")
    const asset = sha(item?.asset_sha256)
    if (!symbol || !asset) continue
    wanted.push({ symbol, asset, visionId: sanitizeVisionId(item?.vision_id || "") })
  }
  if (!wanted.length) return []
  const symbols = [...new Set(wanted.map((item) => item.symbol))]
  const pairs = [...new Map(wanted.map((item) => [`${item.symbol}|${item.asset}`, item])).values()]
  const statements = [
    db
      .prepare(
        `SELECT gene_symbol, asset_sha256, vision_id, upvotes, downvotes, score
           FROM icono_vote_asset_summary
          WHERE gene_symbol IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(symbols)),
    db
      .prepare(
        `SELECT s.gene_symbol, s.asset_sha256, s.direction, s.active, a.status AS assignment_status
           FROM json_each(?1) AS wanted
           CROSS JOIN icono_caretaker_supervote_projection AS s ON s.gene_symbol = wanted.value
           LEFT JOIN icono_caretaker_vote_assignment_projection AS a ON a.gene_symbol = s.gene_symbol`,
      )
      .bind(JSON.stringify(symbols)),
  ]
  if (userId) {
    statements.push(
      db
        .prepare(
          `SELECT v.gene_symbol, v.asset_sha256, v.vote_value
             FROM json_each(?1) AS wanted
             CROSS JOIN icono_image_votes AS v
               ON v.gene_symbol = json_extract(wanted.value, '$[0]')
              AND v.asset_sha256 = json_extract(wanted.value, '$[1]')
              AND v.user_id = ?2`,
        )
        .bind(JSON.stringify(pairs.map((item) => [item.symbol, item.asset])), userId),
    )
  }
  const [summaryRead, caretakerRead, voteRead] = await db.batch(statements)
  const summaries = new Map()
  const visions = new Map()
  for (const row of summaryRead?.results || []) {
    const symbol = String(row.gene_symbol || "")
    const asset = sha(row.asset_sha256)
    if (!asset) continue
    summaries.set(`${symbol}|${asset}`, row)
    const vision = sanitizeVisionId(row.vision_id || "")
    if (!vision) continue
    const key = `${symbol}|${vision}`
    const total = visions.get(key) || { up: 0, down: 0, score: 0 }
    total.up += count(row.upvotes)
    total.down += count(row.downvotes)
    total.score += Number(row.score || 0) || 0
    visions.set(key, total)
  }
  const caretakers = new Map()
  for (const row of caretakerRead?.results || []) {
    const input = caretakerElectionInput(row)
    if (input) caretakers.set(String(row.gene_symbol || "").toUpperCase(), input)
  }
  const votes = new Map()
  for (const row of voteRead?.results || []) {
    votes.set(`${row.gene_symbol}|${sha(row.asset_sha256)}`, Number(row.vote_value || 0))
  }
  return wanted.map(({ symbol, asset, visionId }) => {
    const summary = summaries.get(`${symbol}|${asset}`) || null
    const resolvedVisionId = visionId || sanitizeVisionId(summary?.vision_id || "")
    const snapshot = zeroSnapshot(symbol, asset, resolvedVisionId)
    snapshot.image_upvotes = count(summary?.upvotes)
    snapshot.image_downvotes = count(summary?.downvotes)
    snapshot.image_score = Number(summary?.score || 0) || 0
    snapshot.user_vote = votes.get(`${symbol}|${asset}`) || 0
    const vision = resolvedVisionId ? visions.get(`${symbol}|${resolvedVisionId}`) : null
    snapshot.vision_upvotes = vision?.up || 0
    snapshot.vision_downvotes = vision?.down || 0
    snapshot.vision_score = vision?.score || 0
    const caretaker = caretakers.get(symbol)
    const supervoted = Boolean(caretaker && caretaker.asset_sha256 === asset)
    snapshot.caretaker_supervote = supervoted
    snapshot.caretaker_supervote_direction = supervoted ? caretaker.direction : null
    snapshot.caretaker_supervote_weight = supervoted
      ? caretaker.direction * CARETAKER_SUPERVOTE_WEIGHT
      : 0
    snapshot.weighted_score = snapshot.image_score + snapshot.caretaker_supervote_weight
    return {
      candidate_ref: snapshot.candidate_ref,
      symbol,
      asset_sha256: asset,
      vision_id: resolvedVisionId,
      snapshot,
    }
  })
}
