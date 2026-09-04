import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { syncStaticImportVersions, syncStudioImportVersions } from "./static-import-versions.mjs"

const files = [
  "app.js",
  "diagram-studio.js",
  "diagram-document.js",
  "diagram-x6-editor.js",
  "generated/x6-runtime.js",
]

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "studio-cache-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "iconoplasm/generated"), { recursive: true })
  for (const file of files) {
    await copyFile(
      new URL(`../../quartz/static/iconoplasm/${file}`, import.meta.url),
      path.join(root, "iconoplasm", file),
    )
  }
  return root
}

async function snapshot(root) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        await readFile(path.join(root, "iconoplasm", file), "utf8"),
      ]),
    ),
  )
}

for (const leaf of ["diagram-document.js", "generated/x6-runtime.js"]) {
  test(`editing ${leaf} invalidates the Studio entry import without manual keys`, async (t) => {
    const root = await fixture(t)
    await syncStudioImportVersions(root)
    const before = await snapshot(root)
    await writeFile(path.join(root, "iconoplasm", leaf), before[leaf] + "\n// changed leaf\n")
    await syncStudioImportVersions(root)
    const after = await snapshot(root)
    assert.notEqual(after["app.js"], before["app.js"])
    assert.notEqual(after["diagram-studio.js"], before["diagram-studio.js"])
    const studioHash = createHash("sha256")
      .update(after["diagram-studio.js"])
      .digest("hex")
      .slice(0, 16)
    assert.ok(after["app.js"].includes(`./diagram-studio.js?v=${studioHash}`))
    if (leaf.startsWith("generated/"))
      assert.notEqual(after["diagram-x6-editor.js"], before["diagram-x6-editor.js"])
    const appFile = path.join(root, "iconoplasm/app.js")
    const modified = (await stat(appFile)).mtimeMs
    await syncStudioImportVersions(root)
    assert.deepEqual(await snapshot(root), after)
    assert.equal(
      (await stat(appFile)).mtimeMs,
      modified,
      "unchanged build does not rewrite sources",
    )
  })
}

test("missing consumer imports fail instead of silently leaving stale URLs", async (t) => {
  const root = await fixture(t)
  await assert.rejects(
    syncStaticImportVersions(root, "iconoplasm/diagram-document.js", ["iconoplasm/app.js"]),
    /Unable to synchronize/,
  )
})
