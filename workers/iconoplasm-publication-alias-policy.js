// ARCHITECTURE FENCE [IPD-005]: D1 owns one bounded desired policy plus a
// pruned audit trail; immutable public projections live in KV.
// ARCHITECTURE FENCE [IPD-008]: anonymous manifest/search/resolve traffic must
// never fall back to D1. The bundled dictionary is bootstrap-only when no valid
// KV projection has ever been published.
import {
  iconoplasmPublicationAliasManifest,
  iconoplasmPublicationAliasManifestFromPolicy,
  invalidIconoplasmPublishedAliasTerms,
  MAX_PUBLICATION_ALIAS_COUNT,
  MAX_PUBLICATION_ALIAS_LENGTH,
  normalizePublicationAlias,
  normalizePublicationAliasSymbol,
  PUBLICATION_ALIAS_SCHEMA_VERSION,
  publicationAliasCollisionKey,
  validateIconoplasmPublicationAliases,
} from "./iconoplasm-publication-aliases.js"

export const ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY = "curated"
export const ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES = 4 * 1024
export const ICONOPLASM_PUBLICATION_ALIAS_MAX_REQUEST_BYTES = 16 * 1024
export const ICONOPLASM_PUBLICATION_ALIAS_HISTORY_RETENTION = 100
export const ICONOPLASM_PUBLICATION_ALIAS_KV_RETENTION = 100
export const ICONOPLASM_PUBLICATION_ALIAS_KV_PREFIX =
  "iconoplasm:publication-alias-policy:v1:revision:"
export const ICONOPLASM_PUBLICATION_ALIAS_VERSION_KV_PREFIX =
  "iconoplasm:publication-alias-policy:v1:version:"

const CATALOG_MANIFEST_KV_KEY = "iconoplasm:catalog-manifest"
const SCANNER_CATALOG_KV_PREFIX = "iconoplasm:scanner-catalog:"
const PUBLIC_CACHE_TTL_MS = 5_000
const PROJECTION_LEASE_MS = 60_000
const KV_REVISION_WIDTH = 20
const KV_LIST_LIMIT = 1_000
const KV_CLEANUP_BATCH_SIZE = 10
const VERSION_RE = /^v1-[a-f0-9]{16}$/
const VERSION_TOKEN_RE = /^v1[a-f0-9]{16}$/
const PUBLIC_PROJECTION_FIELDS = Object.freeze([
  "alias_count",
  "by_symbol",
  "removal_count",
  "remove_by_symbol",
  "schema_version",
  "version",
])

let publicProjectionCache = new WeakMap()
let bootstrapProjectionPromise = null

export class IconoplasmPublicationAliasPolicyError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message)
    this.name = "IconoplasmPublicationAliasPolicyError"
    this.code = code
    this.status = status
    this.details = details
  }
}

function policyError(code, message, status, details = null) {
  return new IconoplasmPublicationAliasPolicyError(code, message, status, details)
}

function requireBinding(binding, name) {
  if (!binding) {
    throw policyError(`${name.toLowerCase()}_binding_missing`, `${name} binding missing`, 500)
  }
  return binding
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength
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

function prepare(db, sql, values = []) {
  return db.prepare(sql).bind(...values)
}

function changedRows(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) || 0
}

function publicPolicyShape(policy) {
  return {
    schema_version: PUBLICATION_ALIAS_SCHEMA_VERSION,
    alias_count: Number(policy?.alias_count || 0),
    removal_count: Number(policy?.removal_count || 0),
    by_symbol: policy?.by_symbol || {},
    remove_by_symbol: policy?.remove_by_symbol || {},
  }
}

function samePolicy(left, right) {
  return JSON.stringify(publicPolicyShape(left)) === JSON.stringify(publicPolicyShape(right))
}

