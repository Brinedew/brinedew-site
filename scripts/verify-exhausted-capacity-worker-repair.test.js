import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { verifyWorkerRepairPaths } from "./verify-exhausted-capacity-worker-repair.mjs"
import { requireNormalWorkerRepairState } from "./verify-exhausted-capacity-worker-state.mjs"

test("exhausted-capacity repair accepts a schema-free worker diff", () => {
  const paths = [
    ".github/workflows/iconoplasm-d1-statement-burn-watch.yml",
    "docs/ICONOPLASM_OPERATIONS.md",
    "scripts/verify-exhausted-capacity-worker-repair.mjs",
    "workers/generated/operation-cost-identities.js",
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    "workers/iconoplasm/discovery-ordinal-store.js",
    "workers/iconoplasm/discovery-ordinal-store.test.js",
  ]
  assert.deepEqual(verifyWorkerRepairPaths(paths), [...paths].sort())
})

test("exhausted-capacity repair refuses schema, data and dependency changes", () => {
  const base = ["workers/iconoplasm/discovery-ordinal-store.js"]
  for (const forbidden of [
    "migrations-iconoplasm/9999_discovery_read_burn.sql",
    "migrations/0001_add_column.sql",
    "seeds/genes.json",
    "data/portraits.json",
    "workers/iconoplasm/catalog.sqlite",
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    "package.json",
    "pnpm-lock.yaml",
  ])
    assert.throws(
      () => verifyWorkerRepairPaths([...base, forbidden]),
      /COST_WORKER_REPAIR_SCOPE_REFUSED/,
      forbidden,
    )
})

test("exhausted-capacity repair refuses an empty or test-only diff", () => {
  assert.throws(() => verifyWorkerRepairPaths([]), /COST_WORKER_REPAIR_SCOPE_REFUSED/)
  assert.throws(
    () => verifyWorkerRepairPaths(["workers/iconoplasm/discovery-ordinal-store.test.js"]),
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
  assert.match(repair, /workers\/iconoplasm-card-publication\.test\.js/)
  assert.match(repair, /Restore immutable static assets required by the Worker bundle/)
  assert.match(repair, /run-id: \$\{\{ steps\.exact-ci\.outputs\.ci_run_id \}\}/)
  assert.match(repair, /Deploy the zero-D1 stateful Worker repair/)
  assert.match(repair, /wrangler deploy --env=""/)
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
