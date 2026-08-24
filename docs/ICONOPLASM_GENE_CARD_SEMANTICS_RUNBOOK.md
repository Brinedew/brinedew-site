# Iconoplasm gene semantics and discovery runbook

**ARCHITECTURE FENCE [IPD-003]** — Complete canonical gene profiles are
discoverable through one immutable-catalog eligibility contract and frozen,
self-locating prefix ranges. The labelled semantic profile remains a one-to-one
non-visual equivalent of the existing card, never an extra visible SEO product.

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

The same predicate owns response headers, HTML metadata, `/genes` membership,
gene sitemap shards, and tests. Never update just one of those surfaces.

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
The stable first-party `/blots/<SYMBOL>.webp` route resolves only the immutable
object referenced by the card artifact selected by `KV_GALLERY_VERSION`; it is
not a second selection timeline and never consults live D1 portrait state.

When a complete, indexable gene page has an exact ready blot, that blot must be
present consistently in all of these projections:

- a server-rendered `<img>` with gene-specific alt text inside the initially
  hidden print-copy surface; the existing `request print copy` action reveals
  it, while the default gene-page layout contains neither a visible duplicate
  blot nor explanatory caption copy;
- gene-specific `og:image`, `og:image:url`, `og:image:alt`, `twitter:image`,
  and `twitter:image:alt` metadata, alongside gene-specific social title and
  description fields;
- one linked JSON-LD graph in which `WebPage.primaryImageOfPage` and
  `Gene.image` reference the same `ImageObject`, whose `contentUrl` is that
  first-party semantic blot URL; and
- the gene's only image-sitemap entry.

Use the same exact card payload for blot readiness, interactive page, metadata, and
structured data. JSON-LD must be escaped for an HTML script context and omitted
for incomplete/noindex pages. Route/catalog records establish identity and
membership only. If the requested card projection is unavailable or malformed,
the whole document fails closed as uncached `503`. A valid complete card with no
matching ready blot stays indexable, linked from its frozen archive range, and
listed in its gene-sitemap shard; only its blot image metadata, `ImageObject`,
and image-sitemap child are absent. The raw portrait may
remain visible in the interactive dossier as subordinate source material, but
it is never `primaryImageOfPage`, `Gene.image`, the social image, or an
image-sitemap entry.

In healthy non-Vietnam regions, the tab-scoped IPD-001 probe may select Bunny's
byte-equivalent immutable URL for delivery. Vietnam and any failed Bunny probe
use the first-party route. The first-party URL remains the discovery identity.

## Agent image resolution

Public assistants and other clients resolve images through the bounded
`POST /api/public/v1/images/resolve` endpoint. A request accepts `symbols` or
`identifiers`, contains at most 50 values, and is limited to 60 requests per
minute. The existing public identifier resolver owns normalization, so a gene
symbol, publication alias, or UniProt identifier reaches the same canonical
symbol. The response preserves the ontology with distinct
`images.gene_blot` and temporary `images.portrait` fields. It never returns
an ambiguous generic image.

Published gene portraits and published gene blots are the only two Iconoplasm
asset classes dedicated under CC0 1.0 Universal. Every returned image envelope
states `rights`, `license_url`, `usage_url`, `embedding_permitted`,
`hotlinking_permitted`, `modification_permitted`, `commercial_use_permitted`,
and `attribution_required` explicitly. The gene page links to `/license`, a
ready blot's `ImageObject` carries `license` and `usageInfo`, and raw portrait
and blot responses expose standard HTTP `rel="license"` plus the usage page.
Do not broaden that dedication to catalog data, metadata, prose, software,
prompts, unpublished images, services, or any other Brinedew asset.

The stable `/blot/{SYMBOL}.webp` URL is the canonical gene image. The singular
`/portrait/{SYMBOL}.webp` URL is only the medium portrait alias; full and
thumbnail aliases are intentionally absent because the public product has four
images per gene: full, medium, thumbnail, and blot. Both aliases resolve from
the exact published card selected by `KV_GALLERY_VERSION`. The blot route
derives the current renderer fingerprint and immutable object key from that
card; it does not require blot metadata to be copied back into KV. A vote
changes public output after the normal canonical-card publication, while the
portrait remains available during blot generation.

The portrait field and endpoint remain only while blot coverage is incomplete.
Remove them from this agent workflow only after a live exact-card audit proves
ready blots for all 19,023 published genes. The massive `/genes/{range}` pages
remain text-only so they support discovery without replacing the gallery
collection experience; image-sitemap children continue to expose ready blots.

