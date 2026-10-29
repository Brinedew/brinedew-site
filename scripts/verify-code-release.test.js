import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"
import {
  readAppliedChangedMigrations,
  reviewedOnlineMigrationPaths,
  verifyCodeReleaseScope,
} from "./verify-code-release.mjs"

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

test("a routine release refuses unapplied data changes before upload", () => {
  for (const path of [
    "migrations/0100_new_field.sql",
    "migrations-iconoplasm/0100_new_field.sql",
    "workers/benchmark/migrations/0100_new_field.sql",
  ]) {
    assert.throws(
      () =>
        verifyCodeReleaseScope({
          state,
          headSha: head,
          changedPaths: ["workers/fix.js", path],
          installedIsAncestor: true,
        }),
      /MIGRATION_NOT_ONLINE/,
      path,
    )
  }
})

// B-847: a reviewed online migration (and the plan entry that declares it)
// ships on the ordinary push; the online step applies it before the Worker.
test("a reviewed online migration and its plan entry are ordinary releases", () => {
  const changedPaths = [
    "workers/fix.js",
    "migrations-iconoplasm/0110_drop.sql",
    "cloudflare/operation-cost-migration-plan.json",
  ]
  assert.deepEqual(
    verifyCodeReleaseScope({
      state,
      headSha: head,
      changedPaths,
      installedIsAncestor: true,
      onlineMigrations: new Set(["migrations-iconoplasm/0110_drop.sql"]),
    }).changed_paths,
    changedPaths,
  )
  assert.throws(
    () =>
      verifyCodeReleaseScope({
        state,
        headSha: head,
        changedPaths: ["migrations-iconoplasm/0111_offline.sql"],
        installedIsAncestor: true,
        onlineMigrations: new Set(["migrations-iconoplasm/0110_drop.sql"]),
      }),
    /MIGRATION_NOT_ONLINE/,
  )
  assert.deepEqual(
    [
      ...reviewedOnlineMigrationPaths({
        migrations: {
          "iconoplasm/0110_drop.sql": { online: true },
          "iconoplasm/0112_offline.sql": {},
          "geneguessr/0050_x.sql": { online: true },
        },
      }),
    ],
    ["migrations-iconoplasm/0110_drop.sql"],
  )
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
    "migrations-iconoplasm/0108_compact_discovery_activation_v2.sql",
    "migrations/0028_brinedew_account_lifecycle.sql",
    "migrations-iconoplasm/README.md",
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
    /MIGRATION_NOT_ONLINE/,
  )
})

test("journal check reads only changed migration names from their owning databases", async () => {
  const changedPaths = [
    "migrations-iconoplasm/0108_compact_discovery_activation_v2.sql",
    "migrations/0028_brinedew_account_lifecycle.sql",
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
binding = "DB"
database_id = "22222222-2222-2222-2222-222222222222"`,
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
  assert.equal(calls.length, 2)
  assert.deepEqual(
    calls.map((call) => call.body),
    [
      {
        sql: "SELECT name FROM d1_migrations WHERE name IN (?)",
        params: ["0108_compact_discovery_activation_v2.sql"],
      },
      {
        sql: "SELECT name FROM d1_migrations WHERE name IN (?)",
        params: ["0028_brinedew_account_lifecycle.sql"],
      },
    ],
  )
})

test("missing or failed journal evidence cannot authorize a code release", async () => {
  const changedPaths = ["migrations-iconoplasm/0108_compact_discovery_activation_v2.sql"]
  const options = {
    changedPaths,
    accountId: "a".repeat(32),
    token: "test-token",
    configText: `[[d1_databases]]
binding = "ICONOPLASM_DB"
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
    /MIGRATION_NOT_ONLINE/,
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

test("the production release builds and ships both Worker owners and Pages", () => {
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
  for (const index of [worker, edge, activate]) {
    assert.match(steps[index].run, /wrangler versions upload/)
    assert.match(steps[index].run, /wrangler versions deploy/)
    assert.doesNotMatch(steps[index].run, /wrangler triggers deploy|--triggers/)
  }
  assert.match(steps[activate].run, /ICONOPLASM_HTML_SHELL_CACHE_VERSION:\$CACHE_BUST/)
  assert.ok(
    steps.some(
      (step) => step.name === "Smoke test production host ownership and browser bootstraps",
    ),
  )
})
