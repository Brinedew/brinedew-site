import assert from "node:assert/strict"
import test from "node:test"

import { MAX_EMULSION_CODES_PER_VISION } from "../lib/iconoplasm-mutation-write-bounds.js"
import { iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"

// B-1067: the dirty-vision rebuild, on the real schema of every production
// migration, with the real batch admission. Failure modes written before the
// change:
// 1. visions above the emulsion-code bound (B-946) stop the run, so a good
//    vision queued behind them is never rebuilt; this is what our own
//    50-statement invocation budget did after about 30 refusals, a wall that is
//    neither Cloudflare's (1,000 D1 calls an invocation) nor the tier table's;
// 2. a refused vision loses its mark, or keeps the head of the queue;
// 3. a rebuild writes rows for a refused vision.
// The loop is bounded by construction: each failed attempt removes one vision,
// so a run of N visions makes at most N + 1 attempts.

const today = new Date().toISOString().slice(0, 10)
// Cloudflare's GraphQL answer for a quiet account: 1,000 rows read and 100
// written today, nothing in the last ten minutes.
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [{ sum: { requests: 10 } }],
              d1AnalyticsAdaptiveGroups: [
                {
                  dimensions: { date: today, databaseId: "main" },
                  sum: { rowsRead: 1_000, rowsWritten: 100 },
                },
              ],
              recent: [],
            },
          ],
        },
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )

const { markVisionRollupsDirty, rebuildDirtyVisionRollups } =
  await import("../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")

let assetNumber = 0
function addAsset(db, visionId, emulsionId) {
  assetNumber += 1
  const sha = assetNumber.toString(16).padStart(64, "0")
  db.database
    .prepare(
      `INSERT INTO icono_portrait_assets
         (gene_symbol, asset_sha256, r2_key_full, r2_key_thumb, vision_id, emulsion_id)
       VALUES ('TP53', ?, ?, ?, ?, ?)`,
    )
    .run(sha, `full/${sha}.webp`, `thumb/${sha}.webp`, visionId, emulsionId)
}

test("visions over the code bound are set aside, and the good vision behind 40 of them is rebuilt", async () => {
  const db = iconoplasmDatabase()
  const env = {
    ICONOPLASM_DB: db,
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_BUDGET_ANALYTICS_TOKEN: "analytics-token",
  }
  const over = Array.from({ length: 40 }, (_, i) => `anima-v1-9${String(i).padStart(4, "0")}`)
  for (const visionId of over)
    for (let code = 0; code <= MAX_EMULSION_CODES_PER_VISION; code += 1)
      addAsset(db, visionId, `X${code}-${visionId}`)
  addAsset(db, "anima-v1-23013", "C9-23013")
  // The over-bound visions were marked first, so they hold the head of the queue.
  await markVisionRollupsDirty(env, over, "2026-10-11T00:00:00.000Z")
  await markVisionRollupsDirty(env, ["anima-v1-23013"], "2026-10-11T00:01:00.000Z")

  const result = await rebuildDirtyVisionRollups(env)

  assert.equal(result.ok, true)
  assert.equal(result.visions, 1)
  assert.equal(result.remaining, 0)
  assert.deepEqual(result.refused.map((row) => row.vision_id).sort(), [...over].sort())
  const rolled = db.database
    .prepare("SELECT vision_id FROM icono_admin_vision_rollup ORDER BY vision_id")
    .all()
    .map((row) => row.vision_id)
  assert.deepEqual(rolled, ["anima-v1-23013"])
  // Every refused vision stays marked, now behind anything marked before it.
  const dirty = db.database
    .prepare("SELECT vision_id FROM icono_vision_rollup_dirty ORDER BY vision_id")
    .all()
    .map((row) => row.vision_id)
  assert.deepEqual(dirty, [...over].sort())
})
