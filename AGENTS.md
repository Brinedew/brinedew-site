# Website project rules

## Extension release integrity

Read `docs/ICONOPLASM_RELEASE_INTEGRITY.md` before changing extension packaging,
release identity, store workflows or published download files. Validation builds
must visibly say DEV and carry their content fingerprint. Tests use disposable
output roots and never replace real release artifacts. Store submission consumes
the verified immutable bundle for one exact tagged commit; it must not rebuild
current `main` under an already approved version. Preserve the human GUI gate.

This `AGENTS.md` is loaded automatically when work happens inside `D:\Coding\Website\`. Root `D:\Coding\AGENTS.md` rules still apply — these are project-specific additions.

## Architecture fence registry

Before changing reader freshness, read `docs/ICONOPLASM_PRODUCT_OPERATING_MODEL.md`.
The owner permits stale images while an article stays open. New page loads and
ordinary reloads must check current published canon. Scale and smooth reading
outrank shaving a minute off synchronization: aim for one minute; two is acceptable,
not a strict worldwide guarantee. No continuous per-tab polling. Use the explicit
10,000-daily-reader working scenario (including voting, saved discoveries and
regional fallback), not today's traffic, to evaluate changes. Report reader-level
verdicts, not isolated operation counts. Historical 15-minute timing is not a
product exception. Spec/model updates are not runtime proof.

Cloudflare account history matters: Free → paid R2 used → R2 disabled
with unpaid debt → currently Free (owner confirmed 2026-08-27). Paid R2 does
not establish a past paid Workers subscription. Historical paid
allowances and the old monthly D1 budget variables are not usable capacity.
Read the account-history section of the operating model before interpreting
conflicting billing telemetry. No upgrade, debt payment or R2 reactivation is
authorized by a performance task; paid Bunny is the intended alternative.

Before changing a non-obvious cost, ownership, fallback, or release decision,
read `architecture-fences.json` and `docs/ARCHITECTURE_FENCES.md`. Registered
fences are deliberately enforced in instructions, runbooks, source,
configuration, tests, and deployment. A fence may be replaced, but only by an
explicit migration that updates all registered enforcement points together.

**ARCHITECTURE FENCE [BPC-001]** — Brinedew Prose Checker has two separate
lanes: Harper may lint locally after editor idle, while remote DeepSeek checks
run only after an explicit user command against one immutable full-document
snapshot. Remote code must not probe the model, read the API key, scan a note,
or send traffic during plugin startup or typing. The only remote route is the
currently free `deepseek-v4-flash-free` model on OpenCode Zen; absence, expiry,
or auth failure stops the run and never falls back to OpenCode Go or a paid
model. Read `docs/OBSIDIAN_PROSE_CHECKER_RUNBOOK.md` before changing plugin
startup, scheduling, model routing, credential handling, or result anchoring.

**ARCHITECTURE FENCE [IPD-001]** — Bunny is Iconoplasm's healthy-path portrait
accelerator because direct delivery avoids charging each image to the
Cloudflare Worker budget. The extension starts one real browser-native image
per tab and begins the canonical first-party hedge after 350 ms if Bunny is
still unresolved; the first successful source becomes the tab decision. A
regional DNS failure therefore selects canonical without putting the old 2.5 s
worker-byte probe on the visible-hover path. Never turn
one network's DNS result into a global accelerator disable.
Country is not a delivery decision: a working Vietnamese ISP or VPN uses Bunny
too. Bunny is the owner's paid alternative to R2; do not make R2 enablement or
a new paid Cloudflare plan a prerequisite. Canonical identity is first-party;
that does not prohibit Bunny caching immutable public metadata. A cache has no
authority to choose an image, advance a snapshot, or serve private APIs. Read
`docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` before changing portrait policy,
storage, CDN configuration, preconnects, or fallback behavior. Requested
labelled-card thumbnails share this same tab-scoped accelerator/fallback
decision; never emit a raw Bunny-only browser image without the canonical
first-party binding. Bunny Storage and Bunny CDN replicas can disagree by
region. The first-party Worker must resolve those server-side views through the
single portrait-storage adapter, and only failure of every configured view is
“missing.” For a regional incident, test the affected browser, a contrasting
VPN region, authenticated Storage, and the CDN replica before choosing a cause.
Website Ops must preserve split-view success as `regionally_divergent`; its
operator-triggered audit may recheck verdicts older than 30 days only through
the existing bounded batch, never an automatic corpus sweep.

**ARCHITECTURE FENCE [IPD-003]** — Iconoplasm gene discovery is one atomic
published-catalog contract. Complete canonical profiles are indexable; aliases
redirect permanently; incomplete profiles stay noindex; unknown symbols are
real 404s. The `/genes` archive uses frozen, self-locating prefix ranges—never
numeric pagination or automatic count rebalancing. Preserve the visual card and
its one-to-one hidden semantic equivalent. Printed selector alternatives are
visual ink, not controls or peer facts: their accessibility representation must
name the resolved molecular value and mapped character value while hiding the
unused printed alternatives. Render those alternative words as CSS ink, not DOM
text, because browsing agents may flatten DOM content without honoring ARIA.
Crawler discovery belongs in the
existing non-visual homepage description, not as new discovery chrome in the
immersive Archive/Clans/Studio switcher. Studio is the ordinary human surface
for the same diagram document and bounded canonical blot resolver exposed to
agents through WebMCP; it must not become a second image authority or a
crawlable gene index. Feed skip links stay clipped until keyboard focus. Read
`docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md` before changing the renderer,
gene HTML, range map, robots metadata, archive, sitemap, or `llms.txt`.
The canonical public machine image is the Iconoplasm gene blot, not its source
portrait. A blot is the exact image-only shared card composition:
published portrait cover crop, protection gradient, full gene name at bottom
left, and gene symbol at bottom right. The workstation renders its immutable
768x1024 WebP from the exact selected published card, persists it locally, then
uploads it to Bunny; Cloudflare never renders it. That card deterministically
defines the renderer fingerprint and Bunny object key, so materialization does
not republish the card catalog or spend KV writes. Every complete gene page
projects the exact ready blot through a
server-rendered `<img>` with gene-specific alt text inside the initially hidden
print-copy surface. The blot becomes visible only when the user activates the
existing `request print copy` control; do not add a visible explanatory caption
or a default-open duplicate image to the gene page. Search discovery remains
independent of that presentation state through gene-specific Open Graph and
Twitter metadata, one linked `WebPage`/`ImageObject`/`Gene` JSON-LD graph, and
the gene-sitemap entry. The stable first-party `/blot/{SYMBOL}.webp` route may
resolve only the immutable blot referenced by the current exact card artifact.
These discovery reads must not add a D1 scan or any request-time write,
enrollment, vote lookup, Queue send, repair, or Browser Rendering work. Before
emitting a gene-sitemap shard, batch-read the
exact published card shards selected by `KV_GALLERY_VERSION`. Catalog and route
records supply identity candidates only; never compare or substitute their
legacy portrait SHA. Every requested candidate must resolve to a structurally
valid card, while only cards with an exact ready blot enter the range or gene
sitemap. An unavailable/incomplete artifact read returns uncached `503` instead
of a partial sitemap. The source portrait remains available as subordinate
source material; it must never be described as the canonical public gene
image. On any healthy network, IPD-001 selects Bunny's byte-equivalent
accelerator URL; a failed Bunny probe selects first-party for that tab only.
Delivery selection must not replace the first-party discovery identity.
Massive `/genes/{range}` pages are text-only discovery indexes and must not
render portrait or blot thumbnails that bypass the gallery collection mechanic.
Image metadata may expose only a ready object whose fingerprint still matches
that exact card. Zero-KV corpus uploads become discoverable through bounded
exact-symbol reads of the D1 materialization ledger; the selected published
card still derives the fingerprint and immutable key, and these reads must
never widen into a ledger scan or a second image-selection authority. Blot
readiness must never gate
the underlying complete gene profile: every eligible gene remains linked from
its frozen archive range and listed in its gene-sitemap shard, while a gene with
no ready blot simply has no image-sitemap child. Those crawler
reads must never enroll work, consult votes, scan D1, or launch Browser Rendering.
Agent image lookup reads that same exact published-card authority. The bounded
`POST /api/public/v1/images/resolve` contract accepts at most 50 identifiers and
returns only a deterministically resolvable `gene_blot`; it must not expose a
source portrait or invent one generic "image" field. `/blot/{SYMBOL}.webp` is
the stable canonical gene-image identity. The temporary
`/portrait/{SYMBOL}.webp` alias was retired after live 19,023-gene and regional
delivery proof. Immutable `/portraits/v1/...` assets remain available to the
gallery and portrait-native surfaces but never enter this agent workflow.
Published gene portraits and published gene blots are the only two Iconoplasm
asset classes under CC0 1.0 Universal. Keep the visible `/license` scope,
resolver permission fields, ready-blot `ImageObject.license`/`usageInfo`, and
raw-image HTTP `rel="license"` headers aligned. Never extend CC0 to catalog
data, metadata, prose, software, prompts, unpublished images, services, or any
other Brinedew asset without explicit author direction.
Do not publish a 19,023-image manifest or add source-portrait links to every
archive row: agent retrieval stays exact and bounded.
Model-training crawlers are not the search contract: GPTBot and ClaudeBot are
blocked by a project-owned WAF rule before Worker execution, while OpenAI,
Anthropic, and Perplexity search/user agents remain allowed. The WAF policy,
robots.txt, deploy reconciliation, documentation, and tests must change
together.

**ARCHITECTURE FENCE [IPD-004]** — Iconoplasm Queue messages are due-time
wakeups for durable ledgers, not polling tokens. Unfinished future work must be
delayed until its ledger `next_attempt_at`; never immediately replace a message
merely because `remaining > 0`, and never cap a long durable backoff to a short
retry loop. Read `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` before
changing Queue consumers, retry delays, ledger status counts, or self-draining
background work. Requested gene-card materialization follows the same fence:
one durable row owns the latest desired fingerprint, duplicate requests only
increase demand, and a batch-size-one Queue consumer serializes Browser
Rendering within the daily budget.

**ARCHITECTURE FENCE [IPD-005]** — the primary Iconoplasm D1 is bounded
operational state. Its Free-plan wall is 500,000,000 bytes per database, not the
5 GB account allowance. Keep manifestation prose authoritative only in gene
essence, keep the admin rollup copy empty, and archive publish events older than
30 days to the cold audit D1 only after ID verification. Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` before adding large
columns, materialized payloads, append-only ledgers, retention jobs, D1 bindings,
capacity charts, or bulk reconciliation paths.
Factory request-summary joins need the collation-matched emulsion index in
migration 0081. A BINARY index cannot seek a NOCASE predicate; that mismatch
spent 434M reads in 33 updates. Preserve its real query-plan/row-cost test.
Labelled PNG bytes and render history do not belong in D1. Keep at most one
compact materialization row per canonical gene and seven daily budget rows;
store content-addressed image bytes in Bunny. Administrator recognition policy
history is bounded operational state too: publication aliases and the shared
extension blocklist retain only their newest 100 D1 revisions and 100 immutable
KV projections. Recognition validation uses one singleton receipt row; never
turn validation attempts, leases, or scanner builds into an append-only ledger.

