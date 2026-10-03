// The GeneGuessr structure-bytes route finds a protein by an indexed equality.
//
// `/api/structure-cached?key=alphafold/<id>.pdb` and
// `...?key=swissmodel/<id>_<template>.pdb` carry no upstream URL: the route reads
// the protein's stored structure columns to learn it. With R2 unbound, as in
// production, every such request is a miss, so this lookup runs once per view of
// a guess structure and grows with players.
//
// The lookup compares the bare column to an upper-cased bound value. Written as
// `WHERE upper(uniprot) = ?` it would defeat the UNIQUE index on
// `proteins.uniprot` and read the whole table: 19,110 rows per request, so about
// 261 views would spend the day's 5M-row allowance. Every stored accession is
// already upper-case (19,110 of 19,110 measured on 2026-10-03), and the other
// protein reader, `fetchProteinByUniprot`, compares `uniprot = ?` with an
// upper-cased bound value, so the equality finds the same rows.
//
// Everything runs against a real local D1 built from the real GeneGuessr
// migrations and seeded with the production shape (19,110 proteins), through the
// real Worker, with no R2 bucket bound.
//
// Failure modes this file proves, each written before the code that fixes it:
//   S1  a key-based request reads the table in O(rows) instead of one indexed row
//   S2  the indexed lookup resolves a different row than the upper() form does
//   S3  a missing row, or a key with no accession in it, changes its answer
//   S4  a D1 error on the lookup throws instead of falling through
//   S5  a PDB key starts reading the database, or a stray upstream= parameter
//       changes what is read or fetched
//   S6  the statement the route runs scans `proteins` (names the scan)
import assert from "node:assert/strict"
import test, { after, before, mock } from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  PRODUCTION_SHAPE,
  geneguessrWorkerEnv,
  meteredDb,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "./daily-selection-pool-test-d1.js"

// The same lookup with the column wrapped in upper(). It is the oracle: replayed
// here to show what a full scan costs on this catalog and to compare its answers
// with the route's.
const UPPER_COLUMN_SQL = `SELECT uniprot, structure_source, pdb_id, alphafold_url, swissmodel_url, swissmodel_template
      FROM proteins
      WHERE upper(uniprot) = ?`

let db
let dispose
let rows

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
})
after(async () => {
  await dispose()
})

// Evenly spaced rows, so a run is repeatable and spans the whole table.
function sample(list, count) {
  const step = Math.max(1, Math.floor(list.length / count))
  return list.filter((_row, index) => index % step === 0).slice(0, count)
}

const bySource = (source) => rows.filter((row) => row.structure_source === source)

