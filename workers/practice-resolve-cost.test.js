// The practice gene-list resolver finds each pasted gene by an indexed equality.
//
// `POST /api/game/practice/resolve` is the "paste your own gene list and practice on
// it" box. It looks every pasted symbol up in `proteins`, a hundred symbols per
// statement. Written as `WHERE upper(gene) IN (...)` the function defeats
// `idx_proteins_gene`, so each statement reads the whole table: 19,110 rows per
// chunk, which is 19,110 rows for a one-gene paste and 1.9M rows (38% of the day's
// 5M-row read allowance) for the 10,000-symbol maximum. About 261 pastes would spend
// the whole day, and every other D1 read in the game fails with it.
//
// Every stored `proteins.gene` is already upper-case, trimmed and made only of
// `A-Z`, `0-9` and `-` (19,110 of 19,110, one scan of production on 2026-10-03), and
// the route upper-cases every pasted symbol before it queries. So the bare column
// compared with the already-upper-cased bound value finds the same rows through the
// index. On production that statement read 7 rows for 3 symbols (2 found, 1 missing):
// one row per symbol looked up plus two per symbol found, at most three per symbol.
//
// Everything runs through the real Worker against a real local D1 built from the real
// GeneGuessr migrations and seeded with the production shape (19,110 proteins).
//
// Failure modes this file proves, each written before the code that fixes it:
//   R1  a paste reads the table in O(rows) per chunk instead of O(symbols)
//   R2  the indexed statement answers differently from the upper() statement: found,
//       missing, unplayable, duplicate, lower-case, padded and punctuated symbols
//   R3  the statement the route runs scans `proteins` (names the scan)
//   R4  chunking changes: a long paste stops being a hundred symbols per statement, or
//       the 10,000-symbol cap and its `truncated` flag change
//   R5  an empty or junk paste reads the database, or a D1 error stops being a 500
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

// The statement the route used to run, with the column wrapped in upper(). It is the
// oracle: replayed here to show what a scan costs on this catalog and to compare its
// answers with the route's.
const UPPER_COLUMN_SQL = (
  count,
) => `SELECT gene, uniprot, structure_source, alphafold_url, pdb_id, swissmodel_url
      FROM proteins
      WHERE upper(gene) IN (${new Array(count).fill("?").join(",")})`

// The production meter: one row per symbol looked up, plus two per symbol found.
const PRODUCTION_ROWS_PER_SYMBOL = 3

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

const playableRow = () => rows.find((row) => row.structure_source === "pdb")
const unplayableRow = () => rows.find((row) => row.structure_source === null)

// Evenly spaced genes, so a run is repeatable and spans the whole table.
function sampleGenes(count) {
  const step = Math.max(1, Math.floor(rows.length / count))
  return rows
    .filter((_row, index) => index % step === 0)
    .slice(0, count)
    .map((row) => row.gene)
}

