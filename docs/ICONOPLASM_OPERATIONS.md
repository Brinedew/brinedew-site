# Iconoplasm operations

This is the cheat sheet for answering Iconoplasm data questions from the website/runtime repo.

If you are new to Iconoplasm, read `docs/ICONOPLASM_ONBOARDING.md` first. This file is for live-data operations, not for explaining the product split from scratch.

The short version: if the question is about what the live site knows right now, query the remote D1 database from `d:\Coding\Website` and write the query against the runtime tables here. Do not guess from frontend state, and do not assume the sibling workstation repo has already pushed what you need.

## where to run queries

Run these from `d:\Coding\Website`.

Use the remote database when the question is about production data:

- `npx wrangler d1 execute iconoplasm --remote --command "..."`

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
npx wrangler d1 execute iconoplasm --remote --command "SELECT json_group_array(json_object('gene_symbol', gene_symbol, 'full_name', full_name, 'name_len', name_len)) AS rows_json FROM (SELECT gene_symbol, full_name, LENGTH(TRIM(full_name)) AS name_len FROM icono_gene_essence WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> '' ORDER BY name_len ASC, full_name COLLATE NOCASE ASC, gene_symbol ASC LIMIT 100);"
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
npx wrangler d1 execute iconoplasm --remote --command "SELECT COUNT(*) AS male_count FROM icono_gene_essence WHERE lower(trim(sex)) = 'male' AND trim(COALESCE(full_name, '')) <> '';"
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
2. Signed-in users should never have a real zero-state shelf. The starter trio (`INS`, `LEP`, `GCG`) is part of the contract.

So if an authenticated user appears to have zero discoveries, do not assume the UI is allowed to show that. Check whether the worker failed to seed or return the starter rows.

Admin classic gallery mode is different. That mode should use the classic public gallery path, not a giant fake discoveries payload.

## sanity checks

- If a result looks wrong, confirm you used `--remote`.
- If an authenticated homepage shows `0 discovered`, treat that as a bug, not a harmless edge case.
- If admin classic gallery mode is involved, confirm the page is using the classic gallery route before debugging the shelf API.
- If names look stale or absent, compare `icono_gene_essence` and `icono_gene_catalog` instead of trusting one blindly.
- If published portraits look wrong, that is usually `icono_publish_state` plus `icono_portrait_assets`, not `icono_gene_essence`.

## when to leave this repo

Leave this repo and inspect `d:\Coding\Datasets\iconoplasm` when the problem is about:

- authoring workstation sync
- local reconcile batching
- candidate generation requests before they hit the website runtime
- export/publish logic that has not made it into the live D1 state yet