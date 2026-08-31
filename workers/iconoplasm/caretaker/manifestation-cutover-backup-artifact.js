// ARCHITECTURE FENCE [IPD-012]: the legacy-plaintext retirement gate is bound
// to an actual multipart encrypted backup in a distinct private storage zone.
// General events, snapshots, browser DTOs, and replica DTOs never expose these
// authority-only package locators or envelope fields.
import { sha256Hex } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
  readEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"
import { ManifestationAuthorityCutoverError } from "./manifestation-authority-cutover.js"

const ZERO_HASH = "0".repeat(64)
const MAX_PACKAGE_BYTES = 64 * 1024
const PART_ENTRY_LIMIT = 250
function error(code, message, status = 409) {
  return new ManifestationAuthorityCutoverError(code, message, status)
}
export function cutoverBackupStorageEnvironment(env) {
  const primaryZone = String(env?.ICONOPLASM_AUTHORING_STORAGE_ZONE || "").trim()
  const backupHost = String(env?.ICONOPLASM_AUTHORING_BACKUP_STORAGE_HOST || "").trim()
  const backupZone = String(env?.ICONOPLASM_AUTHORING_BACKUP_STORAGE_ZONE || "").trim()
  const password = String(env?.ICONOPLASM_AUTHORING_BACKUP_STORAGE_PASSWORD || "").trim()
  if (!backupHost || !backupZone || !password) {
    throw error(
      "CUTOVER_BACKUP_STORAGE_NOT_CONFIGURED",
      "Independent cutover backup storage is not configured",
      503,
    )
  }
  if (backupZone === primaryZone) {
    throw error(
      "CUTOVER_BACKUP_STORAGE_NOT_INDEPENDENT",
      "Cutover backup storage must use a distinct private zone",
      503,
    )
  }
  return {
    ICONOPLASM_AUTHORING_STORAGE_HOST: backupHost,
    ICONOPLASM_AUTHORING_STORAGE_ZONE: backupZone,
    ICONOPLASM_AUTHORING_STORAGE_PASSWORD: password,
    ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS: env?.ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS,
  }
}
function base64(bytes) {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
function utf8(value) {
  return new TextEncoder().encode(value)
}
function boundedBytes(value, label) {
  const bytes = utf8(JSON.stringify(value))
  if (bytes.byteLength < 17 || bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw error(
      "CUTOVER_BACKUP_PACKAGE_TOO_LARGE",
      `${label} exceeds the bounded package size`,
      500,
    )
  }
  return bytes
}

function value(row, key) {
  return row?.[key] ?? null
}

async function candidateCount(db, runId) {
  const row = await first(
    db,
    `SELECT sum(CASE WHEN source_kind = 'manifestation' THEN 1 ELSE 0 END)
              + sum(CASE WHEN seed_tags_derivative_id IS NOT NULL THEN 1 ELSE 0 END) AS total
       FROM icono_manifestation_cutover_items WHERE cutover_run_id = ?`,
    runId,
  )
  return Number(row?.total || 0)
}

async function readArtifact(db, runId) {
  return first(
    db,
    "SELECT * FROM icono_manifestation_cutover_backup_artifacts WHERE cutover_run_id = ?",
    runId,
  )
}

export async function beginManifestationCutoverBackupArtifact(
  db,
  env,
  { cutoverRunId, backupArtifactId, idFactory, now = new Date().toISOString() } = {},
) {
  requireDatabase(db)
  cutoverBackupStorageEnvironment(env)
  const run = await first(
    db,
    "SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?",
    cutoverRunId,
  )
  if (!run) throw error("CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  if (run.status !== "authoritative") {
    throw error(
      "CUTOVER_BACKUP_AUTHORITY_NOT_ACTIVE",
      "Only the authoritative cutover can be backed up",
    )
  }
  const artifactId = String(backupArtifactId || idFactory?.("cutover_backup") || "").trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(artifactId)) {
    throw error("CUTOVER_BACKUP_INVALID_ID", "backup_artifact_id is invalid", 400)
  }
  const expected = await candidateCount(db, run.cutover_run_id)
  await prepared(
    db,
    `INSERT OR IGNORE INTO icono_manifestation_cutover_backup_artifacts (
       backup_artifact_id, cutover_run_id, source_snapshot_sha256, expected_entries,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    artifactId,
    run.cutover_run_id,
    run.source_snapshot_sha256,
    expected,
    now,
    now,
  ).run()
  const artifact = await readArtifact(db, run.cutover_run_id)
  if (
    !artifact ||
    artifact.backup_artifact_id !== artifactId ||
    artifact.source_snapshot_sha256 !== run.source_snapshot_sha256 ||
    Number(artifact.expected_entries) !== expected
  ) {
    throw error(
      "CUTOVER_BACKUP_IDENTITY_CONFLICT",
      "A different backup artifact already owns this cutover",
    )
  }
  return artifact
}

async function revisionPackage(db, run, entityId) {
  const row = await first(
    db,
    `SELECT item.gene_id, item.canonical_symbol,
            manifestation.manifestation_id, manifestation.origin, manifestation.status AS manifestation_status,
            manifestation.row_version, manifestation.non_withdrawable, manifestation.created_at AS manifestation_created_at,
            revision.manifestation_revision_id, revision.revision_number, revision.parent_revision_id,
            revision.source_revision_id, revision.base_canonical_selection_id, revision.body_sha256,
            revision.body_bytes, revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            revision.created_at AS revision_created_at, lifecycle.status AS lifecycle_status,
            lifecycle.lifecycle_version, lifecycle.change_reason, lifecycle.changed_at,
            secret.object_key, secret.ciphertext_sha256, secret.ciphertext_bytes,
            secret.body_iv_base64, secret.wrapped_dek_base64, secret.wrap_iv_base64,
            secret.key_version, secret.aad_version, secret.object_etag, secret.verified_at,
            head.canonical_manifestation_id, head.canonical_revision_id,
            head.canonical_selection_id, head.head_version, head.gene_revision,
            selection.previous_selection_id, selection.previous_revision_id,
            selection.reason AS selection_reason, selection.command_id AS selection_command_id,
            selection.created_at AS selection_created_at
       FROM icono_manifestation_cutover_items item
       JOIN icono_manifestation_revisions revision ON revision.manifestation_revision_id = item.seed_revision_id
       JOIN icono_manifestations manifestation ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets secret
         ON secret.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_heads head ON head.gene_id = item.gene_id
       LEFT JOIN icono_manifestation_canonical_selections selection
         ON selection.canonical_selection_id = item.seed_selection_id
      WHERE item.cutover_run_id = ? AND revision.manifestation_revision_id = ?`,
    run.cutover_run_id,
    entityId,
  )
  if (!row)
    throw error("CUTOVER_BACKUP_ENTITY_MISSING", "Planned revision backup entity is missing")
  return {
    sourceObjectKey: row.object_key,
    bodySha256: row.body_sha256,
    bodyBytes: Number(row.body_bytes),
    ciphertextSha256: row.ciphertext_sha256,
    ciphertextBytes: Number(row.ciphertext_bytes),
    package: {
      schema_version: 1,
      package_kind: "manifestation_cutover_revision_backup",
      cutover_run_id: run.cutover_run_id,
      source_snapshot_sha256: run.source_snapshot_sha256,
      gene: { gene_id: row.gene_id, canonical_symbol: row.canonical_symbol },
      manifestation: {
        manifestation_id: row.manifestation_id,
        origin: row.origin,
        status: row.manifestation_status,
        row_version: Number(row.row_version),
        non_withdrawable: Number(row.non_withdrawable),
        created_at: row.manifestation_created_at,
      },
      revision: {
        manifestation_revision_id: row.manifestation_revision_id,
        revision_number: Number(row.revision_number),
        parent_revision_id: value(row, "parent_revision_id"),
        source_revision_id: value(row, "source_revision_id"),
        base_canonical_selection_id: value(row, "base_canonical_selection_id"),
        body_sha256: row.body_sha256,
        body_bytes: Number(row.body_bytes),
        sample_label: value(row, "sample_label"),
        sample_number: value(row, "sample_number"),
        sample_text_sha256: value(row, "sample_text_sha256"),
        created_at: row.revision_created_at,
      },
      lifecycle: {
        status: row.lifecycle_status,
        lifecycle_version: Number(row.lifecycle_version),
        change_reason: value(row, "change_reason"),
        changed_at: row.changed_at,
      },
      canonical: {
        canonical_manifestation_id: row.canonical_manifestation_id,
        canonical_revision_id: row.canonical_revision_id,
        canonical_selection_id: row.canonical_selection_id,
        head_version: Number(row.head_version),
        gene_revision: Number(row.gene_revision),
      },
      selection: {
        canonical_selection_id: row.canonical_selection_id,
        previous_selection_id: value(row, "previous_selection_id"),
        previous_revision_id: value(row, "previous_revision_id"),
        reason: value(row, "selection_reason"),
        command_id: value(row, "selection_command_id"),
        created_at: value(row, "selection_created_at"),
      },
      envelope: {
        ciphertext_sha256: row.ciphertext_sha256,
        ciphertext_bytes: Number(row.ciphertext_bytes),
        body_iv_base64: row.body_iv_base64,
        wrapped_dek_base64: row.wrapped_dek_base64,
        wrap_iv_base64: row.wrap_iv_base64,
        key_version: Number(row.key_version),
        aad_version: Number(row.aad_version),
        object_etag: value(row, "object_etag"),
        verified_at: row.verified_at,
      },
    },
  }
}

async function derivativePackage(db, run, entityId) {
  const row = await first(
    db,
    `SELECT item.gene_id, item.canonical_symbol, derivative.*,
            secret.object_key, secret.ciphertext_sha256, secret.ciphertext_bytes,
            secret.body_iv_base64, secret.wrapped_dek_base64, secret.wrap_iv_base64,
            secret.key_version, secret.aad_version, secret.object_etag, secret.verified_at,
            derivative_head.accepted_derivative_id, derivative_head.derivative_head_version,
            derivative_head.updated_at AS derivative_head_updated_at
       FROM icono_manifestation_cutover_items item
       JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_derivative_id = item.seed_tags_derivative_id
       JOIN icono_manifestation_derivative_storage_secrets secret
         ON secret.manifestation_derivative_id = derivative.manifestation_derivative_id
       LEFT JOIN icono_manifestation_derivative_heads derivative_head
         ON derivative_head.manifestation_revision_id = derivative.manifestation_revision_id
      WHERE item.cutover_run_id = ? AND derivative.manifestation_derivative_id = ?`,
    run.cutover_run_id,
    entityId,
  )
  if (!row)
    throw error("CUTOVER_BACKUP_ENTITY_MISSING", "Planned derivative backup entity is missing")
  return {
    sourceObjectKey: row.object_key,
    bodySha256: row.body_sha256,
    bodyBytes: Number(row.body_bytes),
    ciphertextSha256: row.ciphertext_sha256,
    ciphertextBytes: Number(row.ciphertext_bytes),
    package: {
      schema_version: 1,
      package_kind: "manifestation_cutover_tags_backup",
      cutover_run_id: run.cutover_run_id,
      source_snapshot_sha256: run.source_snapshot_sha256,
      gene: { gene_id: row.gene_id, canonical_symbol: row.canonical_symbol },
      derivative: {
        manifestation_derivative_id: row.manifestation_derivative_id,
        manifestation_revision_id: row.manifestation_revision_id,
        derivative_kind: row.derivative_kind,
        status: row.status,
        source_body_sha256: row.source_body_sha256,
        body_sha256: row.body_sha256,
        body_bytes: Number(row.body_bytes),
        tags_sha256: row.tags_sha256,
        tags_bytes: Number(row.tags_bytes),
        fields_sha256: row.fields_sha256,
        fields_bytes: Number(row.fields_bytes),
        recipe_id: value(row, "recipe_id"),
        recipe_version: value(row, "recipe_version"),
        provider_id: value(row, "provider_id"),
        model_id: value(row, "model_id"),
        tagger_config_sha256: value(row, "tagger_config_sha256"),
        provenance_status: row.provenance_status,
        created_at: row.created_at,
        completed_at: value(row, "completed_at"),
      },
      derivative_head: {
        accepted_derivative_id: value(row, "accepted_derivative_id"),
        derivative_head_version: Number(row.derivative_head_version || 0),
        updated_at: value(row, "derivative_head_updated_at"),
      },
      envelope: {
        ciphertext_sha256: row.ciphertext_sha256,
        ciphertext_bytes: Number(row.ciphertext_bytes),
        body_iv_base64: row.body_iv_base64,
        wrapped_dek_base64: row.wrapped_dek_base64,
        wrap_iv_base64: row.wrap_iv_base64,
        key_version: Number(row.key_version),
        aad_version: Number(row.aad_version),
        object_etag: value(row, "object_etag"),
        verified_at: row.verified_at,
      },
    },
  }
}

async function packageMetadata(db, run, kind, entityId) {
  return kind === "revision"
    ? revisionPackage(db, run, entityId)
    : derivativePackage(db, run, entityId)
}

async function nextCandidates(db, artifact, limit) {
  const existing = await all(
    db,
    `SELECT entity_kind, entity_id FROM icono_manifestation_cutover_backup_entries
      WHERE backup_artifact_id = ? AND status IN ('uploading', 'failed')
      ORDER BY entity_kind, entity_id LIMIT ?`,
    artifact.backup_artifact_id,
    limit,
  )
  if (existing.length >= limit) return existing
  return existing.concat(
    await all(
      db,
      `WITH candidates(entity_kind, entity_id) AS (
       SELECT 'revision', seed_revision_id FROM icono_manifestation_cutover_items
        WHERE cutover_run_id = ? AND seed_revision_id IS NOT NULL
       UNION ALL
       SELECT 'derivative', seed_tags_derivative_id FROM icono_manifestation_cutover_items
        WHERE cutover_run_id = ? AND seed_tags_derivative_id IS NOT NULL
     )
     SELECT candidates.entity_kind, candidates.entity_id FROM candidates
      WHERE NOT EXISTS (
        SELECT 1 FROM icono_manifestation_cutover_backup_entries entry
         WHERE entry.backup_artifact_id = ? AND entry.entity_kind = candidates.entity_kind
           AND entry.entity_id = candidates.entity_id
      )
      ORDER BY candidates.entity_kind, candidates.entity_id LIMIT ?`,
      artifact.cutover_run_id,
      artifact.cutover_run_id,
      artifact.backup_artifact_id,
      limit - existing.length,
    ),
  )
}

async function backupEntity(db, env, backupEnv, run, artifact, candidate, now) {
  const metadata = await packageMetadata(db, run, candidate.entity_kind, candidate.entity_id)
  let entry = await first(
    db,
    `SELECT * FROM icono_manifestation_cutover_backup_entries
      WHERE backup_artifact_id = ? AND entity_kind = ? AND entity_id = ?`,
    artifact.backup_artifact_id,
    candidate.entity_kind,
    candidate.entity_id,
  )
  if (!entry) {
    const objectKey = await createManifestationBodyObjectKey()
    await prepared(
      db,
      `INSERT INTO icono_manifestation_cutover_backup_entries (
         backup_artifact_id, entity_kind, entity_id, package_object_key,
         body_sha256, body_bytes, ciphertext_sha256, ciphertext_bytes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      artifact.backup_artifact_id,
      candidate.entity_kind,
      candidate.entity_id,
      objectKey,
      metadata.bodySha256,
      metadata.bodyBytes,
      metadata.ciphertextSha256,
      metadata.ciphertextBytes,
      now,
    ).run()
    entry = await first(
      db,
      `SELECT * FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND entity_kind = ? AND entity_id = ?`,
      artifact.backup_artifact_id,
      candidate.entity_kind,
      candidate.entity_id,
    )
  }
  if (entry.status === "verified") return
  const source = await readEncryptedManifestationBody(env, metadata.sourceObjectKey)
  if (
    !source ||
    source.bytes.byteLength !== metadata.ciphertextBytes ||
    (await sha256Hex(source.bytes)) !== metadata.ciphertextSha256
  ) {
    throw error(
      "CUTOVER_BACKUP_SOURCE_INTEGRITY_FAILED",
      "Encrypted authority source failed backup verification",
      503,
    )
  }
  const bytes = boundedBytes(
    { ...metadata.package, ciphertext_base64: base64(source.bytes) },
    "backup package",
  )
  const packageHash = await sha256Hex(bytes)
  await putEncryptedManifestationBody(backupEnv, entry.package_object_key, bytes, {
    expectedSha256: packageHash,
  })
  await prepared(
    db,
    `UPDATE icono_manifestation_cutover_backup_entries
        SET status = 'verified', package_sha256 = ?, package_bytes = ?, verified_at = ?
      WHERE backup_artifact_id = ? AND entity_kind = ? AND entity_id = ?
        AND status IN ('uploading', 'failed')`,
    packageHash,
    bytes.byteLength,
    now,
    artifact.backup_artifact_id,
    candidate.entity_kind,
    candidate.entity_id,
  ).run()
}

