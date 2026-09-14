import assert from "node:assert/strict"
import test from "node:test"

import {
  compareGeneAuthorityRows,
  composeGeneSelectionReference,
  electGeneAuthorityWinner,
  projectGeneAuthorityRows,
  winnerAssetShaFromSelectionReference,
} from "./gene-authority-election.js"

const sha = (char) => char.repeat(64)
const candidate = (char, overrides = {}) => ({
  asset_sha256: sha(char),
  status: "approved",
  autopick_eligible: true,
  is_stale: false,
  is_legacy: false,
  created_at: "2026-01-01T00:00:00Z",
  revision: 1,
  ...overrides,
})
const summary = (char, overrides = {}) => ({
  asset_sha256: sha(char),
  upvotes: 0,
  downvotes: 0,
  score: 0,
  vote_count: 0,
  ...overrides,
})

test("ineligible, rejected and withdrawn candidates never win", () => {
  const { winner } = electGeneAuthorityWinner({
    candidates: [
      candidate("a", { autopick_eligible: false }),
      candidate("b", { status: "rejected" }),
    ],
    summaries: [summary("a", { score: 50 })],
  })
  assert.equal(winner, null)
})

test("highest score wins and a caretaker +10 supervote outweighs ordinary votes", () => {
  const summaries = [summary("a", { score: 3 }), summary("b", { score: 12 })]
  const plain = electGeneAuthorityWinner({
    candidates: [candidate("a"), candidate("b")],
    summaries,
  })
  assert.equal(plain.winner.asset_sha256, sha("b"))
  const withSupervote = electGeneAuthorityWinner({
    candidates: [candidate("a"), candidate("b")],
    summaries,
    caretaker: { active: true, asset_sha256: sha("a"), direction: 1, supervote_version: 4 },
  })
  assert.equal(withSupervote.winner.asset_sha256, sha("a"))
  assert.equal(withSupervote.winner.caretaker_supervote, true)
})

test("negative caretaker supervote removes the weighted advantage", () => {
  const { winner } = electGeneAuthorityWinner({
    candidates: [candidate("a"), candidate("b")],
    summaries: [summary("a", { score: 3 }), summary("b", { score: 12 })],
    caretaker: { active: true, asset_sha256: sha("a"), direction: -1, supervote_version: 1 },
  })
  assert.equal(winner.asset_sha256, sha("b"))
})

test("ties prefer the currently published asset, then newest creation, then sha order", () => {
  const tie = electGeneAuthorityWinner({
    candidates: [candidate("a"), candidate("b")],
    summaries: [summary("a"), summary("b")],
    currentAssetSha: sha("b"),
  })
  assert.equal(tie.winner.asset_sha256, sha("b"))

  const newest = electGeneAuthorityWinner({
    candidates: [
      candidate("a", { created_at: "2026-01-01T00:00:00Z" }),
      candidate("b", { created_at: "2026-02-01T00:00:00Z" }),
    ],
    summaries: [summary("a"), summary("b")],
  })
  assert.equal(newest.winner.asset_sha256, sha("b"))

  const lexicographic = electGeneAuthorityWinner({
    candidates: [candidate("c"), candidate("a")],
    summaries: [summary("c"), summary("a")],
  })
  assert.equal(lexicographic.winner.asset_sha256, sha("a"))
})

test("legacy assets lose a score tie against current assets", () => {
  const { winner } = electGeneAuthorityWinner({
    candidates: [candidate("a", { is_legacy: true }), candidate("b")],
    summaries: [summary("a"), summary("b")],
    currentAssetSha: sha("a"),
  })
  assert.equal(winner.asset_sha256, sha("b"))
})

test("compareGeneAuthorityRows matches the shipped ordering on equal weighted scores", () => {
  const rows = projectGeneAuthorityRows({
    candidates: [
      candidate("a", { created_at: "2026-01-01T00:00:00Z" }),
      candidate("b", { created_at: "2026-02-01T00:00:00Z" }),
    ],
    summaries: [summary("a", { upvotes: 1 }), summary("b", { upvotes: 2 })],
  })
  const sorted = [...rows].sort(compareGeneAuthorityRows)
  assert.equal(sorted[0].asset_sha256, sha("b"))
})

test("selection reference changes only when the rendered outcome can change", () => {
  const winnerBase = candidate("a")
  const base = composeGeneSelectionReference({
    symbol: "TP53",
    winner: winnerBase,
    caretakerSupervoteVersion: 2,
    caretakerDirection: 0,
  })
  const sameOutcome = composeGeneSelectionReference({
    symbol: "TP53",
    winner: { ...winnerBase },
    caretakerSupervoteVersion: 2,
    caretakerDirection: 0,
  })
  assert.equal(base, sameOutcome)
  assert.notEqual(
    base,
    composeGeneSelectionReference({
      symbol: "TP53",
      winner: { ...winnerBase, revision: 2 },
      caretakerSupervoteVersion: 2,
      caretakerDirection: 0,
    }),
  )
  assert.notEqual(
    base,
    composeGeneSelectionReference({ symbol: "TP53", winner: null, caretakerSupervoteVersion: 2 }),
  )
  assert.equal(winnerAssetShaFromSelectionReference(base), sha("a"))
  assert.equal(winnerAssetShaFromSelectionReference(base.replace(sha("a"), "none")), null)
})
