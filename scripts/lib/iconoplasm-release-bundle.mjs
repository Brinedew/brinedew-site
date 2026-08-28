import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import JSZip from "jszip"

export const RELEASE_REPOSITORY = "Brinedew/brinedew-site"
export const RELEASE_MANIFEST = "iconoplasm-release.json"
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

export function releaseIdentity(version, commit) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Release requires an exact version and full source commit SHA")
  return { version, commit, tag: `iconoplasm-v${version}` }
}

export function releaseArtifactNames(version) {
  return [
    `iconoplasm-extension-v${version}.zip`,
    `iconoplasm-firefox-v${version}.zip`,
    `iconoplasm-firefox-source-v${version}.zip`,
    `iconoplasm-edge-v${version}.zip`,
  ]
}

export async function createReleaseManifest(identity, files) {
  const artifacts = []
  for (const name of releaseArtifactNames(identity.version)) {
    const bytes = files.get(name)
    if (!Buffer.isBuffer(bytes)) throw new Error(`Missing release artifact ${name}`)
    const zip = await JSZip.loadAsync(bytes)
    const source = name.includes("firefox-source")
    const manifest = JSON.parse(
      await zip
        .file(source ? "iconoplasm-extension/manifest.json" : "manifest.json")
        ?.async("string"),
    )
    if (manifest.version !== identity.version) throw new Error(`Wrong package version: ${name}`)
    if (!source) {
      const build = JSON.parse(await zip.file("build-info.json")?.async("string"))
      if (
        build.channel !== "release" ||
        build.version !== identity.version ||
        /\bDEV\b/.test(manifest.name)
      )
        throw new Error(`Development package cannot be released: ${name}`)
    }
    artifacts.push({ name, size: bytes.length, sha256: sha256(bytes) })
  }
  return { schemaVersion: 1, repository: RELEASE_REPOSITORY, ...identity, artifacts }
}

export function verifyReleaseFiles(identity, manifest, files) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== RELEASE_REPOSITORY ||
    manifest.version !== identity.version ||
    manifest.commit !== identity.commit ||
    manifest.tag !== identity.tag
  )
    throw new Error("Release manifest does not match the authorized version/source commit")
  const expected = releaseArtifactNames(identity.version).sort()
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expected))
    throw new Error("Release files have an unexpected artifact set")
  if (
    !Array.isArray(manifest.artifacts) ||
    JSON.stringify(manifest.artifacts.map((x) => x.name).sort()) !== JSON.stringify(expected)
  )
    throw new Error("Release manifest has an unexpected artifact set")
  for (const item of manifest.artifacts) {
    const bytes = files.get(item.name)
    if (!Buffer.isBuffer(bytes) || bytes.length !== item.size || sha256(bytes) !== item.sha256)
      throw new Error(`Release artifact failed size/hash verification: ${item.name}`)
  }
}

export async function assertSameZipPayload(expectedBytes, actualBytes) {
  const expected = await JSZip.loadAsync(expectedBytes)
  const actual = await JSZip.loadAsync(actualBytes)
  const names = (zip) =>
    Object.keys(zip.files)
      .filter((n) => !zip.files[n].dir)
      .sort()
  if (JSON.stringify(names(expected)) !== JSON.stringify(names(actual)))
    throw new Error("Committed Chrome package has different files from the release source")
  for (const name of names(expected)) {
    if (
      !(await expected.file(name).async("nodebuffer")).equals(
        await actual.file(name).async("nodebuffer"),
      )
    )
      throw new Error(`Committed Chrome package differs from the release source: ${name}`)
  }
}

function runGh(args, input) {
  return execFileSync("gh", args, {
    input,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2_000_000,
    stdio: ["pipe", "pipe", "pipe"],
  })
}

