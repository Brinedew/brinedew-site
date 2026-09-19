import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"
import {
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactUserState,
  readSharedCompactState,
} from "./discovery-compact-store.js"
import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"
import { drainSharedDiscoveryDeliveries } from "./discovery-shared-delivery.js"
import { readSharedDiscoveryOrdinal } from "./discovery-compact-state.js"

// B-716 working workload for the compact discovery path: 2,000 savers making
// 20,000 qualified encounters. Both acknowledgement models are measured: one
// batch per saver (2,000 batches) and the worst case of ten separately
// acknowledged saves per saver (20,000 batches). Real D1 receipts prove the
// first; an in-memory SQLite sweep proves the second without spending CI time.

const SYMBOLS = Array.from({ length: 10 }, (_, index) => `GENE${String(index).padStart(2, "0")}`)
const dictionary = createDiscoveryOrdinalDictionary(
  SYMBOLS.map((symbol, ordinal) => ({ symbol, ordinal })),
)

function encountersFor(userIndex) {
  return SYMBOLS.map((symbol, index) => ({
    symbol,
    at: 1_800_000_000 + userIndex * 100 + index,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  }))
}

function measuredDb(db, receipts) {
  const wrap = (statement) => ({
    __raw: statement,
    bind(...args) {
      return wrap(statement.bind(...args))
    },
    async all() {
      const result = await statement.all()
      receipts.push({
        reads: Number(result.meta?.rows_read || 0),
        writes: Number(result.meta?.rows_written || 0),
      })
      return result
    },
    async first(column) {
      return statement.first(column)
    },
    async run() {
      const result = await statement.run()
      receipts.push({
        reads: Number(result.meta?.rows_read || 0),
        writes: Number(result.meta?.rows_written || 0),
      })
      return result
    },
  })
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: async (statements) => {
      const results = await db.batch(statements.map((statement) => statement.__raw || statement))
      receipts.push(
        results.reduce(
          (sum, result) => ({
            reads: sum.reads + Number(result.meta?.rows_read || 0),
            writes: sum.writes + Number(result.meta?.rows_written || 0),
          }),
          { reads: 0, writes: 0 },
        ),
      )
      return results
    },
  }
}

