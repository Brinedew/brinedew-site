// The practice "paste your own gene list" box resolves in the browser (B-934), from the static
// protein index, with the module quartz/static/geneguessr/practice-resolve.js. It replaced
// POST /api/game/practice/resolve, which cost about three D1 rows per pasted symbol and one
// Worker request per paste.
//
// Golden test. workers/fixtures/practice-resolve-golden.json holds what the deleted route
// answered for real inputs, recorded through the real Worker on a real local D1 at origin/main
// 3b6a8868. The module must give the same answer for every one of them. It also pins the one
// answer that changed on purpose, and the old-index fallback.
//
// Ways this can fail, written before the code:
//  1. a pasted symbol is cleaned differently (case, padding, edge punctuation, "-", digits only)
//  2. aliases or partial matches start resolving (MARCH1 must stay unrecognized, MARCHF1 found)
//  3. duplicates are counted twice, or the 10,000-distinct cut and `truncated` change
//  4. an empty paste gets a `truncated` field the route did not send
//  5. a protein with a structure source but a recorded structure failure reads as playable, so a
//     player is offered a protein the game cannot show (the route said playable; that was the bug)
//  6. an index file written before `recognized_unplayable` existed breaks the box instead of
//     reading those symbols as unrecognized
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildProteinIndex } from "../scripts/export-geneguessr-protein-index.mjs"
import {
  PRACTICE_RESOLVE_MAX_INPUTS,
  buildPracticeLookup,
  resolvePracticeGenes,
} from "../quartz/static/geneguessr/practice-resolve.js"

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/practice-resolve-golden.json", import.meta.url), "utf8"),
)

// The index the browser downloads, for the catalog the golden answers were recorded against:
// a protein with a structure source is playable, one without is recognized but unplayable.
const [PLAYABLE, UNPLAYABLE] = [
  golden.catalog.filter((row) => row[6]),
  golden.catalog.filter((row) => !row[6]),
]
const index = buildProteinIndex(
  PLAYABLE.map(([uniprot, gene, surname, name, length]) => ({
    uniprot,
    gene,
    gene_surname: surname,
    full_name: name,
    length,
    synonyms: "[]",
  })),
  UNPLAYABLE.map(([, gene]) => ({ gene })),
)
const lookup = buildPracticeLookup(index)

// The page splits a text paste itself; the route split a `text` body the same way.
const genesOf = (body) => body.genes ?? body.text.split(/[,\s;]+/g)

for (const [name, recorded] of Object.entries(golden.cases)) {
  if (recorded.bodyGenerated) continue
  test(`golden: ${name}`, () => {
    assert.deepEqual(resolvePracticeGenes(lookup, genesOf(recorded.body)), recorded.response)
  })
}

test("golden: more than 10,000 distinct symbols are cut at 10,000 and say so", () => {
  const recorded = golden.cases["more than 10,000 distinct symbols"].response
  const catalogGenes = golden.catalog.map((row) => row[1])
  const pasted = Array.from({ length: 10010 }, (_, i) => (i < 9 ? catalogGenes[i] : `ZZZ${i}`))
  const answer = resolvePracticeGenes(lookup, pasted)
  assert.equal(PRACTICE_RESOLVE_MAX_INPUTS, 10000)
  const { unrecognized, ...rest } = answer
  const { unrecognizedCount, ...recordedRest } = recorded
  assert.deepEqual(rest, recordedRest)
  assert.equal(unrecognized.length, unrecognizedCount)
})

test("a protein with a structure source but a recorded structure failure is recognized but unplayable", () => {
  // Through the real index builder, as the nightly export feeds it: BROKEN has a source and a
  // failure row, so the export lists it as unplayable and leaves it out of the playable rows.
  const exported = buildProteinIndex(
    [{ uniprot: "P00001", gene: "TP53", full_name: "p53", length: 393, synonyms: "[]" }],
    [{ gene: "BROKEN" }, { gene: "NOSTRUCT" }, { gene: "TP53" }],
  )
  assert.deepEqual(exported.recognized_unplayable, ["BROKEN", "NOSTRUCT"], "TP53 stays playable")
  const answer = resolvePracticeGenes(buildPracticeLookup(exported), ["broken", "TP53", "NOPE"])
  assert.deepEqual(answer.playable, [{ gene: "TP53", uniprot: "P00001" }])
  assert.deepEqual(answer.recognizedUnplayable, ["BROKEN"])
  assert.deepEqual(answer.unrecognized, ["NOPE"])
  assert.equal(answer.recognizedCount, 2)
})

test("an index without recognized_unplayable still works: those symbols read as unrecognized", () => {
  const { recognized_unplayable: _dropped, ...oldIndex } = index
  const answer = resolvePracticeGenes(buildPracticeLookup(oldIndex), ["TP53", "ABT1"])
  assert.deepEqual(answer.playable, [{ gene: "TP53", uniprot: "P04637" }])
  assert.deepEqual(answer.unrecognized, ["ABT1"])
  assert.deepEqual(answer.recognizedUnplayable, [])
})

test("an index of an unknown shape is refused, not guessed at", () => {
  assert.throws(
    () => buildPracticeLookup({ schema_version: 2, fields: [], rows: [] }),
    /unknown shape/,
  )
})
