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
    "steps.migrations.outputs.continuation_required != 'true'",
    "steps.migrations.outputs.continuation_required != 'true'",
    "steps.release-state.outputs.schema_transition != 'true'",
    "steps.release-state.outputs.schema_transition == 'true'",
  ])
  assert.equal(
    uploads.filter((step) => step.if === "steps.migrations.outputs.continuation_required != 'true'")
      .length,
    2,
  )
  const expected = '--triggers "55 23 * * *" "3 0 * * *" "6 12 * * *"'
  for (const step of uploads) assert.ok(step.run.includes(expected), step.name)
})

test("the Sep 17 cloud recovery controller only tightens quarantine and keeps retrying the same UTC day", () => {
  const workflow = readWorkflow("retry-production-after-d1-reset.yml")
  assert.match(workflow, /set_queue_pause_state true/)
  assert.doesNotMatch(workflow, /set_queue_pause_state false|release_background|FULL_CRONS/)
  assert.match(workflow, /One-shot Sep 17 recovery driver has expired/)
  assert.match(workflow, /2026-09-17/)
  assert.match(workflow, /2,7,12,17,22,27,32,37,42,47,52,57 0-6/)
  assert.match(workflow, /2,12,22,32,42,52 7-23/)
  assert.match(workflow, /quarantine_background/)
  assert.match(workflow, /Exact-main protected CI/)
  assert.match(workflow, /not a proven retry-safe pre-mutation budget gate/)
  assert.doesNotMatch(workflow, /RECOVERY_DEADLINE_UTC/)
})

test("the Sep 17 hard pre-reset quarantine is one-shot, early and pinned to known-green containment", () => {
  const workflow = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  assert.doesNotMatch(workflow, /RECOVERY_DEADLINE_UTC/)
  assert.match(workflow, /utc_day.*2026-09-16/)
  assert.match(workflow, /One-shot Sep 17 pre-reset quarantine has expired/)
  assert.match(workflow, /utc_minute_of_day > 5 && utc_minute_of_day < 1375/)
  assert.match(workflow, /cron: "0 23 \* \* \*"/)
  assert.match(workflow, /SAFE_CONTAINMENT_SHA: d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce/)
  assert.match(workflow, /SAFE_CONTAINMENT_CI_RUN: "35080994110"/)
})