async function normalizedManifest(rawPolicy) {
  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) return null
  let manifest
  try {
    manifest = await iconoplasmPublicationAliasManifestFromPolicy(rawPolicy)
  } catch {
    return null
  }
  if (
    Number(rawPolicy.schema_version) !== manifest.schema_version ||
    Number(rawPolicy.alias_count) !== manifest.alias_count ||
    Number(rawPolicy.removal_count) !== manifest.removal_count ||
    String(rawPolicy.version || "") !== manifest.version ||
    JSON.stringify(rawPolicy.by_symbol) !== JSON.stringify(manifest.by_symbol) ||
    JSON.stringify(rawPolicy.remove_by_symbol) !== JSON.stringify(manifest.remove_by_symbol)
  ) {
    return null
  }
  const fields = Object.keys(rawPolicy).sort()
  if (JSON.stringify(fields) !== JSON.stringify(PUBLIC_PROJECTION_FIELDS)) return null
  if (
    utf8ByteLength(JSON.stringify(manifest)) >= ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES
  ) {
    return null
  }
  return manifest
}

async function policyFromRow(row) {
  if (!row || typeof row !== "object") return null
  const revision = positiveRevision(row.revision)
  const version = String(row.version || "").trim()
  const rawPolicy = safeJsonParse(row.policy_json)
  if (
    !revision ||
    !VERSION_RE.test(version) ||
    !rawPolicy ||
    (row.depends_on_blocklist_revision != null &&
      !positiveRevision(row.depends_on_blocklist_revision))
  ) {
    return null
  }
  const manifest = await iconoplasmPublicationAliasManifestFromPolicy(rawPolicy).catch(() => null)
  if (!manifest || manifest.version !== version) return null
  if (JSON.stringify(publicPolicyShape(manifest)) !== JSON.stringify(rawPolicy)) return null
  return Object.freeze({
    policy_key: ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY,
    revision,
    ...manifest,
    updated_at: String(row.updated_at || "").trim() || null,
    updated_by: String(row.updated_by || "").trim() || "unknown",
    depends_on_blocklist_revision: nullableRevision(row.depends_on_blocklist_revision),
    published_revision: nullableRevision(row.published_revision),
    published_version: String(row.published_version || "").trim() || null,
    published_at: String(row.published_at || "").trim() || null,
    projection_lease_token: String(row.projection_lease_token || "").trim() || null,
    projection_lease_expires_at: String(row.projection_lease_expires_at || "").trim() || null,
    last_projection_error: String(row.last_projection_error || "").trim() || null,
  })
}

export async function readIconoplasmPublicationAliasPolicy(db) {
  requireBinding(db, "ICONOPLASM_DB")
  const row = await prepare(
    db,
    `SELECT policy_key, policy_json, revision, version, updated_at, updated_by,
            depends_on_blocklist_revision,
            published_revision, published_version, published_at,
            projection_lease_token, projection_lease_expires_at, last_projection_error
       FROM icono_publication_alias_policy
      WHERE policy_key = ?1`,
    [ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY],
  ).first()
  const policy = await policyFromRow(row)
  if (!policy) {
    throw policyError(
      "publication_alias_policy_unavailable",
      "Publication alias policy is missing or invalid; apply migration 0066",
      503,
    )
  }
  return policy
}

function policyJson(policy) {
  return JSON.stringify(publicPolicyShape(policy))
}

function projectionForPolicy(policy) {
  const projection = {
    schema_version: PUBLICATION_ALIAS_SCHEMA_VERSION,
    alias_count: policy.alias_count,
    removal_count: policy.removal_count,
    by_symbol: policy.by_symbol,
    remove_by_symbol: policy.remove_by_symbol,
    version: policy.version,
  }
  const publicRaw = JSON.stringify(projection)
  if (utf8ByteLength(publicRaw) >= ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES) {
    throw policyError(
      "publication_alias_projection_too_large",
      `Published alias policy must remain below ${ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES} bytes`,
      422,
    )
  }
  const revision = positiveRevision(policy?.revision)
  const raw = revision
    ? JSON.stringify({
        schema_version: 1,
        revision,
        depends_on_blocklist_revision: nullableRevision(policy?.depends_on_blocklist_revision),
        publication_aliases: projection,
      })
    : publicRaw
  return { projection: Object.freeze(projection), raw }
}

