# Iconoplasm capacity and background-work runbook

## Current account state versus historical allowances

**Owner clarification, 2026-08-27:** Free initially → paid R2 used → R2 disabled
with unpaid debt → currently Free until the debt is settled. R2 billing and the
Workers subscription are separate; do not infer a past paid Workers subscription
from paid R2. Transition
dates are unknown; do not invent them. Even a $5 upgrade would require paying
the existing balance (previously described as roughly $70). R2 and paid Workers
capacity are unavailable to this design. Bunny is the intentionally paid
replacement, not a prohibited provider. The canonical spending boundary is in
`ICONOPLASM_PRODUCT_OPERATING_MODEL.md`.

The signed-in Cloudflare **Workers plans** page was checked on 2026-08-27 and
explicitly showed **Free — Current plan**: 100,000 Worker requests/day, 10 ms
CPU/request, 5 million D1 rows read/day and 100,000 D1 rows written/day. This is
fresh plan evidence; the debt/history above remains owner-reported. The local production Wrangler configuration
still contains historical D1 monthly budgets of 24 billion reads and 40 million
writes, with a threefold daily burst allowance. The cost cockpit derives its
"smart daily" allowances from that configuration. **Those values do not establish
Free-plan capacity or raise a provider quota.** Do not use the historical cycle
budget, or paid-period observed usage, to certify today's workload.

B-716 must reconcile budget enforcement and UI with the current Free boundary
as part of the growth migration. Until verified, the old smart-budget display
is not proof of protection against Free daily limits. Record provider hard
limits separately from product allocations, and never reinterpret daily quotas
as a monthly pool. No billing or subscription changes are part of this audit.

### Authority cutover operator request fence

On 2026-08-31, the manifestation authority migration and backup operators
exhausted the Free plan's 100,000 Worker requests/day. Cloudflare Error 1027
then returned HTTP 429 for the live dynamic site until the UTC-day reset. A
concurrency limit corrected the burst but could not prevent cumulative daily
exhaustion.

Both authority cutover operators therefore reserve every outgoing request,
including status reads and retries, in one Windows-user-wide UTC-day ledger before
calling the Worker endpoint. The hard operator allocation is at most 2,500 requests
per day. Reservations are atomic across concurrent processes and are not
refunded after a crash or ambiguous timeout. A missing, malformed, or locked
ledger fails closed before network traffic. The remaining 97,500 requests are
reserved for the live site and unrelated account traffic; do not raise the
operator ceiling to make a one-time job finish sooner. Let the resumable
cutover continue after the next UTC reset instead.

The local ledger is a backstop, not account truth. Before the first Worker
request and after each further 100 reserved requests, the operators query
Cloudflare's account-wide `workersInvocationsAdaptive` analytics directly
through the User-scope `iconoplasm-admin` credential. Missing credentials,
timeouts, malformed telemetry, or an observed daily count of 75,000 or more
stop the operator before it sends more Worker traffic. Analytics can lag and
is not billing truth, which is why the 25,000-request provider margin and the
separate 2,500-request local ceiling are both required.

## Immutable hover metadata transport (B-711, 2026-08-27)

The B-716 replacement is specified in
[`ICONOPLASM_CARD_PUBLICATION_V2.md`](ICONOPLASM_CARD_PUBLICATION_V2.md).
It moves immutable metadata to Bunny Storage and the ordered head/cursor to
SQLite Durable Objects. The B-711 KV-backed origin-fill arithmetic below is
historical baseline evidence, not the replacement's reader cost. The D1 budget
policy now caps historical monthly allocations at Free daily limits; this is
not an account-wide reservation or a whole-product capacity certificate.

**ARCHITECTURE FENCE [IPD-008] + [IPD-011]**: the existing publication barrier
and card-shard SHA256 remain the only authority. The snapshot-specific
`/api/public/v1/card-snapshots/:snapshot/delivery-index` is an on-demand,
at-most-16-KiB range index, not part of the scanner bootstrap. It carries no card
payloads. Each tuple selects the existing shard hash for a symbol.

