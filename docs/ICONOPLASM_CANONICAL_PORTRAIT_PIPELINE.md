# Iconoplasm canonical portrait pipeline

This is the architecture and operations note for canonical portrait changes, vote auto-promotion, the public card artifact, and the repair path used during the PRL incident on 2026-05-20.

If you remember one rule, remember this:

**D1 is the current per-gene canonical source. The public card-catalog artifact is a coarse browse snapshot and must not be treated as the freshness layer for individual gene pages or print-copy requests.**

## Architecture

Iconoplasm has two different live read surfaces that are easy to confuse:

- Rich gene/detail surfaces read current runtime state from D1, especially `icono_publish_state`, `icono_portrait_assets`, and candidate/vote read models.
- Logged-out/public card surfaces such as `/api/iconoplasm/cards/:symbol` read a versioned, full-catalog card artifact from KV, keyed by the shared gallery/card version barrier.

That split is intentional. Public card traffic must not rebuild cards from D1 per request, because cold Cloudflare isolates can multiply D1 reads globally. The public card path is:

1. `KV_GALLERY_VERSION` says which card artifact version is live.
2. `readPublishedCardCatalogArtifact(...)` loads the sharded full-catalog artifact from KV.
3. `/api/iconoplasm/cards/:symbol` selects the symbol from that artifact.
4. The public edge proxy stays state-free and does not add a symbol-only Cache API entry in front of that endpoint. It has no KV binding, so it cannot key by `KV_GALLERY_VERSION`; the stateful worker owns the version-aware card cache.

The public artifact is allowed to lag current D1 after vote-driven promotions, but surfaces that are explicitly about one gene must not use that lagging artifact as their final authority. Gene pages, rich candidate panels, and print-copy URLs that carry the displayed `portrait.asset_sha256` resolve against `/api/iconoplasm/site/genes/:symbol` / current D1 canonical state. Browse grids and extension card snapshots continue to use the KV artifact.

Budget note: this is a multi-meter Cloudflare fence, not a D1-only fence. The admin cost cockpit at `/admin#costs` tracks D1, Workers, Durable Objects, KV, Queues, R2, Pages Functions, and Workers observability. The card-catalog publication preflight currently fails closed on `kv_reads`, `kv_writes`, `kv_lists`, `d1_rows_read`, `d1_rows_written`, `queue_operations`, `worker_requests`, `worker_cpu_ms`, `durable_object_requests`, `durable_object_rows_written`, `logs_events`, and `r2_available`. `kv_writes` must cover at least one full catalog artifact publish, not merely the final manifest or gallery-version pointer. Do not fix canonical staleness by bypassing KV, Queue, Worker, Durable Object, R2, or log headroom checks, and do not add a public D1 fallback.

KV publication has a second hard control inside the same stateful-worker choke point: every new card-catalog artifact reserves its estimated KV write cost through the shared budget Durable Object before it writes any KV shards. The default daily reservation ceiling is 900 KV writes, leaving room under Cloudflare's 1000/day free-tier write wall for unrelated settings, manifests, and emergency cleanup. If a future edit adds another path that writes card-catalog KV keys without calling `publishCardCatalogArtifact(...)`, treat it as a production-safety bug.

Frontend gallery caches have the same freshness constraint. Browser storage must not be allowed to skip the manifest/version check before painting gallery cards. IndexedDB can store returned card VMs under the current `snapshot_version`, but `/api/iconoplasm/mobile-card-manifest` must be contacted before the page renders so the browser learns the current `KV_GALLERY_VERSION`. A cache-first optimization here can make one browser keep showing old canonical portraits even after the gene page and backend artifact have moved on.

Gene page HTML shells have a separate freshness trap. `/gene/:symbol` must embed its first-paint lead card from the canonical detail endpoint, not from `/api/iconoplasm/cards/:symbol`. The per-symbol HTML shell cache key must include the current canonical detail asset, so a symbol-only 300-second HTML cache cannot freeze the old lead card while the hydrated candidate list has already moved. The client must also prefer rich `/api/iconoplasm/site/genes/:symbol` detail before falling back to the public card artifact, and print-copy generation must honor a displayed asset hash only if current gene detail confirms that hash is canonical.

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

The critical invariant is now authority separation. Step 7 changes the current per-gene canonical state, so one-gene surfaces must read D1-backed detail and converge immediately. The full public card artifact should move only through explicit publication/sync work, because publishing it for every vote can burn the daily KV write budget. Do not run canonical promotion from request `waitUntil`; that path can still be interrupted before read models settle.

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
- One full catalog publish wrote roughly 27 KV objects at the current catalog size: 26 shards plus the manifest. A gallery invalidation also writes the shared `KV_GALLERY_VERSION` barrier.

Root cause:

`invalidateGalleryCache(...)` minted a random artifact version for each invalidation. That made repeated read-model/admin sync work rewrite the full public card-catalog artifact even when the public card material had not changed.

Fix landed in commit `9a3bd1e6`:

- Card-catalog artifact versions are now content-addressed with the `ccv1-...` prefix.
- Publishing reuses an existing artifact when the public card material is unchanged.
- Repeated identical gallery invalidation writes zero KV keys.
- A regression test proves the first invalidation writes the artifact and the second identical invalidation does not write.

Follow-up hardening:

- `kv_writes` preflight now requires full-publish headroom.
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

## Safe Repair Procedure

Use this when one gene's D1 canonical and public card artifact disagree.

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

Use the admin endpoint for the affected symbol. This rebuilds the symbol read models and publishes a new full card-catalog artifact through the normal budget-gated barrier.

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
    invalidate_gallery: true,
    skip_dashboard: true,
  }),
});
console.log(JSON.stringify({ status: res.status, payload: await res.json() }, null, 2));
'@ | node -
```

Expected result:

- `ok: true`
- `symbols: 1`
- `card_catalog.artifact_version` is a new version
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

If the admin sync already advanced the artifact and live endpoints agree, clear the completed symbol's stale queued job so the hourly processor does not spend another full artifact publish on the same repair.

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

When D1 had new canonical B but the public lead card still came from old artifact A:

- the page lead/public card showed A
- the candidate list from rich D1 data correctly included A as a non-current candidate
- B could be hidden from candidate thumbnails because it was current in D1

That makes the user see "old canonical duplicated as a candidate" and "the candidate I voted on disappeared." The real failure is not candidate deletion. It is D1/artifact split-brain.
