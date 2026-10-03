import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  iconoplasmGenePageHtml,
  publishedGeneEntries,
  writeIconoplasmGenePages,
  writeIconoplasmStubPages,
} from "./prepare-iconoplasm-edge-assets.mjs"

// B-809: every published gene gets a static document whose raw HTML names that
// gene, so crawlers and unfurlers never see the shell's canonical "/".

// B-898: rows of the stable catalog object (catalog/v3/index.json).
const rows = [
  ["TP53", "tumor protein p53", "", "", 0],
  ["A1BG", "alpha-1-B glycoprotein", "", "", 0],
  ["BAD<", "should be rejected", "", "", 0],
]

test("gene documents carry their own title, canonical, description, image and licence", () => {
  const html = iconoplasmGenePageHtml({ symbol: "TP53", fullName: "tumor protein p53" })
  // B-818: the one Iconoplasm title template, in <title>, og:title and JSON-LD.
  const title = "TP53 — tumor protein p53 | Iconoplasm"
  assert.ok(html.includes(`<title>${title}</title>`))
  assert.ok(html.includes(`<meta property="og:title" content="${title}">`))
  assert.equal(JSON.parse(html.match(/ld\+json">([^<]+)</)[1]).name, title)
  assert.ok(
    iconoplasmGenePageHtml({ symbol: "X1", fullName: "" }).includes(
      "<title>X1 | Iconoplasm</title>",
    ),
  )
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
  assert.match(html, /fetch\("\/",\{credentials:"same-origin"\}\)/)
  // B-836: a reader never sees the crawler copy; it paints the site background,
  // stays hidden, and shows the copy only if the shell fetch fails.
  assert.match(html, /body\{visibility:hidden\}/)
  assert.match(html, /icono-stub-failed/)
  const boot = html.match(/<script>\(function\(\)[\s\S]*?<\/script>/)?.[0] || ""
  assert.ok(html.indexOf(boot) < html.indexOf("</head>"), "the shell request starts from <head>")
  new Function(boot.replace(/<\/?script>/g, ""))
  assert.doesNotMatch(html, /<img /)
})

test("gene names are escaped in HTML and JSON-LD", () => {
  const html = iconoplasmGenePageHtml({ symbol: "X1", fullName: 'a "quoted" <b>name</b>' })
  assert.match(html, /a &quot;quoted&quot; &lt;b&gt;name&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>name<\/b>/)
})

test("published entries are validated, de-duplicated and sorted", () => {
  assert.throws(() => publishedGeneEntries(rows), /Invalid published gene symbol/)
  assert.throws(() => publishedGeneEntries({ schema: 3 }), /Invalid published catalog rows/)
  const valid = rows.slice(0, 2)
  assert.deepEqual(publishedGeneEntries([...valid, ...valid]), [
    ["A1BG", "alpha-1-B glycoprotein"],
    ["TP53", "tumor protein p53"],
  ])
})

test("one static file per gene is written under gene/", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gene-pages-"))
  try {
    const result = await writeIconoplasmGenePages({
      outputRoot: dir,
      publishedGenes: rows.slice(0, 2),
    })
    assert.equal(result.genePages, 2)
    assert.deepEqual((await readdir(path.join(dir, "gene"))).sort(), ["A1BG.html", "TP53.html"])
    assert.match(await readFile(path.join(dir, "gene", "TP53.html"), "utf8"), /gene\/TP53"/)
    const none = await writeIconoplasmGenePages({ outputRoot: dir, publishedGenes: [] })
    assert.equal(none.genePages, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// B-980: the 404 page and the two in-app route pages are stubs that say noindex
// until the shell takes over, and boot the shell exactly as a gene document does.
test("the not-found and in-app route stubs are noindex and boot the shell", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stub-pages-"))
  try {
    assert.equal((await writeIconoplasmStubPages({ outputRoot: dir })).stubPages, 3)
    assert.deepEqual((await readdir(dir)).sort(), ["404.html", "clans.html", "studio.html"])
    const titles = {
      "404.html": "Page not found | Iconoplasm",
      "clans.html": "Clans | Iconoplasm",
      "studio.html": "Diagram Studio | Iconoplasm",
    }
    for (const [file, title] of Object.entries(titles)) {
      const html = await readFile(path.join(dir, file), "utf8")
      assert.ok(html.includes("<title>" + title + "</title>"), file)
      assert.match(html, /<meta name="robots" content="noindex,follow">/, file)
      assert.doesNotMatch(html, /rel="canonical"/, file)
      assert.match(html, /fetch\("\/",\{credentials:"same-origin"\}\)/, file)
      const boot = html.match(/<script>\(function\(\)[\s\S]*?<\/script>/)?.[0] || ""
      assert.ok(html.indexOf(boot) < html.indexOf("</head>"), file)
      new Function(boot.replace(/<\/?script>/g, ""))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