`/api/public/v1/card-content/v1/:hash/{genes|portraits}/:symbol` is a deterministic
projection with publication-epoch fields removed. The extension validates hash,
symbol and lane, then restores the named snapshot envelope. A vote changes the
affected shard hash only; unchanged shards retain cache keys. Publication adds
no KV writes, no Bunny uploads, no second pointer and no full-catalog rebuild.
On a cold origin miss, only current/previous published manifests admit a hash;
already-cached immutable historical bytes remain valid. Missing/corrupt content
fails closed with non-cacheable errors, never mutable D1 selection.

The extension has two cached indexes, two index requests in flight, a bounded
30-second failed-index backoff and 128 tab decisions. It uses an 800-ms index
deadline, 350-ms CDN hedge and 2.5-second source deadlines inside the existing
4-second request deadline. Each response is capped at 64 KiB. Both hover lanes
remain independent; another lane cannot alter an in-flight race's failure count.
All new transport uses omitted credentials. Failure returns to the existing
exact-snapshot API; aborts remain aborts. Host-load gating is unchanged.

Bunny routing must match ONLY the new immutable content namespace. The default
Storage Zone origin for portraits is unchanged. Smart Cache excludes JSON, so
verify the scoped cache rule with real repeated requests: successful responses
must become HIT, errors must not. Do not substitute a year-long error cache or
an all-API origin override. Browser extension release remains the human-owned
publisher workflow; deploying the origin does not update installed clients.

Capacity evidence and limits are in `ICONOPLASM_FIRST_PRINCIPLES_CAPACITY_MODEL.md`.
The executable cases are `metadata-delivery.test.js`, `iconoplasm.public-media.test.js`
and `iconoplasm-first-principles-capacity.test.mjs`, with the delivery suite in
the production deployment gate.

### Live Bunny configuration and release check

Pull zone `iconoplasmportraits` (5695279) retains Storage Zone
`iconoplasm-portraits` as its default origin. Three narrow edge rules were saved
and read back in the owner's Edge/VPN dashboard on 2026-08-27:

1. Namespace `https://iconoplasmportraits.b-cdn.net/api/public/v1/card-content/v1/*`
   AND status 200: Override Cache Time 31,536,000 seconds.
2. That namespace only: Override Origin URL
   `https://iconoplasm.brinedew.bio{{path}}`; Enable Request Coalescing.
3. That namespace AND status NOT 200: Set Response Header `Cache-Control: no-store`.

The third rule is necessary: the initial live probe observed Bunny rewriting
origin `no-store` to `no-cache`. After configuration propagation, repeated 410s
were MISS with `no-store` and different origin request IDs. Do not weaken the
probe to accept the provider's default rewrite. No private routes are proxied.

Run `node scripts/verify-iconoplasm-hover-delivery-live.mjs` after deployment.
It checks TP53/RIPOR1 index bindings, both lanes, all scientific properties,
CDN/first-party equivalence, repeated HITs and uncached errors. It writes bounded
public evidence under the project artifact archive. If local DNS fails, an
explicit `--cdn-ip=<verified public resolver address>` is a diagnostic contrast,
not proof the affected network works and never a persistent DNS change.

Release evidence: source 487e6078 deployed successfully in workflow 33047786825.
The live index was 2,325 bytes; detail/locator were 2,576/739 bytes for TP53 and
1,697/743 for RIPOR1. All four objects became HIT; cached responses retained
the original origin request ID while CDN request IDs changed. Local DNS still
returned NXDOMAIN; the actual candidate delivery module recovered through
first-party for both symbols with identical portrait SHAs. Cache HIT latency
varied (roughly 0.26-1.31 seconds in the diagnostic curl run), so this is a proven
request-scaling improvement, not a claim that every CDN fetch is faster.

