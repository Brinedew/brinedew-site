# Iconoplasm capacity and background-work runbook

This runbook is for operating the current system safely. Product requirements
live in [ICONOPLASM_PRODUCT_OPERATING_MODEL.md](ICONOPLASM_PRODUCT_OPERATING_MODEL.md).
Historical incidents belong in Git and closed Linear issues, not here.

## Operating objective

Keep public reading available, preserve every accepted mutation, and prevent
automatic work from exhausting shared free-plan resources.

A green build, a successful deployment, a fresh telemetry sample, an activated
revision, and a verified user operation are separate facts.

## Current boundaries

<!-- ARCHITECTURE FENCE [IPD-004] -->

Queue messages wake durable work. They are not polling tokens. Repeated work for
the same durable object is coalesced, and a future retry waits for its durable
due time.

<!-- ARCHITECTURE FENCE [IPD-005] -->

The primary Iconoplasm D1 stores bounded operational state. Large immutable
bodies and retained audit history do not accumulate there without an explicit
retention design.

<!-- ARCHITECTURE FENCE [IPD-007] -->

Anonymous reading is static/CDN-first. Workers Cache is not a quota workaround.
The stable `/blot/{symbol}.webp` alias uses the existing Worker to resolve the
exact published card after a vote changes the winner. Healthy portrait images
load directly from Bunny; their canonical first-party `/portraits/*` URLs use
the existing Worker only for a real byte fallback. The site shell and crawler
files remain static. Dynamic Worker paths also exist for explicit private
actions, mutations, and administration.

<!-- ARCHITECTURE FENCE [IPD-008] -->

Anonymous startup and extension hover consume the published immutable plane.
They do not probe authentication, scan D1, or repair publication.

<!-- ARCHITECTURE FENCE [IPD-010] -->

Routine publication processes changed content only. A scheduled or vote-driven
step must never silently fall back to rebuilding the corpus.

<!-- ARCHITECTURE FENCE [IPD-012] -->

The Website is the command authority for caretaker and manifestation state. The
workstation is a version-bound replica and executor, not a second writer.

These are durable boundaries. Batch sizes, schemas, schedules, cache lifetimes,
retry counts, and provider-operation estimates are implementation choices and
belong in code and tests.

## Production release path

The one production workflow is `.github/workflows/deploy-quartz.yml`. A push to
`main` releases compatible code and static assets: it checks the installed
revision, runs the exact-commit CI gate, builds, uploads and activates Worker
versions, then deploys Pages. Worker versions preserve the installed routes,
Cron triggers, and Queue consumers. The push does not stage a schema transition,
run D1 migrations, rebuild the publication catalog, or reconcile provider
topology. It refuses if the changes since the installed revision include a
migration, Worker binding, route, or named provider policy change, or if an
active schema transition makes the code release incompatible.

For a reviewed data or topology change, dispatch that same workflow with
`data_maintenance=true`. This is the only path that runs provider capacity
admission, schema migration, catalog publication, and topology reconciliation.
It is intentionally explicit because those operations consume the shared
account allowance and can pause application work. The separate
`reader_recovery_only=true` dispatch remains a D1-free containment action for
an active incident. Neither dispatch is a routine code-release fallback.

Record source revision, exact CI result, provider deployment, activated
revision, and a fresh user-visible operation separately. If a push refuses,
inspect the reason and use the owned change path; do not replay it blindly.

## Before any capacity-consuming operation

Verify all of the following from current sources:

1. The intended operation has one named owner and one idempotent identity.
2. Its worst-case work is bounded and admitted before dispatch.
3. Provider telemetry is fresh for the current UTC day and account scope.
4. The shared capacity ledger is available and includes retained uncertain
   reservations.
5. The operation leaves protected headroom for public reading and recovery.
6. A failure has one durable retry owner rather than a blind retry loop.

Missing, stale, malformed, or exhausted evidence fails closed for new mutation
work. It does not justify inventing capacity, refunding an uncertain reservation,
or waiting without a durable executor.

## Current inspection commands

For explicit data or topology maintenance, dispatch the production workflow
with `data_maintenance=true`. That workflow refreshes account capacity and
admits each operation before it runs. Read actual D1 query and row counts from
the provider when diagnosing exhaustion; the retired synthetic capacity model
cannot establish current visitor demand or release readiness.

Validate architecture ownership:

```powershell
pnpm run test:architecture-fences
pnpm run validate:iconoplasm-topology
```

Inspect the shared admission endpoint through the authenticated supported
operator path:

```text
GET /api/iconoplasm/admin/cost/operations/capacity
```

Do not use application D1 reads to discover whether D1 read capacity is already
exhausted. Use provider analytics and the existing capacity ledger.

## Admission behavior

Every mutation or background operation must declare:

- the owning operation;
- an idempotent identity;
- the resource meters it may spend;
- a reviewed worst-case bound;
- the durable completion or retry destination.

Reserve before dispatch. Settle from provider receipts when the outcome is
known. Retain the reservation when the outcome is uncertain. No lane borrows
another lane's unused budget.

Exact ceilings and lane allocations live in executable policy, not this
runbook. Tests must fail when a new path bypasses that policy.

## Public-read behavior

Anonymous shells, catalog data, gene records, portraits, and blots come from the
published plane. A public request must not:

- scan or repair mutable state;
- elect canon from D1;
- trigger publication;
- create a personal discovery record;
- rebuild a catalog or shard;
- depend on an administrator session.

If published bytes are temporarily unavailable, retain a coherent prior
publication or show the static failure state. Do not reconstruct a partial canon
from live state.

## Background-work behavior

Automatic work requires one durable desired-state owner. Restarting a process or
workstation must not convert a pause into permission.

Use these rules:

- schedule by durable due time, not rapid empty polling;
- coalesce repeated dirty work;
- process bounded units and persist progress;
- make retries idempotent;
- park when no useful work is due;
- expose what may run next without scanning large queues or tables.

## Incident response

When a hard allowance is near or exhausted:

1. Preserve public reading and already accepted user intent.
2. Stop admitting new nonessential mutations through the owned policy.
3. Identify the operation and statement responsible from provider receipts and
   telemetry.
4. Fix the amplification at its source: query shape, index, retry loop,
   duplicate owner, batch, or publication behavior.
5. Deploy through the normal pipeline.
6. Verify provider headroom, activation, and a real user operation separately.
7. Remove temporary containment or promote it into the existing named owner.

A reset creates an opportunity to verify the repair. It is not the repair.

## Capacity conclusions

Do not call the architecture safe because current traffic is low. Do not call it
fundamentally broken because one stale model or accidental query exceeds a
limit.

The only useful conclusion names the user journey, irreducible work, allowance,
headroom, and user-visible failure.
