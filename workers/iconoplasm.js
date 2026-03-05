import { isAdmin } from "./admin.js"
import { parseCookies } from "./auth.js"
import { fetchProteinByGene, fetchProteinByUniprot } from "./lib/protein-store.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const API_SCHEMA_VERSION = 2
const MIN_EXTENSION_VERSION = "0.3.0"

const KV_COLORS_MANIFEST = "iconoplasm:colors-manifest"
const KV_COLORS_PREFIX = "iconoplasm:colors:"

const colorsCache = {
  hash: null,
  bySymbol: new Map(),
  symbolByUniprot: new Map(),
  loadedAt: 0,
}
const COLORS_CACHE_TTL_MS = 5 * 60 * 1000

const rlBuckets = new Map()
const RL_WINDOW_MS = 60 * 1000

export function isIconoplasmRequest(host) {
  return host === ICONOPLASM_HOST || host.startsWith("iconoplasm.")
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "If-None-Match, Content-Type, X-Iconoplasm-Extension-Version, Authorization, X-Iconoplasm-Admin-Token",
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
  if (typeof env.ICONOPLASM_PORTRAIT_BASE_URL === "string" && env.ICONOPLASM_PORTRAIT_BASE_URL.trim()) {
    return env.ICONOPLASM_PORTRAIT_BASE_URL.trim()
  }
  // R2 keys include the `portraits/` prefix, so the base is just the origin.
  return url.origin
}

// Canonical R2 key for a portrait rendition.
// rendition: 'full' (<=1MP, gene page hero), 'medium' (512px long edge, extension/grid), 'thumb' (256x256 crop)
function r2PortraitKey(sha256, rendition) {
  return `portraits/v1/${sha256.slice(0, 2)}/${sha256}/${rendition}.webp`
}

