# Cloudflare system budget audit

Status: implementation and capacity verification in progress; not a production safety certificate.

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
The combined scheduler invocation and cumulative daily admission remain open;
these local query fixes do not certify scheduler capacity.

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
