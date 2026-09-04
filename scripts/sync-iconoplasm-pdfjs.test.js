import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { syncIconoplasmPdfJs } from "./sync-iconoplasm-pdfjs.mjs"

const run = promisify(execFile)
const sharedRoot = fileURLToPath(
  new URL("../iconoplasm-extension/generated/pdfjs/", import.meta.url),
)
const packageRoot = fileURLToPath(new URL("../node_modules/pdfjs-dist/", import.meta.url))

async function inventory(root, timestamps = false) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const result = {}
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      result[entry.name] = await inventory(path, timestamps)
    } else {
      result[entry.name] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex")
      if (timestamps) result[`${entry.name}:mtime`] = (await stat(path)).mtimeMs
    }
  }
  return result
}

test("PDF.js synchronization requires an explicit build destination", () => {
  assert.throws(() => syncIconoplasmPdfJs(), /explicit output directory/)
})

test("concurrent PDF.js staging preserves pinned bytes without touching shared generated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "iconoplasm-pdfjs-isolation-"))
  const before = await inventory(sharedRoot, true)
  const destinations = [join(root, "firefox"), join(root, "edge")]
  const code = `import { syncIconoplasmPdfJs } from ${JSON.stringify(new URL("./sync-iconoplasm-pdfjs.mjs", import.meta.url).href)}; syncIconoplasmPdfJs(process.argv[1])`
  try {
    const outcomes = await Promise.allSettled(
      destinations.map((destination) =>
        run(process.execPath, ["--input-type=module", "-e", code, destination], {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        }),
      ),
    )
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") throw outcome.reason
    }
    const first = await inventory(destinations[0])
    assert.ok(Object.keys(first).length > 5, "the staged runtime must contain its assets")
    assert.deepEqual(await inventory(destinations[1]), first)
    for (const [source, target] of [
      ["legacy/build/pdf.mjs", "pdf.mjs"],
      ["legacy/build/pdf.worker.mjs", "pdf.worker.mjs"],
      ["legacy/web/pdf_viewer.mjs", "pdf_viewer.mjs"],
    ]) {
      assert.deepEqual(
        await readFile(join(destinations[0], target)),
        await readFile(join(packageRoot, source)),
      )
    }
    assert.deepEqual(await inventory(sharedRoot, true), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
