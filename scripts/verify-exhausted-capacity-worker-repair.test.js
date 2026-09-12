import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  B749_WORKER_REPAIR_FILES,
  verifyWorkerRepairPaths,
} from "./verify-exhausted-capacity-worker-repair.mjs"
import { requireNormalWorkerRepairState } from "./verify-exhausted-capacity-worker-state.mjs"

test("exhausted-capacity repair accepts only the exact reviewed B-749 source envelope", () => {
  assert.deepEqual(verifyWorkerRepairPaths(B749_WORKER_REPAIR_FILES), B749_WORKER_REPAIR_FILES)
  assert.throws(
    () => verifyWorkerRepairPaths([...B749_WORKER_REPAIR_FILES, "migrations-iconoplasm/9999.sql"]),
    /COST_WORKER_REPAIR_SCOPE_REFUSED/,
  )
  assert.throws(
    () =>
      verifyWorkerRepairPaths(
        B749_WORKER_REPAIR_FILES.filter(
          (path) => !path.includes("iconoplasm-stateful-runtime-inside-the-only-allowed"),
        ),
      ),
    /COST_WORKER_REPAIR_SCOPE_REFUSED/,
  )
})

test("the repair workflow stays exact-CI gated and D1-mutation free", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const start = workflow.indexOf("  worker-repair-only:")
  const end = workflow.indexOf("  deploy-production:", start)
  const repair = workflow.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(repair, /Require successful tests for the exact deployed commit/)
  assert.match(repair, /verify-exhausted-capacity-worker-repair\.mjs/)
  assert.match(repair, /verify-exhausted-capacity-worker-state\.mjs/)
  assert.match(repair, /Deploy the zero-D1 stateful Worker repair/)
  assert.doesNotMatch(repair, /d1 migrations|run-admitted-d1|publish-dirty|pages deploy/i)
})

test("worker repair refuses an installed schema transition", () => {
  assert.deepEqual(requireNormalWorkerRepairState({ schema_transition: false }), {
    schema_transition: false,
  })
  assert.throws(
    () => requireNormalWorkerRepairState({ schema_transition: true, reader_recovery: true }),
    /COST_WORKER_REPAIR_INCOMPATIBLE_INSTALLED_STATE/,
  )
})
