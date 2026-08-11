import {
  normalizePublicationAliasSymbol,
  publicationAliasCollisionKey,
  publishedAliasTermKey,
} from "./iconoplasm-publication-aliases.js"

// ARCHITECTURE FENCE [IPD-008]: admin recognition validation reads only the
// immutable lookup shards touched by a semantic change. It must never rebuild
// the 1.9 MiB scanner artifact inside a foreground Worker request.
export const ICONOPLASM_RECOGNITION_INDEX_SCHEMA_VERSION = 1
export const ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT = 64
export const ICONOPLASM_RECOGNITION_INDEX_MAX_SHARD_BYTES = 128 * 1024
export const ICONOPLASM_RECOGNITION_INDEX_MANIFEST_PREFIX =
  "iconoplasm:recognition-validation-index:v1:manifest:"
export const ICONOPLASM_RECOGNITION_INDEX_SHARD_PREFIX =
  "iconoplasm:recognition-validation-index:v1:shard:"

const textEncoder = new TextEncoder()

function normalizedScannerVersion(value) {
  const version = String(value || "").trim()
  if (!version || version.length > 200)
    throw new TypeError("Recognition index scanner version is invalid")
  return version
}

function safeJsonParse(raw) {
  if (typeof raw !== "string" || !raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function fnv1a32(value) {
  let hash = 0x811c9dc5
  const bytes = textEncoder.encode(value)
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function iconoplasmRecognitionIndexManifestKey(scannerVersion) {
  return `${ICONOPLASM_RECOGNITION_INDEX_MANIFEST_PREFIX}${normalizedScannerVersion(scannerVersion)}`
}

export function iconoplasmRecognitionIndexShardKey(scannerVersion, shardIndex) {
  const version = normalizedScannerVersion(scannerVersion)
  const index = Number(shardIndex)
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT
  ) {
    throw new TypeError("Recognition index shard is invalid")
  }
  return `${ICONOPLASM_RECOGNITION_INDEX_SHARD_PREFIX}${version}:${String(index).padStart(2, "0")}`
}

export function iconoplasmRecognitionIndexCanonicalKey(symbol) {
  const normalized = normalizePublicationAliasSymbol(symbol)
  return normalized ? `s:${normalized}` : ""
}

export function iconoplasmRecognitionIndexCollisionKey(alias) {
  const normalized = publicationAliasCollisionKey(alias)
  return normalized ? `c:${normalized}` : ""
}

export function iconoplasmRecognitionIndexPublishedKey(alias) {
  const normalized = publishedAliasTermKey(alias)
  return normalized ? `p:${normalized}` : ""
}

export function iconoplasmRecognitionIndexShardForKey(key) {
  const normalized = String(key || "")
  if (!normalized) throw new TypeError("Recognition index lookup key is required")
  return fnv1a32(normalized) % ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT
}

function addOwner(map, key, owner) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(owner)
}

function addPublishedKeyByOwner(map, collisionKey, owner, publishedKey) {
  if (!map.has(collisionKey)) map.set(collisionKey, new Map())
  const byOwner = map.get(collisionKey)
  if (!byOwner.has(owner)) byOwner.set(owner, new Set())
  byOwner.get(owner).add(publishedKey)
}

function sortedObjectFromMap(map, project) {
  const result = {}
  for (const key of [...map.keys()].sort()) result[key] = project(map.get(key))
  return result
}

export function buildIconoplasmRecognitionValidationIndex(genes, { scannerVersion } = {}) {
  const version = normalizedScannerVersion(scannerVersion)
  if (!genes || typeof genes !== "object" || Array.isArray(genes)) {
    throw new TypeError("Recognition index requires a scanner genes object")
  }
  const canonicalSymbols = new Set()
  const collisionOwners = new Map()
  const publishedOwners = new Map()
  const publishedKeysByCollisionOwner = new Map()

  for (const [rawSymbol, gene] of Object.entries(genes)) {
    const symbol = normalizePublicationAliasSymbol(rawSymbol)
    if (!symbol || symbol !== rawSymbol) {
      throw new TypeError(`Recognition index found invalid canonical symbol ${rawSymbol}`)
    }
    canonicalSymbols.add(symbol)
    for (const rawAlias of Array.isArray(gene?.a) ? gene.a : []) {
      const collisionKey = publicationAliasCollisionKey(rawAlias)
      const publishedKey = publishedAliasTermKey(rawAlias)
      if (!collisionKey || !publishedKey) continue
      addOwner(collisionOwners, collisionKey, symbol)
      addOwner(publishedOwners, publishedKey, symbol)
      addPublishedKeyByOwner(publishedKeysByCollisionOwner, collisionKey, symbol, publishedKey)
    }
  }

  const shardEntries = Array.from({ length: ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT }, () => ({}))
  const addEntry = (key, value) => {
    shardEntries[iconoplasmRecognitionIndexShardForKey(key)][key] = value
  }
  for (const symbol of [...canonicalSymbols].sort()) {
    addEntry(iconoplasmRecognitionIndexCanonicalKey(symbol), 1)
  }
  for (const collisionKey of [...collisionOwners.keys()].sort()) {
    const byOwner = publishedKeysByCollisionOwner.get(collisionKey) || new Map()
    addEntry(`c:${collisionKey}`, {
      o: [...collisionOwners.get(collisionKey)].sort(),
      k: sortedObjectFromMap(byOwner, (keys) => [...keys].sort()),
    })
  }
  for (const publishedKey of [...publishedOwners.keys()].sort()) {
    addEntry(`p:${publishedKey}`, { o: [...publishedOwners.get(publishedKey)].sort() })
  }

  const shards = shardEntries.map((entries, index) => {
    const value = JSON.stringify({
      schema_version: ICONOPLASM_RECOGNITION_INDEX_SCHEMA_VERSION,
      scanner_version: version,
      shard_index: index,
      entries,
    })
    const byteSize = textEncoder.encode(value).byteLength
    if (byteSize > ICONOPLASM_RECOGNITION_INDEX_MAX_SHARD_BYTES) {
      throw new Error(
        `Recognition index shard ${index} is ${byteSize} bytes; budget is ${ICONOPLASM_RECOGNITION_INDEX_MAX_SHARD_BYTES}`,
      )
    }
    return Object.freeze({
      key: iconoplasmRecognitionIndexShardKey(version, index),
      value,
      byte_size: byteSize,
    })
  })
  const manifest = Object.freeze({
    schema_version: ICONOPLASM_RECOGNITION_INDEX_SCHEMA_VERSION,
    scanner_version: version,
    shard_count: ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT,
    canonical_count: canonicalSymbols.size,
    collision_key_count: collisionOwners.size,
    published_key_count: publishedOwners.size,
    shard_byte_sizes: shards.map((shard) => shard.byte_size),
  })
  const recognitionContext = Object.freeze({
    canonicalSymbols,
    collisionOwners,
    publishedOwners,
    publishedKeysByCollisionOwner,
  })
  return Object.freeze({
    recognitionContext,
    manifest,
    manifestKey: iconoplasmRecognitionIndexManifestKey(version),
    manifestValue: JSON.stringify(manifest),
    shards: Object.freeze(shards),
  })
}

function validManifest(raw, scannerVersion) {
  const manifest = safeJsonParse(raw)
  return manifest &&
    manifest.schema_version === ICONOPLASM_RECOGNITION_INDEX_SCHEMA_VERSION &&
    manifest.scanner_version === scannerVersion &&
    manifest.shard_count === ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT &&
    Number.isSafeInteger(manifest.canonical_count) &&
    Number.isSafeInteger(manifest.collision_key_count) &&
    Number.isSafeInteger(manifest.published_key_count) &&
    Array.isArray(manifest.shard_byte_sizes) &&
    manifest.shard_byte_sizes.length === ICONOPLASM_RECOGNITION_INDEX_SHARD_COUNT
    ? manifest
    : null
}

function validShard(raw, scannerVersion, shardIndex) {
  const shard = safeJsonParse(raw)
  return shard &&
    shard.schema_version === ICONOPLASM_RECOGNITION_INDEX_SCHEMA_VERSION &&
    shard.scanner_version === scannerVersion &&
    shard.shard_index === shardIndex &&
    shard.entries &&
    typeof shard.entries === "object" &&
    !Array.isArray(shard.entries)
    ? shard
    : null
}

export async function readIconoplasmRecognitionValidationIndexRecords(
  kv,
  scannerVersion,
  lookupKeys,
) {
  if (!kv || typeof kv.get !== "function") throw new TypeError("KV binding is required")
  const version = normalizedScannerVersion(scannerVersion)
  const keys = [
    ...new Set(Array.from(lookupKeys || [], (key) => String(key || "")).filter(Boolean)),
  ]
  const manifest = validManifest(
    await kv.get(iconoplasmRecognitionIndexManifestKey(version)),
    version,
  )
  if (!manifest) {
    const error = new Error(
      "Published recognition validation index is unavailable; republish the catalog before editing recognition policy",
    )
    error.code = "published_recognition_index_unavailable"
    error.status = 503
    throw error
  }
  if (keys.length === 0) return new Map()
  const shardIndexes = [...new Set(keys.map(iconoplasmRecognitionIndexShardForKey))].sort(
    (left, right) => left - right,
  )
  const shards = await Promise.all(
    shardIndexes.map(async (shardIndex) => {
      const raw = await kv.get(iconoplasmRecognitionIndexShardKey(version, shardIndex))
      const expectedBytes = Number(manifest.shard_byte_sizes[shardIndex])
      if (
        !Number.isSafeInteger(expectedBytes) ||
        expectedBytes < 1 ||
        expectedBytes > ICONOPLASM_RECOGNITION_INDEX_MAX_SHARD_BYTES ||
        textEncoder.encode(String(raw || "")).byteLength !== expectedBytes
      ) {
        return null
      }
      return validShard(raw, version, shardIndex)
    }),
  )
  if (shards.some((shard) => !shard)) {
    const error = new Error(
      "Published recognition validation index is incomplete; republish the catalog before editing recognition policy",
    )
    error.code = "published_recognition_index_unavailable"
    error.status = 503
    throw error
  }
  const byIndex = new Map(shardIndexes.map((index, offset) => [index, shards[offset]]))
  return new Map(
    keys.map((key) => [
      key,
      byIndex.get(iconoplasmRecognitionIndexShardForKey(key))?.entries?.[key] ?? null,
    ]),
  )
}

export async function publishIconoplasmRecognitionValidationIndex(kv, index) {
  if (!kv || typeof kv.put !== "function") throw new TypeError("KV binding is required")
  for (const shard of index.shards) await kv.put(shard.key, shard.value)
  await kv.put(index.manifestKey, index.manifestValue)
  return index.manifest
}
