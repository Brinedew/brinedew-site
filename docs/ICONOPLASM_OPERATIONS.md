# Iconoplasm operations

This is the cheat sheet for answering Iconoplasm data questions from the website/runtime repo.

If you are new to Iconoplasm, read `docs/ICONOPLASM_ONBOARDING.md` first. This file is for live-data operations, not for explaining the product split from scratch.

## Live operation boundary

Read the [current capacity and background-work runbook](ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md)
and [D1 exhaustion guide](D1_READ_EXHAUSTION_PREVENTION.md) before a live
capacity-consuming operation. Check the installed
Worker mode, fresh account-wide provider meter and the operation's own durable
state before acting. Source tests alone do not prove activation.

A saved output, accepted selection, publication and fresh reader must retain
the same logical operation identity and authority. Missing state requires its
bounded handover or a visible refusal. Global `run-sync`, a catalog rebuild or
an unrelated finalization backlog is not an ordinary per-gene repair path.

Choose the authority before interpreting data. Public image identity comes
from the one stable gene object `genes/v3/<SYMBOL>.json`; D1's
`icono_publish_state` is the projection the publisher writes alongside it.
Neither D1 nor a cache may elect substitute public bytes. The workstation is an exact
replica and draft/generation surface, never a second overwrite authority.

For a gene whose published portrait disagrees with D1, follow the repair in
`docs/ICONOPLASM_CANONICAL_PORTRAIT_PIPELINE.md`.

For gene-label recognition, read `docs/ICONOPLASM_PUBLICATION_ALIASES.md`.
Curated page labels are administrator-owned desired state in the primary D1 and
publish first to bounded immutable KV history; they are not a Website Ops catalog
publication. Anonymous manifest, search, and resolver paths split one atomic
alias/blocklist recognition-pair bundle and remain KV-only.

## where to run queries

Run these from `d:\Coding\Website`.

Only when the installed mode and fresh provider-level admission permit it, use
the remote database for an explicitly bounded retained-state question.
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
  - retained legacy per-user discovery rows (the shelf reads compact V2 state)
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

This query pattern answers “top 100 shortest full names for genes
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

The signed-in shelf reads compact V2 discovery state
(`icono_discovery_user_state_v2` and its chronology,
`workers/iconoplasm/discovery-compact-*.js`). Retained legacy
`icono_gene_discoveries` rows are read only by the per-user compact import
(`workers/iconoplasm/discovery-compact-migrate.js`). The query below diagnoses
one user's legacy rows. It must not overwrite compact state or serve as a
fallback when the compact reader is unavailable.

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
- client-side discovery slicing plus `/api/iconoplasm/mobile-card-manifest`, which reads one stable gene object per symbol rather than D1-composed fallback cards

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
- The stable gene object `genes/v3/<SYMBOL>.json` owns the public portrait.
  Read it from Bunny. It is rewritten in place; its `published_at` is the
  version that public responses report.
- `/api/iconoplasm/cards/:symbol`, site-gene detail, the gene-page lead and
  metadata, public media, signed-in and anonymous galleries, archive ranges,
  image sitemaps, extension cards, and print-copy inputs must all project that
  object's portrait.
- The shared public edge worker must not add a symbol-only Cache API entry in front of `/api/iconoplasm/cards/:symbol`. Iconoplasm's custom hostname routes directly to the asset-first stateful worker; shared-host requests cross the proxy, which has no storage binding. The stateful worker owns the card read in both cases.

Site-gene detail reads bounded D1 rich detail and candidates, but it overrides
the portrait and candidate `is_current` state with the stable object's SHA.
There is no signed-in or gene-detail fallback. A missing or incomplete stable
object fails closed and uncached instead of selecting the D1 leader.

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
    version:
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

All three public responses must name the same stable-object version and portrait SHA.
An uncached `503` with `X-Iconoplasm-Portrait-Source: artifact-unavailable` is a
publication failure, not permission to query D1 for substitute public bytes.

After current provider and operation admission, and only for a gene still using
the legacy projection, an exact-key D1 read can show whether that projection is
ahead. These remote queries consume shared D1 capacity:

```powershell
pnpm exec wrangler d1 execute iconoplasm --remote --config wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml --command "SELECT gene_symbol, current_asset_sha256, updated_at FROM icono_publish_state WHERE gene_symbol = 'PRL' LIMIT 1"
```

A different D1 SHA is expected only until the vote authority's per-gene
publication or the next Actions republish pass rewrites the gene's stable
object; every public surface reads that one object.

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
fallback. Check the original scope and repeat/restart receipts for the same
logical operation.

