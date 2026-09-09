# D1 exhaustion: cause and prevention

## Recovery ownership fence: RECOVERY-001

Read [Recovery Ownership Contract](RECOVERY_OWNERSHIP_CONTRACT.md) before incident, capacity,
deployment or recovery work. The accepting executor owns delivery through a
verified user operation; the owner does not run deployment/SQL commands or
time resets. A safeguard must preserve a tested compatible repair path
under its exact failure. Continue non-deploying source publication and
isolated tests while live D1 is exhausted. Refusal is containment evidence.
Deferred work needs an inspected registered executor, accessible source,
wake condition and failure destination. A chat or Linear edit does not
schedule it. Preserve security, actual admission and schema compatibility
when replacing a deadlocking guard through explicit change control.
This contract adds no new production gate or prerequisite redesign.
Historical checkpoints below require fresh state reconciliation.

For the dated delivery state, decision fences and ordered remaining work, start
with [the B-742 recovery handoff](B742_RECOVERY_HANDOFF.md).

## September 9 follow-up measurements

The completion-time query must use `completed_at > ''` against the existing
`(status, completed_at)` index. Its former `<> ''` predicate measured 19,023 reads
when all completed timestamps were empty. The revised range returns the same
latest nonempty timestamp or null and costs at most two reads, including after
80,000 blank-timestamp jobs. This is a locally measured defect; live jobs have a
nonempty completion timestamp, so it does not establish the live cost source.

Provider Query Insights in the following investigation also recorded full
catalog (19,023 rows) and essence (19,737 rows) fetches. Workstation publication
preflight discarded both results before execution compared its actual scope
again. Removing those advisory reads preserves the real sync comparison and
authenticated readiness check. Neither these sampled queries nor changes in the
shared ledger alone establish a complete attribution of account consumption.

Explicit catalog and essence scopes now use forced unique-key probes in pages
of 500, up to the existing 25,000-symbol request maximum. The former essence
branch discarded scopes above 1,000 symbols and fetched the entire table; the
catalog branch retained the filter but could scan unrelated rows through its
optional-scope predicate. Exact per-row hashing, missing-key behavior and global
symbol ordering remain intact. Sorting the bounded result in JavaScript avoids
D1 temporary-sort reads. Real D1 measured two reads for one key, 2,002 for 1,001
keys and 50,000 for 25,000 keys, with zero writes for either table. Adding 60,000
unrelated genes did not increase those receipts. Duplicate keys are deduplicated
and an empty normalized scope does no database work. Existing deliberately
unscoped routes remain whole-state operations and still require complete
operation admission; this scoped fix does not certify their cost.

September 9 B-749 retires the aggregate `GET /api/iconoplasm/admin/catalog/state`
path entirely. The endpoint now accepts only a nonempty explicit `POST` symbol
scope, and the workstation planner derives ordinary catalog checks from the
candidate cursor's exact symbols. A scoped job repeats that same state check
before it writes, so unpublished rows remain authoritative without a published
KV digest or a hidden catalogue scan. Explicit recovery passes its complete
membership to the worker; catalog deletion remains the separately authenticated
`delete_symbols` reconcile command rather than an inferred complement. The
handler-level workerd regression measures one selected row at two D1 reads,
with the same receipt after adding 60,000 unrelated catalog rows and on an
immediate no-op repeat.

When that transition was entered by the verified D1-free reader artifact, the
canonical full-release preflight retains its recorded origin only after GitHub
proves the same workflow, repository, `main` lineage, source ancestry, and both
reader deployment/verification steps. This preserves the original migration
identity without treating an arbitrary successful deployment as a continuation.

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

### Reader recovery is independent of migration capacity

The canonical production workflow can refresh an **already-active** schema
transition with the published-card reader before admitting further D1 work.
Protected exact-commit CI, executable/migration identities, topology, and fresh
Worker/KV headroom precede that upload. The installed Cloudflare setting owns
maintenance state; a public gene API's success or failure cannot establish it.
This preserves the original fence against pausing a working application without
complete migration headroom, while allowing immutable readers to recover when
uncertain reservations consume the operator allocation. All D1 admission,
migration cursors, source-freeze triggers and retained receipts remain unchanged.
The workflow still fails if the remaining migration/release cannot complete;
reader verification is explicitly not a successful full production release.
TP53 and BRCA1 content, HEAD, unknown symbols and the protected authority route
are checked independently. The expired one-off hard-quarantine workflow is not
the release mechanism for this recovery.

When new source corrects an interrupted release, dispatch the canonical workflow
with `resume_run_id` naming its original failed production run. The shared
release helper verifies repository, canonical workflow, main branch, ancestry
and receipt-retention age before reusing that run's migration identities.
Existing continuation rules retain predictions, ceilings and every uncertain
step. Fresh read-only inventories use the current run/attempt identity: they
are new observations, not another migration allowance. This avoids both
silently renewing DDL predictions and exhausting an old two-read observation
plan before a resumable migration can continue.

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

