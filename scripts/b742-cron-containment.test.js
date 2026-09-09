import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const readWorkflow = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")

test("every production state-owner upload retains incident cron containment", () => {
  const workflow = parse(readWorkflow("deploy-quartz.yml"))
  const uploads = workflow.jobs["deploy-production"].steps.filter(
    (step) =>
      (step.run?.includes("pnpm exec wrangler deploy") ||
        step.run?.includes("node scripts/deploy-iconoplasm-reader-recovery.mjs")) &&
      (step.run.includes("--config wrangler.the-only-allowed-internal-stateful-worker") ||
        step.run.includes("--config wrangler.iconoplasm-schema-transition.generated.toml")),
  )
  assert.equal(uploads.length, 4)
  const conditional = uploads.filter((step) => step.if)
  assert.deepEqual(conditional.map((step) => step.if).sort(), [
    "steps.release-state.outputs.schema_transition != 'true'",
    "steps.release-state.outputs.schema_transition == 'true'",
  ])
  // Exactly one of the two schema stages runs; a release still uploads the
  // state owner at most three times, regardless of initial maintenance state.
  assert.equal(uploads.filter((step) => !step.if).length + 1, 3)
  const expected = '--triggers "55 23 * * *" "3 0 * * *" "6 12 * * *"'
  for (const step of uploads) assert.ok(step.run.includes(expected), step.name)
})

test("the recovery controller can only tighten background containment and recurs every UTC day", () => {
  const workflow = readWorkflow("retry-production-after-d1-reset.yml")
  assert.match(workflow, /set_queue_pause_state true/)
  assert.doesNotMatch(workflow, /set_queue_pause_state false|release_background|FULL_CRONS/)
  assert.match(workflow, /Final containment check complete; background quarantine remains/)
  assert.doesNotMatch(workflow, /RECOVERY_DEADLINE_UTC/)
  assert.match(workflow, /utc_minute_of_day > 390 && utc_minute_of_day < 1435/)
})

test("the hard pre-reset quarantine cannot expire on a calendar date", () => {
  const workflow = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  assert.doesNotMatch(workflow, /RECOVERY_DEADLINE_UTC/)
  assert.match(workflow, /utc_minute_of_day > 5 && utc_minute_of_day < 1435/)
  assert.match(workflow, /cron: "58 23 \* \* \*"/)
})
