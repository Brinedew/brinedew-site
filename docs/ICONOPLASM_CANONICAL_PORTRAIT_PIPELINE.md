# Iconoplasm published source-portrait pipeline

This is the architecture and operations note for source-portrait selection, vote auto-promotion, the public card artifact, and the repair path used during the PRL incident on 2026-05-20.

If you remember one rule, remember this:

**D1 is the authoring and vote-projection source. The exact card artifact selected by `KV_GALLERY_VERSION` is the sole published source-portrait selection. The canonical public machine image is the workstation-rendered gene blot tied to that exact card.**

## Image ontology

- **Portrait** is the generated character image selected by `asset_sha256`. It is source material.
- **Gene blot** is the exact shared `image-only` card composition: portrait cover crop, protection gradient, full gene name at bottom left, and symbol at bottom right. Its verified 768x1024 WebP is the canonical public/search image.
- **High-resolution print copy** is the separate requested 1536x2048 PNG workflow. It is not the canonical search image.

Only the Iconoplasm workstation renders canonical blots. Cloudflare accepts authenticated verified WebP uploads, records the one-row-per-gene materialization ledger, publishes the reference in exact card artifacts, and serves bytes. Public GET/HEAD requests never render or enroll blots.

## Architecture

Iconoplasm has two coordinated read responsibilities that are easy to confuse:

- Rich detail and candidate state comes from D1, especially `icono_gene_essence`, `icono_portrait_assets`, and candidate/vote read models.
- Every published source-portrait selection comes from the versioned card artifact selected by the shared gallery/card version barrier. Every public blot reference must match that same exact card.

That split is intentional. Public card traffic must not rebuild cards from D1 per request, because cold Cloudflare isolates can multiply D1 reads globally. The public card path is:

1. `KV_GALLERY_VERSION` says which card artifact version is live.
2. `readPublishedCardCatalogArtifact(...)` loads the sharded full-catalog artifact from KV.
3. `/api/iconoplasm/cards/:symbol` selects the symbol from that artifact.
4. The public edge proxy stays state-free and does not add a symbol-only Cache API entry in front of that endpoint. It has no KV binding, so it cannot key by `KV_GALLERY_VERSION`; the stateful worker owns the version-aware card cache.

The public artifact is allowed to lag authoring D1 after vote-driven promotions. That lag is an explicit publication boundary, not permission for public surfaces to expose the unpublished SHA. `/api/iconoplasm/site/genes/:symbol` combines live D1 detail/candidates with a portrait override from the exact card artifact; candidate `is_current` flags use that same published SHA. Before dirty-shard publication can advance a changed card, the workstation must upload the matching blot. A successful release moves the published source portrait and public blot together.

Budget note: this is a multi-meter Cloudflare fence, not a D1-only fence. The admin cost cockpit at `/admin#costs` tracks D1, Workers, Durable Objects, KV, Queues, R2, Pages Functions, and Workers observability. The card-catalog publication preflight currently fails closed on `kv_reads`, `kv_writes`, `kv_lists`, `d1_rows_read`, `d1_rows_written`, `queue_operations`, `worker_requests`, `worker_cpu_ms`, `durable_object_requests`, `durable_object_rows_written`, `logs_events`, and `r2_available`. `kv_writes` must cover at least one full catalog artifact publish, not merely the final manifest or gallery-version pointer. Do not fix canonical staleness by bypassing KV, Queue, Worker, Durable Object, R2, or log headroom checks, and do not add a public D1 fallback.

KV publication has a second hard control inside the same stateful-worker choke point: every new card-catalog artifact reserves its estimated KV write cost through the shared budget Durable Object before it writes any KV shards. The default daily reservation ceiling is 900 KV writes, leaving room under Cloudflare's 1000/day free-tier write wall for unrelated settings, manifests, and emergency cleanup. If a future edit adds another path that writes card-catalog KV keys without calling `publishCardCatalogArtifact(...)`, treat it as a production-safety bug.

Frontend gallery caches have the same freshness constraint. Browser storage must not be allowed to skip the manifest/version check before painting gallery cards. IndexedDB can store returned card VMs under the current `snapshot_version`, but `/api/iconoplasm/mobile-card-manifest` must be contacted before the page renders so the browser learns the current `KV_GALLERY_VERSION`. A cache-first optimization here can make one browser keep showing an old blot composition after the gene page and backend artifact have moved on.

