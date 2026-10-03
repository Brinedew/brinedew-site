import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Static } from "./static"
import { BuildCtx } from "../../util/ctx"

// B-905: the Static emitter copies quartz/static/** into the site, and that copy
// is the Iconoplasm Static Assets bundle's source. Tests sit beside the browser
// modules they cover, so a copy-everything emitter publishes them (24 files of
// the bundle's 20,000-file cap, and the test code, on the open web).
//
// Ways this can fail, written before the fix:
// 1. A test file is emitted, at the top of a folder or nested under vendor/.
// 2. The filter is too wide and drops a real asset whose name only contains
//    "test" (latest.js, contest.css), so a shipped module disappears.
// 3. The filter replaces the vault's ignorePatterns instead of adding to them.
test("the Static emitter publishes assets and never test files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "static-emitter-"))
  const cwd = process.cwd()
  const files: Record<string, boolean> = {
    "iconoplasm/app.js": true,
    "iconoplasm/app.test.js": false,
    "iconoplasm/latest.js": true,
    "iconoplasm/contest.css": true,
    "iconoplasm/fonts/a.woff2": true,
    "iconoplasm/vendor/inner/widget.test.mjs": false,
    "geneguessr/dialogs.test.js": false,
    "shared/sidebar.spec.ts": false,
    "shared/sidebar.test.json": true,
    "private/secret.js": false,
  }
  try {
    for (const name of Object.keys(files)) {
      const file = path.join(root, "quartz", "static", name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, "x")
    }
    process.chdir(root)
    const output = path.join(root, "public")
    const ctx = {
      argv: { output },
      cfg: { configuration: { ignorePatterns: ["private"] } },
    } as unknown as BuildCtx
    const emitted: string[] = []
    const emit = Static().emit(ctx, [], {} as never) as AsyncGenerator<string>
    for await (const dest of emit) {
      emitted.push(path.relative(path.join(output, "static"), dest).split(path.sep).join("/"))
    }
    const expected = Object.keys(files)
      .filter((name) => files[name])
      .sort()
    assert.deepEqual(emitted.sort(), expected)
    for (const name of expected) {
      assert.ok(fs.existsSync(path.join(output, "static", name)), `${name} was copied`)
    }
    assert.equal(fs.existsSync(path.join(output, "static", "iconoplasm", "app.test.js")), false)
  } finally {
    process.chdir(cwd)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// B-932: quartz/static/iconoplasm/downloads holds the extension packages the GUI
// release transaction commits, one per release. The site offers exactly one
// manual-install download, the one extension-release.json names; every other
// zip is a file of the Iconoplasm bundle's 20,000-file cap and about 3.5 MB
// nobody downloads. This emitter decides what quartz/static publishes, so it is
// where an unreferenced package stops.
//
// Ways this can fail, written before the fix:
// 1. A zip the metadata does not name is emitted (an old version, or the
//    predecessor once the next release adds its own file).
// 2. The filter is too wide: it drops the named zip, a zip outside
//    iconoplasm/downloads/, or matches by prefix so v0.5.9 also publishes
//    v0.5.90.
// 3. The metadata is missing, unreadable, names a path outside downloads/, or
//    names a file that is not there, and the build ships a live download
//    button with no package behind it instead of failing.
async function emitStatic(files: Record<string, string>): Promise<string[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "static-emitter-downloads-"))
  const cwd = process.cwd()
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(root, "quartz", "static", name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
    process.chdir(root)
    const ctx = {
      argv: { output: path.join(root, "public") },
      cfg: { configuration: { ignorePatterns: [] } },
    } as unknown as BuildCtx
    const emitted: string[] = []
    const emit = Static().emit(ctx, [], {} as never) as AsyncGenerator<string>
    for await (const dest of emit) {
      emitted.push(
        path
          .relative(path.join(root, "public", "static"), dest)
          .split(path.sep)
          .join("/"),
      )
    }
    return emitted.sort()
  } finally {
    process.chdir(cwd)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

const releaseJson = (name: string) =>
  JSON.stringify({
    version: "0.5.9",
    chromeDeveloperPackageUrl: `/static/iconoplasm/downloads/${name}`,
  })

test("the Static emitter publishes only the extension package the release metadata names", async () => {
  const emitted = await emitStatic({
    "iconoplasm/app.js": "x",
    "iconoplasm/extension-release.json": releaseJson("iconoplasm-extension-v0.5.9.zip"),
    "iconoplasm/downloads/iconoplasm-extension-v0.5.9.zip": "current",
    "iconoplasm/downloads/iconoplasm-extension-v0.5.8.zip": "predecessor",
    "iconoplasm/downloads/iconoplasm-extension-v0.5.90.zip": "prefix lookalike",
    "iconoplasm/downloads/iconoplasm-extension-v0.4.1.zip": "old",
    "iconoplasm/vendor/other-library.zip": "not an extension package",
    "geneguessr/sample-data.zip": "another app's zip",
  })
  assert.deepEqual(emitted, [
    "geneguessr/sample-data.zip",
    "iconoplasm/app.js",
    "iconoplasm/downloads/iconoplasm-extension-v0.5.9.zip",
    "iconoplasm/extension-release.json",
    "iconoplasm/vendor/other-library.zip",
  ])
})

test("the Static emitter fails the build when the release metadata cannot name a present package", async () => {
  const zip = "iconoplasm/downloads/iconoplasm-extension-v0.5.9.zip"
  await assert.rejects(
    emitStatic({ [zip]: "current" }),
    /extension-release\.json/,
    "a package with no metadata to name it",
  )
  await assert.rejects(
    emitStatic({ [zip]: "current", "iconoplasm/extension-release.json": "{not json" }),
    /extension-release\.json/,
    "unreadable metadata",
  )
  await assert.rejects(
    emitStatic({
      [zip]: "current",
      "iconoplasm/extension-release.json": JSON.stringify({ version: "0.5.9" }),
    }),
    /chromeDeveloperPackageUrl/,
    "metadata with no package URL",
  )
  await assert.rejects(
    emitStatic({
      [zip]: "current",
      "iconoplasm/extension-release.json": JSON.stringify({
        chromeDeveloperPackageUrl: "/static/iconoplasm/vendor/iconoplasm-extension-v0.5.9.zip",
      }),
    }),
    /downloads/,
    "a URL outside the downloads folder",
  )
  await assert.rejects(
    emitStatic({
      [zip]: "current",
      "iconoplasm/extension-release.json": releaseJson("iconoplasm-extension-v0.6.0.zip"),
    }),
    /iconoplasm-extension-v0\.6\.0\.zip/,
    "metadata naming a package that is not in the tree",
  )
})
