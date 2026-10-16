// B-898 Stage 2: D1 is the only store for votes. These tests run the vote,
// supervote, snapshot and upload paths against a real SQLite database
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
//     ineligible candidate, or twice for one command id; or it keeps counting
//     after the caretaker's role ends.
//  5. A failed stable-object publish turns a committed vote into an error.
//  6. A snapshot or vote statement scans a vote table instead of seeking an
//     index, or the statement count grows with the item count.
//  7. An upload that does not change the winner leaves no
//     publication-affecting event, so the new candidate never reaches readers;
//     a direct one-gene upload is not republished in process; or a sync batch
//     (ingest with defer_read_models, then reconcile) republishes a gene twice.
//  9. A vote summary drifts from the vote rows (identical retries, flips,
//     clears, bulk imports).
// 11. A vote commits while its gene's stable object is being written, its own
//     republish lands first, and the older object overwrites it for good.
// 12. A vote, supervote or reader import past the daily vote budget writes
//     anything at all (vote row, summary, event, version, budget), or the
//     refusal is not a 429 with words a reader can act on; an unchanged vote
//     spends budget; an administrator's vote is refused.
// 13. A vote still writes a row for the workstation's vote mirror, which
//     nothing reads (B-1065: about 6 of a vote's 15-21 rows).
// 14. A gene's rejected or stale history counts toward the 256-candidate
//     election bound, so a gene with a long history stops electing.
// 15. A vote import elects only the genes whose votes changed, so re-running
//     an import cannot repair a gene whose election failed the first time.
// 16. Restarting the admin read-model bootstrap empties the vote summaries the
//     election reads, so every gene not yet rebuilt elects from zero votes.
// 18. A vote import names more genes, or carries more votes, than one Worker
//     invocation can handle on the free plan's 50 D1 queries: it is accepted,
//     writes some votes and dies before electing every gene, instead of being
//     refused up front (400, naming the limit) with nothing written. The
//     largest import the limits allow makes more than 40 D1 queries.
// 19. An election fails inside an import and the route still answers 200, so a
//     caller that reads only `upserted` believes the import finished; or a
//     re-run does not repair the gene whose election failed.
// 20. An image edit's publish imports (and spends budget on) more than the
//     inherited-upvote limit plus the publisher's own vote, however many
//     upvotes its source holds or its stored job row claims.
// 23. A read-model sync empties the vote summaries elections read, whatever
//     the request body asks for: a vote that lands before the table is refilled
//     elects from zero votes everywhere.
// 24. The vote projection job table survives the migrations, or Worker or
//     release source still names it.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate as handleApi,
  publishIconoplasmGeneStableObject,
  publishRequestPickerObject,
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
  invalidateCaretakerSupervote,
  readCaretakerSupervote,
  setCaretakerSupervote,
} from "./iconoplasm/caretaker/caretaker-supervote.js"
import { changeRole } from "./iconoplasm/caretaker-roles.js"
import {
  IMAGE_EDIT_INHERITED_UPVOTE_LIMIT,
  VOTE_DAILY_BUDGET_EXHAUSTED,
  VOTE_PERSON_DAILY_LIMIT,
  VOTE_IMPORT_MAX_GENES,
  VOTE_IMPORT_MAX_ITEMS,
} from "./iconoplasm/votes/vote-guards.js"
import { PUBLICATION_AFFECTING_ACTIONS } from "./iconoplasm-catalog-dispatch.js"
import { secondsUntilCloudflareDailyReset } from "./lib/cloudflare-availability.js"
import {
  BOT_TOKEN,
  CHANNEL_ID,
  FakeNetwork,
  STORAGE_PASSWORD,
  STORAGE_ZONE,
} from "./test-helpers/fake-discord-and-bunny.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const VOTE_TABLES = [
  "icono_image_votes",
  "icono_vote_asset_summary",
  "icono_portrait_assets",
  "icono_publish_events",
  "icono_caretaker_assignments",
  "icono_gene_vote_version",
  "icono_vote_person_day",
]
const sha = (char) => char.repeat(64)
// One asset's vote totals as readers see them (the summary the cards read).
const summaryOf = (db, symbol, asset) => {
  const row = db.rows(
    "SELECT score, vote_count FROM icono_vote_asset_summary WHERE gene_symbol = ? AND asset_sha256 = ?",
    symbol,
    asset,
  )[0]
  return row ? { score: row.score, vote_count: row.vote_count } : null
}
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
    // Every round trip to D1 the Worker makes: one per first/all/run/raw call
    // and one per batch(), however many statements the batch carries (measured
    // on the free plan, B-914; vote-guards.js records it). The import bounds
    // keep the largest import under the 50 calls the D1 limits page lists.
    this.calls = 0
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
        if (db.failOn && db.failOn.test(statement.sql, statement.args))
          throw new Error("injected D1 failure")
        const prepared = db.sqlite.prepare(statement.sql)
        if (mode === "run") {
          const info = prepared.run(...statement.args)
          return { success: true, results: [], meta: { changes: Number(info.changes || 0) } }
        }
        const rows = prepared.all(...statement.args)
        return { success: true, results: rows, meta: { changes: 0, rows_read: rows.length } }
      },
      async first(column) {
        db.calls += 1
        const row = statement.execute("all").results[0] ?? null
        return row && column ? (row[column] ?? null) : row
      },
      async all() {
        db.calls += 1
        return statement.execute("all")
      },
      async run() {
        db.calls += 1
        return statement.execute("run")
      },
      async raw() {
        db.calls += 1
        return statement.execute("all").results.map((row) => Object.values(row))
      },
    }
    return statement
  }
  async batch(statements) {
    this.batches += 1
    this.calls += 1
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

// A catalogue row: the publisher builds a card only for a gene the catalogue carries.
function seedGene(db, symbol, { fullName = symbol, color = null } = {}) {
  db.exec(
    "INSERT OR IGNORE INTO icono_gene_catalog (gene_symbol, full_name, color_hex) VALUES (?, ?, ?)",
    symbol,
    fullName,
    color,
  )
}

// The publisher's canonical text reader, for genes with no text (the manifestation
// authority has its own tests).
const noText = async () => null
const upvotesOf = (card) => card.portrait_candidates[0]?.image_upvotes ?? 0

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

// A browser signed in as `user` (B-1069: a real sealed session cookie); an empty
// `user` is a guest, whose request carries no session cookie at all.
async function signedInHeaders(user, headers = {}) {
  return user?.user_id ? { ...headers, Cookie: await sessionCookieFor(user) } : headers
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
  const headers = await signedInHeaders(user, { "Content-Type": "application/json" })
  if (env.admin) headers.Authorization = `Bearer ${ADMIN_TOKEN}`
  const response = await handleApi(
    new Request(`https://iconoplasm.brinedew.bio${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    {
      ICONOPLASM_DB: db,
      SESSION_SECRET: TEST_SESSION_SECRET,
      ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
      ...env.bindings,
    },
    ctx,
  )
  const payload = await response.json()
  await Promise.all(ctx.promises)
  return { status: response.status, payload, ctx, headers: response.headers }
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

// The gene's caretaker role, as a claim leaves it (caretaker-roles.js).
function seedCaretaker(db, symbol, account = "acct_owner") {
  db.exec(
    `INSERT INTO icono_caretaker_assignments
       (caretaker_assignment_id, gene_symbol, account_id, status, terms_accepted_at,
        relinquish_policy, invited_by_account_id, started_at)
     VALUES (?, ?, ?, 'active', '2026-10-01', 'retain', ?, '2026-10-01')`,
    `assign-${symbol}`,
    symbol,
    account,
    account,
  )
}

function supervote(db, symbol, fields) {
  return setCaretakerSupervote(db, { symbol, ...fields })
}

test("4: a caretaker supervote weighs exactly 10 and obeys every supervote rule", async () => {
  const db = new SqliteD1()
  seedAsset(db, "EGFR", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, "EGFR", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, "EGFR", sha("a"))
  for (let index = 0; index < 9; index += 1) await vote(db, "EGFR", sha("a"), `u${index}`, 1)
  seedCaretaker(db, "EGFR")

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

  // A retry of the last command replays it, whatever the retry carries: a
  // command ID names one click.
  for (const assetSha256 of [sha("b"), sha("a")]) {
    const replay = await supervote(db, "EGFR", {
      accountId: "acct_owner",
      assetSha256,
      direction: 1,
      commandId: "cmd_1",
      expectedAssignmentVersion: 1,
      expectedSupervoteVersion: 0,
    })
    assert.equal(replay.replayed, true)
    assert.equal(replay.supervote.asset_sha256, sha("b"))
    assert.equal(replay.supervote.supervote_version, 1)
  }
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
  const cleared = await invalidateCaretakerSupervote(db, {
    symbol: "EGFR",
    assetSha256: sha("a"),
    invalidationId: "invalidate_a",
  })
  assert.equal(cleared.selection_cleared, true)
  const after = await readCaretakerSupervote(db, "EGFR", "acct_owner")
  assert.equal(after.snapshot.active, false)
  assert.equal(after.snapshot.supervote_version, 3)

  // A supervote decides the gene; then the role ends. The supervote stops
  // counting with nothing to clear, and the gene's vote version moves, so the
  // next election cannot be one computed before the end.
  seedAsset(db, "EGFR", sha("c"))
  seedAsset(db, "EGFR", sha("d"))
  for (const user of ["v1", "v2", "v3"]) await vote(db, "EGFR", sha("d"), user, 1)
  await supervote(db, "EGFR", {
    accountId: "acct_owner",
    assetSha256: sha("c"),
    direction: 1,
    commandId: "cmd_c",
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 3,
  })
  assert.equal((await readGeneElection(db, "EGFR")).winner.asset_sha256, sha("c"))
  const versionBefore = (await readGeneElection(db, "EGFR")).version
  const ended = await changeRole(db, {
    roleId: "assign-EGFR",
    action: "end",
    expectedVersion: 1,
    actorAccountId: "acct_owner",
    ownerAccountId: "acct_owner",
    now: "2026-10-11T00:00:00.000Z",
    reason: "caretaker_resigned",
    policy: "retain",
  })
  assert.equal(ended.changed, true)
  assert.deepEqual(ended.reElect, ["EGFR"])
  election = await readGeneElection(db, "EGFR")
  assert.equal(election.winner.asset_sha256, sha("d"))
  assert.ok(election.version > versionBefore, "the end moved the gene's vote version")
  assert.equal((await readCaretakerSupervote(db, "EGFR")).role, null)
})

test("4: the supervote route answers with the supervote and re-elects the gene", async () => {
  const db = new SqliteD1()
  seedAsset(db, "BRCA1", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, "BRCA1", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, "BRCA1", sha("a"))
  seedCaretaker(db, "BRCA1")
  const user = { user_id: "reader-1", account_id: "acct_owner" }
  const ctx = waitUntilRecorder()
  const response = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/BRCA1/supervote", {
      method: "PUT",
      headers: await signedInHeaders(user, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        asset_sha256: sha("b"),
        direction: 1,
        command_id: "cmd_route",
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }),
    }),
    { ICONOPLASM_DB: db, SESSION_SECRET: TEST_SESSION_SECRET },
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

test("7: an upload that keeps the winner leaves a publication-affecting event, and a batch republishes its gene once", async (t) => {
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

  // A repair batch: ingest marked defer_read_models (the caller rebuilds read
  // models once for all its batches) still republishes its genes, exactly once.
  // B-1067: it used to wait for a reconcile call nobody made any more.
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
  assert.equal(ingest.payload.republished_in_process, true)
  assert.equal(republishAttempts(db, mark, "PDX1"), 1, "one republish per batch")
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

// --- 11 -----------------------------------------------------------------

test("11: a vote that lands while its gene's object is written is republished once more", async () => {
  const db = new SqliteD1()
  seedGene(db, "TP53")
  seedAsset(db, "TP53", sha("a"))
  const env = { ICONOPLASM_DB: db }
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
      return { key, hash: "e".repeat(64), size: 1 }
    },
  }

  // Nothing lands in between: one write, stamped with the version it read.
  await vote(db, "TP53", sha("a"), "u1", 1)
  const quiet = await publishIconoplasmGeneStableObject(env, "TP53", {
    objects,
    readManifestation: noText,
  })
  assert.deepEqual(
    written.map((object) => [upvotesOf(object), object.vote_version]),
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
    await publishIconoplasmGeneStableObject(env, "TP53", { objects, readManifestation: noText })
  }
  const result = await publishIconoplasmGeneStableObject(env, "TP53", {
    objects,
    readManifestation: noText,
  })
  assert.deepEqual(
    written.map((object) => [upvotesOf(object), object.vote_version]),
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

test("11: the republish rechecks after every write, at most three passes", async () => {
  const db = new SqliteD1()
  seedGene(db, "TP53")
  seedAsset(db, "TP53", sha("a"))
  const env = { ICONOPLASM_DB: db }
  // Each queued interleave is one vote that commits while the publisher's PUT
  // is in flight and finishes its own republish first, so the publisher's
  // older object then lands on top of it. Nested publishes never trigger the
  // next interleave.
  const interleaves = []
  const written = []
  let nested = false
  let ownWrites = 0
  const objects = {
    async writeStable(key, value) {
      if (!nested) {
        ownWrites += 1
        const run = interleaves.shift()
        if (run) {
          nested = true
          try {
            await run()
          } finally {
            nested = false
          }
        }
      }
      written.push([upvotesOf(value), value.vote_version])
      return { key, hash: "e".repeat(64), size: 1 }
    },
  }
  const landVote = (userId) => async () => {
    await vote(db, "TP53", sha("a"), userId, 1)
    await publishIconoplasmGeneStableObject(env, "TP53", { objects, readManifestation: noText })
  }

  // Two votes land in two different PUT windows: the second one is only seen
  // by the pass that the first one's recheck started, so that pass must
  // recheck as well.
  await vote(db, "TP53", sha("a"), "u1", 1)
  await vote(db, "TP53", sha("a"), "u2", 1)
  interleaves.push(landVote("u3"), landVote("u4"))
  const result = await publishIconoplasmGeneStableObject(env, "TP53", {
    objects,
    readManifestation: noText,
  })
  assert.deepEqual(
    written,
    [
      [3, 3],
      [2, 2],
      [4, 4],
      [3, 3],
      [4, 4],
    ],
    "u3's object, the stale pass-1 object on top, u4's object, the stale pass-2 object on top, then the pass-3 object from fresh rows",
  )
  assert.equal(ownWrites, 3)
  assert.equal(result.republished_after_vote, true)
  assert.equal(result.vote_version, 4)
  assert.deepEqual(written.at(-1), [4, 4], "the last object written holds every vote")

  // A vote lands in every window: the publisher stops after three passes and
  // leaves the newest vote to its own republish.
  written.length = 0
  ownWrites = 0
  for (const userId of ["u5", "u6", "u7", "u8", "u9"]) interleaves.push(landVote(userId))
  const stormy = await publishIconoplasmGeneStableObject(env, "TP53", {
    objects,
    readManifestation: noText,
  })
  assert.equal(ownWrites, 3, "three passes, never a fourth")
  assert.equal(stormy.republished_after_vote, true)
})

// --- 12 -----------------------------------------------------------------

const BUDGETED_TABLES = [
  "icono_image_votes",
  "icono_vote_asset_summary",
  "icono_gene_vote_version",
  "icono_vote_person_day",
  "icono_caretaker_assignments",
  "icono_publish_state",
  "icono_publish_events",
]

function budgetedRows(db) {
  return JSON.stringify(
    BUDGETED_TABLES.map((table) => db.rows(`SELECT * FROM ${table} ORDER BY 1, 2`)),
  )
}

// B-1065: the allowance is per person. Failure modes: one person's votes spend
// another's; a refused batch writes anything; the sentence or the reset is lost.
const LIMIT_SENTENCE = /^Daily vote limit reached; vote again in \d+ hours?\.$/

test("12: past a person's daily vote allowance their vote, import or supervote writes nothing and answers 429", async () => {
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
  assert.equal((await voteWith("u1", -1)).ok, true)
  assert.deepEqual(
    db.rows("SELECT user_id, changes FROM icono_vote_person_day").map((row) => ({ ...row })),
    [{ user_id: "u1", changes: 2 }],
    "two changed votes spent two of u1's; the unchanged one spent none",
  )

  const before = budgetedRows(db)
  const refused = await voteWith("u1", 1)
  assert.equal(refused.status, 429)
  assert.equal(refused.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.match(refused.error, LIMIT_SENTENCE)
  const imported = await importGeneVotes(
    db,
    [
      { symbol: "TP53", asset_sha256: sha("b"), user_id: "i1", vote_value: 1 },
      { symbol: "TP53", asset_sha256: sha("b"), user_id: "i2", vote_value: 1 },
    ],
    { chargeTo: "u1", dailyVoteLimit: 2 },
  )
  assert.equal(imported.refused, true)
  assert.deepEqual(
    imported.results.map((row) => row.status),
    [429, 429],
  )
  assert.deepEqual(imported.changed_symbols, [])
  assert.equal(budgetedRows(db), before, "the refusals wrote nothing")

  // Another person still votes: u1's spent allowance is u1's alone.
  assert.equal((await voteWith("u2", 1)).ok, true)
  // The administrator's vote and import are charged to nobody, so never refused.
  assert.equal((await voteWith("curator", 1, { admit: false })).ok, true)

  // Through the routes, at the real limit.
  const db2 = new SqliteD1()
  seedAsset(db2, "BRCA1", sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db2, "BRCA1", sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db2, "BRCA1", sha("a"))
  await seedCaretaker(db2, "BRCA1")
  db2.exec(
    "INSERT INTO icono_vote_person_day (user_id, day, changes) VALUES ('reader-1', date('now'), ?), ('caretaker:acct_owner', date('now'), ?)",
    VOTE_PERSON_DAILY_LIMIT,
    VOTE_PERSON_DAILY_LIMIT,
  )
  const before2 = budgetedRows(db2)
  const route = await callApi(db2, "/api/iconoplasm/votes/set", {
    symbol: "BRCA1",
    asset_sha256: sha("b"),
    vote_value: 1,
  })
  assert.equal(route.status, 429)
  assert.equal(route.payload.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.match(route.payload.error, LIMIT_SENTENCE)
  assert.equal(route.ctx.promises.length, 0, "a refused vote republishes nothing")
  const ctx = waitUntilRecorder()
  const supervote = await handleApi(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/BRCA1/supervote", {
      method: "PUT",
      headers: await signedInHeaders(
        { user_id: "reader-1", account_id: "acct_owner" },
        { "Content-Type": "application/json" },
      ),
      body: JSON.stringify({
        asset_sha256: sha("b"),
        direction: 1,
        command_id: "cmd_budget",
        expected_assignment_version: 1,
        expected_supervote_version: 0,
      }),
    }),
    {
      ICONOPLASM_DB: db2,
      SESSION_SECRET: TEST_SESSION_SECRET,
    },
    ctx,
  )
  const supervotePayload = await supervote.json()
  assert.equal(supervote.status, 429)
  assert.equal(supervotePayload.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.match(supervotePayload.error, LIMIT_SENTENCE)
  assert.equal(budgetedRows(db2), before2, "the refused routes wrote nothing")
  const admin = await callApi(
    db2,
    "/api/iconoplasm/admin/votes/set",
    { symbol: "BRCA1", asset_sha256: sha("b"), user_id: "curator", vote_value: 1 },
    { env: { admin: true } },
  )
  assert.equal(admin.status, 200, JSON.stringify(admin.payload))
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
  assert.deepEqual(
    summaryOf(db, "KRAS", sha("a")),
    { score: 1, vote_count: 1 },
    "the identical re-import counted the vote once",
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

// --- 18 -----------------------------------------------------------------

function seedPromotableGene(db, symbol) {
  seedAsset(db, symbol, sha("a"), { createdAt: "2026-01-02 00:00:00" })
  seedAsset(db, symbol, sha("b"), { createdAt: "2026-01-01 00:00:00" })
  seedPublished(db, symbol, sha("a"))
}

// `count` upvotes for asset b spread over `genes` genes, each from its own
// voter: every gene's winner moves to b, the most an election can cost.
function importItems(genes, count) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `GENE${(index % genes) + 1}`,
    asset_sha256: sha("b"),
    user_id: `voter-${index}`,
    vote_value: 1,
  }))
}

const importRoute = (db, items) =>
  callApi(db, "/api/iconoplasm/admin/votes/import", { items }, { env: { admin: true } })

test("18: an import past the free plan's D1 query limit is refused up front; the largest one allowed stays under 40 queries", async (t) => {
  const db = new SqliteD1()
  for (let gene = 1; gene <= VOTE_IMPORT_MAX_GENES + 1; gene += 1)
    seedPromotableGene(db, `GENE${gene}`)
  const before = budgetedRows(db)

  db.calls = 0
  const tooManyGenes = await importRoute(
    db,
    importItems(VOTE_IMPORT_MAX_GENES + 1, VOTE_IMPORT_MAX_GENES + 1),
  )
  assert.equal(tooManyGenes.status, 400)
  assert.match(
    tooManyGenes.payload.error,
    new RegExp(`at most ${VOTE_IMPORT_MAX_GENES} genes and ${VOTE_IMPORT_MAX_ITEMS} votes`),
  )
  const tooManyVotes = await importRoute(db, importItems(1, VOTE_IMPORT_MAX_ITEMS + 1))
  assert.equal(tooManyVotes.status, 400)
  assert.match(tooManyVotes.payload.error, new RegExp(`${VOTE_IMPORT_MAX_ITEMS} votes`))
  assert.equal(db.calls, 0, "refused before a single D1 call")
  assert.equal(budgetedRows(db), before, "refused before anything was written")

  // The largest import the limits allow: every vote count and every gene at
  // its bound, every election moving its winner.
  const largest = await importRoute(db, importItems(VOTE_IMPORT_MAX_GENES, VOTE_IMPORT_MAX_ITEMS))
  assert.equal(largest.status, 200, JSON.stringify(largest.payload))
  assert.equal(largest.payload.upserted, VOTE_IMPORT_MAX_ITEMS)
  assert.equal(largest.payload.elected, VOTE_IMPORT_MAX_GENES)
  assert.equal(largest.payload.elections_failed, 0)
  assert.equal(largest.payload.auto_promoted, VOTE_IMPORT_MAX_GENES)
  // Two D1 calls per chunk of votes (a read batch, a write batch) and two per
  // gene (the election read, the projection); the Worker makes no others.
  const expected =
    2 * Math.ceil(VOTE_IMPORT_MAX_ITEMS / GENE_VOTE_IMPORT_CHUNK) + 2 * VOTE_IMPORT_MAX_GENES
  t.diagnostic(
    `largest import: ${db.calls} D1 calls for ${VOTE_IMPORT_MAX_ITEMS} votes over ${VOTE_IMPORT_MAX_GENES} genes`,
  )
  assert.equal(db.calls, expected)
  assert.ok(db.calls <= 40, `${db.calls} D1 calls`)
})

// --- 19 -----------------------------------------------------------------

test("19: an import whose election fails answers non-2xx with the failed symbols, and re-running it repairs them", async () => {
  const db = new SqliteD1()
  seedPromotableGene(db, "TP53")
  seedPromotableGene(db, "KRAS")
  const items = ["TP53", "KRAS"].map((symbol) => ({
    symbol,
    asset_sha256: sha("b"),
    user_id: "u1",
    vote_value: 1,
  }))
  // KRAS's election read fails; the vote writes and TP53's election do not.
  db.failOn = {
    test: (sql, args) => /icono_caretaker_assignments/.test(sql) && args[0] === "KRAS",
  }
  const failed = await importRoute(db, items)
  assert.equal(failed.status, 502, JSON.stringify(failed.payload))
  assert.equal(failed.payload.ok, false)
  assert.equal(failed.payload.code, "VOTE_IMPORT_ELECTION_FAILED")
  assert.deepEqual(failed.payload.failed_symbols, ["KRAS"])
  assert.match(failed.payload.error, /KRAS/)
  assert.match(failed.payload.error, /run the import again/i)
  assert.equal(failed.payload.upserted, 2, "the votes themselves committed")
  assert.equal(current(db, "TP53"), sha("b"), "the other gene was elected")
  assert.equal(current(db, "KRAS"), sha("a"), "the failed gene was not")

  db.failOn = null
  const retry = await importRoute(db, items)
  assert.equal(retry.status, 200, JSON.stringify(retry.payload))
  assert.equal(retry.payload.elections_failed, 0)
  assert.equal(retry.payload.elected, 2)
  assert.equal(current(db, "KRAS"), sha("b"), "re-running the same import repaired it")
  for (const symbol of ["TP53", "KRAS"])
    assert.deepEqual(
      summaryOf(db, symbol, sha("b")),
      { score: 1, vote_count: 1 },
      `the identical re-import counted ${symbol}'s vote once`,
    )
})

// --- 20 -----------------------------------------------------------------

function seedImageEditJob(db, { id, symbol, source, result, inherited }) {
  db.exec(
    `INSERT INTO icono_image_edit_jobs (
       id, user_id, provider_id, source_gene_symbol, source_asset_sha256,
       status, result_asset_sha256, result_r2_key_full, result_r2_key_medium,
       result_r2_key_thumb, result_mime, inherited_upvotes
     ) VALUES (?, 'reader-1', 'openai', ?, ?, 'succeeded', ?, 'f', 'm', 't', 'image/webp', ?)`,
    id,
    symbol,
    source,
    result,
    inherited,
  )
}

async function publishImageEdit(db, id, { user = "reader-1" } = {}) {
  const ctx = waitUntilRecorder()
  const response = await handleApi(
    new Request(`https://iconoplasm.brinedew.bio/api/iconoplasm/image-edit/jobs/${id}/publish`, {
      method: "POST",
      headers: await signedInHeaders({ user_id: user }),
    }),
    {
      ICONOPLASM_DB: db,
      SESSION_SECRET: TEST_SESSION_SECRET,
    },
    ctx,
  )
  const payload = await response.json()
  await Promise.all(ctx.promises)
  return { status: response.status, payload }
}

test("20: an image edit's publish imports at most 25 inherited votes and the publisher's own, and spends exactly that many budget units", async () => {
  assert.equal(IMAGE_EDIT_INHERITED_UPVOTE_LIMIT, 25)
  const db = new SqliteD1()
  seedAsset(db, "A1BG", sha("a"))
  seedPublished(db, "A1BG", sha("a"))
  // The source holds 1,000 upvotes. A job row stored with 900 inherited votes
  // (90% of them) must still import only the limit.
  db.exec(
    `INSERT INTO icono_vote_asset_summary (gene_symbol, asset_sha256, candidate_ref, upvotes, score, vote_count)
     VALUES ('A1BG', ?, ?, 1000, 1000, 1000)`,
    sha("a"),
    `a:A1BG|${sha("a")}`,
  )
  seedImageEditJob(db, {
    id: "job-big",
    symbol: "A1BG",
    source: sha("a"),
    result: sha("c"),
    inherited: 900,
  })

  const published = await publishImageEdit(db, "job-big")
  assert.equal(published.status, 200, JSON.stringify(published.payload))
  assert.equal(published.payload.vote_inheritance.inherited_upvotes, 25)
  assert.equal(published.payload.vote_inheritance.imported_votes, 26)
  assert.equal(published.payload.job.inherited_upvotes, 25, "the job reports what it imported")
  assert.equal(
    db.rows(
      "SELECT COUNT(*) AS n FROM icono_image_votes WHERE gene_symbol = 'A1BG' AND asset_sha256 = ?",
      sha("c"),
    )[0].n,
    26,
    "25 inherited votes plus the publisher's own",
  )
  assert.equal(
    db.rows(
      "SELECT COUNT(*) AS n FROM icono_image_votes WHERE gene_symbol = 'A1BG' AND asset_sha256 = ? AND user_id = 'reader-1'",
      sha("c"),
    )[0].n,
    1,
  )
  assert.equal(
    db.rows("SELECT changes FROM icono_vote_person_day WHERE user_id = 'reader-1'")[0].changes,
    26,
    "the publisher's allowance pays for the votes the edit brings",
  )
  assert.equal(summary(db, "A1BG", sha("c")).upvotes, 26)

  // A smaller source inherits its 90% in full: 10 upvotes, 9 inherited votes.
  seedAsset(db, "B1BG", sha("d"))
  seedPublished(db, "B1BG", sha("d"))
  seedImageEditJob(db, {
    id: "job-small",
    symbol: "B1BG",
    source: sha("d"),
    result: sha("e"),
    inherited: 9,
  })
  const small = await publishImageEdit(db, "job-small")
  assert.equal(small.status, 200, JSON.stringify(small.payload))
  assert.equal(small.payload.vote_inheritance.inherited_upvotes, 9)
  assert.equal(small.payload.vote_inheritance.imported_votes, 10)
  assert.equal(
    db.rows("SELECT changes FROM icono_vote_person_day WHERE user_id = 'reader-1'")[0].changes,
    36,
  )
})

// 22. Something still addresses the deleted vote coordinator, so the first
//     vote-adjacent request after the migration throws on a missing binding; or
//     a script, route or doc keeps describing a compare, an export or a queue
//     message kind that no longer exists. Migration history (v2 created the
//     class, v9 deleted it) is the only place the class may be named.
test("22: nothing addresses the deleted vote coordinator, its compare route, its export or its queue messages", () => {
  const root = new URL("../", import.meta.url)
  const stale =
    /IconoplasmVoteCoordinator|ICONOPLASM_VOTE_COORDINATORS|compare-coordinators|export-to-d1|export-iconoplasm-votes|process_vote_projection_refresh|iconoplasm-vote-projection/
  const files = []
  for (const [directory, extension] of [
    ["workers", /\.js$/],
    ["scripts", /\.(?:m?js|ps1)$/],
    [".github/workflows", /\.ya?ml$/],
    ["docs", /\.md$/],
  ]) {
    for (const name of readdirSync(new URL(`${directory}/`, root), { recursive: true }).map(
      String,
    )) {
      const relative = `${directory}/${name.replaceAll("\\", "/")}`
      if (
        !extension.test(name) ||
        /\.test\.js$/.test(name) ||
        relative.startsWith("docs/superpowers/")
      )
        continue
      files.push(relative)
    }
  }
  const offenders = files.filter((relative) =>
    stale.test(readFileSync(new URL(relative, root), "utf8")),
  )
  assert.deepEqual(offenders, [])
  const toml = readFileSync(
    new URL("wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml", root),
    "utf8",
  )
  for (const line of toml.split(/\r?\n/).filter((item) => stale.test(item)))
    assert.match(
      line,
      /^(?:new_sqlite_classes|deleted_classes) = /,
      `the toml names the class outside a migration: ${line}`,
    )
})

// 23. A scoped read-model sync syncs its own scope and empties nothing, even
//     when its body asks for a full rebuild; and no source file holds a
//     statement that deletes every row of the summary table elections read.
function sourcesUnder(directory) {
  const root = new URL(`../${directory}/`, import.meta.url)
  return readdirSync(root, { recursive: true })
    .map((name) => String(name).replaceAll("\\", "/"))
    .filter(
      (name) => /\.m?js$/.test(name) && !/\.test\.js$/.test(name) && !name.startsWith("generated/"),
    )
    .map((name) => ({
      name: `${directory}/${name}`,
      text: readFileSync(new URL(name, root), "utf8"),
    }))
}
const workerSources = () => sourcesUnder("workers")

test("23: a read-model sync that asks for a full rebuild syncs only its scope and nothing empties the vote summaries", async (t) => {
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
    "/api/iconoplasm/admin/read-models/sync",
    { symbols: ["AAA1"], full_rebuild: true },
    { env: { admin: true } },
  )
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  const emptying = db.since(mark).filter(({ sql }) => /^\s*DELETE\s+FROM\s+\w+\s*;?\s*$/i.test(sql))
  assert.deepEqual(emptying, [], "no statement deletes every row of a table")
  for (const symbol of ["AAA1", "ZZZ9"])
    assert.deepEqual(summary(db, symbol, sha("a")), recount(db, symbol, sha("a")), symbol)

  const offenders = workerSources()
    .filter(
      ({ text }) =>
        /bulkRebuildAdminReadModels/.test(text) ||
        /DELETE\s+FROM\s+icono_vote_asset_summary\s*(?:`|"|')/.test(text),
    )
    .map(({ name }) => name)
  assert.deepEqual(offenders, [], "no source can empty the summary table")
})

// 24. After every checked-in migration the vote projection job table is gone,
//     and no Worker or release source reads or writes it.
test("24: the vote projection job table does not survive the migrations or the source", () => {
  const table = "icono_vote_projection_refresh_jobs"
  const db = new SqliteD1()
  assert.deepEqual(
    db.rows("SELECT type, name FROM sqlite_schema WHERE instr(sql, ?) > 0", table),
    [],
    "no schema object names the vote projection job table",
  )
  const offenders = [...workerSources(), ...sourcesUnder("scripts")]
    .filter(({ text }) => text.includes(table))
    .map(({ name }) => name)
  assert.deepEqual(offenders, [], "no Worker or release script names the vote projection job table")
})

// --- 25 -----------------------------------------------------------------

// B-912: the budget refusal tells a client when voting is back.
//
// Ways this can fail, written before the code:
//  1. the 429 carries no Retry-After header, or no retry_after_seconds in the body (the body is
//     the only channel the extension's fetch proxy and a cross-origin page can read);
//  2. the header and the body disagree;
//  3. the number is not the seconds to 00:00:00 UTC: it keeps the 00:00:05 margin that
//     secondsUntilCloudflareDailyReset adds by default (the route passes 0; the function's own
//     table is in cloudflare-d1-availability.test.js);
//  4. a refusal that is not the budget (400) or a vote the server takes carries a Retry-After;
//  5. the number is not a whole number of seconds from 1 to 86,400.
test("25: the daily-budget 429 carries the seconds to 00:00 UTC, in the header and in the body", async () => {
  const seed = async (spent) => {
    const db = new SqliteD1()
    seedAsset(db, "BRCA1", sha("a"), { createdAt: "2026-01-02 00:00:00" })
    seedAsset(db, "BRCA1", sha("b"), { createdAt: "2026-01-01 00:00:00" })
    seedPublished(db, "BRCA1", sha("a"))
    await seedCaretaker(db, "BRCA1")
    if (spent) {
      db.exec(
        "INSERT INTO icono_vote_person_day (user_id, day, changes) VALUES ('reader-1', date('now'), ?)",
        VOTE_PERSON_DAILY_LIMIT,
      )
    }
    return db
  }
  const vote = (db, body = {}) =>
    callApi(db, "/api/iconoplasm/votes/set", {
      symbol: "BRCA1",
      asset_sha256: sha("b"),
      vote_value: 1,
      ...body,
    })

  // The refusal: the number is read before and after the call, because the clock moves.
  const spent = await seed(true)
  const before = secondsUntilCloudflareDailyReset(Date.now(), 0)
  const refused = await vote(spent)
  const after = secondsUntilCloudflareDailyReset(Date.now(), 0)
  assert.equal(refused.status, 429)
  assert.equal(refused.payload.code, VOTE_DAILY_BUDGET_EXHAUSTED)
  assert.match(refused.payload.error, LIMIT_SENTENCE)
  const header = refused.headers.get("Retry-After")
  assert.match(String(header), /^[1-9][0-9]*$/, "a whole number of seconds")
  assert.equal(
    Number(header),
    refused.payload.retry_after_seconds,
    "the header and the body say the same thing",
  )
  assert.ok(Number.isInteger(refused.payload.retry_after_seconds))
  assert.ok(
    refused.payload.retry_after_seconds <= before && refused.payload.retry_after_seconds >= after,
    `retry ${refused.payload.retry_after_seconds} must be the seconds to 00:00 UTC (${after}..${before})`,
  )
  assert.ok(
    refused.payload.retry_after_seconds >= 1 && refused.payload.retry_after_seconds <= 86_400,
  )
  assert.equal(refused.headers.get("Cache-Control"), "no-store")

  // A refusal that is not the budget says nothing about the reset.
  const invalid = await vote(await seed(true), { vote_value: 5 })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.headers.get("Retry-After"), null)
  assert.equal("retry_after_seconds" in invalid.payload, false)

  // A vote the server takes says nothing about it either.
  const taken = await vote(await seed(false))
  assert.equal(taken.status, 200, JSON.stringify(taken.payload))
  assert.equal(taken.headers.get("Retry-After"), null)
  assert.equal("retry_after_seconds" in taken.payload, false)
})

// B-972: the sole guards of the rules below lived in tests that ran the route against a
// hand-written fake D1, which re-implemented the SQL in JavaScript. These run the real
// routes on the migrated schema. A refused or failed request must leave the tables as it
// found them, and nothing private may leave the Worker.

async function routeRequest(
  db,
  method,
  path,
  { body, user = { user_id: "reader-1", username: "reader" }, bindings = {} } = {},
) {
  const pending = []
  const ctx = { waitUntil: (promise) => pending.push(Promise.resolve(promise).catch(() => {})) }
  const response = await handleApi(
    new Request(`https://iconoplasm.brinedew.bio${path}`, {
      method,
      headers: await signedInHeaders(user, { "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {
      ICONOPLASM_DB: db,
      SESSION_SECRET: TEST_SESSION_SECRET,
      ...bindings,
    },
    ctx,
  )
  const payload = await response.json().catch(() => null)
  await Promise.all(pending)
  return { status: response.status, payload }
}

// 27. An image edit's publish belongs to its owner, and a failure says which step stopped.
//     The candidate write and the final confirmation are separate steps: after the second
//     one fails the candidate and its votes exist, so the retry must finish the publish
//     without adding a second audit event.
test("27: an image edit's publish is owner-only, names the step that failed, and a retry adds no second audit event", async () => {
  const db = new SqliteD1()
  seedAsset(db, "A1BG", sha("a"))
  seedPublished(db, "A1BG", sha("a"))
  seedImageEditJob(db, {
    id: "job-ladder",
    symbol: "A1BG",
    source: sha("a"),
    result: sha("c"),
    inherited: 3,
  })
  const resultAssets = () =>
    db.rows("SELECT COUNT(*) AS n FROM icono_portrait_assets WHERE asset_sha256 = ?", sha("c"))[0].n
  const auditEvents = () =>
    db.rows("SELECT COUNT(*) AS n FROM icono_publish_events WHERE action = 'edit_candidate'")[0].n

  // Someone else's job is not found, and nothing is written for it.
  const intruder = await publishImageEdit(db, "job-ladder", { user: "intruder-1" })
  assert.equal(intruder.status, 404)
  assert.equal(resultAssets(), 0)
  assert.equal(auditEvents(), 0)

  // The candidate write fails: the edit is saved, no candidate was added, nothing was voted.
  db.failOn = { test: (sql) => sql.includes("INSERT INTO icono_portrait_assets") }
  const noCandidate = await publishImageEdit(db, "job-ladder")
  assert.equal(noCandidate.status, 503)
  assert.equal(noCandidate.payload.code, "IMAGE_EDIT_PUBLISH_CANDIDATE_FAILED")
  assert.equal(noCandidate.payload.failure.candidate_added, false)
  assert.equal(noCandidate.payload.failure.vote_recorded, false)
  assert.equal(noCandidate.payload.job.published, false)
  assert.equal(resultAssets(), 0)

  // The final confirmation fails after the candidate and its votes committed: it says so.
  db.failOn = { test: (sql) => sql.includes("UPDATE icono_image_edit_jobs") }
  const noConfirmation = await publishImageEdit(db, "job-ladder")
  assert.equal(noConfirmation.status, 503)
  assert.equal(noConfirmation.payload.code, "IMAGE_EDIT_PUBLISH_CONFIRMATION_FAILED")
  assert.equal(noConfirmation.payload.failure.candidate_added, true)
  assert.equal(noConfirmation.payload.failure.vote_recorded, true)
  assert.equal(resultAssets(), 1)
  assert.equal(auditEvents(), 1)

  // The retry finishes the publish and the audit trail still has one event.
  db.failOn = null
  const retry = await publishImageEdit(db, "job-ladder")
  assert.equal(retry.status, 200, JSON.stringify(retry.payload))
  assert.equal(retry.payload.job.published, true)
  assert.equal(auditEvents(), 1)
})

// 28. A reader's own image-provider key is theirs: stored encrypted, never returned by any
//     route, never visible to another account or a guest.
test("28: a saved provider key is stored encrypted, never returned, and invisible to other accounts", async () => {
  const db = new SqliteD1()
  const bindings = {
    ICONOPLASM_IMAGE_EDIT_KEY_SECRET: "test-secret-with-more-than-32-bytes-for-aes",
  }
  const saved = await routeRequest(db, "POST", "/api/iconoplasm/image-edit/providers", {
    body: {
      provider_id: "openai",
      api_key: "sk-test-secret",
      endpoint_url: "https://api.openai.com/v1",
      model: "gpt-image-2.5-sunburst",
    },
    bindings,
  })
  assert.equal(saved.status, 200, JSON.stringify(saved.payload))
  const stored = db.rows("SELECT * FROM icono_user_image_provider_keys")[0]
  assert.ok(stored.encrypted_api_key && stored.encryption_iv)
  assert.equal(JSON.stringify(stored).includes("sk-test-secret"), false)

  const own = await routeRequest(db, "GET", "/api/iconoplasm/image-edit/providers", { bindings })
  assert.equal(own.status, 200)
  assert.deepEqual(
    own.payload.providers.map((provider) => [provider.provider_id, provider.configured]),
    [["openai", true]],
  )
  const listed = JSON.stringify(own.payload)
  for (const secret of ["sk-test-secret", stored.encrypted_api_key, stored.encryption_iv]) {
    assert.equal(listed.includes(secret), false, "key material left the Worker")
  }

  const other = await routeRequest(db, "GET", "/api/iconoplasm/image-edit/providers", {
    user: { user_id: "reader-2" },
    bindings,
  })
  assert.deepEqual(other.payload.providers, [])
  const guest = await routeRequest(db, "GET", "/api/iconoplasm/image-edit/providers", {
    user: {},
    bindings,
  })
  assert.equal(guest.status, 401)
})

// 29. Gene suggestions are public to read, but a hidden one never renders, no one is named by
//     account id, a guest cannot write, and only the author can edit or delete one.
test("29: gene comments hide hidden ones, need a sign-in to write, and only the author can change one", async () => {
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_comments (gene_symbol, user_id, username, body, status) VALUES ('A1BG', 'reader-2', 'visible-user', 'Should have an eraser instead of a pen.', 'visible')",
  )
  db.exec(
    "INSERT INTO icono_gene_comments (gene_symbol, user_id, username, body, status) VALUES ('A1BG', 'reader-3', 'hidden-user', 'This hidden prompt should never render.', 'hidden')",
  )

  const read = await routeRequest(db, "GET", "/api/iconoplasm/comments/gene/A1BG", { user: {} })
  assert.equal(read.status, 200)
  assert.deepEqual(
    read.payload.comments.map((comment) => comment.body),
    ["Should have an eraser instead of a pen."],
  )
  assert.equal(
    JSON.stringify(read.payload).includes("reader-2"),
    false,
    "user ids stay server-side",
  )

  const comment = { symbol: "A1BG", body: "Please add a lab stamp." }
  const guest = await routeRequest(db, "POST", "/api/iconoplasm/comments", {
    body: comment,
    user: {},
  })
  assert.equal(guest.status, 401)

  const written = await routeRequest(db, "POST", "/api/iconoplasm/comments", { body: comment })
  assert.equal(written.status, 200, JSON.stringify(written.payload))
  const mine = db.rows(
    "SELECT id, user_id FROM icono_gene_comments WHERE body = 'Please add a lab stamp.'",
  )[0]
  assert.equal(mine.user_id, "reader-1")

  const commentsPath = "/api/iconoplasm/genes/A1BG/comments"
  for (const method of ["PATCH", "DELETE"]) {
    const refused = await routeRequest(db, method, commentsPath, {
      body: { id: mine.id, body: "Rewritten by someone else." },
      user: { user_id: "reader-2" },
    })
    assert.equal(refused.status, 403, method)
  }
  const untouched = db.rows("SELECT body, status FROM icono_gene_comments WHERE id = ?", mine.id)[0]
  assert.equal(untouched.body, "Please add a lab stamp.")
  assert.equal(untouched.status, "visible")

  const edited = await routeRequest(db, "PATCH", commentsPath, {
    body: { id: mine.id, body: "Please add a lab stamp, please." },
  })
  assert.equal(edited.status, 200, JSON.stringify(edited.payload))
  const removed = await routeRequest(db, "DELETE", commentsPath, { body: { id: mine.id } })
  assert.equal(removed.status, 200, JSON.stringify(removed.payload))
  assert.equal(
    db.rows("SELECT status FROM icono_gene_comments WHERE id = ?", mine.id)[0].status,
    "deleted",
  )
})

// B-1101: readers who are not signed in read a gene's comments from a CDN object, because a
// gene page view costs no Worker request. Failure modes, written before the code:
// G1. The public copy carries an account id, an ownership flag or a hidden comment.
// G2. A post, an edit or a delete leaves the public copy stale.
// G3. Deleting the last comment leaves the old text in public instead of an empty list.
// G5. Storage being down turns a comment that was saved into an error for its author.
// (G4, an erased name left in public, is in iconoplasm-account-erasure-d1.test.js.)
test("B-1101: a gene's public comments copy follows every post, edit and delete", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  const db = new SqliteD1()
  db.exec(
    "INSERT INTO icono_gene_comments (gene_symbol, user_id, username, body, status) VALUES ('A1BG', 'reader-3', 'hidden-user', 'This hidden prompt should never render.', 'hidden')",
  )
  const bunny = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STORAGE_ZONE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: STORAGE_PASSWORD,
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
  }
  const KEY = "comments/v1/A1BG.json"
  const publicCopy = () => JSON.parse(Buffer.from(network.objects.get(KEY)).toString("utf8"))
  const bodies = () => publicCopy().comments.map((comment) => comment.body)
  const commentsPath = "/api/iconoplasm/genes/A1BG/comments"

  const posted = await routeRequest(db, "POST", "/api/iconoplasm/comments", {
    body: { symbol: "A1BG", body: "Please add a lab stamp." },
    bindings: bunny,
  })
  assert.equal(posted.status, 200, JSON.stringify(posted.payload))
  const other = await routeRequest(db, "POST", "/api/iconoplasm/comments", {
    body: { symbol: "A1BG", body: "Keep the pen." },
    user: { user_id: "reader-2", username: "other" },
    bindings: bunny,
  })
  assert.equal(other.status, 200)
  // G1, G2: the copy is what a guest's API answer would be, newest first, with nothing private.
  assert.deepEqual(bodies(), ["Keep the pen.", "Please add a lab stamp."])
  assert.equal(publicCopy().symbol, "A1BG")
  assert.equal(publicCopy().count, 2)
  const text = JSON.stringify(publicCopy())
  assert.doesNotMatch(text, /reader-1|reader-2|user_id|is_own|hidden/)
  const guestApi = await routeRequest(db, "GET", "/api/iconoplasm/comments/gene/A1BG", {
    user: {},
  })
  assert.deepEqual(
    publicCopy().comments.map((comment) => [comment.id, comment.username, comment.body]),
    guestApi.payload.comments.map((comment) => [comment.id, comment.username, comment.body]),
  )

  // G2: an edit and a delete reach the copy.
  const mine = db.rows(
    "SELECT id FROM icono_gene_comments WHERE body = 'Please add a lab stamp.'",
  )[0].id
  const edited = await routeRequest(db, "PATCH", commentsPath, {
    body: { id: mine, body: "Please add a lab stamp, please." },
    bindings: bunny,
  })
  assert.equal(edited.status, 200)
  assert.deepEqual(bodies(), ["Keep the pen.", "Please add a lab stamp, please."])
  const refused = await routeRequest(db, "DELETE", commentsPath, {
    body: { id: mine },
    user: { user_id: "reader-2" },
    bindings: bunny,
  })
  assert.equal(refused.status, 403)
  assert.equal(publicCopy().count, 2, "a refused delete changes nothing in public")
  assert.equal(
    (await routeRequest(db, "DELETE", commentsPath, { body: { id: mine }, bindings: bunny }))
      .status,
    200,
  )
  assert.deepEqual(bodies(), ["Keep the pen."])

  // G3: the last comment's delete leaves an empty list, not the old text.
  const theirs = db.rows("SELECT id FROM icono_gene_comments WHERE body = 'Keep the pen.'")[0].id
  const last = await routeRequest(db, "DELETE", commentsPath, {
    body: { id: theirs },
    user: { user_id: "reader-2", username: "other" },
    bindings: bunny,
  })
  assert.equal(last.status, 200)
  assert.deepEqual(publicCopy(), { symbol: "A1BG", count: 0, comments: [] })

  // G6: a commenter's picture is embedded, so a guest makes no /api/avatar request and never
  // contacts Discord; it is fetched once however many comments its author wrote.
  const avatar = encodeURIComponent("https://cdn.discordapp.com/avatars/42/face.png")
  for (const body of ["First of two.", "Second of two."]) {
    db.exec(
      "INSERT INTO icono_gene_comments (gene_symbol, user_id, username, avatar_url, body, status) VALUES ('A1BG', 'reader-4', 'pictured', ?, ?, 'visible')",
      `/api/avatar?src=${avatar}`,
      body,
    )
  }
  const pictured = await routeRequest(db, "POST", "/api/iconoplasm/comments", {
    body: { symbol: "A1BG", body: "A comment that publishes the copy." },
    bindings: bunny,
  })
  assert.equal(pictured.status, 200)
  const withPictures = publicCopy().comments.filter((comment) => comment.username === "pictured")
  assert.equal(withPictures.length, 2)
  for (const comment of withPictures) {
    assert.match(comment.avatar_url, /^data:image\/png;base64,/)
  }
  assert.doesNotMatch(JSON.stringify(publicCopy()), /\/api\/avatar|cdn\.discordapp\.com/)
  assert.equal(network.callsTo("discord-cdn").length, 1, "one fetch for one author")

  // G5: with storage refusing every write, the comment is still saved and answered 200.
  const original = globalThis.fetch
  globalThis.fetch = (input, init) =>
    String(input?.url || input).includes("storage.bunnycdn.com")
      ? Promise.resolve(new Response("down", { status: 503 }))
      : original(input, init)
  t.after(() => {
    globalThis.fetch = original
  })
  const warn = console.warn
  console.warn = () => {}
  try {
    const saved = await routeRequest(db, "POST", "/api/iconoplasm/comments", {
      body: { symbol: "A1BG", body: "Written while storage is down." },
      bindings: bunny,
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.payload))
  } finally {
    console.warn = warn
    globalThis.fetch = original
  }
  assert.equal(
    db.rows(
      "SELECT COUNT(*) AS n FROM icono_gene_comments WHERE body = 'Written while storage is down.'",
    )[0].n,
    1,
  )
})

