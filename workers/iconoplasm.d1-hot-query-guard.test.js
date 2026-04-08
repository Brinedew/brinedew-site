import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js", import.meta.url), "utf8")

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
  assert.match(voteSnapshotFn, /iconoplasmVoteCoordinatorSnapshot\(/, "vote snapshot should ask the per-gene coordinator first")
  assert.doesNotMatch(voteSnapshotFn, /SUM\(CASE WHEN vote_value/, "vote snapshot must not aggregate the raw vote ledger on the hot path")

  const coordinatorClass = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "export class IconoplasmVoteCoordinator",
    "function voteDeltaFromTransition",
  )
  assert.match(coordinatorClass, /CREATE TABLE IF NOT EXISTS vote_by_user_asset/, "vote coordinator should own the per-user vote state")
  assert.match(coordinatorClass, /CREATE TABLE IF NOT EXISTS asset_summary/, "vote coordinator should own the per-asset summary state")
  assert.match(coordinatorClass, /CREATE TABLE IF NOT EXISTS vision_summary/, "vote coordinator should own the per-vision summary state")

  const voteSetRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/votes/set" && request.method === "POST")',
    'if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST")',
  )
  assert.match(voteSetRoute, /iconoplasmVoteCoordinatorSetVote\(/, "single-vote writes should go through the per-gene coordinator")
  assert.match(voteSetRoute, /projectVoteCoordinatorLedgerRow\(/, "single-vote writes should project the compatibility ledger from coordinator state")
  assert.match(voteSetRoute, /scheduleVoteProjectionRefresh\(/, "single-vote writes should defer symbol-wide read-model refresh through the projection queue")
  assert.doesNotMatch(voteSetRoute, /refreshProjectedVoteReadModelsFromCoordinatorState\(/, "single-vote writes must not block on symbol-wide read-model refresh")
  assert.doesNotMatch(voteSetRoute, /autoPromoteTopVotedPortraitFromCoordinatorState\(/, "single-vote writes must not block on canon auto-promotion")
  assert.doesNotMatch(voteSetRoute, /SELECT vote_value[\s\S]*FROM icono_image_votes/, "single-vote writes must not read the raw D1 vote ledger on the hot path")
  assert.doesNotMatch(voteSetRoute, /syncVoteReadModelsAndInvalidateGallery\(|syncAdminReadModelsAndInvalidateGallery\(/, "single-vote writes must not call the bulk summary rebuild paths")
})

test("DO NOT DELETE: request picker hot path must stay on a precomputed rollup instead of live portrait scans", () => {
  const requestOptionsFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function listGenerationRequestVisionOptions",
    "async function generationRequestSummaryPayload",
  )
  assert.match(
    requestOptionsFn,
    /FROM icono_generation_request_vision_option_rollup/,
    "request picker options should read from the dedicated rollup table",
  )
  assert.doesNotMatch(
    requestOptionsFn,
    /FROM icono_admin_vision_rollup|WITH ranked_previews AS|FROM icono_portrait_assets/,
    "request picker options must not hydrate previews from raw vision or portrait tables on the hot path",
  )

  const geneRequestRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'const geneRequestLegacyMatch = path.match(/^\\/api\\/iconoplasm\\/requests\\/gene\\/([^/]+)$/)',
    'if (path === "/api/iconoplasm/requests" && request.method === "POST")',
  )
  assert.match(
    geneRequestRoute,
    /LEGACY_GENE_REQUEST_ROUTE_REMOVED/,
    "legacy request-state route should stay deleted with a loud tombstone response",
  )
  assert.doesNotMatch(
    geneRequestRoute,
    /listGenerationRequestVisionOptions\(|listOpenGenerationRequests\(/,
    "legacy request-state route must not quietly regain mixed summary+options logic",
  )
})
