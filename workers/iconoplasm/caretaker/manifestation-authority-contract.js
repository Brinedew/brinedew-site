export const MANIFESTATION_AUTHORITY_EVENT_TYPE = "manifestation.authority_gene_snapshot.v1"

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,63}$/
const RELINQUISH_POLICIES = new Set(["retain", "withdraw"])

export class ManifestationAuthorityError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "ManifestationAuthorityError"
    this.code = code
    this.status = status
  }
}

function authorityError(code, message, status = 400, cause) {
  return new ManifestationAuthorityError(code, message, { status, cause })
}

function normalizeId(raw, label) {
  const value = String(raw || "").trim()
  if (!ID_PATTERN.test(value)) throw authorityError("INVALID_ID", `${label} is invalid`)
  return value
}

function normalizeOptionalId(raw, label) {
  return raw == null || raw === "" ? null : normalizeId(raw, label)
}

function normalizeSha256(raw, label = "request_sha256") {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (!SHA256_PATTERN.test(value)) throw authorityError("INVALID_SHA256", `${label} is invalid`)
  return value
}

function normalizeSymbol(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL_PATTERN.test(value))
    throw authorityError("INVALID_GENE_SYMBOL", "Gene symbol is invalid")
  return value
}

function normalizeVersion(raw, label) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw authorityError("INVALID_VERSION", `${label} is invalid`)
  }
  return value
}

function normalizePolicy(raw, fallback = null) {
  const value = String(raw || fallback || "")
    .trim()
    .toLowerCase()
  if (!RELINQUISH_POLICIES.has(value)) {
    throw authorityError(
      "INVALID_RELINQUISH_POLICY",
      "Relinquish policy must be retain or withdraw",
    )
  }
  return value
}

function normalizeActorKind(raw) {
  const value = String(raw || "account").trim()
  if (!["account", "administrator", "service", "migration"].includes(value)) {
    throw authorityError("INVALID_ACTOR_KIND", "Actor kind is invalid")
  }
  return value
}

function normalizeTimestamp(raw) {
  const value = raw == null ? new Date().toISOString() : String(raw).trim()
  if (!value || Number.isNaN(Date.parse(value))) {
    throw authorityError("INVALID_TIMESTAMP", "Timestamp is invalid")
  }
  return new Date(value).toISOString()
}

function defaultIdFactory(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`
}

function createId(raw, label, prefix, idFactory) {
  return normalizeId(raw || idFactory(prefix), label)
}

export {
  authorityError,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizePolicy,
  normalizeSha256,
  normalizeSymbol,
  normalizeTimestamp,
  normalizeVersion,
  defaultIdFactory,
  createId,
}