// B-1001. Failure modes, written before the code:
// 1. An author edits a comment and the public Discord copy keeps the old text.
// 2. An author deletes a comment and its Discord copy stays.
// 3. Another person's post, or the author's other post on the gene, is touched.
// 4. A refused edit (someone else's comment) reaches Discord.
test("B-1001: the public Discord copy follows the author's own edit and delete, and nothing else", async (t) => {
  const network = new FakeNetwork()
  network.clock = Date.now()
  network.install()
  t.after(() => network.restore())
  const db = new SqliteD1()
  db.exec("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('A1BG', 'alpha-1-B')")
  const discord = { DISCORD_BOT_TOKEN: BOT_TOKEN, DISCORD_ICONOPLASM_CHANNEL_ID: CHANNEL_ID }
  const post = (body, user) =>
    routeRequest(db, "POST", "/api/iconoplasm/comments", {
      body: { symbol: "A1BG", body },
      user,
      bindings: discord,
    })
  assert.equal((await post("Please add a lab stamp.")).status, 200)
  assert.equal(
    (await post("Keep the pen.", { user_id: "reader-2", username: "other" })).status,
    200,
  )
  assert.equal((await post("A second thought on this gene.")).status, 200)
  const posts = () => network.messages.map((message) => message.content.split("\n\n")[1])
  assert.deepEqual(posts(), [
    "**reader**: Please add a lab stamp.",
    "**other**: Keep the pen.",
    "**reader**: A second thought on this gene.",
  ])
  const idOf = (body) => db.rows("SELECT id FROM icono_gene_comments WHERE body = ?", body)[0].id
  const commentsPath = "/api/iconoplasm/genes/A1BG/comments"

  const refused = await routeRequest(db, "PATCH", commentsPath, {
    body: { id: idOf("Keep the pen."), body: "Rewritten by someone else." },
    bindings: discord,
  })
  assert.equal(refused.status, 403)

  const edited = await routeRequest(db, "PATCH", commentsPath, {
    body: { id: idOf("Please add a lab stamp."), body: "Please add a lab stamp, in red." },
    bindings: discord,
  })
  assert.equal(edited.status, 200)
  const removed = await routeRequest(db, "DELETE", commentsPath, {
    body: { id: idOf("A second thought on this gene.") },
    bindings: discord,
  })
  assert.equal(removed.status, 200)

  assert.deepEqual(posts(), [
    "**reader**: Please add a lab stamp, in red.",
    "**other**: Keep the pen.",
  ])
})

