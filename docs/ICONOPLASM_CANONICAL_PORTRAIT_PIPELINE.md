# Iconoplasm published source-portrait pipeline

How a gene's winning portrait is chosen, published and repaired.

If you remember one rule, remember this:

**D1 is the authoring and vote source. The stable gene object
`genes/v3/<SYMBOL>.json` is the one published card for a gene: its portrait is
the published winner, and the canonical public image is the workstation-rendered
gene blot tied to that object.**

## Publication contract

Iconoplasm publishes two objects on Bunny:

- `genes/v3/<SYMBOL>.json` is the whole published card for one gene: the
  projected record, the winning portrait, the complete candidate pool and
  `published_at`. `publishIconoplasmGeneStableObject` in the stateful runtime
  rewrites it in place and purges its CDN URL (about five subrequests, no
  Durable Object). Every vote and supervote calls it after the response; an
  upload or reconcile that touches at most eight genes, `/admin/publish` and
  `/admin/reject` call it in process; the admin republish route
  (`admin_publication.republish`) calls it for everything else.
- `catalog/v3/index.json` is the one catalog object. GitHub Actions
  (`scripts/publish-iconoplasm-catalog.mjs`) builds it from D1 and uploads it
  through `admin_publication.catalog_object_put`; the same run republishes the
  dirty genes through the republish route. The Worker's quarter-hour `gallery`
  cron (`workers/iconoplasm-catalog-dispatch.js`) sends one
  `repository_dispatch` when the newest publication-affecting event moved.
  `PUBLICATION_AFFECTING_ACTIONS` in that file is the one list of event actions
  that change a stable object (a winner or a candidate change); the publisher
  republishes every gene with one of them after its watermark.

## Stable gene object

`writeStable` in `workers/lib/iconoplasm-published-card-objects.js`, called
only by `publishIconoplasmGeneStableObject`, writes the object with
`stable_object_version: 3` and Cache-Control
`public, max-age=300, stale-while-revalidate=86400`, and verifies the bytes by
authenticated read-back before it returns.

The pull zone does not honour that header (measured 2026-09-30: the CDN served
`genes/v3/A1BG.json` with `max-age=2592000`). So every rewrite also purges its
exact CDN URL through the Bunny API (`BUNNY_ACCOUNT_API_KEY`, free): PUT,
verified GET and purge are three subrequests per gene. Without the account key
the write still succeeds and reports `purged: false`; a refused purge throws so
the caller retries the gene. Readers fetch with `cache: "no-cache"`, so a
browser revalidates instead of keeping a rewritten gene for the CDN's 30 days.

Bounded race: two publications of one gene can overlap (two votes a second
apart, or a vote while the Actions publisher republishes the same gene). Each
reads D1 when it runs; a stalled older PUT that lands after a newer one leaves
the older content until the next publication of that gene, or a `republish` of
it (see the repair below). A winner change always has its publish event, so the
next Actions run repairs it; a count-only lag lasts until the gene's next vote.

## Image ontology

- **Portrait** is the generated character image selected by `asset_sha256`. It is source material.
- **Gene blot** is the exact shared `image-only` card composition: portrait cover crop, protection gradient, full gene name at bottom left, and symbol at bottom right. Its verified 768x1024 WebP is the canonical public/search image.
- **High-resolution print copy** is the separate requested 1536x2048 PNG workflow. It is not the canonical search image.

Only the Iconoplasm workstation renders canonical blots. Cloudflare accepts authenticated verified WebP uploads, records the one-row-per-gene materialization ledger, carries the blot key in the stable gene object, and serves bytes. Public GET/HEAD requests never render or enroll blots.

## Read path

Rich detail and candidate state come from D1 (`icono_gene_essence`,
`icono_portrait_assets`, the candidate and vote read models). The published
portrait comes only from the stable gene object. Public card traffic never
rebuilds cards from D1 per request, because cold Cloudflare isolates multiply
D1 reads globally:

1. `readStableGeneObjects(...)` reads `genes/v3/<SYMBOL>.json` from Bunny Storage, one read per requested symbol.
2. `/api/iconoplasm/cards/:symbol`, the mobile cards, site detail, public media and the blot route project that one object.
3. The public edge proxy stays state-free and adds no symbol-only Cache API entry in front of those endpoints.

`/api/iconoplasm/site/genes/:symbol` combines live D1 detail and candidates
with the portrait from the stable object, and marks candidates `is_current`
from that same published SHA. So a D1 winner that is not yet published shows
as an ordinary candidate, never as a second current portrait. The signed-in
account gallery (both its full and `image-only` views) loads the same stable
objects; it never keeps a separate portrait snapshot (B-700).

The home page's IndexedDB card cache is write-through only: the page always
asks `/api/iconoplasm/mobile-card-manifest` for the current snapshot label
before painting cached cards, because browsers keep IndexedDB rows for weeks.

`/gene/:symbol` embeds its first-paint card from
`/api/iconoplasm/site/genes/:symbol`; its ETag covers the published card and
the complete payload. Print-copy generation accepts only the portrait of the
published card: an `asset=` parameter is an assertion, so a malformed value
fails with `400` and a valid SHA that differs from the published portrait fails
with `409`. Print-copy enrollment, status, rendering and download never fall
back to D1.

Budget: publication writes go to Bunny Storage (one PUT, one verified GET and
one CDN purge per gene), never to KV, and the catalog object is built outside
the Worker. Do not fix staleness by bypassing a provider headroom check, and do
not add a public D1 fallback.

## Votes and the workstation blot lane

D1 is the only store for votes. A vote (`/api/iconoplasm/votes/set`, the
admin and import routes, a copied, edited or generated candidate's first
upvote) runs `workers/iconoplasm/votes/gene-votes.js` inside the request:

1. One write batch upserts the user's row in `icono_image_votes`, moves that
   asset's `icono_vote_asset_summary` row by the exact delta between the old
   and the new vote (read inside the same transaction), and bumps the gene's
   version in `icono_gene_vote_version`. An identical retry writes nothing.
2. One read batch takes the gene's candidates, summaries, caretaker supervote,
   published state and vote version, and elects with
   `electGeneAuthorityWinner`.
3. If the winner differs from `icono_publish_state.current_asset_sha256`, one
   batch projects it (the state row and one `publish` event), but only while
   `admin_override` is 0, the winner is still eligible and the gene's vote
   version is still the one step 2 read. A newer vote makes an older election a
   no-op, so two near-simultaneous votes can never leave the older winner.
4. After the response (`ctx.waitUntil`) the gene's stable object is
   republished with no selection, so its shared counts stay current. A failed
   publish never fails the vote.

A caretaker supervote (`/api/iconoplasm/caretaker/genes/:symbol/supervote`)
is the same shape over the caretaker projection tables: compare-and-set on the
assignment and supervote versions, a receipt per command id, weight exactly 10
(+ or -), eligible candidates only. Admin paths that change a gene's candidates
(reject, unstale, reconcile, remove, clear-override) elect through the same
function after advancing the gene's vote version. Measured on the full
migrated schema (`workers/iconoplasm/vote-asset-summary-cost.test.js`): a new
vote writes 15 D1 rows and reads 2, an election reads about 2 rows per
candidate, a snapshot reads 7.

Snapshots (`/votes/snapshot(s)`) read D1: the named genes' summaries, the
caller's own votes on exactly the named assets and the caretaker rows, three
statements whatever the item count.

The `IconoplasmVoteCoordinator` Durable Objects hold a historical copy only.
`POST /api/iconoplasm/admin/votes/compare-coordinators` (driven by
`scripts/export-iconoplasm-votes-to-d1.mjs --compare`) reports each
coordinator's differences from D1 and writes nothing.

