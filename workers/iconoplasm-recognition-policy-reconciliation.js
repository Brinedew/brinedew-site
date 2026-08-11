// ARCHITECTURE FENCE [IPD-008]: cross-policy publication is ordered by the
// exact desired-state dependency revisions persisted by each administrator
// save, then exposed through one atomic immutable KV pair projection.
import {
  parseIconoplasmPublishedExtensionBlocklistProjection,
  readAuthoritativePublishedIconoplasmExtensionBlocklist,
  readRetainedPublishedIconoplasmExtensionBlocklists,
  reconcileIconoplasmExtensionBlocklistPolicy,
  validateIconoplasmExtensionBlocklistAgainstPublishedScanner,
} from "./iconoplasm-extension-blocklist-policy.js"
import {
  iconoplasmPublicationAliasManifest,
  iconoplasmPublicationAliasManifestFromPolicy,
} from "./iconoplasm-publication-aliases.js"
import {
  readAuthoritativePublishedIconoplasmPublicationAliases,
  reconcileIconoplasmPublicationAliasPolicy,
} from "./iconoplasm-publication-alias-policy.js"

export const ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX = "iconoplasm:recognition-policy-pair:v1:"
export const ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION = 100
export const ICONOPLASM_RECOGNITION_PAIR_MAX_BYTES = 64 * 1024

const PAIR_SCHEMA_VERSION = 1
const REVISION_WIDTH = 20
const KV_LIST_LIMIT = 1_000
const KV_CLEANUP_BATCH_SIZE = 10
const COHERENT_PUBLIC_CACHE_TTL_MS = 5_000
const ALIAS_PUBLIC_FIELDS = Object.freeze([
  "alias_count",
  "by_symbol",
  "removal_count",
  "remove_by_symbol",
  "schema_version",
  "version",
])
const BLOCKLIST_PUBLIC_FIELDS = Object.freeze([
  "revision",
  "schema_version",
  "term_count",
  "terms",
  "version",
])

let coherentPublicCache = new WeakMap()

export class IconoplasmRecognitionPolicyError extends Error {
  constructor(code, message, status = 500) {
    super(message)
    this.name = "IconoplasmRecognitionPolicyError"
    this.code = code
    this.status = status
  }
}

function policyError(code, message, status = 500) {
  return new IconoplasmRecognitionPolicyError(code, message, status)
}

function positiveRevision(value) {
  const revision = Number(value)
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null
}

function strictPositiveRevision(value) {
  return typeof value === "number" ? positiveRevision(value) : null
}

function nullableRevision(value) {
  return value == null ? null : positiveRevision(value)
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || ""))
  } catch {
    return null
  }
}

function publicBlocklist(projection) {
  if (!projection?.revision) return null
  const terms = Object.freeze([...(Array.isArray(projection.terms) ? projection.terms : [])])
  return Object.freeze({
    schema_version: projection.schema_version,
    revision: projection.revision,
    version: projection.version,
    term_count: projection.term_count,
    terms,
  })
}

function compatiblePair(aliasRecord, blocklistRecord) {
  return Boolean(
    aliasRecord?.revision &&
    blocklistRecord?.revision &&
    Number(aliasRecord.depends_on_blocklist_revision || 0) <= blocklistRecord.revision &&
    Number(blocklistRecord.depends_on_alias_revision || 0) <= aliasRecord.revision,
  )
}

export function iconoplasmRecognitionPairKvKey(aliasRevision, blocklistRevision) {
  const aliases = positiveRevision(aliasRevision)
  const blocklist = positiveRevision(blocklistRevision)
  if (!aliases || !blocklist) {
    throw policyError(
      "invalid_recognition_pair_revision",
      "Recognition pair revisions must be positive integers",
    )
  }
  return `${ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX}a${String(aliases).padStart(
    REVISION_WIDTH,
    "0",
  )}:b${String(blocklist).padStart(REVISION_WIDTH, "0")}`
}

