// A guess's similarity reads two embedding rows (B-957: the guess answers with its score, so this
// read is on the guess's own path). A row on production holds 800 B of HiG2Vec, 2,560 B of SaProt
// and 5,120 B of ESM2 (read-only, 2026-10-03), and 15% of rows have no SaProt (455 of the first
// 3,000), for which ESM2 is the sequence signal. D1 hands every BLOB over as an array of numbers,
// so the bytes a read names are bytes the Worker parses and decodes.
//
// Failure modes this file proves, each written before the code that fixes it:
//   E1  the score differs from the one the whole-row read computed: for two rows with SaProt, for a
//       guess or a target with none (the ESM2 fallback), for a ladder neighbour, for HiG2Vec alone
//       and for a gene with no row (the golden values below come from the whole-row read)
//   E2  a row with SaProt still carries its 5,120 ESM2 bytes over the wire, which nothing reads
//   E3  the ESM2 read is made for a pair that has SaProt, or is not made for one that has none
//   E4  an embeddings read that fails is swallowed in the store, hiding it from the guess handler
//       that decides what a failure means
import assert from "node:assert/strict"
import test from "node:test"

import { getBlendedSimilarity, getHig2vecSimilarity } from "./lib/protein-store.js"
import { embeddingRow } from "./daily-selection-pool-test-d1.js"

// Genes by what their row holds.
const FULL = ["EMB1", "EMB2", "EMB3"] // HiG2Vec, SaProt and ESM2
const NO_SAPROT = ["EMB4", "EMB5"] // HiG2Vec and ESM2 only
const ROWS = new Map([
  ...FULL.map((gene) => [gene, embeddingRow(gene)]),
  ...NO_SAPROT.map((gene) => [gene, embeddingRow(gene, { saprot: false })]),
])

// A D1 that answers `SELECT <columns> FROM protein_embeddings_old WHERE gene_symbol = ?` with
// the named columns of the gene's row, BLOBs as arrays of numbers as the binding hands them
// over, and records each statement and the bytes it returned.
function embeddingsDb({ fail = false } = {}) {
  const statements = []
  return {
    statements,
    prepare(sql) {
      return {
        bind(gene) {
          return {
            async first() {
              if (fail) throw new Error("D1 unavailable")
              const columns = sql
                .match(/SELECT\s+([\s\S]*?)\s+FROM/i)[1]
                .split(",")
                .map((column) => column.trim())
              const row = ROWS.get(gene)
              const answer = row
                ? Object.fromEntries(
                    columns.map((column) => [
                      column,
                      row[column] instanceof Uint8Array ? Array.from(row[column]) : row[column],
                    ]),
                  )
                : null
              statements.push({
                gene,
                columns,
                bytes: answer
                  ? columns.reduce((sum, column) => sum + (row[column]?.length ?? 0), 0)
                  : 0,
              })
              return answer
            },
          }
        },
      }
    },
  }
}

const NEIGHBOURS = [{ gene: "EMB2", similarity: 0.93 }]
// [guess, target, neighbours]
const PAIRS = [
  ["EMB1", "EMB3", null],
  ["EMB2", "EMB3", NEIGHBOURS],
  ["EMB4", "EMB3", null],
  ["EMB1", "EMB5", null],
  ["EMB4", "EMB5", null],
  ["EMB1", "EMB9", null],
]

// The numbers the whole-row read computed for these rows, before the read changed.
const GOLDEN = {
  blended: [
    { blended: 45, isLadder: false, ladderRank: null },
    { blended: 44, isLadder: true, ladderRank: 1 },
    { blended: 47, isLadder: false, ladderRank: null },
    { blended: 50, isLadder: false, ladderRank: null },
    { blended: 50, isLadder: false, ladderRank: null },
    { blended: null, isLadder: false, ladderRank: null },
  ],
  hig2vec: [26, 25],
}

test("E1: every pair scores as it did when the whole row was read", async () => {
  const got = []
  for (const [guess, target, neighbours] of PAIRS) {
    got.push(
      await getBlendedSimilarity(embeddingsDb(), guess, target, { targetNeighbors: neighbours }),
    )
  }
  if (process.env.CAPTURE_GOLDEN) {
    console.log(
      JSON.stringify({
        blended: got,
        hig2vec: [
          await getHig2vecSimilarity(embeddingsDb(), "EMB1", "EMB3"),
          await getHig2vecSimilarity(embeddingsDb(), "EMB4", "EMB5"),
        ],
      }),
    )
  }
  assert.deepEqual(got, GOLDEN.blended)
  assert.equal(await getHig2vecSimilarity(embeddingsDb(), "EMB1", "EMB3"), GOLDEN.hig2vec[0])
  assert.equal(await getHig2vecSimilarity(embeddingsDb(), "EMB4", "EMB5"), GOLDEN.hig2vec[1])
})

test("E2, E3: a pair with SaProt reads no ESM2 bytes; a pair without it reads them", async () => {
  // Fresh genes: the store keeps rows it has read, so these are read for the first time here.
  for (const gene of ["EMB1", "EMB2", "EMB3"]) ROWS.set(`${gene}X`, embeddingRow(gene))
  const full = embeddingsDb()
  await getBlendedSimilarity(full, "EMB1X", "EMB3X")
  assert.ok(full.statements.length >= 2, "both rows are read")
  for (const read of full.statements) {
    assert.ok(
      !read.columns.includes("esm2_vector"),
      `${read.gene}: ESM2 named for a pair with SaProt`,
    )
    assert.ok(read.bytes <= 800 + 2560, `${read.gene}: ${read.bytes} bytes for HiG2Vec and SaProt`)
  }
  assert.equal(full.statements.length, 2, "one statement per row")

  for (const gene of ["EMB4", "EMB5"]) ROWS.set(`${gene}X`, embeddingRow(gene, { saprot: false }))
  const legacy = embeddingsDb()
  await getBlendedSimilarity(legacy, "EMB4X", "EMB5X")
  assert.ok(
    legacy.statements.some((read) => read.columns.includes("esm2_vector")),
    "a pair with no SaProt falls back to ESM2 and reads it",
  )
})

test("E4: a failing read reaches the caller", async () => {
  await assert.rejects(
    getBlendedSimilarity(embeddingsDb({ fail: true }), "EMB1Y", "EMB3Y"),
    /D1 unavailable/,
  )
})
