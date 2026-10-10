import fs from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"

import { republishGenes, staleSymbols } from "./publish-iconoplasm-catalog.mjs"

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

// B-1064: each catalogue row is read from the gene's published card. Golden: two
// live cards (genes/v3/WEE1.json and MFNG.json as published on 2026-10-09).
test("a catalogue row is the card's name, winner, colour, score, measures and date", async () => {
  const { readFileSync } = await import("node:fs")
  const { rowFromCard } = await import("./publish-iconoplasm-catalog.mjs")
  const card = (symbol) =>
    JSON.parse(
      readFileSync(
        new URL(`../workers/lib/fixtures/gene-cards/${symbol}.json`, import.meta.url),
        "utf8",
      ),
    )
  const wee1 = card("WEE1")
  assert.deepEqual(rowFromCard(wee1), [
    "WEE1",
    "WEE1 G2 checkpoint kinase",
    wee1.portrait.asset_sha256,
    "#352f35",
    1,
    null,
    71.6,
    29,
    1991,
    "2026-03-12 18:23:25",
  ])
  const mfng = card("MFNG")
  const winner = mfng.portrait_candidates.find((candidate) => candidate.is_current)
  const row = rowFromCard(mfng)
  assert.equal(row[2], mfng.portrait.asset_sha256)
  assert.equal(row[4], winner.image_score)
  assert.equal(row[9], winner.created_at)

  // A gene with no portrait yet is listed without one.
  const bare = {
    ...wee1,
    portrait: { status: "missing", asset_sha256: null },
    portrait_candidates: [],
  }
  assert.deepEqual(rowFromCard(bare).slice(2, 5), ["", "#352f35", 0])
  assert.equal(rowFromCard(bare)[9], "")
})

// B-1064: the rank compares a gene with the whole catalogue, so it comes from the
// workstation's one uniqueness file, never from a card. Failure modes: an
// unchanged row from the previous object keeps a stale rank; a gene the file
// doesn't name keeps one; a bad value reaches the sort.
test("every row takes its rank from the uniqueness file, the previous object's rows too", async () => {
  const { rowFromCard, withRanks } = await import("./publish-iconoplasm-catalog.mjs")
  const wee1 = JSON.parse(
    fs.readFileSync(new URL("../workers/lib/fixtures/gene-cards/WEE1.json", import.meta.url)),
  )
  const fresh = rowFromCard(wee1)
  const previous = ["TLX3", "T cell leukemia homeobox 3", "", "#7074a3", 0, 8.0, 31.9, 27, 1993, ""]
  const dropped = ["ACTL10", "actin like 10", "", "", 0, 4.2, 26.8, 30, 2001, ""]
  const odd = ["UBE2W", "ubiquitin conjugating enzyme E2 W", "", "", 0, null, 17.3, 26, 1994, ""]
  const ranks = new Map([
    ["WEE1", 3.25],
    ["TLX3", 11.5],
    ["UBE2W", "not a number"],
  ])

  withRanks([fresh, previous, dropped, odd], ranks)

  assert.equal(fresh[5], 3.25)
  assert.equal(previous[5], 11.5, "a row carried over from the previous object is re-ranked")
  assert.equal(dropped[5], null, "a gene the file doesn't name has no rank")
  assert.equal(odd[5], null)
})

// B-1063: the writer of a publication event rebuilds the gene's card in the same
// request, so a run republishes only the changed genes whose card is older than
// their latest event, or missing. Real cards: WEE1 published 2026-10-01 15:13:03,
// MFNG 2026-10-09 13:52:14.
test("only a card older than its gene's latest event, or a missing one, is republished", () => {
  const card = (name) =>
    JSON.parse(
      fs.readFileSync(new URL(`../workers/lib/fixtures/gene-cards/${name}.json`, import.meta.url)),
    )
  const cards = new Map([
    ["WEE1", card("WEE1")],
    ["MFNG", card("MFNG")],
    ["GONE1", null],
  ])
  const changedAt = new Map([
    ["WEE1", "2026-10-09 13:00:00"], // a vote after the card: its rebuild failed
    ["MFNG", "2026-10-09 13:52:14"], // the same second as the card: current
    ["GONE1", "2026-10-09 10:00:00"], // no card at all
  ])
  assert.deepEqual(staleSymbols(cards, changedAt), ["WEE1", "GONE1"])
})
