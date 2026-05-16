---
description: "Use when editing Iconoplasm worker cost-barrier code, Iconoplasm D1 tests, onboarding docs, or agent instructions. Covers the protected alarm files, the triplicate guardrail rule, and why deleting warnings/tests is dangerous."
name: "Iconoplasm D1 Cost Barrier"
applyTo: "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js, workers/iconoplasm-caller.js, workers/*.test.js, docs/ICONOPLASM_ONBOARDING.md, CLAUDE.md, .github/hooks/iconoplasm-d1-guardrails.*, .github/instructions/iconoplasm-d1-cost-barrier.instructions.md"
---
# Iconoplasm D1 cost barrier

Treat the Iconoplasm D1 guardrails like alarm bells, not clutter.

## the triplicate rule

If you add or replace a deterministic D1 safety defense, it should exist in at least three separate places so a future editor has to deliberately remove multiple barriers before dangerous code can slip through.

Right now the intended stack is:

1. runtime warning comments in `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
2. guard tests in:
   - `workers/iconoplasm.d1-cost-barrier.test.js`
   - `workers/iconoplasm.d1-hot-query-guard.test.js`
   - `workers/iconoplasm.do-not-delete-cost-guards.test.js`
3. repo instructions and docs in:
   - `CLAUDE.md`
   - `docs/ICONOPLASM_ONBOARDING.md`
   - this file
4. deploy-time checks in:
   - `.github/workflows/deploy-quartz.yml`
   - `scripts/assert-iconoplasm-worker-budget-guards.mjs`
5. the hook guard in `.github/hooks/iconoplasm-d1-guardrails.json` and `.github/hooks/iconoplasm-d1-guardrails.ps1`

The current safety story is intentionally split:

- hot public and first-party reads stay off the budget DO entirely
- dangerous admin mutation families still use the limiter DO and fail closed when headroom or telemetry is not trustworthy
- usage visibility comes from Cloudflare dashboard and GraphQL analytics, not an app-owned request-path report

## what not to do

Do not do any of these just because a change is inconvenient:

- delete a failing guard test
- rename a guard test so nobody recognizes it
- remove the loud warning comments from `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- replace raw canonical-key predicates with `upper(...)` / `lower(...)` on hot paths
- remove the shared KV barrier and rely on module memory alone
- put hot read traffic back on the budget DO just because it feels tidy to count everything in one place
- rebuild `/api/iconoplasm/admin/cost/usage` into a fake internal telemetry source instead of pointing operators at Cloudflare-native observability

## if a guard fails

Assume the guard is telling you something useful.

Fix the code, or land a stricter replacement guard in the same change and explain why the old one was no longer the right guard.

## chesterton's fence

If you see a bizarrely long helper or test name with `DO_NOT_DELETE` in it, that is intentional. The project is using friction on purpose because the failure mode is a real billing incident, not a tidy-code dispute.
