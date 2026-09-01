// ARCHITECTURE FENCE [IPD-012]: bounded, resumable planning and monotonic
// authority-mode transitions for the one-time legacy manifestation cutover.
// This module never writes source prose or Tags into either D1 database.
import {
  normalizeManifestationProse,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "./manifestation-tags-payload.js"

const ZERO_SHA256 = "0".repeat(64)
const SHA256 = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,63}$/
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const MAX_TAG_BYTES = 32 * 1024
const TEXT_ENCODER = new TextEncoder()

export class ManifestationAuthorityCutoverError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = "ManifestationAuthorityCutoverError"
    this.code = code
    this.status = status
  }
}

function cutoverError(code, message, status = 409) {
  return new ManifestationAuthorityCutoverError(code, message, status)
}

function requireDb(db, label) {
  if (!db?.prepare || !db?.batch) {
    throw new TypeError(`${label} must be a D1-compatible database binding`)
  }
  return db
}

function id(raw, label) {
  const value = String(raw || "").trim()
  if (!OPAQUE_ID.test(value)) throw cutoverError("CUTOVER_INVALID_ID", `${label} is invalid`, 400)
  return value
}

function sha(raw, label, { optional = false } = {}) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (!value && optional) return null
  if (!SHA256.test(value)) {
    throw cutoverError("CUTOVER_INVALID_SHA256", `${label} is invalid`, 400)
  }
  return value
}

function symbol(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(value)) {
    throw cutoverError("CUTOVER_INVALID_GENE_SYMBOL", "Legacy gene symbol is invalid", 422)
  }
  return value
}

function boundedText(raw, maxLength) {
  const value = String(raw || "").trim()
  return value ? value.slice(0, maxLength) : null
}

function sourceTags(raw) {
  const value = String(raw || "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim()
  if (!value) return null
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw cutoverError(
      "CUTOVER_TAGS_CONTROL_CHARACTER",
      "Legacy Tags contain an unsupported control character",
      422,
    )
  }
  const bytes = TEXT_ENCODER.encode(value)
  if (bytes.byteLength > MAX_TAG_BYTES) {
    throw cutoverError(
      "CUTOVER_TAGS_TOO_LARGE",
      `Legacy Tags exceed ${MAX_TAG_BYTES} UTF-8 bytes`,
      422,
    )
  }
  return { value, bytes: bytes.byteLength }
}

export async function normalizeLegacyTagsDerivativeMaterial(rawTags, rawFieldsJson) {
  const tags = sourceTags(rawTags)
  const rawFields = String(rawFieldsJson ?? "").trim()
  let fields = {}
  if (rawFields) {
    try {
      fields = JSON.parse(rawFields)
      canonicalManifestationFieldsJson(fields)
    } catch (error) {
      throw cutoverError(
        "CUTOVER_INVALID_TAG_FIELDS",
        `Legacy structured Tags fields are invalid: ${String(error?.code || error?.message || "invalid")}`,
        422,
      )
    }
  }
  if (!tags) {
    if (Object.keys(fields).length > 0) {
      throw cutoverError(
        "CUTOVER_FIELDS_WITHOUT_TAGS",
        "Legacy structured Tags fields exist without Tags text",
        422,
      )
    }
    return null
  }
  const tagsSha256 = await sha256Hex(TEXT_ENCODER.encode(tags.value))
  const fieldsCanonical = canonicalManifestationFieldsJson(fields)
  const fieldsSha256 = await sha256Hex(TEXT_ENCODER.encode(fieldsCanonical))
  try {
    return prepareManifestationTagsPayload({
      tagsText: tags.value,
      tagsSha256,
      fieldsJson: fields,
      fieldsSha256,
    })
  } catch (error) {
    throw cutoverError(
      "CUTOVER_TAGS_OUTPUT_INVALID",
      `Legacy Tags output is invalid: ${String(error?.code || error?.message || "invalid")}`,
      422,
    )
  }
}

