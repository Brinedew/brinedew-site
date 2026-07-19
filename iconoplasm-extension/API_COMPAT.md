# Iconoplasm extension contract

`publisher-release.json` is the complete, inspectable authority for browser
releases. `version` and `catalog_contract` identify the newest human-authorized
package. `minimum_supported_version` and `compatibility_contracts` define the
only older package the API must still serve. The published extension is 0.4.7
and receives catalog schema 4 from `GET /api/public/v1/catalog/manifest`. Its
artifact contains concrete aliases and the `pt`/`ph` portrait paths it
understands.

`candidate-contract.json` describes the unreleased source contract. The current
candidate uses catalog schema 5, `PortraitAssetRefV1` in each gene's optional
`p` field, `PortraitDeliveryPolicyV1`, and the publication alias dictionary.

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

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
