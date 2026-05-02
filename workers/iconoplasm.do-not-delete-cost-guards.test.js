import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"

function DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function DO_NOT_DELETE_THIS_HELPER_BECAUSE_IT_COUNTS_THE_NUMBER_OF_SEPARATE_ALARMS_A_FUTURE_EDITOR_WOULD_HAVE_TO_REMOVE_ON_PURPOSE__countMatches(haystack, needle) {
  return (haystack.match(needle) || []).length
}

test("DO NOT DELETE: the protected Iconoplasm D1 alarms are named in at least three different places", () => {
  const agents = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../AGENTS.md")
  const opus = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../.github/agents/opus.agent.md")
  const copilot = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../.github/copilot-instructions.md")
  const onboarding = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../docs/ICONOPLASM_ONBOARDING.md")
  const instruction = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../.github/instructions/iconoplasm-d1-cost-barrier.instructions.md")

  const combined = [agents, opus, copilot, onboarding, instruction].join("\n")
  for (const protectedFile of [
    "iconoplasm.d1-cost-barrier.test.js",
    "iconoplasm.d1-hot-query-guard.test.js",
    "iconoplasm.do-not-delete-cost-guards.test.js",
  ]) {
    const mentions = DO_NOT_DELETE_THIS_HELPER_BECAUSE_IT_COUNTS_THE_NUMBER_OF_SEPARATE_ALARMS_A_FUTURE_EDITOR_WOULD_HAVE_TO_REMOVE_ON_PURPOSE__countMatches(
      combined,
      new RegExp(protectedFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    )
    assert.ok(mentions >= 3, `${protectedFile} should be named in at least three separate guardrail surfaces`)
  }
})

test("DO NOT DELETE: the deterministic hook guard exists and uses absurdly explicit function names", () => {
  const hookJson = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../.github/hooks/iconoplasm-d1-guardrails.json")
  const hookScript = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../../.github/hooks/iconoplasm-d1-guardrails.ps1")

  assert.match(hookJson, /iconoplasm-d1-guardrails\.ps1/, "hook config should point at the Iconoplasm D1 guard script")
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
  assert.match(hookScript, /permissionDecision = 'ask'/, "hook should force an explicit pause when protected files are touched")
  assert.match(hookScript, /permissionDecision = 'deny'/, "hook should deny obvious delete-style attempts against protected files")
})

test("DO NOT DELETE: the loud test files still say why deleting them would be reckless", () => {
  const costBarrier = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./iconoplasm.d1-cost-barrier.test.js")
  const hotQuery = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./iconoplasm.d1-hot-query-guard.test.js")

  assert.match(costBarrier, /DO NOT DELETE THIS FILE\./, "cost-barrier test should announce itself loudly")
  assert.match(costBarrier, /billing incident|bill gets stupid again/i, "cost-barrier test should explain the failure mode in plain words")
  assert.match(hotQuery, /DO NOT DELETE THIS FILE\./, "hot-query guard test should announce itself loudly")
  assert.match(hotQuery, /expensive mistake|real money/i, "hot-query guard should explain why the tripwire exists")
})

test("DO NOT DELETE: the only allowed stateful worker name stays loud across code, docs, and config", () => {
  const worker = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./the-only-allowed-public-edge-worker-that-must-not-touch-state.js")
  const onboarding = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../docs/ICONOPLASM_ONBOARDING.md")
  const wrangler = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../wrangler.toml")

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
  const publicWrangler = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../wrangler.toml")

  assert.doesNotMatch(
    publicWrangler,
    /binding = "ICONOPLASM_DB"/,
    "the public edge worker must not bind ICONOPLASM_DB again",
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

test("DO NOT DELETE: public workers must proxy to the one allowed internal stateful worker", () => {
  const publicEdge = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./the-only-allowed-public-edge-worker-that-must-not-touch-state.js")
  const benchmarkEdge = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./benchmark/the-only-allowed-public-benchmark-edge-worker-that-must-not-touch-state.js")
  const internalRuntime = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js")
  const internalWrangler = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")

  assert.throws(
    () => DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./index.js"),
    /ENOENT|Cannot find module|no such file/i,
    "generic workers/index.js shim should stay deleted after the clean cutover so nobody drifts back to a fake entrypoint",
  )
  assert.match(
    publicEdge,
    /handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate/,
    "public edge worker should expose an absurdly explicit proxy function name",
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
    internalRuntime,
    /export \{ IconoplasmVoteCoordinator \}/,
    "internal stateful worker runtime should explicitly export the Iconoplasm vote coordinator durable object class",
  )
  assert.match(
    internalWrangler,
    /name = "ICONOPLASM_VOTE_COORDINATORS"[\s\S]*class_name = "IconoplasmVoteCoordinator"/,
    "internal stateful worker should bind the per-gene vote coordinator durable object",
  )
  assert.match(
    internalWrangler,
    /name = "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE"[\s\S]*class_name = "IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate"/,
    "internal stateful worker should bind the hard daily budget durable object because alerts are not a kill switch",
  )
  assert.match(
    internalWrangler,
    /\[\[migrations\]\][\s\S]*tag = "v1"[\s\S]*new_sqlite_classes = \["GameSession"\][\s\S]*\[\[migrations\]\][\s\S]*tag = "v2"[\s\S]*new_sqlite_classes = \["IconoplasmVoteCoordinator"\][\s\S]*\[\[migrations\]\][\s\S]*tag = "v3"[\s\S]*new_sqlite_classes = \["IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate"\]/,
    "internal stateful worker should preserve the old durable objects and add the hard daily budget kill switch as its own migration tag",
  )
  assert.match(
    internalWrangler,
    /ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY = "24000000000"/,
    "prod internal worker should define a real hard monthly rows-read cap instead of relying on alerts",
  )
  assert.match(
    internalWrangler,
    /ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY = "40000000"/,
    "prod internal worker should define a hard monthly rows-written cap as a second stop",
  )
  assert.match(
    internalWrangler,
    /ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY = "7"/,
    "prod internal worker should pin the billing cycle day so smart daily allowances reset on the real billing boundary",
  )
  assert.match(
    internalWrangler,
    /ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY = "3"/,
    "prod internal worker should explicitly declare how much daily burst room to allow under the monthly cap",
  )
})

test("DO NOT DELETE: the only allowed internal stateful worker should stay non-public even in staging", () => {
  const internalWrangler = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")

  assert.match(internalWrangler, /^workers_dev = false$/m, "prod internal worker should not expose a workers.dev URL")
  assert.match(internalWrangler, /^preview_urls = false$/m, "prod internal worker should not expose preview URLs")
  assert.match(
    internalWrangler,
    /\[env\.staging\][\s\S]*?workers_dev = false/,
    "staging internal worker should also stay off workers.dev so the stateful worker remains internal",
  )
  assert.match(
    internalWrangler,
    /\[env\.staging\][\s\S]*?preview_urls = false/,
    "staging internal worker should also stay off preview URLs so we do not publish the internal state worker by accident",
  )
})

test("DO NOT DELETE: production deploy wiring must use the internal stateful worker config before the public edge deploy", () => {
  const workflow = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../.github/workflows/deploy-quartz.yml")

  assert.match(
    workflow,
    /wrangler d1 migrations apply iconoplasm --remote --config wrangler\.the-only-allowed-internal-stateful-worker-do-not-duplicate\.toml/,
    "production migrations must run through the internal stateful worker config because the public edge worker no longer has the D1 binding",
  )
  assert.match(
    workflow,
    /Deploy the only allowed internal stateful worker \(production\)[\s\S]*?wrangler deploy --config wrangler\.the-only-allowed-internal-stateful-worker-do-not-duplicate\.toml/,
    "production workflow should deploy the internal stateful worker explicitly before the public edge worker",
  )
  assert.match(
    workflow,
    /Upload public edge worker script without routes \(production\)[\s\S]*?wrangler deploy --config wrangler\.the-only-allowed-public-edge-worker-upload-only\.toml/,
    "production workflow should upload the public edge worker script without reusing old routes on geneguessr-api",
  )
  assert.match(
    workflow,
    /Reassign production routes to the public edge worker[\s\S]*?node scripts\/reassign-cloudflare-worker-routes\.mjs[\s\S]*?the-only-allowed-public-edge-worker-that-must-not-touch-state/,
    "production workflow should explicitly reassign the zone routes away from the legacy geneguessr-api script",
  )
})

test("DO NOT DELETE: cost attribution should name request-picker and admin dashboard routes explicitly", () => {
  const runtime = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")

  assert.match(runtime, /return "gene_request_state_gone"/, "legacy request-state route should stay tombstoned as an explicit removed bucket")
  assert.match(runtime, /return "gene_request_summary"/, "request summary route should have its own named cost bucket")
  assert.match(runtime, /return "gene_request_options"/, "request options route should have its own named cost bucket")
  assert.match(runtime, /return "gene_request_submit"/, "request submit route should have its own named cost bucket")
  assert.match(runtime, /return "mobile_card_manifest"/, "mobile card manifest should have its own named cost bucket")
  assert.match(runtime, /family === "mobile_card_manifest"\) return "first_party_read"/, "mobile card manifest should stay in the first-party read budget class")
  assert.match(runtime, /return "admin_overview"/, "admin overview should not disappear into admin_other")
  assert.match(runtime, /return "admin_coverage"/, "admin coverage should not disappear into admin_other")
  assert.match(runtime, /return "admin_requests_open"/, "admin request queue should not disappear into admin_other")
  assert.match(runtime, /return "admin_requests_fulfill"/, "admin request fulfillment should not disappear into admin_other")
  assert.match(runtime, /LEGACY_GENE_REQUEST_ROUTE_REMOVED/, "deleted request-state route should fail loudly instead of silently lingering")
  assert.doesNotMatch(runtime, /return "admin_other"|return "iconoplasm_other"/, "handled Iconoplasm routes must not disappear into miscellaneous buckets")
  assert.match(runtime, /ICONOPLASM_ROUTE_CLASSIFICATION_MISSING/, "missing route classification should fail loudly instead of silently falling back")
  assert.doesNotMatch(runtime, /if \(path\.startsWith\("\/api\/iconoplasm\/"\)\)\s*\{\s*return true\s*\}/, "route handling should not accept every /api/iconoplasm path implicitly")
})

test("DO NOT DELETE: Iconoplasm sync finalization must not regain crutch control planes", () => {
  const runtime = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")
  const entrypoint = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js")
  const deployCredentials = DO_NOT_DELETE_THIS_TEST_UNLESS_YOU_HAVE_BUILT_A_STRICTER_TRIPLICATE_GUARDRAIL_SYSTEM__readUtf8("../docs/ICONOPLASM_DEPLOY_CREDENTIALS.md")
  const queueDiagnosticsWorkflow = new URL("../.github/workflows/iconoplasm-queue-diagnostics.yml", import.meta.url)

  assert.equal(
    existsSync(queueDiagnosticsWorkflow),
    false,
    "the old GitHub Actions Queue diagnostics/kick workflow should stay deleted; Cloudflare account auth belongs in the dashboard",
  )

  assert.match(
    runtime,
    /durable D1 ledger rows are advanced by Cloudflare Queue messages of kind\s+\/\/ `drain_finalization_ledger`/,
    "runtime should document the single Queue finalization path",
  )
  assert.match(
    runtime,
    /Do not add a GitHub\s+\/\/ Actions Queue kick, workstation drain, direct API processor, or admin-token\s+\/\/ workaround/,
    "runtime should explicitly reject the crutch paths",
  )
  assert.match(
    runtime,
    /admin_finalization_process_410/,
    "direct process route should remain a loud tombstone",
  )
  assert.match(
    entrypoint,
    /handleIconoplasmSyncFinalizationQueue/,
    "the deployed geneguessr-api entrypoint must import the Iconoplasm finalization Queue consumer",
  )
  assert.doesNotMatch(
    runtime,
    /apiPath:\s*["']\/api\/iconoplasm\/admin\/finalization\/process["']|api_path:\s*["']\/api\/iconoplasm\/admin\/finalization\/process["']/,
    "runtime should not call its own deleted direct finalization processor",
  )
  assert.match(
    deployCredentials,
    /Do not replace this with a GitHub Actions diagnostic workflow, a repository-secret control plane, or a direct Cloudflare API connector call/,
    "credential docs should block future dashboard-auth crutches",
  )
  assert.match(
    deployCredentials,
    /Forbidden paths: workstation-side finalization processing, `\/api\/iconoplasm\/admin\/finalization\/process`, per-symbol Queue message formats, GitHub Actions Queue kicks/,
    "credential docs should name the forbidden sync finalization paths",
  )
})
