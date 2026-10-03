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
    "geneguessr/native-dialogs.test.js": false,
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
