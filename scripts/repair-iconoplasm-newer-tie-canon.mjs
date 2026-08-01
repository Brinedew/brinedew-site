#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import toml from "toml"

const flagsWithValues = new Set(["--reason", "--actor", "--chunk-size", "--base-url"])
const booleanFlags = new Set(["--apply-d1", "--sync-events", "--verify-only"])

function readFlagValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return ""
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) fail(`${flag} requires a value.`)
  return String(value).trim()
}

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (flagsWithValues.has(arg)) {
    index += 1
    continue
  }
  if (booleanFlags.has(arg)) continue
  fail(`Unknown argument: ${arg}`)
}

const args = new Set(process.argv.slice(2))
const applyD1 = args.has("--apply-d1")
const syncEvents = args.has("--sync-events")
const verifyOnly = args.has("--verify-only")
const reason = readFlagValue("--reason") || "newer_tied_canonical_backfill_2026_05_29"
const actor = readFlagValue("--actor") || "codex_newer_tie_backfill"
const chunkSize = Math.max(1, Math.min(1000, Number(readFlagValue("--chunk-size") || 1000) || 1000))
const baseUrl = readFlagValue("--base-url") || "https://iconoplasm.brinedew.bio"
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim()
const cloudflareToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim()
const adminToken = String(process.env.ICONOPLASM_ADMIN_TOKEN || "").trim()
const targetTable = "icono_ops_newer_tie_backfill_20260529"
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")
const statefulWranglerConfigPath = path.join(
  projectRoot,
  "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
)

function fail(message) {
  console.error(`[iconoplasm-newer-tie-repair] ${message}`)
  process.exit(1)
}

if (verifyOnly && (applyD1 || syncEvents)) {
  fail("--verify-only cannot be combined with --apply-d1 or --sync-events.")
}

if (!accountId) fail("CLOUDFLARE_ACCOUNT_ID is missing.")
if (!cloudflareToken) fail("CLOUDFLARE_API_TOKEN is missing.")
if (!adminToken) fail("ICONOPLASM_ADMIN_TOKEN is missing.")

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

async function loadProductionIconoplasmDatabaseId() {
  const parsed = toml.parse(await readFile(statefulWranglerConfigPath, "utf8"))
  const iconoplasmDb = (parsed.d1_databases || []).find(
    (entry) => entry?.binding === "ICONOPLASM_DB",
  )
  if (!iconoplasmDb?.database_id) {
    fail("Could not find the production ICONOPLASM_DB database_id in the stateful Wrangler config.")
  }
  return String(iconoplasmDb.database_id)
}

const databaseId = await loadProductionIconoplasmDatabaseId()

async function d1Query(sql) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${cloudflareToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(120_000),
    },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success) {
    fail(`D1 query failed (${response.status}): ${JSON.stringify(payload || {}).slice(0, 1000)}`)
  }
  return payload.result || []
}

