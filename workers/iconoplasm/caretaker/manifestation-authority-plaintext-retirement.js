// ARCHITECTURE FENCE [IPD-012]: irreversible legacy plaintext retirement is
// deliberately separate from authority activation. It requires a verified
// backup identity and advances in bounded, idempotent pages.
import { ManifestationAuthorityCutoverError } from "./manifestation-authority-cutover.js"
import { requireVerifiedManifestationCutoverBackupArtifact } from "./manifestation-cutover-backup-artifact.js"

const SHA256 = /^[a-f0-9]{64}$/
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

function error(code, message, status = 409) {
  return new ManifestationAuthorityCutoverError(code, message, status)
}

function database(raw, label) {
  if (!raw?.prepare || !raw?.batch) throw new TypeError(`${label} must be D1-compatible`)
  return raw
}

function opaqueId(raw, label) {
  const value = String(raw || "").trim()
  if (!OPAQUE_ID.test(value))
    throw error("PLAINTEXT_RETIREMENT_INVALID_ID", `${label} is invalid`, 400)
  return value
}

function sha256(raw, label) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (!SHA256.test(value)) {
    throw error("PLAINTEXT_RETIREMENT_INVALID_HASH", `${label} is invalid`, 400)
  }
  return value
}

async function first(db, sql, ...parameters) {
  return db
    .prepare(sql)
    .bind(...parameters)
    .first()
}

async function all(db, sql, ...parameters) {
  const result = await db
    .prepare(sql)
    .bind(...parameters)
    .all()
  return Array.isArray(result?.results) ? result.results : []
}

async function run(db, sql, ...parameters) {
  return db
    .prepare(sql)
    .bind(...parameters)
    .run()
}

function assertMatchingAuthority(authority, projection, runId, snapshot) {
  if (!authority || authority.cutover_run_id !== runId || authority.status !== "authoritative") {
    throw error(
      "PLAINTEXT_RETIREMENT_AUTHORITY_NOT_VERIFIED",
      "The requested authority cutover is not authoritative",
    )
  }
  if (authority.source_snapshot_sha256 !== snapshot) {
    throw error(
      "PLAINTEXT_RETIREMENT_SNAPSHOT_MISMATCH",
      "The authority cutover snapshot does not match the requested retirement",
    )
  }
  if (
    !projection ||
    projection.mode !== "authoritative" ||
    projection.source_snapshot_sha256 !== snapshot
  ) {
    throw error(
      "PLAINTEXT_RETIREMENT_PROJECTION_NOT_VERIFIED",
      "The primary projection is not authoritative at the verified snapshot",
    )
  }
}