Gene page HTML shells have a separate freshness trap. `/gene/:symbol` embeds its first-paint lead card from `/api/iconoplasm/site/genes/:symbol`; that response is complete rich detail whose portrait is already overridden from the exact published card. Its ETag covers the card version and complete payload, so a symbol-only HTML cache cannot cross either a release or a rich-detail change. Print-copy generation must accept only the portrait from that same published card artifact. An `asset=` parameter is an assertion against that artifact, not an override: malformed values fail with `400`, and a valid SHA that differs from the artifact portrait fails with `409`. Never restore a `geneRecord(...)`, site-gene-detail, or other D1 fallback for print-copy enrollment, status, rendering, or download.

## Vote Auto-Promotion Flow

Normal public voting goes through this path:

1. `/api/iconoplasm/votes/set`
2. `IconoplasmVoteCoordinator` Durable Object records the settled per-user vote for one gene.
3. The worker projects the settled vote into D1 compatibility/event tables.
4. The worker enqueues `icono_vote_projection_refresh_jobs` and sends an `ICONOPLASM_VOTE_PROJECTION_QUEUE` message.
5. The Cloudflare Queue consumer drains the queued symbol and calls `processVoteProjectionRefreshForSymbol(...)`.
6. `processVoteProjectionRefreshForSymbol(...)` reads coordinator summaries for that gene.
7. `autoPromoteTopVotedPortraitFromCoordinatorState(...)` may update `icono_publish_state`.
8. `refreshProjectedVoteReadModelsFromCoordinatorState(...)` rebuilds symbol/vision read models.
9. The projection job is cleared after the D1 canonical/read-model work succeeds. It must not publish the full public card-catalog artifact per vote.

The critical invariant is authority separation. Step 7 changes authoring state,
while the published source portrait advances through one explicit card-artifact
publication. That exact card immediately determines the expected blot
fingerprint and Bunny key; the later workstation upload does not republish KV.
Publishing for every individual vote can still burn the daily KV budget, so the
dirty-shard release remains the canonical barrier. A vote updates coordinator and
D1 authoring state; only a leader change marks the owning shard dirty. The bounded
publisher has historically coalesced those changes behind a 15-minute window.
That describes existing implementation, not the current product target: the
2026-08-27 owner clarification in `ICONOPLASM_PRODUCT_OPERATING_MODEL.md` retains
60-second availability for fresh loads/reloads while allowing unreloaded
articles to keep their images. Bringing the publisher/reload path into compliance
still requires implementation and measured verification; do not bypass budget
guards or introduce a second publisher. Each bounded step rewrites at most six
dirty shards and publishes through one `KV_GALLERY_VERSION` barrier. The extension portrait
locator is then projected on read from that same card payload. It does not create a
new artifact, KV write, or per-vote republish. Do not poll site detail
waiting for an unpublished SHA, and do not run canonical promotion from request
`waitUntil`.

The workstation closes that deliberate gap through the Drain-owned priority
lane. While no generation request is running, Drain asks the authenticated blot
backlog for canonical-affecting symbols after the exact published watermark.
That lookup excludes `gene_card_materialized` and `gene_blot_materialized`, is
hard-capped at 100 symbols, and returns no more than 25 missing renders. Drain
persists and uploads those exact card-derived blots. The normal dirty-shard
publisher is not gated by the render queue: it publishes the canonical card,
and the stable blot route starts resolving the deterministic object when upload
completes. Drain never changes D1 canonical state or publishes an unmatched
image. Transient failure backs off for five
minutes; daily KV exhaustion sleeps until the next UTC budget day. The old
artifact remains coherently live.

## Automatic Canonical Tie-Breaker

Automatic promotion uses one ranking rule everywhere it chooses a leader:

1. highest vote score
2. non-legacy before legacy
3. highest upvote count
4. newest `created_at`
5. existing current asset only as a stability fallback
6. lowest asset SHA as the final deterministic fallback

The existing current asset is not protected from an equally voted newer asset. If a newer blot has the same score and upvote count, it should become canonical. The only durable "do not move this automatically" protection is `admin_override = 1` in `icono_publish_state`.

