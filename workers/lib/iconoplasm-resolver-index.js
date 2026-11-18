// Compact identifier resolver index built once in CI (next to catalog/v3/aliases.json
// and in KV) so Worker isolates and browsers never hydrate or scan the full 19k-gene catalogue.
//
// Format note: entries are stored in a single backslash-free JSON string
// (`<key>|<kind>|<value>^...`), sorted by UTF-16 code units on `(key, kind)`.
// Avoiding per-entry JSON object properties and JSON string escapes keeps V8 cold-start
// `JSON.parse` under ~0.5 ms and binary search under ~0.2 ms for 50 identifiers.

export const COMPACT_RESOLVER_INDEX_SCHEMA_VERSION = 1
export const COMPACT_RESOLVER_OBJECT_KEY = "catalog/v3/resolve.json"
export const COMPACT_RESOLVER_OBJECT_LIMIT = 8 * 1024 * 1024
export const COMPACT_RESOLVER_KV_PREFIX = "iconoplasm:resolver-index:"

const FIELD_SEP = "|"
const RECORD_SEP = "^"
const UNICODE_DASH_RE = /[\u2010-\u2015\u2212]/g
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/g
const AMBIGUOUS_OWNER = "*"

function safeDecodeComponent(raw) {
  const text = String(raw ?? "")
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

export function normalizeResolverSymbol(raw) {
  if (!raw) return null
  const value = safeDecodeComponent(raw).trim().toUpperCase()
  return /^[A-Z0-9][A-Z0-9-]{0,63}$/.test(value) ? value : null
}

export function normalizeResolverUniprot(raw) {
  if (!raw) return null
  const value = safeDecodeComponent(raw).trim().toUpperCase()
  return /^[A-Z0-9]{6,10}$/.test(value) ? value : null
}

export function normalizeResolverAliasKey(raw) {
  const cleaned = String(raw ?? "")
    .replace(CONTROL_CHAR_RE, "")
    .replace(UNICODE_DASH_RE, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
  return cleaned
}

export function foldResolverKey(raw) {
  return normalizeResolverAliasKey(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9\u0370-\u03ff]+/gu, "")
}

function encodeField(value) {
  const text = String(value ?? "")
  if (!text.includes("%") && !text.includes(FIELD_SEP) && !text.includes(RECORD_SEP)) {
    return text
  }
  return text.replace(/%/g, "%25").replaceAll(FIELD_SEP, "%7C").replaceAll(RECORD_SEP, "%5E")
}

function decodeField(value) {
  const text = String(value ?? "")
  return text.includes("%")
    ? text.replaceAll("%5E", RECORD_SEP).replaceAll("%7C", FIELD_SEP).replaceAll("%25", "%")
    : text
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeGeneAliases(rawAliases) {
  const out = []
  const seen = new Set()
  const list = Array.isArray(rawAliases) ? rawAliases : []
  for (const item of list) {
    const alias = normalizeResolverAliasKey(item)
    if (!alias || alias.includes(" ")) continue
    const upper = alias.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    out.push(alias)
    if (out.length >= 48) break
  }
  return out
}

/**
 * Builds the compact resolver index artifact from catalog rows `{ s, u, a }`.
 */
export function buildCompactResolverIndex(genes, { generatedAt = null } = {}) {
  const rows = Array.isArray(genes) ? genes : []
  const records = []
  const seenSymbols = new Set()
  const uniprotOwners = new Map()
  const aliasOwners = new Map()

  for (const gene of rows) {
    const symbol = normalizeResolverSymbol(gene?.s || gene?.symbol || gene?.gene_symbol || "")
    if (!symbol || seenSymbols.has(symbol)) continue
    seenSymbols.add(symbol)
    records.push({ sortKey: symbol, kind: "S", value: "1" })

    const uniprot = normalizeResolverUniprot(gene?.u || gene?.uniprot || "")
    if (uniprot && !uniprotOwners.has(uniprot)) {
      uniprotOwners.set(uniprot, symbol)
    }

    const aliases = normalizeGeneAliases(gene?.a ?? gene?.aliases ?? [])
    for (const alias of aliases) {
      const existing = aliasOwners.get(alias)
      if (existing === undefined) aliasOwners.set(alias, symbol)
      else if (existing !== symbol) aliasOwners.set(alias, AMBIGUOUS_OWNER)
    }
  }

  for (const [uniprot, symbol] of uniprotOwners) {
    records.push({ sortKey: uniprot, kind: "U", value: symbol })
  }
  for (const [alias, owner] of aliasOwners) {
    records.push({ sortKey: alias, kind: "E", value: owner })
  }

  const encodedRecords = records.map((record) => {
    const encodedKey = encodeField(record.sortKey)
    return {
      key: encodedKey,
      kind: record.kind,
      line: `${encodedKey}${FIELD_SEP}${record.kind}${FIELD_SEP}${encodeField(record.value)}`,
    }
  })
  encodedRecords.sort(
    (left, right) =>
      compareCodeUnits(left.key, right.key) || compareCodeUnits(left.kind, right.kind),
  )

  return {
    schema: COMPACT_RESOLVER_INDEX_SCHEMA_VERSION,
    generated_at: String(generatedAt || new Date().toISOString()),
    gene_count: seenSymbols.size,
    entry_count: encodedRecords.length,
    entries: encodedRecords.length
      ? `${encodedRecords.map((item) => item.line).join(RECORD_SEP)}${RECORD_SEP}`
      : "",
  }
}

export function isValidCompactResolverIndex(value) {
  if (!value || typeof value !== "object") return false
  if (Number(value.schema) !== COMPACT_RESOLVER_INDEX_SCHEMA_VERSION) return false
  if (typeof value.entries !== "string") return false
  if (value.entries.length > 0 && !value.entries.endsWith(RECORD_SEP)) return false
  return Number.isInteger(Number(value.gene_count)) && Number(value.gene_count) >= 0
}

/**
 * Binary-searches a sorted compact resolver `entries` string by exact `(key, kind)`.
 */
export function lookupCompactEntry(entries, rawKey, kind) {
  if (typeof entries !== "string" || !entries.length) return null
  const targetKey = encodeField(rawKey)
  let lo = 0
  let hi = entries.length

  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const recStart = mid === 0 ? 0 : entries.lastIndexOf(RECORD_SEP, mid - 1) + 1
    const recEnd = entries.indexOf(RECORD_SEP, recStart)
    if (recEnd === -1) break
    const sep1 = entries.indexOf(FIELD_SEP, recStart)
    const sep2 = sep1 === -1 ? -1 : entries.indexOf(FIELD_SEP, sep1 + 1)
    if (sep1 === -1 || sep2 === -1 || sep2 > recEnd) break

    const recKey = entries.slice(recStart, sep1)
    const recKind = entries.slice(sep1 + 1, sep2)
    const cmp = compareCodeUnits(recKey, targetKey) || compareCodeUnits(recKind, kind)
    if (cmp === 0) {
      return decodeField(entries.slice(sep2 + 1, recEnd))
    }
    if (cmp < 0) lo = recEnd + 1
    else hi = recStart
  }
  return null
}

/**
 * Builds an O(|curated|) overlay for live publication-alias additions and owner retractions
 * on top of a compact base resolver index, avoiding a whole-catalogue pass.
 */
export function buildCompactResolverOverlay(index, publicationAliases) {
  const added = new Map()
  const removed = new Map()
  const entries = index?.entries || ""
  if (!publicationAliases || typeof publicationAliases !== "object" || !entries) {
    return { added, removed }
  }

  const knownCanonical = new Map()
  const isCanonicalKnown = (symbol) => {
    if (!knownCanonical.has(symbol)) {
      knownCanonical.set(symbol, lookupCompactEntry(entries, symbol, "S") === "1")
    }
    return knownCanonical.get(symbol)
  }

  for (const [rawSymbol, rawRemovals] of Object.entries(
    publicationAliases.remove_by_symbol || {},
  )) {
    const symbol = normalizeResolverSymbol(rawSymbol)
    if (!symbol || !isCanonicalKnown(symbol)) continue
    for (const rawAlias of Array.isArray(rawRemovals) ? rawRemovals : []) {
      const aliasKey = normalizeResolverAliasKey(rawAlias)
      if (!aliasKey) continue
      if (!removed.has(aliasKey)) removed.set(aliasKey, new Set())
      removed.get(aliasKey).add(symbol)
    }
  }

  for (const [rawSymbol, rawAdditions] of Object.entries(publicationAliases.by_symbol || {})) {
    const symbol = normalizeResolverSymbol(rawSymbol)
    if (!symbol || !isCanonicalKnown(symbol)) continue
    for (const rawAlias of Array.isArray(rawAdditions) ? rawAdditions : []) {
      const aliasKey = normalizeResolverAliasKey(rawAlias)
      if (!aliasKey) continue

      const priorCurated = added.get(aliasKey)
      if (priorCurated !== undefined && priorCurated !== symbol) {
        added.set(aliasKey, null)
        continue
      }
      const baseOwner = lookupCompactEntry(entries, aliasKey, "E")
      const baseRetracted = baseOwner && removed.get(aliasKey)?.has(baseOwner)
      if (baseOwner && baseOwner !== AMBIGUOUS_OWNER && baseOwner !== symbol && !baseRetracted) {
        added.set(aliasKey, null)
        continue
      }
      added.set(aliasKey, symbol)
    }
  }

  return { added, removed }
}

/**
 * Resolves an arbitrary gene identifier (`symbol`, `uniprot`, or `alias`) against the compact
 * resolver index and optional curated alias overlay.
 */
export function resolveIdentifierFromCompactIndex(index, rawIdentifier, overlay = null) {
  const requested = String(rawIdentifier || "")
  const entries = index?.entries || ""
  if (!entries) {
    return { requested, found: false, canonical_symbol: null, matched_by: null }
  }
  const symbol = normalizeResolverSymbol(requested)
  if (symbol && lookupCompactEntry(entries, symbol, "S") === "1") {
    return { requested, found: true, canonical_symbol: symbol, matched_by: "symbol" }
  }

  const uniprot = normalizeResolverUniprot(requested)
  if (uniprot) {
    const uOwner = lookupCompactEntry(entries, uniprot, "U")
    if (uOwner) {
      return { requested, found: true, canonical_symbol: uOwner, matched_by: "uniprot" }
    }
  }

  const aliasKey = normalizeResolverAliasKey(requested)
  if (aliasKey) {
    if (overlay?.added?.has(aliasKey)) {
      const curatedOwner = overlay.added.get(aliasKey)
      if (curatedOwner) {
        return { requested, found: true, canonical_symbol: curatedOwner, matched_by: "alias" }
      }
      return { requested, found: false, canonical_symbol: null, matched_by: null }
    }
    const baseOwner = lookupCompactEntry(entries, aliasKey, "E")
    if (
      baseOwner &&
      baseOwner !== AMBIGUOUS_OWNER &&
      !overlay?.removed?.get(aliasKey)?.has(baseOwner)
    ) {
      return { requested, found: true, canonical_symbol: baseOwner, matched_by: "alias" }
    }
  }

  return { requested, found: false, canonical_symbol: null, matched_by: null }
}
