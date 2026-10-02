import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const readWorkflow = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")

test("maintenance containment uploads retain cron work and activation restores the owned schedule", () => {
  const workflow = parse(readWorkflow("deploy-quartz.yml"))
  // A normal release applies a pending Durable Object migration with
  // `wrangler deploy` and the config's own triggers; it is not containment.
  const migrationDeploy = workflow.jobs["deploy-production"].steps.find(
    (step) => step.name === "Deploy the compatible stateful Worker",
  )
  assert.equal(migrationDeploy.if, "inputs.data_maintenance != true")
  assert.match(migrationDeploy.run, /steps\.do_migration\.outputs\.pending/)
  assert.doesNotMatch(migrationDeploy.run, /--triggers/)
  const uploads = workflow.jobs["deploy-production"].steps.filter(
    (step) =>
      step !== migrationDeploy &&
      (step.run?.includes("pnpm exec wrangler deploy") ||
        step.run?.includes("node scripts/deploy-iconoplasm-reader-recovery.mjs")) &&
      (step.run.includes("--config wrangler.the-only-allowed-internal-stateful-worker") ||
        step.run.includes("--config wrangler.iconoplasm-schema-transition.generated.toml")),
  )
  // The maintenance path uploads the stateful Worker twice with
  // the checked-in schedule (once before Pages with the "-backend" cache
  // identity, once after with the final one); the two containment uploads keep
  // the three-cron reader-recovery schedule.
  assert.equal(uploads.length, 4)
  const conditional = uploads.filter((step) => step.if)
  assert.deepEqual(conditional.map((step) => step.if).sort(), [
    "inputs.data_maintenance == true && steps.migrations.outputs.continuation_required != 'true'",
    "inputs.data_maintenance == true && steps.migrations.outputs.continuation_required != 'true'",
    "inputs.data_maintenance == true && steps.release-state.outputs.schema_transition != 'true'",
    "inputs.data_maintenance == true && steps.release-state.outputs.schema_transition == 'true'",
  ])
  const containment = '--triggers "55 23 * * *" "3 0 * * *" "6 12 * * *"'
  const normalActivations = uploads.filter(
    (step) =>
      step.if ===
      "inputs.data_maintenance == true && steps.migrations.outputs.continuation_required != 'true'",
  )
  assert.equal(normalActivations.length, 2, "pre-Pages and post-Pages stateful uploads")
  for (const step of normalActivations) assert.doesNotMatch(step.run, /--triggers\b/)
  for (const step of uploads.filter((step) => !normalActivations.includes(step))) {
    assert.ok(step.run.includes(containment), step.name)
  }
  const statefulConfig = readFileSync(
    new URL(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      import.meta.url,
    ),
    "utf8",
  )
  assert.match(
    statefulConfig,
    /0,1,2,3,4,5,6,7,8,10,11,13,14,15,16,17,18,19,20,23,24,26,27,28,29,30,31,32,33,34,35,38,39,41,42,43,44,45,46,47,48,50,51,52,53,54,55,56,59 \* \* \* \*/,
  )
})
