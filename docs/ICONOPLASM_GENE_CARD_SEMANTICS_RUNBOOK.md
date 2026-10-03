# Iconoplasm gene semantics and discovery runbook

**ARCHITECTURE FENCE [IPD-003]** — The catalog object `catalog/v3/index.json`
defines the discoverable set: every gene in it gets one static document and one
sitemap URL, built at deploy time. The labelled semantic profile remains a
one-to-one non-visual equivalent of the existing card, never an extra visible
SEO product.

## Why this exists

The card deliberately presents facts as a compact physical label: a person can
associate a handwritten note, selected field, and molecular origin at a glance.
DOM readers and AI browsing agents instead received an unlabeled stream of text.
The shared renderer now emits one semantic profile using a heading and a
definition list. Every two-part visual field is one explicit directional
mapping—for example, molecular category → character sex and PFAM clan →
character aesthetic—so non-visual readers never have to infer a relationship
from nearby text. It carries the exact card facts without adding visual
duplication.

Printed selector strips require an additional boundary. Labels such as
`ONCOGENE` / `TUMOR SUPPRESSOR` and `TRANSMEMBRANE` / `SOLUBLE` are visual ink,
not interactive controls and not a list of equally true facts. The renderer
therefore hides each printed alternative from the accessibility tree, names the
resolved molecular value on the visual selector, and names the handwritten
character result as a note. Do not model these strips as radio buttons, tabs, or
peer text. The four decorative legends are emitted as CSS ink rather than DOM
text because browsing agents may flatten DOM content without honoring ARIA; the
semantic profile remains the complete non-visual reference for the directional
mapping.

## Boundaries that must move together

The semantic profile is rendered by
`shared/iconoplasm-card/shared-card-runtime.js` and styled with the standard
visually-hidden, accessibility-tree-preserving rule in
`shared/iconoplasm-card/shared-card-label.css`. The same renderer supplies both
the Worker-generated first HTML and the hydrated client card; do not create a
second server-only or client-only fact mapper.

IPD-003 supersedes IPD-002's obsolete blanket-noindex premise. A current
canonical catalog record with a full name and published lead portrait is
eligible only when the shared renderer also emits its labelled semantic
profile. Eligible pages omit both robots directives. Aliases redirect
permanently, known incomplete records remain noindex, and unknown symbols return
a real 404 instead of the application shell.

The same predicate owns response headers, HTML metadata, and tests. Never
update just one of those surfaces.

A gene has one public name: its HGNC approved name, which is
`icono_gene_catalog.full_name`, with the symbol standing in when that is empty.
`iconoplasmGeneName` in `workers/lib/iconoplasm-gene-name.js` is the only
reader of that rule. The stable gene object's `full_name`, catalog row[1] of
`catalog/v3/index.json` (which titles the static gene documents and labels the
gallery and search results), and the shelf rows all take their name through it,
so the static document's title and the loaded card's title are the same
string. `icono_gene_essence.full_name` is the UniProt protein name the
workstation syncs; it names no gene in public, and a reader that takes it ahead
of the catalog row makes the tab title change when the card loads. The extension
never reads the catalog object: it reads `full_name` from the stable gene
object and `n` from the catalog manifest, both of which are the catalog row's
name. Catalog row[1] only changes for genes the Actions publisher rebuilds, so
a changed name reaches every gene's row with a full run
(`workflow_dispatch` with `full`), and the static documents with the next
deploy after it. `e2e/gene-name-one-source.e2e.mjs` proves the three
producers agree and the title holds still in a real browser.

## Canonical blot discovery contract

Iconoplasm's public machine image is a **gene blot**, not the source character
portrait. A blot is the shared card runtime's exact `image-only` composition:
the selected published portrait as a cover crop, the protection gradient, the
full gene name at bottom left, and the gene symbol at bottom right. The portrait
is an ingredient; the labelled blot is the finished public image.

The workstation renders each exact published card on the gallery's canonical
384x512 CSS artboard and captures it at 2x device density as a verified
768x1024 WebP. This preserves the gallery's responsive font sizes, inset, text
wrapping, shadows, and protection-gradient geometry instead of recalculating
its clamped CSS at a 768px layout width.
Its visible-material fingerprint includes the renderer revision, normalized
symbol, full gene name, and selected portrait SHA. The immutable object lives at
`/blots/v1/<initial>/<SYMBOL>/<fingerprint>/<SYMBOL>-iconoplasm-gene-blot.webp`.
The stable first-party `/blot/{SYMBOL}.webp` route enters the existing Worker.
It reads the gene's stable object and then its immutable WebP object from
Bunny (B-898: no head, no coordinator). A card without a blot returns an honest 404 at
the image route. There is no second mutable Bunny `/blot/{SYMBOL}.webp` object
to overwrite or wait for; its long-lived CDN cache stalled real publication on
2026-09-24 while the first-party route already worked.

