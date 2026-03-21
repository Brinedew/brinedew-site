import { isAdmin } from "./admin.js"
import { parseCookies } from "./auth.js"
import { fetchProteinByUniprot } from "./lib/protein-store.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { ICONOPLASM_ARTIST_STYLES_HTML } from "./iconoplasm-artist-styles-html.js"
import { ICONOPLASM_WIKI_PAGEVIEWS } from "./iconoplasm-wiki-pageviews.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const API_SCHEMA_VERSION = 2
const MIN_EXTENSION_VERSION = "0.3.0"

const KV_CATALOG_MANIFEST = "iconoplasm:catalog-manifest"
const KV_CATALOG_PREFIX = "iconoplasm:catalog:"
const KV_GALLERY_VERSION = "iconoplasm:gallery-version"

const catalogCache = {
  hash: null,
  bySymbol: new Map(),
  symbolByUniprot: new Map(),
  loadedAt: 0,
}
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
const gallerySnapshotCache = {
  catalogHash: null,
  base: null,
  loadedAt: 0,
  items: [],
  publishedTotal: 0,
  sorted: new Map(),
}
const GALLERY_SNAPSHOT_TTL_MS = 60 * 1000
const galleryVersionCache = {
  value: "0",
  loadedAt: 0,
}
const GALLERY_VERSION_CACHE_TTL_MS = 5 * 1000
const ADMIN_DASHBOARD_SUMMARY_KEY = "default"
const ADMIN_READ_MODEL_BOOTSTRAP_KEY = "default"
const ADMIN_READ_MODEL_BOOTSTRAP_PHASE_SYMBOLS = "symbols"
const ADMIN_READ_MODEL_BOOTSTRAP_PHASE_VISIONS = "visions"
const ADMIN_READ_MODEL_BOOTSTRAP_PHASE_DONE = "done"
const ADMIN_READ_MODEL_BOOTSTRAP_STATUS_RUNNING = "running"
const ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE = "complete"
const ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT = 200
const ADMIN_READ_MODEL_SYMBOL_BATCH_MAX = 1000
const ADMIN_READ_MODEL_VISION_BATCH_DEFAULT = 150
const ADMIN_READ_MODEL_VISION_BATCH_MAX = 1000
const ADMIN_READ_MODEL_STEP_DEFAULT = 1
const ADMIN_READ_MODEL_STEP_MAX = 25
const adminReadModelState = {
  ready: false,
  promise: null,
}

const rlBuckets = new Map()
const RL_WINDOW_MS = 60 * 1000
const RANDOM_ARTIST_METAVISION_RE = /^artist-random-[a-z0-9-]+$/i
const LEGACY_ARTIST_VISION_RE = /^artist-(?!random-)[a-z0-9()_-]+$/i
const CANONICAL_RANDOM_ARTIST_VARIANT_RE = /^[a-z0-9-]+-v\d+-\d+$/i

export function isIconoplasmRequest(host) {
  return host === ICONOPLASM_HOST || host.startsWith("iconoplasm.")
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "If-None-Match, Content-Type, X-Iconoplasm-Extension-Version, Authorization, X-Iconoplasm-Admin-Token",
    Vary: "Origin",
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", ...extra },
  })
}

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extra },
  })
}

function asHead(request, response) {
  if (request.method !== "HEAD") return response
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

function normalizeSymbol(raw) {
  if (!raw) return null
  const v = decodeURIComponent(String(raw)).trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{0,63}$/.test(v)) return null
  return v
}

function normalizeUniprot(raw) {
  if (!raw) return null
  const v = decodeURIComponent(String(raw)).trim().toUpperCase()
  if (!/^[A-Z0-9]{6,10}$/.test(v)) return null
  return v
}

function normalizeUserId(raw) {
  const v = String(raw || "").trim()
  if (!v) return "local"
  return v.slice(0, 255)
}

function isGuestUserId(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
  if (!v) return true
  if (["local", "guest", "anonymous", "anon"].includes(v)) return true
  return v.startsWith("guest_")
}

function normalizeVisionId(raw) {
  const v = String(raw || "").trim()
  if (!v) return ""
  return v.slice(0, 255)
}

function normalizeArtistTag(raw) {
  const base = String(raw || "")
    .trim()
    .toLowerCase()
  if (!base) return null
  const withAt = base.startsWith("@") ? base : `@${base}`
  if (!/^@[a-z0-9()_-]{1,254}$/i.test(withAt)) return null
  return withAt.slice(0, 255)
}

export function isRandomArtistMetavisionId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return false
  return RANDOM_ARTIST_METAVISION_RE.test(visionId)
}

export function isLegacyArtistVisionId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return false
  return LEGACY_ARTIST_VISION_RE.test(visionId)
}

export function isCanonicalRandomArtistVariantId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return false
  return CANONICAL_RANDOM_ARTIST_VARIANT_RE.test(visionId)
}

function deriveAdminArtistId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return ""
  if (!isCanonicalRandomArtistVariantId(visionId)) return ""
  const match = visionId.match(/-(\d+)$/)
  if (!match) return ""
  return String(Number.parseInt(match[1], 10) || "")
}

function publicArtistIdForRow(row) {
  return sanitizeText(row?.artist_id || "", 64) || deriveAdminArtistId(row?.vision_id || "")
}

export function sanitizeVoteVisionId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return ""
  if (isRandomArtistMetavisionId(visionId)) return ""
  if (isLegacyArtistVisionId(visionId)) return ""
  return visionId
}

function normalizeVoteValue(raw) {
  const n = Number.parseInt(String(raw ?? ""), 10)
  if (n === 1) return 1
  if (n === -1) return -1
  if (n === 0) return 0
  return null
}

function normalizeCandidateRef(raw, symbol = null, assetSha256 = null) {
  const explicit = String(raw || "").trim()
  if (explicit) return explicit.slice(0, 255)
  const sym = normalizeSymbol(symbol)
  const sha = normalizeSha256(assetSha256)
  if (!sym || !sha) return null
  return `a:${sym}|${sha}`
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function joinUrl(base, key) {
  const b = String(base || "").replace(/\/+$/, "")
  const k = String(key || "").replace(/^\/+/, "")
  return `${b}/${k}`
}

function portraitBase(url, env) {
  if (
    typeof env.ICONOPLASM_PORTRAIT_BASE_URL === "string" &&
    env.ICONOPLASM_PORTRAIT_BASE_URL.trim()
  ) {
    return env.ICONOPLASM_PORTRAIT_BASE_URL.trim()
  }
  // R2 keys include the `portraits/` prefix, so the base is just the origin.
  return url.origin
}

function portraitHashToken(raw) {
  const token = String(raw || "")
    .trim()
    .replace(/[^0-9A-Za-z]+/g, "")
  return token || null
}

export function buildPortraitAwareManifestHash(baseHash, portraitFingerprint) {
  const base = String(baseHash || "").trim()
  if (!base) return null
  if (!portraitFingerprint) return base
  const count = Number(portraitFingerprint.published_count ?? portraitFingerprint.count ?? 0)
  const latest = portraitHashToken(
    portraitFingerprint.latest_updated_at ?? portraitFingerprint.latest ?? "",
  )
  if (!count && !latest) return base
  return latest ? `${base}-${count}-${latest}` : `${base}-${count}`
}

export function mergePublishedPortraitRefsIntoArtifact(artifact, publishedPortraits) {
  if (!artifact || typeof artifact !== "object") return artifact
  const genes = Array.isArray(artifact.genes) ? artifact.genes : null
  if (!genes || !Array.isArray(publishedPortraits) || publishedPortraits.length === 0)
    return artifact

  const publishedBySymbol = new Map()
  for (const row of publishedPortraits) {
    const symbol = normalizeSymbol(row?.symbol || row?.gene_symbol)
    if (!symbol) continue
    const heroRef = String(row?.ph || row?.r2_key_full || "").trim()
    const thumbRef = String(row?.pt || row?.r2_key_medium || row?.r2_key_thumb || "").trim()
    if (!heroRef && !thumbRef) continue
    publishedBySymbol.set(symbol, { ph: heroRef || null, pt: thumbRef || null })
  }
  if (publishedBySymbol.size === 0) return artifact

  let changed = false
  const nextGenes = genes.map((gene) => {
    if (!gene || typeof gene !== "object") return gene
    const symbol = normalizeSymbol(gene.s)
    const published = symbol ? publishedBySymbol.get(symbol) : null
    if (!published) return gene

    let nextGene = gene
    if (!gene.ph && published.ph) {
      nextGene = nextGene === gene ? { ...gene } : nextGene
      nextGene.ph = published.ph
      changed = true
    }
    if (!gene.pt && published.pt) {
      nextGene = nextGene === gene ? { ...gene } : nextGene
      nextGene.pt = published.pt
      changed = true
    }
    return nextGene
  })

  if (!changed) return artifact
  return { ...artifact, genes: nextGenes }
}

async function publishedPortraitFingerprint(env) {
  if (!env.ICONOPLASM_DB) return null
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT
         COUNT(*) AS published_count,
         MAX(updated_at) AS latest_updated_at
       FROM icono_publish_state
       WHERE current_asset_sha256 IS NOT NULL`,
    ).first()
    return row || null
  } catch {
    return null
  }
}

async function publishedPortraitRefs(env) {
  if (!env.ICONOPLASM_DB) return []
  try {
    // Keep artifact hydration O(1) SQL-wise. One join here is much cheaper than
    // per-gene API lookups or N+1 D1 queries when the extension refreshes.
    const rows = await env.ICONOPLASM_DB.prepare(
      `SELECT
         upper(ps.gene_symbol) AS symbol,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb
       FROM icono_publish_state ps
       LEFT JOIN icono_portrait_assets pa
         ON upper(pa.gene_symbol) = upper(ps.gene_symbol)
        AND pa.asset_sha256 = ps.current_asset_sha256
       WHERE ps.current_asset_sha256 IS NOT NULL`,
    ).all()
    return Array.isArray(rows?.results) ? rows.results : []
  } catch {
    return []
  }
}

// Canonical R2 key for a portrait rendition.
// rendition: 'full' (<=1MP, gene page hero), 'medium' (512px long edge, extension/grid), 'thumb' (256x256 crop)
function r2PortraitKey(sha256, rendition) {
  return `portraits/v1/${sha256.slice(0, 2)}/${sha256}/${rendition}.webp`
}

function adminPortraitUrl(base, assetSha256, rendition = "thumb") {
  const sha = normalizeSha256(assetSha256)
  if (!sha) return null
  return joinUrl(base, r2PortraitKey(sha, rendition))
}

function normalizeSha256(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(v)) return null
  return v
}

function optionalInt(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < 0) return null
  return rounded
}

function optionalFloat(raw, { min = 0 } = {}) {
  if (raw == null) return null
  if (typeof raw === "string" && !raw.trim()) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n < min) return null
  return n
}

function coerceBoolean(raw, fallback = false) {
  if (typeof raw === "boolean") return raw
  if (typeof raw === "number") return raw !== 0
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(v)) return true
    if (["0", "false", "no", "off"].includes(v)) return false
  }
  return fallback
}

function normalizeAssetStatus(raw, fallback = "draft") {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
  if (["draft", "approved", "rejected"].includes(v)) return v
  return fallback
}

function normalizeHexColor(raw) {
  const v = String(raw || "").trim()
  if (!v) return null
  if (/^#[a-f0-9]{6}$/i.test(v)) return v.toLowerCase()
  return null
}

function sanitizeText(raw, maxLen) {
  const v = String(raw || "").trim()
  if (!v) return null
  return v.slice(0, maxLen)
}

function normalizeTextList(raw, { maxItems = 32, maxLen = 128 } = {}) {
  const out = []
  const seen = new Set()
  const pushValue = (value) => {
    const cleaned = sanitizeText(value, maxLen)
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      pushValue(item)
      if (out.length >= maxItems) break
    }
    return out
  }
  if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(",")) {
      pushValue(part)
      if (out.length >= maxItems) break
    }
  }
  return out
}

function normalizeAestheticsList(raw) {
  return normalizeTextList(raw)
}

function validateEssenceTraitOrigins({
  symbol,
  aesthetics,
  faction,
  aestheticsOrigin,
  politicsOrigin,
}) {
  if (
    Array.isArray(aesthetics) &&
    aesthetics.length &&
    (!Array.isArray(aestheticsOrigin) || !aestheticsOrigin.length)
  ) {
    return `Aesthetics origin metadata is required for ${symbol}`
  }
  if (faction && (!Array.isArray(politicsOrigin) || !politicsOrigin.length)) {
    return `Politics origin metadata is required for ${symbol}`
  }
  return ""
}

function normalizeCanonicalFaction(raw) {
  const cleaned = sanitizeText(raw, 64)
  if (!cleaned) return { value: null, error: "" }
  const key = cleaned.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()
  if (key === "pro growth" || key === "progrowth") {
    return { value: "pro-growth", error: "" }
  }
  if (key === "pro control" || key === "procontrol") {
    return { value: "pro-control", error: "" }
  }
  if (key === "turncoat") {
    return { value: "turncoat", error: "" }
  }
  if (key === "neutral" || key === "housekeeper") {
    return { value: null, error: "" }
  }
  return {
    value: null,
    error: `Invalid faction label "${cleaned}"; expected pro-growth, pro-control, or turncoat`,
  }
}

function normalizeEssencePayload(rawEssence, fallbackSymbol) {
  const payload = rawEssence && typeof rawEssence === "object" ? rawEssence : null
  if (!payload) return null
  const symbol = normalizeSymbol(payload.symbol || payload.gene_symbol || fallbackSymbol || "")
  if (!symbol) return null

  const fullName = sanitizeText(payload.name || payload.full_name, 255)
  const weightKgRaw = optionalFloat(payload.weight_kg, { min: 0 })
  const weightKg =
    Number.isFinite(weightKgRaw) && weightKgRaw > 0 ? Math.round(weightKgRaw * 10) / 10 : null
  const heightCm = optionalInt(payload.height_cm)
  const ageYears = optionalInt(payload.age_years)
  const ageTextRaw = sanitizeText(payload.age || payload.age_text, 64)
  const ageText = ageTextRaw || (ageYears != null ? String(ageYears) : null)
  const sex = sanitizeText(payload.sex, 32)
  const factionInfo = normalizeCanonicalFaction(payload.faction || payload.politics)
  const faction = factionInfo.value
  const skinHex = normalizeHexColor(payload.skin_hex)
  const skinName = sanitizeText(payload.skin_name, 64)
  const tissueTau = optionalFloat(payload.tissue_tau, { min: 0 })
  const loeuf = optionalFloat(payload.loeuf, { min: 0 })
  const constraintPercentile = optionalFloat(payload.constraint_percentile, { min: 0 })
  const aesthetics = normalizeAestheticsList(payload.aesthetics)
  const aestheticsOrigin = normalizeTextList(payload.aesthetics_origin)
  const politicsOrigin = normalizeTextList(payload.politics_origin)
  const familySurname = sanitizeText(payload.family_surname || payload.gene_surname, 64)
  const familyMembers = optionalInt(payload.family_members)
  const familyFeature = sanitizeText(payload.family_feature, 255)
  const manifestation = sanitizeText(payload.manifestation || payload.description, 4000)
  const traitOriginValidationError = validateEssenceTraitOrigins({
    symbol,
    aesthetics,
    faction,
    aestheticsOrigin,
    politicsOrigin,
  })
  const validationError = factionInfo.error || traitOriginValidationError

  return {
    gene_symbol: symbol,
    full_name: fullName,
    weight_kg: weightKg,
    height_cm: heightCm,
    sex,
    age: ageText,
    age_years: ageYears,
    faction,
    skin_hex: skinHex,
    skin_name: skinName,
    tissue_tau: tissueTau,
    loeuf,
    constraint_percentile: constraintPercentile,
    aesthetics_json: JSON.stringify(aesthetics),
    aesthetics_origin_json: JSON.stringify(aestheticsOrigin),
    politics_origin_json: JSON.stringify(politicsOrigin),
    family_surname: familySurname,
    family_members: familyMembers,
    family_feature: familyFeature,
    manifestation,
    ...(validationError ? { validation_error: validationError } : {}),
  }
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ""))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
}

function catalogStateHashPayload(rawItem) {
  const item = normalizeCatalogPayloadItem(rawItem)
  if (!item || item.validation_error) return null
  return [
    item.gene_symbol,
    item.full_name || "",
    item.uniprot || "",
    item.color_hex || "",
    item.tmh ? 1 : 0,
  ]
}

async function hashCatalogItems(rawItems) {
  const rows = []
  for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
    const payload = catalogStateHashPayload(rawItem)
    if (payload) rows.push(payload)
  }
  rows.sort((left, right) => String(left[0] || "").localeCompare(String(right[0] || "")))
  return sha256Hex(JSON.stringify(rows))
}

function essenceStateHashPayload(rawEssence, fallbackSymbol = "") {
  const essence = normalizeEssencePayload(rawEssence, fallbackSymbol)
  if (!essence || essence.validation_error) return null
  return [
    essence.gene_symbol,
    essence.full_name || "",
    essence.weight_kg ?? null,
    essence.height_cm ?? null,
    essence.sex || "",
    essence.age || "",
    essence.age_years ?? null,
    essence.faction || "",
    essence.skin_hex || "",
    essence.skin_name || "",
    essence.tissue_tau ?? null,
    essence.loeuf ?? null,
    essence.constraint_percentile ?? null,
    essence.aesthetics_json || "[]",
    essence.aesthetics_origin_json || "[]",
    essence.politics_origin_json || "[]",
    essence.family_surname || "",
    essence.family_members ?? null,
    essence.family_feature || "",
    essence.manifestation || "",
  ]
}

async function hashEssencePayload(rawEssence, fallbackSymbol = "") {
  const payload = essenceStateHashPayload(rawEssence, fallbackSymbol)
  if (!payload) return ""
  return sha256Hex(JSON.stringify(payload))
}

async function upsertGeneEssence(env, essence, updatedBy, source = "nicegui_sync") {
  if (!env.ICONOPLASM_DB || !essence?.gene_symbol) return false
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_gene_essence (
       gene_symbol,
       full_name,
       weight_kg,
       height_cm,
       sex,
       age,
       age_years,
       faction,
       skin_hex,
       skin_name,
       tissue_tau,
       loeuf,
       constraint_percentile,
       aesthetics_json,
       aesthetics_origin_json,
       politics_origin_json,
       family_surname,
       family_members,
       family_feature,
       manifestation,
       source,
       updated_by,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       full_name=excluded.full_name,
       weight_kg=excluded.weight_kg,
       height_cm=excluded.height_cm,
       sex=excluded.sex,
       age=excluded.age,
       age_years=excluded.age_years,
       faction=excluded.faction,
       skin_hex=excluded.skin_hex,
       skin_name=excluded.skin_name,
       tissue_tau=excluded.tissue_tau,
       loeuf=excluded.loeuf,
       constraint_percentile=excluded.constraint_percentile,
       aesthetics_json=excluded.aesthetics_json,
       aesthetics_origin_json=excluded.aesthetics_origin_json,
       politics_origin_json=excluded.politics_origin_json,
       family_surname=excluded.family_surname,
       family_members=excluded.family_members,
       family_feature=excluded.family_feature,
       manifestation=excluded.manifestation,
       source=excluded.source,
       updated_by=excluded.updated_by,
       updated_at=CURRENT_TIMESTAMP`,
  )
    .bind(
      essence.gene_symbol,
      essence.full_name,
      essence.weight_kg,
      essence.height_cm,
      essence.sex,
      essence.age,
      essence.age_years,
      essence.faction,
      essence.skin_hex,
      essence.skin_name,
      essence.tissue_tau,
      essence.loeuf,
      essence.constraint_percentile,
      essence.aesthetics_json,
      essence.aesthetics_origin_json,
      essence.politics_origin_json,
      essence.family_surname,
      essence.family_members,
      essence.family_feature,
      essence.manifestation || null,
      String(source || "nicegui_sync").slice(0, 64),
      normalizeUserId(updatedBy || "nicegui_sync"),
    )
    .run()
  return true
}

function decodeBase64Bytes(raw) {
  const input = String(raw || "").trim()
  if (!input) return null
  const cleaned = input.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "")
  if (!cleaned) return null
  try {
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

function extractRenditionPayload(item, rendition) {
  const fromRenditions = item?.renditions?.[rendition]
  if (typeof fromRenditions === "string") return { base64: fromRenditions }
  if (fromRenditions && typeof fromRenditions === "object") return fromRenditions

  const fromRoot = item?.[rendition]
  if (typeof fromRoot === "string") return { base64: fromRoot }
  if (fromRoot && typeof fromRoot === "object") return fromRoot

  const rootBase64 = item?.[`${rendition}_base64`]
  if (typeof rootBase64 === "string" && rootBase64.trim()) return { base64: rootBase64 }
  return null
}

function extractRenditionBytes(payload) {
  if (!payload || typeof payload !== "object") return null
  const b64 =
    payload.base64 ||
    payload.data ||
    payload.body ||
    payload.content_base64 ||
    payload.image_base64 ||
    payload.bytes_base64 ||
    ""
  return decodeBase64Bytes(b64)
}

function hasAdminToken(request, env) {
  const configured = String(env.ICONOPLASM_ADMIN_TOKEN || "").trim()
  if (!configured) return false
  const fromHeader = String(request.headers.get("x-iconoplasm-admin-token") || "").trim()
  const authHeader = String(request.headers.get("Authorization") || "").trim()
  const fromBearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : ""
  return fromHeader === configured || fromBearer === configured
}

async function isIconoplasmAdmin(request, env) {
  if (await isAdmin(request, env)) return true
  return hasAdminToken(request, env)
}

function extVersion(request) {
  return request.headers.get("x-iconoplasm-extension-version") || null
}

function etagMatches(ifNoneMatchValue, etag) {
  if (!ifNoneMatchValue || !etag) return false
  const candidates = String(ifNoneMatchValue)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const normalize = (v) => String(v).replace(/^W\//, "")
  const target = normalize(etag)
  return candidates.some((v) => normalize(v) === target)
}

function rateLimit(request, routeKey, maxPerMin) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown"
  const key = `${routeKey}:${ip}`
  const now = Date.now()
  const item = rlBuckets.get(key)
  if (!item || now - item.start > RL_WINDOW_MS) {
    rlBuckets.set(key, { start: now, count: 1 })
    return null
  }
  item.count += 1
  if (item.count > maxPerMin) {
    return Math.max(1, Math.ceil((RL_WINDOW_MS - (now - item.start)) / 1000))
  }
  return null
}

async function logReq(route, request, status, started, schema = null) {
  console.log(
    JSON.stringify({
      service: "iconoplasm",
      route,
      status,
      latency_ms: Date.now() - started,
      schema_version: schema,
      ext_version: extVersion(request),
      method: request.method,
    }),
  )
}

async function catalogManifestObj(env) {
  if (!env.KV) return null
  const raw = await env.KV.get(KV_CATALOG_MANIFEST)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function extensionManifestObj(url, env) {
  const manifest = await catalogManifestObj(env)
  if (!manifest) return null
  return {
    ...manifest,
    current_hash: buildPortraitAwareManifestHash(
      manifest.current_hash,
      await publishedPortraitFingerprint(env),
    ),
    portrait_base_url: portraitBase(url, env),
  }
}

async function warmCatalogCache(env) {
  const manifest = await catalogManifestObj(env)
  if (!manifest?.current_hash || !env.KV) return
  const now = Date.now()
  if (
    catalogCache.hash === manifest.current_hash &&
    now - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS &&
    catalogCache.bySymbol.size > 0
  ) {
    return
  }

  const raw = await env.KV.get(`${KV_CATALOG_PREFIX}${manifest.current_hash}`)
  if (!raw) return
  let artifact
  try {
    artifact = JSON.parse(raw)
  } catch {
    return
  }
  artifact = mergePublishedPortraitRefsIntoArtifact(artifact, await publishedPortraitRefs(env))

  const bySymbol = new Map()
  const symbolByUniprot = new Map()
  for (const g of artifact?.genes || []) {
    const s = normalizeSymbol(g?.s)
    if (!s) continue
    bySymbol.set(s, g)
    const u = normalizeUniprot(g?.u)
    if (u) symbolByUniprot.set(u, s)
  }
  catalogCache.hash = manifest.current_hash
  catalogCache.loadedAt = now
  catalogCache.bySymbol = bySymbol
  catalogCache.symbolByUniprot = symbolByUniprot
}

function normalizeCatalogPayloadItem(rawItem) {
  const payload = rawItem && typeof rawItem === "object" ? rawItem : null
  if (!payload) return null
  const symbol = normalizeSymbol(payload.symbol || payload.gene_symbol || payload.s || "")
  if (!symbol) return null
  const fullName = sanitizeText(payload.full_name || payload.name || payload.n, 255)
  if (!fullName) {
    return { symbol, validation_error: "Catalog item is missing full_name" }
  }
  const colorHex = normalizeHexColor(payload.color_hex || payload.color || payload.c || "")
  const uniprot = normalizeUniprot(payload.uniprot || payload.u || "")
  if (payload.uniprot != null && payload.uniprot !== "" && !uniprot) {
    return { symbol, validation_error: "Catalog item has invalid UniProt accession" }
  }
  if (payload.tmh == null) {
    return { symbol, validation_error: "Catalog item is missing tmh boolean" }
  }
  return {
    gene_symbol: symbol,
    full_name: fullName,
    uniprot,
    color_hex: colorHex,
    tmh: coerceBoolean(payload.tmh, false),
  }
}

async function fetchCatalogState(env) {
  if (!env.ICONOPLASM_DB) return { gene_count: 0, content_hash: "" }
  const { results } = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, full_name, uniprot, color_hex, tmh
       FROM icono_gene_catalog
      ORDER BY gene_symbol ASC`,
  ).all()
  const rows = Array.isArray(results) ? results : []
  return {
    gene_count: rows.length,
    content_hash: await hashCatalogItems(rows),
  }
}

async function fetchEssenceStateRows(env, requestedSymbols = null) {
  if (!env.ICONOPLASM_DB) return []
  const wantedSymbols = Array.isArray(requestedSymbols)
    ? requestedSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)
    : []
  let results = []
  if (wantedSymbols.length && wantedSymbols.length <= 1000) {
    const placeholders = wantedSymbols.map(() => "?").join(", ")
    const stmt = env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol, full_name, weight_kg, height_cm, sex, age, age_years, faction,
              skin_hex, skin_name, tissue_tau, loeuf, constraint_percentile,
              aesthetics_json, aesthetics_origin_json, politics_origin_json,
              family_surname, family_members, family_feature, manifestation, updated_at
         FROM icono_gene_essence
        WHERE upper(gene_symbol) IN (${placeholders})
        ORDER BY gene_symbol ASC`,
    ).bind(...wantedSymbols)
    const response = await stmt.all()
    results = Array.isArray(response?.results) ? response.results : []
  } else {
    const response = await env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol, full_name, weight_kg, height_cm, sex, age, age_years, faction,
              skin_hex, skin_name, tissue_tau, loeuf, constraint_percentile,
              aesthetics_json, aesthetics_origin_json, politics_origin_json,
              family_surname, family_members, family_feature, manifestation, updated_at
         FROM icono_gene_essence
        ORDER BY gene_symbol ASC`,
    ).all()
    results = Array.isArray(response?.results) ? response.results : []
  }

  const out = []
  for (const row of results) {
    const rawEssence = {
      gene_symbol: row?.gene_symbol || "",
      full_name: row?.full_name || "",
      weight_kg: row?.weight_kg,
      height_cm: row?.height_cm,
      sex: row?.sex || "",
      age: row?.age || "",
      age_years: row?.age_years,
      faction: row?.faction || "",
      skin_hex: row?.skin_hex || "",
      skin_name: row?.skin_name || "",
      aesthetics: (() => {
        try {
          const parsed = JSON.parse(String(row?.aesthetics_json || "[]"))
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      aesthetics_origin: (() => {
        try {
          const parsed = JSON.parse(String(row?.aesthetics_origin_json || "[]"))
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      politics_origin: (() => {
        try {
          const parsed = JSON.parse(String(row?.politics_origin_json || "[]"))
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })(),
      family_surname: row?.family_surname || "",
      family_members: row?.family_members,
      family_feature: row?.family_feature || "",
      manifestation: row?.manifestation || "",
    }
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol) continue
    out.push({
      symbol,
      hash: await hashEssencePayload(rawEssence, symbol),
      updated_at: row?.updated_at ? String(row.updated_at) : null,
    })
  }
  return out
}

async function fetchCatalogRow(env, symbol) {
  if (!env.ICONOPLASM_DB || !symbol) return null
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol, full_name, uniprot, color_hex, tmh, updated_at
       FROM icono_gene_catalog
       WHERE upper(gene_symbol) = ?
       LIMIT 1`,
    )
      .bind(symbol)
      .first()
    if (!row?.gene_symbol) return null
    return {
      gene_symbol: normalizeSymbol(row.gene_symbol),
      full_name: sanitizeText(row.full_name, 255),
      uniprot: normalizeUniprot(row.uniprot || null),
      color_hex: normalizeHexColor(row.color_hex || null),
      tmh: coerceBoolean(row.tmh, false),
      updated_at: row?.updated_at ? String(row.updated_at) : null,
    }
  } catch {
    return null
  }
}

async function resolveGene(env, rawId) {
  const symbol = normalizeSymbol(rawId)
  if (!symbol) return null
  const catalog = await fetchCatalogRow(env, symbol)
  if (!catalog) return null

  let protein = null
  if (catalog.uniprot && env.DB) {
    try {
      protein = await fetchProteinByUniprot(env.DB, catalog.uniprot)
    } catch {}
  }

  return {
    symbol,
    catalog,
    protein,
    mode: "catalog",
  }
}