function revisionsFromPairKey(key) {
  const suffix = String(key || "").slice(ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX.length)
  const match = suffix.match(new RegExp(`^a(\\d{${REVISION_WIDTH}}):b(\\d{${REVISION_WIDTH}})$`))
  if (!match) return null
  const aliasRevision = positiveRevision(Number(match[1]))
  const blocklistRevision = positiveRevision(Number(match[2]))
  return aliasRevision && blocklistRevision ? { aliasRevision, blocklistRevision } : null
}

async function listPairKeys(kv) {
  if (typeof kv?.list !== "function") {
    throw policyError("kv_list_unavailable", "KV binding does not support list()")
  }
  const result = await kv.list({
    prefix: ICONOPLASM_RECOGNITION_PAIR_KV_PREFIX,
    limit: KV_LIST_LIMIT,
  })
  if (result?.list_complete === false) {
    throw policyError(
      "recognition_pair_index_overflow",
      `Recognition pair index exceeds ${KV_LIST_LIMIT} keys`,
      503,
    )
  }
  const rawKeys = Array.isArray(result?.keys) ? result.keys : []
  const entries = rawKeys
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .map((key) => ({ key: String(key || ""), revisions: revisionsFromPairKey(key) }))
    .filter((entry) => entry.revisions)
    .sort(
      (left, right) =>
        right.revisions.aliasRevision - left.revisions.aliasRevision ||
        right.revisions.blocklistRevision - left.revisions.blocklistRevision,
    )
  return { entries, sawAny: rawKeys.length > 0 }
}

async function normalizedAliasOverlay(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const normalized = await iconoplasmPublicationAliasManifestFromPolicy(raw).catch(() => null)
  if (!normalized) return null
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(ALIAS_PUBLIC_FIELDS)) return null
  return JSON.stringify(raw) === JSON.stringify(normalized) ? normalized : null
}

async function normalizedBlocklist(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  if (JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(BLOCKLIST_PUBLIC_FIELDS))
    return null
  const parsed = await parseIconoplasmPublishedExtensionBlocklistProjection(raw)
  return parsed ? publicBlocklist(parsed) : null
}

async function parsePair(raw, revisions) {
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  if (typeof value.schema_version !== "number" || value.schema_version !== PAIR_SCHEMA_VERSION) {
    return null
  }
  const aliasRevision = strictPositiveRevision(value.alias_revision)
  const blocklistRevision = strictPositiveRevision(value.blocklist_revision)
  const aliasDependency =
    value.alias_depends_on_blocklist_revision == null
      ? null
      : strictPositiveRevision(value.alias_depends_on_blocklist_revision)
  const blocklistDependency =
    value.blocklist_depends_on_alias_revision == null
      ? null
      : strictPositiveRevision(value.blocklist_depends_on_alias_revision)
  if (
    !aliasRevision ||
    !blocklistRevision ||
    (value.alias_depends_on_blocklist_revision != null && !aliasDependency) ||
    (value.blocklist_depends_on_alias_revision != null && !blocklistDependency) ||
    aliasRevision !== revisions.aliasRevision ||
    blocklistRevision !== revisions.blocklistRevision ||
    (aliasDependency && aliasDependency > blocklistRevision) ||
    (blocklistDependency && blocklistDependency > aliasRevision)
  ) {
    return null
  }
  const [publicationAliases, extensionBlocklist] = await Promise.all([
    normalizedAliasOverlay(value.publication_aliases),
    normalizedBlocklist(value.extension_blocklist),
  ])
  if (!publicationAliases || !extensionBlocklist) return null
  return Object.freeze({
    publication_aliases: publicationAliases,
    extension_blocklist: extensionBlocklist,
    alias_revision: aliasRevision,
    blocklist_revision: blocklistRevision,
    alias_depends_on_blocklist_revision: aliasDependency,
    blocklist_depends_on_alias_revision: blocklistDependency,
  })
}

