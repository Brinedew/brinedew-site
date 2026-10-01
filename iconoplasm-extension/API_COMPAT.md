# Iconoplasm extension contract

## Hover detail: one stable object per gene (B-898 stage 1, extension 0.5.9)

The hover card reads one stable, mutable object per gene from the free CDN:
`https://iconoplasmportraits.b-cdn.net/genes/v3/<SYMBOL>.json`. The object
carries `stable_object_version: 3`, the gene's `symbol`, `full_name`,
`color`, `essence`, trait origins, and the published `portrait` (or
`null`) with its `asset_sha256` and immutable `/portraits/v1/` URLs. The
Website purges that exact CDN URL on every rewrite, so reading it costs zero
metered Worker requests. The service worker validates the object the same way
the website's reader does (version 3, same symbol, a `portrait_candidates`
array, a `portrait` key), caches it in memory for five minutes (errors for
thirty seconds), and answers one `ICONOPLASM_STABLE_GENE` message per
symbol. A CDN `404` or a malformed object means "no card for this gene", not
an error, and is cached for the same TTL so repeated hovers never become a
retry storm. The request carries no cookies and no client-version header, so
every reader shares one CDN cache entry per gene.

Extension 0.5.9 retired the immutable card tree reader: the
`card-snapshots/:snapshot/{genes|portraits}/:symbol` routes, the
`delivery-index` and `card-content/v1` shard resolution, the `card-current`
head poll, the per-article `ccv2-` epoch selection, the separate
portrait-locator lane, and the 32 MiB IndexedDB of exact card responses. Those
Worker routes remain the website's own fallback and the compatibility surface
for 0.5.8; the extension never references them again. The first 0.5.9 startup
removes the retired storage keys and deletes the old card-response database.

`publisher-release.json` is the complete, inspectable authority for browser
releases. `version` and `catalog_contract` identify the newest human-authorized
package. `minimum_supported_version` and `compatibility_contracts` define the
only older package the API must still serve. The current package and compatibility
floor are the values declared in that file; both receive catalog schema 5 from
`GET /api/public/v1/catalog/manifest`.

`candidate-contract.json` describes the unreleased source contract. The current
candidate uses full catalog schema 5 plus scanner schema 1. The full catalog
retains each gene's optional `PortraitAssetRefV1` `p` field. The separately
published scanner artifact contains only symbol, name, UniProt, color, and
aliases; it is capped at 3 MiB and is the only whole-catalog payload sent to
arbitrary tabs. `PortraitDeliveryPolicyV1` and the publication alias dictionary
remain in the manifest.

Ordinary development may change the candidate contract but must not change the
extension version. The human-gated workstation publisher advances the manifest
and publisher authority together when it creates a store release. Packaging and
store workflows reject any version that differs from that authority.

Each new store release starts a one-release compatibility window: the prior
human-authorized version becomes `minimum_supported_version`, and its contract
is the sole entry in `compatibility_contracts`. Store review can therefore run
asynchronously without cutting off installed users. The next human release
replaces that entry with its own predecessor, so retired releases do not remain
documented or supported indefinitely.

The Worker serves exactly one catalog contract; there is no second, per-version
catalog artifact. (An earlier design projected one, but nothing in production
ever published it, so an activated window would have answered 503. It was
removed on 2026-09-26, B-869.) The window therefore holds only while the older
release reads the served contract: a catalog change during store review must be
readable by the previous package. `iconoplasm-extension.publisher-authority.test.js`
fails CI when a supported older release declares a different catalog contract.

Publication alias dictionary edits are administrator-owned desired state and are
projected into both contracts through the existing `publication_aliases`
manifest object. They do not rebuild the catalog/scanner or require a store
update. The Website retains only bounded revision history and serves immutable
KV projections; the source dictionary is first-deploy bootstrap only. Protocol,
permission, packaged-runtime, or `publication_aliases` schema changes still
require a human-authorized store release.