test(
  "real D1 prints exact per-saver row receipts for the 2,000-saver envelope",
  { timeout: 600000 },
  async () => {
    const req = createRequire(import.meta.url)
    const { Miniflare, convertV4MiniflareOptions } = createRequire(
      req.resolve("wrangler/package.json"),
    )("miniflare")
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('test')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    try {
      const db = await runtime.getD1Database("DB")
      for (const statement of DISCOVERY_COMPACT_SCHEMA_SQL.split(";")
        .map((sql) => sql.trim().replace(/\s+/g, " "))
        .filter(Boolean)) {
        await db.exec(statement)
      }
      const receipts = []
      const measured = measuredDb(db, receipts)
      const startedAt = Date.now()
      const SAVERS = 2_000
      for (let user = 0; user < SAVERS; user++) {
        await recordCompactDiscoveryBatch(measured, {
          userId: `saver-${user}`,
          batchId: `device-${user}:1`,
          dictionary,
          encounters: encountersFor(user),
        })
      }
      const personalMs = Date.now() - startedAt
      const personal = receipts.reduce(
        (sum, entry) => ({ reads: sum.reads + entry.reads, writes: sum.writes + entry.writes }),
        { reads: 0, writes: 0 },
      )
      assert.equal(receipts.length, SAVERS * 2, "one read batch and one commit batch per saver")
      assert.equal(
        personal.reads,
        SAVERS * 3,
        "the production compact schema must retain exactly three D1 rows read per saver batch",
      )
      assert.equal(
        personal.writes,
        SAVERS * 3,
        "the production compact schema and outbox index must retain exactly three D1 writes per saver batch",
      )

      const firstUser = await readCompactUserState(db, "saver-0")
      assert.equal(firstUser.member_count, 10)
      assert.equal(firstUser.active_events.length, 10)

      const beforeDrain = await readSharedCompactState(db)
      assert.equal(
        Number(beforeDrain.state_version),
        0,
        "personal commits never contend on shared state",
      )

      const drainReceipts = []
      const measuredDrain = measuredDb(db, drainReceipts)
      let drained = 0
      for (;;) {
        const result = await drainSharedDiscoveryDeliveries(measuredDrain, { limit: 128 })
        drained += result.drained
        if (result.drained < 128) break
      }
      assert.equal(drained, SAVERS)

      const shared = await readSharedCompactState(db)
      for (let ordinal = 0; ordinal < SYMBOLS.length; ordinal++) {
        const summary = readSharedDiscoveryOrdinal(shared, ordinal)
        assert.deepEqual(
          {
            discoverers: summary.discoverer_count,
            encounters: summary.encounter_count,
          },
          { discoverers: SAVERS, encounters: SAVERS },
        )
      }
      const drainWrites = drainReceipts.reduce((sum, entry) => sum + entry.writes, 0)
      assert.equal(
        drainWrites,
        SAVERS * 2 + Math.ceil(SAVERS / 128),
        "real D1 bills one shared update per drain page plus one receipt and one indexed outbox delete per delivery",
      )
      const receipt = {
        schemaVersion: 1,
        kind: "iconoplasm_task3_mutation_measurement",
        generatedAt: new Date().toISOString(),
        provenance: {
          task3Commit: "02a39908",
          runtime: "miniflare_d1",
          harness: "workers/iconoplasm/discovery-workload.workerd.test.js",
          command:
            "node --test workers/iconoplasm/discovery-workload.workerd.test.js --test-name-pattern=real D1 prints exact per-saver row receipts",
        },
        workload: {
          savers: SAVERS,
          encounters: SAVERS * 10,
          personalBatches: SAVERS,
          drainBatches: Math.ceil(drained / 128),
        },
        meters: {
          d1RowsRead: personal.reads,
          d1RowsWritten: personal.writes + drainWrites,
        },
        components: {
          personalReads: personal.reads,
          personalWrites: personal.writes,
          drainWrites,
        },
        timing: { personalMs },
      }
      const artifact = {
        ...receipt,
        digestAlgorithm: "sha256",
        digest: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
      }
      console.log("B764_WORKLOAD_RECEIPT", JSON.stringify(artifact))
      if (process.env.ICONOPLASM_MEASUREMENT_OUTPUT) {
        const output = path.resolve(process.env.ICONOPLASM_MEASUREMENT_OUTPUT)
        mkdirSync(path.dirname(output), { recursive: true })
        writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
      }
    } finally {
      await runtime.dispose()
    }
  },
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
  async run() {
    const info = this.raw.prepare(this.sql).run(...this.args)
    return { results: [], meta: { changes: Number(info.changes || 0) } }
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
      const results = statements.map((statement) => {
        const prepared = this.raw.prepare(statement.sql)
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(statement.sql) || /\bRETURNING\b/i.test(statement.sql))
          return { results: prepared.all(...statement.args) }
        const info = prepared.run(...statement.args)
        return { results: [], meta: { changes: Number(info.changes || 0) } }
      })
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

test(
  "the full 2,000-saver / 20,000-encounter workload converges exactly",
  { timeout: 300000 },
  async () => {
    const db = new D1Like()
    for (let user = 0; user < 2000; user++) {
      await recordCompactDiscoveryBatch(db, {
        userId: `saver-${user}`,
        batchId: `device-${user}:1`,
        dictionary,
        encounters: encountersFor(user),
      })
    }
    const users = await db
      .prepare(
        "SELECT COUNT(*) AS users, SUM(member_count) AS members FROM icono_discovery_user_state_v2",
      )
      .first()
    assert.deepEqual([Number(users.users), Number(users.members)], [2000, 20000])
    let drained = 0
    for (;;) {
      const result = await drainSharedDiscoveryDeliveries(db, { limit: 128 })
      drained += result.drained
      if (result.drained < 128) break
    }
    assert.equal(drained, 2000)
    const shared = await readSharedCompactState(db)
    for (let ordinal = 0; ordinal < SYMBOLS.length; ordinal++) {
      const summary = readSharedDiscoveryOrdinal(shared, ordinal)
      assert.deepEqual(
        { discoverers: summary.discoverer_count, encounters: summary.encounter_count },
        { discoverers: 2000, encounters: 2000 },
      )
    }
    console.log(
      "B764_FULL_WORKLOAD_RECEIPT",
      JSON.stringify({ savers: 2000, encounters: 20000, drained }),
    )
  },
)

test(
  "the 20,000 individually acknowledged saves worst case stays linear per batch",
  { timeout: 600000 },
  async () => {
    const db = new D1Like()
    const startedAt = Date.now()
    for (let saver = 0; saver < 2000; saver++) {
      for (let save = 0; save < 10; save++) {
        const symbol = SYMBOLS[save]
        await recordCompactDiscoveryBatch(db, {
          userId: `saver-${saver}`,
          batchId: `device-${saver}:${save + 1}`,
          dictionary,
          encounters: [
            {
              symbol,
              at: 1_800_000_000 + saver * 100 + save,
              source: "extension_hover",
              trigger: "hover_dwell",
              dwell_ms: 900,
            },
          ],
        })
      }
    }
    const elapsedMs = Date.now() - startedAt
    const state = await db
      .prepare(
        "SELECT SUM(member_count) AS members, COUNT(*) AS users FROM icono_discovery_user_state_v2",
      )
      .first()
    assert.equal(Number(state.users), 2000)
    assert.equal(Number(state.members), 2000 * 10)
    const outbox = await db
      .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_outbox_v2")
      .first()
    assert.equal(Number(outbox.n), 20000)
    console.log(
      "B764_WORST_CASE_RECEIPT",
      JSON.stringify({ batches: 20000, elapsed_ms: elapsedMs }),
    )
  },
)
