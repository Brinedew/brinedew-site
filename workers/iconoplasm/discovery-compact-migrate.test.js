import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"
import {
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryChronology,
  readCompactUserState,
} from "./discovery-compact-store.js"
import {
  importLegacyDiscoveryUser,
  legacyRowsToCompactEncounters,
  parseLegacyDiscoveryTimestamp,
} from "./discovery-compact-migrate.js"

class Result {
  constructor(rows) {
    this.results = rows
  }
  first() {
    return this.results[0] ?? null
  }
}

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
    return new Result(this.raw.prepare(this.sql).all(...this.args))
  }
  async run() {
    this.raw.prepare(this.sql).run(...this.args)
    return { results: [] }
  }
  async first() {
    return this.raw.prepare(this.sql).get(...this.args) ?? null
  }
}

class D1Like {
  constructor() {
    this.raw = new DatabaseSync(":memory:")
    this.raw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
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

const dictionary = createDiscoveryOrdinalDictionary([
  { symbol: "TP53", ordinal: 2 },
  { symbol: "BRCA1", ordinal: 0 },
])

function legacyRow(overrides = {}) {
  return {
    gene_symbol: "TP53",
    first_discovered_at: "2026-01-03 04:05:06",
    last_encountered_at: "2026-01-04 05:06:07",
    encounter_count: 3,
    first_source: "extension_hover",
    last_source: "extension_hover",
    first_trigger: "hover_dwell",
    last_trigger: "hover_dwell",
    first_dwell_ms: 900,
    last_dwell_ms: 1200,
    ...overrides,
  }
}

const firstAt = Math.floor(Date.parse("2026-01-03T04:05:06Z") / 1000)
const lastAt = Math.floor(Date.parse("2026-01-04T05:06:07Z") / 1000)

test("legacy timestamps parse as UTC and stay bounded", () => {
  assert.equal(parseLegacyDiscoveryTimestamp("2026-01-03 04:05:06"), firstAt)
  assert.equal(parseLegacyDiscoveryTimestamp("2026-01-03T04:05:06Z"), firstAt)
  assert.equal(parseLegacyDiscoveryTimestamp(""), null)
})

test("legacy rows become a count-preserving bounded event tape", () => {
  const encounters = legacyRowsToCompactEncounters([legacyRow()], { nowSeconds: 1 })
  assert.equal(encounters.length, 3)
  assert.equal(encounters[0].at, firstAt)
  assert.equal(encounters[2].at, lastAt)
  assert.equal(encounters[2].dwell_ms, 1200)
  const capped = legacyRowsToCompactEncounters([legacyRow({ encounter_count: 500 })], {
    nowSeconds: 1,
  })
  assert.equal(capped.length, 32)
})

test("first import writes compact membership, chronology and the derived delivery", async () => {
  const db = new D1Like()
  const result = await importLegacyDiscoveryUser({
    db,
    userId: "reader",
    dictionary,
    legacyRows: [legacyRow()],
    nowSeconds: 1,
  })
  assert.deepEqual(result, { ok: true, imported: 1, events: 3, batches: 1, remaining: 0 })
  const state = await readCompactUserState(db, "reader")
  assert.equal(state.member_count, 1)
  const chronology = await readCompactDiscoveryChronology(db, "reader")
  assert.equal(chronology.chunks.length, 0)
  assert.equal(chronology.active_events.length, 3)
  assert.deepEqual(
    chronology.active_events.map((event) => event.symbol),
    ["TP53", "TP53", "TP53"],
  )
  const outbox = await db
    .prepare("SELECT payload_json FROM icono_discovery_shared_delivery_outbox_v2")
    .all()
  assert.equal(outbox.results.length, 1)
  const delivery = JSON.parse(outbox.results[0].payload_json)
  assert.deepEqual(delivery.deltas, [[2, 1, 3, firstAt, lastAt]])
})

test("re-running an interrupted import is idempotent and never duplicates events", async () => {
  const db = new D1Like()
  const rows = [legacyRow(), legacyRow({ gene_symbol: "BRCA1", encounter_count: 1 })]
  const first = await importLegacyDiscoveryUser({
    db,
    userId: "reader",
    dictionary,
    legacyRows: rows,
    nowSeconds: 1,
  })
  assert.equal(first.imported, 2)
  const replay = await importLegacyDiscoveryUser({
    db,
    userId: "reader",
    dictionary,
    legacyRows: rows,
    nowSeconds: 2,
  })
  assert.equal(replay.imported, 0)
  assert.equal(replay.batches, 0)
  const chronology = await readCompactDiscoveryChronology(db, "reader")
  assert.equal(chronology.active_events.length, 4)
  const outbox = await db
    .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_outbox_v2")
    .first()
  assert.equal(Number(outbox.n), 1)
})

test("a partially imported user resumes at the missing symbol", async () => {
  const db = new D1Like()
  await importLegacyDiscoveryUser({
    db,
    userId: "reader",
    dictionary,
    legacyRows: [legacyRow()],
    nowSeconds: 1,
  })
  const resumed = await importLegacyDiscoveryUser({
    db,
    userId: "reader",
    dictionary,
    legacyRows: [legacyRow(), legacyRow({ gene_symbol: "BRCA1" })],
    nowSeconds: 2,
  })
  assert.equal(resumed.imported, 1)
  const state = await readCompactUserState(db, "reader")
  assert.equal(state.member_count, 2)
})
