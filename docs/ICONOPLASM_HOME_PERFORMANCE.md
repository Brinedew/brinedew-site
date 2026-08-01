# Iconoplasm Home Performance

## Discovery Freshness

The signed-in account shelf is a discovery-fresh product surface. The default order is newest discovered first, so the first account gallery window must not be painted from a browser cache of ordered symbols. A user can discover genes from another page, tab, or extension session and then return home expecting those genes at the top.

Browser storage may cache immutable card view-models keyed by snapshot version. It must not cache the ordered account window unless the server first provides a per-user collection version that changes on every discovery encounter and merge.

## Virtual Feed Contract

The homepage is an automatic, cursor-backed feed, but its data sources remain distinct. Personal and shared `newest`/`symbol` orders use the bidirectional account-window v2 contract; other discovery orders use bounded slices of the discovery metadata already loaded for that mode; classic full-catalog mode uses versioned gallery windows. Never flatten these paths into one universal sequence.

The browser keeps the first paint to four cards, then requests 8 cards per mobile segment or 12 per desktop segment. It may mount at most 24 mobile cards or 48 desktop cards. Distant measured segments become height-preserving spacers and can be rehydrated in either direction. Only eight segment payloads may remain in memory, and ordered account windows must not be persisted.

Automatic progress uses `history.replaceState` to update opaque `history.state` while the visible URL stays clean. Explicit scope and sort changes use `pushState`, but only user-meaningful, shareable choices may appear in the URL: a non-default order, shared scope, and the seed required to reproduce a random order. Cursor, segment page, offset, anchor gene, and intra-segment pixel offset are transient restoration data and must never be written to the address bar.

A saved history entry still contains that transient state so Back can restore the exact neighborhood without caching a complete DOM fragment. Legacy URLs containing `page`, `after`, `offset`, `cursor`, `anchor`, or `anchorOffset` may be consumed once for restoration and are cleaned on the first feed-state update. Crawlable pagination remains in the document's `rel=next` link rather than mutating the user's current URL.

Restoration is scoped by the explicitly prefixed `ICONO_ARCHIVE_RESTORE_SESSION` token in `sessionStorage`, which survives a real same-tab document navigation without leaking across tabs. The early head bootstrap uses `PerformanceNavigationTiming.type`: it preserves the saved home entry only for `back_forward`, and clears it plus scroll position for ordinary navigation or reload. This distinction is required because a browser may implement Back as either a same-document SPA traversal, a back-forward-cache restore, or a full document traversal; all three must restore the gallery, while Refresh must start clean.

Iconoplasm owns its in-app route entries. Its state carries the explicit `quartzRouterIgnore: true` suffix marker; the generic Quartz router must also honor an already-cancelled click. These two fences prevent the generic fetch/morph router and the Iconoplasm gallery router from both pushing or replaying the same navigation. Do not remove either fence unless Iconoplasm is migrated wholesale onto a single replacement router with equivalent scroll-restoration tests.

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
