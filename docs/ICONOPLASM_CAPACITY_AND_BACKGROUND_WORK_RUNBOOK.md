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

Scheduled jobs wake durable work. They are not polling tokens. Repeated work for
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

Caretaking is plain rows in the main D1 (B-1065): the site writes them, and
the workstation reads and PUTs gene texts through the admin text routes.

<!-- ARCHITECTURE FENCE [IPD-013] -->

Batch work is let in by its price, before it runs. Cloudflare's D1 meter shows
a minute one to two minutes late, so a gate that only reads it lets a fast
writer run past the 85% stop: on 2026-10-11 a copy wrote 62,000 rows in four
minutes that way and readers lost their votes until 00:00 UTC (B-1085). Every
admin route names its price; the gate adds the meter's total, what batch work
was let in since the meter's newest minute (`icono_batch_admissions`, one row a
minute) and the price, and refuses past the stop. The Hono routes name their
price beside the route in `workers/iconoplasm/app.js`; the legacy gateway's
admin and workstation routes name theirs in
`workers/iconoplasm/batch-route-prices.js`, which refuses to load while a
contract route of those audiences has no entry (B-1067). A multi-page job
prices its whole length on its first page. A meter that can't be read stops batch work.
Before starting a bulk job by hand, ask
`/api/iconoplasm/admin/d1-usage?quote_written=N&quote_read=M` and start only on
`"fits": true`.

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
with `data_maintenance=true`. This is the only path that pauses the
application, applies reviewed migrations that are not online
(`scripts/apply-online-d1-migrations.mjs --maintenance`, with the same price
and size guards), and reconciles topology. It is intentionally explicit because those operations consume
the shared account allowance and can pause application work. It is not a
routine code-release fallback.

Record source revision, exact CI result, provider deployment, activated
revision, and a fresh user-visible operation separately. If a push refuses,
inspect the reason and use the owned change path; do not replay it blindly.

## Before any capacity-consuming operation

Verify all of the following from current sources:

1. **Price it on every meter, per statement.** D1 counts each index entry and
   each trigger's writes as rows: a winner change wrote 17 rows for one status
   update until 2026-10-09. Take the numbers from Cloudflare's
   `d1QueriesAdaptiveGroups` (rows written per query text) or the measured
   table in `ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`, never from "the route
   only upserts". On 2026-10-09 a gene object sweep priced at "0 rows written" and the
   Drain's backlog spent the whole 100,000-row write wall by 21:00 UTC.
2. **Check today's meter first:** if the account is already past 50% of a wall,
   find out who is spending before adding batch work.
3. **Send it through a route that sheds batch work** (the factory's register and
   rebuild routes stop it at 85% of a wall). Never write around them.
4. The operation has one named owner and one idempotent identity, and a failure
   has one durable retry owner rather than a blind retry loop.

A batch request is refused with 503 `D1_BATCH_SHARE_SPENT` when its price
does not fit under its tier's stop, and with 503 `D1_METER_UNAVAILABLE` when
Cloudflare's meter can't be read. Both carry `Retry-After` and
`retry_after_seconds`: the share is told the seconds to the next 00:00 UTC
reset, because the provider's count never falls within a UTC day. When
Cloudflare's own wall trips, D1 answers its daily-limit error and the gateway
turns it into a 503 with the reset time. The workstation waits for the stated
time before it sends the request again (`daily_budget_retry_after_seconds` in
the Iconoplasm repository).

## Current inspection commands

For explicit data or topology maintenance, dispatch the production workflow
with `data_maintenance=true`. Read actual D1 query and row counts from the
provider when diagnosing exhaustion; a synthetic capacity model cannot
establish current visitor demand or release readiness.

Validate architecture ownership:

```powershell
pnpm run test:architecture-fences
pnpm run validate:iconoplasm-topology
```

Ask whether a job of a given price fits today, with the factory token:

```text
GET /api/iconoplasm/admin/d1-usage?quote_written=N&quote_read=M
```

Do not use application D1 reads to discover whether D1 read capacity is already
exhausted. Use provider analytics.

### Who did what, and what it cost (B-1147)

Every request to the stateful Worker leaves one record, written by
`workers/lib/the-only-request-record.js` after the response: `route`, `method`,
`status`, `latency_ms`, `rows_read`, `rows_written` and `d1_calls` (summed from
each statement's own D1 receipt), `actor` (a 16-hex keyed hash of the account,
or of IP and user agent for a guest, that changes every UTC day), `actor_kind`
(`account` or `guest`), `channel` (the `ref` or `utm_source` of the page the
request came from) and `country`.

