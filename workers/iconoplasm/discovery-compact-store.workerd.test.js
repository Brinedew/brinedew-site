import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import {
  applyDiscoveryBatch,
  applySharedDiscoveryDeltas,
  createDiscoveryOrdinalDictionary,
} from "./discovery-compact-state.js"
import {
  commitCompactDiscoveryBatch,
  DISCOVERY_COMPACT_SCHEMA_SQL,
  readCompactDiscoveryState,
} from "./discovery-compact-store.js"

function measuredDb(db, receipts) {
  return {
    prepare: (sql) => db.prepare(sql),
    batch: async (statements) => {
      try {
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
      } catch (error) {
        receipts.push({ reads: null, writes: 0, failed: true })
        throw error
      }
    },
  }
}

test(
  "real D1 compact discovery commits stay row-bounded and conflicts roll back",
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
      await db.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
      const dictionary = createDiscoveryOrdinalDictionary([
        { symbol: "TP53", ordinal: 0 },
        { symbol: "BRCA1", ordinal: 1 },
        { symbol: "EGFR", ordinal: 19022 },
      ])
      const receipts = []
      const measured = measuredDb(db, receipts)

      const initial = await readCompactDiscoveryState(measured, "user-1")
      const applied = applyDiscoveryBatch(initial.user, {
        batchId: "device-a:1",
        dictionary,
        encounters: Array.from({ length: 10 }, (_, index) => ({
          symbol: index % 2 ? "TP53" : "BRCA1",
          at: 1000 + index,
          source: "extension",
          trigger: "hover",
          dwell_ms: 900,
        })),
      })
      const shared = applySharedDiscoveryDeltas(initial.shared, {
        dictionaryVersion: dictionary.version,
        deltas: applied.shared_deltas,
      })
      assert.equal(
        (
          await commitCompactDiscoveryBatch(measured, {
            userId: "user-1",
            expectedUserVersion: 0,
            expectedSharedVersion: 0,
            nextUserState: applied.state,
            nextSharedState: shared,
            sealedChunks: applied.sealed_chunks,
            batchId: "device-a:1",
          })
        ).committed,
        true,
      )
      const firstWrite = receipts.at(-1)
      assert.ok(firstWrite.writes <= 4, `10-event batch wrote ${firstWrite.writes} D1 rows`)

      const beforeConflict = await readCompactDiscoveryState(measured, "user-1")
      const staleApplied = applyDiscoveryBatch(null, {
        batchId: "stale:1",
        dictionary,
        encounters: [{ symbol: "EGFR", at: 2000 }],
      })
      const staleShared = applySharedDiscoveryDeltas(
        { ...beforeConflict.shared, state_version: 0 },
        { dictionaryVersion: dictionary.version, deltas: staleApplied.shared_deltas },
      )
      assert.deepEqual(
        await commitCompactDiscoveryBatch(measured, {
          userId: "user-1",
          expectedUserVersion: 0,
          expectedSharedVersion: 0,
          nextUserState: staleApplied.state,
          nextSharedState: staleShared,
          sealedChunks: staleApplied.sealed_chunks,
          batchId: "stale:1",
        }),
        { committed: false, conflict: true },
      )
      const afterConflict = await readCompactDiscoveryState(measured, "user-1")
      assert.deepEqual(afterConflict, beforeConflict)

      const next = applyDiscoveryBatch(afterConflict.user, {
        batchId: "device-a:2",
        dictionary,
        encounters: Array.from({ length: 64 }, (_, index) => ({
          symbol: index % 2 ? "TP53" : "BRCA1",
          at: 3000 + index,
        })),
      })
      const nextShared = applySharedDiscoveryDeltas(afterConflict.shared, {
        dictionaryVersion: dictionary.version,
        deltas: next.shared_deltas,
      })
      assert.equal(next.sealed_chunks.length, 1)
      assert.equal(
        (
          await commitCompactDiscoveryBatch(measured, {
            userId: "user-1",
            expectedUserVersion: afterConflict.user.state_version,
            expectedSharedVersion: afterConflict.shared.state_version,
            nextUserState: next.state,
            nextSharedState: nextShared,
            sealedChunks: next.sealed_chunks,
            batchId: "device-a:2",
          })
        ).committed,
        true,
      )
      const chunkWrite = receipts.at(-1)
      assert.ok(chunkWrite.writes <= 6, `64-event chunk batch wrote ${chunkWrite.writes} D1 rows`)
      assert.equal(
        Number(
          (
            await db.prepare("SELECT COUNT(*) AS n FROM icono_discovery_chronology_v2").first()
          ).n,
        ),
        1,
      )
    } finally {
      await runtime.dispose()
    }
  },
)