// One request through the real Worker.
async function resolve(body, { failProteinReads = false } = {}) {
  const statements = []
  mock.method(console, "log", () => {})
  mock.method(console, "warn", () => {})
  mock.method(console, "error", () => {})
  try {
    const metered = meteredDb(db, {
      before(sql, args) {
        statements.push({ sql, args })
        if (failProteinReads && /FROM proteins/i.test(sql)) throw new Error("D1 unavailable")
      },
    })
    const { env } = geneguessrWorkerEnv(metered)
    const response = await worker.fetch(
      new Request("https://geneguessr.brinedew.bio/api/game/practice/resolve?practice=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
      { waitUntil() {} },
    )
    const payload = await response.json()
    return { response, payload, metered, statements }
  } finally {
    mock.restoreAll()
  }
}

const proteinStatements = (statements) =>
  statements.filter((entry) => /FROM proteins/i.test(entry.sql))

test("R1: the upper() form scans this catalog, the 19,110 rows production paid per chunk", async () => {
  const metered = meteredDb(db)
  await metered.prepare(UPPER_COLUMN_SQL(1)).bind("GENE1").all()
  assert.equal(metered.totalRead(), PRODUCTION_SHAPE.proteins)
})

test("R1: a paste reads rows in proportion to its symbols, never the table, whatever it names", async (t) => {
  const sizes = [1, 2, 20, 99, 100, 101, 250, 1000]
  for (const size of sizes) {
    const genes = sampleGenes(size)
    const { response, payload, metered } = await resolve({ genes })
    assert.equal(response.status, 200, `${size} symbols`)
    assert.equal(payload.uniqueCount, size)
    assert.equal(payload.recognizedCount, size, `${size} symbols are all in the catalog`)
    const read = metered.totalRead()
    t.diagnostic(`${size} symbols: ${read} rows read`)
    assert.ok(
      read <= PRODUCTION_ROWS_PER_SYMBOL * size,
      `${size} symbols read ${read} rows; the ceiling is ${PRODUCTION_ROWS_PER_SYMBOL * size}`,
    )
    assert.ok(
      Math.max(...metered.receipts.map((receipt) => receipt.rows_read)) <
        PRODUCTION_SHAPE.proteins / 10,
      `${size} symbols: one statement read a large share of the table`,
    )
  }
})

test("R1: symbols that are not in the catalog read next to nothing", async () => {
  const missing = Array.from({ length: 100 }, (_unused, index) => `NOSUCHGENE${index}`)
  const { payload, metered } = await resolve({ genes: missing })
  assert.equal(payload.recognizedCount, 0)
  assert.equal(payload.unrecognized.length, 100)
  assert.ok(metered.totalRead() <= 100 * PRODUCTION_ROWS_PER_SYMBOL, `${metered.totalRead()} rows`)
})

test("R1: the 10,000-symbol maximum reads a bounded number of rows, not 100 scans", async (t) => {
  const genes = rows.slice(0, 10_000).map((row) => row.gene)
  const { payload, metered } = await resolve({ genes })
  assert.equal(payload.uniqueCount, 10_000)
  const read = metered.totalRead()
  t.diagnostic(`10,000 symbols: ${read} rows read (100 scans would be ${100 * rows.length})`)
  assert.ok(read <= PRODUCTION_ROWS_PER_SYMBOL * 10_000, `${read} rows`)
})

test("R2: playable, unplayable and unknown symbols are classified as before", async () => {
  const playable = playableRow()
  const unplayable = unplayableRow()
  const { payload } = await resolve({ genes: [playable.gene, unplayable.gene, "NOSUCHGENE"] })
  assert.deepEqual(payload.playable, [{ gene: playable.gene, uniprot: playable.uniprot }])
  assert.deepEqual(payload.recognizedUnplayable, [unplayable.gene])
  assert.deepEqual(payload.unrecognized, ["NOSUCHGENE"])
  assert.equal(payload.inputCount, 3)
  assert.equal(payload.uniqueCount, 3)
  assert.equal(payload.recognizedCount, 2)
  assert.equal(payload.playableCount, 1)
  assert.equal(payload.truncated, false)
})

test("R2: lower-case, padded, punctuated and duplicate symbols resolve to the same rows", async () => {
  const [first, second, third] = sampleGenes(3)
  const messy = [
    first.toLowerCase(),
    ` ${second} `,
    `(${third})`,
    `${first},`,
    first,
    `${second};`,
    "",
    "***",
  ]
  const { payload } = await resolve({ genes: messy })
  assert.equal(payload.inputCount, messy.length)
  assert.equal(payload.uniqueCount, 3, "duplicates collapse, empty and punctuation-only drop out")
  assert.equal(payload.recognizedCount, 3)
  const found = [...payload.playable.map((entry) => entry.gene), ...payload.recognizedUnplayable]
  assert.deepEqual(found.sort(), [first, second, third].sort())
})

test("R2: a pasted text block is split on commas, spaces and semicolons", async () => {
  const [first, second, third] = sampleGenes(3)
  const { payload } = await resolve({
    text: `${first}, ${second.toLowerCase()};${third}\nNOSUCHGENE`,
  })
  assert.equal(payload.uniqueCount, 4)
  assert.equal(payload.recognizedCount, 3)
  assert.deepEqual(payload.unrecognized, ["NOSUCHGENE"])
})

test("R2: the route finds exactly the rows the upper() statement finds, across the whole table", async () => {
  // The upper() statement scans the table, so each comparison replays 19,110 rows.
  const genes = sampleGenes(250)
  const { payload } = await resolve({ genes })
  const oracleFound = new Set()
  for (let offset = 0; offset < genes.length; offset += 100) {
    const chunk = genes.slice(offset, offset + 100)
    const result = await db
      .prepare(UPPER_COLUMN_SQL(chunk.length))
      .bind(...chunk)
      .all()
    for (const row of result.results) oracleFound.add(row.gene)
  }
  const routeFound = new Set([
    ...payload.playable.map((entry) => entry.gene),
    ...payload.recognizedUnplayable,
  ])
  assert.equal(oracleFound.size, 250)
  assert.deepEqual([...routeFound].sort(), [...oracleFound].sort())
  assert.equal(payload.playable.length + payload.recognizedUnplayable.length, 250)
  const expectedPlayable = genes.filter((gene) => {
    const row = rows.find((candidate) => candidate.gene === gene)
    return Boolean(row.structure_source || row.alphafold_url || row.pdb_id || row.swissmodel_url)
  })
  assert.deepEqual(
    payload.playable.map((entry) => entry.gene),
    expectedPlayable,
  )
})

test("R3: every statement the route runs on proteins is an index search on idx_proteins_gene, never a scan", async () => {
  const { statements } = await resolve({ genes: sampleGenes(150) })
  const seen = proteinStatements(statements)
  assert.equal(seen.length, 2, "150 symbols are two chunks")
  for (const { sql, args } of seen) {
    const plan = await db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...args)
      .all()
    const details = plan.results.map((step) => step.detail).join(" | ")
    assert.doesNotMatch(details, /\bSCAN\b/, `query plan scans proteins: ${details}`)
    assert.match(details, /SEARCH proteins USING INDEX idx_proteins_gene/, details)
  }
})