Keep the direct D1 auto-promotion SQL, the Queue-backed coordinator projection comparator, and the admin read-model leader SQL in the same order. If they drift, the admin view can name one leader while the vote projection publishes another.

## Automatic Canonical Tie-Breaker

Automatic promotion uses one ranking rule everywhere it chooses a leader:

1. highest vote score
2. non-legacy before legacy
3. highest upvote count
4. newest `created_at`
5. existing current asset only as a stability fallback
6. lowest asset SHA as the final deterministic fallback

The existing current asset is not protected from an equally voted newer asset. If a newer blot has the same score and upvote count, it should become canonical. The only durable "do not move this automatically" protection is `admin_override = 1` in `icono_publish_state`.

Keep the direct D1 auto-promotion SQL, the Queue-backed coordinator projection comparator, and the admin read-model leader SQL in the same order. If they drift, the admin view can name one leader while the vote projection publishes another.

## 2026-05-20 PRL Failure

Observed symptom:

- A logged-in user upvoted a PRL candidate and saw it become canonical.
- Logged-out PRL cards still showed the old canonical even after hard refresh.
- The old canonical also appeared as a candidate, making the candidate list look duplicated.
- The newly upvoted candidate appeared to disappear because it had become current in D1, while the public lead card still came from the old artifact.

Live evidence:

- `/api/iconoplasm/site/genes/PRL` showed D1 canonical asset `c9d01e44...`, candidate image `31345`.
- `/api/iconoplasm/cards/PRL` was still an edge cache HIT on old artifact `mpcygacc-e0cbc2cc`, with old asset `f5b9e239...`, candidate image `25515`.
- PRL still had a due row in `icono_vote_projection_refresh_jobs`.
- Follow-up hardening removed the public edge worker's symbol-only Cache API layer for `/api/iconoplasm/cards/:symbol`. That cache could not observe `KV_GALLERY_VERSION`, so it could keep serving a stale logged-out card even after the stateful worker had published the new artifact.

Root cause:

The old projection flow could mutate `icono_publish_state` before the card-catalog artifact publication succeeded. If artifact publication failed or did not run, D1 and the public artifact split.

Fix landed in commit `06ff1bbd`:

- `processVoteProjectionRefreshForSymbol(...)` now runs `assertIconoplasmCardCatalogBudgetPreflight(env)` before any auto-promotion mutation.
- If artifact publication fails after a promotion, `rollbackVoteAutoPromoteAfterProjectionFailure(...)` conditionally rolls back `icono_publish_state`.
- The rollback only applies when the row still points at the asset this projection promoted and `admin_override` is still off, so it will not undo a newer admin action or later successful promotion.
- Regression tests cover both missing preflight and failed artifact publication.

## 2026-05-29 KV Write-Cap Failure

Observed symptom:

- Cloudflare warned that Workers KV exceeded the free daily write limit of 1000 operations.
- Public reads mostly continued, but any Worker path that needed `KV.put(...)` could fail with 429 until the UTC reset.
- The failure coincided with social traffic, but the write spike was not caused by normal public card reads.

Live evidence:

- KV writes were 2770 on 2026-05-26, 1390 on 2026-05-27, and 1360 on 2026-05-28.
- KV reads stayed modest on those days: 1050, 1470, and 1260.
- The production namespace had 7971 `iconoplasm:card-catalog:` keys; 7917 were stale artifact shards/manifests.
- The removed whole-catalog publisher wrote roughly 27 KV objects at the current catalog size: 26 shards plus the manifest. Its invalidation step also wrote the shared `KV_GALLERY_VERSION` barrier.

Root cause:

The removed `invalidateGalleryCache(...)` implementation minted a random artifact version for each invalidation. Repeated read-model/admin sync work therefore rewrote the complete public card catalog even when the public card material had not changed.

Fix landed in commit `9a3bd1e6`:

- Card-catalog artifact versions are now content-addressed with the `ccv1-...` prefix.
- Publishing reuses an existing artifact when the public card material is unchanged.
- Repeated identical gallery invalidation writes zero KV keys.
- A regression test proves the first invalidation writes the artifact and the second identical invalidation does not write.

