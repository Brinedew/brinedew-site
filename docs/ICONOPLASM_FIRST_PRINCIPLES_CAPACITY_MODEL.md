# Iconoplasm first-principles launch capacity

Status: **the stated 10,000-lurker plus 100-serious-user launch target is not
safe on the current architecture at $0**.

This is a request-graph model, not a traffic extrapolation. No current or
historical request counter is an input. Observed counters may diagnose an
incident, but architecture has changed too much for them to forecast launch.

The spending constraint is also an input: **$0 of new Cloudflare spend and no
dependency on paying the existing account debt**. A paid-plan recommendation
is invalid unless the debt and billing state are resolved separately and
Vladimir explicitly changes that constraint.

The executable source of the arithmetic is
`scripts/iconoplasm-first-principles-capacity.mjs`. Its test locks the threshold
calculations against accidental hand-waving.

## Fixed inputs

### Provider daily ceilings

| Resource                           | Free daily ceiling |
| ---------------------------------- | -----------------: |
| Worker requests, account-wide      |            100,000 |
| Workers KV reads                   |            100,000 |
| Workers KV writes                  |              1,000 |
| D1 rows read                       |          5,000,000 |
| D1 rows written                    |            100,000 |
| Durable Object requests            |            100,000 |
| Durable Object SQLite rows written |            100,000 |
| Queue operations                   |             10,000 |

Other hard walls remain relevant but do not determine the user-count scenarios
below: 10 ms Worker CPU per request, 128 MB per isolate, 50 subrequests per
invocation, 500 MB per D1 database, and 5 GB D1 storage across the account.

