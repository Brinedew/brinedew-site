// ARCHITECTURE FENCE [IPD-005]: this singleton receipt is bounded operational
// D1 state, never an append-only validation ledger.
// ARCHITECTURE FENCE [IPD-008]: expensive scanner validation is represented by
// one bounded D1 receipt. Projection and pair retries must use the exact receipt
// and must never rebuild the scanner index merely to wait for KV propagation.

export const ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY = "shared"
export const ICONOPLASM_RECOGNITION_VALIDATOR_REVISION = 1
export const ICONOPLASM_RECOGNITION_VALIDATION_LEASE_MS = 60_000

const STATES = new Set(["unvalidated", "valid", "invalid"])

function positiveRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) || 0
}

function prepare(db, sql, values = []) {
  return db.prepare(sql).bind(...values)
}

function normalizedVersion(value) {
  const version = String(value || "").trim()
  return version && version.length <= 100 ? version : null
}

function normalizedScannerVersion(value, { allowEmpty = false } = {}) {
  const version = String(value || "").trim()
  if (!version) return allowEmpty ? "" : null
  return version.length <= 200 ? version : null
}

export function iconoplasmRecognitionValidationTarget({
  scannerVersion,
  aliases,
  blocklist,
  validatorRevision = ICONOPLASM_RECOGNITION_VALIDATOR_REVISION,
}) {
  const scanner = normalizedScannerVersion(scannerVersion)
  const aliasRevision = positiveRevision(aliases?.revision)
  const aliasVersion = normalizedVersion(aliases?.version)
  const blocklistRevision = positiveRevision(blocklist?.revision)
  const blocklistVersion = normalizedVersion(blocklist?.version)
  const validator = positiveRevision(validatorRevision)
  if (
    !scanner ||
    !aliasRevision ||
    !aliasVersion ||
    !blocklistRevision ||
    !blocklistVersion ||
    !validator
  ) {
    throw new TypeError("Recognition validation target is incomplete")
  }
  return Object.freeze({
    validator_revision: validator,
    scanner_version: scanner,
    alias_revision: aliasRevision,
    alias_version: aliasVersion,
    blocklist_revision: blocklistRevision,
    blocklist_version: blocklistVersion,
  })
}

function receiptFromRow(row) {
  if (!row || typeof row !== "object") return null
  const state = String(row.state || "")
  const validatorRevision = positiveRevision(row.validator_revision)
  const scannerVersion = normalizedScannerVersion(row.scanner_version, { allowEmpty: true })
  const aliasRevision = positiveRevision(row.alias_revision)
  const aliasVersion = normalizedVersion(row.alias_version)
  const blocklistRevision = positiveRevision(row.blocklist_revision)
  const blocklistVersion = normalizedVersion(row.blocklist_version)
  const validatedAt = String(row.validated_at || "").trim() || null
  const leaseToken = String(row.validation_lease_token || "").trim() || null
  const leaseExpiresAt = String(row.validation_lease_expires_at || "").trim() || null
  const lastValidationError = String(row.last_validation_error || "").trim() || null
  const stateIsValid =
    state === "valid" &&
    Boolean(scannerVersion) &&
    validatedAt &&
    Number.isFinite(Date.parse(validatedAt)) &&
    !leaseToken &&
    !leaseExpiresAt &&
    !lastValidationError
  const stateIsInvalid =
    state === "invalid" &&
    Boolean(scannerVersion) &&
    !validatedAt &&
    !leaseToken &&
    !leaseExpiresAt &&
    Boolean(lastValidationError)
  const stateIsUnvalidated =
    state === "unvalidated" &&
    !validatedAt &&
    Boolean(leaseToken) === Boolean(leaseExpiresAt) &&
    (!leaseExpiresAt || Number.isFinite(Date.parse(leaseExpiresAt)))
  if (
    !STATES.has(state) ||
    !validatorRevision ||
    scannerVersion == null ||
    !aliasRevision ||
    !aliasVersion ||
    !blocklistRevision ||
    !blocklistVersion ||
    (!stateIsValid && !stateIsInvalid && !stateIsUnvalidated)
  ) {
    return null
  }
  return Object.freeze({
    policy_key: ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY,
    state,
    validator_revision: validatorRevision,
    scanner_version: scannerVersion,
    alias_revision: aliasRevision,
    alias_version: aliasVersion,
    blocklist_revision: blocklistRevision,
    blocklist_version: blocklistVersion,
    validated_at: validatedAt,
    validation_lease_token: leaseToken,
    validation_lease_expires_at: leaseExpiresAt,
    last_validation_error: lastValidationError,
  })
}

