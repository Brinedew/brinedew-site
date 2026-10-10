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
  `published_at`. The record carries the shown manifestation prose and never
  the Tags (the caretaker panel promises they stay private). One pure builder
  (`buildGeneCard`, `workers/lib/iconoplasm-stable-gene-object.js`) makes it,
  and `publishIconoplasmGeneStableObject` in the stateful runtime writes it.
  Whoever changes a gene rebuilds its card in the same request:
  - **the factory** registers portraits it has uploaded to Bunny
    (`POST /api/iconoplasm/admin/portraits/register`, Hono, `workers/iconoplasm/app.js`),
    up to 8 genes and 100 portraits a call (the laptop sends 4 and 50);
  - **a vote or supervote** rebuilds after the response;
  - **the rebuild route** (`POST /api/iconoplasm/admin/publication/republish`)
    serves the bulk sweep (`scripts/republish-iconoplasm-gene-objects.mjs`) and
    the catalogue run's repairs.
- `catalog/v3/index.json` is the one catalogue object. GitHub Actions
  (`scripts/publish-iconoplasm-catalog.mjs`) builds it **from the cards** on
  Bunny Storage's origin, not from D1, and uploads it through
  `admin_publication.catalog_object_put`. An incremental run reads the cards of
  the genes with a publication-affecting event since its watermark and
  republishes only those whose card is older than the gene's latest event: the
  rebuilds that failed in their own request. The Worker's quarter-hour
  `gallery` cron (`workers/iconoplasm-catalog-dispatch.js`) sends one
  `repository_dispatch` when the newest publication-affecting event moved.
  `PUBLICATION_AFFECTING_ACTIONS` in that file is the one list of event actions
  that change what readers see.
- A gene the catalogue no longer carries has no card. Its republish deletes its
  stable object and its `icono_published_gene_routes` row, after a D1 read
  proves the gene is absent, and the catalogue run drops its row.

