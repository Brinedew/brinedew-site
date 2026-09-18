# Iconoplasm operations

This is the cheat sheet for answering Iconoplasm data questions from the website/runtime repo.

If you are new to Iconoplasm, read `docs/ICONOPLASM_ONBOARDING.md` first. This file is for live-data operations, not for explaining the product split from scratch.

## Current cutover boundary: 17 September 2026

Read `docs/D1_READ_EXHAUSTION_PREVENTION.md` and Linear B-742/B-749 before
recovery.
During the current production D1 hold, use source inspection and isolated tests.
Do not run production sync, publication retries, queue releases or diagnostic D1
queries. Reconcile the installed revision and current incident status before any
later live operation. A branch passing tests does not activate its behavior.

The intended V2 workflow preserves one independently frozen session/scope and
logical operation identity through save, authority acceptance, publication and
fresh-reader verification. Missing V2 state must recover through its bounded
handover/snapshot protocol or fail closed. Global `run-sync`, a catalog rebuild,
or waiting for every unrelated finalization job is not an ordinary repair path.

Current source still has separate authority mechanisms. The vote coordinator
uses a per-gene `authority_epoch=v2`. Manifestation cutover uses singleton
primary/authoring authority rows and verifies its entire planned set before
activation. B-726 owns reconciling these mechanisms; the vote epoch alone does
not prove complete authoring, caretaker or pending-obligation migration.

Choose the authority before interpreting data. Retained D1 vote/publication rows
are historical/projection input for migrated genes. Public image identity comes
from the exact advertised immutable card view. A V2 view names its baseline and
immutable delta chain; a plain baseline remains valid historical input. Neither
D1 nor a cache may elect substitute public bytes. In the intended V2 workflow, the workstation must be an exact replica and
draft/generation surface, never a second overwrite authority.

For historical portrait incidents, read
`docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`. Historical global-repair examples
are not authorization to restore a retired writer. B-771's component status is
recorded in `plans/B-762-DELETION-INVENTORY.md`.

