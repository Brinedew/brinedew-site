# D1 exhaustion: cause and prevention

## September 5 evidence

Cloudflare account analytics at approximately 09:50 UTC reported 5.97 million
rows read: roughly 4.86 million in Iconoplasm, 1.10 million in authoring, and
6,096 in GeneGuessr. These databases share one allowance. GeneGuessr migration
and OAuth failures were consequences, not evidence that GeneGuessr caused it.

Query Insights identified these concrete consumption defects:

- Finalization status counted unfinished jobs by scanning completed history:
  19,024 rows per call, 627,792 across 33 observed calls.
- Authoring gene resolution joined every identity to aliases before applying
  an OR predicate: about 28,901 rows per lookup, 317,917 across 11 calls.
- The previous snapshot builder copied 10,795 transport parts, accounting for
  237,490 observed reads and 43,180 writes. B-739 replaces this with streaming.
- Open/cancelled request counts scanned the requester's fulfilled history too.

The query-level dataset does not reconcile to the account aggregate. These
figures identify verified contributors, not an invented complete attribution.
Raw bounded evidence is in `artifacts/rescue-core-flows/d1-incident-*.json`.

## Chesterton's fence

**ARCHITECTURE FENCE [IPD-012]**: durable jobs exist to resume partially completed
publication safely. Exact status counts and completion timestamps are part of
the workstation contract. Preserve the jobs, phases, retry dates and exact
totals. Do not delete completed history or replace exact counts with guessed
values to reduce reads.

Migration 0094 maintains six counters on one row with transactional
insert/update/delete triggers. Global status reads that row and obtains the
latest completion using an indexed maximum. Scoped status probes only the
requested gene keys (maximum 5,000). A partial unfinished index excludes
completed history from pending lists and drains. The initial migration scans
history once; its index construction spends writes and requires deployment
headroom. Missing counters fail explicitly; no hidden scan fallback.

Gene resolution retains ID, case-insensitive canonical symbol, alias and merged
gene metadata. It first unions three indexed ID probes, then reads metadata.
The authoritative identities and aliases remain unchanged. Notification joins
still verify actual request, delivery and asset identity; do not remove those
joins as a cost shortcut.

## Admission and protected capacity

The account entitlement remains 5 million reads and 100,000 writes per UTC day.
The existing administrative/authoring runtime ledger now allocates at most
1 million reads and 20,000 writes. Historical monthly settings cannot raise
that allocation. This leaves headroom for readers, login, other databases,
concurrent in-flight requests and recovery. The ledger records actual costs;
it is not a complete account telemetry source or an atomic per-query reservation.

The existing PowerShell cutover preflight now also checks account-wide D1
analytics, across every database. It refuses new operator traffic at 3.5 million
reads or 70,000 writes, and on missing, invalid or wrong-day telemetry. Existing
atomic request reservations and Worker ceilings remain required. Analytics
lag is why this threshold is below the provider wall. Keep each operation's
work bounded; neither request count nor a fresh analytics sample bounds an
arbitrary SQL scan.

The normal production workflow runs this same control-plane preflight before
any D1 migration. It stops an exhausted release before spending more application
reads. It uses the existing CI credentials; no new provider or state owner.

Do not increase limits or retry continuously to finish a batch. Find the costly
query or repeated caller. Query analytics through the provider control plane,
which does not scan application D1, and verify SQL plans locally at catalogue
scale before running production work.

## Release and acceptance

### September 8 retained-reservation recovery

Run `34184941658` passed exact-commit CI and provider headroom but migration
0095 refused `COST_SHARED_DAILY_LIMIT`. The preceding run `34176838247` has
an unsettled 753,048-read / 256-write reservation for that migration. It must
remain charged; low account telemetry is not a provider receipt and cannot
refund it. No schema mutation was dispatched by the September 8 retry.

The same authority now exposes an admin-only `/capacity` control read of its
combined current-day operation reservations and legacy usage, including uncertain
work. It does not read D1 or reset any plan. Release diagnostics inspect at most
1,025 schema objects per database through the existing registered inventory
adapter and retain their actual provider receipts separately from expensive DDL.
This staged capability upgrade is diagnostic, not production recovery. The next
release-preflight change must consume the shared capacity before pausing service;
account telemetry alone cannot establish available operator capacity.

### Read-only published catalog cutover

Catalog hydration formerly repaired a missing artifact on a reader request.
That mechanism kept a cold isolate usable, but multiplied D1 reads and KV writes
across readers. The replacement preserves the exact portrait fingerprint and
catalog identity: the publisher verifies the reference digest, writes hydrated
payloads before their fingerprint pointer, and advances the catalog manifest
last. Failed publication does not advance the isolate cache. Missing published
artifacts return an uncached 503; readers never reconstruct or persist them.
KV remains eventually consistent across locations; this ordering is not a claim
of cross-location transactional visibility.