**Batch work stops at 85% of a D1 wall.** The register and rebuild routes read
the account's real D1 usage from Cloudflare's analytics and answer 503
`D1_BATCH_SHARE_SPENT` (with `Retry-After` and `reset_at`) once rows read or
written reach the tier table's batch share (`shared/iconoplasm-d1-budget-policy.js`).
A registration marked `criticality: "critical"` (a session drawn for a
reader's own request) runs to Cloudflare's wall. Every caller (the Drain, the
sweep script, the catalogue run) waits that 503 out. Cloudflare's own walls
answer the same way (`D1_ACCOUNT_READ_LIMIT`, `D1_ACCOUNT_WRITE_LIMIT`).

**What publishing costs, measured 2026-10-09** (Cloudflare `d1QueriesAdaptiveGroups`,
rows written per statement; indexes and triggers count): a portrait upsert
about 9, an election's winner row and event 4 each, a gene rollup rebuild 6.6,
a publish event 4. A new gene's first portrait is about 28 rows written; the
free plan's 100,000 a day hold roughly 3,000 of them at the 85% share. Price a
batch job with these numbers before running it.

## Stable gene object

`writeStable` in `workers/lib/iconoplasm-published-card-objects.js`, called
only by `publishIconoplasmGeneStableObject`, writes the object with
`stable_object_version: 3` and Cache-Control
`public, max-age=300, stale-while-revalidate=86400`, and verifies the bytes by
authenticated read-back before it returns.

The pull zone does not honour that header; its edge rule for `genes/v3`,
`catalog/v3` and `leaderboard/v1` (`bunny/the-only-iconoplasm-pull-zone-policy.json`)
serves them with a 60 s edge and browser cache time. A rewrite therefore shows
within Bunny's replication lag plus 60 s, and nothing is purged: PUT and the
verified GET are the two subrequests per gene. Bunny's purge API rate-limits a
bulk republish (429), so the edge rule, not a purge, bounds staleness.

A change to what the object carries reaches the CDN only when each gene is
rewritten. The Actions publisher rewrites only the genes whose winner or
candidates changed, so a change of shape needs a sweep of every gene through the
republish route, started in the last hours of the UTC day. The route takes up
to eight genes a call, but the sweep sends four, because the free plan's 10 ms
CPU cap kills a share of the heavier calls; the sweep retries a killed call and
then sends its genes one at a time.
`scripts/republish-iconoplasm-gene-objects.mjs` is that sweep (dry run by
default, resumable, its first batch read back from the CDN before it goes on);
`--verify` reads every public object.

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
2. `/api/iconoplasm/cards/:symbol`, the mobile cards, public media and the blot route project that one object.
3. The public edge proxy stays state-free and adds no symbol-only Cache API entry in front of those endpoints.

The gene page marks candidates `is_current` from the published SHA of the
stable object it read. So a D1 winner that is not yet published shows as an
ordinary candidate, never as a second current portrait. The signed-in
account gallery (both its full and `image-only` views) loads the same stable
objects; it never keeps a separate portrait snapshot (B-700).

The home page's IndexedDB card cache is write-through only: the page always
asks `/api/iconoplasm/mobile-card-manifest` for the current snapshot label
before painting cached cards, because browsers keep IndexedDB rows for weeks.

`/gene/:symbol` reads its card from the stable object on the CDN
(`genes/v3/<SYMBOL>.json`). Print-copy generation accepts only the portrait of the
published card: an `asset=` parameter is an assertion, so a malformed value
fails with `400` and a valid SHA that differs from the published portrait fails
with `409`. Print-copy enrollment, status, rendering and download never fall
back to D1.

Budget: publication writes go to Bunny Storage (one PUT and one verified GET
per gene), never to KV, and the catalog object is built outside
the Worker. Do not fix staleness by bypassing a provider headroom check, and do
not add a public D1 fallback.

## Votes and the workstation blot lane

D1 is the only store for votes. A vote (`/api/iconoplasm/votes/set`, the
admin and import routes, a copied, edited or generated candidate's first
upvote) runs `workers/iconoplasm/votes/gene-votes.js` inside the request:

1. One write batch starts with the voter's daily vote allowance
   (`workers/iconoplasm/votes/vote-guards.js`), then upserts the user's row in
   `icono_image_votes`, moves that asset's `icono_vote_asset_summary` row by
   the exact delta between the old and the new vote (read inside the same
   transaction), and bumps the gene's version in
   `icono_gene_vote_version`. An identical retry writes nothing and spends no
   allowance.
2. One read batch takes the gene's eligible candidates with their summaries
   (not rejected, auto-pick eligible, not stale; at most 256), the caretaker
   supervote, the published state and the vote version, and elects with
   `electGeneAuthorityWinner`.
3. If the winner differs from `icono_publish_state.current_asset_sha256`, one
   batch projects it (the state row and one `publish` event), but only while
   `admin_override` is 0, the winner is still eligible and the gene's vote
   version is still the one step 2 read. A newer vote makes an older election a
   no-op, so two near-simultaneous votes can never leave the older winner.
4. After the response (`ctx.waitUntil`) the gene's stable object is
   republished with no selection, so its shared counts stay current. The object
   carries the `vote_version` its publisher read before materializing; the
   publisher reads the version again after each write and, if a vote landed in
   between, materializes and writes again from the fresh rows, at most three
   passes. A failed publish never fails the vote.

**Daily vote allowance.** Each person may change 200 votes per UTC day
(`VOTE_PERSON_DAILY_LIMIT`, `icono_vote_person_day`, migration 0123, B-1065).
Their reader votes, the votes their image edit or generated candidate brings
with it, and, counted apart, their caretaker supervotes all spend it. Past it
their write batch is refused whole (nothing is written) and they get a 429 in
Stack Overflow's words: "Daily vote limit reached; vote again in N hours."
Nobody else is affected. The administrator's vote and import routes charge
nobody and are never refused. A person's earlier days are deleted by their
next vote. The `votes/set` 429 also says when voting is back: the seconds to
00:00:00 UTC (`secondsUntilCloudflareDailyReset` with no margin, the day the
allowance row is keyed on), as a
`Retry-After` header and as `retry_after_seconds` in the body. The body is the
copy the page reads, because `fetchJSON` keeps only the body and the
extension's fetch proxy drops headers. The vote box (`wireVoteBox` in
`shared/iconoplasm-card/shared-card-runtime.js`, one source that
`scripts/sync-iconoplasm-shared.mjs` copies into the site and the extension
bundle) restores the vote, shows the server's sentence through its
`onVoteFailed` callback, and then stops sending: the box is dimmed and
`aria-disabled`, and a tap shows the sentence again instead of asking the
Worker. The pause ends at the stated time, checked against the wall clock on
each tap, or at the next page load when a 429 carries no usable number. Other
refusals (400, 404, 409, 5xx) never pause a box. The candidate-copy, edit-publish,
generated-candidate and supervote routes answer the same code without a reset
time, because nothing on those routes waits for it.
Measured on the full migrated schema
(`workers/iconoplasm/vote-asset-summary-cost.test.js`): a first vote on an
asset nobody voted on writes 9 D1 rows, a first vote on a voted asset 7, a
flip 6, a supervote 13; a winner change adds about 7. One person at the
allowance writes about 2,000 rows, 2% of the free 100,000.

