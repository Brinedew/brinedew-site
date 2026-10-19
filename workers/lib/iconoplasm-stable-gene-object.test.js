import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  compareGeneObject,
  inputsFromGeneObject,
} from "../../scripts/compare-stable-gene-object-builder.mjs"
import { buildStableGeneObject } from "./iconoplasm-stable-gene-object.js"

// ARCHITECTURE FENCE [IPD-011]: one builder of the stable gene object (B-1063).
// Golden tests on live gene objects (genes/v3/WEE1.json and MFNG.json as published on
// 2026-10-09, private tags removed). Failure modes written before the builder:
// 1. a live gene object, split into the factory's content and the readers' facts,
//    doesn't rebuild to itself (a field renamed, dropped, reformatted or
//    reordered in the pool);
// 2. the winner rule disagrees with the portrait the object shows;
// 3. a vote that puts another portrait ahead doesn't move the winner, the
//    pool order and is_current together;
// 4. an administrator's pin loses to votes, or a pin on a portrait that left
//    the pool leaves the gene without a portrait;
// 5. a rejected portrait shows or wins; a stale one wins;
// 6. a gene with no portrait yet gets no gene object shape readers understand;
// 7. private text fields (tags, B-859) or hidden prose reach the object;
// 8. a missing number is published as 0.
const fixture = (symbol) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/gene-objects/${symbol}.json`, import.meta.url), "utf8"),
  )
const at = () => "2026-10-09T18:00:00.000Z"

test("live gene objects rebuild to themselves and the winner rule picks their portrait", () => {
  for (const symbol of ["WEE1", "MFNG"]) {
    const result = compareGeneObject(fixture(symbol))
    assert.deepEqual(result.fields, [], `${symbol} differs at ${result.fields.join(", ")}`)
    assert.equal(result.winner_matches, true, `${symbol}: the winner rule picks another portrait`)
  }
})

test("a vote that puts another portrait ahead moves the winner", () => {
  const geneObject = fixture("WEE1")
  const { content, facts } = inputsFromGeneObject(geneObject)
  const [first, second] = geneObject.portrait_candidates
  facts.votes = facts.votes.map((tally) =>
    tally.asset_sha256 === second.asset_sha256 ? { ...tally, upvotes: 3, score: 3 } : tally,
  )
  const rebuilt = buildStableGeneObject(content, facts, { now: at })
  assert.equal(rebuilt.portrait.asset_sha256, second.asset_sha256)
  assert.deepEqual(
    rebuilt.portrait_candidates.map((candidate) => [candidate.asset_sha256, candidate.is_current]),
    [
      [second.asset_sha256, true],
      [first.asset_sha256, false],
    ],
  )
  assert.equal(rebuilt.portrait.hero_url, second.full_url)
})

test("a pin beats votes while its portrait is in the pool, and falls back when it leaves", () => {
  const geneObject = fixture("WEE1")
  const { content, facts } = inputsFromGeneObject(geneObject)
  const [first, second] = geneObject.portrait_candidates
  facts.votes = facts.votes.map((tally) =>
    tally.asset_sha256 === second.asset_sha256 ? { ...tally, upvotes: 9, score: 9 } : tally,
  )
  const pinned = buildStableGeneObject(content, { ...facts, pin: first.asset_sha256 }, { now: at })
  assert.equal(pinned.portrait.asset_sha256, first.asset_sha256)
  const gone = buildStableGeneObject(content, { ...facts, pin: "f".repeat(64) }, { now: at })
  assert.equal(gone.portrait.asset_sha256, second.asset_sha256)
})

test("rejected portraits leave the pool; stale ones stay but can't win", () => {
  const geneObject = fixture("WEE1")
  const { content, facts } = inputsFromGeneObject(geneObject)
  const [first, second] = geneObject.portrait_candidates
  const mark = (fields) =>
    content.portraits.map((portrait) =>
      portrait.asset_sha256 === first.asset_sha256 ? { ...portrait, ...fields } : portrait,
    )
  const rejected = buildStableGeneObject(
    { ...content, portraits: mark({ status: "rejected" }) },
    facts,
    {
      now: at,
    },
  )
  assert.equal(rejected.candidate_count, 1)
  assert.equal(rejected.portrait.asset_sha256, second.asset_sha256)
  const stale = buildStableGeneObject({ ...content, portraits: mark({ is_stale: true }) }, facts, {
    now: at,
  })
  assert.equal(stale.candidate_count, 2)
  assert.equal(stale.portrait.asset_sha256, second.asset_sha256)
})

test("a gene with no portrait yet gets the missing-portrait gene object", () => {
  const { content, facts } = inputsFromGeneObject(fixture("MFNG"))
  const geneObject = buildStableGeneObject({ ...content, portraits: [] }, facts, { now: at })
  assert.equal(geneObject.portrait.status, "missing")
  assert.equal(geneObject.portrait.asset_sha256, null)
  assert.deepEqual(geneObject.portrait_candidates, [])
  assert.equal(geneObject.candidate_count, 0)
  assert.equal(geneObject.full_name, "MFNG O-fucosylpeptide 3-beta-N-acetylglucosaminyltransferase")
})

test("private text fields and hidden prose never reach the gene object", () => {
  const { content, facts } = inputsFromGeneObject(fixture("WEE1"))
  const manifestation = {
    ...fixture("WEE1").canonical_manifestation,
    accepted_tags_derivative: { tags_text: "checkpoint_guardian" },
    prose: "Hidden draft",
    public_page_visible: false,
  }
  const hidden = buildStableGeneObject(content, { ...facts, manifestation }, { now: at })
  assert.doesNotMatch(JSON.stringify(hidden), /checkpoint_guardian|Hidden draft/)
  const shown = buildStableGeneObject(
    content,
    { ...facts, manifestation: { ...manifestation, public_page_visible: true } },
    { now: at },
  )
  assert.equal(shown.canonical_manifestation.prose, "Hidden draft")
  assert.doesNotMatch(JSON.stringify(shown), /checkpoint_guardian/)
})

test("a missing number stays missing instead of becoming 0", () => {
  const { content, facts } = inputsFromGeneObject(fixture("WEE1"))
  content.essence.first_publication_year = null
  const geneObject = buildStableGeneObject(content, facts, { now: at })
  assert.equal("first_publication_year" in geneObject, false)
})
