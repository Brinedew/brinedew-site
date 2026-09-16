# Independent follow-up audit of 383c0046

Reviewed application revision: `383c0046e85856ebb3523cc33d4f0e8ad4d84844`, PR #141 merge.
Executed September 16, 2026, 08:48 UTC.
Run: https://github.com/Brinedew/brinedew-site/actions/runs/35075816278
Job: `104727852395`.
Artifact: `10438252281`, `v2-383c-independent-evidence`.
ZIP SHA-256: `e9d267d8079bae46be652cdebf56ad7abb2466fbaf9a315a1cb01012ba2f288a`.
Importable test-only commit: `0e9b87ad08e5c7f81bb8efdc9889f9b91c73c31c`.
New test: `scripts/v2-383c-independent-concurrency-audit.mjs`.

The workflow verified that all application source was identical to the reviewed merge. It installed the repository's locked runtime and used native workerd/D1 with isolated synthetic data. It had no production credentials or deployment steps. Windows/Prefect state and production data were not accessed or changed.

## What was independently confirmed

The revised existing migration audit passed all six checks. Pending 0106 was accepted using actual repository filenames and its new manifest entry, and `iconoplasm-migration-0106` was registered.

The actual migration adapter reproduced **49 reads and 23 writes** with 19,023 catalog rows, an initially 15-object schema, and zero resulting ordinals. This is the cheap schema/singleton installation, including the adapter's journal insert. It is not a measurement of a completed per-gene authority transfer or full user-data conversion. Admission-ledger overhead and ordinary traffic are outside this direct adapter measurement.

A sequential control registered TP53 as ordinal 0 and LMNA as ordinal 1, then re-resolved both with unchanged results.

## Reproduced defect 1: the new ordinal allocator commits collisions

`ensureDiscoveryDictionaryForNames` is imported unchanged from production source. Test wrappers only pause real asynchronous calls and capture native receipts; they do not change SQL results or application decisions.

### Schedule A: both requests prepare against the same version

Two independent client wrappers over the same native D1 database resolve TP53 and LMNA. A barrier after each maximum-ordinal read ensures both see the empty dictionary. A second barrier before batch submission ensures both prepare against the same dictionary version. D1 still executes each batch as a real transaction.

Persisted rows:

```
LMNA  ordinal=0  canonical=LMNA  active=1
TP53  ordinal=0  canonical=TP53  active=1
```

The first batch returned version 2 and recorded 3 writes. The losing batch's final conditional update returned no rows, while its native receipt still recorded **2 writes**. Both application calls returned normally with ordinal 0. The condition rejecting duplicate canonical ordinals failed.

Cause: candidate-row upserts occur before the conditional metadata update. A conditional UPDATE affecting zero rows is not a SQL error, so the transaction commits its earlier writes. The JavaScript retry runs after that commit; its lookup finds the bad persisted row and returns it.

### Schedule B: a stale maximum is paired with a newer version

The TP53 request reads the empty maximum and pauses. A separate LMNA request completes and takes ordinal 0. TP53 resumes, reads the now-newer metadata version at the end of its planning, and successfully changes version 2 to 3 while writing its already-computed ordinal 0.

Both canonical genes again persist as ordinal 0. The final conditional metadata update succeeds in this schedule, so merely adding rollback for a losing conditional update cannot fix it.

Required repair: validate the same version that protected all allocation inputs, and make any rejected version abort or suppress all related mutations inside the same database transaction. Preserve the legitimate sharing of an ordinal by a canonical symbol and its aliases. A uniqueness safeguard for canonical identities may help, but a blanket unique constraint on every ordinal row would break aliases.

The changed runtime calls this allocator from `recordCompactDiscoveryEncounters`, the recorder for hover batches, guest merges and starter seeding, as well as legacy-user import. A hold on workstation full-scope sync is not proof that these separate discovery writers are contained.

Scope: this proves an integrity failure in the shared allocator under valid overlapping schedules. The native tests do not measure production incidence or assert that production data has already been corrupted. They do not exercise a complete browser request.

## Reproduced defect 2: the migration read bound is invalid for schema sizes accepted by its guard

The adapter accepts up to 1,024 existing schema objects but declares a maximum of 256 reads. Adding 300 unrelated empty tables to the control gives a **315-object schema**, which satisfies that guard.

Native adapter dispatch then completes with **649 reads and 23 writes**, exceeding its declared 256-read bound. Schema guard reads grow with schema cardinality even though the catalog seed was removed.

This is a supported-size fixture, not a production schema inventory. It establishes that the declared admission bound is unsound; the exact cost and outcome on the current production schema remain unmeasured. Fix the bound or guard/query design to cover its accepted range, exercise real admission reconciliation, and retain the existing daily budgets. Increasing an operation's honest reservation within the existing daily allowance does not require increasing that daily allowance.

## Test counts and evidence limits

Existing revised audit: 6 passed, 0 failed.
Independent follow-up: 2 controls passed, 3 assertions failed. Two assertions cover distinct unsafe schedules in the allocator; one covers the schema-size bound.

The existing test called 'ordinal transfer is bounded by touched names and independent of catalog size' checks three created ordinals, their count after re-resolution, and one rename. It does not meter cumulative D1 work for the full retained membership. Its success should not be presented as a completed full-transfer cost proof.

## Remaining transfer and reset gates

The agent's latest report explicitly says the per-gene transfer lacks an authenticated external entrypoint, registered executor and frozen membership. Its local gate code and live configuration were not independently accessible in this audit. This report does not certify them.

Before ordinary sync can run, freeze a coherent intended membership from retained authoritative inputs, implement the authenticated resumable transfer with durable progress and terminal evidence, and tie sync to that exact completed plan. Test missing plan configuration itself: an unarmed or absent transfer requirement must not silently bypass the hold. Also test an incomplete transfer, foreign receipt, successful deployment with legacy authority, and restart/replay.

Server-side scheduled producers need their own state verification. A fail-closed resource preflight does not by itself prove ordering between independent producers when fresh capacity appears.

## Recommended immediate engineering action

Prevent unchanged `383c0046` from activating unsafe discovery writers at the reset. Hold or safely retarget the existing deployment intent through its reversible controls; preserve its retained history and accepted work. Repair the allocator and read bound, finish the transfer executor and missing-plan hold, then run a connected rehearsal on realistic retained-state fixtures before rearming a corrected exact revision. Do not replace the application with v1, raise daily budgets, renumber retained ordinals, or treat an empty/reduced membership as success.

The report adds diagnostic evidence only. No production implementation, reset task or continuation was changed by this audit.