The workstation drain polls the authenticated `blots/backlog` route, which
answers from D1 and the stable objects, renders the missing blots for the
published portraits and uploads them. The blot route serves a blot once its
upload completes; until then the gene shows its developing state. The drain
never changes D1 canonical state or uploads an image that does not match the
published card.

## Automatic canonical tie-breaker

Automatic promotion uses one ranking rule everywhere it chooses a leader:

1. highest vote score
2. non-legacy before legacy
3. highest upvote count
4. newest `created_at`
5. existing current asset only as a stability fallback
6. lowest asset SHA as the final deterministic fallback

The existing current asset is not protected from an equally voted newer asset. If a newer portrait has the same score and upvote count, it becomes canonical. The only durable "do not move this automatically" protection is `admin_override = 1` in `icono_publish_state`.

Stale, rejected and auto-pick-ineligible candidates never win. Keep `electGeneAuthorityWinner` and the admin read-model leader SQL in the same order. If they drift, the admin view names one leader while the election publishes another.

## Publication diagnosis and safe repair

Use this when one gene's D1 winner and its published stable object disagree
for longer than one publisher run (about 15 minutes). That is the B-888
failure: D1 says one portrait won, readers see another.

### 1. Confirm the split for one symbol

Do not run a catalog-wide report first. Read D1's winner:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, current_asset_sha256, admin_override, updated_by, updated_at FROM icono_publish_state WHERE gene_symbol = 'PRL'"
```

Then the object readers fetch:

```powershell
@'
const res = await fetch("https://iconoplasmportraits.b-cdn.net/genes/v3/PRL.json", { cache: "no-store" });
const gene = await res.json();
console.log(JSON.stringify({
  status: res.status,
  published_at: gene.published_at,
  portrait: gene.portrait?.asset_sha256 ?? null,
  marked_current: (gene.portrait_candidates || []).filter((c) => c.is_current).map((c) => c.asset_sha256),
}, null, 2));
'@ | node -
```

`portrait` and `marked_current` should both equal D1's `current_asset_sha256`.

### 2. Republish the gene from D1

If D1 is right and the object is stale, republish. With no selection the
publisher publishes what D1 holds and writes nothing back to D1, so this call
cannot change a winner. It rewrites `genes/v3/PRL.json`, purges its CDN URL and
returns the new `published_at`. Up to `REPUBLISH_MAX_SYMBOLS` (8) per call.

```powershell
@'
const token = process.env.ICONOPLASM_ADMIN_TOKEN;
if (!token) throw new Error("ICONOPLASM_ADMIN_TOKEN missing");
const res = await fetch("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/republish", {
  method: "POST",
  headers: { "content-type": "application/json", "x-iconoplasm-admin-token": token },
  body: JSON.stringify({ symbols: ["PRL"] }),
});
console.log(JSON.stringify({ status: res.status, payload: await res.json() }, null, 2));
'@ | node -
```

If D1 itself is wrong, fix the winner through the admin publish path (which
records a publish event) and then republish; never write `icono_publish_state`
by hand without a matching `icono_publish_events` row.

### 3. Verify both surfaces

Re-run step 1: the object's `published_at` is new and both fields name D1's
winner. Then open `https://iconoplasm.brinedew.bio/gene/PRL` in a fresh browser
profile and check the portrait. The catalog object (`catalog/v3/index.json`)
picks the change up on the next Actions publisher run.

### Do not

- write `icono_publish_state` without a publish event and a republish
- hand-edit a stable gene object instead of republishing the gene
- add a public D1 fallback to `/api/iconoplasm/cards/:symbol`
- trust a frontend zero or candidate count as the source of truth
- run broad full-catalog D1 reports before a symbol-scoped diagnosis
- purge the entire Cloudflare zone or Bunny pull zone when one object is stale
- rely on remote `wrangler dev --test-scheduled` for this worker; remote dev does not support the Queue and SQLite Durable Object combination it binds
