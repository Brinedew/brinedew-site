import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const manualOnly = "github.event_name == 'workflow_dispatch'"
const workflows = [
  ["b742-hard-pre-reset-d1-quarantine.yml", "quarantine"],
  ["retry-production-after-d1-reset.yml", "recover-production"],
]

function requireRetiredAutomation(workflow, jobName) {
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.deepEqual(Object.keys(workflow.jobs), [jobName])
  assert.equal(workflow.jobs[jobName].if, manualOnly)
}

for (const [filename, jobName] of workflows) {
  const source = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8")
  const workflow = parse(source)

  test(`${filename}: every automatic trigger is stopped before a runner or mutation`, () => {
    requireRetiredAutomation(workflow, jobName)
    assert.ok(workflow.on.schedule.length > 0)
    assert.ok(Object.hasOwn(workflow.on, "push"))
    // This exact GitHub expression admits only an explicit operator dispatch.
    // Keeping it on the whole job prevents a later step from bypassing retirement.
    for (const eventName of Object.keys(workflow.on)) {
      const admitted = eventName === "workflow_dispatch"
      assert.equal(admitted, !["schedule", "push"].includes(eventName))
    }
    assert.match(source, /docs\/B751_QUARANTINE_RETIREMENT\.md/)
  })

  test(`${filename}: regression coverage rejects removal or widening of the job fence`, () => {
    for (const weakened of [undefined, true, "always()", "github.event_name != 'pull_request'"]) {
      const copy = structuredClone(workflow)
      copy.jobs[jobName].if = weakened
      assert.throws(() => requireRetiredAutomation(copy, jobName))
    }
  })

  test(`${filename}: the existing manual containment path remains available`, () => {
    const job = workflow.jobs[jobName]
    assert.equal(job["runs-on"], "ubuntu-latest")
    assert.ok(job.steps.length > 0)
    assert.match(source, /CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/)
    assert.match(source, /iconoplasm-sync-finalization/)
    assert.match(source, /iconoplasm-vote-projection/)
    assert.match(source, /iconoplasm-gene-card-materialization/)
    assert.doesNotMatch(source, /resume-delivery|set_queue_pause_state false/)
  })
}

test("canonical protected production and D1-free repair paths remain independent", () => {
  const source = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  const workflow = parse(source)
  assert.ok(Object.hasOwn(workflow.on, "push"))
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"))
  assert.notEqual(workflow.jobs["deploy-production"].if, manualOnly)
  assert.match(source, /inputs\.reader_recovery_only == true/)
  assert.match(source, /Require successful tests for the exact deployed commit/)
  assert.match(source, /Read compatible installed state and non-D1 reader headroom/)
  assert.match(source, /Apply reviewed D1 migrations through prediction admission/)
})