// 30. The request picker is read by every signed-in reader who opens it. Its answer is
//     bounded (120 styles, five previews each: four for the card and a spare for when
//     another card already shows one of its genes, B-896) and carries no artist identity
//     (B-883, B-884); the artist stays in the rollup row and goes no further.
test("30: the request picker lists at most 120 styles, five medium previews each, and never an artist", async () => {
  const db = new SqliteD1()
  const previews = JSON.stringify(
    [1, 2, 3, 4, 5, 6].map((rank) => ({
      gene_symbol: `GENE${rank}`,
      asset_sha256: sha(String(rank)),
      is_current: rank === 1,
      preview_rank: rank,
    })),
  )
  for (let n = 1; n <= 300; n += 1) {
    db.exec(
      `INSERT INTO icono_generation_request_vision_option_rollup (
         vision_id, emulsion_id, emulsion_family_id, artist_tag, artist_name, workflow_id,
         workflow_label, prompt_version, variant_slot, image_count, live_count, score,
         vote_h_index, preview_assets_json, builder_version
       ) VALUES (?, ?, ?, '@secretartist', 'Secret Artist', 'A1', 'Anima v1', '93', ?, 8, 6, 5, 4, ?, 3)`,
      `anima-v1-${n}`,
      `A1-93-${n}`,
      `0-${n}`,
      String(n),
      previews,
    )
  }

  const guest = await routeRequest(db, "GET", "/api/iconoplasm/requests/options", { user: {} })
  assert.equal(guest.status, 401)

  const signedIn = await routeRequest(db, "GET", "/api/iconoplasm/requests/options")
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.payload).slice(0, 400))
  const options = signedIn.payload.request_options
  assert.ok(options.length > 0 && options.length <= 120, `${options.length} styles in one answer`)
  assert.doesNotMatch(JSON.stringify(signedIn.payload), /secretartist|secret artist/i)
  for (const option of options) {
    assert.equal(option.preview_assets.length, 5, "a style sends five of its six previews")
    for (const preview of option.preview_assets) {
      assert.match(String(preview.medium_url || ""), /medium\.webp$/)
      assert.equal("thumb_url" in preview, false)
      assert.equal("preview_rank" in preview, false)
    }
  }
})

