const SHA256 = /^[a-f0-9]{64}$/

const PERMANENT_SOURCE_FAILURES = new Set([
  "CANONICAL_GENERATION_SOURCE_NOT_FOUND",
  "GENERATION_SOURCE_GENE_INACTIVE",
  "GENERATION_SOURCE_INVALID",
  "GENERATION_SOURCE_MANIFESTATION_INACTIVE",
  "GENERATION_SOURCE_REVISION_INACTIVE",
  "GENERATION_SOURCE_DERIVATIVE_STALE",
  "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
  "LEGACY_GENERATION_SOURCE_UNBOUND",
])

function text(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max)
}

function positiveRowId(value) {
  const normalized = Number(value)
  return Number.isSafeInteger(normalized) && normalized >= 1 ? normalized : null
}

export function isPermanentGenerationSourceFailure(code) {
  return PERMANENT_SOURCE_FAILURES.has(text(code, 96))
}

function quarantineRecord(row, now) {
  const requestRowId = positiveRowId(row?.id ?? row?.request_id)
  if (!requestRowId) throw new TypeError("Generation request quarantine requires request_row_id")
  const rawGenerationRequestId = text(row?.generation_request_id, 180)
  const generationRequestId = rawGenerationRequestId || `legacy_request_row:${requestRowId}`
  const revisionId = text(row?.source_manifestation_revision_id, 180)
  const snapshotSha256 = text(row?.source_snapshot_sha256, 64).toLowerCase()
  const hasExactSource = revisionId.length >= 8 && SHA256.test(snapshotSha256)
  const failureCode = text(row?.code, 96)
  const failureMessage = text(row?.error || row?.message, 500)
  if (!failureCode || !failureMessage) {
    throw new TypeError("Generation request quarantine requires a failure code and message")
  }
  return Object.freeze({
    requestRowId,
    generationRequestId,
    sourceManifestationRevisionId: hasExactSource ? revisionId : null,
    sourceSnapshotSha256: hasExactSource ? snapshotSha256 : null,
    failureCode,
    failureMessage,
    quarantinedAt: now.toISOString(),
  })
}

export async function quarantinePermanentGenerationRequests({
  db,
  blockedRows = [],
  now = new Date(),
} = {}) {
  if (!db?.prepare || typeof db.batch !== "function") {
    throw new TypeError("Generation request quarantine requires a D1 database binding")
  }
  const clock = now instanceof Date ? now : new Date(now)
  if (!Number.isFinite(clock.getTime())) throw new TypeError("Invalid quarantine timestamp")
  const records = blockedRows
    .filter((row) => isPermanentGenerationSourceFailure(row?.code))
    .map((row) => quarantineRecord(row, clock))
  if (!records.length)
    return Object.freeze({ quarantined_count: 0, request_ids: Object.freeze([]) })

  const statements = []
  for (const record of records) {
    statements.push(
      db
        .prepare(
          `INSERT INTO icono_generation_request_quarantine (
             request_row_id, generation_request_id,
             source_manifestation_revision_id, source_snapshot_sha256,
             failure_code, failure_message, quarantined_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(request_row_id) DO NOTHING`,
        )
        .bind(
          record.requestRowId,
          record.generationRequestId,
          record.sourceManifestationRevisionId,
          record.sourceSnapshotSha256,
          record.failureCode,
          record.failureMessage,
          record.quarantinedAt,
        ),
      db
        .prepare(
          `UPDATE icono_generation_requests
              SET status = 'cancelled', updated_at = ?,
                  fulfillment_note = ?
            WHERE id = ? AND status = 'open'`,
        )
        .bind(
          record.quarantinedAt,
          `Exact source unavailable: ${record.failureCode}`,
          record.requestRowId,
        ),
    )
  }
  await db.batch(statements)
  return Object.freeze({
    quarantined_count: records.length,
    request_ids: Object.freeze(records.map((record) => record.requestRowId)),
  })
}
