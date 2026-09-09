import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = new URL("../", import.meta.url)
const workflow = readFileSync(new URL(".github/workflows/deploy-quartz.yml", root), "utf8")
const recovery = readFileSync(
  new URL(".github/workflows/retry-production-after-d1-reset.yml", root),
  "utf8",
)
const sentinelName = "Reject exhausted capacity before release setup"
// The manual D1-free reader recovery intentionally repeats the exact-source
// and exact-CI labels. The early-release sentinel applies only to the normal
// deployment job that can reach D1, not to that isolated containment job.
const deployProduction = workflow.slice(workflow.indexOf("  deploy-production:"))

function stepPosition(name) {
  const needle = `- name: ${name}\n`
  const position = deployProduction.indexOf(needle)
  assert.ok(position >= 0, `Missing release step: ${name}`)
  assert.equal(
    deployProduction.indexOf(needle, position + 1),
    -1,
    `Duplicate release step: ${name}`,
  )
  return position
}

test("early refusal follows source and CI checks and precedes release setup", () => {
  const sentinel = stepPosition(sentinelName)
  assert.ok(stepPosition("Reject stale production source before admission") < sentinel)
  assert.ok(stepPosition("Require successful tests for the exact deployed commit") < sentinel)
  for (const name of [
    "Setup Python",
    "Install Python dependencies",
    "Enrich protein pages",
    "Install dependencies",
    "Sync shared Iconoplasm assets before release guards",
    "Bake Iconoplasm observability snapshot (production)",
    "Build Quartz site",
  ]) {
    assert.ok(sentinel < stepPosition(name), `Sentinel must precede ${name}`)
  }
  assert.equal(
    deployProduction.split("node scripts/early-release-capacity-sentinel.mjs").length - 1,
    1,
  )
  const sentinelStep = deployProduction.slice(
    sentinel,
    deployProduction.indexOf("\n      - name:", sentinel),
  )
  assert.match(sentinelStep, /timeout-minutes: 1/)
  assert.doesNotMatch(sentinelStep, /continue-on-error|always\(\)/)
})

test("published readers recover before D1 admission and all later release gates remain", () => {
  const reader = stepPosition("Refresh published readers during existing schema maintenance")
  assert.ok(stepPosition("Read installed schema-transition state and reader headroom") < reader)
  assert.ok(reader < stepPosition("Require account-wide D1 and Worker headroom before migrations"))
  const complete = stepPosition("Check account capacity before release mutations")
  const refreshed = stepPosition(
    "Refresh account capacity immediately before pausing application work",
  )
  const stage = stepPosition("Stage migration admission in the existing state owner")
  const migrate = stepPosition("Apply reviewed D1 migrations through prediction admission")
  assert.ok(complete < refreshed && refreshed < stage && stage < migrate)
  assert.equal(
    deployProduction.split("node scripts/preflight-operation-cost-release.mjs").length - 1,
    2,
  )
  assert.match(workflow, /cancel-in-progress: false/)
})

test("reset controller recognizes early refusal while retaining background containment", () => {
  const start = recovery.indexOf('case "${failed_step}" in')
  const end = recovery.indexOf("esac", start)
  assert.ok(start >= 0 && end > start)
  assert.ok(recovery.slice(start, end).includes(`"${sentinelName}"`))
  assert.match(recovery, /set_queue_pause_state true/)
  assert.doesNotMatch(recovery, /set_queue_pause_state false/)
  assert.match(recovery, /Final containment check complete; background quarantine remains in place/)
})

test("real sentinel imports load and missing credentials refuse before provider traffic", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("scripts/early-release-capacity-sentinel.mjs", root))],
    {
      cwd: fileURLToPath(root),
      env: { PATH: process.env.PATH || "", SystemRoot: process.env.SystemRoot || "" },
      encoding: "utf8",
      timeout: 10_000,
    },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /^COST_RELEASE_STATE_CREDENTIALS_REQUIRED\s*$/)
  assert.equal(result.stdout, "")
})
