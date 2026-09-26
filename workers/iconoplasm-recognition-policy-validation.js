// ARCHITECTURE FENCE [IPD-005]: this singleton receipt is bounded operational
// D1 state, never an append-only validation ledger.
// ARCHITECTURE FENCE [IPD-008]: expensive scanner validation is represented by
// one bounded D1 receipt. Projection and pair retries must use the exact receipt
// and must never rebuild the scanner index merely to wait for KV propagation.

export const ICONOPLASM_RECOGNITION_VALIDATION_POLICY_KEY = "shared"
export const ICONOPLASM_RECOGNITION_VALIDATOR_REVISION = 1

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

export async function recordIconoplasmRecognitionValidationReceipt(
  db,
  target,
  { now = new Date() } = {},
) {
  const result = await prepareIconoplasmRecognitionValidationReceiptUpsert(db, target, {
    now,
  }).run()
  return changedRows(result) === 1
}
