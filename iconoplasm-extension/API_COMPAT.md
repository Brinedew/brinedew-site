# Iconoplasm extension contract

`publisher-release.json` is the complete, inspectable authority for browser
releases. `version` and `catalog_contract` identify the newest human-authorized
package. `minimum_supported_version` and `compatibility_contracts` define the
only older package the API must still serve. The current human-authorized
package is 0.4.12 and the compatibility floor is 0.4.11. Both receive catalog
schema 5 from `GET /api/public/v1/catalog/manifest`.

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

Publication alias dictionary edits are projected into both contracts and do not
require a store update. Protocol, permission, or packaged runtime changes do.

The catalog manifest may expose an `extension_blocklist` object with schema,
revision, and the complete authoritative shared text-term list. A protocol-aware
extension stores only valid monotonic projections, keeps the last-known-good
projection across missing or malformed refreshes, and treats a valid empty list
as intentional. The packaged list is a first-run/offline fallback only; user
removed-default tombstones and custom terms remain local. The enabling runtime
change requires one human-authorized store release. Later term revisions do not
change the catalog/scanner contract, download a scanner artifact, or require a
new store release; older extensions safely ignore the optional field.

The manifest may also expose `card_snapshot_version`. It is an immutable
publication boundary, not a new catalog schema: extensions that understand it
invalidate their bounded persistent hover-detail cache when it changes, while
older extensions safely ignore it. `POST /api/public/v1/genes/batch` projects
records from that published card snapshot and echoes `snapshot_version`;
transient failures are never durable negative-cache entries.

The persistent detail cache is capped at 512 records and 4 MiB. Extension
updates compact legacy portrait-heavy scanner storage before returning data to
a tab. Chromium therefore stays below its default 10 MiB `storage.local` quota
without requesting `unlimitedStorage`.

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
