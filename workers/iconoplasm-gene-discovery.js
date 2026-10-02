const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const ICONOPLASM_ORIGIN = `https://${ICONOPLASM_HOST}`
const ICONOPLASM_PORTRAIT_RENDITIONS = new Set(["thumb", "medium", "full"])

export const ICONOPLASM_SEMANTIC_PROFILE_CONTRACT_VERSION = 1

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return /^[A-Z0-9][A-Z0-9._-]*$/.test(symbol) ? symbol : ""
}

function normalizeSha256(value) {
  const sha = String(value || "")
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(sha) ? sha : ""
}

export function normalizeIconoplasmPublishedGeneRecord(rawRecord) {
  const raw = rawRecord && typeof rawRecord === "object" ? rawRecord : {}
  const symbol = normalizeSymbol(raw.s || raw.symbol || raw.canonical_symbol)
  const fullName = String(raw.n || raw.full_name || raw.name || "").trim()
  const portrait = raw.p || raw.portrait || {}
  return {
    symbol,
    fullName,
    portraitAssetSha256: normalizeSha256(portrait.asset_sha256 || raw.portraitAssetSha256),
  }
}

export function iconoplasmPublishedPortraitUrl(rawRecord, rendition = "medium") {
  const gene = normalizeIconoplasmPublishedGeneRecord(rawRecord)
  const size = String(rendition || "medium")
    .trim()
    .toLowerCase()
  if (!gene.portraitAssetSha256 || !ICONOPLASM_PORTRAIT_RENDITIONS.has(size)) return ""
  return `${ICONOPLASM_ORIGIN}/portraits/v1/${gene.portraitAssetSha256.slice(0, 2)}/${gene.portraitAssetSha256}/${size}.webp`
}

// ARCHITECTURE FENCE [IPD-011]: the public catalog is allowed to establish
// discovery membership and naming only. Its portrait reference can lag the
// versioned published card artifact and must never decide canonical image
// identity or final page indexability.
export function iconoplasmPublishedGeneRecordIsDiscoveryCandidate(rawRecord) {
  const gene = normalizeIconoplasmPublishedGeneRecord(rawRecord)
  return Boolean(gene.symbol && gene.fullName && ICONOPLASM_SEMANTIC_PROFILE_CONTRACT_VERSION === 1)
}
