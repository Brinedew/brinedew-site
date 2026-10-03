// B-908: a gene has one public name. The static gene document (what a crawler
// and the first paint see), catalog row[1] (the gallery, search and the static
// documents' source) and the stable gene object's full_name (the loaded card)
// must be the same string, because they are one field read through one rule.
//
// Ways this can fail, written before the fix:
// 1. The catalog builder reads the essence column (the UniProt protein name,
//    "Cellular tumor antigen p53") ahead of the catalog column (the HGNC name,
//    "tumor protein p53") while the stable object reads only the catalog
//    column: row[1] and full_name disagree for nearly every gene.
// 2. The static document is titled from row[1], so the tab title changes when
//    the card payload arrives. The check records every value of document.title
//    from the static document's first paint to the loaded card, in a real
//    browser, and wants exactly one.
//    Measured with names already in agreement: the static document's title,
//    then the shell's home title ("Iconoplasm | Gene character cards") for
//    ~300 ms while the app starts, then a symbol-only title, then the card's.
//    The document hands over to the shell with the shell's own <title>, so the
//    check needs the hand-off to carry the document's title across too.
// 3. A gene whose catalog name is empty is named from the essence column by one
//    producer and from the symbol by the other.
// 4. Surrounding whitespace in the catalog name is trimmed by one producer and
//    kept by the other, so the titles differ by a space.
// 5. The extension starts reading the catalog object. Its next store release is not
//    ours to schedule, so a catalog change must not be able to reach it: it
//    reads names from the stable gene object and the catalog manifest only.
// 6. The check cannot see the bug at all: a control run, whose static document
//    is built from the UniProt name (what the catalog published before B-908),
//    must show the title changing.
//
// What is real: a SQLite database built from every checked-in migration, the
// catalog builder's own row SQL and row mapper, the stable-object publisher
// (the Worker's per-gene card path), the static document writer, the shared
// browser app and Chrome. What is stubbed: the two CDN objects are served from
// what those producers just wrote, and the Worker answers nothing.
//
// Needs `pnpm run build` (public-iconoplasm-edge for the app shell) and an
// installed Chrome. The measured titles land in
// artifacts/e2e/gene-name-one-source.json.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { iconoplasmGenePageTitle } from "../quartz/static/iconoplasm/page-title.js"
import { ROW_SQL, geneRow } from "../scripts/publish-iconoplasm-catalog.mjs"
import { writeIconoplasmGenePages } from "../scripts/prepare-iconoplasm-edge-assets.mjs"
import { publishIconoplasmGeneStableObject } from "../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const MIGRATIONS = new URL("../migrations-iconoplasm/", import.meta.url)
const CDN = "https://iconoplasmportraits.b-cdn.net"
const TINY_WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")

// What each gene is called by the two authorities. `catalog` is
// icono_gene_catalog.full_name (HGNC); `essence` is icono_gene_essence.full_name
// (the UniProt protein name the workstation syncs).
const GENES = [
  {
    symbol: "TP53",
    catalog: "tumor protein p53",
    essence: "Cellular tumor antigen p53",
    expected: "tumor protein p53",
  },
  { symbol: "INS", catalog: "insulin", essence: "Insulin", expected: "insulin" },
  // 3. No catalog name: the symbol, never the essence's protein name.
  { symbol: "ZZ1", catalog: "", essence: "Zinc finger protein ZZ1", expected: "ZZ1" },
  // 4. Surrounding whitespace is trimmed by every producer.
  {
    symbol: "PAD1",
    catalog: "  padded name  ",
    essence: "Padded protein",
    expected: "padded name",
  },
]

const sha = (char) => char.repeat(64)