async function adminGet(pathname) {
  const response = await fetch(new URL(pathname, baseUrl), {
    headers: {
      accept: "application/json",
      "x-iconoplasm-admin-token": adminToken,
    },
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    fail(`Admin ${pathname} failed (${response.status}): ${JSON.stringify(payload).slice(0, 1000)}`)
  }
  return payload
}

async function assertD1WriteHeadroom(repairTargets) {
  const targets = Math.max(0, Number(repairTargets || 0) || 0)
  if (targets <= 0) return null
  const estimatedRowsWritten = targets * 4 + 10_000
  const policy = await adminGet("/api/iconoplasm/admin/mutation-limiter/policy")
  const limiter = policy.mutation_limiter || {}
  const remaining =
    limiter.rows_written_target_remaining === null ||
    limiter.rows_written_target_remaining === undefined
      ? null
      : Number(limiter.rows_written_target_remaining)
  if (limiter.target_cap_reached || remaining === null || !Number.isFinite(remaining)) {
    fail(
      `D1 repair refused because mutation headroom is not usable: ${JSON.stringify(limiter).slice(
        0,
        1000,
      )}`,
    )
  }
  if (remaining < estimatedRowsWritten) {
    fail(
      `D1 repair refused: estimated ${estimatedRowsWritten} rows written for ${targets} targets, but only ${remaining} target rows remain.`,
    )
  }
  return {
    estimated_rows_written: estimatedRowsWritten,
    rows_written_target_remaining: remaining,
    target_rows_written_ceiling: limiter.target_rows_written_ceiling ?? null,
  }
}

function repairTargetSql() {
  return `
WITH candidate AS (
  SELECT
    pa.gene_symbol,
    pa.asset_sha256,
    COALESCE(pa.created_at, '') AS created_at,
    COALESCE(pa.is_legacy, 0) AS is_legacy,
    COALESCE(vs.score, 0) AS score,
    COALESCE(vs.upvotes, 0) AS upvotes
  FROM icono_portrait_assets pa
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
  WHERE COALESCE(pa.autopick_eligible, 1) = 1
    AND COALESCE(pa.status, '') <> 'rejected'
    AND COALESCE(pa.is_stale, 0) = 0
    AND COALESCE(pa.asset_sha256, '') <> ''
), ranked AS (
  SELECT
    c.*,
    ps.current_asset_sha256,
    COALESCE(ps.admin_override, 0) AS admin_override,
    ROW_NUMBER() OVER (
      PARTITION BY c.gene_symbol
      ORDER BY
        c.score DESC,
        CASE WHEN c.is_legacy = 0 THEN 1 ELSE 0 END DESC,
        c.upvotes DESC,
        c.created_at DESC,
        CASE WHEN ps.current_asset_sha256 = c.asset_sha256 THEN 1 ELSE 0 END DESC,
        c.asset_sha256 ASC
    ) AS rn
  FROM candidate c
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = c.gene_symbol
)
SELECT
  gene_symbol,
  current_asset_sha256 AS from_asset_sha256,
  asset_sha256 AS to_asset_sha256,
  score,
  upvotes,
  created_at
FROM ranked
WHERE rn = 1
  AND COALESCE(admin_override, 0) = 0
  AND COALESCE(current_asset_sha256, '') <> COALESCE(asset_sha256, '')`
}

async function mismatchSummary() {
  const result = await d1Query(`
WITH targets AS (${repairTargetSql()})
SELECT
  COUNT(*) AS targets,
  SUM(CASE WHEN COALESCE(score, 0) <> 0 THEN 1 ELSE 0 END) AS nonzero_score_targets,
  SUM(CASE WHEN COALESCE(score, 0) = 0 THEN 1 ELSE 0 END) AS zero_score_targets
FROM targets`)
  return result[0]?.results?.[0] || { targets: 0, nonzero_score_targets: 0, zero_score_targets: 0 }
}

async function applyD1Repair() {
  await d1Query(`DROP TABLE IF EXISTS ${targetTable}`)
  await d1Query(
    `CREATE TABLE ${targetTable} (gene_symbol TEXT, from_asset_sha256 TEXT, to_asset_sha256 TEXT, score INTEGER, upvotes INTEGER, created_at TEXT)`,
  )
  await d1Query(
    `INSERT INTO ${targetTable} (gene_symbol, from_asset_sha256, to_asset_sha256, score, upvotes, created_at) ${repairTargetSql()}`,
  )
  const countResult = await d1Query(`SELECT COUNT(*) AS repair_targets FROM ${targetTable}`)
  const repairTargets = Number(countResult[0]?.results?.[0]?.repair_targets || 0)
  await d1Query(`
INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
SELECT gene_symbol, to_asset_sha256, ${sqlString(actor)}, CURRENT_TIMESTAMP, 0
FROM ${targetTable}
WHERE true
ON CONFLICT(gene_symbol) DO UPDATE SET
  current_asset_sha256 = excluded.current_asset_sha256,
  admin_override = 0,
  updated_by = excluded.updated_by,
  updated_at = CURRENT_TIMESTAMP`)
  await d1Query(`
INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at)
SELECT gene_symbol, NULLIF(from_asset_sha256, ''), to_asset_sha256, 'auto_promote', ${sqlString(actor)}, ${sqlString(reason)}, CURRENT_TIMESTAMP
FROM ${targetTable}`)
  await d1Query(`DROP TABLE ${targetTable}`)
  return repairTargets
}

async function symbolsFromEvents() {
  const result = await d1Query(`
SELECT DISTINCT gene_symbol
FROM icono_publish_events
WHERE actor = ${sqlString(actor)}
  AND reason = ${sqlString(reason)}
ORDER BY gene_symbol ASC`)
  return (result[0]?.results || []).map((row) => String(row.gene_symbol || "")).filter(Boolean)
}

async function adminPost(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-iconoplasm-admin-token": adminToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    fail(`Admin ${path} failed (${response.status}): ${JSON.stringify(payload).slice(0, 1000)}`)
  }
  return payload
}

async function syncReadModels(symbols) {
  const chunks = []
  for (let index = 0; index < symbols.length; index += chunkSize) {
    const chunk = symbols.slice(index, index + chunkSize)
    const result = await adminPost("/api/iconoplasm/admin/read-models/sync", {
      symbols: chunk,
      publish_gallery_dirty_shards: false,
      skip_vote_summaries: true,
      skip_vision_rollups: true,
      skip_dashboard: true,
    })
    chunks.push({
      start: index,
      requested: chunk.length,
      processed: Number(result.symbols || 0),
      partial: Boolean(result.partial),
      stop_reason: result.stop_reason || null,
    })
    if (result.partial) fail(`Read-model sync stopped early: ${JSON.stringify(chunks.at(-1))}`)
  }
  const finalPublish = await adminPost("/api/iconoplasm/admin/read-models/sync", {
    symbols: [],
    publish_gallery_dirty_shards: true,
    skip_vote_summaries: true,
    skip_gene_rollups: true,
    skip_vision_rollups: true,
    skip_dashboard: false,
  })
  return {
    chunks,
    final_publish: {
      partial: Boolean(finalPublish.partial),
      artifact_version: finalPublish.card_catalog?.artifact_version || null,
      artifact_gene_count: Number(finalPublish.card_catalog?.artifact_gene_count || 0),
      catalog_gene_count: Number(finalPublish.card_catalog?.catalog_gene_count || 0),
    },
  }
}

const before = await mismatchSummary()
if (syncEvents && Number(before.targets || 0) !== 0) {
  fail(
    `--sync-events refused because ${before.targets} canonical mismatches remain before read-model sync.`,
  )
}
const budget_preflight = applyD1 ? await assertD1WriteHeadroom(before.targets) : null
let repaired = 0
if (applyD1) repaired = await applyD1Repair()
const symbols = syncEvents || (applyD1 && repaired > 0) ? await symbolsFromEvents() : []
const sync = symbols.length && !verifyOnly ? await syncReadModels(symbols) : null
const after = applyD1 ? await mismatchSummary() : before

console.log(
  JSON.stringify(
    {
      ok: Number(after.targets || 0) === 0,
      before,
      budget_preflight,
      repaired,
      event_symbol_count: symbols.length,
      sync,
      after,
    },
    null,
    2,
  ),
)

if (Number(after.targets || 0) !== 0) process.exit(1)
