// A blot is one WebP: the gene's current portrait with its name and symbol
// painted on (docs/ICONOPLASM_GLOSSARY.md). This module is its identity: the
// fingerprint, the storage key, the CDN address, the file name and the size.
// The site computes a gene's blot address from its published card with these
// functions, and scripts/draw-iconoplasm-blots.mjs draws the file at that
// address with the shared blot painter (shared/iconoplasm-card/blot-painter.js).
// Nothing else records which blots exist: Bunny storage is the record (B-1131).
//
// ARCHITECTURE FENCE [IPD-011]: the fingerprint is derived from the exact
// published card payload. This module never reconstructs a winner from votes.

// Change the revision whenever the painter's output changes, so every blot is
// drawn again at a new address instead of a stale picture keeping its old one.
export const ICONOPLASM_BLOT_RENDERER_REVISION = "blot-v3-2026-10-19-painter-768"
export const ICONOPLASM_BLOT_WIDTH = 768
export const ICONOPLASM_BLOT_HEIGHT = 1024
// One storage folder per first letter, so one listing shows every drawn blot
// of that letter (the largest, C, holds about 2,200 genes).
export const ICONOPLASM_BLOT_PREFIX = "blots/v2/"

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol) ? symbol : ""
}

function normalizeSha256(value) {
  const sha = String(value || "")
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(sha) ? sha : ""
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (!value || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value)
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`
}

// Two independent 64-bit FNV-1a streams make a compact deterministic freshness
// fingerprint. This is a change detector, not a security boundary or object
// checksum.
function fnv1a64(text, seed) {
  let hash = BigInt(seed)
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, "0")
}

// What the painter sees: the symbol, the name and the published portrait. The
// drawing script hands the painter exactly these, so a blot can't change
// without its fingerprint changing too.
export function iconoplasmBlotInputs(cardPayload) {
  const portrait =
    cardPayload?.portrait && typeof cardPayload.portrait === "object" ? cardPayload.portrait : {}
  return {
    symbol: normalizeSymbol(cardPayload?.symbol || cardPayload?.canonical_symbol || ""),
    full_name: String(cardPayload?.full_name || cardPayload?.name || "").trim(),
    portrait_asset_sha256:
      portrait.status === "published" ? normalizeSha256(portrait.asset_sha256 || "") : "",
  }
}

export function iconoplasmBlotFingerprint(cardPayload) {
  const material = stableJson({
    renderer: ICONOPLASM_BLOT_RENDERER_REVISION,
    ...iconoplasmBlotInputs(cardPayload),
  })
  return `${fnv1a64(material, 0xcbf29ce484222325n)}${fnv1a64(material, 0x84222325cbf29ce4n)}`
}

export function iconoplasmBlotObjectKey(symbolValue, fingerprintValue) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(fingerprintValue || "")
    .trim()
    .toLowerCase()
  if (!symbol || !/^[a-f0-9]{32}$/.test(fingerprint)) return ""
  return `${ICONOPLASM_BLOT_PREFIX}${symbol.slice(0, 1)}/${symbol}-${fingerprint}.webp`
}

// The storage folder a blot key lives in, and the file name inside it.
export function iconoplasmBlotFolder(symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  return symbol ? `${ICONOPLASM_BLOT_PREFIX}${symbol.slice(0, 1)}/` : ""
}

// The public CDN address of any object in the portrait storage zone.
export function iconoplasmCdnUrl(env, objectKey) {
  const base = String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || "https://img.brinedew.bio")
    .trim()
    .replace(/\/+$/, "")
  const key = String(objectKey || "").replace(/^\/+/, "")
  return base && key ? `${base}/${key}` : ""
}

export function iconoplasmBlotCdnUrl(env, objectKey) {
  return iconoplasmCdnUrl(env, objectKey)
}

// The name a reader's download gets.
export function iconoplasmBlotFilename(symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  return symbol ? `${symbol}-iconoplasm-blot.webp` : "iconoplasm-blot.webp"
}

function asciiAt(bytes, offset, length) {
  let value = ""
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] || 0)
  }
  return value
}

function littleEndianUint32(bytes, offset) {
  return (
    ((bytes[offset] || 0) |
      ((bytes[offset + 1] || 0) << 8) |
      ((bytes[offset + 2] || 0) << 16) |
      ((bytes[offset + 3] || 0) << 24)) >>>
    0
  )
}

// A WebP's pixel size from its header, or null when the bytes aren't a WebP.
export function webpDimensions(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (
    source.byteLength < 30 ||
    asciiAt(source, 0, 4) !== "RIFF" ||
    asciiAt(source, 8, 4) !== "WEBP"
  ) {
    return null
  }
  let offset = 12
  while (offset + 8 <= source.byteLength) {
    const kind = asciiAt(source, offset, 4)
    const chunkSize = littleEndianUint32(source, offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + chunkSize > source.byteLength) return null
    if (kind === "VP8X" && chunkSize >= 10) {
      const width =
        1 + source[dataOffset + 4] + (source[dataOffset + 5] << 8) + (source[dataOffset + 6] << 16)
      const height =
        1 + source[dataOffset + 7] + (source[dataOffset + 8] << 8) + (source[dataOffset + 9] << 16)
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (kind === "VP8 " && chunkSize >= 10) {
      const width = source[dataOffset + 6] + ((source[dataOffset + 7] & 0x3f) << 8)
      const height = source[dataOffset + 8] + ((source[dataOffset + 9] & 0x3f) << 8)
      return width > 0 && height > 0 ? { width, height } : null
    }
    if (kind === "VP8L" && chunkSize >= 5 && source[dataOffset] === 0x2f) {
      const b1 = source[dataOffset + 1]
      const b2 = source[dataOffset + 2]
      const b3 = source[dataOffset + 3]
      const b4 = source[dataOffset + 4]
      const width = 1 + b1 + ((b2 & 0x3f) << 8)
      const height = 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset = dataOffset + chunkSize + (chunkSize % 2)
  }
  return null
}
