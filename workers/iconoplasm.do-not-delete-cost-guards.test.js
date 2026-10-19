import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

function DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
  path,
) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function DO_NOT_DELETE_THIS_HELPER_BECAUSE_IT_COUNTS_THE_NUMBER_OF_SEPARATE_ALARMS_A_FUTURE_EDITOR_WOULD_HAVE_TO_REMOVE_ON_PURPOSE__countMatches(
  haystack,
  needle,
) {
  return (haystack.match(needle) || []).length
}

test("DO NOT DELETE: the protected Iconoplasm D1 alarms are named in at least three different places", () => {
  const claude =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../CLAUDE.md",
    )
  const onboarding =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../docs/ICONOPLASM_ONBOARDING.md",
    )
  const deployWorkflow =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../.github/workflows/deploy-quartz.yml",
    )
  const deployGuardScript =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../scripts/assert-iconoplasm-worker-budget-guards.mjs",
    )
  const instruction =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../.github/instructions/iconoplasm-d1-cost-barrier.instructions.md",
    )

  const combined = [claude, onboarding, deployWorkflow, deployGuardScript, instruction].join("\n")
  for (const protectedFile of [
    "iconoplasm.d1-cost-barrier.test.js",
    "iconoplasm.d1-hot-query-guard.test.js",
    "iconoplasm.do-not-delete-cost-guards.test.js",
  ]) {
    const mentions =
      DO_NOT_DELETE_THIS_HELPER_BECAUSE_IT_COUNTS_THE_NUMBER_OF_SEPARATE_ALARMS_A_FUTURE_EDITOR_WOULD_HAVE_TO_REMOVE_ON_PURPOSE__countMatches(
        combined,
        new RegExp(protectedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      )
    assert.ok(
      mentions >= 3,
      `${protectedFile} should be named in at least three separate guardrail surfaces`,
    )
  }
})

test("DO NOT DELETE: the deterministic hook guard exists and uses absurdly explicit function names", () => {
  const hookJson =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../.github/hooks/iconoplasm-d1-guardrails.json",
    )
  const hookScript =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../.github/hooks/iconoplasm-d1-guardrails.ps1",
    )

  assert.match(
    hookJson,
    /iconoplasm-d1-guardrails\.ps1/,
    "hook config should point at the Iconoplasm D1 guard script",
  )
  assert.match(
    hookScript,
    /function Test-IconoplasmD1GuardrailPayload-ForProtectedAlarmFiles/,
    "hook script should contain an explicitly named protected-file detector",
  )
  assert.match(
    hookScript,
    /function Write-IconoplasmD1GuardrailAskDecision-BecauseDeletingAlarmFilesCanReintroduceRealBillingIncidents/,
    "hook script should contain an explicitly named ask-decision function",
  )
  assert.match(
    hookScript,
    /function Write-IconoplasmD1GuardrailDenyDecision-BecauseDeletingAlarmFilesIsHowRealBillingIncidentsComeBack/,
    "hook script should contain an explicitly named deny-decision function",
  )
  assert.match(
    hookScript,
    /permissionDecision = 'ask'/,
    "hook should force an explicit pause when protected files are touched",
  )
  assert.match(
    hookScript,
    /permissionDecision = 'deny'/,
    "hook should deny obvious delete-style attempts against protected files",
  )
})

test("DO NOT DELETE: the loud test files still say why deleting them would be reckless", () => {
  const costBarrier =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./iconoplasm.d1-cost-barrier.test.js",
    )
  const hotQuery =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./iconoplasm.d1-hot-query-guard.test.js",
    )

  assert.match(
    costBarrier,
    /DO NOT DELETE THIS FILE\./,
    "cost-barrier test should announce itself loudly",
  )
  assert.match(
    costBarrier,
    /billing incident|bill gets stupid again/i,
    "cost-barrier test should explain the failure mode in plain words",
  )
  assert.match(
    hotQuery,
    /DO NOT DELETE THIS FILE\./,
    "hot-query guard test should announce itself loudly",
  )
  assert.match(
    hotQuery,
    /expensive mistake|real money/i,
    "hot-query guard should explain why the tripwire exists",
  )
})

