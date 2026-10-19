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

Portrait selection happens before delivery policy. D1 owns authoring, vote,
rich-detail, and candidate state and may legitimately name a newer leader while
publication is pending. The stable gene object `genes/v3/<SYMBOL>.json` is
the sole published source-portrait selection used by signed-in and anonymous
cards, gene detail, extension cards, and the print copy. A missing stable
object fails closed; there is no D1 or gene-detail portrait fallback.

The source portrait is not Iconoplasm's canonical public/search image. That role
belongs to the gene's **blot** (`docs/ICONOPLASM_GLOSSARY.md`): the current
portrait with the gene's full name and symbol painted into one 768x1024 WebP by
`scripts/draw-iconoplasm-blots.mjs`. Blots use immutable keys derived from the
gene's stable object and the painter revision. The stable first-party
`/blot/<SYMBOL>.webp` route recomputes that key from the stable object and
serves that object only; until the drawing run has painted it, the route
redirects to the bare current portrait. Public media, page metadata and
structured data expose the blot, while the raw portrait is
explicitly subordinate.

Portraits and blots load from `img.brinedew.bio` on every network (see
"Protected image behavior" below). The delivery host changes only how bytes
arrive, never identity.

The print copy is painted in the reader's own browser from the published
portrait and the stable gene object (`genes/v3/<SYMBOL>.json`). The browser copies
the portrait's pixels 1:1 and bakes the gene's name and symbol into them, so the print
size is the portrait's own size. No server renders, stores or serves a print
copy, and no D1 row or Worker request is spent on one; the reader's click
downloads a file the browser already holds. The print copy never chooses or
reconstructs a portrait independently of the stable object.
It never treats an unverified upload as ready.

## Storage and serving

Portrait bytes live in Bunny Storage. The internal stateful Worker is the only
runtime with the authenticated Storage API credential. One server-side adapter,
`workers/lib/iconoplasm-portrait-storage.js`, owns Bunny configuration, bounded
requests, GET/HEAD source selection, PUT, and DELETE. Routes and notification
senders must not reconstruct those operations independently.

Authenticated authoring and verification use Bunny Storage through the one
server-side adapter. Healthy browsers load immutable portraits directly from
Bunny. When Bunny is unreachable from a browser, canonical first-party
`/portraits/*` requests reach the existing Worker, which reads the same
immutable key through that adapter. The build must not redirect those URLs to
the static placeholder: that serves SVG with HTTP 200 under a `.webp` name and
breaks any client that decodes the portrait. The mutable `/blot/<SYMBOL>.webp` alias
enters the same Worker, reads the gene's stable object, and serves only its
matching immutable WebP. Neither route elects a portrait from D1 or starts a
repair.

Website Ops stores `regionally_divergent` separately from ordinary
`renderable`. Its existing storage-audit action always prioritizes unknown rows,
then permits verdicts older than 30 days to re-enter the same bounded batch of
at most 100 assets. This is an operator-triggered rolling recheck, not an
automatic corpus sweep; the summary reports how many old verdicts are due.

Server-generated Discord receipts use that same adapter and the same
content-addressed full rendition. Discord keeps its WebP signature and byte
limits after the shared read resolves. It must never regain a private copy of
Storage-vs-CDN selection.

Routine workstation ingest is a bounded write path: each missing rendition gets
one Bunny Storage PUT, and the normal candidate batch must not invoke the
read-after-write retry envelope. That envelope can repeat a PUT and several
HEAD probes while Bunny converges, so it belongs only to explicit storage audit
or repair work. Keeping it out of ordinary ingest preserves the Worker resource
envelope; the durable storage-audit path remains available when exact
read-after-write proof is required.

Discord fulfillment is deliberately sliced at one complete requester/publication/
gene group per Worker invocation. A group may require both Storage and public-CDN
fetches for every preview, followed by the Discord channel and message calls;
processing several groups together can exceed Cloudflare's per-invocation
subrequest ceiling even when each individual path is healthy. The workstation
repeats the exact publication handoff until the pending request set is empty.
An explicit Cloudflare subrequest-limit exception is retryable because the
platform rejects that outbound call before it can reach Discord. Other ambiguous
message outcomes remain terminal and must not be replayed automatically.

## Browser delivery policy

### Why Bunny is primary

