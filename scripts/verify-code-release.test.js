import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"
import { readAppliedChangedMigrations, verifyCodeReleaseScope } from "./verify-code-release.mjs"

const installed = "a".repeat(40)
const head = "b".repeat(40)
const state = { schema_transition: false, reader_recovery: false, cache_version: installed }

test("a routine release includes every change since the installed Worker", () => {
  const changedPaths = [
    "workers/iconoplasm-card-publication.js",
    "quartz/static/iconoplasm/publication-reader.js",
    "content/apps/iconoplasm/index.md",
    "package.json",
    ".github/workflows/deploy-quartz.yml",
  ]
  assert.deepEqual(
    verifyCodeReleaseScope({ state, headSha: head, changedPaths, installedIsAncestor: true }),
    { installed_sha: installed, head_sha: head, changed_paths: changedPaths },
  )
  assert.deepEqual(
    verifyCodeReleaseScope({
      state,
      headSha: installed,
      changedPaths: [],
      installedIsAncestor: true,
    }).changed_paths,
    [],
  )
})

test("a routine release refuses unapplied data or owned topology changes before upload", () => {
  for (const path of [
    "migrations/0100_new_field.sql",
    "migrations-iconoplasm/0100_new_field.sql",
    "migrations-iconoplasm-authoring/0100_new_field.sql",
    "migrations-iconoplasm-event-archive/0100_new_field.sql",
    "workers/benchmark/migrations/0100_new_field.sql",
    "cloudflare/operation-cost-migration-plan.json",
    "cloudflare/deployment-topology.json",
  ]) {
    assert.throws(
      () =>
        verifyCodeReleaseScope({
          state,
          headSha: head,
          changedPaths: ["workers/fix.js", path],
          installedIsAncestor: true,
        }),
      /CODE_RELEASE_REQUIRES_MAINTENANCE/,
      path,
    )
  }
})

test("a routing-only Wrangler edit is ordinary deployable code", () => {
  const changedPaths = [
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  ]
  assert.deepEqual(
    verifyCodeReleaseScope({ state, headSha: head, changedPaths, installedIsAncestor: true }),
    { installed_sha: installed, head_sha: head, changed_paths: changedPaths },
  )
})

test("a routine release accepts a migration already recorded in its D1 journal", () => {
  const changedPaths = [
    "migrations-iconoplasm-authoring/0018_assignment_manifestation_lookup.sql",
    "migrations-iconoplasm-event-archive/0001_event_archive.sql",
    "migrations-iconoplasm-authoring/README.md",
  ]
  assert.deepEqual(
    verifyCodeReleaseScope({
      state,
      headSha: head,
      changedPaths,
      installedIsAncestor: true,
      appliedMigrations: new Set(changedPaths.slice(0, 2)),
    }),
    { installed_sha: installed, head_sha: head, changed_paths: changedPaths },
  )
  assert.throws(
    () =>
      verifyCodeReleaseScope({
        state,
        headSha: head,
        changedPaths: ["other/schema.sql"],
        installedIsAncestor: true,
        appliedMigrations: new Set(["other/schema.sql"]),
      }),
    /CODE_RELEASE_REQUIRES_MAINTENANCE/,
  )
})

test("journal check reads only changed migration names from their owning databases", async () => {
  const changedPaths = [
    "migrations-iconoplasm/0108_compact_discovery_activation_v2.sql",
    "migrations-iconoplasm-authoring/0018_assignment_manifestation_lookup.sql",
    "migrations-iconoplasm-event-archive/0001_event_archive.sql",
  ]
  const calls = []
  const applied = await readAppliedChangedMigrations({
    changedPaths,
    accountId: "a".repeat(32),
    token: "test-token",
    configText: `[[d1_databases]]
binding = "ICONOPLASM_DB"
database_id = "11111111-1111-1111-1111-111111111111"
[[d1_databases]]
binding = "ICONOPLASM_AUTHORING_DB"
database_id = "22222222-2222-2222-2222-222222222222"
[[d1_databases]]
binding = "ICONOPLASM_AUTHORITY_EVENT_ARCHIVE_DB"
database_id = "33333333-3333-3333-3333-333333333333"`,
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body)
      calls.push({ url, body })
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: [{ success: true, results: [{ name: body.params[0] }] }],
        }),
      }
    },
  })
  assert.deepEqual(applied, new Set(changedPaths))
  assert.equal(calls.length, 3)
  assert.deepEqual(
    calls.map((call) => call.body),
    [
      {
        sql: "SELECT name FROM d1_migrations WHERE name IN (?)",
        params: ["0108_compact_discovery_activation_v2.sql"],
      },
      {
        sql: "SELECT name FROM d1_migrations WHERE name IN (?)",
        params: ["0018_assignment_manifestation_lookup.sql"],
      },
      {
        sql: "SELECT name FROM d1_migrations WHERE name IN (?)",
        params: ["0001_event_archive.sql"],
      },
    ],
  )
})

