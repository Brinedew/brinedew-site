# Iconoplasm capacity and background-work runbook

This runbook is for operating the current system safely. Product requirements
live in [ICONOPLASM_PRODUCT_OPERATING_MODEL.md](ICONOPLASM_PRODUCT_OPERATING_MODEL.md).

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
The stable `/blot/{symbol}.webp` route uses the existing Worker to read the
gene's stable object, so it follows the winner after a vote. Healthy portrait
images load directly from Bunny; their canonical first-party `/portraits/*` URLs use
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
revision, runs the exact-commit CI gate, builds, applies reviewed online D1
migrations (`scripts/apply-online-d1-migrations.mjs`, B-847), uploads and
activates Worker versions, reconciles the Bunny pull zone policy, then deploys
Pages. Worker versions preserve the installed routes and Queue consumers, and
cannot change Cron triggers or apply a Durable Object migration, so
`scripts/stateful-worker-deploy-mode.mjs` asks Cloudflare first and the release
uses `wrangler deploy` instead of a version upload when a migration tag is
pending or the toml's `crons` differ from the installed schedules. The same
script verifies the installed triggers equal the toml's after the last Worker
deploy and fails the release otherwise. The toml owns the trigger set: record a
trigger change there, never by hand on the provider. `scripts/verify-code-release.mjs` refuses the push with
`CODE_RELEASE_REQUIRES_MAINTENANCE` when the changes since the installed
revision include an unapplied migration that is not reviewed as online, or a
change to `cloudflare/deployment-topology.json` or
`cloudflare/iconoplasm-crawler-policy.json`. It also refuses while a schema
transition or reader recovery is active.

For any other reviewed data or topology change, dispatch that same workflow
with `data_maintenance=true`. This is the only path that runs provider capacity
admission, non-online schema migration, catalog preparation, and topology
reconciliation. It is intentionally explicit because those operations consume
the shared account allowance and can pause application work. It is not a
routine code-release fallback.

Record source revision, exact CI result, provider deployment, activated
revision, and a fresh user-visible operation separately. If a push refuses,
inspect the reason and use the owned change path; do not replay it blindly.

## Before any capacity-consuming operation

Verify all of the following from current sources:

1. The intended operation has one named owner and one idempotent identity.
2. Its worst-case work is bounded and admitted before dispatch.
3. The shared capacity ledger is available and includes retained uncertain
   reservations.
4. The operation leaves protected headroom for public reading and recovery.
5. A failure has one durable retry owner rather than a blind retry loop.

Exhausted evidence refuses new mutation work. Missing or late telemetry does
not refuse it: D1 write admission then counts every worst-case receipt since the
last same-day provider sample (or since midnight, when the meter is exactly
zero). A telemetry outage never becomes invented capacity, a refunded uncertain
reservation, or a whole-day stall (B-897).

## Current inspection commands

For explicit data or topology maintenance, dispatch the production workflow
with `data_maintenance=true`. That workflow refreshes account capacity and
admits each operation before it runs. Read actual D1 query and row counts from
the provider when diagnosing exhaustion; a synthetic capacity model cannot
establish current visitor demand or release readiness.

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

Reserve before dispatch. D1 write admission measures pressure: the provider's
rows-written meter plus the worst-case units of every reservation made since
15 minutes before that meter was sampled. An uncertain reservation is never
refunded; it keeps counting until the meter can see its real writes. Background
lanes stop at 70% of the daily meter and user actions at 90%, so users always
keep a band that background work cannot take.

Exact ceilings live in executable policy
(`workers/lib/iconoplasm-mutation-lane-reservations.js`), not this runbook.
Tests must fail when a new path bypasses that policy.

