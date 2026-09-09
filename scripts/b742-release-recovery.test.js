import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import toml from "toml"
import {
  CANONICAL_CONFIG,
  SCHEMA_TRANSITION_MODE,
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
  assert.equal(SCHEMA_TRANSITION_MODE, "reader-recovery")
  assert.deepEqual({ ...prepared, main: canonical.main }, { ...canonical })
  assert.throws(() => prepareSchemaTransitionConfig(""), /exactly one/)
  assert.throws(() => prepareSchemaTransitionConfig(source + source), /exactly one/)
  assert.throws(
    () => prepareSchemaTransitionConfig(source, { mode: "shell-only" }),
    /Unsupported schema-transition mode/,
  )
})

test("migration staging preserves the fallback and all release gates", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  assert.match(workflow, /node scripts\/prepare-iconoplasm-schema-transition-config\.mjs/)
  assert.match(workflow, /--config wrangler\.iconoplasm-schema-transition\.generated\.toml/)
  assert.match(workflow, /--var "ICONOPLASM_SCHEMA_TRANSITION_MODE:reader-recovery"/)
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
  const readerRefresh = workflow.indexOf(
    "- name: Refresh published readers during existing schema maintenance",
  )
  for (const gate of [
    "Require successful tests for the exact deployed commit",
    "Verify operation cost implementation and migration identities",
    "Validate Iconoplasm deployment topology",
    "Read installed schema-transition state and reader headroom",
  ])
    assert.ok(workflow.indexOf(`- name: ${gate}`) < readerRefresh, gate)
  assert.match(
    workflow.slice(readerRefresh),
    /if: steps\.release-state\.outputs\.schema_transition == 'true'/,
  )
  assert.match(
    workflow.slice(workflow.indexOf("- name: Stage migration admission")),
    /if: steps\.release-state\.outputs\.schema_transition != 'true'/,
  )
  assert.ok(
    readerRefresh <
      workflow.indexOf("- name: Require account-wide D1 and Worker headroom before migrations"),
  )
})

test("manual reader recovery is exact-CI gated and never enters the D1 release path", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const start = workflow.indexOf("  reader-recovery-only:")
  const end = workflow.indexOf("  deploy-production:", start)
  assert.ok(start >= 0 && end > start)
  const recovery = workflow.slice(start, end)
  assert.match(recovery, /inputs\.reader_recovery_only == true/)
  assert.match(recovery, /Require successful tests for the exact deployed commit/)
  assert.match(recovery, /id: exact-ci/)
  assert.match(recovery, /Restore immutable static assets from the exact tested CI run/)
  assert.match(recovery, /run-id: \$\{\{ steps\.exact-ci\.outputs\.ci_run_id \}\}/)
  assert.match(recovery, /Verify restored immutable static asset bundle/)
  assert.match(recovery, /ICONOPLASM_READER_RECOVERY_ONLY: "1"/)
  assert.match(recovery, /Read compatible installed state and non-D1 reader headroom/)
  assert.match(recovery, /Deploy the D1-free reader containment artifact/)
  assert.match(recovery, /ICONOPLASM_SCHEMA_TRANSITION_MODE:reader-recovery/)
  assert.match(recovery, /Verify published readers and retained application protection/)
  for (const forbidden of [
    "Install Python dependencies",
    "Enrich protein pages",
    "Sync shared Iconoplasm assets before release guards",
    "Apply reviewed D1 migrations through prediction admission",
    "Prepare the published catalog through shared KV admission",
    "Ensure requested gene-card Queues exist",
  ])
    assert.equal(recovery.includes(forbidden), false, forbidden)
})

test("exact push CI archives the static bundle needed by D1-free recovery", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yaml", import.meta.url), "utf8")
  assert.match(ci, /Ensure Quartz builds/)
  assert.match(ci, /Archive exact tested Iconoplasm static assets for recovery/)
  assert.match(ci, /name: iconoplasm-edge-assets-\$\{\{ github\.sha \}\}/)
  assert.match(ci, /path: public-iconoplasm-edge/)
  assert.match(ci, /retention-days: 1/)
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
