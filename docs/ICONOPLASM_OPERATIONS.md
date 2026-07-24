# Iconoplasm operations

This is the cheat sheet for answering Iconoplasm data questions from the website/runtime repo.

If you are new to Iconoplasm, read `docs/ICONOPLASM_ONBOARDING.md` first. This file is for live-data operations, not for explaining the product split from scratch.

The short version: if the question is about what the live site knows right now, query the remote D1 database from `d:\Coding\Website` and write the query against the runtime tables here. Do not guess from frontend state, and do not assume the sibling workstation repo has already pushed what you need.

For canonical portrait voting and public card artifact consistency, read `docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md` before touching data. It contains the PRL split-brain incident, the safe repair path, and the forbidden shortcuts.

For gene-label recognition, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`. Curated page labels are Website manifest configuration, not D1 data and not a Website Ops catalog publication.

## where to run queries

Run these from `d:\Coding\Website`.

Use the remote database when the question is about production data:

- `pnpm exec wrangler d1 execute iconoplasm --remote --command "..."`

If you skip `--remote`, you are not looking at the live data.

## tables you usually want

- `icono_gene_catalog`
  - canonical symbol list, base full names, colors, aliases
- `icono_gene_essence`
  - synced NiceGUI/runtime traits like `sex`, `full_name`, `weight_kg`, `age_years`, `manifestation`
- `icono_gene_discoveries`
  - per-user discovery history
- `icono_publish_state`
  - which portrait is currently live for a gene
- `icono_portrait_assets`
  - portrait candidates and their asset metadata

## retrieval protocol

1. Decide whether the question is about live runtime data or workstation/control-plane data.
   - Live site question: stay in this repo and query remote D1.
   - Authoring/sync pipeline question: check `d:\Coding\Datasets\iconoplasm` first.
2. Prefer the runtime table that already stores the answer.
   - Example: `sex` and curated `full_name` live in `icono_gene_essence`, so use that instead of inferring from UI cards.
3. Ask for exactly the fields you need.
   - This keeps the output readable and makes it easier to paste results back into chat or docs.
4. Sort in SQL, not by hand afterward.
   - If the user wants “shortest names first”, do `ORDER BY LENGTH(TRIM(full_name)) ASC, ...` in the query.
5. When you need a top list, add `LIMIT` directly in SQL.
6. If the output is large, prefer JSON aggregation so one row contains the result set cleanly.

Exception: do **not** JSON-aggregate giant full-catalog payloads just because it looks tidy. For large admin/catalog questions, page or limit the result instead. Giant aggregates can hit D1 size limits and tell you less than you think.

## canonical example: shortest male full names

This is the query pattern used for the “top 100 shortest full names for genes marked as male” request.

```text
pnpm exec wrangler d1 execute iconoplasm --remote --command "SELECT json_group_array(json_object('gene_symbol', gene_symbol, 'full_name', full_name, 'name_len', name_len)) AS rows_json FROM (SELECT gene_symbol, full_name, LENGTH(TRIM(full_name)) AS name_len FROM icono_gene_essence WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> '' ORDER BY name_len ASC, full_name COLLATE NOCASE ASC, gene_symbol ASC LIMIT 100);"
```

What this does:

- uses `icono_gene_essence` because that is where runtime `sex` and curated `full_name` live
- filters to `male`
- ignores blank names
- sorts by trimmed name length first
- breaks ties alphabetically by full name, then by symbol
- returns the top 100 rows in one JSON blob

If you only need the count first, use the same filter without the list projection:

```text
pnpm exec wrangler d1 execute iconoplasm --remote --command "SELECT COUNT(*) AS male_count FROM icono_gene_essence WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> '';"
```

## discovery questions

If the question is about what a specific user has discovered, start with `icono_gene_discoveries` and join names in from catalog or essence if needed.

Shape to remember:

```sql
SELECT
  d.user_id,
  d.gene_symbol,
  COALESCE(NULLIF(TRIM(ge.full_name), ''), NULLIF(TRIM(gc.full_name), ''), d.gene_symbol) AS full_name,
  d.first_discovered_at,
  d.last_encountered_at,
  d.encounter_count
FROM icono_gene_discoveries d
LEFT JOIN icono_gene_essence ge
  ON ge.gene_symbol = d.gene_symbol
