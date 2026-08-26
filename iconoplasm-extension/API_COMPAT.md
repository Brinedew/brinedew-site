# Iconoplasm extension contract

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

The manifest may also expose `card_snapshot_version`. It is an immutable
publication boundary, not a new catalog schema: extensions that understand it
invalidate their bounded persistent hover-detail and portrait-locator caches
when it changes, while older extensions safely ignore it. Current extensions
read rich detail through
`GET /api/public/v1/card-snapshots/:snapshot/genes/:symbol` and the compact
portrait locator through
`GET /api/public/v1/card-snapshots/:snapshot/portraits/:symbol`. Both URLs name
the same card snapshot and are immutable, so the browser and CDN can reuse them
without re-running a body-keyed Worker POST. The locator is projected directly
from that card payload; it is not a second image index, publication, or
authority. Neither endpoint falls back to mutable D1 state. The compatibility
`POST /api/public/v1/genes/batch` projection remains available to the one
supported predecessor and echoes `snapshot_version`; transient failures are
never durable negative-cache entries. Only the current and immediately
previous publication barriers are addressable, matching the documented
one-release compatibility window; retired or invented snapshot versions fail
closed without becoming immutable negative cache entries.

The scanner index remains stale-while-revalidate so highlights never wait on
the network, and healthy tabs make no extra manifest request. A retired detail
or locator URL returns `410` with `code: "card_snapshot_retired"`. That explicit
signal starts one deduplicated, cache-busted read of the existing small manifest.
The changed `card_snapshot_version` aborts retired detail/locator requests,
clears both revision-keyed caches, and retries the currently visible hover
without requiring a reload. An unchanged scanner artifact is not downloaded.

Foreground detail and locator reads have independent four-second deadlines and propagate cancellation
from the current hover through the content bridge to the service-worker fetch.
One tab-scoped reading session receives recognized anchors from both HTML and PDF.
Catalog initialization, including a cold scanner-artifact fetch, begins only after
the host `load` event. Recognition scans then replace text cooperatively in bounded idle slices. The session
inventories anchors immediately, but speculative immutable detail, portrait
resolution, decode, and persistent-frame acknowledgement wait for host `load`, a
one-second quiet delay, and a genuine idle turn. Ordinary documents prepare the
first ten unique symbols with one worker on constrained devices and two workers
otherwise; large documents add deterministic ten-symbol near-viewport windows.
Data Saver and 2G disable preparation. A foreground hover bypasses the host-page
gate, reuses matching in-flight work, and is otherwise a
recovery path, not the normal loading trigger. Portrait delivery may complete
from the locator lane while rich detail remains stalled; if both projections
arrive with different portrait SHAs, the portrait and vote controls fail closed.
Packaged card fonts begin loading
during initialization, including inside the persistent rich-card frame.
Portraits normally load as native HTTPS image sources with a 350 ms canonical
hedge behind Bunny; service-worker-
buffered data URLs exist only for page-CSP compatibility.

The persistent detail cache is capped at 512 records and 4 MiB. The locator
cache is separately capped at 1,024 records and 768 KiB, but uses the same card
snapshot invalidation boundary. Extension
updates compact legacy portrait-heavy scanner storage before returning data to
a tab. Chromium therefore stays below its default 10 MiB `storage.local` quota
without requesting `unlimitedStorage`.

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