async function portraitState(env, symbol, base) {
  if (!env.ICONOPLASM_DB)
    return {
      status: "missing",
      hero_url: null,
      medium_url: null,
      thumb_url: null,
      asset_sha256: null,
      candidate_image_id: null,
      artist_id: null,
    }
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT ps.current_asset_sha256 AS asset_sha256, pa.r2_key_full, pa.r2_key_medium, pa.r2_key_thumb, pa.vision_id, pa.candidate_image_id, pa.artist_id
         FROM icono_publish_state ps
         LEFT JOIN icono_portrait_assets pa
           ON upper(pa.gene_symbol) = upper(ps.gene_symbol)
          AND pa.asset_sha256 = ps.current_asset_sha256
         WHERE upper(ps.gene_symbol) = ?
         LIMIT 1`,
    )
      .bind(symbol)
      .first()
    if (!row?.asset_sha256)
      return {
        status: "missing",
        hero_url: null,
        medium_url: null,
        thumb_url: null,
        asset_sha256: null,
        candidate_image_id: null,
        artist_id: null,
      }
    return {
      status: "published",
      hero_url: row.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      medium_url: row.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      thumb_url: row.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
      asset_sha256: row.asset_sha256,
      candidate_image_id: optionalInt(row?.candidate_image_id),
      vision_id: String(row?.vision_id || "").trim() || null,
      // Public cards and gene pages should show the same one-number-per-artist
      // emulsion ID as admin. candidate_image_id is per image, so derive from the
      // resolved artist lineage when no persisted artist_id is present.
      artist_id: publicArtistIdForRow(row) || null,
    }
  } catch {
    return {
      status: "unavailable",
      hero_url: null,
      medium_url: null,
      thumb_url: null,
      asset_sha256: null,
      candidate_image_id: null,
      artist_id: null,
    }
  }
}

async function essenceState(env, symbol) {
  if (!env.ICONOPLASM_DB) return { exists: false, essence: {} }
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT
           full_name,
           weight_kg,
           height_cm,
           sex,
           age,
           age_years,
           faction,
           skin_hex,
           skin_name,
           tissue_tau,
           loeuf,
           constraint_percentile,
           aesthetics_json,
           aesthetics_origin_json,
           politics_origin_json,
           family_surname,
           family_members,
           family_feature,
           manifestation,
           updated_at
         FROM icono_gene_essence
         WHERE upper(gene_symbol) = ?
         LIMIT 1`,
    )
      .bind(symbol)
      .first()
    if (!row) return { exists: false, essence: {} }
    let aesthetics = []
    let aestheticsOrigin = []
    let politicsOrigin = []
    try {
      const parsed = JSON.parse(String(row?.aesthetics_json || "[]"))
      if (Array.isArray(parsed))
        aesthetics = parsed.map((v) => String(v || "").trim()).filter(Boolean)
    } catch {}
    try {
      const parsed = JSON.parse(String(row?.aesthetics_origin_json || "[]"))
      if (Array.isArray(parsed))
        aestheticsOrigin = parsed.map((v) => String(v || "").trim()).filter(Boolean)
    } catch {}
    try {
      const parsed = JSON.parse(String(row?.politics_origin_json || "[]"))
      if (Array.isArray(parsed))
        politicsOrigin = parsed.map((v) => String(v || "").trim()).filter(Boolean)
    } catch {}
    const essence = {
      ...(row?.weight_kg != null ? { weight_kg: Number(row.weight_kg) } : {}),
      ...(row?.height_cm != null ? { height_cm: Number(row.height_cm) } : {}),
      ...(row?.sex ? { sex: String(row.sex) } : {}),
      ...(row?.age ? { age: String(row.age) } : {}),
      ...(row?.age_years != null ? { age_years: Number(row.age_years) } : {}),
      ...(row?.faction ? { faction: String(row.faction), politics: String(row.faction) } : {}),
      ...(row?.skin_hex ? { skin_hex: String(row.skin_hex) } : {}),
      ...(row?.skin_name ? { skin_name: String(row.skin_name) } : {}),
      ...(row?.tissue_tau != null ? { tissue_tau: Number(row.tissue_tau) } : {}),
      ...(row?.loeuf != null ? { loeuf: Number(row.loeuf) } : {}),
      ...(row?.constraint_percentile != null
        ? { constraint_percentile: Number(row.constraint_percentile) }
        : {}),
      ...(aesthetics.length ? { aesthetics } : {}),
      ...(aestheticsOrigin.length ? { aesthetics_origin: aestheticsOrigin } : {}),
      ...(politicsOrigin.length ? { politics_origin: politicsOrigin } : {}),
      ...(row?.family_surname ? { family_surname: String(row.family_surname) } : {}),
      ...(row?.family_members != null ? { family_members: Number(row.family_members) } : {}),
      ...(row?.family_feature ? { family_feature: String(row.family_feature) } : {}),
      ...(row?.updated_at ? { updated_at: String(row.updated_at) } : {}),
      ...(row?.full_name ? { name: String(row.full_name) } : {}),
    }
    return {
      exists: true,
      essence,
      full_name: row?.full_name ? String(row.full_name) : null,
      manifestation: row?.manifestation ? String(row.manifestation) : null,
    }
  } catch {
    return { exists: false, essence: {} }
  }
}

function sourceLinks(symbol, uniprot) {
  const sym = encodeURIComponent(symbol)
  return {
    ...(uniprot
      ? { uniprot: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(uniprot)}` }
      : {}),
    ncbi: `https://www.ncbi.nlm.nih.gov/gene/?term=${sym}%5BGene%20Name%5D+AND+human%5BOrganism%5D`,
    ensembl: `https://www.ensembl.org/Homo_sapiens/Search/Results?q=${sym}`,
  }
}

function sexOriginFromProtein(protein) {
  if (!protein || typeof protein !== "object" || typeof protein.tmh !== "boolean") return []
  return [protein.tmh ? "Transmembrane" : "Soluble"]
}

function sexFromProtein(protein) {
  if (!protein || typeof protein !== "object" || typeof protein.tmh !== "boolean") return null
  return protein.tmh ? "Male" : "Female"
}

async function geneRecord(env, url, rawId) {
  const r = await resolveGene(env, rawId)
  if (!r?.symbol) return null
  const base = portraitBase(url, env)
  const portrait = await portraitState(env, r.symbol, base)
  const portraitCandidates = await portraitCandidatesForGene(
    env,
    url,
    r.symbol,
    portrait?.asset_sha256 || null,
  )
  const syncedEssenceState = await essenceState(env, r.symbol)
  const syncedEssence =
    syncedEssenceState?.essence && typeof syncedEssenceState.essence === "object"
      ? syncedEssenceState.essence
      : {}
  const proteinDemo =
    r?.protein?.demographics && typeof r.protein.demographics === "object"
      ? r.protein.demographics
      : {}
  const syncedAesthetics = normalizeTextList(syncedEssence?.aesthetics)
  const syncedPolitics = sanitizeText(syncedEssence?.politics || syncedEssence?.faction, 64)
  const syncedAestheticsOrigin = normalizeTextList(syncedEssence?.aesthetics_origin)
  const syncedPoliticsOrigin = normalizeTextList(syncedEssence?.politics_origin)
  const syncedSexOrigin = normalizeTextList(
    syncedEssence?.sex_origin || syncedEssence?.gender_origin,
    {
      maxItems: 2,
    },
  )
  const liveAesthetics = normalizeTextList(proteinDemo?.aesthetics)
  const livePolitics = sanitizeText(proteinDemo?.politics || syncedPolitics, 64)
  const liveAestheticsOrigin = normalizeTextList(r?.protein?.clans)
  const livePoliticsOrigin = normalizeTextList(r?.protein?.alignment ? [r.protein.alignment] : [])
  const liveSex =
    typeof r?.catalog?.tmh === "boolean"
      ? r.catalog.tmh
        ? "Male"
        : "Female"
      : sexFromProtein(r?.protein)
  const liveSexOrigin =
    typeof r?.catalog?.tmh === "boolean"
      ? [r.catalog.tmh ? "Transmembrane" : "Soluble"]
      : sexOriginFromProtein(r?.protein)
  const identityFullName =
    sanitizeText(r?.catalog?.full_name, 255) ||
    (r?.protein?.full_name && String(r.protein.full_name).trim()) ||
    r.symbol
  const tooltipEssence = {
    ...syncedEssence,
    ...(identityFullName ? { name: identityFullName } : {}),
    ...(liveSex ? { sex: liveSex } : {}),
    ...((syncedAesthetics.length ? syncedAesthetics : liveAesthetics).length
      ? { aesthetics: syncedAesthetics.length ? syncedAesthetics : liveAesthetics }
      : {}),
    ...(livePolitics ? { politics: livePolitics, faction: livePolitics } : {}),
    ...((syncedAestheticsOrigin.length ? syncedAestheticsOrigin : liveAestheticsOrigin).length
      ? {
          aesthetics_origin: syncedAestheticsOrigin.length
            ? syncedAestheticsOrigin
            : liveAestheticsOrigin,
        }
      : {}),
    ...((syncedPoliticsOrigin.length ? syncedPoliticsOrigin : livePoliticsOrigin).length
      ? {
          politics_origin: syncedPoliticsOrigin.length ? syncedPoliticsOrigin : livePoliticsOrigin,
        }
      : {}),
    ...((syncedSexOrigin.length ? syncedSexOrigin : liveSexOrigin).length
      ? {
          sex_origin: syncedSexOrigin.length ? syncedSexOrigin : liveSexOrigin,
        }
      : {}),
  }
  const uniprot = normalizeUniprot(r?.catalog?.uniprot || r?.protein?.uniprot || null)
  const fullName = sanitizeText(r?.catalog?.full_name, 255) || identityFullName
  const weightKgValue = Number(tooltipEssence?.weight_kg)
  const weightKg = Number.isFinite(weightKgValue) && weightKgValue > 0 ? weightKgValue : null
  const proteinLengthAa = optionalInt(r?.protein?.length)
  const massDa = Number(r?.protein?.mass)
  const molecularWeightKda =
    Number.isFinite(massDa) && massDa > 0 ? Math.round((massDa / 1000) * 10) / 10 : null
  const firstPublicationYear = optionalInt(r?.protein?.first_pub_year)
  const tissueTau =
    optionalFloat(r?.protein?.tissue?.score, { min: 0 }) ??
    optionalFloat(syncedEssence?.tissue_tau, { min: 0 })
  const loeuf =
    optionalFloat(r?.protein?.loeuf, { min: 0 }) ?? optionalFloat(syncedEssence?.loeuf, { min: 0 })
  const constraintPercentile =
    optionalFloat(r?.protein?.constraint_percentile, { min: 0 }) ??
    optionalFloat(syncedEssence?.constraint_percentile, { min: 0 })
  const primaryTissue =
    r?.protein?.tissue?.label && String(r.protein.tissue.label).trim()
      ? String(r.protein.tissue.label).trim()
      : null
  return {
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    canonical_symbol: r.symbol,
    symbol: r.symbol,
    full_name: fullName,
    color: r?.catalog?.color_hex || null,
    ...(uniprot ? { uniprot } : {}),
    ...(weightKg != null ? { weight_kg: weightKg } : {}),
    ...(proteinLengthAa != null ? { protein_length_aa: proteinLengthAa } : {}),
    ...(molecularWeightKda != null ? { molecular_weight_kda: molecularWeightKda } : {}),
    ...(firstPublicationYear != null ? { first_publication_year: firstPublicationYear } : {}),
    ...(tissueTau != null ? { tissue_tau: tissueTau } : {}),
    ...(loeuf != null ? { loeuf } : {}),
    ...(constraintPercentile != null ? { constraint_percentile: constraintPercentile } : {}),
    ...(primaryTissue ? { primary_tissue: primaryTissue } : {}),
    popularity_score: wikiPageviewsForSymbol(r.symbol),
    essence: tooltipEssence,
    ...(syncedEssenceState?.manifestation
      ? { manifestation: syncedEssenceState.manifestation }
      : {}),
    portrait,
    portrait_candidates: portraitCandidates,
    source_links: sourceLinks(r.symbol, uniprot),
    page_url: `${url.origin}/gene/${encodeURIComponent(r.symbol)}`,
    resolved_from: r.mode,
  }
}

async function etagFor(obj) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(obj)),
  )
  const b = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
  return `"${b.slice(0, 24)}"`
}

async function actor(request, env) {
  if (!env.GAME_SESSIONS) return "unknown"
  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "")
    if (!cookies.session) return "unknown"
    const id = env.GAME_SESSIONS.idFromName(`session:${cookies.session}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    if (!resp.ok) return "unknown"
    const s = await resp.json()
    return s?.username || s?.user_id || "unknown"
  } catch {
    return "unknown"
  }
}

async function iconoplasmSessionUser(request, env) {
  if (!env.GAME_SESSIONS) return null
  try {
    const cookies = parseCookies(request.headers.get("Cookie") || "")
    const sessionId = String(cookies.session || "").trim()
    if (!sessionId) return null
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    if (!resp.ok) return null
    const session = await resp.json()
    const userId = String(session?.user_id || "").trim()
    if (!userId) return null
    return {
      user_id: userId,
      username: String(session?.username || "").trim() || null,
    }
  } catch {
    return null
  }
}

async function iconoVoteSnapshot(env, { candidateRef, symbol, assetSha256, visionId, userId }) {
  if (!env.ICONOPLASM_DB) {
    return {
      image_upvotes: 0,
      image_downvotes: 0,
      image_score: 0,
      user_vote: 0,
      vision_upvotes: 0,
      vision_downvotes: 0,
      vision_score: 0,
      candidate_ref: String(candidateRef || ""),
      vision_id: String(visionId || ""),
    }
  }

  const symbolNorm = normalizeSymbol(symbol)
  const assetShaNorm = normalizeSha256(assetSha256)
  const candidateRefNorm = normalizeCandidateRef(candidateRef, symbolNorm, assetShaNorm)
  const visionNorm = sanitizeVoteVisionId(visionId)
  const userNorm = normalizeUserId(userId)
  if (!candidateRefNorm) {
    return {
      image_upvotes: 0,
      image_downvotes: 0,
      image_score: 0,
      user_vote: 0,
      vision_upvotes: 0,
      vision_downvotes: 0,
      vision_score: 0,
      candidate_ref: "",
      vision_id: visionNorm,
    }
  }

  const imageAgg = await env.ICONOPLASM_DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
       COALESCE(SUM(vote_value), 0) AS score
     FROM icono_image_votes
     WHERE candidate_ref = ?`,
  )
    .bind(candidateRefNorm)
    .first()

  const userVoteRow = await env.ICONOPLASM_DB.prepare(
    `SELECT vote_value
     FROM icono_image_votes
     WHERE candidate_ref = ?
       AND user_id = ?
     LIMIT 1`,
  )
    .bind(candidateRefNorm, userNorm)
    .first()

  let visionAgg = null
  if (visionNorm) {
    visionAgg = await env.ICONOPLASM_DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
         COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
         COALESCE(SUM(vote_value), 0) AS score
       FROM icono_image_votes
       WHERE vision_id = ?`,
    )
      .bind(visionNorm)
      .first()
  }

  return {
    image_upvotes: Number(imageAgg?.upvotes || 0),
    image_downvotes: Number(imageAgg?.downvotes || 0),
    image_score: Number(imageAgg?.score || 0),
    user_vote: Number(userVoteRow?.vote_value || 0),
    vision_upvotes: Number(visionAgg?.upvotes || 0),
    vision_downvotes: Number(visionAgg?.downvotes || 0),
    vision_score: Number(visionAgg?.score || 0),
    candidate_ref: candidateRefNorm,
    vision_id: visionNorm,
  }
}

async function iconoVoteSnapshotsBatch(env, { items, userId }) {
  const normalizedItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item === "object")
    : []
  const userNorm = normalizeUserId(userId)
  if (!env.ICONOPLASM_DB || !normalizedItems.length) return []

  const snapshots = []
  const chunkSize = 5000
  for (let start = 0; start < normalizedItems.length; start += chunkSize) {
    const chunk = normalizedItems.slice(start, start + chunkSize)
    try {
      const chunkJson = JSON.stringify(
        chunk.map((item) => ({
          candidate_ref: String(item?.candidate_ref || "").trim(),
          symbol: normalizeSymbol(item?.symbol || ""),
          asset_sha256: normalizeSha256(item?.asset_sha256 || ""),
          vision_id: sanitizeVoteVisionId(item?.vision_id || ""),
        })),
      )
      const resp = await env.ICONOPLASM_DB.prepare(
        `WITH input AS (
           SELECT
             CAST(json_each.key AS INTEGER) AS idx,
             json_extract(json_each.value, '$.candidate_ref') AS candidate_ref,
             json_extract(json_each.value, '$.symbol') AS symbol,
             json_extract(json_each.value, '$.asset_sha256') AS asset_sha256,
             json_extract(json_each.value, '$.vision_id') AS vision_id
           FROM json_each(?)
         ),
         image_agg AS (
           SELECT
             iv.candidate_ref,
             COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(SUM(iv.vote_value), 0) AS score
           FROM icono_image_votes iv
           WHERE iv.candidate_ref IN (SELECT candidate_ref FROM input)
           GROUP BY iv.candidate_ref
         ),
         user_votes AS (
           SELECT iv.candidate_ref, iv.vote_value
           FROM icono_image_votes iv
           WHERE iv.user_id = ?
             AND iv.candidate_ref IN (SELECT candidate_ref FROM input)
         ),
         vision_agg AS (
           SELECT
             iv.vision_id,
             COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(SUM(iv.vote_value), 0) AS score
           FROM icono_image_votes iv
           WHERE COALESCE(iv.vision_id, '') <> ''
             AND iv.vision_id IN (SELECT DISTINCT vision_id FROM input WHERE COALESCE(vision_id, '') <> '')
           GROUP BY iv.vision_id
         )
         SELECT
           input.idx,
           input.candidate_ref,
           input.symbol,
           input.asset_sha256,
           input.vision_id,
           COALESCE(image_agg.upvotes, 0) AS image_upvotes,
           COALESCE(image_agg.downvotes, 0) AS image_downvotes,
           COALESCE(image_agg.score, 0) AS image_score,
           COALESCE(user_votes.vote_value, 0) AS user_vote,
           COALESCE(vision_agg.upvotes, 0) AS vision_upvotes,
           COALESCE(vision_agg.downvotes, 0) AS vision_downvotes,
           COALESCE(vision_agg.score, 0) AS vision_score
         FROM input
         LEFT JOIN image_agg
           ON image_agg.candidate_ref = input.candidate_ref
         LEFT JOIN user_votes
           ON user_votes.candidate_ref = input.candidate_ref
         LEFT JOIN vision_agg
           ON vision_agg.vision_id = input.vision_id
         ORDER BY input.idx ASC`,
      )
        .bind(chunkJson, userNorm)
        .all()
      for (const row of Array.isArray(resp?.results) ? resp.results : []) {
        const candidateRef = String(row?.candidate_ref || "").trim()
        const visionId = sanitizeVoteVisionId(row?.vision_id || "")
        snapshots.push({
          candidate_ref: candidateRef,
          symbol: normalizeSymbol(row?.symbol || ""),
          asset_sha256: normalizeSha256(row?.asset_sha256 || ""),
          vision_id: visionId,
          snapshot: {
            image_upvotes: Number(row?.image_upvotes || 0),
            image_downvotes: Number(row?.image_downvotes || 0),
            image_score: Number(row?.image_score || 0),
            user_vote: Number(row?.user_vote || 0),
            vision_upvotes: Number(row?.vision_upvotes || 0),
            vision_downvotes: Number(row?.vision_downvotes || 0),
            vision_score: Number(row?.vision_score || 0),
            candidate_ref: candidateRef,
            vision_id: visionId,
          },
        })
      }
    } catch (error) {
      const candidateRefs = chunk
        .map((item) => String(item.candidate_ref || "").trim())
        .filter(Boolean)
      const visionIds = [
        ...new Set(chunk.map((item) => sanitizeVoteVisionId(item.vision_id || "")).filter(Boolean)),
      ]
      const imageAggByRef = new Map()
      const userVoteByRef = new Map()
      const visionAggById = new Map()
      const imageAggPromise = candidateRefs.length
        ? env.ICONOPLASM_DB.prepare(
            `SELECT
               candidate_ref,
               COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
               COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
               COALESCE(SUM(vote_value), 0) AS score
             FROM icono_image_votes
             WHERE candidate_ref IN (${candidateRefs.map(() => "?").join(",")})
             GROUP BY candidate_ref`,
          )
            .bind(...candidateRefs)
            .all()
        : Promise.resolve({ results: [] })
      const userVotePromise = candidateRefs.length
        ? env.ICONOPLASM_DB.prepare(
            `SELECT candidate_ref, vote_value
             FROM icono_image_votes
             WHERE user_id = ?
               AND candidate_ref IN (${candidateRefs.map(() => "?").join(",")})`,
          )
            .bind(userNorm, ...candidateRefs)
            .all()
        : Promise.resolve({ results: [] })
      const visionAggPromise = visionIds.length
        ? env.ICONOPLASM_DB.prepare(
            `SELECT
               vision_id,
               COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
               COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
               COALESCE(SUM(vote_value), 0) AS score
             FROM icono_image_votes
             WHERE vision_id IN (${visionIds.map(() => "?").join(",")})
             GROUP BY vision_id`,
          )
            .bind(...visionIds)
            .all()
        : Promise.resolve({ results: [] })
      const [imageAggRows, userVoteRows, visionAggRows] = await Promise.all([
        imageAggPromise,
        userVotePromise,
        visionAggPromise,
      ])
      for (const row of Array.isArray(imageAggRows?.results) ? imageAggRows.results : []) {
        const candidateRef = String(row?.candidate_ref || "").trim()
        if (!candidateRef) continue
        imageAggByRef.set(candidateRef, {
          upvotes: Number(row?.upvotes || 0),
          downvotes: Number(row?.downvotes || 0),
          score: Number(row?.score || 0),
        })
      }
      for (const row of Array.isArray(userVoteRows?.results) ? userVoteRows.results : []) {
        const candidateRef = String(row?.candidate_ref || "").trim()
        if (!candidateRef || userVoteByRef.has(candidateRef)) continue
        userVoteByRef.set(candidateRef, Number(row?.vote_value || 0))
      }
      for (const row of Array.isArray(visionAggRows?.results) ? visionAggRows.results : []) {
        const visionId = sanitizeVoteVisionId(row?.vision_id || "")
        if (!visionId) continue
        visionAggById.set(visionId, {
          upvotes: Number(row?.upvotes || 0),
          downvotes: Number(row?.downvotes || 0),
          score: Number(row?.score || 0),
        })
      }
      for (const item of chunk) {
        const candidateRef = String(item?.candidate_ref || "").trim()
        const visionId = sanitizeVoteVisionId(item?.vision_id || "")
        const imageAgg = imageAggByRef.get(candidateRef) || { upvotes: 0, downvotes: 0, score: 0 }
        const visionAgg = visionAggById.get(visionId) || { upvotes: 0, downvotes: 0, score: 0 }
        snapshots.push({
          candidate_ref: candidateRef,
          symbol: normalizeSymbol(item?.symbol || ""),
          asset_sha256: normalizeSha256(item?.asset_sha256 || ""),
          vision_id: visionId,
          snapshot: {
            image_upvotes: Number(imageAgg.upvotes || 0),
            image_downvotes: Number(imageAgg.downvotes || 0),
            image_score: Number(imageAgg.score || 0),
            user_vote: Number(userVoteByRef.get(candidateRef) || 0),
            vision_upvotes: Number(visionAgg.upvotes || 0),
            vision_downvotes: Number(visionAgg.downvotes || 0),
            vision_score: Number(visionAgg.score || 0),
            candidate_ref: candidateRef,
            vision_id: visionId,
          },
        })
      }
    }
  }

  return snapshots
}

async function autoPromoteTopVotedPortrait(env, { symbol, actorId, reason } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  if (!symbolNorm) return { ok: false, changed: false, code: "BAD_SYMBOL" }

  const currentRow = await env.ICONOPLASM_DB.prepare(
    `SELECT current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
     FROM icono_publish_state
     WHERE upper(gene_symbol) = ?
     LIMIT 1`,
  )
    .bind(symbolNorm)
    .first()
  const currentAssetSha = normalizeSha256(currentRow?.current_asset_sha256 || "")
  const adminOverride = Number(currentRow?.admin_override || 0) > 0
  if (adminOverride) {
    return {
      ok: true,
      changed: false,
      code: "ADMIN_OVERRIDE",
      current_asset_sha256: currentAssetSha || null,
    }
  }

  const topRow = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
       COALESCE(pa.is_legacy, 0) AS is_legacy,
       COALESCE(v.upvotes, 0) AS image_upvotes,
       COALESCE(v.downvotes, 0) AS image_downvotes,
       COALESCE(v.score, 0) AS image_score,
       pa.created_at,
       CASE
         WHEN lower(pa.asset_sha256) = ? THEN 1
         ELSE 0
       END AS is_current
     FROM icono_portrait_assets pa
     LEFT JOIN (
       SELECT
         candidate_ref,
         SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
         SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
         SUM(vote_value) AS score
       FROM icono_image_votes
       GROUP BY candidate_ref
     ) v
       ON v.candidate_ref = ('a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256))
     WHERE upper(pa.gene_symbol) = ?
       AND COALESCE(pa.autopick_eligible, 1) = 1
       AND COALESCE(pa.status, '') <> 'rejected'
       AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
     ORDER BY
       COALESCE(v.score, 0) DESC,
       CASE
         WHEN COALESCE(pa.is_legacy, 0) = 0 THEN 1
         ELSE 0
       END DESC,
       COALESCE(v.upvotes, 0) DESC,
       CASE
         WHEN lower(pa.asset_sha256) = ? THEN 1
         ELSE 0
       END DESC,
       pa.created_at DESC,
       lower(pa.asset_sha256) ASC
     LIMIT 1`,
  )
    .bind(currentAssetSha || "", symbolNorm, currentAssetSha || "")
    .first()

  const topAssetSha = normalizeSha256(topRow?.asset_sha256 || "")
  if (!topAssetSha) return { ok: true, changed: false, code: "NO_CANDIDATE" }
  if (currentAssetSha && topAssetSha === currentAssetSha) {
    return { ok: true, changed: false, code: "UNCHANGED", current_asset_sha256: currentAssetSha }
  }

  const actorNorm = normalizeUserId(actorId || "vote_auto")
  const eventReason = String(reason || "vote_auto_promote").slice(0, 2000) || "vote_auto_promote"

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       current_asset_sha256 = excluded.current_asset_sha256,
       admin_override = 0,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(symbolNorm, topAssetSha, actorNorm)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_portrait_assets
     SET status = 'approved'
     WHERE upper(gene_symbol) = ?
       AND lower(asset_sha256) = ?`,
  )
    .bind(symbolNorm, topAssetSha)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_events (
       gene_symbol,
       from_asset_sha256,
       to_asset_sha256,
       action,
       actor,
       reason,
       created_at
     ) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(symbolNorm, currentAssetSha || null, topAssetSha, actorNorm, eventReason)
    .run()

  return {
    ok: true,
    changed: true,
    code: "PROMOTED",
    from_asset_sha256: currentAssetSha || null,
    to_asset_sha256: topAssetSha,
    image_score: topScore,
    image_upvotes: topUpvotes,
    image_downvotes: topDownvotes,
  }
}

async function getArtistStyleBlacklistRow(env, artistTag) {
  if (!env.ICONOPLASM_DB) return null
  const artistTagNorm = normalizeArtistTag(artistTag)
  if (!artistTagNorm) return null
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT artist_tag, artist_name, reason, created_by, created_at, updated_at
       FROM icono_artist_style_blacklist
       WHERE lower(artist_tag) = ?
       LIMIT 1`,
    )
      .bind(artistTagNorm)
      .first()
    return row || null
  } catch {
    return null
  }
}

async function iconoExistingAssetsBatch(env, rawItems) {
  const out = new Map()
  if (!env.ICONOPLASM_DB || !Array.isArray(rawItems) || rawItems.length <= 0) return out
  const lookupRows = rawItems
    .map((item) => ({
      symbol: normalizeSymbol(item?.symbol || item?.gene_symbol || ""),
      asset_sha256: normalizeSha256(item?.asset_sha256 || item?.sha256 || ""),
    }))
    .filter((row) => row.symbol && row.asset_sha256)
  if (lookupRows.length <= 0) return out
  try {
    const { results } = await env.ICONOPLASM_DB.prepare(
      `WITH incoming AS (
         SELECT
           upper(json_extract(value, '$.symbol')) AS symbol,
           lower(json_extract(value, '$.asset_sha256')) AS asset_sha256
         FROM json_each(?)
       )
       SELECT
         upper(pa.gene_symbol) AS symbol,
         lower(pa.asset_sha256) AS asset_sha256,
         pa.status,
         pa.autopick_eligible,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         pa.vision_id,
         pa.artist_tag,
         pa.artist_name
       FROM icono_portrait_assets pa
       JOIN incoming i
         ON upper(pa.gene_symbol) = i.symbol
        AND lower(pa.asset_sha256) = i.asset_sha256`,
    )
      .bind(JSON.stringify(lookupRows))
      .all()
    for (const row of results || []) {
      const symbol = normalizeSymbol(row?.symbol || "")
      const assetSha = normalizeSha256(row?.asset_sha256 || "")
      if (!symbol || !assetSha) continue
      out.set(`${symbol}|${assetSha}`, row)
    }
  } catch {}
  return out
}

async function iconoPublishStateBatch(env, rawSymbols) {
  const out = new Map()
  if (!env.ICONOPLASM_DB || !Array.isArray(rawSymbols) || rawSymbols.length <= 0) return out
  const symbols = Array.from(
    new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  if (symbols.length <= 0) return out
  try {
    const { results } = await env.ICONOPLASM_DB.prepare(
      `WITH incoming AS (
         SELECT upper(value) AS symbol
         FROM json_each(?)
       )
       SELECT
         upper(ps.gene_symbol) AS symbol,
         lower(COALESCE(ps.current_asset_sha256, '')) AS current_asset_sha256,
         COALESCE(ps.admin_override, 0) AS admin_override
       FROM icono_publish_state ps
       JOIN incoming i
         ON upper(ps.gene_symbol) = i.symbol`,
    )
      .bind(JSON.stringify(symbols))
      .all()
    for (const row of results || []) {
      const symbol = normalizeSymbol(row?.symbol || "")
      if (!symbol) continue
      out.set(symbol, {
        current_asset_sha256: normalizeSha256(row?.current_asset_sha256 || "") || null,
        admin_override: Number(row?.admin_override || 0) > 0,
      })
    }
  } catch {}
  return out
}

async function iconoBlacklistRowsBatch(env, rawArtistTags) {
  const out = new Map()
  if (!env.ICONOPLASM_DB || !Array.isArray(rawArtistTags) || rawArtistTags.length <= 0) return out
  const artistTags = Array.from(
    new Set(rawArtistTags.map((value) => normalizeArtistTag(value)).filter(Boolean)),
  )
  if (artistTags.length <= 0) return out
  try {
    const { results } = await env.ICONOPLASM_DB.prepare(
      `WITH incoming AS (
         SELECT lower(value) AS artist_tag
         FROM json_each(?)
       )
       SELECT artist_tag, artist_name, reason, created_by, created_at, updated_at
       FROM icono_artist_style_blacklist
       WHERE lower(artist_tag) IN (SELECT artist_tag FROM incoming)`,
    )
      .bind(JSON.stringify(artistTags))
      .all()
    for (const row of results || []) {
      const artistTag = normalizeArtistTag(row?.artist_tag || "")
      if (!artistTag) continue
      out.set(artistTag, row)
    }
  } catch {}
  return out
}

async function searchArtistStyles(env, { query = "", limit = 50 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit || "50"), 10) || 50))
  const queryNorm = String(query || "")
    .trim()
    .toLowerCase()
    .slice(0, 120)
  const like = queryNorm ? `%${queryNorm}%` : ""
  const { results } = await env.ICONOPLASM_DB.prepare(
    `SELECT
       lower(pa.artist_tag) AS artist_tag,
       MAX(NULLIF(pa.artist_name, '')) AS artist_name,
       COUNT(*) AS total_count,
       SUM(CASE WHEN lower(COALESCE(pa.status, '')) <> 'rejected' THEN 1 ELSE 0 END) AS visible_count,
       SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'approved' THEN 1 ELSE 0 END) AS approved_count,
       SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'draft' THEN 1 ELSE 0 END) AS draft_count,
       SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
       SUM(
         CASE
           WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
           ELSE 0
         END
       ) AS live_count,
       MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.created_by, '')) AS blacklist_created_by,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_publish_state ps
       ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
      AND lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256)
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     WHERE COALESCE(pa.artist_tag, '') <> ''
       AND (
         ? = ''
         OR lower(pa.artist_tag) LIKE ?
         OR lower(COALESCE(pa.artist_name, '')) LIKE ?
       )
     GROUP BY lower(pa.artist_tag)
     ORDER BY
       blacklisted DESC,
       live_count DESC,
       visible_count DESC,
       total_count DESC,
       artist_tag ASC
     LIMIT ?`,
  )
    .bind(queryNorm, like, like, cleanedLimit)
    .all()

  return Array.isArray(results)
    ? results.map((row) => ({
        artist_tag: normalizeArtistTag(row?.artist_tag || "") || "",
        artist_name: sanitizeText(row?.artist_name || "", 255) || "",
        total_count: Number(row?.total_count || 0),
        visible_count: Number(row?.visible_count || 0),
        approved_count: Number(row?.approved_count || 0),
        draft_count: Number(row?.draft_count || 0),
        rejected_count: Number(row?.rejected_count || 0),
        live_count: Number(row?.live_count || 0),
        blacklisted: Number(row?.blacklisted || 0) > 0,
        blacklist_reason: sanitizeText(row?.blacklist_reason || "", 2000) || "",
        blacklist_created_by: sanitizeText(row?.blacklist_created_by || "", 255) || "",
        blacklist_updated_at: sanitizeText(row?.blacklist_updated_at || "", 64) || "",
      }))
    : []
}