export async function saveIconoplasmPublicationAliasPolicy(
  db,
  {
    bySymbol,
    removeBySymbol,
    expectedRevision,
    expectedBlocklistRevision = null,
    actor = "unknown",
    now = new Date(),
  },
) {
  requireBinding(db, "ICONOPLASM_DB")
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw policyError(
      "expected_revision_required",
      "expected_revision must be a positive integer",
      428,
    )
  }
  if (
    expectedBlocklistRevision != null &&
    (!Number.isSafeInteger(expectedBlocklistRevision) || expectedBlocklistRevision < 1)
  ) {
    throw policyError(
      "invalid_extension_blocklist_revision_dependency",
      "Expected extension blocklist revision must be a positive integer",
      500,
    )
  }
  const current = await readIconoplasmPublicationAliasPolicy(db)
  let validated
  try {
    validated = validateIconoplasmPublicationAliases(bySymbol, { rawRemovals: removeBySymbol })
  } catch (error) {
    throw policyError("invalid_publication_alias_policy", String(error?.message || error), 422)
  }
  const manifest = await iconoplasmPublicationAliasManifestFromPolicy(validated)
  projectionForPolicy(manifest)
  if (current.revision !== expectedRevision) {
    throw policyError(
      "publication_alias_revision_conflict",
      "Publication alias policy changed since it was loaded",
      409,
      { current },
    )
  }
  if (samePolicy(current, manifest)) return { changed: false, policy: current }

  const revision = current.revision + 1
  const changedAt = new Date(now).toISOString()
  const changedBy =
    String(actor || "unknown")
      .trim()
      .slice(0, 200) || "unknown"
  const nextPolicyJson = policyJson(manifest)
  const statements = [
    prepare(
      db,
      `UPDATE icono_publication_alias_policy
          SET policy_json = ?1,
              revision = ?2,
              version = ?3,
              updated_at = ?4,
              updated_by = ?5,
              depends_on_blocklist_revision = ?6,
              last_projection_error = NULL
        WHERE policy_key = ?7
          AND revision = ?8
          AND (
            ?9 IS NULL
            OR EXISTS (
              SELECT 1
                FROM icono_extension_blocklist_policy
               WHERE policy_key = 'shared'
                 AND revision = ?9
            )
          )`,
      [
        nextPolicyJson,
        revision,
        manifest.version,
        changedAt,
        changedBy,
        expectedBlocklistRevision,
        ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY,
        expectedRevision,
        expectedBlocklistRevision,
      ],
    ),
    prepare(
      db,
      `INSERT OR IGNORE INTO icono_publication_alias_policy_history (
         policy_key, revision, version, policy_json, changed_at, changed_by,
         depends_on_blocklist_revision
       )
       SELECT policy_key, revision, version, policy_json, updated_at, updated_by,
              depends_on_blocklist_revision
         FROM icono_publication_alias_policy
        WHERE policy_key = ?1
          AND revision = ?2
          AND version = ?3`,
      [ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY, revision, manifest.version],
    ),
    prepare(
      db,
      `DELETE FROM icono_publication_alias_policy_history
        WHERE policy_key = ?1
          AND revision NOT IN (
            SELECT revision
              FROM icono_publication_alias_policy_history
             WHERE policy_key = ?1
             ORDER BY revision DESC
             LIMIT ?2
          )`,
      [ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY, ICONOPLASM_PUBLICATION_ALIAS_HISTORY_RETENTION],
    ),
  ]
  const results = await db.batch(statements)
  if (changedRows(results?.[0]) !== 1) {
    const latest = await readIconoplasmPublicationAliasPolicy(db)
    throw policyError(
      "publication_alias_dependency_revision_conflict",
      "Publication alias policy or shared blocklist changed since validation",
      409,
      { current: latest },
    )
  }
  return { changed: true, policy: await readIconoplasmPublicationAliasPolicy(db) }
}

async function readJsonFromKv(kv, key) {
  return safeJsonParse(await kv.get(key))
}

function scannerAliasOwners(genes) {
  const owners = new Map()
  for (const [rawSymbol, gene] of Object.entries(genes || {})) {
    const symbol = normalizePublicationAliasSymbol(rawSymbol)
    if (!symbol) continue
    for (const rawAlias of Array.isArray(gene?.a) ? gene.a : []) {
      const alias = normalizePublicationAlias(rawAlias)
      const key = publicationAliasCollisionKey(alias)
      if (!alias || !key) continue
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key).add(symbol)
    }
  }
  return owners
}

