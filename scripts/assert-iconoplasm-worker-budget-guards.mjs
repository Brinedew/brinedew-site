import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const worker = readFileSync(
  new URL(
    "../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const routeContract = readFileSync(
  new URL("../workers/iconoplasm-route-contract.js", import.meta.url),
  "utf8",
)
const readModelRoutes = readFileSync(
  new URL("../workers/iconoplasm-admin-read-model-routes.js", import.meta.url),
  "utf8",
)
const publicationAliasPolicyTests = readFileSync(
  new URL("../workers/iconoplasm-publication-alias-policy.test.js", import.meta.url),
  "utf8",
)
const recognitionValidationIndex = readFileSync(
  new URL("../workers/iconoplasm-recognition-validation-index.js", import.meta.url),
  "utf8",
)
const recognitionValidationIndexTests = readFileSync(
  new URL("../workers/iconoplasm-recognition-validation-index.test.js", import.meta.url),
  "utf8",
)
const publicationAliasRoute = readFileSync(
  new URL("../workers/iconoplasm-admin-publication-alias-routes.js", import.meta.url),
  "utf8",
)
const extensionBlocklistRoute = readFileSync(
  new URL("../workers/iconoplasm-admin-extension-blocklist-routes.js", import.meta.url),
  "utf8",
)
const recognitionReconciliation = readFileSync(
  new URL("../workers/iconoplasm-recognition-policy-reconciliation.js", import.meta.url),
  "utf8",
)
const workflow = readFileSync(
  new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
  "utf8",
)
const refreshWorkflow = readFileSync(
  new URL("../.github/workflows/refresh-iconoplasm-observability-snapshot.yml", import.meta.url),
  "utf8",
)
const budgetWatchWorkflow = readFileSync(
  new URL("../.github/workflows/iconoplasm-cloudflare-budget-watch.yml", import.meta.url),
  "utf8",
)
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const npmrc = readFileSync(new URL("../.npmrc", import.meta.url), "utf8")

function includesOrFail(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message)
}

function doesNotMatchOrFail(haystack, pattern, message) {
  assert.doesNotMatch(haystack, pattern, message)
}

