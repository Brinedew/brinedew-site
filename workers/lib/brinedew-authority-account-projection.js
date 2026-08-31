import {
  projectAuthorityAccountStatus,
  registerAuthorityAccount,
} from "../iconoplasm/caretaker/manifestation-authority.js"
import {
  BrinedewAccountIdentityError,
  normalizeBrinedewAccountId,
  readBrinedewAccount,
} from "./brinedew-account-identity.js"

const PROJECTION_BATCH_LIMIT = 25

function requireDb(db, name) {
  if (!db?.prepare) throw new TypeError(`${name} binding missing`)
}

function retryAt(attemptCount, now) {
  const exponent = Math.min(8, Math.max(0, Number(attemptCount || 0)))
  return now + Math.min(15 * 60_000, 5_000 * 2 ** exponent)
}

async function outboxRow(primaryDb, accountId) {
  return primaryDb
    .prepare(
      `SELECT account_id, source_event_id, source_event_sequence, account_version,
              source_status, authority_status, public_credit_label,
              final_leave_policy, projection_state, attempt_count,
              next_attempt_at, occurred_at
         FROM brinedew_authority_account_projection_outbox
        WHERE account_id = ?`,
    )
    .bind(accountId)
    .first()
}

async function beginAttempt(primaryDb, row, attemptedAt) {
  await primaryDb
    .prepare(
      `UPDATE brinedew_authority_account_projection_outbox
          SET attempt_count = attempt_count + 1,
              last_attempted_at = ?, last_error_code = NULL,
              next_attempt_at = NULL
        WHERE account_id = ? AND source_event_id = ?
          AND source_event_sequence = ? AND projection_state = 'pending'`,
    )
    .bind(attemptedAt, row.account_id, row.source_event_id, row.source_event_sequence)
    .run()
}

async function markDelivered(primaryDb, row, deliveredAt) {
  await primaryDb
    .prepare(
      `UPDATE brinedew_authority_account_projection_outbox
          SET projection_state = 'delivered', delivered_at = ?,
              last_error_code = NULL, next_attempt_at = NULL
        WHERE account_id = ? AND source_event_id = ?
          AND source_event_sequence = ? AND projection_state = 'pending'`,
    )
    .bind(deliveredAt, row.account_id, row.source_event_id, row.source_event_sequence)
    .run()
}

async function markFailed(primaryDb, row, error, attemptedAt) {
  await primaryDb
    .prepare(
      `UPDATE brinedew_authority_account_projection_outbox
          SET last_error_code = ?, next_attempt_at = ?
        WHERE account_id = ? AND source_event_id = ?
          AND source_event_sequence = ? AND projection_state = 'pending'`,
    )
    .bind(
      String(error?.code || "AUTHORITY_ACCOUNT_PROJECTION_FAILED").slice(0, 128),
      retryAt(Number(row.attempt_count || 0), attemptedAt),
      row.account_id,
      row.source_event_id,
      row.source_event_sequence,
    )
    .run()
}

function projectionInput(row) {
  return {
    accountId: row.account_id,
    status: row.authority_status,
    publicCreditLabel: row.public_credit_label || undefined,
    finalLeavePolicy: row.final_leave_policy || undefined,
    sourceEventId: row.source_event_id,
    sourceEventSequence: Number(row.source_event_sequence),
    occurredAt: Number(row.occurred_at),
  }
}

async function applyProjection(
  authoringDb,
  row,
  { projectAccount = projectAuthorityAccountStatus, registerAccount = registerAuthorityAccount },
) {
  const input = projectionInput(row)
  try {
    return await projectAccount(authoringDb, input)
  } catch (error) {
    if (error?.code !== "ACCOUNT_NOT_REGISTERED") throw error
  }
  await registerAccount(authoringDb, {
    accountId: row.account_id,
    publicCreditLabel: row.public_credit_label || undefined,
    status: row.authority_status,
    now: Number(row.occurred_at),
  })
  return projectAccount(authoringDb, input)
}

