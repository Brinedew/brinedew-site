# Cloudflare system budget audit

Status: implementation and capacity verification in progress; not a production safety certificate.

## September 13 reset: wait for the installed admission implementation

Automatic run 34726835475, attempt 1, staged repaired source 2d47dd90 at
00:02:39 UTC, then failed schema inspection with COST_PLAN_IDENTITY_MISMATCH.
Its first schema receipt retained the previous executable/schema identities
(4dfeef/237122), with one settled 97-read operation. The next database never
registered. At 00:09:39 all three live inventory adapters matched the repaired
fc334/6aa91 identities. These receipts demonstrate an implementation switch
during inspection; an upload receipt alone did not prove admission readiness.
Neither migration ran and normal activation was skipped in that attempt.

Schema inspection now waits for two consecutive observations of all three exact
release adapters before registering any plan. The wait makes at most 16 control
requests, performs no D1 operation, and remains within the existing inspection's
40-request allocation. It has a 60-second elapsed deadline, keeps transport
failures explicit and never retries a registration or execution. Tests exercise
old/new/old propagation, missing/duplicate adapters, an unchanged deployment,
deadline expiry and transport failure. Original receipts, continuation identities,
predictions and account limits remain authoritative.

## September 12 audit and September 13 reset release

The later caretaker regression found a second history multiplier. Projecting
1,000 eligibility changes beside 100 retained audit/receipt/delivered rows and
20,000 pending delivery rows used 20,704,000 DO SQL reads and 3,000 writes.
Eligibility changes that do not clear a selection add no history, so they now
skip compaction: the same fixture uses 4,000 reads and 3,000 writes. Repetition
writes zero rows. Actual history compaction requires the existing delivery
index on both sides of its delete and reads 800 rows in that fixture, preserving
all 20,000 pending deliveries and the last 100 delivered/audit records.
The previously chosen delete plan examined pending rows despite its delivered
filter; the explicit index prevents backlog growth from increasing pruning cost.

The cold-bootstrap investigation distinguished SQL rollback from the real
request boundary. A caught-failure fixture with a stubbed concurrency gate
exposed partial state, but actual workerd `blockConcurrencyWhile` discarded the
failed seed on both legacy-vote and eligibility faults in the existing code.
The proposed additional transaction was therefore removed. Cold bootstrap's
history-dependent D1/DO cost and shared pre-dispatch admission remain open;
the pruning fix is not a certificate for that complete load.

The account-wide provider sample at 18:15 UTC was 2,645,863 D1 reads,
18,970 D1 writes, 57,545 Worker requests, 4,018,577 Durable Object SQLite
reads, 11,268 DO writes, 46,390 DO requests and 40.75 GB-seconds. KV was
11,760 reads, 88 writes, one delete and one list; Queues had six billable
operations. These are account totals for the UTC day, not a single database
or the application's smaller protected allowance. The twelve-meter reader
in `scripts/lib/cloudflare-account-budget.mjs` rejects missing, malformed,
truncated or stale data. In particular, an unavailable meter is not zero.

The repair package addresses these measured amplifiers:

| Source                      | Evidence and repaired behavior                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily budget DO ledger      | The ledger namespace accounted for 4,009,912 reads in the earlier 16:59 UTC sample. A cycle-key index replaces repeated scans of historical days. Real DO regression with 10,000 cycles costs at most eight reads for a warm lookup and twelve for a record operation; history and reservations remain intact.                                                                            |
| Global asset/backlog counts | Migration 0104 maintains the existing exact counts and age buckets through transactional triggers. A full-schema fixture with 100,000 assets, 50,000 audit rows and 25,000 publications costs 883,453 reads/12,319 writes to guard and initialize, then one read/zero writes for the summary. The migration adapter reserves the whole operation and rejects oversize sources before DDL. |
| Asset-state scope           | A successful live request charged 126,181 reads. The route now requires a nonempty normalized scope and drives indexed asset/vote lookups from it. Selecting two assets and three votes beside 100,000 unrelated records costs 22 reads and zero writes.                                                                                                                                  |
| GeneGuessr search           | Bounded indexed FTS/prefix candidates replace popular-term scans. The 25,000-protein fixture falls from 75,000–100,000 reads to about 1,038 while retaining exact and prefix matches, exclusions and returned-row semantics.                                                                                                                                                              |
| Workstation blot loop       | Sampled successful upload logs contained 18,002 D1 writes across 8,999 requests, while repeated backlog reads added 85,392 reads. The workstation now parks completed corpus work, verifies exact public bytes before recovering old upload receipts, and persists a daily-budget pause across restarts. The durable backlog still owns new work.                                         |
| Gene HTML CPU               | The actual 345,198-byte shell repeatedly scanned its inline CSS for metadata edits. One markup pass preserves script/style bodies and canonical image metadata. The isolated local routine measured 3.1–3.8 ms before and 0.30–0.46 ms after; this is not a total Cloudflare CPU measurement.                                                                                             |