// 30b. B-1014: "All styles" reaches every style. The first answer carries a cursor; each
//      `after=` page continues in strength order (votes, canonical portraits, score, blots,
//      vision ID) until the cursor is empty. Ways this can fail, written before the code:
//      a style is skipped or shown twice where sort keys tie; a page re-reads the list from
//      the top (reads grow with depth); a bad cursor reaches SQL.
test("30b: All styles pages through every style once, in strength order, by index seeks", async () => {
  const db = new SqliteD1()
  const previews = JSON.stringify([
    { gene_symbol: "GENE1", asset_sha256: sha("1"), is_current: true, preview_rank: 1 },
  ])
  const expected = []
  for (let n = 1; n <= 400; n += 1) {
    // Ties on purpose: four h-index values, three live counts, two scores and five blot
    // counts, so a page boundary lands inside every kind of tie group.
    const row = {
      vision_id: `anima-v1-${n}`,
      vote_h_index: n % 4 === 0 ? 1 : 0,
      live_count: n % 3,
      score: n % 2,
      image_count: (n % 5) + 1,
    }
    expected.push(row)
    db.exec(
      `INSERT INTO icono_generation_request_vision_option_rollup (
         vision_id, emulsion_id, emulsion_family_id, artist_tag, artist_name, workflow_id,
         workflow_label, prompt_version, variant_slot, image_count, live_count, score,
         vote_h_index, preview_assets_json, builder_version
       ) VALUES (?, ?, ?, '', '', 'A1', 'Anima v1', '93', ?, ?, ?, ?, ?, ?, 3)`,
      row.vision_id,
      `0-${n}`,
      `0-${n}`,
      String(n),
      row.image_count,
      row.live_count,
      row.score,
      row.vote_h_index,
      previews,
    )
  }
  expected.sort(
    (a, b) =>
      b.vote_h_index - a.vote_h_index ||
      b.live_count - a.live_count ||
      b.score - a.score ||
      b.image_count - a.image_count ||
      (a.vision_id < b.vision_id ? -1 : a.vision_id > b.vision_id ? 1 : 0),
  )

  const seen = []
  let path = "/api/iconoplasm/requests/options"
  let pages = 0
  for (;;) {
    db.log = []
    const answer = await routeRequest(db, "GET", path)
    assert.equal(answer.status, 200, JSON.stringify(answer.payload).slice(0, 300))
    seen.push(...answer.payload.request_options.map((option) => option.vision_id))
    pages += 1
    if (pages > 1) {
      // Every statement a page runs is a seek on the strength index: no scan, no sort.
      const paging = db.log.filter((entry) =>
        /FROM icono_generation_request_vision_option_rollup/.test(entry.sql),
      )
      assert.ok(paging.length >= 1 && paging.length <= 5, `${paging.length} statements`)
      for (const entry of paging) {
        const plan = db
          .rows(`EXPLAIN QUERY PLAN ${entry.sql}`, ...entry.args)
          .map((row) => row.detail)
          .join(" | ")
        assert.match(plan, /SEARCH .*idx_icono_generation_request_vision_option_rollup_priority/)
        assert.doesNotMatch(plan, /\bSCAN\b|TEMP B-TREE/, plan)
      }
    }
    const cursor = answer.payload.next_cursor
    if (!cursor) break
    assert.ok(pages < 20, "paging does not end")
    path = `/api/iconoplasm/requests/options?after=${encodeURIComponent(cursor)}`
  }
  assert.deepEqual(
    seen,
    expected.map((row) => row.vision_id),
  )
  // 120 first, then pages of 60.
  assert.equal(pages, 1 + Math.ceil((400 - 120) / 60))

  for (const bad of ["x", "[1,2,3]", '[0,0,0,0,""]', '["a",0,0,0,"anima-v1-1"]']) {
    const answer = await routeRequest(
      db,
      "GET",
      `/api/iconoplasm/requests/options?after=${encodeURIComponent(bad)}`,
    )
    assert.equal(answer.status, 200)
    assert.deepEqual(answer.payload.request_options, [], bad)
    assert.equal(answer.payload.next_cursor, "")
  }
})

