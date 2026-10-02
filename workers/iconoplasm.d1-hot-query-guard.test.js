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

test("DO NOT DELETE: discovery hover path is tombstoned and the compact batch route owns writes", () => {
  assert.doesNotMatch(
    source,
    /icono_gene_discoveries/,
    "activated request runtime must not retain a legacy per-hover writer or whole-membership fallback",
  )
  const encounterRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/discoveries/encounter" && request.method === "POST")',
    'if (path === "/api/iconoplasm/discoveries/batch" && request.method === "POST")',
  )
  assert.match(
    encounterRoute,
    /LEGACY_DISCOVERY_WRITER_RETIRED/,
    "the retired per-hover writer must stay a loud, write-free tombstone",
  )
  assert.doesNotMatch(
    encounterRoute,
    /recordDiscoveryEncounterAtomically\(|recordCompactDiscoveryEncounters\(|ICONOPLASM_DB\.prepare/,
    "the retired per-hover route must not touch discovery storage",
  )

  const batchRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/discoveries/batch" && request.method === "POST")',
    'if (path === "/api/iconoplasm/discoveries/membership" && request.method === "GET")',
  )
  assert.match(
    batchRoute,
    /recordCompactDiscoveryEncounters\(env, \{/,
    "signed-in hover batches must commit compact personal state",
  )
  assert.doesNotMatch(
    batchRoute,
    /ensureStarterGeneDiscoveries\(/,
    "hover batches must not starter-seed",
  )

  const compactWriter = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function recordCompactDiscoveryEncounters",
    "async function readCompactDiscoveryMembership",
  )
  assert.match(
    compactWriter,
    /recordCompactDiscoveryBatch\(db, \{/,
    "the compact recorder must go through the reviewed compact batch service",
  )
  assert.doesNotMatch(
    compactWriter,
    /INSERT INTO icono_gene_discoveries|UPDATE icono_gene_discoveries/,
    "the compact recorder must never write legacy discovery rows",
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
  // B-898 Stage 1 (step B): the endpoint reads ONE stable gene object per
  // symbol from Bunny Storage. The guard no longer looks for the KV head or
  // the card-catalog artifact reader; it now fails if either comes back, and
  // still fails on any D1 composition below.
  assert.match(cardEndpoint, /readStableGeneObject\(env, symbol\)/)
  assert.doesNotMatch(
    cardEndpoint,
    /currentMobileCardSnapshotVersion\(|readPublishedCardCatalogArtifact\(/,
    "the per-symbol card endpoint must not walk the retired KV head / manifest tree",
  )
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

// B-898 Stage 2: D1 is the only vote store. These guards replace the ones
// that pinned the per-gene coordinator, its outbox and the projection Queue;
// they are stricter where the cost now lives: every vote statement is keyed,
// nothing aggregates a gene's vote history in a request, and the winner is
// projected only under the gene's vote version. The executable proof against
// the migrated schema (EXPLAIN QUERY PLAN on every statement) is
// workers/iconoplasm.d1-votes.test.js.
const geneVotesSource = readFileSync(
  new URL("./iconoplasm/votes/gene-votes.js", import.meta.url),
  "utf8",
)
const electionSource = readFileSync(
  new URL("./iconoplasm/vote-authority/gene-authority-election.js", import.meta.url),
  "utf8",
)

test("DO NOT DELETE: a vote elects in the request under its gene's vote version and publishes after the response", () => {
  const elect = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function electGeneAfterVote",
    "async function settleGeneAfterVote",
  )
  assert.match(elect, /electAndProjectGeneWinner\(env\.ICONOPLASM_DB, symbol/)
  const settle = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function settleGeneAfterVote",
    "async function setIconoplasmVote",
  )
  assert.match(settle, /await electGeneAfterVote\(env, symbol/)
  assert.match(settle, /republishGeneAfterResponse\(env, ctx, symbol\)/)
  const afterResponse = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function republishGeneAfterResponse",
    "function republishTouchedGenesAfterResponse",
  )
  assert.match(
    afterResponse,
    /ctx\.waitUntil\(work\)/,
    "the stable-object publish must never hold or fail the vote response",
  )
  const projection = geneVotesSource.slice(
    geneVotesSource.indexOf("export async function projectGeneElection"),
    geneVotesSource.indexOf("export async function electAndProjectGeneWinner"),
  )
  assert.match(
    projection,
    /\$\{GENE_VOTE_VERSION_SQL\} = \?3/,
    "a projection applies only while the gene's vote version is the one its election read",
  )
  assert.match(projection, /COALESCE\(icono_publish_state\.admin_override, 0\) = 0/)
  assert.doesNotMatch(source, /ICONOPLASM_VOTE_COORDINATORS\b[^\n]*idFromName/)
})

test("DO NOT DELETE: public vote hot paths keep raw asset-key predicates", () => {
  for (const [name, text] of [
    ["gene-votes.js", geneVotesSource],
    ["vote routes", source],
  ]) {
    assert.doesNotMatch(
      text,
      /(upper|lower)\((v\.|vs\.|pa\.)?(gene_symbol|asset_sha256)\)\s*=\s*\?/i,
      `${name}: vote keys must stay raw so the vote indexes apply`,
    )
  }
  assert.doesNotMatch(
    geneVotesSource,
    /SUM\(|COUNT\(\*\)|GROUP BY/i,
    "a vote or snapshot must never aggregate the vote ledger; summaries move by exact deltas",
  )
  const voteSetRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/votes/set" && request.method === "POST")',
    'if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST")',
  )
  assert.match(voteSetRoute, /setIconoplasmVote\(env, ctx, \{/)
  assert.doesNotMatch(
    voteSetRoute,
    /syncAdminReadModels|rebuildVoteAssetSummaryForSymbols|SELECT[\s\S]*FROM icono_image_votes/,
    "single-vote writes must not rebuild read models or read the raw vote ledger",
  )
  const snapshotRoute = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    'if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST")',
    'if (path === "/api/iconoplasm/admin/votes/import" && request.method === "POST")',
  )
  assert.match(snapshotRoute, /iconoVoteSnapshots\(env, \{/)
  assert.doesNotMatch(snapshotRoute, /ICONOPLASM_DB\.prepare/)
  assert.match(
    geneVotesSource,
    /FROM json_each\(\?1\) AS wanted\s+CROSS JOIN icono_image_votes AS v/,
    "the caller's votes are probed per named (gene, asset, user), never by scanning the user's history",
  )
})

test("DO NOT DELETE: canon auto-promotion must not select stale portrait assets", () => {
  const autoPromoteFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function autoPromoteTopVotedPortrait",
    "async function iconoExistingAssetsBatch",
  )
  assert.match(autoPromoteFn, /electAndProjectGeneWinner\(env\.ICONOPLASM_DB, symbolNorm/)
  assert.match(
    electionSource,
    /row\.autopick_eligible && !row\.is_stale && row\.status !== "rejected"/,
    "automatic canon repair should ignore stale assets instead of republishing images a human already marked invalid",
  )
  assert.match(
    geneVotesSource,
    /lower\(status\) <> 'rejected' AND autopick_eligible = 1 AND is_stale = 0/,
    "a projection re-checks the winner's eligibility inside its own batch",
  )
})

test("DO NOT DELETE: automatic canon tie-break ranks newer assets before current-asset inertia", () => {
  const compareFn = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "function compareAdminLeaderRows",
    "async function listAdminReadModelSymbolsAfter",
  )
  DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(
    compareFn,
    'compareNullableTextDesc(left?.created_at || "", right?.created_at || "")',
    'Number(normalizeSha256(right?.asset_sha256 || "") === normalizeSha256(currentAssetSha || ""))',
    "the shared canon comparator must rank newer tied assets before preserving the existing current asset",
  )
  DO_NOT_DELETE_THIS_GUARD__assertNeedleOrder(
    electionSource,
    'compareNullableTextDesc(left?.created_at || "", right?.created_at || "")',
    "Number(normalizedSha(right?.asset_sha256) === normalizedSha(currentAssetSha))",
    "the one election must rank newer tied assets before preserving the existing current asset",
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

test("DO NOT DELETE: public change feed reads O(page), never whole tables", () => {
  // 2026-09-25: /api/public/v1/changes read all ~19k icono_publish_state rows per
  // call and defeated the updated_at indexes with COALESCE: ~40-77k D1 rows per
  // public request, so ~65-125 calls could exhaust the free plan's 5M daily reads.
  const handler = DO_NOT_DELETE_THIS_GUARD__sliceBetweenOrFailLoudly(
    "async function handlePublicChanges(request, env) {",
    "\n}\n",
  )
  assert.doesNotMatch(handler, /COALESCE\(\s*updated_at/, "wrapping updated_at defeats its index")
  const selects = handler.match(/SELECT[\s\S]*?`/g) || []
  assert.ok(selects.length >= 4, "expected the three source queries and the page lookup")
  for (const sql of selects) {
    assert.match(sql, /\bWHERE\b/, `unbounded public read: ${sql.slice(0, 80)}`)
    assert.ok(
      /\bLIMIT\b/.test(sql) || /json_each/.test(sql),
      `page-unbounded read: ${sql.slice(0, 80)}`,
    )
  }
  assert.doesNotMatch(handler, /Math\.max\(limit \* 5/, "per-source reads stay near the page size")
})