The three sync rollup functions were also exercised against the complete schema.
For one selected asset/vote/vision beside 20,000 unrelated assets and votes,
their receipts were 8/5, 34/9 and 83/19 reads/writes respectively. This does not
bound concentrated per-gene voting or the complete finalization journey.
The later concentrated experiment reproduced a vision/blacklist cross product:
100 gene assets, 10,000 votes, 10,000 additional same-vision assets and 1,000
blacklist rows cost 10,313,151 reads for one vision rebuild. Migration 0105
indexes the exact normalized blacklist expression; all four matching runtime
joins require that index. The identical experiment now costs 233,351 reads and
19 writes. A separate full-schema regression with 10,000 same-vision assets and
5,000 blacklist rows costs 230,051 reads/19 writes on repetition and preserves
case-insensitive blacklist metadata and exact asset/rejection totals.

0105's atomic source/schema guard rejects overflow before index creation or a
journal receipt. Its 5,000-row migration measured 15,378 reads/5,004 writes,
inside the reviewed 18,450/5,032 envelope. The complete pending 0104+0105 release
maximum, including inventories, is 993,914 reads and 17,384 writes, with 421
control requests and ten KV reads/one KV write. These are conservative release
bounds, not live population estimates, and fresh shared capacity must still fit.
No provider or operator allowance was increased.

VoteCoordinator alarms previously used raw D1 bindings and retried a failing
outbox every minute. Their D1 deliveries now share the daily ledger and one
50-statement invocation envelope: four ordinary votes and two caretaker events
per alarm. A known daily refusal persists the next UTC reset plus five seconds
in the existing coordinator; new votes and constructor wakeups respect it.
Both outboxes retain their identities. Alarm D1 work also waits during schema
transition. Tests cover exhausted-day zero D1, new votes, restart, automatic
post-reset delivery and accounting. This bounds the alarm's admitted statements;
whole-phase atomic row-cost admission, cold bootstrap and canonical export
remain B-754 work. Current traffic does not certify the 10,000-reader scenario.

The next source pass found that partial vision finalization repeated its entire
committed prefix. It now advances one vision and the remaining list under the
existing job-version fence. One Queue message processes one phase and one stale
lease, with all D1 bindings sharing the provider's 50-statement ceiling. The
previous consumer configuration admitted 100 messages and scoped drains could
repeat eight passes. Production now specifies batch size/concurrency one;
functional tests complete two saved genes through all eight automatic phases.
This does not establish a maximum row cost for a single large phase.

Known daily refusals move the wakeup atomically into the existing SyncGovernor's
one reset alarm before transport acknowledgement. D1 retains all jobs/progress;
the alarm coalesces duplicate refusals, survives restart, waits through deployment,
and retains failed sends. The live Queue audit at 20:23 UTC found finalization
and its DLQ retained messages for only 60 seconds, with zero primary backlog.
The release reconciles 24-hour retention and verifies the bounded consumer;
the reset alarm handles old messages that still age out before reset.

The warm vote and import responses also exported every historical asset summary,
although their callers only consume the vote receipt/snapshot. Removing that
unused export changes a real DO fixture with 10,000 images from 10,025 reads to
22 reads for one vote (19 writes); import uses 20 reads/17 writes. The background
coordinator state export retains its authority and remains separate work.

Vote-summary projection now removes only absent assets and conditionally upserts
changed values in one atomic D1 batch. With 1,000 images for the affected gene
beside 20,000 other genes, one changed score formerly cost 2,000 reads/5,000
writes; the identical update now costs 5,000 reads/three writes. A repeated
delivery costs 5,000 reads/zero writes and preserves timestamps. This trades
3,000 additional reads in this fixture for 4,997 fewer writes, without changing
the exact authoritative set. Duplicate identities fail before D1; a failed
insert rolls back removals. Full export and cold coordinator initialization are
still history-dependent and must not be represented as bounded by this change.

The factory projection used three separate source aggregations for totals,
preview ranks and h-index. Computing both ranks over one joined input and then
aggregating together preserves all results while reducing reads. A full-schema
fixture with 10,000 selected assets and 20,000 unrelated assets costs
146,685 reads before and 93,339 after with vote summaries/current selections;
with neither, it falls from 110,019 to 80,006. Both write three rows. The full
vision/blacklist fixture now repeats at 200,040 reads/19 writes. This is still
proportional to affected history and is not whole-phase admission.