// B-972: icono_gene_essence.manifestation is the workstation's raw sample prose. It is internal:
// no public producer may copy it, whatever it is called there (manifestation, description).
const sampleProse = (symbol) => `CANARY internal sample prose for ${symbol}`

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:")
    for (const name of readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(new URL(name, MIGRATIONS), "utf8"))
    }
  }
  prepare(sql) {
    const db = this
    const statement = {
      args: [],
      bind(...args) {
        statement.args = args
        return statement
      },
      async first(column) {
        const row = db.sqlite.prepare(sql).all(...statement.args)[0] ?? null
        return row && column ? (row[column] ?? null) : row
      },
      async all() {
        const results = db.sqlite.prepare(sql).all(...statement.args)
        return { success: true, results, meta: { changes: 0, rows_read: results.length } }
      },
      async run() {
        const info = db.sqlite.prepare(sql).run(...statement.args)
        return { success: true, results: [], meta: { changes: Number(info.changes || 0) } }
      },
      async raw() {
        return db.sqlite
          .prepare(sql)
          .all(...statement.args)
          .map((row) => Object.values(row))
      },
    }
    return statement
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN")
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.sqlite.exec("COMMIT")
      return results
    } catch (error) {
      this.sqlite.exec("ROLLBACK")
      throw error
    }
  }
  exec(sql, ...args) {
    return this.sqlite.prepare(sql).run(...args)
  }
  rows(sql, ...args) {
    return this.sqlite.prepare(sql).all(...args)
  }
}

function seedDatabase() {
  const db = new SqliteD1()
  GENES.forEach((gene, index) => {
    const asset = sha(String(index + 1))
    db.exec(
      "INSERT INTO icono_gene_catalog (gene_symbol, full_name, color_hex) VALUES (?, ?, '#35353c')",
      gene.symbol,
      gene.catalog,
    )
    db.exec(
      "INSERT INTO icono_gene_essence (gene_symbol, full_name, weight_kg, age_years, manifestation) VALUES (?, ?, 43.7, 44, ?)",
      gene.symbol,
      gene.essence,
      sampleProse(gene.symbol),
    )
    db.exec(
      `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, created_at, is_stale, autopick_eligible, vision_id, width, height)
       VALUES (?, ?, ?, ?, ?, 'published', '2026-07-10 23:09:09', 0, 1, 'anima-v1-1', 768, 1024)`,
      gene.symbol,
      asset,
      `portraits/${asset}/full.webp`,
      `portraits/${asset}/medium.webp`,
      `portraits/${asset}/thumb.webp`,
    )
    db.exec(
      "INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by) VALUES (?, ?, 'seed')",
      gene.symbol,
      asset,
    )
  })
  return db
}

// The catalog builder's own SQL and row mapper, over every seeded gene.
function buildCatalogObject(db) {
  const rows = db.rows(`${ROW_SQL}\n   ORDER BY gc.gene_symbol ASC`).map(geneRow)
  return { schema: 3, generated_at: "2026-10-03T00:00:00.000Z", watermark_event_id: 1, genes: rows }
}

// The Worker's per-gene publisher, with the object store replaced by a capture.
async function publishStableObjects(db) {
  const objects = new Map()
  const store = {
    async writeStable(key, value) {
      objects.set(key, JSON.parse(JSON.stringify(value)))
      return { key, hash: "e".repeat(64), size: 1 }
    },
  }
  for (const gene of GENES) {
    await publishIconoplasmGeneStableObject({ ICONOPLASM_DB: db }, gene.symbol, {
      objects: store,
    })
  }
  return objects
}

async function staticDocuments(publishedGenes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gene-name-docs-"))
  await writeIconoplasmGenePages({ outputRoot: dir, publishedGenes })
  const docs = new Map()
  for (const name of readdirSync(path.join(dir, "gene"))) {
    docs.set(name.replace(/\.html$/, ""), readFileSync(path.join(dir, "gene", name), "utf8"))
  }
  rmSync(dir, { recursive: true, force: true })
  return docs
}

const metaTitle = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1]
const ogTitle = (html) => html.match(/property="og:title" content="([^"]*)"/)?.[1]
const htmlUnescape = (value) =>
  String(value).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")

