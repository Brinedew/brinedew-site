import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import vm from "node:vm"

import JSZip from "jszip"

const workflowText = readFileSync(".github/workflows/publish-iconoplasm-firefox.yml", "utf8")
const edgeWorkflowText = readFileSync(".github/workflows/publish-iconoplasm-edge.yml", "utf8")
const readmeText = readFileSync("iconoplasm-extension/README.md", "utf8")
const firefoxSourcePackageText = readFileSync(
  "scripts/package-iconoplasm-firefox-source.mjs",
  "utf8",
)
const amoSourceReadmeText = readFileSync("iconoplasm-extension/AMO-SOURCE-README.md", "utf8")
function quoteWindowsCommandArg(arg) {
  return /[\s"&|<>^]/u.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg
}

function runPnpm(args, cwd, timeout = 180_000) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `pnpm ${args.map(quoteWindowsCommandArg).join(" ")}`]
      : args
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    timeout,
  })
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.slice(-8_000)
  assert.equal(
    result.status,
    0,
    `pnpm ${args.join(" ")} failed${result.error ? `: ${result.error.message}` : ""}:\n${output}`,
  )
  return result
}

async function extractZip(zipPath, destination) {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  for (const entry of Object.values(zip.files)) {
    const outputPath = path.join(destination, entry.name)
    if (entry.dir) {
      await mkdir(outputPath, { recursive: true })
      continue
    }
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, await entry.async("nodebuffer"))
  }
}

async function zipFileContents(zipPath) {
  const zip = await JSZip.loadAsync(await readFile(zipPath))
  const files = new Map()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) files.set(name, await entry.async("nodebuffer"))
  }
  return files
}

function firstDifference(expected, actual) {
  const limit = Math.min(expected.length, actual.length)
  let offset = 0
  while (offset < limit && expected[offset] === actual[offset]) offset += 1
  const start = Math.max(0, offset - 80)
  const end = offset + 160
  return JSON.stringify({
    offset,
    expectedLength: expected.length,
    actualLength: actual.length,
    expected: expected.subarray(start, end).toString("utf8"),
    actual: actual.subarray(start, end).toString("utf8"),
  })
}

test("Firefox store publish workflow stays behind the human GUI gate", () => {
  assert.match(workflowText, /workflow_dispatch:/)
  assert.match(workflowText, /human_confirmation:/)
  assert.match(workflowText, /expected_version:/)
  assert.match(workflowText, /YES, I AM A HUMAN, PUBLISH ICONOPLASM/)
  assert.match(workflowText, /Iconoplasm GUI/)
  assert.match(workflowText, /verify-iconoplasm-publisher-authority\.mjs/)
  assert.match(workflowText, /wait-for-iconoplasm-release-ci\.mjs/)
  assert.match(
    workflowText,
    /package-iconoplasm-extension\.mjs --target=firefox --release "--expected-version=\$env:EXPECTED_VERSION"/,
  )
  assert.match(
    workflowText,
    /package-iconoplasm-firefox-source\.mjs --release "--expected-version=\$env:EXPECTED_VERSION"/,
  )
  assert.match(workflowText, /actions:\s*read/)
  assert.doesNotMatch(workflowText, /^on:\s*\n\s*push:/m)
})

test("Firefox publication also requires a certified ownership adapter", () => {
  const workflow = readFileSync(".github/workflows/publish-iconoplasm-firefox.yml", "utf8")
  const certification = JSON.parse(
    readFileSync("iconoplasm-extension/pdf-ownership-certification.json", "utf8"),
  )
  assert.match(workflow, /verify-iconoplasm-pdf-release-gate\.mjs --target=firefox/)
  assert.equal(certification.targets.chrome.store_release_ready, true)
  assert.equal(certification.targets.edge.store_release_ready, true)
  assert.equal(certification.targets.firefox.implementation_complete, true)
  assert.equal(certification.targets.firefox.store_release_ready, false)
  assert.equal(certification.targets.safari.store_release_ready, false)
})

test("Edge publication requires the same certified ownership contract", () => {
  const workflow = readFileSync(".github/workflows/publish-iconoplasm-edge.yml", "utf8")
  assert.match(workflow, /verify-iconoplasm-pdf-release-gate\.mjs --target=edge/)
})

