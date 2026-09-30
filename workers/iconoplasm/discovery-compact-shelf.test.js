// B-887: the per-user shelf (one row, in the user state) that replaces the
// O(history) chronology fold on every signed-in home view.
//
// Ways it can fail, written before the code:
// 1. migration 0111's backfill disagrees with the chronology fold (symbol case
//    and whitespace, min/max times, repeat counts, the unsealed active tail,
//    events without a symbol);
// 2. a discovery write leaves the shelf stale (a new gene missing, a repeat
//    visit not moving its count or last time, an earlier visit not moving its
//    first time);
// 3. a write on a user whose shelf is stale (version mismatch) does not heal it;
// 4. the shelf is trusted when its version does not match the state version
//    (the reader must fall back to the chronology; see the window tests);
// 5. the migration adapter admits a database larger than its reviewed bound.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { compactShelfRowsFromChronology } from "./discovery-compact-read.js"
import { applyDiscoveryBatch, createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"
import {
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryChronology,
  readCompactDiscoveryState,
} from "./discovery-compact-store.js"
import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"

const MIGRATION_SQL = readFileSync(
  new URL("../../migrations-iconoplasm/0111_discovery_user_shelf.sql", import.meta.url),
  "utf8",
)

class Bound {
  constructor(raw, sql, args = []) {
    this.raw = raw
    this.sql = sql
    this.args = args
  }
  bind(...args) {
    return new Bound(this.raw, this.sql, args)
  }
  async all() {
    return { results: this.raw.prepare(this.sql).all(...this.args) }
  }
  async first() {
    return this.raw.prepare(this.sql).get(...this.args) ?? null
  }
}

class D1Like {
  constructor(schemaSql = DISCOVERY_COMPACT_SCHEMA_SQL) {
    this.raw = new DatabaseSync(":memory:")
    this.raw.exec(schemaSql)
  }
  prepare(sql) {
    return new Bound(this.raw, sql)
  }
  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = statements.map((statement) => ({
        results: this.raw.prepare(statement.sql).all(...statement.args),
      }))
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

// The fold every shelf must equal: [symbol, first_at, last_at, count], any order.
function foldOf(chronology) {
  return compactShelfRowsFromChronology(chronology)
    .map((row) => [row.gene_symbol, row.first_at, row.last_at, row.encounter_count])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

function sortedShelf(shelf) {
  return [...shelf].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

function event(seq, symbol, at) {
  return { seq, ordinal: seq, symbol, at, source: "gene_page_visit", trigger: "gene_page_visit" }
}

// The schema as it was before 0111: no shelf columns.
function preMigrationSchema() {
  const schema = DISCOVERY_COMPACT_SCHEMA_SQL.replace(
    /,\n\s*shelf_json[^\n]*\n\s*shelf_state_version[^\n]*/,
    "",
  )
  assert.doesNotMatch(schema, /shelf_/, "could not rebuild the pre-0111 schema")
  return schema
}

test("migration 0111 backfills every shelf exactly as the chronology fold (B-887)", () => {
  const db = new D1Like(preMigrationSchema())
  const insertUser = db.raw.prepare(
    `INSERT INTO icono_discovery_user_state_v2 (user_id, dictionary_version, state_version,
      membership_b64, member_count, next_event_seq, next_chunk_seq, active_events_json,
      recent_receipts_json, last_batch_id) VALUES (?, 1, ?, '', ?, 1, 1, ?, '[]', 'b')`,
  )
  const insertChunk = db.raw.prepare(
    `INSERT INTO icono_discovery_chronology_v2 (user_id, chunk_seq, first_event_seq,
      last_event_seq, events_json) VALUES (?, ?, 1, 1, ?)`,
  )
  const heavyChunks = [
    [event(1, "TP53", 500), event(2, " brca1 ", 300), event(3, "TP53", 100)],
    [event(4, "EGFR", 700), event(5, "", 50), event(6, "tp53", 900), event(7, "EGFR", 600)],
  ]
  const heavyActive = [event(8, "BRCA1", 1000), event(9, "INS", 20)]
  insertUser.run("heavy", 7, 4, JSON.stringify(heavyActive))
  heavyChunks.forEach((events, i) => insertChunk.run("heavy", i + 1, JSON.stringify(events)))
  insertUser.run("tail-only", 3, 1, JSON.stringify([event(1, "RHO", 42), event(2, "RHO", 41)]))
  insertUser.run("empty", 1, 0, "[]")

  db.raw.exec(MIGRATION_SQL)

  const rows = db.raw
    .prepare(
      "SELECT user_id, state_version, shelf_json, shelf_state_version FROM icono_discovery_user_state_v2 ORDER BY user_id",
    )
    .all()
  const byUser = Object.fromEntries(rows.map((row) => [row.user_id, row]))
  assert.deepEqual(
    sortedShelf(JSON.parse(byUser.heavy.shelf_json)),
    foldOf({
      chunks: heavyChunks.map((events, i) => ({ chunk_seq: i + 1, events })),
      active_events: heavyActive,
    }),
  )
  assert.deepEqual(sortedShelf(JSON.parse(byUser["tail-only"].shelf_json)), [["RHO", 41, 42, 2]])
  assert.deepEqual(JSON.parse(byUser.empty.shelf_json), [])
  for (const row of rows) {
    assert.equal(row.shelf_state_version, row.state_version, `${row.user_id}: version not stamped`)
  }
})

const dictionary = createDiscoveryOrdinalDictionary([
  { symbol: "TP53", ordinal: 0 },
  { symbol: "BRCA1", ordinal: 1 },
  { symbol: "EGFR", ordinal: 2 },
])

test("a discovery batch folds into the shelf and stamps its version (B-887)", () => {
  const first = applyDiscoveryBatch(null, {
    batchId: "device:1",
    dictionary,
    encounters: [
      { symbol: "TP53", at: 100 },
      { symbol: "BRCA1", at: 50 },
      { symbol: "TP53", at: 200 },
    ],
  })
  assert.deepEqual(sortedShelf(first.state.shelf), [
    ["BRCA1", 50, 50, 1],
    ["TP53", 100, 200, 2],
  ])
  assert.equal(first.state.shelf_state_version, first.state.state_version)

  const second = applyDiscoveryBatch(first.state, {
    batchId: "device:2",
    dictionary,
    encounters: [
      { symbol: "TP53", at: 10 },
      { symbol: "EGFR", at: 300 },
    ],
  })
  assert.deepEqual(sortedShelf(second.state.shelf), [
    ["BRCA1", 50, 50, 1],
    ["EGFR", 300, 300, 1],
    ["TP53", 10, 200, 3],
  ])
  assert.equal(second.state.shelf_state_version, second.state.state_version)
})

test("a batch on a stale shelf never stamps it valid without the history (B-887)", () => {
  const first = applyDiscoveryBatch(null, {
    batchId: "device:1",
    dictionary,
    encounters: [{ symbol: "TP53", at: 100 }],
  })
  const stale = { ...first.state, shelf: [["WRONG", 1, 1, 1]], shelf_state_version: 0 }
  const next = applyDiscoveryBatch(stale, {
    batchId: "device:2",
    dictionary,
    encounters: [{ symbol: "BRCA1", at: 200 }],
  })
  assert.notEqual(next.state.shelf_state_version, next.state.state_version)
})

test("recording on a stale shelf heals it from the chronology in the same commit (B-887)", async () => {
  const db = new D1Like()
  const record = (batchId, encounters) =>
    recordCompactDiscoveryBatch(db, {
      userId: "u1",
      batchId,
      dictionary,
      encounters,
      sharedMode: "none",
    })
  await record("device:1", [
    { symbol: "TP53", at: 100 },
    { symbol: "BRCA1", at: 50 },
  ])
  // An older writer (or the pre-migration row) left the shelf stale.
  db.raw
    .prepare(
      "UPDATE icono_discovery_user_state_v2 SET shelf_json = '[]', shelf_state_version = 0 WHERE user_id = 'u1'",
    )
    .run()
  await record("device:2", [
    { symbol: "EGFR", at: 300 },
    { symbol: "TP53", at: 400 },
  ])
  const state = await readCompactDiscoveryState(db, "u1")
  assert.equal(state.user.shelf_state_version, state.user.state_version, "shelf was not healed")
  assert.deepEqual(
    sortedShelf(state.user.shelf),
    foldOf(await readCompactDiscoveryChronology(db, "u1")),
  )
})

test("randomized batches keep the shelf equal to the chronology fold (B-887)", async () => {
  const db = new D1Like()
  const symbols = ["TP53", "BRCA1", "EGFR"]
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let batch = 1; batch <= 12; batch++) {
    const size = 1 + Math.floor(random() * 40) // crosses 64-event chunk seals
    await recordCompactDiscoveryBatch(db, {
      userId: "u2",
      batchId: `device:${batch}`,
      dictionary,
      encounters: Array.from({ length: size }, () => ({
        symbol: symbols[Math.floor(random() * symbols.length)],
        at: 1000 + Math.floor(random() * 5000),
      })),
      sharedMode: "none",
    })
  }
  const state = await readCompactDiscoveryState(db, "u2")
  assert.equal(state.user.shelf_state_version, state.user.state_version)
  const chronology = await readCompactDiscoveryChronology(db, "u2")
  assert.ok(chronology.chunks.length >= 2, "the fixture never sealed a chunk")
  assert.deepEqual(sortedShelf(state.user.shelf), foldOf(chronology))
})

test("the 0111 cost adapter refuses a database past its reviewed bound (B-887)", async () => {
  const { createDiscoveryShelfMigrationCostAdapter } =
    await import("./operation-cost-discovery-shelf-migration-adapter.js")
  const adapter = createDiscoveryShelfMigrationCostAdapter({
    db: null,
    executable_sha256: "a".repeat(64),
    schema_sha256: "b".repeat(64),
  })
  await assert.rejects(() => adapter.prepare({ max_users: 500 }), /ARGUMENTS_INVALID/)
  // The plan's arguments: measured 38 users / 224 chunks / 15,276 events cost
  // 69,362 reads on production D1 (2026-09-28); the bound must cover that
  // rate at the guard limits and stay within 2x the plan's booked prediction.
  const plan = JSON.parse(
    readFileSync(
      new URL("../../cloudflare/operation-cost-migration-plan.json", import.meta.url),
      "utf8",
    ),
  ).migrations["iconoplasm/0111_discovery_user_shelf.sql"]
  const prepared = await adapter.prepare(plan.arguments)
  const worstEvents = (plan.arguments.max_chunks + plan.arguments.max_users) * 64
  assert.ok(
    prepared.bound.rows_read >= Math.ceil((69_362 / 15_276) * worstEvents),
    "bound below the measured rate",
  )
  assert.ok(prepared.bound.rows_read <= 2 * plan.prediction.rows_read, "bound over 2x prediction")
  assert.ok(
    prepared.bound.rows_written <= 2 * plan.prediction.rows_written,
    "writes over 2x prediction",
  )
  assert.ok(
    plan.arguments.max_users >= 2 * 38 && plan.arguments.max_chunks >= 224 + 100,
    "no headroom",
  )
  assert.equal(prepared.statements.at(-1).parameters[0], "0111_discovery_user_shelf.sql")

  // The guards run first and abort the batch when the data outgrew the bound.
  const db = new D1Like(preMigrationSchema())
  const insertChunk = db.raw.prepare(
    `INSERT INTO icono_discovery_chronology_v2 (user_id, chunk_seq, first_event_seq,
      last_event_seq, events_json) VALUES ('u', ?, 1, 1, '[]')`,
  )
  const small = await adapter.prepare({ max_users: 1, max_chunks: 2 })
  for (let seq = 1; seq <= 3; seq++) insertChunk.run(seq)
  const guards = small.statements.filter((s) => /COST_MIGRATION_/.test(s.sql))
  assert.ok(guards.length >= 2, "missing schema or row guards")
  assert.throws(() => {
    for (const guard of guards) db.raw.prepare(guard.sql).all(...guard.parameters)
  }, /malformed JSON/)
})