// One request through the real Worker. `fetch` is the upstream: it records each
// URL the Worker asks for and answers with a small structure file.
async function getStructure(query, { failProteinReads = false } = {}) {
  const fetched = []
  const statements = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetched.push(String(url))
    return new Response("data_structure\n", {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  }
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  try {
    const metered = meteredDb(db, {
      before(sql, args) {
        statements.push({ sql, args })
        if (failProteinReads && /FROM proteins/i.test(sql)) throw new Error("D1 unavailable")
      },
    })
    const { env } = geneguessrWorkerEnv(metered)
    const waits = []
    const response = await worker.fetch(
      new Request(`https://geneguessr.brinedew.bio/api/structure-cached?${query}`),
      env,
      { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
    )
    const body = await response.text()
    await Promise.allSettled(waits)
    return { response, body, fetched, metered, statements }
  } finally {
    globalThis.fetch = originalFetch
    mock.restoreAll()
  }
}

const keyQuery = (key) => `key=${encodeURIComponent(key)}`

test("S1: the upper() form scans this catalog, the 19,110 rows production paid per request", async () => {
  const metered = meteredDb(db)
  await metered.prepare(UPPER_COLUMN_SQL).bind("Q00001").first()
  assert.equal(metered.totalRead(), PRODUCTION_SHAPE.proteins)
})

test("S1: a SWISS-MODEL key reads at most one row, whichever protein it names", async (t) => {
  const reads = []
  for (const row of sample(bySource("swissmodel"), 12)) {
    const key = `swissmodel/${row.uniprot}_${row.swissmodel_template}.pdb`
    const { response, fetched, metered } = await getStructure(keyQuery(key))
    assert.equal(response.status, 200, key)
    assert.deepEqual(fetched, [row.swissmodel_url], `${key} resolves its own stored upstream`)
    reads.push(metered.totalRead())
  }
  t.diagnostic(`rows read per SWISS-MODEL request: ${reads.join(", ")}`)
  assert.ok(Math.max(...reads) <= 1, `a request read ${Math.max(...reads)} rows`)
})

test("S1: an AlphaFold key reads at most one row, whichever protein it names", async (t) => {
  const reads = []
  for (const row of sample(bySource("alphafold"), 12)) {
    const key = `alphafold/${row.uniprot}.pdb`
    const { response, fetched, metered } = await getStructure(keyQuery(key))
    assert.equal(response.status, 200, key)
    assert.deepEqual(fetched, [row.alphafold_url], `${key} resolves its own stored upstream`)
    reads.push(metered.totalRead())
  }
  t.diagnostic(`rows read per AlphaFold request: ${reads.join(", ")}`)
  assert.ok(Math.max(...reads) <= 1, `a request read ${Math.max(...reads)} rows`)
})

test("S1: the row is found however the key spells the accession", async () => {
  const [row] = sample(bySource("alphafold"), 1)
  const { metered } = await getStructure(keyQuery(`alphafold/${row.uniprot.toLowerCase()}.pdb`))
  assert.equal(metered.totalRead(), 1, "a lower-case key still matches the stored accession")
})

test("S2: the statement the route runs returns the row the upper() form returns, for every key spelling", async () => {
  // The upper() form scans the table, so each comparison replays 19,110 rows.
  const samples = [...sample(bySource("alphafold"), 10), ...sample(bySource("swissmodel"), 10)]
  let compared = 0
  for (const row of samples) {
    for (const spelling of [row.uniprot, row.uniprot.toLowerCase()]) {
      const key =
        row.structure_source === "alphafold"
          ? `alphafold/${spelling}.pdb`
          : `swissmodel/${spelling}_${row.swissmodel_template}.pdb`
      const { statements } = await getStructure(keyQuery(key))
      const lookup = statements.find((entry) => /FROM proteins/i.test(entry.sql))
      assert.ok(lookup, `${key} reads the protein row`)
      const upperRow = await db.prepare(UPPER_COLUMN_SQL).bind(row.uniprot.toUpperCase()).first()
      const routeRow = await db
        .prepare(lookup.sql)
        .bind(...lookup.args)
        .first()
      assert.deepEqual(routeRow, upperRow, `${key}: same row from both statements`)
      assert.equal(upperRow.uniprot, row.uniprot)
      compared += 1
    }
  }
  assert.equal(compared, 40)
})

test("S3: an accession that is not in the catalog gets the derived upstream (AlphaFold) or a 404 (SWISS-MODEL), and reads nothing", async () => {
  const alphafold = await getStructure(keyQuery("alphafold/QZZZZZ.cif"))
  assert.equal(alphafold.response.status, 200)
  assert.deepEqual(
    alphafold.fetched,
    ["https://alphafold.ebi.ac.uk/files/AF-QZZZZZ-F1-model_v6.cif"],
    "AlphaFold falls back to the derived upstream",
  )
  assert.equal(alphafold.metered.totalRead(), 0)

  const swissmodel = await getStructure(keyQuery("swissmodel/QZZZZZ_tmpl.pdb"))
  assert.equal(swissmodel.response.status, 404, "SWISS-MODEL has no derivable upstream")
  assert.deepEqual(swissmodel.fetched, [])
  assert.equal(swissmodel.metered.totalRead(), 0)
})

test("S3: a SWISS-MODEL key with no accession in it does no lookup at all", async () => {
  const { response, metered, statements } = await getStructure(keyQuery("swissmodel/Q00001.pdb"))
  assert.equal(response.status, 404)
  assert.equal(metered.totalRead(), 0)
  assert.equal(statements.filter((entry) => /FROM proteins/i.test(entry.sql)).length, 0)
})

test("S3: a SWISS-MODEL key naming another template than the stored one is not served the stored upstream", async () => {
  // The row exists, but this template is not the stored one: the stored upstream
  // must not be served under another template's key.
  const [row] = sample(bySource("swissmodel"), 1)
  const { response, fetched } = await getStructure(keyQuery(`swissmodel/${row.uniprot}_other.pdb`))
  assert.equal(response.status, 404)
  assert.deepEqual(fetched, [])
})

test("S4: a D1 error on the lookup is survived: AlphaFold derives its upstream, SWISS-MODEL says 404", async () => {
  const [alphafold] = sample(bySource("alphafold"), 1)
  const derived = await getStructure(keyQuery(`alphafold/${alphafold.uniprot}.cif`), {
    failProteinReads: true,
  })
  assert.equal(derived.response.status, 200)
  assert.deepEqual(derived.fetched, [
    `https://alphafold.ebi.ac.uk/files/AF-${alphafold.uniprot}-F1-model_v6.cif`,
  ])

  const [swissmodel] = sample(bySource("swissmodel"), 1)
  const missing = await getStructure(
    keyQuery(`swissmodel/${swissmodel.uniprot}_${swissmodel.swissmodel_template}.pdb`),
    { failProteinReads: true },
  )
  assert.equal(missing.response.status, 404)
  assert.deepEqual(missing.fetched, [])
})

test("S5: a PDB key never reads the database, and a stray upstream= parameter changes nothing", async () => {
  const [row] = sample(bySource("alphafold"), 1)
  const stray = await getStructure(
    `${keyQuery(`alphafold/${row.uniprot}.pdb`)}&upstream=${encodeURIComponent("https://example.test/a.cif")}`,
  )
  assert.equal(stray.response.status, 200)
  assert.deepEqual(stray.fetched, [row.alphafold_url], "the stored upstream, not the parameter")
  assert.equal(stray.metered.totalRead(), 1, "one indexed row, as without the parameter")

  const pdb = await getStructure(keyQuery("pdb/1ABC23.bcif"))
  assert.equal(pdb.response.status, 200)
  assert.deepEqual(pdb.fetched, [
    "https://models.rcsb.org/v1/1ABC23/full?encoding=bcif&copy_all_categories=false",
  ])
  assert.equal(pdb.metered.totalRead(), 0)
})

test("S6: every statement the route runs on proteins is an index search, never a scan", async () => {
  const [alphafold] = sample(bySource("alphafold"), 1)
  const [swissmodel] = sample(bySource("swissmodel"), 1)
  const runs = [
    await getStructure(keyQuery(`alphafold/${alphafold.uniprot}.pdb`)),
    await getStructure(
      keyQuery(`swissmodel/${swissmodel.uniprot}_${swissmodel.swissmodel_template}.pdb`),
    ),
  ]
  const seen = new Map()
  for (const { statements } of runs) {
    for (const entry of statements) {
      if (/FROM proteins/i.test(entry.sql)) seen.set(entry.sql, entry.args)
    }
  }
  assert.ok(seen.size >= 1, "the route reads proteins")
  for (const [sql, args] of seen) {
    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...args)
      .all()
    const details = plan.results.map((step) => step.detail).join(" | ")
    assert.doesNotMatch(details, /\bSCAN\b/, `query plan scans proteins: ${details}`)
    assert.match(details, /SEARCH proteins/, `query plan is not an index search: ${details}`)
  }
})
