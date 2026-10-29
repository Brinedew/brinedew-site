// Versioned module names and the files carried forward from earlier releases,
// run on the real browser modules. The served side (headers, the graph a
// browser walks) is in workers/iconoplasm-static-assets.workerd.test.js.
// Ways this can fail:
//  1. A changed module keeps its name, or its importers keep theirs.
//  2. A tab opened before this release asks for last release's file and gets a
//     404: the earlier file was not carried forward.
//  3. Files older than a week, or more than the room Cloudflare's file limit
//     leaves, are carried forward anyway.
//  4. A carried-forward file arrives with other bytes and is served under a
//     name that says otherwise.
//  5. A manifest entry names a path outside static/ and the build writes it.
//  6. Two modules import each other and the build names them anyway.
import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { retainEarlierModules, versionIconoplasmModules } from "./lib/iconoplasm-hashed-modules.mjs"

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"))
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

async function release(root, change) {
  await cp(
    path.join(repoRoot, "quartz", "static", "iconoplasm"),
    path.join(root, "static", "iconoplasm"),
    { recursive: true, filter: (source) => !TEST_FILE.test(source) },
  )
  if (change) await change(root)
  return versionIconoplasmModules({ outputRoot: root })
}

const quiet = { warn() {} }

test("a release carries last week's module files forward, newest first", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "iconoplasm-versions-"))
  try {
    const earlier = path.join(temporary, "earlier")
    const later = path.join(temporary, "later")
    const before = await release(earlier)
    const after = await release(later, async (root) => {
      const file = path.join(root, "static", "iconoplasm", "wiki-pageviews.js")
      await writeFile(file, `${await readFile(file, "utf8")}\n// next release\n`)
    })
    const changed = (file) => before.get(file) !== after.get(file)
    assert.ok(changed("static/iconoplasm/wiki-pageviews.js"), "the changed module is renamed")
    assert.ok(changed("static/iconoplasm/app.js"), "its importer is renamed with it")
    assert.ok(!changed("static/iconoplasm/dialog.js"), "an untouched module keeps its name")

    const now = new Date("2026-10-29T12:00:00Z")
    const yesterday = "2026-10-28T12:00:00.000Z"
    const previous = {
      modules: {
        ...Object.fromEntries([...before.values()].map((file) => [file, yesterday])),
        "static/iconoplasm/old.0123456789abcdef.js": "2026-10-20T12:00:00.000Z",
        "static/../wrangler.0123456789abcdef.js": yesterday,
      },
    }
    const fetchFile = (file) => readFile(path.join(earlier, file))
    const { modules, kept } = await retainEarlierModules({
      outputRoot: later,
      versioned: after,
      previous,
      room: 1000,
      fetchFile,
      now,
      log: quiet,
    })
    const expected = [...before.values()].filter((file) => ![...after.values()].includes(file))
    assert.deepEqual(kept.sort(), expected.sort(), "every renamed file is carried forward")
    assert.ok(kept.includes(before.get("static/iconoplasm/app.js")))
    for (const file of kept)
      assert.deepEqual(await readFile(path.join(later, file)), await fetchFile(file), file)
    assert.equal(modules[before.get("static/iconoplasm/app.js")], yesterday, "its age is kept")
    assert.equal(modules[after.get("static/iconoplasm/app.js")], now.toISOString())
    assert.equal(
      modules["static/iconoplasm/old.0123456789abcdef.js"],
      undefined,
      "8 days is too old",
    )
    await assert.rejects(stat(path.join(temporary, "wrangler.0123456789abcdef.js")))

    const tight = await retainEarlierModules({
      outputRoot: later,
      versioned: after,
      previous: {
        modules: {
          [before.get("static/iconoplasm/app.js")]: "2026-10-27T12:00:00.000Z",
          [before.get("static/iconoplasm/wiki-pageviews.js")]: yesterday,
        },
      },
      room: 1,
      fetchFile,
      now,
      log: quiet,
    })
    assert.deepEqual(tight.kept, [before.get("static/iconoplasm/wiki-pageviews.js")])

    const gone = await retainEarlierModules({
      outputRoot: later,
      versioned: after,
      previous,
      room: 1000,
      fetchFile: () => Promise.reject(new Error("HTTP 404")),
      now,
      log: quiet,
    })
    assert.deepEqual(gone.kept, [], "a file the edge no longer has is skipped, not invented")

    await assert.rejects(
      retainEarlierModules({
        outputRoot: later,
        versioned: after,
        previous,
        room: 1000,
        fetchFile: async () => Buffer.from("other bytes"),
        now,
        log: quiet,
      }),
      /does not match the hash in its name/,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("modules that import each other are refused, not named", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "iconoplasm-loop-"))
  try {
    await mkdir(path.join(root, "static", "iconoplasm"), { recursive: true })
    await writeFile(path.join(root, "static", "iconoplasm", "a.js"), `import "./b.js?v=0"\n`)
    await writeFile(path.join(root, "static", "iconoplasm", "b.js"), `import "./a.js?v=0"\n`)
    await assert.rejects(
      versionIconoplasmModules({ outputRoot: root }),
      /import each other in a loop/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