function normalizeSha256(raw) {
  const v = String(raw || "").trim().toLowerCase()
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
  const v = String(raw || "").trim().toLowerCase()
  if (["draft", "approved", "rejected"].includes(v)) return v
  return fallback
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
  const fromBearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
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

async function colorsManifestObj(env) {
  if (!env.KV) return null
  const raw = await env.KV.get(KV_COLORS_MANIFEST)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function warmColorsCache(env) {
  const manifest = await colorsManifestObj(env)
  if (!manifest?.current_hash || !env.KV) return
  const now = Date.now()
  if (
    colorsCache.hash === manifest.current_hash &&
    now - colorsCache.loadedAt < COLORS_CACHE_TTL_MS &&
    colorsCache.bySymbol.size > 0
  ) {
    return
  }

  const raw = await env.KV.get(`${KV_COLORS_PREFIX}${manifest.current_hash}`)
  if (!raw) return
  let artifact
  try {
    artifact = JSON.parse(raw)
  } catch {
    return
  }

  const bySymbol = new Map()
  const symbolByUniprot = new Map()
  for (const g of artifact?.genes || []) {
    const s = normalizeSymbol(g?.s)
    if (!s) continue
    bySymbol.set(s, g)
    const u = normalizeUniprot(g?.u)
    if (u) symbolByUniprot.set(u, s)
  }
  colorsCache.hash = manifest.current_hash
  colorsCache.loadedAt = now
  colorsCache.bySymbol = bySymbol
  colorsCache.symbolByUniprot = symbolByUniprot
}

async function resolveGene(env, rawId) {
  await warmColorsCache(env)
  const bySymbol = colorsCache.bySymbol
  const byUni = colorsCache.symbolByUniprot

  const s = normalizeSymbol(rawId)
  if (s) {
    if (env.DB) {
      try {
        const p = await fetchProteinByGene(env.DB, s)
        if (p?.gene) return { protein: p, symbol: normalizeSymbol(p.gene), mode: "symbol" }
      } catch {}
    }
    if (bySymbol.has(s)) {
      const g = bySymbol.get(s)
      return { protein: { gene: s, full_name: g?.n || s, uniprot: g?.u || null }, symbol: s, mode: "symbol" }
    }
  }

  const u = normalizeUniprot(rawId)
  if (u) {
    if (env.DB) {
      try {
        const p = await fetchProteinByUniprot(env.DB, u)
        if (p?.gene) return { protein: p, symbol: normalizeSymbol(p.gene), mode: "uniprot" }
      } catch {}
    }
    const mapped = byUni.get(u)
    if (mapped) {
      const g = bySymbol.get(mapped)
      return { protein: { gene: mapped, full_name: g?.n || mapped, uniprot: u }, symbol: mapped, mode: "uniprot" }
    }
  }
  return null
}

async function portraitState(env, symbol, base) {
  if (!env.ICONOPLASM_DB) return { status: "missing", hero_url: null, medium_url: null, thumb_url: null, asset_sha256: null }
  try {
    const row = await env.ICONOPLASM_DB
      .prepare(
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
    if (!row?.asset_sha256) return { status: "missing", hero_url: null, medium_url: null, thumb_url: null, asset_sha256: null }
    return {
      status: "published",
      hero_url: row.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      medium_url: row.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      thumb_url: row.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
      asset_sha256: row.asset_sha256,
    }
  } catch {
    return { status: "unavailable", hero_url: null, medium_url: null, thumb_url: null, asset_sha256: null }
  }
}

function sourceLinks(symbol, uniprot) {
  const sym = encodeURIComponent(symbol)
  return {
    ...(uniprot ? { uniprot: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(uniprot)}` } : {}),
    ncbi: `https://www.ncbi.nlm.nih.gov/gene/?term=${sym}%5BGene%20Name%5D+AND+human%5BOrganism%5D`,
    ensembl: `https://www.ensembl.org/Homo_sapiens/Search/Results?q=${sym}`,
  }
}

async function geneRecord(env, url, rawId) {
  const r = await resolveGene(env, rawId)
  if (!r?.symbol) return null
  const entry = colorsCache.bySymbol.get(r.symbol)
  const base = portraitBase(url, env)
  const portrait = await portraitState(env, r.symbol, base)
  const uniprot = normalizeUniprot(r?.protein?.uniprot || entry?.u || null)
  const fullName = (r?.protein?.full_name && String(r.protein.full_name).trim()) || entry?.n || r.symbol
  return {
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    canonical_symbol: r.symbol,
    symbol: r.symbol,
    full_name: fullName,
    color: entry?.c || null,
    ...(uniprot ? { uniprot } : {}),
    portrait,
    source_links: sourceLinks(r.symbol, uniprot),
    page_url: `${url.origin}/gene/${encodeURIComponent(r.symbol)}`,
    resolved_from: r.mode,
  }
}

async function etagFor(obj) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(obj)))
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
  const visionNorm = normalizeVisionId(visionId)
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

async function handleLegacyColorsManifest(request, env) {
  if (!env.KV) return json({ error: "KV binding missing" }, 500)
  const manifest = await env.KV.get(KV_COLORS_MANIFEST)
  if (!manifest) return json({ error: "Colors manifest not found — run upload script" }, 404)
  let etag = null
  try {
    etag = `"${JSON.parse(manifest).current_hash}"`
  } catch {}
  if (etag && etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" } })
  }
  return new Response(manifest, {
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", ...(etag ? { ETag: etag } : {}) },
  })
}

async function handleLegacyColorsArtifact(env, path) {
  const m = path.match(/\/api\/colors\/colors\.([a-f0-9]+)\.json$/)
  if (!m) return json({ error: "Invalid artifact path" }, 400)
  if (!env.KV) return json({ error: "KV binding missing" }, 500)
  const body = await env.KV.get(`${KV_COLORS_PREFIX}${m[1]}`)
  if (!body) return json({ error: "Artifact not found" }, 404)
  return new Response(body, {
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable", ETag: `"${m[1]}"` },
  })
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
    if (request.method === "OPTIONS") return done("options", new Response(null, { status: 204, headers: corsHeaders() }))
    if (!["GET", "HEAD", "POST"].includes(request.method)) return done("method", json({ error: "Method not allowed" }, 405))

    if (path === "/health" || path === "/api/health") {
      return done("health", json({ status: "ok", service: "iconoplasm" }, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/manifest") {
      const retry = rateLimit(request, "manifest", 60)
      if (retry) return done("manifest_rl", json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, { "Retry-After": String(retry) }))
      const m = await colorsManifestObj(env)
      if (!m) return done("manifest_404", json({ error: "Colors manifest not found — run upload script" }, 404))
      const payload = {
        schema_version: API_SCHEMA_VERSION,
        canonical_key: "symbol",
        current_hash: m.current_hash || null,
        filename: m.filename || null,
        generated_at: m.generated_at || null,
        gene_count: m.gene_count || null,
        artifact_schema_version: m.schema_version || 1,
        portrait_base_url: portraitBase(url, env),
        min_extension_version: env.ICONOPLASM_MIN_EXTENSION_VERSION || MIN_EXTENSION_VERSION,
      }
      const etag = payload.current_hash ? `"${payload.current_hash}"` : await etagFor(payload)
      if (etagMatches(request.headers.get("If-None-Match"), etag)) {
        return done("manifest_304", new Response(null, { status: 304, headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" } }), API_SCHEMA_VERSION)
      }
      return done("manifest", json(payload, 200, { ETag: etag, "Cache-Control": "public, max-age=300" }), API_SCHEMA_VERSION)
    }

    if (path.startsWith("/api/gene/")) {
      const retry = rateLimit(request, "gene", 240)
      if (retry) return done("gene_rl", json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, { "Retry-After": String(retry) }))
      const rawId = path.slice("/api/gene/".length)
      const resolved = await resolveGene(env, rawId)
      if (!resolved) return done("gene_404", json({ error: "Gene not found" }, 404))
      const canonicalPath = `/api/gene/${encodeURIComponent(resolved.symbol)}`
      if (path !== canonicalPath) return done("gene_redirect", Response.redirect(`${url.origin}${canonicalPath}`, 302))
      const payload = await geneRecord(env, url, resolved.symbol)
      const etag = await etagFor(payload)
      if (etagMatches(request.headers.get("If-None-Match"), etag)) {
        return done("gene_304", new Response(null, { status: 304, headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=120" } }), API_SCHEMA_VERSION)
      }
      return done("gene", json(payload, 200, { ETag: etag, "Cache-Control": "public, max-age=120" }), API_SCHEMA_VERSION)
    }

    // Random gene sample for the homepage grid
    if (path === "/api/genes/random") {
      const retry = rateLimit(request, "genes_random", 30)
      if (retry) return done("genes_random_rl", json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, { "Retry-After": String(retry) }))
      await warmColorsCache(env)
      const count = Math.max(1, Math.min(120, Number.parseInt(url.searchParams.get("count") || "60", 10)))
      const allSymbols = Array.from(colorsCache.bySymbol.keys())
      const shuffled = allSymbols.sort(() => Math.random() - 0.5).slice(0, count)
      const genes = shuffled.map(s => {
        const g = colorsCache.bySymbol.get(s)
        return { symbol: s, color: g?.c || "#888", full_name: g?.n || s }
      })
      return done("genes_random", json({ genes, total: allSymbols.length }, 200, { "Cache-Control": "public, max-age=60" }))
    }

    // Search genes by symbol prefix or full name substring
    if (path === "/api/genes/search") {
      const retry = rateLimit(request, "genes_search", 120)
      if (retry) return done("genes_search_rl", json({ error: "Rate limit exceeded", retry_after_seconds: retry }, 429, { "Retry-After": String(retry) }))
      const q = (url.searchParams.get("q") || "").trim().toUpperCase()
      if (!q) return done("genes_search_empty", json({ genes: [], query: "" }, 200))
      await warmColorsCache(env)
      const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get("limit") || "20", 10)))
      const results = []
      // Prioritize symbol-prefix matches, then name-substring matches
      const prefixMatches = []
      const nameMatches = []
      for (const [s, g] of colorsCache.bySymbol) {
        if (s.startsWith(q)) {
          prefixMatches.push({ symbol: s, color: g?.c || "#888", full_name: g?.n || s })
        } else if (g?.n && g.n.toUpperCase().includes(q)) {
          nameMatches.push({ symbol: s, color: g?.c || "#888", full_name: g?.n || s })
        }
        if (prefixMatches.length + nameMatches.length >= limit * 2) break
      }
      const genes = [...prefixMatches, ...nameMatches].slice(0, limit)
      return done("genes_search", json({ genes, query: q }, 200, { "Cache-Control": "public, max-age=30" }))
    }

    if (path.startsWith("/portraits/")) {
      if (!env.ICONOPLASM_PORTRAITS) return done("portrait_no_binding", json({ error: "Portrait bucket not configured" }, 404))
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
      if (!env.ICONOPLASM_DB) return done("votes_set_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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
      if (!candidateRef) return done("votes_set_400", json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400))
      if (!symbol) return done("votes_set_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha) return done("votes_set_400", json({ error: "Missing or invalid asset_sha256" }, 400))
      if (requested === null) return done("votes_set_400", json({ error: "vote_value must be -1, 0, or 1" }, 400))

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

      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
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
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/votes/snapshot" && request.method === "POST") {
      if (!env.ICONOPLASM_DB) return done("votes_snapshot_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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
      const visionId = normalizeVisionId(p?.vision_id || "")
      if (!candidateRef) return done("votes_snapshot_400", json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400))
      if (!symbol) return done("votes_snapshot_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha) return done("votes_snapshot_400", json({ error: "Missing or invalid asset_sha256" }, 400))

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
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_votes_import_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_votes_import_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_import_400", json({ error: "Invalid JSON" }, 400))
      }
      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length) return done("admin_votes_import_400", json({ error: "No items provided" }, 400))
      if (items.length > 20000) return done("admin_votes_import_400", json({ error: "Too many items (max 20000)" }, 400))

      let upserted = 0
      let deleted = 0
      let invalid = 0
      for (const raw of items) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        const candidateRef = normalizeCandidateRef(
          raw?.candidate_ref || (raw?.candidate_image_id ? `c:${String(raw.candidate_image_id)}` : ""),
          symbol,
          assetSha,
        )
        const visionId = normalizeVisionId(raw?.vision_id || "")
        const userId = normalizeUserId(raw?.user_id || raw?.user || "local")
        const voteValue = normalizeVoteValue(raw?.vote_value)
        if (!candidateRef || !symbol || !assetSha || !userId || voteValue === null) {
          invalid += 1
          continue
        }
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

      return done(
        "admin_votes_import",
        json(
          {
            ok: true,
            total: items.length,
            upserted,
            deleted,
            invalid,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/set" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_votes_set_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_votes_set_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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
      if (!candidateRef) return done("admin_votes_set_400", json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400))
      if (!symbol) return done("admin_votes_set_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha) return done("admin_votes_set_400", json({ error: "Missing or invalid asset_sha256" }, 400))
      if (requested === null) return done("admin_votes_set_400", json({ error: "vote_value must be -1, 0, or 1" }, 400))
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

      const snapshot = await iconoVoteSnapshot(env, {
        candidateRef,
        symbol,
        assetSha256: assetSha,
        visionId,
        userId,
      })
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
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/snapshot" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_votes_snapshot_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_votes_snapshot_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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
      const visionId = normalizeVisionId(p?.vision_id || "")
      const userId = normalizeUserId(p?.user_id || p?.user || "local")
      if (!candidateRef) return done("admin_votes_snapshot_400", json({ error: "Missing vote identity (candidate_ref or symbol+asset_sha256)" }, 400))
      if (!symbol) return done("admin_votes_snapshot_400", json({ error: "Missing or invalid symbol" }, 400))
      if (!assetSha) return done("admin_votes_snapshot_400", json({ error: "Missing or invalid asset_sha256" }, 400))

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
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_votes_snapshots_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_votes_snapshots_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_snapshots_400", json({ error: "Invalid JSON" }, 400))
      }
      const items = Array.isArray(p?.items) ? p.items : []
      if (!items.length) return done("admin_votes_snapshots_400", json({ error: "No items provided" }, 400))
      if (items.length > 5000) return done("admin_votes_snapshots_400", json({ error: "Too many items (max 5000)" }, 400))
      const userId = normalizeUserId(p?.user_id || p?.user || "local")

      const deduped = []
      const seen = new Set()
      for (const raw of items) {
        const symbol = normalizeSymbol(raw?.symbol || raw?.gene_symbol || "")
        const assetSha = normalizeSha256(raw?.asset_sha256 || raw?.sha256 || "")
        const candidateRef = normalizeCandidateRef(
          raw?.candidate_ref || (raw?.candidate_image_id ? `c:${String(raw.candidate_image_id)}` : ""),
          symbol,
          assetSha,
        )
        const visionId = normalizeVisionId(raw?.vision_id || "")
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
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_votes_vision_stats_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_votes_vision_stats_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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
        const visionId = normalizeVisionId(raw)
        if (!visionId || seenVision.has(visionId)) continue
        seenVision.add(visionId)
        visionIds.push(visionId)
      }
      if (visionIds.length > 2000) {
        return done("admin_votes_vision_stats_400", json({ error: "Too many vision_ids (max 2000)" }, 400))
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

    if (path === "/admin") {
      if (!(await isAdmin(request, env))) return done("admin_403", html("<h1>403 Unauthorized</h1>", 403))
      return done("admin", html(ICONOPLASM_ADMIN_HTML, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/iconoplasm/admin/assets" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_assets_403", json({ error: "Unauthorized" }, 403))
      const status = (url.searchParams.get("status") || "draft").toLowerCase()
      const limit = Math.max(1, Math.min(250, Number.parseInt(url.searchParams.get("limit") || "50", 10)))
      const where = status === "all" ? "" : "WHERE lower(status)=?"
      const stmt =
        status === "all"
          ? env.ICONOPLASM_DB.prepare(`SELECT gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, created_by, created_at FROM icono_portrait_assets ${where} ORDER BY created_at DESC LIMIT ?`).bind(limit)
          : env.ICONOPLASM_DB.prepare(`SELECT gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb, status, created_by, created_at FROM icono_portrait_assets ${where} ORDER BY created_at DESC LIMIT ?`).bind(status, limit)
      const { results } = await stmt.all()
      const base = portraitBase(url, env)
      const assets = (results || []).map((r) => ({ ...r, hero_url: r.r2_key_full ? joinUrl(base, r.r2_key_full) : null, medium_url: r.r2_key_medium ? joinUrl(base, r.r2_key_medium) : null, thumb_url: r.r2_key_thumb ? joinUrl(base, r.r2_key_thumb) : null }))
      return done("admin_assets", json({ assets, count: assets.length }, 200, { "Cache-Control": "no-store" }))
    }

    if (["/api/iconoplasm/admin/ingest", "/api/iconoplasm/admin/publish-local"].includes(path) && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_ingest_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_ingest_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      if (!env.ICONOPLASM_PORTRAITS) return done("admin_ingest_500", json({ error: "ICONOPLASM_PORTRAITS binding missing" }, 500))

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_ingest_400", json({ error: "Invalid JSON" }, 400))
      }

      const itemsRaw = Array.isArray(p?.items) ? p.items : [p]
      if (!itemsRaw.length) return done("admin_ingest_400", json({ error: "No items provided" }, 400))
      if (itemsRaw.length > 100) return done("admin_ingest_400", json({ error: "Too many items (max 100 per request)" }, 400))

      const actorId = await actor(request, env)
      const dryRun = coerceBoolean(p?.dry_run ?? p?.dryRun, false)
      const defaultPublish = path.endsWith("/publish-local") || coerceBoolean(p?.publish, false)
      const reasonDefault = String(p?.reason || "").slice(0, 2000) || null
      const createdByDefault = String(p?.created_by || p?.createdBy || actorId || "unknown").slice(0, 255)
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

          const publishNow = coerceBoolean(item?.publish, defaultPublish)
          const statusRequested = normalizeAssetStatus(item?.status, publishNow ? "approved" : "draft")
          const reason = String(item?.reason || reasonDefault || "").slice(0, 2000) || null
          const createdBy = String(item?.created_by || item?.createdBy || createdByDefault || "unknown").slice(0, 255)

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
                customMetadata: { gene_symbol: symbol, asset_sha256: assetSha, rendition: "medium" },
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

          const width = optionalInt(item?.width ?? fullPayload?.width)
          const height = optionalInt(item?.height ?? fullPayload?.height)
          const bytes = optionalInt(item?.bytes ?? fullPayload?.bytes ?? fullBytes?.byteLength)

          const existingAsset = await env.ICONOPLASM_DB.prepare(
            "SELECT status FROM icono_portrait_assets WHERE upper(gene_symbol)=? AND asset_sha256=? LIMIT 1",
          )
            .bind(symbol, assetSha)
            .first()
          const existingStatus = normalizeAssetStatus(existingAsset?.status || "", "draft")
          let finalStatus = statusRequested
          if (!publishNow && finalStatus === "draft" && (existingStatus === "approved" || existingStatus === "rejected")) {
            finalStatus = existingStatus
          }

          if (!dryRun) {
            await env.ICONOPLASM_DB.prepare(
              `INSERT INTO icono_portrait_assets (
                 gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
                 mime, width, height, bytes, status, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
                 r2_key_full=excluded.r2_key_full,
                 r2_key_medium=excluded.r2_key_medium,
                 r2_key_thumb=excluded.r2_key_thumb,
                 mime=excluded.mime,
                 width=COALESCE(excluded.width, icono_portrait_assets.width),
                 height=COALESCE(excluded.height, icono_portrait_assets.height),
                 bytes=COALESCE(excluded.bytes, icono_portrait_assets.bytes),
                 status=excluded.status,
                 created_by=COALESCE(excluded.created_by, icono_portrait_assets.created_by)`,
            )
              .bind(symbol, assetSha, keys.full, keys.medium, keys.thumb, width, height, bytes, finalStatus, createdBy)
              .run()
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
              await env.ICONOPLASM_DB.prepare("UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?").bind(symbol, assetSha).run()
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
              await env.ICONOPLASM_DB.prepare("UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?").bind(symbol, assetSha).run()
              await env.ICONOPLASM_DB.prepare(
                "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)",
              )
                .bind(symbol, fromAssetSha256, assetSha, actorId, reason)
                .run()
              publishResult = "published"
            }
          }

          const uploads = {
            full: exists.full ? "skipped_existing" : fullBytes ? (dryRun ? "would_upload" : "uploaded") : "missing_payload",
            medium: exists.medium ? "skipped_existing" : mediumBytes ? (dryRun ? "would_upload" : "uploaded") : "missing_payload",
            thumb: exists.thumb ? "skipped_existing" : thumbBytes ? (dryRun ? "would_upload" : "uploaded") : "missing_payload",
          }

          processed += 1
          results.push({
            ok: true,
            symbol,
            asset_sha256: assetSha,
            dry_run: dryRun,
            status: finalStatus,
            uploads,
            publish: publishResult,
            from_asset_sha256: fromAssetSha256,
            hero_url: joinUrl(base, keys.full),
            medium_url: joinUrl(base, keys.medium),
            thumb_url: joinUrl(base, keys.thumb),
            r2_keys: keys,
          })
        } catch (err) {
          failed += 1
          const rawSymbol = rawItem && typeof rawItem === "object" ? rawItem.symbol || rawItem.gene_symbol || null : null
          const rawSha = rawItem && typeof rawItem === "object" ? rawItem.asset_sha256 || rawItem.sha256 || null : null
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
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_reconcile_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB) return done("admin_reconcile_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_reconcile_400", json({ error: "Invalid JSON" }, 400))
      }

      const keepRaw = Array.isArray(p?.keep) ? p.keep : []
      const publishRaw = Array.isArray(p?.publish) ? p.publish : []
      if (keepRaw.length > 50000) return done("admin_reconcile_400", json({ error: "Too many keep entries (max 50000)" }, 400))
      if (publishRaw.length > 20000) return done("admin_reconcile_400", json({ error: "Too many publish entries (max 20000)" }, 400))

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

      const { results: existingAssets = [] } = await env.ICONOPLASM_DB
        .prepare("SELECT gene_symbol, asset_sha256, status FROM icono_portrait_assets")
        .all()

      const { results: existingStateRows = [] } = await env.ICONOPLASM_DB
        .prepare("SELECT gene_symbol, current_asset_sha256 FROM icono_publish_state")
        .all()
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
        await env.ICONOPLASM_DB
          .prepare("UPDATE icono_portrait_assets SET status='rejected' WHERE upper(gene_symbol)=? AND asset_sha256=?")
          .bind(symbol, assetSha)
          .run()
        await env.ICONOPLASM_DB
          .prepare(
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
        await env.ICONOPLASM_DB
          .prepare(
            `INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(gene_symbol) DO UPDATE SET
               current_asset_sha256=excluded.current_asset_sha256,
               updated_by=excluded.updated_by,
               updated_at=CURRENT_TIMESTAMP`,
          )
          .bind(symbol, targetAssetSha, actorId)
          .run()
        await env.ICONOPLASM_DB
          .prepare("UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?")
          .bind(symbol, targetAssetSha)
          .run()
        await env.ICONOPLASM_DB
          .prepare(
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
        await env.ICONOPLASM_DB
          .prepare("UPDATE icono_publish_state SET current_asset_sha256=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?")
          .bind(actorId, symbol)
          .run()
        await env.ICONOPLASM_DB
          .prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
          )
          .bind(symbol, currentAssetSha, null, actorId, reason)
          .run()
      }

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

    if (["/api/iconoplasm/admin/publish", "/api/iconoplasm/admin/reject", "/api/iconoplasm/admin/rollback", "/api/iconoplasm/admin/unpublish"].includes(path) && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env))) return done("admin_mut_403", json({ error: "Unauthorized" }, 403))
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
        const cur = await env.ICONOPLASM_DB.prepare("SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1").bind(symbol).first()
        await env.ICONOPLASM_DB.prepare(`INSERT INTO icono_publish_state (gene_symbol, current_asset_sha256, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(gene_symbol) DO UPDATE SET current_asset_sha256=excluded.current_asset_sha256, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`).bind(symbol, asset, actorId).run()
        await env.ICONOPLASM_DB.prepare("UPDATE icono_portrait_assets SET status='approved' WHERE upper(gene_symbol)=? AND asset_sha256=?").bind(symbol, asset).run()
        await env.ICONOPLASM_DB.prepare("INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'publish', ?, ?, CURRENT_TIMESTAMP)").bind(symbol, cur?.current_asset_sha256 || null, asset, actorId, String(p?.reason || "").slice(0, 2000) || null).run()
        return done("publish", json({ ok: true, action: "publish", symbol, to_asset_sha256: asset }))
      }

      if (path.endsWith("/reject")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset) return done("reject_400", json({ error: "Missing asset_sha256" }, 400))
        await env.ICONOPLASM_DB.prepare("UPDATE icono_portrait_assets SET status='rejected' WHERE upper(gene_symbol)=? AND asset_sha256=?").bind(symbol, asset).run()
        await env.ICONOPLASM_DB.prepare("INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'reject', ?, ?, CURRENT_TIMESTAMP)").bind(symbol, asset, asset, actorId, String(p?.reason || "").slice(0, 2000) || null).run()
        return done("reject", json({ ok: true, action: "reject", symbol, asset_sha256: asset }))
      }

      if (path.endsWith("/unpublish")) {
        const current = await env.ICONOPLASM_DB.prepare("SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1").bind(symbol).first()
        const from = current?.current_asset_sha256 || null
        if (!from) return done("unpublish_400", json({ error: "No published state to clear" }, 400))
        await env.ICONOPLASM_DB.prepare("UPDATE icono_publish_state SET current_asset_sha256=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?").bind(actorId, symbol).run()
        await env.ICONOPLASM_DB.prepare("INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)").bind(symbol, from, null, actorId, String(p?.reason || "").slice(0, 2000) || null).run()
        return done("unpublish", json({ ok: true, action: "unpublish", symbol, from_asset_sha256: from }))
      }

      const current = await env.ICONOPLASM_DB.prepare("SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1").bind(symbol).first()
      const from = current?.current_asset_sha256 || null
      if (!from) return done("rollback_400", json({ error: "No published state to roll back" }, 400))
      let target = String(p?.target_asset_sha256 || "").trim() || null
      if (!target) {
        const prev = await env.ICONOPLASM_DB.prepare("SELECT to_asset_sha256 FROM icono_publish_events WHERE upper(gene_symbol)=? AND action='publish' AND to_asset_sha256 IS NOT NULL AND to_asset_sha256 != ? ORDER BY id DESC LIMIT 1").bind(symbol, from).first()
        target = prev?.to_asset_sha256 || null
      }
      if (!target) return done("rollback_400", json({ error: "No prior published asset to roll back to" }, 400))
      await env.ICONOPLASM_DB.prepare("UPDATE icono_publish_state SET current_asset_sha256=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?").bind(target, actorId, symbol).run()
      await env.ICONOPLASM_DB.prepare("INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'rollback', ?, ?, CURRENT_TIMESTAMP)").bind(symbol, from, target, actorId, String(p?.reason || "").slice(0, 2000) || null).run()
      return done("rollback", json({ ok: true, action: "rollback", symbol, from_asset_sha256: from, to_asset_sha256: target }))
    }

    if (path === "/api/colors/manifest") return done("legacy_manifest", await handleLegacyColorsManifest(request, env))
    if (path.startsWith("/api/colors/colors.") && path.endsWith(".json")) return done("legacy_artifact", await handleLegacyColorsArtifact(env, path))

    if (path.startsWith("/api/")) return done("api_404", json({ error: "Not found" }, 404))

    // Non-API routes are handled by the index.js proxy (serves Quartz HTML from Pages)
    return done("404", json({ error: "Not found" }, 404))
  } catch (e) {
    const out = json({ error: "Internal server error" }, 500)
    await logReq("error", request, 500, started, null)
    return asHead(request, out)
  }
}
