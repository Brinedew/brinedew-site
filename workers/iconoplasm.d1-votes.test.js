// B-898 Stage 2: D1 is the only store for votes. These tests run the vote,
// supervote, snapshot, upload and compare paths against a real SQLite database
// built from every checked-in Iconoplasm migration (all tables, indexes and
// triggers), behind the D1 prepare/bind/first/all/run/batch surface.
//
// Failure modes this file proves cannot happen:
//  1. Two near-simultaneous votes on one gene: the older election projects its
//     winner over the newer one.
//  2. A vote moves the winner of a gene an administrator pinned (admin_override).
//  3. A vote names an asset of another gene and is stored against this gene.
//  4. A caretaker supervote weighs anything but exactly 10 (+ or -), or moves
//     with a stale assignment/supervote version, from a non-owner, onto an
//     ineligible candidate, or twice for one command id.
//  5. A failed stable-object publish turns a committed vote into an error.
//  6. A snapshot or vote statement scans a vote table instead of seeking an
//     index, or the statement count grows with the item count.
//  7. An upload that does not change the winner leaves no
//     publication-affecting event, so the new candidate never reaches readers;
//     a direct one-gene upload is not republished in process; or a sync batch
//     (ingest with defer_read_models, then reconcile) republishes a gene twice.
//  8. The coordinator compare route writes to D1, or hides a difference that
//     matters for a rollback: a published winner, a caretaker assignment, or
//     the vision_id and updated_at a replay needs; or caps samples when asked
//     for all of them.
//  9. A vote summary drifts from the vote rows (identical retries, flips,
//     clears, bulk imports).
// 10. A coordinator alarm scheduled before the cutover publishes a stale winner.
// 11. A vote commits while its gene's stable object is being written, its own
//     republish lands first, and the older object overwrites it for good.
// 12. A vote, supervote or reader import past the daily vote budget writes
//     anything at all (vote row, summary, event, version, budget), or the
//     refusal is not a 429 with words a reader can act on; an unchanged vote
//     spends budget; an administrator's vote is refused.
// 13. A changed vote leaves no icono_vote_events row for the workstation's
//     incremental mirror, or an unchanged one leaves one.
// 14. A gene's rejected or stale history counts toward the 256-candidate
//     election bound, so a gene with a long history stops electing.
// 15. A vote import elects only the genes whose votes changed, so re-running
//     an import cannot repair a gene whose election failed the first time.
// 16. Restarting the admin read-model bootstrap empties the vote summaries the
//     election reads, so every gene not yet rebuilt elects from zero votes.
// 17. A leftover vote-projection Queue message throws, retries, reaches the
//     dead-letter queue or reports a failure to the sync governor.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  IconoplasmVoteCoordinator,
  compareIconoplasmVoteCoordinatorWithD1,
  handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi,
  handleIconoplasmQueue,
  publishIconoplasmGeneStableObject,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  GENE_VOTE_IMPORT_CHUNK,
  electAndProjectGeneWinner,
  importGeneVotes,
  projectGeneElection,
  readGeneElection,
  readGeneVoteSnapshots,
  setGeneVote,
} from "./iconoplasm/votes/gene-votes.js"
import {
  caretakerSupervoteRequestSha256,
  invalidateCaretakerSupervoteInD1,
  projectCaretakerAssignmentInD1,
  readCaretakerSupervoteFromD1,
  setCaretakerSupervoteInD1,
} from "./iconoplasm/caretaker/caretaker-supervote.js"
import {
  VOTE_DAILY_BUDGET_EXHAUSTED,
  VOTE_DAILY_BUDGET_MESSAGE,
  VOTE_DAILY_LIMIT,
} from "./iconoplasm/votes/vote-guards.js"
import { PUBLICATION_AFFECTING_ACTIONS } from "./iconoplasm-catalog-dispatch.js"
import { withTestMutationAuthority } from "./iconoplasm/test-only-mutation-authority.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const VOTE_TABLES = [
  "icono_image_votes",
  "icono_vote_asset_summary",
  "icono_portrait_assets",
  "icono_publish_events",
  "icono_caretaker_supervote_projection",
  "icono_caretaker_vote_assignment_projection",
  "icono_caretaker_candidate_eligibility_projection",
  "icono_gene_vote_version",
  "icono_vote_events",
  "icono_vote_daily_budget",
]
const sha = (char) => char.repeat(64)
const ADMIN_TOKEN = "test-admin-token-000000000000000000001"

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:")
    for (const name of readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
    }
    this.log = []
    this.batches = 0
    this.failOn = null
  }
  prepare(sql) {
    const db = this
    const statement = {
      sql: String(sql),
      args: [],
      bind(...args) {
        statement.args = args
        return statement
      },
      execute(mode) {
        db.log.push({ sql: statement.sql, args: statement.args })
        if (db.failOn && db.failOn.test(statement.sql)) throw new Error("injected D1 failure")
        const prepared = db.sqlite.prepare(statement.sql)
        if (mode === "run") {
          const info = prepared.run(...statement.args)
          return { success: true, results: [], meta: { changes: Number(info.changes || 0) } }
        }
        const rows = prepared.all(...statement.args)
        return { success: true, results: rows, meta: { changes: 0, rows_read: rows.length } }
      },
      async first(column) {
        const row = statement.execute("all").results[0] ?? null
        return row && column ? (row[column] ?? null) : row
      },
      async all() {
        return statement.execute("all")
      },
      async run() {
        return statement.execute("run")
      },
      async raw() {
        return statement.execute("all").results.map((row) => Object.values(row))
      },
    }
    return statement
  }
  async batch(statements) {
    this.batches += 1
    this.sqlite.exec("BEGIN")
    try {
      const results = statements.map((statement) =>
        /^\s*(SELECT|WITH)\b/i.test(statement.sql) &&
        !/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(statement.sql)
          ? statement.execute("all")
          : statement.execute("run"),
      )
      this.sqlite.exec("COMMIT")
      return results
    } catch (error) {
      this.sqlite.exec("ROLLBACK")
      throw error
    }
  }
  exec(sql, ...args) {
    return this.sqlite.prepare(sql).run(...args)
  }
  rows(sql, ...args) {
    return this.sqlite.prepare(sql).all(...args)
  }
  mark() {
    return this.log.length
  }
  since(mark) {
    return this.log.slice(mark)
  }
  // Every statement since `mark` that touches a vote table must seek an index
  // (EXPLAIN QUERY PLAN says SEARCH), never scan the table.
  assertIndexedSince(mark) {
    for (const { sql, args } of this.since(mark)) {
      if (!VOTE_TABLES.some((table) => sql.includes(table))) continue
      const plan = this.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...args)
        .map((row) => String(row.detail))
      for (const detail of plan) {
        const scanned = /^SCAN (\w+)/.exec(detail)?.[1]
        if (!scanned) continue
        const table = tableForAlias(sql, scanned)
        assert.equal(VOTE_TABLES.includes(table), false, `full scan in: ${detail}\n${sql}`)
      }
    }
  }
}