Fresh browser loads of both gene pages showed visible decoded 398x512 portraits
and populated molecular/character properties. These are site checks, not proof
of a newly installed extension. The actual Edge popup reported 0.4.15; Firefox
was not open at this check. Candidate code still requires the human publisher
release; never mark installed clients updated based on deployment success.

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

`icono_gene_essence.manifestation` is legacy cutover input, not a versioning
authority. `icono_admin_gene_rollup.manifestation` remains empty. The separate
IPD-012 authoring authority owns accepted manifestation state.

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

## ARCHITECTURE FENCE [IPD-012]: manifestation authoring has one bounded authority

### Exact generation from imported Tags (B-738)

New image requests may use a migration-imported `legacy_unknown` Tags derivative
when its exact revision, accepted derivative ID, verified encrypted object, and
compound/component hashes are complete. Unknown historical tagger identity stays
unknown; it is never filled with a guessed model. The image generation provider,
model, recipe, and final prompt remain recorded for the new image. Generated Tags
still require their complete authoring history. This distinction restores image
requests after cutover without changing source bytes or selecting newer prose.
Existing `legacy_unbound` image requests remain non-replayable.

Website source admission, exact-source validation, and workstation lease and
fulfillment validation share this contract. Hash drift, missing storage, withdrawn
sources, partial generated history, and duplicate execution still fail closed.

### Storage ownership

Production `iconoplasm-authoring` and staging `iconoplasm-authoring-staging` are
bound only to the loud stateful Worker as `ICONOPLASM_AUTHORING_DB`. They own
stable gene/account references, caretaker assignment state, immutable revision
metadata, canonical-selection history, idempotency receipts, tombstones, and the
ordered workstation replication stream. They do not store plaintext prose.

The migration baseline is 19,186 current Website manifestations containing
66,938,816 characters. The workstation also has 21,696 active candidates that
cannot be bound to an exact historical manifestation. Those candidates stay
`legacy_unbound`; never attach the current revision merely because the symbol
matches.

Each prose body is normalized and bounded at 4,000 Unicode code points and
16 KiB UTF-8, encrypted with a random AES-256-GCM data key, and written under an
opaque immutable key in the dedicated private `iconoplasm-authoring` Bunny zone.
That zone has no connected Pull Zone and authoring code has no fallback to the
portrait zone or its credentials. The data key is separately
wrapped by the versioned `ICONOPLASM_AUTHORING_BODY_KEK_V<n>` secret. Content AAD
binds revision ID, gene ID, plaintext hash, and byte length. D1 contains the
wrapped key, IVs, ciphertext hash, and logical byte count; Bunny contains only
ciphertext. Authenticated Storage GET must byte/hash/decrypt
verify every PUT before the new revision and canonical selection can commit.

Creation ordering is validate and claim idempotency, encrypt, PUT, authenticated
GET/hash/decrypt verification, then one guarded D1 transaction. The old head
remains valid on every earlier failure. A verified object whose transaction
loses CAS is an orphan for bounded cleanup, not a partial revision. Hard purge
first selects a legal fallback and removes the wrapped key transactionally, then
retries authenticated object deletion until a missing read is verified.

The authoring logical-body admission ceiling is 350,000,000 bytes, below the
400 MB operational target and 500,000,000-byte database wall. Events carry a
complete no-prose gene snapshot. Cursor expiry requires a bounded snapshot;
consumers must never infer skipped event IDs or reconstruct authority from the
primary D1 projection.

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