// 30c. B-896: the picker's first page is a CDN object a background job writes, so an open
//      reads no D1 for it. Ways this can fail, written before the code: the object differs
//      from the API's first page; the job rewrites unchanged bytes every quarter hour (Bunny
//      replication churn, B-923); a vote that reorders the styles never reaches the object;
//      `scope=favorites` still reads the 120-row page; a shared user emulsion (an owner's
//      username) lands in a public object.
test("30c: the picker's first page is a CDN object, written only when it changed", async (t) => {
  const network = new FakeNetwork()
  network.install()
  t.after(() => network.restore())
  const db = new SqliteD1()
  const insert = (n, h) =>
    db.exec(
      `INSERT INTO icono_generation_request_vision_option_rollup (
         vision_id, emulsion_id, emulsion_family_id, artist_tag, artist_name, workflow_id,
         workflow_label, prompt_version, variant_slot, image_count, live_count, score,
         vote_h_index, preview_assets_json, builder_version
       ) VALUES (?, ?, ?, '@secretartist', 'Secret Artist', 'A1', 'Anima v1', '93', ?, 3, 1, 0, ?, ?, 3)
       ON CONFLICT(vision_id) DO UPDATE SET vote_h_index = excluded.vote_h_index`,
      `anima-v1-${n}`,
      `0-${n}`,
      `0-${n}`,
      String(n),
      h,
      JSON.stringify([
        { gene_symbol: `GENE${n}`, asset_sha256: sha(String(n % 10)), is_current: true },
      ]),
    )
  for (let n = 1; n <= 130; n += 1) insert(n, 0)
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: STORAGE_ZONE,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: STORAGE_PASSWORD,
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
  }
  const KEY = "picker/v1/styles.json"
  const object = () => JSON.parse(Buffer.from(network.objects.get(KEY)).toString("utf8"))
  const puts = () => network.calls.filter((call) => call === `bunny PUT /${STORAGE_ZONE}/${KEY}`)

  const first = await publishRequestPickerObject(env)
  assert.equal(first.published, true, JSON.stringify(first))
  assert.equal(first.styles, 120)
  assert.equal(puts().length, 1)
  // The object is the API's first page, without the player's own favourites.
  const api = await routeRequest(db, "GET", "/api/iconoplasm/requests/options")
  assert.deepEqual(
    object().request_options.map((option) => option.vision_id),
    api.payload.request_options.map((option) => option.vision_id),
  )
  assert.equal(object().next_cursor, api.payload.next_cursor)
  assert.doesNotMatch(JSON.stringify(object()), /secretartist|secret artist|user_emulsion/i)
  assert.ok(Buffer.from(network.objects.get(KEY)).byteLength < 512 * 1024)

  const quiet = await publishRequestPickerObject(env)
  assert.equal(quiet.published, false, "nothing changed")
  assert.equal(puts().length, 1, "so nothing was written")

  insert(130, 1)
  const voted = await publishRequestPickerObject(env)
  assert.equal(voted.published, true, "a vote that reorders the styles is published")
  assert.equal(object().request_options[0].vision_id, "anima-v1-130")
  assert.equal(
    network.calls.some((call) => call.startsWith("bunny DELETE")),
    false,
    "no purge, no delete",
  )

  // scope=favorites reads the player's favourites, not the 120-row page.
  db.log = []
  const favorites = await routeRequest(
    db,
    "GET",
    "/api/iconoplasm/requests/options?scope=favorites",
  )
  assert.equal(favorites.status, 200)
  assert.deepEqual(favorites.payload.request_options, [])
  assert.equal(favorites.payload.next_cursor, "")
  assert.equal(
    db.log.some((entry) => /ORDER BY vote_h_index DESC/.test(entry.sql)),
    false,
    "scope=favorites read the strength page",
  )
})