test("DO NOT DELETE: the only allowed stateful worker name stays loud across code, docs, and config", () => {
  const worker =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js",
    )
  const onboarding =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../docs/ICONOPLASM_ONBOARDING.md",
    )
  const wrangler =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../wrangler.toml",
    )

  assert.match(
    worker,
    /THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE/,
    "worker should use the loud stateful-worker binding name",
  )
  assert.match(
    onboarding,
    /THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE|the-only-allowed-internal-stateful-worker-do-not-duplicate/i,
    "docs should explain why the loud stateful-worker name exists",
  )
  assert.match(
    wrangler,
    /THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE/,
    "wrangler should bind the public worker to the loud stateful-worker name",
  )
})

test("DO NOT DELETE: Website/wrangler.toml must not quietly regain direct state bindings", () => {
  const publicWrangler =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../wrangler.toml",
    )

  assert.doesNotMatch(
    publicWrangler,
    /binding = "ICONOPLASM_DB"/,
    "the public edge worker must not bind the Iconoplasm database",
  )
  assert.doesNotMatch(
    publicWrangler,
    /binding = "DB"/,
    "the public edge worker must not bind the general game DB either; one internal worker means one internal worker",
  )
  assert.doesNotMatch(
    publicWrangler,
    /binding = "KV"/,
    "the public edge worker must not quietly regain KV authority",
  )
  assert.doesNotMatch(
    publicWrangler,
    /binding = "STRUCTURES_BUCKET"|binding = "ICONOPLASM_PORTRAITS"/,
    "the public edge worker must not quietly regain R2 state authority",
  )
})

