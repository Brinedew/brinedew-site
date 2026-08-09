// ARCHITECTURE FENCE [IPD-008]: D1 owns desired administrator policy, while
// anonymous manifest reads consume only the bounded KV projection below.
import ICONOPLASM_CANDIDATE_CONTRACT from "../iconoplasm-extension/candidate-contract.json" with { type: "json" }
import {
  applyIconoplasmPublicationAliasPolicyToGene,
  ICONOPLASM_PUBLICATION_ALIASES,
} from "./iconoplasm-publication-aliases.js"

export const ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY = "shared"
export const ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION = Number(
  ICONOPLASM_CANDIDATE_CONTRACT.extension_blocklist_schema_version,
)
export const ICONOPLASM_EXTENSION_BLOCKLIST_CONTRACT_REVISION = Number(
  ICONOPLASM_CANDIDATE_CONTRACT.extension_blocklist_contract_revision,
)
export const ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERMS = 500
export const ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERM_LENGTH = 64
export const ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES = 48 * 1024
export const ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES = 64 * 1024
export const ICONOPLASM_EXTENSION_BLOCKLIST_HISTORY_RETENTION = 100
export const ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION = 100
export const ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX =
  "iconoplasm:extension-blocklist-policy:v1:revision:"

const CATALOG_MANIFEST_KV_KEY = "iconoplasm:catalog-manifest"
const SCANNER_CATALOG_KV_PREFIX = "iconoplasm:scanner-catalog:"
const PUBLIC_CACHE_TTL_MS = 5_000
const PROJECTION_LEASE_MS = 60_000
const KV_REVISION_WIDTH = 20
const KV_LIST_LIMIT = 1_000
const KV_CLEANUP_BATCH_SIZE = 10
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u
const UNICODE_DASH_RE = /[\u2010-\u2015\u2212]/g
const VERSION_RE = /^ebl1-[a-f0-9]{16}$/

if (
  ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION !== 1 ||
  ICONOPLASM_EXTENSION_BLOCKLIST_CONTRACT_REVISION !== 1
) {
  throw new TypeError("Unsupported extension blocklist candidate contract")
}

let publicProjectionCache = new WeakMap()

export function iconoplasmExtensionBlocklistKvKey(revision) {
  const normalized = positiveRevision(revision)
  if (!normalized) {
    throw policyError(
      "invalid_extension_blocklist_revision",
      "Extension blocklist revision must be a positive integer",
      500,
    )
  }
  return `${ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX}${String(normalized).padStart(
    KV_REVISION_WIDTH,
    "0",
  )}`
}

function revisionFromProjectionKey(key) {
  const value = String(key || "")
  if (!value.startsWith(ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX)) return null
  const suffix = value.slice(ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX.length)
  if (!new RegExp(`^\\d{${KV_REVISION_WIDTH}}$`).test(suffix)) return null
  return positiveRevision(Number(suffix))
}

export class IconoplasmExtensionBlocklistPolicyError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message)
    this.name = "IconoplasmExtensionBlocklistPolicyError"
    this.code = code
    this.status = status
    this.details = details
  }
}

function policyError(code, message, status, details = null) {
  return new IconoplasmExtensionBlocklistPolicyError(code, message, status, details)
}

function requireBinding(binding, name) {
  if (!binding) throw policyError(`${name.toLowerCase()}_binding_missing`, `${name} binding missing`, 500)
  return binding
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength
}

function normalizedTerm(rawTerm, index) {
  if (typeof rawTerm !== "string") {
    throw policyError(
      "invalid_extension_blocklist_terms",
      `Blocklist term ${index + 1} must be a string`,
      400,
    )
  }
  const term = rawTerm.trim().replace(UNICODE_DASH_RE, "-").toUpperCase()
  if (!term) {
    throw policyError(
      "invalid_extension_blocklist_terms",
      `Blocklist term ${index + 1} is empty`,
      400,
    )
  }
  if (term.length > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERM_LENGTH) {
    throw policyError(
      "invalid_extension_blocklist_terms",
      `Blocklist term ${index + 1} exceeds ${ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERM_LENGTH} characters`,
      400,
    )
  }
  if (CONTROL_CHARACTER_RE.test(term)) {
    throw policyError(
      "invalid_extension_blocklist_terms",
      `Blocklist term ${index + 1} contains a control character`,
      400,
    )
  }
  return term
}