When a complete, indexable gene page has an exact ready blot, that blot must be
present consistently in all of these projections:

- a server-rendered `<img>` with gene-specific alt text inside the initially
  hidden print-copy surface; the existing `request print copy` action reveals
  it, while the default gene-page layout contains neither a visible duplicate
  blot nor explanatory caption copy. Its actual `src` is the stable first-party
  `/blot/{SYMBOL}.webp` URL, with `data-iconoplasm-role="canonical-blot"` and
  `data-gene-symbol` identifying it unambiguously in the DOM;
- gene-specific `og:image`, `og:image:url`, `og:image:alt`, `twitter:image`,
  and `twitter:image:alt` metadata, alongside gene-specific social title and
  description fields;
- one linked JSON-LD graph in which `WebPage.primaryImageOfPage` and
  `Gene.image` reference the same `ImageObject`, whose `contentUrl` is that
  first-party semantic blot URL.

Use the same exact card payload for blot readiness, interactive page, metadata, and
structured data. JSON-LD must be escaped for an HTML script context and omitted
for incomplete/noindex pages. Route/catalog records establish identity and
membership only. If the requested card projection is unavailable or malformed,
the whole document fails closed as uncached `503`. A valid complete card with no
matching ready blot stays indexable and listed in the sitemap; only its blot
image metadata and `ImageObject` are absent. The raw portrait may remain
visible in the interactive dossier as subordinate source material, but it is
never `primaryImageOfPage`, `Gene.image`, or the social image. Visible
source-portrait and candidate-blot `<img>` elements
carry `data-iconoplasm-role="source-portrait"` or `"candidate-blot"` plus the
same normalized `data-gene-symbol`, so machine readers do not have to infer the
page's image hierarchy from layout or alt text alone.

On any healthy network, the tab-scoped IPD-001 probe may select Bunny's
byte-equivalent immutable URL for delivery. A failed probe selects first-party
for that tab; country is not a routing rule. The first-party URL remains the discovery identity.

## Agent image resolution

Public assistants and other clients resolve images through the bounded
`POST /api/public/v1/images/resolve` endpoint. A request accepts `symbols` or
`identifiers`, contains at most 50 values, and is limited to 60 requests per
minute. The existing public identifier resolver owns normalization, so a gene
symbol, publication alias, or UniProt identifier reaches the same canonical
symbol. The response exposes only the labelled `images.gene_blot` envelope; it
never returns a source portrait or an ambiguous generic image.

Published gene portraits and published gene blots are the only two Iconoplasm
asset classes dedicated under CC0 1.0 Universal. Every returned image envelope
states `rights`, `license_url`, `usage_url`, `embedding_permitted`,
`hotlinking_permitted`, `modification_permitted`, `commercial_use_permitted`,
and `attribution_required` explicitly. The gene page links to `/license`, a
ready blot's `ImageObject` carries `license` and `usageInfo`, and raw portrait
and blot responses expose standard HTTP `rel="license"` plus the usage page.
Do not broaden that dedication to catalog data, metadata, prose, software,
prompts, unpublished images, services, or any other Brinedew asset.

The stable `/blot/{SYMBOL}.webp` URL is the canonical gene image. Immutable
`/portraits/v1/...` assets remain available to the gallery and other
portrait-native product surfaces; the agent gene-image workflow returns blots
only. The blot route derives the current renderer
fingerprint and immutable object key from the gene's stable object; it does
not require blot metadata to be copied back into
KV. A vote changes public output after the normal canonical-card publication.

For ordinary exact-symbol retrieval, teach the stable `/blot/{SYMBOL}.webp`
route before the resolver. The resolver remains the advanced interface for
identifier normalization and batches of up to 50 values; it is not the first
abstraction for someone who already knows the HGNC symbol.

The resolver is the free HTTP foundation for any future MCP transport. Do not
create a separate MCP authority, require users to configure MCP for ordinary
image retrieval, or publish a 19,023-image manifest. Bunny may be returned as a byte-equivalent alternate for
any healthy network, including working Vietnamese providers and VPNs, but the
first-party URL remains the stable identity and regional fallback.

Standards-aware clients discover that existing resolver from the RFC 8631
`Link` relations on public HTML, crawler documents, and JSON responses.
`rel="service-desc"` points to the small OpenAPI 3.1 document at
`/api/public/v1/openapi.json`; `rel="service-meta"` points to the existing
catalog metadata; and `llms.txt` is linked separately with `rel="describedby"`.
The OpenAPI document describes the resolver but does not create a second API or
image authority. Do not claim that HTTP headers alone make a search LLM use the
API: cold-agent retrieval is a separate release test. Do not publish a fake
`/.well-known/ai` or agent card; unimplemented experimental well-known routes
must return an explicit 404 rather than the application shell.

