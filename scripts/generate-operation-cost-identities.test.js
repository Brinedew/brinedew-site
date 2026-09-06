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

test("runtime identities ignore local caches but include new domain helpers and locked dependencies", (t) => {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), "iconoplasm-cost-identity-"))
  t.after(() => rmSync(sourceRoot, { recursive: true, force: true }))
  const write = (name, text) => {
    const file = path.join(sourceRoot, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  for (const directory of [
    "migrations",
    "migrations-iconoplasm",
    "migrations-iconoplasm-authoring",
  ])
    write(`${directory}/0001.sql`, "SELECT 1;\n")
  write("workers/runtime.js", "export const runtime = 1;\n")
  write("shared/domain.js", "export const domain = 1;\n")
  write("pnpm-lock.yaml", "lockfileVersion: 9\n")
  write(
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    "name = 'test'\n",
  )
  write("scripts/generate-operation-cost-migrations.mjs", "export const migration = 1;\n")
  const initial = operationCostIdentities({ sourceRoot })
  write("workers/node_modules/.cache/wrangler/account.json", '{"local":"one"}')
  write("workers/.wrangler/runtime.js", "local runtime cache")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("workers/runtime.js", "export const runtime = 1;\r\n")
  assert.deepEqual(operationCostIdentities({ sourceRoot }), initial)
  write("workers/domain/another-helper.js", "export const helper = 1;\n")
  const withHelper = operationCostIdentities({ sourceRoot })
  assert.notEqual(withHelper.executable_sha256, initial.executable_sha256)
  write("pnpm-lock.yaml", "lockfileVersion: 10\n")
  assert.notEqual(
    operationCostIdentities({ sourceRoot }).executable_sha256,
    withHelper.executable_sha256,
  )
})
