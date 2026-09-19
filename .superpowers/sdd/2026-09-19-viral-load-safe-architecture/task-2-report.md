# Task 2 report: zero-state anonymous read plane

Date: 2026-09-19 ICT

## Outcome

Implemented the anonymous Website read-plane cutover without adding a second
publisher or state owner. The Iconoplasm shell is now a Cloudflare Static Assets
SPA; gene detail, public catalog search, classic gallery browsing, passive vote
display, portraits, and blots resolve from the existing Sysop V2 publication and
content-addressed Bunny objects. Explicit account-scoped search, mutations, and
administrator routes remain in the single stateful Worker.

The current-head lookup is Bunny-only in the browser. It never starts a
canonical-origin hedge, and it retains the previously accepted coherent head
when Bunny fails. Immutable-object and media failure never falls through to D1,
a Durable Object, Queue, session, browser binding, or an internal service;
media uses the bundled static placeholder.

## RED evidence

The first tests failed against the reviewed starting point because:

1. `app.js` still called the stateful `/api/iconoplasm/site/genes/*` detail route.
2. Wrangler still used `not_found_handling = "none"` and sent `/gene/*` through
   `run_worker_first`.
3. The Static Assets CSP did not permit Bunny JSON reads.

Review then found and captured two additional falsifiers before acceptance:

1. A successful Bunny response still allowed the delayed canonical hedge to
   fire. The new test observed four unwanted origin requests.
2. Flattening every catalog-page reference into the root manifest made the root
   grow with the corpus. The new test observed `catalog_pages` in the root when
   the contract required a bounded per-shard catalog-index reference.

Both tests were red before implementation and green afterward.

## Implementation

- Added `quartz/static/iconoplasm/publication-reader.js`, which validates exact
  SHA-256 identities for Sysop V2 manifests, delivery indexes, delta chains,
  gene records, compact catalog indexes, and catalog pages. It derives portrait
  rendition URLs from the published asset identity and admits only Bunny blot
  byte URLs or the bundled placeholder.
- Routed anonymous gene detail, catalog search, classic gallery, metadata, and
  passive aggregate display through that immutable reader. Account discovery
  and shared search scopes remain explicit authenticated stateful interactions.
- Extended the one existing publisher to create at-most-128-entry catalog pages
  with search/gallery fields, portrait/blot identity, candidate summaries, and
  shared vote totals. Each publication shard names one content-addressed catalog
  index; the root does not repeat every page reference.
- Changed Static Assets to SPA fallback and removed gene, gallery/archive,
  portrait, blot, sitemap, crawler, and immutable-object paths from
  `run_worker_first`. `/api/*`, `/admin*`, and the existing mutation/control
  paths remain Worker-first.
- Emitted static `robots.txt`, `sitemap.xml`, `llms.txt`, media fallback
  redirects, and the bundled blot placeholder. Updated the CSP to permit Bunny.
- Added a reusable throwing-state-bindings harness. The request matrix covers
  homepage, dossier shell, archive/gallery shell, robots, sitemap, llms,
  portrait failure, and blot failure. Browser-reader tests cover public search,
  gallery ordering, immutable gene reads, passive vote totals/candidates,
  content validation, prior-head failure behavior, and the no-origin healthy
  path.
- Updated IPD-007, IPD-008, IPD-009, and IPD-011 registry text, markers,
  enforcement tests, request lifecycle, publication documentation, capacity
  runbook, and topology assertions together.

## Verification

- Focused plus affected integration suite: **198 tests passed, 0 failed**.
  This includes reader, publisher, route topology, architecture fences, app
  performance contracts, SEO/crawler behavior, public media, reader-view
  publication, real-workerd publication runtime, import versioning, and Worker
  routing tests.
- `git diff --check`: passed.
- `node --check` for the new reader and changed app/publisher/asset scripts:
  passed.
- Repository changed-file formatting: passed after applying the repository
  formatter.

## Verification limitations

- The initial worktree had an incomplete ignored `.quartz/plugins` tree. The
  production build boundary became runnable after restoring the missing local
  plugin build; the final build result is recorded in Review remediation.
- This task does not claim deployment, CDN propagation, or authenticated
  Playwright production acceptance. Those remain separate release gates.

## Files owned by this task

The commit includes the immutable browser reader, publisher catalog projection,
static topology/asset generation, throwing-bindings tests, affected integration
test updates, and the IPD fence/runbook changes listed above. It does not change
`D:\Coding\Iconoplasm`.

## Review remediation

The first Task 2 review rejected the implementation. The review was right: the
browser still had three ways to recreate stateful public demand, the head
fallback could fan every slow reader into the canonical Worker, and the
original topology test modeled the desired router instead of executing it.

Focused RED evidence captured all eight findings before the fixes:

1. Importing `portrait-delivery.js` performed one anonymous
   `/api/public/v1/metadata` request.
2. Diagram search did not expose an immutable-reader seam and still called the
   public Worker API.
3. A slow or failed Bunny head started canonical-origin requests from the
   browser.
4. A valid new head with a missing immutable child replaced the stored
   last-good head.
5. Search and gallery fetched every rich catalog page instead of compact
   lookup data plus selected result pages.
6. The original throwing-bindings request helper did not execute Cloudflare's
   asset router.