The ordinary `/api/iconoplasm/admin/read-models/sync` handler rejects
missing/empty scope and `full_rebuild`/`full_vision` flags. The publication wake
processes dirty canonical events under its watermark; it does not use the
caller's scope as a catalog-wide publication instruction. If a scoped operation
is materially charged for unrelated backlog, record its original scope,
receipt and provider cost as a concrete defect. Never bypass a scope refusal
with a full flag, a new operation ID or a global continuation.

### do not repeat the bad repair paths

Avoid these even if they look faster:

- do not trust the frontend candidate count as the source of truth
- do not disguise a partial catalog as a complete one; the per-gene stable objects and the one catalog object are the supported source design
- do not add a D1 fallback to the public card, site-gene-detail, public-media,
  gene-page, gallery, sitemap, or print-copy path
- do not purge the entire Cloudflare zone for one stale card URL
- do not use remote `wrangler dev --test-scheduled` as a repair path for this worker; remote dev does not support the Queue/SQLite Durable Object combination here

## sanity checks

- If a result looks wrong, confirm you used `--remote`.
- If an authenticated homepage shows `0 discovered`, treat that as a bug, not a harmless edge case.
- If admin classic gallery mode is involved, confirm the page is using the classic gallery route before debugging the shelf API.
- If names look stale or absent, compare `icono_gene_essence` and `icono_gene_catalog` instead of trusting one blindly.
- If public portraits look wrong, inspect the gene's stable object, its
  immutable portrait bytes and the gene's active authority. Compare retained D1
  rows only after identifying their epoch and role.

## website ops sync: missing Cloudflare telemetry

Missing telemetry is not a pause (B-897). The workstation budget registry
shows an unreadable meter as `needs_telemetry` and keeps syncing; only a meter
known to have crossed its ceiling pauses sync. The Worker's D1 write admission
is the authority, and it counts every worst-case reservation since its last
same-day provider sample (or since midnight) when a sample is missing.

When a meter is unreadable, fix the credential: `CLOUDFLARE_API_TOKEN` must be
the account-owned `iconoplasm-admin` token that can read `CLOUDFLARE_ACCOUNT_ID`;
do not use Wrangler OAuth or `cloudflare_auth_cache.json` as a recovery path.

## account erasure request

The privacy pages promise erasure. Fulfil a verified request with one command
(B-871):

`POST /api/iconoplasm/admin/accounts/erase` with
`{"account_id": "...", "command_id": "<unique per request>", "reason_code": "user_request"}`
and the admin token.

It requests erasure with the `retain` caretaker policy and completes it: provider
identities are removed, the public name becomes the stable "Former caretaker"
label, and retained history keeps the account id. The account projection outbox
then ends caretaker assignments on its scheduled drain. Re-sending the same
`command_id` replays; a different `command_id` on an erased account refuses.

## observability snapshot publication and freshness

The admin Observability tab is fed by Cloudflare GraphQL data collected out of band. The live admin request path must never query GraphQL, D1, or a Durable Object to explain its own telemetry.

Publication contract:

- `.github/workflows/refresh-iconoplasm-observability-snapshot.yml` owns the hourly snapshot, account headroom check, and per-statement D1 burn check. It can also be dispatched manually. Both checks still run if collection or publication fails; cancellation stops them.
- The generator writes one JSON snapshot. The account check reports every capacity alert but permits its one atomic KV write only when KV write headroom is available; exhausted D1 must not hide fresh telemetry. The key is `iconoplasm:observability-snapshot:v1`.
- The authenticated `/api/iconoplasm/admin/cost/snapshot` endpoint reads that value and falls back to the snapshot bundled by the last production deploy. It remains `no-store` and does no analytics work.
- Cloudflare GraphQL owns account-wide usage truth. The shared operation-cost
  admission ledger reserves work and retains uncertain reservations; it is a
  different owner.

Freshness SLA:

- `fresh`: at most 90 minutes old
- `stale`: 91–240 minutes old
- `unavailable`: older than 240 minutes or missing a valid generated-at timestamp

A red scheduled workflow is the publication failure alert. If the admin shows `stale`, `unavailable`, or `deploy fallback`, inspect that workflow before touching runtime telemetry fences or increasing KV budgets.

### Retained obligations

Retained jobs, receipts, queue messages and dead-letter state must survive until
their accepted obligations are reconciled. Do not resume global finalization
as an ordinary per-gene repair, kick a Queue directly, delete a job or invent a
completion receipt. A transport failure preserves the same durable obligation.
The [current runbook](ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md)
describes the release and background-work paths; a concrete failed operation
belongs in its owning issue with the current source and live receipts.

## when to leave this repo

Leave this repo and inspect the workstation, `d:\Coding\Iconoplasm` (code) and `d:\Coding\Datasets\iconoplasm` (state), when the problem is about:

- authoring workstation sync
- local reconcile batching
- candidate generation requests before they hit the website runtime
- export/publish logic that has not made it into the live D1 state yet
