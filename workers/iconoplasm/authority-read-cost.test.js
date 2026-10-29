import assert from "node:assert/strict"
import test from "node:test"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import runtime from "../the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  ICONOPLASM_BACKGROUND_MINUTES,
  ICONOPLASM_RECURRING_CRON,
} from "../iconoplasm-background-schedule.js"

// The gallery tick only decides whether to dispatch the Actions catalog
// publisher. Without a dispatch token it reports that and does nothing else.
test("the scheduled gallery tick is only the catalog dispatch and never throws without a token", async () => {
  await assert.doesNotReject(
    runtime.scheduled(
      {
        cron: ICONOPLASM_RECURRING_CRON,
        scheduledTime: Date.UTC(2026, 8, 6, 0, ICONOPLASM_BACKGROUND_MINUTES.gallery[0]),
      },
      {},
      {},
    ),
  )
})

test("rejected authority requests cannot schedule projection repairs or touch D1", async () => {
  let queries = 0
  const background = []
  const db = {
    prepare() {
      queries++
      throw new Error("Unadmitted database work")
    },
  }
  const env = {
    DB: db,
    ICONOPLASM_DB: db,
    ICONOPLASM_AUTHORITY_GENERATION_TOKEN: "test-generation",
  }
  const ctx = {
    waitUntil(promise) {
      background.push(promise)
    },
  }
  for (const [path, method] of [
    ["/api/iconoplasm/authority/generation-leases/claim", "POST"],
    ["/api/iconoplasm/authority/generation-leases/complete", "POST"],
  ]) {
    const result = await gateway(
      new Request(`https://iconoplasm.brinedew.bio${path}`, { method }),
      env,
      ctx,
    )
    assert.ok([401, 403].includes(result.status), `${path}: ${result.status}`)
  }
  await Promise.allSettled(background)
  assert.equal(queries, 0)
  assert.equal(background.length, 0)
})
