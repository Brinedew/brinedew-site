import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./iconoplasm-gateway.js", import.meta.url), "utf8")

// DO NOT DELETE THIS FILE.
//
// This is the cheap tripwire for the expensive mistake. It does not try to prove
// runtime correctness by itself; it proves the SQL shape and route wiring have not
// drifted back into the exact patterns that already burned real money.

function DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `Missing marker: ${startMarker}`)
  const end = endMarker ? source.indexOf(endMarker, start) : -1
  assert.notEqual(end, -1, `Missing marker: ${endMarker}`)
  return source.slice(start, end)
}

test("DO NOT DELETE: discovery hover path keeps canonical discovery keys raw", () => {
  const discoveryFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function recordGeneDiscoveryEncounter",
    "async function ensureStarterGeneDiscoveries",
  )
  assert.match(discoveryFn, /WHERE user_id = \?[\s\S]*AND gene_symbol = \?/, "discovery writes should use raw primary-key equality")
  assert.doesNotMatch(discoveryFn, /AND upper\(gene_symbol\) = \?/, "discovery hover writes must not wrap canonical gene keys")

  const encounterRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/discoveries/encounter" && request.method === "POST")',
    'if (path === "/api/iconoplasm/discoveries/me" && request.method === "GET")',
  )
  assert.doesNotMatch(encounterRoute, /ensureStarterGeneDiscoveries\(/, "hover encounter route must not starter-seed on every hover")
})

test("DO NOT DELETE: public vote hot paths keep raw asset-key predicates", () => {
  const voteSnapshotFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function iconoVoteSnapshot",
    "async function iconoVoteSnapshotsBatch",
  )
  assert.match(voteSnapshotFn, /WHERE gene_symbol = \?[\s\S]*AND asset_sha256 = \?/, "vote snapshot should use the asset index")
  assert.doesNotMatch(voteSnapshotFn, /upper\(gene_symbol\)|lower\(asset_sha256\)/, "vote snapshot must not wrap canonical asset keys")
  assert.match(voteSnapshotFn, /FROM icono_vote_asset_summary/, "vote snapshot should read the per-asset summary")
  assert.match(voteSnapshotFn, /FROM icono_admin_vision_rollup/, "vote snapshot should read the per-vision rollup")
  assert.doesNotMatch(voteSnapshotFn, /SUM\(CASE WHEN vote_value/, "vote snapshot must not aggregate the raw vote ledger on the hot path")

  const autoPromoteFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function autoPromoteTopVotedPortrait",
    "async function getArtistStyleBlacklistRow",
  )
  assert.match(autoPromoteFn, /WHERE gene_symbol = \?/, "auto-promote should filter by raw gene symbol")
  assert.doesNotMatch(autoPromoteFn, /upper\(gene_symbol\)|lower\(asset_sha256\)/, "auto-promote must stay on raw asset-key predicates")
  assert.match(autoPromoteFn, /LEFT JOIN icono_vote_asset_summary/, "auto-promote should rank from the vote summary read model")
  assert.doesNotMatch(autoPromoteFn, /WITH vote_agg AS|SUM\(CASE WHEN vote_value/, "auto-promote must not rebuild vote aggregates from the raw ledger")

  const voteSetRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/votes/set" && request.method === "POST")',
    'if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST")',
  )
  assert.match(voteSetRoute, /WHERE gene_symbol = \?[\s\S]*AND asset_sha256 = \?[\s\S]*AND user_id = \?/, "vote writes should use the asset+user unique guard")
  assert.doesNotMatch(voteSetRoute, /upper\(gene_symbol\)|lower\(asset_sha256\)/, "vote writes must not wrap canonical asset keys")
  assert.match(voteSetRoute, /applyVoteDeltaToAssetSummary\(/, "single-vote writes should update the summary incrementally")
  assert.match(voteSetRoute, /refreshVoteReadModelsAfterHotWrite\(/, "single-vote writes should refresh only the narrow post-vote read models")
  assert.doesNotMatch(voteSetRoute, /syncVoteReadModelsAndInvalidateGallery\(|syncAdminReadModelsAndInvalidateGallery\(/, "single-vote writes must not call the bulk summary rebuild paths")
})