export function normalizeIconoplasmExtensionBlocklistTerms(rawTerms) {
  if (!Array.isArray(rawTerms)) {
    throw policyError(
      "invalid_extension_blocklist_terms",
      "Blocklist terms must be an array",
      400,
    )
  }
  if (rawTerms.length > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERMS) {
    throw policyError(
      "invalid_extension_blocklist_terms",
      `Blocklist cannot exceed ${ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERMS} terms`,
      400,
    )
  }
  return [...new Set(rawTerms.map(normalizedTerm))].sort()
}

async function contentVersion(terms) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(terms)),
  )
  const hex = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("")
  return `ebl1-${hex.slice(0, 16)}`
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || ""))
  } catch {
    return null
  }
}

function positiveRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null
}

function nullableRevision(value) {
  if (value == null) return null
  return positiveRevision(value)
}

function policyFromRow(row) {
  if (!row || typeof row !== "object") return null
  const revision = positiveRevision(row.revision)
  const version = String(row.version || "").trim()
  const rawTerms = safeJsonParse(row.terms_json)
  if (!revision || !VERSION_RE.test(version) || !Array.isArray(rawTerms)) return null
  let terms
  try {
    terms = normalizeIconoplasmExtensionBlocklistTerms(rawTerms)
  } catch {
    return null
  }
  if (JSON.stringify(terms) !== JSON.stringify(rawTerms)) return null
  return {
    policy_key: ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY,
    revision,
    version,
    terms,
    updated_at: String(row.updated_at || "") || null,
    updated_by: String(row.updated_by || "") || "unknown",
    published_revision: nullableRevision(row.published_revision),
    published_version: String(row.published_version || "").trim() || null,
    published_at: String(row.published_at || "").trim() || null,
    projection_lease_token: String(row.projection_lease_token || "").trim() || null,
    projection_lease_expires_at:
      String(row.projection_lease_expires_at || "").trim() || null,
    last_projection_error: String(row.last_projection_error || "").trim() || null,
  }
}

function prepare(db, sql, values = []) {
  return db.prepare(sql).bind(...values)
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) || 0
}

export async function readIconoplasmExtensionBlocklistPolicy(db) {
  requireBinding(db, "ICONOPLASM_DB")
  const row = await prepare(
    db,
    `SELECT policy_key, terms_json, revision, version, updated_at, updated_by,
            published_revision, published_version, published_at,
            projection_lease_token, projection_lease_expires_at, last_projection_error
       FROM icono_extension_blocklist_policy
      WHERE policy_key = ?1`,
    [ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY],
  ).first()
  const policy = policyFromRow(row)
  if (!policy) {
    throw policyError(
      "extension_blocklist_policy_unavailable",
      "Extension blocklist policy is missing or invalid; apply migration 0065",
      503,
    )
  }
  return policy
}