Before activating this reader, the release initializes the retained current
catalog through the existing operation-cost authority. Its reviewed capability
allows five KV reads and one hydrated-artifact write, no D1, lists or deletes.
It verifies the source, references and fingerprint and preserves both pointers.
Inputs and output are capped at 20 MiB and 20,000 genes. A real local workerd
test processes an 18,480,071-byte, 20,000-gene catalog within that envelope;
repetition performs five reads and zero writes. Supported extension releases
currently share the same schema; a future older supported schema must have its
compatibility artifact published explicitly before exposing it.

KV admission extends the same transactional reservation and continuation
authority. Additive auxiliary tables preserve existing D1 plans and receipts.
Operator daily ceilings are 10,000 reads, 200 writes, 100 deletes and 100 lists;
account admission ceilings are 70,000 reads and 700 for each other operation.
Fresh account-wide `kvOperationsAdaptiveGroups` telemetry is mandatory. Missing,
stale or malformed telemetry refuses work before KV; uncertain execution keeps
the reservation. Release retries inherit their spending and cannot renew the
two-times-prediction ceiling. These controls cover this initialization adapter;
they do not yet certify all publication or background KV work.

Exhaustion is checked against the resources an adapter can actually spend. The
KV-only capability has no D1 access and can therefore run with healthy KV/Worker
headroom during a D1 outage; every adapter that touches D1 retains both D1 gates.
A zero-delete/zero-list bound cannot consume those KV allowances. Identical cached
KV telemetry causes no further storage write, and the auxiliary KV day tables
use the same seven-day retention as the original authority tables.

### Retired snapshot storage

Migration 0015 removes only `icono_manifestation_snapshot_parts`, the old copied
v1 transport. Migration 0012 already moved current snapshots to immutable source
pages. Those baselines, events, checkpoint parts and their rowids remain intact;
lease audit records also remain. The uncalled legacy sweeper is retired with its
table. Cleanup refuses an active v1 lease and executes bounded lease/schema
guards, the drop and its migration journal entry in one admitted transaction.
A full-schema workerd regression preserves an active v2 snapshot's exact pages
and source rowids while reclaiming the obsolete copies' pages. Do not run VACUUM
or rebuild source tables while streaming leases exist.

The local 10,000-part cleanup used 1,292 reads and three writes within its
12,548-read/16-write envelope. These measured row costs do not establish the
live table's storage share. Verify the provider's database size after release
before reporting how much production capacity was recovered.

### Mandatory operation admission (B-741)

The existing global budget Durable Object also owns immutable cost plans.
`/api/iconoplasm/admin/cost/operations` lists reviewed adapters and their exact
implementation/schema hashes. Register a prediction in rows read, rows written
and Worker requests before execution. Each step reserves an authority-computed
maximum against twice that prediction, the shared operator allocation and fresh
account-wide usage. The authority executes the step itself and reconciles actual
D1 receipts. Missing receipts retain the maximum reservation; retries never
refund it. An underestimated verified bound invalidates that implementation.
Discovery, registration and receipt requests share the request allocation;
execution leaves 100 requests for diagnosis. Receiving a refused HTTP request
still costs a Worker invocation; this gate prevents its database execution.

Replica snapshots, event pages/acknowledgements, exact body downloads and Tags
head selection require operation headers. Selection includes its exact accepted
event projection and publication wake in the reservation, with both databases
metered. A published replay does not repeat the projection.
The workstation persists the plan before registration and
the next step before network dispatch. A failed run reuses the original plan;
an expired plan or a deployed implementation correction can create one linked
continuation with the same prediction and all previous spending inherited.
Unknown outcomes retain their full reservation. Continuing permanently closes
the predecessor to new work, and a second successor is refused. Code changes,
process restarts and UTC rollover cannot restore a spent allowance. A client
requires explicit server support before using this protocol; absent historical
receipts with locally dispatched work fail closed.
The whole-job ceiling is twice its forecast; it is separate from the smaller
daily allocation. Longer jobs can continue across days without borrowing daily
headroom or resetting total spending. Continuations preserve the predecessor's
exact ceiling, including older plans with a smaller historical ceiling. Sync
command forecasts include selection plus primary projection, not just the
authoring command's own statements.
Completed refreshes permit a new explicit job. The refresh has at most 240 pages
per pass, with two passes included in one forecast for post-command convergence.
Body hydration predicts one exact download; it never fans out over the catalogue.

