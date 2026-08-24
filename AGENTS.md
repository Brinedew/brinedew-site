# Website project rules

This `AGENTS.md` is loaded automatically when work happens inside `D:\Coding\Website\`. Root `D:\Coding\AGENTS.md` rules still apply — these are project-specific additions.

## Architecture fence registry

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
one network's DNS result into a global accelerator disable. Read
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
existing non-visual homepage description, not as new chrome in the immersive
Archive/Clans switcher; feed skip links stay clipped until keyboard focus. Read
`docs/ICONOPLASM_GENE_CARD_SEMANTICS_RUNBOOK.md` before changing the renderer,
gene HTML, range map, robots metadata, archive, sitemap, or `llms.txt`.
The canonical public machine image is the Iconoplasm gene blot, not its source
portrait. A blot is the exact image-only shared card composition:
published portrait cover crop, protection gradient, full gene name at bottom
left, and gene symbol at bottom right. The workstation renders its immutable
768x1024 WebP from the exact selected published card; Cloudflare never renders
it. Every complete gene page projects the exact ready blot through a
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
image. In healthy non-Vietnam regions, IPD-001 selects Bunny's byte-equivalent
accelerator URL; Vietnam and any failed Bunny probe stay on the first-party
route. Delivery selection must not replace the first-party discovery identity.
Massive `/genes/{range}` pages are text-only discovery indexes and must not
render portrait or blot thumbnails that bypass the gallery collection mechanic.
Image metadata may expose only a ready object whose fingerprint still matches
that exact card. Blot readiness must never gate
the underlying complete gene profile: every eligible gene remains linked from
its frozen archive range and listed in its gene-sitemap shard, while a gene with
no ready blot simply has no image-sitemap child. Those crawler
reads must never enroll work, consult votes, scan D1, or launch Browser Rendering.
Agent image lookup reads that same exact published-card authority. The bounded
`POST /api/public/v1/images/resolve` contract accepts at most 50 identifiers and
returns separately typed `gene_blot` and temporary `portrait` fields; it must
not invent one generic "image" field. `/blot/{SYMBOL}.webp` is the stable
canonical gene-image identity. `/portrait/{SYMBOL}.webp` is only the stable
medium portrait alias and must never be promoted to the canonical image. Keep
portrait coverage until all 19,023 published genes have ready blots; remove it
from this resolver only after live complete-corpus proof.
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
proxy. Rate limits live on that route owner. Read
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
not perform an anonymous auth lookup. Extension detail uses a version-addressed
immutable per-symbol GET; older clients retain the batch compatibility route.
HTML and PDF feed one tab-scoped reading session. That session compiles the
recognized unique-symbol inventory and prepares complete card detail plus decoded
portrait before pointer intent: up to 16/64/128 ordinary-document symbols with
3/6/8 workers on constrained/ordinary/measured-fast connections, plus deterministic
near-viewport windows for larger documents. Data Saver and 2G disable preparation.
Hover selects an already-ready card; its foreground GET is only a recovery path
and may promote the same in-flight immutable request without waiting for whole-cache
hydration. Do not restore pointer-trajectory, DOM-neighbor, scroll-direction, or
surface-specific prediction. Packaged card fonts begin loading
during initialization in both the host page and persistent card frame. Both routes
project immutable published card artifacts and
persist a bounded cache keyed by the card snapshot version; they must not
compose public hover cards from D1 or turn transient
failures into durable “missing gene” records. The admin-managed shared extension
text blocklist and curated publication aliases are one recognition policy: D1
owns each desired state, while individual immutable KV revisions are bounded
publication inputs and history. Anonymous manifest, search, and resolver paths
split one newest valid immutable recognition-pair bundle, never select the two
policies independently and never fall back to D1. A healthy cold read is one
bounded prefix list plus one payload GET; a nonempty malformed or nonvisible
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
remain list-free. The default scheduled reconciler owns bounded best-effort
cleanup of alias, blocklist, and pair KV histories, including the exact-pair
fast path; never disable cleanup for the scheduled caller.
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
`KV_GALLERY_VERSION` owns both the published source-portrait selection and the
canonical public blot reference. Discovery/catalog/D1 rows may decide
membership, ordering, rich detail, candidates, and authoring state; they do not
decide either public image identity. Ordinary and image-only account cards may
render their blot composition from the exact card VM, while gene-page metadata,
structured data, archives, image sitemaps, and public media use the matching
workstation-materialized blot WebP. Never restore `publishedPortraitRefs(...)`,
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

When a user reports "site broken" or "images not loading" or any visual regression, the first 30 minutes are dominated by the wrong kind of investigation (DNS-layer forensics, status-page checks, Git blame) when the actual answer is almost always on the user's network or in a project-owned fallback that already exists. The pattern that wastes hours is:

- probing public resolvers / external CDNs to "prove they're not the cause" (they almost never are)
- reading the architecture doc only after exhausting the codebase
- assuming the user wants a code change when the user actually wants the right diagnosis
- proposing a project-side "fix" that costs the project's budget when the bug is on a third party

Concrete rules:

1. **If the project has a runbook for the bug, read it first.** `D:\Coding\Website\docs\` has `ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md` for "portraits broken on iconoplasm.brinedew.bio." Read it before touching the codebase. If a runbook does not exist, the user can tell you, and that is fine — but check for one before assuming there isn't.
2. **If the user says "fine yesterday, broken today," the question is not "what changed in our project"** (the project almost certainly did not change). The question is "what changed in the user's network path to the third party." Public resolvers will almost always say "fine" because the breakage is on a subset of consumer resolvers. The right diagnostic is the _user's actual recursive resolver_, not 8.8.8.8.
3. **If the user rejects a "fix" twice, the user is telling you the fix is the wrong shape.** Stop proposing that fix. Ask what the user wants, or say "I do not have a fix that does not cost the project budget, and I am not going to keep proposing ones."
4. **When the architecture doc already names the durable fix and the durable fix is blocked by an account-level state (e.g. R2 disabled because billing/card path is broken), the right move is to surface the unblocker, not to invent a project-side workaround.** The unblocker is a user action on the third-party dashboard, not a code change.
5. **The Playwright browser is already logged into brinedew.bio.** For "what is the live state of X" questions, navigate to `https://brinedew.bio/admin/iconoplasm#costs` (or the relevant admin page) and read the rendered tables. Do not probe external APIs with auth tokens you don't have when the browser session already has the access you need.
6. **Do not propose a code change as a band-aid** that converts a third-party cost into a project cost. The user has rejected this pattern four times in a row when it was proposed in the 2026-06-26 incident. Read the room.

## Local development overrides

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