function sameTerms(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export async function saveIconoplasmExtensionBlocklistPolicy(
  db,
  { terms: rawTerms, expectedRevision, actor = "unknown", now = new Date() },
) {
  requireBinding(db, "ICONOPLASM_DB")
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw policyError(
      "expected_revision_required",
      "expected_revision must be a positive integer",
      428,
    )
  }
  const terms = normalizeIconoplasmExtensionBlocklistTerms(rawTerms)
  const current = await readIconoplasmExtensionBlocklistPolicy(db)
  if (current.revision !== expectedRevision) {
    throw policyError(
      "extension_blocklist_revision_conflict",
      "Extension blocklist changed since it was loaded",
      409,
      { current },
    )
  }
  if (sameTerms(current.terms, terms)) return { changed: false, policy: current }

  const revision = current.revision + 1
  const version = await contentVersion(terms)
  // Validate the exact public representation before the D1 CAS. A policy that
  // cannot fit in the bounded KV artifact must never become desired state.
  projectionForPolicy({ revision, version, terms })
  const changedAt = new Date(now).toISOString()
  const changedBy = String(actor || "unknown").trim().slice(0, 200) || "unknown"
  const termsJson = JSON.stringify(terms)
  const statements = [
    prepare(
      db,
      `UPDATE icono_extension_blocklist_policy
          SET terms_json = ?1,
              revision = ?2,
              version = ?3,
              updated_at = ?4,
              updated_by = ?5,
              last_projection_error = NULL
        WHERE policy_key = ?6
          AND revision = ?7`,
      [
        termsJson,
        revision,
        version,
        changedAt,
        changedBy,
        ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY,
        expectedRevision,
      ],
    ),
    prepare(
      db,
      `INSERT OR IGNORE INTO icono_extension_blocklist_policy_history (
         policy_key, revision, version, terms_json, changed_at, changed_by
       )
       SELECT policy_key, revision, version, terms_json, updated_at, updated_by
         FROM icono_extension_blocklist_policy
        WHERE policy_key = ?1
          AND revision = ?2
          AND version = ?3`,
      [ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY, revision, version],
    ),
    prepare(
      db,
      `DELETE FROM icono_extension_blocklist_policy_history
        WHERE policy_key = ?1
          AND revision NOT IN (
            SELECT revision
              FROM icono_extension_blocklist_policy_history
             WHERE policy_key = ?1
             ORDER BY revision DESC
             LIMIT ?2
          )`,
      [
        ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY,
        ICONOPLASM_EXTENSION_BLOCKLIST_HISTORY_RETENTION,
      ],
    ),
  ]
  const results = await db.batch(statements)
  if (changedRows(results?.[0]) !== 1) {
    const latest = await readIconoplasmExtensionBlocklistPolicy(db)
    throw policyError(
      "extension_blocklist_revision_conflict",
      "Extension blocklist changed since it was loaded",
      409,
      { current: latest },
    )
  }
  return { changed: true, policy: await readIconoplasmExtensionBlocklistPolicy(db) }
}

function parsePublishedProjection(raw) {
  const projection = typeof raw === "string" ? safeJsonParse(raw) : raw
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) return null
  if (Number(projection.schema_version) !== ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION) {
    return null
  }
  const revision = positiveRevision(projection.revision)
  const version = String(projection.version || "").trim()
  if (!revision || !VERSION_RE.test(version) || !Array.isArray(projection.terms)) return null
  let terms
  try {
    terms = normalizeIconoplasmExtensionBlocklistTerms(projection.terms)
  } catch {
    return null
  }
  if (!sameTerms(terms, projection.terms)) return null
  if (Number(projection.term_count) !== terms.length) return null
  const normalized = {
    schema_version: ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
    revision,
    version,
    term_count: terms.length,
    terms,
  }
  if (utf8ByteLength(JSON.stringify(normalized)) > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES) {
    return null
  }
  return Object.freeze({ ...normalized, terms: Object.freeze([...terms]) })
}

export function resetIconoplasmExtensionBlocklistPublicCacheForTests() {
  publicProjectionCache = new WeakMap()
}