async function fetchAdminRecentEvents(env, { limit = 40 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedEventLimit = Math.max(
    0,
    Math.min(200, Number.parseInt(String(limit || "40"), 10) || 40),
  )
  if (cleanedEventLimit === 0) return []
  const eventResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       id,
       gene_symbol,
       from_asset_sha256,
       to_asset_sha256,
       action,
       actor,
       reason,
       created_at
     FROM icono_publish_events
     ORDER BY id DESC
     LIMIT ?`,
  )
    .bind(cleanedEventLimit)
    .all()
  return Array.isArray(eventResp?.results) ? eventResp.results : []
}

function assetHasRenderablePortrait(row) {
  return Boolean(String(row?.r2_key_medium || row?.r2_key_thumb || row?.r2_key_full || "").trim())
}

function validAdminRollupVisionId(raw) {
  return sanitizeVoteVisionId(raw || "") || ""
}

function compareAdminLeaderRows(left, right, currentAssetSha = null) {
  return (
    Number(right?.score || 0) - Number(left?.score || 0) ||
    Number(left?.is_legacy || 0) - Number(right?.is_legacy || 0) ||
    Number(right?.upvotes || 0) - Number(left?.upvotes || 0) ||
    Number(normalizeSha256(right?.asset_sha256 || "") === normalizeSha256(currentAssetSha || "")) -
      Number(
        normalizeSha256(left?.asset_sha256 || "") === normalizeSha256(currentAssetSha || ""),
      ) ||
    compareNullableTextDesc(left?.created_at || "", right?.created_at || "") ||
    compareNullableTextAsc(left?.asset_sha256 || "", right?.asset_sha256 || "")
  )
}

async function listAdminReadModelSymbols(env) {
  if (!env.ICONOPLASM_DB) return []
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol FROM icono_gene_catalog
     UNION
     SELECT gene_symbol FROM icono_portrait_assets
     UNION
     SELECT gene_symbol FROM icono_publish_state`,
  ).all()
  return Array.from(
    new Set(
      (Array.isArray(resp?.results) ? resp.results : [])
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter(Boolean),
    ),
  )
}

async function listAdminReadModelSymbolsAfter(env, rawAfterSymbol = "", limit = 0) {
  if (!env.ICONOPLASM_DB) return []
  const afterSymbol = normalizeSymbol(rawAfterSymbol) || ""
  const cleanedLimit = Math.max(
    1,
    Math.min(
      ADMIN_READ_MODEL_SYMBOL_BATCH_MAX,
      Number.parseInt(String(limit || ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT), 10) ||
        ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT,
    ),
  )
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol
     FROM (
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_gene_catalog
       UNION
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_portrait_assets
       UNION
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_publish_state
     ) symbols
     WHERE (? = '' OR gene_symbol > ?)
     ORDER BY gene_symbol ASC
     LIMIT ?`,
  )
    .bind(afterSymbol, afterSymbol, cleanedLimit)
    .all()
  return Array.from(
    new Set(
      (Array.isArray(resp?.results) ? resp.results : [])
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter(Boolean),
    ),
  )
}

async function collectVisionIdsForSymbols(env, rawSymbols) {
  if (!env.ICONOPLASM_DB || !Array.isArray(rawSymbols) || rawSymbols.length <= 0) return []
  const symbols = Array.from(
    new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  if (!symbols.length) return []
  const resp = await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT upper(value) AS gene_symbol
       FROM json_each(?)
     )
     SELECT DISTINCT pa.vision_id
     FROM icono_portrait_assets pa
     JOIN incoming i
       ON upper(pa.gene_symbol) = i.gene_symbol
     WHERE COALESCE(pa.vision_id, '') <> ''
       AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'`,
  )
    .bind(JSON.stringify(symbols))
    .all()
  return Array.from(
    new Set(
      (Array.isArray(resp?.results) ? resp.results : [])
        .map((row) => validAdminRollupVisionId(row?.vision_id || ""))
        .filter(Boolean),
    ),
  )
}

async function listAdminReadModelVisionIdsAfter(env, rawAfterVisionId = "", limit = 0) {
  if (!env.ICONOPLASM_DB) return []
  const afterVisionId = validAdminRollupVisionId(rawAfterVisionId) || ""
  const cleanedLimit = Math.max(
    1,
    Math.min(
      ADMIN_READ_MODEL_VISION_BATCH_MAX,
      Number.parseInt(String(limit || ADMIN_READ_MODEL_VISION_BATCH_DEFAULT), 10) ||
        ADMIN_READ_MODEL_VISION_BATCH_DEFAULT,
    ),
  )
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT DISTINCT vision_id
     FROM icono_portrait_assets
     WHERE COALESCE(vision_id, '') <> ''
       AND lower(COALESCE(vision_id, '')) NOT LIKE 'artist-random-%'
       AND (? = '' OR vision_id > ?)
     ORDER BY vision_id ASC
     LIMIT ?`,
  )
    .bind(afterVisionId, afterVisionId, cleanedLimit)
    .all()
  return Array.from(
    new Set(
      (Array.isArray(resp?.results) ? resp.results : [])
        .map((row) => validAdminRollupVisionId(row?.vision_id || ""))
        .filter(Boolean),
    ),
  )
}

async function rebuildVoteAssetSummaryForSymbols(env, rawSymbols) {
  if (!env.ICONOPLASM_DB || !Array.isArray(rawSymbols) || rawSymbols.length <= 0) return 0
  const symbols = Array.from(
    new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  if (!symbols.length) return 0
  const symbolsJson = JSON.stringify(symbols)

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT upper(value) AS gene_symbol
       FROM json_each(?)
     )
     DELETE FROM icono_vote_asset_summary
     WHERE gene_symbol IN (SELECT gene_symbol FROM incoming)`,
  )
    .bind(symbolsJson)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT upper(value) AS gene_symbol
       FROM json_each(?)
     )
     INSERT INTO icono_vote_asset_summary (
       gene_symbol,
       asset_sha256,
       candidate_ref,
       vision_id,
       candidate_image_id,
       upvotes,
       downvotes,
       score,
       vote_count,
       updated_at
     )
     SELECT
       upper(pa.gene_symbol) AS gene_symbol,
       lower(pa.asset_sha256) AS asset_sha256,
       'a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256) AS candidate_ref,
       COALESCE(MAX(NULLIF(iv.vision_id, '')), MAX(NULLIF(pa.vision_id, '')), '') AS vision_id,
       COALESCE(MAX(iv.candidate_image_id), MAX(pa.candidate_image_id)) AS candidate_image_id,
       COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
       COALESCE(SUM(iv.vote_value), 0) AS score,
       COALESCE(COUNT(iv.user_id), 0) AS vote_count,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     JOIN incoming i
       ON upper(pa.gene_symbol) = i.gene_symbol
     LEFT JOIN icono_image_votes iv
       ON upper(iv.gene_symbol) = upper(pa.gene_symbol)
      AND lower(iv.asset_sha256) = lower(pa.asset_sha256)
     GROUP BY upper(pa.gene_symbol), lower(pa.asset_sha256)`,
  )
    .bind(symbolsJson)
    .run()

  return symbols.length
}

async function rebuildGeneRollupForSymbols(env, rawSymbols) {
  if (!env.ICONOPLASM_DB || !Array.isArray(rawSymbols) || rawSymbols.length <= 0) return 0
  const symbols = Array.from(
    new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  if (!symbols.length) return 0
  const symbolsJson = JSON.stringify(symbols)

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT upper(value) AS gene_symbol
       FROM json_each(?)
     )
     DELETE FROM icono_admin_gene_rollup
     WHERE gene_symbol IN (SELECT gene_symbol FROM incoming)`,
  )
    .bind(symbolsJson)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT upper(value) AS gene_symbol
       FROM json_each(?)
     )
     INSERT INTO icono_admin_gene_rollup (
       gene_symbol,
       full_name,
       manifestation,
       current_asset_sha256,
       current_asset_missing,
       admin_override,
       total_assets,
       candidate_count,
       approved_count,
       rejected_count,
       stale_count,
       legacy_count,
       last_asset_at,
       live_status,
       live_is_stale,
       live_is_legacy,
       live_autopick_eligible,
       live_vision_id,
       live_artist_tag,
       live_artist_name,
       live_upvotes,
       live_downvotes,
       live_score,
       live_created_at,
       live_r2_key_full,
       live_r2_key_medium,
       live_r2_key_thumb,
       leader_asset_sha256,
       leader_vision_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
       leader_r2_key_full,
       leader_r2_key_medium,
       leader_r2_key_thumb,
       updated_at
     )
     WITH publish_info AS (
       SELECT
         i.gene_symbol,
         gc.full_name,
         ge.manifestation,
         lower(COALESCE(ps.current_asset_sha256, '')) AS current_asset_sha256,
         COALESCE(ps.admin_override, 0) AS admin_override
       FROM incoming i
       LEFT JOIN icono_gene_catalog gc
         ON upper(gc.gene_symbol) = i.gene_symbol
       LEFT JOIN icono_gene_essence ge
         ON upper(ge.gene_symbol) = i.gene_symbol
       LEFT JOIN icono_publish_state ps
         ON upper(ps.gene_symbol) = i.gene_symbol
     ),
     asset_base AS (
       SELECT
         upper(pa.gene_symbol) AS gene_symbol,
         lower(pa.asset_sha256) AS asset_sha256,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         lower(COALESCE(pa.status, 'draft')) AS status,
         COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.vision_id, '') AS vision_id,
         COALESCE(pa.artist_tag, '') AS artist_tag,
         COALESCE(pa.artist_name, '') AS artist_name,
         COALESCE(pa.created_at, '') AS created_at,
         COALESCE(vs.upvotes, 0) AS upvotes,
         COALESCE(vs.downvotes, 0) AS downvotes,
         COALESCE(vs.score, 0) AS score
       FROM icono_portrait_assets pa
       JOIN incoming i
         ON upper(pa.gene_symbol) = i.gene_symbol
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = upper(pa.gene_symbol)
        AND vs.asset_sha256 = lower(pa.asset_sha256)
     ),
     asset_counts AS (
       SELECT
         gene_symbol,
         COUNT(*) AS total_assets,
         SUM(
           CASE
             WHEN COALESCE(autopick_eligible, 1) = 1
              AND COALESCE(status, 'draft') <> 'rejected'
              AND COALESCE(r2_key_medium, r2_key_thumb, r2_key_full, '') <> '' THEN 1
             ELSE 0
           END
         ) AS candidate_count,
         SUM(CASE WHEN COALESCE(status, 'draft') = 'approved' THEN 1 ELSE 0 END) AS approved_count,
         SUM(CASE WHEN COALESCE(status, 'draft') = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
         SUM(CASE WHEN COALESCE(is_stale, 0) = 1 THEN 1 ELSE 0 END) AS stale_count,
         SUM(CASE WHEN COALESCE(is_legacy, 0) = 1 THEN 1 ELSE 0 END) AS legacy_count,
         MAX(NULLIF(created_at, '')) AS last_asset_at
       FROM asset_base
       GROUP BY gene_symbol
     ),
     current_asset AS (
       SELECT
         pi.gene_symbol,
         ab.asset_sha256,
         ab.status,
         ab.is_stale,
         ab.is_legacy,
         ab.autopick_eligible,
         ab.vision_id,
         ab.artist_tag,
         ab.artist_name,
         ab.upvotes,
         ab.downvotes,
         ab.score,
         ab.created_at,
         ab.r2_key_full,
         ab.r2_key_medium,
         ab.r2_key_thumb
       FROM publish_info pi
       LEFT JOIN asset_base ab
         ON ab.gene_symbol = pi.gene_symbol
        AND ab.asset_sha256 = pi.current_asset_sha256
     ),
     ranked_candidates AS (
       SELECT
         ab.gene_symbol,
         ab.asset_sha256,
         ab.vision_id,
         ab.artist_tag,
         ab.artist_name,
         ab.upvotes,
         ab.downvotes,
         ab.score,
         ab.created_at,
         ab.r2_key_full,
         ab.r2_key_medium,
         ab.r2_key_thumb,
         ROW_NUMBER() OVER (
           PARTITION BY ab.gene_symbol
           ORDER BY
             COALESCE(ab.score, 0) DESC,
             CASE WHEN COALESCE(ab.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
             COALESCE(ab.upvotes, 0) DESC,
             CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC,
             COALESCE(ab.created_at, '') DESC,
             ab.asset_sha256 ASC
         ) AS row_num
       FROM asset_base ab
       JOIN publish_info pi
         ON pi.gene_symbol = ab.gene_symbol
       WHERE COALESCE(ab.autopick_eligible, 1) = 1
         AND COALESCE(ab.status, 'draft') <> 'rejected'
         AND COALESCE(ab.r2_key_medium, ab.r2_key_thumb, ab.r2_key_full, '') <> ''
     ),
     leader_asset AS (
       SELECT *
       FROM ranked_candidates
       WHERE row_num = 1
     )
     SELECT
       pi.gene_symbol,
       COALESCE(NULLIF(TRIM(pi.full_name), ''), pi.gene_symbol) AS full_name,
       COALESCE(pi.manifestation, '') AS manifestation,
       NULLIF(pi.current_asset_sha256, '') AS current_asset_sha256,
       CASE
         WHEN NULLIF(pi.current_asset_sha256, '') IS NOT NULL
          AND (
            ca.asset_sha256 IS NULL
            OR COALESCE(ca.r2_key_medium, ca.r2_key_thumb, ca.r2_key_full, '') = ''
          ) THEN 1
         ELSE 0
       END AS current_asset_missing,
       COALESCE(pi.admin_override, 0) AS admin_override,
       COALESCE(ac.total_assets, 0) AS total_assets,
       COALESCE(ac.candidate_count, 0) AS candidate_count,
       COALESCE(ac.approved_count, 0) AS approved_count,
       COALESCE(ac.rejected_count, 0) AS rejected_count,
       COALESCE(ac.stale_count, 0) AS stale_count,
       COALESCE(ac.legacy_count, 0) AS legacy_count,
       ac.last_asset_at,
       COALESCE(ca.status, '') AS live_status,
       COALESCE(ca.is_stale, 0) AS live_is_stale,
       COALESCE(ca.is_legacy, 0) AS live_is_legacy,
       COALESCE(ca.autopick_eligible, 0) AS live_autopick_eligible,
       COALESCE(ca.vision_id, '') AS live_vision_id,
       COALESCE(ca.artist_tag, '') AS live_artist_tag,
       COALESCE(ca.artist_name, '') AS live_artist_name,
       COALESCE(ca.upvotes, 0) AS live_upvotes,
       COALESCE(ca.downvotes, 0) AS live_downvotes,
       COALESCE(ca.score, 0) AS live_score,
       COALESCE(ca.created_at, '') AS live_created_at,
       COALESCE(ca.r2_key_full, '') AS live_r2_key_full,
       COALESCE(ca.r2_key_medium, '') AS live_r2_key_medium,
       COALESCE(ca.r2_key_thumb, '') AS live_r2_key_thumb,
       la.asset_sha256 AS leader_asset_sha256,
       COALESCE(la.vision_id, '') AS leader_vision_id,
       COALESCE(la.artist_tag, '') AS leader_artist_tag,
       COALESCE(la.artist_name, '') AS leader_artist_name,
       COALESCE(la.upvotes, 0) AS leader_upvotes,
       COALESCE(la.downvotes, 0) AS leader_downvotes,
       COALESCE(la.score, 0) AS leader_score,
       COALESCE(la.created_at, '') AS leader_created_at,
       COALESCE(la.r2_key_full, '') AS leader_r2_key_full,
       COALESCE(la.r2_key_medium, '') AS leader_r2_key_medium,
       COALESCE(la.r2_key_thumb, '') AS leader_r2_key_thumb,
       CURRENT_TIMESTAMP AS updated_at
     FROM publish_info pi
     LEFT JOIN asset_counts ac
       ON ac.gene_symbol = pi.gene_symbol
     LEFT JOIN current_asset ca
       ON ca.gene_symbol = pi.gene_symbol
     LEFT JOIN leader_asset la
       ON la.gene_symbol = pi.gene_symbol
     WHERE COALESCE(NULLIF(TRIM(pi.full_name), ''), '') <> ''
        OR COALESCE(ac.total_assets, 0) > 0
        OR NULLIF(pi.current_asset_sha256, '') IS NOT NULL`,
  )
    .bind(symbolsJson)
    .run()

  return symbols.length
}

async function rebuildVisionRollupsBatch(env, rawVisionIds) {
  if (!env.ICONOPLASM_DB || !Array.isArray(rawVisionIds) || rawVisionIds.length <= 0) return 0
  const visionIds = Array.from(
    new Set(rawVisionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean)),
  )
  if (!visionIds.length) return 0
  const visionIdsJson = JSON.stringify(visionIds)

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     )
     DELETE FROM icono_admin_vision_rollup
     WHERE vision_id IN (SELECT vision_id FROM incoming)`,
  )
    .bind(visionIdsJson)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     )
     INSERT INTO icono_admin_vision_rollup (
       vision_id,
       artist_tag,
       artist_name,
       image_count,
       avg_vote,
       rejected_count,
       rejection_rate,
       upvotes,
       downvotes,
       score,
       live_count,
       blacklisted,
       blacklist_reason,
       blacklist_updated_at,
       updated_at
     )
     SELECT
       pa.vision_id,
       MAX(NULLIF(pa.artist_tag, '')) AS artist_tag,
       MAX(NULLIF(pa.artist_name, '')) AS artist_name,
       COUNT(*) AS image_count,
       COALESCE(AVG(
         CASE
           WHEN COALESCE(vs.vote_count, 0) > 0 THEN 1.0 * COALESCE(vs.score, 0) / vs.vote_count
           ELSE NULL
         END
       ), 0) AS avg_vote,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS rejection_rate,
       COALESCE(SUM(COALESCE(vs.upvotes, 0)), 0) AS upvotes,
       COALESCE(SUM(COALESCE(vs.downvotes, 0)), 0) AS downvotes,
       COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score,
       COALESCE(SUM(
         CASE
           WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
           ELSE 0
         END
       ), 0) AS live_count,
       MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     JOIN incoming i
       ON pa.vision_id = i.vision_id
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = upper(pa.gene_symbol)
      AND vs.asset_sha256 = lower(pa.asset_sha256)
     LEFT JOIN icono_publish_state ps
       ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     GROUP BY pa.vision_id`,
  )
    .bind(visionIdsJson)
    .run()

  return visionIds.length
}

async function rebuildVoteAssetSummaryForSymbol(env, rawSymbol) {
  if (!env.ICONOPLASM_DB) return 0
  const symbol = normalizeSymbol(rawSymbol)
  if (!symbol) return 0

  const [assetResp, voteResp] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT asset_sha256, vision_id, candidate_image_id
       FROM icono_portrait_assets
       WHERE gene_symbol = ?`,
    )
      .bind(symbol)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT
         asset_sha256,
         MAX(NULLIF(vision_id, '')) AS vision_id,
         MAX(candidate_image_id) AS candidate_image_id,
         SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
         SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
         SUM(vote_value) AS score,
         COUNT(*) AS vote_count
       FROM icono_image_votes
       WHERE gene_symbol = ?
       GROUP BY asset_sha256`,
    )
      .bind(symbol)
      .all(),
  ])

  const voteByAsset = new Map()
  for (const row of Array.isArray(voteResp?.results) ? voteResp.results : []) {
    const assetSha = normalizeSha256(row?.asset_sha256 || "")
    if (!assetSha) continue
    voteByAsset.set(assetSha, {
      vision_id: validAdminRollupVisionId(row?.vision_id || ""),
      candidate_image_id: optionalInt(row?.candidate_image_id),
      upvotes: Number(row?.upvotes || 0),
      downvotes: Number(row?.downvotes || 0),
      score: Number(row?.score || 0),
      vote_count: Number(row?.vote_count || 0),
    })
  }

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_vote_asset_summary WHERE gene_symbol = ?`)
    .bind(symbol)
    .run()

  let written = 0
  for (const row of Array.isArray(assetResp?.results) ? assetResp.results : []) {
    const assetSha = normalizeSha256(row?.asset_sha256 || "")
    if (!assetSha) continue
    const vote = voteByAsset.get(assetSha) || null
    const candidateRef = normalizeCandidateRef("", symbol, assetSha)
    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_vote_asset_summary (
         gene_symbol,
         asset_sha256,
         candidate_ref,
         vision_id,
         candidate_image_id,
         upvotes,
         downvotes,
         score,
         vote_count,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
      .bind(
        symbol,
        assetSha,
        candidateRef,
        validAdminRollupVisionId(vote?.vision_id || row?.vision_id || ""),
        optionalInt(vote?.candidate_image_id ?? row?.candidate_image_id),
        Number(vote?.upvotes || 0),
        Number(vote?.downvotes || 0),
        Number(vote?.score || 0),
        Number(vote?.vote_count || 0),
      )
      .run()
    written += 1
  }
  return written
}

async function rebuildGeneRollupForSymbol(env, rawSymbol) {
  if (!env.ICONOPLASM_DB) return false
  const symbol = normalizeSymbol(rawSymbol)
  if (!symbol) return false

  const info = await env.ICONOPLASM_DB.prepare(
    `SELECT
       ? AS gene_symbol,
       gc.full_name,
       ge.manifestation,
       lower(COALESCE(ps.current_asset_sha256, '')) AS current_asset_sha256,
       COALESCE(ps.admin_override, 0) AS admin_override
     FROM (SELECT 1) seed
     LEFT JOIN icono_gene_catalog gc
       ON gc.gene_symbol = ?
     LEFT JOIN icono_gene_essence ge
       ON ge.gene_symbol = ?
     LEFT JOIN icono_publish_state ps
       ON ps.gene_symbol = ?`,
  )
    .bind(symbol, symbol, symbol, symbol)
    .first()

  const assetResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       lower(COALESCE(pa.status, 'draft')) AS status,
       COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
       COALESCE(pa.is_stale, 0) AS is_stale,
       COALESCE(pa.is_legacy, 0) AS is_legacy,
       pa.vision_id,
       pa.artist_tag,
       pa.artist_name,
       pa.created_at,
       COALESCE(vs.upvotes, 0) AS upvotes,
       COALESCE(vs.downvotes, 0) AS downvotes,
       COALESCE(vs.score, 0) AS score
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE pa.gene_symbol = ?`,
  )
    .bind(symbol)
    .all()

  const assets = (Array.isArray(assetResp?.results) ? assetResp.results : []).map((row) => ({
    asset_sha256: normalizeSha256(row?.asset_sha256 || "") || null,
    r2_key_full: sanitizeText(row?.r2_key_full || "", 512) || "",
    r2_key_medium: sanitizeText(row?.r2_key_medium || "", 512) || "",
    r2_key_thumb: sanitizeText(row?.r2_key_thumb || "", 512) || "",
    status: sanitizeText(row?.status || "", 32) || "draft",
    autopick_eligible: Number(row?.autopick_eligible || 0) > 0,
    is_stale: Number(row?.is_stale || 0) > 0,
    is_legacy: Number(row?.is_legacy || 0) > 0,
    vision_id: validAdminRollupVisionId(row?.vision_id || ""),
    artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
    artist_name: sanitizeText(row?.artist_name || "", 255) || "",
    created_at: sanitizeText(row?.created_at || "", 64) || "",
    upvotes: Number(row?.upvotes || 0),
    downvotes: Number(row?.downvotes || 0),
    score: Number(row?.score || 0),
  }))

  const currentAssetSha = normalizeSha256(info?.current_asset_sha256 || "") || null
  const currentAsset = assets.find((row) => row.asset_sha256 === currentAssetSha) || null
  const currentAssetMissing = Boolean(
    currentAssetSha && (!currentAsset || !assetHasRenderablePortrait(currentAsset)),
  )
  const candidateAssets = assets.filter(
    (row) => row.autopick_eligible && row.status !== "rejected" && assetHasRenderablePortrait(row),
  )
  candidateAssets.sort((left, right) => compareAdminLeaderRows(left, right, currentAssetSha))
  const leaderAsset = candidateAssets[0] || null
  const lastAssetAt =
    assets
      .map((row) => row.created_at)
      .filter(Boolean)
      .sort((left, right) => compareNullableTextDesc(left, right))[0] || null

  const hasCatalogOrAssets = Boolean(
    sanitizeText(info?.full_name || "", 255) || assets.length || currentAssetSha,
  )
  if (!hasCatalogOrAssets) {
    await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_gene_rollup WHERE gene_symbol = ?`)
      .bind(symbol)
      .run()
    return false
  }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_admin_gene_rollup (
       gene_symbol,
       full_name,
       manifestation,
       current_asset_sha256,
       current_asset_missing,
       admin_override,
       total_assets,
       candidate_count,
       approved_count,
       rejected_count,
       stale_count,
       legacy_count,
       last_asset_at,
       live_status,
       live_is_stale,
       live_is_legacy,
       live_autopick_eligible,
       live_vision_id,
       live_artist_tag,
       live_artist_name,
       live_upvotes,
       live_downvotes,
       live_score,
       live_created_at,
       live_r2_key_full,
       live_r2_key_medium,
       live_r2_key_thumb,
       leader_asset_sha256,
       leader_vision_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
       leader_r2_key_full,
       leader_r2_key_medium,
       leader_r2_key_thumb,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       full_name = excluded.full_name,
       manifestation = excluded.manifestation,
       current_asset_sha256 = excluded.current_asset_sha256,
       current_asset_missing = excluded.current_asset_missing,
       admin_override = excluded.admin_override,
       total_assets = excluded.total_assets,
       candidate_count = excluded.candidate_count,
       approved_count = excluded.approved_count,
       rejected_count = excluded.rejected_count,
       stale_count = excluded.stale_count,
       legacy_count = excluded.legacy_count,
       last_asset_at = excluded.last_asset_at,
       live_status = excluded.live_status,
       live_is_stale = excluded.live_is_stale,
       live_is_legacy = excluded.live_is_legacy,
       live_autopick_eligible = excluded.live_autopick_eligible,
       live_vision_id = excluded.live_vision_id,
       live_artist_tag = excluded.live_artist_tag,
       live_artist_name = excluded.live_artist_name,
       live_upvotes = excluded.live_upvotes,
       live_downvotes = excluded.live_downvotes,
       live_score = excluded.live_score,
       live_created_at = excluded.live_created_at,
       live_r2_key_full = excluded.live_r2_key_full,
       live_r2_key_medium = excluded.live_r2_key_medium,
       live_r2_key_thumb = excluded.live_r2_key_thumb,
       leader_asset_sha256 = excluded.leader_asset_sha256,
       leader_vision_id = excluded.leader_vision_id,
       leader_artist_tag = excluded.leader_artist_tag,
       leader_artist_name = excluded.leader_artist_name,
       leader_upvotes = excluded.leader_upvotes,
       leader_downvotes = excluded.leader_downvotes,
       leader_score = excluded.leader_score,
       leader_created_at = excluded.leader_created_at,
       leader_r2_key_full = excluded.leader_r2_key_full,
       leader_r2_key_medium = excluded.leader_r2_key_medium,
       leader_r2_key_thumb = excluded.leader_r2_key_thumb,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      symbol,
      sanitizeText(info?.full_name || "", 255) || symbol,
      sanitizeText(info?.manifestation || "", 4000) || "",
      currentAssetSha,
      currentAssetMissing ? 1 : 0,
      Number(info?.admin_override || 0) > 0 ? 1 : 0,
      assets.length,
      candidateAssets.length,
      assets.filter((row) => row.status === "approved").length,
      assets.filter((row) => row.status === "rejected").length,
      assets.filter((row) => row.is_stale).length,
      assets.filter((row) => row.is_legacy).length,
      lastAssetAt,
      currentAsset?.status || "",
      currentAsset?.is_stale ? 1 : 0,
      currentAsset?.is_legacy ? 1 : 0,
      currentAsset?.autopick_eligible ? 1 : 0,
      currentAsset?.vision_id || "",
      currentAsset?.artist_tag || "",
      currentAsset?.artist_name || "",
      Number(currentAsset?.upvotes || 0),
      Number(currentAsset?.downvotes || 0),
      Number(currentAsset?.score || 0),
      currentAsset?.created_at || "",
      currentAsset?.r2_key_full || "",
      currentAsset?.r2_key_medium || "",
      currentAsset?.r2_key_thumb || "",
      leaderAsset?.asset_sha256 || null,
      leaderAsset?.vision_id || "",
      leaderAsset?.artist_tag || "",
      leaderAsset?.artist_name || "",
      Number(leaderAsset?.upvotes || 0),
      Number(leaderAsset?.downvotes || 0),
      Number(leaderAsset?.score || 0),
      leaderAsset?.created_at || "",
      leaderAsset?.r2_key_full || "",
      leaderAsset?.r2_key_medium || "",
      leaderAsset?.r2_key_thumb || "",
    )
    .run()

  return true
}

