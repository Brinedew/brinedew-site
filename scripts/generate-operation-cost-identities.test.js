import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { operationCostIdentities } from "./generate-operation-cost-identities.mjs"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { assertOperationCostMigrationsCurrent } from "./generate-operation-cost-migrations.mjs"

test("deployed cost identities match the enforcement code and migration set", () => {
  assert.deepEqual(OPERATION_COST_IDENTITIES, operationCostIdentities())
  assert.doesNotThrow(assertOperationCostMigrationsCurrent)
})

test("cost identities follow the cost authority imports, not unrelated Worker copy", (t) => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), "iconoplasm-cost-identity-"))
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }))
  const write = (name, text) => {
    const file = path.join(sourceRoot, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  for (const directory of [
    "migrations",
    "workers/benchmark/migrations",
    "migrations-iconoplasm",
    "migrations-iconoplasm-authoring",
  ])
    write(`${directory}/0001.sql`, "SELECT 1;\n")
  write(
    "workers/iconoplasm/operation-cost-http.js",
    "import { query } from './domain/query.js'; export const cost = query;\n",
  )
  write(
    "workers/iconoplasm/domain/query.js",
    "import { value } from '../../../shared/domain.js'; export const query = value;\n",
  )
  write("shared/domain.js", "export const value = 1;\n")
  write("workers/runtime.js", "export const runtime = 1;\n")
  write("workers/iconoplasm-observability-freshness.js", "export const headline = 'old';\n")
  write("pnpm-lock.yaml", "lockfileVersion: 9\n")
  write(
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    "name = 'test'\n",
  )
  write("scripts/generate-operation-cost-migrations.mjs", "export const migration = 1;\n")
  const initial = operationCostIdentities({ sourceRoot })
  write(
    "workers/the-only-allowed-public-edge-worker-that-must-not-touch-state.js",
    "export const publicRedirect = 301;\n",
  )
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("workers/node_modules/.cache/wrangler/account.json", '{"local":"one"}')
  write("workers/.wrangler/runtime.js", "local runtime cache")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("workers/runtime.js", "export const runtime = 1;\r\n")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("workers/iconoplasm-observability-freshness.js", "export const headline = 'new';\n")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("shared/domain.js", "export const value = 1;\r\n")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("shared/domain.js", "export const value = 2;\n")
  const withHelper = operationCostIdentities({ sourceRoot })
  assert.notEqual(withHelper.executable_sha256, initial.executable_sha256)
  write("pnpm-lock.yaml", "lockfileVersion: 10\n")
  assert.notEqual(
    operationCostIdentities({ sourceRoot }).executable_sha256,
    withHelper.executable_sha256,
  )
  const beforeBenchmark = operationCostIdentities({ sourceRoot })
  write(
    "workers/benchmark/migrations/0002.sql",
    "CREATE TABLE benchmark_test(id INTEGER PRIMARY KEY);\n",
  )
  assert.notEqual(
    operationCostIdentities({ sourceRoot }).schema_sha256,
    beforeBenchmark.schema_sha256,
  )
})