test("Edge store publish workflow stays behind the human GUI gate", () => {
  assert.match(edgeWorkflowText, /workflow_dispatch:/)
  assert.match(edgeWorkflowText, /human_confirmation:/)
  assert.match(edgeWorkflowText, /expected_version:/)
  assert.match(edgeWorkflowText, /YES, I AM A HUMAN, PUBLISH ICONOPLASM/)
  assert.match(edgeWorkflowText, /verify-iconoplasm-publisher-authority\.mjs/)
  assert.match(edgeWorkflowText, /wait-for-iconoplasm-release-ci\.mjs/)
  assert.match(edgeWorkflowText, /actions:\s*read/)
  assert.match(edgeWorkflowText, /EDGE_ADDONS_CLIENT_ID/)
  assert.match(edgeWorkflowText, /EDGE_ADDONS_API_KEY/)
  assert.match(edgeWorkflowText, /b8547df3-4156-4b56-b7dc-3752347b6794/)
  assert.match(edgeWorkflowText, /background\.service_worker/)
  assert.match(
    edgeWorkflowText,
    /package-iconoplasm-extension\.mjs --target=edge --release "--expected-version=\$env:EXPECTED_VERSION"/,
  )
  assert.match(edgeWorkflowText, /iconoplasm-edge-v\$env:EXPECTED_VERSION\.zip/)
  assert.doesNotMatch(edgeWorkflowText, /^on:\s*\n\s*push:/m)
})

test("store publish packaging goes through WXT browser targets", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const packageScriptText = readFileSync("scripts/package-iconoplasm-extension.mjs", "utf8")
  const wxtConfigText = readFileSync("wxt.config.ts", "utf8")

  assert.match(
    packageJson.devDependencies?.wxt || "",
    /^0\.21\./,
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
    /releaseZipName:\s*`iconoplasm-safari-webext-v\$\{packageVersion\}\.zip`[\s\S]*validationZipName:\s*"iconoplasm-safari-webext-validation\.zip"/,
    "Safari validation must not masquerade as a versioned App Store release artifact",
  )
  assert.match(packageScriptText, /Release packaging requires --expected-version=X\.Y\.Z/)
  assert.match(packageScriptText, /Refusing to overwrite release artifact/)
  assert.match(wxtConfigText, /ICONOPLASM_WXT_OUT_DIR/)
  assert.match(wxtConfigText, /ICONOPLASM_WXT_ARTIFACT_TEMPLATE/)
  assert.doesNotMatch(
    packageScriptText,
    /Compress-Archive/,
    "the package script should not keep a separate PowerShell ZIP implementation after moving to WXT",
  )
  assert.match(
    wxtConfigText,
    /browser === "firefox"[\s\S]*"generated\/catalog-contract\.js"[\s\S]*"generated\/portrait-delivery-core\.js"[\s\S]*"publication-alias-overlay\.js"[\s\S]*"content-settings\.js"[\s\S]*"service-worker\.js"/,
    "WXT config should load every Firefox background-page dependency before the service worker",
  )
  assert.match(
    packageScriptText,
    /function validatePackagedBackground\(\)[\s\S]*Firefox background dependency order is invalid/,
    "packaging must validate the final Firefox manifest instead of trusting source configuration",
  )
  assert.match(
    packageScriptText,
    /const supportsPdfReader = packageTarget !== "safari"/,
    "Chrome, Edge, and Firefox should package the shared reader while Safari stays capability-gated",
  )
  assert.match(
    packageScriptText,
    /function validatePackagedPdfSurface\(\)/,
    "packaging must reject PDF-reader drift in every final browser payload",
  )
  assert.match(
    wxtConfigText,
    /browser !== "firefox"[\s\S]*delete manifest\.browser_specific_settings/,
    "WXT config should own the Chromium-target removal of Firefox-only manifest fields",
  )
})

test("release-shaped artifacts require an explicit matching publisher version", () => {
  const cases = [
    {
      args: ["./scripts/package-iconoplasm-extension.mjs", "--release"],
      expected: /Release packaging requires --expected-version=X\.Y\.Z/,
    },
    {
      args: [
        "./scripts/package-iconoplasm-extension.mjs",
        "--release",
        "--expected-version=99.0.0",
      ],
      expected: /diverges from human publisher authority/,
    },
    {
      args: ["./scripts/package-iconoplasm-firefox-source.mjs", "--release"],
      expected: /Release packaging requires --expected-version=X\.Y\.Z/,
    },
    {
      args: [
        "./scripts/package-iconoplasm-firefox-source.mjs",
        "--release",
        "--expected-version=99.0.0",
      ],
      expected: /diverges from human publisher authority/,
    },
  ]

  for (const { args, expected } of cases) {
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    })
    assert.notEqual(result.status, 0, `${args.join(" ")} should fail closed`)
    assert.match(`${result.stdout || ""}\n${result.stderr || ""}`, expected)
  }
})

