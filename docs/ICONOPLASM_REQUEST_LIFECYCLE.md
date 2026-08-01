# Iconoplasm request lifecycle

<!-- ARCHITECTURE FENCE [IPD-009] -->

This document is the operational contract for anonymous and authenticated
Iconoplasm requests. It is intentionally explicit so an unfamiliar agent does
not mistake a warm browser for a different authorization path.

## Canonical gene document

For an exact published symbol, the cold path is bounded and ordered:

1. Normalize the path symbol.
2. Read `KV_GALLERY_VERSION` and the matching published card-catalog shard.
   The published KV barrier is authoritative; D1 rows cannot make a card
   public before publication.
3. Build the canonical route record and current page snapshot version without
   hydrating the full 19,023-gene catalog.
4. Fetch the internal JSON detail response only far enough to derive its ETag
   snapshot version.
5. Check the HTML cache before parsing JSON or rendering the shell.
6. Return the cached shell immediately on a hit. On a miss, parse and render
   using the same already-fetched detail response, then store the result.

Aliases and UniProt identifiers intentionally retain the immutable catalog
resolver until their route-record publication contract is separately migrated.
Unknown symbols remain real 404s; incomplete cards remain noindex/503. Do not
turn a failed read into a publication or repair operation.

## Warm versus authenticated

Public gene facts are the same for anonymous and authenticated users. The gene
HTML bootstrap sends an internal request with `Accept: application/json`; it
does not forward the browser session cookie. Login can enable private action
islands, but it does not select a privileged gene renderer.

Firefox/Edge can appear “fixed” after login because an already-open SPA, browser
cache/BFCache, a prior API call, or a warm Cloudflare isolate has paid the
initialization cost. A fresh hard navigation or crawler can still exercise the
cold path. Test with cache-busting URLs and no prerequisite API request.

## CPU and cache invariants

The Free-plan CPU budget is a hard constraint. Cache lookup must precede full
detail parsing and HTML rendering. A cache hit must not load the full catalog,
parse the complete detail JSON, or render before returning. The current
regression test is `workers/iconoplasm-gene-cold-path.test.js`.

## Boundary and naming invariants

`IPD-007` remains in force: static assets first, one dynamic invocation, and
the existing stateful Worker as the direct owner. `IPD-009` adds the cold-path
and naming guard. The protected entrypoint/config filenames retain their exact
`the-only-allowed-...-do-not-duplicate` shape. Responsibility names are only
for extracted modules below the boundary; they do not replace the loud names,
create a second runtime, or introduce `iconoplasm-web`.
