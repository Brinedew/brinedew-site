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
`shared/iconoplasm-card/shared-card-label.css`. The same renderer supplies the
website's client-rendered card and the extension's hover card; do not create a
second fact mapper.

IPD-003 supersedes IPD-002's obsolete blanket-noindex premise. Eligibility is
catalog membership: a gene in `catalog/v3/index.json` gets a static document
(canonical URL, no robots directive) and a sitemap entry on the next deploy.
Anything else under `/gene/` (an unpublished symbol, a lowercase symbol, an
alias) answers a real 404 from the asset layer: `not_found_handling = "404-page"`
serves `404.html`, which says `noindex` and boots the app in place, so a
browser still resolves the symbol client-side while a crawler gets a 404. The
Worker serves no gene page and reads no gene route table for one.

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

## Blot discovery contract

Iconoplasm's public machine image is a **gene blot**, not the source character
portrait. A blot is the shared card runtime's exact `image-only` composition:
the selected published portrait as a cover crop, the protection gradient, the
full gene name at bottom left, and the gene symbol at bottom right. The portrait
is an ingredient; the labelled blot is the finished public image.

One painter draws every blot: `shared/iconoplasm-card/blot-painter.js`, the
same code that paints a reader's print copy. It reproduces the gallery's
384x512 artboard (responsive font sizes, inset, wrapping, shadows, gradient
geometry) on a canvas at 768x1024, and the drawing script refuses to upload a
blot whose card fonts did not load. The fingerprint hashes the painter
revision, the normalized symbol, the full gene name and the current portrait's
SHA. The immutable object lives at
`blots/v2/<initial>/<SYMBOL>-<fingerprint>.webp` (`workers/lib/iconoplasm-blot.js`).
The stable first-party `/blot/{SYMBOL}.webp` route enters the existing Worker.
It reads the gene's stable object and then its immutable WebP object from
Bunny (B-898: no head, no coordinator). In the few minutes between a new winner
or name and the drawing run, the route redirects (307, `no-store`) to the bare
current portrait. There is no second mutable Bunny `/blot/{SYMBOL}.webp` object
to overwrite or wait for; its long-lived CDN cache stalled real publication on
2026-09-24 while the first-party route already worked. Old `blots/v1/` objects
stay in storage because embedders were promised their CDN addresses never
change.

A gene's blot reaches machine readers through the static gene document, which
names it as the page's share image: `og:image` and the JSON-LD `image` carry
the stable first-party `/blot/{SYMBOL}.webp` URL. The gene page itself shows
the card once, with no duplicate blot. Route and catalog records establish identity and membership only. The raw
portrait may remain visible in the interactive dossier as subordinate source
material, but it is never the social image. Visible source-portrait and
candidate-portrait `<img>` elements carry `data-iconoplasm-role="source-portrait"`
or `"candidate-portrait"` plus the same normalized `data-gene-symbol`, so machine
readers do not have to infer the page's image hierarchy from layout or alt text
alone.

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
and `attribution_required` explicitly. The gene page links to `/license`, its
JSON-LD carries `license`, and raw portrait and blot responses expose standard
HTTP `rel="license"` plus the usage page.
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
serve its immutable WebP bytes, or redirect to the current portrait while the
blot is still being drawn. A gene with no published portrait returns 404. This route
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
- `404.html`, the page the asset layer serves, with a real 404, for any path that
  has no document, and `clans.html` and `studio.html`, the 200 documents of the
  two in-app routes. All three say `noindex,follow` and boot the shared app shell
  in place exactly as a gene document does; none is in the sitemap. A browser
  that opens an alias or lowercase gene link (`/gene/tp53`) gets the 404 page,
  which hands over to the app, and the app resolves the symbol client-side. A
  crawler gets a 404. The home page's own `index,follow` and canonical are
  untouched;
- `_redirects`, which sends `/genes` and `/genes/*` to the Archive (`/`) with
  a 301, so old links and search results land on the one public catalog.