test("Firefox background-page scripts boot in dependency order without importScripts", () => {
  const listeners = {
    installed: [],
    startup: [],
    message: [],
  }
  const addListener = (collection) => (listener) => collection.push(listener)
  const sandbox = {
    URL,
    chrome: {
      runtime: {
        getManifest: () => ({ version: "test" }),
        onInstalled: { addListener: addListener(listeners.installed) },
        onStartup: { addListener: addListener(listeners.startup) },
        onMessage: { addListener: addListener(listeners.message) },
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {},
        },
        session: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    },
  }
  const scripts = [
    "iconoplasm-extension/generated/catalog-contract.js",
    "iconoplasm-extension/generated/portrait-delivery-core.js",
    "iconoplasm-extension/publication-alias-overlay.js",
    "iconoplasm-extension/content-settings.js",
    "iconoplasm-extension/service-worker.js",
  ]

  vm.runInNewContext(scripts.map((path) => readFileSync(path, "utf8")).join("\n"), sandbox)

  assert.equal(sandbox.IconoplasmCatalogContract?.catalog?.schemaVersion, 5)
  assert.equal(
    typeof sandbox.IconoplasmPortraitDelivery?.normalizePortraitDeliveryPolicy,
    "function",
  )
  assert.equal(
    typeof sandbox.IconoplasmPublicationAliasOverlay?.applyPublishedAliasOverlay,
    "function",
  )
  assert.equal(listeners.installed.length, 1)
  assert.equal(listeners.startup.length, 1)
  assert.equal(listeners.message.length, 1)
})

test("Firefox reviewer source package reproduces the pnpm/WXT build", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))
  const sharedSyncText = readFileSync("scripts/sync-iconoplasm-shared.mjs", "utf8")

  assert.match(firefoxSourcePackageText, /"pnpm-lock\.yaml"/)
  assert.match(firefoxSourcePackageText, /"pnpm-workspace\.yaml"/)
  assert.match(firefoxSourcePackageText, /"iconoplasm-extension\/amo-source\/package\.json"/)
  assert.match(firefoxSourcePackageText, /"iconoplasm-extension\/amo-source\/tsconfig\.json"/)
  assert.match(firefoxSourcePackageText, /"wxt\.config\.ts"/)
  assert.match(firefoxSourcePackageText, /"iconoplasm-extension\/publication-alias-overlay\.js"/)
  assert.match(firefoxSourcePackageText, /"iconoplasm-extension\/content-settings\.js"/)
  assert.doesNotMatch(firefoxSourcePackageText, /"package-lock\.json"/)
  assert.match(amoSourceReadmeText, /pnpm install --frozen-lockfile/)
  assert.equal(
    packageJson.scripts?.["sync:iconoplasm-extension"],
    "node ./scripts/sync-iconoplasm-shared.mjs --extension-only",
  )
  assert.match(amoSourceReadmeText, /pnpm run sync:iconoplasm-extension/)
  assert.match(amoSourceReadmeText, /dist\/validation\/firefox\/iconoplasm-firefox-validation\.zip/)
  assert.match(sharedSyncText, /process\.argv\.includes\("--extension-only"\)/)
  assert.match(
    sharedSyncText,
    /if \(!extensionOnly\) \{\s*await syncSidebarShellImportVersions\(\)/,
  )
  assert.doesNotMatch(amoSourceReadmeText, /npm ci/)
})