test("R4: a long paste runs one statement per hundred symbols", async () => {
  for (const [size, expected] of [
    [1, 1],
    [100, 1],
    [101, 2],
    [250, 3],
  ]) {
    const { statements } = await resolve({ genes: sampleGenes(size) })
    const seen = proteinStatements(statements)
    assert.equal(seen.length, expected, `${size} symbols`)
    assert.ok(
      seen.every((entry) => entry.args.length <= 100),
      "no statement binds more than the 100 parameters D1 allows",
    )
  }
})

test("R4: more than 10,000 distinct symbols are cut at 10,000 and say so", async () => {
  const genes = rows.slice(0, 10_010).map((row) => row.gene)
  const { payload, statements } = await resolve({ genes })
  assert.equal(payload.inputCount, 10_010)
  assert.equal(payload.uniqueCount, 10_000)
  assert.equal(payload.truncated, true)
  assert.equal(proteinStatements(statements).length, 100)
})

test("R5: an empty or junk paste reads nothing", async () => {
  for (const body of [{}, { genes: [] }, { text: "" }, { genes: ["", "***", "  "] }, null]) {
    const { response, payload, metered } = await resolve(body)
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(payload.uniqueCount, 0)
    assert.equal(metered.receipts.length, 0, `${JSON.stringify(body)} touched the database`)
  }
})

test("R5: a D1 error is still a 500 with the same message", async () => {
  const { response, payload } = await resolve({ genes: sampleGenes(3) }, { failProteinReads: true })
  assert.equal(response.status, 500)
  assert.deepEqual(payload, { error: "Practice resolve failed" })
})
