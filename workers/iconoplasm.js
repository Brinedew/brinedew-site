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

export function sanitizeVoteVisionId(raw) {
  const visionId = normalizeVisionId(raw)
  if (!visionId) return ""
  if (isRandomArtistMetavisionId(visionId)) return ""
  if (isLegacyArtistVisionId(visionId)) return ""
  if (/^\d+$/.test(visionId)) return ""
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
  const faction = sanitizeText(payload.faction || payload.politics, 64)
  const skinHex = normalizeHexColor(payload.skin_hex)
  const skinName = sanitizeText(payload.skin_name, 64)
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
    aesthetics_json: JSON.stringify(aesthetics),
    aesthetics_origin_json: JSON.stringify(aestheticsOrigin),
    politics_origin_json: JSON.stringify(politicsOrigin),
    family_surname: familySurname,
    family_members: familyMembers,
    family_feature: familyFeature,
    manifestation,
    ...(traitOriginValidationError ? { validation_error: traitOriginValidationError } : {}),
  }
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
    }
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT ps.current_asset_sha256 AS asset_sha256, pa.r2_key_full, pa.r2_key_medium, pa.r2_key_thumb
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
      }
    return {
      status: "published",
      hero_url: row.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      medium_url: row.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      thumb_url: row.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
      asset_sha256: row.asset_sha256,
    }
  } catch {
    return {
      status: "unavailable",
      hero_url: null,
      medium_url: null,
      thumb_url: null,
      asset_sha256: null,
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

async function autoPromoteTopVotedPortrait(env, { symbol, actorId, reason } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  if (!symbolNorm) return { ok: false, changed: false, code: "BAD_SYMBOL" }

  const currentRow = await env.ICONOPLASM_DB.prepare(
    `SELECT current_asset_sha256
     FROM icono_publish_state
     WHERE upper(gene_symbol) = ?
     LIMIT 1`,
  )
    .bind(symbolNorm)
    .first()
  const currentAssetSha = normalizeSha256(currentRow?.current_asset_sha256 || "")

  const topRow = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
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

  const topScore = Number(topRow?.image_score || 0)
  const topUpvotes = Number(topRow?.image_upvotes || 0)
  const topDownvotes = Number(topRow?.image_downvotes || 0)
  if (!currentAssetSha && topScore <= 0 && topUpvotes <= 0 && topDownvotes <= 0) {
    return { ok: true, changed: false, code: "NO_SIGNAL", current_asset_sha256: null }
  }

  const actorNorm = normalizeUserId(actorId || "vote_auto")
  const eventReason = String(reason || "vote_auto_promote").slice(0, 2000) || "vote_auto_promote"

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       current_asset_sha256 = excluded.current_asset_sha256,
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

async function unpublishCurrentPortrait(env, { symbol, actorId, reason, fromAssetSha256 } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  const actorNorm = normalizeUserId(actorId || "artist_style_blacklist")
  const fromAssetSha = normalizeSha256(fromAssetSha256 || "")
  if (!symbolNorm || !fromAssetSha) return { ok: false, changed: false, code: "BAD_INPUT" }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at)
     VALUES (?, NULL, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       current_asset_sha256 = NULL,
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
  { artistTag, artistName = "", actorId = "artist_style_blacklist", reason = "", dryRun = false } = {},
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
  if (["votes", "popularity", "newest", "random"].includes(value)) return value
  return "votes"
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

function clearGallerySnapshotCache() {
  gallerySnapshotCache.catalogHash = null
  gallerySnapshotCache.base = null
  gallerySnapshotCache.loadedAt = 0
  gallerySnapshotCache.items = []
  gallerySnapshotCache.publishedTotal = 0
  gallerySnapshotCache.sorted = new Map()
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

function sortGalleryItems(items, order, seed = null) {
  const sorted = Array.isArray(items) ? items.slice() : []
  sorted.sort((left, right) => {
    if (order === "newest") {
      return (
        compareNullableTextDesc(
          left.published_at || left.asset_created_at,
          right.published_at || right.asset_created_at,
        ) || compareNullableTextAsc(left.symbol, right.symbol)
      )
    }
    if (order === "random") {
      return (
        galleryRandomRank(seed, left.symbol) - galleryRandomRank(seed, right.symbol) ||
        compareNullableTextAsc(left.symbol, right.symbol)
      )
    }
    if (order === "popularity") {
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
       upper(ps.gene_symbol) AS symbol,
       ps.updated_at AS published_at,
       pa.created_at AS asset_created_at,
       pa.asset_sha256,
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
       ON upper(pa.gene_symbol) = upper(ps.gene_symbol)
      AND lower(pa.asset_sha256) = lower(ps.current_asset_sha256)
     LEFT JOIN icono_image_votes iv
       ON iv.candidate_ref = ('a:' || upper(ps.gene_symbol) || '|' || lower(pa.asset_sha256))
     WHERE ps.current_asset_sha256 IS NOT NULL
     GROUP BY
       upper(ps.gene_symbol),
       ps.updated_at,
       pa.created_at,
       pa.asset_sha256,
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
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
      },
    })
  }

  const items = []
  for (const [symbol, cached] of catalogCache.bySymbol.entries()) {
    const published = publishedMap.get(symbol) || null
    const fullName = String(cached?.n || symbol || "").trim() || symbol
    const color = String(cached?.c || "#888").trim() || "#888"
    items.push({
      symbol,
      color,
      full_name: fullName,
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
  const limit = Math.max(1, Math.min(60, Number.parseInt(String(rawLimit || "30"), 10) || 30))
  const offset = Math.max(0, Number.parseInt(String(rawOffset || "0"), 10) || 0)
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
  clearGallerySnapshotCache()

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
      const payload = await galleryFeed(
        env,
        url,
        url.searchParams.get("order"),
        url.searchParams.get("limit"),
        url.searchParams.get("offset"),
        url.searchParams.get("seed"),
      )
      return done(
        "gallery",
        json(payload, 200, { "Cache-Control": "public, max-age=60" }),
        API_SCHEMA_VERSION,
      )
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
             candidate_ref, gene_symbol, asset_sha256, vision_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, userId, requested)
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
      clearGallerySnapshotCache()
      return done(
        "votes_set",
        json(
          {
            ok: true,
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
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
             candidate_ref, gene_symbol, asset_sha256, vision_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, userId, voteValue)
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

      clearGallerySnapshotCache()
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
             candidate_ref, gene_symbol, asset_sha256, vision_id, user_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(candidate_ref, user_id) DO UPDATE SET
             gene_symbol = excluded.gene_symbol,
             asset_sha256 = excluded.asset_sha256,
             vision_id = excluded.vision_id,
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(candidateRef, symbol, assetSha, visionId, userId, requested)
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
      clearGallerySnapshotCache()
      return done(
        "admin_votes_set",
        json(
          {
            ok: true,
            candidate_ref: candidateRef,
            symbol,
            asset_sha256: assetSha,
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

      const snapshots = []
      for (const item of deduped) {
        const snapshot = await iconoVoteSnapshot(env, {
          candidateRef: item.candidate_ref,
          symbol: item.symbol,
          assetSha256: item.asset_sha256,
          visionId: item.vision_id,
          userId,
        })
        snapshots.push({
          candidate_ref: item.candidate_ref,
          symbol: item.symbol,
          asset_sha256: item.asset_sha256,
          vision_id: item.vision_id,
          snapshot,
        })
      }

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

    if (path === "/api/iconoplasm/admin/votes/vision-stats" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_vision_stats_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_vision_stats_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_vision_stats_400", json({ error: "Invalid JSON" }, 400))
      }
      const visionIdsRaw = Array.isArray(p?.vision_ids) ? p.vision_ids : []
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

      let results = []
      if (!visionIds.length) {
        const resp = await env.ICONOPLASM_DB.prepare(
          `SELECT
             vision_id,
             COUNT(DISTINCT candidate_ref) AS image_count,
             COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(SUM(vote_value), 0) AS score
           FROM icono_image_votes
           WHERE COALESCE(vision_id, '') <> ''
             AND LOWER(COALESCE(vision_id, '')) NOT LIKE 'artist-random-%'
           GROUP BY vision_id
           ORDER BY score DESC, upvotes DESC, image_count DESC, vision_id ASC`,
        ).all()
        results = Array.isArray(resp?.results) ? resp.results : []
      } else {
        const placeholders = visionIds.map(() => "?").join(",")
        const resp = await env.ICONOPLASM_DB.prepare(
          `SELECT
             vision_id,
             COUNT(DISTINCT candidate_ref) AS image_count,
             COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
             COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
             COALESCE(SUM(vote_value), 0) AS score
           FROM icono_image_votes
           WHERE COALESCE(vision_id, '') <> ''
             AND LOWER(COALESCE(vision_id, '')) NOT LIKE 'artist-random-%'
             AND vision_id IN (${placeholders})
           GROUP BY vision_id
           ORDER BY score DESC, upvotes DESC, image_count DESC, vision_id ASC`,
        )
          .bind(...visionIds)
          .all()
        results = Array.isArray(resp?.results) ? resp.results : []
      }

      const rows = (results || []).map((row) => ({
        vision_id: String(row?.vision_id || ""),
        image_count: Number(row?.image_count || 0),
        upvotes: Number(row?.upvotes || 0),
        downvotes: Number(row?.downvotes || 0),
        score: Number(row?.score || 0),
      }))
      return done(
        "admin_votes_vision_stats",
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
        if (!dryRun) clearGallerySnapshotCache()
        return done(
          "artist_styles_remove",
          json(result, 200, { "Cache-Control": "no-store" }),
        )
      } catch (error) {
        return done(
          "artist_styles_remove_400",
          json({ error: String(error?.message || error || "Artist style removal failed") }, 400),
        )
      }
    }

    if (path === "/api/iconoplasm/admin/assets" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_403", json({ error: "Unauthorized" }, 403))
      const status = (url.searchParams.get("status") || "draft").toLowerCase()
      const limit = Math.max(
        1,
        Math.min(250, Number.parseInt(url.searchParams.get("limit") || "50", 10)),
      )
      const where = status === "all" ? "" : "WHERE lower(status)=?"
      const stmt =
        status === "all"
          ? env.ICONOPLASM_DB.prepare(
              `SELECT gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, autopick_eligible, vision_id, artist_tag, artist_name, created_by, created_at FROM icono_portrait_assets ${where} ORDER BY created_at DESC LIMIT ?`,
            ).bind(limit)
          : env.ICONOPLASM_DB.prepare(
              `SELECT gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, autopick_eligible, vision_id, artist_tag, artist_name, created_by, created_at FROM icono_portrait_assets ${where} ORDER BY created_at DESC LIMIT ?`,
            ).bind(status, limit)
      const { results } = await stmt.all()
      const base = portraitBase(url, env)
      const assets = (results || []).map((r) => ({
        ...r,
        hero_url: r.r2_key_full ? joinUrl(base, r.r2_key_full) : null,
        medium_url: r.r2_key_medium ? joinUrl(base, r.r2_key_medium) : null,
        thumb_url: r.r2_key_thumb ? joinUrl(base, r.r2_key_thumb) : null,
      }))
      return done(
        "admin_assets",
        json({ assets, count: assets.length }, 200, { "Cache-Control": "no-store" }),
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

    if (
      ["/api/iconoplasm/admin/ingest", "/api/iconoplasm/admin/publish-local"].includes(path) &&
      request.method === "POST"
    ) {
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
      if (itemsRaw.length > 100)
        return done(
          "admin_ingest_400",
          json({ error: "Too many items (max 100 per request)" }, 400),
        )

      const actorId = await actor(request, env)
      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      const defaultPublish = path.endsWith("/publish-local") || coerceBoolean(p?.publish, false)
      const reasonDefault = String(p?.reason || "").slice(0, 2000) || null
      const createdByDefault = String(p?.created_by || p?.createdBy || actorId || "unknown").slice(
        0,
        255,
      )
      const base = portraitBase(url, env)

      const results = []
      let processed = 0
      let failed = 0

      for (const rawItem of itemsRaw) {
        try {
          const item = rawItem && typeof rawItem === "object" ? rawItem : {}
          const symbol = normalizeSymbol(item?.symbol || item?.gene_symbol || "")
          const assetSha = normalizeSha256(item?.asset_sha256 || item?.sha256 || "")
          if (!symbol) throw new Error("Missing or invalid symbol")
          if (!assetSha) throw new Error("Missing or invalid asset_sha256")

          const requestedPublish = coerceBoolean(item?.publish, defaultPublish)
          const statusRequested = normalizeAssetStatus(
            item?.status,
            requestedPublish ? "approved" : "draft",
          )
          const reason = String(item?.reason || reasonDefault || "").slice(0, 2000) || null
          const createdBy = String(
            item?.created_by || item?.createdBy || createdByDefault || "unknown",
          ).slice(0, 255)

          const keys = {
            full: r2PortraitKey(assetSha, "full"),
            medium: r2PortraitKey(assetSha, "medium"),
            thumb: r2PortraitKey(assetSha, "thumb"),
          }

          const [headFull, headMedium, headThumb] = await Promise.all([
            env.ICONOPLASM_PORTRAITS.head(keys.full),
            env.ICONOPLASM_PORTRAITS.head(keys.medium),
            env.ICONOPLASM_PORTRAITS.head(keys.thumb),
          ])
          const exists = {
            full: Boolean(headFull),
            medium: Boolean(headMedium),
            thumb: Boolean(headThumb),
          }

          const fullPayload = extractRenditionPayload(item, "full")
          const mediumPayload = extractRenditionPayload(item, "medium")
          const thumbPayload = extractRenditionPayload(item, "thumb")
          const fullBytes = extractRenditionBytes(fullPayload)
          const mediumBytes = extractRenditionBytes(mediumPayload)
          const thumbBytes = extractRenditionBytes(thumbPayload)

          if (!dryRun) {
            if (!exists.full) {
              if (!fullBytes) throw new Error("Missing full rendition payload for new upload")
              await env.ICONOPLASM_PORTRAITS.put(keys.full, fullBytes, {
                httpMetadata: { contentType: "image/webp" },
                customMetadata: { gene_symbol: symbol, asset_sha256: assetSha, rendition: "full" },
              })
            }
            if (!exists.medium) {
              if (!mediumBytes) throw new Error("Missing medium rendition payload for new upload")
              await env.ICONOPLASM_PORTRAITS.put(keys.medium, mediumBytes, {
                httpMetadata: { contentType: "image/webp" },
                customMetadata: {
                  gene_symbol: symbol,
                  asset_sha256: assetSha,
                  rendition: "medium",
                },
              })
            }
            if (!exists.thumb) {
              if (!thumbBytes) throw new Error("Missing thumb rendition payload for new upload")
              await env.ICONOPLASM_PORTRAITS.put(keys.thumb, thumbBytes, {
                httpMetadata: { contentType: "image/webp" },
                customMetadata: { gene_symbol: symbol, asset_sha256: assetSha, rendition: "thumb" },
              })
            }
          }

          const existingAsset = await env.ICONOPLASM_DB.prepare(
            `SELECT
               status,
               autopick_eligible,
               vision_id,
               artist_tag,
               artist_name
             FROM icono_portrait_assets
             WHERE upper(gene_symbol)=? AND asset_sha256=?
             LIMIT 1`,
          )
            .bind(symbol, assetSha)
            .first()
          const visionId =
            sanitizeText(item?.vision_id || item?.vision || existingAsset?.vision_id || "", 255) || null
          const artistTag =
            normalizeArtistTag(item?.artist_tag || item?.artistTag || existingAsset?.artist_tag || "") || null
          const artistName =
            sanitizeText(item?.artist_name || item?.artistName || existingAsset?.artist_name || "", 255) ||
            null
          const blacklistRow = artistTag ? await getArtistStyleBlacklistRow(env, artistTag) : null
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
          const publishNow = blacklisted ? false : requestedPublish
          const essence = normalizeEssencePayload(item?.essence, symbol)
          const existingStatus = normalizeAssetStatus(existingAsset?.status || "", "draft")
          let finalStatus = statusRequested
          if (
            !publishNow &&
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
                 mime, width, height, bytes, status, autopick_eligible,
                 vision_id, artist_tag, artist_name, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                 vision_id=COALESCE(excluded.vision_id, icono_portrait_assets.vision_id),
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
                artistTag,
                artistName,
                createdBy,
              )
              .run()
          }

          let essenceResult = "not_provided"
          if (essence) {
            if (dryRun) {
              essenceResult = "would_update"
            } else {
              await upsertGeneEssence(env, essence, createdBy, "nicegui_sync")
              essenceResult = "updated"
            }
          }

          let publishResult = "not_requested"
          let fromAssetSha256 = null
          if (publishNow) {
            const current = await env.ICONOPLASM_DB.prepare(
              "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
            )
              .bind(symbol)
              .first()
            fromAssetSha256 = current?.current_asset_sha256 || null
            if (dryRun) {
              publishResult = fromAssetSha256 === assetSha ? "already_current" : "would_publish"
            } else if (fromAssetSha256 === assetSha) {
              publishResult = "already_current"
              await env.ICONOPLASM_DB.prepare(
                "UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?",
              )
                .bind(symbol, assetSha)
                .run()
            } else {
              await env.ICONOPLASM_DB.prepare(
                `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(gene_symbol) DO UPDATE SET
                   current_asset_sha256=excluded.current_asset_sha256,
                   updated_by=excluded.updated_by,
                   updated_at=CURRENT_TIMESTAMP`,
              )
                .bind(symbol, assetSha, actorId)
                .run()
              await env.ICONOPLASM_DB.prepare(
                "UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?",
              )
                .bind(symbol, assetSha)
                .run()
              await env.ICONOPLASM_DB.prepare(
                "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)",
              )
                .bind(symbol, fromAssetSha256, assetSha, actorId, reason)
                .run()
              publishResult = "published"
            }
          }

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

          processed += 1
          results.push({
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
            publish: publishResult,
            requested_publish: requestedPublish,
            blacklisted,
            blacklist_reason: sanitizeText(blacklistRow?.reason || "", 2000) || null,
            from_asset_sha256: fromAssetSha256,
            essence: essenceResult,
            hero_url: joinUrl(base, keys.full),
            medium_url: joinUrl(base, keys.medium),
            thumb_url: joinUrl(base, keys.thumb),
            r2_keys: keys,
          })
        } catch (err) {
          failed += 1
          const rawSymbol =
            rawItem && typeof rawItem === "object"
              ? rawItem.symbol || rawItem.gene_symbol || null
              : null
          const rawSha =
            rawItem && typeof rawItem === "object"
              ? rawItem.asset_sha256 || rawItem.sha256 || null
              : null
          results.push({
            ok: false,
            symbol: rawSymbol,
            asset_sha256: rawSha,
            error: String(err?.message || err || "Unknown ingest error"),
          })
        }
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
      const publishRaw = Array.isArray(p?.publish) ? p.publish : []
      if (keepRaw.length > 50000)
        return done(
          "admin_reconcile_400",
          json({ error: "Too many keep entries (max 50000)" }, 400),
        )
      if (publishRaw.length > 20000)
        return done(
          "admin_reconcile_400",
          json({ error: "Too many publish entries (max 20000)" }, 400),
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

      const publishBySymbol = new Map()
      for (const raw of publishRaw) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        if (!symbol || !assetSha) continue
        const key = `${symbol}|${assetSha}`
        if (!keepSet.has(key)) continue
        if (publishBySymbol.has(symbol)) continue
        publishBySymbol.set(symbol, assetSha)
      }

      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      const actorId = await actor(request, env)
      const reason = String(p?.reason || "").slice(0, 2000) || "local_sync_reconcile"

      const { results: existingAssets = [] } = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol, asset_sha256, status FROM icono_portrait_assets",
      ).all()

      const { results: existingStateRows = [] } = await env.ICONOPLASM_DB.prepare(
        "SELECT gene_symbol, current_asset_sha256 FROM icono_publish_state",
      ).all()
      const existingState = new Map()
      for (const row of existingStateRows) {
        const symbol = normalizeSymbol(row?.gene_symbol || "")
        if (!symbol) continue
        const assetSha = normalizeSha256(row?.current_asset_sha256 || "") || null
        existingState.set(symbol, assetSha)
      }

      let rejected = 0
      let published = 0
      let unpublished = 0
      let alreadyCurrent = 0
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
        rejected += 1
        if (dryRun) continue
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='rejected' WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, assetSha)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, assetSha, assetSha, actorId, reason)
          .run()
      }

      for (const [symbol, targetAssetSha] of publishBySymbol.entries()) {
        const currentAssetSha = existingState.has(symbol) ? existingState.get(symbol) : null
        if (currentAssetSha === targetAssetSha) {
          alreadyCurrent += 1
          continue
        }
        published += 1
        if (dryRun) continue
        await env.ICONOPLASM_DB.prepare(
          `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(gene_symbol) DO UPDATE SET
               current_asset_sha256=excluded.current_asset_sha256,
               updated_by=excluded.updated_by,
               updated_at=CURRENT_TIMESTAMP`,
        )
          .bind(symbol, targetAssetSha, actorId)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, targetAssetSha)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, currentAssetSha, targetAssetSha, actorId, reason)
          .run()
      }

      for (const [symbol, currentAssetSha] of existingState.entries()) {
        if (!currentAssetSha) continue
        if (publishBySymbol.has(symbol)) continue
        unpublished += 1
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

      if (!dryRun) clearGallerySnapshotCache()
      return done(
        "admin_reconcile",
        json(
          {
            ok: true,
            dry_run: dryRun,
            keep_count: keep.length,
            publish_count: publishBySymbol.size,
            rejected,
            published,
            unpublished,
            already_current: alreadyCurrent,
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
        "/api/iconoplasm/admin/reject",
        "/api/iconoplasm/admin/rollback",
        "/api/iconoplasm/admin/unpublish",
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
          `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(gene_symbol) DO UPDATE SET current_asset_sha256=excluded.current_asset_sha256, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`,
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
        clearGallerySnapshotCache()
        return done(
          "publish",
          json({ ok: true, action: "publish", symbol, to_asset_sha256: asset }),
        )
      }

      if (path.endsWith("/reject")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("reject_400", json({ error: "Missing asset_sha256" }, 400))
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='rejected' WHERE upper(gene_symbol)=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, asset, asset, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()
        clearGallerySnapshotCache()
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
          "UPDATE icono_publish_state SET current_asset_sha256=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
        )
          .bind(actorId, symbol)
          .run()
        await env.ICONOPLASM_DB.prepare(
          "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
        )
          .bind(symbol, from, null, actorId, String(p?.reason || "").slice(0, 2000) || null)
          .run()
        clearGallerySnapshotCache()
        return done(
          "unpublish",
          json({ ok: true, action: "unpublish", symbol, from_asset_sha256: from }),
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
        "UPDATE icono_publish_state SET current_asset_sha256=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
      )
        .bind(target, actorId, symbol)
        .run()
      await env.ICONOPLASM_DB.prepare(
        "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'rollback', ?, ?, CURRENT_TIMESTAMP)",
      )
        .bind(symbol, from, target, actorId, String(p?.reason || "").slice(0, 2000) || null)
        .run()
      clearGallerySnapshotCache()
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