function tableForAlias(sql, alias) {
  if (VOTE_TABLES.includes(alias)) return alias
  const match = new RegExp(`\\b(icono_\\w+)\\s+(?:AS\\s+)?${alias}\\b`, "i").exec(sql)
  return match ? match[1] : alias
}

function seedAsset(
  db,
  symbol,
  asset,
  { status = "draft", createdAt = "2026-01-01 00:00:00", stale = 0 } = {},
) {
  db.exec(
    `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, created_at, is_stale, autopick_eligible, vision_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'anima-v1-1')`,
    symbol,
    asset,
    `portraits/${asset}/full.webp`,
    `portraits/${asset}/medium.webp`,
    `portraits/${asset}/thumb.webp`,
    status,
    createdAt,
    stale,
  )
}

function seedPublished(db, symbol, asset, { override = 0 } = {}) {
  db.exec(
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, admin_override)
     VALUES (?, ?, 'seed', ?)`,
    symbol,
    asset,
    override,
  )
}

function current(db, symbol) {
  return (
    db.rows(
      "SELECT current_asset_sha256 AS a FROM icono_publish_state WHERE gene_symbol = ?",
      symbol,
    )[0]?.a ?? null
  )
}

function summary(db, symbol, asset) {
  const row =
    db.rows(
      "SELECT upvotes, downvotes, score, vote_count FROM icono_vote_asset_summary WHERE gene_symbol = ? AND asset_sha256 = ?",
      symbol,
      asset,
    )[0] || null
  return row ? { ...row } : null
}

function recount(db, symbol, asset) {
  const row = db.rows(
    `SELECT COALESCE(SUM(vote_value = 1), 0) AS upvotes, COALESCE(SUM(vote_value = -1), 0) AS downvotes,
            COALESCE(SUM(vote_value), 0) AS score, COUNT(*) AS vote_count
       FROM icono_image_votes WHERE gene_symbol = ? AND asset_sha256 = ?`,
    symbol,
    asset,
  )[0]
  return { ...row }
}

async function vote(db, symbol, asset, userId, voteValue) {
  return setGeneVote(db, { symbol, assetSha256: asset, userId, voteValue })
}

function sessions(user) {
  return {
    idFromName: (name) => name,
    get: () => ({ fetch: async () => Response.json(user) }),
  }
}

function waitUntilRecorder() {
  const promises = []
  return {
    promises,
    waitUntil(promise) {
      promises.push(Promise.resolve(promise))
    },
  }
}

async function callApi(
  db,
  path,
  body,
  { user = { user_id: "reader-1" }, ctx = waitUntilRecorder(), env = {} } = {},
) {
  const headers = { "Content-Type": "application/json", Cookie: "session=s1" }
  if (env.admin) headers.Authorization = `Bearer ${ADMIN_TOKEN}`
  const response = await handleApi(
    new Request(`https://iconoplasm.brinedew.bio${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    withTestMutationAuthority({
      ICONOPLASM_DB: db,
      GAME_SESSIONS: sessions(user),
      ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
      ...env.bindings,
    }),
    ctx,
  )
  const payload = await response.json()
  await Promise.all(ctx.promises)
  return { status: response.status, payload, ctx }
}

// --- 1 ------------------------------------------------------------------

test("1: an older election cannot project over a newer vote on the same gene", async () => {
  const db = new SqliteD1()
  seedAsset(db, "TP53", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, "TP53", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, "TP53", sha("a"))

  // Vote A commits and reads its election: b gets one upvote, so b leads.
  await vote(db, "TP53", sha("b"), "u1", 1)
  const older = await readGeneElection(db, "TP53")
  assert.equal(older.winner.asset_sha256, sha("b"))

  // Votes B and C commit after A's read: two upvotes put a back in front.
  await vote(db, "TP53", sha("a"), "u2", 1)
  await vote(db, "TP53", sha("a"), "u3", 1)
  const newer = await readGeneElection(db, "TP53")
  assert.equal(newer.winner.asset_sha256, sha("a"))
  assert.ok(newer.version > older.version)

  // The older election lands last in wall-clock order: it must be refused.
  const stale = await projectGeneElection(db, older, { actor: "vote_authority" })
  assert.equal(stale.code, "SUPERSEDED")
  assert.equal(current(db, "TP53"), sha("a"))
  assert.equal(
    db.rows("SELECT COUNT(*) AS n FROM icono_publish_events WHERE gene_symbol = 'TP53'")[0].n,
    0,
  )

  // Reverse order: the older election projects first (still current), then
  // the newer one replaces it. The final state is always the newest data's.
  const db2 = new SqliteD1()
  seedAsset(db2, "TP53", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db2, "TP53", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db2, "TP53", sha("a"))
  await vote(db2, "TP53", sha("b"), "u1", 1)
  const first = await readGeneElection(db2, "TP53")
  assert.equal((await projectGeneElection(db2, first, {})).code, "PROMOTED")
  assert.equal(current(db2, "TP53"), sha("b"))
  await vote(db2, "TP53", sha("a"), "u2", 1)
  await vote(db2, "TP53", sha("a"), "u3", 1)
  const second = await readGeneElection(db2, "TP53")
  assert.equal((await projectGeneElection(db2, second, {})).code, "PROMOTED")
  assert.equal(current(db2, "TP53"), sha("a"))
  const events = db2.rows(
    "SELECT action, from_asset_sha256 AS f, to_asset_sha256 AS t FROM icono_publish_events WHERE gene_symbol = 'TP53' ORDER BY id",
  )
  assert.deepEqual(
    events.map((row) => [row.action, row.f, row.t]),
    [
      ["publish", sha("a"), sha("b")],
      ["publish", sha("b"), sha("a")],
    ],
  )
  for (const row of events) assert.equal(PUBLICATION_AFFECTING_ACTIONS.includes(row.action), true)
})

test("1: an admin candidate change advances the version so an in-flight vote election is refused", async () => {
  const db = new SqliteD1()
  seedAsset(db, "SOX4", sha("a"))
  seedAsset(db, "SOX4", sha("b"), { stale: 1 })
  seedPublished(db, "SOX4", sha("a"))
  await vote(db, "SOX4", sha("b"), "u1", 1)
  const inFlight = await readGeneElection(db, "SOX4")
  // Admin unstales b and runs its own election (bump: true) before the vote
  // election lands.
  db.exec(
    "UPDATE icono_portrait_assets SET is_stale = 0 WHERE gene_symbol = 'SOX4' AND asset_sha256 = ?",
    sha("b"),
  )
  const admin = await electAndProjectGeneWinner(db, "SOX4", { actor: "admin", bump: true })
  assert.equal(admin.projection.code, "PROMOTED")
  assert.equal((await projectGeneElection(db, inFlight, {})).code, "UNCHANGED")
  assert.equal(current(db, "SOX4"), sha("b"))
})