async function rebuildDashboardSummary(env) {
  if (!env.ICONOPLASM_DB) return false
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT
       COUNT(*) AS genes,
       SUM(CASE WHEN COALESCE(current_asset_sha256, '') <> '' THEN 1 ELSE 0 END) AS with_live,
       SUM(CASE WHEN COALESCE(admin_override, 0) = 1 AND COALESCE(current_asset_sha256, '') <> '' THEN 1 ELSE 0 END) AS overrides,
       SUM(CASE WHEN COALESCE(current_asset_missing, 0) = 1 THEN 1 ELSE 0 END) AS drift,
       SUM(CASE WHEN COALESCE(current_asset_missing, 0) = 1 THEN 1 ELSE 0 END) AS current_asset_missing,
       SUM(CASE WHEN COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS missing,
       SUM(CASE WHEN COALESCE(current_asset_sha256, '') = '' THEN 1 ELSE 0 END) AS no_live,
       SUM(COALESCE(stale_count, 0)) AS stale_assets,
       SUM(COALESCE(legacy_count, 0)) AS legacy_assets,
       SUM(CASE WHEN COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS zero_candidates,
       SUM(CASE WHEN COALESCE(candidate_count, 0) = 1 THEN 1 ELSE 0 END) AS one_candidate,
       SUM(CASE WHEN COALESCE(candidate_count, 0) BETWEEN 2 AND 5 THEN 1 ELSE 0 END) AS two_to_five_candidates,
       SUM(CASE WHEN COALESCE(candidate_count, 0) >= 6 THEN 1 ELSE 0 END) AS six_plus_candidates
     FROM icono_admin_gene_rollup`,
  ).first()

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_admin_dashboard_summary (
       summary_key,
       genes,
       with_live,
       overrides,
       drift,
       current_asset_missing,
       missing,
       no_live,
       stale_assets,
       legacy_assets,
       zero_candidates,
       one_candidate,
       two_to_five_candidates,
       six_plus_candidates,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(summary_key) DO UPDATE SET
       genes = excluded.genes,
       with_live = excluded.with_live,
       overrides = excluded.overrides,
       drift = excluded.drift,
       current_asset_missing = excluded.current_asset_missing,
       missing = excluded.missing,
       no_live = excluded.no_live,
       stale_assets = excluded.stale_assets,
       legacy_assets = excluded.legacy_assets,
       zero_candidates = excluded.zero_candidates,
       one_candidate = excluded.one_candidate,
       two_to_five_candidates = excluded.two_to_five_candidates,
       six_plus_candidates = excluded.six_plus_candidates,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      ADMIN_DASHBOARD_SUMMARY_KEY,
      Number(row?.genes || 0),
      Number(row?.with_live || 0),
      Number(row?.overrides || 0),
      Number(row?.drift || 0),
      Number(row?.current_asset_missing || 0),
      Number(row?.missing || 0),
      Number(row?.no_live || 0),
      Number(row?.stale_assets || 0),
      Number(row?.legacy_assets || 0),
      Number(row?.zero_candidates || 0),
      Number(row?.one_candidate || 0),
      Number(row?.two_to_five_candidates || 0),
      Number(row?.six_plus_candidates || 0),
    )
    .run()
  return true
}

async function rebuildVisionRollups(env, rawVisionIds, { full = false } = {}) {
  if (!env.ICONOPLASM_DB) return 0
  let visionIds = []
  if (full) {
    const allResp = await env.ICONOPLASM_DB.prepare(
      `SELECT DISTINCT vision_id
       FROM icono_portrait_assets
       WHERE COALESCE(vision_id, '') <> ''
         AND lower(COALESCE(vision_id, '')) NOT LIKE 'artist-random-%'`,
    ).all()
    visionIds = Array.from(
      new Set(
        (Array.isArray(allResp?.results) ? allResp.results : [])
          .map((row) => validAdminRollupVisionId(row?.vision_id || ""))
          .filter(Boolean),
      ),
    )
  } else {
    visionIds = Array.from(
      new Set(rawVisionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean)),
    )
  }

  let rebuilt = 0
  for (const visionId of visionIds) {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT
         pa.vision_id,
         MAX(NULLIF(pa.artist_tag, '')) AS artist_tag,
         MAX(NULLIF(pa.artist_name, '')) AS artist_name,
         COUNT(*) AS image_count,
         COALESCE(AVG(
           CASE
             WHEN COALESCE(vs.vote_count, 0) > 0 THEN 1.0 * COALESCE(vs.score, 0) / vs.vote_count
             ELSE NULL
           END
         ), 0) AS avg_vote,
         COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
         COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS rejection_rate,
         COALESCE(SUM(COALESCE(vs.upvotes, 0)), 0) AS upvotes,
         COALESCE(SUM(COALESCE(vs.downvotes, 0)), 0) AS downvotes,
         COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score,
         COALESCE(SUM(
           CASE
             WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
             ELSE 0
           END
         ), 0) AS live_count,
         MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
         MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
         MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at
       FROM icono_portrait_assets pa
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = pa.gene_symbol
        AND vs.asset_sha256 = pa.asset_sha256
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = pa.gene_symbol
       LEFT JOIN icono_artist_style_blacklist bl
         ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
       WHERE pa.vision_id = ?
       GROUP BY pa.vision_id`,
    )
      .bind(visionId)
      .first()

    if (!row) {
      await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_vision_rollup WHERE vision_id = ?`)
        .bind(visionId)
        .run()
      continue
    }

    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_admin_vision_rollup (
         vision_id,
         artist_tag,
         artist_name,
         image_count,
         avg_vote,
         rejected_count,
         rejection_rate,
         upvotes,
         downvotes,
         score,
         live_count,
         blacklisted,
         blacklist_reason,
         blacklist_updated_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(vision_id) DO UPDATE SET
         artist_tag = excluded.artist_tag,
         artist_name = excluded.artist_name,
         image_count = excluded.image_count,
         avg_vote = excluded.avg_vote,
         rejected_count = excluded.rejected_count,
         rejection_rate = excluded.rejection_rate,
         upvotes = excluded.upvotes,
         downvotes = excluded.downvotes,
         score = excluded.score,
         live_count = excluded.live_count,
         blacklisted = excluded.blacklisted,
         blacklist_reason = excluded.blacklist_reason,
         blacklist_updated_at = excluded.blacklist_updated_at,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        visionId,
        sanitizeText(row?.artist_tag || "", 255) || "",
        sanitizeText(row?.artist_name || "", 255) || "",
        Number(row?.image_count || 0),
        Number(row?.avg_vote || 0),
        Number(row?.rejected_count || 0),
        Number(row?.rejection_rate || 0),
        Number(row?.upvotes || 0),
        Number(row?.downvotes || 0),
        Number(row?.score || 0),
        Number(row?.live_count || 0),
        Number(row?.blacklisted || 0) > 0 ? 1 : 0,
        sanitizeText(row?.blacklist_reason || "", 2000) || "",
        sanitizeText(row?.blacklist_updated_at || "", 64) || "",
      )
      .run()
    rebuilt += 1
  }
  return rebuilt
}

async function bulkRebuildAdminReadModels(env) {
  if (!env.ICONOPLASM_DB) return { symbols: 0, visions: 0 }

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_vote_asset_summary`).run()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_vote_asset_summary (
       gene_symbol,
       asset_sha256,
       candidate_ref,
       vision_id,
       candidate_image_id,
       upvotes,
       downvotes,
       score,
       vote_count,
       updated_at
     )
     SELECT
       upper(pa.gene_symbol) AS gene_symbol,
       lower(pa.asset_sha256) AS asset_sha256,
       'a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256) AS candidate_ref,
       COALESCE(MAX(NULLIF(iv.vision_id, '')), MAX(NULLIF(pa.vision_id, '')), '') AS vision_id,
       COALESCE(MAX(iv.candidate_image_id), MAX(pa.candidate_image_id)) AS candidate_image_id,
       COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
       COALESCE(SUM(iv.vote_value), 0) AS score,
       COALESCE(COUNT(iv.user_id), 0) AS vote_count,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_image_votes iv
       ON upper(iv.gene_symbol) = upper(pa.gene_symbol)
      AND lower(iv.asset_sha256) = lower(pa.asset_sha256)
     GROUP BY upper(pa.gene_symbol), lower(pa.asset_sha256)`,
  ).run()

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_gene_rollup`).run()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_admin_gene_rollup (
       gene_symbol,
       full_name,
       manifestation,
       current_asset_sha256,
       current_asset_missing,
       admin_override,
       total_assets,
       candidate_count,
       approved_count,
       rejected_count,
       stale_count,
       legacy_count,
       last_asset_at,
       live_status,
       live_is_stale,
       live_is_legacy,
       live_autopick_eligible,
       live_vision_id,
       live_artist_tag,
       live_artist_name,
       live_upvotes,
       live_downvotes,
       live_score,
       live_created_at,
       live_r2_key_full,
       live_r2_key_medium,
       live_r2_key_thumb,
       leader_asset_sha256,
       leader_vision_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
       leader_r2_key_full,
       leader_r2_key_medium,
       leader_r2_key_thumb,
       updated_at
     )
     WITH all_symbols AS (
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_gene_catalog
       UNION
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_portrait_assets
       UNION
       SELECT upper(gene_symbol) AS gene_symbol FROM icono_publish_state
     ),
     publish_info AS (
       SELECT
         s.gene_symbol,
         gc.full_name,
         ge.manifestation,
         lower(COALESCE(ps.current_asset_sha256, '')) AS current_asset_sha256,
         COALESCE(ps.admin_override, 0) AS admin_override
       FROM all_symbols s
       LEFT JOIN icono_gene_catalog gc
         ON upper(gc.gene_symbol) = s.gene_symbol
       LEFT JOIN icono_gene_essence ge
         ON upper(ge.gene_symbol) = s.gene_symbol
       LEFT JOIN icono_publish_state ps
         ON upper(ps.gene_symbol) = s.gene_symbol
     ),
     asset_base AS (
       SELECT
         upper(pa.gene_symbol) AS gene_symbol,
         lower(pa.asset_sha256) AS asset_sha256,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         lower(COALESCE(pa.status, 'draft')) AS status,
         COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.vision_id, '') AS vision_id,
         COALESCE(pa.artist_tag, '') AS artist_tag,
         COALESCE(pa.artist_name, '') AS artist_name,
         COALESCE(pa.created_at, '') AS created_at,
         COALESCE(vs.upvotes, 0) AS upvotes,
         COALESCE(vs.downvotes, 0) AS downvotes,
         COALESCE(vs.score, 0) AS score
       FROM icono_portrait_assets pa
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = upper(pa.gene_symbol)
        AND vs.asset_sha256 = lower(pa.asset_sha256)
     ),
     asset_counts AS (
       SELECT
         gene_symbol,
         COUNT(*) AS total_assets,
         SUM(
           CASE
             WHEN COALESCE(autopick_eligible, 1) = 1
              AND COALESCE(status, 'draft') <> 'rejected'
              AND COALESCE(r2_key_medium, r2_key_thumb, r2_key_full, '') <> '' THEN 1
             ELSE 0
           END
         ) AS candidate_count,
         SUM(CASE WHEN COALESCE(status, 'draft') = 'approved' THEN 1 ELSE 0 END) AS approved_count,
         SUM(CASE WHEN COALESCE(status, 'draft') = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
         SUM(CASE WHEN COALESCE(is_stale, 0) = 1 THEN 1 ELSE 0 END) AS stale_count,
         SUM(CASE WHEN COALESCE(is_legacy, 0) = 1 THEN 1 ELSE 0 END) AS legacy_count,
         MAX(NULLIF(created_at, '')) AS last_asset_at
       FROM asset_base
       GROUP BY gene_symbol
     ),
     current_asset AS (
       SELECT
         pi.gene_symbol,
         ab.asset_sha256,
         ab.status,
         ab.is_stale,
         ab.is_legacy,
         ab.autopick_eligible,
         ab.vision_id,
         ab.artist_tag,
         ab.artist_name,
         ab.upvotes,
         ab.downvotes,
         ab.score,
         ab.created_at,
         ab.r2_key_full,
         ab.r2_key_medium,
         ab.r2_key_thumb
       FROM publish_info pi
       LEFT JOIN asset_base ab
         ON ab.gene_symbol = pi.gene_symbol
        AND ab.asset_sha256 = pi.current_asset_sha256
     ),
     ranked_candidates AS (
       SELECT
         ab.gene_symbol,
         ab.asset_sha256,
         ab.vision_id,
         ab.artist_tag,
         ab.artist_name,
         ab.upvotes,
         ab.downvotes,
         ab.score,
         ab.created_at,
         ab.r2_key_full,
         ab.r2_key_medium,
         ab.r2_key_thumb,
         ROW_NUMBER() OVER (
           PARTITION BY ab.gene_symbol
           ORDER BY
             COALESCE(ab.score, 0) DESC,
             CASE WHEN COALESCE(ab.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
             COALESCE(ab.upvotes, 0) DESC,
             CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC,
             COALESCE(ab.created_at, '') DESC,
             ab.asset_sha256 ASC
         ) AS row_num
       FROM asset_base ab
       JOIN publish_info pi
         ON pi.gene_symbol = ab.gene_symbol
       WHERE COALESCE(ab.autopick_eligible, 1) = 1
         AND COALESCE(ab.status, 'draft') <> 'rejected'
         AND COALESCE(ab.r2_key_medium, ab.r2_key_thumb, ab.r2_key_full, '') <> ''
     ),
     leader_asset AS (
       SELECT *
       FROM ranked_candidates
       WHERE row_num = 1
     )
     SELECT
       pi.gene_symbol,
       COALESCE(NULLIF(TRIM(pi.full_name), ''), pi.gene_symbol) AS full_name,
       COALESCE(pi.manifestation, '') AS manifestation,
       NULLIF(pi.current_asset_sha256, '') AS current_asset_sha256,
       CASE
         WHEN NULLIF(pi.current_asset_sha256, '') IS NOT NULL
          AND (
            ca.asset_sha256 IS NULL
            OR COALESCE(ca.r2_key_medium, ca.r2_key_thumb, ca.r2_key_full, '') = ''
          ) THEN 1
         ELSE 0
       END AS current_asset_missing,
       COALESCE(pi.admin_override, 0) AS admin_override,
       COALESCE(ac.total_assets, 0) AS total_assets,
       COALESCE(ac.candidate_count, 0) AS candidate_count,
       COALESCE(ac.approved_count, 0) AS approved_count,
       COALESCE(ac.rejected_count, 0) AS rejected_count,
       COALESCE(ac.stale_count, 0) AS stale_count,
       COALESCE(ac.legacy_count, 0) AS legacy_count,
       ac.last_asset_at,
       COALESCE(ca.status, '') AS live_status,
       COALESCE(ca.is_stale, 0) AS live_is_stale,
       COALESCE(ca.is_legacy, 0) AS live_is_legacy,
       COALESCE(ca.autopick_eligible, 0) AS live_autopick_eligible,
       COALESCE(ca.vision_id, '') AS live_vision_id,
       COALESCE(ca.artist_tag, '') AS live_artist_tag,
       COALESCE(ca.artist_name, '') AS live_artist_name,
       COALESCE(ca.upvotes, 0) AS live_upvotes,
       COALESCE(ca.downvotes, 0) AS live_downvotes,
       COALESCE(ca.score, 0) AS live_score,
       COALESCE(ca.created_at, '') AS live_created_at,
       COALESCE(ca.r2_key_full, '') AS live_r2_key_full,
       COALESCE(ca.r2_key_medium, '') AS live_r2_key_medium,
       COALESCE(ca.r2_key_thumb, '') AS live_r2_key_thumb,
       la.asset_sha256 AS leader_asset_sha256,
       COALESCE(la.vision_id, '') AS leader_vision_id,
       COALESCE(la.artist_tag, '') AS leader_artist_tag,
       COALESCE(la.artist_name, '') AS leader_artist_name,
       COALESCE(la.upvotes, 0) AS leader_upvotes,
       COALESCE(la.downvotes, 0) AS leader_downvotes,
       COALESCE(la.score, 0) AS leader_score,
       COALESCE(la.created_at, '') AS leader_created_at,
       COALESCE(la.r2_key_full, '') AS leader_r2_key_full,
       COALESCE(la.r2_key_medium, '') AS leader_r2_key_medium,
       COALESCE(la.r2_key_thumb, '') AS leader_r2_key_thumb,
       CURRENT_TIMESTAMP AS updated_at
     FROM publish_info pi
     LEFT JOIN asset_counts ac
       ON ac.gene_symbol = pi.gene_symbol
     LEFT JOIN current_asset ca
       ON ca.gene_symbol = pi.gene_symbol
     LEFT JOIN leader_asset la
       ON la.gene_symbol = pi.gene_symbol`,
  ).run()

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_dashboard_summary`).run()
  await rebuildDashboardSummary(env)

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_vision_rollup`).run()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_admin_vision_rollup (
       vision_id,
       artist_tag,
       artist_name,
       image_count,
       avg_vote,
       rejected_count,
       rejection_rate,
       upvotes,
       downvotes,
       score,
       live_count,
       blacklisted,
       blacklist_reason,
       blacklist_updated_at,
       updated_at
     )
     SELECT
       pa.vision_id,
       MAX(NULLIF(pa.artist_tag, '')) AS artist_tag,
       MAX(NULLIF(pa.artist_name, '')) AS artist_name,
       COUNT(*) AS image_count,
       COALESCE(AVG(
         CASE
           WHEN COALESCE(vs.vote_count, 0) > 0 THEN 1.0 * COALESCE(vs.score, 0) / vs.vote_count
           ELSE NULL
         END
       ), 0) AS avg_vote,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS rejection_rate,
       COALESCE(SUM(COALESCE(vs.upvotes, 0)), 0) AS upvotes,
       COALESCE(SUM(COALESCE(vs.downvotes, 0)), 0) AS downvotes,
       COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score,
       COALESCE(SUM(
         CASE
           WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
           ELSE 0
         END
       ), 0) AS live_count,
       MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = upper(pa.gene_symbol)
      AND vs.asset_sha256 = lower(pa.asset_sha256)
     LEFT JOIN icono_publish_state ps
       ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     WHERE COALESCE(pa.vision_id, '') <> ''
       AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
     GROUP BY pa.vision_id`,
  ).run()

  const summary = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS genes FROM icono_admin_gene_rollup`,
  ).first()
  const visionSummary = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS visions FROM icono_admin_vision_rollup`,
  ).first()
  adminReadModelState.ready = true
  return {
    symbols: Number(summary?.genes || 0),
    visions: Number(visionSummary?.visions || 0),
  }
}

async function syncAdminReadModels(
  env,
  { symbols = [], visionIds = [], fullVision = false, fullRebuild = false } = {},
) {
  if (!env.ICONOPLASM_DB) return { symbols: 0, visions: 0 }
  if (fullRebuild) {
    return bulkRebuildAdminReadModels(env)
  }

  const symbolList = Array.from(
    new Set(symbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  await rebuildVoteAssetSummaryForSymbols(env, symbolList)
  await rebuildGeneRollupForSymbols(env, symbolList)
  const inferredVisionIds = await collectVisionIdsForSymbols(env, symbolList)
  const finalVisionIds = Array.from(
    new Set([
      ...inferredVisionIds,
      ...visionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean),
    ]),
  )
  if (fullVision) await rebuildVisionRollups(env, [], { full: true })
  else await rebuildVisionRollupsBatch(env, finalVisionIds)
  await rebuildDashboardSummary(env)
  adminReadModelState.ready = true
  return { symbols: symbolList.length, visions: fullVision ? -1 : finalVisionIds.length }
}

function normalizeAdminReadModelBootstrapSteps(raw) {
  return Math.max(
    1,
    Math.min(
      ADMIN_READ_MODEL_STEP_MAX,
      Number.parseInt(String(raw || ADMIN_READ_MODEL_STEP_DEFAULT), 10) ||
        ADMIN_READ_MODEL_STEP_DEFAULT,
    ),
  )
}

function normalizeAdminReadModelSymbolBatch(raw) {
  return Math.max(
    1,
    Math.min(
      ADMIN_READ_MODEL_SYMBOL_BATCH_MAX,
      Number.parseInt(String(raw || ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT), 10) ||
        ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT,
    ),
  )
}

function normalizeAdminReadModelVisionBatch(raw) {
  return Math.max(
    1,
    Math.min(
      ADMIN_READ_MODEL_VISION_BATCH_MAX,
      Number.parseInt(String(raw || ADMIN_READ_MODEL_VISION_BATCH_DEFAULT), 10) ||
        ADMIN_READ_MODEL_VISION_BATCH_DEFAULT,
    ),
  )
}

function mapAdminReadModelBootstrapRow(row) {
  const phase =
    row?.phase === ADMIN_READ_MODEL_BOOTSTRAP_PHASE_VISIONS ||
    row?.phase === ADMIN_READ_MODEL_BOOTSTRAP_PHASE_DONE
      ? row.phase
      : ADMIN_READ_MODEL_BOOTSTRAP_PHASE_SYMBOLS
  const status =
    row?.status === ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE
      ? ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE
      : ADMIN_READ_MODEL_BOOTSTRAP_STATUS_RUNNING
  return {
    bootstrap_key: String(row?.bootstrap_key || ADMIN_READ_MODEL_BOOTSTRAP_KEY),
    status,
    phase,
    last_symbol: normalizeSymbol(row?.last_symbol || "") || "",
    last_vision_id: validAdminRollupVisionId(row?.last_vision_id || "") || "",
    processed_symbols: Number(row?.processed_symbols || 0),
    total_symbols: Number(row?.total_symbols || 0),
    processed_visions: Number(row?.processed_visions || 0),
    total_visions: Number(row?.total_visions || 0),
    last_error: sanitizeText(row?.last_error || "", 2000) || "",
    started_at: sanitizeText(row?.started_at || "", 64) || "",
    updated_at: sanitizeText(row?.updated_at || "", 64) || "",
    completed_at: sanitizeText(row?.completed_at || "", 64) || "",
  }
}

async function fetchAdminReadModelBootstrapState(env) {
  if (!env.ICONOPLASM_DB) return null
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_admin_read_model_bootstrap
     WHERE bootstrap_key = ?
     LIMIT 1`,
  )
    .bind(ADMIN_READ_MODEL_BOOTSTRAP_KEY)
    .first()
  return row ? mapAdminReadModelBootstrapRow(row) : null
}

async function writeAdminReadModelBootstrapState(env, state) {
  if (!env.ICONOPLASM_DB) return null
  const row = mapAdminReadModelBootstrapRow(state || {})
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_admin_read_model_bootstrap (
       bootstrap_key,
       status,
       phase,
       last_symbol,
       last_vision_id,
       processed_symbols,
       total_symbols,
       processed_visions,
       total_visions,
       last_error,
       started_at,
       updated_at,
       completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(bootstrap_key) DO UPDATE SET
       status = excluded.status,
       phase = excluded.phase,
       last_symbol = excluded.last_symbol,
       last_vision_id = excluded.last_vision_id,
       processed_symbols = excluded.processed_symbols,
       total_symbols = excluded.total_symbols,
       processed_visions = excluded.processed_visions,
       total_visions = excluded.total_visions,
       last_error = excluded.last_error,
       started_at = excluded.started_at,
       updated_at = CURRENT_TIMESTAMP,
       completed_at = excluded.completed_at`,
  )
    .bind(
      ADMIN_READ_MODEL_BOOTSTRAP_KEY,
      row.status,
      row.phase,
      row.last_symbol,
      row.last_vision_id,
      row.processed_symbols,
      row.total_symbols,
      row.processed_visions,
      row.total_visions,
      row.last_error,
      row.started_at || null,
      row.completed_at || null,
    )
    .run()
  return fetchAdminReadModelBootstrapState(env)
}

async function resetAdminReadModelBootstrap(env) {
  if (!env.ICONOPLASM_DB) return null
  const [symbolCountRow, visionCountRow] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT upper(gene_symbol) AS gene_symbol FROM icono_gene_catalog
         UNION
         SELECT upper(gene_symbol) AS gene_symbol FROM icono_portrait_assets
         UNION
         SELECT upper(gene_symbol) AS gene_symbol FROM icono_publish_state
       ) symbols`,
    ).first(),
    env.ICONOPLASM_DB.prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT DISTINCT vision_id
         FROM icono_portrait_assets
         WHERE COALESCE(vision_id, '') <> ''
           AND lower(COALESCE(vision_id, '')) NOT LIKE 'artist-random-%'
       ) visions`,
    ).first(),
  ])

  await Promise.all([
    env.ICONOPLASM_DB.prepare(`DELETE FROM icono_vote_asset_summary`).run(),
    env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_gene_rollup`).run(),
    env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_dashboard_summary`).run(),
    env.ICONOPLASM_DB.prepare(`DELETE FROM icono_admin_vision_rollup`).run(),
  ])
  adminReadModelState.ready = false

  return writeAdminReadModelBootstrapState(env, {
    bootstrap_key: ADMIN_READ_MODEL_BOOTSTRAP_KEY,
    status: ADMIN_READ_MODEL_BOOTSTRAP_STATUS_RUNNING,
    phase: ADMIN_READ_MODEL_BOOTSTRAP_PHASE_SYMBOLS,
    last_symbol: "",
    last_vision_id: "",
    processed_symbols: 0,
    total_symbols: Number(symbolCountRow?.count || 0),
    processed_visions: 0,
    total_visions: Number(visionCountRow?.count || 0),
    last_error: "",
    started_at: new Date().toISOString(),
    completed_at: "",
  })
}

async function ensureAdminReadModelBootstrapInitialized(env) {
  const existing = await fetchAdminReadModelBootstrapState(env)
  if (existing) return existing
  return resetAdminReadModelBootstrap(env)
}

async function runAdminReadModelBootstrapStep(
  env,
  { reset = false, symbolBatch = ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT, visionBatch = ADMIN_READ_MODEL_VISION_BATCH_DEFAULT } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  let state = reset
    ? await resetAdminReadModelBootstrap(env)
    : await ensureAdminReadModelBootstrapInitialized(env)
  const cleanedSymbolBatch = normalizeAdminReadModelSymbolBatch(symbolBatch)
  const cleanedVisionBatch = normalizeAdminReadModelVisionBatch(visionBatch)

  if (state.status === ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE) {
    adminReadModelState.ready = true
    return {
      ok: true,
      advanced: false,
      state,
      processed: { symbols: 0, visions: 0 },
    }
  }

  if (state.phase === ADMIN_READ_MODEL_BOOTSTRAP_PHASE_SYMBOLS) {
    const symbols = await listAdminReadModelSymbolsAfter(env, state.last_symbol, cleanedSymbolBatch)
    if (symbols.length === 0) {
      state = await writeAdminReadModelBootstrapState(env, {
        ...state,
        phase: ADMIN_READ_MODEL_BOOTSTRAP_PHASE_VISIONS,
        last_symbol: "",
        last_error: "",
      })
      return {
        ok: true,
        advanced: true,
        state,
        processed: { symbols: 0, visions: 0 },
      }
    }

    await rebuildVoteAssetSummaryForSymbols(env, symbols)
    await rebuildGeneRollupForSymbols(env, symbols)
    const touchedVisionIds = await collectVisionIdsForSymbols(env, symbols)
    await rebuildVisionRollupsBatch(env, touchedVisionIds)
    await rebuildDashboardSummary(env)

    state = await writeAdminReadModelBootstrapState(env, {
      ...state,
      last_symbol: symbols[symbols.length - 1] || state.last_symbol,
      processed_symbols: Math.min(state.total_symbols, state.processed_symbols + symbols.length),
      last_error: "",
    })
    return {
      ok: true,
      advanced: true,
      state,
      processed: { symbols: symbols.length, visions: touchedVisionIds.length },
    }
  }

  if (state.phase === ADMIN_READ_MODEL_BOOTSTRAP_PHASE_VISIONS) {
    const visionIds = await listAdminReadModelVisionIdsAfter(
      env,
      state.last_vision_id,
      cleanedVisionBatch,
    )
    if (visionIds.length === 0) {
      await rebuildDashboardSummary(env)
      state = await writeAdminReadModelBootstrapState(env, {
        ...state,
        status: ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE,
        phase: ADMIN_READ_MODEL_BOOTSTRAP_PHASE_DONE,
        last_error: "",
        completed_at: new Date().toISOString(),
      })
      adminReadModelState.ready = true
      return {
        ok: true,
        advanced: true,
        state,
        processed: { symbols: 0, visions: 0 },
      }
    }

    await rebuildVisionRollupsBatch(env, visionIds)
    await rebuildDashboardSummary(env)
    state = await writeAdminReadModelBootstrapState(env, {
      ...state,
      last_vision_id: visionIds[visionIds.length - 1] || state.last_vision_id,
      processed_visions: Math.min(state.total_visions, state.processed_visions + visionIds.length),
      last_error: "",
    })
    return {
      ok: true,
      advanced: true,
      state,
      processed: { symbols: 0, visions: visionIds.length },
    }
  }

  adminReadModelState.ready = true
  return {
    ok: true,
    advanced: false,
    state,
    processed: { symbols: 0, visions: 0 },
  }
}

async function ensureAdminReadModelsReady(env) {
  if (!env.ICONOPLASM_DB) return
  if (adminReadModelState.ready) return
  if (adminReadModelState.promise) {
    await adminReadModelState.promise
    return
  }
  adminReadModelState.promise = (async () => {
    const summary = await env.ICONOPLASM_DB.prepare(
      `SELECT summary_key FROM icono_admin_dashboard_summary WHERE summary_key = ? LIMIT 1`,
    )
      .bind(ADMIN_DASHBOARD_SUMMARY_KEY)
      .first()
    if (!summary) {
      // Do not bootstrap the entire admin read model from a live request.
      // Production already crossed the point where a first-run full rebuild can
      // blow D1 CPU limits, so the heavy backfill now happens in a migration.
      // Request-time code only makes sure the lightweight dashboard row exists
      // so the admin page degrades to empty data instead of throwing a 500.
      await rebuildDashboardSummary(env)
    }
    adminReadModelState.ready = true
  })()
  try {
    await adminReadModelState.promise
  } finally {
    adminReadModelState.promise = null
  }
}

async function fetchAdminOverview(env, { eventLimit = 12 } = {}) {
  if (!env.ICONOPLASM_DB) {
    return { summary: null, attention: [], recent_events: [] }
  }

  await ensureAdminReadModelsReady(env)
  const [summaryRow, attentionResp] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT *
       FROM icono_admin_dashboard_summary
       WHERE summary_key = ?
       LIMIT 1`,
    )
      .bind(ADMIN_DASHBOARD_SUMMARY_KEY)
      .first(),
    env.ICONOPLASM_DB.prepare(
      `SELECT
         gene_symbol,
         current_asset_missing,
         candidate_count,
         stale_count,
         admin_override
       FROM icono_admin_gene_rollup
       WHERE current_asset_missing = 1
          OR candidate_count = 0
          OR stale_count > 0
          OR admin_override = 1
       ORDER BY
         CASE
           WHEN current_asset_missing = 1 THEN 100
           WHEN candidate_count = 0 THEN 90
           WHEN stale_count > 0 THEN 70
           WHEN admin_override = 1 THEN 50
           ELSE 0
         END DESC,
         gene_symbol ASC
       LIMIT 12`,
    ).all(),
  ])

  const attention = (Array.isArray(attentionResp?.results) ? attentionResp.results : []).map(
    (row) => {
      const currentAssetMissing = Number(row?.current_asset_missing || 0) > 0
      const candidateCount = Number(row?.candidate_count || 0)
      const staleCount = Number(row?.stale_count || 0)
      const adminOverride = Number(row?.admin_override || 0) > 0
      let kind = ""
      if (currentAssetMissing) kind = "drift"
      else if (candidateCount === 0) kind = "missing"
      else if (staleCount > 0) kind = "stale"
      else if (adminOverride) kind = "override"
      return {
        symbol: normalizeSymbol(row?.gene_symbol || "") || "",
        kind,
        stale_assets: staleCount,
      }
    },
  )

  const recentEvents = await fetchAdminRecentEvents(env, { limit: eventLimit })

  return {
    summary: {
      genes: Number(summaryRow?.genes || 0),
      with_live: Number(summaryRow?.with_live || 0),
      overrides: Number(summaryRow?.overrides || 0),
      drift: Number(summaryRow?.drift || 0),
      current_asset_missing: Number(summaryRow?.current_asset_missing || 0),
      missing: Number(summaryRow?.missing || 0),
      no_live: Number(summaryRow?.no_live || 0),
      stale_assets: Number(summaryRow?.stale_assets || 0),
      legacy_assets: Number(summaryRow?.legacy_assets || 0),
    },
    attention,
    recent_events: recentEvents,
  }
}

async function fetchAdminCanonAudit(env, { limit = 1500, eventLimit = 40 } = {}) {
  if (!env.ICONOPLASM_DB) return { rows: [], recent_events: [] }

  const cleanedLimit = Math.max(
    1,
    Math.min(4000, Number.parseInt(String(limit || "1500"), 10) || 1500),
  )
  const cleanedEventLimit = Math.max(
    0,
    Math.min(200, Number.parseInt(String(eventLimit || "40"), 10) || 40),
  )

  await ensureAdminReadModelsReady(env)
  const auditResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       gene_symbol,
       current_asset_sha256,
       current_asset_missing,
       admin_override,
       total_assets,
       rejected_count AS rejected_assets,
       stale_count AS stale_assets,
       legacy_count AS legacy_assets,
       candidate_count AS eligible_assets,
       current_asset_sha256 AS current_resolved_asset_sha256,
       live_r2_key_full AS current_r2_key_full,
       live_r2_key_medium AS current_r2_key_medium,
       live_r2_key_thumb AS current_r2_key_thumb,
       live_status AS current_status,
       live_is_stale AS current_is_stale,
       live_is_legacy AS current_is_legacy,
       live_vision_id AS current_vision_id,
       live_artist_tag AS current_artist_tag,
       live_artist_name AS current_artist_name,
       live_upvotes AS current_upvotes,
       live_downvotes AS current_downvotes,
       live_score AS current_score,
       live_created_at AS current_created_at,
       leader_asset_sha256,
       leader_r2_key_full,
       leader_r2_key_medium,
       leader_r2_key_thumb,
       '' AS leader_status,
       0 AS leader_is_stale,
       0 AS leader_is_legacy,
       leader_vision_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at
     FROM icono_admin_gene_rollup
     ORDER BY candidate_count DESC, total_assets DESC, gene_symbol ASC
     LIMIT ?`,
  )
    .bind(cleanedLimit)
    .all()

  return {
    rows: Array.isArray(auditResp?.results) ? auditResp.results : [],
    recent_events: await fetchAdminRecentEvents(env, { limit: cleanedEventLimit }),
  }
}

function normalizeAdminGalleryMode(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (["all", "side-by-side"].includes(value)) return value
  return "live"
}

function normalizeAdminGalleryFilter(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (["mismatch", "pinned", "missing", "stale"].includes(value)) return value
  return "all"
}