async function listProjectionKeys(kv) {
  if (typeof kv?.list !== "function") {
    throw policyError("kv_list_unavailable", "KV binding does not support list()", 500)
  }
  const result = await kv.list({
    prefix: ICONOPLASM_EXTENSION_BLOCKLIST_KV_PREFIX,
    limit: KV_LIST_LIMIT,
  })
  if (result?.list_complete === false) {
    throw policyError(
      "extension_blocklist_projection_index_overflow",
      `Extension blocklist projection index exceeds ${KV_LIST_LIMIT} keys`,
      503,
    )
  }
  return (Array.isArray(result?.keys) ? result.keys : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .map((key) => ({ key: String(key || ""), revision: revisionFromProjectionKey(key) }))
    .filter((entry) => entry.revision)
    .sort((left, right) => left.revision - right.revision)
}

async function readHighestValidProjectionFromKv(kv) {
  const keys = await listProjectionKeys(kv)
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const entry = keys[index]
    const parsed = parsePublishedProjection(await kv.get(entry.key))
    if (parsed?.revision === entry.revision) return parsed
  }
  return null
}

export async function readAuthoritativePublishedIconoplasmExtensionBlocklist(kv) {
  requireBinding(kv, "KV")
  return readHighestValidProjectionFromKv(kv)
}

function monotonicProjection(cached, candidate) {
  if (!cached) return candidate
  if (!candidate || candidate.revision < cached.revision) return cached
  if (
    candidate.revision === cached.revision &&
    (candidate.version !== cached.version || !sameTerms(candidate.terms, cached.terms))
  ) {
    return cached
  }
  return candidate
}

export async function readPublishedIconoplasmExtensionBlocklist(
  kv,
  { fresh = false, nowMs = Date.now() } = {},
) {
  if (!kv) return null
  const cached = publicProjectionCache.get(kv)
  if (!fresh && cached && cached.expiresAt > nowMs) return cached.value
  const candidate = await readHighestValidProjectionFromKv(kv)
  const value = monotonicProjection(cached?.value || null, candidate)
  publicProjectionCache.set(kv, { value, expiresAt: nowMs + PUBLIC_CACHE_TTL_MS })
  return value
}

function cachePublishedProjection(kv, candidate) {
  const cached = publicProjectionCache.get(kv)
  publicProjectionCache.set(kv, {
    value: monotonicProjection(cached?.value || null, candidate),
    expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS,
  })
}

function projectionForPolicy(policy) {
  const projection = {
    schema_version: ICONOPLASM_EXTENSION_BLOCKLIST_SCHEMA_VERSION,
    revision: policy.revision,
    version: policy.version,
    term_count: policy.terms.length,
    terms: [...policy.terms],
  }
  const raw = JSON.stringify(projection)
  if (utf8ByteLength(raw) > ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES) {
    throw policyError(
      "extension_blocklist_projection_too_large",
      `Published extension blocklist exceeds ${ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES} bytes`,
      422,
    )
  }
  return { projection, raw }
}

function projectionMatchesPolicy(projection, policy) {
  return Boolean(
    projection &&
      policy &&
      projection.revision === policy.revision &&
      projection.version === policy.version &&
      sameTerms(projection.terms, policy.terms),
  )
}

function assertProjectionDoesNotConflictWithPolicy(projection, policy) {
  if (!projection) return
  if (projection.revision > policy.revision) {
    throw policyError(
      "extension_blocklist_public_projection_ahead",
      `Published extension blocklist revision ${projection.revision} is ahead of desired revision ${policy.revision}`,
      503,
    )
  }
  if (projection.revision === policy.revision && !projectionMatchesPolicy(projection, policy)) {
    throw policyError(
      "extension_blocklist_projection_revision_collision",
      `Published extension blocklist revision ${projection.revision} has different content`,
      503,
    )
  }
}

async function cleanupOldProjectionKeys(kv, protectedRevision = null) {
  const keys = await listProjectionKeys(kv)
  const excess = Math.max(0, keys.length - ICONOPLASM_EXTENSION_BLOCKLIST_KV_RETENTION)
  const doomed = keys
    .filter(({ revision }) => revision !== protectedRevision)
    .slice(0, Math.min(excess, KV_CLEANUP_BATCH_SIZE))
  if (doomed.length > 0 && typeof kv?.delete !== "function") {
    throw policyError("kv_delete_unavailable", "KV binding does not support delete()", 500)
  }
  await Promise.all(doomed.map(({ key }) => kv.delete(key)))
  return {
    deleted: doomed.length,
    pending: Math.max(0, excess - doomed.length),
  }
}

