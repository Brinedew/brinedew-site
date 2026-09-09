# Architecture fences

## Recovery ownership fence: RECOVERY-001

Read [Recovery Ownership Contract](RECOVERY_OWNERSHIP_CONTRACT.md) before incident, capacity,
deployment or recovery work. The accepting executor owns delivery through a
verified user operation; the owner does not run deployment/SQL commands or
time resets. A safeguard must preserve a tested compatible repair path
under its exact failure. Continue non-deploying source publication and
isolated tests while live D1 is exhausted. Refusal is containment evidence.
Deferred work needs an inspected registered executor, accessible source,
wake condition and failure destination. A chat or Linear edit does not
schedule it. Preserve security, actual admission and schema compatibility
when replacing a deadlocking guard through explicit change control.
This contract adds no new production gate or prerequisite redesign.
Historical checkpoints below require fresh state reconciliation.

This repository uses executable Chesterton's fences for decisions that look
locally removable but protect a system-wide cost, correctness, ownership, or
release invariant.

`architecture-fences.json` is the registry. Every registered fence must appear
in the first four categories. Add the last two when configuration or deployment
participates in the protected decision:

1. repository instructions that route an agent to the decision before editing;
2. a current-state runbook that explains the decision and its failure modes;
3. source code at the point where the tempting change would be made;
4. tests that verify behavior, not only the presence of comments;
5. production and staging configuration when infrastructure participates; and
6. the production deploy workflow when violating the fence could ship a costly
   or correctness-breaking release.

Markers use `ARCHITECTURE FENCE [ID]`. The registry test verifies that every
declared marker exists and that every fence covers the required categories.
Fence-specific tests then assert the protected behavior.

## Change rule

A fence is not permanent dogma. It may be removed or replaced when the
architecture changes. The change must be explicit: update the registry,
rationale, source, configuration, behavioral tests, and deploy guard together.
Deleting or weakening only the nearest guard is a regression.

## Adding a fence

Add a registry entry only for a non-obvious decision whose local simplification
would create a material system-wide failure. Give it a stable ID, explain the
cost or correctness reason, add distributed markers, and add at least one test
that would have failed for the incident that motivated the fence.

The registry is intentionally small. It is not a substitute for ordinary code
comments or tests.
