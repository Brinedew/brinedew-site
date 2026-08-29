import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import JSZip from "jszip"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { createBuildIdentity, applyBuildIdentity } from "./lib/iconoplasm-build-identity.mjs"
import {
  ReleaseArchive,
  RELEASE_MANIFEST,
  releaseIdentity,
  releaseArtifactNames,
  createReleaseManifest,
  verifyReleaseFiles,
  assertSameZipPayload,
  sha256,
} from "./lib/iconoplasm-release-bundle.mjs"

const identity = releaseIdentity("0.5.4", "a".repeat(40))

test("CI rejects edits and deletion of published downloads but allows a new version", (t) => {
  const root = mkdtempSync(join(tmpdir(), "iconoplasm-release-history-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Release Test",
        "-c",
        "user.email=release-test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: root, timeout: 10_000, stdio: "pipe" },
    )
      .toString()
      .trim()
  git(["init"])
  const folder = join(root, "quartz/static/iconoplasm/downloads")
  mkdirSync(folder, { recursive: true })
  const old = join(folder, "iconoplasm-extension-v0.5.3.zip")
  writeFileSync(old, "published")
  git(["add", "."])
  git(["commit", "-m", "Original release"])
  const base = git(["rev-parse", "HEAD"])
  const script = fileURLToPath(new URL("./verify-iconoplasm-release-history.mjs", import.meta.url))
  const check = () =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, BASE_SHA: base },
      timeout: 15_000,
      encoding: "utf8",
    })
  writeFileSync(join(folder, "iconoplasm-extension-v0.5.4.zip"), "new")
  git(["add", "."])
  git(["commit", "-m", "Next release"])
  assert.equal(check().status, 0)
  writeFileSync(old, "replaced")
  git(["add", "."])
  git(["commit", "-m", "Invalid replacement"])
  assert.match(check().stderr, /must never be modified or deleted/)
  unlinkSync(old)
  git(["add", "."])
  git(["commit", "-m", "Invalid deletion"])
  assert.notEqual(check().status, 0)
})

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "iconoplasm-release-fixture-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const files = new Map()
  for (const name of releaseArtifactNames(identity.version)) {
    const zip = new JSZip()
    zip.file(
      name.includes("source") ? "iconoplasm-extension/manifest.json" : "manifest.json",
      JSON.stringify({ version: identity.version, name: "Iconoplasm" }),
    )
    if (!name.includes("source"))
      zip.file("build-info.json", JSON.stringify({ channel: "release", version: identity.version }))
    files.set(name, await zip.generateAsync({ type: "nodebuffer" }))
  }
  const manifest = await createReleaseManifest(identity, files)
  const state = {
    release: null,
    bytes: new Map(),
    calls: [],
    commit: identity.commit,
    immutable: true,
    corruptUpload: false,
  }
  function gh(args, input) {
    state.calls.push(args)
    if (args[0] === "api") {
      const path = args[1]
      if (path.includes("/commits/")) return JSON.stringify({ sha: state.commit })
      if (path.includes("/releases?"))
        return JSON.stringify(state.release?.draft ? [state.release] : [])
      if (args.includes("--input")) {
        const body = JSON.parse(input)
        if (args.includes("PATCH"))
          Object.assign(state.release, body, { immutable: state.immutable })
        else state.release = { id: 123, assets: [], ...body }
        return JSON.stringify(state.release)
      }
      if (!state.release) throw Object.assign(new Error("Not found"), { stderr: "HTTP 404" })
      return JSON.stringify(state.release)
    }
    if (args[1] === "upload") {
      for (const path of args.slice(args.indexOf("--clobber") + 1))
        state.bytes.set(path.split(/[\\/]/).at(-1), readFileSync(path))
      state.release.assets = [...state.bytes].map(([name, bytes]) => ({
        name,
        size: bytes.length,
        digest: `sha256:${state.corruptUpload ? "0".repeat(64) : sha256(bytes)}`,
      }))
    } else if (args[1] === "download") {
      const destination = args[args.indexOf("--dir") + 1]
      for (const [name, bytes] of state.bytes) writeFileSync(join(destination, name), bytes)
    } else throw new Error("Unexpected GitHub operation")
    return ""
  }
  return { directory, files, manifest, state, archive: new ReleaseArchive(identity, gh) }
}

test("draft releases remain discoverable before publication", async (t) => {
  const f = await fixture(t)
  f.state.release = {
    id: 123,
    tag_name: identity.tag,
    target_commitish: identity.commit,
    draft: true,
    assets: [],
  }
  assert.equal(f.archive.inspect().id, 123)
})

test("duplicate drafts are rejected instead of uploading ambiguously", async (t) => {
  const f = await fixture(t)
  const original = f.archive.api.bind(f.archive)
  f.archive.api = (path, body, method) => {
    if (path.includes("releases?"))
      return [
        { id: 123, tag_name: identity.tag, target_commitish: identity.commit, draft: true },
        { id: 456, tag_name: identity.tag, target_commitish: identity.commit, draft: true },
      ]
    return original(path, body, method)
  }
  assert.throws(() => f.archive.inspect(), /Multiple draft releases.*123, 456/)
})