These files are as fresh as the last deploy: a gene added to the catalog object
appears in `sitemap.xml` and gets its document on the next push to `main`,
not when the catalog object is republished. The asset layer answers every one
of them before the Worker runs, so a crawler request costs no Worker request
and reads no KV, D1, Durable Object, Queue or storage object. The containment
deploy (`scripts/prepare-iconoplasm-schema-transition-config.mjs`) keeps the
same asset bytes and routes only the Worker's own paths into the Worker, so
gene pages, robots, sitemap and llms.txt stay identical during a maintenance
window.

The bundle counts toward Cloudflare's 20,000-file limit per Worker version. A
real build on 2026-10-03 produced 19,535 files (19,023 gene documents, 478
under `static/` and 34 others, 68 MiB), 465 under the limit, and the build
refuses a bundle above 20,000. (The 404 page and the two route documents add
three files to that count.) Anything that adds a file per gene or per range
must show its count against that headroom first. Tests are not assets: the
Quartz `Static` emitter (`quartz/plugins/emitters/static.ts`) leaves every
`*.test.*` and `*.spec.*` file under `quartz/static` out of `public/static`,
which both this bundle and the main site are copied from, and the bundle build
refuses one that gets through. The same holds for old extension packages: the
site publishes the one package `extension-release.json` names, and the bundle
build refuses a missing one and any other (see
`docs/ICONOPLASM_RELEASE_INTEGRITY.md`).

## Drawing blots

Cloudflare does not render blots. The "Draw Iconoplasm blots" GitHub workflow
(`.github/workflows/draw-iconoplasm-blots.yml`) runs
`scripts/draw-iconoplasm-blots.mjs` after every successful "Publish Iconoplasm
catalog" run, and on demand. The script reads `catalog/v3/index.json`, computes
each gene's blot key from the catalogue's symbol, full name and current
portrait, lists the `blots/v2/<initial>/` folders in Bunny storage (27 listing
calls for the whole catalogue), and paints only the keys that are missing. It
paints in the runner's Chrome with the shared blot painter, checks every WebP is
768x1024, and uploads it with a SHA-256 checksum that Bunny verifies. A failed
gene stays missing and the next run draws it; there is no queue, ledger, D1 row
or admin route. A run costs no D1 rows and no Worker requests.

A portrait or full-name change produces a new fingerprint and so a new key;
unrelated essence changes do not. Changing the painter's output means changing
`ICONOPLASM_BLOT_RENDERER_REVISION`, and the next run redraws every gene
(about 19,400 blots, 2.6 GB; the first full run on 2026-10-19 drew about
250 a minute on a GitHub runner, so about 80 minutes). GET and HEAD routes never render, enroll, repair or enqueue
work.

`e2e/draw-blots.e2e.mjs` runs the script on real genes and compares its blots
with Chrome's own screenshot of the card.

## Requested high-resolution print copies

The print copy is painted in the reader's own browser when they press the
printer button beside the star in the gene toolbar. The browser takes the card and
portrait the page already holds (read from the gene's stable object
`genes/v3/<SYMBOL>.json`), copies the portrait's pixels 1:1 and bakes the card's
name, symbol and shading into them, then shows the PNG in the site's image viewer.
The viewer's Download button saves it named for the gene, for example
`SOX12-iconoplasm-print-copy.png`, and "Save image as" works on the picture. No
server renders, queues, stores or serves it, so a click costs the site no Worker
request, D1 row or Bunny object, and a viral page cannot spend a meter on it.
The print copy never selects the current D1 authoring portrait, even during the
expected D1-to-artifact publication window: it paints the published portrait.

The print copy is the same blot painted at the portrait's full resolution as a
PNG; it is not the canonical search image. Sitemap, semantic blot, and
gene-page GET/HEAD paths are immutable published reads: no vote query, D1 repair
or render is allowed. Crawling therefore cannot manufacture the 19,023-image
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
