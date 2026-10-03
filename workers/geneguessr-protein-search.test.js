// The protein autocomplete and the protein lookup, through the real Worker.
//
// The page searches a static index in the browser and falls back to `GET /api/proteins` when
// that index cannot be loaded; `GET /api/protein` answers a lookup by accession. Both read the
// catalog in D1. What a reader must be able to rely on: a typed symbol, accession, alias or
// word of the name finds the protein; punctuation in a symbol (HLA-DRA) does not break the
// search; proteins already guessed are left out; and a database that is down is a 503 the page
// can retry, never an empty list ("no such protein") or a 404.
//
// The query runs on a real local D1 (Miniflare) with the real GeneGuessr migrations, including
// the full-text index and its triggers. The cost of the search is proven by
// protein-store.search-cost.test.js.
//
// Failure modes this file proves, each written before the code that fixes it:
//   P1  a symbol, an accession, an alias or a word of the full name stops finding its protein
//   P2  a symbol with punctuation (HLA-DRA) or a short prefix (hla) finds nothing, or the
//       exact symbol is not the first answer
//   P3  a guessed protein is offered again, or the limit is ignored
//   P4  a database that errors answers an empty list or a 404 instead of a 503
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

const ORIGIN = "https://geneguessr.brinedew.bio"

// Real proteins, by their UniProt accession, symbol and full name.
const CATALOG = [
  ["P04637", "TP53", "Cellular tumor antigen p53", ["P53", "LFS1"]],
  ["P38398", "BRCA1", "Breast cancer type 1 susceptibility protein", ["RNF53"]],
  ["P01903", "HLA-DRA", "HLA class II histocompatibility antigen, DR alpha chain", ["HLA-DRA1"]],
  ["P01911", "HLA-DRB1", "HLA class II histocompatibility antigen, DRB1 beta chain", []],
  ["P04626", "ERBB2", "Receptor tyrosine-protein kinase erbB-2", ["HER2", "NEU"]],
]

let db
let dispose

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  const rows = productionShapedCatalogRows()
    .filter((row) => row.structure_source === "pdb" && row.gene_summary)
    .slice(0, CATALOG.length)
  await seedCatalog(db, rows)
  for (const [index, [uniprot, gene, fullName, synonyms]] of CATALOG.entries()) {
    const { id } = rows[index]
    await db
      .prepare(
        "UPDATE proteins SET uniprot = ?, gene = ?, full_name = ?, length = 100 WHERE id = ?",
      )
      .bind(uniprot, gene, fullName, id)
      .run()
    for (const synonym of synonyms) {
      await db
        .prepare("INSERT INTO protein_synonyms (protein_id, synonym, normalized) VALUES (?, ?, ?)")
        .bind(id, synonym, synonym.toUpperCase())
        .run()
    }
  }
})
after(async () => {
  await dispose()
})

async function call(path, { wrap } = {}) {
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})
  try {
    const harness = geneguessrWorkerEnv(wrap ? wrap(db) : db)
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`), harness.env, {
      waitUntil() {},
    })
    return { status: response.status, payload: await response.json(), response }
  } finally {
    mock.restoreAll()
  }
}
const search = (query, extra = "") =>
  call(`/api/proteins?query=${encodeURIComponent(query)}${extra}`)
const symbols = (result) => result.payload.map((protein) => protein.hgnc)

test("P1: a symbol, an accession, an alias and a word of the name each find the protein", async () => {
  for (const query of [
    "tp53",
    "TP53",
    "p04637",
    "P53",
    "lfs1",
    "tumor antigen",
    "cellular tumor",
  ]) {
    const found = await search(query)
    assert.equal(found.status, 200, query)
    assert.equal(symbols(found)[0], "TP53", `${query} -> ${symbols(found)}`)
    assert.equal(found.payload[0].uniprot, "P04637")
  }
  assert.equal(symbols(await search("her2"))[0], "ERBB2", "an alias of another protein")
})

test("P2: a symbol with punctuation, and a short prefix, find their proteins, the exact symbol first", async () => {
  assert.equal(symbols(await search("HLA-DRA"))[0], "HLA-DRA")
  assert.equal(symbols(await search("hla-dra"))[0], "HLA-DRA")
  assert.deepEqual(symbols(await search("hla")).sort(), ["HLA-DRA", "HLA-DRB1"])
  assert.deepEqual(symbols(await search("HLA-DRB")), ["HLA-DRB1"])
  assert.deepEqual((await search("zzzzzz")).payload, [], "a name nobody has finds nothing")
  assert.deepEqual((await search("   ")).payload, [], "a blank query finds nothing")
})

test("P3: a guessed protein is left out, and the limit holds", async () => {
  const guessed = await search("hla", "&exclude=p01903")
  assert.deepEqual(symbols(guessed), ["HLA-DRB1"], "the exclusion is by accession, in any case")
  const one = await search("hla", "&limit=1")
  assert.equal(one.payload.length, 1)
})

test("P4: a database that is down is a 503 the page can retry, never an empty list or a 404", async () => {
  const down = (message) => (inner) => ({
    prepare(sql) {
      if (/^\s*CREATE TABLE/i.test(sql)) return inner.prepare(sql)
      return {
        bind: () => ({
          all: async () => {
            throw new Error(message)
          },
          first: async () => {
            throw new Error(message)
          },
        }),
      }
    },
    batch: (statements) => inner.batch(statements),
  })

  const unavailable = await call("/api/proteins?query=tp53", {
    wrap: down("D1 temporarily unavailable"),
  })
  assert.equal(unavailable.status, 503)
  assert.match(unavailable.payload.error, /temporarily unavailable/)
  assert.equal(unavailable.response.headers.get("cache-control"), "no-store")

  const noIndex = await call("/api/proteins?query=tp53", {
    wrap: down("no such table: protein_search"),
  })
  assert.equal(noIndex.status, 503, "a missing search index fails loud")

  const lookup = await call("/api/protein?uniprot=P04637", {
    wrap: down("D1 temporarily unavailable"),
  })
  assert.equal(lookup.status, 503, "an unreachable database is not 'no such protein'")

  const absent = await call("/api/protein?uniprot=Q99998")
  assert.equal(absent.status, 404)
  assert.equal(absent.payload.error, "Protein not found")
  const present = await call("/api/protein?uniprot=p04637")
  assert.equal(present.status, 200)
  assert.equal(present.payload.uniprot, "P04637")
})
