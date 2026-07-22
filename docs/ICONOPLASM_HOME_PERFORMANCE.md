# Iconoplasm Home Performance

## Discovery Freshness

The signed-in account shelf is a discovery-fresh product surface. The default order is newest discovered first, so the first account gallery window must not be painted from a browser cache of ordered symbols. A user can discover genes from another page, tab, or extension session and then return home expecting those genes at the top.

Browser storage may cache immutable card view-models keyed by snapshot version. It must not cache the ordered account window unless the server first provides a per-user collection version that changes on every discovery encounter and merge.

## Virtual Feed Contract

The homepage is an automatic, cursor-backed feed, but its data sources remain distinct. Personal and shared `newest`/`symbol` orders use the bidirectional account-window v2 contract; other discovery orders use bounded slices of the discovery metadata already loaded for that mode; classic full-catalog mode uses versioned gallery windows. Never flatten these paths into one universal sequence.

The browser keeps the first paint to four cards, then requests 8 cards per mobile segment or 12 per desktop segment. It may mount at most 24 mobile cards or 48 desktop cards. Distant measured segments become height-preserving spacers and can be rehydrated in either direction. Only eight segment payloads may remain in memory, and ordered account windows must not be persisted.

Automatic progress uses `history.replaceState`; explicit scope and sort changes use `pushState`. A saved route state contains the active cursor, segment page, anchor gene, and intra-segment offset so Back can restore the exact neighborhood without caching a complete DOM fragment.

The protected controller contract is `quartz/static/iconoplasm/collection-feed.test.js`. It covers loading boundaries, request joining and cancellation, feed semantics, keyboard traversal, forward and backward recycling, the mounted-card and payload caps after 100+ batches, retry behavior, and catalog snapshot changes.

## Gallery Card Freshness

Undesired optimization: do not let browser storage decide that a gallery card page is fresh enough to paint before the page has checked the current backend manifest.

The `/api/iconoplasm/mobile-card-manifest` response is the freshness authority for mobile/home gallery card view-models. IndexedDB rows are a write-through performance cache only. A fully populated local page cache must still ask the manifest endpoint for the current `KV_GALLERY_VERSION` before rendering, because browsers such as Edge can retain old IndexedDB rows for weeks. If local rows from an old version are allowed to short-circuit the manifest request, the gallery can show portraits that were outvoted long ago while the gene page correctly shows the current canonical portrait.

This is intentionally stricter than a normal cache hit. The right behavior is:

- Ask the manifest endpoint for every gallery card page before paint.
- Store returned card VMs under `manifest.snapshot_version`.
- Render only cards from the current manifest response.
- Show a visible manifest/data failure if the manifest is unavailable or incomplete.

Do not add a cache-first, stale-while-revalidate, "all symbols are already in IndexedDB", or old-version fill-in path for gallery cards. Those designs recreate the Edge stale-canonical failure mode.

The protected contract is `quartz/static/iconoplasm/home-performance-contract.test.js`:

- `account gallery first window is discovery-fresh and does not use a stale ordered-window cache`
- `mobile home collection refreshes card VMs from the manifest before painting`
