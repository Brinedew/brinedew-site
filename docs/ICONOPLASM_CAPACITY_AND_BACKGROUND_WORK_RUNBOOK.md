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

Requested gene-card materialization is deliberately serial and demand driven.
The D1 row is the authority; a Queue message only wakes its current generation.
The consumer uses batch size one and maximum concurrency one. Duplicate voter
requests converge on that row, expired leases are recovered by the scheduled
job, and stale generations are harmless. Provider deferrals preserve the
attempt count and wait until the durable due time instead of spinning Queue
operations.

When the daily Browser budget is exhausted, the row advances to the next UTC
day but does not mint one delayed Queue message per waiting gene. The scheduled
recovery job wakes bounded due rows from D1. Short launch-interval deferrals may
use one delayed Queue wakeup because they become runnable within seconds.

Browser Rendering is protected by a D1 budget shared across isolates: at most
eight launches and 480 reserved seconds per UTC day, with at least 25 seconds
between launches. These are launch reservations, so crashes cannot silently
refund capacity and create a thundering herd.

## ARCHITECTURE FENCE [IPD-005]: the primary D1 is bounded operational state

The Free-plan wall is **500,000,000 bytes per D1 database**. The separate 5 GB
account allowance is not the denominator for a single database. The operational
target is 80% (400,000,000 bytes) so maintenance still has room to write and
delete.

The primary `iconoplasm` D1 stores current relational state and bounded hot
history. It must not accumulate either of these:

- a second copy of immutable gene-profile prose in a read model;
- unbounded historical publish events.

The gene-card ledger is bounded by the canonical 19,023-gene inventory and
stores only the newest desired/ready fingerprints, lease, retry state, object
key, and request count. It stores neither PNG bytes nor per-request history.
Seven daily budget rows are retained. Content-addressed PNGs live in Bunny
Storage, where a matching existing object can be reused without launching a
browser.

`icono_gene_essence` remains the canonical manifestation source.
`icono_admin_gene_rollup.manifestation` is deliberately kept empty during the
rolling schema transition; bounded admin result queries join the canonical row.

Publish events remain hot for 30 days. Scheduled maintenance copies a bounded
batch to `ICONOPLASM_AUDIT_DB`, verifies every event ID in the cold database,
and only then deletes those IDs from the primary database. A failed copy or
verification leaves the hot rows untouched. The archive operation is idempotent
because the original event ID is the cold primary key.

Administrator recognition policies are bounded operational state too. D1 keeps
one current publication-alias row, one current shared-blocklist row, and only
the newest 100 audit revisions for each. Their immutable individual KV histories
and the atomic recognition-pair history are likewise capped at 100; do not turn
routine policy maintenance into append-only growth. Recognition validation is
one singleton D1 receipt for the current exact policy/scanner tuple; attempts,
leases, scanner builds, and failures must never become an append-only ledger.

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

### Canonical gene first-paint cold path (B-694)

The route owner has one deliberately staged read path for `/gene/{SYMBOL}`:

1. Static Assets serves matching files before Worker code.
2. The existing stateful Worker resolves an exact canonical symbol from the
   identity-only `icono_published_gene_routes` D1 index. Publication advances
   this table only after the card-catalog barrier succeeds. The normal exact
   identity-resolution stage therefore spends zero KV reads and does not hydrate
   the 19,023-gene artifact or let unpublished catalog rows enter discovery.
3. The Worker asks the existing site-gene detail handler for the response
   headers only. Its ETag supplies the immutable HTML snapshot key; the detail
   handler uses bounded indexed D1 reads for fresh page facts, votes, and
   candidates, plus a bounded one-symbol read from the exact card artifact
   selected by `KV_GALLERY_VERSION`. The card portrait overrides D1 portrait
   identity and candidate `is_current` state.
4. `caches.default.match` runs before JSON parsing, card rendering, or shell
   injection. A hit returns the cached document immediately.
5. Only a miss parses the detail payload and renders the complete first-paint
   card. The same response is reused for rendering; it is not fetched again.

Alias and UniProt identifiers are intentionally different: they are not D1
primary keys and continue through the immutable published-catalog resolver so
they can redirect without creating a second alias map. Unknown symbols remain
real 404s; incomplete profiles remain noindex; complete profiles remain the
only indexable discovery surface.

