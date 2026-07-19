# Iconoplasm extension contract

The current extension release is 0.6.0. It consumes:

- `GET /api/public/v1/catalog/manifest`
- catalog artifact schema 5
- `PortraitAssetRefV1` in each gene's optional `p` field
- `PortraitDeliveryPolicyV1` in `portrait_delivery`
- publication alias overlay schema 1
- symbol-first gene routes at `/gene/<SYMBOL>`

The manifest's `min_extension_version` is authoritative. The extension clears
an incompatible cached catalog and reports a contract error instead of serving
stale data.

Catalog entries use `s` as the canonical symbol, with optional `c`, `n`, `u`,
`a`, `tmh`, and `p` fields. The `p` object is inspectable and contains the asset
SHA plus first-party canonical URLs for full, medium, and thumb renditions.

Publication alias dictionary edits ship with the website manifest and do not
require an extension package update. Protocol, permission, or runtime changes
require a new extension release.

For portrait architecture and operations, read
`../docs/ICONOPLASM_PORTRAIT_DELIVERY_RUNBOOK.md`.