function normalizeAdminGallerySort(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (["votes", "recency", "mismatch"].includes(value)) return value
  return "name"
}

function normalizeAdminGalleryPage(raw) {
  return Math.max(1, Number.parseInt(String(raw || "1"), 10) || 1)
}

function normalizeAdminGalleryLimit(raw) {
  return Math.max(1, Math.min(120, Number.parseInt(String(raw || "60"), 10) || 60))
}

async function fetchAdminCoverage(env) {
  if (!env.ICONOPLASM_DB) {
    return { total: 0, zero: 0, one: 0, two_to_five: 0, six_plus: 0 }
  }

  await ensureAdminReadModelsReady(env)
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT
       genes AS total,
       zero_candidates AS zero,
       one_candidate AS one,
       two_to_five_candidates AS two_to_five,
       six_plus_candidates AS six_plus
     FROM icono_admin_dashboard_summary
     WHERE summary_key = ?
     LIMIT 1`,
  )
    .bind(ADMIN_DASHBOARD_SUMMARY_KEY)
    .first()

  return {
    total: Number(row?.total || 0),
    zero: Number(row?.zero || 0),
    one: Number(row?.one || 0),
    two_to_five: Number(row?.two_to_five || 0),
    six_plus: Number(row?.six_plus || 0),
  }
}

async function fetchAdminGallery(
  env,
  url,
  { page = 1, limit = 100, filter = "all", sort = "name", query = "", mode = "live" } = {},
) {
  if (!env.ICONOPLASM_DB) {
    return { page: 1, limit: 0, total: 0, count: 0, mode: "live", rows: [] }
  }

  await ensureAdminReadModelsReady(env)

  const cleanedPage = normalizeAdminGalleryPage(page)
  const cleanedLimit = normalizeAdminGalleryLimit(limit)
  const cleanedFilter = normalizeAdminGalleryFilter(filter)
  const cleanedSort = normalizeAdminGallerySort(sort)
  const cleanedMode = normalizeAdminGalleryMode(mode)
  const queryNorm = String(query || "")
    .trim()
    .toUpperCase()
    .slice(0, 64)
  const offset = (cleanedPage - 1) * cleanedLimit
  const base = portraitBase(url, env)

  const sharedWhereParts = []
  const params = []
  if (queryNorm) {
    sharedWhereParts.push(
      "(upper(gr.gene_symbol) LIKE ? OR upper(COALESCE(gr.full_name, '')) LIKE ?)",
    )
    params.push(`%${queryNorm}%`, `%${queryNorm}%`)
  }
  if (cleanedMode === "all") {
    const whereParts = sharedWhereParts.slice()
    whereParts.push("COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''")
    if (cleanedFilter === "mismatch") {
      whereParts.push("COALESCE(gr.current_asset_missing, 0) = 1")
    } else if (cleanedFilter === "pinned") {
      whereParts.push("COALESCE(gr.admin_override, 0) = 1")
    } else if (cleanedFilter === "missing") {
      whereParts.push("1 = 0")
    } else if (cleanedFilter === "stale") {
      whereParts.push("COALESCE(pa.is_stale, 0) = 1")
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""

    let orderClause = "upper(pa.gene_symbol) ASC, COALESCE(vs.score, 0) DESC, pa.created_at DESC"
    if (cleanedSort === "votes") {
      orderClause =
        "COALESCE(vs.score, 0) DESC, COALESCE(vs.upvotes, 0) DESC, upper(pa.gene_symbol) ASC, pa.created_at DESC"
    } else if (cleanedSort === "recency") {
      orderClause = "pa.created_at DESC, upper(pa.gene_symbol) ASC, lower(pa.asset_sha256) ASC"
    } else if (cleanedSort === "mismatch") {
      orderClause =
        "COALESCE(gr.current_asset_missing, 0) DESC, COALESCE(pa.is_stale, 0) DESC, upper(pa.gene_symbol) ASC, COALESCE(vs.score, 0) DESC"
    }

    const allResp = await env.ICONOPLASM_DB.prepare(
      `
       SELECT
         pa.gene_symbol AS gene_symbol,
         gr.full_name,
         gr.manifestation,
         pa.asset_sha256 AS asset_sha256,
         COALESCE(pa.status, 'draft') AS status,
         COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         pa.vision_id,
         pa.artist_tag,
         pa.artist_name,
         pa.created_at,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         COALESCE(vs.upvotes, 0) AS upvotes,
         COALESCE(vs.downvotes, 0) AS downvotes,
         COALESCE(vs.score, 0) AS score,
         CASE WHEN COALESCE(gr.current_asset_sha256, '') = pa.asset_sha256 THEN 1 ELSE 0 END AS is_live,
         COALESCE(gr.admin_override, 0) AS admin_override,
         COALESCE(gr.current_asset_missing, 0) AS has_mismatch,
         COALESCE(gr.candidate_count, 0) AS candidate_count,
         COALESCE(gr.approved_count, 0) AS approved_count,
         COALESCE(gr.rejected_count, 0) AS rejected_count,
         COALESCE(gr.stale_count, 0) AS stale_count,
         COALESCE(gr.legacy_count, 0) AS legacy_count,
         COALESCE(gr.total_assets, 0) AS total_assets,
         COUNT(*) OVER() AS total_rows
       FROM icono_portrait_assets pa
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = pa.gene_symbol
        AND vs.asset_sha256 = pa.asset_sha256
       LEFT JOIN icono_admin_gene_rollup gr
         ON gr.gene_symbol = pa.gene_symbol
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`,
    )
      .bind(...params, cleanedLimit, offset)
      .all()

    const allRows = Array.isArray(allResp?.results) ? allResp.results : []
    const allTotal = Number(allRows[0]?.total_rows || 0)

    return {
      page: cleanedPage,
      limit: cleanedLimit,
      total: allTotal,
      count: allRows.length,
      mode: cleanedMode,
      rows: allRows.map((row) => ({
        gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
        full_name: sanitizeText(row?.full_name || "", 255) || "",
        manifestation: sanitizeText(row?.manifestation || "", 4000) || "",
        asset_sha256: normalizeSha256(row?.asset_sha256 || "") || null,
        candidate_count: Number(row?.candidate_count || 0),
        approved_count: Number(row?.approved_count || 0),
        rejected_count: Number(row?.rejected_count || 0),
        stale_count: Number(row?.stale_count || 0),
        legacy_count: Number(row?.legacy_count || 0),
        total_assets: Number(row?.total_assets || 0),
        status: sanitizeText(row?.status || "", 32) || "draft",
        autopick_eligible: Number(row?.autopick_eligible || 0) > 0,
        is_stale: Number(row?.is_stale || 0) > 0,
        is_legacy: Number(row?.is_legacy || 0) > 0,
        is_live: Number(row?.is_live || 0) > 0,
        admin_override: Number(row?.admin_override || 0) > 0,
        has_mismatch: Number(row?.has_mismatch || 0) > 0,
        current_asset_missing: Number(row?.has_mismatch || 0) > 0,
        missing: false,
        has_stale: Number(row?.is_stale || 0) > 0,
        vision_id: sanitizeText(row?.vision_id || "", 255) || "",
        artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
        artist_name: sanitizeText(row?.artist_name || "", 255) || "",
        image_upvotes: Number(row?.upvotes || 0),
        image_downvotes: Number(row?.downvotes || 0),
        image_score: Number(row?.score || 0),
        thumb_url:
          row?.r2_key_thumb || row?.r2_key_medium
            ? joinUrl(base, row?.r2_key_thumb || row?.r2_key_medium)
            : adminPortraitUrl(base, row?.asset_sha256 || "", "thumb"),
        medium_url:
          row?.r2_key_medium || row?.r2_key_full
            ? joinUrl(base, row?.r2_key_medium || row?.r2_key_full)
            : adminPortraitUrl(base, row?.asset_sha256 || "", "medium"),
        full_url:
          row?.r2_key_full || row?.r2_key_medium
            ? joinUrl(base, row?.r2_key_full || row?.r2_key_medium)
            : adminPortraitUrl(base, row?.asset_sha256 || "", "full"),
        updated_at: sanitizeText(row?.created_at || "", 64) || "",
      })),
    }
  }

  const whereParts = sharedWhereParts.slice()
  if (cleanedFilter === "mismatch") {
    whereParts.push("COALESCE(gr.current_asset_missing, 0) = 1")
  } else if (cleanedFilter === "pinned") {
    whereParts.push("COALESCE(gr.admin_override, 0) = 1")
  } else if (cleanedFilter === "missing") {
    whereParts.push("COALESCE(gr.candidate_count, 0) = 0")
  } else if (cleanedFilter === "stale") {
    whereParts.push("COALESCE(gr.stale_count, 0) > 0")
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""

  let orderClause = "upper(gr.gene_symbol) ASC"
  if (cleanedSort === "votes") {
    orderClause =
      "COALESCE(gr.leader_score, gr.live_score, 0) DESC, COALESCE(gr.leader_upvotes, gr.live_upvotes, 0) DESC, upper(gr.gene_symbol) ASC"
  } else if (cleanedSort === "recency") {
    orderClause =
      "COALESCE(gr.updated_at, gr.leader_created_at, gr.last_asset_at, '') DESC, upper(gr.gene_symbol) ASC"
  } else if (cleanedSort === "mismatch") {
    orderClause =
      "COALESCE(gr.current_asset_missing, 0) DESC, COALESCE(gr.stale_count, 0) DESC, upper(gr.gene_symbol) ASC"
  }

  const resp = await env.ICONOPLASM_DB.prepare(
    `
     SELECT
       gr.gene_symbol AS gene_symbol,
       gr.full_name,
       gr.manifestation,
       gr.candidate_count,
       gr.approved_count,
       gr.rejected_count,
       gr.stale_count,
       gr.legacy_count,
       gr.total_assets,
       gr.last_asset_at,
       gr.current_asset_sha256 AS live_sha,
       gr.admin_override,
       gr.updated_at AS live_updated_at,
       gr.live_vision_id,
       gr.live_artist_tag,
       gr.live_artist_name,
       gr.live_upvotes,
       gr.live_downvotes,
       gr.live_score,
       gr.live_status,
       gr.live_is_stale,
       gr.live_is_legacy,
       gr.live_r2_key_full,
       gr.live_r2_key_medium,
       gr.live_r2_key_thumb,
       gr.leader_asset_sha256 AS leader_sha,
       gr.leader_vision_id,
       gr.leader_artist_tag,
       gr.leader_artist_name,
       gr.leader_created_at,
       gr.leader_upvotes,
       gr.leader_downvotes,
       gr.leader_score,
       gr.leader_r2_key_full,
       gr.leader_r2_key_medium,
       gr.leader_r2_key_thumb,
       gr.current_asset_missing AS has_mismatch,
       COUNT(*) OVER() AS total_rows
     FROM icono_admin_gene_rollup gr
     ${whereClause}
     ORDER BY ${orderClause}
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, cleanedLimit, offset)
    .all()

  const rows = Array.isArray(resp?.results) ? resp.results : []
  const total = Number(rows[0]?.total_rows || 0)

  return {
    page: cleanedPage,
    limit: cleanedLimit,
    total,
    count: rows.length,
    mode: cleanedMode,
    rows: rows.map((row) => ({
      gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
      full_name: sanitizeText(row?.full_name || "", 255) || "",
      manifestation: sanitizeText(row?.manifestation || "", 4000) || "",
      candidate_count: Number(row?.candidate_count || 0),
      approved_count: Number(row?.approved_count || 0),
      rejected_count: Number(row?.rejected_count || 0),
      stale_count: Number(row?.stale_count || 0),
      legacy_count: Number(row?.legacy_count || 0),
      total_assets: Number(row?.total_assets || 0),
      live_sha: normalizeSha256(row?.live_sha || "") || null,
      admin_override: Number(row?.admin_override || 0) > 0,
      live_vision_id: sanitizeText(row?.live_vision_id || "", 255) || "",
      live_artist_tag: sanitizeText(row?.live_artist_tag || "", 255) || "",
      live_artist_name: sanitizeText(row?.live_artist_name || "", 255) || "",
      live_upvotes: Number(row?.live_upvotes || 0),
      live_downvotes: Number(row?.live_downvotes || 0),
      live_score: Number(row?.live_score || 0),
      live_status: sanitizeText(row?.live_status || "", 32) || "",
      live_thumb_url:
        row?.live_r2_key_thumb || row?.live_r2_key_medium
          ? joinUrl(base, row?.live_r2_key_thumb || row?.live_r2_key_medium)
          : adminPortraitUrl(base, row?.live_sha || "", "thumb"),
      live_medium_url:
        row?.live_r2_key_medium || row?.live_r2_key_full
          ? joinUrl(base, row?.live_r2_key_medium || row?.live_r2_key_full)
          : adminPortraitUrl(base, row?.live_sha || "", "medium"),
      leader_sha: normalizeSha256(row?.leader_sha || "") || null,
      leader_vision_id: sanitizeText(row?.leader_vision_id || "", 255) || "",
      leader_artist_tag: sanitizeText(row?.leader_artist_tag || "", 255) || "",
      leader_artist_name: sanitizeText(row?.leader_artist_name || "", 255) || "",
      leader_upvotes: Number(row?.leader_upvotes || 0),
      leader_downvotes: Number(row?.leader_downvotes || 0),
      leader_score: Number(row?.leader_score || 0),
      leader_thumb_url:
        row?.leader_r2_key_thumb || row?.leader_r2_key_medium
          ? joinUrl(base, row?.leader_r2_key_thumb || row?.leader_r2_key_medium)
          : adminPortraitUrl(base, row?.leader_sha || "", "thumb"),
      leader_medium_url:
        row?.leader_r2_key_medium || row?.leader_r2_key_full
          ? joinUrl(base, row?.leader_r2_key_medium || row?.leader_r2_key_full)
          : adminPortraitUrl(base, row?.leader_sha || "", "medium"),
      has_mismatch: Number(row?.has_mismatch || 0) > 0,
      current_asset_missing: Number(row?.has_mismatch || 0) > 0,
      has_stale: Number(row?.stale_count || 0) > 0,
      missing: Number(row?.candidate_count || 0) === 0,
      updated_at:
        sanitizeText(
          row?.live_updated_at || row?.leader_created_at || row?.last_asset_at || "",
          64,
        ) || "",
    })),
  }
}

async function fetchAdminGeneDetail(env, url, rawSymbol) {
  if (!env.ICONOPLASM_DB) return null
  const symbol = normalizeSymbol(rawSymbol)
  if (!symbol) return null
  const base = portraitBase(url, env)

  await ensureAdminReadModelsReady(env)

  const info = await env.ICONOPLASM_DB.prepare(
    `SELECT
       gene_symbol,
       full_name,
       manifestation,
       current_asset_sha256 AS live_sha,
       admin_override,
       updated_at AS live_updated_at
     FROM icono_admin_gene_rollup
     WHERE gene_symbol = ?`,
  )
    .bind(symbol)
    .first()

  const candidateResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       lower(pa.asset_sha256) AS asset_sha256,
       lower(COALESCE(pa.status, 'draft')) AS status,
       COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
       COALESCE(pa.is_stale, 0) AS is_stale,
       COALESCE(pa.is_legacy, 0) AS is_legacy,
       pa.vision_id,
       pa.artist_tag,
       pa.artist_name,
       pa.created_at,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       COALESCE(vs.upvotes, 0) AS upvotes,
       COALESCE(vs.downvotes, 0) AS downvotes,
       COALESCE(vs.score, 0) AS score,
       CASE
         WHEN lower(COALESCE(?, '')) = lower(pa.asset_sha256) THEN 1
         ELSE 0
       END AS is_live
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE upper(pa.gene_symbol) = ?
       AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
     ORDER BY
       is_live DESC,
       COALESCE(vs.score, 0) DESC,
       COALESCE(vs.upvotes, 0) DESC,
       pa.created_at DESC,
       lower(pa.asset_sha256) ASC`,
  )
    .bind(normalizeSha256(info?.live_sha || "") || "", symbol)
    .all()

  const eventResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       id,
       gene_symbol,
       from_asset_sha256,
       to_asset_sha256,
       action,
       actor,
       reason,
       created_at
     FROM icono_publish_events
     WHERE upper(gene_symbol) = ?
     ORDER BY id DESC
     LIMIT 20`,
  )
    .bind(symbol)
    .all()

  const liveSha = normalizeSha256(info?.live_sha || "") || null
  const candidates = (Array.isArray(candidateResp?.results) ? candidateResp.results : []).map(
    (row) => ({
      asset_sha256: normalizeSha256(row?.asset_sha256 || "") || null,
      status: sanitizeText(row?.status || "", 32) || "draft",
      autopick_eligible: Number(row?.autopick_eligible || 0) > 0,
      is_stale: Number(row?.is_stale || 0) > 0,
      is_legacy: Number(row?.is_legacy || 0) > 0,
      is_live: Number(row?.is_live || 0) > 0,
      vision_id: sanitizeText(row?.vision_id || "", 255) || "",
      artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
      artist_name: sanitizeText(row?.artist_name || "", 255) || "",
      vote_score: Number(row?.score || 0),
      image_upvotes: Number(row?.upvotes || 0),
      image_downvotes: Number(row?.downvotes || 0),
      created_at: sanitizeText(row?.created_at || "", 64) || "",
      full_url:
        row?.r2_key_full || row?.r2_key_medium
          ? joinUrl(base, row?.r2_key_full || row?.r2_key_medium)
          : adminPortraitUrl(base, row?.asset_sha256 || "", "full"),
      medium_url:
        row?.r2_key_medium || row?.r2_key_full
          ? joinUrl(base, row?.r2_key_medium || row?.r2_key_full)
          : adminPortraitUrl(base, row?.asset_sha256 || "", "medium"),
      thumb_url:
        row?.r2_key_thumb || row?.r2_key_medium
          ? joinUrl(base, row?.r2_key_thumb || row?.r2_key_medium)
          : adminPortraitUrl(base, row?.asset_sha256 || "", "thumb"),
    }),
  )

  return {
    gene_symbol: symbol,
    full_name: sanitizeText(info?.full_name || "", 255) || "",
    live_sha: liveSha,
    admin_override: Number(info?.admin_override || 0) > 0,
    manifestation: sanitizeText(info?.manifestation || "", 4000) || "",
    updated_at: sanitizeText(info?.live_updated_at || info?.essence_updated_at || "", 64) || "",
    candidates,
    recent_events: (Array.isArray(eventResp?.results) ? eventResp.results : []).map((row) => ({
      id: Number(row?.id || 0),
      symbol: normalizeSymbol(row?.gene_symbol || "") || symbol,
      from_asset_sha256: normalizeSha256(row?.from_asset_sha256 || "") || null,
      to_asset_sha256: normalizeSha256(row?.to_asset_sha256 || "") || null,
      action: sanitizeText(row?.action || "", 64) || "",
      actor: sanitizeText(row?.actor || "", 255) || "",
      reason: sanitizeText(row?.reason || "", 2000) || "",
      created_at: sanitizeText(row?.created_at || "", 64) || "",
      thumb_url:
        adminPortraitUrl(base, row?.to_asset_sha256 || "", "thumb") ||
        adminPortraitUrl(base, row?.from_asset_sha256 || "", "thumb"),
    })),
  }
}

function mapAdminVisionStatsRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    vision_id: sanitizeText(row?.vision_id || "", 255) || "",
    // The user-facing artist/emulsion ID is the stable resolved variant ordinal
    // encoded in vision_id (for example anima-v1-42 -> 42). Do not use
    // candidate_image_id here; that is per image and gives different numbers for
    // the same artist row.
    artist_id: sanitizeText(row?.artist_id || "", 64) || deriveAdminArtistId(row?.vision_id || ""),
    artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
    artist_name: sanitizeText(row?.artist_name || "", 255) || "",
    image_count: Number(row?.image_count || 0),
    avg_vote: Number(row?.avg_vote || 0),
    rejected_count: Number(row?.rejected_count || 0),
    rejection_rate: Number(row?.rejection_rate || 0),
    upvotes: Number(row?.upvotes || 0),
    downvotes: Number(row?.downvotes || 0),
    score: Number(row?.score || 0),
    live_count: Number(row?.live_count || 0),
    blacklisted: Number(row?.blacklisted || 0) > 0,
    blacklist_reason: sanitizeText(row?.blacklist_reason || "", 2000) || "",
    blacklist_updated_at: sanitizeText(row?.blacklist_updated_at || "", 64) || "",
  }))
}

function mapAdminVisionAssetRow(base, row) {
  const assetSha = normalizeSha256(row?.asset_sha256 || "") || ""
  const width = optionalInt(row?.width)
  const height = optionalInt(row?.height)
  const candidateImageId = optionalInt(row?.candidate_image_id ?? row?.emulsion_id)
  const score = Number(row?.score || 0)
  const voteCount = Number(row?.vote_count || 0)
  return {
    vision_id: sanitizeText(row?.vision_id || "", 255) || "",
    artist_id: sanitizeText(row?.artist_id || "", 64) || deriveAdminArtistId(row?.vision_id || ""),
    gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
    asset_sha256: assetSha,
    candidate_image_id: candidateImageId,
    artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
    artist_name: sanitizeText(row?.artist_name || "", 255) || "",
    status: sanitizeText(row?.status || "", 32) || "draft",
    width,
    height,
    aspect_ratio: width && height ? Math.round((width / height) * 1000) / 1000 : null,
    bytes: optionalInt(row?.bytes),
    hero_url:
      (row?.r2_key_full ? joinUrl(base, row.r2_key_full) : null) ||
      adminPortraitUrl(base, assetSha, "full"),
    medium_url:
      (row?.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null) ||
      adminPortraitUrl(base, assetSha, "medium"),
    thumb_url:
      (row?.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null) ||
      adminPortraitUrl(base, assetSha, "thumb"),
    is_current: Number(row?.is_current || 0) > 0,
    is_stale: Number(row?.is_stale || 0) > 0,
    is_legacy: Number(row?.is_legacy || 0) > 0,
    autopick_eligible: Number(row?.autopick_eligible ?? 1) > 0,
    upvotes: Number(row?.upvotes || 0),
    downvotes: Number(row?.downvotes || 0),
    score,
    vote_count: voteCount,
    avg_vote: voteCount > 0 ? Math.round((score / voteCount) * 100) / 100 : 0,
    created_at: sanitizeText(row?.created_at || "", 64) || "",
  }
}

function normalizeAdminVisionAssetLimit(raw, fallback = 6, max = 48) {
  return Math.max(1, Math.min(max, Number.parseInt(String(raw || fallback), 10) || fallback))
}

async function fetchAdminVisionAssets(env, { base, visionIds = [], perVisionLimit = 6 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedVisionIds = Array.from(
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
  )
  if (!cleanedVisionIds.length) return []
  const cleanedLimit = normalizeAdminVisionAssetLimit(perVisionLimit, 6, 48)
  const assetResp = await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     ),
     ranked_assets AS (
       SELECT
         pa.vision_id,
         upper(pa.gene_symbol) AS gene_symbol,
         lower(pa.asset_sha256) AS asset_sha256,
         COALESCE(pa.artist_tag, '') AS artist_tag,
         COALESCE(pa.artist_name, '') AS artist_name,
         pa.candidate_image_id,
         lower(COALESCE(pa.status, 'draft')) AS status,
         pa.width,
         pa.height,
         pa.bytes,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.created_at, '') AS created_at,
         COALESCE(vs.upvotes, 0) AS upvotes,
         COALESCE(vs.downvotes, 0) AS downvotes,
         COALESCE(vs.score, 0) AS score,
         COALESCE(vs.vote_count, 0) AS vote_count,
         CASE
           WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
           ELSE 0
         END AS is_current,
         ROW_NUMBER() OVER (
           PARTITION BY pa.vision_id
           ORDER BY
             CASE
               WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
               ELSE 0
             END DESC,
             CASE lower(COALESCE(pa.status, 'draft'))
               WHEN 'approved' THEN 0
               WHEN 'draft' THEN 1
               WHEN 'rejected' THEN 2
               ELSE 3
             END ASC,
             COALESCE(vs.score, 0) DESC,
             COALESCE(vs.upvotes, 0) DESC,
             COALESCE(pa.created_at, '') DESC,
             lower(pa.asset_sha256) ASC
         ) AS row_num
       FROM icono_portrait_assets pa
       JOIN incoming i
         ON i.vision_id = pa.vision_id
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = upper(pa.gene_symbol)
        AND vs.asset_sha256 = lower(pa.asset_sha256)
       LEFT JOIN icono_publish_state ps
         ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
       WHERE COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
     )
     SELECT *
     FROM ranked_assets
     WHERE row_num <= ?
     ORDER BY vision_id ASC, row_num ASC`,
  )
    .bind(JSON.stringify(cleanedVisionIds), cleanedLimit)
    .all()
  return (Array.isArray(assetResp?.results) ? assetResp.results : []).map((row) =>
    mapAdminVisionAssetRow(base, row),
  )
}

async function fetchAdminVisionDetail(env, { base, visionId, assetLimit = 24 } = {}) {
  if (!env.ICONOPLASM_DB) return null
  const cleanedVisionId = validAdminRollupVisionId(visionId)
  if (!cleanedVisionId) return null
  const [summaryRows, assets] = await Promise.all([
    fetchAdminVisionStatsDirect(env, { visionIds: [cleanedVisionId] }),
    fetchAdminVisionAssets(env, {
      base,
      visionIds: [cleanedVisionId],
      perVisionLimit: normalizeAdminVisionAssetLimit(assetLimit, 24, 240),
    }),
  ])
  const summary = Array.isArray(summaryRows) ? summaryRows[0] || null : null
  if (!summary) return null
  return {
    vision: summary,
    assets,
  }
}

function groupAdminVisionPreviewRows(summaryRows, assetRows) {
  const assetMap = new Map()
  for (const asset of Array.isArray(assetRows) ? assetRows : []) {
    const visionId = validAdminRollupVisionId(asset?.vision_id || "")
    if (!visionId) continue
    const existing = assetMap.get(visionId) || []
    existing.push(asset)
    assetMap.set(visionId, existing)
  }
  return (Array.isArray(summaryRows) ? summaryRows : []).map((row) => ({
    vision_id: row.vision_id,
    artist_tag: row.artist_tag,
    artist_name: row.artist_name,
    image_count: row.image_count,
    assets: assetMap.get(row.vision_id) || [],
  }))
}

async function fetchAdminVisionStatsDirect(env, { visionIds = [] } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedVisionIds = Array.from(
    new Set((Array.isArray(visionIds) ? visionIds : []).map((value) => validAdminRollupVisionId(value)).filter(Boolean)),
  )
  const applyFilter = cleanedVisionIds.length > 0
  const statsResp = await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     )
     SELECT
       pa.vision_id,
       MAX(NULLIF(pa.artist_tag, '')) AS artist_tag,
       MAX(NULLIF(pa.artist_name, '')) AS artist_name,
       COUNT(*) AS image_count,
       COALESCE(AVG(
         CASE
           WHEN COALESCE(vs.vote_count, 0) > 0 THEN 1.0 * COALESCE(vs.score, 0) / vs.vote_count
           ELSE NULL
         END
       ), 0) AS avg_vote,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
       COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS rejection_rate,
       COALESCE(SUM(COALESCE(vs.upvotes, 0)), 0) AS upvotes,
       COALESCE(SUM(COALESCE(vs.downvotes, 0)), 0) AS downvotes,
       COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score,
       COALESCE(SUM(
         CASE
           WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
           ELSE 0
         END
       ), 0) AS live_count,
       MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = upper(pa.gene_symbol)
      AND vs.asset_sha256 = lower(pa.asset_sha256)
     LEFT JOIN icono_publish_state ps
       ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     WHERE COALESCE(pa.vision_id, '') <> ''
       AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
       AND (
         ? = 0
         OR pa.vision_id IN (SELECT vision_id FROM incoming)
       )
     GROUP BY pa.vision_id
     ORDER BY live_count DESC, score DESC, image_count DESC, pa.vision_id ASC`,
  )
    .bind(JSON.stringify(cleanedVisionIds), applyFilter ? 1 : 0)
    .all()
  return mapAdminVisionStatsRows(statsResp?.results)
}

async function fetchAdminVisionStats(env, { visionIds = [] } = {}) {
  if (!env.ICONOPLASM_DB) return { rows: [], blacklisted: [] }

  const cleanedVisionIds = Array.from(
    new Set((Array.isArray(visionIds) ? visionIds : []).map((value) => validAdminRollupVisionId(value)).filter(Boolean)),
  )
  const [bootstrapState, blacklistResp] = await Promise.all([
    fetchAdminReadModelBootstrapState(env),
    env.ICONOPLASM_DB.prepare(
    `SELECT artist_tag, artist_name, reason, created_by, created_at, updated_at
     FROM icono_artist_style_blacklist
     ORDER BY updated_at DESC, artist_tag ASC`,
    ).all(),
  ])

  const bootstrapRunning =
    bootstrapState && bootstrapState.status !== ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE

  let rows = []
  if (!bootstrapRunning) {
    const applyFilter = cleanedVisionIds.length > 0
    const statsResp = await env.ICONOPLASM_DB.prepare(
      `WITH incoming AS (
         SELECT value AS vision_id
         FROM json_each(?)
       )
       SELECT *
       FROM icono_admin_vision_rollup
       WHERE (
         ? = 0
         OR vision_id IN (SELECT vision_id FROM incoming)
       )
       ORDER BY live_count DESC, score DESC, image_count DESC, vision_id ASC`,
    )
      .bind(JSON.stringify(cleanedVisionIds), applyFilter ? 1 : 0)
      .all()
    rows = mapAdminVisionStatsRows(statsResp?.results)
  }

  // When the big gene-centric bootstrap is still running, the vision rollup is only
  // partially populated. In that state we would rather do one direct grouped read
  // over the indexed raw asset table than serve a silently incomplete scorecard.
  if (bootstrapRunning || rows.length === 0) {
    rows = await fetchAdminVisionStatsDirect(env, { visionIds: cleanedVisionIds })
  }

  return {
    rows,
    blacklisted: (Array.isArray(blacklistResp?.results) ? blacklistResp.results : []).map(
      (row) => ({
        artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
        artist_name: sanitizeText(row?.artist_name || "", 255) || "",
        reason: sanitizeText(row?.reason || "", 2000) || "",
        created_by: sanitizeText(row?.created_by || "", 255) || "",
        created_at: sanitizeText(row?.created_at || "", 64) || "",
        updated_at: sanitizeText(row?.updated_at || "", 64) || "",
      }),
    ),
  }
}

