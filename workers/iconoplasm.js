import { isAdmin } from "./admin.js"
import { parseCookies } from "./auth.js"
import { fetchProteinByGene, fetchProteinByUniprot } from "./lib/protein-store.js"

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
    "Access-Control-Allow-Headers": "If-None-Match, Content-Type, X-Iconoplasm-Extension-Version",
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

    if (path === "/admin/iconoplasm") {
      if (!(await isAdmin(request, env))) return done("admin_403", html("<h1>403 Unauthorized</h1>", 403))
      return done("admin", html("<!doctype html><html><body><h1>Iconoplasm Admin</h1><p>Use /api/iconoplasm/admin/* endpoints.</p></body></html>", 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/iconoplasm/admin/assets" && request.method === "GET") {
      if (!(await isAdmin(request, env))) return done("admin_assets_403", json({ error: "Unauthorized" }, 403))
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

    if (["/api/iconoplasm/admin/publish", "/api/iconoplasm/admin/reject", "/api/iconoplasm/admin/rollback"].includes(path) && request.method === "POST") {
      if (!(await isAdmin(request, env))) return done("admin_mut_403", json({ error: "Unauthorized" }, 403))
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