**ARCHITECTURE FENCE [IPD-006]** — one completed workstation publication is the
Discord delivery and Request inbox receipt unit, partitioned by recipient and
gene. Persist the durable
publication ID; never infer a group from button presses, timestamps, adjacent
IDs, or a cron run. Wait until every request in that publication-recipient-gene
group is ready, then send one receipt
with at most ten full-resolution preview attachments and the authoritative
gene-page link. A hundred candidates still means one receipt, not ten DMs and
not a hundred-image contact sheet. Read
`docs/ICONOPLASM_FULFILLMENT_NOTIFICATION_RUNBOOK.md` before changing request
creation, fulfillment triggers, Discord delivery, Request inbox grouping,
attachment limits, or delivery reconciliation.

**ARCHITECTURE FENCE [IPD-007]** — Iconoplasm is static-first and has one
dynamic Worker invocation. Matching files on `iconoplasm.brinedew.bio` must be
served by Workers Static Assets before Worker execution; dynamic misses route
directly to the existing stateful Worker, never through the shared public
proxy. Workers Cache is a separate, metered product: its HITs and previously free
assets consume the request allowance when enabled. Do not enable it in the
production/staging config or a named entrypoint as a Free-quota workaround.
The parsed-config deploy guard enforces this distinction. Rate limits live on
that route owner. Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` (including the
canonical gene cold-path contract) and Linear B-670 before changing Iconoplasm
route ownership, asset bindings, bundle generation, rate-limit placement, or
production deploy order. Preserve the loud protected entrypoint and config
names; an internal extraction may add descriptive responsibility segments only
inside that boundary and must not create a second Worker or state owner. This
fence records evidence, not tradition: replace it when a fully costed
alternative proves better and updates every enforcement point atomically.

**ARCHITECTURE FENCE [IPD-008]** — anonymous Iconoplasm startup and extension
hover detail use the published read plane. A guest homepage must not probe
authentication, settings, discoveries, inventory statistics, admin state, or
D1. The readable shared-session marker carries no identity or authority; it may
only gate one direct authenticated-user lookup, while the HttpOnly session
cookie remains the credential. Brinedew identity is independent of Discord's
short-lived access token: the session owner refreshes provider tokens atomically,
retains the Brinedew identity through provider outages or revocation, and rolls
the browser credential on authenticated activity. Dynamic HTML may restore the
presence-only marker when an HttpOnly session cookie is already present; it must
not perform an anonymous auth lookup. Extension rich detail and its compact
portrait locator use separate version-addressed immutable per-symbol GETs over
the same named card artifact; older clients retain the batch compatibility route.
HTML and PDF feed one tab-scoped reading session. Performance acceptance uses
`docs/ICONOPLASM_READER_PERFORMANCE_BENCHMARK.md`: time highlighting from page
load, keep each article's first hover separate from repeats, and inspect actual
cache readiness before fixed-deadline hovers. A completed preparation attempt
must not remain "ready" after image eviction or partial failure. No wait-until-warm
timing, silently skipped browser failures, or hidden replacement browser.
Initial and mutation-driven
recognition scans must run in bounded idle slices; extension DOM work must not
monopolize the host page's rendering turn. The content entrypoint uses `document_end`,
then yields through a paint boundary and genuine idle time. Only a validated local
scanner may initialize before host `load`; cache-only means no network, refresh,
legacy migration, renderer boot, or persistent portrait hydration. Cold scanner
downloads still wait for `load`. Recognition slices have a 4 ms wall-time budget
between nodes and no forced idle timeout before load. Matcher construction uses
genuine idle slices targeting 8 ms, with clock checks every 32 tokens. Semantic
article/main roots precede navigation without changing matching. Each article selects its
card epoch once after load (or explicit early hover), before either card lane or
disk cache is used. Do not re-couple cached recognition to card freshness or to
unrelated slow images/analytics. The session inventories recognized
symbols immediately but may not start speculative detail or portrait work until
the host `load` event, a one-second quiet delay, and a genuine idle callback.
It prepares the first ten ordinary-document symbols with at most one worker on
constrained connections and two workers otherwise, plus deterministic ten-symbol
near-viewport windows for larger documents. Data Saver and 2G disable preparation.
Hover selects an already-ready card; its foreground GET is only a recovery path
and may promote the same in-flight immutable request without waiting for whole-cache
hydration. Portrait paint must not wait for rich-detail success: the locator lane
may resolve and paint while detail is stalled or exhausted. The locator is only a
projection of the exact card payload, shares its snapshot version and portrait
SHA, and must fail closed on disagreement; it never selects canon or advances
an independent publication. Byte-equivalent caches are permitted. Do not restore pointer-trajectory, DOM-neighbor, scroll-direction, or
surface-specific prediction. Packaged card fonts begin loading
during card initialization after load (or explicit hover) in both the host page and persistent card frame. Both routes
project immutable published card artifacts and
persist a bounded cache keyed by the card snapshot version; they must not
compose public hover cards from D1 or turn transient
failures into durable "missing gene" records. The scanner cache remains
stale-while-revalidate. A retired immutable card endpoint returns the explicit
`card_snapshot_retired` protocol signal; only then may the extension make one
deduplicated, cache-busted request to the existing small manifest. A changed
snapshot atomically aborts retired requests, invalidates both projection caches,
and retries the visible hover without a reload. This recovery must never download
an unchanged scanner artifact or create a polling endpoint or timer. The admin-managed shared extension
text blocklist and curated publication aliases are one recognition policy: D1
owns each desired state, while individual immutable KV revisions are bounded
publication inputs and history. Anonymous manifest, search, and resolver paths
split one newest valid immutable recognition-pair bundle, never select the two
policies independently and never fall back to D1. A healthy cold read is one
exact current-pointer GET plus one exact immutable-pair GET, with zero lists.
Missing-pointer discovery is migration-only, never a normal public read; a malformed or nonvisible
pair namespace fails closed unless the isolate has last-known-good state.
Bootstrap is allowed only while the pair namespace is truly empty and preserves
the newest dependency-free legacy blocklist. Protocol-aware extensions retain
the last valid authoritative policies, use packaged lists only before any valid
projection is available, and keep per-user removals and custom terms
browser-local. Alias and blocklist saves persist and CAS-check the exact
counterpart revision they validated; only one atomic pair value may advance the
public plane, so a blocklisted term is never published without one unambiguous
alias. Catalog publication builds one immutable 64-shard recognition-validation
index while the scanner genes are already in memory and records the exact D1
validation receipt before advancing the manifest. A foreground semantic mutation
must validate only the changed aliases or newly added blocklist terms from the
small touched shards plus the current receipt; it must never fetch, parse, or
rebuild the 1.9 MiB scanner artifact. The same D1 CAS stores the next bounded
receipt bound to the validator revision, scanner build, and exact alias/blocklist
revision-version tuple. Publication retries use direct immutable-key GETs plus
that receipt and remain scanner-free while waiting for KV propagation. A semantic
no-op skips recognition-index validation. Because v1 pair
keys do not encode the scanner build, even an existing exact pair requires a
valid receipt for the current manifest before it can be accepted.
Foreground admin reconciliation disables history cleanup so propagation retries
remain list-free. The scheduled reconciler owns bounded best-effort cleanup
after actual publication. An unchanged exact-pair fast path performs no history lists.
Read
`docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` and Linear B-673
before changing anonymous bootstrap, the session-presence hint, catalog/card
publication metadata, public batch reads, extension detail caching, or shared
extension terms.

**ARCHITECTURE FENCE [IPD-009]** — canonical Iconoplasm gene first paint is
cold-safe: a tiny publication-owned D1 identity index resolves an exact symbol
without a full-catalog read, then the complete site-detail ETag is probed before
the HTML cache. That detail combines bounded exact D1 reads with the one-symbol
card shard selected by `KV_GALLERY_VERSION`; cache hits return before JSON
parsing or shell rendering, though they still pay those bounded state reads.
The route index stores no portrait or vote state. The existing loudly named
stateful Worker and direct route remain the only owner. Never replace the
protective prefix/suffix naming pattern with shorter responsibility-only names;
descriptive responsibility segments are allowed only inside that full pattern
for extracted modules below the boundary. Do not create `iconoplasm-web`, a
public proxy, or a second state owner. Read `docs/ICONOPLASM_REQUEST_LIFECYCLE.md`,
`docs/SITE.md`, and `cloudflare/deployment-topology.json` before changing the
gene document path, Worker split, deployment order, or module names.

**ARCHITECTURE FENCE [IPD-010]** — routine Iconoplasm gallery publication is
dirty-shard-only. A vote or canonical publish event updates the shard ranges
that contain those symbols and atomically flips the manifest when they are all
ready. The scheduled route processes one bounded step and cannot request more.
Cold bootstrap, storage-format conversion, and card-mapping revision changes
must fail explicitly in this path; never reinterpret them as permission to scan
or rebuild all 19,023 genes. A missing shard may be repaired only from its own
recorded range. Keep the `dirty_shard`, `baseline`, `publication`, and
`schema_migration_required` vocabulary: generic `rebuild`, `refresh`, `warm`,
or responsibility-only names hide cost and have already caused regressions.
Read `docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md` and Linear B-695
before changing gallery publication, its cron route, KV accounting, or mapper
revision behavior.

**ARCHITECTURE FENCE [IPD-011]** — the exact versioned card artifact selected by
the durable card-publication head owns the published source-portrait selection and every
input used to derive the canonical public blot fingerprint and immutable Bunny
key. Blot-only uploads and portrait-locator reads never republish KV. The extension
locator endpoint projects portrait fields directly from that named card payload;
it has no independent pointer or version. Byte-equivalent CDN caches and
deterministic immutable projections are allowed; independently selected image
state is not. Caching must preserve the named snapshot and never promote
private or mutable routes into public CDN content. Discovery/catalog/D1 rows may decide
membership, ordering, rich detail, candidates, and authoring state; they do not
decide either public image identity. Ordinary and image-only account cards may
render their blot composition from the exact card VM, while gene-page metadata,
structured data, archives, image sitemaps, and public media use the matching
workstation-materialized blot WebP. The stable route derives its object key from
the exact card and may use only an exact-card legacy blot as migration fallback.
Never restore `publishedPortraitRefs(...)`,
discovery-row or raw `icono_publish_state` SHA, a browser-local portrait cache,
or another parallel snapshot as a public image source. That split caused B-700.
Read
`docs/ICONOPLASM_HOME_PERFORMANCE.md`,
`docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md`, and the B-700 section of
`docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md` before changing any public
image projection. Any replacement must preserve the ontology and single exact
card authority, and pass same-session visual comparison plus blot
page/sitemap/public-media concordance tests.

**ARCHITECTURE FENCE [GG-001]** — automatic GeneGuessr daily selection gives
each normalized gene surname exactly one lottery slot. It first chooses a
surname from a deterministic without-replacement shuffle-bag, then a
deterministic representative inside that surname. Automatic targets cannot
repeat inside one complete playable-surname cycle;
AlphaFold-only rows are excluded from the automatic bag; structure fallback
may advance only through the remaining one-representative-per-surname
sequence. Manual overrides remain explicit
exceptions. Never hash across the flat protein table or let a large family gain
more automatic slots because it has more members. Read
`docs/GENEGUESSR_DAILY_SELECTION_RUNBOOK.md` before changing the daily pool,
daily hash, target availability fallback, schedule cache, or pre-warm selection.

Ahead-of-time recap reconciliation must reject an unreachable automatic target,
never change that protein to AlphaFold. Its availability replacement must come
from outside every UniProt ID and normalized surname in the authoritative
horizon, so one broken structure cannot create a later collision or cascade
rewrite. Availability pins are automatic, pool-fingerprint-bound records (not
manual overrides); admin schedule, pre-warm, request slow path, and card render
must all consume the same pin. A visually accepted replacement structure must
also be cached in R2, pinned through its play date, and read back with the
requested `pinnedUntil` metadata before yearly coverage can pass.

**ARCHITECTURE FENCE [GG-002]** — a GeneGuessr recap image is usable only when
the rendered canvas contains molecule pixels and the exact uploaded bytes can be
read back from the immutable day + UniProt + renderer key. A Bunny 2xx response,
an object HEAD, a Discord attachment node, or a non-empty PNG is not visual
proof. Missing images may preserve the daily text recap, but admin coverage must
say so and a later repair must edit the existing Discord message rather than
post a duplicate. Annual filling is a resumable reconciliation, not a blind
365-item loop: preflight and final checks are bounded, verified objects are the
durable checkpoint, only missing identities render, and the browser releases
each protein image after its missing days finish. Read `docs/DISCORD_INTEGRATION.md`
before changing recap rendering, storage, bulk coverage, upload success, cron
fallback, repair, or visual acceptance.

The authoritative annual schedule response must never return HTTP 200 with a
null identity in its requested horizon. Generate primary identities from one
canonical in-memory shuffle-bag plan, bulk-load the minimal protein summaries,
write no per-day schedule cache, and fail the whole response closed if any
summary is missing. Do not restore per-day KV schedule caching or `SELECT *`
schedule hydration: together they exhausted Cloudflare's daily KV write budget
and a live annual request after 340 future identities, disguising the
remaining 25 failures as successful null rows.

Automatic availability pins are durable D1 state, not KV state. They must stay
available even when unrelated KV writes have exhausted the account's daily
quota; annual reconciliation discovered this fence when its first dead curated
structure could not record a replacement after the old schedule cache spent the
KV budget.

Mol*'s fixed bottom-left orientation axes are not molecule pixels. Readiness
must measure the molecular viewport and require spatial spread outside that UI
region. Any readiness change must bump `DISCORD_RECAP_RENDER_CONTRACT`; images
accepted by an older gate must never satisfy the new coverage audit.

## "Site is broken" runbook

When a user reports "site broken", missing images, or a visual regression, do
not preselect either the network or our code as the cause. Write competing
hypotheses and disproof tests. Check the actual installed version and affected
browser, the published payload and exact image identity, source delivery, and
local rendering. A healthy alternate region cannot disprove the user's failure;
a failed local resolver cannot prove a global provider outage. Separate observed
facts from inferred causes, and read the relevant runbook before changing policy.

Concrete rules:

1. **If the project has a runbook for the bug, read it first.** `D:\Coding\Website\docs\` has `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` for "portraits broken on iconoplasm.brinedew.bio." Read it before touching the codebase. If a runbook does not exist, the user can tell you, and that is fine — but check for one before assuming there isn't.
2. **"Fine yesterday, broken today" is not a cause.** Check deployed/installed changes, publication freshness, quotas, and the user's actual network. Use public resolvers only as contrasting evidence, not as a substitute for the affected path.
3. **If the user rejects a fix twice, revisit its premises.** Show which hypotheses were disproved and which remain. Do not repeat a rejected architecture or disguise its costs with new names.
4. **Verify the owner's actual provider choice before calling account state a blocker.** Iconoplasm uses already-paid Bunny because R2 billing is unavailable. R2 enablement is not this product's unblocker. Test Bunny's healthy path and the affected tab's first-party fallback separately; preserve both. If Bunny administration itself is inaccessible, report that exact access failure instead of silently changing providers.
5. **The Playwright browser is already logged into brinedew.bio.** For "what is the live state of X" questions, navigate to `https://brinedew.bio/admin/iconoplasm#costs` (or the relevant admin page) and read the rendered tables. Do not probe external APIs with auth tokens you don't have when the browser session already has the access you need.
   **Browser-selection fence (B-713):** an explicit request for Playwright MCP means the actual `mcp__playwright__*` tools. Discover and call those tools before reporting a browser or authentication blocker. A signed-out Codex in-app browser, missing Chrome bridge, or Firefox Computer Use refusal says nothing about the Playwright session. Do not substitute those backends or install an unrequested bridge. The separate desktop-session rule below applies when the user asks to inspect that desktop session, not when they explicitly select Playwright MCP.
