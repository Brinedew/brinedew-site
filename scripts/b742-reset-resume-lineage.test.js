import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const workflow = readFileSync(
  new URL("../.github/workflows/retry-production-after-d1-reset.yml", import.meta.url),
  "utf8",
)

test("Sep 17 controller can recover a proven reader-recovery transition with no retained origin", () => {
  const failedStep = '"Read installed schema-transition state and reader headroom")'
  const start = workflow.indexOf(failedStep)
  assert.ok(start >= 0, "the no-origin recovery branch must be explicit")
  const recovery = workflow.slice(start, workflow.indexOf("              *)", start))

  assert.match(recovery, /workers\/scripts\/\$\{CLOUDFLARE_SCRIPT_NAME\}\/settings/)
  assert.match(recovery, /ICONOPLASM_SCHEMA_TRANSITION/)
  assert.match(recovery, /ICONOPLASM_SCHEMA_TRANSITION_MODE/)
  assert.match(recovery, /reader-recovery/)
  assert.match(recovery, /ICONOPLASM_MIGRATION_ORIGIN_RUN_ID/)
  assert.match(recovery, /resume_run_id="\$\{latest_failed_run_id\}"/)
})

test("resume id is passed only as an explicit workflow-dispatch input", () => {
  assert.match(workflow, /dispatch_resume_args=\(\)/)
  assert.match(workflow, /inputs\[resume_run_id\]=\$\{resume_run_id\}/)
  assert.match(workflow, /"\$\{dispatch_resume_args\[@\]\}"/)
  assert.match(workflow, /-f ref=main/)
})

test("unsafe post-mutation failures still stop automatic retry", () => {
  assert.match(workflow, /This is not a proven retry-safe pre-mutation budget gate/)
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf('"Apply reviewed D1 migrations through prediction admission"')),
    /resume_run_id="\$\{latest_failed_run_id\}"/,
  )
})