test("DO NOT DELETE: shared public workers proxy while Iconoplasm routes directly to the one stateful worker", () => {
  const publicEdge =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js",
    )
  const benchmarkEdge =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./benchmark/the-only-allowed-public-benchmark-edge-worker-that-must-not-touch-state.js",
    )
  const internalRuntime =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    )
  const internalWrangler =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    )

  assert.throws(
    () =>
      DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
        "./index.js",
      ),
    /ENOENT|Cannot find module|no such file/i,
    "generic workers/index.js shim should stay deleted after the clean cutover so nobody drifts back to a fake entrypoint",
  )
  assert.match(
    publicEdge,
    /handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate/,
    "public edge worker should expose an absurdly explicit proxy function name",
  )
  assert.doesNotMatch(
    publicEdge,
    /publicEdgeCardCacheKey|caches\.default|edgeCache\.put/,
    "public edge must not symbol-cache card artifacts because it cannot key them by KV_GALLERY_VERSION",
  )
  assert.match(
    publicEdge,
    /PRL split-brain[\s\S]*KV_GALLERY_VERSION[\s\S]*stateful worker own public card freshness/,
    "public edge code comments should make the canonical portrait cache boundary searchable",
  )
  assert.match(
    benchmarkEdge,
    /handleBenchmarkRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate/,
    "benchmark edge worker should also proxy through the one allowed stateful worker",
  )
  assert.doesNotMatch(
    publicEdge,
    /ICONOPLASM_DB|env\.DB|GAME_SESSIONS|STRUCTURES_BUCKET|ICONOPLASM_PORTRAITS/,
    "public edge worker should stay free of direct state bindings in runtime code",
  )
  assert.match(
    internalWrangler,
    /routes = \[\{ pattern = "iconoplasm\.brinedew\.bio\/\*"/,
    "Iconoplasm should route directly to the existing stateful worker instead of paying for a second proxy invocation",
  )
  assert.match(
    internalWrangler,
    /\[assets\][\s\S]*directory = "\.\/public-iconoplasm-edge"[\s\S]*not_found_handling = "404-page"[\s\S]*run_worker_first = \[[\s\S]*"\/api\/\*"[\s\S]*\]/,
    "matching Iconoplasm files must bypass Worker execution through the asset-first binding",
  )
  const workerFirstBlock =
    internalWrangler.match(/\[assets\][\s\S]*?(?=\n\[observability\])/u)?.[0] || ""
  assert.doesNotMatch(
    workerFirstBlock,
    /"\/(?:gene|genes|sitemap|robots\.txt|llms\.txt)/,
    "static reader routes must never re-enter the Worker-first list",
  )
  const objectDeliverySource = readFileSync(
    new URL("./lib/iconoplasm-published-object-delivery.js", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(
    objectDeliverySource,
    /ICONOPLASM_DB|\.prepare\(|\.batch\(/u,
    "the publication-object fallback handler must never touch D1",
  )
  assert.match(
    internalWrangler,
    /run_worker_first = \[[\s\S]*"\/portraits\/\*"[\s\S]*\]/,
    "canonical portrait URLs must reach their existing Worker handler",
  )
  // B-1067: the daily budget referee and the sync governor were deleted by
  // migration v10, in production and staging. Batch work is let in by its price
  // (workers/iconoplasm/batch-admission.js) and no Durable Object stands in front
  // of D1. A binding coming back would bring the referee's per-call DO reads back.
  assert.equal(
    internalWrangler.match(
      /deleted_classes = \["IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate", "IconoplasmSyncGovernor"\]/g,
    )?.length,
    2,
    "migration v10 deletes the referee and the governor in production and staging",
  )
  assert.doesNotMatch(
    internalWrangler,
    /name = "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE"|name = "ICONOPLASM_SYNC_GOVERNOR"/,
    "no Durable Object may be bound in front of D1 again",
  )
  // B-1026 (10-09): the account is on the free plan, whose only wall is Cloudflare's
  // daily allowance. A leftover monthly variable would look like a cap while nothing
  // reads it, so none may remain in the config or be read by the runtime.
  const retiredMonthlyBudgetNames =
    /HARD_MONTHLY_BUDGET|BILLING_CYCLE_DAY_OF_MONTH|DAILY_BURST_MULTIPLIER/
  assert.doesNotMatch(
    internalWrangler,
    retiredMonthlyBudgetNames,
    "no monthly budget, billing-cycle day or burst variable may remain in the worker config",
  )
  assert.doesNotMatch(
    readFileSync(
      new URL(
        "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
        import.meta.url,
      ),
      "utf8",
    ),
    retiredMonthlyBudgetNames,
    "the runtime must not read a monthly budget variable",
  )
})

test("DO NOT DELETE: production has no workers.dev bypass and staging has one owned rehearsal URL", () => {
  const internalWrangler =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    )

  assert.match(
    internalWrangler,
    /^workers_dev = false$/m,
    "production must not expose a workers.dev bypass around the owned custom-domain route",
  )
  assert.match(
    internalWrangler,
    /^preview_urls = false$/m,
    "prod internal worker should not expose preview URLs",
  )
  assert.match(
    internalWrangler,
    /\[env\.staging\][\s\S]*?workers_dev = true/,
    "isolated staging must expose its checked-in workers.dev rehearsal URL so release evidence is executable",
  )
  assert.match(
    internalWrangler,
    /\[env\.staging\][\s\S]*?preview_urls = false/,
    "staging internal worker should stay off preview URLs; production exposure is limited to the explicit Iconoplasm custom-domain route",
  )
})

// Deploy ordering is a deliberate architecture choice, not an accident:
//
//   1. Run D1 migrations through the internal stateful worker config
//      (the public edge worker has no D1 binding — see wrangler.toml comments)
//   2. Deploy the internal stateful worker (geneguessr-api) first
//   3. Deploy the shared public edge worker with only apex/www/GeneGuessr routes
//   4. Reassign shared routes to the public worker and the Iconoplasm route to
//      the asset-first stateful worker as explicit final-state verification
//
// This replaces the old two-step approach (upload-only config + separate reassign script)
// which had a window where wrangler deploy with no routes key would clear existing
// routes, and the reassign step made 6 sequential Cloudflare API calls that could
// each fail independently.
//
// If you need to change the deploy order, update all four assertions together.
//
test("DO NOT DELETE: production deploy wiring must use the internal stateful worker config before the public edge deploy", () => {
  const workflow =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../.github/workflows/deploy-quartz.yml",
    )
  const productionJob = workflow.slice(workflow.indexOf("  deploy-production:"))

  assert.match(
    workflow,
    /Pause the application for maintenance[\s\S]*?ICONOPLASM_SCHEMA_TRANSITION:1[\s\S]*?node scripts\/apply-online-d1-migrations\.mjs --maintenance[\s\S]*?Deploy the stateful Worker after data maintenance/,
    "the application pauses, reviewed migrations apply by their price, and only then does the application deploy",
  )
  assert.doesNotMatch(
    productionJob,
    /wrangler d1 (?:execute|migrations apply)/,
    "production D1 work must not bypass prediction admission; isolated staging owns its disposable migration rehearsal",
  )
  const statefulConfig =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
    )
  assert.match(
    statefulConfig,
    /ICONOPLASM_SCHEMA_TRANSITION = "0"/,
    "normal backend activation must clear the transition gate",
  )
  assert.match(
    workflow,
    /Deploy the stateful Worker after data maintenance[\s\S]*?pnpm exec wrangler deploy --env="" --config wrangler\.the-only-allowed-internal-stateful-worker-do-not-duplicate\.toml[\s\S]*?ICONOPLASM_HTML_SHELL_CACHE_VERSION:\$CACHE_BUST-backend/,
    "a maintenance release deploys the canonical static-first stateful config directly (B-898: no publisher preparation, no Durable Object migration wait)",
  )
  assert.match(
    workflow,
    /Hand off Iconoplasm route to the prepared stateful worker[\s\S]*?geneguessr-api[\s\S]*?iconoplasm\.brinedew\.bio\/\*[\s\S]*?Deploy the stateful Worker after data maintenance/,
    "Cloudflare route ownership must move to the prepared stateful target before Wrangler reconciles the route declared by that script",
  )
  assert.match(
    workflow,
    /Upload public edge worker script with routes \(production\)[\s\S]*?wrangler deploy/,
    "production workflow should deploy the public edge worker script after the internal stateful worker, with routes from wrangler.toml as the single source of truth",
  )
  assert.match(
    workflow,
    /Reassign production routes to the public edge worker[\s\S]*?node scripts\/reassign-cloudflare-worker-routes\.mjs[\s\S]*?the-only-allowed-public-edge-worker-that-must-not-touch-state/,
    "production workflow should explicitly assign only shared routes to the public proxy",
  )
  assert.match(
    workflow,
    /Reassign Iconoplasm route to the stateful worker[\s\S]*?reassign-cloudflare-worker-routes\.mjs[\s\S]*?geneguessr-api[\s\S]*?iconoplasm\.brinedew\.bio\/\*/,
    "production workflow should explicitly assign Iconoplasm to the asset-first stateful worker",
  )
})

// B-1067 deleted the daily budget referee, its per-route cost attribution and
// the sync finalization queue these tests used to guard; every admin route's
// price now lives in workers/iconoplasm/batch-route-prices.js, which refuses to
// load with one missing. Two routing guards outlived them.
test("DO NOT DELETE: retired routes fail loudly and no /api/iconoplasm path is accepted implicitly", () => {
  const runtime =
    DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    )
  assert.match(
    runtime,
    /LEGACY_GENE_REQUEST_ROUTE_REMOVED/,
    "deleted request-state route should fail loudly instead of silently lingering",
  )
  assert.doesNotMatch(
    runtime,
    /if \(path\.startsWith\("\/api\/iconoplasm\/"\)\)\s*\{\s*return true\s*\}/,
    "route handling should not accept every /api/iconoplasm path implicitly",
  )
})