LEFT JOIN icono_gene_catalog gc
  ON gc.gene_symbol = d.gene_symbol
WHERE d.user_id = ?
ORDER BY d.first_discovered_at ASC, d.gene_symbol ASC;
```

Why this shape matters:

- these runtime tables already store canonical uppercase `gene_symbol` keys
- joining on the raw key lets SQLite use the indexes
- wrapping both sides in `upper(...)` looks safe but can turn a fast shelf query into a scan and temp sort

## shelf contract

Two rules matter here:

1. Signed-in personal shelf mode comes from `icono_gene_discoveries` through `/api/iconoplasm/discoveries/me`.
2. Signed-in users should never have a real zero-state shelf. The starter trio (`INS`, `RHO`, `PRL`) is part of the contract.

So if an authenticated user appears to have zero discoveries, do not assume the UI is allowed to show that. Check whether the worker failed to seed or return the starter rows.

Admin classic gallery mode is different. That mode should use the classic public gallery path, not a giant fake discoveries payload.

## card/gallery path warning

Before debugging a card or gallery bug, identify the active data path. Do not infer it from visible page text.

The common paths are:

- `/api/public/v1/gallery` for classic public gallery mode
- `/api/iconoplasm/discoveries/me` for the signed-in personal shelf state
- `/api/iconoplasm/account-gallery-window` for supported signed-in order windows
- client-side discovery slicing plus `/api/iconoplasm/mobile-card-manifest`, which must read the live published card-catalog artifact rather than per-gene KV objects or D1-composed fallback cards

There is no universal "next genes the user will see" order across these paths. Do not design cache warming, preloading, or pagination as if one global gallery sequence exists.

Missing rich card data must not make a catalog gene unreachable. Treat per-gene mobile-card VM data as enrichment, not as proof that the gene exists.

## canonical portrait split-brain runbook

Use this when a logged-in/gene-detail surface shows one canonical portrait and the logged-out/home/public card endpoint shows another.

The source-of-truth relationship is:

- D1 `icono_publish_state` decides the current portrait.
- `/api/iconoplasm/cards/:symbol` serves the published full-catalog card artifact from KV, selected through `KV_GALLERY_VERSION`.
- The shared public edge worker must not add a symbol-only Cache API entry in front of `/api/iconoplasm/cards/:symbol`. Iconoplasm's custom hostname now routes directly to the asset-first stateful worker; shared-host requests can still cross the proxy, which has no KV binding and cannot key by `KV_GALLERY_VERSION`. The stateful worker owns the version-aware card cache in both cases.

The public card endpoint must not fall back to D1 composition. If it did, a popular card route could multiply D1 reads across isolates and colos.

### diagnose one symbol

Compare the public card endpoint and the site gene endpoint:

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

Check whether a vote projection job is already queued:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, actor_id, reason, requested_at, last_attempt_at, next_attempt_at, attempts, substr(last_error,1,200) AS last_error FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' LIMIT 1"
```

### repair through the admin sync barrier

Do not hand-edit `icono_publish_state`, `KV_GALLERY_VERSION`, or card artifact KV keys.

Use the authenticated admin read-model sync for the affected symbol. It rebuilds the symbol read models and publishes a new full card-catalog artifact through the normal budget-gated path:

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

If `/api/iconoplasm/cards/PRL` still returns `cf-cache-status: HIT` with the old artifact after the sync succeeds, purge only that one API URL from Cloudflare. This should be a legacy-cache cleanup path, not the normal freshness mechanism:

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

