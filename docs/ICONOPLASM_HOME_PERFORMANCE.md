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

The Quartz router must read `target="_blank"` from the enclosing anchor, never from the nested image or text element that received the click. Image-only gallery cards deliberately open gene profiles in a new tab; hijacking their inner image click into SPA navigation destroys the source gallery's scroll context.

The protected controller contract is `quartz/static/iconoplasm/collection-feed.test.js`. It covers loading boundaries, request joining and cancellation, feed semantics, keyboard traversal, forward and backward recycling, the mounted-card and payload caps after 100+ batches, retry behavior, and catalog snapshot changes.

## Gallery Card Freshness

**ARCHITECTURE FENCE [IPD-011] — every public surface has one portrait authority.**

D1 owns live authoring, votes, rich detail, and candidates. The stable
gene object `genes/v3/<SYMBOL>.json` is the sole public portrait authority. A D1
leader may legitimately be newer for the minutes until the per-gene publisher or
the Actions republish pass rewrites that object; no public surface may reveal
that SHA early.

The account window combines two kinds of data with deliberately different
jobs:

- discovery rows determine which genes belong to the account and in what order;
- the stable gene object determines every displayed card field,
  including the canonical portrait URL and `asset_sha256`.

`view=image-only` is only a smaller wire representation. It is not a separate
read model and must not have a separate freshness mechanism. The server first
reads the account's bounded symbol window, reads those symbols' stable gene
objects (`readStableGeneObjects(...)`), and then projects
compact image cards from those published card VMs. The ordinary and image-only
views therefore differ in response shape, not authority.

The same rule covers anonymous galleries, site-gene detail, the server-rendered
gene-page lead and metadata, public media, extension cards, and print-copy
inputs. Site-gene detail may overlay fresh D1
facts and candidates around the card portrait, but it has no signed-in or
gene-detail portrait fallback. A missing or incomplete stable object fails
closed and uncached instead of selecting a D1 or catalog SHA.

### Why this fence exists

A symbol-to-SHA snapshot is its own portrait timeline. Used for the image-only
account view, it shows an outvoted portrait on the signed-in homepage while
`/gene/<SYMBOL>` shows the current one, and guest or substitute-browser checks
never exercise that branch. The regression test "image-only account gallery
ignores a stale legacy portrait-ref snapshot"
(`workers/iconoplasm.account-gallery-window.test.js`) makes the portrait-reference
snapshot stale while the stable object is current, and requires the response to
use the stable object. Compact discovery state holds no image identity, so there
is no discovery-row SHA to go stale.

### Forbidden “optimizations”

Do not:

- use `publishedPortraitRefs(...)` or any other symbol-to-SHA snapshot as the
  image-only account source;
- use `row.asset_sha256` from the discovery window for a displayed portrait;
- treat an image-only response as permission to bypass the stable gene object;
- let site-gene detail, public media, metadata, a sitemap, or print-copy select
  the D1 authoring leader;
- add a cache that is not keyed by the stable object's version; or
- accept API/hash equality alone as proof when the bug report is visual.

If the stable-object read is too expensive, optimize the compact projection
inside that single read path. Do not create another portrait timeline. A
proposed replacement is acceptable only if one publication event selects one
canonical image for every public surface, adversarial tests prove a
D1-only change cannot move it, and a same-session Computer Use check confirms
the homepage and gene page show the same character skin color.

Undesired optimization: do not let browser storage decide that a gallery card page is fresh enough to paint before the page has checked the current backend manifest.

The `/api/iconoplasm/mobile-card-manifest` response is the freshness authority for mobile/home gallery card view-models. IndexedDB rows are a write-through performance cache only. A fully populated local page cache must still ask the manifest endpoint before rendering, because browsers such as Edge can retain old IndexedDB rows for weeks. If local rows from an old version are allowed to short-circuit the manifest request, the gallery can show portraits that were outvoted long ago while the gene page correctly shows the current canonical portrait.

This is intentionally stricter than a normal cache hit. The right behavior is:

- Ask the manifest endpoint for every gallery card page before paint.
- Store returned card VMs under `manifest.snapshot_version`.
- Render only cards from the current manifest response.
- Show a visible manifest/data failure if the manifest is unavailable or incomplete.

Do not add a cache-first, stale-while-revalidate, "all symbols are already in IndexedDB", or old-version fill-in path for gallery cards. Those designs recreate the Edge stale-canonical failure mode.

Three real tests exercise this path. `e2e/home-collection-sorts.e2e.mjs` runs the
signed-in home collection in Chrome and records, in order, the symbols the page
asks the manifest endpoint for. `workers/iconoplasm.mobile-card-manifest.test.js`
runs the manifest route, and `workers/iconoplasm.account-gallery-window.test.js`
runs the account window route. No automated check forbids a cache-first path in
the client, so a reviewer must.

The anonymous reader's side of the same rule (no Worker request, no identity
probe) is `e2e/anonymous-reader-requests.e2e.mjs`: it loads the home page and a
gene page without the signed-in cookie and fails if any request matches the
stateful config's `run_worker_first` list.

Global authority is additionally protected by the public-media test under
`workers/`. It must keep D1 portrait A and card portrait B intentionally different, then
prove that only a rewrite of the gene's stable object can move public media.