The former request-triggered projection recovery existed to retry durable
outboxes. It also ran before authentication, allowing rejected reads to trigger
database work. Its replacement retains accepted-event projection and the existing
15-minute outbox drain. Reads and authentication failures schedule no repair work.
Accepted-event projection now uses the event's unique key, instead of sorting the
pending backlog and taking up to 50 events. It still reads the current authority
head and cannot rewind canonical state. Acknowledgement touches at most 250
consecutive gene revisions through the unique gene/revision index; older pending
records remain available to scheduled recovery and continue to block premature
compaction. Scheduled selection now reads four disjoint ranges through the
existing status/retry index, at most 50 rows per range, then coalesces that bounded
window in memory. It no longer searches the full backlog for a newer event.
Each selected callback still reads the current authoritative head; delayed
retries stay queued. A 5,800-event regression checks indexed query plans, complete
eventual progress and unchanged future retries. The whole scheduled drain still
needs mandatory admission for its downstream account/assignment/publication work.

The shared alias lookup previously sorted complete gene histories on ordinary
commands. It now takes at most 257 rows through the existing gene index before
sorting and refuses histories above the 256-row command envelope. It never
truncates aliases in an accepted event. Larger histories require a bounded paged
event schema before execution. Upload verification now follows the currently
installed storage object's unique key to its adopted intent; a historical
adopted upload cannot prove the current object or cause an unbounded history sort.

Authoring migration `0013` removes the old first-upload exception from both
storage-insert guards. It existed to permit imports without reservations; every
current production writer, including cutover imports and restores, already
reserves before uploading. New inserts always require a matching, unexpired
upload reservation through the unique object-key index. Existing stored content
is unchanged, as are adoption and restore protections. The migration replaces
two triggers without scanning content or building indexes; its admitted batch
caps schema size before DDL and records the migration atomically.
Local workerd measured this migration at 640 reads and 5 writes within its
4,352-read/32-write reservation. Separate upgrade tests preserve existing content
and reject missing, mismatched, expired and failed reservations for both body kinds.

Local workerd verification uses the production compatibility date and full
primary schema: 20,000 genes, a 300-event pending history and 256 aliases.
Selection plus projection used 2,438 reads and 531 writes within a 4,096/2,048
reservation. Exact encrypted prose and Tags downloads used 6 and 8 reads, with
zero D1 writes. The shared batch meter replaces duplicate receipt-validation
loops across diagnosis and migration adapters.

The production workflow now uses `run-admitted-d1-migrations.mjs` and the
checked-in `cloudflare/operation-cost-migration-plan.json`. All three migration
inventories are capped and admitted. Every pending migration must have a reviewed
adapter and prediction before the first schema change. The migration's row-count
guards, DDL and migration receipt run in one transactional D1 batch. Raw Wrangler
D1 migration/execute commands are excluded from this workflow.

The old deployment order protected application/schema compatibility: DDL ran
before new handlers accepted commands. Prediction admission itself now needs to
be available to execute that DDL. The workflow stages the same state owner with
`ICONOPLASM_SCHEMA_TRANSITION=1`, performs admitted migrations, then activates
the normal configuration (`0`). These steps stay adjacent. During the transition,
Iconoplasm application API requests receive 503 with Retry-After, queue batches
are retried without acknowledgement, and periodic Iconoplasm projection work
waits for its next tick. Static assets and GeneGuessr keep their existing paths.
On migration failure the workflow leaves the gate closed; do not activate
unready handlers or retry with a larger prediction. Inspect the retained receipt
and correct the cause. This is a temporary release transition, not a second worker.

Deployment prerequisites are the existing `ICONOPLASM_ADMIN_TOKEN` repository
secret and `CLOUDFLARE_BUDGET_ANALYTICS_TOKEN` in both the Worker and repository,
with account analytics read permission, plus the account ID. Analytics failure
stops admission. Before release mutations and again immediately before staging,
`preflight-operation-cost-release.mjs` reads fresh account telemetry without D1
queries. It checks the entire reviewed migration set plus all three inventories
at twice their forecasts, including control requests, against the same account
headroom ceilings as the server ledger. It also prepares the actual reviewed
adapters locally, without database bindings, to reject invalid arguments,
underfunded steps and combined maxima above the daily operator allocation.
The HTTP authority and preflight share one migration-adapter registry.
Missing, stale, malformed or exhausted
telemetry stops the workflow before it pauses application work. This prevents
known refusals from stranding production in transition; it does not reserve
capacity or replace the server's atomic admission against concurrent spending.
Implementation/migration identity generation is checked in CI and deployment.