Official ceiling sources:
[Workers](https://developers.cloudflare.com/workers/platform/limits/),
[KV](https://developers.cloudflare.com/kv/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/),
and [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

### Shipped structural shape

- 19,023 published genes.
- 26 immutable card-artifact shards, normally 750 genes per shard.
- Eight genes per extension detail batch.
- 512 persistent extension detail-cache entries per publication snapshot.
- The three guest starter genes live in three different shards.
- Non-rejected portrait candidates per gene: average 2.958, p95 5, p99 12,
  maximum 44.

These are artifact/schema measurements. They describe what the shipped code
must touch; they are not measurements of audience behavior.

### Fixed code-scheduled work

The deployed configuration creates 96 quarter-hour Cron Trigger activations and
three daily activations: **99 Worker requests/day** before users. The hourly
observability workflow also spends **24 KV writes/day**. These are known from
configuration, not inferred from telemetry.

The D1/KV/Queue work performed inside a tick is state-dependent. It is modeled
with its cause—dirty publication, pending notification, vote projection, or
finalization—not disguised as an observed baseline. A clean best-case scenario
therefore includes the 99 activations and 24 writes but does not invent rows for
empty jobs.

## Atomic journey costs

All rows assume a cold isolate/cache when a maximum is being claimed. “Healthy
Bunny” means portrait bytes come directly from Bunny CDN and do not invoke the
Cloudflare Worker.

| Journey                                                | Worker | KV read | KV write |    D1 read rows |   D1 write rows |     DO requests |   DO write rows |
| ------------------------------------------------------ | -----: | ------: | -------: | --------------: | --------------: | --------------: | --------------: |
| Anonymous cold homepage                                |      1 |       5 |        0 |               0 |               0 |               0 |               0 |
| One cold distinct search                               |      1 |       3 |        0 |               0 |               0 |               0 |               0 |
| One signed-out gene page, average candidates           |      4 |       4 |        0 |           6.958 |               0 |               1 |           2.958 |
| One signed-out gene page, maximum candidates           |      4 |       4 |        0 |              48 |               0 |               1 |              44 |
| Signed-out extension, 8 active hours, 512 unique genes |    256 |     928 |        0 |             0\* |               0 |               0 |               0 |
| Signed-in extension, 8 active hours, 512 unique genes  |    673 |     928 |    0\*\* |             0\* |           1,024 |             512 |               0 |
| Signed-in website left visible for 8 hours             |    480 |       0 |        0 | route-dependent |               0 | route-dependent |               0 |
| Fixed scheduled control plane, one day                 |     99 |       0 |       24 | route-dependent | route-dependent | route-dependent | route-dependent |

\* The portrait-fingerprint refresh anomaly is modeled separately because its
cost is global and race-dependent, not honestly attributable to one user.

\*\* A newly shared discovery also writes KV. In a cold/disjoint shared state,
512 unique genes cost 512 writes per user; the second such user exceeds the
1,000-write ceiling. In mature overlapping state, this cost approaches zero.
Both assumptions must stay visible.

The four Worker requests for a gene-page visit are the HTML document, vote
snapshot, comments, and discovery encounter. The HTML path reads primary D1
twice for the catalog row, once for portrait state, once for essence, and once
per candidate. Client bootstrap prevents a duplicate detail fetch.

## User behavior scenarios and first failure

“First over” means the first whole user whose complete journey would exceed the
ceiling. The preceding user count is below it; operating exactly at a ceiling
is not safe headroom.

| Assumption                                                          | First resource over | First whole user over |
| ------------------------------------------------------------------- | ------------------- | --------------------: |
| Homepage only, one cold session each                                | KV reads            |                20,001 |
| Explorer: home + 5 cold searches + 3 gene pages, average candidates | KV reads            |                 3,126 |
| Same explorer, three 44-candidate genes                             | DO rows written     |                   758 |
| Signed-out extension, 8 active hours, 512 unique genes              | KV reads            |                   108 |
| Same extension after 10,000 one-visit homepage lurkers              | KV reads            |                    54 |
| Signed-in extension, 8 active hours, mature shared-discovery state  | D1 rows written     |                    98 |
| Signed-in extension, cold/disjoint shared-discovery state           | KV writes           |                     2 |

All rows above use the best-case assumption that unrelated Brinedew/GeneGuessr
traffic consumes none of the shared account quota. Because the Worker allowance
is account-wide, that is a floor, not headroom. Other account demand must be an
explicit reserve assumption:

| Other-account KV reserve | First serious signed-out extension user over after 10,000 lurkers |
| -----------------------: | ----------------------------------------------------------------: |
|                       0% |                                                                54 |
|                      20% |                                                                33 |
|                      50% |                                                                 1 |

The reserve table is deliberately not estimated from yesterday. It lets the
decision-maker choose an explicit isolation/headroom policy and see the result.

The explicit 10,000-lurker plus 100-serious-extension-user target therefore
costs, before search and gene-page exploration:

- signed-out extension users: 35,600 Worker requests and **142,800 KV reads**;
- signed-in extension users: 77,300 Worker requests, **142,800 KV reads**, and
  **102,400 D1 rows written**;
- if those 100 signed-in users also leave the site visible for eight hours:
  **125,300 Worker requests**.

The fixed scheduled control plane adds 99 Worker requests and 24 KV writes to
each total. It does not change which resource fails first.

The target fails first-principles checks even when Bunny is healthy. It is not
made safe by the crawler block.

## Independent maximum-strain assumptions

### Portrait CDN failure

If Bunny is unavailable and every unique portrait falls back to the
first-party route, a 512-gene extension session adds up to 512 Worker requests
per user. A 44-candidate gene page adds up to 44. Healthy-CDN and failed-CDN
scenarios must never be averaged together.

### Search crawler

GPTBot and ClaudeBot are blocked before Worker execution. A permitted search
crawler fetching every gene document without JavaScript still costs 19,023
Worker requests. Under a cold-isolate upper bound it can also cost 57,069 KV
reads. That is structurally affordable alone but consumes material capacity
when combined with humans.

### Unknown or adversarial automation

An unblocked actor can consume the account-wide 100,000-Worker-request allowance
regardless of application rate limits, because an application rate-limit check
already entered the Worker. Protection for this failure mode belongs before the
Worker at Cloudflare's edge.

## Hardening anomaly ledger

### H-1 — vote snapshot “read” rewrites Durable Object rows

**Status: launch blocker. Homemade state-repair behavior is on a read path.**

`/vote/snapshots` calls `ensureAssetSummaryFromMetadata`, which reaches
`ensureAssetSummaryRow`. That method performs `INSERT ... ON CONFLICT DO UPDATE`
and changes `updated_at` even when the asset already exists. Merely viewing a
gene therefore writes one `asset_summary` row per candidate.

First-principles consequence:

- repeating a 44-candidate gene page: user/page 2,273 exceeds 100,000 DO row
  writes;
- the three-gene maximum explorer: user 758 exceeds the same ceiling.

Permanent correction: snapshot reads must be side-effect free. Missing summary
repair belongs on candidate/vote mutation or an explicit bounded repair job,
with a test proving repeat snapshot reads execute no storage write.

### H-2 — five-minute fingerprint refresh performs a whole-catalog D1 scan

**Status: launch blocker. This is a homemade distributed cache without
single-flight ownership.**

When the shared portrait fingerprint is stale, a read request scans 19,023
published rows, hashes them, and writes one shared KV key. Concurrent cold
isolates can all do the same work.

| Active window | Concurrent cold refreshers per 5-minute boundary |               D1 rows read |
| ------------- | -----------------------------------------------: | -------------------------: |
| 8 hours       |                                                1 |                  1,826,208 |
| 8 hours       |                                                2 |                  3,652,416 |
| 8 hours       |                                                3 | **5,478,624 — over limit** |
| 24 hours      |                                                1 | **5,478,624 — over limit** |

Permanent correction: publication must write immutable fingerprint/version
metadata once. Public reads consume that metadata and never reconstruct it by
scanning D1.

### H-3 — homepage card hydration rereads multiple immutable shards

**Status: capacity blocker for the combined target, not data corruption.**

An anonymous cold homepage spends five KV reads: gallery version, catalog
manifest, and three starter shards. Ten thousand one-visit lurkers spend half
the daily KV-read allowance before extension traffic begins.

Permanent correction: publish one tiny starter-card artifact or serve the
starter payload with the static release. Do not add more D1 reads or a per-user
cache workaround.

### H-4 — signed-in discovery writes two D1 rows per unique hover

**Status: capacity blocker; authority is valid, write amplification is not.**

Each unique signed-in encounter writes the personal discovery and the shared
rollup. One hundred users filling a 512-entry cache write about 102,400 D1 rows
before other account writes. The shared-discovery KV mirror can independently
exceed its 1,000-write ceiling when discoveries are cold and disjoint.

Permanent correction requires separating durable personal truth from a bounded
publication/aggregation path. Dropping either authority or accuracy to make the
chart green would be a kludge.

### H-5 — minute polling turns an idle signed-in tab into traffic

**Status: anomalous background load.**

The signed-in request inbox polls once per minute while visible. One tab open
for eight hours costs 480 Worker requests; 100 such users cost 48,000. The
appropriate correction is event/visibility-aware bounded refresh behavior, not
a larger arbitrary polling interval.

### H-6 — full maintenance is deliberately fired twice eight minutes apart

**Status: homemade redundancy; not yet a proven launch blocker.**

Both `55 23 * * *` and `3 0 * * *` are members of
`ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS`. Each runs archive, vote projection,
canon repair, and gallery refresh. The two triggers also own unrelated
GeneGuessr pre-warm and recap responsibilities, so the shared clock causes full
Iconoplasm maintenance to run twice.

This may be intentional recovery redundancy, but its cost bound and reason are
not explicit. Permanent correction: give maintenance one clear owner, or
document and test the second run as a no-op recovery pass with exact maximum
D1/KV/Queue work.

### H-7 — an unreachable hourly maintenance selector remains in runtime code

**Status: anomalous dead configuration, no current production quota cost.**

`ICONOPLASM_SCHEDULED_MAINTENANCE_CRONS` still includes `17 * * * *`, while the
deployed Worker Cron Trigger list does not. A separate GitHub Actions workflow
uses that schedule for observability publication. Keeping the same expression
in the Worker maintenance set obscures ownership and can accidentally turn a
future trigger change into hourly heavy maintenance.

Permanent correction: remove the dead selector or make schedule ownership a
single validated configuration. Do not rely on two files accidentally
disagreeing.

## What historical counters may and may not do

Historical counters may establish that GPTBot/ClaudeBot caused the 2026-07-24
incident and verify that the edge block stopped that incident. They may not be
used to estimate Scott Alexander traffic, serious-user behavior, or capacity of
the changed architecture.

The model changes only when one of these changes:

1. a provider ceiling;
2. the shipped request graph;
3. artifact/catalog shape;
4. a stated user-behavior assumption;
5. the $0 spending constraint.

Any recommendation must name the changed input and rerun the executable model.
