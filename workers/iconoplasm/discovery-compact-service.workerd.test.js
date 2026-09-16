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

const dictionary = createDiscoveryOrdinalDictionary([{ symbol: "TP53", ordinal: 0 }])
const encounter = (index) => ({
  symbol: "TP53",
  at: 1000 + index,
  source: "extension",
  trigger: "hover",
  dwell_ms: 900,
})

test(
  "deferred shared delivery removes unrelated-user contention from the real D1 personal hot path",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const users = 20
      const results = await Promise.all(
        Array.from({ length: users }, (_, index) =>
          recordCompactDiscoveryBatch(db, {
            userId: `user-${index}`,
            batchId: `device-${index}:1`,
            dictionary,
            encounters: [encounter(index)],
          }),
        ),
      )
      assert.ok(results.every((result) => result.ok && !result.replay))
      const attempts = results.map((result) => result.attempts)
      assert.deepEqual(attempts, Array(users).fill(1))
      assert.equal(
        new Set(results.map((result) => result.shared_delivery?.delivery_id)).size,
        users,
      )
      assert.ok(
        results.every(
          (result) =>
            result.shared_delivery?.schema === "iconoplasm.discoverySharedDelivery.v1" &&
            result.shared_delivery?.deltas?.length === 1 &&
            result.shared_delivery.deltas[0][0] === 0 &&
            result.shared_delivery.deltas[0][1] === 1 &&
            result.shared_delivery.deltas[0][2] === 1,
        ),
      )
      const compact = await readCompactDiscoveryState(db, "user-0")
      assert.deepEqual(readSharedDiscoveryOrdinal(compact.shared, 0), {
        discoverer_count: 0,
        encounter_count: 0,
        first_at: 0,
        latest_at: 0,
      })
      console.log(
        "B764_DEFERRED_CONCURRENCY_RECEIPT",
        JSON.stringify({ users, total_attempts: users, max_attempts: 1 }),
      )
    })
  },
)

test(
  "atomic shared mode remains a correctness baseline and demonstrates why it is not the live hot path",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const users = 20
      const results = await Promise.all(
        Array.from({ length: users }, (_, index) =>
          recordCompactDiscoveryBatch(db, {
            userId: `atomic-user-${index}`,
            batchId: `atomic-device-${index}:1`,
            dictionary,
            encounters: [encounter(index)],
            sharedMode: "atomic",
            maxAttempts: 64,
          }),
        ),
      )
      assert.ok(results.every((result) => result.ok && !result.replay))
      const attempts = results.map((result) => result.attempts)
      const maxAttempts = Math.max(...attempts)
      const totalAttempts = attempts.reduce((sum, value) => sum + value, 0)
      assert.ok(maxAttempts <= users)
      assert.ok(totalAttempts > users)
      const compact = await readCompactDiscoveryState(db, "atomic-user-0")
      assert.deepEqual(readSharedDiscoveryOrdinal(compact.shared, 0), {
        discoverer_count: users,
        encounter_count: users,
        first_at: 1000,
        latest_at: 1019,
      })
      console.log(
        "B764_ATOMIC_CONCURRENCY_RECEIPT",
        JSON.stringify({
          users,
          total_attempts: totalAttempts,
          max_attempts: maxAttempts,
          attempts,
        }),
      )
    })
  },
)

test(
  "replaying a deferred batch returns the exact durable shared delivery without re-deriving membership",
  { timeout: 60000 },
  async () => {
    await withD1(async (db) => {
      const input = {
        userId: "user-1",
        batchId: "device-1:1",
        dictionary,
        encounters: [encounter(0)],
      }
      const first = await recordCompactDiscoveryBatch(db, input)
      const replay = await recordCompactDiscoveryBatch(db, {
        ...input,
        encounters: [{ ...encounter(999), at: 9999 }],
      })
      assert.equal(first.replay, false)
      assert.equal(replay.replay, true)
      assert.equal(replay.state_version, first.state_version)
      assert.deepEqual(replay.shared_delivery, first.shared_delivery)
      assert.deepEqual(replay.shared_delivery?.deltas, [[0, 1, 1, 1000, 1000]])
      const compact = await readCompactDiscoveryState(db, "user-1")
      assert.deepEqual(readSharedDiscoveryOrdinal(compact.shared, 0), {
        discoverer_count: 0,
        encounter_count: 0,
        first_at: 0,
        latest_at: 0,
      })
    })
  },
)
