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

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

export function readIconoplasmPublisherAuthority(repoRoot) {
  const authorityPath = resolve(repoRoot, "iconoplasm-extension", "publisher-release.json")
  const candidatePath = resolve(repoRoot, "iconoplasm-extension", "candidate-contract.json")
  const authority = readJson(authorityPath, "Iconoplasm publisher authority")
  const candidate = readJson(candidatePath, "Iconoplasm candidate contract")
  if (Number(authority.schema_version) !== 1) {
    throw new Error(
      `Unsupported publisher authority schema ${JSON.stringify(authority.schema_version)}`,
    )
  }
  if (authority.declared_by !== "iconoplasm-gui-human-release") {
    throw new Error("Publisher authority was not declared by the human-gated Iconoplasm GUI")
  }
  const version = requireVersion(authority.version, "Publisher authority version")
  const nextReleaseVersion = authority.next_release_version
    ? requireVersion(authority.next_release_version, "Publisher authority next release version")
    : null
  if (nextReleaseVersion && compareVersions(nextReleaseVersion, version) <= 0) {
    throw new Error(
      `Publisher authority next release ${nextReleaseVersion} must be newer than ${version}`,
    )
  }
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
  const candidateSchemaVersion = Number(candidate.catalog_schema_version)
  const candidateContractRevision = Number(candidate.catalog_contract_revision)
  const candidateScannerSchemaVersion = Number(candidate.scanner_schema_version)
  const candidateScannerContractRevision = Number(candidate.scanner_contract_revision)
  if (
    Number(candidate.schema_version) !== 1 ||
    !Number.isInteger(candidateSchemaVersion) ||
    candidateSchemaVersion < 1 ||
    !Number.isInteger(candidateContractRevision) ||
    candidateContractRevision < 1 ||
    !Number.isInteger(candidateScannerSchemaVersion) ||
    candidateScannerSchemaVersion < 1 ||
    !Number.isInteger(candidateScannerContractRevision) ||
    candidateScannerContractRevision < 1
  ) {
    throw new Error("Iconoplasm candidate contract is invalid")
  }
  if (
    candidateSchemaVersion < contractSchemaVersion ||
    (candidateSchemaVersion === contractSchemaVersion &&
      candidateContractRevision < contractRevision)
  ) {
    throw new Error(
      `Candidate catalog contract ${candidateSchemaVersion}.${candidateContractRevision} is older than human publisher authority ${contractSchemaVersion}.${contractRevision}`,
    )
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
    candidate,
    candidatePath,
    version,
    nextReleaseVersion,
    minimumSupportedVersion,
    contractSchemaVersion,
    contractRevision,
    candidateScannerSchemaVersion,
    candidateScannerContractRevision,
    compatibilityContracts,
  }
}

export function renderIconoplasmCatalogContractRuntime(release) {
  return [
    "/* GENERATED FILE. Edit iconoplasm-extension/candidate-contract.json and publisher-release.json, then rerun pnpm run sync:iconoplasm-shared. */",
    "globalThis.IconoplasmCatalogContract = Object.freeze({",
    "  schemaVersion: 1,",
    '  publicApiVersion: "v1",',
    "  catalog: Object.freeze({",
    `    schemaVersion: ${release.contractSchemaVersion},`,
    `    revision: ${release.contractRevision},`,
    "  }),",
    "  scanner: Object.freeze({",
    `    schemaVersion: ${release.candidateScannerSchemaVersion},`,
    `    revision: ${release.candidateScannerContractRevision},`,
    "  }),",
    "  extension: Object.freeze({",
    `    version: ${JSON.stringify(release.version)},`,
    `    minimumSupportedVersion: ${JSON.stringify(release.minimumSupportedVersion)},`,
    "  }),",
    "})",
    "",
  ].join("\n")
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