Coordinator asset metadata now updates only when its effective vision or image
identity changes. The warm vote fixture's SQL writes fall from 19 to 15 and
import from 17 to 13. An identical desired-vote command reads 14 SQL rows and
writes zero, retaining the same user vote and snapshot. These counts describe
SQLite statements; the existing alarm/wakeup and delivery costs remain separate.

`scripts/install-reset-deployer.ps1` updates the existing Windows task
**Iconoplasm Deploy Window Dispatcher**. Its versioned runner has a 180-second
process deadline, starts at 00:00 UTC (07:00 Vietnam), wakes the laptop when
Windows permits it, and checks every five minutes during the reset window.
The armed exact source, reset date, deadline and retained dispatch state live in
`artifacts/reset-deploy/`. Dispatch requires current-main CI and headroom across
all twelve meters. It records the reservation before the GitHub POST and will
not replay an uncertain dispatch. Only the latest exact-main workflow attempt,
all six full-release steps and installed normal mode establish activation.
The two migrations remain individually staged. Only a successful exact-attempt
migration step plus its explicit continuation checkpoint, with every normal
activation step skipped, permits automatic continuation. The executor preserves
the installed migration origin, records the checkpoint before dispatch and
retains uncertain outcomes; a generic successful or failed workflow cannot
renew a migration allowance. CI verifies checkpoint continuation through full
activation, restart and an uncertain second POST.

The reset activation deadline is September 13 at 00:30 UTC. A miss belongs to
B-756 and the registered **Cloudflare reset recovery** Codex heartbeat, which
owns failure inspection and repair. The existing Prefect B-749 continuation
retains its sync lineage and waits for the repaired server before resuming.
Deployment, both authenticated sync checks, fresh pages/blots, and the enabled
UTC day ending September 14 at 00:00 UTC remain separate acceptance gates.

## Acceptance contract

The September 6 failure requires proactive system analysis, not another individual
timeout fix. The unit of acceptance is a working user journey under the shared
account limits. Rejecting every request does not satisfy that contract.

1. Inventory deployed entrypoints, service bindings, HTTP routes, queues, alarms,
   scheduled jobs, workstation clients, CI and direct operators. Include every
   database and other shared Cloudflare allowances.
2. Derive maximum work from the actual query, indexes, trigger fanout, bounded
   inputs, loop counts and retry policy. A result LIMIT, indexed SEARCH, passing
   functional test, or historical average is not a maximum-cost proof.
3. Measure with local workerd and production-shaped fixtures: large completed
   history, many pending jobs, concentrated popular genes, cold caches, duplicate
   delivery, failures, concurrent requests and restart. Never use production
   exhaustion as the experiment.
4. Sum whole journeys and background work for the existing 10,000-reader working
   scenario, plus authoring, generation, release and recovery. Preserve protected
   operational headroom and prove admission against concurrent reservations.
5. Repair amplification at its source. Preserve private authority, provenance,
   exact counts and ordinary functionality. Ship through the normal pipeline and
   verify fresh user-visible behavior. Do not certify partial coverage.

## Existing mechanisms and the guarantees they protect

Durable generation leases fence attempts and prevent conflicting results.
Generation output saved before an outage must remain recoverable, but an older
attempt cannot overwrite a newer claim. Completion may accept the same expired
attempt only while its exact request, token, owner and version still match;
renewal and access to private generation material retain expiry checks.

Finalization history preserves resumability and exact progress. Transactional
summary counters replace repeated history scans without deleting that history.
Notification membership must retain request, publication and asset identity joins.

The existing operation-cost authority atomically reserves reviewed maximum costs
and retains uncertain spending. Reuse that authority; adding another independent
budget would allow their combined use to exceed the account. Existing legacy
post-query metering is useful attribution, but cannot prevent an oversized query.
Moving all requests behind that old meter would not solve the defect.

## Evidence collected September 6

`scripts/audit-cloudflare-resource-surface.mjs` follows static imports from the
three configured production Worker entrypoints. Initial result: 171 modules,
196 Iconoplasm route contracts, 591 SQL preparation sites and 1,511 resource-call
candidates. Ordinary JavaScript collections are included as candidates; this is
module reachability, not proven per-route execution. Client/operator paths,
dynamic imports and non-Iconoplasm route attribution still require coverage.

`scripts/audit-cloudflare-query-plans.mjs` builds the three migration schemas in
local SQLite and compiles statements without executing application mutations.
Initial result: 462 compiled SQL sites, 143 with scan/sort signals, 102 requiring
dynamic-SQL review and 27 unresolved statements. Scanning a capped JSON input is
different from scanning growing persistent history. Each needs classification.
Evidence is generated in `artifacts/cloudflare-system-budget-audit/`.

