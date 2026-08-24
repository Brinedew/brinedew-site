# Iconoplasm request lifecycle

<!-- ARCHITECTURE FENCE [IPD-009] -->

This document is the operational contract for anonymous and authenticated
Iconoplasm requests. It is intentionally explicit so an unfamiliar agent does
not mistake a warm browser for a different authorization path.

## Canonical gene document

For an exact published symbol, the cold path is bounded and ordered:

1. Normalize the path symbol.
2. Read the exact symbol from `icono_published_gene_routes`, the tiny indexed
   D1 read model advanced only after the public card-catalog barrier succeeds.
   This identity-only table has no portrait, ranking, or vote fields.
3. Build the canonical route record without KV reads or hydration of the full
   19,023-gene catalog.
4. Build the internal JSON detail response from bounded rich D1 reads plus the
   one-symbol card shard selected by `KV_GALLERY_VERSION`. D1 supplies live
   facts/candidates; the card payload overrides the canonical portrait and
   candidate `is_current` identity. Derive the HTML snapshot key from the
   complete response ETag, which includes the card version.
5. Check the HTML cache before parsing JSON or rendering the shell.
6. Return the cached shell immediately on a hit. On a miss, parse and render
   using the same already-fetched detail response, then store the result.

Aliases and UniProt identifiers intentionally retain the immutable catalog
resolver until their route-record publication contract is separately migrated.
Unknown symbols remain real 404s; incomplete cards remain noindex/503. Do not
turn a failed read into a publication or repair operation.

After a successful card-catalog version flip, publication synchronizes route
membership only for canonical-affecting event symbols in the watermark window.
The operation is idempotent. It never copies mutable canon into the route table
and never publishes KV per vote. A newly projected vote can change rich candidate
state and therefore the detail ETag, but it cannot move the public portrait before
publication. The next successful 15-minute publication tick rewrites only the
dirty content-addressed shard and atomically flips the browse manifest, page
portrait, media projection, and discovery documents together. A
scattered delta may require multiple six-shard preparation ticks, but the old
manifest remains coherent until the one final flip; it never falls back to a
complete-catalog rebuild. See architecture fence IPD-010.

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
`the-only-allowed-...-do-not-duplicate` shape. Responsibility segments may make
an extracted internal module more specific, but responsibility-only names must
not replace the protective prefix/suffix, create a second runtime, or introduce
`iconoplasm-web`.
