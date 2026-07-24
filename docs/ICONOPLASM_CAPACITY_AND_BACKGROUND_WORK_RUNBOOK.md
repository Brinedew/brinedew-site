# Iconoplasm capacity and background-work runbook

This runbook records the capacity decisions exposed by the 2026-07-22
finalization incident and the 2026-07-23 shoutout review. They are separate
invariants and must not be collapsed into “the Queue was noisy” or “traffic was
high.”

## ARCHITECTURE FENCE [IPD-004]: Queue wakeups follow due work

The durable D1 ledger owns whether work exists and when it may run. A Queue
message is only a wakeup. “Unfinished” does not mean “runnable now.”

- Finalization replacement messages use the earliest future `next_attempt_at`.
- Partial work stopped by a budget barrier sleeps before checking again.
- Vote projection retries use the durable retry time, not a short polling cap.
- Empty polling loops are prohibited. One future job may own at most one delayed
  wakeup per delivery; it must not continuously ack and replace itself.
- Cloudflare Queue retries are billable reads. A retry delay is part of the cost
  model, not merely latency tuning.

When changing a background consumer, test all four states: no job, runnable job,
future job, and failed job whose durable backoff was just advanced. The future
case must prove that no immediate replacement is sent.

## ARCHITECTURE FENCE [IPD-005]: the primary D1 is bounded operational state

The Free-plan wall is **500,000,000 bytes per D1 database**. The separate 5 GB
account allowance is not the denominator for a single database. The operational
target is 80% (400,000,000 bytes) so maintenance still has room to write and
delete.

The primary `iconoplasm` D1 stores current relational state and bounded hot
history. It must not accumulate either of these:

- a second copy of immutable gene-profile prose in a read model;
- unbounded historical publish events.

`icono_gene_essence` remains the canonical manifestation source.
`icono_admin_gene_rollup.manifestation` is deliberately kept empty during the
rolling schema transition; bounded admin result queries join the canonical row.

Publish events remain hot for 30 days. Scheduled maintenance copies a bounded
batch to `ICONOPLASM_AUDIT_DB`, verifies every event ID in the cold database,
and only then deletes those IDs from the primary database. A failed copy or
verification leaves the hot rows untouched. The archive operation is idempotent
because the original event ID is the cold primary key.

## ARCHITECTURE FENCE [IPD-007]: static-first, one dynamic Worker

`iconoplasm.brinedew.bio/*` belongs directly to `geneguessr-api`. Matching
homepage, privacy, JavaScript, CSS, font, icon, and download files are served by
Workers Static Assets before Worker code executes. Dynamic misses such as
`/api/*`, `/gene/*`, crawler documents, admin routes, and portrait fallback
enter the existing stateful Worker once.

The shared public proxy must not reclaim the Iconoplasm hostname. Production
telemetry on the Free plan showed nearly one public invocation for every
internal invocation, so the proxy doubled the metered request count. A normal
Iconoplasm page also requested more than one hundred static dependencies. Cache
API hits inside a Worker do not solve that cost; matching assets must bypass the
Worker.

Service-binding requests to the stateful Worker also pass through its
asset-first dispatcher. Consequently, the shared Brinedew/GeneGuessr edge must
serve its own hostname-sensitive root, index, and privacy HTML documents
directly from the canonical Pages deployment. Otherwise the stateful Worker's
Iconoplasm `index.html` or `privacy.html` captures those paths before
host-aware Worker code runs. This exception is stateless and document-only:
the public edge must not gain state bindings, reclaim the Iconoplasm hostname,
or absorb APIs, authenticated reads, draft checks, or other dynamic behavior.

The generated bundle must:

- be built deterministically from the current Quartz output;
- remain below 20,000 files and 25 MiB per file;
- carry the same CSP, clickjacking, MIME, referrer, permissions, and transport
  headers as the previous Worker-served responses;
- keep dynamic gene pages on the Worker so complete first paint, alias
  redirects, unknown-symbol 404s, and crawl eligibility remain correct.

Rate limiting belongs in the stateful route owner, where direct and shared-host
dynamic requests cannot accidentally bypass it or be charged twice. Voting
authority remains the per-gene VoteCoordinator Durable Object; never move
immediate ranking truth to eventually consistent KV to make this routing shape
look simpler.

Linear B-670 contains the live telemetry, user journeys, 22 ranked scenarios,
research synthesis, rejected alternatives, and zero-spend constraint. Treat
that evidence as revisable. Do not treat this fence—or an older issue—as
authority when newer production evidence proves a better complete design.