For gene-label recognition, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`.
Curated page labels are administrator-owned desired state in the primary D1 and
publish first to bounded immutable KV history; they are not a Website Ops catalog
publication. Anonymous manifest, search, and resolver paths split one atomic
alias/blocklist recognition-pair bundle and remain KV-only.

## where to run queries

Run these from `d:\Coding\Website`.

Only after the production hold is lifted and provider-level admission permits
it, use the remote database for an explicitly bounded retained-state question.
First verify that the selected table is authoritative for that gene and state
category. A `LIMIT` bounds returned rows, not scanned rows; use an indexed exact
key and verify query plans offline. Broad analyses belong on a retained local
snapshot instead of the production database.

The executor, rather than the owner, runs approved technical operations:

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
  - retained legacy authoring/vote projection; check the gene's authority epoch before interpreting it; never public image authority
- `icono_portrait_assets`
  - portrait candidates and their asset metadata

## retrieval protocol

1. Decide whether the question is about live runtime data or workstation/control-plane data.
   - Live site question: inspect the installed authority and exact published view in this repo; use D1 only for an admitted exact-key question about retained data.
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

## offline analysis example: shortest male full names

This historical query pattern answers “top 100 shortest full names for genes
marked as male”. Its expression filter and sort can scan the corpus. Run it
against a local retained snapshot; the output limit does not make it a safe
production D1 lookup.

```sql
SELECT gene_symbol, full_name, LENGTH(TRIM(full_name)) AS name_len
FROM icono_gene_essence
WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> ''
ORDER BY name_len ASC, full_name COLLATE NOCASE ASC, gene_symbol ASC
LIMIT 100;
```

What this does:

- uses `icono_gene_essence` because that is where runtime `sex` and curated `full_name` live
- filters to `male`
- ignores blank names
- sorts by trimmed name length first
- breaks ties alphabetically by full name, then by symbol
- returns the top 100 rows from the retained snapshot

If you only need the count first, use the same filter without the list projection:

```sql
SELECT COUNT(*) AS male_count FROM icono_gene_essence
WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> '';
```

## discovery questions

First identify whether the deployed reader uses compact V2 discovery state or
retained legacy rows; B-764 owns this cutover. The query below diagnoses the
legacy projection for one user. It must not overwrite migrated compact state
or serve as an ordinary fallback when the compact reader is unavailable.

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

1. Signed-in personal shelf mode uses `/api/iconoplasm/discoveries/me` and the deployed discovery authority. Retained `icono_gene_discoveries` rows are not a second writer after compact-state migration.
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

## public portrait concordance runbook

Use this when public surfaces show different portraits, or when D1 names a newer
leader and you need to distinguish an expected publication window from a stuck
release.

The authority relationship is:

- The gene's active authority owns its desired selection. D1
  `icono_publish_state` is the retained legacy projection and may differ after
  a per-gene authority transfer.
- The exact advertised immutable card view owns the public portrait. V2 reader
  code resolves `<base>.c<chainHash>` through immutable chain/segment objects;
  `KV_GALLERY_VERSION` alone names only the baseline. Read the installed head
  contract before selecting a version.
- `/api/iconoplasm/cards/:symbol`, site-gene detail, the gene-page lead and
  metadata, public media, signed-in and anonymous galleries, archive ranges,
  image sitemaps, extension cards, and print-copy inputs must all project that
  artifact portrait.
- The shared public edge worker must not add a symbol-only Cache API entry in front of `/api/iconoplasm/cards/:symbol`. Iconoplasm's custom hostname now routes directly to the asset-first stateful worker; shared-host requests can still cross the proxy, which has no KV binding and cannot key by `KV_GALLERY_VERSION`. The stateful worker owns the version-aware card cache in both cases.

Site-gene detail still reads bounded D1 rich detail and candidates, but it
overrides the portrait and candidate `is_current` state with the published-card
SHA. There is no signed-in or gene-detail fallback. Missing or incomplete exact
card state fails closed and uncached instead of selecting the D1 leader.

### diagnose one symbol

Compare the public card, site-gene-detail, and public-media projections:

```powershell
@'
const symbol = "PRL";
const endpoints = [
  {
    surface: "card",
    url: `https://iconoplasm.brinedew.bio/api/iconoplasm/cards/${symbol}`,
  },
  {
    surface: "site-detail",
    url: `https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/${symbol}`,
    headers: { referer: `https://iconoplasm.brinedew.bio/gene/${symbol}` },
  },
  {
    surface: "public-media",
    url: `https://iconoplasm.brinedew.bio/api/public/v1/media/${symbol}`,
  },
];
for (const endpoint of endpoints) {
  const res = await fetch(endpoint.url, {
    headers: { accept: "application/json", ...(endpoint.headers || {}) },
  });
  const payload = await res.json();
  const portrait = payload?.card?.portrait || payload?.portrait || payload?.media || null;
  console.log(JSON.stringify({
    surface: endpoint.surface,
    url: endpoint.url,
    status: res.status,
    cfCacheStatus: res.headers.get("cf-cache-status"),
    portraitSource: res.headers.get("x-iconoplasm-portrait-source"),
    artifactVersion:
      res.headers.get("x-iconoplasm-card-version") ||
      payload?.card_snapshot_version ||
      payload?.diagnostics?.artifact_version ||
      null,
    portraitAsset: portrait?.asset_sha256 || portrait?.checksum_sha256 || null,
    candidateImageId: portrait?.candidate_image_id || null
  }, null, 2));
}
'@ | node -
```

All three public responses must name the same artifact version and portrait SHA.
An uncached `503` with `X-Iconoplasm-Portrait-Source: artifact-unavailable` is a
publication failure, not permission to query D1 for substitute public bytes.

After admission and only for a gene still using the legacy projection, an
exact-key D1 read can show whether that projection is ahead. During the current
hold, do not execute this or the following projection-job query:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, current_asset_sha256, updated_at FROM icono_publish_state WHERE gene_symbol = 'PRL' LIMIT 1"
```

A different D1 SHA is expected while its dirty shard awaits publication, as
long as every public surface remains coherent on the selected card artifact.

