// The published gene blot's identity (fingerprint, object key, CDN URL, WebP size) and
// its D1 registration. Print copies are painted in the reader's browser from the
// published card, so no server renders or stores them.
//
// ARCHITECTURE FENCE [IPD-011]: the fingerprint is derived from the exact
// published card payload. This module never reconstructs a winner from votes.

export const ICONOPLASM_GENE_BLOT_RENDERER_REVISION = "gene-blot-v2-2026-08-24-gallery-artboard-2x"
export const ICONOPLASM_GENE_BLOT_WIDTH = 768
export const ICONOPLASM_GENE_BLOT_HEIGHT = 1024

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
// checksum; storage bytes are still verified by the provider adapter.
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

export function iconoplasmGeneBlotFingerprint(cardPayload) {
  const portrait =
    cardPayload?.portrait && typeof cardPayload.portrait === "object" ? cardPayload.portrait : {}
  const material = stableJson({
    renderer: ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
    symbol: normalizeSymbol(cardPayload?.symbol || cardPayload?.canonical_symbol || ""),
    full_name: String(cardPayload?.full_name || cardPayload?.name || "").trim(),
    portrait_asset_sha256:
      portrait.status === "published" ? normalizeSha256(portrait.asset_sha256 || "") : "",
  })
  return `${fnv1a64(material, 0xcbf29ce484222325n)}${fnv1a64(material, 0x84222325cbf29ce4n)}`
}

export function iconoplasmGeneBlotObjectKey(symbolValue, fingerprintValue) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(fingerprintValue || "")
    .trim()
    .toLowerCase()
  if (!symbol || !/^[a-f0-9]{32}$/.test(fingerprint)) return ""
  return `blots/v1/${symbol.slice(0, 1)}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
}

export function iconoplasmGeneBlotCdnUrl(env, objectKey) {
  return iconoplasmGeneCardCdnUrl(env, objectKey)
}

export function iconoplasmGeneBlotFilename(symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  return symbol ? `${symbol}-iconoplasm-gene-blot.webp` : "iconoplasm-gene-blot.webp"
}

export function iconoplasmGeneCardCdnUrl(env, objectKey) {
  const base = String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || "https://img.brinedew.bio")
    .trim()
    .replace(/\/+$/, "")
  const key = String(objectKey || "").replace(/^\/+/, "")
  return base && key ? `${base}/${key}` : ""
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

export function iconoplasmGeneBlotWebpDimensions(bytes) {
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
      const height = 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset = dataOffset + chunkSize + (chunkSize % 2)
  }
  return null
}

export async function registerIconoplasmGeneBlot(
  env,
  { symbol: symbolValue, blotFingerprint, portraitAssetSha256, blotAssetSha256, objectKey },
) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(blotFingerprint || "")
    .trim()
    .toLowerCase()
  const portraitAssetSha = normalizeSha256(portraitAssetSha256)
  const blotAssetSha = normalizeSha256(blotAssetSha256)
  const key = String(objectKey || "").trim()
  if (
    !symbol ||
    !/^[a-f0-9]{32}$/.test(fingerprint) ||
    !portraitAssetSha ||
    !blotAssetSha ||
    key !== iconoplasmGeneBlotObjectKey(symbol, fingerprint)
  ) {
    throw new TypeError("Invalid canonical gene blot identity")
  }
  const current = await env.ICONOPLASM_DB.prepare(
    `SELECT * FROM icono_gene_blot_materializations WHERE gene_symbol = ?`,
  )
    .bind(symbol)
    .first()
  const changed = !(
    String(current?.blot_fingerprint || "").toLowerCase() === fingerprint &&
    normalizeSha256(current?.portrait_asset_sha256 || "") === portraitAssetSha &&
    normalizeSha256(current?.blot_asset_sha256 || "") === blotAssetSha &&
    String(current?.object_key || "") === key &&
    Number(current?.width || 0) === ICONOPLASM_GENE_BLOT_WIDTH &&
    Number(current?.height || 0) === ICONOPLASM_GENE_BLOT_HEIGHT
  )
  const statements = [
    env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_gene_blot_materializations (
         gene_symbol, blot_fingerprint, portrait_asset_sha256, blot_asset_sha256,
         object_key, width, height, renderer_revision, rendered_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(gene_symbol) DO UPDATE SET
         blot_fingerprint = excluded.blot_fingerprint,
         portrait_asset_sha256 = excluded.portrait_asset_sha256,
         blot_asset_sha256 = excluded.blot_asset_sha256,
         object_key = excluded.object_key,
         width = excluded.width,
         height = excluded.height,
         renderer_revision = excluded.renderer_revision,
         rendered_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      symbol,
      fingerprint,
      portraitAssetSha,
      blotAssetSha,
      key,
      ICONOPLASM_GENE_BLOT_WIDTH,
      ICONOPLASM_GENE_BLOT_HEIGHT,
      ICONOPLASM_GENE_BLOT_RENDERER_REVISION,
    ),
    env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_publish_events (
         gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
       ) VALUES (?, ?, ?, 'gene_blot_materialized', 'iconoplasm_workstation', ?, CURRENT_TIMESTAMP)`,
    ).bind(
      symbol,
      portraitAssetSha,
      portraitAssetSha,
      `Ready canonical blot ${fingerprint} as ${blotAssetSha}`,
    ),
  ]
  if (!changed) {
    // A re-registration of the exact same blot is a no-op. Writing the row and
    // a publish event again would consume a D1 write and fan out a duplicate
    // event for zero image change; return the already-current row instead.
    return { changed: false, row: current }
  }
  await env.ICONOPLASM_DB.batch(statements)
  return {
    changed,
    row: await env.ICONOPLASM_DB.prepare(
      `SELECT * FROM icono_gene_blot_materializations WHERE gene_symbol = ?`,
    )
      .bind(symbol)
      .first(),
  }
}