Run that audit from the website repository without downloading image bytes:

```sh
node scripts/audit-iconoplasm-live-blot-coverage.mjs --require-complete
```

The command counts published gene URLs and singular `/blot/{SYMBOL}.webp`
projections across every live gene-sitemap shard. Exit code `2` means coverage
is incomplete and therefore forbids portrait removal. A successful zero exit
with `complete: true` is necessary, but still requires spot-checking blot bytes
from Vietnam and a healthy Bunny region before changing the delivery contract.

The resolver is the free HTTP foundation for any future MCP transport. Do not
create a separate MCP authority, require users to configure MCP for ordinary
image retrieval, publish a 19,023-image manifest, or add source-portrait links
to every archive row. Bunny may be returned as a byte-equivalent alternate for
healthy non-Vietnam delivery, but the first-party URL remains the stable
identity and works directly in Vietnam.

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

Crawler GET and HEAD paths remain projections, not workflows. Sitemap and
archive generation continue to read the shared versioned KV catalog and must
add no D1 scan. A canonical gene document may retain its existing bounded exact
D1 identity/detail reads under IPD-009, but discovery rendering must add no
request-time write, enrollment, vote lookup, Queue send, repair, or Browser
Rendering work.

Before a gene-sitemap shard is emitted, one range-batched exact-shard read from
the card artifact selected by `KV_GALLERY_VERSION` must resolve a structurally
valid card for every catalog identity candidate. Every complete card remains a
gene URL entry; only cards with exact ready blots receive an image child. A
missing requested card or failed artifact read returns uncached `503` for the
whole shard. Catalog/D1
portrait SHAs are never compared or substituted. The response exposes both
catalog and card versions so a crawler
cache validator advances with either publication surface. The static blot
discovery contract version is also part of the validator, so a blot renderer
release itself is truthfully visible even when catalog data did not change.

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
ordinary `/genes` anchor lives inside the homepage's existing `sr-only`
description, where it is useful to accessibility-tree and crawler readers
without adding a third destination to the immersive Archive/Clans switcher.
Likewise, the feed's before/after links are keyboard affordances: keep them
clipped at rest and reveal the full 44px control only while focused. Moving
either surface into the default visual composition is an immersion regression.

## Frozen range contract

`workers/iconoplasm-gene-discovery.js` contains the deliberate range table for
the stable 19,023-gene inventory. `/genes` links every leaf directly under its
initial letter, and each range page contains ordinary server-rendered links to
canonical profiles. For example, TP53 is always `/genes` → `TO–TR` → TP53.

The range table is not generated at request or publication time. Numeric pages
and automatic count rebalancing are prohibited because an agent with a known
symbol must determine the correct link without guessing a page number. Routine
catalog or portrait publications update range contents but not boundaries. An
unmatched or multiply matched eligible symbol is a failed inventory migration
and must stop release work until a deliberate rebaseline updates the table,
documentation, sitemap expectations, and tests together.

Archive and sitemap requests read the shared versioned KV catalog artifact.
They must never add an on-request whole-catalog D1 scan.

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
changes do not. Dirty-shard publication does not wait for materialization: the
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
through `/api/iconoplasm/cards/:symbol` and the artifact selected by
`KV_GALLERY_VERSION`. An `asset=` query value can only assert the artifact's
exact portrait SHA: malformed values return `400`, and a different valid SHA
returns `409`. It must never select the current D1 authoring portrait or trigger
a site-gene-detail fallback, even during the expected D1-to-artifact publication
window.

High-resolution print copies remain an explicit user-requested PNG workflow.
They are not the canonical search image and never appear in image sitemaps.
Archive, sitemap, semantic blot, and gene-page GET/HEAD paths are immutable
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
is also exposed through Open Graph, Twitter metadata, linked `ImageObject`
structured data, and the gene image sitemap. Removing redundant visible copy
therefore does not remove the canonical image from the crawl graph.

Indexability changes are atomic discovery migrations: revise this fence, the
range contract, canonical blot sitemap
projections, `llms.txt`, robots headers, lead-image accessibility text,
Open Graph and Twitter metadata, JSON-LD, tests, and release verification
together. Do not add visible derivation prose to gene pages; the visual card
already serves human readers and the semantic definition list serves non-visual
readers.