export async function validateIconoplasmPublicationAliasesAgainstPublishedScanner(
  kv,
  bySymbol,
  removeBySymbol = {},
  { baselinePolicy = null, requiredAliasTerms = [] } = {},
) {
  requireBinding(kv, "KV")
  const catalogManifest = await readJsonFromKv(kv, CATALOG_MANIFEST_KV_KEY)
  const scannerVersion = String(
    catalogManifest?.scanner_artifact?.build_version || catalogManifest?.current_hash || "",
  ).trim()
  if (!scannerVersion) {
    throw policyError(
      "published_scanner_unavailable",
      "Published scanner catalog is unavailable; publish the catalog before editing aliases",
      503,
    )
  }
  const scanner = await readJsonFromKv(kv, `${SCANNER_CATALOG_KV_PREFIX}${scannerVersion}`)
  const genes = scanner?.genes
  if (!genes || typeof genes !== "object" || Array.isArray(genes)) {
    throw policyError(
      "published_scanner_unavailable",
      "Published scanner catalog is unavailable; publish the catalog before editing aliases",
      503,
    )
  }
  const canonicalSymbols = new Set(
    Object.keys(genes).map(normalizePublicationAliasSymbol).filter(Boolean),
  )
  let policy
  try {
    policy = validateIconoplasmPublicationAliases(bySymbol, {
      canonicalSymbols,
      rawRemovals: removeBySymbol,
    })
  } catch (error) {
    throw policyError("invalid_publication_alias_policy", String(error?.message || error), 422)
  }

  const owners = scannerAliasOwners(genes)
  const invalidOperations = []
  for (const [symbol, aliases] of Object.entries(policy.remove_by_symbol)) {
    const baselineKeys = new Set(
      (baselinePolicy?.remove_by_symbol?.[symbol] || [])
        .map(publicationAliasCollisionKey)
        .filter(Boolean),
    )
    for (const alias of aliases) {
      const key = publicationAliasCollisionKey(alias)
      const currentOwners = owners.get(key)
      if (!currentOwners?.has(symbol)) {
        if (baselineKeys.has(key)) continue
        invalidOperations.push({
          operation: "remove",
          symbol,
          alias,
          reason: currentOwners?.size ? "owned_by_other_gene" : "not_generated_for_target",
          owners: currentOwners ? [...currentOwners].sort() : [],
        })
        continue
      }
      currentOwners.delete(symbol)
      if (currentOwners.size === 0) owners.delete(key)
    }
  }
  for (const [symbol, aliases] of Object.entries(policy.by_symbol)) {
    const baselineKeys = new Set(
      (baselinePolicy?.by_symbol?.[symbol] || []).map(publicationAliasCollisionKey).filter(Boolean),
    )
    for (const alias of aliases) {
      const key = publicationAliasCollisionKey(alias)
      const currentOwners = owners.get(key)
      const conflictingOwners = currentOwners
        ? [...currentOwners].filter((owner) => owner !== symbol).sort()
        : []
      if (conflictingOwners.length) {
        invalidOperations.push({
          operation: "add",
          symbol,
          alias,
          reason: "owned_by_other_gene",
          owners: conflictingOwners,
        })
        continue
      }
      if (currentOwners?.has(symbol) && !baselineKeys.has(key)) {
        invalidOperations.push({
          operation: "add",
          symbol,
          alias,
          reason: "already_generated_for_target",
          owners: [symbol],
        })
        continue
      }
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key).add(symbol)
    }
  }
  if (invalidOperations.length) {
    throw policyError(
      "publication_alias_operations_conflict_with_scanner",
      "Publication alias operations conflict with the published scanner catalog",
      422,
      { invalid_operations: invalidOperations },
    )
  }
  const manifest = await iconoplasmPublicationAliasManifestFromPolicy(policy)
  const invalidTerms = invalidIconoplasmPublishedAliasTerms(genes, manifest, requiredAliasTerms)
  if (invalidTerms.length) {
    throw policyError(
      "publication_alias_policy_invalidates_blocklist",
      "Publication alias policy would make a shared blocklist term unavailable or ambiguous",
      422,
      { invalid_terms: invalidTerms },
    )
  }
  projectionForPolicy(manifest)
  return manifest
}

function publicationAliasVersionToken(version) {
  const normalized = String(version || "").trim()
  return VERSION_RE.test(normalized) ? normalized.replace(/-/g, "") : null
}

function normalizedPublicationAliasVersionToken(rawToken) {
  const token = String(rawToken || "").trim()
  return VERSION_TOKEN_RE.test(token) ? token : null
}