Crawler GET and HEAD paths are static files, not workflows; see "Static
discovery documents" below.

Blot readiness does not control sitemap membership. GET and HEAD for
the stable blot route read the published card through the existing Worker and
serve its verified immutable WebP bytes. Missing blots return 404. This route
does not read mutable D1 or create an alternate image selection timeline.

The crawl frontier exists for search indexing and user-directed retrieval, not
for unbounded model-training ingestion. On 2026-07-24, GPTBot and ClaudeBot
generated more than 81,000 requests before 08:00 UTC by walking the new
19,023-gene frontier and first-party portraits. That crossed the account's
75,000-request warning threshold before the Scott Alexander referral.

The project therefore separates bot purposes. Blot indexing does not alter
this split:

- GPTBot and ClaudeBot are model-training crawlers. A project-owned Cloudflare
  WAF rule blocks them on `iconoplasm.brinedew.bio` before Worker execution.
- OAI-SearchBot, Claude-SearchBot, and PerplexityBot remain allowed so public
  profiles can be indexed for AI search.
- ChatGPT-User, Claude-User, and Perplexity-User remain allowed for
  user-directed retrieval.
- `robots.txt` mirrors the same policy for cooperative crawlers. It is not the
  cost barrier; the WAF rule is.

`cloudflare/iconoplasm-crawler-policy.json` is the declarative policy and
`scripts/reconcile-iconoplasm-crawler-policy.mjs` applies it idempotently during
production deploys without replacing unrelated custom rules. Do not enable
Cloudflare's blanket "block all AI crawlers" setting: it would also remove the
search and assistant agents this discovery contract exists to serve.

The homepage link frontier must not become visible application chrome. Its
ordinary archive anchor lives inside the homepage's existing `sr-only`
description, where it is useful to accessibility-tree and crawler readers
without adding a discovery destination to the immersive Archive/Clans/Studio
switcher. Studio may resolve bounded canonical blots into a visible editable
diagram, but it is a creative surface rather than a second archive or image
authority.
Likewise, the feed's before/after links are keyboard affordances: keep them
clipped at rest and reveal the full 44px control only while focused. Moving
either surface into the default visual composition is an immersion regression.

## Static discovery documents

The crawler documents on `iconoplasm.brinedew.bio` are files in the static
asset bundle, written by `scripts/prepare-iconoplasm-edge-assets.mjs` during
every production deploy:

- `robots.txt`, which names `/sitemap.xml` and mirrors the crawler policy below;
- `sitemap.xml`, one flat urlset with the homepage, every gene in
  `catalog/v3/index.json` as `/gene/{SYMBOL}`, and the privacy, license and
  developers pages (19,023 gene URLs on 2026-10-02, about 1.3 MB, well under the
  protocol's 50,000-URL and 50 MB limits);
- `llms.txt`, a short pointer to the archive, the sitemap, the gene and blot
  URL patterns and the developers page;
- `gene/{SYMBOL}.html`, one small document per catalog gene with its own title,
  description, canonical URL, `og:image` and licence, which boots the shared
  app shell in place and writes its own `<title>` into that shell, so the tab
  shows the gene's title from first paint until the card loads;
- `_redirects`, which sends `/genes` and `/genes/*` to the Archive (`/`) with
  a 301, so old links and search results land on the one public catalog.

These files are as fresh as the last deploy: a gene added to the catalog object
appears in `sitemap.xml` and gets its document on the next push to `main`,
not when the catalog object is republished. The asset layer answers every one
of them before the Worker runs, so a crawler request costs no Worker request
and reads no KV, D1, Durable Object, Queue or storage object. The containment
deploy (`scripts/prepare-iconoplasm-schema-transition-config.mjs`) keeps the
same asset bytes and routes only gene pages into the Worker, so robots,
sitemap and llms.txt stay identical during a maintenance window.

The bundle counts toward Cloudflare's 20,000-file limit per Worker version. A
real build on 2026-10-03 produced 19,535 files (19,023 gene documents, 478
under `static/` and 34 others, 68 MiB), 465 under the limit, and the build
refuses a bundle above 20,000. Anything that adds a file per gene or per range
must show its count against that headroom first. Tests are not assets: the
Quartz `Static` emitter (`quartz/plugins/emitters/static.ts`) leaves every
`*.test.*` and `*.spec.*` file under `quartz/static` out of `public/static`,
which both this bundle and the main site are copied from, and the bundle build
refuses one that gets through. The same holds for old extension packages: the
site publishes the one package `extension-release.json` names, and the bundle
build refuses a missing one and any other (see
`docs/ICONOPLASM_RELEASE_INTEGRITY.md`).

## Workstation-materialized gene blots

Cloudflare does not render canonical blots. The local Iconoplasm workstation
asks the authenticated bounded backlog endpoint for exact published-card
identities, loads the Website checkout's shared card runtime and label CSS in
local Chrome, renders the `image-only` composition at 768x1024, converts it to
WebP, and uploads it through the authenticated admin route. The server verifies
fingerprint, selected portrait SHA, content type, byte ceiling, WebP dimensions,
immutable-key consistency, and Storage replication before atomically recording
the ready row and publication event.

The server ledger contains one bounded audit row per gene. Before upload, the
workstation persists the exact WebP in a durable local content-addressed store
with a SQLite manifest, so restarts retry the same bytes instead of rerendering.
A portrait or full-name change produces a new fingerprint; unrelated essence
changes do not. Per-gene publication does not wait for materialization: the
newly published card immediately defines the expected immutable key, and the
stable route begins serving it as soon as Bunny contains it. Corpus backfill
therefore performs zero KV writes. GET and HEAD routes never render, enroll,
repair, or enqueue work.

The authenticated candidate backlog has two modes. An explicit symbol list is
used by generation-session finalization. An empty list is the bounded automatic
priority lane: it returns only canonical-affecting symbols after the published
event watermark, excludes materialization-only events, refuses more than 100
pending symbols, and returns at most the requested render batch. The always-on
Iconoplasm Drain checks this lane once per minute while its request queue is
idle, renders at most 25 missing candidate blots, and publishes only after the
whole bounded priority set is ready. It then scans at most 250 published genes
per corpus-backfill batch, releases those backfill events every 100 scanned
genes, and stops after 20,000 scanned genes per UTC day. Priority work may run
while the operator is active; bulk backfill still obeys the workstation quiet
and resource gates. Ordinary transient failures wait five minutes rather than
opening a hot retry loop; a daily KV-budget refusal sleeps until the next UTC
budget day.

## Requested high-resolution print copies

The print-copy action is explicit enrollment, not a GET side effect. Its POST
records the current published card fingerprint in the bounded materialization
ledger. Signed-in users use their session; guests must pass Turnstile. Repeated
requests from many users converge on the same gene row and content-addressed
object. They do not create parallel renders.

The Queue renders only the exact versioned published card artifact. It never
reconstructs a winner from live votes. If publication changes while a render is
in flight, the stale completion cannot replace the newer desired fingerprint;
the ledger remains due for the new card. Downloads use a useful per-gene name,
for example `SOX12-iconoplasm-gene-card.png`.

Every print-copy enrollment, status, render, and download resolves its identity
through `/api/iconoplasm/cards/:symbol` and the gene's stable object. An
`asset=` query value can only assert that object's
exact portrait SHA: malformed values return `400`, and a different valid SHA
returns `409`. It must never select the current D1 authoring portrait or trigger
a site-gene-detail fallback, even during the expected D1-to-artifact publication
window.

High-resolution print copies remain an explicit user-requested PNG workflow.
They are not the canonical search image. Sitemap, semantic blot, and gene-page
GET/HEAD paths are immutable
published reads: no enrollment, vote query, D1 repair, Queue send, or Browser
Rendering is allowed. Crawling therefore cannot manufacture the 19,023-image
corpus.

## Safe changes

When a visible card field changes, update the canonical resolver and semantic
profile together, then run the semantic-card and SEO discovery tests. Keep the
profile a normal semantic `<section>` with labelled `<dt>` and `<dd>` pairs;
never use `display: none`, `hidden`, `visibility: hidden`, or `aria-hidden`,
because those erase it from the accessibility tree.

For printed selector alternatives, the inverse rule applies: keep the rendered
ink visually unchanged but `aria-hidden`, and put the resolved value on the
noninteractive parent field. Never use selection-state ARIA intended for real
controls on decorative label stock.

The hidden interactive blot is not the sole crawler signal. Its ordinary
server-rendered `src` remains in the initial HTML, while the same canonical URL
is also exposed through Open Graph, Twitter metadata, and linked
`ImageObject` structured data. Removing redundant visible copy
therefore does not remove the canonical image from the crawl graph.

Indexability changes are atomic discovery migrations: revise this fence, the
static sitemap and gene documents, `llms.txt`, robots headers, lead-image
accessibility text,
Open Graph and Twitter metadata, JSON-LD, tests, and release verification
together. Do not add visible derivation prose to gene pages; the visual card
already serves human readers and the semantic definition list serves non-visual
readers.
