import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import toml from "toml"
import {
  CANONICAL_CONFIG,
  prepareSchemaTransitionConfig,
} from "./prepare-iconoplasm-schema-transition-config.mjs"
import { createReleaseSender } from "./run-admitted-d1-migrations.mjs"
import { classifyOperationCostFailure } from "../workers/iconoplasm/operation-cost-http.js"

test("schema staging preserves every production binding", () => {
  const source = readFileSync(new URL(`../${CANONICAL_CONFIG}`, import.meta.url), "utf8")
  const canonical = toml.parse(source)
  const prepared = toml.parse(prepareSchemaTransitionConfig(source))
  assert.equal(
    prepared.main,
    "workers/b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js",
  )
  assert.deepEqual({ ...prepared, main: canonical.main }, { ...canonical })
  assert.throws(() => prepareSchemaTransitionConfig(""), /exactly one/)
  assert.throws(() => prepareSchemaTransitionConfig(source + source), /exactly one/)
})

test("migration staging preserves the fallback and all release gates", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  assert.match(workflow, /node scripts\/prepare-iconoplasm-schema-transition-config\.mjs/)
  assert.match(workflow, /--config wrangler\.iconoplasm-schema-transition\.generated\.toml/)
  const names = [
    "Require successful tests for the exact deployed commit",
    "Refresh account capacity immediately before pausing application work",
    "Stage migration admission in the existing state owner",
    "Apply reviewed D1 migrations through prediction admission",
    "Prepare the published catalog through shared KV admission",
    "Deploy the only allowed internal stateful worker (production)",
  ]
  let previous = -1
  for (const name of names) {
    const position = workflow.indexOf(`- name: ${name}`)
    assert.ok(position > previous, name)
    previous = position
  }
})

test("failure classification never returns private provider prose", () => {
  const cases = [
    ["D1_ERROR: no such table: private_table", "COST_DATABASE_TABLE_MISSING"],
    ["D1_ERROR: no such column: private_column", "COST_DATABASE_COLUMN_MISSING"],
    ["D1_ERROR: malformed JSON", "COST_DATABASE_MIGRATION_GUARD_REFUSED"],
    ["D1_ERROR: database or disk is full", "COST_DATABASE_STORAGE_FULL"],
    ["UNIQUE constraint failed: private_table.private_value", "COST_DATABASE_UNIQUE_CONSTRAINT"],
    [
      "Exceeded allowed rows written in Durable Objects free tier",
      "COST_AUTHORITY_STORAGE_WRITE_QUOTA",
    ],
    ["secret-token user@example.test unknown failure", "COST_AUTHORITY_NATIVE_FAILURE"],
  ]
  for (const [message, expected] of cases)
    assert.equal(classifyOperationCostFailure(new Error(message)), expected)
})

test("release reports a refused adapter without secrets or retries", async () => {
  const reports = []
  let calls = 0
  const send = createReleaseSender(
    "test-secret-token",
    async () => {
      calls++
      return Response.json(
        { code: "COST_DATABASE_MIGRATION_GUARD_REFUSED", private: "private-response" },
        { status: 503 },
      )
    },
    (step) => reports.push(step),
  )
  await assert.rejects(
    send("/execute", "POST", {
      operation_id: "release-migration",
      step_id: "execute-0",
      adapter_id: "iconoplasm-migration-0095",
      arguments: { private: "private-argument" },
    }),
    /COST_DATABASE_MIGRATION_GUARD_REFUSED/,
  )
  assert.equal(calls, 1)
  assert.equal(reports.length, 2)
  assert.equal(reports[1].phase, "refused")
  assert.equal(reports[1].adapter_id, "iconoplasm-migration-0095")
  assert.doesNotMatch(JSON.stringify(reports), /test-secret|private-response|private-argument/)
})