export function iconoplasmRecognitionValidationReceiptMatches(receipt, target, state = "valid") {
  return Boolean(
    receipt &&
    receipt.state === state &&
    receipt.validator_revision === target.validator_revision &&
    receipt.scanner_version === target.scanner_version &&
    receipt.alias_revision === target.alias_revision &&
    receipt.alias_version === target.alias_version &&
    receipt.blocklist_revision === target.blocklist_revision &&
    receipt.blocklist_version === target.blocklist_version,
  )
}

export function iconoplasmRecognitionValidationTargetMatches(
  target,
  { scannerVersion, aliases, blocklist },
) {
  if (!target) return false
  let candidate
  try {
    candidate = iconoplasmRecognitionValidationTarget({ scannerVersion, aliases, blocklist })
  } catch {
    return false
  }
  return (
    candidate.validator_revision === target.validator_revision &&
    candidate.scanner_version === target.scanner_version &&
    candidate.alias_revision === target.alias_revision &&
    candidate.alias_version === target.alias_version &&
    candidate.blocklist_revision === target.blocklist_revision &&
    candidate.blocklist_version === target.blocklist_version
  )
}

export async function readIconoplasmRecognitionValidationReceipt(db) {
  const row = await prepare(
    db,
    `SELECT policy_key, state, validator_revision, scanner_version,
            alias_revision, alias_version, blocklist_revision, blocklist_version,
            validated_at, validation_lease_token, validation_lease_expires_at,
            last_validation_error
       FROM icono_recognition_policy_validation
      WHERE policy_key = ?1`,
    [ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY],
  ).first()
  const receipt = receiptFromRow(row)
  if (!receipt)
    throw new Error(
      "Recognition policy validation state is missing or invalid; apply migration 0067",
    )
  return receipt
}

export function prepareIconoplasmRecognitionValidationReceiptUpsert(
  db,
  target,
  { now = new Date() } = {},
) {
  return prepare(
    db,
    `INSERT INTO icono_recognition_policy_validation (
       policy_key, state, validator_revision, scanner_version,
       alias_revision, alias_version, blocklist_revision, blocklist_version,
       validated_at, validation_lease_token, validation_lease_expires_at,
       last_validation_error
     )
     SELECT 'shared', 'valid', ?1, ?2,
            aliases.revision, aliases.version, blocklist.revision, blocklist.version,
            ?3, NULL, NULL, NULL
       FROM icono_publication_alias_policy AS aliases
       CROSS JOIN icono_extension_blocklist_policy AS blocklist
      WHERE aliases.policy_key = 'curated'
        AND blocklist.policy_key = 'shared'
        AND aliases.revision = ?4
        AND aliases.version = ?5
        AND blocklist.revision = ?6
        AND blocklist.version = ?7
     ON CONFLICT(policy_key) DO UPDATE SET
       state = excluded.state,
       validator_revision = excluded.validator_revision,
       scanner_version = excluded.scanner_version,
       alias_revision = excluded.alias_revision,
       alias_version = excluded.alias_version,
       blocklist_revision = excluded.blocklist_revision,
       blocklist_version = excluded.blocklist_version,
       validated_at = excluded.validated_at,
       validation_lease_token = NULL,
       validation_lease_expires_at = NULL,
       last_validation_error = NULL`,
    [
      target.validator_revision,
      target.scanner_version,
      new Date(now).toISOString(),
      target.alias_revision,
      target.alias_version,
      target.blocklist_revision,
      target.blocklist_version,
    ],
  )
}