test(
  "the extracted Firefox reviewer archive rebuilds validation without touching release artifacts",
  { timeout: 240_000 },
  async (t) => {
    const repoRoot = process.cwd()
    const version = JSON.parse(readFileSync("iconoplasm-extension/manifest.json", "utf8")).version
    const sourceZip = path.join(
      repoRoot,
      "iconoplasm-extension",
      "dist",
      "validation",
      "firefox-source",
      "iconoplasm-firefox-source-validation.zip",
    )
    const validationZip = path.join(
      repoRoot,
      "iconoplasm-extension",
      "dist",
      "validation",
      "firefox",
      "iconoplasm-firefox-validation.zip",
    )
    const releaseZip = path.join(
      repoRoot,
      "iconoplasm-extension",
      "dist",
      `iconoplasm-firefox-v${version}.zip`,
    )
    const releaseSourceZip = path.join(
      repoRoot,
      "iconoplasm-extension",
      "dist",
      `iconoplasm-firefox-source-v${version}.zip`,
    )
    const releaseSentinel = Buffer.from("release artifact sentinel\n")
    const originalReleaseZip = await readFile(releaseZip).catch(() => null)
    const originalReleaseSourceZip = await readFile(releaseSourceZip).catch(() => null)
    const extractedRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-amo-source-"))
    t.after(() => rm(extractedRoot, { recursive: true, force: true }))
    t.after(async () => {
      if (originalReleaseZip) await writeFile(releaseZip, originalReleaseZip)
      else await rm(releaseZip, { force: true })
      if (originalReleaseSourceZip) await writeFile(releaseSourceZip, originalReleaseSourceZip)
      else await rm(releaseSourceZip, { force: true })
    })
    await mkdir(path.dirname(releaseZip), { recursive: true })
    await writeFile(releaseZip, releaseSentinel)
    await writeFile(releaseSourceZip, releaseSentinel)

    runPnpm(["run", "sync:iconoplasm-extension"], repoRoot)
    runPnpm(["run", "package:iconoplasm-firefox"], repoRoot)
    runPnpm(["run", "package:iconoplasm-firefox-source"], repoRoot)
    assert.deepEqual(await readFile(releaseZip), releaseSentinel)
    assert.deepEqual(await readFile(releaseSourceZip), releaseSentinel)
    await extractZip(sourceZip, extractedRoot)

    const storeDir = runPnpm(["store", "path", "--silent"], repoRoot).stdout.trim()
    runPnpm(
      [
        "install",
        "--frozen-lockfile",
        "--offline",
        "--config.block-exotic-subdeps=false",
        "--store-dir",
        storeDir,
      ],
      extractedRoot,
    )
    runPnpm(["run", "sync:iconoplasm-extension"], extractedRoot)
    runPnpm(["run", "package:iconoplasm-firefox"], extractedRoot)

    const rebuiltZip = path.join(
      extractedRoot,
      "iconoplasm-extension",
      "dist",
      "validation",
      "firefox",
      "iconoplasm-firefox-validation.zip",
    )
    const submittedFiles = await zipFileContents(validationZip)
    const rebuiltFiles = await zipFileContents(rebuiltZip)

    assert.equal(
      [...submittedFiles.keys()].some((name) => name.startsWith("generated/pdfjs/")),
      true,
      "Firefox must ship the shared PDF.js renderer instead of deleting the capability",
    )
    for (const name of [
      "pdf-byte-store.js",
      "pdf-gecko-ownership.js",
      "pdf-gecko-redirect.js",
      "pdf-reader.mjs",
    ]) {
      assert.equal(submittedFiles.has(name), true, `Firefox package is missing ${name}`)
    }

    assert.deepEqual([...rebuiltFiles.keys()].sort(), [...submittedFiles.keys()].sort())
    for (const [name, expected] of submittedFiles) {
      const actual = rebuiltFiles.get(name)
      assert.ok(actual)
      assert.equal(
        actual.equals(expected),
        true,
        `${name} did not reproduce: ${firstDifference(expected, actual)}`,
      )
    }
  },
)

test("Firefox submission uses the locked audited publisher and sends reviewer source", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"))

  assert.equal(packageJson.devDependencies?.["publish-browser-extension"], "5.1.0")
  assert.equal(packageJson.devDependencies?.["web-ext"], undefined)
  assert.match(workflowText, /package-iconoplasm-firefox-source\.mjs --release/)
  assert.match(workflowText, /FIREFOX_SOURCES_ZIP:/)
  assert.match(workflowText, /FIREFOX_EXTENSION_ID: iconoplasm@brinedew\.bio/)
  assert.match(workflowText, /FIREFOX_CHANNEL: listed/)
  assert.match(workflowText, /pnpm exec publish-extension/)
  assert.doesNotMatch(workflowText, /unlisted/)
  assert.doesNotMatch(workflowText, /pnpm dlx/)
  assert.doesNotMatch(workflowText, /\bweb-ext\b/)
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
