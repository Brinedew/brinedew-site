import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import {
  createDiscoveryOrdinalDictionary,
  readSharedDiscoveryOrdinal,
} from "./discovery-compact-state.js"
import {
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryState,
} from "./discovery-compact-store.js"
import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"
import {
  consumeSharedDiscoveryDeliveries,
  drainSharedDiscoveryDeliveries,
} from "./discovery-shared-delivery.js"

async function installSchema(db) {
  for (const statement of DISCOVERY_COMPACT_SCHEMA_SQL.split(";")
    .map((sql) => sql.trim().replace(/\s+/g, " "))
    .filter(Boolean)) {
    await db.exec(statement)
  }
}

async function withD1(run) {
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
    await installSchema(db)
    return await run(db)
  } finally {
    await runtime.dispose()
  }
}

function measuredDb(db, receipts) {
  return {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      const results = await db.batch(statements)
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

const dictionary = createDiscoveryOrdinalDictionary([{ symbol: "TP53", ordinal: 0 }])

async function personalDelivery(db, user, sequence, at) {
  const result = await recordCompactDiscoveryBatch(db, {
    userId: user,
    batchId: `device-${user}:${sequence}`,
    dictionary,
    encounters: [{ symbol: "TP53", at, source: "extension", trigger: "hover", dwell_ms: 900 }],
  })
  assert.ok(result.shared_delivery)
  return result.shared_delivery
}

test(
  "one serialized D1 consumer applies 50 deferred deliveries in one shared write plus durable receipts",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const deliveries = []
      for (let index = 0; index < 50; index++) {
        deliveries.push(await personalDelivery(db, `u${index}`, 1, 1000 + index))
      }
      const receipts = []
      const measured = measuredDb(db, receipts)
      const result = await consumeSharedDiscoveryDeliveries(measured, deliveries)
      assert.deepEqual(
        { applied: result.applied, duplicates: result.duplicates, attempts: result.attempts },
        { applied: 50, duplicates: 0, attempts: 1 },
      )
      const write = receipts.at(-1)
      assert.equal(write.writes, 51, "50 idempotency receipts plus one shared-state row")
      const state = await readCompactDiscoveryState(db, "u0")
      assert.deepEqual(readSharedDiscoveryOrdinal(state.shared, 0), {
        discoverer_count: 50,
        encounter_count: 50,
        first_at: 1000,
        latest_at: 1049,
      })
      assert.equal(
        Number(
          (
            await db
              .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_receipts_v2")
              .first()
          ).n,
        ),
        50,
      )
      console.log(
        "B764_SHARED_BATCH_RECEIPT",
        JSON.stringify({ deliveries: 50, d1_reads: write.reads, d1_writes: write.writes }),
      )
    })
  },
)

test(
  "redelivered queue messages are write-free and conflicting reuse of a delivery id fails closed",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const delivery = await personalDelivery(db, "u1", 1, 1000)
      await consumeSharedDiscoveryDeliveries(db, [delivery])
      const receipts = []
      const measured = measuredDb(db, receipts)
      const replay = await consumeSharedDiscoveryDeliveries(measured, [delivery, delivery])
      assert.equal(replay.applied, 0)
      assert.equal(replay.duplicates, 1)
      assert.equal(receipts.length, 1, "duplicate-only consumer pass performs only its read batch")
      assert.equal(receipts[0].writes, 0)

      const corrupt = structuredClone(delivery)
      corrupt.deltas[0][2] += 1
      await assert.rejects(
        consumeSharedDiscoveryDeliveries(db, [corrupt]),
        /delivery id collision/i,
      )
      const state = await readCompactDiscoveryState(db, "u1")
      assert.deepEqual(readSharedDiscoveryOrdinal(state.shared, 0), {
        discoverer_count: 1,
        encounter_count: 1,
        first_at: 1000,
        latest_at: 1000,
      })
    })
  },
)

test(
  "a later batch for the same user increments encounters without double-counting discoverers",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const first = await personalDelivery(db, "u1", 1, 1000)
      const second = await personalDelivery(db, "u1", 2, 2000)
      assert.deepEqual(first.deltas, [[0, 1, 1, 1000, 1000]])
      assert.deepEqual(second.deltas, [[0, 0, 1, 2000, 2000]])
      await consumeSharedDiscoveryDeliveries(db, [second, first])
      const state = await readCompactDiscoveryState(db, "u1")
      assert.deepEqual(readSharedDiscoveryOrdinal(state.shared, 0), {
        discoverer_count: 1,
        encounter_count: 2,
        first_at: 1000,
        latest_at: 2000,
      })
    })
  },
)

test(
  "personal batch commits its exact derived delivery into the durable outbox in the same transaction",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      await personalDelivery(db, "u1", 1, 1000)
      await personalDelivery(db, "u2", 1, 1100)
      const beforeDrain = await readCompactDiscoveryState(db, "u1")
      assert.deepEqual(readSharedDiscoveryOrdinal(beforeDrain.shared, 0), {
        discoverer_count: 0,
        encounter_count: 0,
        first_at: 0,
        latest_at: 0,
      })
      const outbox = await db
        .prepare(
          "SELECT delivery_id, payload_json FROM icono_discovery_shared_delivery_outbox_v2 ORDER BY delivery_id",
        )
        .all()
      assert.equal(outbox.results.length, 2)
      for (const row of outbox.results) {
        const payload = JSON.parse(row.payload_json)
        assert.equal(payload.schema, "iconoplasm.discoverySharedDelivery.v1")
        assert.ok(["u1", "u2"].includes(payload.user_id))
        assert.equal(payload.delivery_id, row.delivery_id)
      }

      const drained = await drainSharedDiscoveryDeliveries(db, { limit: 8 })
      assert.deepEqual(drained, { ok: true, drained: 2, applied: 2, duplicates: 0 })
      const afterDrain = await readCompactDiscoveryState(db, "u1")
      assert.deepEqual(readSharedDiscoveryOrdinal(afterDrain.shared, 0), {
        discoverer_count: 2,
        encounter_count: 2,
        first_at: 1000,
        latest_at: 1100,
      })
      const remaining = await db
        .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_outbox_v2")
        .first()
      assert.equal(Number(remaining.n), 0)
      console.log(
        "B764_DURABLE_DELIVERY_RECEIPT",
        JSON.stringify({ outbox_rows: outbox.results.length, drained }),
      )
    })
  },
)

test(
  "a crash between shared apply and outbox cleanup replays once and then clears",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const delivery = await personalDelivery(db, "u1", 1, 1000)
      // The outbox row is still present; the consumer applied the same delivery
      // before the crash, so the drain must treat it as a duplicate and stop
      // without changing counts.
      const applied = await consumeSharedDiscoveryDeliveries(db, [delivery])
      assert.equal(applied.applied, 1)
      const replay = await drainSharedDiscoveryDeliveries(db, { limit: 8 })
      assert.deepEqual(replay, { ok: true, drained: 1, applied: 0, duplicates: 1 })
      const state = await readCompactDiscoveryState(db, "u1")
      assert.deepEqual(readSharedDiscoveryOrdinal(state.shared, 0), {
        discoverer_count: 1,
        encounter_count: 1,
        first_at: 1000,
        latest_at: 1000,
      })
      const remaining = await db
        .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_outbox_v2")
        .first()
      assert.equal(Number(remaining.n), 0)
    })
  },
)
