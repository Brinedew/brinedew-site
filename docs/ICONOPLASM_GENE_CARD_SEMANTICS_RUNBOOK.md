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

## Canonical portrait discovery contract

The published lead portrait already has one immutable, provider-independent
identity: its content-addressed first-party medium WebP under
`https://iconoplasm.brinedew.bio/portraits/v1/<prefix>/<sha>/medium.webp`.
That existing URL is the single canonical portrait URL. Do not create
`/portraits/{SYMBOL}.webp`, a symbol-addressed redirect, a mutable duplicate in
storage, or another symbol-to-portrait snapshot. Any of those would add a
second timeline that could disagree with the published card.

For every complete, indexable gene page, the same exact medium WebP URL must be
present in all of these projections:

- the server-rendered lead `<img src>` with descriptive alt text and nearby
  accessibility-tree-preserving text that names it as the canonical
  Iconoplasm portrait of that human gene;
- gene-specific `og:image`, `og:image:url`, `og:image:alt`, `twitter:image`,
  and `twitter:image:alt` metadata, alongside gene-specific social title and
  description fields;
- one linked JSON-LD graph in which `WebPage.primaryImageOfPage` and
  `Gene.image` reference the same `ImageObject`, whose `contentUrl` is that
  medium WebP; and
- the gene's entry in its existing image-sitemap shard, where the canonical
  portrait is always the primary image.

Use the same published lead-card payload that rendered the page; never select a
portrait separately for metadata or structured data. Do not invent external
identifiers that are absent from the authoritative payload. JSON-LD must be
escaped for an HTML script context and omitted for incomplete/noindex pages.
If the route record and rendered card payload disagree on portrait SHA, the
whole gene document fails closed as `503`/noindex; merely omitting image
metadata while leaving the divergent page indexable is forbidden.
After first paint, the browser may select Bunny's equivalent accelerator URL
through the existing IPD-001 health probe; that delivery optimization must not
replace the first-party URL in server HTML, metadata, structured data, or the
sitemap.

The optional requested labelled-card PNG is a secondary derived image. It may
follow the canonical portrait in archive HTML or the sitemap only when its ready
fingerprint still matches the exact published card artifact. Its absence must
never suppress the canonical portrait, and its presence must never make it the
page's `primaryImageOfPage` or the `Gene.image`.

Crawler GET and HEAD paths remain projections, not workflows. Sitemap and
archive generation continue to read the shared versioned KV catalog and must
add no D1 scan. A canonical gene document may retain its existing bounded exact
D1 identity/detail reads under IPD-009, but discovery rendering must add no
request-time write, enrollment, vote lookup, Queue send, repair, or Browser
Rendering work.

Before a gene-sitemap shard is emitted, one range-batched exact-shard read from
the card artifact selected by `KV_GALLERY_VERSION` validates that every
canonical portrait SHA still matches the discovery snapshot. Missing card
publication state, a missing eligible symbol, or any SHA divergence returns an
uncached `503` for the whole shard. It must never degrade to a partial or stale
image sitemap. The response exposes both catalog and card versions so a crawler
cache validator advances with either publication surface. The static portrait
discovery contract version `2026-08-23-v1` is also part of the validator, and
the sitemap `lastmod` floor is `2026-08-23`, so this renderer release itself is
truthfully visible even when catalog data did not change.

The crawl frontier exists for search indexing and user-directed retrieval, not
for unbounded model-training ingestion. On 2026-07-24, GPTBot and ClaudeBot
generated more than 81,000 requests before 08:00 UTC by walking the new
19,023-gene frontier and first-party portraits. That crossed the account's
75,000-request warning threshold before the Scott Alexander referral.

The project therefore separates bot purposes. Portrait indexing does not alter
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

## Requested labelled-card images

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

Archive range HTML and the image sitemap expose a thumbnail only after the ready
fingerprint matches the card in that same catalog artifact. Their GET and HEAD
paths remain immutable published reads: no enrollment, vote query, D1 repair,
Queue send, or Browser Rendering is allowed. This keeps Google discovery cheap
and makes crawling incapable of manufacturing the 19,023-image corpus.

The canonical portrait is different: it is already part of every complete
published gene record, so each eligible gene sitemap entry exposes its existing
content-addressed first-party medium WebP whether or not a labelled-card PNG has
been requested. When a ready labelled-card exists, it is an additional,
secondary image after the portrait.

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

Indexability changes are atomic discovery migrations: revise this fence, the
range contract, canonical portrait and optional labelled-card sitemap
projections, `llms.txt`, robots headers, lead-image accessibility text,
Open Graph and Twitter metadata, JSON-LD, tests, and release verification
together. Do not add visible derivation prose to gene pages; the visual card
already serves human readers and the semantic definition list serves non-visual
readers.