The current legacy wrapper returns raw database bindings for routes outside its
high-risk admin and workstation families. The internal queue and scheduled
entrypoints also receive the raw environment. The wrapper covers two Iconoplasm
databases, while the internal Worker has four production D1 bindings.

The 15-minute job can launch eight independent maintenance operations 96 times
per day. Three queue consumers allow five retries after initial delivery. Their
cost envelope must include duplicate delivery and all triggered work.

The existing reader model predicts 172,000 D1 writes at 10,000 daily readers:
160,000 for saved discoveries and 12,000 for votes. This is a model of selected
components, not current measured total traffic. Its tests explicitly accept the
redesign-required result; passing them is not evidence that the workload fits.
Verify current receipts before changing either schema or model coefficients.

The signed-in live dashboard shows seven databases and authoring storage near
500 MB (499.97 MB in the list). Cloudflare's documented Free per-database limit
is 500 MB. Storage growth needs an explicit design and release check. The D1
overview's 20.29 billion reads refers to the August 7–September 7 billing period,
not today's allowance. The authoring metrics page uses a rolling 24-hour range;
neither window substitutes for fresh UTC-day account telemetry.

## Open work

Local repair evidence (not deployed): migration 0096 maintains exact inbox receipt
membership and per-user/per-group counts. The request and asset identity checks
remain on the bounded result page. Real local workerd measurements at 20,000
valid receipts: one row read for all four counters, 200 rows read for 50 returned
cards. Repeating the measurement with every primary migration, index, trigger
and seed row raised the acknowledgement cost from four to five writes; the
extra write is the existing unread index. The actual public acknowledgement
function now skips already-read IDs, so a duplicate costs one read and zero
writes. The full-schema test asserts these bounds. Independent
SQLite tests cover invalid identities, read transitions, group changes, source
deletion/reinsertion and rollback. Migration adapters are now registered and
measured locally; all-path runtime budget integration remains unfinished.

The full-schema migration experiment uses 20,000 catalog genes, 20,000 rollup
rows, 50,000 assets and 3,000 notification receipts. Admin counter migration:
250,323 reads / 44 writes against 753,048 / 256 reserved maximums. Inbox counter
migration: 24,466 / 15,026 against 81,040 / 15,256. Oversized source guards roll
back before DDL; both successful migrations record their journal entries in the
same transaction. The inbox seed pins notification rows as the outer cursor,
then makes exact request/asset probes. These are tested envelopes, not live
production cardinality measurements.

Release preflight now admits a read-only inventory through the installed
authority before staging new code. It pins that installed adapter's identities;
DDL still requires the new release identities. The forecast covers only the
verified pending set, and unknown/divergent history stops before DDL. Historical
migration receipts are preserved. The two counter migrations (including delivery
readiness), reconciliation cursor, transport retirement and three inventories
reserve 882,738 reads / 18,816 writes within the operator allocation. A hypothetical
release needing every historical migration is correctly refused rather than
misreported as affordable. Fifteen release/continuation tests pass locally.
The schema fingerprint also includes benchmark migrations sharing GeneGuessr's
database; the query-plan audit now builds that owner in the same local schema.

Authoring storage was verified through the provider metadata API at 499,974,144
bytes across 42 tables. This is physical database size, not an attribution of
that size to individual tables. The legacy copied snapshot-part table has no
current reader or writer; its only remaining runtime function was an uncalled
sweeper. Migration 0015 removes that derived transport table, preserving source
baselines, events, checkpoint parts, source rowids and lease audit records. It
refuses any building/open v1 lease and caps lease/schema inspection atomically.
No table rebuild or VACUUM is used. A full-schema workerd test with 10,000 old
parts reduced the database from 8,318,976 to 700,416 bytes using 1,292 reads and
three writes, within 12,548 / 16 reserved maximums. An active v2 snapshot returned
identical pages before/after, and source rowids/content were unchanged. The
production cleanup and actual recovered capacity are not yet verified.

Shared discovery search no longer rebuilds the hourly overlay from D1 or writes
KV when its publication is missing or malformed. The publisher now initializes
an empty publication correctly (previously it mistook missing and empty for an
unchanged snapshot). Reader failure is explicit and uncached, before catalog
hydration; valid published searches continue to work. This restores the existing
hourly-publication contract, but publisher admission and live initialization
remain required before release. The discovery/search suite passes 25 tests;
the notification suite plus full-schema workerd tests passes 42 tests locally.