// --- 2 ------------------------------------------------------------------

test("2: votes never move a gene an administrator pinned", async () => {
  const db = new SqliteD1()
  seedAsset(db, "MYC", sha("a"))
  seedAsset(db, "MYC", sha("b"))
  seedPublished(db, "MYC", sha("a"), { override: 1 })
  for (const user of ["u1", "u2", "u3"]) await vote(db, "MYC", sha("b"), user, 1)
  const { projection } = await electAndProjectGeneWinner(db, "MYC", { actor: "vote_authority" })
  assert.equal(projection.code, "ADMIN_OVERRIDE")
  assert.equal(current(db, "MYC"), sha("a"))
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM icono_publish_events")[0].n, 0)
})

// --- 3 ------------------------------------------------------------------

test("3: a vote on another gene's asset is refused and writes nothing", async () => {
  const db = new SqliteD1()
  seedAsset(db, "TP53", sha("a"))
  seedAsset(db, "KRAS", sha("c"))
  const before = db.rows("SELECT COUNT(*) AS n FROM icono_image_votes")[0].n
  const refused = await vote(db, "TP53", sha("c"), "u1", 1)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, "VOTE_ASSET_NOT_IN_GENE")
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM icono_image_votes")[0].n, before)
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM icono_gene_vote_version")[0].n, 0)

  const route = await callApi(db, "/api/iconoplasm/votes/set", {
    symbol: "TP53",
    asset_sha256: sha("c"),
    vote_value: 1,
  })
  assert.equal(route.status, 404)
  assert.equal(route.payload.code, "VOTE_ASSET_NOT_IN_GENE")
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM icono_image_votes")[0].n, before)

  const guest = await callApi(
    db,
    "/api/iconoplasm/votes/set",
    { symbol: "TP53", asset_sha256: sha("a"), vote_value: 1 },
    { user: {} },
  )
  assert.equal(guest.status, 401)
})

// --- 4 ------------------------------------------------------------------

async function seedCaretaker(db, symbol, account = "acct_owner") {
  await projectCaretakerAssignmentInD1(db, {
    event_id: `evt-${symbol}-1`,
    event_sequence: 1,
    gene: { gene_id: `gene-${symbol}`, canonical_symbol: symbol },
    assignment: {
      caretaker_assignment_id: `assign-${symbol}`,
      account_id: account,
      status: "active",
      assignment_version: 1,
    },
  })
}

async function supervote(db, symbol, fields) {
  const command = {
    command_id: fields.commandId,
    gene_symbol: symbol,
    caretaker_account_id: fields.accountId,
    asset_sha256: fields.assetSha256 ?? null,
    direction: fields.assetSha256 ? fields.direction : null,
    expected_assignment_version: fields.expectedAssignmentVersion,
    expected_supervote_version: fields.expectedSupervoteVersion,
  }
  return setCaretakerSupervoteInD1(db, {
    symbol,
    ...fields,
    requestSha256: fields.requestSha256 || (await caretakerSupervoteRequestSha256(command)),
  })
}

test("4: a caretaker supervote weighs exactly 10 and obeys every coordinator rule", async () => {
  const db = new SqliteD1()
  seedAsset(db, "EGFR", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, "EGFR", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, "EGFR", sha("a"))
  for (let index = 0; index < 9; index += 1) await vote(db, "EGFR", sha("a"), `u${index}`, 1)
  await seedCaretaker(db, "EGFR")

  const set = await supervote(db, "EGFR", {
    accountId: "acct_owner",
    assetSha256: sha("b"),
    direction: 1,
    commandId: "cmd_1",
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 0,
  })
  assert.equal(set.ok, true)
  assert.equal(set.supervote.weight, 10)
  assert.equal(set.supervote.supervote_version, 1)
  // +10 on b (0 votes) beats 9 ordinary votes on a.
  let election = await readGeneElection(db, "EGFR")
  assert.equal(election.winner.asset_sha256, sha("b"))
  // A tenth ordinary vote ties at 10; the positive supervote wins the tie.
  await vote(db, "EGFR", sha("a"), "u9", 1)
  election = await readGeneElection(db, "EGFR")
  assert.equal(election.winner.asset_sha256, sha("b"))
  // An eleventh outweighs it.
  await vote(db, "EGFR", sha("a"), "u10", 1)
  election = await readGeneElection(db, "EGFR")
  assert.equal(election.winner.asset_sha256, sha("a"))

  // An identical retry replays the receipt; the same id with another request
  // is refused.
  const replay = await supervote(db, "EGFR", {
    accountId: "acct_owner",
    assetSha256: sha("b"),
    direction: 1,
    commandId: "cmd_1",
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 0,
  })
  assert.equal(replay.replayed, true)
  await assert.rejects(
    supervote(db, "EGFR", {
      accountId: "acct_owner",
      assetSha256: sha("a"),
      direction: 1,
      commandId: "cmd_1",
      expectedAssignmentVersion: 1,
      expectedSupervoteVersion: 1,
    }),
    { code: "COMMAND_ID_CONFLICT" },
  )
  for (const [fields, code] of [
    [{ accountId: "acct_owner", expectedSupervoteVersion: 0 }, "STALE_SUPERVOTE_STATE"],
    [{ accountId: "acct_owner", expectedAssignmentVersion: 2 }, "STALE_ASSIGNMENT_STATE"],
    [{ accountId: "acct_intruder" }, "CARETAKER_ASSIGNMENT_NOT_OWNED"],
  ]) {
    await assert.rejects(
      supervote(db, "EGFR", {
        assetSha256: sha("a"),
        direction: -1,
        commandId: `cmd_${code}`,
        expectedAssignmentVersion: 1,
        expectedSupervoteVersion: 1,
        ...fields,
      }),
      { code },
    )
  }
  // A -1 supervote subtracts 10.
  const negative = await supervote(db, "EGFR", {
    accountId: "acct_owner",
    assetSha256: sha("a"),
    direction: -1,
    commandId: "cmd_2",
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 1,
  })
  assert.equal(negative.supervote.direction, -1)
  election = await readGeneElection(db, "EGFR")
  // a: 11 - 10 = 1; b: 0 -> a still leads by score, but by 1, not 11.
  assert.equal(election.rows.find((row) => row.asset_sha256 === sha("a")).score, 11)
  assert.equal(election.winner.asset_sha256, sha("a"))

  // A rejected candidate is ineligible; rejecting the supervoted asset clears it.
  db.exec(
    "UPDATE icono_portrait_assets SET status = 'rejected' WHERE gene_symbol = 'EGFR' AND asset_sha256 = ?",
    sha("b"),
  )
  await assert.rejects(
    supervote(db, "EGFR", {
      accountId: "acct_owner",
      assetSha256: sha("b"),
      direction: 1,
      commandId: "cmd_3",
      expectedAssignmentVersion: 1,
      expectedSupervoteVersion: 2,
    }),
    { code: "SUPERVOTE_TARGET_INELIGIBLE" },
  )
  db.exec(
    "UPDATE icono_portrait_assets SET status = 'rejected' WHERE gene_symbol = 'EGFR' AND asset_sha256 = ?",
    sha("a"),
  )
  const cleared = await invalidateCaretakerSupervoteInD1(db, {
    symbol: "EGFR",
    assetSha256: sha("a"),
  })
  assert.equal(cleared.selection_cleared, true)
  const after = await readCaretakerSupervoteFromD1(db, "EGFR", "acct_owner")
  assert.equal(after.snapshot.active, false)
  assert.equal(after.snapshot.supervote_version, 3)

  // Ending the assignment clears any supervote and is projected once.
  await supervote(db, "EGFR", {
    accountId: "acct_owner",
    commandId: "cmd_clear",
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 3,
  })
  const ended = await projectCaretakerAssignmentInD1(db, {
    event_id: "evt-EGFR-2",
    event_sequence: 2,
    gene: { gene_id: "gene-EGFR", canonical_symbol: "EGFR" },
    assignment: {
      caretaker_assignment_id: "assign-EGFR",
      account_id: "acct_owner",
      status: "ended",
      assignment_version: 2,
    },
  })
  assert.equal(ended.changed, true)
  await assert.rejects(
    projectCaretakerAssignmentInD1(db, {
      event_id: "evt-EGFR-0",
      event_sequence: 1,
      gene: { gene_id: "gene-EGFR", canonical_symbol: "EGFR" },
      assignment: {
        caretaker_assignment_id: "assign-EGFR",
        account_id: "acct_owner",
        status: "active",
        assignment_version: 1,
      },
    }),
    { code: "STALE_ASSIGNMENT_EVENT" },
  )
})