function leaseToken() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export async function claimIconoplasmRecognitionValidationLease(
  db,
  target,
  { now = new Date() } = {},
) {
  const current = await readIconoplasmRecognitionValidationReceipt(db)
  if (iconoplasmRecognitionValidationReceiptMatches(current, target, "valid")) {
    return { status: "valid", receipt: current }
  }
  if (iconoplasmRecognitionValidationReceiptMatches(current, target, "invalid")) {
    return { status: "invalid", receipt: current }
  }
  const nowDate = new Date(now)
  const activeUntil = Date.parse(current.validation_lease_expires_at || "")
  const sameTarget =
    current.validator_revision === target.validator_revision &&
    current.scanner_version === target.scanner_version &&
    current.alias_revision === target.alias_revision &&
    current.alias_version === target.alias_version &&
    current.blocklist_revision === target.blocklist_revision &&
    current.blocklist_version === target.blocklist_version
  if (
    sameTarget &&
    current.validation_lease_token &&
    Number.isFinite(activeUntil) &&
    activeUntil > nowDate.getTime()
  ) {
    return { status: "busy", receipt: current }
  }
  const token = leaseToken()
  const expiresAt = new Date(nowDate.getTime() + ICONOPLASM_RECOGNITION_VALIDATION_LEASE_MS)
  const result = await prepare(
    db,
    `UPDATE icono_recognition_policy_validation
        SET state = 'unvalidated', validator_revision = ?1, scanner_version = ?2,
            alias_revision = ?3, alias_version = ?4,
            blocklist_revision = ?5, blocklist_version = ?6,
            validated_at = NULL, validation_lease_token = ?7,
            validation_lease_expires_at = ?8, last_validation_error = NULL
      WHERE policy_key = ?9
        AND EXISTS (
          SELECT 1
            FROM icono_publication_alias_policy AS aliases
           WHERE aliases.policy_key = 'curated'
             AND aliases.revision = ?3
             AND aliases.version = ?4
        )
        AND EXISTS (
          SELECT 1
            FROM icono_extension_blocklist_policy AS blocklist
           WHERE blocklist.policy_key = 'shared'
             AND blocklist.revision = ?5
             AND blocklist.version = ?6
        )
        AND (
          validator_revision <> ?1 OR scanner_version <> ?2 OR
          alias_revision <> ?3 OR alias_version <> ?4 OR
          blocklist_revision <> ?5 OR blocklist_version <> ?6 OR
          validation_lease_token IS NULL OR validation_lease_expires_at IS NULL OR
          validation_lease_expires_at <= ?10
        )`,
    [
      target.validator_revision,
      target.scanner_version,
      target.alias_revision,
      target.alias_version,
      target.blocklist_revision,
      target.blocklist_version,
      token,
      expiresAt.toISOString(),
      ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY,
      nowDate.toISOString(),
    ],
  ).run()
  return changedRows(result) === 1
    ? { status: "owned", token, expires_at: expiresAt.toISOString() }
    : { status: "busy", receipt: await readIconoplasmRecognitionValidationReceipt(db) }
}

async function finishLease(db, target, token, { state, error = null, now = new Date() }) {
  const result = await prepare(
    db,
    `UPDATE icono_recognition_policy_validation
        SET state = ?1, validated_at = ?2,
            validation_lease_token = NULL, validation_lease_expires_at = NULL,
            last_validation_error = ?3
      WHERE policy_key = ?4
        AND validator_revision = ?5 AND scanner_version = ?6
        AND alias_revision = ?7 AND alias_version = ?8
        AND blocklist_revision = ?9 AND blocklist_version = ?10
        AND validation_lease_token = ?11
        AND EXISTS (
          SELECT 1
            FROM icono_publication_alias_policy AS aliases
           WHERE aliases.policy_key = 'curated'
             AND aliases.revision = ?7
             AND aliases.version = ?8
        )
        AND EXISTS (
          SELECT 1
            FROM icono_extension_blocklist_policy AS blocklist
           WHERE blocklist.policy_key = 'shared'
             AND blocklist.revision = ?9
             AND blocklist.version = ?10
        )`,
    [
      state,
      state === "valid" ? new Date(now).toISOString() : null,
      error == null ? null : String(error).slice(0, 500),
      ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY,
      target.validator_revision,
      target.scanner_version,
      target.alias_revision,
      target.alias_version,
      target.blocklist_revision,
      target.blocklist_version,
      token,
    ],
  ).run()
  return changedRows(result) === 1
}

export function completeIconoplasmRecognitionValidationLease(db, target, token, options = {}) {
  return finishLease(db, target, token, { ...options, state: "valid" })
}

export function rejectIconoplasmRecognitionValidationLease(db, target, token, error, options = {}) {
  return finishLease(db, target, token, { ...options, state: "invalid", error })
}

export function releaseIconoplasmRecognitionValidationLease(
  db,
  target,
  token,
  error,
  options = {},
) {
  return finishLease(db, target, token, { ...options, state: "unvalidated", error })
}