test("catalog row, stable object and static document name every gene the same way", async () => {
  const db = seedDatabase()
  const catalog = buildCatalogObject(db)
  const stable = await publishStableObjects(db)
  const docs = await staticDocuments(catalog.genes)
  const report = []
  for (const gene of GENES) {
    const row = catalog.genes.find((candidate) => candidate[0] === gene.symbol)
    const object = stable.get(`genes/v3/${gene.symbol}.json`)
    const html = docs.get(gene.symbol)
    const title = iconoplasmGenePageTitle(gene.symbol, object.full_name)
    report.push({
      symbol: gene.symbol,
      catalog_row_1: row[1],
      stable_full_name: object.full_name,
      stable_essence_name: object.essence?.name,
      static_title: htmlUnescape(metaTitle(html)),
      expected_title: title,
    })
    assert.equal(row.length, 10, `${gene.symbol}: catalog row keeps its ten columns`)
    assert.equal(object.full_name, gene.expected, `${gene.symbol}: stable object name`)
    assert.equal(row[1], object.full_name, `${gene.symbol}: catalog row[1] vs stable full_name`)
    assert.equal(object.essence?.name, object.full_name, `${gene.symbol}: card essence name`)
    // Raw sample prose reaches no public producer.
    for (const [producer, body] of [
      ["stable object", JSON.stringify(object)],
      ["catalog row", JSON.stringify(row)],
      ["static document", html],
    ]) {
      assert.equal(
        body.includes("CANARY") || body.includes(sampleProse(gene.symbol)),
        false,
        `${gene.symbol}: the ${producer} copied the raw sample prose`,
      )
    }
    assert.equal(htmlUnescape(metaTitle(html)), title, `${gene.symbol}: static <title>`)
    assert.equal(htmlUnescape(ogTitle(html)), title, `${gene.symbol}: static og:title`)
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    path.join(OUT, "gene-name-one-source-producers.json"),
    JSON.stringify(report, null, 2),
  )
})

test("the extension never reads the catalog object, so a catalog name cannot reach it", () => {
  const dir = new URL("../iconoplasm-extension/", import.meta.url)
  const sources = readdirSync(dir)
    .filter((name) => /\.(?:m?js|html|json)$/.test(name) && !/\.test\./.test(name))
    .map((name) => [name, readFileSync(new URL(name, dir), "utf8")])
  assert.ok(sources.length > 20, "the extension's own files were found")
  for (const [name, source] of sources) {
    assert.doesNotMatch(source, /catalog\/v3|stable-catalog/, `${name} reads the catalog object`)
  }
  // What it does read: the stable gene object from the CDN (its full_name) and
  // the catalog manifest (the scanner artifact's names).
  const worker = sources.find(([name]) => name === "service-worker.js")[1]
  assert.match(worker, /genes\/v3\//)
  assert.match(worker, /\/api\/public\/v1\/catalog\/manifest/)
})

// Records every value document.title takes, whoever sets it, from the first
// instant a page exists. The static document replaces itself with the app
// shell in place (document.open/write), which keeps this window and its hooks.
const TITLE_RECORDER = () => {
  window.__titleLog = []
  const original = Object.getOwnPropertyDescriptor(Document.prototype, "title")
  Object.defineProperty(Document.prototype, "title", {
    configurable: true,
    get() {
      return original.get.call(this)
    },
    set(value) {
      window.__titleLog.push({
        at: Math.round(performance.now()),
        via: "app",
        value: String(value),
      })
      original.set.call(this, value)
    },
  })
  const poll = () => {
    const value = document.title
    const last = window.__titleLog[window.__titleLog.length - 1]
    if (value && (!last || last.value !== value)) {
      window.__titleLog.push({ at: Math.round(performance.now()), via: "poll", value })
    }
  }
  setInterval(poll, 3)
}

async function loadGenePage(
  browser,
  origin,
  { symbol, document: html, catalog, stable, expected },
) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  // Lowest priority first: nothing outside the production host and the CDN may
  // be reached, so the run does not depend on the live network.
  await context.route("**/*", (route) => route.abort())
  await routeProduction(context, origin)
  // A guest page asks the Worker nothing but "who am I"; any other API request
  // is recorded, because it would mean the page fell back from the CDN.
  const originHits = []
  await context.route(`${HOST}/api/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === "/api/auth/me")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: false }),
      })
    originHits.push(pathname)
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  })
  await context.route(`${HOST}/gene/${symbol}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  )
  const cdnHits = []
  const cors = { "access-control-allow-origin": "*" }
  await context.route(`${CDN}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    cdnHits.push(pathname)
    if (pathname === "/catalog/v3/index.json")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(catalog),
      })
    if (pathname === `/genes/v3/${symbol}.json`)
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(stable),
      })
    if (pathname.startsWith("/portraits/"))
      return route.fulfill({
        status: 200,
        contentType: "image/webp",
        headers: cors,
        body: TINY_WEBP,
      })
    return route.fulfill({ status: 404, headers: cors, body: "" })
  })
  await context.addInitScript(TITLE_RECORDER)
  const page = await context.newPage()
  const consoleLines = []
  page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`))
  await page.goto(`${HOST}/gene/${symbol}`)
  // The app has taken over and set the title from the loaded card: the card's
  // own title is the one value only the loaded stable object can produce.
  await page.waitForFunction(
    (title) => window.__titleLog?.some((entry) => entry.via === "app" && entry.value === title),
    expected,
    { timeout: 30_000 },
  )
  // Settle: any later title change (a second producer, a late hydration) lands
  // inside this window.
  await page.waitForTimeout(2000)
  const result = await page.evaluate(() => ({
    log: window.__titleLog,
    finalTitle: document.title,
    text: document.body.innerText,
  }))
  await page.screenshot({ path: path.join(OUT, `gene-name-one-source-${symbol}.png`) })
  await context.close()
  return { ...result, cdnHits, originHits, console: consoleLines.slice(-12) }
}

