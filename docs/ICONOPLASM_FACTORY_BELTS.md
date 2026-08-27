# Factory output belts

Owner: [B-715](https://linear.app/brinedew/issue/B-715).

The admin Factory tab opens on Outputs. Each belt is an exact Pipeline + Vision
recipe (for example A9), with its six newest **published candidates**, newest first.
It is not a canonical-gene gallery or a view of unpublished workstation files.
The active recipe editor remains visible; Compare and Settings retain the existing
diagnostic matrix and recommended-Vision controls. Selecting a view never activates
a recipe or queues generation.

## Fences: preserve these distinctions

- Group only by normalized `icono_portrait_assets.emulsion_id`. Migration 0076 made
  qualified codes evidence of factory lineage. Never infer a factory from an artist
  Vision ID, a filename, or today's active recipe. Unqualified legacy assets and
  edited derivatives are not factory outputs.
- Retired pipelines keep their historical belts under Retired, but cannot become
  active. Empty recommended recipes remain discoverable under All factories.
- `open_count` means open requests, not proven running GPU jobs. Keep the label
  **open**. The website does not own workstation execution state.
- Candidate inspection uses the existing `lightbox.js` PhotoSwipe delegation,
  full-rendition URL and native dimensions. One lightbox group per belt; never add
  a parallel viewer, crop images, or use thumbnail dimensions for full-size zoom.
- Belt pins are local viewing preferences, not canonical portrait overrides.
  This endpoint does not alter votes, canonical materialization, or publication.

## Bounded reads, stable inspection

`GET /api/iconoplasm/admin/factory-belts` is authenticated, private and no-store.
It must be registered in `iconoplasm-route-contract.js` as well as implemented in
the runtime: an unregistered handler is unreachable through the real gateway.
It runs in the existing stateful worker and uses existing immutable portrait URLs.
There is no new publisher, storage service, KV write or public request path.

Migration 0080 adds a partial expression index only for qualified factory assets.
The output query performs an indexed top-six seek per registered recipe, not a
corpus-wide scan/window ranking. At present 16 pipelines × 9 Visions means 144
small seeks. A hard 512-recipe limit fails explicitly before querying; implement
pagination before raising it. Open counts use the existing request-status index.
Catalog expansion must preserve the query-plan test and its bounded access path.

The client reads on entry/return, and every 30 seconds only while Outputs is
visible and there is open work. It stops when hidden, unmounted, or an update is
waiting. New results appear behind **Show updates**, so inspection does not
shuffle underneath the user. Refresh never replaces an open lightbox's images.
Failures retain the last good view and expose retry. Images are lazy-loaded.

## Verification

`workers/iconoplasm.factory-belts.test.js` exercises real SQLite query plans,
newest-six ordering, exact lineage, retired/empty recipes, recipe-capacity failure,
shared PhotoSwipe attributes, polling and stable updates. Browser verification must
also open and zoom a real full image, change filters, persist a pin across reload,
and check the existing diagnostic viewer and a public gene page after deployment.