That 2026-05 content-addressing fix was necessary but not sufficient. B-695
removed whole-catalog publication from steady state entirely. Current routine
publication is `publishIconoplasmGalleryDirtyShards(...)`: it admits at most six
dirty baseline shards per invocation and never falls back to complete-catalog
work.

Current hardening:

- `kv_writes` preflight reserves at most the bounded dirty-shard step ceiling (16 writes), not hypothetical complete-catalog headroom.
- Production enables card-catalog budget preflight and the shared KV write-budget reservation.
- The budget watch workflow checks Cloudflare KV read/write/list/delete headroom every two hours and fails visibly before the free-tier wall is hit.
- `scripts/cleanup-iconoplasm-stale-card-catalog-kv.mjs` is the only approved cleanup path for stale card-catalog KV bloat.

Stale KV artifact cleanup:

Run a dry-run first:

```powershell
pnpm exec node scripts/cleanup-iconoplasm-stale-card-catalog-kv.mjs --max-delete=900
```

If the output keeps only the current and previous gallery versions, execute one capped batch:

```powershell
pnpm exec node scripts/cleanup-iconoplasm-stale-card-catalog-kv.mjs --max-delete=900 --execute
```

Do not run repeated delete batches on the free plan without checking the current day's KV delete usage. Deletes share the same 1000/day free-tier bucket as writes and lists.

## Publication Diagnosis and Safe Repair

Use this when one gene's D1 authoring SHA and public card artifact disagree longer than the expected publication window, or when the publication watermark claims the D1 event is already included. A short-lived difference before the next release is expected.

### 1. Confirm the split with narrow reads

Do not run a broad report first. Check the one symbol.

```powershell
@'
const symbol = "PRL";
for (const url of [
  `https://iconoplasm.brinedew.bio/api/iconoplasm/cards/${symbol}`,
  `https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/${symbol}`
]) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const payload = await res.json();
  const portrait = payload?.card?.portrait || payload?.portrait || payload?.gene?.portrait || null;
  console.log(JSON.stringify({
    url,
    status: res.status,
    cfCacheStatus: res.headers.get("cf-cache-status"),
    artifactVersion: payload?.diagnostics?.artifact_version || null,
    portraitAsset: portrait?.asset_sha256 || null,
    candidateImageId: portrait?.candidate_image_id || null
  }, null, 2));
}
'@ | node -
```

Check the queued projection row for the same symbol:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, actor_id, reason, requested_at, last_attempt_at, next_attempt_at, attempts, substr(last_error,1,200) AS last_error FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' LIMIT 1"
```

### 2. Deploy the invariant fix first

Do not repair data while the old code path can recreate the split.

Required tests before deploy:

```powershell
pnpm test workers/iconoplasm.vote-coordinator-routing.test.js workers/iconoplasm.d1-cost-barrier.test.js workers/iconoplasm.d1-hot-query-guard.test.js workers/iconoplasm.do-not-delete-cost-guards.test.js workers/iconoplasm.card-catalog-budget-preflight.test.js
```

Use the normal production workflow, not a local one-off Worker upload, unless the documented deploy path is blocked.

### 3. Republish through the authenticated admin sync path

Use the admin endpoint for the affected symbol. This updates the symbol read
models and asks the budget-gated publisher to replace only the owning dirty
shard. Unrelated shard references remain unchanged.

```powershell
@'
const token = process.env.ICONOPLASM_ADMIN_TOKEN;
if (!token) throw new Error("ICONOPLASM_ADMIN_TOKEN missing");
const res = await fetch("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/read-models/sync", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "x-iconoplasm-admin-token": token,
  },
  body: JSON.stringify({
    symbols: ["PRL"],
    publish_gallery_dirty_shards: true,
    skip_dashboard: true,
  }),
});
console.log(JSON.stringify({ status: res.status, payload: await res.json() }, null, 2));
'@ | node -
```

Expected result:

- `ok: true`
- `symbols: 1`
- `card_catalog.artifact_version` is a new version when the public card bytes changed
- budget data is present and not exhausted across the Cloudflare barrier set, not only D1

For PRL, this produced artifact `mpduzx6k-9e396c96`.

### 4. Purge only the stale card URL if the CDN still serves the old artifact

After artifact publication, `/api/iconoplasm/cards/:symbol` can still be a Cloudflare CDN HIT for the old response. A browser hard refresh does not necessarily bypass that outer cache.