The catalog manifest may expose an `extension_blocklist` object with schema,
revision, and the complete authoritative shared text-term list. A protocol-aware
extension stores only valid monotonic projections, keeps the last-known-good
projection across missing or malformed refreshes, and treats a valid empty list
as intentional. The packaged list is a first-run/offline fallback only; user
removed-default tombstones and custom terms remain local. The enabling runtime
change requires one human-authorized store release. Later term revisions do not
change the catalog/scanner contract, download a scanner artifact, or require a
new store release; older extensions safely ignore the optional field.

Alias and blocklist policy-only revisions are cross-validated and dependency-
ordered by the Website. This changes neither public object: the dependency
revisions remain server-side publication metadata, while installed clients keep
receiving the same independent `publication_aliases` and `extension_blocklist`
payloads in one manifest response.

The manifest may still expose `card_snapshot_version`. Extension 0.5.9 and
later ignore it: hover detail has no epoch because the stable gene object is
rewritten in place. The supported predecessor, 0.5.8, still selects
exact-snapshot hover-detail and portrait-locator records through
`GET /api/public/v1/card-snapshots/:snapshot/{genes|portraits}/:symbol`, so
those routes and the `card_snapshot_version` field stay served until that
compatibility window closes.

The scanner index remains stale-while-revalidate so highlights never wait on
the network, and healthy tabs make no extra manifest request. The manifest is
read from the Bunny copy first and from the canonical origin only when the CDN
copy is unusable; neither read carries a client-version header.

A foreground hover shares one in-flight stable-object request per symbol with
speculative preparation; cancelling the hover releases the page's wait without
discarding the shared result. Vote and discovery requests still propagate
cancellation from the content bridge to the service-worker fetch.
One tab-scoped reading session receives recognized anchors from both HTML and PDF.
Catalog initialization, including a cold scanner-artifact fetch, begins only after
the host `load` event. Recognition scans then replace text cooperatively in bounded idle slices. The session
inventories anchors immediately, but speculative immutable detail, portrait
resolution, decode, and persistent-frame acknowledgement wait for host `load`, a
genuine idle turn, without an extra one-second delay. Ordinary documents prepare the
first ten unique symbols with ten independent tasks (two on low-memory devices).
Responses are per gene, never a combined binary batch. A slow card cannot hold
the other nine behind its complete metadata/image pipeline.
Near-viewport work advances in deterministic ten-symbol selections. Completion
refills the selection without requiring another scroll. These selections do not
evict previously prepared images. Automatic refills attempt each visible symbol
once; only a real viewport/inventory event may restore an evicted image or retry
a failed preparation after backoff. This prevents cache churn and timer polling.
Data Saver and 2G disable preparation. A foreground hover bypasses the host-page
gate, reuses matching in-flight work, and is otherwise a
recovery path, not the normal loading trigger. The portrait and the vote
controls come from the same stable object as the card text, so there is no
second projection that could disagree with it.
Packaged card fonts begin loading
during initialization, including inside the persistent rich-card frame.
The background runtime retains exact immutable portrait bytes across websites.
Only a cache miss invokes the shared Bunny-first source plan and its 350 ms
canonical hedge. The displaying frame (or simple host layout) decodes the
returned data URL; it never downloads the same HTTPS image a second time.

The background owns one IndexedDB store for immutable portraits (64 MiB
total, 512 KiB per image, 8,192-entry safety ceiling) with transactional byte
accounting and LRU eviction; reads update small recency records without
rewriting image bytes. Stable gene objects live only in a bounded in-memory
cache (512 entries, five-minute TTL) in the service worker plus a page-local
copy of the same size; the browser HTTP cache is their persistent layer. Pages
never clone or rewrite a saved collection. Extension updates compact legacy
portrait-heavy scanner storage and delete the retired card-response database.
No `unlimitedStorage` permission is required; the scanner/settings remain
within `storage.local`, while the bounded image store uses IndexedDB.

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