The expanded SQL-expression inventory also includes SQL passed through repository
helpers and Durable Object storage rather than direct D1 `prepare` calls. Current
result after snapshot retirement: 174 modules, 1,193 SQL expression candidates,
948 compilable expressions, 251 scan/sort signals, 78 dynamic expressions and
167 unresolved expressions. There are 1,509 resource-call candidates and no
unresolved static imports.
Fragments, generated migration SQL and DO-only schemas account for some of these;
none are silently certified. The three migration schemas build successfully.

Fresh UTC-day account analytics at approximately 06:25 UTC on September 6:
Iconoplasm 7,886,920 reads / 24,815 writes; authoring 234,224 / 32; GeneGuessr
1,829 / 140; total 8,122,973 reads / 24,987 writes and 5,363 Worker invocations.
These are provider telemetry observations with reporting lag, not a forecast or
an execution permit.

The 07:42 UTC refresh returned 8,126,350 account reads, 24,987 writes and 6,490
Worker invocations. The daily read allowance remains exhausted. Do not dispatch
another production release to rediscover this known refusal: the normal headroom
check must pass before the schema-transition stage can run.

Full local regression after all three migrations: 1,855 passed, zero failed,
cancelled or skipped. The full type and formatting check also passed. Neither
result establishes deployed compatibility or resolves the open capacity work.

## Remaining defects identified before another outage

| Flow                                          | Concrete growth problem                                                                                                                                              | Required coherent replacement                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal discovery shelf                      | Full shelf reads join up to 10,000 records; first-discovered ordering lacks the matching personal index. Adding that index alone increases discovery writes.         | Design shelf reads and durable encounter storage together; measure the complete signed-in journey, including existing-account migration.                        |
| Public catalog and compatibility artifacts    | Local reader cutover removes reconstruction and writes on cache misses; normal publisher D1 scans and its complete resource envelope still need admission.           | Release the admitted retained-catalog initializer, verify live reads, and bound the complete normal publisher including future supported compatibility schemas. |
| Bulk inbox acknowledgement and source changes | Mark-all updates and source-trigger fanout can grow with a user's receipts or a popular asset's receipts. Exact counters fix reads but do not bound these mutations. | Bound the complete mutation and preserve exact identity/group counts; measure source insert/update/delete and duplicate delivery, not only one acknowledgement. |
| Background and alternative entrypoints        | Scheduled work, queue retries and raw bindings are not all dispatched through reviewed operation adapters.                                                           | Extend the existing reservation authority to every executing path and sum their declared daily workload before dispatch.                                        |
| Authoring storage                             | Physical storage is near the provider ceiling; retiring obsolete copies does not bound future canonical growth.                                                      | Verify reclaimed production capacity and enforce cumulative storage admission for canonical uploads, derivatives, events and retained checkpoints.              |

These are implementation defects, not findings that are cleared by passing the
current test suite. The 10,000-reader scenario remains uncertified and its current
discovery/vote write model still fails. No blanket route shutdown or allowance
increase is treated as its replacement.

The local catalog cutover writes payloads before pointers, checks actual reference
digests against source races, preserves the previous readable publication after
failed writes, and removes obsolete portrait fields on unpublication. Five cold
isolates consume published artifacts with no D1 reads or KV writes. Missing
artifacts fail uncached and recover after publication at the same URL.
The normal release now initializes retained catalog hydration through a bounded
KV adapter in the existing authority before activation. Its additive ledger
preserves old D1 plans; fresh account telemetry, cumulative operator reservations
and retry ceilings cover all four KV meters. The authenticated HTTP regression
refuses stale/exhausted/underestimated work before KV and rejects invalid success
receipts. A real workerd test initializes 20,000 genes (18,480,071 bytes) with
five reads and one write, then repeats with no write. Production initialization
and dedicated CI analytics-token permission for the KV dataset remain unverified.

The discovery save audit found a separate correctness defect: personal and shared
state could commit separately, and two concurrent first encounters could race.
The local replacement commits both through one D1 batch; a 20,000-row full-schema
workerd fixture verifies 20 concurrent encounters, one discoverer, admin exclusion,
idempotent starter seeding and rollback after an injected shared failure.

Guest merge previously sent up to 2,000 extension symbols to a server that silently
kept only 200, after which the extension deleted its entire submitted buffer.
It also repeated encounter writes after lost responses and loaded the full shelf
after every merge. The new server rejects oversized requests before D1; a maximum
200-symbol union uses two statements in one transaction and returns exact accepted
symbols. Both clients retain unacknowledged local data and spend at most one
200-symbol attempt per page. Replay costs zero writes. Full-schema measurements:
600 reads / 1,600 writes for 200 new symbols; 601 reads / zero writes on replay.
This fixes retry amplification and loss, not the remaining eight-write insert
envelope. No extension release identity or published bundle was changed.