The operator ledger (the shared daily D1 budget that admin, workstation and
background routes spend, `D1_OPERATOR_DAILY_LIMITS`) is shed by criticality,
lowest tier first, after Google SRE's
[Handling Overload](https://sre.google/sre-book/handling-overload/) and Stripe's
reserved share for critical requests (B-1026). A request is refused once the
day's operator reads or writes reach its tier's share, at the start and again
before every statement, so a diagnostic admitted just under its share stops on
its next query.

The tier follows who is waiting for the request. Readers, votes and caretaker
saves never enter this ledger. Inside it:

- critical, refused only when the day is spent: a player's portrait delivery.
  That is the lease routes (`authority_generation_executor`) and the publication
  of that portrait, which shares its routes (ingest, catalog upsert and
  reconcile, finalization) with bulk syncs. The caller declares a delivery: the
  workstation sends `X-Iconoplasm-Criticality: critical` while it publishes a
  generation session, and the finalization queue reads the message's existing
  `drain_scoped_phases`. Only those routes may be declared critical, and only by
  a credentialed caller;
- sheddable_plus, refused at 85%: work nobody is waiting on that must still
  finish (bulk syncs, replication, rewrites, Tags derivatives, blots,
  moderation), and any budgeted family not named otherwise. The write-heavy
  admin limiter's default target is this same share;
- sheddable, refused at 60%: admin diagnostics and summaries (overview,
  coverage, assets, storage audit, repair scope, blots backlog, the gallery
  listing).

The refusal is the usual `ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED` 503, retried
after the reset, and `budget.exhausted_by` names the tier
(`rows_read_sheddable`, `rows_written_sheddable_plus`, ...). Tiers and shares
live in `shared/iconoplasm-d1-budget-policy.js`; a new family that player
deliveries depend on must be added to the critical set there.
`workers/iconoplasm/budget-criticality-shedding.test.js` drives the real gateway
against the real ledger at each share.

A refusal states when the same request is worth sending again, in the standard
`Retry-After` header and as `retry_after_seconds` in the body, always the same
whole number of seconds. Every daily-budget 503 the gateway answers
(`ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED` and `ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE`)
and the two discovery 429s (batch and guest merge) take it from one function,
`mutationRefusalRetryAfterSeconds`. A lane refusal is told 15 minutes
(`MUTATION_ANALYTICS_LAG_MS`) only when reservations in flight are the whole reason,
that is when the provider's count plus the request would fit without them: they
stop counting once a provider sample is 15 minutes past their bucket. That is the
earliest it can clear. The window is cut on 15-minute buckets and the sample can be
a few minutes old, so it can take up to twice as long, and the next refusal then
states 15 minutes again. Anything else (the provider's own count already blocks the
request, the shared day is spent, the admin limiter) is told the seconds to the next
00:00 UTC reset plus five seconds of slack for Cloudflare's own meters
(`secondsUntilCloudflareDailyReset`), because the provider's count never falls
within a UTC day. The workstation waits for the stated time before it sends the
request again (`daily_budget_retry_after_seconds` in the Iconoplasm repository).
The monthly caps are set far above what the free plan can write in a month, so
they are not a cause; a refusal for one would still state the next reset, which is
never late.

A reservation's unit is a D1 row written, the provider's own meter, which counts
every index entry and trigger write behind a statement. It is not a statement
count: the provider allows 1,000 D1 calls per invocation and counts a batch as
one, and the 50-statement invocation budget (`workers/lib/d1-invocation-budget.js`)
is ours and bounds statements, not rows. What each operation reserves lives in
`workers/lib/iconoplasm-mutation-write-bounds.js`, sized from the operation's own
bounded input and pinned to receipts measured on the migrated schema by
`workers/iconoplasm/finalization-reservation-receipts.test.js`. A reservation
never goes below the 50-unit floor, and one above it carries its size in its
identity so a receipt held under an earlier sizing is never replayed at another
size. A migration that adds an index or trigger to a reserved path fails that
test until the new number is pinned.

The laptop routes (the five generation executor routes and the tags-derivative
submission) reserve in the laptop-delivery lane, sized from their own body, and
only after their bearer is checked: a request the route would turn away reserves
nothing. A claim takes new leases every time it is sent, so each claim call is its
own operation, sized for a scan in which every row is quarantined. Renew, fail,
completion and the tags submission name the exact thing they change, so their
identity is their body and a retry is the same operation. Reading a lease's
material writes no row and reserves none. A completion carries at most 50
requests, the size of one claim, and is refused above that before any write. One
completion call delivers one Discord group, so the workstation sends the identical
body again until every group is delivered, and a replay is admitted without a new
reservation: the completion's reservation therefore covers the rows of the whole
series, sized for the worst grouping (groups of two requests), and a call writes
only what moves (a request already on the publication is not rewritten), so a call
after the first costs the group it delivers, not the requests still pending. The
tags head selection is not in this lane: the gateway hands it to the
operation-cost authority, which admits it against its own declared bound. The
numbers are pinned by `workers/iconoplasm/generation-executor-reservation-receipts.test.js`
and `workers/iconoplasm/tags-derivative-reservation-receipts.test.js`, and a test
fails when a route classed `workstation_sync_write` is neither sized nor admitted
by the operation-cost authority.

A vision carries at most 24 distinct emulsion codes (the largest in production
carries 17). The vision rebuild reads the codes first and refuses a vision above
the bound before it writes anything; the finalization job stays in its retry
ledger with the reason in its last error. Raise the bound only together with a new
measurement of `VISION_ROLLUP_ROWS`.

## Public-read behavior

Anonymous shells, catalog data, gene records, portraits, and blots come from the
published plane. A public request must not:

- scan or repair mutable state;
- elect canon from D1;
- trigger publication;
- create a personal discovery record;
- rebuild a catalog object;
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