If the endpoints now agree and a stale projection row remains, clear only the completed symbol job so the hourly projection drain does not spend another full artifact publish:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "DELETE FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' AND reason = 'vote_auto_promote'"
```

For the PRL repair on 2026-05-20, the final good state was:

- artifact version `mpduzx6k-9e396c96`
- canonical asset `c9d01e44d6ea92e2cc363ee70c50afd85bd1edc893a7ae05a207251fa5d3d576`
- candidate image `31345`

### do not repeat the bad repair paths

Avoid these even if they look faster:

- do not trust the frontend candidate count as the source of truth
- do not build a symbol-scoped card artifact
- do not add a D1 fallback to the public card endpoint
- do not purge the entire Cloudflare zone for one stale card URL
- do not use remote `wrangler dev --test-scheduled` as a repair path for this worker; remote dev does not support the Queue/SQLite Durable Object combination here

## sanity checks

- If a result looks wrong, confirm you used `--remote`.
- If an authenticated homepage shows `0 discovered`, treat that as a bug, not a harmless edge case.
- If admin classic gallery mode is involved, confirm the page is using the classic gallery route before debugging the shelf API.
- If names look stale or absent, compare `icono_gene_essence` and `icono_gene_catalog` instead of trusting one blindly.
- If published portraits look wrong, that is usually `icono_publish_state` plus `icono_portrait_assets`, not `icono_gene_essence`.

## website ops sync: durable objects telemetry guard

If Website Ops shows a last-finished message like:

`Paused website sync because the local Cloudflare Durable Objects guard lost live telemetry. Website Ops will not keep mutating blindly past the 50% DO ceiling. (live DO telemetry unavailable during candidate ingest batch)`

then treat that as a **real stop condition**, not a flaky retry candidate.

What it means:

- the workstation could no longer read live Cloudflare Durable Objects `rows_written` usage
- the local 50% DO guard therefore could not prove remaining headroom
- the sync intentionally failed closed during a mutating stage instead of guessing

What to do next:

1. fix Cloudflare telemetry/auth first

- check the Website Ops Cloudflare diagnostic in the GUI
- verify `CLOUDFLARE_API_TOKEN` is the account-owned `iconoplasm-admin` token and can read `CLOUDFLARE_ACCOUNT_ID`
- do not use Wrangler OAuth or `cloudflare_auth_cache.json` as a recovery path

2. confirm the DO usage panel is green again
3. only then rerun Website Ops sync

What **not** to do:

- do **not** keep pressing `Run Sync` blindly
- do **not** loosen the DO guard just to get a run through
- do **not** treat repeated retries as progress; they only replay candidate ingest without a trustworthy DO budget reading

This guard is intentional. The problem to fix is telemetry/auth availability, not the existence of the guardrail.

## observability snapshot publication and freshness

The admin Observability tab is fed by Cloudflare GraphQL data collected out of band. The live admin request path must never query GraphQL, D1, or a Durable Object to explain its own telemetry.

Publication contract:

- `.github/workflows/refresh-iconoplasm-observability-snapshot.yml` runs at minute 17 every hour and can also be dispatched manually.
- The generator writes one JSON snapshot, the workflow verifies current Cloudflare KV headroom, and one atomic KV write publishes `iconoplasm:observability-snapshot:v1`.
- The authenticated `/api/iconoplasm/admin/cost/snapshot` endpoint reads that value and falls back to the snapshot bundled by the last production deploy. It remains `no-store` and does no analytics work.
- The application-owned usage ledger is intentionally retired. Cloudflare GraphQL and product dashboards remain the source of operational truth.

Freshness SLA:

- `fresh`: at most 90 minutes old
- `stale`: 91–240 minutes old
- `unavailable`: older than 240 minutes or missing a valid generated-at timestamp

A red scheduled workflow is the publication failure alert. If the admin shows `stale`, `unavailable`, or `deploy fallback`, inspect that workflow before touching runtime telemetry fences or increasing KV budgets.

### finalization has one production path

Website Ops sync finalization has one path only:

`GUI Sync button -> workstation run-sync preflight -> durable D1 finalization ledger -> Cloudflare Queue drain_finalization_ledger -> geneguessr-api queue consumer -> /finalization/pending reaches zero`

Forbidden recovery paths:

- no workstation-side finalization processing
- no `/api/iconoplasm/admin/finalization/process`
- no direct Cloudflare Queue sends outside the worker
- no GitHub Actions Queue kick
- no compatibility shim that marks the run done without `/finalization/pending` reaching zero

If Queue send returns `429` or `QUEUE_SEND_FAILED`, the correct behavior is to fail loud before or during sync, preserve the durable ledger, and fix Cloudflare Queue allowance/account state. Re-running the GUI button without Queue headroom is not progress.

## when to leave this repo

Leave this repo and inspect `d:\Coding\Datasets\iconoplasm` when the problem is about:

- authoring workstation sync
- local reconcile batching
- candidate generation requests before they hit the website runtime
- export/publish logic that has not made it into the live D1 state yet