export function iconoplasmPublicationAliasVersionKvKey(rawToken) {
  const token = normalizedPublicationAliasVersionToken(rawToken)
  if (!token) {
    throw policyError(
      "invalid_publication_alias_version_token",
      "Publication alias version token is invalid",
      400,
    )
  }
  return `${ICONOPLASM_PUBLICATION_ALIAS_VERSION_KV_PREFIX}${token}`
}

export function iconoplasmPublicationAliasKvKey(revision, version = null) {
  const normalized = positiveRevision(revision)
  if (!normalized) {
    throw policyError(
      "invalid_publication_alias_revision",
      "Publication alias revision must be a positive integer",
      500,
    )
  }
  const base = `${ICONOPLASM_PUBLICATION_ALIAS_KV_PREFIX}${String(normalized).padStart(
    KV_REVISION_WIDTH,
    "0",
  )}`
  if (version == null) return base
  const token = publicationAliasVersionToken(version)
  if (!token) {
    throw policyError(
      "invalid_publication_alias_version",
      "Publication alias version is invalid",
      500,
    )
  }
  return `${base}:version:${token}`
}

function projectionMetadataFromKey(key) {
  const value = String(key || "")
  if (!value.startsWith(ICONOPLASM_PUBLICATION_ALIAS_KV_PREFIX)) return null
  const suffix = value.slice(ICONOPLASM_PUBLICATION_ALIAS_KV_PREFIX.length)
  const match = suffix.match(
    new RegExp(`^(\\d{${KV_REVISION_WIDTH}})(?::version:(v1[a-f0-9]{16}))?$`),
  )
  if (!match) return null
  const revision = positiveRevision(Number(match[1]))
  return revision ? { revision, versionToken: match[2] || null } : null
}

async function listProjectionKeys(kv) {
  if (typeof kv?.list !== "function") {
    throw policyError("kv_list_unavailable", "KV binding does not support list()", 500)
  }
  const result = await kv.list({
    prefix: ICONOPLASM_PUBLICATION_ALIAS_KV_PREFIX,
    limit: KV_LIST_LIMIT,
  })
  if (result?.list_complete === false) {
    throw policyError(
      "publication_alias_projection_index_overflow",
      `Publication alias projection index exceeds ${KV_LIST_LIMIT} keys`,
      503,
    )
  }
  return (Array.isArray(result?.keys) ? result.keys : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .map((key) => {
      const normalizedKey = String(key || "")
      const metadata = projectionMetadataFromKey(normalizedKey)
      return metadata ? { key: normalizedKey, ...metadata } : null
    })
    .filter(Boolean)
    .sort((left, right) => left.revision - right.revision)
}

async function readHighestValidProjectionFromKv(kv) {
  const keys = await listProjectionKeys(kv)
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const entry = keys[index]
    const record = await projectionRecord(await readJsonFromKv(kv, entry.key), entry.revision)
    if (record) return record
  }
  return null
}

async function projectionRecord(rawValue, keyRevision) {
  const envelope =
    rawValue?.publication_aliases && typeof rawValue.publication_aliases === "object"
      ? rawValue
      : null
  const overlay = await normalizedManifest(envelope ? envelope.publication_aliases : rawValue)
  if (!overlay) return null
  const revision = envelope ? positiveRevision(envelope.revision) : keyRevision
  if (
    !revision ||
    revision !== keyRevision ||
    (envelope?.depends_on_blocklist_revision != null &&
      !positiveRevision(envelope.depends_on_blocklist_revision))
  ) {
    return null
  }
  return Object.freeze({
    revision,
    depends_on_blocklist_revision: envelope
      ? nullableRevision(envelope.depends_on_blocklist_revision)
      : null,
    overlay,
  })
}

export async function readAuthoritativePublishedIconoplasmPublicationAliases(kv) {
  requireBinding(kv, "KV")
  return readHighestValidProjectionFromKv(kv)
}

export async function readPublishedIconoplasmPublicationAliasesByVersionToken(kv, rawToken) {
  requireBinding(kv, "KV")
  const token = normalizedPublicationAliasVersionToken(rawToken)
  if (!token) return null
  const bootstrap = await bootstrapProjection()
  if (publicationAliasVersionToken(bootstrap.overlay.version) === token) return bootstrap
  const overlay = await normalizedManifest(
    await readJsonFromKv(kv, iconoplasmPublicationAliasVersionKvKey(token)),
  )
  if (!overlay || publicationAliasVersionToken(overlay.version) !== token) return null
  return Object.freeze({ revision: null, overlay })
}

