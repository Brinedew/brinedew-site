import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"

// Content identity works in both Git checkouts and the standalone AMO source archive.
export function createBuildIdentity(root, manifest, release, buildConfiguration = {}) {
  const hash = createHash("sha256").update(JSON.stringify(manifest))
  hash.update(JSON.stringify(buildConfiguration))
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const bytes = readFileSync(path)
        hash.update(relative(root, path).replaceAll("\\", "/") + "\0" + bytes.length + "\0")
        hash.update(bytes)
      } else throw new Error("Build payload must contain only regular files and directories")
    }
  }
  visit(root)
  return {
    schemaVersion: 1,
    channel: release ? "release" : "development",
    version: manifest.version,
    payloadSha256: hash.digest("hex"),
  }
}

export function applyBuildIdentity(manifest, identity) {
  if (
    !identity ||
    !/^[a-f0-9]{64}$/.test(identity.payloadSha256) ||
    identity.version !== manifest.version ||
    !["release", "development"].includes(identity.channel)
  ) {
    throw new Error("Package build identity is missing or invalid; use the package command")
  }
  if (identity.channel === "release") return manifest
  const label = `${manifest.version}-dev.${identity.payloadSha256.slice(0, 12)}`
  return {
    ...manifest,
    name: `Iconoplasm DEV ${identity.payloadSha256.slice(0, 12)}`,
    version_name: label,
    description: `Unreleased development build ${label}. ${manifest.description || ""}`.slice(
      0,
      132,
    ),
  }
}
