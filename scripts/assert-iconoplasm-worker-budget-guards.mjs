import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const worker = readFileSync(
  new URL(
    "../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const workflow = readFileSync(
  new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
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
doesNotMatchOrFail(
  workflow,
  /\bnpm\s+(ci|install|i|run)\b|\bnpx\b/,
  "Production workflow must not use npm/npx.",
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