Check whether a vote projection job is already queued:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, actor_id, reason, requested_at, last_attempt_at, next_attempt_at, attempts, substr(last_error,1,200) AS last_error FROM icono_vote_projection_refresh_jobs WHERE gene_symbol = 'PRL' LIMIT 1"
```

### recover exact publication without reviving global sync

Retain the original generation output, hashes, session/request IDs, authority
revision, logical operation ID, publication obligations and uncertain receipts.
Do not regenerate saved images, clear a pending job manually, edit
`icono_publish_state`, or advance a public pointer by hand.

Identify the failing stage from that operation's own receipts. For a migrated
gene, recovery must remain on its V2 authority epoch and per-gene publication
attempt. Verify the exact immutable object bytes and advertised view from a
fresh reader. An unrelated gene's backlog must not become its completion gate.
An absent object is not a successful publication and does not authorize a V1
fallback. B-762 owns live per-gene publication acceptance; B-749 additionally
requires the original workstation scope and repeat/restart receipts to agree.

The ordinary `/api/iconoplasm/admin/read-models/sync` handler in this source
rejects missing/empty normalized scope and rejects `full_rebuild`/`fullRebuild`
or `full_vision`/`fullVision` when enabled. Its surviving publication wrapper
still calls the generic gallery publisher without forwarding that scope. This
is a remaining B-749 defect, so a successful scoped HTTP response alone is not
proof of bounded V2 publication. Never bypass a scope refusal with a full flag,
a newly invented operation ID, or a global recovery continuation.

`scripts/repair-iconoplasm-newer-tie-canon.mjs` is permanently retired in source.
Every flag mode exits with `LEGACY_GLOBAL_REPAIR_RETIRED` before network or D1
access. The original May repair is preserved in git history. Its old direct D1
writer and empty-scope final publication are not available as recovery tools.

Historical PRL evidence from 2026-05-20 remains useful for reconciliation:
artifact `mpduzx6k-9e396c96`, asset
`c9d01e44d6ea92e2cc363ee70c50afd85bd1edc893a7ae05a207251fa5d3d576`,
candidate image `31345`. These identifiers do not authorize replaying that
historical repair or deleting a current projection obligation.

### do not repeat the bad repair paths

Avoid these even if they look faster:

- do not trust the frontend candidate count as the source of truth
- do not disguise a partial catalog as a complete baseline; verified V2 per-gene immutable cards and exact delta views are the supported source design
- do not add a D1 fallback to the public card, site-gene-detail, public-media,
  gene-page, gallery, sitemap, or print-copy path
- do not purge the entire Cloudflare zone for one stale card URL
- do not use remote `wrangler dev --test-scheduled` as a repair path for this worker; remote dev does not support the Queue/SQLite Durable Object combination here

## sanity checks

- If a result looks wrong, confirm you used `--remote`.
- If an authenticated homepage shows `0 discovered`, treat that as a bug, not a harmless edge case.
- If admin classic gallery mode is involved, confirm the page is using the classic gallery route before debugging the shelf API.
- If names look stale or absent, compare `icono_gene_essence` and `icono_gene_catalog` instead of trusting one blindly.
- If public portraits look wrong, inspect the exact advertised view, its
  immutable objects and the gene's active authority. Compare retained D1 rows
  only after identifying their epoch and role.

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
3. reconcile the original operation's durable identity, accepted receipts and
   independently frozen membership; resume only the verified bounded V2 path
   after its activation/capacity gates pass. Restored telemetry never authorizes
   global `run-sync` or proves that its consumption defect is fixed.

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

### retained V1 finalization is not the V2 recovery path

The legacy chain was `GUI Sync -> workstation run-sync -> D1 finalization ledger
-> Queue drain -> global pending count reaches zero`. Its retained jobs,
receipts, queue messages and dead-letter state must survive until their accepted
obligations have been reconciled. B-771 removes its executable producers,
consumers, bindings, cron duties and recovery launchers after replacement
consumers are verified. It must not be resumed as the normal path for migrated
operations, and zero global pending jobs is not a V2 success criterion.

No direct Queue kicks, job deletion, ad hoc `/finalization/process`, or synthetic
completion receipts are recovery substitutes. A transport failure preserves the
same durable obligation. Source/configuration retirement must update IPD-004,
IPD-010 and affected authority fences together; documentation alone cannot prove
that a queue or scheduled launcher is unavailable.

The release workflow starts automatically on a push to `main`. A source-only
review branch must stay unmerged while that automatic release would conflict
with the production hold. Keep protected checks intact and record the exact
reviewed revision, test results and any live work still unverified in Linear.

## when to leave this repo

Leave this repo and inspect `d:\Coding\Datasets\iconoplasm` when the problem is about:

- authoring workstation sync
- local reconcile batching
- candidate generation requests before they hit the website runtime
- export/publish logic that has not made it into the live D1 state yet