async function cleanupOldProjectionKeysBestEffort(kv, protectedRevision = null) {
  try {
    return { ok: true, ...(await cleanupOldProjectionKeys(kv, protectedRevision)) }
  } catch (error) {
    return { ok: false, deleted: 0, error: String(error?.message || error) }
  }
}

export function iconoplasmExtensionBlocklistPublicationState(policy, projection) {
  const inSync = Boolean(
    policy &&
      projection &&
      policy.revision === projection.revision &&
      policy.version === projection.version &&
      sameTerms(policy.terms, projection.terms) &&
      policy.published_revision === projection.revision &&
      policy.published_version === projection.version,
  )
  return {
    version: projection?.version || policy?.published_version || null,
    revision: projection?.revision || policy?.published_revision || null,
    in_sync: inSync,
    published_at: policy?.published_at || null,
    last_error: policy?.last_projection_error || null,
  }
}

async function readJsonFromKv(kv, key) {
  const raw = await kv.get(key)
  return safeJsonParse(raw)
}

export async function validateIconoplasmExtensionBlocklistAgainstPublishedScanner(kv, terms) {
  requireBinding(kv, "KV")
  const normalizedTerms = normalizeIconoplasmExtensionBlocklistTerms(terms)
  if (normalizedTerms.length === 0) return normalizedTerms
  const manifest = await readJsonFromKv(kv, CATALOG_MANIFEST_KV_KEY)
  const scannerVersion = String(
    manifest?.scanner_artifact?.build_version || manifest?.current_hash || "",
  ).trim()
  if (!scannerVersion) {
    throw policyError(
      "published_scanner_unavailable",
      "Published scanner catalog is unavailable; publish the catalog before editing this policy",
      503,
    )
  }
  const scanner = await readJsonFromKv(kv, `${SCANNER_CATALOG_KV_PREFIX}${scannerVersion}`)
  const genes = scanner?.genes
  if (!genes || typeof genes !== "object" || Array.isArray(genes)) {
    throw policyError(
      "published_scanner_unavailable",
      "Published scanner catalog is unavailable; publish the catalog before editing this policy",
      503,
    )
  }

  const canonicalSymbols = new Set(
    Object.keys(genes)
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean),
  )
  const aliasOwners = new Map()
  for (const [rawSymbol, gene] of Object.entries(genes)) {
    const symbol = String(rawSymbol || "").trim().toUpperCase()
    const effectiveGene = applyIconoplasmPublicationAliasPolicyToGene(
      gene,
      symbol,
      ICONOPLASM_PUBLICATION_ALIASES,
    )
    for (const rawAlias of Array.isArray(effectiveGene?.a) ? effectiveGene.a : []) {
      let alias
      try {
        alias = normalizedTerm(String(rawAlias || ""), 0)
      } catch {
        continue
      }
      if (!alias || alias === symbol || canonicalSymbols.has(alias)) continue
      if (!aliasOwners.has(alias)) {
        aliasOwners.set(alias, symbol)
      } else if (aliasOwners.get(alias) !== symbol) {
        aliasOwners.set(alias, null)
      }
    }
  }

  const invalidTerms = []
  for (const term of normalizedTerms) {
    if (canonicalSymbols.has(term)) {
      invalidTerms.push({ term, reason: "canonical_symbol" })
    } else if (!aliasOwners.has(term)) {
      invalidTerms.push({ term, reason: "not_published_alias" })
    } else if (!aliasOwners.get(term)) {
      invalidTerms.push({ term, reason: "ambiguous_alias" })
    }
  }
  if (invalidTerms.length) {
    throw policyError(
      "extension_blocklist_terms_not_aliases",
      "Every shared blocklist term must be an unambiguous alias in the published scanner catalog, never a canonical symbol",
      422,
      { invalid_terms: invalidTerms },
    )
  }
  return normalizedTerms
}

