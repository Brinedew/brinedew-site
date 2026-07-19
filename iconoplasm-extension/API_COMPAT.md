# Iconoplasm extension contract

`publisher-release.json` is the authority for the version browsers can actually
run. The published extension is 0.4.7 and receives catalog schema 4 from
`GET /api/public/v1/catalog/manifest`. Its artifact contains concrete aliases
and the `pt`/`ph` portrait paths it understands.

`candidate-contract.json` describes the unreleased source contract. The current
candidate uses catalog schema 5, `PortraitAssetRefV1` in each gene's optional
`p` field, `PortraitDeliveryPolicyV1`, and the publication alias dictionary.

Ordinary development may change the candidate contract but must not change the
extension version. The human-gated workstation publisher advances the manifest
and publisher authority together when it creates a store release. Packaging and
store workflows reject any version that differs from that authority.

Publication alias dictionary edits are projected into both contracts and do not
require a store update. Protocol, permission, or packaged runtime changes do.

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