The authority's own SQLite storage is another shared allowance. A real Durable
Object experiment (stubbed D1 receipts, actual authority storage) measured 59 row
writes for capability lookup, registration, ten executions and one receipt. The
experiment refreshed telemetry on every execution: the first cost six DO writes
and later executions five. Cached identical D1 samples avoid one of these writes.
Even four control writes per each of 20,000 discovery saves would consume 80,000
DO writes before registration, authentication and other DO owners. Therefore
putting all public traffic behind the current per-step operator protocol is not
an accepted capacity fix. Its own bounded overhead and every other DO owner must
be included before extending admission to public user journeys.

The scheduled delivery reconciliation previously updated every pending request
every 15 minutes. Its fence protects confirmed delivery: a generated asset is
insufficient, and permanently unsent requests must remain pending without blocking
later sent receipts. The local replacement scans at most two indexed 50-row ranges,
checks at most 50 requests, and atomically advances one durable checkpoint with
their completions. It wraps after the last range. Migration 0097 only creates and
seeds that checkpoint; it does not scan or copy request history. Freshly delivered
groups return their exact request IDs and finish in immediate chunks of 50, up to
the existing 500-request delivery-group limit.

Real workerd tests with 20,000 pending requests exposed two misleading bounds:
SQLite chose the status index for an `id IN (...)` update and read the entire
backlog; a tuple comparison also revisited equal-timestamp prefixes. The replacement
pins completion to integer-primary-key lookup (`NOT INDEXED` still allows rowid)
and splits equal-time and later-time candidates into separately limited ranges.
Two unsent 50-request batches each used 260 reads and one checkpoint write;
50 confirmed completions used 1,058 reads and 501 writes including inbox triggers;
the final 25-request range used 136 reads and one write. `RETURNING id` counts actual
completions, because D1's changes receipt also counted trigger changes (200 for
50 requests). Tests cover rollback of completions when the checkpoint fails,
overlapping runs, scoped replay, and progress beyond unsent rows. The cursor
migration used 312 reads and five writes under its reviewed release envelope.
These are local measurements, not deployed prevention.

Delivery selection was measured separately with 20,000 ready, single-request
groups: selecting one leader read 120,000 rows, or a potential 11.52 million reads
at 96 runs/day. A readiness projection now follows notification changes inside
the same transaction. Only groups with eligible members remain in that derived
queue. Separate indexed mode ranges preserve the default test-recipient gate and
explicit all-requesters mode; each range stops before fetching payloads. New
groups use creation time as their due time, so newly arriving pending groups
cannot permanently outrank an older due retry. Scoped calls use at most 50 exact
request IDs. Local workerd measurements: two reads for ordinary selection, three
for all-requesters selection, seven for one scoped request and 350 for 50. An
entirely future-dated backlog costs one/two reads, not a scan.

The publication-member index now orders by ID after the complete group identity;
the old status column in the middle prevented genuinely bounded leader/member
lookups. Three obsolete status/request-batch indexes were removed after checking
the remaining consumers; exact request, user-inbox and publication lookups stay
indexed. This halves a 500-request delivery's measured writes from 6,003 to 3,003.
That full delivery uses 18,013 reads, one mocked Discord message and ten previews.
No live messages were sent. Claims use bounded JSON IDs below D1's 100-parameter
limit, atomically require the complete still-ready group, and count `RETURNING`
IDs rather than trigger-inflated change totals. Tests cover overlapping claims,
mid-claim rollback, partial stale claims and replay. Reconstructing eligibility
for a malformed 20,000-member group reads only the structural sentinel range
(2,515 reads) and retains an overflow flag, preventing accidental delivery.

The readiness schema is included in **unreleased** migration 0096; a fresh remote
check confirmed that migration had not been pushed. Combining the seeds preserves
a shared maximum: a retained delivery group needs a non-sent member, whose two
queue writes cannot overlap that member's four inbox seed writes. With the two
notification indexes and DDL, reserve `6*N + 512` writes. At 3,000 notifications,
sent/pending/mixed fixtures used 18,033 / 12,032 / 15,032 writes, all below the
18,512 envelope. The corresponding reads were 37,763 / 25,760 / 31,759, below
81,040. Group acknowledgement fanout and cumulative scheduled-work admission
remain open; these fixes do not certify the full daily workload.