async function readNewestValidPair(kv) {
  const { entries: keys, sawAny } = await listPairKeys(kv)
  if (!sawAny) return null
  for (const entry of keys.slice(0, ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION)) {
    const pair = await parsePair(await kv.get(entry.key), entry.revisions)
    if (pair) return pair
  }
  throw policyError(
    "recognition_pair_unavailable",
    "Recognition pair keys exist but none contain a valid visible projection",
    503,
  )
}

export async function readAuthoritativePublishedIconoplasmRecognitionPolicies(kv) {
  if (!kv) throw policyError("kv_binding_missing", "KV binding missing")
  return readNewestValidPair(kv)
}

async function bootstrapPair(kv = null) {
  let extensionBlocklist = null
  if (kv) {
    const newest = await readAuthoritativePublishedIconoplasmExtensionBlocklist(kv)
    const legacy = !newest?.depends_on_alias_revision
      ? newest
      : (await readRetainedPublishedIconoplasmExtensionBlocklists(kv)).find(
          (projection) => !projection.depends_on_alias_revision,
        ) || null
    if (legacy) extensionBlocklist = publicBlocklist(legacy)
  }
  return Object.freeze({
    publication_aliases: await iconoplasmPublicationAliasManifest(),
    extension_blocklist: extensionBlocklist,
    alias_revision: 0,
    blocklist_revision: extensionBlocklist?.revision || 0,
  })
}

function monotonicPair(cached, candidate) {
  if (!cached) return candidate
  if (
    candidate.alias_revision < cached.alias_revision ||
    candidate.blocklist_revision < cached.blocklist_revision
  ) {
    return cached
  }
  return candidate
}

export async function readCoherentPublishedIconoplasmRecognitionPolicies(
  kv,
  { fresh = false, nowMs = Date.now() } = {},
) {
  if (!kv) return bootstrapPair()
  const cached = coherentPublicCache.get(kv)
  if (!fresh && cached && cached.expiresAt > nowMs) return cached.value
  let candidate
  try {
    candidate = (await readNewestValidPair(kv)) || (await bootstrapPair(kv))
  } catch (error) {
    if (fresh) throw error
    if (!cached?.value) throw error
    candidate = cached.value
  }
  const value = monotonicPair(cached?.value || null, candidate)
  coherentPublicCache.set(kv, { value, expiresAt: nowMs + COHERENT_PUBLIC_CACHE_TTL_MS })
  return value
}

function pairRaw(aliasRecord, blocklistRecord) {
  const value = {
    schema_version: PAIR_SCHEMA_VERSION,
    alias_revision: aliasRecord.revision,
    blocklist_revision: blocklistRecord.revision,
    alias_depends_on_blocklist_revision: nullableRevision(
      aliasRecord.depends_on_blocklist_revision,
    ),
    blocklist_depends_on_alias_revision: nullableRevision(
      blocklistRecord.depends_on_alias_revision,
    ),
    publication_aliases: aliasRecord.overlay,
    extension_blocklist: publicBlocklist(blocklistRecord),
  }
  const raw = JSON.stringify(value)
  if (byteLength(raw) > ICONOPLASM_RECOGNITION_PAIR_MAX_BYTES) {
    throw policyError(
      "recognition_pair_too_large",
      `Recognition pair exceeds ${ICONOPLASM_RECOGNITION_PAIR_MAX_BYTES} bytes`,
      422,
    )
  }
  return raw
}

async function cleanupPairKeys(kv, protectedKey) {
  const { entries: keys } = await listPairKeys(kv)
  const doomed = keys
    .filter((entry) => entry.key !== protectedKey)
    .slice(ICONOPLASM_RECOGNITION_PAIR_KV_RETENTION - 1)
    .slice(0, KV_CLEANUP_BATCH_SIZE)
  await Promise.all(doomed.map((entry) => kv.delete(entry.key)))
  return { deleted: doomed.length }
}

async function cleanupPairKeysBestEffort(kv, protectedKey) {
  try {
    return { ok: true, ...(await cleanupPairKeys(kv, protectedKey)) }
  } catch (error) {
    return { ok: false, deleted: 0, error: String(error?.message || error) }
  }
}

