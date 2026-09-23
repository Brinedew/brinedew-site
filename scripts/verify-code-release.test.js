import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"
import { verifyCodeReleaseScope } from "./verify-code-release.mjs"

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

test("a routine release refuses unapplied data, binding, or route changes before upload", () => {
  for (const path of [
    "migrations/0100_new_field.sql",
    "migrations-iconoplasm/0100_new_field.sql",
    "migrations-iconoplasm-authoring/0100_new_field.sql",
    "workers/benchmark/migrations/0100_new_field.sql",
    "cloudflare/operation-cost-migration-plan.json",
    "cloudflare/deployment-topology.json",
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
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
  assert.equal(workflow.jobs["deploy-viral-load-staging"], undefined)
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