## ARCHITECTURE FENCE [IPD-008]: public reads scale with publications and sessions

Anonymous startup uses static files and published immutable artifacts. It must
not spend dynamic requests on cross-subdomain settings, authentication,
discoveries, inventory counts, or admin-state probes. The fixed 19,023-gene
catalog count is release metadata. Guest starter discoveries and the compact
website guest shelf are local product state. The shelf can retain all 19,023
deliberately visited dossier symbols in `localStorage`; it never posts while
signed out. Each authenticated browser session merges at most 200 pending
symbols and clears only that batch after a successful response.

The readable `brinedew_session_present` cookie is only a request-suppression
hint. It contains no user ID, role, or secret and grants no authority. Only the
HttpOnly session cookie authenticates a request. When the hint is present, the
homepage may make one direct `/api/auth/me` request to the Iconoplasm route
owner; a 401 clears the stale hint. This deliberately avoids charging every
lurker for an auth check.

Extension hover detail is immutable within a published card snapshot:

- the catalog manifest exposes `card_snapshot_version`;
- public gene batches read the corresponding published card artifact, not D1;
- installed extensions keep a bounded local detail cache keyed by that version;
- a version change invalidates the cache;
- only an explicit `missing` result is negative-cached, and transient failures
  remain retryable.

Catalog portrait fingerprints and portrait-reference snapshots are publication
artifacts too. Catalog publication writes them before advertising the version.
Public manifest, search, and artifact reads consume the published metadata even
after its former five-minute timestamp; they never scan D1 or write KV to
"repair" it. Missing or corrupt publication state returns a retryable 503.

The batch endpoint still costs one Worker invocation on a cache miss. Persistence
changes the unit of cost from page navigation to unique gene detail per
publication snapshot, while the published artifact removes D1 read pressure.
Writes, votes, authenticated account feeds, and complete gene HTML remain
dynamic and keep their existing authority.

Discovery follows the same product boundary:

- a signed-out website gene visit is retained in the full-catalog local shelf without
  a Worker request;
- each authenticated browser session merges at most 200 pending symbols and
  preserves the remainder, or the whole batch on any failed response;
- signed-in encounters update the personal row and increment the shared rollup
  in constant time;
- the hourly publication tick, not a reader request, owns the shared-discovery
  KV snapshot; and
- the signed-in request inbox polls each minute only while a generation request
  is open, with one-shot refreshes on startup, focus, and visibility return.

The canonical launch calculation is
`docs/ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md`, backed by
`scripts/iconoplasm-first-principles-capacity.mjs`. Current and historical
request counters are incident evidence only. They are prohibited as forecast
inputs after a material architecture change.

The canonical product/freshness contract is
`docs/ICONOPLASM_PRODUCT_OPERATING_MODEL.md`. The capacity model owns resource
envelopes. Any read path that mutates state, whole-catalog recomputation
triggered by public reads, unbounded polling, or homegrown distributed cache
behavior must be recorded with its exact resource ceiling and permanent
correction.
Linear may track remaining implementation, but a stale issue is not architectural
authority.

## Incident evidence

At 2026-07-22 15:05 UTC:

- primary D1: 499,994,624 bytes;
- publish event ledger: 297,818 rows;
- duplicated rollup manifestation values: 19,110 rows;
- finalization Queue: the 10,000 daily operation allowance exhausted;
- root job failure: `D1_ERROR: Exceeded maximum DB size`.

Recovery copied and verified all 297,818 events in `iconoplasm-audit`, then
removed 297,118 events older than 2026-06-22 from the hot database. Clearing the
duplicated rollup payload reduced the primary database to 393,740,288 bytes.
The canonical gene essence was not removed or changed.

The pre-recovery SQL export is retained in the incident artifact archive and is
recoverable in addition to D1 Time Travel. Linear issue B-667 owns the incident,
root-cause analysis, release evidence, and any future migration.

## Capacity response

- Below 80%: normal operation; nightly archival keeps history bounded.
- At or above 80%: observability status is warning; investigate table growth
  before bulk publication or reconciliation.
- At or above 100%: observability status is critical; stop bulk work, preserve a
  Time Travel/export recovery point, archive cold rows, and remove duplicated or
  obsolete materializations before resuming.

Never “fix” a capacity incident by deleting history without a verified archive,
changing the dashboard denominator, disabling the Queue, or adding a faster
poll. Those actions hide or amplify the failure.
