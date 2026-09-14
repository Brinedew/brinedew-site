import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import {
  createDiscoveryOrdinalDictionary,
  readSharedDiscoveryOrdinal,
} from "./discovery-compact-state.js"
import { DISCOVERY_COMPACT_SCHEMA_SQL, readCompactDiscoveryState } from "./discovery-compact-store.js"
import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"

async function installSchema(db) {
  for (const statement of DISCOVERY_COMPACT_SCHEMA_SQL.split(";")
    .map((sql) => sql.trim().replace(/\s+/g, " "))
    .filter(Boolean)) {
    await db.exec(statement)
  }
}

test(
  "real D1 concurrent users retry compact shared-state conflicts without losing discoveries",
  { timeout: 60000 },
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
      await installSchema(db)
      const dictionary = createDiscoveryOrdinalDictionary([{ symbol: "TP53", ordinal: 0 }])
      const users = 20
      const results = await Promise.all(
        Array.from({ length: users }, (_, index) =>
          recordCompactDiscoveryBatch(db, {
            userId: `user-${index}`,
            batchId: `device-${index}:1`,
            dictionary,
            encounters: [
              {
                symbol: "TP53",
                at: 1000 + index,
                source: "extension",
                trigger: "hover",
                dwell_ms: 900,
              },
            ],
            maxAttempts: 64,
          }),
        ),
      )
      assert.ok(results.every((result) => result.ok && !result.replay))
      const attempts = results.map((result) => result.attempts)
      const maxAttempts = Math.max(...attempts)
      const totalAttempts = attempts.reduce((sum, value) => sum + value, 0)
      assert.ok(maxAttempts <= users)
      const compact = await readCompactDiscoveryState(db, "user-0")
      assert.deepEqual(readSharedDiscoveryOrdinal(compact.shared, 0), {
        discoverer_count: users,
        encounter_count: users,
        first_at: 1000,
        latest_at: 1019,
      })
      console.log(
        "B764_CONCURRENCY_RECEIPT",
        JSON.stringify({ users, total_attempts: totalAttempts, max_attempts: maxAttempts, attempts }),
      )
    } finally {
      await runtime.dispose()
    }
  },
)

test(
  "same compact batch id replays from the user receipt without incrementing shared counts",
  { timeout: 60000 },
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
      await installSchema(db)
      const dictionary = createDiscoveryOrdinalDictionary([{ symbol: "TP53", ordinal: 0 }])
      const input = {
        userId: "user-1",
        batchId: "device-1:1",
        dictionary,
        encounters: [{ symbol: "TP53", at: 1000 }],
      }
      const first = await recordCompactDiscoveryBatch(db, input)
      const replay = await recordCompactDiscoveryBatch(db, {
        ...input,
        encounters: [{ symbol: "TP53", at: 9999 }],
      })
      assert.equal(first.replay, false)
      assert.equal(replay.replay, true)
      const compact = await readCompactDiscoveryState(db, "user-1")
      assert.deepEqual(readSharedDiscoveryOrdinal(compact.shared, 0), {
        discoverer_count: 1,
        encounter_count: 1,
        first_at: 1000,
        latest_at: 1000,
      })
    } finally {
      await runtime.dispose()
    }
  },
)
