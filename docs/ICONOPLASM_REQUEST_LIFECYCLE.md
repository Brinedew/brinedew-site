# Iconoplasm request lifecycle

<!-- ARCHITECTURE FENCE [IPD-009] -->

This document is the operational contract for anonymous and authenticated
Iconoplasm requests. It is intentionally explicit so an unfamiliar agent does
not mistake a warm browser for a different authorization path.

## Canonical gene document

For an exact published symbol, the anonymous cold path is bounded and ordered:

1. Cloudflare Static Assets serves the one SPA application shell for `/gene/*`
   without executing the Worker. No per-gene static HTML files exist.
2. The browser asks Bunny for the shared current-head projection. A Bunny miss
   may fill from the existing KV projection route, which never queries the
   coordinator or D1. The browser stores the last coherent head.
3. The browser validates the content hash of the exact immutable Sysop V2 root
   manifest, one at-most-128-gene directory, and the requested gene object.
4. If the advertised reader view names the symbol, the browser validates its
   immutable delta chain and exact committed gene receipt. A withdrawal stays
   missing; an unreadable dependency never falls back to a different version.
5. Portrait bytes use the content-addressed Bunny rendition. Blot bytes use the
   exact published Bunny URL. A failed CDN path renders a static placeholder;
   it never enters a Worker, D1, Queue, Durable Object, or Browser binding.

Search and gallery load compact content-addressed catalog indexes named by the
same root manifest's shards, then their at-most-128-entry pages. Those pages
carry public ordering/search fields, passive candidate summaries, and shared
vote totals. Unknown symbols remain missing; failed reads retain the coherent
previous publication or show a static failure surface. A reader never publishes
or repairs state.

After a successful card-catalog version flip, publication synchronizes route
membership only for canonical-affecting event symbols in the watermark window.
The operation is idempotent. It never copies mutable canon into the route table
and never publishes KV per vote. A newly projected vote can change rich candidate
state and therefore the detail ETag.

A canonical-affecting command on an activated gene publishes that gene's exact
selected card through the advertised per-gene view (the base epoch plus its
exact immutable delta chain), without waiting for a global publication tick. The
website detail resolves, for a symbol the advertised view names, the exact
committed card in that view; untouched symbols keep resolving from the base
artifact selected by `KV_GALLERY_VERSION`. The base catalog epoch is no longer
the portrait mechanism for routine changes. A symbol the advertised view names
whose immutable dependency is unreadable fails closed with an uncached 503 and
never falls back to base content the view retired. No legacy projection queue,
global finalization barrier, or complete-catalog rebuild participates in this
path. See architecture fences IPD-009 and IPD-010.

## Warm versus authenticated

Public gene facts are the same for anonymous and authenticated users. Login can
enable private action islands after explicit intent, but it does not select a
privileged gene renderer or make passive reading load a session.

Firefox/Edge can appear “fixed” after login because an already-open SPA, browser
cache/BFCache, a prior API call, or a warm Cloudflare isolate has paid the
initialization cost. A fresh hard navigation or crawler can still exercise the
cold path. Test with cache-busting URLs and no prerequisite API request.

## CPU and cache invariants

Reader count must not multiply Worker CPU or state reads. Immutable object
validation is browser-side and content-addressed. Catalog pages contain at most
128 entries; a dossier reads one directory and one gene object. The current
head is shared-cached for 30 seconds, and an older coherent head is preferable
to stateful reconstruction.

## Boundary and naming invariants

`IPD-007` remains in force: anonymous documents and public immutable artifacts
bypass Worker execution; explicit mutation and administrator API paths enter the
existing stateful Worker once. `IPD-009` adds the zero-state reader guard. The
protected entrypoint/config filenames retain their exact
`the-only-allowed-...-do-not-duplicate` shape. Responsibility segments may make
an extracted internal module more specific, but responsibility-only names must
not replace the protective prefix/suffix, create a second runtime, or introduce
`iconoplasm-web`.
