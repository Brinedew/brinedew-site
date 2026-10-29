---
description: "Use when editing Iconoplasm worker cost-barrier code, Iconoplasm D1 tests, onboarding docs, or agent instructions. Covers which tests guard D1 cost and why they measure instead of reading text."
name: "Iconoplasm D1 Cost Barrier"
applyTo: "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js, workers/iconoplasm-caller.js, workers/*.test.js, docs/ICONOPLASM_ONBOARDING.md, CLAUDE.md, .github/hooks/iconoplasm-d1-guardrails.*, .github/instructions/iconoplasm-d1-cost-barrier.instructions.md"
---

# Iconoplasm D1 cost barrier

A full-table read on a public path can spend the account's whole D1 day. The
guards against that run code and measure it:

1. `workers/iconoplasm.d1-cost-barrier.test.js` runs the real SQL against a real
   D1 and counts the rows each path reads.
2. `workers/iconoplasm/batch-admission.test.js` and `workers/iconoplasm/app.test.js`
   prove that admin and workstation routes are let in by their D1 price, and
   that batch work stops when Cloudflare's meter is unreadable.
3. `workers/iconoplasm.worker-config.test.js` parses both Wrangler configs: the
   public edge Worker holds no state, and production has no workers.dev bypass.
4. The per-path cost tests next to the code (for example
   `workers/iconoplasm/factory-rollup-source-cost.test.js`) assert rows read
   and written for one path each.

The safety story:

- hot public and first-party reads stay off batch admission entirely
- admin and workstation routes are let in by their D1 price before they run (`workers/iconoplasm/batch-admission.js`, `workers/iconoplasm/batch-route-prices.js`, IPD-013), and batch work stops when Cloudflare's meter is unreadable
- usage visibility comes from Cloudflare dashboard and GraphQL analytics, and from the per-request record (`workers/lib/the-only-request-record.js`)

## what not to do

- weaken a measuring test to make a change fit
- replace raw canonical-key predicates with `upper(...)` / `lower(...)` on hot paths
- remove the shared KV barrier and rely on module memory alone
- put hot read traffic behind batch admission
- add a test that matches source, docs or workflow text: it fails on unrelated edits and catches nothing that a measurement would miss (B-1187)

## if a guard fails

Assume the guard is telling you something useful. Fix the code, or replace the
test in the same change with one that measures more, and say why.