async function ensureVersionProjection(kv, projection) {
  const token = publicationAliasVersionToken(projection?.version)
  if (!token) {
    throw policyError(
      "invalid_publication_alias_version",
      "Publication alias version is invalid",
      500,
    )
  }
  const key = iconoplasmPublicationAliasVersionKvKey(token)
  const existingRaw = await kv.get(key)
  if (existingRaw != null) {
    const existing = await normalizedManifest(safeJsonParse(existingRaw))
    if (!existing || existing.version !== projection.version || !samePolicy(existing, projection)) {
      throw policyError(
        "publication_alias_version_projection_collision",
        `Immutable publication alias version ${projection.version} already has different content`,
        503,
      )
    }
  } else {
    await kv.put(key, JSON.stringify(projection))
  }
  const visible = await normalizedManifest(await readJsonFromKv(kv, key))
  if (!visible || visible.version !== projection.version || !samePolicy(visible, projection)) {
    throw policyError(
      "publication_alias_projection_not_visible",
      `Publication alias version ${projection.version} is not yet visible`,
      503,
    )
  }
  return { key, token, overlay: visible }
}

async function bootstrapProjection() {
  if (!bootstrapProjectionPromise) {
    bootstrapProjectionPromise = iconoplasmPublicationAliasManifest().then((overlay) =>
      Object.freeze({ revision: 0, overlay }),
    )
  }
  return bootstrapProjectionPromise
}

function monotonicProjection(cached, candidate) {
  if (!cached) return candidate
  if (!candidate || candidate.revision < cached.revision) return cached
  if (
    candidate.revision === cached.revision &&
    (candidate.overlay.version !== cached.overlay.version ||
      !samePolicy(candidate.overlay, cached.overlay))
  ) {
    return cached
  }
  return candidate
}

export async function readPublishedIconoplasmPublicationAliases(
  kv,
  { fresh = false, nowMs = Date.now() } = {},
) {
  if (!kv) return (await bootstrapProjection()).overlay
  const cached = publicProjectionCache.get(kv)
  if (!fresh && cached && cached.expiresAt > nowMs) return cached.value.overlay
  let candidate
  try {
    candidate = (await readHighestValidProjectionFromKv(kv)) || (await bootstrapProjection())
  } catch (error) {
    if (fresh) throw error
    candidate = cached?.value || (await bootstrapProjection())
  }
  const value = monotonicProjection(cached?.value || null, candidate)
  publicProjectionCache.set(kv, { value, expiresAt: nowMs + PUBLIC_CACHE_TTL_MS })
  return value.overlay
}

function cachePublishedProjection(kv, candidate) {
  const cached = publicProjectionCache.get(kv)
  publicProjectionCache.set(kv, {
    value: monotonicProjection(cached?.value || null, candidate),
    expiresAt: Date.now() + PUBLIC_CACHE_TTL_MS,
  })
}

export function resetIconoplasmPublicationAliasPublicCacheForTests() {
  publicProjectionCache = new WeakMap()
}

function projectionMatchesPolicy(projection, policy) {
  return Boolean(
    projection &&
    policy &&
    projection.revision === policy.revision &&
    projection.depends_on_blocklist_revision ===
      nullableRevision(policy.depends_on_blocklist_revision) &&
    projection.overlay.version === policy.version &&
    samePolicy(projection.overlay, policy),
  )
}

function assertProjectionDoesNotConflictWithPolicy(projection, policy) {
  if (!projection) return
  if (projection.revision > policy.revision) {
    throw policyError(
      "publication_alias_public_projection_ahead",
      `Published alias revision ${projection.revision} is ahead of desired revision ${policy.revision}`,
      503,
    )
  }
  if (projection.revision === policy.revision && !projectionMatchesPolicy(projection, policy)) {
    throw policyError(
      "publication_alias_projection_revision_collision",
      `Published alias revision ${projection.revision} has different content`,
      503,
    )
  }
}

