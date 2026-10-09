import assert from "node:assert/strict"
import test from "node:test"

import { republishGenes } from "./publish-iconoplasm-catalog.mjs"

// B-1055: a catalogue delivery dirties a thousand genes in one run. Failure modes:
// 1. a batch killed by the 10 ms CPU cap twice throws the whole run, and the held
//    watermark makes every later run throw on the same genes;
// 2. a gene that never republishes is silently dropped from its object;
// 3. a per-gene result the route reports as failed is lost.
function cpuCappedRoute({ alwaysFails = new Set() } = {}) {
  const calls = []
  return {
    calls,
    async post(symbols) {
      calls.push(symbols.join(","))
      // Four-gene calls die at the cap; single-gene calls fit.
      if (symbols.length > 1) return { ok: false, status: 503, body: null }
      if (alwaysFails.has(symbols[0])) return { ok: false, status: 503, body: null }
      return {
        ok: true,
        status: 200,
        body: {
          ok: true,
          published: 1,
          results: [{ symbol: symbols[0], ok: symbols[0] !== "BADROW" }],
        },
      }
    },
  }
}

const noWait = async () => {}

test("a batch the CPU cap kills is retried, then republished one gene a call", async () => {
  const route = cpuCappedRoute()
  const symbols = ["ADGRE4P", "BADROW", "C10ORF143", "PABIR3", "ZNF892"]

  const result = await republishGenes(symbols, { post: route.post, sleep: noWait })

  assert.equal(result.published, 5)
  // Three tries of each four-gene batch, then one call per gene: nothing is skipped.
  assert.deepEqual(route.calls.slice(0, 3), Array(3).fill("ADGRE4P,BADROW,C10ORF143,PABIR3"))
  assert.equal(route.calls.filter((call) => !call.includes(",")).length, 5)
  // A per-gene failure the route reports is kept in the receipt.
  assert.deepEqual(result.failed, [{ symbol: "BADROW", ok: false }])
})

test("a gene that fails every try fails the run instead of vanishing", async () => {
  const route = cpuCappedRoute({ alwaysFails: new Set(["PABIR3"]) })
  await assert.rejects(
    republishGenes(["C10ORF143", "PABIR3"], { post: route.post, sleep: noWait }),
    /Republish of PABIR3 failed after retries \(503\)/,
  )
})

// 2026-10-09: 599 genes were listed while their cards failed to build, so their
// pages said "Page not found". The list holds only genes with a card.
test("the catalog lists only genes whose card exists", async () => {
  const { DatabaseSync } = await import("node:sqlite")
  const { ROW_SQL } = await import("./publish-iconoplasm-catalog.mjs")
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`
      CREATE TABLE icono_gene_catalog (gene_symbol TEXT PRIMARY KEY, full_name TEXT, color_hex TEXT);
      CREATE TABLE icono_published_gene_routes (gene_symbol TEXT PRIMARY KEY);
      CREATE TABLE icono_gene_essence (gene_symbol TEXT PRIMARY KEY, leakage_percent REAL,
        weight_kg REAL, age_years REAL, first_publication_year INTEGER);
      CREATE TABLE icono_publish_state (gene_symbol TEXT PRIMARY KEY, current_asset_sha256 TEXT);
      CREATE TABLE icono_portrait_assets (gene_symbol TEXT, asset_sha256 TEXT, created_at TEXT);
      CREATE TABLE icono_vote_asset_summary (gene_symbol TEXT, asset_sha256 TEXT, score REAL);
      INSERT INTO icono_gene_catalog VALUES ('TP53', 'tumor protein p53', ''), ('FAM25A', 'family 25A', '');
      INSERT INTO icono_published_gene_routes VALUES ('TP53');
    `)
    const rows = db.prepare(`${ROW_SQL}\n ORDER BY gc.gene_symbol`).all()
    assert.deepEqual(
      rows.map((row) => row.symbol),
      ["TP53"],
    )
  } finally {
    db.close()
  }
})
