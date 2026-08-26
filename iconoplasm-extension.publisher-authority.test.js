import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  assertIconoplasmPublisherAuthority,
  renderIconoplasmCatalogContractRuntime,
} from "./scripts/lib/iconoplasm-publisher-authority.mjs"

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function compareReleaseVersions(left, right) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

test("human publisher authority owns every published extension version surface", () => {
  const authority = readJson("iconoplasm-extension/publisher-release.json")
  const manifest = readJson("iconoplasm-extension/manifest.json")
  const publicRelease = readJson("quartz/static/iconoplasm/extension-release.json")
  const popup = readFileSync("iconoplasm-extension/popup.html", "utf8")
  const popupRuntime = readFileSync("iconoplasm-extension/popup.js", "utf8")

  const verified = assertIconoplasmPublisherAuthority(process.cwd(), {
    expectedVersion: authority.version,
  })
  assert.equal(verified.version, authority.version)
  assert.equal(verified.nextReleaseVersion, authority.next_release_version ?? null)
  assert.equal(verified.minimumSupportedVersion, authority.minimum_supported_version)
  assert.deepEqual(verified.compatibilityContracts, authority.compatibility_contracts)
  assert.equal(manifest.version, authority.version)
  assert.equal(publicRelease.version, authority.version)
  assert.match(publicRelease.chromeDeveloperPackageUrl, new RegExp(`v${authority.version}\\.zip$`))
  assert.doesNotMatch(popup, /v\d+\.\d+\.\d+/)
  assert.match(popupRuntime, /chrome\.runtime\.getManifest\(\)\.version/)
  assert.throws(
    () => assertIconoplasmPublisherAuthority(process.cwd(), { expectedVersion: "9.9.9" }),
    /diverges from human publisher authority/,
  )
})

test("ordinary repository work has no extension version writer", () => {
  const packageJson = readJson("package.json")
  assert.equal(existsSync("scripts/bump-iconoplasm-extension-version.mjs"), false)
  assert.equal(
    Object.keys(packageJson.scripts).some((name) =>
      name.startsWith("version:iconoplasm-extension"),
    ),
    false,
  )
})

test("published and candidate extension contracts remain explicit", () => {
  const authority = readJson("iconoplasm-extension/publisher-release.json")
  const candidate = readJson("iconoplasm-extension/candidate-contract.json")
  const patchNotes = readFileSync("content/wiki/Iconoplasm Patch Notes.md", "utf8")
  const worker = readFileSync(
    "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    "utf8",
  )

  assert.ok(authority.catalog_contract.schema_version <= candidate.catalog_schema_version)
  if (authority.catalog_contract.schema_version === candidate.catalog_schema_version) {
    assert.ok(authority.catalog_contract.revision <= candidate.catalog_contract_revision)
  }
  assert.equal(candidate.extension_blocklist_schema_version, 1)
  assert.equal(candidate.extension_blocklist_contract_revision, 1)
  assert.ok(Object.keys(authority.compatibility_contracts).length <= 1)
  assert.match(patchNotes, /^## Unreleased$/m)
  const publishedHeadings = [...patchNotes.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map(
    (match) => match[1],
  )
  assert.ok(
    publishedHeadings.includes(authority.version),
    `Patch notes must contain the authoritative release ${authority.version}`,
  )
  assert.deepEqual(
    publishedHeadings.filter((version) => compareReleaseVersions(version, authority.version) > 0),
    [],
    `Patch notes must not declare a release newer than publisher authority ${authority.version}`,
  )
  assert.match(worker, /publisher-release\.json/)
  assert.match(worker, /candidate-contract\.json/)
  assert.doesNotMatch(worker, /ICONOPLASM_MIN_EXTENSION_VERSION/)
  const verified = assertIconoplasmPublisherAuthority(process.cwd())
  assert.equal(
    readFileSync("iconoplasm-extension/generated/catalog-contract.js", "utf8"),
    renderIconoplasmCatalogContractRuntime(verified),
  )
})

test("release workflows cannot mask a stale checked-in catalog contract", () => {
  const ciWorkflow = readFileSync(".github/workflows/ci.yaml", "utf8")
  const deployWorkflow = readFileSync(".github/workflows/deploy-quartz.yml", "utf8")
  const authorityTestCommand =
    "node scripts/run-tests.mjs iconoplasm-extension.publisher-authority.test.js"
  const syncCommand = "pnpm run sync:iconoplasm-shared"
  const releaseGuardName = "Verify Iconoplasm architecture and Worker budget guards"
  const ciAuthorityIndex = ciWorkflow.indexOf(authorityTestCommand)
  const ciSyncIndex = ciWorkflow.indexOf(syncCommand)
  const deploySyncIndex = deployWorkflow.indexOf(syncCommand)
  const deployGuardIndex = deployWorkflow.indexOf(releaseGuardName)

  assert.notEqual(ciAuthorityIndex, -1, "CI must run the publisher-authority test")
  assert.notEqual(ciSyncIndex, -1, "CI must retain the shared-asset sync")
  assert.ok(
    ciAuthorityIndex < ciSyncIndex,
    "CI must validate the checked-in generated contract before sync can rewrite it",
  )
  assert.notEqual(deploySyncIndex, -1, "production must sync shared assets")
  assert.notEqual(deployGuardIndex, -1, "production must retain the focused release guard")
  assert.ok(
    deploySyncIndex < deployGuardIndex,
    "production must sync the generated contract before the focused release guard",
  )
})