export async function projectBrinedewAccountToManifestationAuthority(
  {
    primaryDb,
    authoringDb,
    accountId: rawAccountId,
    now = Date.now(),
    wakeManifestationProjection = null,
  } = {},
  dependencies = {},
) {
  requireDb(primaryDb, "DB")
  requireDb(authoringDb, "ICONOPLASM_AUTHORING_DB")
  const accountId = normalizeBrinedewAccountId(rawAccountId)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const row = await outboxRow(primaryDb, accountId)
  if (!row) {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_PROJECTION_NOT_QUEUED",
      "Stable account identity has no authority projection row",
      503,
    )
  }
  if (row.projection_state === "delivered") {
    return Object.freeze({
      ok: true,
      replayed: true,
      account_id: accountId,
      source_event_sequence: Number(row.source_event_sequence),
      status: row.authority_status,
    })
  }
  const attemptedAt = Math.max(0, Math.trunc(Number(now) || 0))
  await beginAttempt(primaryDb, row, attemptedAt)
  try {
    const result = await applyProjection(authoringDb, row, {
      projectAccount: dependencies.projectAccount || projectAuthorityAccountStatus,
      registerAccount: dependencies.registerAccount || registerAuthorityAccount,
    })
    await markDelivered(primaryDb, row, attemptedAt)
    if (result?.accepted_event_sequence && typeof wakeManifestationProjection === "function") {
      await wakeManifestationProjection()
    }
    return Object.freeze({ ...result, account_id: accountId })
  } catch (error) {
    await markFailed(primaryDb, row, error, attemptedAt)
    throw error
  }
}

export async function synchronizeActiveBrinedewAccountToManifestationAuthority({
  primaryDb,
  authoringDb,
  accountId: rawAccountId,
  now = Date.now(),
  wakeManifestationProjection = null,
} = {}) {
  requireDb(primaryDb, "DB")
  const accountId = normalizeBrinedewAccountId(rawAccountId)
  if (!accountId) throw new TypeError("Invalid Brinedew account ID")
  const account = await readBrinedewAccount(primaryDb, accountId)
  if (!account || account.status !== "active") {
    throw new BrinedewAccountIdentityError(
      "ACCOUNT_NOT_ACTIVE",
      "This Brinedew account is not active",
      403,
    )
  }
  const projection = await projectBrinedewAccountToManifestationAuthority({
    primaryDb,
    authoringDb,
    accountId,
    now,
    wakeManifestationProjection,
  })
  return Object.freeze({ account, projection })
}

export async function drainBrinedewAuthorityAccountProjectionOutbox({
  primaryDb,
  authoringDb,
  limit = 10,
  now = Date.now(),
  wakeManifestationProjection = null,
} = {}) {
  requireDb(primaryDb, "DB")
  requireDb(authoringDb, "ICONOPLASM_AUTHORING_DB")
  const attemptedAt = Math.max(0, Math.trunc(Number(now) || 0))
  const boundedLimit = Math.max(
    1,
    Math.min(PROJECTION_BATCH_LIMIT, Math.trunc(Number(limit) || 10)),
  )
  const response = await primaryDb
    .prepare(
      `SELECT account_id
         FROM brinedew_authority_account_projection_outbox
        WHERE projection_state = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY source_event_sequence ASC
        LIMIT ?`,
    )
    .bind(attemptedAt, boundedLimit)
    .all()
  const rows = Array.isArray(response?.results) ? response.results : []
  const results = []
  for (const row of rows) {
    try {
      const projected = await projectBrinedewAccountToManifestationAuthority({
        primaryDb,
        authoringDb,
        accountId: row.account_id,
        now: attemptedAt,
        wakeManifestationProjection,
      })
      results.push({ account_id: row.account_id, status: "delivered", projected })
    } catch (error) {
      results.push({
        account_id: row.account_id,
        status: "failed",
        code: String(error?.code || "AUTHORITY_ACCOUNT_PROJECTION_FAILED"),
      })
    }
  }
  return Object.freeze({
    ok: results.every((result) => result.status === "delivered"),
    attempted: results.length,
    delivered: results.filter((result) => result.status === "delivered").length,
    failed: results.filter((result) => result.status === "failed").length,
    has_more: rows.length === boundedLimit,
    results: Object.freeze(results),
  })
}
