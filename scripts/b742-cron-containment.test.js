import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"

const readWorkflow = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")

test("recovery uploads contain cron work while normal activation restores the owned schedule", () => {
  const workflow = parse(readWorkflow("deploy-quartz.yml"))
  const cutover = readFileSync(
    new URL("./prepare-iconoplasm-public-read-cutover.mjs", import.meta.url),
    "utf8",
  )
  const uploads = workflow.jobs["deploy-production"].steps.filter(
    (step) =>
      (step.run?.includes("pnpm exec wrangler deploy") ||
        step.run?.includes("node scripts/deploy-iconoplasm-reader-recovery.mjs")) &&
      (step.run.includes("--config wrangler.the-only-allowed-internal-stateful-worker") ||
        step.run.includes("--config wrangler.iconoplasm-schema-transition.generated.toml")),
  )
  assert.equal(uploads.length, 3)
  const conditional = uploads.filter((step) => step.if)
  assert.deepEqual(conditional.map((step) => step.if).sort(), [
    "steps.migrations.outputs.continuation_required != 'true'",
    "steps.release-state.outputs.schema_transition != 'true'",
    "steps.release-state.outputs.schema_transition == 'true'",
  ])
  assert.equal(
    uploads.filter((step) => step.if === "steps.migrations.outputs.continuation_required != 'true'")
      .length,
    1,
  )
  const containment = '--triggers "55 23 * * *" "3 0 * * *" "6 12 * * *"'
  const normalActivation = uploads.find(
    (step) => step.if === "steps.migrations.outputs.continuation_required != 'true'",
  )
  assert.ok(normalActivation, "normal activation upload")
  assert.doesNotMatch(normalActivation.run, /--triggers\b/)
  for (const step of uploads.filter((step) => step !== normalActivation)) {
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
  assert.equal(
    (cutover.match(/"--triggers",\s*"55 23 \* \* \*",\s*"3 0 \* \* \*",\s*"6 12 \* \* \*"/g) || [])
      .length,
    0,
    "public-read cutover deploys must retain the checked-in full production schedule",
  )
})

test("the Sep 17 hard pre-reset quarantine is one-shot, early and pinned to known-green containment", () => {
  const workflow = readWorkflow("b742-hard-pre-reset-d1-quarantine.yml")
  assert.doesNotMatch(workflow, /RECOVERY_DEADLINE_UTC/)
  assert.match(workflow, /utc_day.*2026-09-16/)
  assert.match(workflow, /One-shot Sep 17 pre-reset quarantine has expired/)
  assert.match(workflow, /utc_minute_of_day > 5 && utc_minute_of_day < 1375/)
  assert.match(workflow, /SAFE_CONTAINMENT_SHA: d00ae8e39bb5c2115c5a70d42a8ca76fc84127ce/)
  assert.match(workflow, /SAFE_CONTAINMENT_CI_RUN: "35080994110"/)
})