The owner pays for Bunny as the alternative to R2, whose billing is unavailable.
Do not require R2 enablement or a paid Cloudflare upgrade to complete delivery.
The canonical-URL rule prohibits provider-owned identity, not provider delivery.
It also permits CDN caching of public hover metadata (the gene's stable object).
Neither a cached response nor a deterministic projection is a second canon:
only independent image selection or an independent publication pointer is.

### Hover metadata on the CDN

The extension reads hover detail from the gene's stable object on the free CDN,
`https://iconoplasmportraits.b-cdn.net/genes/v3/<SYMBOL>.json`
(`iconoplasm-extension/service-worker.js`). It sends no cookies and no
client-version header, so every reader shares one CDN cache entry per gene, and
it revalidates with `cache: "no-cache"`. The Worker purges that exact URL on
every rewrite. A CDN 404 means the gene has no stable object. The service worker keeps at
most 512 objects in memory for five minutes. The pull zone's CORS extensions are
owned by `bunny/the-only-iconoplasm-pull-zone-policy.json`, which
`scripts/reconcile-iconoplasm-pull-zone.mjs` applies from the production deploy.

Rules for any public cache in front of Iconoplasm:

- Cache only anonymous public objects. Never proxy private, auth, vote, admin,
  mutable manifest, or mutation routes through a public cache.
- A vote that leaves the winner unchanged creates no publication; a changed
  winner rewrites the gene's stable object in place through the per-gene
  publisher, which purges its CDN URL. Never require corpus purges on voting.
- Confirm CDN rules do not cache `no-store` failures or personalized responses.
  Bunny Smart Cache excludes JSON by default; changing a URL alone is not proof
  of acceleration. Follow the current [Bunny caching contract](https://bunny.net/docs/cdn/smart-cache).

### Protected image behavior

**ARCHITECTURE FENCE [IPD-001]** — readers load portraits, blots and
the published objects from `https://img.brinedew.bio`, a Cloudflare-proxied
CNAME for the Bunny pull zone (B-1087). Cloudflare's free cache answers repeat
views, so a view costs neither a Worker request nor Bunny bandwidth; Bunny
bills only cache misses. The zone records live in
`cloudflare/the-only-brinedew-static-edge-policy.json`, and the hostname in
`bunny/the-only-iconoplasm-pull-zone-policy.json`.

The website rewrites every delivered image URL onto that host
(`quartz/static/iconoplasm/portrait-delivery.js`). Stable gene objects name an image by its
canonical first-party URL, or by `iconoplasmportraits.b-cdn.net` if they were
published before the switch; both are rewritten. There is no probe and no
Worker fallback. Those existed because some ISP resolvers could not resolve
`*.b-cdn.net`, and `img.brinedew.bio` resolves through Cloudflare like the site
itself. A fallback would only have moved images onto metered Worker requests.
The canonical first-party URL stays the image's identity.

`GET /api/public/v1/metadata` and `GET /api/public/v1/catalog/manifest` still
publish `PortraitDeliveryPolicyV1`, with `img.brinedew.bio` as the accelerator.
Installed extensions read it: until its next store release the extension runs
the probe-and-fallback state machine in
`shared/iconoplasm-portrait/portrait-delivery-core.js`, bundled as
`iconoplasm-extension/generated/portrait-delivery-core.js`. That release
deletes it.

The website caches module URLs immutably. `sync:iconoplasm-shared` and the
restamp script update each importer's `?v=` hash when module bytes change.
Never freeze a dated import URL while changing the bytes behind it.

### Extension byte cache

The extension background stores immutable portrait bytes in an extension-origin
IndexedDB cache (`iconoplasm-extension/immutable-response-cache.js`, store
`iconoplasm-portrait-bytes-v1`) bounded to 8,192 entries, 64 MiB in total and
512 KiB per image, with a 48-entry in-memory layer. A separate metadata record
tracks recency, so reading a saved image never rewrites its blob. Oversized
responses still render but are not persisted; a quota or storage failure keeps
the bounded memory copy and cannot evict committed data. No unlimited-storage
permission is added. The key is the immutable asset path, not a gene-name
guess, so the same portrait is reused across websites. Hover metadata is held
only in memory; private APIs, failures and mutations never enter the cache.

This cache is part of the IPD-001/IPD-008 client transport. Source deployment is
not an extension-store release.

## Release contract

- Public API schema: 4
- Catalog artifact schema: 5
- Extension scanner artifact schema: 1
- Immutable catalog URL contract token: `a5c1`
- Published portrait snapshot schema: `v3`
- Minimum extension version: the value in `iconoplasm-extension/publisher-release.json`
- Full catalog portrait field: `p` (`PortraitAssetRefV1`)
- Extension scanner portrait fields: none; hover detail and its portrait come
  from the gene's stable object. One HTML/PDF reading session prepares
  the ordinary document's unique-symbol cards before hover and uses deterministic
  near-viewport working windows for large documents. A matching foreground hover
  reuses the same detail and portrait work instead of restarting it
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
- Server-side Bunny Storage/CDN authority:
  `workers/lib/iconoplasm-portrait-storage.js`
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
8. Generate or edit a portrait after the tab has selected canonical delivery and
   confirm the new result loads first-party in the comparison modal.
9. Verify the extension on a normal web page in the same two network states.
10. Run the shared delivery, extension worker, public media, image-edit, storage,
    packaging, and build tests before deployment.