Purge the exact API URL, not the whole zone:

```powershell
@'
const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = "011c9fff052a2bcce10eec371a788771"; // brinedew.bio
const files = ["https://iconoplasm.brinedew.bio/api/iconoplasm/cards/PRL"];
const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json",
  },
  body: JSON.stringify({ files }),
});
console.log(JSON.stringify({ status: res.status, payload: await res.json() }, null, 2));
'@ | node -
```

### 5. Clear only completed stale projection rows

If the admin sync already advanced the artifact and live endpoints agree, clear
the completed symbol's stale queued job so the projection worker does not repeat
already-settled promotion work.

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "DELETE FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' AND reason = 'vote_auto_promote'"
```

Then verify the row is gone:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, requested_at, attempts, substr(last_error,1,160) AS last_error FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' LIMIT 1"
```

### 6. Verify both surfaces

Both endpoints should now name the same asset and candidate image.

For PRL after repair:

- public card artifact: `mpduzx6k-9e396c96`
- canonical asset: `c9d01e44d6ea92e2cc363ee70c50afd85bd1edc893a7ae05a207251fa5d3d576`
- candidate image: `31345`

## What Not To Do

Do not repair this class of bug by:

- manually writing `icono_publish_state` without publishing a new card artifact
- manually writing `KV_GALLERY_VERSION`
- creating a symbol-scoped card artifact; the public artifact must cover the full catalog
- adding a public D1 fallback to `/api/iconoplasm/cards/:symbol`
- running vote auto-promotion from request `waitUntil` instead of the Cloudflare Queue drain
- trusting a frontend zero/candidate count as the source of truth
- running broad full-catalog D1 reports before a symbol-scoped diagnosis
- purging the entire Cloudflare zone when one API URL is stale
- relying on remote `wrangler dev --test-scheduled` for this worker; remote dev does not support the Queue/SQLite Durable Object combination this worker binds

## Why The Old Candidate Looked Duplicated

The removed mixed-authority implementation could combine artifact A with D1 canonical B:

- the page lead/public card showed A
- the candidate list marked B current from D1 and treated displayed A as non-current
- B could disappear from candidate thumbnails while displayed A appeared duplicated

The current site-detail projection passes artifact A as the canonical override when it builds candidates. A stays current until publication; D1-only B remains visible as a candidate. The real failure was mixed authority, not candidate deletion.

## 2026-08-02 B-700 Signed-In Account Gallery Split

**ARCHITECTURE FENCE [IPD-011]** protects the account-gallery seam that is easy
to mistake for a harmless image-only optimization.

Observed visual evidence in one logged-in Edge session:

- homepage ZNF25: old light-purple skin;
- `/gene/ZNF25`: current dark-gray skin;
- a fresh cache-busting homepage navigation still showed the old image.

That last observation rejected the ordinary stale-browser-cache hypothesis. It
also explained why guest and substitute-browser checks were misleading: they
did not traverse the signed-in `account-gallery-window?view=image-only` branch.

The branch had three potential portrait identities:

1. the discovery row's historical `asset_sha256`;
2. the separately versioned `publishedPortraitRefs(...)` snapshot; and
3. the published card VM selected by `KV_GALLERY_VERSION`.

Only the third participates in routine dirty-shard publication and represents
the browse snapshot that the homepage is supposed to display. Keeping URL and
SHA atomic inside option 2 was insufficient: an internally consistent old URL
and old SHA are still the wrong canonical portrait. The bug was architectural,
not a malformed response.

Commit `afd6f6eb` removed the image-only early return and made both account
variants load the same bounded set of card VMs from the current published card
artifact. The compact response is derived from those VMs. Discovery rows remain
the authority for account membership/order only.

Rollback rule: do not restore a separate portrait snapshot to make the
image-only response cheaper. If performance changes are needed, retain the
single `KV_GALLERY_VERSION` and `readPublishedCardCatalogArtifact(...)` path,
then optimize its indexed shard reads or projection. Acceptance requires a
logged-in same-session visual comparison of the affected homepage card and gene
page; API payloads, hashes, D1 rows, and guest-browser screenshots are supporting
evidence, not substitutes for the user-visible outcome.