// 31. Favorites are one account's own list: idempotent, refused to guests, and only for a
//     style that exists. An asset that has left the picker's rollup is still favoriteable.
test("31: emulsion favorites are per account, idempotent, refused to guests, and need a real emulsion", async () => {
  const db = new SqliteD1()
  seedAsset(db, "A1BG", sha("a"))
  db.exec("UPDATE icono_portrait_assets SET vision_id = 'anima-v1-19' WHERE gene_symbol = 'A1BG'")
  const favoritesPath = "/api/iconoplasm/emulsion-favorites"

  for (let again = 0; again < 2; again += 1) {
    const put = await routeRequest(db, "PUT", `${favoritesPath}/0-19`)
    assert.equal(put.status, 200, JSON.stringify(put.payload))
  }
  const mine = await routeRequest(db, "GET", favoritesPath)
  assert.deepEqual(mine.payload.favorite_emulsion_ids, ["0-19"])
  const theirs = await routeRequest(db, "GET", favoritesPath, { user: { user_id: "reader-2" } })
  assert.deepEqual(theirs.payload.favorite_emulsion_ids, [])

  assert.equal((await routeRequest(db, "GET", favoritesPath, { user: {} })).status, 401)
  assert.equal((await routeRequest(db, "PUT", `${favoritesPath}/0-19`, { user: {} })).status, 401)
  const unknown = await routeRequest(db, "PUT", `${favoritesPath}/0-99999`)
  assert.equal(unknown.status, 404)
  assert.equal(unknown.payload.code, "EMULSION_NOT_FOUND")

  // Another account removing it changes nothing for the owner; the owner removing it twice is fine.
  await routeRequest(db, "DELETE", `${favoritesPath}/0-19`, { user: { user_id: "reader-2" } })
  assert.deepEqual((await routeRequest(db, "GET", favoritesPath)).payload.favorite_emulsion_ids, [
    "0-19",
  ])
  for (let again = 0; again < 2; again += 1) {
    const removed = await routeRequest(db, "DELETE", `${favoritesPath}/0-19`)
    assert.equal(removed.status, 200)
  }
  assert.deepEqual((await routeRequest(db, "GET", favoritesPath)).payload.favorite_emulsion_ids, [])
})