When an already-protected transition has retained reservations that cannot
admit the entire pending release, `one-migration-per-release-v1` allows exactly
one independently bounded DDL migration to run. The workflow records a staged
checkpoint and skips catalog, Worker, route, Pages and browser activation. The
existing reset controller may dispatch the next canonical run only after that
checkpoint, and every run repeats fresh account and server admission. A working
site still requires complete release headroom before it can enter maintenance.

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

The separate B-742 `reader-recovery` transition mode is not a migration retry
and does not authorize any D1 work. It serves only the published-card-backed
gene HTML and site-detail GET/HEAD routes, so it can restore the public read
plane while votes, caretakers, generation, authoring, queues, and background
projections remain fenced. A known missing card is 404; an unavailable card
artifact is 503. Report this as **Reading restored**, never as **Full service**.

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

Before reserving any pending DDL, the release runner now checks notification
and assignment source cardinalities through the existing admitted inventory
adapter. The probes stop at 3,001 and 1,001 rows respectively, spend at most
8,004 reads combined and perform no writes. Their envelopes are included in
complete-release and maintenance-resume preflight. Already-applied migrations
do not probe their old source tables. A changed envelope, unavailable probe or
oversized source refuses before the first DDL registration. Atomic migration
guards remain in place to protect against changes after observation.

This preserves the old guards' correctness and admission guarantees while
preventing a routine source-size mismatch from stranding an expensive DDL
reservation. Real workerd tests prove the bounded probes against 20,000-row
sources; runner tests prove refusal happens before any DDL plan is registered.

Catalog initialization also runs an admitted five-read, zero-write inspection
before acquiring its retained mutation plan. Invalid retained manifests,
fingerprints, reference digests and source artifacts now report fixed stage
codes without exposing contents. The inspection uses the current attempt's
read-only identity; publication keeps its original prediction and uncertain
write reservations. Its extra reads are included in release headroom. The
scoped KV capability rejects writes during inspection before sending them.

Portrait reference digests preserve SQLite's gene-symbol ordering before adding
the `:hash` delimiter. Sorting complete serialized pairs changes the order of
prefix families such as MRPL1/MRPL10 and INS/INS-IGF2, incorrectly rejecting the
unchanged published fingerprint. Publication and verification use one shared
serializer; no stored identity or portrait selection changes. The production-size
fixture includes these prefix cases. A successful read-only comparison against
an existing exact hydrated artifact also completes preparation without replaying
its mutation plan if a later release stage failed.

Scoped finalization wakeups now force unique gene-key probes for running leases,
due jobs and pending-work counts. The optional-OR scope predicate previously
allowed a status-backlog scan even for one requested gene. The replacement
preserves exact counts, phase priority and durable retry times. A workerd fixture
adds 60,000 unrelated completed, running and queued jobs without changing the
nine-symbol read receipts (27, 30 and 26 rows respectively). At the supported
5,000-symbol maximum, the three queries measured 16,667, 15,834 and 15,000 reads;
all performed zero writes. These measurements cover selection, not phase work.
Global selection, global publication and shared finalization admission still
require their own bounds before background containment can be lifted.

Affirmative reconcile reads only the supplied keep/legacy asset keys, in pages
of at most 500 unique keys. An explicit symbol scope filters those inputs before
SQL. Omitted candidates remain untouched and are never enumerated merely to
count them; the response states `omitted_assets_preserved: true` in place of the
old `kept_absent` history count. No production consumer depended on that count.
Publication state is read only for an explicit unpublish request, which now
requires a nonempty symbol scope and probes those unique keys. A workerd test
kept a two-key lookup at three reads after adding 60,000 assets concentrated on
the same genes; 1,001 existing keys cost 2,002 reads across three pages. These
are source-selection receipts, not a bound on subsequent promotion, votes,
emulsion examples or read-model rebuilds.

Global Queue selection uses migration 0099's due partial index and migration
0103's running-lease partial index. The durable
ledger and existing phase priority remain authoritative; within each phase,
earliest due time now precedes original request time. This avoids scanning
future retries to preserve an old arrival sort. Each of four priority ranges
stops at the batch limit before merging, and stale-running selection stops at
250 index entries. Scheduling consumes `has_runnable`, an existence result,
instead of counting every runnable job. Exact remaining totals still come from
the transactional singleton; future wakeups retain the earliest durable date.

Each index has source-size admission before DDL and atomic guards for at most
25,000 total jobs and 5,000 unfinished jobs. The populations are disjoint and
contain no completed history. Splitting the formerly combined 0099 migration
keeps the compatibility contract while allowing each full-table build to reserve
its own 68,706-read/5,064-write envelope. Probe identities include their
query name so multiple checks against one database cannot share a mismatched
prediction. A 25,000-row workerd migration with 5,000 unfinished jobs measured
60,129 reads and 5,002 writes for the due index, within its 68,706-read/5,064-write bound. Global
selection beside 85,000 stored jobs measured 250 reads for running leases,
128 for a 25-job due batch, 1,253 for the 250-job maximum and nine for readiness.
With every queued/retrying job moved into the future, due selection cost eight
reads and readiness remained nine, with the correct future wakeup. These are selection and
migration receipts; global publication, phase execution and whole-operation
shared admission remain required before background containment is lifted.