test("development identity is visible, content-derived and reproducible outside Git", (t) => {
  const root = mkdtempSync(join(tmpdir(), "iconoplasm-build-id-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "content.js"), "first")
  const manifest = { name: "Iconoplasm", version: "0.5.3" }
  const first = createBuildIdentity(root, manifest, false)
  assert.deepEqual(first, createBuildIdentity(root, manifest, false))
  assert.match(applyBuildIdentity(manifest, first).name, /^Iconoplasm DEV /)
  assert.match(applyBuildIdentity(manifest, first).version_name, /^0\.5\.3-dev\./)
  writeFileSync(join(root, "content.js"), "second")
  assert.notEqual(first.payloadSha256, createBuildIdentity(root, manifest, false).payloadSha256)
  assert.deepEqual(
    applyBuildIdentity(manifest, createBuildIdentity(root, manifest, true)),
    manifest,
  )
})

test("one sealed release is reused without uploading or replacing files", async (t) => {
  const f = await fixture(t)
  f.archive.seal(f.directory, f.manifest, f.files)
  const uploads = f.state.calls.filter((x) => x[1] === "upload").length
  f.archive.seal(f.directory, f.manifest, f.files)
  assert.equal(f.state.calls.filter((x) => x[1] === "upload").length, uploads)
  assert.equal(f.state.release.draft, false)
  assert.equal(f.state.release.immutable, true)
  assert.equal(f.state.bytes.size, 5)
  assert.ok(f.state.bytes.has(RELEASE_MANIFEST))
})

test("changed bytes and changed source commits cannot reuse a sealed version", async (t) => {
  const f = await fixture(t)
  f.archive.seal(f.directory, f.manifest, f.files)
  const altered = new Map(f.files)
  const name = [...altered.keys()][0]
  altered.set(name, Buffer.concat([altered.get(name), Buffer.from("changed")]))
  assert.throws(() => f.archive.seal(f.directory, f.manifest, altered), /hash verification/)
  const otherManifest = {
    ...f.manifest,
    artifacts: f.manifest.artifacts.map((x) =>
      x.name === name
        ? { ...x, size: altered.get(name).length, sha256: sha256(altered.get(name)) }
        : x,
    ),
  }
  assert.throws(() => f.archive.seal(f.directory, otherManifest, altered), /already sealed/)
  f.state.commit = "b".repeat(40)
  assert.throws(() => f.archive.download(), /different source commit/)
})

test("interrupted draft stays unpublished and can be retried with verified bytes", async (t) => {
  const f = await fixture(t)
  f.state.corruptUpload = true
  assert.throws(
    () => f.archive.seal(f.directory, f.manifest, f.files),
    /does not match tested bytes/,
  )
  assert.equal(f.state.release.draft, true)
  f.state.corruptUpload = false
  f.archive.seal(f.directory, f.manifest, f.files)
  assert.equal(f.state.release.immutable, true)
})

test("disabled server protection and corrupt downloads block store consumption", async (t) => {
  const f = await fixture(t)
  f.state.immutable = false
  assert.throws(() => f.archive.seal(f.directory, f.manifest, f.files), /not immutable/)
  assert.throws(() => f.archive.download(), /not immutable/)
  f.state.release.immutable = true
  f.state.bytes.set([...f.files.keys()][0], Buffer.from("corrupt"))
  assert.throws(() => f.archive.download(), /hash verification/)
})

test("release manifests reject swapped identities, missing assets and development packages", async (t) => {
  const f = await fixture(t)
  assert.throws(
    () => verifyReleaseFiles(identity, { ...f.manifest, commit: "b".repeat(40) }, f.files),
    /authorized/,
  )
  assert.throws(
    () =>
      verifyReleaseFiles(
        identity,
        { ...f.manifest, artifacts: f.manifest.artifacts.slice(1) },
        f.files,
      ),
    /artifact set/,
  )
  const name = [...f.files.keys()][0]
  const zip = await JSZip.loadAsync(f.files.get(name))
  zip.file("build-info.json", JSON.stringify({ channel: "development", version: identity.version }))
  f.files.set(name, await zip.generateAsync({ type: "nodebuffer" }))
  await assert.rejects(createReleaseManifest(identity, f.files), /Development package/)
})

test("Chrome source parity compares every payload file, not ZIP timestamps", async () => {
  const first = new JSZip().file("manifest.json", "same", { date: new Date("2025-01-01") })
  const second = new JSZip().file("manifest.json", "same", { date: new Date("2026-01-01") })
  const a = await first.generateAsync({ type: "nodebuffer" })
  const b = await second.generateAsync({ type: "nodebuffer" })
  await assertSameZipPayload(a, b)
  second.file("manifest.json", "changed")
  await assert.rejects(
    assertSameZipPayload(a, await second.generateAsync({ type: "nodebuffer" })),
    /differs from/,
  )
})