test("4: the supervote route answers in the coordinator's shape and re-elects the gene", async () => {
  const db = new SqliteD1()
  seedAsset(db, "BRCA1", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, "BRCA1", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, "BRCA1", sha("a"))
  await seedCaretaker(db, "BRCA1")
  const user = { user_id: "reader-1", account_id: "acct_owner" }
  const ctx = waitUntilRecorder()
  const response = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/BRCA1/supervote", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: "session=s1" },
      body: JSON.stringify({
        asset_sha256: sha("b"),
        direction: 1,
        command_id: "cmd_route",
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }),
    }),
    withTestMutationAuthority({ ICONOPLASM_DB: db, GAME_SESSIONS: sessions(user) }),
    ctx,
  )
  const payload = await response.json()
  await Promise.all(ctx.promises)
  assert.equal(response.status, 200)
  assert.equal(payload.supervote.asset_sha256, sha("b"))
  assert.equal(payload.symbol, "BRCA1")
  assert.equal(payload.account_id, "acct_owner")
  assert.equal(current(db, "BRCA1"), sha("b"))
  assert.equal(ctx.promises.length, 1, "the gene is republished after the response")
})

// --- 5 ------------------------------------------------------------------

test("5: a failed stable-object publish never fails a committed vote", async (t) => {
  t.mock.method(console, "warn", () => {})
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('TP53', 'tumor protein p53')",
  )
  seedAsset(db, "TP53", sha("a"))
  seedAsset(db, "TP53", sha("b"))
  seedPublished(db, "TP53", sha("a"))
  // The publisher's card materialization is the only statement that fails.
  db.failOn = /catalog_full_name/
  const result = await callApi(db, "/api/iconoplasm/votes/set", {
    symbol: "TP53",
    asset_sha256: sha("b"),
    vote_value: 1,
  })
  assert.equal(result.status, 200)
  assert.equal(result.payload.snapshot.image_upvotes, 1)
  assert.equal(result.payload.snapshot.user_vote, 1)
  assert.equal(result.ctx.promises.length, 1, "the vote scheduled exactly one republish")
  assert.ok(
    db.log.some((entry) => /catalog_full_name/.test(entry.sql)),
    "the republish was attempted",
  )
  // The winner change was still projected, with its publication-affecting
  // event, so the Actions publisher repairs the stable object.
  assert.equal(current(db, "TP53"), sha("b"))
  const event = db.rows("SELECT action FROM icono_publish_events WHERE gene_symbol = 'TP53'")[0]
  assert.equal(PUBLICATION_AFFECTING_ACTIONS.includes(event.action), true)
  // The response carries no field of the retired outbox receipt.
  for (const field of ["auto_promote", "projection_refresh", "operations", "operation_receipt"])
    assert.equal(Object.hasOwn(result.payload, field), false, field)
})

// --- 6 ------------------------------------------------------------------

test("6: vote, election and snapshot statements seek indexes and stay a fixed count", async () => {
  const db = new SqliteD1()
  for (const symbol of ["TP53", "KRAS", "MYC"]) {
    for (const char of ["a", "b", "c"]) seedAsset(db, symbol, sha(char))
  }
  for (let index = 0; index < 40; index += 1) await vote(db, "TP53", sha("a"), `bulk${index}`, 1)
  await seedCaretaker(db, "TP53")

  let mark = db.mark()
  await vote(db, "TP53", sha("b"), "reader", 1)
  await electAndProjectGeneWinner(db, "TP53", { actor: "vote_authority" })
  db.assertIndexedSince(mark)

  const items = []
  for (const symbol of ["TP53", "KRAS", "MYC"])
    for (const char of ["a", "b", "c"]) items.push({ symbol, asset_sha256: sha(char) })
  mark = db.mark()
  const batchesBefore = db.batches
  const snapshots = await readGeneVoteSnapshots(db, { userId: "reader", items })
  assert.equal(db.batches - batchesBefore, 1, "one D1 round trip for any item count")
  assert.equal(db.since(mark).length, 3, "three statements for nine items")
  db.assertIndexedSince(mark)
  const tp53a = snapshots.find((row) => row.symbol === "TP53" && row.asset_sha256 === sha("a"))
  assert.equal(tp53a.snapshot.image_upvotes, 40)
  const tp53b = snapshots.find((row) => row.symbol === "TP53" && row.asset_sha256 === sha("b"))
  assert.equal(tp53b.snapshot.user_vote, 1)
  assert.equal(tp53b.candidate_ref, `a:TP53|${sha("b")}`)

  // A guest snapshot never probes per-user votes.
  mark = db.mark()
  await readGeneVoteSnapshots(db, { userId: "", items })
  assert.equal(db.since(mark).length, 2)

  // The bulk import reads in two set-based statements per chunk.
  mark = db.mark()
  await importGeneVotes(
    db,
    Array.from({ length: GENE_VOTE_IMPORT_CHUNK + 5 }, (_, index) => ({
      symbol: "KRAS",
      asset_sha256: sha("a"),
      user_id: `import${index}`,
      vote_value: 1,
    })),
  )
  db.assertIndexedSince(mark)
  assert.deepEqual(summary(db, "KRAS", sha("a")), recount(db, "KRAS", sha("a")))
})

