# Task 2 report: zero-state anonymous read plane

Date: 2026-09-19 ICT

## Outcome

Implemented the anonymous Website read-plane cutover without adding a second
publisher or state owner. The Iconoplasm shell is now a Cloudflare Static Assets
SPA; gene detail, public catalog search, classic gallery browsing, passive vote
display, portraits, and blots resolve from the existing Sysop V2 publication and
content-addressed Bunny objects. Explicit account-scoped search, mutations, and
administrator routes remain in the single stateful Worker.

The current-head lookup keeps Bunny primary and a bounded canonical hedge. A
healthy Bunny response cancels the hedge, so it cannot silently create one
Worker/KV projection read per reader. If both sources fail, the reader retains
the previously accepted coherent head. Immutable-object and media failure never
falls through to D1, a Durable Object, Queue, session, browser binding, or an
internal service; media uses the bundled static placeholder.

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

- `pnpm run check` reaches TypeScript before failing on the worktree's incomplete
  generated `.quartz/plugins` tree: 28 existing plugin modules are absent, all
  reported as TS2307 imports from `.quartz/plugins/index.ts`. None is a Task 2
  file.
- `pnpm run build` completed the shared-source sync and entered Quartz, but the
  repository build exceeded the 240-second hard deadline without producing an
  error. Because Quartz did not finish, the standalone edge-asset preparation
  correctly failed on the absent generated `public/apps/iconoplasm/index.html`.
- This task does not claim deployment, CDN propagation, or authenticated
  Playwright production acceptance. Those remain separate release gates.

## Files owned by this task

The commit includes the immutable browser reader, publisher catalog projection,
static topology/asset generation, throwing-bindings tests, affected integration
test updates, and the IPD fence/runbook changes listed above. It does not change
`D:\Coding\Iconoplasm`.
