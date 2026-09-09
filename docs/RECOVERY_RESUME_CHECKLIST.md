# Recovery resume checklist

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

Use this checklist before continuing an incident after a handoff, compaction or
another agent's work. Read the current issue description and recent comments as
well as this file. Historical evidence remains useful when its time is explicit.

## Establish the current state before editing

Record the observation time in UTC and collect:

- Remote default-branch SHA and the exact protected CI result for that SHA.
- Latest successful canonical production run, its deployed SHA and completion
  time. Inspect later failed or interrupted runs for partial production changes.
- Latest failed canonical run and failed step, plus any active or queued release.
- Installed provider settings for schema transition, selected release identity,
  queue delivery and Cron schedules. Schema transition and background quarantine
  are separate states; a successful public page cannot establish either one.
- Fresh account telemetry and shared capacity, including uncertain reservations,
  using the existing bounded control-plane and capacity readers. Record a failed
  observation as unavailable, not as a zero balance or permission to proceed.
- Local branch, HEAD, working-tree changes and unpushed commits in every affected
  checkout. A local handoff commit can be newer than remote main. Preserve it.

Resolve disagreements against direct evidence for the specific fact. A newer
comment that repeats an older state does not supersede a completed deployment.
Neither a green build nor a merged PR establishes installed production state.
Reconcile file ownership with an active local agent before touching the same
files. Do not discard local work, reset a checkout, create duplicate fixes or
cancel a valid release merely to make the state simpler.

Read the applicable architecture fences and local handoff documents next. Reuse
existing tests and measured receipts when they cover the unchanged code. Refresh
live observations immediately before a consequential action.

## Early capacity sentinel

`scripts/early-release-capacity-sentinel.mjs` runs after the exact-source and CI
checks, before release setup. For an active application it reads installed state,
account analytics and one shared-capacity snapshot. Those reads perform no
application D1 queries, migration inventory, plan registration or reservation.
The capacity GET is still a Worker invocation. Transport has a deadline and no
implicit retry; output contains only approved status fields and fixed errors.

The sentinel rejects already exhausted capacity and invalid, stale or wrong-day
samples. It preserves uncertain reservations. A pass is only permission to reach
the existing full-release preflight, which still computes pending work and uses
atomic admission before execution. A nonzero balance does not prove the complete
release fits. Both existing late preflights remain mandatory.

An installed schema transition takes the existing reader-recovery path without
requiring D1 headroom at this early step. The later reader gate still verifies
fresh installed state and Worker/KV headroom before uploading the zero-D1 reader.
This exception cannot authorize migrations, activate application writes, or
restore background work. The reset controller recognizes the new early refusal
step while retaining its existing schedules, checks and quarantine behavior.

Validate with:

```text
node --test scripts/early-release-capacity-sentinel.test.js scripts/early-release-capacity-wiring.test.js
```

The policy tests inject all external reads. The wiring tests also run the real
CLI with provider credentials absent, proving imports load and the credential
check refuses before provider access. Protected repository CI and release tests
remain required after integrating the change.

## Attribute consumption without manufacturing evidence

Correlate a costly query with its route or job, caller chain, executable version,
query family and bounded correlation identifier. Log no credentials, private
prose, arbitrary query arguments or complete headers. Use provider Query Insights
and existing traces before spending D1 on another diagnostic operation.

A read-counter increase during a build does not establish that the build caused
it. A browser-like user agent can be an application transport. Keep the initiating
caller unresolved until direct evidence connects it to the query. Fix the caller
and query bounds together; a request-count limit cannot bound a full-table scan.

## Keep partial repairs separate from incident acceptance

For a partial incident PR, use `Related to B-742` in its description. Keep the
incident identifier out of its branch name and title. Linear's relation keywords
attach the PR without changing issue status. Closing keywords, ordinary reference
keywords and branch-name linking have different automation behavior. Check the
actual relationship after creating the PR and the incident status after merging.

This convention does not edit team-wide integration settings. An administrator
can inspect Settings > Team > Workflows & automations > Pull request and commit
automations when a broader change is warranted; preserve unrelated workflows.
See the official integration documentation: https://linear.app/docs/github.

Keep the incident open until its own acceptance evidence exists. Preserve saved
outputs, immutable publication identities, migration lineage and all uncertain
reservations. No budget increase, speculative refund, protection bypass or
regeneration is implied by this checklist. Restore background work only through
a reviewed capacity release coordinated with the reset controller, then observe
a full UTC reset-to-reset interval with intended functionality enabled.