function nonNegativeInteger(raw, label, { optional = false } = {}) {
  if ((raw === null || raw === undefined || raw === "") && optional) return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw cutoverError("CUTOVER_INVALID_SOURCE", `${label} is invalid`, 422)
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

async function derivedId(prefix, namespace, value) {
  const digest = await sha256Hex(`${namespace}\n${value}`)
  return `${prefix}_${digest.slice(0, 48)}`
}

export async function stableCutoverIdentities(rawSymbol, { hasBody, hasTags } = {}) {
  const canonicalSymbol = symbol(rawSymbol)
  const geneId = await derivedId("gene", "iconoplasm.authority.gene.v1", canonicalSymbol)
  if (!hasBody) {
    return Object.freeze({
      canonical_symbol: canonicalSymbol,
      gene_id: geneId,
      seed_command_id: await derivedId(
        "command",
        "iconoplasm.authority.empty-gene-command.v1",
        geneId,
      ),
    })
  }
  const seedManifestationId = await derivedId(
    "manifestation",
    "iconoplasm.authority.system-seed-lineage.v1",
    geneId,
  )
  const seedRevisionId = await derivedId(
    "revision",
    "iconoplasm.authority.system-seed-revision.v1",
    geneId,
  )
  const result = {
    canonical_symbol: canonicalSymbol,
    gene_id: geneId,
    seed_manifestation_id: seedManifestationId,
    seed_revision_id: seedRevisionId,
    seed_selection_id: await derivedId(
      "selection",
      "iconoplasm.authority.system-seed-selection.v1",
      geneId,
    ),
    seed_command_id: await derivedId(
      "command",
      "iconoplasm.authority.system-seed-command.v1",
      geneId,
    ),
  }
  if (hasTags) {
    result.seed_tags_derivative_id = await derivedId(
      "derivative",
      "iconoplasm.authority.legacy-tags-derivative.v1",
      seedRevisionId,
    )
    result.seed_tags_command_id = await derivedId(
      "command",
      "iconoplasm.authority.legacy-tags-command.v1",
      seedRevisionId,
    )
    result.seed_tags_selection_command_id = await derivedId(
      "command",
      "iconoplasm.authority.legacy-tags-selection-command.v1",
      seedRevisionId,
    )
  }
  return Object.freeze(result)
}

export async function normalizeLegacyManifestationSource(row) {
  const canonicalSymbol = symbol(row?.gene_symbol)
  const rawProse = String(row?.manifestation || "")
  const hasBody = Boolean(rawProse.trim())
  const tags = await normalizeLegacyTagsDerivativeMaterial(
    row?.manifestation_tags,
    row?.manifestation_fields_json,
  )
  if (!hasBody && tags) {
    throw cutoverError(
      "CUTOVER_TAGS_WITHOUT_MANIFESTATION",
      `${canonicalSymbol} has legacy Tags but no source manifestation`,
      422,
    )
  }
  const identities = await stableCutoverIdentities(canonicalSymbol, {
    hasBody,
    hasTags: Boolean(tags),
  })
  const sampleNumber = nonNegativeInteger(row?.sample_number, "sample_number", { optional: true })
  const sampleTextSha256 = sha(row?.sample_text_hash, "sample_text_hash", { optional: true })
  if (!hasBody) {
    return Object.freeze({
      ...identities,
      source_kind: "no_manifestation",
      source_updated_at: boundedText(row?.updated_at, 64),
      source_body_sha256: null,
      source_body_bytes: null,
      source_tags_sha256: null,
      source_tags_bytes: null,
      source_fields_sha256: null,
      source_fields_bytes: null,
      source_sample_label: boundedText(row?.sample_label, 128),
      source_sample_number: sampleNumber,
      source_sample_text_sha256: sampleTextSha256,
    })
  }
  const prose = normalizeManifestationProse(rawProse)
  return Object.freeze({
    ...identities,
    source_kind: "manifestation",
    source_updated_at: boundedText(row?.updated_at, 64),
    source_body_sha256: await sha256Hex(prose.bytes),
    source_body_bytes: prose.bytes.byteLength,
    source_tags_sha256: tags?.tags_sha256 || null,
    source_tags_bytes: tags?.tags_bytes || null,
    source_fields_sha256: tags?.fields_sha256 || null,
    source_fields_bytes: tags?.fields_bytes || null,
    source_sample_label: boundedText(row?.sample_label, 128),
    source_sample_number: sampleNumber,
    source_sample_text_sha256: sampleTextSha256,
  })
}

function planFingerprint(record) {
  return JSON.stringify([
    record.canonical_symbol,
    record.gene_id,
    record.source_kind,
    record.seed_manifestation_id || null,
    record.seed_revision_id || null,
    record.seed_selection_id || null,
    record.seed_command_id || null,
    record.seed_tags_derivative_id || null,
    record.seed_tags_command_id || null,
    record.source_updated_at,
    record.source_body_sha256,
    record.source_body_bytes,
    record.source_tags_sha256,
    record.source_tags_bytes,
    record.source_fields_sha256,
    record.source_fields_bytes,
    record.source_sample_label,
    record.source_sample_number,
    record.source_sample_text_sha256,
  ])
}

export async function beginManifestationAuthorityCutover(
  authorityDb,
  {
    cutoverRunId,
    sourceSnapshotId,
    targetAuthorityEpoch,
    createdByAccountId,
    createdByActorKind = "administrator",
    now = new Date().toISOString(),
  } = {},
) {
  const db = requireDb(authorityDb, "authorityDb")
  const runId = id(cutoverRunId, "cutover_run_id")
  const snapshotId = id(sourceSnapshotId, "source_snapshot_id")
  const creatorKind = String(createdByActorKind || "")
    .trim()
    .toLowerCase()
  if (!new Set(["administrator", "service", "migration"]).has(creatorKind)) {
    throw cutoverError("CUTOVER_INVALID_ACTOR", "Cutover creator authority is invalid", 400)
  }
  const accountId =
    createdByAccountId == null ? null : id(createdByAccountId, "created_by_account_id")
  if ((creatorKind === "administrator") !== Boolean(accountId)) {
    throw cutoverError("CUTOVER_INVALID_ACTOR", "Cutover creator identity is inconsistent", 400)
  }
  const epoch = Number(targetAuthorityEpoch)
  if (!Number.isSafeInteger(epoch) || epoch < 2) {
    throw cutoverError("CUTOVER_INVALID_EPOCH", "Target authority epoch is invalid", 400)
  }
  await run(
    db,
    `INSERT OR IGNORE INTO icono_manifestation_cutover_runs (
       cutover_run_id, source_snapshot_id, source_gene_count,
       source_manifestation_count, source_manifestation_bytes,
       target_authority_epoch, plan_chain_sha256, status,
       created_by_actor_kind, created_by_account_id, created_at, updated_at
     ) VALUES (?, ?, 0, 0, 0, ?, ?, 'planning', ?, ?, ?, ?)`,
    runId,
    snapshotId,
    epoch,
    ZERO_SHA256,
    creatorKind,
    accountId,
    now,
    now,
  )
  const existing = await first(
    db,
    `SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
    runId,
  )
  if (
    !existing ||
    existing.source_snapshot_id !== snapshotId ||
    Number(existing.target_authority_epoch) !== epoch ||
    existing.created_by_actor_kind !== creatorKind ||
    (existing.created_by_account_id || null) !== accountId
  ) {
    throw cutoverError("CUTOVER_RUN_CONFLICT", "Cutover run identity already differs", 409)
  }
  return existing
}

export async function planNextManifestationCutoverPage(
  primaryDb,
  authorityDb,
  { cutoverRunId, limit = 100, now = new Date().toISOString() } = {},
) {
  const sourceDb = requireDb(primaryDb, "primaryDb")
  const targetDb = requireDb(authorityDb, "authorityDb")
  const runId = id(cutoverRunId, "cutover_run_id")
  const pageSize = Math.max(1, Math.min(250, Number(limit) || 100))
  const cutover = await first(
    targetDb,
    `SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
    runId,
  )
  if (!cutover) throw cutoverError("CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  if (cutover.status !== "planning") return cutover

  const rows = await all(
    sourceDb,
    `SELECT gene_symbol, manifestation, manifestation_tags, manifestation_fields_json,
            sample_label, sample_number, sample_text_hash, updated_at
       FROM icono_gene_essence
      WHERE gene_symbol > ?
      ORDER BY gene_symbol ASC
      LIMIT ?`,
    String(cutover.scan_after_symbol || ""),
    pageSize,
  )
  const records = []
  let chain = sha(cutover.plan_chain_sha256, "plan_chain_sha256")
  for (const row of rows) {
    const record = await normalizeLegacyManifestationSource(row)
    records.push(record)
    chain = await sha256Hex(`${chain}\n${planFingerprint(record)}`)
  }
  const bodyCount = records.filter((record) => record.source_kind === "manifestation").length
  const bodyBytes = records.reduce(
    (total, record) => total + Number(record.source_body_bytes || 0),
    0,
  )
  const finished = rows.length < pageSize
  const nextCursor = records.at(-1)?.canonical_symbol || cutover.scan_after_symbol || null
  const statements = records.map((record) =>
    targetDb
      .prepare(
        `INSERT INTO icono_manifestation_cutover_items (
           cutover_run_id, canonical_symbol, gene_id, source_kind,
           seed_manifestation_id, seed_revision_id, seed_selection_id, seed_command_id,
           seed_tags_derivative_id, seed_tags_command_id, seed_tags_selection_command_id,
           source_updated_at, source_body_sha256, source_body_bytes,
           source_tags_sha256, source_tags_bytes, source_fields_sha256,
           source_fields_bytes, source_sample_label,
           source_sample_number, source_sample_text_sha256, status, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`,
      )
      .bind(
        runId,
        record.canonical_symbol,
        record.gene_id,
        record.source_kind,
        record.seed_manifestation_id || null,
        record.seed_revision_id || null,
        record.seed_selection_id || null,
        record.seed_command_id || null,
        record.seed_tags_derivative_id || null,
        record.seed_tags_command_id || null,
        record.seed_tags_selection_command_id || null,
        record.source_updated_at,
        record.source_body_sha256,
        record.source_body_bytes,
        record.source_tags_sha256,
        record.source_tags_bytes,
        record.source_fields_sha256,
        record.source_fields_bytes,
        record.source_sample_label,
        record.source_sample_number,
        record.source_sample_text_sha256,
        now,
      ),
  )
  statements.push(
    targetDb
      .prepare(
        `UPDATE icono_manifestation_cutover_runs
            SET scan_after_symbol = ?, plan_chain_sha256 = ?,
                source_snapshot_sha256 = CASE WHEN ? THEN ? ELSE NULL END,
                source_gene_count = source_gene_count + ?,
                source_manifestation_count = source_manifestation_count + ?,
                source_manifestation_bytes = source_manifestation_bytes + ?,
                planned_items = planned_items + ?,
                status = CASE WHEN ? THEN 'ready' ELSE 'planning' END,
                updated_at = ?
          WHERE cutover_run_id = ? AND status = 'planning'
            AND plan_chain_sha256 = ?
            AND scan_after_symbol IS ?`,
      )
      .bind(
        nextCursor,
        chain,
        finished ? 1 : 0,
        chain,
        records.length,
        bodyCount,
        bodyBytes,
        records.length,
        finished ? 1 : 0,
        now,
        runId,
        cutover.plan_chain_sha256,
        cutover.scan_after_symbol || null,
      ),
  )
  await targetDb.batch(statements)
  return first(
    targetDb,
    `SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
    runId,
  )
}

export async function verifyPlannedLegacySource(primaryDb, plannedItem) {
  const db = requireDb(primaryDb, "primaryDb")
  const itemSymbol = symbol(plannedItem?.canonical_symbol)
  // symbol() has already canonicalized case. Keep this raw equality on the
  // gene_symbol primary key: an explicit NOCASE collation turns a one-row
  // verification into a full icono_gene_essence scan in remote D1.
  const row = await first(
    db,
    `SELECT gene_symbol, manifestation, manifestation_tags, manifestation_fields_json,
            sample_label, sample_number, sample_text_hash, updated_at
       FROM icono_gene_essence
      WHERE gene_symbol = ?
      LIMIT 1`,
    itemSymbol,
  )
  if (!row) throw cutoverError("CUTOVER_SOURCE_DISAPPEARED", `${itemSymbol} disappeared`, 409)
  const current = await normalizeLegacyManifestationSource(row)
  if (planFingerprint(current) !== planFingerprint(plannedItem)) {
    throw cutoverError(
      "CUTOVER_SOURCE_CHANGED",
      `${itemSymbol} changed after the migration plan was recorded`,
      409,
    )
  }
  return current
}

export async function freezeLegacyManifestationWriter(
  primaryDb,
  { targetAuthorityEpoch, sourceSnapshotSha256, expectedGeneCount, actorAccountId } = {},
) {
  const db = requireDb(primaryDb, "primaryDb")
  const epoch = Number(targetAuthorityEpoch)
  const count = nonNegativeInteger(expectedGeneCount, "expected_gene_count")
  const snapshot = sha(sourceSnapshotSha256, "source_snapshot_sha256")
  const actor = actorAccountId == null ? null : id(actorAccountId, "actor_account_id")
  const current = await first(
    db,
    `SELECT * FROM icono_manifestation_projection_authority WHERE singleton = 1`,
  )
  if (!current)
    throw cutoverError("CUTOVER_PRIMARY_STATE_MISSING", "Primary cutover state is missing", 500)
  if (current.mode !== "legacy_write") {
    if (
      Number(current.authority_epoch) === epoch &&
      current.source_snapshot_sha256 === snapshot &&
      Number(current.expected_gene_count) === count
    ) {
      return current
    }
    throw cutoverError("CUTOVER_PRIMARY_ALREADY_FROZEN", "Primary authority state already differs")
  }
  const result = await run(
    db,
    `UPDATE icono_manifestation_projection_authority
        SET authority_epoch = ?, mode = 'shadow_frozen',
            source_snapshot_sha256 = ?, expected_gene_count = ?,
            changed_by_account_id = ?, changed_at = CURRENT_TIMESTAMP
      WHERE singleton = 1 AND mode = 'legacy_write' AND authority_epoch < ?`,
    epoch,
    snapshot,
    count,
    actor,
    epoch,
  )
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw cutoverError("CUTOVER_FREEZE_RACE", "Another cutover changed primary authority state")
  }
  return first(db, `SELECT * FROM icono_manifestation_projection_authority WHERE singleton = 1`)
}

export async function activateManifestationAuthority(
  authorityDb,
  primaryDb,
  { cutoverRunId, now = new Date().toISOString() } = {},
) {
  const targetDb = requireDb(authorityDb, "authorityDb")
  const projectionDb = requireDb(primaryDb, "primaryDb")
  const runId = id(cutoverRunId, "cutover_run_id")
  const cutover = await first(
    targetDb,
    `SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
    runId,
  )
  if (!cutover) throw cutoverError("CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  const outstanding = await first(
    targetDb,
    `SELECT COUNT(*) AS count
       FROM icono_manifestation_cutover_items
      WHERE cutover_run_id = ? AND status <> 'verified'`,
    runId,
  )
  if (Number(outstanding?.count || 0) !== 0 || cutover.status !== "shadow_verified") {
    throw cutoverError(
      "CUTOVER_NOT_VERIFIED",
      "Every planned gene must pass shadow verification before authority activation",
    )
  }
  const epoch = Number(cutover.target_authority_epoch)
  const primary = await first(
    projectionDb,
    `SELECT * FROM icono_manifestation_projection_authority WHERE singleton = 1`,
  )
  if (
    !primary ||
    Number(primary.authority_epoch) !== epoch ||
    !["shadow_frozen", "authoritative"].includes(primary.mode) ||
    primary.source_snapshot_sha256 !== cutover.source_snapshot_sha256
  ) {
    throw cutoverError(
      "CUTOVER_PRIMARY_NOT_FROZEN",
      "Primary projection is not frozen at the verified authority epoch",
    )
  }

  // The order is deliberate. A crash can leave the new authority live while
  // the old side remains frozen, but can never revive the legacy writer.
  await run(
    targetDb,
    `UPDATE icono_authority_state
        SET authority_epoch = ?, authority_mode = 'authoritative', updated_at = ?
      WHERE singleton = 1 AND authority_epoch <= ?
        AND authority_mode IN ('shadow', 'authoritative')`,
    epoch,
    now,
    epoch,
  )
  await run(
    projectionDb,
    `UPDATE icono_manifestation_projection_authority
        SET mode = 'authoritative', changed_at = ?
      WHERE singleton = 1 AND authority_epoch = ?
        AND mode IN ('shadow_frozen', 'authoritative')`,
    now,
    epoch,
  )
  await run(
    targetDb,
    `UPDATE icono_manifestation_cutover_runs
        SET status = 'authoritative', completed_at = ?, updated_at = ?
      WHERE cutover_run_id = ? AND status IN ('shadow_verified', 'authoritative')`,
    now,
    now,
    runId,
  )
  return { ok: true, authority_epoch: epoch, mode: "authoritative" }
}

export async function enterManifestationAuthorityRecoveryReadOnly(
  authorityDb,
  primaryDb,
  { cutoverRunId, now = new Date().toISOString() } = {},
) {
  const targetDb = requireDb(authorityDb, "authorityDb")
  const projectionDb = requireDb(primaryDb, "primaryDb")
  const runId = id(cutoverRunId, "cutover_run_id")
  const cutover = await first(
    targetDb,
    `SELECT target_authority_epoch FROM icono_manifestation_cutover_runs
      WHERE cutover_run_id = ?`,
    runId,
  )
  if (!cutover) throw cutoverError("CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  const epoch = Number(cutover.target_authority_epoch)
  await run(
    targetDb,
    `UPDATE icono_authority_state
        SET authority_mode = 'read_only', updated_at = ?
      WHERE singleton = 1 AND authority_epoch = ?`,
    now,
    epoch,
  )
  await run(
    projectionDb,
    `UPDATE icono_manifestation_projection_authority
        SET mode = 'recovery_read_only', changed_at = ?
      WHERE singleton = 1 AND authority_epoch = ?
        AND mode <> 'legacy_write'`,
    now,
    epoch,
  )
  await run(
    targetDb,
    `UPDATE icono_manifestation_cutover_runs
        SET status = 'recovery_read_only', updated_at = ?
      WHERE cutover_run_id = ?`,
    now,
    runId,
  )
  return { ok: true, authority_epoch: epoch, mode: "recovery_read_only" }
}

export { planFingerprint }
