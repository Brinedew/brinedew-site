export const ICONOPLASM_JOB_TABLES = Object.freeze([
  "icono_image_edit_jobs",
  "icono_candidate_generation_jobs",
])

export const ICONOPLASM_JOB_STATUSES = Object.freeze(["queued", "running", "succeeded", "failed"])

export const ICONOPLASM_TERMINAL_JOB_STATUSES = Object.freeze(["succeeded", "failed"])

export const ICONOPLASM_INITIAL_JOB_STATUSES = Object.freeze(["queued", "running"])

export const ICONOPLASM_LEGAL_JOB_TRANSITIONS = Object.freeze({
  queued: Object.freeze(["running", "succeeded", "failed"]),
  running: Object.freeze(["succeeded", "failed"]),
  succeeded: Object.freeze([]),
  failed: Object.freeze([]),
})

function normalizeStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase()
}

export function assertIconoplasmJobTable(table) {
  if (!ICONOPLASM_JOB_TABLES.includes(table)) {
    throw new Error(`Unsupported iconoplasm job table: ${table}`)
  }
  return table
}

export function assertValidInitialIconoplasmJobStatus(status) {
  const normalized = normalizeStatus(status)
  if (!ICONOPLASM_INITIAL_JOB_STATUSES.includes(normalized)) {
    const error = new Error(`Invalid initial iconoplasm job status: ${status}`)
    error.code = "INVALID_JOB_INITIAL_STATUS"
    throw error
  }
  return normalized
}

export function canTransitionIconoplasmJobStatus(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus)
  const to = normalizeStatus(toStatus)
  const allowed = ICONOPLASM_LEGAL_JOB_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

export function assertIconoplasmJobTransition(fromStatus, toStatus) {
  const from = normalizeStatus(fromStatus)
  const to = normalizeStatus(toStatus)
  if (!canTransitionIconoplasmJobStatus(from, to)) {
    const error = new Error(`Illegal iconoplasm job transition: ${from || "(empty)"} -> ${to}`)
    error.code = "INVALID_JOB_TRANSITION"
    throw error
  }
  return to
}

/**
 * Atomically transitions an editable or candidate-generation job from a
 * non-terminal status ('queued' or 'running') to 'succeeded'. Terminal rows
 * ('succeeded' or 'failed') are never overwritten.
 */
export async function transitionIconoplasmJobToSucceeded(db, table, row) {
  const validTable = assertIconoplasmJobTable(table)
  const result = await db
    .prepare(
      `UPDATE ${validTable}
       SET status = 'succeeded',
           result_asset_sha256 = ?,
           result_r2_key_full = ?,
           result_r2_key_medium = ?,
           result_r2_key_thumb = ?,
           result_mime = ?,
           result_width = ?,
           result_height = ?,
           result_bytes = ?,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('queued', 'running')`,
    )
    .bind(
      row.result_asset_sha256,
      row.result_r2_key_full,
      row.result_r2_key_medium,
      row.result_r2_key_thumb,
      row.result_mime,
      row.result_width,
      row.result_height,
      row.result_bytes,
      row.id,
    )
    .run()
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0)
  return { ok: changes > 0, changes }
}

/**
 * Atomically transitions a job from 'queued' or 'running' to 'failed' with a
 * bounded error message. Terminal rows are untouched.
 */
export async function transitionIconoplasmJobToFailed(
  db,
  table,
  { id, error, defaultError = "Job failed" },
) {
  const validTable = assertIconoplasmJobTable(table)
  const message =
    String(error || "")
      .trim()
      .slice(0, 2000) || defaultError
  const result = await db
    .prepare(
      `UPDATE ${validTable}
       SET status = 'failed',
           error = ?,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status IN ('queued', 'running')`,
    )
    .bind(message, id)
    .run()
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0)
  return { ok: changes > 0, changes }
}

/**
 * Atomically claims a 'queued' job by transitioning it to 'running'.
 */
export async function transitionIconoplasmJobToRunning(db, table, { id }) {
  const validTable = assertIconoplasmJobTable(table)
  const result = await db
    .prepare(
      `UPDATE ${validTable}
       SET status = 'running',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'queued'`,
    )
    .bind(id)
    .run()
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0)
  return { ok: changes > 0, changes }
}
