import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const workflowText = readFileSync(".github/workflows/publish-iconoplasm-firefox.yml", "utf8")
const edgeWorkflowText = readFileSync(".github/workflows/publish-iconoplasm-edge.yml", "utf8")
const readmeText = readFileSync("iconoplasm-extension/README.md", "utf8")
const firefoxSourcePackageText = readFileSync(
  "scripts/package-iconoplasm-firefox-source.mjs",
  "utf8",
)
const amoSourceReadmeText = readFileSync("iconoplasm-extension/AMO-SOURCE-README.md", "utf8")

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
  assert.match(edgeWorkflowText, /package-iconoplasm-extension\.mjs --target=edge/)
  assert.match(edgeWorkflowText, /iconoplasm-edge-v\$env:EXPECTED_VERSION\.zip/)
  assert.doesNotMatch(edgeWorkflowText, /^on:\s*\n\s*push:/m)
})

test("store publish packaging goes through WXT browser targets", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const packageScriptText = readFileSync("scripts/package-iconoplasm-extension.mjs", "utf8")
  const wxtConfigText = readFileSync("wxt.config.ts", "utf8")

  assert.match(
    packageJson.devDependencies?.wxt || "",
    /^0\.20\./,
    "WXT should be an explicit dev dependency so browser-target packaging is not homegrown",
  )
  assert.match(
    packageScriptText,
    /const wxtArgs = \["exec", "wxt", "zip"/,
    "the Iconoplasm package script should delegate browser-specific ZIP creation to WXT",
  )
  assert.equal(
    packageJson.scripts?.["package:iconoplasm-safari"],
    "node ./scripts/package-iconoplasm-extension.mjs --target=safari",
    "Safari should have a first-class WXT build target even though App Store publishing is separate",
  )
  assert.match(
    packageScriptText,
    /value === "safari"/,
    "the package script should accept Safari as an explicit target",
  )
  assert.match(
    packageScriptText,
    /iconoplasm-safari-webext-v\$\{packageVersion\}\.zip/,
    "Safari packaging should produce a clearly named WebExtension artifact, not imply App Store submission",
  )
  assert.doesNotMatch(
    packageScriptText,
    /Compress-Archive/,
    "the package script should not keep a separate PowerShell ZIP implementation after moving to WXT",
  )
  assert.match(
    wxtConfigText,
    /browser === "firefox"[\s\S]*background = \{ scripts: \["publication-alias-overlay\.js", "service-worker\.js"\] \}/,
    "WXT config should load the shared alias-overlay runtime before the Firefox background script",
  )
  assert.match(
    wxtConfigText,
    /browser !== "firefox"[\s\S]*delete manifest\.browser_specific_settings/,
    "WXT config should own the Chromium-target removal of Firefox-only manifest fields",
  )
})

test("Firefox reviewer source package reproduces the pnpm/WXT build", () => {
  assert.match(firefoxSourcePackageText, /"pnpm-lock\.yaml"/)
  assert.match(firefoxSourcePackageText, /"pnpm-workspace\.yaml"/)
  assert.match(firefoxSourcePackageText, /"wxt\.config\.ts"/)
  assert.match(firefoxSourcePackageText, /"iconoplasm-extension\/publication-alias-overlay\.js"/)
  assert.doesNotMatch(firefoxSourcePackageText, /"package-lock\.json"/)
  assert.match(amoSourceReadmeText, /pnpm install --frozen-lockfile/)
  assert.doesNotMatch(amoSourceReadmeText, /npm ci/)
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
  assert.match(
    edgeWorkflowText,
    /\$body = @\{ notes = \[string\]\$env:CERTIFICATION_NOTES \} \| ConvertTo-Json/,
    "Edge publish notes must be posted as the JSON shape documented by Microsoft",
  )
  assert.match(
    edgeWorkflowText,
    /InProgressSubmission/,
    "Edge publish failures should identify the active Partner Center submission blocker",
  )
  assert.match(
    edgeWorkflowText,
    /if:\s*always\(\)[\s\S]*name: iconoplasm-edge-package/,
    "Edge ZIP evidence should be uploaded even when Microsoft blocks the publish operation",
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
  assert.match(readmeText, /Safari publishing is not another browser ZIP upload/)
  assert.match(readmeText, /pnpm run package:iconoplasm-safari/)
})
