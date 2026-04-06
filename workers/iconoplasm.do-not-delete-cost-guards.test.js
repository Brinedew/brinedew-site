import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

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
