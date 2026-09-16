import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const temporaryFence = "github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'"

function readWorkflow(filename) {
  const source = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8")
  return { source, workflow: parse(source) }
}

test("the temporary B-742 hard quarantine is narrowly reactivated for Sep 17", () => {
  const { source, workflow } = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  const job = workflow.jobs.quarantine

  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.ok(workflow.on.schedule.length > 0)
  assert.equal(job.if, temporaryFence)
  assert.match(source, /2026-09-16/)
  assert.match(source, /One-shot Sep 17 pre-reset quarantine has expired/)
  assert.match(source, /SAFE_CONTAINMENT_SHA: d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce/)
  assert.equal(job["runs-on"], "ubuntu-latest")
  assert.match(source, /CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/)
  assert.match(source, /iconoplasm-sync-finalization/)
  assert.match(source, /iconoplasm-vote-projection/)
  assert.match(source, /iconoplasm-gene-card-materialization/)
  assert.doesNotMatch(source, /resume-delivery|set_queue_pause_state false/)
})

test("the existing cloud recovery driver is reactivated for Sep 17 only and never unpauses background work", () => {
  const { source, workflow } = readWorkflow("retry-production-after-d1-reset.yml")
  const job = workflow.jobs["recover-production"]

  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.ok(workflow.on.schedule.length >= 3)
  assert.equal(job.if, temporaryFence)
  assert.match(source, /2026-09-16/)
  assert.match(source, /2026-09-17/)
  assert.match(source, /One-shot Sep 17 recovery driver has expired/)
  assert.match(source, /2,12,22,32,42,52 7-23/)
  assert.equal(job["runs-on"], "ubuntu-latest")
  assert.match(source, /CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/)
  assert.match(source, /iconoplasm-sync-finalization/)
  assert.match(source, /iconoplasm-vote-projection/)
  assert.match(source, /iconoplasm-gene-card-materialization/)
  assert.doesNotMatch(source, /resume-delivery|set_queue_pause_state false/)
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
