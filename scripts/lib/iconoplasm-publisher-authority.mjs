import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error.message}`)
  }
}

function requireVersion(value, label) {
  const version = String(value || "").trim()
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`${label} must be an x.y.z version; received ${JSON.stringify(value)}`)
  }
  return version
}

export function readIconoplasmPublisherAuthority(repoRoot) {
  const authorityPath = resolve(repoRoot, "iconoplasm-extension", "publisher-release.json")
  const authority = readJson(authorityPath, "Iconoplasm publisher authority")
  if (Number(authority.schema_version) !== 1) {
    throw new Error(
      `Unsupported publisher authority schema ${JSON.stringify(authority.schema_version)}`,
    )
  }
  if (authority.declared_by !== "iconoplasm-gui-human-release") {
    throw new Error("Publisher authority was not declared by the human-gated Iconoplasm GUI")
  }
  const version = requireVersion(authority.version, "Publisher authority version")
  const minimumSupportedVersion = requireVersion(
    authority.minimum_supported_version,
    "Publisher authority minimum supported version",
  )
  const contractSchemaVersion = Number(authority.catalog_contract?.schema_version)
  const contractRevision = Number(authority.catalog_contract?.revision)
  if (!Number.isInteger(contractSchemaVersion) || contractSchemaVersion < 1) {
    throw new Error("Publisher authority catalog schema must be a positive integer")
  }
  if (!Number.isInteger(contractRevision) || contractRevision < 1) {
    throw new Error("Publisher authority catalog revision must be a positive integer")
  }
  const compatibilityContracts = authority.compatibility_contracts
  if (!compatibilityContracts || typeof compatibilityContracts !== "object") {
    throw new Error("Publisher authority compatibility contracts must be an object")
  }
  for (const [compatibilityVersion, contract] of Object.entries(compatibilityContracts)) {
    requireVersion(compatibilityVersion, "Compatibility contract version")
    if (
      !Number.isInteger(Number(contract?.schema_version)) ||
      Number(contract.schema_version) < 1 ||
      !Number.isInteger(Number(contract?.revision)) ||
      Number(contract.revision) < 1
    ) {
      throw new Error(`Compatibility contract ${compatibilityVersion} is invalid`)
    }
  }
  const compatibilityVersions = Object.keys(compatibilityContracts)
  if (minimumSupportedVersion === version && compatibilityVersions.length !== 0) {
    throw new Error("Publisher authority must not retain compatibility contracts without a rollout")
  }
  if (
    minimumSupportedVersion !== version &&
    (compatibilityVersions.length !== 1 || compatibilityVersions[0] !== minimumSupportedVersion)
  ) {
    throw new Error(
      "Publisher authority must retain exactly the minimum supported version during a rollout",
    )
  }
  return {
    authority,
    authorityPath,
    version,
    minimumSupportedVersion,
    contractSchemaVersion,
    contractRevision,
    compatibilityContracts,
  }
}

export function assertIconoplasmPublisherAuthority(repoRoot, { expectedVersion } = {}) {
  const release = readIconoplasmPublisherAuthority(repoRoot)
  const manifestPath = resolve(repoRoot, "iconoplasm-extension", "manifest.json")
  const manifest = readJson(manifestPath, "Iconoplasm extension manifest")
  const manifestVersion = requireVersion(manifest.version, "Extension manifest version")
  if (manifestVersion !== release.version) {
    throw new Error(
      `Extension manifest ${manifestVersion} diverges from human publisher authority ${release.version}`,
    )
  }
  if (expectedVersion != null) {
    const expected = requireVersion(expectedVersion, "Expected publisher version")
    if (expected !== release.version) {
      throw new Error(
        `Requested version ${expected} diverges from human publisher authority ${release.version}`,
      )
    }
  }
  return { ...release, manifest, manifestPath }
}