6. **Cost both delivery paths.** First-party fallback is intentional for affected networks, not a reason to route every healthy reader through Cloudflare. Changes must preserve correctness and show request, storage, CPU, and publication costs, including failure paths.
7. **Use the requested desktop session.** If the owner has Edge/Firefox and a VPN/provider dashboard open, read the installed Computer Use skill and inspect that actual window before declaring browser access blocked. A missing Chrome bridge add-on says nothing about desktop Computer Use availability. Refresh window identity after tab detachment and refresh observed state after user input. Never install an unrequested bridge or change providers to bypass this check.

**ARCHITECTURE FENCE [IPD-008] metadata transport:** read
`docs/ICONOPLASM_CARD_PUBLICATION_V2.md` before changing publication or reloads.
The on-demand hash directories map a named snapshot to per-gene content hashes. Immutable per-symbol
detail and portrait projections may use Bunny; they are not another publisher.
Unchanged hashes retain their URLs across votes; changed hashes get new URLs.
No whole-card shards enter the extension, no reader writes occur, no D1 fallback
elects canon, and private/mutation traffic never enters the CDN. Keep separate
hover lanes, deadlines, bounded caches and per-tab network decisions. Test cold
CDN fills, blocked networks, concurrent lanes and publication changes together.
Storage migrations must also keep the released client's delivery-index and v1
content envelope working. A validation package can retain the released version
number while containing newer code: compare package/runtime hashes, not only the
displayed version. V2 compatibility reads one directory plus the exact lane
object; never load its packed shard or make portraits wait on rich-card bytes.
Prepare native portrait bytes in the context that paints them: the persistent
card frame for framed layouts, host for simple cards. The adapter retains source
selection and hedging. A host-page image cache hit is not frame readiness;
verify transfer counts with browser routing/cache interception disabled.

