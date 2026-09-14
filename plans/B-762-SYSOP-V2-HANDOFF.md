# B-762: implementation handoff, 14 September 2026

## Delivered, with scope limits

`workers/iconoplasm/vote-authority/gene-publication-state.js` is a preparatory
storage helper for the EXISTING `IconoplasmVoteCoordinator`. It does not define
another Durable Object. Nothing imports it into production yet. One SQLite row
contains desired selection, the last verified published artifact, monotonic
selection/attempt versions and a retry deadline. Vote mutation, publication intent
and alarm share one async SQLite storage transaction. Network I/O happens outside
it. Exact selection/attempt fencing prevents stale completion, including A-B-A.

Fifteen Node 22.16.0 tests passed locally using real SQLite and simulated alarms.
The companion workerd test checks native DO SQL receipts and rollback AFTER native
setAlarm, using the repository's locked Wrangler and production compatibility date.
Check the branch-only isolated Actions run for its result; syntax checking is not
execution. Alarms are placed in the future, so automatic alarm delivery remains
an integration test. No D1, Queue, KV, Bunny or other gene is called by this helper.
It does not implement vote policy, authentication, uploads or public routes.

## Finish the first slice

Read current B-762/B-742/B-749/B-716, AGENTS, the capacity/authority runbooks and
architecture-fences.json. Fetch without resetting D:\Coding\Website or
D:\Coding\Iconoplasm, preserving unpushed work and concurrent agents. The oversized
stateful module could not be read through GitHub Contents in this session; inspect
it in full locally before production wiring.

Keep B-742/B-749 independent. Preserve recovery continuation
`0926662b7542-1789202515`, saved session `20260914-091116Z--rax2-era-anima`, accepted
publications, dispatch receipts and uncertain reservations. Re-read their latest
checkpoint. Do not reset/recreate recovery, rescan the corpus or replace the stable
scoped sync receipt with an unrelated one-gene receipt.

1. Integrate in `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`,
   reusing `IconoplasmVoteCoordinator` and `ICONOPLASM_VOTE_COORDINATORS`. Preserve
   the actual per-user AND per-candidate vote key, explicit +/-/clear/toggle behavior,
   winner/tie rules, eligibility, overrides, exact manifestation identity, and
   caretaker assignment/+10-supervote logic. Preserve all current consumers.
2. Adapt the existing synchronous vote mutation to `commitSelection`. Its identity
   must include every public-card-affecting revision, including withdrawal/tombstone;
   winning-image SHA alone is insufficient. Keep `selectionRef` bounded and limited
   to immutable source references. Check nested transaction and asynchronous-call
   behavior. No external I/O belongs in the mutation callback.
3. Extend the shared alarm handler. A DO has one alarm for publication and caretaker
   duties. Dispatch the earliest due local work; never erase another duty's alarm.
   A completed publication may leave one harmless timeout wake; idle must not rearm.
   Enforce existing shared resource admission in the upload adapter even when a new
   winner resets this helper's local retry delay. Recovery under exhaustion remains
   the executor's responsibility.
4. Reuse the B-716 card-publication-v2 contract and immutable Bunny primitives.
   Render/upload/verify ONLY this gene's exact public version, then call
   `completeAttempt` with a verified receipt. The helper validates receipt shape;
   the adapter must verify real bytes and source eligibility. Reconcile a lost PUT
   response at the SAME immutable key. Make every public pointer projection
   revision-checked, so a delayed upload never regresses canon. The local helper
   pointer alone does not migrate the public read plane.
5. Remove ordinary per-vote D1 projection and Queue delivery for migrated genes.
   Move detail, gallery, rankings, moderation, caretaker effects and publication to
   the same authority. Preserve audit/history using bounded non-authoritative
   batches. Tests must throw on unexpected D1 prepare/Queue send in the new hot
   path. Keeping two active writers does not complete the replacement.
6. Add bounded resumable migration of votes, counts, overrides, receipts and pending
   work with one explicit authority epoch per gene. Avoid cold full-history import
   in new hot reads. Verify the prior public bytes before `seedPublished`; settle
   old writers before transfer. Once new votes are accepted, rollback must retain
   or export that authority, never switch to stale D1. Preserve unresolved outbox
   records until reconciled.

## Complete the other representations

Reuse the existing ordered authoring metadata stream and signed cursor/snapshot-v2
protocol. Long-offline catch-up needs retention-floor detection, bounded verified
snapshot recovery, and local cursor commit AFTER an accepted batch. Preserve exact
revision IDs and private encrypted body handling.

Discoveries need a versioned stable gene-ID ordinal dictionary, compact membership
and bounded chronology chunks. 19,023 bits use 2,378 payload bytes. Alphabetical row
positions are unsafe: renames/additions/merges must not move existing bits or erase
unknown entries. Merge cross-device membership atomically; retain first/last and
repeat encounters. Idempotent batches remain locally durable until a server receipt.
Do not acknowledge an unflushed event as remotely durable.

Remove the GLOBAL finalization/publication barrier in the new path. TP53 must
publish while another gene stays dirty. Retire obsolete queue/poller/index/trigger
machinery only after migrating every consumer and preserving accepted data. Replace
IPD-004, IPD-010 and affected IPD-012 enforcement points together. Preserve
IPD-001/IPD-011 image identity, protected filenames, one stateful Worker and human
extension-release gates. Preserve current reading and the incident continuation.

## Evidence and completion

Run Node/native workerd proofs, existing vote routing/hot-cost/caretaker tests,
topology/fence checks, generated identities, format/types, full repository tests
and Wrangler dry run. Replace obsolete regex prescriptions with complete behavior,
failure and cost invariants in the same change.

Retain B-716's original workload: 10,000 readers; 50,000 article loads; 2,000 savers
making 20,000 discoveries; 500 voters making 1,000 votes; 200 winner changes; 2%
fallback. One merge per saver is 2,000 merges; ten separately acknowledged saves is
20,000. Measure the actual batches rather than equating bitmap size with write count.
Include higher participation, 10% fallback, cold/disjoint genes, multiple devices,
workstation traffic, retries and storage growth. Report D1, DO SQL/index rows,
DO request/duration/storage, alarms, Worker requests/CPU, KV, Queue and Bunny costs
separately. Local changes() and this helper's receipts are not the full 10k-reader bill.
The 172,000 D1-write figure is a conservative baseline. Report missed targets honestly.

Deploy only through the protected workflow after the complete migration, rollback
and measured envelope are ready and coordinated with the production owner. Verify
real vote -> canon -> fresh website and installed HTML/PDF extension loads, including
automatic alarms and crash/restart boundaries. B-716 retains capacity/freshness
certification; B-742 retains its frozen incident exit and full eligible UTC-day proof.
Do not close either from source-only tests. Record commits, test output, actual cost
receipts, deployment version and unresolved work in B-762. The human is not the
operator for routine commands or scheduled wakeups; do not substitute another ETA.

Platform contract used:
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
https://developers.cloudflare.com/durable-objects/api/alarms/