function leaseToken() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function claimProjectionLease(db, { now = new Date() } = {}) {
  const acquiredAt = new Date(now)
  const expiresAt = new Date(acquiredAt.getTime() + PROJECTION_LEASE_MS).toISOString()
  const token = leaseToken()
  const result = await prepare(
    db,
    `UPDATE icono_extension_blocklist_policy
        SET projection_lease_token = ?1,
            projection_lease_expires_at = ?2
      WHERE policy_key = ?3
        AND (
          projection_lease_token IS NULL
          OR projection_lease_expires_at IS NULL
          OR projection_lease_expires_at <= ?4
        )`,
    [token, expiresAt, ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY, acquiredAt.toISOString()],
  ).run()
  return changedRows(result) === 1 ? { token, expiresAt } : null
}

async function releaseProjectionLease(db, token, errorMessage = null) {
  await prepare(
    db,
    `UPDATE icono_extension_blocklist_policy
        SET projection_lease_token = NULL,
            projection_lease_expires_at = NULL,
            last_projection_error = ?1
      WHERE policy_key = ?2
        AND projection_lease_token = ?3`,
    [
      errorMessage == null ? null : String(errorMessage || "projection_failed").slice(0, 500),
      ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY,
      token,
    ],
  ).run()
}

export async function publishIconoplasmExtensionBlocklistPolicy(
  db,
  kv,
  { now = new Date(), maxAttempts = 3 } = {},
) {
  requireBinding(db, "ICONOPLASM_DB")
  requireBinding(kv, "KV")
  const before = await readIconoplasmExtensionBlocklistPolicy(db)
  const publishedBefore = await readHighestValidProjectionFromKv(kv)
  assertProjectionDoesNotConflictWithPolicy(publishedBefore, before)
  if (iconoplasmExtensionBlocklistPublicationState(before, publishedBefore).in_sync) {
    return {
      ok: true,
      changed: false,
      skipped: true,
      policy: before,
      projection: publishedBefore,
      cleanup: await cleanupOldProjectionKeysBestEffort(kv, before.revision),
    }
  }

  const lease = await claimProjectionLease(db, { now })
  if (!lease) {
    const policy = await readIconoplasmExtensionBlocklistPolicy(db)
    const projection = await readHighestValidProjectionFromKv(kv)
    return { ok: false, changed: false, busy: true, policy, projection }
  }

  try {
    for (let attempt = 0; attempt < Math.max(1, Math.min(5, maxAttempts)); attempt += 1) {
      const policy = await readIconoplasmExtensionBlocklistPolicy(db)
      if (policy.projection_lease_token !== lease.token) {
        throw policyError(
          "extension_blocklist_projection_lease_lost",
          "Extension blocklist projection lease was lost",
          503,
        )
      }
      const { projection, raw } = projectionForPolicy(policy)
      const publishedNow = await readHighestValidProjectionFromKv(kv)
      assertProjectionDoesNotConflictWithPolicy(publishedNow, policy)
      const key = iconoplasmExtensionBlocklistKvKey(policy.revision)
      const existingRaw = await kv.get(key)
      if (existingRaw != null) {
        const existing = parsePublishedProjection(existingRaw)
        if (!projectionMatchesPolicy(existing, policy)) {
          throw policyError(
            "extension_blocklist_projection_revision_collision",
            `Immutable extension blocklist revision ${policy.revision} already has different content`,
            503,
          )
        }
      } else {
        await kv.put(key, raw)
      }
      const publishedAfter = await readHighestValidProjectionFromKv(kv)
      assertProjectionDoesNotConflictWithPolicy(publishedAfter, policy)
      if (!projectionMatchesPolicy(publishedAfter, policy)) {
        throw policyError(
          "extension_blocklist_projection_not_visible",
          `Extension blocklist revision ${policy.revision} is not yet visible in the public projection index`,
          503,
        )
      }
      const publishedAt = new Date().toISOString()
      const acknowledged = await prepare(
        db,
        `UPDATE icono_extension_blocklist_policy
            SET published_revision = ?1,
                published_version = ?2,
                published_at = ?3,
                projection_lease_token = NULL,
                projection_lease_expires_at = NULL,
                last_projection_error = NULL
          WHERE policy_key = ?4
            AND revision = ?5
            AND version = ?6
            AND projection_lease_token = ?7`,
        [
          policy.revision,
          policy.version,
          publishedAt,
          ICONOPLASM_EXTENSION_BLOCKLIST_POLICY_KEY,
          policy.revision,
          policy.version,
          lease.token,
        ],
      ).run()
      if (changedRows(acknowledged) === 1) {
        cachePublishedProjection(kv, publishedAfter)
        return {
          ok: true,
          changed: true,
          skipped: false,
          policy: await readIconoplasmExtensionBlocklistPolicy(db),
          projection: publishedAfter,
          cleanup: await cleanupOldProjectionKeysBestEffort(kv, policy.revision),
        }
      }
    }
    throw policyError(
      "extension_blocklist_projection_contended",
      "Extension blocklist changed repeatedly during publication",
      503,
    )
  } catch (error) {
    await releaseProjectionLease(db, lease.token, error?.message || error)
    if (error instanceof IconoplasmExtensionBlocklistPolicyError) throw error
    throw policyError(
      "extension_blocklist_projection_failed",
      `Extension blocklist was saved but publication failed: ${String(error?.message || error)}`,
      503,
    )
  }
}