Do not merge route membership, D1 authoring state, and public portrait identity
into one snapshot. The route index answers only “has this symbol crossed
publication?”. The complete detail payload and ETag combine fresh bounded D1
facts with the exact published-card portrait and card version. D1 may
legitimately lead until a dirty-shard release; there is no gene-detail fallback
that exposes that unpublished SHA. Selecting public portrait identity from D1
would restore mixed-authority split-brain, while resolving ordinary exact-symbol
membership from the whole KV catalog would restore the request-spend regression.

The protected entrypoint/config names are part of the architecture contract and
must not be shortened or replaced:

- `workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js`
- `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- `wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml`

If a future extraction is needed, keep those files as the composition and
dispatch boundary. New internal modules may add responsibility segments only
inside that boundary, while retaining an `iconoplasm-` prefix and the explicit
`-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js`
suffix. Names such as `iconoplasm-web`, `public-worker`, `handler`, or
`utils` are prohibited because they hide ownership and invite a second Worker
or state owner. The extraction must preserve IPD-007: no shared public proxy,
no normal-request service binding, no symbol-only cache, and no duplicate
publication state.

The regression contract lives in
`workers/iconoplasm-gene-cold-path.test.js`. A change is incomplete if that
test no longer proves both the indexed canonical lookup and cache-before-render
ordering.

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
signed out. Each authenticated page session merges at most 200 pending
symbols and clears only that batch after a successful response.

The visible signed-out archive is the fixed published set `INS`, `RHO`, `PRL`,
and `CD4`. Any card backs shown after those four are noninteractive continuation
scenery beneath the existing infocard fade: they carry no gene symbols, do not
count as discoveries, and must not cause an authentication, catalog, or card
detail request.

The readable `brinedew_session_present` cookie is only a request-suppression
hint. It contains no user ID, role, or secret and grants no authority. Only the
HttpOnly session cookie authenticates a request. When the hint is present, the
homepage may make one direct `/api/auth/me` request to the Iconoplasm route
owner; a 401 clears the stale hint. This deliberately avoids charging every
lurker for an auth check.

Brinedew account identity must not expire with Discord's OAuth access token.
The `GameSession` Durable Object is the serialization and persistence owner for
provider-token refresh: it refreshes within five minutes of expiry, stores a
rotated refresh token before another request can use the old one, and returns
the durable Brinedew identity even when Discord is temporarily unavailable. An
`invalid_grant` revokes only Discord-derived authorization and safely downgrades
supporter state; it does not log the user out of Brinedew or remove configured
administrator authority. The HttpOnly browser cookie and presence hint use a
rolling 400-day lifetime and renew on authenticated activity, which keeps an
active account signed in indefinitely within current browser cookie limits.

Dynamic Iconoplasm HTML responses may reissue the presence-only hint whenever
the request already carries an HttpOnly session cookie. This is a no-read repair
path for hints cleared by older clients: it performs no auth, D1, or Durable
Object lookup, never places the hint in a shared cache object, and a truly stale
session still fails the one gated `/api/auth/me` lookup. Do not replace this with
an unconditional anonymous auth probe.

Extension hover detail is immutable within a published card snapshot:

- the catalog manifest exposes `card_snapshot_version`;
- catalog publication writes a separately versioned scanner artifact before
  advancing the manifest;
- the scanner artifact contains only canonical symbol, name, UniProt, color,
  and aliases, is capped at 3 MiB, and never contains portrait references;
- extension upgrades atomically compact any legacy portrait-heavy scanner map
  before returning gene data to a tab;
- foreground hover reads one version-addressed immutable per-symbol GET. The
  compatibility batch route remains for older installations; both read the
  corresponding published card artifact, not D1;
  active current/previous versions reuse the Cloudflare Worker Cache API before
  reading the manifest or shard, and the same immutable URL remains reusable in
  the browser HTTP cache;
  partial reads reuse at most three parsed manifests and four parsed shards per
  Worker isolate, with a 16 MiB estimated parsed-heap ceiling and one in-flight
  KV read/parse per immutable key;
  missing or malformed values are never cached;
- installed extensions keep a detail cache capped at both 512 entries and
  4 MiB, keyed by that version;
- a version change invalidates the cache, and an older-started response from a
  different snapshot cannot displace a newer-started response already adopted;
- only an explicit `missing` result is negative-cached, and transient failures
  remain retryable;
- foreground GETs do not wait for whole-cache hydration, carry a four-second
  deadline, and may promote the same reading-session request for that symbol
  through the content-to-service-worker bridge;
- a successful detail response resolves the visible card from memory before a
  coalesced idle writer reads, merges, stringifies, or writes the persistent
  cache; an old queued write cannot roll a newer snapshot backward;
- HTML and PDF register recognized anchors with one tab-scoped reading session.
  Ordinary documents prepare their unique-symbol inventory as complete immutable
  cards—detail, delivery resolution, bytes, decode, and frame acknowledgement—before
  hover. The adaptive ceilings are 16 symbols/3 workers on constrained connections,
  64/6 ordinarily, and 128/8 only on measured fast connections;
- large documents use the same session and deterministic near-viewport working
  windows instead of pointer trajectory, DOM-neighbor, or scroll-direction guesses.
  Data Saver, `slow-2g`, and `2g` disable preparation;
- hover is a selector over the ready-card set. Its foreground request exists only
  for immediate-startup interaction, a transient preparation failure, or suppressed
  preparation, and reuses matching in-flight immutable detail/portrait work;
- the rich variants boot one iframe inside its permanent tooltip-owned parent
  during initialization. That same browsing context decodes neighbors and
  renders every hover; it is never reparented or duplicated;
- the cold rich card paints identity over its stable reverse face. Only the
  shared portrait adapter may assign resolved HTTPS sources: Bunny begins first,
  canonical starts after a 350 ms unresolved hedge, and the first decoded source
  becomes the tab decision. Worker-buffered base64 is CSP compatibility only; and
- a neighbor is paint-ready only after bytes arrive, `img.decode()` settles, and
  the renderer acknowledges a frame boundary. Content retains at most 48 resolved
  native sources, the legacy worker compatibility cache retains 48 data URLs,
  the frame retains 48 decoded sources, and the simple renderer retains 96;
  same-source work is deduplicated.

This follows the current small-queue discipline used by modern router
prefetchers: explicit intent outranks viewport speculation, matching predicted
immutable work is promoted rather than restarted, newer intent
replaces older queued work, and finished results remain reusable. We evaluated
[ForesightJS](https://foresightjs.com/docs/getting-started/what-is-foresightjs),
which the current [Next.js prefetching guide](https://nextjs.org/docs/app/guides/prefetching)
names for cursor-trajectory prediction, but did not vendor it. Its roughly
120 ms prediction window cannot hide this system's 300–900 ms cold network
floor; its approximately 32 KiB runtime would be injected into every eligible
page; and its required per-element `unregister()` lifecycle is not compatible
with the current removal-unaware scanner. Reconsider it only with a
removal-aware registry and a measured non-adjacent-hover win that outweighs the
startup and memory cost.

The shared extension text blocklist and curated publication aliases follow the
same published-read-plane boundary without becoming catalog artifacts.
Administrators replace one normalized desired policy for each; D1 retains each
current revision and only the newest 100 audit revisions. At most 100 immutable
KV records per policy are retained as dependency-aware publication inputs and
history. They are not selected independently by anonymous traffic.

After both individual inputs are visible and mutually valid, the reconciler
writes one immutable bundle under `iconoplasm:recognition-policy-pair:v1:`. The
bundle atomically nests the exact outward `extension_blocklist` and
`publication_aliases` shapes plus private dependency metadata. Manifest,
search, and resolver readers list that prefix and normally GET only the newest
valid value, so public work is O(1) in retained history and eventual cross-key
propagation cannot expose a mixed policy pair. Their versions participate in
the manifest ETag. Public reads never repair or fall back to D1, a policy-only
revision never rebuilds or downloads the scanner artifact, and the extension
makes no additional request or timer.

Scanner validation is also bounded explicitly. Migration 0067 owns one
singleton D1 receipt keyed by validator revision, scanner build, and the exact
alias/blocklist revision-version tuple. Catalog publication performs the full
fused recognition traversal while scanner genes are already in memory, writes
an immutable 64-shard canonical/alias validation index, records the current
exact receipt, and only then advances the catalog manifest. A true semantic
admin mutation requires the current baseline receipt and reads only the small
index shards touched by changed aliases or newly added blocklist terms. It
rechecks the small manifest and commits the next valid receipt in the same D1
CAS batch as the desired revision. It never downloads or parses the 1.9 MiB
scanner artifact. A normalized no-op skips lookup work. Receipt-backed retries
directly GET exact immutable keys and do zero scanner-artifact or validation-
index reads, including while KV values are visible before their list indexes.
Individual history cleanup stays off unchanged foreground retry paths.

The reconciler never treats an existing v1 pair as scanner-bound proof because
the public key and payload intentionally omit scanner version. It reads the
small current manifest, requires an exact valid receipt, and re-reads the
manifest and both D1 policies before success or publication. Thus the exact-pair
path uses two bounded manifest GETs, and new-pair staging adds one final
pre-publication manifest GET, while a matching receipt keeps scanner-artifact
work at zero. A missing, stale-validator, or scanner-mismatched receipt fails
loud with a retryable 503 and requires catalog publication to regenerate the
proof from the already-loaded scanner. Reconciliation never downloads the
scanner as a repair path. Deterministic invalid state is durable so cron does
not retry it.

Cleanup responsibility is mode-specific. Admin POST reconciliation passes
`cleanup: false`, keeping unchanged propagation retries free of history lists.
The no-option scheduled caller is the cleanup owner: it performs one bounded
best-effort cleanup pass over alias, blocklist, and pair namespaces on an exact
pair, enables cleanup while converging individual projections, and cleans the
pair namespace after new publication. A transient cleanup failure does not
invalidate the current pair; subsequent scheduled ticks continue convergence.

Alias and blocklist desired state is cross-validated before either CAS. Each
revision persists the exact counterpart revision it validated, and publication
requires that dependency (or newer) to be visible before staging the individual
KV record. Scheduled reconciliation runs blocklist, aliases, blocklist again,
then the atomic pair publisher: removals therefore stage blocklist-first,
additions alias-first, and sequential saved-but-pending revisions converge
without deadlock. Only the final pair value advances the anonymous read plane.
Admin blocklist writes normalize, sort, and deduplicate terms and reject a
canonical symbol used by itself. Each term must be either one unambiguous alias
or a larger protected phrase containing a recognized canonical symbol or
unambiguous alias after the desired alias policy. A protected phrase suppresses
all overlapping highlights inside that occurrence while leaving the same label
recognizable elsewhere. Alias writes reject unknown targets, cross-owner
collisions, and new aliases already supplied by the generated scanner while
ensuring every desired blocklist term remains valid. Whether an alias or phrase
is an unwanted ambiguity remains explicit administrator judgment.

Once an extension has accepted a valid blocklist or alias projection, it retains
that last-known-good authoritative state through missing, malformed, stale, or
failed refreshes. A valid empty blocklist is an intentional empty policy. On a
true first deployment with no pair keys, the server combines its alias seed with
the newest dependency-free legacy blocklist. Any nonempty but unreadable pair
namespace fails closed instead of silently dropping policy. Packaged extension
fallbacks remain first-run/offline state; per-user removed-default tombstones
and custom terms remain browser-local and retain user authority.

Historical compatibility URLs resolve aliases through a direct
content-addressed version key within the bounded 100-revision horizon; the seed
token remains source-backed. A current pair that propagates before its version
key supplies the same snapshot directly. A syntactically valid but not-yet-
visible alias or portrait snapshot returns a retryable 503, never a false 404.

Catalog portrait fingerprints and portrait-reference snapshots are publication
artifacts too, but they do not belong in the per-tab scanner. Visible and hovered
genes hydrate them through the published card batch. Catalog publication writes
the full artifact and compact scanner before advertising either version. Public
manifest, search, and artifact reads consume the published metadata even after
its former five-minute timestamp; they never scan D1 or write KV to "repair" it.
Missing or corrupt publication state returns a retryable 503.

The batch endpoint still costs one Worker invocation on a cache miss. Its bounded
isolate LRU prevents repeated parsing of overlapping immutable manifest/shard
reads without becoming an alternate authority or touching D1. Persistence and
predictive neighbor readiness change the unit of cost from page navigation to
unique gene detail and portrait per publication snapshot, while the published
artifact removes D1 read pressure. Useful identity never waits for portrait
transfer, storage persistence, iframe boot, or decorative Rough.js hydration.
Writes, votes, authenticated account feeds, and complete gene HTML remain
dynamic and keep their existing authority.

Discovery follows the same product boundary:

- a signed-out website gene visit is retained in the full-catalog local shelf without
  a Worker request;
- each authenticated page session merges at most 200 pending symbols and
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

## ARCHITECTURE FENCE [IPD-010]: routine gallery publication is dirty-shard-only

The gene universe is stable. A vote changes the canonical card for one gene; it
does not create a reason to reread or remap all 19,023 genes. Routine publication
therefore has one strategy:

1. Capture the canonical publish-event ID high-water mark. The timestamp remains
   diagnostic metadata; it is not the correctness cursor because multiple votes
   can share one SQLite second.
2. Resolve changed symbols to their current content-addressed shard ranges.
3. Prepare at most six dirty shards in one Worker invocation. If more are dirty,
   retain a durable publication cursor while the old manifest remains live.
4. Reuse untouched immutable shard references. Insertions, removals, and splits
   are local to the owning range; a missing blob may be repaired from that range
   only.
5. After every dirty shard is ready, write one manifest, flip the gallery version,
   synchronize route membership, and advance the watermark as one publication
   boundary.

There is no size threshold whose fallback is a complete catalog rebuild. The
scheduled route performs exactly one bounded step and ignores historical
`max_chunks` input. No-op cycles write neither shards nor manifests. A normal
single-gene canonical change writes at most one replacement shard, one manifest,
one release pointer, and one watermark; content-addressing avoids even the shard
write when bytes are unchanged.

The workstation blot owner does not turn this publisher into a poll-driven
rebuild. Once per idle Drain minute it asks for at most 100 post-watermark
priority symbols and renders at most 25 missing blots. The read is indexed by
the existing event watermark and excludes blot/card materialization events, so
the corpus backfill cannot repeatedly trigger the priority lane. Backfill scans
ten published cards per quiet slice, checkpoints its exact artifact cursor and
renderer revision, and publishes each 100-gene tranche through this same
dirty-shard path. Its 5,000-gene UTC ceiling yields at most 50 ordinary tranche
publications per day. No reader request, full-catalog scan, or Cloudflare render
participates.

Exact blot readiness is checked before a dirty-shard step reserves KV writes.
`GENE_BLOT_NOT_READY` is a deterministic workstation dependency and must consume
zero KV reservation and perform zero KV writes. This ordering prevents the
15-minute publication retry from exhausting the conservative internal ledger
while the real Cloudflare write counter remains low.

Cold bootstrap, legacy storage conversion, and a changed card-mapper revision are
deployment migrations, not runtime recovery modes. The routine route fails with
`CARD_CATALOG_BASELINE_REQUIRED`, `CARD_CATALOG_STORAGE_MIGRATION_REQUIRED`, or
`CARD_CATALOG_SCHEMA_MIGRATION_REQUIRED`; it must never silently start broad work.
Migration tooling must finish and validate a candidate baseline before activating
code that requires it. Public readers remain fail-closed and never repair state.

Each non-empty publication has an operation ID in
`icono_card_catalog_publication_audit`, with `started`, `preparing`, `completed`,
or `failed` outcome. It records the trigger reason, exact dirty-symbol/shard
counts, baseline shards read, replacement shards written, KV writes reserved and
used, duration, and error code. The operational table is bounded to 512 rows,
and structured Worker logs carry the same operation ID and counters. This is the
evidence source for cost review; do not reconstruct history from a deleted cursor
or infer it from whichever artifact happens to be live.

Naming is part of the cost guard. Use explicit `card catalog dirty shard
publication`, `baseline version`, `publication cursor`, and `schema migration
required`. Do not call routine publication a `rebuild`, `warm`, or generic
`refresh`; those names hide whether work is symbol-scoped and previously allowed
an absentminded agent to route a scattered vote delta into complete-catalog work.
Linear B-695 records the incident and implementation evidence.

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