// --- 7 ------------------------------------------------------------------

function portraitBucket() {
  const objects = new Map()
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, bytes)
      return { key }
    },
    async head(key) {
      return objects.has(key) ? { key } : null
    },
    async get(key) {
      return objects.has(key) ? { body: objects.get(key) } : null
    },
    async delete(key) {
      objects.delete(key)
    },
  }
}

function republishAttempts(db, mark, symbol) {
  return db
    .since(mark)
    .filter((entry) => /catalog_full_name/.test(entry.sql) && entry.args.includes(symbol)).length
}

test("7: an upload that keeps the winner leaves a publication-affecting event, and a sync batch republishes its gene once", async (t) => {
  t.mock.method(console, "warn", () => {})
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('PDX1', 'pancreatic and duodenal homeobox 1')",
  )
  seedAsset(db, "PDX1", sha("a"))
  seedPublished(db, "PDX1", sha("a"))
  for (const user of ["u1", "u2"]) await vote(db, "PDX1", sha("a"), user, 1)
  const png = Buffer.from("not-really-a-webp").toString("base64")
  const env = { admin: true, bindings: { ICONOPLASM_PORTRAITS: portraitBucket() } }
  const upload = (asset, sampleNumber) => ({
    symbol: "PDX1",
    asset_sha256: asset,
    full: png,
    medium: png,
    thumb: png,
    vision_id: "anima-v1-2",
    sample_label: `S${sampleNumber}`,
    sample_number: sampleNumber,
    sample_text_hash: sha("e"),
  })

  // A sync batch: ingest marked defer_read_models (reconcile follows), then
  // reconcile over the batch's genes. Exactly one republish, by reconcile.
  let mark = db.mark()
  const ingest = await callApi(
    db,
    "/api/iconoplasm/admin/ingest",
    { defer_read_models: true, items: [upload(sha("f"), 1)] },
    { env },
  )
  assert.equal(ingest.status, 200, JSON.stringify(ingest.payload))
  assert.equal(ingest.payload.processed, 1)
  assert.equal(ingest.payload.results[0].candidate_event, "candidate_added")
  assert.equal(ingest.payload.republished_in_process, false, "reconcile republishes the batch")
  assert.equal(republishAttempts(db, mark, "PDX1"), 0)
  const reconcile = await callApi(
    db,
    "/api/iconoplasm/admin/reconcile",
    {
      defer_read_models: true,
      keep: [
        { symbol: "PDX1", asset_sha256: sha("a") },
        { symbol: "PDX1", asset_sha256: sha("f") },
      ],
    },
    { env },
  )
  assert.equal(reconcile.status, 200, JSON.stringify(reconcile.payload))
  assert.equal(reconcile.payload.republished_in_process, true)
  assert.equal(republishAttempts(db, mark, "PDX1"), 1, "one republish per sync batch")
  const events = db.rows("SELECT action FROM icono_publish_events WHERE gene_symbol = 'PDX1'")
  assert.deepEqual(
    events.map((row) => row.action),
    ["candidate_added"],
  )
  assert.equal(PUBLICATION_AFFECTING_ACTIONS.includes("candidate_added"), true)
  // The winner did not change.
  assert.equal(current(db, "PDX1"), sha("a"))

  // A direct ingest (no reconcile follows) republishes its gene itself.
  mark = db.mark()
  const direct = await callApi(
    db,
    "/api/iconoplasm/admin/ingest",
    { items: [upload(sha("d"), 2)] },
    { env },
  )
  assert.equal(direct.status, 200, JSON.stringify(direct.payload))
  assert.equal(direct.payload.republished_in_process, true)
  assert.equal(republishAttempts(db, mark, "PDX1"), 1)

  // Every candidate-changing action the runtime writes is publication-affecting.
  const runtime = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  for (const action of [
    "candidate_added",
    "candidate_changed",
    "copy_candidate",
    "edit_candidate",
    "generate_candidate",
    "unstale",
    "restore_keep",
    "legacy_mark",
    "reject",
    "remove_candidate",
    "publish",
  ]) {
    assert.ok(runtime.includes(`'${action}'`) || runtime.includes(`"${action}"`), action)
    assert.equal(PUBLICATION_AFFECTING_ACTIONS.includes(action), true, action)
  }
  // The Actions publisher's dirty-gene query uses the same list object.
  const publisher = readFileSync(
    new URL("../scripts/publish-iconoplasm-catalog.mjs", import.meta.url),
    "utf8",
  )
  assert.match(
    publisher,
    /import \{ PUBLICATION_AFFECTING_ACTIONS \} from "\.\.\/workers\/iconoplasm-catalog-dispatch\.js"/,
  )
  assert.match(publisher, /WHERE id > \? AND action IN \(\$\{PUBLICATION_AFFECTING_ACTIONS/)
})

// --- 8 ------------------------------------------------------------------

function coordinatorBinding(exported) {
  return {
    idFromString: (id) => id,
    get: () => ({ fetch: async () => Response.json(exported) }),
  }
}

test("8: the coordinator compare route reports every difference a replay needs and never writes", async () => {
  const db = new SqliteD1()
  seedAsset(db, "PDX1", sha("a"))
  seedAsset(db, "PDX1", sha("b"))
  seedPublished(db, "PDX1", sha("a"))
  await vote(db, "PDX1", sha("a"), "both", 1)
  await vote(db, "PDX1", sha("a"), "only-d1", 1)
  await vote(db, "PDX1", sha("a"), "differs", 1)
  // Voted and then cleared in D1: the row is gone, its events remain.
  await vote(db, "PDX1", sha("a"), "cleared-in-d1", 1)
  await vote(db, "PDX1", sha("a"), "cleared-in-d1", 0)
  await seedCaretaker(db, "PDX1", "acct_d1")
  const exported = {
    ok: true,
    bootstrapped: true,
    symbol: "PDX1",
    authority_epoch: "v2",
    published_asset_sha256: sha("b"),
    votes: [
      { user_id: "both", asset_sha256: sha("a"), vote_value: 1 },
      {
        user_id: "differs",
        asset_sha256: sha("a"),
        vote_value: -1,
        vision_id: "anima-v1-9",
        updated_at: "2026-10-03 21:00:00",
      },
      {
        user_id: "only-coordinator",
        asset_sha256: sha("a"),
        vote_value: 1,
        vision_id: "anima-v1-7",
        updated_at: "2026-10-03T21:05:00.000Z",
      },
      { user_id: "cleared-in-d1", asset_sha256: sha("a"), vote_value: 1 },
      ...Array.from({ length: 24 }, (_, index) => ({
        user_id: `bulk-${index}`,
        asset_sha256: sha("b"),
        vote_value: 1,
      })),
    ],
    asset_summaries: [
      { asset_sha256: sha("a"), upvotes: 2, downvotes: 1, score: 1, vote_count: 3 },
    ],
    caretaker_supervote: {
      active: false,
      assignment: {
        caretaker_assignment_id: "assign-PDX1",
        caretaker_account_id: "acct_coordinator",
        status: "active",
        assignment_version: 1,
      },
    },
  }
  const env = { ICONOPLASM_DB: db, ICONOPLASM_VOTE_COORDINATORS: coordinatorBinding(exported) }
  const mark = db.mark()
  const result = await compareIconoplasmVoteCoordinatorWithD1(env, "1".repeat(64))
  assert.equal(result.compared, true)
  assert.equal(result.differs, true)
  assert.equal(result.votes_missing_in_d1, 26)
  assert.equal(result.votes_only_in_d1, 1)
  assert.equal(result.votes_value_differs, 1)
  assert.equal(result.summaries_differ, 1)
  assert.equal(result.published_asset_differs, true)
  assert.equal(result.coordinator_published_asset_sha256, sha("b"))
  assert.equal(result.d1_published_asset_sha256, sha("a"))
  assert.equal(result.assignment_differs, true)
  assert.equal(result.samples.assignment.d1.caretaker_account_id, "acct_d1")
  assert.equal(result.samples.missing_in_d1.length, 20, "20 samples per category by default")
  const differs = result.samples.value_differs[0]
  assert.deepEqual(differs.coordinator, {
    value: -1,
    vision_id: "anima-v1-9",
    updated_at: "2026-10-03 21:00:00",
  })
  assert.equal(differs.d1.value, 1)
  assert.match(differs.d1.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(differs.d1.vision_id, "anima-v1-1")
  assert.equal(result.samples.only_in_d1[0].user_id, "only-d1")
  assert.ok(result.samples.only_in_d1[0].d1.updated_at)

  const all = await compareIconoplasmVoteCoordinatorWithD1(env, "1".repeat(64), { sampleLimit: 0 })
  assert.equal(all.samples.missing_in_d1.length, 26, "sampleLimit 0 lifts the cap")
  const onlyCoordinator = all.samples.missing_in_d1.find(
    (row) => row.user_id === "only-coordinator",
  )
  assert.deepEqual(onlyCoordinator.coordinator, {
    value: 1,
    vision_id: "anima-v1-7",
    updated_at: "2026-10-03T21:05:00.000Z",
  })
  assert.equal(onlyCoordinator.d1_last_event_at, null)
  const cleared = all.samples.missing_in_d1.find((row) => row.user_id === "cleared-in-d1")
  assert.ok(cleared.d1_last_event_at, "a vote cleared in D1 shows its last D1 event")
  const writes = db.since(mark).filter(({ sql }) => /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))
  assert.deepEqual(writes, [])

  // The route passes all_samples through.
  const route = await callApi(
    db,
    "/api/iconoplasm/admin/votes/compare-coordinators",
    { object_ids: ["1".repeat(64)], all_samples: true },
    {
      env: {
        admin: true,
        bindings: { ICONOPLASM_VOTE_COORDINATORS: coordinatorBinding(exported) },
      },
    },
  )
  assert.equal(route.status, 200, JSON.stringify(route.payload))
  assert.equal(route.payload.results[0].samples.missing_in_d1.length, 26)
})

// --- 9 ------------------------------------------------------------------

test("9: summaries move by the exact delta through retries, flips, clears and imports", async () => {
  const db = new SqliteD1()
  seedAsset(db, "KRAS", sha("a"))
  const steps = [1, 1, -1, 0, 0, -1, 1]
  for (const value of steps) {
    const before = db.mark()
    const result = await vote(db, "KRAS", sha("a"), "flipper", value)
    assert.equal(result.ok, true)
    if (!result.changed) assert.equal(db.since(before).length, 2, "an unchanged vote only reads")
    assert.deepEqual(summary(db, "KRAS", sha("a")), recount(db, "KRAS", sha("a")))
  }
  const imported = await importGeneVotes(db, [
    { symbol: "KRAS", asset_sha256: sha("a"), user_id: "i1", vote_value: 1 },
    { symbol: "KRAS", asset_sha256: sha("a"), user_id: "i1", vote_value: -1 },
    { symbol: "KRAS", asset_sha256: sha("a"), user_id: "i2", vote_value: 1 },
    { symbol: "KRAS", asset_sha256: sha("d"), user_id: "i3", vote_value: 1 },
    { symbol: "KRAS", asset_sha256: "not-a-sha", user_id: "i4", vote_value: 1 },
  ])
  assert.equal(imported.results.filter((row) => row.ok).length, 2)
  assert.equal(
    imported.results.find((row) => row.asset_sha256 === sha("d")).code,
    "VOTE_ASSET_NOT_IN_GENE",
  )
  assert.equal(imported.invalid, 1)
  assert.deepEqual(summary(db, "KRAS", sha("a")), recount(db, "KRAS", sha("a")))
  assert.equal(
    db.rows("SELECT vote_value FROM icono_image_votes WHERE user_id = 'i1'")[0].vote_value,
    -1,
    "a later item for the same user and asset wins",
  )
})

// --- 10 -----------------------------------------------------------------

test("10: the retired vote coordinator only exports; its alarm is inert", async () => {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE vote_by_user_asset (user_id TEXT, asset_sha256 TEXT, vision_id TEXT, candidate_image_id INTEGER, vote_value INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE asset_summary (asset_sha256 TEXT PRIMARY KEY, vision_id TEXT, candidate_image_id INTEGER, upvotes INTEGER, downvotes INTEGER, score INTEGER, vote_count INTEGER);
    INSERT INTO meta VALUES ('symbol', 'TP53'), ('bootstrapped', '1'), ('authority_epoch', 'v2');
  `)
  sqlite
    .prepare("INSERT INTO vote_by_user_asset VALUES ('u1', ?, '', NULL, 1, '', '')")
    .run(sha("a"))
  const state = {
    storage: {
      sql: {
        exec(query, ...bindings) {
          const rows = sqlite.prepare(query).all(...bindings)
          return { toArray: () => rows }
        },
      },
    },
  }
  const coordinator = new IconoplasmVoteCoordinator(state, {})
  assert.deepEqual(await coordinator.alarm(), { ok: true, inert: true })
  const refused = await coordinator.fetch(
    new Request("https://c/vote/set", { method: "POST", body: "{}" }),
  )
  assert.equal(refused.status, 404)
  const exported = await (await coordinator.fetch(new Request("https://c/vote/export"))).json()
  assert.equal(exported.symbol, "TP53")
  assert.equal(exported.votes.length, 1)
  assert.equal(exported.caretaker_supervote.active, false)
})

// --- 11 -----------------------------------------------------------------

test("11: a vote that lands while its gene's object is written is republished once more", async () => {
  const db = new SqliteD1()
  seedAsset(db, "TP53", sha("a"))
  const env = { ICONOPLASM_DB: db }
  // The materialization reads the live count, like the real card source.
  const source = {
    async materialize(symbols) {
      const row = db.rows(
        "SELECT upvotes FROM icono_vote_asset_summary WHERE gene_symbol = 'TP53' AND asset_sha256 = ?",
        sha("a"),
      )[0]
      return symbols.map((symbol) => ({
        symbol,
        payload: { symbol, upvotes: Number(row?.upvotes || 0), portrait_candidates: [] },
      }))
    },
    complete: () => true,
    stable: (card) => card,
    project: (payload) => payload,
  }
  const written = []
  let interleave = null
  const objects = {
    async writeStable(key, value) {
      if (interleave) {
        const run = interleave
        interleave = null
        await run()
      }
      written.push(value)
      return { key, hash: "e".repeat(64), size: 1, purged: true }
    },
  }

  // Nothing lands in between: one write, stamped with the version it read.
  await vote(db, "TP53", sha("a"), "u1", 1)
  const quiet = await publishIconoplasmGeneStableObject(env, "TP53", { source, objects })
  assert.deepEqual(
    written.map((object) => [object.upvotes, object.vote_version]),
    [[1, 1]],
  )
  assert.equal(quiet.republished_after_vote, undefined)

  // Vote A commits and its republish reads version 2. Before A's PUT lands,
  // vote B commits and B's own republish finishes: A's older object then
  // lands on top. A sees the version moved and republishes once more.
  written.length = 0
  await vote(db, "TP53", sha("a"), "u2", 1)
  interleave = async () => {
    await vote(db, "TP53", sha("a"), "u3", 1)
    await publishIconoplasmGeneStableObject(env, "TP53", { source, objects })
  }
  const result = await publishIconoplasmGeneStableObject(env, "TP53", { source, objects })
  assert.deepEqual(
    written.map((object) => [object.upvotes, object.vote_version]),
    [
      [3, 3],
      [2, 2],
      [3, 3],
    ],
    "B's object, A's stale object on top of it, then A's republish from fresh rows",
  )
  assert.equal(result.republished_after_vote, true)
  assert.equal(result.vote_version, 3)
})

// --- 12 -----------------------------------------------------------------

const BUDGETED_TABLES = [
  "icono_image_votes",
  "icono_vote_asset_summary",
  "icono_vote_events",
  "icono_gene_vote_version",
  "icono_vote_daily_budget",
  "icono_caretaker_supervote_projection",
  "icono_caretaker_supervote_events",
  "icono_caretaker_supervote_command_receipts",
  "icono_publish_state",
  "icono_publish_events",
]

function budgetedRows(db) {
  return JSON.stringify(
    BUDGETED_TABLES.map((table) => db.rows(`SELECT * FROM ${table} ORDER BY 1, 2`)),
  )
}

test("12: past the daily vote budget a vote, a reader import or a supervote writes nothing and answers 429", async () => {
  const db = new SqliteD1()
  seedAsset(db, "TP53", sha("a"))
  seedAsset(db, "TP53", sha("b"))
  seedPublished(db, "TP53", sha("a"))
  const voteWith = (userId, voteValue, extra = {}) =>
    setGeneVote(db, {
      symbol: "TP53",
      assetSha256: sha("a"),
      userId,
      voteValue,
      dailyVoteLimit: 2,
      ...extra,
    })
  assert.equal((await voteWith("u1", 1)).ok, true)
  assert.equal((await voteWith("u1", 1)).changed, false, "an unchanged vote")
  assert.equal((await voteWith("u2", 1)).ok, true)
  assert.equal(
    db.rows("SELECT votes FROM icono_vote_daily_budget")[0].votes,
    2,
    "two changed votes spent two units; the unchanged one spent none",
  )

  const before = budgetedRows(db)
  const refused = await voteWith("u3", 1)
  assert.deepEqual(refused, {
    ok: false,
    status: 429,
    code: VOTE_DAILY_BUDGET_EXHAUSTED,
    error: VOTE_DAILY_BUDGET_MESSAGE,
  })
  assert.equal((await voteWith("u1", -1)).code, VOTE_DAILY_BUDGET_EXHAUSTED, "a flip too")
  const imported = await importGeneVotes(
    db,
    [
      { symbol: "TP53", asset_sha256: sha("b"), user_id: "i1", vote_value: 1 },
      { symbol: "TP53", asset_sha256: sha("b"), user_id: "i2", vote_value: 1 },
    ],
    { dailyVoteLimit: 2 },
  )
  assert.equal(imported.refused, true)
  assert.deepEqual(
    imported.results.map((row) => row.status),
    [429, 429],
  )
  assert.deepEqual(imported.changed_symbols, [])
  assert.equal(budgetedRows(db), before, "the refusals wrote nothing")

  // The administrator's vote is not admitted, so it is never refused.
  assert.equal((await voteWith("curator", 1, { admit: false })).ok, true)

  // Through the routes, at the real limit.
  const db2 = new SqliteD1()
  seedAsset(db2, "BRCA1", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db2, "BRCA1", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db2, "BRCA1", sha("a"))
  await seedCaretaker(db2, "BRCA1")
  db2.exec(
    "INSERT INTO icono_vote_daily_budget (day, votes) VALUES (date('now'), ?)",
    VOTE_DAILY_LIMIT,
  )
  const before2 = budgetedRows(db2)
  const route = await callApi(db2, "/api/iconoplasm/votes/set", {
    symbol: "BRCA1",
    asset_sha256: sha("b"),
    vote_value: 1,
  })
  assert.equal(route.status, 429)
  assert.equal(route.payload.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.equal(route.payload.error, VOTE_DAILY_BUDGET_MESSAGE)
  assert.equal(route.ctx.promises.length, 0, "a refused vote republishes nothing")
  const ctx = waitUntilRecorder()
  const supervote = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/BRCA1/supervote", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: "session=s1" },
      body: JSON.stringify({
        asset_sha256: sha("b"),
        direction: 1,
        command_id: "cmd_budget",
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }),
    }),
    withTestMutationAuthority({
      ICONOPLASM_DB: db2,
      GAME_SESSIONS: sessions({ user_id: "reader-1", account_id: "acct_owner" }),
    }),
    ctx,
  )
  const supervotePayload = await supervote.json()
  assert.equal(supervote.status, 429)
  assert.equal(supervotePayload.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.equal(supervotePayload.error, VOTE_DAILY_BUDGET_MESSAGE)
  assert.equal(budgetedRows(db2), before2, "the refused routes wrote nothing")
  const admin = await callApi(
    db2,
    "/api/iconoplasm/admin/votes/set",
    { symbol: "BRCA1", asset_sha256: sha("b"), user_id: "curator", vote_value: 1 },
    { env: { admin: true } },
  )
  assert.equal(admin.status, 200, JSON.stringify(admin.payload))
})

// --- 13 -----------------------------------------------------------------

test("13: every changed vote leaves one icono_vote_events row for the workstation's mirror", async () => {
  const db = new SqliteD1()
  seedAsset(db, "KRAS", sha("a"))
  for (const value of [1, 1, -1, 0, 0]) await vote(db, "KRAS", sha("a"), "u1", value)
  await importGeneVotes(db, [
    { symbol: "KRAS", asset_sha256: sha("a"), user_id: "i1", vote_value: 1 },
    { symbol: "KRAS", asset_sha256: sha("a"), user_id: "i2", vote_value: -1 },
  ])
  assert.deepEqual(
    db
      .rows("SELECT user_id, vote_value, candidate_ref FROM icono_vote_events ORDER BY id")
      .map((row) => [row.user_id, row.vote_value, row.candidate_ref]),
    [
      ["u1", 1, `a:KRAS|${sha("a")}`],
      ["u1", -1, `a:KRAS|${sha("a")}`],
      ["u1", 0, `a:KRAS|${sha("a")}`],
      ["i1", 1, `a:KRAS|${sha("a")}`],
      ["i2", -1, `a:KRAS|${sha("a")}`],
    ],
    "one row per change, clears included, none for the two unchanged repeats",
  )
})

// --- 14 -----------------------------------------------------------------

const hexAsset = (n) => n.toString(16).padStart(64, "0")

test("14: only eligible candidates count toward the election bound", async () => {
  const db = new SqliteD1()
  // 300 rejected and 300 stale candidates of history, two eligible ones.
  for (let n = 1; n <= 600; n += 1) {
    seedAsset(db, "MYC", hexAsset(n), {
      status: n <= 300 ? "rejected" : "draft",
      stale: n > 300 ? 1 : 0,
    })
  }
  seedAsset(db, "MYC", sha("a"))
  seedAsset(db, "MYC", sha("b"))
  seedPublished(db, "MYC", sha("a"))
  await vote(db, "MYC", sha("b"), "u1", 1)
  const mark = db.mark()
  const election = await readGeneElection(db, "MYC")
  db.assertIndexedSince(mark)
  assert.equal(election.overflow, false)
  assert.deepEqual(election.rows.map((row) => row.asset_sha256).sort(), [sha("a"), sha("b")])
  assert.equal(election.winner.asset_sha256, sha("b"))
  assert.equal(election.rows.find((row) => row.asset_sha256 === sha("b")).upvotes, 1)

  // 257 eligible candidates are past the bound: nothing is projected.
  for (let n = 1; n <= 257; n += 1) seedAsset(db, "SOX2", hexAsset(n))
  seedPublished(db, "SOX2", hexAsset(1))
  const { projection } = await electAndProjectGeneWinner(db, "SOX2", { actor: "vote_authority" })
  assert.equal(projection.code, "CANDIDATE_SET_EXCEEDS_BOUND")
})

// --- 15 -----------------------------------------------------------------

test("15: a vote import elects every gene it names, so re-running it repairs a stale winner", async () => {
  const db = new SqliteD1()
  seedAsset(db, "KRAS", sha("a"))
  seedAsset(db, "KRAS", sha("b"))
  seedPublished(db, "KRAS", sha("b"))
  // The vote committed but its election never ran (a failed request).
  await vote(db, "KRAS", sha("a"), "u1", 1)
  assert.equal(current(db, "KRAS"), sha("b"))
  const result = await callApi(
    db,
    "/api/iconoplasm/admin/votes/import",
    { items: [{ symbol: "KRAS", asset_sha256: sha("a"), user_id: "u1", vote_value: 1 }] },
    { env: { admin: true } },
  )
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(result.payload.upserted, 1)
  assert.equal(result.payload.elected, 1)
  assert.equal(result.payload.auto_promoted, 1)
  assert.equal(current(db, "KRAS"), sha("a"))
  assert.equal(
    db.rows("SELECT COUNT(*) AS n FROM icono_vote_events WHERE user_id = 'u1'")[0].n,
    1,
    "the identical re-import wrote no vote",
  )
})

// --- 16 -----------------------------------------------------------------

test("16: restarting the read-model bootstrap keeps the vote summaries elections read", async (t) => {
  t.mock.method(console, "warn", () => {})
  const db = new SqliteD1()
  for (const symbol of ["AAA1", "ZZZ9"]) {
    db.exec("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)", symbol, symbol)
    seedAsset(db, symbol, sha("a"))
    seedPublished(db, symbol, sha("a"))
    for (const user of ["u1", "u2"]) await vote(db, symbol, sha("a"), user, 1)
  }
  const mark = db.mark()
  const result = await callApi(
    db,
    "/api/iconoplasm/admin/read-models/bootstrap",
    { reset: true, steps: 1, symbol_batch: 1 },
    { env: { admin: true } },
  )
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(
    db
      .since(mark)
      .some(({ sql }) => /DELETE\s+FROM\s+icono_vote_asset_summary\s*$/i.test(sql.trim())),
    false,
    "no statement empties the summary table",
  )
  for (const symbol of ["AAA1", "ZZZ9"])
    assert.deepEqual(summary(db, symbol, sha("a")), recount(db, symbol, sha("a")), symbol)
})

// --- 17 -----------------------------------------------------------------

test("17: leftover vote-projection Queue messages are acknowledged and dropped", async () => {
  const acked = []
  const retried = []
  const messages = ["TP53", "KRAS"].map((symbol) => ({
    body: { kind: "process_vote_projection_refresh", symbol },
    ack: () => acked.push(symbol),
    retry: () => retried.push(symbol),
  }))
  // No bindings at all: the drop must not reach the sync governor, D1 or
  // the finalization consumer.
  const result = await handleIconoplasmQueue(
    { queue: "iconoplasm-vote-projection", messages },
    {},
    { waitUntil() {} },
  )
  assert.deepEqual(acked, ["TP53", "KRAS"])
  assert.deepEqual(retried, [])
  assert.equal(result.ok, true)
  assert.equal(result.dropped, 2)
})