Publishing an image edit imports the edit's inherited upvotes and the
publisher's own vote in one import. The edit inherits 90% of its source's
upvotes, at most 25 (`IMAGE_EDIT_INHERITED_UPVOTE_LIMIT`), however many the
source holds, so one click spends at most 26 of the publisher's allowance and
writes about 134 rows.

A caretaker supervote (`/api/iconoplasm/caretaker/genes/:symbol/supervote`)
is the same shape over the caretaker projection tables: compare-and-set on the
assignment and supervote versions, a receipt per command id, weight exactly 10
(+ or -), eligible candidates only. Admin paths that change a gene's candidates
(reject, unstale, reconcile, remove, clear-override) elect through the same
function after advancing the gene's vote version. A vote import elects every
gene it names, so re-running one repairs a gene whose election failed. An
election reads about 2 rows per eligible candidate, a snapshot about 9.

The administrator's import route (`/api/iconoplasm/admin/votes/import`) is one
Worker invocation. What counts toward the free plan's per-invocation limit is
the number of calls to D1, and a `db.batch()` is one call however many
statements it carries (measured, B-914; `vote-guards.js` records the
measurement and the 1,000-call limit it found). An import makes two D1 calls
per chunk of 50 votes and two per gene it names, so the route takes at most 12
genes and 200 votes per request (32 calls at the bounds, `VOTE_IMPORT_MAX_GENES`
and `VOTE_IMPORT_MAX_ITEMS` in `vote-guards.js`, kept inside the 50 calls the
D1 limits page lists) and refuses a larger one with a 400 that names the
limits, before writing anything. When any named gene's election fails it answers 502 with the
`failed_symbols` (the votes are committed); running the same import again
elects every named gene afresh. Callers split their imports by the same
bounds.

The vote snapshot (`/votes/snapshot`) reads D1: the named gene's summaries,
the caller's own vote on exactly the named asset and the caretaker row.

A print copy is rendered only when a reader requests it (B-997); publication
never queues a browser render. Its fingerprint leaves out vote counts and the
stable object's envelope (candidate pool, `published_at`, `vote_version`), and
the status and PNG routes serve only a PNG whose fingerprint matches the current
card, so a reader never gets a stale copy: their click enrols the current card.

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

Do not run a catalog-wide report first, and do not read production D1 from a
shell: agent shells refuse it (B-1002). Read what readers get, the stable object:

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

`portrait` and `marked_current` should be the same SHA, and the one readers
report seeing. The admin page's gene detail (`GET /api/iconoplasm/admin/gene/PRL`,
`live_sha`) shows D1's winner through the admin read model, which can lag a
refresh; treat it as a hint, not proof.

### 2. Republish the gene from D1

Republishing is the check and the repair in one step. The card builder elects
the winner on every build (B-1063), so a republish can change a gene's portrait:
when the votes, the candidates or a pin say another portrait should win, the
card shows it and `icono_publish_state` follows. An exact tie keeps the portrait
the card already shows. It rewrites `genes/v3/PRL.json` and returns the new
`published_at`; the CDN shows it within about a minute. Up to `MAX_GENES_PER_REQUEST` (8) per call.

```powershell
@'
const token = process.env.ICONOPLASM_ADMIN_TOKEN;
if (!token) throw new Error("ICONOPLASM_ADMIN_TOKEN missing");
const res = await fetch("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/republish", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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