export function iconoplasmPublicationAliasPublicationState(policy, projection) {
  const inSync = Boolean(
    projectionMatchesPolicy(projection, policy) &&
    policy.published_revision === projection.revision &&
    policy.published_version === projection.overlay.version,
  )
  return {
    version: projection?.overlay?.version || policy?.published_version || null,
    revision: projection?.revision || policy?.published_revision || null,
    in_sync: inSync,
    published_at: policy?.published_at || null,
    last_error: policy?.last_projection_error || null,
  }
}

async function cleanupOldProjectionKeys(kv, protectedRevision = null) {
  const keys = await listProjectionKeys(kv)
  const excess = Math.max(0, keys.length - ICONOPLASM_PUBLICATION_ALIAS_KV_RETENTION)
  const doomed = keys
    .filter(({ revision }) => revision !== protectedRevision)
    .slice(0, Math.min(excess, KV_CLEANUP_BATCH_SIZE))
  if (doomed.length > 0 && typeof kv?.delete !== "function") {
    throw policyError("kv_delete_unavailable", "KV binding does not support delete()", 500)
  }
  const doomedKeys = new Set(doomed.map(({ key }) => key))
  const retainedTokens = new Set(
    keys
      .filter(({ key }) => !doomedKeys.has(key))
      .map(({ versionToken }) => versionToken)
      .filter(Boolean),
  )
  const doomedVersionKeys = [
    ...new Set(
      doomed
        .map(({ versionToken }) => versionToken)
        .filter((token) => token && !retainedTokens.has(token))
        .map((token) => iconoplasmPublicationAliasVersionKvKey(token)),
    ),
  ]
  await Promise.all([
    ...doomed.map(({ key }) => kv.delete(key)),
    ...doomedVersionKeys.map((key) => kv.delete(key)),
  ])
  return {
    deleted: doomed.length,
    version_keys_deleted: doomedVersionKeys.length,
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
    `UPDATE icono_publication_alias_policy
        SET projection_lease_token = ?1,
            projection_lease_expires_at = ?2
      WHERE policy_key = ?3
        AND (
          projection_lease_token IS NULL
          OR projection_lease_expires_at IS NULL
          OR projection_lease_expires_at <= ?4
        )`,
    [token, expiresAt, ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY, acquiredAt.toISOString()],
  ).run()
  return changedRows(result) === 1 ? { token, expiresAt } : null
}

async function releaseProjectionLease(db, token, errorMessage = null) {
  await prepare(
    db,
    `UPDATE icono_publication_alias_policy
        SET projection_lease_token = NULL,
            projection_lease_expires_at = NULL,
            last_projection_error = ?1
      WHERE policy_key = ?2
        AND projection_lease_token = ?3`,
    [
      errorMessage == null ? null : String(errorMessage || "projection_failed").slice(0, 500),
      ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY,
      token,
    ],
  ).run()
}

