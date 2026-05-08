import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const workflowText = readFileSync(".github/workflows/publish-iconoplasm-firefox.yml", "utf8")
const edgeWorkflowText = readFileSync(".github/workflows/publish-iconoplasm-edge.yml", "utf8")
const readmeText = readFileSync("iconoplasm-extension/README.md", "utf8")

test("Firefox store publish workflow stays behind the human GUI gate", () => {
  assert.match(workflowText, /workflow_dispatch:/)
  assert.match(workflowText, /human_confirmation:/)
  assert.match(workflowText, /expected_version:/)
  assert.match(workflowText, /YES, I AM A HUMAN, PUBLISH ICONOPLASM/)
  assert.match(workflowText, /Iconoplasm GUI/)
  assert.doesNotMatch(workflowText, /^on:\s*\n\s*push:/m)
})

test("Edge store publish workflow stays behind the human GUI gate", () => {
  assert.match(edgeWorkflowText, /workflow_dispatch:/)
  assert.match(edgeWorkflowText, /human_confirmation:/)
  assert.match(edgeWorkflowText, /expected_version:/)
  assert.match(edgeWorkflowText, /YES, I AM A HUMAN, PUBLISH ICONOPLASM/)
  assert.match(edgeWorkflowText, /EDGE_ADDONS_CLIENT_ID/)
  assert.match(edgeWorkflowText, /EDGE_ADDONS_API_KEY/)
  assert.match(edgeWorkflowText, /b8547df3-4156-4b56-b7dc-3752347b6794/)
  assert.match(edgeWorkflowText, /background\.service_worker/)
  assert.doesNotMatch(edgeWorkflowText, /^on:\s*\n\s*push:/m)
})

test("Edge store publish workflow expands operation IDs into documented polling URLs", () => {
  assert.match(
    edgeWorkflowText,
    /"operation_id=\$operationLocation" >> \$env:GITHUB_OUTPUT/,
    "Edge Add-ons Location headers are operation IDs, not absolute URLs",
  )
  assert.match(
    edgeWorkflowText,
    /OPERATION_ID:\s*\$\{\{ steps\.edge_upload\.outputs\.operation_id \}\}/,
    "package validation should consume the package-upload operation ID",
  )
  assert.match(
    edgeWorkflowText,
    /submissions\/draft\/package\/operations\/\$operationId/,
    "package validation must poll the documented package operation endpoint",
  )
  assert.match(
    edgeWorkflowText,
    /OPERATION_ID:\s*\$\{\{ steps\.edge_publish\.outputs\.operation_id \}\}/,
    "publish wait should consume the publish operation ID",
  )
  assert.match(
    edgeWorkflowText,
    /submissions\/operations\/\$operationId/,
    "publish wait must poll the documented publish operation endpoint",
  )
  assert.doesNotMatch(
    edgeWorkflowText,
    /Invoke-RestMethod -Uri \$env:OPERATION_LOCATION/,
    "the workflow must not try to request a bare GUID as a hostname",
  )
})

test("extension release docs point store publish at the Iconoplasm GUI", () => {
  assert.match(readmeText, /Website Ops -> Store publish/)
  assert.match(readmeText, /Firefox \+ Edge/)
  assert.match(
    readmeText,
    /do not trigger store publish from unattended CLI, LLM, scheduled job, website deploy automation, push, or cron/,
  )
  assert.match(readmeText, /Chrome Web Store publishing remains human-dashboard only/)
})