export async function publishIconoplasmRecognitionPolicyPair(kv) {
  if (!kv) throw policyError("kv_binding_missing", "KV binding missing")
  const [aliases, blocklist] = await Promise.all([
    readAuthoritativePublishedIconoplasmPublicationAliases(kv),
    readAuthoritativePublishedIconoplasmExtensionBlocklist(kv),
  ])
  if (!aliases || !blocklist || !compatiblePair(aliases, blocklist)) {
    throw policyError(
      "recognition_pair_dependencies_not_published",
      "A dependency-compatible alias and blocklist projection must be visible before pairing",
      503,
    )
  }
  await validateIconoplasmExtensionBlocklistAgainstPublishedScanner(kv, blocklist.terms, {
    publicationAliases: aliases.overlay,
  })
  const key = iconoplasmRecognitionPairKvKey(aliases.revision, blocklist.revision)
  const raw = pairRaw(aliases, blocklist)
  const existing = await kv.get(key)
  if (existing != null && existing !== raw) {
    throw policyError(
      "recognition_pair_revision_collision",
      "Immutable recognition pair key already contains different content",
      503,
    )
  }
  if (existing == null) await kv.put(key, raw)
  const visible = await parsePair(await kv.get(key), {
    aliasRevision: aliases.revision,
    blocklistRevision: blocklist.revision,
  })
  if (!visible) {
    throw policyError(
      "recognition_pair_not_visible",
      "New recognition pair is not yet visible",
      503,
    )
  }
  const cached = coherentPublicCache.get(kv)
  const cachedValue = monotonicPair(cached?.value || null, visible)
  coherentPublicCache.set(kv, {
    value: cachedValue,
    expiresAt: Date.now() + COHERENT_PUBLIC_CACHE_TTL_MS,
  })
  return {
    ok: true,
    changed: existing == null,
    pair: visible,
    cleanup: await cleanupPairKeysBestEffort(kv, key),
  }
}

export function resetIconoplasmRecognitionPolicyPublicCacheForTests() {
  coherentPublicCache = new WeakMap()
}

async function settled(work) {
  try {
    return { status: "fulfilled", value: await work() }
  } catch (reason) {
    return { status: "rejected", reason }
  }
}

export async function reconcileIconoplasmRecognitionPolicies(env, { now = new Date() } = {}) {
  if (!env?.ICONOPLASM_DB || !env?.KV) {
    const value = { ok: false, skipped: true, reason: "binding_missing" }
    return {
      extension_blocklist: { status: "fulfilled", value },
      publication_aliases: { status: "fulfilled", value },
      pair: { status: "fulfilled", value },
    }
  }

  // A blocklist removal may be the dependency that makes an alias removal safe.
  // Run it first, then aliases, then retry the blocklist so the opposite
  // dependency (a newly published alias) also converges in this same cron tick.
  const blocklistFirst = await settled(() =>
    reconcileIconoplasmExtensionBlocklistPolicy(env, { now }),
  )
  const publicationAliases = await settled(() =>
    reconcileIconoplasmPublicationAliasPolicy(env, {
      now,
      readPublishedBlocklist: () => readAuthoritativePublishedIconoplasmExtensionBlocklist(env.KV),
    }),
  )
  const blocklistSecond = await settled(() =>
    reconcileIconoplasmExtensionBlocklistPolicy(env, { now }),
  )
  const pair = await settled(() => publishIconoplasmRecognitionPolicyPair(env.KV))
  const extensionBlocklist =
    blocklistSecond.status === "fulfilled"
      ? {
          status: "fulfilled",
          value: {
            ...blocklistSecond.value,
            changed:
              Boolean(blocklistFirst.status === "fulfilled" && blocklistFirst.value.changed) ||
              Boolean(blocklistSecond.value.changed),
          },
        }
      : blocklistFirst

  return {
    extension_blocklist: extensionBlocklist,
    publication_aliases: publicationAliases,
    pair,
    passes: Object.freeze({ blocklist_first: blocklistFirst, blocklist_second: blocklistSecond }),
  }
}
