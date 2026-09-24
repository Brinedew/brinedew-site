import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  iconoplasmGenePageHtml,
  publishedGeneEntries,
  writeIconoplasmGenePages,
} from "./prepare-iconoplasm-edge-assets.mjs"

// B-809: every published gene gets a static document whose raw HTML names that
// gene, so crawlers and unfurlers never see the shell's canonical "/".

const index = {
  schema_version: 2,
  search_entries: [
    ["TP53", "tumor protein p53", 0, 0],
    ["A1BG", "alpha-1-B glycoprotein", 0, 0],
    ["BAD<", "should be rejected", 0, 0],
  ],
}

test("gene documents carry their own title, canonical, description, image and licence", () => {
  const html = iconoplasmGenePageHtml({ symbol: "TP53", fullName: "tumor protein p53" })
  assert.match(html, /<title>TP53 — tumor protein p53 \| Iconoplasm character profile<\/title>/)
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53">/,
  )
  assert.match(html, /<meta name="description" content="TP53 \(tumor protein p53\) drawn as/)
  assert.match(
    html,
    /property="og:image" content="https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp"/,
  )
  assert.match(html, /creativecommons\.org\/publicdomain\/zero\/1\.0/)
  // Readers get the one SPA shell in place; the body never loads the blot
  // itself, so a human view spends no Worker request.
  assert.match(html, /fetch\("\/", \{ credentials: "same-origin" \}\)/)
  assert.doesNotMatch(html, /<img /)
})

test("gene names are escaped in HTML and JSON-LD", () => {
  const html = iconoplasmGenePageHtml({ symbol: "X1", fullName: 'a "quoted" <b>name</b>' })
  assert.match(html, /a &quot;quoted&quot; &lt;b&gt;name&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>name<\/b>/)
})

test("published entries are validated, de-duplicated and sorted", () => {
  assert.throws(() => publishedGeneEntries([index]), /Invalid published gene symbol/)
  const valid = { schema_version: 2, search_entries: index.search_entries.slice(0, 2) }
  assert.deepEqual(publishedGeneEntries([valid, valid]), [
    ["A1BG", "alpha-1-B glycoprotein"],
    ["TP53", "tumor protein p53"],
  ])
})

test("one static file per gene is written under gene/", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gene-pages-"))
  try {
    const valid = { schema_version: 2, search_entries: index.search_entries.slice(0, 2) }
    const result = await writeIconoplasmGenePages({ outputRoot: dir, publicationIndexes: [valid] })
    assert.equal(result.genePages, 2)
    assert.deepEqual((await readdir(path.join(dir, "gene"))).sort(), ["A1BG.html", "TP53.html"])
    assert.match(await readFile(path.join(dir, "gene", "TP53.html"), "utf8"), /gene\/TP53"/)
    const none = await writeIconoplasmGenePages({ outputRoot: dir, publicationIndexes: [] })
    assert.equal(none.genePages, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