Release operation IDs use the original GitHub run ID and adapter ID, excluding
the run-attempt number and pending-migration position. Reruns retrieve those
receipts and use another step within the same ceiling. Expiry or corrected code
uses the server's preserved-budget continuation, including unknown reservations.
The original GitHub creation date must be within six days so a rerun cannot
outlive the seven-day receipt retention and silently reset its allowance. The
runner has a 40-request cap, included in release preflight, with no implicit
network retry. A lost continuation response is recovered by following the
server's recorded successor.

Migration history is checked against every schema owner of a database. The
GeneGuessr journal includes `workers/benchmark/migrations` as well as the root
`migrations` directory; the benchmark migration-only Wrangler configuration
explicitly targets that same database. Iconoplasm also retains the historical
`0045_add_gene_comments.sql` journal entry. The committed 0045 and 0046 files
document this earlier minimal table. That entry is accepted only when both
`0045_gene_comments_and_clans_backend.sql` and `0046_gene_comment_columns.sql`
are recorded as applied. No journal rows are removed or rewritten, and the old
entry never substitutes for either repair. Unknown names and duplicate records
still stop all DDL. Read-only admitted inventories on September 6 confirmed
these three historical entries using 141 D1 rows read and zero rows written.

Delivery selection uses the transactionally maintained readiness queue in
unreleased migration 0096, not a filtered scan of all notifications. Keep the
bounded publication-member index and complete-group atomic claim; reverting to
`LIMIT 1` after correlated leader/count filters restores a measured 120,000-read
query at 20,000 ready groups. Migration 0097 separately checkpoints historical
delivery reconciliation. Both require the compatible schema before runtime
activation. See the system audit for measured costs and remaining coverage gaps.

**Cutover status:** these changes are under local verification. Legacy admin
operations, Tags creation, generation and maintenance still require migration
to reviewed adapters; workstation/provider credentials still require their
supported capability cutover. Do not claim universal enforcement or live recovery
until those paths and production acceptance are complete.

Run the real-SQLite gene-resolver and finalization-summary tests, the D1 policy
and admission tests, and normal full release checks. The plan regressions use
20,000 rows and must reject catalogue scans. Counter tests cover creation,
state transitions, scoped reads, deletion and rollback.

The September 5 release attempt stopped at the D1 migration step. New Worker
code cannot be called live until the normal pipeline applies migrations and
deploys successfully. Waiting for the allowance reset is only a release access
condition; it does not complete this incident. After deployment compare actual
rows_read for the affected status and gene routes, prove account headroom under
the bounded bootstrap, and complete B-739/B-740 live acceptance. Until then,
report source/test proof separately from deployed prevention.

### September 8: resumable counter recovery (B-742)

Admitted production probes found 19,023 catalog rows, 19,160 rollup rows, and
more than 50,000 portrait assets. Migration 0095's 50,000-asset guard therefore
rejects this real dataset. The earlier uncertain 753,048-read reservation is
retained; low provider telemetry does not establish a refund.

The replacement keeps the guard's purpose: reserve a proven maximum before
dispatch, preserve exact counters including orphan assets, and never activate
application code with a partial schema. A fixed 1,024-row SQLite rowid page now
adds totals and advances its cursor in one transaction. Temporary database
triggers freeze source inserts, updates, and deletes across all entrypoints.
The final transaction publishes totals, replaces those locks with permanent
counter triggers, records migration 0095, and removes the progress table.
No source rows or private bodies are copied. A missing final response is
resolved through the existing migration journal; initialization cannot replay it.

The normal release runner reuses its immutable plan for at most 100 steps,
checks shared capacity before every page, and stops with
`COST_MIGRATION_RESUME_AFTER_HEADROOM` before a page that cannot fit. Retries
resume the committed cursor and retain old uncertain reservations. Its explicit
256-request client maximum includes per-page capacity reads; the account and
shared daily allowances are unchanged.

Preflight includes schema inspection and cumulative release requests. A working
site requires complete release headroom before entering maintenance. Only a
site already returning the exact schema-transition response may resume its first
paged migration with sufficient capacity for staging diagnostics and its initial
step. This mode is reported as `resume-existing-maintenance`, not recovery.

Real workerd/D1 tests use 60,001 assets, orphan rollup/asset rows, negative source
rowids, a simulated lost response, and source-write attempts during the seed.
Every step must fit its bound; final totals must equal the full canonical seed.
These checks do not certify the remaining background, storage-growth, personal
shelf, bulk-inbox or full-UTC-day acceptance work in B-742.
