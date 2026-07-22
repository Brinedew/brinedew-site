const DEFAULT_HOT_RETENTION_DAYS = 30
const DEFAULT_ARCHIVE_BATCH_LIMIT = 500

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback))
}

function archiveCutoffIso(retentionDays, nowMs) {
  const safeRetentionDays = boundedInteger(retentionDays, DEFAULT_HOT_RETENTION_DAYS, 7, 365)
  return new Date(nowMs - safeRetentionDays * 24 * 60 * 60 * 1000).toISOString()
}

async function ensurePublishEventArchiveTable(auditDb) {
  await auditDb.batch([
    auditDb.prepare(`CREATE TABLE IF NOT EXISTS icono_publish_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      from_asset_sha256 TEXT,
      to_asset_sha256 TEXT,
      action TEXT NOT NULL,
      actor TEXT,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    auditDb.prepare(`CREATE INDEX IF NOT EXISTS idx_icono_publish_events_gene
      ON icono_publish_events (gene_symbol, id DESC)`),
  ])
}

export async function archiveColdIconoplasmPublishEvents(
  env,
  {
    retentionDays = DEFAULT_HOT_RETENTION_DAYS,
    limit = DEFAULT_ARCHIVE_BATCH_LIMIT,
    nowMs = Date.now(),
  } = {},
) {
  // ARCHITECTURE FENCE [IPD-005]: the primary Iconoplasm D1 is a bounded
  // operational database. Historical publish events move to the cold audit D1
  // before deletion; the main database must never become an unbounded ledger.
  const hotDb = env?.ICONOPLASM_DB
  const auditDb = env?.ICONOPLASM_AUDIT_DB
  if (!hotDb || !auditDb) {
    return {
      ok: false,
      skipped: true,
      code: !hotDb ? "HOT_DB_MISSING" : "AUDIT_DB_MISSING",
      archived: 0,
    }
  }

  const safeLimit = boundedInteger(limit, DEFAULT_ARCHIVE_BATCH_LIMIT, 1, 1000)
  const cutoff = archiveCutoffIso(retentionDays, Number(nowMs) || Date.now())
  await ensurePublishEventArchiveTable(auditDb)

  const response = await hotDb
    .prepare(
      `SELECT id, gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
       FROM icono_publish_events
       WHERE created_at < ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    .bind(cutoff, safeLimit)
    .all()
  const rows = Array.isArray(response?.results) ? response.results : []
  if (!rows.length) return { ok: true, archived: 0, cutoff, remaining: false }

  const rowsJson = JSON.stringify(rows)
  await auditDb
    .prepare(
      `WITH incoming AS (
         SELECT
           CAST(json_extract(value, '$.id') AS INTEGER) AS id,
           json_extract(value, '$.gene_symbol') AS gene_symbol,
           json_extract(value, '$.from_asset_sha256') AS from_asset_sha256,
           json_extract(value, '$.to_asset_sha256') AS to_asset_sha256,
           json_extract(value, '$.action') AS action,
           json_extract(value, '$.actor') AS actor,
           json_extract(value, '$.reason') AS reason,
           json_extract(value, '$.created_at') AS created_at
         FROM json_each(?)
       )
       INSERT OR IGNORE INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
       )
       SELECT id, gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
       FROM incoming`,
    )
    .bind(rowsJson)
    .run()

  const ids = rows.map((row) => Number(row?.id || 0)).filter((id) => id > 0)
  const idsJson = JSON.stringify(ids)
  const verified = await auditDb
    .prepare(
      `SELECT COUNT(*) AS count
       FROM icono_publish_events
       WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    )
    .bind(idsJson)
    .first()
  if (Number(verified?.count || 0) !== ids.length) {
    throw new Error(
      `Publish-event archive verification failed: expected ${ids.length}, found ${Number(verified?.count || 0)}.`,
    )
  }

  await hotDb
    .prepare(
      `DELETE FROM icono_publish_events
       WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`,
    )
    .bind(idsJson)
    .run()

  return {
    ok: true,
    archived: ids.length,
    cutoff,
    first_id: ids[0] || null,
    last_id: ids.at(-1) || null,
    remaining: rows.length >= safeLimit,
  }
}

export const ICONOPLASM_PUBLISH_EVENT_HOT_RETENTION_DAYS = DEFAULT_HOT_RETENTION_DAYS
export const ICONOPLASM_PUBLISH_EVENT_ARCHIVE_BATCH_LIMIT = DEFAULT_ARCHIVE_BATCH_LIMIT