The deployment drift guard now checks the runtime's selector calls and requires
both real-SQL selector suites in the release gate. Its earlier ordering-comment
check broke when the SQL moved into dedicated modules, despite protected CI
passing. The guard itself also runs in ordinary CI, so release-only source drift
is caught before merge. The protected phase priority, pending-finalize exclusion
and durable future wakeups are unchanged and remain behaviorally tested.

Production releases serialize through final activation without automatically
cancelling an active release. A delayed older push previously interrupted a newer
run after Worker upload but before Pages activation. Every queued release now
verifies its exact SHA against current main before any production admission;
stale or unverifiable source refuses. This preserves one coherent activation
sequence and prevents delayed events from rolling the deployment backward.

Finalization phase transitions use migration 0100's monotonically increasing
job version. Enqueue, claim, retry and phase advancement each invalidate the
previous version; a failed claim cannot execute phase work. Stale recovery and
an old worker's success/failure compete through the same exact-key conditional
update. This preserves durable saved payloads and retry dates while preventing
duplicate deliveries from advancing the same claim or overwriting a newer job.
Request-time table/index creation is removed: the canonical migration pipeline
owns schema readiness. With 25,001 jobs and the transactional summary and queue
indexes enabled, workerd measured 35 reads/four writes for the migration, two
reads/seven writes for successful transitions and one read/zero writes for a
lost claim. D1's change count includes summary-trigger updates; claim success
uses a positive receipt, not an assumption of exactly one changed row.
Version fencing does not by itself bound phase side
effects or the global publication tail; containment remains until their shared
admission and bounded execution are implemented and verified.

The global completion tail uses migration 0101's transactional handoff state.
Every phase already rebuilds its requested visions; collecting all ready jobs'
vision lists repeated that work, could truncate their union and grew with the
entire backlog. Ready jobs now finish in exact-version pages of at most 100,
using the existing partial index or explicit scoped keys. A transactional counter
also replaces the residual COUNT of nonterminal rows with phase `completed`.

The handoff records the enqueue generation accepted by the existing publisher.
It owns no card, head or publication watermark. New enqueues during a wakeup
remain unacknowledged; expired tokens cannot acknowledge a replacement lease.
Deferred wakeups retain their deadline even when all job rows are completed.
The status contract keeps `unfinished` as an exact job count and separately
reports `pending_handoffs` (zero or one); `total_pending` includes both. The
workstation waits for both categories. An acknowledged wakeup is a durable
publisher handoff, not proof that its new artifact is already live.

With 60,000 completed-history rows, 5,000 terminal-phase rows and 201 ready rows,
workerd measured migration 0101 at 10,023 reads/nine writes within its
53,028-read/32-write bound. All 5,201 rows completed across bounded pages with
one publisher notification; the largest completion invocation measured 1,205
reads and 600 writes. A 5,000-symbol scope with every row ready measured 20,000
selection reads: input enumeration, key probes and candidate ordering remain
bounded by that explicit scope, independent of unrelated history. Tests also
cover newer enqueues, duplicate wakeups, expired lease owners
and a retained next-day retry. Phase execution and whole-operation shared
admission still require completion before background containment is lifted.

The pending-job list retains its ready-first, due-date, request-date and symbol
ordering. Its former optional-scope query sorted every unfinished job before
returning the requested page. Migration 0102 adds the exact partial ordering
index, excluding completed history. Global lists stop at the requested limit;
scoped lists probe only the explicit unique keys before sorting. Unknown stored
phases remain visible, and future retries retain their place in the status view.
With 25,000 jobs and 5,000 unfinished rows, the admitted migration measured
60,117 reads and 5,004 writes within its 68,706-read/5,064-write bound. The
prediction reserves 64,354 reads and 5,064 writes rather than understating the
known index-write cost. Global 1/200/1,000-row lists measured 1/200/1,000 reads;
the maximum 5,000-key scoped list measured 20,000 reads. Adding 60,000 unfinished
and 20,000 completed jobs left those costs unchanged. Migration guards refuse an
oversized source before index creation; ordinary list growth requires no new
migration or scan. These receipts bound listing, not phase execution.

The first 0102 release refused before any production mutation because its
conservative envelope plus duplicate prerequisite scans exceeded the remaining
shared allocation. Its preflight now reads the existing transactional summary
for total and unfinished counts in two singleton probes. The migration still
validates the real source inside its atomic batch before DDL, so a bad counter
cannot authorize an oversized index build. Its single-index read envelope is
two source passes, two capped unfinished ranges and bounded schema overhead;
the queue due and running indexes use that same individually admitted envelope.
No allowance, unknown reservation or admission check is removed.
At the maximum 1,024 schema objects as well as 25,000 jobs/5,000 unfinished
rows, workerd measured 61,121 migration reads and 5,004 writes. Both preflight
counters read one row before and after adding 80,000 jobs.
