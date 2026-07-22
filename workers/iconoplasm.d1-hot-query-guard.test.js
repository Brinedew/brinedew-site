import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import {
  ICONOPLASM_ROUTE_CONTRACTS,
  matchIconoplasmRouteContract,
} from "./iconoplasm-route-contract.js"

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

function DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(haystack, before, after, message) {
  const beforeIndex = haystack.indexOf(before)
  const afterIndex = haystack.indexOf(after)
  assert.notEqual(beforeIndex, -1, `Missing required earlier fragment: ${before}`)
  assert.notEqual(afterIndex, -1, `Missing required later fragment: ${after}`)
  assert.ok(beforeIndex < afterIndex, message)
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

test("DO NOT DELETE: per-symbol card endpoint stays KV-backed and version-barrier safe", () => {
  const getContract = matchIconoplasmRouteContract("/api/iconoplasm/cards/TP53", "GET")
  const headContract = matchIconoplasmRouteContract("/api/iconoplasm/cards/TP53", "HEAD")
  const postContract = matchIconoplasmRouteContract("/api/iconoplasm/cards/TP53", "POST")
  assert.equal(getContract?.route.id, "mobile_card_symbol")
  assert.equal(getContract?.route.budgetFamily, "mobile_card_symbol")
  assert.equal(getContract?.route.gatewayHandler, "mobile_card_symbol")
  assert.equal(getContract?.methodAllowed, true)
  assert.equal(headContract?.methodAllowed, true)
  assert.equal(postContract?.methodAllowed, false)

  const budgetClass = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function iconoplasmBudgetClassFromRouteFamily",
    "function iconoplasmBudgetClassFromHistoricalRouteFamilyForReport",
  )
  assert.match(budgetClass, /family === "mobile_card_symbol"[\s\S]{0,80}return "first_party_read"/)

  const cardEndpoint = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function handleMobileCardSymbol",
    "// DO NOT DELETE: per-symbol card endpoint guard boundary.",
  )
  assert.match(cardEndpoint, /caches\.default/)
  assert.match(cardEndpoint, /const symbol = normalizeSymbol\(symbolFromPath\)/)
  assert.match(cardEndpoint, /currentMobileCardSnapshotVersion\(env\)/)
  assert.match(cardEndpoint, /readPublishedCardCatalogArtifact\(env, snapshotVersion, \[symbol\]\)/)
  assert.doesNotMatch(
    cardEndpoint,
    /s-maxage=86400|stale-while-revalidate=604800/,
    "unversioned /api/iconoplasm/cards/:symbol responses must not be externally cacheable outside KV_GALLERY_VERSION",
  )
  assert.doesNotMatch(
    cardEndpoint,
    /normalizedSymbol\(|geneRecord\(|getPublishedPortraitsForSymbols\(|ICONOPLASM_DB\.prepare/,
    "critical per-symbol card endpoint must not fall back to D1 composition",
  )
})

test("DO NOT DELETE: vote projection promotion is Queue-backed, not request waitUntil-backed", () => {
  const scheduler = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function scheduleVoteProjectionRefresh",
    "async function listAutopromoteCandidateAssetsForSymbol",
  )
  assert.match(
    scheduler,
    /sendVoteProjectionRefreshQueueMessage\(/,
    "public votes must enqueue a real Cloudflare Queue drain for canonical promotion",
  )
  assert.doesNotMatch(
    scheduler,
    /processVoteProjectionRefreshForSymbol\(/,
    "public votes must not start canonical promotion directly from the request path",
  )
  assert.doesNotMatch(
    scheduler,
    /ctx\?\.waitUntil|ctx\.waitUntil/,
    "waitUntil can be interrupted after D1 promotion and before rich-detail read models settle",
  )

  const voteProjectionBatch = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function processVoteProjectionRefreshJobBatch",
    "async function processVoteProjectionRefreshForSymbol",
  )
  assert.doesNotMatch(
    voteProjectionBatch,
    /invalidateGalleryCache\(|publishCardCatalogArtifact\(|assertIconoplasmCardCatalogBudgetPreflight\(/,
    "vote projection must not republish the broad KV card catalog or require its KV-heavy budget preflight",
  )

  const wrapper = source.includes("handleIconoplasmQueue")
  assert.equal(wrapper, true, "the Worker queue handler must dispatch Iconoplasm Queue messages")
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
    coordinatorClass,
    /CREATE TABLE IF NOT EXISTS vote_outbox/,
    "the coordinator transaction should persist projection intent beside the vote",
  )
  assert.match(
    coordinatorClass,
    /deliverOutboxRow[\s\S]*projectVoteCoordinatorLedgerRow\([\s\S]*appendVoteEvent\([\s\S]*scheduleVoteProjectionRefresh\(/,
    "the durable outbox drain should own compatibility, audit, and read-model handoff",
  )
  assert.doesNotMatch(
    voteSetRoute,
    /projectVoteCoordinatorLedgerRow\(|appendVoteEvent\(|scheduleVoteProjectionRefresh\(/,
    "a successful coordinator commit must not be turned into a request failure by downstream projection",
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

test("DO NOT DELETE: automatic canon tie-break ranks newer assets before current-asset inertia", () => {
  const compareFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function compareAdminLeaderRows",
    "async function listAdminReadModelSymbols",
  )
  DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(
    compareFn,
    'compareNullableTextDesc(left?.created_at || "", right?.created_at || "")',
    'Number(normalizeSha256(right?.asset_sha256 || "") === normalizeSha256(currentAssetSha || ""))',
    "the shared canon comparator must rank newer tied assets before preserving the existing current asset",
  )

  const autoPromoteFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function autoPromoteTopVotedPortrait",
    "async function getArtistStyleBlacklistRow",
  )
  const autoPromoteOrderBy = autoPromoteFn.slice(autoPromoteFn.indexOf("ORDER BY"))
  DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(
    autoPromoteOrderBy,
    "COALESCE(pa.created_at, '') DESC",
    "WHEN pa.asset_sha256 = ?",
    "direct D1 auto-promotion SQL must rank newer tied assets before preserving the existing current asset",
  )

  const readModelCurrentNeedle =
    "CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC"
  const readModelCreatedNeedle = "COALESCE(ab.created_at, '') DESC"
  let searchFrom = 0
  let checkedBlocks = 0
  while (true) {
    const currentIndex = source.indexOf(readModelCurrentNeedle, searchFrom)
    if (currentIndex === -1) break
    const blockStart = source.lastIndexOf("ROW_NUMBER() OVER", currentIndex)
    assert.notEqual(blockStart, -1, "read-model current tiebreak must live inside a window rank")
    const rankingBlock = source.slice(blockStart, currentIndex + readModelCurrentNeedle.length)
    DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(
      rankingBlock,
      readModelCreatedNeedle,
      readModelCurrentNeedle,
      "admin read-model leader SQL must mirror the newer-before-current canon tie-break",
    )
    checkedBlocks += 1
    searchFrom = currentIndex + readModelCurrentNeedle.length
  }
  assert.ok(checkedBlocks >= 2, "expected to guard both admin read-model ranked-candidate queries")
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
  for (const routeId of [
    "image_edit_providers",
    "image_edit_jobs_create",
    "image_edit_job",
    "image_edit_job_publish",
    "candidate_generation_jobs_create",
    "candidate_generation_job",
    "candidate_generation_job_publish",
  ]) {
    const route = ICONOPLASM_ROUTE_CONTRACTS.find((entry) => entry.id === routeId)
    assert.ok(route, `${routeId} must stay in the declarative route contract`)
    assert.match(String(route.auth), /authenticated/)
    assert.match(route.budgetFamily, /^(?:image_edit|candidate_generation)_/)
  }
  const budgetClass = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function iconoplasmBudgetClassFromRouteFamily",
    "function iconoplasmBudgetClassFromHistoricalRouteFamilyForReport",
  )
  assert.match(budgetClass, /family\.startsWith\("image_edit_"\)[\s\S]*first_party_write/)
  assert.match(budgetClass, /family\.startsWith\("candidate_generation_"\)[\s\S]*first_party_write/)

  const sourceLookup = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function sourceImageEditAssetRow",
    "function mapImageEditJobRow",
  )
  assert.match(sourceLookup, /WHERE pa\.gene_symbol = \?[\s\S]*AND pa\.asset_sha256 = \?/)
  assert.doesNotMatch(sourceLookup, /upper\(pa\.gene_symbol\)|lower\(pa\.asset_sha256\)/i)

  const candidateGeneLookup = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function candidateGenerationGeneContext",
    "function buildCandidateGenerationPrompt",
  )
  assert.match(
    candidateGeneLookup,
    /WHERE gc\.gene_symbol = \?/,
    "candidate generation should use canonical gene-symbol equality",
  )
  assert.doesNotMatch(
    candidateGeneLookup,
    /upper\(gc\.gene_symbol\)|lower\(gc\.gene_symbol\)/i,
    "candidate generation must not wrap the canonical gene key in hot-path expressions",
  )

  const imageEditRoutes = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/image-edit/providers") {\n      if (!env.ICONOPLASM_DB)',
    'if (path === "/api/iconoplasm/candidates/copy" && request.method === "POST")',
  )
  assert.match(imageEditRoutes, /iconoplasmSessionUser\(request, env\)/)
  assert.match(imageEditRoutes, /sourceImageEditAssetRow\(/)
  assert.doesNotMatch(imageEditRoutes, /candidateGenerationOptionRow\(/)
  assert.doesNotMatch(imageEditRoutes, /loadCandidateGenerationReferenceImages\(/)
  assert.doesNotMatch(imageEditRoutes, /icono_generation_request_vision_option_rollup/)
  assert.match(imageEditRoutes, /reference_assets_json:\s*"\[\]"/)
  assert.doesNotMatch(imageEditRoutes, /createGenerationRequest\(|listOpenGenerationRequests\(/)
})