export async function reconcileIconoplasmExtensionBlocklistPolicy(
  env,
  { now = new Date() } = {},
) {
  if (!env?.ICONOPLASM_DB || !env?.KV) {
    return { ok: false, skipped: true, reason: "binding_missing" }
  }
  const policy = await readIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB)
  const projection = await readHighestValidProjectionFromKv(env.KV)
  const publication = iconoplasmExtensionBlocklistPublicationState(policy, projection)
  const leaseExpiresAt = Date.parse(policy.projection_lease_expires_at || "")
  const leaseIsActive =
    Boolean(policy.projection_lease_token) &&
    Number.isFinite(leaseExpiresAt) &&
    leaseExpiresAt > new Date(now).getTime()
  if (publication.in_sync && !policy.projection_lease_token) {
    return {
      ok: true,
      changed: false,
      skipped: true,
      reason: "already_published",
      cleanup: await cleanupOldProjectionKeysBestEffort(env.KV, policy.revision),
    }
  }
  if (leaseIsActive) {
    return { ok: true, changed: false, skipped: true, reason: "projection_in_progress" }
  }
  if (publication.in_sync && policy.projection_lease_token) {
    await releaseProjectionLease(env.ICONOPLASM_DB, policy.projection_lease_token)
    return {
      ok: true,
      changed: false,
      skipped: true,
      cleaned_expired_lease: true,
      reason: "already_published",
      cleanup: await cleanupOldProjectionKeysBestEffort(env.KV, policy.revision),
    }
  }
  return publishIconoplasmExtensionBlocklistPolicy(env.ICONOPLASM_DB, env.KV, { now })
}

export const ICONOPLASM_EXTENSION_BLOCKLIST_LIMITS = Object.freeze({
  max_terms: ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERMS,
  max_term_length: ICONOPLASM_EXTENSION_BLOCKLIST_MAX_TERM_LENGTH,
  max_projection_bytes: ICONOPLASM_EXTENSION_BLOCKLIST_MAX_PROJECTION_BYTES,
  max_request_bytes: ICONOPLASM_EXTENSION_BLOCKLIST_MAX_REQUEST_BYTES,
})