async function writePendingPart(db, backupEnv, artifact, now, allowPartial) {
  let part = await first(
    db,
    `SELECT * FROM icono_manifestation_cutover_backup_parts
      WHERE backup_artifact_id = ? AND status = 'uploading' ORDER BY part_number LIMIT 1`,
    artifact.backup_artifact_id,
  )
  if (!part) {
    const entries = await all(
      db,
      `SELECT * FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND status = 'verified' AND part_number IS NULL
        ORDER BY entity_kind, entity_id LIMIT ?`,
      artifact.backup_artifact_id,
      PART_ENTRY_LIMIT,
    )
    if (entries.length === 0 || (!allowPartial && entries.length < PART_ENTRY_LIMIT)) return false
    const prior = await first(
      db,
      `SELECT coalesce(max(part_number), 0) AS number
         FROM icono_manifestation_cutover_backup_parts WHERE backup_artifact_id = ?`,
      artifact.backup_artifact_id,
    )
    const partNumber = Number(prior?.number || 0) + 1
    const objectKey = await createManifestationBodyObjectKey()
    await db.batch([
      prepared(
        db,
        `INSERT INTO icono_manifestation_cutover_backup_parts (
           backup_artifact_id, part_number, entry_count, part_object_key, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
        artifact.backup_artifact_id,
        partNumber,
        entries.length,
        objectKey,
        now,
      ),
      ...entries.map((entry) =>
        prepared(
          db,
          `UPDATE icono_manifestation_cutover_backup_entries SET part_number = ?
          WHERE backup_artifact_id = ? AND entity_kind = ? AND entity_id = ?
            AND status = 'verified' AND part_number IS NULL`,
          partNumber,
          artifact.backup_artifact_id,
          entry.entity_kind,
          entry.entity_id,
        ),
      ),
    ])
    part = await first(
      db,
      `SELECT * FROM icono_manifestation_cutover_backup_parts
        WHERE backup_artifact_id = ? AND part_number = ?`,
      artifact.backup_artifact_id,
      partNumber,
    )
  }
  const entries = await all(
    db,
    `SELECT entity_kind, entity_id, package_object_key, package_sha256, package_bytes,
            body_sha256, body_bytes, ciphertext_sha256, ciphertext_bytes
       FROM icono_manifestation_cutover_backup_entries
      WHERE backup_artifact_id = ? AND part_number = ? ORDER BY entity_kind, entity_id`,
    artifact.backup_artifact_id,
    Number(part.part_number),
  )
  if (entries.length !== Number(part.entry_count)) {
    throw error("CUTOVER_BACKUP_PART_INCOMPLETE", "Backup part membership is incomplete", 500)
  }
  const previous =
    Number(part.part_number) === 1
      ? ZERO_HASH
      : (
          await first(
            db,
            `SELECT chain_sha256 FROM icono_manifestation_cutover_backup_parts
          WHERE backup_artifact_id = ? AND part_number = ? AND status = 'verified'`,
            artifact.backup_artifact_id,
            Number(part.part_number) - 1,
          )
        )?.chain_sha256
  if (!previous)
    throw error("CUTOVER_BACKUP_PART_ORDER_INVALID", "Previous backup part is not verified", 500)
  const bytes = boundedBytes(
    {
      schema_version: 1,
      artifact_kind: "manifestation_cutover_backup_part",
      backup_artifact_id: artifact.backup_artifact_id,
      cutover_run_id: artifact.cutover_run_id,
      source_snapshot_sha256: artifact.source_snapshot_sha256,
      part_number: Number(part.part_number),
      entries,
    },
    "backup part",
  )
  const partHash = await sha256Hex(bytes)
  const chainHash = await sha256Hex(utf8(`${previous}\n${part.part_number}\n${partHash}`))
  await putEncryptedManifestationBody(backupEnv, part.part_object_key, bytes, {
    expectedSha256: partHash,
  })
  await prepared(
    db,
    `UPDATE icono_manifestation_cutover_backup_parts
        SET status = 'verified', part_sha256 = ?, part_bytes = ?, chain_sha256 = ?
      WHERE backup_artifact_id = ? AND part_number = ? AND status = 'uploading'`,
    partHash,
    bytes.byteLength,
    chainHash,
    artifact.backup_artifact_id,
    Number(part.part_number),
  ).run()
  return true
}

async function finalizeArtifact(db, backupEnv, artifact, now) {
  const [remaining, unparted] = await Promise.all([
    first(
      db,
      `SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND status <> 'verified'`,
      artifact.backup_artifact_id,
    ),
    first(
      db,
      `SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND status = 'verified' AND part_number IS NULL`,
      artifact.backup_artifact_id,
    ),
  ])
  const entryCount = await first(
    db,
    "SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries WHERE backup_artifact_id = ?",
    artifact.backup_artifact_id,
  )
  if (
    Number(remaining?.total || 0) ||
    Number(unparted?.total || 0) ||
    Number(entryCount?.total || 0) !== Number(artifact.expected_entries)
  )
    return false
  const parts = await all(
    db,
    `SELECT part_number, entry_count, part_object_key, part_sha256, part_bytes, chain_sha256
       FROM icono_manifestation_cutover_backup_parts
      WHERE backup_artifact_id = ? AND status = 'verified' ORDER BY part_number`,
    artifact.backup_artifact_id,
  )
  const finalChain = parts.at(-1)?.chain_sha256 || ZERO_HASH
  let rootKey = artifact.root_object_key
  if (!rootKey) {
    rootKey = await createManifestationBodyObjectKey()
    await prepared(
      db,
      `UPDATE icono_manifestation_cutover_backup_artifacts SET root_object_key = ?, updated_at = ?
        WHERE backup_artifact_id = ? AND status = 'building' AND root_object_key IS NULL`,
      rootKey,
      now,
      artifact.backup_artifact_id,
    ).run()
  }
  const bytes = boundedBytes(
    {
      schema_version: 1,
      artifact_kind: "manifestation_cutover_backup_root",
      backup_artifact_id: artifact.backup_artifact_id,
      cutover_run_id: artifact.cutover_run_id,
      source_snapshot_sha256: artifact.source_snapshot_sha256,
      expected_entries: Number(artifact.expected_entries),
      inventory_chain_sha256: finalChain,
      parts,
    },
    "backup root",
  )
  const rootHash = await sha256Hex(bytes)
  await putEncryptedManifestationBody(backupEnv, rootKey, bytes, { expectedSha256: rootHash })
  const totals = await first(
    db,
    `SELECT count(*) AS verified_entries, coalesce(sum(package_bytes), 0) AS package_bytes
       FROM icono_manifestation_cutover_backup_entries
      WHERE backup_artifact_id = ? AND status = 'verified'`,
    artifact.backup_artifact_id,
  )
  await prepared(
    db,
    `UPDATE icono_manifestation_cutover_backup_artifacts
        SET status = 'verified', verified_entries = ?, package_bytes = ?, part_count = ?,
            inventory_chain_sha256 = ?, root_sha256 = ?, root_bytes = ?,
            updated_at = ?, verified_at = ?
      WHERE backup_artifact_id = ? AND status = 'building'`,
    Number(totals?.verified_entries || 0),
    Number(totals?.package_bytes || 0),
    parts.length,
    finalChain,
    rootHash,
    bytes.byteLength,
    now,
    now,
    artifact.backup_artifact_id,
  ).run()
  return true
}

export async function advanceManifestationCutoverBackupArtifact(
  db,
  env,
  { cutoverRunId, limit = 5, now = new Date().toISOString() } = {},
) {
  requireDatabase(db)
  const backupEnv = cutoverBackupStorageEnvironment(env)
  const run = await first(
    db,
    "SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?",
    cutoverRunId,
  )
  const artifact = await readArtifact(db, cutoverRunId)
  if (!run || !artifact)
    throw error("CUTOVER_BACKUP_NOT_STARTED", "Cutover backup artifact was not started", 404)
  if (artifact.status === "verified") return safeArtifact(artifact)
  if (artifact.status !== "building")
    throw error("CUTOVER_BACKUP_NOT_RUNNABLE", "Cutover backup artifact is not runnable")
  const pageSize = Math.max(1, Math.min(10, Math.trunc(Number(limit)) || 5))
  const candidates = await nextCandidates(db, artifact, pageSize)
  for (const candidate of candidates) {
    await backupEntity(db, env, backupEnv, run, artifact, candidate, now)
  }
  const registered = await first(
    db,
    "SELECT count(*) AS total FROM icono_manifestation_cutover_backup_entries WHERE backup_artifact_id = ?",
    artifact.backup_artifact_id,
  )
  const allRegistered = Number(registered?.total || 0) === Number(artifact.expected_entries)
  await writePendingPart(db, backupEnv, artifact, now, allRegistered)
  if (allRegistered) {
    while (await writePendingPart(db, backupEnv, artifact, now, true)) {
      // Each part is bounded to 250 entries. Normally one remains because the
      // main loop emits full parts incrementally; this also repairs interruption.
    }
    await finalizeArtifact(db, backupEnv, artifact, now)
  }
  const refreshed = await readArtifact(db, cutoverRunId)
  if (refreshed.status === "building") {
    const totals = await first(
      db,
      `SELECT count(*) AS count, coalesce(sum(package_bytes), 0) AS bytes
         FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND status = 'verified'`,
      refreshed.backup_artifact_id,
    )
    return safeArtifact({
      ...refreshed,
      verified_entries: Number(totals?.count || 0),
      package_bytes: Number(totals?.bytes || 0),
    })
  }
  return safeArtifact(refreshed)
}

export async function requireVerifiedManifestationCutoverBackupArtifact(
  db,
  env,
  { cutoverRunId, backupArtifactId } = {},
) {
  requireDatabase(db)
  const artifact = await first(
    db,
    `SELECT * FROM icono_manifestation_cutover_backup_artifacts
      WHERE cutover_run_id = ? AND backup_artifact_id = ?`,
    cutoverRunId,
    backupArtifactId,
  )
  if (!artifact || artifact.status !== "verified") {
    throw error("CUTOVER_BACKUP_NOT_VERIFIED", "The named cutover backup artifact is not verified")
  }
  const stored = await readEncryptedManifestationBody(
    cutoverBackupStorageEnvironment(env),
    artifact.root_object_key,
  )
  if (
    !stored ||
    stored.bytes.byteLength !== Number(artifact.root_bytes) ||
    (await sha256Hex(stored.bytes)) !== artifact.root_sha256
  ) {
    throw error(
      "CUTOVER_BACKUP_ROOT_INTEGRITY_FAILED",
      "The cutover backup root is missing or corrupt",
      503,
    )
  }
  let root
  try {
    root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes))
  } catch {
    throw error(
      "CUTOVER_BACKUP_ROOT_INTEGRITY_FAILED",
      "The cutover backup root is not valid UTF-8 JSON",
      503,
    )
  }
  if (
    root?.backup_artifact_id !== artifact.backup_artifact_id ||
    root?.cutover_run_id !== artifact.cutover_run_id ||
    root?.source_snapshot_sha256 !== artifact.source_snapshot_sha256 ||
    root?.inventory_chain_sha256 !== artifact.inventory_chain_sha256 ||
    Number(root?.expected_entries) !== Number(artifact.expected_entries)
  ) {
    throw error(
      "CUTOVER_BACKUP_ROOT_IDENTITY_MISMATCH",
      "The cutover backup root identity does not match its receipt",
      503,
    )
  }
  return artifact
}

export function safeArtifact(artifact) {
  return Object.freeze({
    schema_version: 1,
    backup_artifact_id: artifact.backup_artifact_id,
    cutover_run_id: artifact.cutover_run_id,
    source_snapshot_sha256: artifact.source_snapshot_sha256,
    status: artifact.status,
    expected_entries: Number(artifact.expected_entries),
    verified_entries: Number(artifact.verified_entries || 0),
    package_bytes: Number(artifact.package_bytes || 0),
    part_count: Number(artifact.part_count || 0),
    inventory_chain_sha256: artifact.inventory_chain_sha256 || null,
    root_sha256: artifact.root_sha256 || null,
    root_bytes: artifact.root_bytes == null ? null : Number(artifact.root_bytes),
    verified_at: artifact.verified_at || null,
  })
}

// ARCHITECTURE FENCE [IPD-012]