test("the tab title never changes while the gene card loads (real browser)", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const db = seedDatabase()
  const catalog = buildCatalogObject(db)
  const stable = await publishStableObjects(db)
  const gene = GENES[0]
  const object = stable.get(`genes/v3/${gene.symbol}.json`)
  const expected = iconoplasmGenePageTitle(gene.symbol, object.full_name)
  const report = { symbol: gene.symbol, expected, runs: {} }
  try {
    // The pipeline as shipped: the document is built from the catalog row the
    // catalog builder wrote.
    const docs = await staticDocuments(catalog.genes)
    const real = await loadGenePage(browser, origin, {
      symbol: gene.symbol,
      document: docs.get(gene.symbol),
      catalog,
      stable: object,
      expected,
    })
    const realTitles = [...new Set(real.log.map((entry) => entry.value))]
    report.runs.shipped = { titles: realTitles, ...real, text: undefined }

    // 5. Control: a document built from the UniProt name, as the catalog
    // published it before B-908. The title must be seen changing, or this
    // check could not have caught the bug.
    const uniprotRows = catalog.genes.map((row) => [
      row[0],
      GENES.find((candidate) => candidate.symbol === row[0]).essence,
      ...row.slice(2),
    ])
    const controlDocs = await staticDocuments(uniprotRows)
    const control = await loadGenePage(browser, origin, {
      symbol: gene.symbol,
      document: controlDocs.get(gene.symbol),
      catalog,
      stable: object,
      expected,
    })
    const controlTitles = [...new Set(control.log.map((entry) => entry.value))]
    report.runs.control_uniprot_document = { titles: controlTitles, ...control, text: undefined }

    // The card really loaded from the stable object, not an error state.
    assert.ok(real.cdnHits.includes(`/genes/v3/${gene.symbol}.json`), "the stable object was read")
    assert.deepEqual(real.originHits, [], "no request fell back to the Worker")
    assert.match(real.text.toLowerCase(), new RegExp(object.full_name.toLowerCase()))
    // 2. One title, from first paint to the loaded card.
    assert.deepEqual(realTitles, [expected], `title values seen: ${JSON.stringify(realTitles)}`)
    assert.equal(real.finalTitle, expected)
    assert.ok(
      real.log.some((entry) => entry.via === "app" && entry.value === expected),
      "the app set the title from the loaded card",
    )
    // 5. The control shows the change.
    assert.equal(controlTitles.length, 2, `control title values: ${JSON.stringify(controlTitles)}`)
    assert.equal(controlTitles[0], iconoplasmGenePageTitle(gene.symbol, gene.essence))
    assert.equal(controlTitles[1], expected)
  } finally {
    writeFileSync(path.join(OUT, "gene-name-one-source.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