The July 2026 **Workers Cache** product is different from Workers Static Assets.
Its cache HITs still count as Worker requests; enabling it also meters otherwise
free static assets and service-binding requests. Its default key excludes the
hostname, which is independently unsafe for this multi-host service without a
cache-identity redesign. Do not enable it as a Free-quota escape. The topology
validator parses TOML and rejects enabled caches at top level, in any environment,
or in named exports; mutation tests run in the deployment gate. A future CPU
optimization using it requires a fully costed, explicitly reviewed replacement
of this fence, not just a faster HIT in one benchmark. Sources checked
2026-08-27: [pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [cache semantics](https://developers.cloudflare.com/workers/cache/).

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
- foreground hover starts two version-addressed immutable per-symbol GETs: rich
  detail and a compact portrait locator. Both project the same named published
  card artifact, not D1. The locator has no independent selection, pointer, or
  publication timeline. A byte-equivalent CDN cache is allowed, not a second
  canon. The compatibility batch route remains for older installations;
  active current/previous versions reuse the Cloudflare Worker Cache API before
  reading the manifest or shard, and the same immutable URL remains reusable in
  the browser HTTP cache;
  partial reads reuse at most three parsed manifests and four parsed shards per
  Worker isolate, with a 16 MiB estimated parsed-heap ceiling and one in-flight
  KV read/parse per immutable key;
  missing or malformed values are never cached;
- installed extensions keep a detail cache capped at both 512 entries and
  4 MiB plus a compact locator cache capped at 1,024 entries and 768 KiB; both
  are keyed by the same card snapshot version;
- the cached scanner index paints immediately without a per-tab manifest request.
  A retired immutable detail or locator URL returns `410` with the explicit
  `card_snapshot_retired` code; only that signal starts one deduplicated,
  cache-busted read of the existing small manifest. An unchanged scanner version
  never downloads the scanner artifact again;
- the recovered card-snapshot version aborts retired requests, invalidates both
  caches, and retries any currently visible hover without requiring a reload or
  re-hover. An older response from a different snapshot cannot populate or roll
  back the newly adopted revision;
- only an explicit `missing` result is negative-cached, and transient failures
  remain retryable;
- foreground GETs do not wait for whole-cache hydration, carry independent
  four-second deadlines, and may promote the same reading-session request for that symbol
  through the content-to-service-worker bridge;
- a successful detail or locator response resolves its visible projection from memory before a
  coalesced idle writer reads, merges, stringifies, or writes the persistent
  cache; an old queued write cannot roll a newer snapshot backward;
- HTML and PDF register recognized anchors with one tab-scoped reading session.
  The `document_end` entrypoint yields through a paint boundary and genuine idle
  time before using a validated local scanner. This cache-only path performs no
  network, refresh, legacy migration, renderer boot, or persistent portrait hydration.
  A missing/incompatible scanner still waits for host `load` before downloading.
  Initial and mutation-driven recognition run in bounded idle slices, with a
  4 ms wall-time budget between nodes and no forced idle timeout before load.
  Matcher construction also yields in genuine idle time, targeting 8 ms
  per turn with clock checks every 32 tokens. Article/main roots precede navigation;
  a full-body pass still covers the remainder without nesting existing highlights.
  Current-card selection is separate: once after load, or on explicit early hover,
  before either card lane or disk cache is used. Slow unrelated page resources
  must not delay cached recognition. The session
  inventories anchors immediately, but speculative immutable rich detail plus
  independently deliverable portrait locators, bytes, decode, and frame acknowledgement
  wait for host `load`, a one-second quiet delay, and a genuine idle callback. The
  first ten symbols use one worker on constrained connections and two otherwise;
- the one/two workers above are browser-side preparation slots per tab, not
  Cloudflare Worker instances. Each prepared symbol starts one rich-detail GET
  and one portrait-locator GET. Ten cold tabs therefore start 100 requests in
  each projection lane. The lanes have separate 120/minute per-IP rate-limit
  buckets so ten users behind one NAT remain below both limits without raising
  either route's abuse ceiling;
- current and previous recognition-policy publication is selected through one
  exact `current` pointer followed by exact immutable alias/blocklist reads.
  Public request paths must never call KV `list()`: the free plan permits only
  1,000 list operations per day, and cache hits inside a Worker still count as
  Worker requests. A missing pointer may use the legacy list scan only as a
  one-time migration fallback; publication must repair the pointer;
- large documents use the same session and deterministic near-viewport working
  windows capped at ten symbols instead of pointer trajectory, DOM-neighbor, or
  scroll-direction guesses.
  Data Saver, `slow-2g`, and `2g` disable preparation;
- hover is a selector over the ready-card set. Its foreground request exists only
  for immediate-startup interaction, a transient preparation failure, or suppressed
  preparation, and reuses matching in-flight immutable detail/portrait work. A
  locator success may paint the portrait while rich detail is stalled or exhausted;
  if both projections arrive with different portrait SHAs, portrait and voting fail closed;
- the rich variants boot one iframe inside its permanent tooltip-owned parent
  during card initialization after load or explicit hover. That same browsing context decodes neighbors and
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

Preparation completion is not a permanent readiness bit: a partial failure or
the bounded source LRU evicting a portrait must make that symbol eligible again
when its real inventory/viewport/active event requests it. Do not add retry
polling or increase the cache without evidence. The visible window selects at
most ten **unprepared** symbols; already-ready sticky headers/sidebars do not
consume those slots. Actual-viewport candidates outrank the 960 px prefetch
margin, with distance to viewport center breaking ties. Scroll events coalesce
to one geometry-read frame because movement inside the IO margin need not cross
an observer threshold. Obsolete visible queue entries are removed; active work
is preserved. Partial failures get event-driven 5–60 second retry backoff, never
a polling timer or per-scroll-frame network retry. This is deterministic viewport
selection, not pointer-trajectory or scroll-direction prediction.
The PDF scroll container must
release its active target on pointer exit (including the toolbar), forwarding
the destination to the shared interactive-tooltip grace policy; otherwise the
old card can physically cover a correctly prepared next gene.

Reader latency acceptance lives in
[`ICONOPLASM_READER_PERFORMANCE_BENCHMARK.md`](ICONOPLASM_READER_PERFORMANCE_BENCHMARK.md).
One eventual hover is only a smoke test. Preserve first-hover/repeat populations,
fixed prediction lead times, actual pre-pointer cache readiness, highlighting
delay, failure counts and host responsiveness. Do not average away recurring
first-hover latency, wait for readiness before timing, or silently skip browser
failures.

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
search, and resolver readers GET the exact current pointer and its exact immutable
pair, with zero normal KV lists. Legacy missing-pointer discovery is migration-only.
Public work is O(1) in retained history and eventual cross-key
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
envelopes. The 2026-08-27 owner clarification permits stale portraits on an
unreloaded article, but requires current-version revalidation on new page loads
and ordinary reloads. Aim for one-minute propagation; two minutes is acceptable,
not a strict guarantee. Scale and smooth reading outrank the timer. Assess the
working 10,000-daily-reader workload including votes and saved discoveries;
the historical 15-minute window is an implementation gap, not product authority.
Model freshness traffic from loads/reloads, not one heartbeat per open tab.
Unchanged content-addressed image bytes remain reusable. This specification
change does not certify the current runtime or authorize bypassing cost guards.
Any read path that mutates state, whole-catalog recomputation
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
rebuild. Each Drain slice asks for at most 100 post-watermark priority symbols
and renders at most 25 missing blots. The read is indexed by the existing event
watermark and excludes blot/card materialization events. An unchanged failed
priority fingerprint receives a bounded local cooldown; a new canonical vote
changes the fingerprint and bypasses that cooldown immediately. Backfill scans
at most 250 published cards per slice, checkpoints its exact artifact cursor
and renderer revision, persists each WebP locally, and uploads it to the
deterministically derived Bunny key with four concurrent immutable uploads. A
measured 100-card response was 216,437 bytes, so the 250-card ceiling is roughly
541 KB while reducing backlog requests by 60 percent versus 100-card slices.
The daily 5,000-gene ceiling remains unchanged. It performs zero KV writes and
never republishes a card solely to record blot readiness. No reader request,
full-catalog scan, or Cloudflare render participates.

Only a real canonical card change consumes the bounded dirty-shard KV budget.
The published card immediately becomes the sole identity input for the stable
blot route; a missing object is a materialization backlog item, not a
publication barrier or a reason to reserve KV writes.

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