- **During a burst:** Workers Logs (dashboard → Workers → the internal stateful
  Worker → Logs), filtered on `service = iconoplasm`, shows the lines within
  seconds; kept 3 days, 200,000 events a day on the free plan.
- **Afterwards:** not yet. The record also writes to Workers Analytics
  Engine (dataset `iconoplasm_requests`, about three months) whenever the
  `ICONOPLASM_REQUESTS` binding exists, but the binding is out of the toml:
  enabling Analytics Engine adds a (free) subscription, and Cloudflare refuses
  any subscription change while the account carries its unpaid April invoice
  (code 1323, 2026-10-22), then refuses a Worker upload that binds it (code
  10089). If the balance is ever cleared, enable it under dashboard → Workers
  → Analytics Engine, restore the `[[analytics_engine_datasets]]` block and
  query it through the SQL API:

```sql
-- blob1 route, blob2 method, blob3 actor_kind, blob4 channel, blob5 country,
-- double1 status, double2 latency_ms, double3 rows_read, double4 rows_written,
-- index1 actor
SELECT blob4 AS channel, blob1 AS route,
       COUNT(DISTINCT index1) AS people, SUM(_sample_interval) AS requests,
       SUM(_sample_interval * double3) AS rows_read,
       SUM(_sample_interval * double4) AS rows_written
FROM iconoplasm_requests
WHERE timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY channel, route ORDER BY rows_written DESC
```

Page views on the static pages never reach the Worker; Cloudflare Web Analytics
counts them (cookieless, for every visitor since 2026-10-22).

### How fast pages load for real readers

The same Web Analytics beacon records each real visitor's Core Web Vitals.
Measure a reader-speed problem here first. Lighthouse's phone profile (1.6 Mbps,
150 ms RTT, 4× CPU) is a stress test. On 2026-10-27 it said gene pages took
5.7 s on a phone, while real readers saw a p75 of about 1.2 s. An agent then
started building B-1162 from the lab number. Query through the dashboard's
GraphQL endpoint (`https://dash.cloudflare.com/api/v4/graphql`, from the
signed-in dashboard page). Times are in microseconds:

```graphql
query {
  viewer {
    accounts(filter: { accountTag: "c2f308188824cbf1651a0e999e3ec931" }) {
      rumWebVitalsEventsAdaptiveGroups(
        limit: 50
        orderBy: [count_DESC]
        filter: {
          datetime_geq: "2026-10-23T12:00:00Z"
          requestHost: "iconoplasm.brinedew.bio"
          requestPath_like: "/gene/%"
        }
      ) {
        count
        dimensions {
          deviceType
        }
        sum {
          lcpTotal
          lcpGood
          lcpNeedsImprovement
          lcpPoor
        }
        quantiles {
          largestContentfulPaintP50
          largestContentfulPaintP75
          largestContentfulPaintP90
        }
      }
    }
  }
}
```

## Admission behavior

The tier follows who is waiting for the request (`shared/iconoplasm-d1-budget-policy.js`):

- critical, never refused by us: a reader's portrait, vote or caretaker save,
  the owner's own action on one gene, and the five generation lease routes the
  Drain uses to deliver a reader's requested portrait;
- sheddable_plus, refused at 85% of a wall: work nobody is waiting on that must
  still finish (portrait registration, gene object rebuilds, syncs, replication,
  rewrites, blots, catalogue delivery);
- sheddable, refused at 60%: admin diagnostics and summaries (overview,
  coverage, assets, storage audit, repair scope, the gallery listing).

A price's unit is a D1 row, the provider's own meter, which counts every index
entry and trigger write behind a statement. It is not a statement count: the
provider allows 1,000 D1 calls per invocation and counts a batch as one. That
call limit is the only bound on statements; there is no statement budget of
our own. Measured prices say where they were
measured; the estimates in `batch-route-prices.js` are labelled as estimates
and are replaced by a `d1QueriesAdaptiveGroups` measurement when one exists.

A vision carries at most 24 distinct emulsion codes (the largest in production
carries 17). The vision rebuild reads the codes first and refuses a vision above
the bound before it writes anything. Raise the bound only together with a new
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