7. The then-current build-revision-2 manifest had no compact catalog index, so
   direct routing activation would have broken search and gallery.
8. Blot delivery accepted a Bunny URL without binding it to the exact published
   object key and fingerprint.

The corrected implementation removes the anonymous metadata startup refresh,
routes diagram search through the same immutable reader, and makes the browser
head path Bunny-only. The reader writes a new head to local storage only after
the operation's manifest and required child objects validate; otherwise it
serves the coherent prior publication or a static placeholder. It never starts
a canonical-origin hedge.

The publisher now writes one schema-2 compact catalog index per publication
shard under a dedicated content-addressed `catalogindexes` namespace capped at
128 KiB. Search and gallery load at most 32 compact indexes and then only the
selected rich pages. The executable browser ceilings are 46 requests and
10,553,344 bytes for a 12-result search, and 58 requests and 16,844,800 bytes
for a 24-item gallery page. Those are deliberately pessimistic byte ceilings;
actual content-addressed objects are normally much smaller. A manifest with
more than 32 indexes fails closed instead of silently expanding per-browser
fanout.

Activation is now two-phase. The preparation deployment uses
`run_worker_first = true`, so uploading the new bundle cannot activate it for
anonymous readers. It starts the explicit build-revision-3 publication
migration while preserving the old head. The activation gate then reads the
Bunny head, hashes its manifest, and hashes every advertised compact index. It
retries for at most four minutes to allow CDN propagation. Only a successful
gate permits the canonical SPA/static routing deployment. Current
build-revision-2 manifests fail this gate without falling back to stateful
reconstruction.

The new Miniflare/Workerd test prepares the real Iconoplasm static bundle from
the actual modules and uses the production `assets` configuration. Homepage,
search, gallery, dossier, portrait, blot, sitemap, robots, `llms.txt`, and an
immutable-object path all bypass a Worker that returns status 599; `/api/*`
still reaches that Worker. Separate executable module tests import the real
portrait and diagram modules so unconditional startup calls fail directly.

The review-fix verification boundary is **113 tests passed, 0 failed** in
16.60 seconds. It includes the real Workerd route matrix, module startup,
reader coherence and failure behavior, passive vote display, exact blot
identity, compact-index publication and migration, route contracts,
architecture fences, published-object storage, and affected gene request
tests. The final `pnpm run build` completed 214 source files and emitted 3,174
files in 12 seconds, followed by a 2,606-file, 52,369,661-byte Iconoplasm edge
bundle. The first
build attempt exposed an incomplete ignored community-plugin installation; I
rebuilt that worktree-local plugin and reran the production build successfully.

Deployment, CDN propagation, and live browser acceptance remain separate gates;
this review-fix commit does not claim them.

## Review remediation, round 2

The second review found that the last-good publication cache was still global,
the four-minute artifact poll could not outwait a 19,023-card migration, and the
preparation deployment could leave production on a newly uploaded
`run_worker_first = true` topology after a failed Bunny gate. Focused tests were
red for all three findings before the corrections.

The browser now retains an independently validated last-good head for gene,
search, gallery, and metadata dependency sets. A successful search against a
partially propagated new publication therefore cannot erase the older coherent
gene fallback. The added regression proves the requested sequence: new search
succeeds, the new gene child is missing, and the older gene still serves.

The migration deadline is derived from the publisher's executable constants and
the measured live manifest shape. For 19,023 cards, six cards per alarm, a
one-second rearm, 26 shard seals, two control alarms, and two 30-second CDN
windows produce 3,259,000 ms and 327 ten-second verification attempts. The
workflow's 68-minute outer deadline additionally includes both five-minute
bounded Wrangler deployments and the 30-second migration request; it is no
longer an invented four-minute constant.

Cloudflare's current platform contract ruled out the initially considered
route-less Preview URL: Workers that implement Durable Objects do not receive
Preview URLs. The final preparation path instead uses the provider's
`keep_assets` upload metadata. It deploys the new publisher/runtime code into
the existing single owner while retaining the exact asset bytes currently
active in production and the exact pre-cutover asset-routing list. It neither
uploads the new SPA bundle nor broadens routing to `run_worker_first = true`.
The existing publication Durable Object performs the migration. Only after the
Bunny head, manifest, and every advertised compact index validate does the
canonical deployment attach the new SPA assets and static-first routing. A
failed gate leaves the active frontend and route topology unchanged.

The schema-transition staging configuration uses the same retained-assets
contract, so the earlier migration-admission deploy cannot accidentally expose
the not-yet-activated frontend. A real Miniflare/Workerd test executes the exact
pre-cutover `not_found_handling` and route list, while a workflow-unit test
proves a failed Bunny gate never calls final activation. Wrangler 4.123.0 also
accepted the generated production config in a real dry run and printed
`keep_assets: true` with the exact retained route policy.

Round-2 verification completed with **97 affected tests passed, 0 failed** in
17.07 seconds. The focused topology/coherence suite passed **26/26** in 10.47
seconds. `pnpm run build` completed 214 source files and emitted 3,174 files in
10 seconds, followed by a 2,606-file, 52,371,031-byte Iconoplasm edge bundle.
`git diff --check` passed; changed-file formatting was applied and rechecked.
No production deployment, CDN propagation, or live browser claim is made by
this source commit.