async function unpublishCurrentPortrait(env, { symbol, actorId, reason, fromAssetSha256 } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  const actorNorm = normalizeUserId(actorId || "artist_style_blacklist")
  const fromAssetSha = normalizeSha256(fromAssetSha256 || "")
  if (!symbolNorm || !fromAssetSha) return { ok: false, changed: false, code: "BAD_INPUT" }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
     VALUES (?, NULL, ?, CURRENT_TIMESTAMP, 1)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       current_asset_sha256 = NULL,
       admin_override = 1,
       updated_by = excluded.updated_by,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(symbolNorm, actorNorm)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_events (
       gene_symbol,
       from_asset_sha256,
       to_asset_sha256,
       action,
       actor,
       reason,
       created_at
     ) VALUES (?, ?, NULL, 'unpublish', ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(symbolNorm, fromAssetSha, actorNorm, String(reason || "").slice(0, 2000) || null)
    .run()

  return { ok: true, changed: true, code: "UNPUBLISHED", from_asset_sha256: fromAssetSha }
}

async function blacklistArtistStyle(
  env,
  {
    artistTag,
    artistName = "",
    actorId = "artist_style_blacklist",
    reason = "",
    dryRun = false,
  } = {},
) {
  if (!env.ICONOPLASM_DB) throw new Error("ICONOPLASM_DB binding missing")
  const artistTagNorm = normalizeArtistTag(artistTag)
  if (!artistTagNorm) throw new Error("Missing or invalid artist_tag")
  const artistNameNorm = sanitizeText(artistName || "", 255) || null
  const actorNorm = normalizeUserId(actorId || "artist_style_blacklist")
  const reasonNorm =
    sanitizeText(reason || "", 2000) || `Removed blacklisted artist style ${artistTagNorm}`

  const affectedRowsRaw = await env.ICONOPLASM_DB.prepare(
    `SELECT
       upper(pa.gene_symbol) AS gene_symbol,
       lower(pa.asset_sha256) AS asset_sha256,
       lower(COALESCE(pa.status, '')) AS status,
       CASE
         WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
         ELSE 0
       END AS is_current
     FROM icono_portrait_assets pa
     LEFT JOIN icono_publish_state ps
       ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
     WHERE lower(COALESCE(pa.artist_tag, '')) = ?`,
  )
    .bind(artistTagNorm)
    .all()
  const affectedRows = Array.isArray(affectedRowsRaw?.results) ? affectedRowsRaw.results : []
  const affectedSymbols = new Set()
  const publishedSymbols = new Map()
  let visibleCount = 0
  for (const row of affectedRows) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    const assetSha = normalizeSha256(row?.asset_sha256 || "")
    if (!symbol || !assetSha) continue
    affectedSymbols.add(symbol)
    if (String(row?.status || "") !== "rejected") visibleCount += 1
    if (Number(row?.is_current || 0) > 0) publishedSymbols.set(symbol, assetSha)
  }

  if (!dryRun) {
    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_artist_style_blacklist (
         artist_tag,
         artist_name,
         reason,
         created_by,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(artist_tag) DO UPDATE SET
         artist_name = COALESCE(excluded.artist_name, icono_artist_style_blacklist.artist_name),
         reason = excluded.reason,
         created_by = excluded.created_by,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(artistTagNorm, artistNameNorm, reasonNorm, actorNorm)
      .run()

    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_portrait_assets
       SET status = 'rejected',
           is_stale = 0,
           is_legacy = 0,
           autopick_eligible = 0
       WHERE lower(COALESCE(artist_tag, '')) = ?`,
    )
      .bind(artistTagNorm)
      .run()
  }

  const promotions = []
  const unpublished = []
  for (const [symbol, assetSha] of publishedSymbols.entries()) {
    if (dryRun) continue
    const promoteResult = await autoPromoteTopVotedPortrait(env, {
      symbol,
      actorId: actorNorm,
      reason: `artist_style_blacklist:${artistTagNorm}`,
    })
    if (promoteResult?.changed) {
      promotions.push({ symbol, ...promoteResult })
      continue
    }
    const unpublishResult = await unpublishCurrentPortrait(env, {
      symbol,
      actorId: actorNorm,
      reason: reasonNorm,
      fromAssetSha256: assetSha,
    })
    unpublished.push({ symbol, ...unpublishResult })
  }

  return {
    ok: true,
    dry_run: dryRun,
    artist_tag: artistTagNorm,
    artist_name: artistNameNorm,
    affected_symbols: Array.from(affectedSymbols),
    affected_assets: affectedRows.length,
    affected_visible_assets: visibleCount,
    affected_genes: affectedSymbols.size,
    affected_live_genes: publishedSymbols.size,
    promoted_genes: promotions.length,
    unpublished_genes: unpublished.length,
    promotions,
    unpublished,
  }
}

function normalizeGalleryOrder(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (value === "popular") return "popularity"
  if (["votes", "uniqueness", "popularity", "newest", "random"].includes(value)) return value
  return "votes"
}

function normalizeGalleryLimit(raw) {
  return Math.max(1, Math.min(60, Number.parseInt(String(raw || "30"), 10) || 30))
}

function normalizeGalleryOffset(raw) {
  return Math.max(0, Number.parseInt(String(raw || "0"), 10) || 0)
}

function normalizeGallerySeed(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
  return value ? value.slice(0, 48) : null
}

function wikiPageviewsForSymbol(symbol) {
  const key = normalizeSymbol(symbol)
  if (!key) return 0
  return Number(ICONOPLASM_WIKI_PAGEVIEWS[key] || 0)
}

function compareNullableTextDesc(a, b) {
  return String(b || "").localeCompare(String(a || ""))
}

function compareNullableTextAsc(a, b) {
  return String(a || "").localeCompare(String(b || ""))
}

function compareGalleryPopularityFallback(left, right) {
  return (
    Number(right.popularity_score || 0) - Number(left.popularity_score || 0) ||
    Number(right.image_score || 0) - Number(left.image_score || 0) ||
    Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
    compareNullableTextDesc(
      left.published_at || left.asset_created_at,
      right.published_at || right.asset_created_at,
    ) ||
    compareNullableTextAsc(left.symbol, right.symbol)
  )
}

function clearGallerySnapshotCache() {
  gallerySnapshotCache.catalogHash = null
  gallerySnapshotCache.base = null
  gallerySnapshotCache.loadedAt = 0
  gallerySnapshotCache.items = []
  gallerySnapshotCache.publishedTotal = 0
  gallerySnapshotCache.sorted = new Map()
}

async function currentGalleryVersion(env) {
  const now = Date.now()
  if (
    galleryVersionCache.loadedAt > 0 &&
    now - galleryVersionCache.loadedAt < GALLERY_VERSION_CACHE_TTL_MS
  ) {
    return galleryVersionCache.value || "0"
  }
  if (!env.KV) {
    galleryVersionCache.loadedAt = now
    return galleryVersionCache.value || "0"
  }
  try {
    const raw = await env.KV.get(KV_GALLERY_VERSION)
    galleryVersionCache.value = String(raw || "0").trim() || "0"
  } catch {
    galleryVersionCache.value = galleryVersionCache.value || "0"
  }
  galleryVersionCache.loadedAt = now
  return galleryVersionCache.value || "0"
}

async function bumpGalleryVersion(env) {
  const next = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  galleryVersionCache.value = next
  galleryVersionCache.loadedAt = Date.now()
  if (env.KV) {
    await env.KV.put(KV_GALLERY_VERSION, next)
  }
  return next
}

async function invalidateGalleryCache(env) {
  clearGallerySnapshotCache()
  await bumpGalleryVersion(env)
}

async function syncAdminReadModelsAndInvalidateGallery(
  env,
  { symbols = [], visionIds = [], fullVision = false, fullRebuild = false } = {},
) {
  await syncAdminReadModels(env, { symbols, visionIds, fullVision, fullRebuild })
  await invalidateGalleryCache(env)
}

function galleryCanUseEdgeCache(url) {
  const order = normalizeGalleryOrder(url.searchParams.get("order"))
  if (order !== "random") return true
  return Boolean(normalizeGallerySeed(url.searchParams.get("seed")))
}

async function galleryEdgeCacheKey(url, env) {
  const keyUrl = new URL("/__edge/iconoplasm/gallery", url.origin)
  const order = normalizeGalleryOrder(url.searchParams.get("order"))
  const limit = normalizeGalleryLimit(url.searchParams.get("limit"))
  const offset = normalizeGalleryOffset(url.searchParams.get("offset"))
  const seed = order === "random" ? normalizeGallerySeed(url.searchParams.get("seed")) : null
  keyUrl.searchParams.set("v", await currentGalleryVersion(env))
  keyUrl.searchParams.set("order", order)
  keyUrl.searchParams.set("limit", String(limit))
  keyUrl.searchParams.set("offset", String(offset))
  if (seed) keyUrl.searchParams.set("seed", seed)
  return new Request(keyUrl.toString(), { method: "GET" })
}

function galleryRandomRank(seed, symbol) {
  const input = `${seed || "iconoplasm"}|${normalizeSymbol(symbol) || ""}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function buildGalleryUniquenessIndex(catalogBySymbol, essenceRows) {
  const clanCounts = new Map()
  const originsBySymbol = new Map()
  const rows = Array.isArray(essenceRows) ? essenceRows : []
  for (const row of rows) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol || !(catalogBySymbol instanceof Map) || !catalogBySymbol.has(symbol)) continue
    let origins = []
    try {
      const parsed = JSON.parse(String(row?.aesthetics_origin_json || "[]"))
      origins = normalizeTextList(parsed)
    } catch {
      origins = []
    }
    if (!origins.length) continue
    originsBySymbol.set(symbol, origins)
    for (const clan of origins) {
      clanCounts.set(clan, Number(clanCounts.get(clan) || 0) + 1)
    }
  }

  const out = new Map()
  for (const [symbol, origins] of originsBySymbol.entries()) {
    let dominantClanSize = 0
    for (const clan of origins) {
      dominantClanSize = Math.max(dominantClanSize, Number(clanCounts.get(clan) || 0))
    }
    if (dominantClanSize > 0) {
      out.set(symbol, dominantClanSize)
    }
  }
  return out
}

function sortGalleryItems(items, order, seed = null) {
  const sorted = Array.isArray(items) ? items.slice() : []
  sorted.sort((left, right) => {
    if (order === "newest") {
      // Keep popularity as the first fallback for newest.
      // Many gallery items share the same publish timestamp or no timestamp at all,
      // and alphabetical fallback made "newest" feel like reverse-A-to-Z browsing.
      return (
        compareNullableTextDesc(
          left.published_at || left.asset_created_at,
          right.published_at || right.asset_created_at,
        ) || compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "random") {
      return (
        galleryRandomRank(seed, left.symbol) - galleryRandomRank(seed, right.symbol) ||
        compareNullableTextAsc(left.symbol, right.symbol)
      )
    }
    if (order === "uniqueness") {
      const leftRank = Number.isFinite(Number(left.uniqueness_rank))
        ? Number(left.uniqueness_rank)
        : null
      const rightRank = Number.isFinite(Number(right.uniqueness_rank))
        ? Number(right.uniqueness_rank)
        : null
      if (leftRank == null && rightRank == null) {
        return compareGalleryPopularityFallback(left, right)
      }
      if (leftRank == null) return 1
      if (rightRank == null) return -1
      return leftRank - rightRank || compareGalleryPopularityFallback(left, right)
    }
    if (order === "popularity") {
      return compareGalleryPopularityFallback(left, right)
    }
    return (
      Number(right.image_score || 0) - Number(left.image_score || 0) ||
      Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
      Number(right.popularity_score || 0) - Number(left.popularity_score || 0) ||
      compareNullableTextDesc(
        left.published_at || left.asset_created_at,
        right.published_at || right.asset_created_at,
      ) ||
      compareNullableTextAsc(left.symbol, right.symbol)
    )
  })
  return sorted
}

async function gallerySnapshot(env, url) {
  await warmCatalogCache(env)
  const catalogTotal = catalogCache.bySymbol.size
  const base = portraitBase(url, env)
  const now = Date.now()
  const cacheFresh =
    gallerySnapshotCache.catalogHash === catalogCache.hash &&
    gallerySnapshotCache.base === base &&
    now - gallerySnapshotCache.loadedAt < GALLERY_SNAPSHOT_TTL_MS &&
    gallerySnapshotCache.items.length > 0
  if (cacheFresh) {
    return {
      items: gallerySnapshotCache.items,
      published_total: gallerySnapshotCache.publishedTotal,
      catalog_total: catalogTotal,
    }
  }

  if (!env.ICONOPLASM_DB) {
    clearGallerySnapshotCache()
    return {
      items: [],
      published_total: 0,
      catalog_total: catalogTotal,
    }
  }

  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT
       ps.gene_symbol AS symbol,
       ps.updated_at AS published_at,
       pa.created_at AS asset_created_at,
       pa.asset_sha256,
       pa.candidate_image_id,
      pa.vision_id,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       pa.width,
       pa.height,
       COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS image_upvotes,
       COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS image_downvotes,
       COALESCE(SUM(iv.vote_value), 0) AS image_score
     FROM icono_publish_state ps
     JOIN icono_portrait_assets pa
       ON pa.gene_symbol = ps.gene_symbol
      AND pa.asset_sha256 = ps.current_asset_sha256
     LEFT JOIN icono_image_votes iv
       ON iv.gene_symbol = ps.gene_symbol
      AND iv.asset_sha256 = pa.asset_sha256
     WHERE ps.current_asset_sha256 IS NOT NULL
     GROUP BY
       ps.gene_symbol,
       ps.updated_at,
       pa.created_at,
       pa.asset_sha256,
      pa.candidate_image_id,
      pa.vision_id,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       pa.width,
       pa.height`,
  ).all()

  const publishedRows = Array.isArray(rows?.results) ? rows.results : []
  const publishedMap = new Map()
  for (const row of publishedRows) {
    const symbol = normalizeSymbol(row?.symbol || "") || ""
    if (!symbol) continue
    const width = optionalInt(row?.width)
    const height = optionalInt(row?.height)
    publishedMap.set(symbol, {
      width,
      height,
      image_upvotes: Number(row?.image_upvotes || 0),
      image_downvotes: Number(row?.image_downvotes || 0),
      image_score: Number(row?.image_score || 0),
      published_at: row?.published_at ? String(row.published_at) : null,
      asset_created_at: row?.asset_created_at ? String(row.asset_created_at) : null,
      ph: row?.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      pt: row?.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      portrait: {
        status: "published",
        hero_url: row?.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
        medium_url: row?.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
        thumb_url: row?.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
        asset_sha256: row?.asset_sha256 ? String(row.asset_sha256) : null,
        candidate_image_id: optionalInt(row?.candidate_image_id),
        vision_id: String(row?.vision_id || "").trim() || null,
        artist_id: publicArtistIdForRow(row) || null,
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
      },
    })
  }

  // Source of truth note: uniqueness must stay based on the synced NiceGUI
  // mapping/demographics pipeline. aesthetics_origin_json is the stored clan list.
  // Do not invent a separate website-only clan resolver here.
  const uniquenessRowsRaw = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, aesthetics_origin_json
       FROM icono_gene_essence`,
  ).all()
  const uniquenessRows = Array.isArray(uniquenessRowsRaw?.results) ? uniquenessRowsRaw.results : []
  const uniquenessBySymbol = buildGalleryUniquenessIndex(catalogCache.bySymbol, uniquenessRows)

  const items = []
  for (const [symbol, cached] of catalogCache.bySymbol.entries()) {
    const published = publishedMap.get(symbol) || null
    const uniquenessRank = uniquenessBySymbol.get(symbol)
    const fullName = String(cached?.n || symbol || "").trim() || symbol
    const color = String(cached?.c || "#888").trim() || "#888"
    items.push({
      symbol,
      color,
      full_name: fullName,
      uniqueness_rank: Number.isFinite(Number(uniquenessRank)) ? Number(uniquenessRank) : null,
      width: published?.width ?? null,
      height: published?.height ?? null,
      popularity_score: wikiPageviewsForSymbol(symbol),
      image_upvotes: Number(published?.image_upvotes || 0),
      image_downvotes: Number(published?.image_downvotes || 0),
      image_score: Number(published?.image_score || 0),
      published_at: published?.published_at || null,
      asset_created_at: published?.asset_created_at || null,
      ph: published?.ph || null,
      pt: published?.pt || null,
      portrait: published?.portrait || null,
    })
  }

  gallerySnapshotCache.catalogHash = catalogCache.hash
  gallerySnapshotCache.base = base
  gallerySnapshotCache.loadedAt = now
  gallerySnapshotCache.items = items
  gallerySnapshotCache.publishedTotal = publishedRows.length
  gallerySnapshotCache.sorted = new Map()

  return {
    items,
    published_total: publishedRows.length,
    catalog_total: catalogTotal,
  }
}

async function galleryFeed(env, url, rawOrder, rawLimit, rawOffset, rawSeed) {
  const order = normalizeGalleryOrder(rawOrder)
  const limit = normalizeGalleryLimit(rawLimit)
  const offset = normalizeGalleryOffset(rawOffset)
  const seed =
    order === "random" ? normalizeGallerySeed(rawSeed) || crypto.randomUUID().slice(0, 12) : null
  const snapshot = await gallerySnapshot(env, url)
  if (!env.ICONOPLASM_DB) {
    return {
      order,
      seed,
      total: 0,
      published_total: 0,
      offset,
      limit,
      has_more: false,
      catalog_total: snapshot.catalog_total,
      items: [],
    }
  }

  const sortKey = `${order}:${seed || ""}`
  let sorted = gallerySnapshotCache.sorted.get(sortKey)
  if (!sorted) {
    sorted = sortGalleryItems(snapshot.items, order, seed)
    gallerySnapshotCache.sorted.set(sortKey, sorted)
  }
  const pageItems = sorted.slice(offset, offset + limit)

  return {
    order,
    ...(seed ? { seed } : {}),
    total: snapshot.catalog_total,
    published_total: snapshot.published_total,
    offset,
    limit,
    has_more: offset + limit < sorted.length,
    catalog_total: snapshot.catalog_total,
    items: pageItems,
  }
}

async function portraitCandidatesForGene(env, url, symbol, currentAssetSha256 = null) {
  if (!env.ICONOPLASM_DB) return []
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       pa.width,
       pa.height,
       pa.status,
       pa.autopick_eligible,
       pa.created_at,
       pa.candidate_image_id,
       pa.vision_id,
       pa.artist_id,
       COALESCE(v.upvotes, 0) AS image_upvotes,
       COALESCE(v.downvotes, 0) AS image_downvotes,
       COALESCE(v.score, 0) AS image_score
     FROM icono_portrait_assets pa
     LEFT JOIN (
       SELECT
         candidate_ref,
         SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
         SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
         SUM(vote_value) AS score
       FROM icono_image_votes
       GROUP BY candidate_ref
     ) v
       ON v.candidate_ref = ('a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256))
     WHERE upper(pa.gene_symbol) = ?
       AND COALESCE(pa.status, '') <> 'rejected'
       AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
     ORDER BY pa.created_at DESC`,
  )
    .bind(symbol)
    .all()

  const base = portraitBase(url, env)
  const currentSha = normalizeSha256(currentAssetSha256 || "")
  const items = (Array.isArray(rows?.results) ? rows.results : []).map((row) => {
    const assetSha = normalizeSha256(row?.asset_sha256 || "") || null
    const width = optionalInt(row?.width)
    const height = optionalInt(row?.height)
    return {
      asset_sha256: assetSha,
      status: String(row?.status || "").trim() || "draft",
      autopick_eligible: coerceBoolean(row?.autopick_eligible, true),
      is_current: !!(assetSha && currentSha && assetSha === currentSha),
      candidate_image_id: optionalInt(row?.candidate_image_id),
      vision_id: String(row?.vision_id || "").trim() || null,
      artist_id: publicArtistIdForRow(row) || null,
      image_upvotes: Number(row?.image_upvotes || 0),
      image_downvotes: Number(row?.image_downvotes || 0),
      image_score: Number(row?.image_score || 0),
      created_at: row?.created_at ? String(row.created_at) : null,
      full_url: row?.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      medium_url: row?.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      thumb_url: row?.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    }
  })

  items.sort((left, right) => {
    return (
      Number(right.is_current) - Number(left.is_current) ||
      Number(right.image_score || 0) - Number(left.image_score || 0) ||
      Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
      compareNullableTextDesc(left.created_at, right.created_at) ||
      compareNullableTextAsc(left.asset_sha256, right.asset_sha256)
    )
  })

  return items
}

async function handleCatalogManifest(request, env) {
  if (!env.KV) return json({ error: "KV binding missing" }, 500)
  const url = new URL(request.url)
  const manifest = await extensionManifestObj(url, env)
  if (!manifest)
    return json({ error: "Catalog manifest not found — run iconoplasm catalog publish" }, 404)
  const body = JSON.stringify(manifest)
  const etag = manifest.current_hash ? `"${manifest.current_hash}"` : null
  if (etag && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" },
    })
  }
  return new Response(body, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ...(etag ? { ETag: etag } : {}),
    },
  })
}

async function handleCatalogArtifact(env, path) {
  const m = path.match(/\/api\/catalog\/catalog\.([a-z0-9-]+)\.json$/i)
  if (!m) return json({ error: "Invalid artifact path" }, 400)
  if (!env.KV) return json({ error: "KV binding missing" }, 500)
  const hash = String(m[1] || "").split("-")[0]
  const body = await env.KV.get(`${KV_CATALOG_PREFIX}${hash}`)
  if (!body) return json({ error: "Artifact not found" }, 404)
  let responseBody = body
  try {
    const artifact = JSON.parse(body)
    const hydrated = mergePublishedPortraitRefsIntoArtifact(
      artifact,
      await publishedPortraitRefs(env),
    )
    responseBody = JSON.stringify(hydrated)
  } catch {
    responseBody = body
  }
  return new Response(responseBody, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    },
  })
}

async function loadCatalogRowsForPublish(env) {
  if (!env.ICONOPLASM_DB) throw new Error("ICONOPLASM_DB binding missing")
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, full_name, uniprot, color_hex, tmh
     FROM icono_gene_catalog
     ORDER BY gene_symbol ASC`,
  ).all()
  const results = Array.isArray(rows?.results) ? rows.results : []
  if (!results.length) throw new Error("Catalog table is empty")

  const genes = []
  const seenSymbols = new Set()
  const seenUniprot = new Map()
  for (const row of results) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    const fullName = sanitizeText(row?.full_name, 255)
    const uniprot = normalizeUniprot(row?.uniprot || null)
    const colorHex = normalizeHexColor(row?.color_hex || null)
    const tmh = coerceBoolean(row?.tmh, false)
    if (!symbol) throw new Error("Catalog contains invalid gene_symbol")
    if (!fullName) throw new Error(`Catalog row ${symbol} is missing full_name`)
    if (seenSymbols.has(symbol)) throw new Error(`Duplicate catalog symbol ${symbol}`)
    seenSymbols.add(symbol)
    if (uniprot) {
      const sibling = seenUniprot.get(uniprot)
      if (sibling && sibling !== symbol) {
        throw new Error(`Duplicate catalog UniProt ${uniprot} for ${sibling} and ${symbol}`)
      }
      seenUniprot.set(uniprot, symbol)
    }
    const entry = { s: symbol, n: fullName, tmh }
    if (uniprot) entry.u = uniprot
    if (colorHex) entry.c = colorHex
    genes.push(entry)
  }
  return genes
}

async function publishCatalogArtifact(env) {
  if (!env.KV) throw new Error("KV binding missing")
  const genes = await loadCatalogRowsForPublish(env)
  const artifact = {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    gene_count: genes.length,
    genes,
  }
  const hydrated = mergePublishedPortraitRefsIntoArtifact(
    artifact,
    await publishedPortraitRefs(env),
  )
  const artifactJson = JSON.stringify(hydrated)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifactJson))
  const hash = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12)
  const filename = `catalog.${hash}.json`
  const manifest = {
    current_hash: hash,
    filename,
    generated_at: hydrated.generated_at,
    schema_version: hydrated.schema_version,
    canonical_key: "symbol",
    gene_count: hydrated.gene_count,
  }

  await env.KV.put(`${KV_CATALOG_PREFIX}${hash}`, artifactJson)
  await env.KV.put(KV_CATALOG_MANIFEST, JSON.stringify(manifest))

  catalogCache.hash = null
  catalogCache.bySymbol = new Map()
  catalogCache.symbolByUniprot = new Map()
  catalogCache.loadedAt = 0
  await invalidateGalleryCache(env)

  return {
    ok: true,
    current_hash: hash,
    filename,
    gene_count: hydrated.gene_count,
    schema_version: hydrated.schema_version,
  }
}