// This is not a style lint. It is a deploy-drift brake.
//
// The 2026-05 sync recovery was first fixed by a direct Worker deploy, then the
// canonical deploy path later overwrote critical budget/finalization behavior.
// That made the GUI button look like it had regressed "by itself". This script
// intentionally checks for loud strings that encode non-negotiable behavior:
// pending-finalize jobs must be allowed to complete without per-scope KV
// publishes, public hot paths must keep the shared KV barrier, and GitHub deploy
// must run the protected cost tests under pnpm with a 24-hour release-age delay.
// If one of these strings changes because the implementation legitimately moved,
// replace this guard with an equally loud behavioral check in the same commit.
// Do not remove it just because a refactor made the string assertion annoying.
includesOrFail(
  worker,
  "ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE",
  "Worker must keep the pending-finalize phase.",
)
includesOrFail(
  worker,
  "Prefer jobs that are already closest to completed_pending_finalize",
  "Worker must keep the pending-finalize ordering guard.",
)
includesOrFail(
  worker,
  "scoped_finalize_only",
  "Worker must keep scoped pending-finalize completion without global publish.",
)
includesOrFail(
  worker,
  "pending_finalize_bulk_complete",
  "Worker must keep the mixed-ledger pending-finalize bulk-complete path.",
)
includesOrFail(
  worker,
  "global_finalize_deferred",
  "Worker must be explicit when global gallery/card-catalog publish is deferred.",
)
includesOrFail(
  worker,
  "currentGalleryVersionBarrier",
  "Worker must keep the shared gallery version barrier.",
)
includesOrFail(
  worker,
  "CARD_CATALOG_DIRTY_SHARD_PUBLICATION_MAX_KV_WRITES",
  "Worker must reserve the bounded dirty-shard publication step ceiling.",
)
doesNotMatchOrFail(
  worker,
  /CARD_CATALOG_ARTIFACT_FULL_PUBLISH_KV_WRITE_HEADROOM|async function publishCardCatalogArtifact\(/,
  "Worker must not retain a whole-catalog routine publication path or budget name.",
)
doesNotMatchOrFail(
  routeContract,
  /\/card-vms\/warm|admin_read_models\.card_artifacts_warm/,
  "Route contract must not expose the retired whole-catalog-shaped warm endpoint.",
)
doesNotMatchOrFail(
  readModelRoutes,
  /CARD_ARTIFACT_REQUIRES_FULL_CATALOG|invalidate_gallery|invalidateGalleryCache/,
  "Read-model routes must use explicit dirty-shard publication naming.",
)
includesOrFail(
  worker,
  "reserve-card-catalog-kv-writes",
  "Worker must keep the shared card-catalog KV write budget reservation endpoint.",
)

includesOrFail(
  workflow,
  "corepack prepare pnpm@11.0.9 --activate",
  "Production workflow must install pnpm explicitly after Node 22 is active.",
)
includesOrFail(
  workflow,
  "pnpm config set minimumReleaseAge 1440",
  "Production workflow must enforce pnpm minimumReleaseAge.",
)
includesOrFail(
  workflow,
  "workers/iconoplasm.d1-cost-barrier.test.js",
  "Production workflow must run the D1 cost barrier test.",
)
includesOrFail(
  workflow,
  "workers/iconoplasm.d1-hot-query-guard.test.js",
  "Production workflow must run the hot-query guard test.",
)
includesOrFail(
  workflow,
  "workers/iconoplasm.do-not-delete-cost-guards.test.js",
  "Production workflow must run the do-not-delete guard test.",
)
includesOrFail(
  workflow,
  "workers/iconoplasm.sync-finalization-queue.test.js",
  "Production workflow must run finalization queue tests.",
)
includesOrFail(
  workflow,
  "assert-iconoplasm-worker-budget-guards.mjs",
  "Production workflow must run this deploy drift guard.",
)
includesOrFail(
  publicationAliasPolicyTests,
  'test("pointer publication completes despite KV list lag and never reads the scanner artifact"',
  "The alias policy suite must keep the no-list pointer-publication regression.",
)
includesOrFail(
  publicationAliasPolicyTests,
  'test("coherent public reader is O(1) at max history and never mixes or mutates pair state"',
  "The alias policy suite must keep the exact-pointer public-reader zero-list regression.",
)
includesOrFail(
  recognitionValidationIndex,
  "ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT = 64",
  "Recognition validation must retain its bounded immutable shard count.",
)
includesOrFail(
  recognitionValidationIndexTests,
  'test("cyclin P to CCNP validates from bounded lookup shards without a scanner read"',
  "The exact production 1102 alias must remain a bounded scanner-free regression.",
)
includesOrFail(
  workflow,
  "workers/iconoplasm-recognition-validation-index.test.js",
  "Production workflow must run the targeted recognition-index gate.",
)
for (const [source, label] of [
  [publicationAliasRoute, "Publication-alias admin route"],
  [extensionBlocklistRoute, "Extension-blocklist admin route"],
  [recognitionReconciliation, "Recognition reconciler"],
]) {
  doesNotMatchOrFail(
    source,
    /loadIconoplasmPublishedScannerRecognitionContext/,
    `${label} must never rebuild the full scanner recognition context.`,
  )
}
const indexPublishOffset = worker.indexOf("await publishIconoplasmRecognitionValidationIndex")
const receiptOffset = worker.indexOf("await recordIconoplasmRecognitionValidationReceipt")
const manifestAdvanceOffset = worker.indexOf("await env.KV.put(KV_CATALOG_MANIFEST")
assert.ok(indexPublishOffset >= 0, "Catalog publication must write the recognition index.")
assert.ok(receiptOffset >= 0, "Catalog publication must record the exact recognition receipt.")
assert.ok(
  indexPublishOffset < receiptOffset && receiptOffset < manifestAdvanceOffset,
  "Catalog publication must write index, then receipt, then advance the public manifest.",
)
doesNotMatchOrFail(
  workflow,
  /\bnpm\s+(ci|install|i|run)\b|\bnpx\b/,
  "Production workflow must not use npm/npx.",
)
includesOrFail(
  budgetWatchWorkflow,
  "check-iconoplasm-cloudflare-budget-headroom.mjs",
  "Budget-watch workflow must run the Cloudflare KV budget headroom check.",
)
includesOrFail(
  budgetWatchWorkflow,
  'cron: "17 */2 * * *"',
  "Budget-watch workflow must run often enough to catch a viral KV-write day before reset.",
)
doesNotMatchOrFail(
  budgetWatchWorkflow,
  /\bnpm\s+(ci|install|i|run)\b|\bnpx\b/,
  "Budget-watch workflow must not use npm/npx.",
)
doesNotMatchOrFail(
  refreshWorkflow,
  /\bnpm\s+(ci|install|i|run)\b|\bnpx\b/,
  "Observability refresh workflow must not use npm/npx.",
)
includesOrFail(
  refreshWorkflow,
  'cron: "17 * * * *"',
  "Observability snapshot publication must run hourly.",
)
includesOrFail(
  refreshWorkflow,
  "check-iconoplasm-cloudflare-budget-headroom.mjs",
  "Observability snapshot publication must fail closed on KV budget pressure.",
)
includesOrFail(
  refreshWorkflow,
  "iconoplasm:observability-snapshot:v1",
  "Observability snapshot publication must use the single atomic KV key.",
)
doesNotMatchOrFail(
  refreshWorkflow,
  /wrangler\s+deploy/,
  "Hourly observability publication must not become a second Worker deploy path.",
)

assert.equal(packageJson.packageManager, "pnpm@11.0.9", "packageManager must pin pnpm.")
assert.equal(packageJson.engines?.pnpm, ">=10.0.0", "engines must name pnpm, not npm.")
doesNotMatchOrFail(
  JSON.stringify(packageJson.scripts || {}),
  /\bnpm\s+run\b|\bnpx\b/,
  "Package scripts must not shell out to npm/npx.",
)
includesOrFail(
  npmrc,
  "minimumReleaseAge=1440",
  ".npmrc must keep the 24-hour dependency release delay.",
)

console.log("Iconoplasm Worker budget deploy guards are present.")