test("missing or failed journal evidence cannot authorize a code release", async () => {
  const changedPaths = ["migrations-iconoplasm-authoring/0018_assignment_manifestation_lookup.sql"]
  const options = {
    changedPaths,
    accountId: "a".repeat(32),
    token: "test-token",
    configText: `[[d1_databases]]
binding = "ICONOPLASM_AUTHORING_DB"
database_id = "22222222-2222-2222-2222-222222222222"`,
  }
  const missing = await readAppliedChangedMigrations({
    ...options,
    fetcher: async () => ({
      ok: true,
      json: async () => ({ success: true, result: [{ success: true, results: [] }] }),
    }),
  })
  assert.throws(
    () =>
      verifyCodeReleaseScope({
        state,
        headSha: head,
        changedPaths,
        installedIsAncestor: true,
        appliedMigrations: missing,
      }),
    /CODE_RELEASE_REQUIRES_MAINTENANCE/,
  )
  await assert.rejects(
    readAppliedChangedMigrations({
      ...options,
      fetcher: async () => ({ ok: false, status: 503 }),
    }),
    /CODE_RELEASE_MIGRATION_STATE_UNAVAILABLE/,
  )
})

test("a routine release refuses uncertain installed lineage or active migration", () => {
  for (const unsafe of [
    { ...state, cache_version: "" },
    { ...state, cache_version: "short" },
    { ...state, schema_transition: true },
    { ...state, reader_recovery: true },
  ]) {
    assert.throws(
      () =>
        verifyCodeReleaseScope({
          state: unsafe,
          headSha: head,
          changedPaths: [],
          installedIsAncestor: true,
        }),
      /CODE_RELEASE_(INSTALLED_REVISION_UNKNOWN|INCOMPATIBLE_STATE)/,
    )
  }
  assert.throws(
    () =>
      verifyCodeReleaseScope({
        state,
        headSha: head,
        changedPaths: [],
        installedIsAncestor: false,
      }),
    /CODE_RELEASE_INSTALLED_REVISION_NOT_ANCESTOR/,
  )
})

test("default production path builds and ships both Worker owners and Pages without D1 maintenance", () => {
  const workflow = parse(
    readFileSync(new URL("../.github/workflows/deploy-quartz.yml", import.meta.url), "utf8"),
  )
  assert.equal(workflow.jobs["worker-repair-only"], undefined)
  const job = workflow.jobs["deploy-production"]
  assert.ok(job)
  const steps = job.steps
  const codeGate = steps.findIndex((step) => step.run?.includes("verify-code-release.mjs"))
  const build = steps.findIndex((step) => step.run === "pnpm run build")
  const worker = steps.findIndex((step) => step.name === "Deploy the compatible stateful Worker")
  const edge = steps.findIndex((step) => step.name === "Deploy the compatible public edge Worker")
  const pages = steps.findIndex(
    (step) => step.name === "Deploy production static site to Cloudflare Pages",
  )
  const activate = steps.findIndex(
    (step) => step.name === "Activate compatible Worker with current HTML shell cache version",
  )
  assert.ok(codeGate >= 0 && codeGate < build && build < worker)
  assert.ok(worker < edge && edge < pages && pages < activate)
  assert.match(steps[codeGate].if, /data_maintenance != true/)
  assert.match(steps[worker].if, /data_maintenance != true/)
  for (const index of [worker, edge, activate]) {
    assert.match(steps[index].run, /wrangler versions upload/)
    assert.match(steps[index].run, /wrangler versions deploy/)
    assert.doesNotMatch(steps[index].run, /wrangler triggers deploy|--triggers/)
  }
  for (const name of [
    "Check account capacity before release mutations",
    "Stage migration admission in the existing state owner",
    "Apply reviewed D1 migrations through prediction admission",
    "Prepare the published catalog through shared KV admission",
    "Publish, verify, and activate immutable public reads",
    "Ensure Iconoplasm finalization Queue consumer is bound",
  ]) {
    const step = steps.find((candidate) => candidate.name === name)
    assert.ok(step, name)
    assert.match(step.if, /data_maintenance == true/, name)
  }
  assert.match(steps[edge].if, /continuation_required != 'true'/)
  assert.match(steps[pages].if, /continuation_required != 'true'/)
  assert.match(steps[activate].run, /ICONOPLASM_HTML_SHELL_CACHE_VERSION:\$CACHE_BUST/)
  assert.ok(
    steps.some(
      (step) => step.name === "Smoke test production host ownership and browser bootstraps",
    ),
  )
})
