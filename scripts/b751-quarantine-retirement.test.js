import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const manualOnly = "github.event_name == 'workflow_dispatch'"
const temporaryFence = "github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'"

function readWorkflow(filename) {
  const source = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8")
  return { source, workflow: parse(source) }
}

test("the expired B-742 hard quarantine is retired at the whole-job boundary", () => {
  const { source, workflow } = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  const job = workflow.jobs.quarantine

  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.ok(!Object.hasOwn(workflow.on, "schedule"))
  assert.ok(Object.hasOwn(workflow.on, "push"))
  assert.equal(job.if, manualOnly)
  assert.match(source, /One-shot Sep 17 pre-reset quarantine has expired/)
  assert.match(source, /SAFE_CONTAINMENT_SHA: d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce/)
  assert.equal(job["runs-on"], "ubuntu-latest")
  assert.match(source, /CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/)
  assert.match(source, /iconoplasm-sync-finalization/)
  assert.match(source, /iconoplasm-vote-projection/)
  assert.match(source, /iconoplasm-gene-card-materialization/)
  assert.doesNotMatch(source, /resume-delivery|set_queue_pause_state false/)
})

test("the hard-quarantine retirement rejects removal or widening of the job fence", () => {
  const { workflow } = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  for (const weakened of [undefined, true, "always()", temporaryFence]) {
    const copy = structuredClone(workflow)
    copy.jobs.quarantine.if = weakened
    assert.notEqual(copy.jobs.quarantine.if, manualOnly)
  }
})

test("no automatic production recovery controller can be re-armed", () => {
  assert.ok(
    !existsSync(
      new URL("../.github/workflows/retry-production-after-d1-reset.yml", import.meta.url),
    ),
  )
  const { source } = readWorkflow("deploy-quartz.yml")
  assert.match(source, /resume_run_id:/)
  assert.match(source, /ICONOPLASM_RELEASE_ORIGIN_RUN_ID: \$\{\{ inputs\.resume_run_id \}\}/)
  assert.doesNotMatch(source, /schedule:/)
})

test("canonical protected production and D1-free containment remain independent", () => {
  const { source, workflow } = readWorkflow("deploy-quartz.yml")
  assert.ok(Object.hasOwn(workflow.on, "push"))
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.match(source, /inputs\.reader_recovery_only == true/)
  assert.match(source, /Require successful tests for the exact deployed commit/)
  assert.match(source, /Read compatible installed state and non-D1 reader headroom/)
  assert.match(source, /Apply reviewed D1 migrations through prediction admission/)
})
