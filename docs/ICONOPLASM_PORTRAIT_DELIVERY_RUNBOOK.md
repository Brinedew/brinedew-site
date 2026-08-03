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

Labelled gene-card PNGs are a separate derived asset class under
`gene-cards/v1/<prefix>/<card-fingerprint>/<SYMBOL>-iconoplasm-gene-card.png`.
Their fingerprint comes from the exact versioned published card payload and the
renderer revision, including the selected portrait identity. They never choose
or reconstruct a portrait independently. Public downloads go through the
first-party print-copy route and set the same gene-specific filename in
`Content-Disposition`; ready archive thumbnails use the accelerator on healthy
tabs and the canonical `/gene-cards/` route after the same tab-scoped delivery
probe used by portraits. Image sitemaps publish the canonical first-party URL,
not a storage-provider hostname.
After a labelled-card PUT, the worker retries authenticated Storage HEAD across
a bounded five-second replication window before declaring verification failed.
It never treats an unverified upload as ready.

## Storage and serving

Portrait bytes live in Bunny Storage. The internal stateful Worker is the only
runtime with the authenticated Storage API credential. It performs idempotent
GET, HEAD, PUT, and DELETE operations with bounded timeout and transient retry.
Permanent 4xx responses fail immediately.

`https://iconoplasm.brinedew.bio/portraits/v1/...` and
`https://iconoplasm.brinedew.bio/gene-cards/v1/...` read authenticated storage
and write successful immutable GET responses to Cloudflare's edge cache. Both
paths are content-addressed, so query strings do not create separate cache
objects.

## Browser delivery policy

### Why Bunny is primary

**ARCHITECTURE FENCE [IPD-001]** — Bunny is not a disposable mirror. It is the
healthy-path delivery layer chosen so browser portrait reads go directly to the
CDN instead of consuming a Cloudflare Worker request for every image. The
canonical first-party route is the correctness fallback and stable public
identity, not the normal delivery path for healthy tabs.

An `ERR_NAME_NOT_RESOLVED` from one browser or ISP is evidence for that tab to
select canonical delivery. It is not evidence that Bunny Storage, the Bunny
pull zone, or Bunny globally is unhealthy. Do not disable the accelerator from
one regional probe.

Retiring or replacing Bunny is allowed only as an explicit architecture
migration. Update `architecture-fences.json`, this runbook, both policy decision
sites, production and staging configuration, behavioral tests, and the
deploy-blocking guard together.

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
- Requested labelled-card thumbnails bind to this same decision. A Bunny DNS
  failure must never leave broken alt text in the crawlable archive.
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
- Extension scanner artifact schema: 1
- Immutable catalog URL contract token: `a5c1`
- Published portrait snapshot schema: `v3`
- Minimum extension version: the value in `iconoplasm-extension/publisher-release.json`
- Full catalog portrait field: `p` (`PortraitAssetRefV1`)
- Extension scanner portrait fields: none; visible and hovered genes hydrate
  portraits from the published card-detail batch
- Image-edit and candidate-generation result field: `result_asset`

The catalog artifact schema and contract revision are part of both its
immutable URL and shared-cache namespace. Any change that can alter catalog
bytes must bump the contract revision, even when the JSON shape is unchanged.
The published-portrait snapshot is accepted only when its row count matches its
content fingerprint; partial or failed reads are never cached as valid empty
state. The catalog manifest ETag also includes the portrait delivery policy, so
a policy change invalidates cached metadata without rebuilding the gene catalog.

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

1. Read live metadata without an extension header and confirm API schema 4,
   candidate artifact schema 5, the publisher-authority minimum extension
   version, canonical origin, and enabled accelerator.
2. Read the manifest with the published extension version header. Confirm its
   schema matches `publisher-release.json`, then follow its `artifact_url` and
   confirm the artifact uses the fields that published version understands.
3. Follow the candidate manifest's `artifact_url`. Confirm its URL contains
   `a5c1`, its body is schema 5, portrait-bearing genes use `p`, and no gene
   contains `pt` or `ph`.
4. Follow `scanner_artifact.artifact_url`. Confirm it is schema 1, stays below
   3 MiB, contains exactly 19,023 canonical keys, and no scanner gene contains
   `p`, `portrait`, or rendition URLs.
5. Confirm a public gene/media payload contains only first-party portrait URLs.
6. On a healthy network, open two gene pages and verify portraits load from the
   accelerator after one tab-wide probe.
7. In a browser where the accelerator is unreachable, verify one failed
   accelerator request followed by first-party portrait requests. Check image
   `complete`, `naturalWidth`, and `naturalHeight`, not only HTTP status.
8. Generate or edit a blot after the tab has selected canonical delivery and
   confirm the new result loads first-party in the comparison modal.
9. Verify the extension on a normal web page in the same two network states.
10. Run the shared delivery, extension worker, public media, image-edit, storage,
    packaging, and build tests before deployment.