export async function publishIconoplasmPublicationAliasPolicy(
  db,
  kv,
  { now = new Date(), maxAttempts = 3, readPublishedBlocklist = null } = {},
) {
  requireBinding(db, "ICONOPLASM_DB")
  requireBinding(kv, "KV")
  const before = await readIconoplasmPublicationAliasPolicy(db)
  const publishedBefore = await readHighestValidProjectionFromKv(kv)
  assertProjectionDoesNotConflictWithPolicy(publishedBefore, before)
  if (iconoplasmPublicationAliasPublicationState(before, publishedBefore).in_sync) {
    await ensureVersionProjection(kv, publishedBefore.overlay)
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
    return {
      ok: false,
      changed: false,
      busy: true,
      policy: await readIconoplasmPublicationAliasPolicy(db),
      projection: await readHighestValidProjectionFromKv(kv),
    }
  }

  try {
    for (let attempt = 0; attempt < Math.max(1, Math.min(5, maxAttempts)); attempt += 1) {
      const policy = await readIconoplasmPublicationAliasPolicy(db)
      if (policy.projection_lease_token !== lease.token) {
        throw policyError(
          "publication_alias_projection_lease_lost",
          "Publication alias projection lease was lost",
          503,
        )
      }
      let publishedBlocklist = null
      if (policy.depends_on_blocklist_revision) {
        if (typeof readPublishedBlocklist !== "function") {
          throw policyError(
            "publication_alias_blocklist_dependency_reader_missing",
            "Publication alias projection requires a published blocklist dependency reader",
            500,
          )
        }
        publishedBlocklist = await readPublishedBlocklist()
        if (
          !publishedBlocklist ||
          Number(publishedBlocklist.revision) < policy.depends_on_blocklist_revision
        ) {
          throw policyError(
            "publication_alias_blocklist_dependency_not_published",
            `Shared blocklist revision ${policy.depends_on_blocklist_revision} must be visible before this alias revision`,
            503,
          )
        }
      } else if (typeof readPublishedBlocklist === "function") {
        publishedBlocklist = await readPublishedBlocklist()
      }
      await validateIconoplasmPublicationAliasesAgainstPublishedScanner(
        kv,
        policy.by_symbol,
        policy.remove_by_symbol,
        {
          baselinePolicy: policy,
          requiredAliasTerms: publishedBlocklist?.terms || [],
        },
      )
      const { projection, raw } = projectionForPolicy(policy)
      const publishedNow = await readHighestValidProjectionFromKv(kv)
      assertProjectionDoesNotConflictWithPolicy(publishedNow, policy)
      const key = iconoplasmPublicationAliasKvKey(policy.revision, policy.version)
      const existingRaw = await kv.get(key)
      if (existingRaw != null) {
        const existing = await projectionRecord(safeJsonParse(existingRaw), policy.revision)
        if (!projectionMatchesPolicy(existing, policy)) {
          throw policyError(
            "publication_alias_projection_revision_collision",
            `Immutable publication alias revision ${policy.revision} already has different content`,
            503,
          )
        }
      } else {
        await kv.put(key, raw)
      }
      // The revision key carries the version token in its name, so a failed
      // token-index write remains discoverable and bounded by normal history
      // cleanup. The atomic recognition pair is not published until both exist.
      await ensureVersionProjection(kv, projection)
      const publishedAfter = await readHighestValidProjectionFromKv(kv)
      assertProjectionDoesNotConflictWithPolicy(publishedAfter, policy)
      if (!projectionMatchesPolicy(publishedAfter, policy)) {
        throw policyError(
          "publication_alias_projection_not_visible",
          `Publication alias revision ${policy.revision} is not yet visible in the public projection index`,
          503,
        )
      }
      const publishedAt = new Date().toISOString()
      const acknowledged = await prepare(
        db,
        `UPDATE icono_publication_alias_policy
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
          projection.version,
          publishedAt,
          ICONOPLASM_PUBLICATION_ALIAS_POLICY_KEY,
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
          policy: await readIconoplasmPublicationAliasPolicy(db),
          projection: publishedAfter,
          cleanup: await cleanupOldProjectionKeysBestEffort(kv, policy.revision),
        }
      }
    }
    throw policyError(
      "publication_alias_projection_contended",
      "Publication alias policy changed repeatedly during publication",
      503,
    )
  } catch (error) {
    await releaseProjectionLease(db, lease.token, error?.message || error)
    if (error instanceof IconoplasmPublicationAliasPolicyError) throw error
    throw policyError(
      "publication_alias_projection_failed",
      `Publication alias policy was saved but publication failed: ${String(error?.message || error)}`,
      503,
    )
  }
}

export async function reconcileIconoplasmPublicationAliasPolicy(
  env,
  { now = new Date(), readPublishedBlocklist = null } = {},
) {
  if (!env?.ICONOPLASM_DB || !env?.KV) {
    return { ok: false, skipped: true, reason: "binding_missing" }
  }
  const policy = await readIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB)
  const projection = await readHighestValidProjectionFromKv(env.KV)
  const publication = iconoplasmPublicationAliasPublicationState(policy, projection)
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
  return publishIconoplasmPublicationAliasPolicy(env.ICONOPLASM_DB, env.KV, {
    now,
    readPublishedBlocklist,
  })
}

export const ICONOPLASM_PUBLICATION_ALIAS_LIMITS = Object.freeze({
  max_operations: MAX_PUBLICATION_ALIAS_COUNT,
  max_alias_length: MAX_PUBLICATION_ALIAS_LENGTH,
  max_projection_bytes: ICONOPLASM_PUBLICATION_ALIAS_MAX_PROJECTION_BYTES,
  max_request_bytes: ICONOPLASM_PUBLICATION_ALIAS_MAX_REQUEST_BYTES,
})