Caretaker comment and supervote selection also scanned 40,002 rows each to choose
20 notifications from a 20,000-row backlog: a potential 7.68 million daily reads
across the two quarter-hour jobs. The replacement uses eight separately limited
index ranges (pending/retry, null/earlier day/today SQL/today ISO timestamp), then
sorts only those bounded candidates. Real workerd tests measure 94 reads for
20 tied pending rows, 17 for an entirely future backlog, 640 with every range
populated, and 31 for five mixed-format due rows. No migration or queue writes
are needed for selection. Nested four-way unions respect D1's compound-select
limit. New retries use SQL UTC timestamps; existing ISO retries remain readable,
fixing their previously measured same-day postponement.

The notification fence protects current tenure/preference, durable intent,
per-message identity lookup and ambiguous Discord POST handling. Claims now check
tenure/preference atomically and reject a stale attempt count, preventing an
overlapping selection from reclaiming a freshly deferred retry. A successful
comment uses two D1 queries after selection; a supervote uses three, including
its separate fresh account identity lookup. No live Discord messages were sent.
The scheduler now assigns one job to each recurring invocation. Five background
jobs keep a 15-minute cadence; five 16-message supervote batches/hour preserve
the previous intended 80-message hourly throughput below the per-invocation D1
query limit (49 queries, 32 Discord requests). Comment batches remain 20
(41 queries, 40 Discord requests). Nightly archive, canon repair and gallery
use separate invocations. Vote recovery runs six times hourly; GeneGuessr remains separate.
The configuration uses exactly five cron expressions. A complete-day dispatch
test checks isolation, cadence, delayed delivery and configuration agreement.
The capacity model now counts 1,014 daily activations instead of 99.

Account recovery previously woke a complete manifestation drain for every
account plus one final drain: a 25-account batch could trigger 650 manifestation
attempts. Account and manifestation recovery now have separate adjacent-minute
invocations, and the batch API cannot request per-account wakes. Interactive
single-account synchronization retains its immediate wake and durable outbox.

The account batch itself formerly used 301 statements for 25 new accounts.
Its two database bindings now share a mandatory 50-statement invocation ceiling;
calls, including whole transaction batches, are charged before sending, and
failed sends stay charged. A new account starts only while at least 32 statements
remain. Branch tests measure 18 authoring statements for suspension/reactivation,
20 for canonical withdrawal and 17 for tombstoning. The reserve also covers
primary bookkeeping, registration races and replay failures. Remaining intents
stay pending; a test completes all 25 accounts across 13 bounded invocations.
This per-invocation count is not a second daily budget or a replacement for the
existing operation-cost authority.

Account selection now reads two limited index ranges instead of sorting its
pending history. Full-schema workerd measurements with 20,000 accounts: 77 reads
for 25 pending candidates, 76 for 25 due retries, four for an entirely future
backlog and eight for two mixed candidates. Account and manifestation recovery
run every 12 minutes, one minute apart. Background account capacity is up to
240 new accounts/day or 120 complex transitions/day, with no change to immediate
interactive synchronization. A backlog drains incrementally instead of attempting
an impossible 301-statement invocation.

Individual heavy-job row/write costs and cumulative daily admission remain open;
account withdrawal still changes a lineage's revision lifecycle rows, and fallback
selection still needs a bounded-history proof. This local isolation and statement
admission fix does not certify scheduler capacity or deployment.

Manifestation recovery now shares one statement budget with its assignment and
public-card publication callbacks, reserving 16 statements before another event starts.
A full-schema workerd integration test exercises the actual runtime wrapper and
both callback paths: three complete gene projections use 44 statements and six
mocked coordinator calls, with 118 reads and 78 writes across primary/authoring
for the first batch. Ten genes finish across four invocations. These figures
exclude the mocked coordinators' own work and are not a full journey total.
Interactive account synchronization now wakes only its exact accepted event;
admin mutation callbacks likewise reject a missing event ID instead of draining
an unrelated 50-event backlog. The original mutation and its projection still
need to fit one shared HTTP invocation envelope; the scheduled-job proof does
not establish that larger bound.

Retry dates protect a failed downstream service from immediate repeated work.
Legacy accepted-event delivery stored SQL timestamps, while recovery stored ISO
timestamps; lexical comparison against ISO time incorrectly admitted future SQL
retries on the same day. Recovery now selects eight disjoint indexed ranges:
each status has unscheduled, earlier-day, today's SQL and today's ISO ranges.
Each stops at the requested limit, with four ranges combined per statement.
Both formats remain readable, and new delivery retries use ISO UTC. No date
function wraps the indexed column and no future backlog is scanned. Exact
accepted-event delivery still addresses only its named event independently of
scheduled backoff.
A candidate-only workerd fixture fills all eight ranges beside 19,200 future
events: selection returns 400 candidates using 400 reads and zero writes, below
the reviewed 816-read bound. The full-schema integration separately covers
projection writes and both callback paths.

