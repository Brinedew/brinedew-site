import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const source = readFileSync(
  new URL(
    "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)

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
  assert.match(
    discoveryFn,
    /WHERE user_id = \?[\s\S]*AND gene_symbol = \?/,
    "discovery writes should use raw primary-key equality",
  )
  assert.doesNotMatch(
    discoveryFn,
    /AND upper\(gene_symbol\) = \?/,
    "discovery hover writes must not wrap canonical gene keys",
  )

  const encounterRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/discoveries/encounter" && request.method === "POST")',
    'if (path === "/api/iconoplasm/discoveries/me" && request.method === "GET")',
  )
  assert.doesNotMatch(
    encounterRoute,
    /ensureStarterGeneDiscoveries\(/,
    "hover encounter route must not starter-seed on every hover",
  )
})

test("DO NOT DELETE: public vote hot paths keep raw asset-key predicates", () => {
  const voteSnapshotFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function iconoVoteSnapshot",
    "async function iconoVoteSnapshotsBatch",
  )
  assert.match(
    voteSnapshotFn,
    /iconoplasmVoteCoordinatorSnapshot\(/,
    "vote snapshot should ask the per-gene coordinator first",
  )
  assert.doesNotMatch(
    voteSnapshotFn,
    /SUM\(CASE WHEN vote_value/,
    "vote snapshot must not aggregate the raw vote ledger on the hot path",
  )

  const coordinatorClass = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "export class IconoplasmVoteCoordinator",
    "function voteDeltaFromTransition",
  )
  assert.match(
    coordinatorClass,
    /CREATE TABLE IF NOT EXISTS vote_by_user_asset/,
    "vote coordinator should own the per-user vote state",
  )
  assert.match(
    coordinatorClass,
    /CREATE TABLE IF NOT EXISTS asset_summary/,
    "vote coordinator should own the per-asset summary state",
  )
  assert.match(
    coordinatorClass,
    /CREATE TABLE IF NOT EXISTS vision_summary/,
    "vote coordinator should own the per-vision summary state",
  )

  const voteSetRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/votes/set" && request.method === "POST")',
    'if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST")',
  )
  assert.match(
    voteSetRoute,
    /iconoplasmVoteCoordinatorSetVote\(/,
    "single-vote writes should go through the per-gene coordinator",
  )
  assert.match(
    voteSetRoute,
    /projectVoteCoordinatorLedgerRow\(/,
    "single-vote writes should project the compatibility ledger from coordinator state",
  )
  assert.match(
    voteSetRoute,
    /scheduleVoteProjectionRefresh\(/,
    "single-vote writes should defer symbol-wide read-model refresh through the projection queue",
  )
  assert.doesNotMatch(
    voteSetRoute,
    /refreshProjectedVoteReadModelsFromCoordinatorState\(/,
    "single-vote writes must not block on symbol-wide read-model refresh",
  )
  assert.doesNotMatch(
    voteSetRoute,
    /autoPromoteTopVotedPortraitFromCoordinatorState\(/,
    "single-vote writes must not block on canon auto-promotion",
  )
  assert.doesNotMatch(
    voteSetRoute,
    /SELECT vote_value[\s\S]*FROM icono_image_votes/,
    "single-vote writes must not read the raw D1 vote ledger on the hot path",
  )
  assert.doesNotMatch(
    voteSetRoute,
    /syncVoteReadModelsAndInvalidateGallery\(|syncAdminReadModelsAndInvalidateGallery\(/,
    "single-vote writes must not call the bulk summary rebuild paths",
  )
})

test("DO NOT DELETE: canon auto-promotion must not select stale portrait assets", () => {
  const autoPromoteFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function autoPromoteTopVotedPortrait",
    "async function getArtistStyleBlacklistRow",
  )

  assert.match(
    autoPromoteFn,
    /AND COALESCE\(pa\.is_stale, 0\) = 0/,
    "automatic canon repair should ignore stale assets instead of republishing images a human already marked invalid",
  )
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
    "const geneRequestLegacyMatch = path.match(/^\\/api\\/iconoplasm\\/requests\\/gene\\/([^/]+)$/)",
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

test("DO NOT DELETE: admin gallery pages must use read-model search columns and separate totals", () => {
  const galleryFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function fetchAdminGallery",
    "async function fetchAdminGeneDetail",
  )

  assert.doesNotMatch(
    galleryFn,
    /COUNT\(\*\) OVER\(\)/,
    "admin gallery pages must not use COUNT(*) OVER() on the paginated row query",
  )
  assert.doesNotMatch(
    galleryFn,
    /upper\(gr\.gene_symbol\)|upper\(COALESCE\(gr\.full_name/,
    "admin gallery search should use normalized read-model columns, not expression scans",
  )
  assert.match(
    galleryFn,
    /gr\.search_symbol|gr\.search_full_name/,
    "admin gallery search should read the normalized search columns maintained by read-model sync",
  )
})

test("DO NOT DELETE: image edit routes stay authenticated, point-keyed, and off the generation request queue", () => {
  const routeFamilies = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function iconoplasmBudgetRouteFamilyFromPath",
    "function iconoplasmBudgetClassFromRouteFamily",
  )
  assert.match(routeFamilies, /\/api\/iconoplasm\/image-edit\/providers/)
  assert.match(routeFamilies, /\/api\/iconoplasm\/image-edit\/jobs/)
  const budgetClass = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function iconoplasmBudgetClassFromRouteFamily",
    "function iconoplasmBudgetClassFromHistoricalRouteFamilyForReport",
  )
  assert.match(budgetClass, /family\.startsWith\("image_edit_"\)[\s\S]*first_party_write/)

  const allowlist = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function isIconoplasmPathHandledInsideTheOnlyAllowedStatefulWorker",
    "function missingTheOnlyAllowedStatefulWorkerResponse",
  )
  assert.match(allowlist, /\/api\/iconoplasm\/image-edit\/providers/)
  assert.match(allowlist, /\/api\/iconoplasm\/image-edit\/jobs/)

  const sourceLookup = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function sourceImageEditAssetRow",
    "function mapImageEditJobRow",
  )
  assert.match(sourceLookup, /WHERE pa\.gene_symbol = \?[\s\S]*AND pa\.asset_sha256 = \?/)
  assert.doesNotMatch(sourceLookup, /upper\(pa\.gene_symbol\)|lower\(pa\.asset_sha256\)/i)

  const imageEditRoutes = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/image-edit/providers") {\n      if (!env.ICONOPLASM_DB)',
    'if (path === "/api/iconoplasm/candidates/copy" && request.method === "POST")',
  )
  assert.match(imageEditRoutes, /iconoplasmSessionUser\(request, env\)/)
  assert.match(imageEditRoutes, /sourceImageEditAssetRow\(/)
  assert.doesNotMatch(imageEditRoutes, /createGenerationRequest\(|listOpenGenerationRequests\(/)
})
