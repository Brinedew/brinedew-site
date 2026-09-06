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
migration receipts are preserved. The two counter migrations, transport retirement
and three inventories reserve 849,714 reads / 15,528 writes within the operator allocation. A hypothetical
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