// 32. One request action queues at most twenty styles. Above that it is refused before it
//     writes anything, so a hand-made request cannot turn one click into a hundred rows.
test("32: a request batch above twenty styles is refused before any write, and a guest is refused", async () => {
  const db = new SqliteD1()
  const body = {
    symbol: "A1BG",
    requested_vision_ids: Array.from({ length: 21 }, (_, index) => `anima-v1-${index + 1}`),
    client_batch_id: "batch-too-large",
  }
  const tooMany = await routeRequest(db, "POST", "/api/iconoplasm/requests", { body })
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.payload.error, /no more than 20/i)
  assert.deepEqual(tooMany.payload.failures, [])
  assert.equal(db.rows("SELECT COUNT(*) AS n FROM icono_generation_requests")[0].n, 0)

  const guest = await routeRequest(db, "POST", "/api/iconoplasm/requests", { body, user: {} })
  assert.equal(guest.status, 401)
})

// 33. Copying a candidate to another gene puts it there, checkmarks it for the copier, and
//     leaves an audit event. An unknown target is refused and writes nothing.
test("33: copying a candidate adds it to the target gene, checkmarks it for the copier, and audits it", async () => {
  const db = new SqliteD1()
  seedAsset(db, "A1BG", sha("a"))
  db.exec("INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES ('INS', 'Insulin')")
  const copyPath = "/api/iconoplasm/candidates/copy"
  const copy = (target) => ({
    body: { source_gene_symbol: "A1BG", target_gene_symbol: target, asset_sha256: sha("a") },
  })

  const missing = await routeRequest(db, "POST", copyPath, copy("NOPE"))
  assert.equal(missing.status, 400)
  assert.equal(
    db.rows("SELECT COUNT(*) AS n FROM icono_portrait_assets WHERE gene_symbol = 'NOPE'")[0].n,
    0,
  )

  const copied = await routeRequest(db, "POST", copyPath, copy("INS"))
  assert.equal(copied.status, 200, JSON.stringify(copied.payload))
  assert.equal(copied.payload.target_url, "/gene/INS")
  assert.equal(copied.payload.vote.vote_value, 1)
  const asset = db.rows(
    "SELECT created_by FROM icono_portrait_assets WHERE gene_symbol = 'INS' AND asset_sha256 = ?",
    sha("a"),
  )
  assert.deepEqual(
    asset.map((row) => row.created_by),
    ["reader-1"],
  )
  const votes = db.rows(
    "SELECT user_id, vote_value FROM icono_image_votes WHERE gene_symbol = 'INS' AND asset_sha256 = ?",
    sha("a"),
  )
  assert.deepEqual(
    votes.map((row) => [row.user_id, row.vote_value]),
    [["reader-1", 1]],
  )
  assert.equal(
    db.rows(
      "SELECT COUNT(*) AS n FROM icono_publish_events WHERE gene_symbol = 'INS' AND action = 'copy_candidate'",
    )[0].n,
    1,
  )

  assert.equal((await routeRequest(db, "POST", copyPath, { ...copy("INS"), user: {} })).status, 401)
})