export async function handleIconoplasmRequest(request, env, ctx) {
  const started = Date.now()
  const url = new URL(request.url)
  const path = url.pathname
  const done = async (route, res, schema = null) => {
    const out = asHead(request, res)
    await logReq(route, request, out.status, started, schema)
    return out
  }

  try {
    if (request.method === "OPTIONS")
      return done("options", new Response(null, { status: 204, headers: corsHeaders() }))
    if (!["GET", "HEAD", "POST"].includes(request.method))
      return done("method", json({ error: "Method not allowed" }, 405))

    if (path === "/health" || path === "/api/health") {
      return done(
        "health",
        json({ status: "ok", service: "iconoplasm" }, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/api/manifest") {
      const retry = rateLimit(request, "manifest", 60)
      if (retry)
        return done(
          "manifest_rl",
          json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, {
            "Retry-After": String(retry),
          }),
        )
      const m = await extensionManifestObj(url, env)
      if (!m)
        return done(
          "manifest_404",
          json({ error: "Catalog manifest not found — run iconoplasm catalog publish" }, 404),
        )
      const payload = {
        schema_version: API_SCHEMA_VERSION,
        canonical_key: "symbol",
        current_hash: m.current_hash || null,
        filename: m.filename || null,
        generated_at: m.generated_at || null,
        gene_count: m.gene_count || null,
        artifact_schema_version: m.schema_version || 1,
        portrait_base_url: m.portrait_base_url || portraitBase(url, env),
        min_extension_version: env.ICONOPLASM_MIN_EXTENSION_VERSION || MIN_EXTENSION_VERSION,
      }
      const etag = payload.current_hash ? `"${payload.current_hash}"` : await etagFor(payload)
      if (etagMatches(request.headers.get("If-None-Match"), etag)) {
        return done(
          "manifest_304",
          new Response(null, {
            status: 304,
            headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" },
          }),
          API_SCHEMA_VERSION,
        )
      }
      return done(
        "manifest",
        json(payload, 200, { ETag: etag, "Cache-Control": "public, max-age=300" }),
        API_SCHEMA_VERSION,
      )
    }

    if (path.startsWith("/api/gene/")) {
      const retry = rateLimit(request, "gene", 240)
      if (retry)
        return done(
          "gene_rl",
          json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, {
            "Retry-After": String(retry),
          }),
        )
      const rawId = path.slice("/api/gene/".length)
      const resolved = await resolveGene(env, rawId)
      if (!resolved) return done("gene_404", json({ error: "Gene not found" }, 404))
      const canonicalPath = `/api/gene/${encodeURIComponent(resolved.symbol)}`
      if (path !== canonicalPath)
        return done("gene_redirect", Response.redirect(`${url.origin}${canonicalPath}`, 302))
      const payload = await geneRecord(env, url, resolved.symbol)
      const etag = await etagFor(payload)
      if (etagMatches(request.headers.get("If-None-Match"), etag)) {
        return done(
          "gene_304",
          new Response(null, {
            status: 304,
            headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=120" },
          }),
          API_SCHEMA_VERSION,
        )
      }
      return done(
        "gene",
        json(payload, 200, { ETag: etag, "Cache-Control": "public, max-age=120" }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === "/api/gallery") {
      const retry = rateLimit(request, "gallery", 60)
      if (retry)
        return done(
          "gallery_rl",
          json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, {
            "Retry-After": String(retry),
          }),
        )
      const edgeCacheable = request.method === "GET" && galleryCanUseEdgeCache(url)
      const cache = edgeCacheable ? caches.default : null
      const cacheKey = edgeCacheable ? await galleryEdgeCacheKey(url, env) : null
      if (cache && cacheKey) {
        const cached = await cache.match(cacheKey)
        if (cached) {
          return done("gallery_cached", cached, API_SCHEMA_VERSION)
        }
      }
      const payload = await galleryFeed(
        env,
        url,
        url.searchParams.get("order"),
        url.searchParams.get("limit"),
        url.searchParams.get("offset"),
        url.searchParams.get("seed"),
      )
      const response = json(payload, 200, { "Cache-Control": "public, max-age=60, s-maxage=60" })
      if (cache && cacheKey) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()))
      }
      return done("gallery", response, API_SCHEMA_VERSION)
    }

    // Random gene sample for the homepage grid
    if (path === "/api/genes/random") {
      const retry = rateLimit(request, "genes_random", 30)
      if (retry)
        return done(
          "genes_random_rl",
          json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, {
            "Retry-After": String(retry),
          }),
        )
      await warmCatalogCache(env)
      const count = Math.max(
        1,
        Math.min(120, Number.parseInt(url.searchParams.get("count") || "60", 10)),
      )
      const allSymbols = Array.from(catalogCache.bySymbol.keys())
      const shuffled = allSymbols.sort(() => Math.random() - 0.5).slice(0, count)
      const base = portraitBase(url, env)
      const genes = shuffled.map((s) => {
        const g = catalogCache.bySymbol.get(s)
        const entry = { symbol: s, color: g?.c || "#888", full_name: g?.n || s }
        if (g?.pt) entry.pt = joinUrl(base, g.pt)
        if (g?.ph) entry.ph = joinUrl(base, g.ph)
        return entry
      })
      return done(
        "genes_random",
        json({ genes, total: allSymbols.length }, 200, { "Cache-Control": "public, max-age=60" }),
      )
    }

    // Search genes by symbol prefix or full name substring
    if (path === "/api/genes/search") {
      const retry = rateLimit(request, "genes_search", 120)
      if (retry)
        return done(
          "genes_search_rl",
          json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, {
            "Retry-After": String(retry),
          }),
        )
      const q = (url.searchParams.get("q") || "").trim().toUpperCase()
      if (!q) return done("genes_search_empty", json({ genes: [], query: "" }, 200))
      await warmCatalogCache(env)
      const limit = Math.max(
        1,
        Math.min(100, Number.parseInt(url.searchParams.get("limit") || "20", 10)),
      )
      const results = []
      // Prioritize symbol-prefix matches, then name-substring matches
      const prefixMatches = []
      const nameMatches = []
      const base = portraitBase(url, env)
      for (const [s, g] of catalogCache.bySymbol) {
        if (s.startsWith(q)) {
          const entry = { symbol: s, color: g?.c || "#888", full_name: g?.n || s }
          if (g?.pt) entry.pt = joinUrl(base, g.pt)
          if (g?.ph) entry.ph = joinUrl(base, g.ph)
          prefixMatches.push(entry)
        } else if (g?.n && g.n.toUpperCase().includes(q)) {
          const entry = { symbol: s, color: g?.c || "#888", full_name: g?.n || s }
          if (g?.pt) entry.pt = joinUrl(base, g.pt)
          if (g?.ph) entry.ph = joinUrl(base, g.ph)
          nameMatches.push(entry)
        }
        if (prefixMatches.length + nameMatches.length >= limit * 2) break
      }
      const genes = [...prefixMatches, ...nameMatches].slice(0, limit)
      return done(
        "genes_search",
        json({ genes, query: q }, 200, { "Cache-Control": "public, max-age=30" }),
      )
    }

    if (path.startsWith("/portraits/")) {
      if (!env.ICONOPLASM_PORTRAITS)
        return done("portrait_no_binding", json({ error: "Portrait bucket not configured" }, 404))
      const key = path.replace(/^\/+/, "")
      const obj = await env.ICONOPLASM_PORTRAITS.get(key)
      if (!obj) return done("portrait_404", json({ error: "Portrait not found" }, 404))
      return done(
        "portrait",
        new Response(obj.body, {
          headers: {
            "Content-Type": obj.httpMetadata?.contentType || "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: `"${obj.httpEtag || key}"`,
            "Access-Control-Allow-Origin": "*",
          },
        }),
      )
    }

    if (path === "/api/iconoplasm/votes/me" && request.method === "GET") {
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "votes_me_guest",
          json(
            {
              authenticated: false,
              user: null,
            },
            200,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      return done(
        "votes_me",
        json(
          {
            authenticated: true,
            user: {
              id: sessionUser.user_id,
              username: sessionUser.username || null,
            },
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/votes/set" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done("votes_set_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "votes_set_401",
          json({ ok: false, code: "AUTH_REQUIRED", error: "Please log-in first to vote." }, 401, {
            "Cache-Control": "no-store",
          }),
        )
      }

      let p
      try {
        p = await request.json()
      } catch {
        return done("votes_set_400", json({ error: "Invalid JSON" }, 400))
      }

      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      const assetSha = normalizeSha256(p?.asset_sha256 || p?.sha256 || "")
      const candidateImageId = optionalInt(p?.candidate_image_id ?? p?.emulsion_id)
      const candidateRef = normalizeCandidateRef(
        p?.candidate_ref || (p?.candidate_image_id ? `c:${String(p.candidate_image_id)}` : ""),
        symbol,
        assetSha,
      )
      const visionId = normalizeVisionId(p?.vision_id || "")
      const requested = normalizeVoteValue(p?.vote_value)
      if (!candidateRef)
        return done(
          "votes_set_400",
          json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400),
        )
      if (!symbol) return done("votes_set_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha)
        return done("votes_set_400", json({ error: "Missing or invalid asset_sha256" }, 400))
      if (requested === null)
        return done("votes_set_400", json({ error: "vote_value must be -1, 0, or 1" }, 400))
      if (isRandomArtistMetavisionId(visionId)) {
        return done(
          "votes_set_400",
          json({ error: "Metavision IDs are not valid for vote writes" }, 400),
        )
      }

      const userId = normalizeUserId(sessionUser.user_id)
      const existing = await env.ICONOPLASM_DB.prepare(
        `SELECT vote_value
         FROM icono_image_votes
         WHERE candidate_ref = ?
           AND user_id = ?
         LIMIT 1`,
      )
        .bind(candidateRef, userId)
        .first()
      const current = Number(existing?.vote_value || 0)

      if (requested === 0 || current === requested) {
        await env.ICONOPLASM_DB.prepare(
          `DELETE FROM icono_image_votes
           WHERE candidate_ref = ?
             AND user_id = ?`,
        )
          .bind(candidateRef, userId)
          .run()
      } else {
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_image_votes (
             candidate_ref, gene_symbol, asset_sha256, vision_id, candidate_image_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             candidate_image_id = COALESCE(excluded.candidate_image_id, icono_image_votes.candidate_image_id),
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, candidateImageId, userId, requested)
          .run()
      }

      const autoPromote = await autoPromoteTopVotedPortrait(env, {
        symbol,
        actorId: userId,
        reason: "vote_auto_promote",
      })

      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
      await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
      return done(
        "votes_set",
        json(
          {
            ok: true,
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
            candidate_image_id: candidateImageId,
            user_id: userId,
            snapshot,
            auto_promote: autoPromote,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done("votes_snapshot_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p
      try {
        p = await request.json()
      } catch {
        return done("votes_snapshot_400", json({ error: "Invalid JSON" }, 400))
      }
      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      const assetSha = normalizeSha256(p?.asset_sha256 || p?.sha256 || "")
      const candidateImageId = optionalInt(p?.candidate_image_id ?? p?.emulsion_id)
      const candidateRef = normalizeCandidateRef(
        p?.candidate_ref || (p?.candidate_image_id ? `c:${String(p.candidate_image_id)}` : ""),
        symbol,
        assetSha,
      )
      const visionId = sanitizeVoteVisionId(p?.vision_id || "")
      if (!candidateRef)
        return done(
          "votes_snapshot_400",
          json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400),
        )
      if (!symbol)
        return done("votes_snapshot_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha)
        return done("votes_snapshot_400", json({ error: "Missing or invalid asset_sha256" }, 400))

      const sessionUser = await iconoplasmSessionUser(request, env)
      const userId = sessionUser?.user_id ? normalizeUserId(sessionUser.user_id) : "__guest__"
      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
      return done(
        "votes_snapshot",
        json(
          {
            ok: true,
            authenticated: Boolean(sessionUser?.user_id),
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
            snapshot,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/import" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_import_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_votes_import_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_import_400", json({ error: "Invalid JSON" }, 400))
      }
      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length)
        return done("admin_votes_import_400", json({ error: "No items provided" }, 400))
      if (items.length > 20000)
        return done("admin_votes_import_400", json({ error: "Too many items (max 20000)" }, 400))

      let upserted = 0
      let deleted = 0
      let invalid = 0
      const touchedSymbols = new Set()
      for (const raw of items) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        const candidateImageId = optionalInt(raw?.candidate_image_id ?? raw?.emulsion_id)
        const candidateRef = normalizeCandidateRef(
          raw?.candidate_ref ||
            (raw?.candidate_image_id ? `c:${String(raw.candidate_image_id)}` : ""),
          symbol,
          assetSha,
        )
        const visionId = normalizeVisionId(raw?.vision_id || "")
        const userId = normalizeUserId(raw?.user_id || raw?.user || "local")
        const voteValue = normalizeVoteValue(raw?.vote_value)
        if (isRandomArtistMetavisionId(visionId)) {
          invalid += 1
          continue
        }
        if (!candidateRef || !symbol || !assetSha || !userId || voteValue === null) {
          invalid += 1
          continue
        }
        touchedSymbols.add(symbol)
        if (voteValue === 0) {
          await env.ICONOPLASM_DB.prepare(
            `DELETE FROM icono_image_votes
             WHERE candidate_ref = ?
               AND user_id = ?`,
          )
            .bind(candidateRef, userId)
            .run()
          deleted += 1
          continue
        }
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_image_votes (
             candidate_ref, gene_symbol, asset_sha256, vision_id, candidate_image_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             candidate_image_id = COALESCE(excluded.candidate_image_id, icono_image_votes.candidate_image_id),
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, candidateImageId, userId, voteValue)
          .run()
        upserted += 1
      }

      let autoPromoted = 0
      for (const symbol of touchedSymbols) {
        const result = await autoPromoteTopVotedPortrait(env, {
          symbol,
          actorId: "admin_import",
          reason: "vote_import_auto_promote",
        })
        if (result?.changed) autoPromoted += 1
      }

      await syncAdminReadModelsAndInvalidateGallery(env, { symbols: Array.from(touchedSymbols) })
      return done(
        "admin_votes_import",
        json(
          {
            ok: true,
            total: items.length,
            upserted,
            deleted,
            invalid,
            auto_promoted: autoPromoted,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/set" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_set_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_votes_set_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_set_400", json({ error: "Invalid JSON" }, 400))
      }

      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      const assetSha = normalizeSha256(p?.asset_sha256 || p?.sha256 || "")
      const candidateRef = normalizeCandidateRef(
        p?.candidate_ref || (p?.candidate_image_id ? `c:${String(p.candidate_image_id)}` : ""),
        symbol,
        assetSha,
      )
      const visionId = normalizeVisionId(p?.vision_id || "")
      const userId = normalizeUserId(p?.user_id || p?.user || "local")
      const requested = normalizeVoteValue(p?.vote_value)
      if (!candidateRef)
        return done(
          "admin_votes_set_400",
          json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400),
        )
      if (!symbol)
        return done("admin_votes_set_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha)
        return done("admin_votes_set_400", json({ error: "Missing or invalid asset_sha256" }, 400))
      if (requested === null)
        return done("admin_votes_set_400", json({ error: "vote_value must be -1, 0, or 1" }, 400))
      if (isRandomArtistMetavisionId(visionId)) {
        return done(
          "admin_votes_set_400",
          json({ error: "Metavision IDs are not valid for vote writes" }, 400),
        )
      }
      if (isGuestUserId(userId)) {
        return done(
          "admin_votes_set_401",
          json({ ok: false, code: "AUTH_REQUIRED", error: "Please log-in first to vote." }, 401, {
            "Cache-Control": "no-store",
          }),
        )
      }

      const existing = await env.ICONOPLASM_DB.prepare(
        `SELECT vote_value
         FROM icono_image_votes
         WHERE candidate_ref = ?
           AND user_id = ?
         LIMIT 1`,
      )
        .bind(candidateRef, userId)
        .first()
      const current = Number(existing?.vote_value || 0)

      if (requested === 0 || current === requested) {
        await env.ICONOPLASM_DB.prepare(
          `DELETE FROM icono_image_votes
           WHERE candidate_ref = ?
             AND user_id = ?`,
        )
          .bind(candidateRef, userId)
          .run()
      } else {
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_image_votes (
             candidate_ref, gene_symbol, asset_sha256, vision_id, candidate_image_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             candidate_image_id = COALESCE(excluded.candidate_image_id, icono_image_votes.candidate_image_id),
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, candidateImageId, userId, requested)
          .run()
      }

      const autoPromote = await autoPromoteTopVotedPortrait(env, {
        symbol,
        actorId: userId,
        reason: "admin_vote_auto_promote",
      })

      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
      await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
      return done(
        "admin_votes_set",
        json(
          {
            ok: true,
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
            candidate_image_id: candidateImageId,
            user_id: userId,
            snapshot,
            auto_promote: autoPromote,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/snapshot" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_snapshot_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_snapshot_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_snapshot_400", json({ error: "Invalid JSON" }, 400))
      }
      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      const assetSha = normalizeSha256(p?.asset_sha256 || p?.sha256 || "")
      const candidateRef = normalizeCandidateRef(
        p?.candidate_ref || (p?.candidate_image_id ? `c:${String(p.candidate_image_id)}` : ""),
        symbol,
        assetSha,
      )
      const visionId = sanitizeVoteVisionId(p?.vision_id || "")
      const userId = normalizeUserId(p?.user_id || p?.user || "local")
      if (!candidateRef)
        return done(
          "admin_votes_snapshot_400",
          json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400),
        )
      if (!symbol)
        return done("admin_votes_snapshot_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha)
        return done(
          "admin_votes_snapshot_400",
          json({ error: "Missing or invalid asset_sha256" }, 400),
        )

      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
      return done(
        "admin_votes_snapshot",
        json(
          {
            ok: true,
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
            user_id: userId,
            snapshot,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/snapshots" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_snapshots_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_snapshots_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_snapshots_400", json({ error: "Invalid JSON" }, 400))
      }
      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length)
        return done("admin_votes_snapshots_400", json({ error: "No items provided" }, 400))
      if (items.length > 5000)
        return done("admin_votes_snapshots_400", json({ error: "Too many items (max 5000)" }, 400))
      const userId = normalizeUserId(p?.user_id || p?.user || "local")

      const deduped = []
      const seen = new Set()
      for (const raw of items) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        const candidateRef = normalizeCandidateRef(
          raw?.candidate_ref ||
            (raw?.candidate_image_id ? `c:${String(raw.candidate_image_id)}` : ""),
          symbol,
          assetSha,
        )
        const visionId = sanitizeVoteVisionId(raw?.vision_id || "")
        if (!candidateRef || !symbol || !assetSha) continue
        const key = `${candidateRef}|${visionId}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push({
          candidate_ref: candidateRef,
          symbol,
          asset_sha256: assetSha,
          vision_id: visionId,
        })
      }

      // optimize/harden: the Website Ops sync asks for thousands of snapshots at
      // once. Keep this set-based so scan_local does not stall behind per-item D1
      // round-trips.
      const snapshots = await iconoVoteSnapshotsBatch(env, { items: deduped, userId })

      return done(
        "admin_votes_snapshots",
        json(
          {
            ok: true,
            user_id: userId,
            count: snapshots.length,
            snapshots,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (
      path === "/api/iconoplasm/admin/votes/vision-stats" &&
      (request.method === "POST" || request.method === "GET")
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_vision_stats_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_vision_stats_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p = {}
      if (request.method === "POST") {
        try {
          p = await request.json()
        } catch {
          return done("admin_votes_vision_stats_400", json({ error: "Invalid JSON" }, 400))
        }
      }
      const visionIdsRaw = Array.isArray(p?.vision_ids)
        ? p.vision_ids
        : String(url.searchParams.get("vision_ids") || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
      const visionIds = []
      const seenVision = new Set()
      for (const raw of visionIdsRaw) {
        const visionId = sanitizeVoteVisionId(raw)
        if (!visionId || seenVision.has(visionId)) continue
        seenVision.add(visionId)
        visionIds.push(visionId)
      }
      if (visionIds.length > 2000) {
        return done(
          "admin_votes_vision_stats_400",
          json({ error: "Too many vision_ids (max 2000)" }, 400),
        )
      }
      const visionStats = await fetchAdminVisionStats(env, { visionIds })
      const rows = visionStats.rows
      return done(
        "admin_votes_vision_stats",
        json(
          {
            ok: true,
            count: rows.length,
            rows,
            blacklisted: visionStats.blacklisted,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (
      path === "/api/iconoplasm/admin/votes/vision-previews" &&
      (request.method === "POST" || request.method === "GET")
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_vision_previews_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_vision_previews_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p = {}
      if (request.method === "POST") {
        try {
          p = await request.json()
        } catch {
          return done("admin_votes_vision_previews_400", json({ error: "Invalid JSON" }, 400))
        }
      }
      const visionIdsRaw = Array.isArray(p?.vision_ids)
        ? p.vision_ids
        : String(url.searchParams.get("vision_ids") || "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)
      const visionIds = []
      const seenVision = new Set()
      for (const raw of visionIdsRaw) {
        const visionId = sanitizeVoteVisionId(raw)
        if (!visionId || seenVision.has(visionId)) continue
        seenVision.add(visionId)
        visionIds.push(visionId)
      }
      if (visionIds.length > 250) {
        return done(
          "admin_votes_vision_previews_400",
          json({ error: "Too many vision_ids (max 250)" }, 400),
        )
      }
      const previewLimit = normalizeAdminVisionAssetLimit(
        p?.limit ?? url.searchParams.get("limit"),
        6,
        12,
      )
      const [visionRows, assetRows] = await Promise.all([
        fetchAdminVisionStatsDirect(env, { visionIds }),
        fetchAdminVisionAssets(env, { base: url.origin, visionIds, perVisionLimit: previewLimit }),
      ])
      const rows = groupAdminVisionPreviewRows(visionRows, assetRows)
      return done(
        "admin_votes_vision_previews",
        json(
          {
            ok: true,
            count: rows.length,
            limit: previewLimit,
            rows,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/vision-detail" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_vision_detail_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_vision_detail_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const visionId = sanitizeVoteVisionId(url.searchParams.get("vision_id") || "")
      if (!visionId) {
        return done(
          "admin_votes_vision_detail_400",
          json({ error: "Missing or invalid vision_id" }, 400),
        )
      }
      const assetLimit = normalizeAdminVisionAssetLimit(url.searchParams.get("limit"), 24, 60)
      const detail = await fetchAdminVisionDetail(env, {
        base: url.origin,
        visionId,
        assetLimit,
      })
      if (!detail) {
        return done(
          "admin_votes_vision_detail_404",
          json({ error: "Vision not found" }, 404),
        )
      }
      return done(
        "admin_votes_vision_detail",
        json(
          {
            ok: true,
            detail,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/artist-styles/search" && request.method === "GET") {
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_styles_search_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const query = String(url.searchParams.get("q") || "")
      const limit = Math.max(
        1,
        Math.min(100, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
      )
      const rows = await searchArtistStyles(env, { query, limit })
      return done(
        "artist_styles_search",
        json(
          {
            ok: true,
            query,
            count: rows.length,
            rows,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/artist-styles") {
      return done(
        "artist_styles_page",
        html(ICONOPLASM_ARTIST_STYLES_HTML, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/admin") {
      if (!(await isAdmin(request, env)))
        return done("admin_403", html("<h1>403 Unauthorized</h1>", 403))
      return done("admin", html(ICONOPLASM_ADMIN_HTML, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/iconoplasm/admin/artist-styles/remove" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("artist_styles_remove_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_styles_remove_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("artist_styles_remove_400", json({ error: "Invalid JSON" }, 400))
      }
      const artistTag = normalizeArtistTag(p?.artist_tag || p?.artistTag || "")
      if (!artistTag)
        return done(
          "artist_styles_remove_400",
          json({ error: "Missing or invalid artist_tag" }, 400),
        )
      const artistName = sanitizeText(p?.artist_name || p?.artistName || "", 255) || ""
      const reason = sanitizeText(p?.reason || "", 2000) || ""
      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      try {
        const result = await blacklistArtistStyle(env, {
          artistTag,
          artistName,
          actorId: await actor(request, env),
          reason,
          dryRun,
        })
        if (!dryRun)
          await syncAdminReadModelsAndInvalidateGallery(env, {
            symbols: Array.isArray(result.affected_symbols) ? result.affected_symbols : [],
          })
        return done("artist_styles_remove", json(result, 200, { "Cache-Control": "no-store" }))
      } catch (error) {
        return done(
          "artist_styles_remove_400",
          json({ error: String(error?.message || error || "Artist style removal failed") }, 400),
        )
      }
    }

    if (path === "/api/iconoplasm/admin/read-models/bootstrap") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_read_models_bootstrap_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_read_models_bootstrap_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      if (request.method === "GET") {
        const state = await fetchAdminReadModelBootstrapState(env)
        return done(
          "admin_read_models_bootstrap_get",
          json({ ok: true, state }, 200, { "Cache-Control": "no-store" }),
        )
      }

      if (request.method === "POST") {
        let p = {}
        try {
          p = await request.json()
        } catch {
          return done(
            "admin_read_models_bootstrap_400",
            json({ error: "Invalid JSON" }, 400),
          )
        }

        const reset = coerceBoolean(p?.reset ?? p?.restart, false)
        const steps = normalizeAdminReadModelBootstrapSteps(p?.steps)
        const symbolBatch = normalizeAdminReadModelSymbolBatch(
          p?.symbol_batch ?? p?.symbolBatch,
        )
        const visionBatch = normalizeAdminReadModelVisionBatch(
          p?.vision_batch ?? p?.visionBatch,
        )

        let latest = null
        let processedSymbols = 0
        let processedVisions = 0
        try {
          for (let index = 0; index < steps; index++) {
            latest = await runAdminReadModelBootstrapStep(env, {
              reset: reset && index === 0,
              symbolBatch,
              visionBatch,
            })
            processedSymbols += Number(latest?.processed?.symbols || 0)
            processedVisions += Number(latest?.processed?.visions || 0)
            if (!latest?.advanced || latest?.state?.status === ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE)
              break
          }
        } catch (error) {
          const state = await ensureAdminReadModelBootstrapInitialized(env)
          await writeAdminReadModelBootstrapState(env, {
            ...state,
            last_error: String(error?.message || error || "bootstrap failed").slice(0, 2000),
          })
          throw error
        }

        return done(
          "admin_read_models_bootstrap_post",
          json(
            {
              ok: true,
              steps,
              processed_symbols: processedSymbols,
              processed_visions: processedVisions,
              state: latest?.state || (await fetchAdminReadModelBootstrapState(env)),
            },
            200,
            { "Cache-Control": "no-store" },
          ),
        )
      }

      return done(
        "admin_read_models_bootstrap_405",
        json({ error: "Method not allowed" }, 405),
      )
    }

    if (path === "/api/iconoplasm/admin/overview" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_overview_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_overview_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const eventLimit = Math.max(
        0,
        Math.min(100, Number.parseInt(url.searchParams.get("event_limit") || "24", 10)),
      )
      let overview
      const base = portraitBase(url, env)
      try {
        overview = await fetchAdminOverview(env, { eventLimit })
      } catch (error) {
        console.error(
          "admin_overview_failed",
          error?.stack || error?.message || String(error || "unknown error"),
        )
        throw error
      }
      const recentEvents = (overview.recent_events || []).map((row) => ({
        id: Number(row?.id || 0),
        symbol: normalizeSymbol(row?.gene_symbol || "") || "",
        from_asset_sha256: normalizeSha256(row?.from_asset_sha256 || "") || null,
        to_asset_sha256: normalizeSha256(row?.to_asset_sha256 || "") || null,
        action: sanitizeText(row?.action || "", 64) || "",
        actor: sanitizeText(row?.actor || "", 255) || "",
        reason: sanitizeText(row?.reason || "", 2000) || "",
        created_at: sanitizeText(row?.created_at || "", 64) || "",
        thumb_url:
          adminPortraitUrl(base, row?.to_asset_sha256 || "", "thumb") ||
          adminPortraitUrl(base, row?.from_asset_sha256 || "", "thumb"),
      }))

      return done(
        "admin_overview",
        json(
          {
            ok: true,
            summary: overview.summary || {},
            attention: Array.isArray(overview.attention) ? overview.attention : [],
            recent_events: recentEvents,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/coverage" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_coverage_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_coverage_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const coverage = await fetchAdminCoverage(env)
      return done(
        "admin_coverage",
        json({ ok: true, ...coverage }, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/api/iconoplasm/admin/gallery" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_gallery_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_gallery_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const page = normalizeAdminGalleryPage(url.searchParams.get("page") || "1")
      const limit = normalizeAdminGalleryLimit(url.searchParams.get("limit") || "100")
      const filter = normalizeAdminGalleryFilter(url.searchParams.get("filter") || "all")
      const sort = normalizeAdminGallerySort(url.searchParams.get("sort") || "name")
      const mode = normalizeAdminGalleryMode(url.searchParams.get("mode") || "live")
      const query = String(url.searchParams.get("query") || url.searchParams.get("q") || "")

      const gallery = await fetchAdminGallery(env, url, {
        page,
        limit,
        filter,
        sort,
        mode,
        query,
      })
      return done(
        "admin_gallery",
        json(
          {
            ok: true,
            page: gallery.page,
            limit: gallery.limit,
            total: gallery.total,
            count: gallery.count,
            mode: gallery.mode,
            rows: gallery.rows,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    const adminGeneMatch = path.match(/^\/api\/iconoplasm\/admin\/gene\/([^/]+)$/)
    if (adminGeneMatch && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_gene_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_gene_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const symbol = normalizeSymbol(adminGeneMatch[1])
      if (!symbol) return done("admin_gene_400", json({ error: "Invalid symbol" }, 400))

      const detail = await fetchAdminGeneDetail(env, url, symbol)
      if (!detail) return done("admin_gene_404", json({ error: "Gene not found" }, 404))

      return done("admin_gene", json({ ok: true, ...detail }, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/iconoplasm/admin/canon-audit" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_canon_audit_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_canon_audit_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const limit = Math.max(
        1,
        Math.min(4000, Number.parseInt(url.searchParams.get("limit") || "1500", 10)),
      )
      const eventLimit = Math.max(
        0,
        Math.min(200, Number.parseInt(url.searchParams.get("event_limit") || "40", 10)),
      )
      const base = portraitBase(url, env)
      const audit = await fetchAdminCanonAudit(env, { limit, eventLimit })
      const rows = (audit.rows || []).map((row) => {
        const symbol = normalizeSymbol(row?.gene_symbol || "")
        const currentAssetSha = normalizeSha256(row?.current_asset_sha256 || "") || null
        const currentResolvedAssetSha =
          normalizeSha256(row?.current_resolved_asset_sha256 || "") || null
        const leaderAssetSha = normalizeSha256(row?.leader_asset_sha256 || "") || null
        const drift = Boolean(
          currentResolvedAssetSha && leaderAssetSha && currentResolvedAssetSha !== leaderAssetSha,
        )
        const missingCurrentAsset = Boolean(currentAssetSha && !currentResolvedAssetSha)
        return {
          symbol,
          popularity_score: wikiPageviewsForSymbol(symbol),
          current_asset_sha256: currentAssetSha,
          current_asset_missing: missingCurrentAsset,
          admin_override: Number(row?.admin_override || 0) > 0,
          total_assets: Number(row?.total_assets || 0),
          rejected_assets: Number(row?.rejected_assets || 0),
          stale_assets: Number(row?.stale_assets || 0),
          legacy_assets: Number(row?.legacy_assets || 0),
          eligible_assets: Number(row?.eligible_assets || 0),
          drift,

          current: currentResolvedAssetSha
            ? {
                asset_sha256: currentResolvedAssetSha,
                status: sanitizeText(row?.current_status || "", 32) || "",
                is_stale: Number(row?.current_is_stale || 0) > 0,
                is_legacy: Number(row?.current_is_legacy || 0) > 0,
                vision_id: sanitizeText(row?.current_vision_id || "", 255) || "",
                artist_tag: sanitizeText(row?.current_artist_tag || "", 255) || "",
                artist_name: sanitizeText(row?.current_artist_name || "", 255) || "",
                upvotes: Number(row?.current_upvotes || 0),
                downvotes: Number(row?.current_downvotes || 0),
                score: Number(row?.current_score || 0),
                created_at: sanitizeText(row?.current_created_at || "", 64) || "",
                hero_url: row?.current_r2_key_full ? joinUrl(base, row.current_r2_key_full) : null,
                medium_url: row?.current_r2_key_medium
                  ? joinUrl(base, row.current_r2_key_medium)
                  : null,
                thumb_url: row?.current_r2_key_thumb
                  ? joinUrl(base, row.current_r2_key_thumb)
                  : null,
              }
            : null,

          leader: leaderAssetSha
            ? {
                asset_sha256: leaderAssetSha,
                status: sanitizeText(row?.leader_status || "", 32) || "",
                is_stale: Number(row?.leader_is_stale || 0) > 0,
                is_legacy: Number(row?.leader_is_legacy || 0) > 0,
                vision_id: sanitizeText(row?.leader_vision_id || "", 255) || "",
                artist_tag: sanitizeText(row?.leader_artist_tag || "", 255) || "",
                artist_name: sanitizeText(row?.leader_artist_name || "", 255) || "",
                upvotes: Number(row?.leader_upvotes || 0),
                downvotes: Number(row?.leader_downvotes || 0),
                score: Number(row?.leader_score || 0),
                created_at: sanitizeText(row?.leader_created_at || "", 64) || "",
                hero_url: row?.leader_r2_key_full ? joinUrl(base, row.leader_r2_key_full) : null,
                medium_url: row?.leader_r2_key_medium
                  ? joinUrl(base, row.leader_r2_key_medium)
                  : null,
                thumb_url: row?.leader_r2_key_thumb ? joinUrl(base, row.leader_r2_key_thumb) : null,
              }
            : null,
        }
      })

      const summary = {
        genes: rows.length,
        with_live: rows.filter((row) => row.current_asset_sha256).length,
        overrides: rows.filter((row) => row.admin_override).length,
        drift: rows.filter((row) => row.drift).length,
        current_asset_missing: rows.filter((row) => row.current_asset_missing).length,
        no_live: rows.filter((row) => !row.current_asset_sha256).length,
        stale_assets: rows.reduce((sum, row) => sum + Number(row.stale_assets || 0), 0),
        legacy_assets: rows.reduce((sum, row) => sum + Number(row.legacy_assets || 0), 0),
      }

      const recentEvents = (audit.recent_events || []).map((row) => ({
        id: Number(row?.id || 0),
        symbol: normalizeSymbol(row?.gene_symbol || "") || "",
        from_asset_sha256: normalizeSha256(row?.from_asset_sha256 || "") || null,
        to_asset_sha256: normalizeSha256(row?.to_asset_sha256 || "") || null,
        action: sanitizeText(row?.action || "", 64) || "",
        actor: sanitizeText(row?.actor || "", 255) || "",
        reason: sanitizeText(row?.reason || "", 2000) || "",
        created_at: sanitizeText(row?.created_at || "", 64) || "",
      }))

      return done(
        "admin_canon_audit",
        json(
          {
            ok: true,
            summary,
            count: rows.length,
            rows,
            recent_events: recentEvents,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/assets" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_assets_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const status = (url.searchParams.get("status") || "all").toLowerCase()
      const stale = (url.searchParams.get("stale") || "all").toLowerCase()
      const legacy = (url.searchParams.get("legacy") || "all").toLowerCase()
      const symbolQuery = normalizeSymbol(url.searchParams.get("symbol") || "")
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
      )
      const whereParts = []
      const params = []
      if (symbolQuery) {
        whereParts.push("upper(pa.gene_symbol)=?")
        params.push(symbolQuery)
      }
      if (status !== "all") {
        whereParts.push("lower(pa.status)=?")
        params.push(status)
      }
      if (stale === "yes") whereParts.push("COALESCE(is_stale, 0) = 1")
      else if (stale === "no") whereParts.push("COALESCE(is_stale, 0) = 0")
      if (legacy === "yes") whereParts.push("COALESCE(is_legacy, 0) = 1")
      else if (legacy === "no") whereParts.push("COALESCE(is_legacy, 0) = 0")
      const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : ""
      const stmt = env.ICONOPLASM_DB.prepare(
        `WITH vote_agg AS (
           SELECT
             upper(gene_symbol) AS gene_symbol,
             lower(asset_sha256) AS asset_sha256,
             SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
             SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
             SUM(vote_value) AS score
           FROM icono_image_votes
           GROUP BY upper(gene_symbol), lower(asset_sha256)
         )
         SELECT
           pa.gene_symbol,
           pa.asset_sha256,
           pa.r2_key_full,
           pa.r2_key_medium,
           pa.r2_key_thumb,
           pa.status,
           pa.autopick_eligible,
           COALESCE(pa.is_stale, 0) AS is_stale,
           COALESCE(pa.is_legacy, 0) AS is_legacy,
           pa.vision_id,
           pa.artist_tag,
           pa.artist_name,
           pa.created_by,
           pa.created_at,
           COALESCE(v.upvotes, 0) AS image_upvotes,
           COALESCE(v.downvotes, 0) AS image_downvotes,
           COALESCE(v.score, 0) AS image_score,
           CASE
             WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
             ELSE 0
           END AS is_current,
           COALESCE(ps.admin_override, 0) AS admin_override,
           0 AS is_vote_leader
         FROM icono_portrait_assets pa
         LEFT JOIN vote_agg v
           ON v.gene_symbol = upper(pa.gene_symbol)
          AND v.asset_sha256 = lower(pa.asset_sha256)
         LEFT JOIN icono_publish_state ps
           ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
         ${where}
         ORDER BY
           is_current DESC,
           COALESCE(v.score, 0) DESC,
           COALESCE(v.upvotes, 0) DESC,
           pa.created_at DESC
         LIMIT ?`,
      ).bind(...params, limit)
      const { results } = await stmt.all()
      const base = portraitBase(url, env)
      const assets = (results || []).map((r) => ({
        ...r,
        is_stale: Number(r?.is_stale || 0) > 0,
        is_legacy: Number(r?.is_legacy || 0) > 0,
        is_current: Number(r?.is_current || 0) > 0,
        admin_override: Number(r?.admin_override || 0) > 0,
        is_vote_leader: Number(r?.is_vote_leader || 0) > 0,
        image_upvotes: Number(r?.image_upvotes || 0),
        image_downvotes: Number(r?.image_downvotes || 0),
        image_score: Number(r?.image_score || 0),
        hero_url: r.r2_key_full ? joinUrl(base, r.r2_key_full) : null,
        medium_url: r.r2_key_medium ? joinUrl(base, r.r2_key_medium) : null,
        thumb_url: r.r2_key_thumb ? joinUrl(base, r.r2_key_thumb) : null,
      }))
      return done(
        "admin_assets",
        json({ assets, count: assets.length }, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/api/iconoplasm/admin/assets/summary" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_summary_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_assets_summary_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const summaryRow = await env.ICONOPLASM_DB.prepare(
        `SELECT
            COUNT(*) AS candidate_assets,
            SUM(CASE WHEN COALESCE(is_stale, 0) = 1 THEN 1 ELSE 0 END) AS stale_assets,
            SUM(CASE WHEN COALESCE(is_legacy, 0) = 1 THEN 1 ELSE 0 END) AS legacy_assets
           FROM icono_portrait_assets`,
      ).first()
      return done(
        "admin_assets_summary",
        json(
          {
            ok: true,
            candidate_assets: Number(summaryRow?.candidate_assets || 0),
            stale_assets: Number(summaryRow?.stale_assets || 0),
            legacy_assets: Number(summaryRow?.legacy_assets || 0),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/assets/state" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_state_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_assets_state_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const resp = await env.ICONOPLASM_DB.prepare(
        `SELECT
           pa.gene_symbol,
           pa.asset_sha256,
           COALESCE(v.upvotes, 0) AS image_upvotes,
           COALESCE(v.downvotes, 0) AS image_downvotes,
           COALESCE(v.score, 0) AS image_score
         FROM icono_portrait_assets pa
         LEFT JOIN (
           SELECT
             candidate_ref,
             COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(SUM(vote_value), 0) AS score
           FROM icono_image_votes
           GROUP BY candidate_ref
         ) v
           ON v.candidate_ref = ('a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256))
         ORDER BY pa.gene_symbol ASC, pa.asset_sha256 ASC`,
      ).all()
      const assets = (Array.isArray(resp?.results) ? resp.results : [])
        .map((row) => ({
          symbol: normalizeSymbol(row?.gene_symbol || ""),
          asset_sha256: normalizeSha256(row?.asset_sha256 || ""),
          image_upvotes: Number(row?.image_upvotes || 0),
          image_downvotes: Number(row?.image_downvotes || 0),
          image_score: Number(row?.image_score || 0),
        }))
        .filter((row) => row.symbol && row.asset_sha256)
      return done(
        "admin_assets_state",
        json({ ok: true, count: assets.length, assets }, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/api/iconoplasm/admin/catalog/state" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_catalog_state_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_catalog_state_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const state = await fetchCatalogState(env)
      return done(
        "admin_catalog_state",
        json(
          {
            ok: true,
            gene_count: Number(state.gene_count || 0),
            content_hash: String(state.content_hash || ""),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/catalog/upsert" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_catalog_upsert_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_catalog_upsert_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_catalog_upsert_400", json({ error: "Invalid JSON" }, 400))
      }

      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length)
        return done("admin_catalog_upsert_400", json({ error: "No items provided" }, 400))
      if (items.length > 1000)
        return done("admin_catalog_upsert_400", json({ error: "Too many items (max 1000)" }, 400))

      const actorId = await actor(request, env)
      const source = sanitizeText(p?.source || "nicegui_catalog_sync", 64) || "nicegui_catalog_sync"
      let processed = 0
      let invalid = 0
      const results = []

      for (const rawItem of items) {
        const item = normalizeCatalogPayloadItem(rawItem)
        if (!item || item.validation_error) {
          invalid += 1
          results.push({
            ok: false,
            symbol:
              normalizeSymbol(rawItem?.symbol || rawItem?.gene_symbol || "") || item?.symbol || "",
            error: item?.validation_error || "Invalid catalog item",
          })
          continue
        }
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_gene_catalog (
             gene_symbol, full_name, uniprot, color_hex, tmh, source, updated_by, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(gene_symbol) DO UPDATE SET
             full_name=excluded.full_name,
             uniprot=excluded.uniprot,
             color_hex=excluded.color_hex,
             tmh=excluded.tmh,
             source=excluded.source,
             updated_by=excluded.updated_by,
             updated_at=CURRENT_TIMESTAMP`,
        )
          .bind(
            item.gene_symbol,
            item.full_name,
            item.uniprot || null,
            item.color_hex || null,
            item.tmh ? 1 : 0,
            source,
            actorId,
          )
          .run()
        processed += 1
        results.push({ ok: true, symbol: item.gene_symbol })
      }

      if (processed > 0) {
        await syncAdminReadModels(env, {
          symbols: results.filter((row) => row?.ok && row?.symbol).map((row) => row.symbol),
        })
      }

      return done(
        "admin_catalog_upsert",
        json(
          {
            ok: invalid === 0,
            processed,
            invalid,
            total: items.length,
            results,
          },
          invalid > 0 && processed === 0 ? 400 : 200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/catalog/reconcile" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_catalog_reconcile_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_catalog_reconcile_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_catalog_reconcile_400", json({ error: "Invalid JSON" }, 400))
      }

      const keepSymbolsRaw = Array.isArray(p?.keep_symbols) ? p.keep_symbols : []
      if (!keepSymbolsRaw.length)
        return done("admin_catalog_reconcile_400", json({ error: "No keep_symbols provided" }, 400))
      if (keepSymbolsRaw.length > 25000)
        return done(
          "admin_catalog_reconcile_400",
          json({ error: "Too many keep_symbols (max 25000)" }, 400),
        )
      const keepSymbols = new Set(
        keepSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean),
      )
      if (!keepSymbols.size)
        return done(
          "admin_catalog_reconcile_400",
          json({ error: "No valid keep_symbols provided" }, 400),
        )

      const currentRows = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol FROM icono_gene_catalog",
      ).all()
      const currentSymbols = Array.isArray(currentRows?.results) ? currentRows.results : []
      const toDelete = currentSymbols
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter((symbol) => symbol && !keepSymbols.has(symbol))

      for (const symbol of toDelete) {
        await env.ICONOPLASM_DB.prepare("DELETE FROM icono_gene_catalog WHERE upper(gene_symbol)=?")
          .bind(symbol)
          .run()
      }

      if (toDelete.length > 0) {
        await syncAdminReadModels(env, { symbols: toDelete })
      }

      return done(
        "admin_catalog_reconcile",
        json(
          {
            ok: true,
            kept: keepSymbols.size,
            deleted: toDelete.length,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/catalog/publish" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_catalog_publish_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_catalog_publish_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      if (!env.KV)
        return done("admin_catalog_publish_500", json({ error: "KV binding missing" }, 500))
      try {
        const result = await publishCatalogArtifact(env)
        return done("admin_catalog_publish", json(result, 200, { "Cache-Control": "no-store" }))
      } catch (error) {
        return done(
          "admin_catalog_publish_400",
          json({ error: String(error?.message || error || "Catalog publish failed") }, 400),
        )
      }
    }

    if (path === "/api/iconoplasm/admin/essence/upsert" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_essence_upsert_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_essence_upsert_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_essence_upsert_400", json({ error: "Invalid JSON" }, 400))
      }

      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length)
        return done("admin_essence_upsert_400", json({ error: "No items provided" }, 400))
      if (items.length > 1000)
        return done("admin_essence_upsert_400", json({ error: "Too many items (max 1000)" }, 400))

      const actorId = await actor(request, env)
      const source = sanitizeText(p?.source || "nicegui_sync", 64) || "nicegui_sync"
      let processed = 0
      let invalid = 0
      const results = []

      for (const rawItem of items) {
        const rawEssence =
          rawItem &&
          typeof rawItem === "object" &&
          rawItem.essence &&
          typeof rawItem.essence === "object"
            ? rawItem.essence
            : rawItem
        const symbolHint =
          rawItem && typeof rawItem === "object"
            ? rawItem.symbol ||
              rawItem.gene_symbol ||
              rawEssence?.symbol ||
              rawEssence?.gene_symbol ||
              ""
            : ""
        const essence = normalizeEssencePayload(rawEssence, symbolHint)
        if (!essence || essence.validation_error) {
          invalid += 1
          results.push({
            ok: false,
            symbol: normalizeSymbol(symbolHint) || essence?.gene_symbol || "",
            error: essence?.validation_error || "Invalid or empty essence payload",
          })
          continue
        }

        await upsertGeneEssence(env, essence, actorId, source)
        processed += 1
        results.push({
          ok: true,
          symbol: essence.gene_symbol,
        })
      }

      if (processed > 0) {
        await syncAdminReadModels(env, {
          symbols: results.filter((row) => row?.ok && row?.symbol).map((row) => row.symbol),
        })
      }

      return done(
        "admin_essence_upsert",
        json(
          {
            ok: invalid === 0,
            processed,
            invalid,
            total: items.length,
            results,
          },
          invalid > 0 && processed === 0 ? 400 : 200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/essence/state" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_essence_state_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_essence_state_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_essence_state_400", json({ error: "Invalid JSON" }, 400))
      }

      const rawSymbols = Array.isArray(p?.symbols) ? p.symbols : []
      if (rawSymbols.length > 25000)
        return done("admin_essence_state_400", json({ error: "Too many symbols (max 25000)" }, 400))

      const rows = await fetchEssenceStateRows(env, rawSymbols.length ? rawSymbols : null)
      return done(
        "admin_essence_state",
        json(
          {
            ok: true,
            count: rows.length,
            rows,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/ingest" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_ingest_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_ingest_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      if (!env.ICONOPLASM_PORTRAITS)
        return done(
          "admin_ingest_500",
          json({ error: "ICONOPLASM_PORTRAITS binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_ingest_400", json({ error: "Invalid JSON" }, 400))
      }

      const itemsRaw = Array.isArray(p?.items) ? p.items : [p]
      if (!itemsRaw.length)
        return done("admin_ingest_400", json({ error: "No items provided" }, 400))
      if (itemsRaw.length > 500)
        return done(
          "admin_ingest_400",
          json({ error: "Too many items (max 500 per request)" }, 400),
        )

      const actorId = await actor(request, env)
      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      const reasonDefault = String(p?.reason || "").slice(0, 2000) || null
      const createdByDefault = String(p?.created_by || p?.createdBy || actorId || "unknown").slice(
        0,
        255,
      )
      const base = portraitBase(url, env)
      const prefetchedExistingAssets = await iconoExistingAssetsBatch(env, itemsRaw)
      const prefetchedBlacklistRows = await iconoBlacklistRowsBatch(
        env,
        itemsRaw.map((item) => item?.artist_tag || item?.artistTag || ""),
      )

      const results = []
      let processed = 0
      let failed = 0
      const ingestConcurrency = dryRun ? 16 : 12

      const ingestOne = async (rawItem) => {
        try {
          const item = rawItem && typeof rawItem === "object" ? rawItem : {}
          const symbol = normalizeSymbol(item?.symbol || item?.gene_symbol || "")
          const assetSha = normalizeSha256(item?.asset_sha256 || item?.sha256 || "")
          if (!symbol) throw new Error("Missing or invalid symbol")
          if (!assetSha) throw new Error("Missing or invalid asset_sha256")

          const statusRequested = normalizeAssetStatus(item?.status, "draft")
          const reason = String(item?.reason || reasonDefault || "").slice(0, 2000) || null
          const createdBy = String(
            item?.created_by || item?.createdBy || createdByDefault || "unknown",
          ).slice(0, 255)

          const existingAsset = prefetchedExistingAssets.get(`${symbol}|${assetSha}`) || null
          const keys = {
            full: r2PortraitKey(assetSha, "full"),
            medium: r2PortraitKey(assetSha, "medium"),
            thumb: r2PortraitKey(assetSha, "thumb"),
          }
          // optimize/harden: repeated syncs should not re-probe and re-require
          // binary renditions for assets the website already knows about.
          const storedRenditionsPresent =
            Boolean(existingAsset?.r2_key_full) &&
            Boolean(existingAsset?.r2_key_medium) &&
            Boolean(existingAsset?.r2_key_thumb)
          let exists = {
            full: storedRenditionsPresent,
            medium: storedRenditionsPresent,
            thumb: storedRenditionsPresent,
          }
          let fullPayload = null
          let mediumPayload = null
          let thumbPayload = null
          let fullBytes = null
          let mediumBytes = null
          let thumbBytes = null
          if (!storedRenditionsPresent) {
            const [headFull, headMedium, headThumb] = await Promise.all([
              env.ICONOPLASM_PORTRAITS.head(keys.full),
              env.ICONOPLASM_PORTRAITS.head(keys.medium),
              env.ICONOPLASM_PORTRAITS.head(keys.thumb),
            ])
            exists = {
              full: Boolean(headFull),
              medium: Boolean(headMedium),
              thumb: Boolean(headThumb),
            }
          }
          if (!exists.full || !exists.medium || !exists.thumb) {
            fullPayload = extractRenditionPayload(item, "full")
            mediumPayload = extractRenditionPayload(item, "medium")
            thumbPayload = extractRenditionPayload(item, "thumb")
            fullBytes = extractRenditionBytes(fullPayload)
            mediumBytes = extractRenditionBytes(mediumPayload)
            thumbBytes = extractRenditionBytes(thumbPayload)
          }

          if (!dryRun) {
            const uploadTasks = []
            if (!exists.full) {
              if (!fullBytes) throw new Error("Missing full rendition payload for new upload")
              uploadTasks.push(
                env.ICONOPLASM_PORTRAITS.put(keys.full, fullBytes, {
                  httpMetadata: { contentType: "image/webp" },
                  customMetadata: {
                    gene_symbol: symbol,
                    asset_sha256: assetSha,
                    rendition: "full",
                  },
                }),
              )
            }
            if (!exists.medium) {
              if (!mediumBytes) throw new Error("Missing medium rendition payload for new upload")
              uploadTasks.push(
                env.ICONOPLASM_PORTRAITS.put(keys.medium, mediumBytes, {
                  httpMetadata: { contentType: "image/webp" },
                  customMetadata: {
                    gene_symbol: symbol,
                    asset_sha256: assetSha,
                    rendition: "medium",
                  },
                }),
              )
            }
            if (!exists.thumb) {
              if (!thumbBytes) throw new Error("Missing thumb rendition payload for new upload")
              uploadTasks.push(
                env.ICONOPLASM_PORTRAITS.put(keys.thumb, thumbBytes, {
                  httpMetadata: { contentType: "image/webp" },
                  customMetadata: {
                    gene_symbol: symbol,
                    asset_sha256: assetSha,
                    rendition: "thumb",
                  },
                }),
              )
            }
            if (uploadTasks.length > 0) {
              await Promise.all(uploadTasks)
            }
          }
          const visionId =
            sanitizeText(item?.vision_id || item?.vision || existingAsset?.vision_id || "", 255) ||
            null
          const candidateImageId =
            optionalInt(
              item?.candidate_image_id ?? item?.emulsion_id ?? existingAsset?.candidate_image_id,
            ) || null
          const artistTag =
            normalizeArtistTag(
              item?.artist_tag || item?.artistTag || existingAsset?.artist_tag || "",
            ) || null
          const artistName =
            sanitizeText(
              item?.artist_name || item?.artistName || existingAsset?.artist_name || "",
              255,
            ) || null
          const blacklistRow =
            (artistTag && prefetchedBlacklistRows.get(artistTag)) ||
            (artistTag ? await getArtistStyleBlacklistRow(env, artistTag) : null)
          const blacklisted = Boolean(blacklistRow)
          const width = optionalInt(item?.width ?? fullPayload?.width)
          const height = optionalInt(item?.height ?? fullPayload?.height)
          const bytes = optionalInt(item?.bytes ?? fullPayload?.bytes ?? fullBytes?.byteLength)
          const autopickEligibleRequested = item?.autopick_eligible ?? item?.autopickEligible
          const autopickEligibleBase =
            autopickEligibleRequested === undefined || autopickEligibleRequested === null
              ? coerceBoolean(existingAsset?.autopick_eligible, true)
              : coerceBoolean(autopickEligibleRequested, true)
          const autopickEligible = blacklisted ? false : autopickEligibleBase
          const existingStatus = normalizeAssetStatus(existingAsset?.status || "", "draft")
          let finalStatus = statusRequested
          if (
            finalStatus === "draft" &&
            (existingStatus === "approved" || existingStatus === "rejected")
          ) {
            finalStatus = existingStatus
          }
          if (blacklisted) finalStatus = "rejected"

          if (!dryRun) {
            await env.ICONOPLASM_DB.prepare(
              `INSERT INTO icono_portrait_assets (
                 gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
                 mime, width, height, bytes, status, autopick_eligible, is_stale, is_legacy,
                 vision_id, candidate_image_id, artist_tag, artist_name, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
                 r2_key_full=excluded.r2_key_full,
                 r2_key_medium=excluded.r2_key_medium,
                 r2_key_thumb=excluded.r2_key_thumb,
                 mime=excluded.mime,
                 width=COALESCE(excluded.width, icono_portrait_assets.width),
                 height=COALESCE(excluded.height, icono_portrait_assets.height),
                 bytes=COALESCE(excluded.bytes, icono_portrait_assets.bytes),
                 status=excluded.status,
                 autopick_eligible=excluded.autopick_eligible,
                 is_stale=0,
                 is_legacy=0,
                 vision_id=COALESCE(excluded.vision_id, icono_portrait_assets.vision_id),
                 candidate_image_id=COALESCE(excluded.candidate_image_id, icono_portrait_assets.candidate_image_id),
                 artist_tag=COALESCE(excluded.artist_tag, icono_portrait_assets.artist_tag),
                 artist_name=COALESCE(excluded.artist_name, icono_portrait_assets.artist_name),
                 created_by=COALESCE(excluded.created_by, icono_portrait_assets.created_by)`,
            )
              .bind(
                symbol,
                assetSha,
                keys.full,
                keys.medium,
                keys.thumb,
                width,
                height,
                bytes,
                finalStatus,
                autopickEligible ? 1 : 0,
                visionId,
                candidateImageId,
                artistTag,
                artistName,
                createdBy,
              )
              .run()
          }

          const essenceResult = "not_provided"

          const uploads = {
            full: exists.full
              ? "skipped_existing"
              : fullBytes
                ? dryRun
                  ? "would_upload"
                  : "uploaded"
                : "missing_payload",
            medium: exists.medium
              ? "skipped_existing"
              : mediumBytes
                ? dryRun
                  ? "would_upload"
                  : "uploaded"
                : "missing_payload",
            thumb: exists.thumb
              ? "skipped_existing"
              : thumbBytes
                ? dryRun
                  ? "would_upload"
                  : "uploaded"
                : "missing_payload",
          }

          return {
            ok: true,
            result: {
              ok: true,
              symbol,
              asset_sha256: assetSha,
              dry_run: dryRun,
              vision_id: visionId,
              artist_tag: artistTag,
              artist_name: artistName,
              status: finalStatus,
              autopick_eligible: autopickEligible,
              uploads,
              publish: "site_managed",
              blacklisted,
              blacklist_reason: sanitizeText(blacklistRow?.reason || "", 2000) || null,
              essence: essenceResult,
              hero_url: joinUrl(base, keys.full),
              medium_url: joinUrl(base, keys.medium),
              thumb_url: joinUrl(base, keys.thumb),
              r2_keys: keys,
            },
          }
        } catch (err) {
          const rawSymbol =
            rawItem && typeof rawItem === "object"
              ? rawItem.symbol || rawItem.gene_symbol || null
              : null
          const rawSha =
            rawItem && typeof rawItem === "object"
              ? rawItem.asset_sha256 || rawItem.sha256 || null
              : null
          return {
            ok: false,
            result: {
              ok: false,
              symbol: rawSymbol,
              asset_sha256: rawSha,
              error: String(err?.message || err || "Unknown ingest error"),
            },
          }
        }
      }

      for (let start = 0; start < itemsRaw.length; start += ingestConcurrency) {
        const chunk = itemsRaw.slice(start, start + ingestConcurrency)
        const chunkResults = await Promise.all(chunk.map((rawItem) => ingestOne(rawItem)))
        for (const outcome of chunkResults) {
          if (outcome?.ok) processed += 1
          else failed += 1
          results.push(
            outcome?.result || {
              ok: false,
              symbol: null,
              asset_sha256: null,
              error: "Unknown ingest outcome",
            },
          )
        }
      }

      if (!dryRun && processed > 0) {
        await syncAdminReadModelsAndInvalidateGallery(env, {
          symbols: results.filter((row) => row?.ok && row?.symbol).map((row) => row.symbol),
        })
      }

      const statusCode = failed > 0 && processed === 0 ? 400 : 200
      return done(
        "admin_ingest",
        json(
          {
            ok: failed === 0,
            dry_run: dryRun,
            processed,
            failed,
            total: itemsRaw.length,
            results,
          },
          statusCode,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/reconcile" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_reconcile_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_reconcile_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_reconcile_400", json({ error: "Invalid JSON" }, 400))
      }

      const keepRaw = Array.isArray(p?.keep) ? p.keep : []
      const legacyRaw = Array.isArray(p?.legacy) ? p.legacy : []
      if (keepRaw.length > 50000)
        return done(
          "admin_reconcile_400",
          json({ error: "Too many keep entries (max 50000)" }, 400),
        )
      if (legacyRaw.length > 50000)
        return done(
          "admin_reconcile_400",
          json({ error: "Too many legacy entries (max 50000)" }, 400),
        )

      const keep = []
      const keepSet = new Set()
      for (const raw of keepRaw) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        if (!symbol || !assetSha) continue
        const key = `${symbol}|${assetSha}`
        if (keepSet.has(key)) continue
        keepSet.add(key)
        keep.push({ symbol, asset_sha256: assetSha, key })
      }

      const legacy = []
      const legacySet = new Set()
      for (const raw of legacyRaw) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        if (!symbol || !assetSha) continue
        const key = `${symbol}|${assetSha}`
        if (legacySet.has(key)) continue
        legacySet.add(key)
        legacy.push({ symbol, asset_sha256: assetSha, key })
      }

      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      const unpublishMissing = coerceBoolean(p?.unpublish_missing ?? p?.unpublishMissing, false)
      const actorId = await actor(request, env)
      const reason = String(p?.reason || "").slice(0, 2000) || "local_sync_reconcile"

      const { results: existingAssets = [] } = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol, asset_sha256, status, COALESCE(is_stale, 0) AS is_stale, COALESCE(is_legacy, 0) AS is_legacy FROM icono_portrait_assets",
      ).all()

      const { results: existingStateRows = [] } = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol, current_asset_sha256, COALESCE(admin_override, 0) AS admin_override FROM icono_publish_state",
      ).all()
      const existingState = new Map()
      for (const row of existingStateRows) {
        const symbol = normalizeSymbol(row?.gene_symbol || "")
        if (!symbol) continue
        existingState.set(symbol, {
          current_asset_sha256: normalizeSha256(row?.current_asset_sha256 || "") || null,
          admin_override: Number(row?.admin_override || 0) > 0,
        })
      }
      const touchedSymbols = new Set(keep.map((row) => row.symbol))

      let rejected = 0
      let legacyMarked = 0
      let legacyAlreadyMarked = 0
      let autoResolved = 0
      let unpublished = 0
      let ignoredInvalid = 0

      for (const row of existingAssets) {
        const symbol = normalizeSymbol(row?.gene_symbol || "")
        const assetSha = normalizeSha256(row?.asset_sha256 || "")
        if (!symbol || !assetSha) {
          ignoredInvalid += 1
          continue
        }
        const key = `${symbol}|${assetSha}`
        if (keepSet.has(key)) continue
        if (legacySet.has(key)) {
          touchedSymbols.add(symbol)
          const alreadyLegacy = Number(row?.is_stale || 0) > 0 && Number(row?.is_legacy || 0) > 0
          if (alreadyLegacy) {
            legacyAlreadyMarked += 1
            continue
          }
          legacyMarked += 1
          if (dryRun) continue
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_portrait_assets SET is_stale=1, is_legacy=1 WHERE upper(gene_symbol)=? AND asset_sha256=?",
          )
            .bind(symbol, assetSha)
            .run()
          await env.ICONOPLASM_DB.prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'legacy_mark', ?, ?, CURRENT_TIMESTAMP)",
          )
            .bind(symbol, assetSha, assetSha, actorId, reason)
            .run()
          continue
        }
        touchedSymbols.add(symbol)
        rejected += 1
        if (dryRun) continue
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='rejected', is_stale=0, is_legacy=0 WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, assetSha)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, assetSha, assetSha, actorId, reason)
          .run()
      }

      if (unpublishMissing) {
        for (const [symbol, currentState] of existingState.entries()) {
          if (currentState?.admin_override) continue
          const currentAssetSha = currentState?.current_asset_sha256 || null
          if (!currentAssetSha) continue
          unpublished += 1
          touchedSymbols.add(symbol)
          if (dryRun) continue
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
          )
            .bind(actorId, symbol)
            .run()
          await env.ICONOPLASM_DB.prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
          )
            .bind(symbol, currentAssetSha, null, actorId, reason)
            .run()
        }
      }

      if (!dryRun) {
        for (const symbol of touchedSymbols) {
          const result = await autoPromoteTopVotedPortrait(env, {
            symbol,
            actorId,
            reason: "site_reconcile_resolve",
          })
          if (result?.changed) autoResolved += 1
        }
      }

      if (!dryRun)
        await syncAdminReadModelsAndInvalidateGallery(env, {
          symbols: Array.from(touchedSymbols),
        })
      return done(
        "admin_reconcile",
        json(
          {
            ok: true,
            dry_run: dryRun,
            keep_count: keep.length,
            legacy_count: legacy.length,
            touched_symbols: touchedSymbols.size,
            legacy_marked: legacyMarked,
            legacy_already_marked: legacyAlreadyMarked,
            rejected,
            auto_resolved: autoResolved,
            unpublished,
            ignored_invalid: ignoredInvalid,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (
      [
        "/api/iconoplasm/admin/publish",
        "/api/iconoplasm/admin/clear-override",
        "/api/iconoplasm/admin/reject",
        "/api/iconoplasm/admin/rollback",
        "/api/iconoplasm/admin/unpublish",
        "/api/iconoplasm/admin/unstale",
        "/api/iconoplasm/admin/purge-legacy",
      ].includes(path) &&
      request.method === "POST"
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_mut_403", json({ error: "Unauthorized" }, 403))
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_mut_400", json({ error: "Invalid JSON" }, 400))
      }
      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      if (!symbol) return done("admin_mut_400", json({ error: "Missing symbol" }, 400))
      const actorId = await actor(request, env)

      if (path.endsWith("/publish")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("publish_400", json({ error: "Missing asset_sha256" }, 400))
        const cur = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)
           ON CONFLICT(gene_symbol) DO UPDATE SET
             current_asset_sha256=excluded.current_asset_sha256,
             admin_override=1,
             updated_by=excluded.updated_by,
             updated_at=CURRENT_TIMESTAMP`,
        )
          .bind(symbol, asset, actorId)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(
            symbol,
            cur?.current_asset_sha256 || null,
            asset,
            actorId,
            String(p?.reason || "").slice(0, 2000) || null,
          )
          .run()
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "publish",
          json({
            ok: true,
            action: "publish",
            symbol,
            to_asset_sha256: asset,
            admin_override: true,
          }),
        )
      }

      if (path.endsWith("/clear-override")) {
        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const from = normalizeSha256(current?.current_asset_sha256 || "") || null
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at, admin_override)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
           ON CONFLICT(gene_symbol) DO UPDATE SET
             current_asset_sha256=excluded.current_asset_sha256,
             admin_override=0,
             updated_by=excluded.updated_by,
             updated_at=CURRENT_TIMESTAMP`,
        )
          .bind(symbol, from, actorId)
          .run()
        const autoPromote = await autoPromoteTopVotedPortrait(env, {
          symbol,
          actorId,
          reason: "admin_clear_override",
        })
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "clear_override",
          json({
            ok: true,
            action: "clear_override",
            symbol,
            from_asset_sha256: from,
            auto_promote: autoPromote,
          }),
        )
      }

      if (path.endsWith("/reject")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("reject_400", json({ error: "Missing asset_sha256" }, 400))
        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const currentAssetSha = normalizeSha256(current?.current_asset_sha256 || "")
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='rejected', is_stale=0, is_legacy=0 WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        if (currentAssetSha && currentAssetSha === normalizeSha256(asset)) {
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
          )
            .bind(actorId, symbol)
            .run()
          await env.ICONOPLASM_DB.prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
          )
            .bind(symbol, asset, null, actorId, String(p?.reason || "").slice(0, 2000) || null)
            .run()
        }
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, asset, asset, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done("reject", json({ ok: true, action: "reject", symbol, asset_sha256: asset }))
      }

      if (path.endsWith("/unpublish")) {
        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const from = current?.current_asset_sha256 || null
        if (!from) return done("unpublish_400", json({ error: "No published state to clear" }, 400))
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
        )
          .bind(actorId, symbol)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, from, null, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "unpublish",
          json({ ok: true, action: "unpublish", symbol, from_asset_sha256: from }),
        )
      }

      if (path.endsWith("/unstale")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("unstale_400", json({ error: "Missing asset_sha256" }, 400))
        const existing = await env.ICONOPLASM_DB.prepare(
          "SELECT COALESCE(is_stale, 0) AS is_stale, COALESCE(is_legacy, 0) AS is_legacy FROM icono_portrait_assets WHERE upper(gene_symbol)=? AND asset_sha256=? LIMIT 1",
        )
          .bind(symbol, asset)
          .first()
        if (!existing) return done("unstale_404", json({ error: "Asset not found" }, 404))
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET is_stale=0, is_legacy=0 WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unstale', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, asset, asset, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done("unstale", json({ ok: true, action: "unstale", symbol, asset_sha256: asset }))
      }

      if (path.endsWith("/purge-legacy")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("purge_legacy_400", json({ error: "Missing asset_sha256" }, 400))
        const existing = await env.ICONOPLASM_DB.prepare(
          `SELECT
             r2_key_full,
             r2_key_medium,
             r2_key_thumb,
             COALESCE(is_legacy, 0) AS is_legacy
           FROM icono_portrait_assets
           WHERE upper(gene_symbol)=? AND asset_sha256=?
           LIMIT 1`,
        )
          .bind(symbol, asset)
          .first()
        if (!existing) return done("purge_legacy_404", json({ error: "Asset not found" }, 404))
        if (Number(existing?.is_legacy || 0) <= 0)
          return done("purge_legacy_400", json({ error: "Asset is not marked legacy" }, 400))

        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const from = normalizeSha256(current?.current_asset_sha256 || "")
        const isCurrent = !!(from && from === normalizeSha256(asset))
        if (isCurrent) {
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
          )
            .bind(actorId, symbol)
            .run()
          await env.ICONOPLASM_DB.prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
          )
            .bind(symbol, asset, null, actorId, String(p?.reason || "").slice(0, 2000) || null)
            .run()
        }

        const candidateRef = normalizeCandidateRef("", symbol, asset)
        if (candidateRef) {
          await env.ICONOPLASM_DB.prepare("DELETE FROM icono_image_votes WHERE candidate_ref = ?")
            .bind(candidateRef)
            .run()
        }
        await env.ICONOPLASM_DB.prepare(
          "DELETE FROM icono_portrait_assets WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'purge_legacy', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, asset, null, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()

        const keys = [existing?.r2_key_full, existing?.r2_key_medium, existing?.r2_key_thumb]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
        if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.delete === "function") {
          for (const key of keys) {
            await env.ICONOPLASM_PORTRAITS.delete(key)
          }
        }

        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "purge_legacy",
          json({
            ok: true,
            action: "purge_legacy",
            symbol,
            asset_sha256: asset,
            unpublished_current: isCurrent,
            deleted_r2_keys: keys.length,
          }),
        )
      }

      const current = await env.ICONOPLASM_DB.prepare(
        "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
      )
        .bind(symbol)
        .first()
      const from = current?.current_asset_sha256 || null
      if (!from)
        return done("rollback_400", json({ error: "No published state to roll back" }, 400))
      let target = String(p?.target_asset_sha256 || "").trim() || null
      if (!target) {
        const prev = await env.ICONOPLASM_DB.prepare(
          "SELECT to_asset_sha256 FROM icono_publish_events WHERE upper(gene_symbol)=? AND action='publish' AND to_asset_sha256 IS NOT NULL AND to_asset_sha256 != ? ORDER BY id DESC LIMIT 1",
        )
          .bind(symbol, from)
          .first()
        target = prev?.to_asset_sha256 || null
      }
      if (!target)
        return done(
          "rollback_400",
          json({ error: "No prior published asset to roll back to" }, 400),
        )
      await env.ICONOPLASM_DB.prepare(
        "UPDATE icono_publish_state SET current_asset_sha256=?, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
      )
        .bind(target, actorId, symbol)
        .run()
      await env.ICONOPLASM_DB.prepare(
        "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'rollback', ?, ?, CURRENT_TIMESTAMP)",
      )
        .bind(symbol, from, target, actorId, String(p?.reason || "").slice(0, 2000) || null)
        .run()
      await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
      return done(
        "rollback",
        json({
          ok: true,
          action: "rollback",
          symbol,
          from_asset_sha256: from,
          to_asset_sha256: target,
        }),
      )
    }

    if (path === "/api/catalog/manifest")
      return done("catalog_manifest", await handleCatalogManifest(request, env))
    if (path.startsWith("/api/catalog/catalog.") && path.endsWith(".json"))
      return done("catalog_artifact", await handleCatalogArtifact(env, path))

    if (path.startsWith("/api/")) return done("api_404", json({ error: "Not found" }, 404))

    // Non-API routes are handled by the index.js proxy (serves Quartz HTML from Pages)
    return done("404", json({ error: "Not found" }, 404))
  } catch (e) {
    const out = json({ error: "Internal server error" }, 500)
    await logReq("error", request, 500, started, null)
    return asHead(request, out)
  }
}