export async function beginLegacyManifestationPlaintextRetirement(
  authorityDb,
  primaryDb,
  env,
  { cutoverRunId, sourceSnapshotSha256, backupArtifactId, now = new Date().toISOString() } = {},
) {
  const authority = database(authorityDb, "authorityDb")
  const primary = database(primaryDb, "primaryDb")
  const runId = opaqueId(cutoverRunId, "cutover_run_id")
  const snapshot = sha256(sourceSnapshotSha256, "source_snapshot_sha256")
  const artifact = await requireVerifiedManifestationCutoverBackupArtifact(authority, env, {
    cutoverRunId: runId,
    backupArtifactId: opaqueId(backupArtifactId, "backup_artifact_id"),
  })
  const backup = sha256(artifact.root_sha256, "backup_artifact_sha256")
  const [cutover, projection] = await Promise.all([
    first(
      authority,
      `SELECT cutover_run_id, status, source_snapshot_sha256
         FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
      runId,
    ),
    first(
      primary,
      `SELECT mode, source_snapshot_sha256, plaintext_retired_at
         FROM icono_manifestation_projection_authority WHERE singleton = 1`,
    ),
  ])
  assertMatchingAuthority(cutover, projection, runId, snapshot)

  await run(
    primary,
    `INSERT OR IGNORE INTO icono_manifestation_plaintext_retirement (
       singleton, cutover_run_id, source_snapshot_sha256, backup_artifact_id,
       backup_artifact_sha256,
       status, started_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, 'running', ?, ?)`,
    runId,
    snapshot,
    artifact.backup_artifact_id,
    backup,
    now,
    now,
  )
  const retirement = await first(
    primary,
    "SELECT * FROM icono_manifestation_plaintext_retirement WHERE singleton = 1",
  )
  if (
    !retirement ||
    retirement.cutover_run_id !== runId ||
    retirement.source_snapshot_sha256 !== snapshot ||
    retirement.backup_artifact_id !== artifact.backup_artifact_id ||
    retirement.backup_artifact_sha256 !== backup
  ) {
    throw error(
      "PLAINTEXT_RETIREMENT_IDENTITY_CONFLICT",
      "A different plaintext retirement is already recorded",
    )
  }
  return retirement
}

export async function retireNextLegacyManifestationPlaintextPage(
  primaryDb,
  { limit = 100, now = new Date().toISOString() } = {},
) {
  const db = database(primaryDb, "primaryDb")
  const pageSize = Math.max(1, Math.min(250, Math.trunc(Number(limit)) || 100))
  const retirement = await first(
    db,
    "SELECT * FROM icono_manifestation_plaintext_retirement WHERE singleton = 1",
  )
  if (!retirement) {
    throw error(
      "PLAINTEXT_RETIREMENT_NOT_STARTED",
      "Plaintext retirement has not passed its backup and authority gate",
    )
  }
  if (retirement.status === "verified") return retirement
  if (retirement.status !== "running") {
    throw error("PLAINTEXT_RETIREMENT_NOT_RUNNABLE", "Plaintext retirement is not runnable")
  }
  const projection = await first(
    db,
    `SELECT mode, source_snapshot_sha256
       FROM icono_manifestation_projection_authority WHERE singleton = 1`,
  )
  if (
    projection?.mode !== "authoritative" ||
    projection.source_snapshot_sha256 !== retirement.source_snapshot_sha256
  ) {
    throw error(
      "PLAINTEXT_RETIREMENT_PROJECTION_NOT_VERIFIED",
      "The primary projection left its verified authoritative state",
    )
  }

  const rows = await all(
    db,
    `SELECT gene_symbol,
            length(CAST(COALESCE(manifestation, '') AS BLOB))
              + length(CAST(COALESCE(manifestation_tags, '') AS BLOB))
              + length(CAST(COALESCE(manifestation_fields_json, '') AS BLOB))
              AS plaintext_bytes,
            CASE WHEN manifestation IS NOT NULL
                   OR manifestation_tags IS NOT NULL
                   OR manifestation_fields_json IS NOT NULL
              THEN 1 ELSE 0 END AS needs_retirement
       FROM icono_gene_essence
      WHERE gene_symbol > ? COLLATE NOCASE
      ORDER BY gene_symbol COLLATE NOCASE ASC
      LIMIT ?`,
    String(retirement.scan_after_symbol || ""),
    pageSize,
  )
  const changed = rows.filter((row) => Number(row.needs_retirement) === 1)
  const retiredBytes = changed.reduce(
    (total, row) => total + Math.max(0, Number(row.plaintext_bytes) || 0),
    0,
  )
  const nextCursor = rows.at(-1)?.gene_symbol || retirement.scan_after_symbol || null
  const finished = rows.length < pageSize
  const statements = changed.map((row) =>
    db
      .prepare(
        `UPDATE icono_gene_essence
            SET manifestation = NULL, manifestation_tags = NULL,
                manifestation_fields_json = NULL
          WHERE gene_symbol = ? COLLATE NOCASE
            AND (manifestation IS NOT NULL OR manifestation_tags IS NOT NULL
              OR manifestation_fields_json IS NOT NULL)`,
      )
      .bind(row.gene_symbol),
  )
  statements.push(
    db
      .prepare(
        `UPDATE icono_manifestation_plaintext_retirement
            SET scan_after_symbol = ?, retired_rows = retired_rows + ?,
                retired_bytes = retired_bytes + ?,
                status = CASE WHEN ? THEN 'verified' ELSE 'running' END,
                verified_at = CASE WHEN ? THEN ? ELSE NULL END,
                updated_at = ?
          WHERE singleton = 1 AND status = 'running' AND scan_after_symbol IS ?`,
      )
      .bind(
        nextCursor,
        changed.length,
        retiredBytes,
        finished ? 1 : 0,
        finished ? 1 : 0,
        now,
        now,
        retirement.scan_after_symbol || null,
      ),
  )
  if (finished) {
    statements.push(
      db
        .prepare(
          `UPDATE icono_manifestation_projection_authority
              SET plaintext_retired_at = ?, changed_at = ?
            WHERE singleton = 1 AND mode = 'authoritative'
              AND source_snapshot_sha256 = ?`,
        )
        .bind(now, now, retirement.source_snapshot_sha256),
    )
  }
  await db.batch(statements)

  if (finished) {
    const remaining = await first(
      db,
      `SELECT COUNT(*) AS count FROM icono_gene_essence
        WHERE manifestation IS NOT NULL OR manifestation_tags IS NOT NULL
           OR manifestation_fields_json IS NOT NULL`,
    )
    if (Number(remaining?.count || 0) !== 0) {
      throw error(
        "PLAINTEXT_RETIREMENT_VERIFICATION_FAILED",
        "Legacy manifestation plaintext remains after the retirement scan",
      )
    }
  }
  return first(db, "SELECT * FROM icono_manifestation_plaintext_retirement WHERE singleton = 1")
}