## Local development overrides

Before changing factory catalog status, model versions, or recipe admission,
read `docs/ICONOPLASM_FACTORY_RETIREMENT.md`. Retired letters remain valid for
historical identity but cannot admit new generation, activation, or diagnostics.

Before changing Factory output belts, read `docs/ICONOPLASM_FACTORY_BELTS.md`.
Keep exact qualified lineage, bounded indexed newest-six reads, stable inspection,
and the existing shared PhotoSwipe viewer. Belt pins never select canonical images.

- **Local API override:** `?gg_api=http://127.0.0.1:8787` for local dev only. Persists in localStorage; clear with `?gg_api=clear`.
- **Staging on Cloudflare:** `brinedew-bio-staging` Pages project and three workers (`the-only-allowed-public-edge-worker-that-must-not-touch-state-staging`, `geneguessr-api-staging`, `geneguessr-benchmark-staging`) are live on the dashboard. `staging.brinedew.bio` resolves. **Production deploys do not update staging.** Staging serves whatever was last manually dispatched to it. Trust `brinedew.bio` for "is the live site correct"; do not trust `staging.brinedew.bio` as a preview of production.

## Iconoplasm publication aliases

Before changing gene-label recognition, the catalog manifest, or extension
alias caching, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`. Administrators own
the curated desired policy in D1; bounded individual KV revisions stage it for
one atomic alias/blocklist recognition-pair bundle, which alone serves the
anonymous read plane. `workers/iconoplasm-publication-aliases.js` is the
bootstrap seed and shared normalization contract, not the routine editing surface.
Generated biological synonyms and portraits remain workstation-owned. Preserve
cross-policy alias/blocklist revision dependencies, the unchanged manifest
shape, the 4 KiB ceiling, and anonymous no-D1 reads.

## Verify live infrastructure — project-specific cases

The general principle (Playwright first, then code) is in root `AGENTS.md`. These are the project-specific failures that must not recur:

- **Don't conclude a third-party service is missing from the codebase without checking the third-party dashboard.** Example: Boosty integration is a Discord bot configured in Discord's Server Settings → Integrations, not in the worker code. The codebase only handles the website auth tier detection piece. Before concluding a third-party integration is absent, check the actual service dashboard, the Discord server's Integrations page, and Cloudflare Workers secrets — not just code references.
- **Don't assume you can't access a service the user has access to.** Example: the user's Discord session was already available in the Playwright browser — wrong initial URL (`/app` instead of the guild directly) does not mean the session is missing. Try navigating directly in Playwright first. If you get a login page, the user may need to log in, but don't assume that without trying.
- **Don't argue with the user about something they can verify in one click.** Example: when told the Boosty bot is on the server, _check_ it instead of saying "I don't know." The user can verify; verify with them.
- **Don't run adversarial "debate" subagents on pre-digested premises.** Each agent must independently read the codebase and check live infrastructure before arguing. If they can't find data, they say so. Otherwise it is LLM theater, not a debate.
