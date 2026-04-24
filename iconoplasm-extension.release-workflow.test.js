import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const workflowText = readFileSync(".github/workflows/publish-iconoplasm-firefox.yml", "utf8")
const readmeText = readFileSync("iconoplasm-extension/README.md", "utf8")

test("Firefox store publish workflow stays behind the human GUI gate", () => {
  assert.match(workflowText, /workflow_dispatch:/)
  assert.match(workflowText, /human_confirmation:/)
  assert.match(workflowText, /YES, I AM A HUMAN, PUBLISH ICONOPLASM/)
  assert.match(workflowText, /Iconoplasm GUI/)
  assert.doesNotMatch(workflowText, /^on:\s*\n\s*push:/m)
})

test("extension release docs point store publish at the Iconoplasm GUI", () => {
  assert.match(readmeText, /Website Ops -> Store publish/)
  assert.match(readmeText, /Yes, I'm a human, publish Firefox/)
  assert.match(
    readmeText,
    /do not trigger store publish from unattended CLI, LLM, scheduled job, or website deploy automation/,
  )
  assert.match(readmeText, /Chrome Web Store publishing is still human-dashboard only/)
})