Account projection's tenure choice now requires migration 0016's expression
index. It preserves open-tenure priority, latest creation time and the stable
assignment-ID tie-breaker; ended tenures remain eligible for identity projection.
The full-schema workerd fixture contains 20,000 ended tenures with tied creation
times. The old indexed history sort uses 40,001 reads; the new exact selection
uses two for either an ended or open tenure and one for an empty account.
Migration admission checks source and schema bounds before its atomic index and
journal batch. The 20,000-row stress fixture costs 60,869 reads and 20,004 writes;
that is a local stress test, not a production allowance. The release envelope
admits at most 1,000 assignments and still requires a fresh live inventory and
the shared cumulative daily gate. An absent index fails explicitly.

Vote summary replacement now uses one atomic two-statement batch: delete the
exact gene's old summary and bulk-insert the coordinator's normalized snapshot.
The 100-image full-schema fixture formerly required 101 statements; it now uses
two, with 100 reads/400 writes initially and 200 reads/500 writes on replacement,
beside 20,000 other genes. Duplicate-key failure restores the entire old summary.
These figures cover summary replacement, not promotion or all dependent rollups.

Vote recovery no longer creates tables, checks schema or adds columns at runtime.
Migration 0098 owns the job generation fence. Its reviewed adapter accepts either
the original eight-column schema or the legacy runtime-added integer column,
checks that declared starting shape inside the transaction, and preserves all
existing job versions. With 20,000 queued jobs, the original shape costs 637 reads
and four writes; the legacy shape costs 323 reads and three writes. Wrong shape
or exceeded schema bounds fail before journal insertion. The release plan declares
the legacy shape but must verify it live before applying; a clean original schema
requires its explicit alternate argument. No generation reset or runtime DDL
fallback remains. Complete vote-job invocation and daily bounds remain open.

- Complete attribution and cost proofs for all execution paths; preserve unknowns
  as unknown rather than declaring them free.
- Fix recurring aggregates, read-triggered rebuilds and write amplification in
  coherent groups, including their schema and every consumer.
- Add storage-growth admission and complete shared pre-send enforcement.
- Verify live pending migrations and source cardinalities against the reviewed
  migration envelopes before staging the compatible release.
- Validate complete journeys locally, release compatible code/schema, and verify
  the running website and Drain. Current source changes are not deployed.

Sources: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

Vote recovery reserves rollback room by admitting at most two unique gene
lookups per invocation, including Queue deliveries from older configurations.
Extra messages retry without D1 access. All selection, apply, rollback and
failure-record calls share the 50-statement fence. A complete-schema workerd
fault test reproduced exhaustion with three jobs; two jobs use 38 statements
when vision projection fails. Completion deletes are one generation-checked
atomic batch, preserving all retry records if any completion fails. The
factory-option completion-failure case uses all 50 statements. Vision-option
inserts now use one bulk statement regardless of the number of distinct visions.
Failed lookups consume the same two-attempt admission allowance as successful ones.
The recovery selector uses three bounded indexed UTC timestamp ranges and reports
`has_more`, replacing the unbounded overdue count. Six isolated invocations
per hour preserve 288 recovery jobs/day versus the former 250/day intent.
This bounds statements, not yet aggregate row cost: candidate history and
vision-rollup scans still require the remaining audit and daily admission.

Canonical lifecycle triggers were another hidden corpus scan: withdrawing one
noncanonical lineage examined all 20,000 gene heads in the full-schema fixture.
Migration 0017 retains reselect-before-withdraw/delete errors and resolves the
head by its authoritative gene key. Canonical selection validation already
requires the selected lineage and revision to belong to that gene. Lineage,
revision lifecycle and body deletion together now read 17 rows in that fixture;
all three still reject mutation of the current canonical revision. The reviewed
atomic trigger migration costs 837 reads and six writes locally, within its
33,024-read/32-write envelope. The complete pending release maximum is now
985,814 reads and 19,896 writes; historical migrations must still be verified
applied before that release can be admitted. Canonical fallback selection itself
still requires the separate history-index redesign.

The refreshed query compilation audit found a malformed full vision rebuild:
its insert named 20 columns but supplied only 15 values. The corrected statement
supplies all 19 bound fields plus the timestamp, preserving workflow, emulsion,
vote and blacklist data on both insert and conflict update. A new normal-suite
check compiles 471 direct static Worker SQL calls against the migrated D1 schemas
without executing their mutations. It reports 71 missing-table calls separately
(including Durable Object storage and migration journals); those are not passes.
Dynamic SQL and fragments remain in the wider audit. This is a syntax/schema
regression check, not a cost certificate: full rebuild admission and bounded
history work remain open.
