# Iconoplasm portrait delivery — current system

Read this when portraits are missing from the Iconoplasm website, browser
extension, edit modal, request inbox, or server-generated message.

## Asset identity

A portrait is identified by `asset_sha256`. Every rendition is content-addressed
under `portraits/v1/<prefix>/<sha>/<rendition>.webp`.

Public APIs return `PortraitAssetRefV1`:

```json
{
  "schema_version": 1,
  "asset_sha256": "<64 lowercase hex characters>",
  "renditions": {
    "full": {
      "path": "portraits/v1/.../full.webp",
      "canonical_url": "https://iconoplasm.brinedew.bio/portraits/v1/.../full.webp"
    },
    "medium": {
      "path": "portraits/v1/.../medium.webp",
      "canonical_url": "https://iconoplasm.brinedew.bio/portraits/v1/.../medium.webp"
    },
    "thumb": {
      "path": "portraits/v1/.../thumb.webp",
      "canonical_url": "https://iconoplasm.brinedew.bio/portraits/v1/.../thumb.webp"
    }
  }
}
```

Domain payloads contain canonical first-party URLs only. A storage or CDN
provider hostname is not an asset identifier and must not be added to gene,
candidate, edit-job, or catalog payloads.

## Storage and serving

Portrait bytes live in Bunny Storage. The internal stateful Worker is the only
runtime with the authenticated Storage API credential. It performs idempotent
GET, HEAD, PUT, and DELETE operations with bounded timeout and transient retry.
Permanent 4xx responses fail immediately.

`https://iconoplasm.brinedew.bio/portraits/v1/...` reads authenticated storage
and writes successful immutable GET responses to Cloudflare's edge cache. The
portrait path is content-addressed, so query strings do not create separate
cache objects.

## Browser delivery policy

`GET /api/public/v1/metadata` and
`GET /api/public/v1/catalog/manifest` publish `PortraitDeliveryPolicyV1`:

```json
{
  "version": 1,
  "canonical_origin": "https://iconoplasm.brinedew.bio",
  "accelerator": {
    "id": "bunny",
    "origin": "https://iconoplasmportraits.b-cdn.net",
    "enabled": true
  },
  "probe_timeout_ms": 2500,
  "decision_scope": "tab"
}
```

The website and extension use the same state machine from
`shared/iconoplasm-portrait/portrait-delivery-core.js`. Its states are
`undecided`, `accelerator`, `canonical`, and `terminal_failure`.

- The first real portrait probe selects the accelerator or canonical origin for
  the tab.
- Simultaneous portraits share that one decision.
- Any later portrait, including a newly generated edit result, is resolved
  through the current tab decision before it is assigned.
- A selected source failure switches once to the other source.
- A late URL from a source already known to have failed is rebound to the
  selected source without changing global state.
- After both sources fail, the state is terminal and does not oscillate.

The website adapter owns explicit DOM image bindings. The extension adapter
owns tab-scoped persistence and conversion to data URLs. Neither adapter owns
source-selection rules.

## Release contract

- Public API schema: 4
- Catalog artifact schema: 5
- Minimum extension version: 0.6.0
- Extension catalog portrait field: `p` (`PortraitAssetRefV1`)
- Image-edit and candidate-generation result field: `result_asset`

The catalog manifest ETag includes the portrait delivery policy, so a policy
change invalidates cached metadata without rebuilding the gene catalog.

## Maintenance map

- Delivery state machine and policy validation:
  `shared/iconoplasm-portrait/portrait-delivery-core.js`
- Website DOM adapter:
  `quartz/static/iconoplasm/portrait-delivery.js`
- Extension byte-fetch/tab adapter:
  `iconoplasm-extension/service-worker.js`
- Public contracts, canonical routes, and storage adapter:
  `workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js`
- Shared bundle generation:
  `scripts/sync-iconoplasm-shared.mjs`

Edit the shared source and run `pnpm run sync:iconoplasm-shared`. Do not edit the
generated website or extension copies.

## Verification

1. Read live metadata and confirm schema 4, artifact schema 5, minimum extension
   0.6.0, canonical origin, and enabled accelerator.
2. Confirm a public gene/media payload contains only first-party portrait URLs.
3. On a healthy network, open two gene pages and verify portraits load from the
   accelerator after one tab-wide probe.
4. In a browser where the accelerator is unreachable, verify one failed
   accelerator request followed by first-party portrait requests. Check image
   `complete`, `naturalWidth`, and `naturalHeight`, not only HTTP status.
5. Generate or edit a blot after the tab has selected canonical delivery and
   confirm the new result loads first-party in the comparison modal.
6. Verify the extension on a normal web page in the same two network states.
7. Run the shared delivery, extension worker, public media, image-edit, storage,
   packaging, and build tests before deployment.