// Remote immutability, not the presence of a ZIP in one runner, owns release identity.
export class ReleaseArchive {
  constructor(identity, gh = runGh) {
    this.identity = identity
    this.gh = gh
  }
  api(path, body, method) {
    const args = ["api", `repos/${RELEASE_REPOSITORY}/${path}`]
    if (body) args.push("--method", method || "POST", "--input", "-")
    const text = this.gh(args, body ? JSON.stringify(body) : undefined)
    return text.trim() ? JSON.parse(text) : null
  }
  inspect() {
    const commit = this.api(`commits/${this.identity.tag}`)
    if (commit.sha !== this.identity.commit)
      throw new Error("Release tag points to a different source commit")
    let release
    try {
      release = this.api(`releases/tags/${this.identity.tag}`)
    } catch (error) {
      if (String(error.stderr).includes("HTTP 404")) return null
      throw error
    }
    if (
      release.tag_name !== this.identity.tag ||
      (release.draft && release.target_commitish !== this.identity.commit)
    )
      throw new Error("Existing release belongs to a different source identity")
    if (!release.draft && !release.immutable) throw new Error("Published release is not immutable")
    return release
  }
  download() {
    const release = this.inspect()
    if (!release || release.draft) throw new Error("The release has not been sealed")
    const names = [RELEASE_MANIFEST, ...releaseArtifactNames(this.identity.version)]
    if (
      JSON.stringify(release.assets.map((x) => x.name).sort()) !== JSON.stringify([...names].sort())
    )
      throw new Error("Immutable release has an unexpected asset set")
    const directory = mkdtempSync(join(tmpdir(), "iconoplasm-sealed-release-"))
    try {
      this.gh([
        "release",
        "download",
        this.identity.tag,
        "--repo",
        RELEASE_REPOSITORY,
        "--dir",
        directory,
        ...names.flatMap((name) => ["--pattern", name]),
      ])
      const manifest = JSON.parse(readFileSync(join(directory, RELEASE_MANIFEST), "utf8"))
      const files = new Map(
        names.slice(1).map((name) => [name, readFileSync(join(directory, name))]),
      )
      verifyReleaseFiles(this.identity, manifest, files)
      return { manifest, files }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  seal(directory, manifest, files) {
    verifyReleaseFiles(this.identity, manifest, files)
    // The GUI checks the admin-only repository setting before dispatch. CI uses
    // only contents permission and verifies the resulting immutable release;
    // if an administrator disables the setting, no store job receives files.
    let release = this.inspect()
    if (release && !release.draft) {
      const existing = this.download()
      if (JSON.stringify(existing.manifest) !== JSON.stringify(manifest))
        throw new Error("This version is already sealed with different artifact bytes")
      return existing
    }
    if (!release)
      release = this.api("releases", {
        tag_name: this.identity.tag,
        target_commitish: this.identity.commit,
        name: `Iconoplasm ${this.identity.version}`,
        draft: true,
        body: "Exact tested extension bundles. Browser-store review and propagation are separate.",
      })
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
    const uploads = new Map([...files, [RELEASE_MANIFEST, manifestBytes]])
    if (release.assets.some((x) => !uploads.has(x.name)))
      throw new Error("Draft contains unrelated assets")
    mkdirSync(directory, { recursive: true })
    for (const [name, bytes] of uploads) writeFileSync(join(directory, name), bytes)
    // Only drafts can be replaced. A published release never enters this branch.
    this.gh([
      "release",
      "upload",
      this.identity.tag,
      "--repo",
      RELEASE_REPOSITORY,
      "--clobber",
      ...[...uploads.keys()].map((name) => join(directory, name)),
    ])
    release = this.inspect()
    for (const [name, bytes] of uploads) {
      const asset = release.assets.find((x) => x.name === name)
      if (asset?.size !== bytes.length || asset?.digest !== `sha256:${sha256(bytes)}`)
        throw new Error(`Uploaded release asset does not match tested bytes: ${name}`)
    }
    if (!release.draft) throw new Error("Release changed while preparing it")
    this.api(`releases/${release.id}`, { draft: false, make_latest: "false" }, "PATCH")
    return this.download()
  }
}
