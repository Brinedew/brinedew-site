import { isAdmin } from "./admin.js"
import { parseCookies } from "./auth.js"
import { fetchProteinByUniprot } from "./lib/protein-store.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { renderIconoplasmArtistStylesHtml } from "./iconoplasm-artist-styles-html.js"
import { ICONOPLASM_WIKI_PAGEVIEWS } from "./iconoplasm-wiki-pageviews.js"
import { normalizeIconoplasmHomeOrder } from "../quartz/static/iconoplasm/home-orders.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
// Public API cutover note:
// This worker now exposes one documented public contract under /api/public/v1.
// The extension and site are expected to use that same contract so we do not
// quietly drift back into a split legacy/public surface later.
//
// Data-lineage fence:
// The local Iconoplasm authoring/control-plane lives at
// `d:\\Coding\\Datasets\\iconoplasm`. When Website Ops sync or catalog facts look
// wrong, start there first. This worker is the public website/runtime boundary
// that ingests and serves published state; it should not grow ad hoc logic that
// compensates for missing upstream workstation exports.
//
// Voting architecture note:
// There are two legitimate vote writers in this system:
// 1) the local operator reviewing fresh candidates before publication, and
// 2) community users on the public site/extension voting on already-published assets.
//
// The local operator path lives in the workstation app and can see pre-publication
// candidates. Website Ops bulk sync is the boundary that publishes those assets here.
// This worker owns the public/community path only, so hot reads and writes should be
// optimized for published assets, cheap ranking refreshes, and Cloudflare request economy.
const API_SCHEMA_VERSION = 3
const PUBLIC_API_VERSION = "v1"
const PUBLIC_API_PREFIX = `/api/public/${PUBLIC_API_VERSION}`
const SITE_GENE_API_PREFIX = "/api/iconoplasm/site/genes"
const MIN_EXTENSION_VERSION = "0.3.0"

const KV_CATALOG_MANIFEST = "iconoplasm:catalog-manifest"
const KV_CATALOG_PREFIX = "iconoplasm:catalog:"
const KV_GALLERY_VERSION = "iconoplasm:gallery-version"
const KV_PUBLISHED_PORTRAIT_REFS_PREFIX = "iconoplasm:published-portrait-refs:"
const KV_PUBLISHED_PORTRAIT_FINGERPRINT_PREFIX = "iconoplasm:published-portrait-fingerprint:"
const KV_GALLERY_PUBLISHED_ROWS_PREFIX = "iconoplasm:gallery-published-rows:"
const KV_GALLERY_UNIQUENESS_ROWS_PREFIX = "iconoplasm:gallery-uniqueness-rows:"
const KV_HYDRATED_CATALOG_ARTIFACT_PREFIX = "iconoplasm:hydrated-catalog-artifact:"
const PUBLIC_DUMP_PREFIX = "public-dumps"
const PUBLIC_DEFAULT_GENE_BATCH_LIMIT = 100
const PUBLIC_MAX_GENE_BATCH_LIMIT = 250
const PUBLIC_MAX_RESOLVE_BATCH_LIMIT = 250
const DISCOVERY_SOURCE_EXTENSION_HOVER = "extension_hover"
const DISCOVERY_SOURCE_EXTENSION_GUEST_MERGE = "extension_guest_merge"
const DISCOVERY_SOURCE_STARTER_SEED = "starter_seed"
const DISCOVERY_TRIGGER_HOVER_DWELL = "hover_dwell"
const DISCOVERY_TRIGGER_GUEST_BUFFER_MERGE = "guest_buffer_merge"
const DISCOVERY_TRIGGER_STARTER_SEED = "starter_seed"
const ICONOPLASM_STARTER_GENE_SYMBOLS = ["INS", "RHO", "PRL"]

const catalogCache = {
  hash: null,
  bySymbol: new Map(),
  symbolByUniprot: new Map(),
  symbolByAlias: new Map(),
  loadedAt: 0,
}
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
const gallerySnapshotCache = {
  catalogHash: null,
  base: null,
  loadedAt: 0,
  items: [],
  publishedTotal: 0,
  hasUniquenessRanks: false,
  sorted: new Map(),
}
const GALLERY_SNAPSHOT_TTL_MS = 60 * 1000
const GALLERY_VOTES_SNAPSHOT_TTL_MS = 5 * 1000
const galleryVersionCache = {
  value: "0",
  loadedAt: 0,
}
const GALLERY_VERSION_CACHE_TTL_MS = 5 * 1000
// Cost barrier: local worker memory is not a billing barrier. Cloudflare can run
// many isolates at once, so any O(N) snapshot that lives only in module memory can
// multiply globally and burn D1 even when each isolate "looks cached" locally.
// Expensive public-read snapshots therefore need two layers:
//   1) fast in-isolate memory for repeat hits on the same isolate, and
//   2) a versioned shared KV snapshot so fresh isolates do not go back to D1.
//
// If you add a new full-table public read, do not rely on a plain JS object TTL.
// Put it behind the shared versioned cache pattern below and add a regression test
// that simulates a fresh isolate.
const publishedPortraitRefsCache = {
  key: null,
  value: null,
}
const publishedPortraitFingerprintCache = {
  loadedAt: 0,
  value: null,
}
const sharedPublishedPortraitFingerprintCache = {
  loadedAt: 0,
  value: null,
}
const PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS = 5 * 1000
const PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION = "v2"
const galleryPublishedRowsCache = {
  version: null,
  value: null,
}
const galleryUniquenessRowsCache = {
  version: null,
  value: null,
}
const hydratedCatalogArtifactCache = {
  key: null,
  value: null,
}
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
const ADMIN_READ_MODEL_SYNC_REQUEST_SYMBOL_MAX = 1000
const ADMIN_READ_MODEL_SYNC_REQUEST_VISION_MAX = 1000
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
const WORKFLOW_SUFFIX_RE = /\.(api|ui)$/i
const TRUSTED_ICONOPLASM_CLIENT_HOSTS = new Set([
  "iconoplasm.brinedew.bio",
  "brinedew.bio",
  "www.brinedew.bio",
  "staging.brinedew.bio",
  "localhost",
  "127.0.0.1",
])

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

function normalizeDiscoverySource(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
  if (v === DISCOVERY_SOURCE_EXTENSION_HOVER) return v
  if (v === DISCOVERY_SOURCE_EXTENSION_GUEST_MERGE) return v
  if (v === DISCOVERY_SOURCE_STARTER_SEED) return v
  return null
}

function normalizeDiscoveryTrigger(raw) {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
  if (v === DISCOVERY_TRIGGER_HOVER_DWELL) return v
  if (v === DISCOVERY_TRIGGER_GUEST_BUFFER_MERGE) return v
  if (v === DISCOVERY_TRIGGER_STARTER_SEED) return v
  return null
}

function normalizeBooleanQueryFlag(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  return value === "1" || value === "true" || value === "yes" || value === "on"
}

function normalizeDiscoveryDwellMs(raw) {
  const dwellMs = optionalInt(raw)
  if (dwellMs == null) return null
  return Math.max(0, Math.min(60000, dwellMs))
}

// Public blacklist submissions should not store raw visitor IPs in D1.
// Use an IP-only guest bucket here so switching browsers does not create a new
// submission identity. This is still anonymous, but it matches the product
// rule better than the earlier IP+UA hybrid.
async function buildArtistBlacklistRequesterId(request) {
  const ip = sanitizeText(request?.headers?.get("CF-Connecting-IP") || "", 64) || "unknown"
  const digest = await sha256Hex(`artist-blacklist-guest-v2\n${ip}`)
  return normalizeUserId(`guest_${digest.slice(0, 24)}`)
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

function normalizeArtistStylesPageHtml(html) {
  const source = String(html || "")
  // Deployment reality has been annoyingly sticky here: the route has kept
  // serving an older inline submit handler even after the template module was
  // edited. Normalize the critical anti-abuse copy at response time so repeat
  // submitters always see the same generic success state instead of an oracle.
  return source
    .replaceAll("Blacklist artist style", "Blocklist artist tag")
    .replaceAll("Blacklist an artist style.", "Blocklist an artist tag.")
    .replaceAll("If an Iconoplasm image looks like your style, enter your name or @tag and send it.", "If an Iconoplasm image matches your style, send the artist tag exactly as shown on the site.")
    .replaceAll("Artist name or @tag", "Artist tag")
    .replaceAll("Loish or @loish", "@artist_(name)")
    .replaceAll("Use the name or @tag from the style list.", "Use the exact @tag as shown on the site. Spaces are not allowed.")
    .replaceAll("Use the exact tag from the emulsion or style list. Spaces are not allowed.", "Use the exact @tag as shown on the site. Spaces are not allowed.")
    .replaceAll("Enter the artist name or @tag first.", "Enter the artist tag first. Example: @artist_(name)")
    .replace(
      "setStatus(data && data.duplicate ? 'That name was already submitted.' : 'Thanks. We got it.', 'ok');",
      "setStatus('Thanks. We got it.', 'ok');",
    )
    .replace("if (!data || !data.duplicate) {", "if (!data || data.accepted !== false) {")
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

function workflowStem(raw) {
  const value = String(raw || "").trim()
  if (!value) return ""
  const filename = value.split(/[\\/]/).pop() || value
  return filename.replace(/\.json$/i, "").replace(WORKFLOW_SUFFIX_RE, "").trim()
}

function workflowLabelFromPath(raw) {
  const stem = workflowStem(raw)
  if (!stem) return ""
  const parts = stem
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return ""
  return parts
    .map(function (part) {
      if (part.length <= 4 && part[0] && part[0] === part[0].toLowerCase()) return part
      return part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase()
    })
    .join(" ")
}

function workflowIdentityFromPath(raw) {
  const stem = workflowStem(raw)
  if (!stem) return ""
  const match = stem.match(/[A-Za-z0-9]+/)
  if (!match || !match[0]) return ""
  return match[0].slice(0, 1).toUpperCase()
}

function promptVersionFromVisionId(raw) {
  const visionId = normalizeVisionId(raw).toLowerCase()
  if (!visionId) return ""
  const match = visionId.match(/-v(\d+)(?:-\d+)?$/)
  if (!match) return ""
  return String(Number.parseInt(match[1], 10) || "")
}

function variantSlotFromVisionId(raw) {
  const visionId = normalizeVisionId(raw).toLowerCase()
  if (!visionId) return ""
  const match = visionId.match(/-(\d+)$/)
  if (!match) return ""
  return String(Number.parseInt(match[1], 10) || "")
}

function publicEmulsionIdForRow(row) {
  const explicitId = sanitizeText(row?.requested_emulsion_id || row?.emulsion_id || "", 64) || ""
  if (explicitId) return explicitId
  const workflowId =
    sanitizeText(row?.requested_workflow_id || row?.workflow_id || "", 32) ||
    workflowIdentityFromPath(
      row?.requested_workflow_path ||
        row?.workflow_path ||
        row?.requested_workflow_label ||
        row?.workflow_label ||
        "",
    )
  const promptVersion =
    sanitizeText(row?.requested_prompt_version || row?.prompt_version || "", 16) ||
    promptVersionFromVisionId(row?.requested_vision_id || row?.vision_id || "")
  const variantSlot =
    sanitizeText(row?.requested_variant_slot || row?.variant_slot || "", 32) ||
    variantSlotFromVisionId(row?.requested_vision_id || row?.vision_id || "")
  if (workflowId && promptVersion && variantSlot) return `${workflowId}${promptVersion}-${variantSlot}`
  return ""
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

function voteAssetIdentity(symbol, assetSha256) {
  return normalizeCandidateRef("", symbol, assetSha256)
}

async function appendVoteEvent(
  env,
  { symbol, assetSha256, visionId = "", candidateRef = "", candidateImageId = null, userId, voteValue },
) {
  if (!env?.ICONOPLASM_DB) return
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256)
  const safeUserId = normalizeUserId(userId)
  const safeVoteValue = normalizeVoteValue(voteValue)
  if (!safeSymbol || !safeAssetSha || !safeUserId || safeVoteValue === null) return
  const safeCandidateRef =
    normalizeCandidateRef(candidateRef, safeSymbol, safeAssetSha) || voteAssetIdentity(safeSymbol, safeAssetSha)
  const safeVisionId = sanitizeVoteVisionId(visionId || "")
  const safeCandidateImageId = optionalInt(candidateImageId)
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_vote_events (
       gene_symbol,
       asset_sha256,
       vision_id,
       candidate_ref,
       candidate_image_id,
       user_id,
       vote_value,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      safeSymbol,
      safeAssetSha,
      safeVisionId,
      safeCandidateRef,
      safeCandidateImageId,
      safeUserId,
      safeVoteValue,
    )
    .run()
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
    portraitFingerprint.latest_updated_at ?? portraitFingerprint.latest ?? portraitFingerprint.content_hash ?? "",
  )
  if (!count && !latest) return base
  return latest
    ? `${base}-${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}-${count}-${latest}`
    : `${base}-${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}-${count}`
}

function catalogBaseHash(rawHash) {
  return String(rawHash || "").trim().split("-")[0] || null
}

function portraitSnapshotVersion(rawFingerprint) {
  return `${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}-${portraitFingerprintVersion(rawFingerprint) || "none"}`
}

export function mergePublishedPortraitRefsIntoArtifact(artifact, publishedPortraits) {
  // Cost barrier: this touches the whole catalog artifact. That is acceptable at
  // publish time or behind a shared versioned cache. It is not acceptable as an
  // unguarded hot-path operation for every request or every cold isolate.
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
    if (published.ph && gene.ph !== published.ph) {
      nextGene = nextGene === gene ? { ...gene } : nextGene
      nextGene.ph = published.ph
      changed = true
    }
    if (published.pt && gene.pt !== published.pt) {
      nextGene = nextGene === gene ? { ...gene } : nextGene
      nextGene.pt = published.pt
      changed = true
    }
    return nextGene
  })

  if (!changed) return artifact
  return { ...artifact, genes: nextGenes }
}

async function queryPublishedPortraitFingerprint(env) {
  if (!env.ICONOPLASM_DB) return null
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT
         COUNT(*) AS published_count,
         GROUP_CONCAT(symbol_asset, '|') AS published_pairs
       FROM (
         SELECT gene_symbol || ':' || current_asset_sha256 AS symbol_asset
         FROM icono_publish_state
         WHERE current_asset_sha256 IS NOT NULL
         ORDER BY gene_symbol ASC
       )`,
    ).first()
    if (!row) return null
    const publishedCount = Number(row.published_count ?? 0)
    if (!publishedCount) {
      return { published_count: 0, latest: null }
    }
    return {
      published_count: publishedCount,
      latest: await sha256Hex(String(row.published_pairs || "")),
    }
  } catch {
    return null
  }
}

async function publishedPortraitFingerprint(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return null
  if (fresh) return queryPublishedPortraitFingerprint(env)
  const now = Date.now()
  if (
    publishedPortraitFingerprintCache.loadedAt > 0 &&
    now - publishedPortraitFingerprintCache.loadedAt < PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS
  ) {
    return publishedPortraitFingerprintCache.value || null
  }
  const row = await queryPublishedPortraitFingerprint(env)
  publishedPortraitFingerprintCache.loadedAt = now
  publishedPortraitFingerprintCache.value = row || null
  return row || null
}

async function sharedPublishedPortraitFingerprint(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return null
  if (fresh) return queryPublishedPortraitFingerprint(env)
  const now = Date.now()
  if (
    sharedPublishedPortraitFingerprintCache.loadedAt > 0 &&
    now - sharedPublishedPortraitFingerprintCache.loadedAt < PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS
  ) {
    return sharedPublishedPortraitFingerprintCache.value || null
  }
  if (env?.KV) {
    try {
      const raw = await env.KV.get(
        `${KV_PUBLISHED_PORTRAIT_FINGERPRINT_PREFIX}${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}`,
      )
      if (raw) {
        const parsed = JSON.parse(raw)
        const cachedAt = Number(parsed?.cached_at || 0)
        if (
          parsed?.fingerprint &&
          typeof parsed.fingerprint === "object" &&
          cachedAt > 0 &&
          now - cachedAt < PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS
        ) {
          sharedPublishedPortraitFingerprintCache.loadedAt = now
          sharedPublishedPortraitFingerprintCache.value = parsed.fingerprint
          return parsed.fingerprint
        }
      }
    } catch {
      // Shared fingerprint cache is a billing barrier, not the source of truth.
      // If it fails we fall back to the direct D1 probe below.
    }
  }
  const row = await queryPublishedPortraitFingerprint(env)
  sharedPublishedPortraitFingerprintCache.loadedAt = now
  sharedPublishedPortraitFingerprintCache.value = row || null
  if (row && env?.KV) {
    try {
      await env.KV.put(
        `${KV_PUBLISHED_PORTRAIT_FINGERPRINT_PREFIX}${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}`,
        JSON.stringify({ cached_at: now, fingerprint: row }),
      )
    } catch {
      // Same story: KV write-through failing should not break the live request.
    }
  }
  return row || null
}

async function queryPublishedPortraitRefs(env) {
  if (!env.ICONOPLASM_DB) return []
  try {
    // Cost barrier: this is a full published-inventory read. Keep the SQL itself
    // index-friendly, then keep almost all callers on the shared versioned KV
    // snapshot so fresh isolates do not repeat it.
    const rows = await env.ICONOPLASM_DB.prepare(
      `SELECT
         ps.gene_symbol AS symbol,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb
       FROM icono_publish_state ps
       LEFT JOIN icono_portrait_assets pa
         ON pa.gene_symbol = ps.gene_symbol
        AND pa.asset_sha256 = ps.current_asset_sha256
       WHERE ps.current_asset_sha256 IS NOT NULL`,
    ).all()
    return Array.isArray(rows?.results) ? rows.results : []
  } catch {
    return []
  }
}

async function publishedPortraitRefs(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return []
  if (fresh) return queryPublishedPortraitRefs(env)
  const version = portraitSnapshotVersion(await publishedPortraitFingerprint(env))
  if (publishedPortraitRefsCache.key === version && Array.isArray(publishedPortraitRefsCache.value)) {
    return publishedPortraitRefsCache.value
  }
  const cached = await readVersionedSharedJson(env, KV_PUBLISHED_PORTRAIT_REFS_PREFIX, version)
  if (Array.isArray(cached)) {
    publishedPortraitRefsCache.key = version
    publishedPortraitRefsCache.value = cached
    return cached
  }
  const rows = await queryPublishedPortraitRefs(env)
  publishedPortraitRefsCache.key = version
  publishedPortraitRefsCache.value = rows
  await writeVersionedSharedJson(env, KV_PUBLISHED_PORTRAIT_REFS_PREFIX, version, rows)
  return rows
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

function mapLocalRemovalRequestRow(row) {
  return {
    id: Number(row?.id || 0),
    gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
    asset_sha256: normalizeSha256(row?.asset_sha256 || "") || "",
    candidate_image_id: optionalInt(row?.candidate_image_id),
    vision_id: sanitizeText(row?.vision_id || "", 255) || "",
    requested_by: sanitizeText(row?.requested_by || "", 255) || "",
    reason: sanitizeText(row?.reason || "", 2000) || "",
    source: sanitizeText(row?.source || "", 64) || "",
    requested_at: sanitizeText(row?.requested_at || "", 64) || "",
    resolved_at: sanitizeText(row?.resolved_at || "", 64) || "",
    resolved_by: sanitizeText(row?.resolved_by || "", 255) || "",
    resolved_status: sanitizeText(row?.resolved_status || "", 64) || "",
    resolved_note: sanitizeText(row?.resolved_note || "", 2000) || "",
  }
}

function mapArtistBlacklistSubmissionRow(row) {
  return {
    id: Number(row?.id || 0),
    artist_name_input: normalizeArtistBlacklistSubmissionInput(row?.artist_name_input || "") || "",
    normalized_input: sanitizeText(row?.normalized_input || "", 255) || "",
    requested_by: sanitizeText(row?.requested_by || "", 255) || "",
    source: sanitizeText(row?.source || "", 64) || "",
    turnstile_passed: Number(row?.turnstile_passed || 0) > 0,
    requested_at: sanitizeText(row?.requested_at || "", 64) || "",
    resolved_at: sanitizeText(row?.resolved_at || "", 64) || "",
    resolved_by: sanitizeText(row?.resolved_by || "", 255) || "",
    resolved_status: sanitizeText(row?.resolved_status || "", 64) || "",
    resolved_note: sanitizeText(row?.resolved_note || "", 2000) || "",
  }
}

function normalizeGenerationRequestMode(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  return value === "specific" ? "specific" : "random"
}

function buildGenerationRequestLaneKey({ geneSymbol, requestMode, requestedVisionId } = {}) {
  const symbol = normalizeSymbol(geneSymbol || "") || ""
  const mode = normalizeGenerationRequestMode(requestMode)
  const visionId = mode === "specific" ? sanitizeVoteVisionId(requestedVisionId || "") : ""
  return `${symbol}|${mode}|${visionId || "random"}`
}

function generationRequestVisionLabel(row) {
  const emulsionId = publicEmulsionIdForRow(row)
  if (emulsionId) return emulsionId
  return sanitizeVoteVisionId(row?.requested_vision_id || row?.vision_id || "")
    ? "Specific emulsion"
    : ""
}

function mapGenerationRequestRow(row) {
  const geneSymbol = normalizeSymbol(row?.gene_symbol || "") || ""
  const requestMode = normalizeGenerationRequestMode(row?.request_mode)
  const requestedVisionId =
    requestMode === "specific" ? sanitizeVoteVisionId(row?.requested_vision_id || "") : ""
  return {
    id: Number(row?.id || 0),
    gene_symbol: geneSymbol,
    full_name: sanitizeText(row?.full_name || "", 255) || "",
    requester_user_id: sanitizeText(row?.requester_user_id || "", 255) || "",
    requester_username: sanitizeText(row?.requester_username || "", 255) || "",
    request_mode: requestMode,
    requested_vision_id: requestedVisionId,
    requested_emulsion_id:
      requestMode === "specific" ? publicEmulsionIdForRow(row) : "",
    requested_emulsion_label:
      requestMode === "specific" ? generationRequestVisionLabel(row) : "Random default",
    status: sanitizeText(row?.status || "", 64) || "open",
    created_at: sanitizeText(row?.created_at || "", 64) || "",
    updated_at: sanitizeText(row?.updated_at || "", 64) || "",
    fulfilled_at: sanitizeText(row?.fulfilled_at || "", 64) || "",
    fulfilled_by: sanitizeText(row?.fulfilled_by || "", 255) || "",
    fulfilled_asset_sha256: normalizeSha256(row?.fulfilled_asset_sha256 || "") || "",
    fulfilled_vision_id: sanitizeVoteVisionId(row?.fulfilled_vision_id || "") || "",
    fulfillment_note: sanitizeText(row?.fulfillment_note || "", 2000) || "",
    lane_key: buildGenerationRequestLaneKey({
      geneSymbol,
      requestMode,
      requestedVisionId,
    }),
  }
}

function mapGeneDiscoveryRow(row) {
  const weightKg = Number(row?.weight_kg)
  const ageYears = Number(row?.age_years)
  const uniquenessRank = Number(row?.uniqueness_rank)
  return {
    gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
    full_name: sanitizeText(row?.full_name || "", 255) || "",
    first_discovered_at: sanitizeText(row?.first_discovered_at || "", 64) || "",
    last_encountered_at: sanitizeText(row?.last_encountered_at || "", 64) || "",
    encounter_count: Math.max(0, Number.parseInt(String(row?.encounter_count || "0"), 10) || 0),
    first_source: sanitizeText(row?.first_source || "", 64) || "",
    last_source: sanitizeText(row?.last_source || "", 64) || "",
    first_trigger: sanitizeText(row?.first_trigger || "", 64) || "",
    last_trigger: sanitizeText(row?.last_trigger || "", 64) || "",
    first_dwell_ms: optionalInt(row?.first_dwell_ms),
    last_dwell_ms: optionalInt(row?.last_dwell_ms),
    weight_kg: Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null,
    age_years: Number.isFinite(ageYears) && ageYears >= 0 ? ageYears : null,
    uniqueness_rank: Number.isFinite(uniquenessRank) && uniquenessRank >= 0 ? uniquenessRank : null,
    popularity_score: wikiPageviewsForSymbol(row?.gene_symbol || ""),
    image_upvotes: Math.max(0, Number(row?.image_upvotes || 0) || 0),
    image_downvotes: Math.max(0, Number(row?.image_downvotes || 0) || 0),
    image_score: Number(row?.image_score || 0) || 0,
    published_at: sanitizeText(row?.published_at || "", 64) || "",
    asset_created_at: sanitizeText(row?.asset_created_at || "", 64) || "",
  }
}

function summarizeGenerationRequestRows(rows, { requesterUserId = "" } = {}) {
  const requesterNorm = normalizeUserId(requesterUserId || "")
  const laneMap = new Map()
  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const row = mapGenerationRequestRow(rawRow)
    if (!row.id || !row.gene_symbol) continue
    const existing = laneMap.get(row.lane_key)
    const requesterMatches = requesterNorm && row.requester_user_id === requesterNorm
    if (existing) {
      existing.request_count += 1
      if (requesterMatches) existing.my_request_count += 1
      existing.request_ids.push(row.id)
      continue
    }
    laneMap.set(row.lane_key, {
      lane_key: row.lane_key,
      gene_symbol: row.gene_symbol,
      full_name: row.full_name,
      request_mode: row.request_mode,
      requested_vision_id: row.requested_vision_id,
      requested_emulsion_id: row.requested_emulsion_id,
      requested_emulsion_label: row.requested_emulsion_label,
      request_count: 1,
      my_request_count: requesterMatches ? 1 : 0,
      request_ids: [row.id],
      created_at: row.created_at,
    })
  }
  return Array.from(laneMap.values()).sort(function (a, b) {
    return String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.lane_key || "").localeCompare(String(b.lane_key || ""))
  })
}

async function enrichGenerationRequestRows(env, rows) {
  return (Array.isArray(rows) ? rows : []).map(mapGenerationRequestRow)
}

async function listOpenGenerationRequests(
  env,
  { limit = 500, geneSymbol = "", requesterUserId = "" } = {},
) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedLimit = Math.max(1, Math.min(2000, Number.parseInt(String(limit || "500"), 10) || 500))
  const symbolNorm = normalizeSymbol(geneSymbol || "") || ""
  const requesterNorm = normalizeUserId(requesterUserId || "")
  const whereParts = ["gr.status = 'open'"]
  const params = []
  if (symbolNorm) {
    whereParts.push("gr.gene_symbol = ?")
    params.push(symbolNorm)
  }
  if (requesterNorm && !isGuestUserId(requesterNorm)) {
    whereParts.push("gr.requester_user_id = ?")
    params.push(requesterNorm)
  }
  const resp = await env.ICONOPLASM_DB.prepare(
    // D1 cost fence: gene symbols are normalized before they hit this queue.
    // Keep equality raw so the request panel stays on the index path instead of
    // forcing expression scans with upper(...).
    `SELECT
       gr.*, 
       COALESCE(gc.full_name, '') AS full_name,
       COALESCE(avr.emulsion_id, '') AS requested_emulsion_id,
       COALESCE(avr.workflow_id, '') AS requested_workflow_id,
       COALESCE(avr.workflow_label, '') AS requested_workflow_label,
       COALESCE(avr.prompt_version, '') AS requested_prompt_version,
       COALESCE(avr.variant_slot, '') AS requested_variant_slot
     FROM icono_generation_requests gr
     LEFT JOIN icono_gene_catalog gc
       ON gc.gene_symbol = gr.gene_symbol
     LEFT JOIN icono_admin_vision_rollup avr
       ON avr.vision_id = gr.requested_vision_id
     WHERE ${whereParts.join(" AND ")}
     ORDER BY gr.created_at ASC, gr.id ASC
     LIMIT ?`,
  )
    .bind(...params, cleanedLimit)
    .all()
  return enrichGenerationRequestRows(env, Array.isArray(resp?.results) ? resp.results : [])
}

async function createGenerationRequest(
  env,
  {
    geneSymbol,
    requesterUserId,
    requesterUsername = "",
    requestMode = "random",
    requestedVisionId = "",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  const symbolNorm = normalizeSymbol(geneSymbol || "")
  if (!symbolNorm) return { ok: false, error: "Missing or invalid gene symbol" }
  const requesterNorm = normalizeUserId(requesterUserId || "")
  if (!requesterNorm || isGuestUserId(requesterNorm)) {
    return { ok: false, error: "Authentication required" }
  }
  const mode = normalizeGenerationRequestMode(requestMode)
  const visionNorm = mode === "specific" ? sanitizeVoteVisionId(requestedVisionId || "") : ""
  if (mode === "specific" && !visionNorm) {
    return { ok: false, error: "Choose a specific emulsion before submitting a specific request." }
  }
  const insertResp = await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_generation_requests (
       gene_symbol,
       requester_user_id,
       requester_username,
       request_mode,
       requested_vision_id,
       status,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
  )
    .bind(
      symbolNorm,
      requesterNorm,
      sanitizeText(requesterUsername || "", 255) || "",
      mode,
      visionNorm,
    )
    .run()
  const requestId = Number(insertResp?.meta?.last_row_id || 0)
  const created = requestId
    ? await env.ICONOPLASM_DB.prepare(
        `SELECT gr.*, COALESCE(gc.full_name, '') AS full_name
         , COALESCE(avr.emulsion_id, '') AS requested_emulsion_id
         , COALESCE(avr.workflow_id, '') AS requested_workflow_id
         , COALESCE(avr.workflow_label, '') AS requested_workflow_label
         , COALESCE(avr.prompt_version, '') AS requested_prompt_version
         , COALESCE(avr.variant_slot, '') AS requested_variant_slot
         FROM icono_generation_requests gr
         LEFT JOIN icono_gene_catalog gc
           ON gc.gene_symbol = gr.gene_symbol
         LEFT JOIN icono_admin_vision_rollup avr
           ON avr.vision_id = gr.requested_vision_id
         WHERE gr.id = ?
         LIMIT 1`,
      )
        .bind(requestId)
        .first()
    : null
  const mapped = (await enrichGenerationRequestRows(env, created ? [created] : []))[0] || null
  return {
    ok: true,
    request: mapped,
  }
}

async function listGenerationRequestVisionOptions(env) {
  if (!env.ICONOPLASM_DB) return []
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT vision_id, emulsion_id, workflow_id, workflow_label, prompt_version, variant_slot, image_count, live_count
     FROM icono_admin_vision_rollup
     WHERE COALESCE(vision_id, '') <> ''
     ORDER BY live_count DESC, image_count DESC, vision_id ASC
     LIMIT 64`,
  ).all()
  const rows = Array.isArray(resp?.results) ? resp.results : []
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const visionId = sanitizeVoteVisionId(row?.vision_id || "")
      if (!visionId) return null
      const emulsionId = publicEmulsionIdForRow(row)
      const artistId = publicArtistIdForRow(row)
      const label = emulsionId || "Specific emulsion"
      return {
        vision_id: visionId,
        label,
        emulsion_id: emulsionId,
        artist_id: artistId,
        image_count: Number(row?.image_count || 0),
        live_count: Number(row?.live_count || 0),
      }
    })
    .filter(Boolean)
}

async function fulfillGenerationRequests(
  env,
  {
    items = [],
    resolvedBy = "workstation_sync",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, fulfilled: 0, request_ids: [], error: "ICONOPLASM_DB binding missing" }
  const actorNorm = normalizeUserId(resolvedBy || "workstation_sync")
  const fulfilledIds = new Set()
  let skipped = 0

  for (const rawItem of Array.isArray(items) ? items : []) {
    if (!rawItem || typeof rawItem !== "object") {
      skipped += 1
      continue
    }
    let requestIds = Array.from(
      new Set(
        (Array.isArray(rawItem.request_ids) ? rawItem.request_ids : [])
          .map((value) => Number(value || 0))
          .filter((value) => value > 0),
      ),
    )
    const requestMode = normalizeGenerationRequestMode(rawItem.request_mode)
    const symbolNorm = normalizeSymbol(rawItem.gene_symbol || rawItem.symbol || "") || ""
    const requestedVisionId =
      requestMode === "specific" ? sanitizeVoteVisionId(rawItem.requested_vision_id || "") : ""
    if (!requestIds.length && requestMode === "specific" && symbolNorm && requestedVisionId) {
      const fallbackResp = await env.ICONOPLASM_DB.prepare(
        `SELECT id
         FROM icono_generation_requests
         WHERE status = 'open'
           AND upper(gene_symbol) = ?
           AND request_mode = 'specific'
           AND requested_vision_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
        .bind(symbolNorm, requestedVisionId)
        .all()
      requestIds = (Array.isArray(fallbackResp?.results) ? fallbackResp.results : [])
        .map((row) => Number(row?.id || 0))
        .filter((value) => value > 0)
    }
    if (!requestIds.length) {
      skipped += 1
      continue
    }
    const fulfilledVisionId = sanitizeVoteVisionId(rawItem.fulfilled_vision_id || rawItem.vision_id || "")
    const fulfilledAssetSha = normalizeSha256(rawItem.fulfilled_asset_sha256 || rawItem.asset_sha256 || "") || ""
    const note = sanitizeText(rawItem.note || rawItem.fulfillment_note || "", 2000) || ""
    for (const requestId of requestIds) {
      const updateResp = await env.ICONOPLASM_DB.prepare(
        `UPDATE icono_generation_requests
         SET status = 'fulfilled',
             updated_at = CURRENT_TIMESTAMP,
             fulfilled_at = CURRENT_TIMESTAMP,
             fulfilled_by = ?,
             fulfilled_asset_sha256 = ?,
             fulfilled_vision_id = ?,
             fulfillment_note = ?
         WHERE id = ?
           AND status = 'open'`,
      )
        .bind(actorNorm, fulfilledAssetSha, fulfilledVisionId, note, requestId)
        .run()
      if (Number(updateResp?.meta?.changes || 0) > 0) {
        fulfilledIds.add(requestId)
      }
    }
  }

  return {
    ok: true,
    fulfilled: fulfilledIds.size,
    skipped,
    request_ids: Array.from(fulfilledIds).sort(function (a, b) {
      return a - b
    }),
  }
}

async function recordGeneDiscoveryEncounter(
  env,
  {
    userId,
    geneSymbol,
    source = DISCOVERY_SOURCE_EXTENSION_HOVER,
    trigger = DISCOVERY_TRIGGER_HOVER_DWELL,
    dwellMs = null,
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  const userIdNorm = normalizeUserId(userId || "")
  const geneSymbolNorm = normalizeSymbol(geneSymbol || "")
  const sourceNorm = normalizeDiscoverySource(source)
  const triggerNorm = normalizeDiscoveryTrigger(trigger)
  const dwellMsNorm = normalizeDiscoveryDwellMs(dwellMs)
  if (!geneSymbolNorm) return { ok: false, error: "Missing or invalid gene symbol" }
  if (!userIdNorm || isGuestUserId(userIdNorm)) return { ok: false, error: "Authentication required" }
  if (!sourceNorm) return { ok: false, error: "Missing or invalid discovery source" }
  if (!triggerNorm) return { ok: false, error: "Missing or invalid discovery trigger" }
  if (triggerNorm === DISCOVERY_TRIGGER_HOVER_DWELL && dwellMsNorm == null) {
    return { ok: false, error: "hover_dwell discovery events must include dwell_ms" }
  }

  async function readDiscoveryRow() {
    // D1 cost fence: extension hover dwell is one of the highest-frequency public
    // write paths in Iconoplasm. `icono_gene_discoveries` already stores
    // canonical uppercase symbols and uses PRIMARY KEY (user_id, gene_symbol), so
    // this predicate must stay raw. Wrapping gene_symbol in upper(...) turns a
    // single hover into a scan over that user's discovery shelf.
    return env.ICONOPLASM_DB.prepare(
      `SELECT *
       FROM icono_gene_discoveries
       WHERE user_id = ?
         AND gene_symbol = ?
       LIMIT 1`,
    )
      .bind(userIdNorm, geneSymbolNorm)
      .first()
  }

  const existing = await readDiscoveryRow()

  if (existing) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_gene_discoveries
       SET last_encountered_at = CURRENT_TIMESTAMP,
           encounter_count = encounter_count + 1,
           last_source = ?,
           last_trigger = ?,
           last_dwell_ms = ?
       WHERE user_id = ?
         AND gene_symbol = ?`,
    )
      .bind(sourceNorm, triggerNorm, dwellMsNorm, userIdNorm, geneSymbolNorm)
      .run()
  } else {
    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_gene_discoveries (
         user_id,
         gene_symbol,
         first_source,
         last_source,
         first_trigger,
         last_trigger,
         first_dwell_ms,
         last_dwell_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        userIdNorm,
        geneSymbolNorm,
        sourceNorm,
        sourceNorm,
        triggerNorm,
        triggerNorm,
        dwellMsNorm,
        dwellMsNorm,
      )
      .run()
  }

  const row = await readDiscoveryRow()

  return {
    ok: true,
    created: !existing,
    discovery: mapGeneDiscoveryRow(row || {}),
  }
}

async function ensureStarterGeneDiscoveries(env, { userId } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) {
    return { ok: false, error: "Authentication required" }
  }
  const createdSymbols = []
  // Starter genes are part of the signed-in shelf contract. Backfill them lazily on
  // shelf/bootstrap endpoints so legacy accounts and brand-new logins stop showing a
  // literal zero-state shelf.
  //
  // Cost fence: do not call this from extension hover dwell writes. Even with raw
  // key predicates, three existence probes on every hover would still multiply into
  // absurd D1 traffic.
  for (const geneSymbol of ICONOPLASM_STARTER_GENE_SYMBOLS) {
    const existing = await env.ICONOPLASM_DB.prepare(
      `SELECT 1
       FROM icono_gene_discoveries
       WHERE user_id = ?
         AND gene_symbol = ?
       LIMIT 1`,
    )
      .bind(userIdNorm, geneSymbol)
      .first()
    if (existing) continue
    const result = await recordGeneDiscoveryEncounter(env, {
      userId: userIdNorm,
      geneSymbol,
      source: DISCOVERY_SOURCE_STARTER_SEED,
      trigger: DISCOVERY_TRIGGER_STARTER_SEED,
      dwellMs: null,
    })
    if (result.ok && result.created) createdSymbols.push(geneSymbol)
  }
  return {
    ok: true,
    created: createdSymbols.length,
    symbols: createdSymbols,
  }
}

async function listUserGeneDiscoveries(env, { userId, limit = 5000, order = "newest", seed = null } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return []
  const cleanedLimit = Math.max(1, Math.min(10000, Number.parseInt(String(limit || "5000"), 10) || 5000))
  // These runtime tables already store canonical gene_symbol primary keys.
  // Keep the joins/order on the raw key so SQLite can use the indexes instead
  // of scanning and temp-sorting the whole shelf query.
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT
       d.*,
       COALESCE(NULLIF(TRIM(ge.full_name), ''), NULLIF(TRIM(gc.full_name), ''), upper(d.gene_symbol)) AS full_name,
       ge.weight_kg,
       ge.age_years,
       ge.leakage_percent AS uniqueness_rank,
       COALESCE(gr.live_upvotes, 0) AS image_upvotes,
       COALESCE(gr.live_downvotes, 0) AS image_downvotes,
       COALESCE(gr.live_score, 0) AS image_score,
       gr.live_created_at AS published_at,
       gr.live_created_at AS asset_created_at
     FROM icono_gene_discoveries d
     LEFT JOIN icono_gene_essence ge
       ON ge.gene_symbol = d.gene_symbol
     LEFT JOIN icono_gene_catalog gc
       ON gc.gene_symbol = d.gene_symbol
     LEFT JOIN icono_admin_gene_rollup gr
       ON gr.gene_symbol = d.gene_symbol
     WHERE d.user_id = ?
     ORDER BY d.first_discovered_at ASC, d.gene_symbol ASC
     LIMIT ?`,
  )
    .bind(userIdNorm, cleanedLimit)
    .all()
  return sortDiscoveryRowsForOrder(
    (Array.isArray(rows?.results) ? rows.results : []).map(mapGeneDiscoveryRow),
    normalizeIconoplasmHomeOrder(order, "newest"),
    seed,
  )
}

async function listAllCatalogGeneDiscoveriesForAdmin(env, { userId, limit = 5000, order = "newest", seed = null } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return []
  const cleanedLimit = Math.max(1, Math.min(10000, Number.parseInt(String(limit || "5000"), 10) || 5000))
  // The admin show-all shelf sits on the homepage critical path. Wrapping these
  // key joins in upper(...) forced full scans and a temp B-tree sort in prod,
  // which is why Pokedex mode got stuck on "Loading your collection...".
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT
       gc.gene_symbol,
       COALESCE(NULLIF(TRIM(ge.full_name), ''), NULLIF(TRIM(gc.full_name), ''), upper(gc.gene_symbol)) AS full_name,
       d.first_discovered_at,
       d.last_encountered_at,
       COALESCE(d.encounter_count, 0) AS encounter_count,
       COALESCE(d.first_source, '') AS first_source,
       COALESCE(d.last_source, '') AS last_source,
       COALESCE(d.first_trigger, '') AS first_trigger,
       COALESCE(d.last_trigger, '') AS last_trigger,
       d.first_dwell_ms,
       d.last_dwell_ms,
       ge.weight_kg,
       ge.age_years,
       ge.leakage_percent AS uniqueness_rank,
       COALESCE(gr.live_upvotes, 0) AS image_upvotes,
       COALESCE(gr.live_downvotes, 0) AS image_downvotes,
       COALESCE(gr.live_score, 0) AS image_score,
       gr.live_created_at AS published_at,
       gr.live_created_at AS asset_created_at
     FROM icono_gene_catalog gc
     LEFT JOIN icono_gene_essence ge
       ON ge.gene_symbol = gc.gene_symbol
     LEFT JOIN icono_gene_discoveries d
       ON d.user_id = ?
      AND d.gene_symbol = gc.gene_symbol
     LEFT JOIN icono_admin_gene_rollup gr
       ON gr.gene_symbol = gc.gene_symbol
     ORDER BY gc.gene_symbol ASC
     LIMIT ?`,
  )
    .bind(userIdNorm, cleanedLimit)
    .all()
  return sortDiscoveryRowsForOrder(
    (Array.isArray(rows?.results) ? rows.results : []).map(mapGeneDiscoveryRow),
    normalizeIconoplasmHomeOrder(order, "newest"),
    seed,
  )
}

async function mergeGuestGeneDiscoveries(
  env,
  {
    userId,
    symbols = [],
  } = {},
) {
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) {
    return { ok: false, error: "Authentication required" }
  }
  await ensureStarterGeneDiscoveries(env, { userId: userIdNorm })
  const requestedSymbols = normalizeRequestedSymbols(symbols, 2000)
  if (!requestedSymbols.length) {
    return {
      ok: true,
      merged_count: 0,
      discoveries: await listUserGeneDiscoveries(env, { userId: userIdNorm }),
    }
  }
  let mergedCount = 0
  for (const symbol of requestedSymbols) {
    const result = await recordGeneDiscoveryEncounter(env, {
      userId: userIdNorm,
      geneSymbol: symbol,
      source: DISCOVERY_SOURCE_EXTENSION_GUEST_MERGE,
      trigger: DISCOVERY_TRIGGER_GUEST_BUFFER_MERGE,
      dwellMs: null,
    })
    if (result.ok) mergedCount += 1
  }
  return {
    ok: true,
    merged_count: mergedCount,
    discoveries: await listUserGeneDiscoveries(env, { userId: userIdNorm }),
  }
}

async function queueLocalRemovalRequest(
  env,
  {
    symbol,
    assetSha256,
    candidateImageId = null,
    visionId = "",
    requestedBy = "",
    reason = "",
    source = "admin_remove",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return null
  const symbolNorm = normalizeSymbol(symbol)
  const assetShaNorm = normalizeSha256(assetSha256)
  if (!symbolNorm || !assetShaNorm) return null

  const existing = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_local_removal_requests
     WHERE upper(gene_symbol) = ?
       AND lower(asset_sha256) = ?
       AND resolved_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
  )
    .bind(symbolNorm, assetShaNorm)
    .first()
  if (existing) {
    return {
      ok: true,
      queued: false,
      duplicate: true,
      request: mapLocalRemovalRequestRow(existing),
    }
  }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_local_removal_requests (
       gene_symbol,
       asset_sha256,
       candidate_image_id,
       vision_id,
       requested_by,
       reason,
       source
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      symbolNorm,
      assetShaNorm,
      optionalInt(candidateImageId),
      sanitizeText(visionId || "", 255) || "",
      normalizeUserId(requestedBy || "admin_remove"),
      sanitizeText(reason || "", 2000) || "",
      sanitizeText(source || "", 64) || "admin_remove",
    )
    .run()

  const created = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_local_removal_requests
     WHERE upper(gene_symbol) = ?
       AND lower(asset_sha256) = ?
       AND resolved_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
  )
    .bind(symbolNorm, assetShaNorm)
    .first()

  return {
    ok: true,
    queued: true,
    duplicate: false,
    request: mapLocalRemovalRequestRow(created),
  }
}

async function queueArtistBlacklistSubmission(
  env,
  {
    artistNameInput,
    requestedBy = "",
    source = "public_form",
    turnstilePassed = false,
    enforceRequesterLock = true,
  } = {},
) {
  if (!env.ICONOPLASM_DB) return null
  const artistNameInputNorm = normalizeArtistBlacklistSubmissionInput(artistNameInput)
  const normalizedInput = normalizeArtistBlacklistSubmissionKey(artistNameInputNorm)
  const requesterNorm = normalizeUserId(requestedBy || "public_form")
  if (!artistNameInputNorm || !normalizedInput) return null

  const existing = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_artist_blacklist_submissions
     WHERE normalized_input = ?
       AND resolved_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
  )
    .bind(normalizedInput)
    .first()
  if (existing) {
    return {
      ok: true,
      queued: false,
      duplicate: true,
      request: mapArtistBlacklistSubmissionRow(existing),
    }
  }

  // Product rule: one visitor gets one blacklist submission, full stop.
  // We intentionally do not reopen the gate after review because the form is
  // supposed to be a one-shot opt-out request channel, not a moderation inbox
  // that one person can keep feeding forever.
  if (enforceRequesterLock) {
    const existingForRequester = await env.ICONOPLASM_DB.prepare(
      `SELECT *
       FROM icono_artist_blacklist_submissions
       WHERE requested_by = ?
       ORDER BY requested_at ASC, id ASC
       LIMIT 1`,
    )
      .bind(requesterNorm)
      .first()
    if (existingForRequester) {
      return {
        ok: true,
        queued: false,
        duplicate: false,
        requesterLocked: true,
        request: mapArtistBlacklistSubmissionRow(existingForRequester),
      }
    }
  }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_artist_blacklist_submissions (
       artist_name_input,
       normalized_input,
       requested_by,
       source,
       turnstile_passed
     ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      artistNameInputNorm,
      normalizedInput,
      requesterNorm,
      sanitizeText(source || "", 64) || "public_form",
      turnstilePassed ? 1 : 0,
    )
    .run()

  const created = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_artist_blacklist_submissions
     WHERE normalized_input = ?
       AND resolved_at IS NULL
     ORDER BY id DESC
     LIMIT 1`,
  )
    .bind(normalizedInput)
    .first()

  return {
    ok: true,
    queued: true,
    duplicate: false,
    request: mapArtistBlacklistSubmissionRow(created),
  }
}

async function listPendingArtistBlacklistSubmissions(env, { limit = 200 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedLimit = Math.max(
    1,
    Math.min(1000, Number.parseInt(String(limit || "200"), 10) || 200),
  )
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_artist_blacklist_submissions
     WHERE resolved_at IS NULL
     ORDER BY requested_at ASC, id ASC
     LIMIT ?`,
  )
    .bind(cleanedLimit)
    .all()
  return (Array.isArray(resp?.results) ? resp.results : []).map(mapArtistBlacklistSubmissionRow)
}

async function resolveArtistBlacklistSubmissions(
  env,
  {
    results = [],
    resolvedBy = "",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { resolved: 0, requests: [] }
  const actorNorm = normalizeUserId(resolvedBy || "workstation_sync")
  const cleanedResults = Array.from(
    new Map(
      (Array.isArray(results) ? results : [])
        .map((raw) => {
          const id = Number(raw?.id || 0)
          if (!(id > 0)) return null
          return [
            id,
            {
              id,
              status: sanitizeText(raw?.status || "", 64) || "applied",
              note: sanitizeText(raw?.note || "", 2000) || "",
            },
          ]
        })
        .filter(Boolean),
    ).values(),
  )
  const resolvedRows = []
  for (const item of cleanedResults) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_artist_blacklist_submissions
       SET resolved_at = CURRENT_TIMESTAMP,
           resolved_by = ?,
           resolved_status = ?,
           resolved_note = ?
       WHERE id = ?
         AND resolved_at IS NULL`,
    )
      .bind(actorNorm, item.status, item.note, item.id)
      .run()
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT *
       FROM icono_artist_blacklist_submissions
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(item.id)
      .first()
    if (row) resolvedRows.push(mapArtistBlacklistSubmissionRow(row))
  }
  return {
    resolved: resolvedRows.length,
    requests: resolvedRows,
  }
}

async function listPendingLocalRemovalRequests(env, { limit = 200 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedLimit = Math.max(
    1,
    Math.min(1000, Number.parseInt(String(limit || "200"), 10) || 200),
  )
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_local_removal_requests
     WHERE resolved_at IS NULL
     ORDER BY requested_at ASC, id ASC
     LIMIT ?`,
  )
    .bind(cleanedLimit)
    .all()
  return (Array.isArray(resp?.results) ? resp.results : []).map(mapLocalRemovalRequestRow)
}

async function resolveLocalRemovalRequests(
  env,
  {
    results = [],
    resolvedBy = "",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { resolved: 0, requests: [] }
  const actorNorm = normalizeUserId(resolvedBy || "workstation_sync")
  const cleanedResults = Array.from(
    new Map(
      (Array.isArray(results) ? results : [])
        .map((raw) => {
          const id = Number(raw?.id || 0)
          if (!(id > 0)) return null
          return [
            id,
            {
              id,
              status: sanitizeText(raw?.status || "", 64) || "applied",
              note: sanitizeText(raw?.note || "", 2000) || "",
            },
          ]
        })
        .filter(Boolean),
    ).values(),
  )
  const resolvedRows = []
  for (const item of cleanedResults) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_local_removal_requests
       SET resolved_at = CURRENT_TIMESTAMP,
           resolved_by = ?,
           resolved_status = ?,
           resolved_note = ?
       WHERE id = ?
         AND resolved_at IS NULL`,
    )
      .bind(actorNorm, item.status, item.note, item.id)
      .run()
    const row = await env.ICONOPLASM_DB.prepare(
      `SELECT *
       FROM icono_local_removal_requests
       WHERE id = ?
       LIMIT 1`,
    )
      .bind(item.id)
      .first()
    if (row) resolvedRows.push(mapLocalRemovalRequestRow(row))
  }
  return {
    resolved: resolvedRows.length,
    requests: resolvedRows,
  }
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

function normalizeCatalogAliases(raw, { maxItems = 48, maxLen = 64 } = {}) {
  const out = []
  const seen = new Set()
  const pushValue = (value) => {
    let cleaned = sanitizeText(value, maxLen)
    if (!cleaned) return
    cleaned = cleaned.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim()
    if (!cleaned || cleaned.includes(" ")) return
    const key = cleaned.toUpperCase()
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
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          pushValue(item)
          if (out.length >= maxItems) break
        }
        return out
      }
    } catch {}
    for (const part of raw.split(",")) {
      pushValue(part)
      if (out.length >= maxItems) break
    }
  }
  return out
}

function normalizeCatalogAliasLookupKey(raw) {
  const aliases = normalizeCatalogAliases([raw], { maxItems: 1 })
  return aliases.length ? String(aliases[0]).toUpperCase() : ""
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
  const leakagePercent = optionalFloat(payload.leakage_percent, { min: 0 })
  const leakageHits = optionalInt(payload.leakage_hits)
  const leakageTotal = optionalInt(payload.leakage_total)
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
    leakage_percent: leakagePercent,
    leakage_hits: leakageHits,
    leakage_total: leakageTotal,
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
    item.aliases_json || "[]",
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
    essence.leakage_percent ?? null,
    essence.leakage_hits ?? null,
    essence.leakage_total ?? null,
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
      leakage_percent,
      leakage_hits,
      leakage_total,
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      leakage_percent=excluded.leakage_percent,
      leakage_hits=excluded.leakage_hits,
      leakage_total=excluded.leakage_total,
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
      essence.leakage_percent,
      essence.leakage_hits,
      essence.leakage_total,
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
    const fresh = { start: now, count: 1 }
    rlBuckets.set(key, fresh)
    return {
      retryAfterSeconds: null,
      headers: {
        "X-RateLimit-Limit": String(maxPerMin),
        "X-RateLimit-Period": String(Math.floor(RL_WINDOW_MS / 1000)),
        "X-RateLimit-Remaining": String(Math.max(0, maxPerMin - fresh.count)),
        "X-RateLimit-Reset": String(Math.ceil(RL_WINDOW_MS / 1000)),
      },
    }
  }
  item.count += 1
  const resetSeconds = Math.max(1, Math.ceil((RL_WINDOW_MS - (now - item.start)) / 1000))
  if (item.count > maxPerMin) {
    return {
      retryAfterSeconds: resetSeconds,
      headers: {
        "X-RateLimit-Limit": String(maxPerMin),
        "X-RateLimit-Period": String(Math.floor(RL_WINDOW_MS / 1000)),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(resetSeconds),
      },
    }
  }
  return {
    retryAfterSeconds: null,
    headers: {
      "X-RateLimit-Limit": String(maxPerMin),
      "X-RateLimit-Period": String(Math.floor(RL_WINDOW_MS / 1000)),
      "X-RateLimit-Remaining": String(Math.max(0, maxPerMin - item.count)),
      "X-RateLimit-Reset": String(resetSeconds),
    },
  }
}

function requestHeaderHost(request, headerName) {
  const raw = String(request.headers.get(headerName) || "").trim()
  if (!raw) return ""
  try {
    return new URL(raw).host.toLowerCase()
  } catch {
    return ""
  }
}

function hasTrustedIconoplasmBrowserOrigin(request) {
  const originHost = requestHeaderHost(request, "Origin")
  const refererHost = requestHeaderHost(request, "Referer")
  if (originHost && TRUSTED_ICONOPLASM_CLIENT_HOSTS.has(originHost)) return true
  if (refererHost && TRUSTED_ICONOPLASM_CLIENT_HOSTS.has(refererHost)) return true
  return false
}

function hasExtensionClientHeader(request) {
  return Boolean(String(extVersion(request) || "").trim())
}

function publicRichRouteDeniedPayload(url, routeKey) {
  return {
    error:
      routeKey === "gene_batch"
        ? "High-fanout batch reads are reserved for the Iconoplasm website UI and browser extension"
        : "Rich per-gene detail is reserved for the Iconoplasm website UI",
    code: "FIRST_PARTY_ONLY",
    faq_url: "https://brinedew.bio/posts/Iconoplasm-FAQ.html",
    recommended_public_api: {
      metadata: publicUrl(url, "/metadata"),
      catalog_manifest: publicUrl(url, "/catalog/manifest"),
      changes: publicUrl(url, "/changes"),
      resolve: publicUrl(url, "/resolve"),
    },
  }
}

function canAccessRichBatchRoute(request, env) {
  if (hasAdminToken(request, env)) return true
  if (hasExtensionClientHeader(request)) return true
  return hasTrustedIconoplasmBrowserOrigin(request)
}

function normalizeArtistBlacklistSubmissionInput(raw) {
  return sanitizeText(raw, 255).replace(/\s+/g, " ").trim()
}

function normalizeArtistBlacklistSubmissionKey(raw) {
  const cleaned = normalizeArtistBlacklistSubmissionInput(raw)
  if (!cleaned) return ""
  const bare = cleaned.startsWith("@") ? cleaned.slice(1) : cleaned
  const token = bare
    .toLowerCase()
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\/g, "")
    .replace(/&/g, " and ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9()]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/\(_/g, "(")
    .replace(/_\)/g, ")")
  return token ? `@${token}` : ""
}

async function verifyTurnstileSubmission(env, request, token) {
  const secret = sanitizeText(env.ICONOPLASM_TURNSTILE_SECRET_KEY || "", 255) || ""
  if (!secret) {
    return { configured: false, passed: true, reason: "unconfigured" }
  }
  const cleanedToken = sanitizeText(token || "", 4096) || ""
  if (!cleanedToken) {
    return { configured: true, passed: false, reason: "missing" }
  }

  const payload = new URLSearchParams()
  payload.set("secret", secret)
  payload.set("response", cleanedToken)
  const remoteIp = sanitizeText(request.headers.get("CF-Connecting-IP") || "", 64) || ""
  if (remoteIp) payload.set("remoteip", remoteIp)

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload,
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return { configured: true, passed: false, reason: `siteverify_http_${resp.status}` }
    }
    return {
      configured: true,
      passed: Boolean(data?.success),
      reason: Array.isArray(data?.["error-codes"]) ? data["error-codes"].join(",") : "",
    }
  } catch (error) {
    return {
      configured: true,
      passed: false,
      reason:
        sanitizeText(String(error?.message || error || "turnstile_failed"), 255) ||
        "turnstile_failed",
    }
  }
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
  // Cost barrier: the public manifest is the extension's "what changed?" probe.
  // If this starts doing raw D1 work per request, extension traffic can amplify
  // the mistake globally. Keep it on the shared fingerprint cache.
  return {
    ...manifest,
    current_hash: buildPortraitAwareManifestHash(
      manifest.current_hash,
      await sharedPublishedPortraitFingerprint(env),
    ),
    portrait_base_url: portraitBase(url, env),
  }
}

function publicApiPath(suffix = "") {
  const normalized = String(suffix || "")
  if (!normalized) return PUBLIC_API_PREFIX
  return normalized.startsWith("/")
    ? `${PUBLIC_API_PREFIX}${normalized}`
    : `${PUBLIC_API_PREFIX}/${normalized}`
}

function publicUrl(url, suffix = "") {
  return `${url.origin}${publicApiPath(suffix)}`
}

function isPublicCatalogArtifactPath(path) {
  return path.startsWith(publicApiPath("/catalog/catalog.")) && path.endsWith(".json")
}

const ICONOPLASM_GATEWAY_INTERNAL_HEADER = "x-iconoplasm-db-gateway-internal"
const ICONOPLASM_GATEWAY_CANON_REPAIR_PATH = "/__internal/iconoplasm/repair-canon-invariants"

function isIconoplasmGatewayInternalRequest(request) {
  return String(request?.headers?.get(ICONOPLASM_GATEWAY_INTERNAL_HEADER) || "") === "1"
}

function isIconoplasmGatewayCanonRepairRequest(path, method = "GET") {
  return path === ICONOPLASM_GATEWAY_CANON_REPAIR_PATH && String(method || "GET").toUpperCase() === "POST"
}

function iconoplasmGatewayEligiblePath(path, method = "GET") {
  const requestMethod = String(method || "GET").toUpperCase()
  if (!["GET", "HEAD", "POST"].includes(requestMethod)) return false
  if (path === publicApiPath("/metadata")) return true
  if (path === publicApiPath("/catalog/manifest")) return true
  if (isPublicCatalogArtifactPath(path)) return true
  if (path === publicApiPath("/gallery")) return true
  if (path === publicApiPath("/genes/search")) return true
  if (path === publicApiPath("/genes/batch")) return requestMethod === "POST"
  if (path.startsWith(publicApiPath("/genes/"))) return true
  if (path === publicApiPath("/resolve")) return true
  if (path === publicApiPath("/changes")) return true
  if (path.startsWith(publicApiPath("/media/"))) return true
  if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) return true
  if (path.startsWith("/api/iconoplasm/")) {
    if (path === "/api/iconoplasm/admin/me") return false
    if (path === "/api/iconoplasm/votes/me") return false
    return true
  }
  return false
}

function missingOnlyAllowedGatewayResponse() {
  return json(
    {
      error: "THE_ONLY_ALLOWED_DB_GATEWAY binding missing for a fail-closed public route",
      code: "DB_GATEWAY_REQUIRED",
    },
    503,
    { "Cache-Control": "no-store" },
  )
}

async function proxyIconoplasmRequestToDbGateway(request, env) {
  // BILLING / CAPABILITY BARRIER: gateway-eligible Iconoplasm routes must go
  // through THE_ONLY_ALLOWED_DB_GATEWAY. If you are tempted to point these
  // paths back at raw ICONOPLASM_DB.prepare(...), stop and read the
  // cost-barrier tests first.
  const gateway = env?.THE_ONLY_ALLOWED_DB_GATEWAY
  const url = new URL(request.url)
  if (!iconoplasmGatewayEligiblePath(url.pathname, request.method)) return null
  if (!gateway || typeof gateway.fetch !== "function") return missingOnlyAllowedGatewayResponse()
  const upstreamRequest = new Request(`https://the-only-allowed-db-gateway${url.pathname}${url.search}`, {
    method: request.method,
    headers: request.headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.clone().text(),
  })
  try {
    return await gateway.fetch(upstreamRequest)
  } catch {
    return json(
      {
        error: "THE_ONLY_ALLOWED_DB_GATEWAY request failed",
        code: "DB_GATEWAY_UNAVAILABLE",
      },
      503,
      { "Cache-Control": "no-store" },
    )
  }
}

export async function runIconoplasmCanonMaintenanceThroughGateway(
  env,
  { limit = 250, actorId = "system", reason = "" } = {},
) {
  const gateway = env?.THE_ONLY_ALLOWED_DB_GATEWAY
  if (!gateway || typeof gateway.fetch !== "function") {
    throw new Error("THE_ONLY_ALLOWED_DB_GATEWAY binding missing for canon maintenance")
  }
  const response = await gateway.fetch(
    new Request(`https://the-only-allowed-db-gateway${ICONOPLASM_GATEWAY_CANON_REPAIR_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit, actorId, reason }),
    }),
  )
  if (!response.ok) {
    let detail = ""
    try {
      detail = await response.text()
    } catch {}
    throw new Error(
      `THE_ONLY_ALLOWED_DB_GATEWAY canon maintenance failed (${response.status})${detail ? `: ${detail}` : ""}`,
    )
  }
  return response.json()
}

function publicCatalogArtifactFilename(hash) {
  return `catalog.${hash}.json`
}

function publicCatalogArtifactPath(hash) {
  return publicApiPath(`/catalog/${publicCatalogArtifactFilename(hash)}`)
}

function publicCatalogJsonlFilename(hash) {
  return `catalog.${hash}.jsonl`
}

function publicCatalogJsonlDumpPath(hash) {
  return publicApiPath(`/dumps/${publicCatalogJsonlFilename(hash)}`)
}

function publicCatalogJsonlDumpKey(hash) {
  return `${PUBLIC_DUMP_PREFIX}/${publicCatalogJsonlFilename(hash)}`
}

function portraitFingerprintVersion(rawFingerprint) {
  if (!rawFingerprint || typeof rawFingerprint !== "object") return null
  const count = Number(rawFingerprint.published_count ?? rawFingerprint.count ?? 0)
  const latest = portraitHashToken(rawFingerprint.latest_updated_at ?? rawFingerprint.latest ?? "")
  if (!count && !latest) return null
  return latest ? `${count}-${latest}` : String(count)
}

async function publicMetadataObj(url, env) {
  const manifest = await extensionManifestObj(url, env)
  if (!manifest) return null
  const portraitFingerprint = await sharedPublishedPortraitFingerprint(env)
  const portraitVersion = portraitFingerprintVersion(portraitFingerprint)
  const buildHash = String(manifest.current_hash || "").trim() || null
  const catalogHash = catalogBaseHash(buildHash)
  return {
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    catalog_hash: catalogHash,
    portrait_hash: portraitVersion,
    build_version: buildHash,
    released_at: manifest.generated_at || null,
    gene_count: manifest.gene_count || null,
    artifact_schema_version: manifest.schema_version || 1,
    min_extension_version: env.ICONOPLASM_MIN_EXTENSION_VERSION || MIN_EXTENSION_VERSION,
    portrait_base_url: manifest.portrait_base_url || portraitBase(url, env),
    urls: {
      metadata: publicUrl(url, "/metadata"),
      schema: publicUrl(url, "/schema"),
      catalog_manifest: publicUrl(url, "/catalog/manifest"),
      catalog_artifact: buildHash
        ? `${url.origin}${publicCatalogArtifactPath(buildHash)}`
        : null,
      catalog_jsonl: catalogHash ? `${url.origin}${publicCatalogJsonlDumpPath(catalogHash)}` : null,
      changes: publicUrl(url, "/changes"),
      batch: publicUrl(url, "/genes/batch"),
      resolve: publicUrl(url, "/resolve"),
      search: publicUrl(url, "/genes/search"),
      gallery: publicUrl(url, "/gallery"),
    },
    source_versions: {
      catalog_table: "ICONOPLASM_DB.icono_gene_catalog",
      essence_table: "ICONOPLASM_DB.icono_gene_essence",
      publish_state_table: "ICONOPLASM_DB.icono_publish_state",
      portraits_bucket: "ICONOPLASM_PORTRAITS",
      protein_source: "DB.proteins via UniProt",
    },
  }
}

function publicSchemaDoc() {
  return {
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    cursor_format: "ISO-8601 UTC timestamp",
    batch_limits: {
      genes_batch_default: PUBLIC_DEFAULT_GENE_BATCH_LIMIT,
      genes_batch_max: PUBLIC_MAX_GENE_BATCH_LIMIT,
      resolve_batch_max: PUBLIC_MAX_RESOLVE_BATCH_LIMIT,
    },
    field_projection: {
      supported: true,
      accepts: ["comma-separated string", "array of strings"],
      fields: [
        "symbol",
        "canonical_symbol",
        "full_name",
        "aliases",
        "uniprot",
        "color",
        "weight_kg",
        "protein_length_aa",
        "molecular_weight_kda",
        "first_publication_year",
        "tissue_tau",
        "loeuf",
        "constraint_percentile",
        "primary_tissue",
        "popularity_score",
        "essence",
        "manifestation",
        "portrait",
        "portrait_candidates",
        "media",
        "source_links",
        "page_url",
        "resolved_from",
      ],
    },
  }
}

function parseProjectedFields(rawFields) {
  const allowed = new Set(publicSchemaDoc().field_projection.fields)
  const values = Array.isArray(rawFields)
    ? rawFields
    : typeof rawFields === "string"
      ? rawFields.split(",")
      : []
  const cleaned = Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .filter((value) => allowed.has(value)),
    ),
  )
  return cleaned.length ? cleaned : null
}

function projectGeneRecord(record, rawFields) {
  if (!record || typeof record !== "object") return record
  const fields = parseProjectedFields(rawFields)
  if (!fields) return record

  const projected = {
    api_version: PUBLIC_API_VERSION,
    schema_version: record.schema_version ?? API_SCHEMA_VERSION,
    canonical_key: record.canonical_key || "symbol",
    canonical_symbol: record.canonical_symbol || record.symbol || null,
  }
  for (const field of fields) {
    if (field in record) projected[field] = record[field]
  }
  if (!("symbol" in projected) && record.symbol) projected.symbol = record.symbol
  return projected
}

function publicMediaEnvelope(url, symbol, portrait) {
  const assetSha = normalizeSha256(portrait?.asset_sha256 || "")
  if (!assetSha) return null
  const width = optionalInt(portrait?.width)
  const height = optionalInt(portrait?.height)
  return {
    id: assetSha,
    type: "portrait",
    symbol,
    checksum_sha256: assetSha,
    canonical_url: portrait?.hero_url || portrait?.medium_url || portrait?.thumb_url || null,
    info_url: publicUrl(url, `/media/${encodeURIComponent(symbol)}`),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    renditions: {
      full: portrait?.hero_url || null,
      medium: portrait?.medium_url || null,
      thumb: portrait?.thumb_url || null,
    },
    rights: "CC BY-NC-ND 4.0",
    license_url: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    attribution: "Brinedew / Iconoplasm",
    source: "iconoplasm-portraits",
  }
}

async function warmCatalogCache(env) {
  const manifest = await catalogManifestObj(env)
  if (!manifest?.current_hash || !env.KV) return
  const baseHash = catalogBaseHash(manifest.current_hash)
  if (!baseHash) return
  const portraitAwareHash =
    buildPortraitAwareManifestHash(baseHash, await publishedPortraitFingerprint(env)) || baseHash
  const now = Date.now()
  if (
    catalogCache.hash === portraitAwareHash &&
    now - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS &&
    catalogCache.bySymbol.size > 0
  ) {
    return
  }

  // Cost barrier: search/resolve/gallery warm-up runs on hot public routes. Do
  // not rebuild the hydrated catalog from scratch here on every cold isolate.
  // Load the shared versioned hydrated artifact instead.
  const artifact = await hydratedCatalogArtifact(env, portraitAwareHash)
  if (!artifact) return

  const bySymbol = new Map()
  const symbolByUniprot = new Map()
  const symbolByAlias = new Map()
  for (const g of artifact?.genes || []) {
    const s = normalizeSymbol(g?.s)
    if (!s) continue
    bySymbol.set(s, g)
    const u = normalizeUniprot(g?.u)
    if (u) symbolByUniprot.set(u, s)
    for (const alias of normalizeCatalogAliases(g?.a || [])) {
      const key = normalizeCatalogAliasLookupKey(alias)
      if (key && !symbolByAlias.has(key)) symbolByAlias.set(key, s)
    }
  }
  catalogCache.hash = portraitAwareHash
  catalogCache.loadedAt = now
  catalogCache.bySymbol = bySymbol
  catalogCache.symbolByUniprot = symbolByUniprot
  catalogCache.symbolByAlias = symbolByAlias
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
  const aliases = normalizeCatalogAliases(
    payload.aliases || payload.a || payload.alias_symbols || payload.aliases_json || [],
  )
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
    aliases_json: JSON.stringify(aliases),
  }
}

async function fetchCatalogState(env) {
  if (!env.ICONOPLASM_DB) return { gene_count: 0, content_hash: "" }
  const rows = await loadCatalogRowsForPublish(env)
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
              leakage_percent, leakage_hits, leakage_total,
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
              leakage_percent, leakage_hits, leakage_total,
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
      tissue_tau: row?.tissue_tau,
      loeuf: row?.loeuf,
      constraint_percentile: row?.constraint_percentile,
      leakage_percent: row?.leakage_percent,
      leakage_hits: row?.leakage_hits,
      leakage_total: row?.leakage_total,
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
      `SELECT gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json, updated_at
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
      aliases: normalizeCatalogAliases(row.aliases_json || []),
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
      width: null,
      height: null,
      asset_sha256: null,
      candidate_image_id: null,
      emulsion_label: null,
      artist_id: null,
    }
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      // D1 cost fence: gene_symbol is the lookup key on both tables. Leave it
      // unwrapped so public media/gene detail stays O(1).
      `SELECT ps.current_asset_sha256 AS asset_sha256, pa.r2_key_full, pa.r2_key_medium, pa.r2_key_thumb, pa.width, pa.height, pa.vision_id, pa.candidate_image_id, pa.emulsion_id
         FROM icono_publish_state ps
         LEFT JOIN icono_portrait_assets pa
           ON pa.gene_symbol = ps.gene_symbol
          AND pa.asset_sha256 = ps.current_asset_sha256
         WHERE ps.gene_symbol = ?
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
        width: null,
        height: null,
        asset_sha256: null,
        candidate_image_id: null,
        emulsion_label: null,
        artist_id: null,
      }
    return {
      status: "published",
      hero_url: row.r2_key_full ? joinUrl(base, row.r2_key_full) : null,
      medium_url: row.r2_key_medium ? joinUrl(base, row.r2_key_medium) : null,
      thumb_url: row.r2_key_thumb ? joinUrl(base, row.r2_key_thumb) : null,
      width: optionalInt(row?.width),
      height: optionalInt(row?.height),
      asset_sha256: row.asset_sha256,
      candidate_image_id: optionalInt(row?.candidate_image_id),
      vision_id: String(row?.vision_id || "").trim() || null,
      emulsion_id: publicEmulsionIdForRow(row) || null,
      emulsion_label: generationRequestVisionLabel(row) || null,
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
      width: null,
      height: null,
      asset_sha256: null,
      candidate_image_id: null,
      emulsion_label: null,
      artist_id: null,
    }
  }
}

async function essenceState(env, symbol) {
  if (!env.ICONOPLASM_DB) return { exists: false, essence: {} }
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      // D1 cost fence: icono_gene_essence is keyed by normalized gene_symbol.
      // Do not wrap the primary key in upper() on the site detail path.
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
         WHERE gene_symbol = ?
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
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    canonical_symbol: r.symbol,
    symbol: r.symbol,
    full_name: fullName,
    ...(Array.isArray(r?.catalog?.aliases) && r.catalog.aliases.length
      ? { aliases: r.catalog.aliases }
      : {}),
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
    media: publicMediaEnvelope(url, r.symbol, portrait),
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

function iconoplasmVoteCoordinatorKey(symbol) {
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return ""
  return `vote-gene:${safeSymbol}`
}

function iconoplasmVoteCoordinatorBinding(env) {
  return env?.ICONOPLASM_VOTE_COORDINATORS || null
}

function iconoplasmVoteCoordinatorStub(env, symbol) {
  const binding = iconoplasmVoteCoordinatorBinding(env)
  const key = iconoplasmVoteCoordinatorKey(symbol)
  if (!binding || !key) return null
  return binding.get(binding.idFromName(key))
}

async function iconoplasmVoteCoordinatorJson(stub, path, payload) {
  if (!stub) throw new Error("ICONOPLASM_VOTE_COORDINATORS binding missing")
  const request = new Request(`https://iconoplasm-vote-coordinator${path}`, {
    method: payload == null ? "GET" : "POST",
    headers: payload == null ? undefined : { "Content-Type": "application/json" },
    body: payload == null ? undefined : JSON.stringify(payload),
  })
  const response = await stub.fetch(request)
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new Error(String(data?.error || `Vote coordinator request failed (${response.status})`))
  }
  return data
}

async function iconoplasmVoteCoordinatorSnapshot(
  env,
  { candidateRef, symbol, assetSha256, visionId, userId } = {},
) {
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256)
  if (!safeSymbol || !safeAssetSha) return null
  const stub = iconoplasmVoteCoordinatorStub(env, safeSymbol)
  if (!stub) return null
  return iconoplasmVoteCoordinatorJson(stub, "/vote/snapshot", {
    candidate_ref: normalizeCandidateRef(candidateRef, safeSymbol, safeAssetSha) || "",
    symbol: safeSymbol,
    asset_sha256: safeAssetSha,
    vision_id: sanitizeVoteVisionId(visionId || ""),
    user_id: normalizeUserId(userId || ""),
  })
}

async function iconoplasmVoteCoordinatorSnapshotsBatch(env, { items, userId } = {}) {
  if (!Array.isArray(items) || !items.length) return []
  const groups = new Map()
  for (const rawItem of items) {
    const symbol = normalizeSymbol(rawItem?.symbol || "")
    const assetSha = normalizeSha256(rawItem?.asset_sha256 || "")
    if (!symbol || !assetSha) continue
    const current = groups.get(symbol) || []
    current.push({
      symbol,
      asset_sha256: assetSha,
      candidate_ref: normalizeCandidateRef(rawItem?.candidate_ref || "", symbol, assetSha) || "",
      vision_id: sanitizeVoteVisionId(rawItem?.vision_id || ""),
    })
    groups.set(symbol, current)
  }
  const snapshots = []
  for (const [symbol, groupItems] of groups.entries()) {
    const stub = iconoplasmVoteCoordinatorStub(env, symbol)
    if (!stub) return []
    const payload = await iconoplasmVoteCoordinatorJson(stub, "/vote/snapshots", {
      user_id: normalizeUserId(userId || ""),
      items: groupItems,
    })
    for (const row of Array.isArray(payload?.snapshots) ? payload.snapshots : []) {
      snapshots.push(row)
    }
  }
  return snapshots
}

async function iconoplasmVoteCoordinatorSetVote(
  env,
  { symbol, assetSha256, visionId, candidateImageId, userId, requestedVoteValue } = {},
) {
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256)
  if (!safeSymbol || !safeAssetSha) return null
  const stub = iconoplasmVoteCoordinatorStub(env, safeSymbol)
  if (!stub) return null
  return iconoplasmVoteCoordinatorJson(stub, "/vote/set", {
    symbol: safeSymbol,
    asset_sha256: safeAssetSha,
    vision_id: sanitizeVoteVisionId(visionId || ""),
    candidate_image_id: optionalInt(candidateImageId),
    user_id: normalizeUserId(userId || ""),
    vote_value: Number(requestedVoteValue || 0),
  })
}

async function iconoplasmVoteCoordinatorImportVotes(env, { symbol, items = [] } = {}) {
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return null
  const stub = iconoplasmVoteCoordinatorStub(env, safeSymbol)
  if (!stub) return null
  return iconoplasmVoteCoordinatorJson(stub, "/vote/import", {
    symbol: safeSymbol,
    items: Array.isArray(items) ? items : [],
  })
}

function mapCoordinatorAssetSummaryRow(row) {
  const assetSha = normalizeSha256(row?.asset_sha256 || "") || ""
  return {
    asset_sha256: assetSha,
    candidate_ref: voteAssetIdentity(normalizeSymbol(row?.gene_symbol || "") || "", assetSha) || "",
    vision_id: sanitizeVoteVisionId(row?.vision_id || "") || "",
    candidate_image_id: optionalInt(row?.candidate_image_id),
    upvotes: Math.max(0, Number(row?.upvotes || 0) || 0),
    downvotes: Math.max(0, Number(row?.downvotes || 0) || 0),
    score: Number(row?.score || 0) || 0,
    vote_count: Math.max(0, Number(row?.vote_count || 0) || 0),
  }
}

export class IconoplasmVoteCoordinator {
  constructor(state, env) {
    this.state = state
    this.env = env
    // The coordinator is the live vote authority. The old design treated D1's
    // compatibility ledger as the live source of truth and re-counted historical
    // rows in request paths. That was an expensive design mistake because each
    // new vote got slower and more expensive as old votes accumulated.
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vote_by_user_asset (
          user_id TEXT NOT NULL,
          asset_sha256 TEXT NOT NULL,
          vision_id TEXT NOT NULL DEFAULT '',
          candidate_image_id INTEGER,
          vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, asset_sha256)
        );
        CREATE INDEX IF NOT EXISTS idx_vote_by_user_asset_asset
          ON vote_by_user_asset (asset_sha256, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_vote_by_user_asset_vision
          ON vote_by_user_asset (vision_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS asset_summary (
          asset_sha256 TEXT PRIMARY KEY,
          vision_id TEXT NOT NULL DEFAULT '',
          candidate_image_id INTEGER,
          upvotes INTEGER NOT NULL DEFAULT 0,
          downvotes INTEGER NOT NULL DEFAULT 0,
          score INTEGER NOT NULL DEFAULT 0,
          vote_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_asset_summary_vision
          ON asset_summary (vision_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS vision_summary (
          vision_id TEXT PRIMARY KEY,
          upvotes INTEGER NOT NULL DEFAULT 0,
          downvotes INTEGER NOT NULL DEFAULT 0,
          score INTEGER NOT NULL DEFAULT 0,
          vote_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `)
    })
  }

  sqlFirst(query, ...bindings) {
    return this.state.storage.sql.exec(query, ...bindings).toArray()[0] || null
  }

  setMeta(key, value) {
    this.state.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(key || ""),
      String(value || ""),
    )
  }

  getMeta(key) {
    return this.sqlFirst(`SELECT value FROM meta WHERE key = ?`, String(key || ""))?.value || ""
  }

  async lookupAssetMetadata(symbol, assetSha256) {
    if (!this.env.ICONOPLASM_DB) return null
    const safeSymbol = normalizeSymbol(symbol)
    const safeAssetSha = normalizeSha256(assetSha256)
    if (!safeSymbol || !safeAssetSha) return null
    return (
      (await this.env.ICONOPLASM_DB.prepare(
        `SELECT vision_id, candidate_image_id
         FROM icono_portrait_assets
         WHERE gene_symbol = ?
           AND asset_sha256 = ?
         LIMIT 1`,
      )
        .bind(safeSymbol, safeAssetSha)
        .first()) || null
    )
  }

  ensureVisionSummaryRow(visionId) {
    const safeVisionId = sanitizeVoteVisionId(visionId || "")
    if (!safeVisionId) return
    this.state.storage.sql.exec(
      `INSERT INTO vision_summary (
         vision_id, upvotes, downvotes, score, vote_count, updated_at
       ) VALUES (?, 0, 0, 0, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(vision_id) DO NOTHING`,
      safeVisionId,
    )
  }

  bumpVisionSummary(visionId, { upvotes = 0, downvotes = 0, score = 0, voteCount = 0 } = {}) {
    const safeVisionId = sanitizeVoteVisionId(visionId || "")
    if (!safeVisionId) return
    this.ensureVisionSummaryRow(safeVisionId)
    this.state.storage.sql.exec(
      `UPDATE vision_summary
       SET upvotes = MAX(0, upvotes + ?),
           downvotes = MAX(0, downvotes + ?),
           score = score + ?,
           vote_count = MAX(0, vote_count + ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE vision_id = ?`,
      Number(upvotes || 0),
      Number(downvotes || 0),
      Number(score || 0),
      Number(voteCount || 0),
      safeVisionId,
    )
  }

  ensureAssetSummaryRow(assetSha256, { visionId = "", candidateImageId = null } = {}) {
    const safeAssetSha = normalizeSha256(assetSha256)
    if (!safeAssetSha) return null
    this.state.storage.sql.exec(
      `INSERT INTO asset_summary (
         asset_sha256,
         vision_id,
         candidate_image_id,
         upvotes,
         downvotes,
         score,
         vote_count,
         updated_at
       ) VALUES (?, ?, ?, 0, 0, 0, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(asset_sha256) DO UPDATE SET
         vision_id = CASE
           WHEN excluded.vision_id <> '' THEN excluded.vision_id
           ELSE asset_summary.vision_id
         END,
         candidate_image_id = COALESCE(excluded.candidate_image_id, asset_summary.candidate_image_id),
         updated_at = CURRENT_TIMESTAMP`,
      safeAssetSha,
      sanitizeVoteVisionId(visionId || ""),
      optionalInt(candidateImageId),
    )
    const row = this.sqlFirst(
      `SELECT asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count
       FROM asset_summary
       WHERE asset_sha256 = ?`,
      safeAssetSha,
    )
    return row ? mapCoordinatorAssetSummaryRow({ ...row, gene_symbol: this.getMeta("symbol") }) : null
  }

  getExistingAssetSummary(assetSha256) {
    const safeAssetSha = normalizeSha256(assetSha256)
    if (!safeAssetSha) return null
    const row = this.sqlFirst(
      `SELECT asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count
       FROM asset_summary
       WHERE asset_sha256 = ?`,
      safeAssetSha,
    )
    return row ? mapCoordinatorAssetSummaryRow({ ...row, gene_symbol: this.getMeta("symbol") }) : null
  }

  async ensureAssetSummaryFromMetadata(symbol, assetSha256, visionId = "", candidateImageId = null) {
    const existing = this.getExistingAssetSummary(assetSha256)
    if (existing) {
      return this.ensureAssetSummaryRow(assetSha256, {
        visionId: visionId || existing.vision_id || "",
        candidateImageId: optionalInt(candidateImageId ?? existing.candidate_image_id),
      })
    }
    const metadata = await this.lookupAssetMetadata(symbol, assetSha256)
    return this.ensureAssetSummaryRow(assetSha256, {
      visionId: visionId || metadata?.vision_id || "",
      candidateImageId: optionalInt(candidateImageId ?? metadata?.candidate_image_id),
    })
  }

  applyVoteMutation(
    {
      assetSha256,
      userId,
      requestedVoteValue,
      visionId = "",
      candidateImageId = null,
      ensuredAsset = null,
      toggleOffWhenSame = true,
    } = {},
  ) {
    const safeAssetSha = normalizeSha256(assetSha256)
    const safeUserId = normalizeUserId(userId || "")
    const safeRequestedVoteValue = normalizeVoteValue(requestedVoteValue)
    if (!safeAssetSha || !safeUserId || safeRequestedVoteValue == null) {
      throw new Error("Missing or invalid vote payload")
    }

    return this.state.storage.transactionSync(() => {
      const currentRow =
        this.sqlFirst(
          `SELECT vote_value, vision_id, candidate_image_id, created_at
           FROM vote_by_user_asset
           WHERE user_id = ?
             AND asset_sha256 = ?
           LIMIT 1`,
          safeUserId,
          safeAssetSha,
        ) || null
      const currentVoteValue = Number(currentRow?.vote_value || 0)
      const finalVoteValue =
        safeRequestedVoteValue === 0
          ? 0
          : toggleOffWhenSame && currentVoteValue === safeRequestedVoteValue
            ? 0
            : safeRequestedVoteValue
      const resolvedVisionId = sanitizeVoteVisionId(
        visionId || currentRow?.vision_id || ensuredAsset?.vision_id || "",
      )
      const resolvedCandidateImageId = optionalInt(
        candidateImageId ?? currentRow?.candidate_image_id ?? ensuredAsset?.candidate_image_id,
      )

      if (finalVoteValue === 0) {
        this.state.storage.sql.exec(
          `DELETE FROM vote_by_user_asset
           WHERE user_id = ?
             AND asset_sha256 = ?`,
          safeUserId,
          safeAssetSha,
        )
      } else {
        this.state.storage.sql.exec(
          `INSERT INTO vote_by_user_asset (
             user_id, asset_sha256, vision_id, candidate_image_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, asset_sha256) DO UPDATE SET
             vision_id = excluded.vision_id,
             candidate_image_id = excluded.candidate_image_id,
             vote_value = excluded.vote_value,
             updated_at = CURRENT_TIMESTAMP`,
          safeUserId,
          safeAssetSha,
          resolvedVisionId,
          resolvedCandidateImageId,
          finalVoteValue,
          sanitizeText(currentRow?.created_at || "", 64) || null,
        )
      }

      const assetDelta = voteDeltaFromTransition(currentVoteValue, finalVoteValue)
      this.ensureAssetSummaryRow(safeAssetSha, {
        visionId: resolvedVisionId,
        candidateImageId: resolvedCandidateImageId,
      })
      this.state.storage.sql.exec(
        `UPDATE asset_summary
         SET vision_id = CASE
               WHEN ? <> '' THEN ?
               ELSE vision_id
             END,
             candidate_image_id = COALESCE(?, candidate_image_id),
             upvotes = MAX(0, upvotes + ?),
             downvotes = MAX(0, downvotes + ?),
             score = score + ?,
             vote_count = MAX(0, vote_count + ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE asset_sha256 = ?`,
        resolvedVisionId,
        resolvedVisionId,
        resolvedCandidateImageId,
        Number(assetDelta.upvotes || 0),
        Number(assetDelta.downvotes || 0),
        Number(assetDelta.score || 0),
        Number(assetDelta.vote_count || 0),
        safeAssetSha,
      )

      const oldVisionId = sanitizeVoteVisionId(currentRow?.vision_id || "")
      if (oldVisionId && oldVisionId !== resolvedVisionId) {
        const oldVisionDelta = voteDeltaFromTransition(currentVoteValue, 0)
        this.bumpVisionSummary(oldVisionId, {
          upvotes: oldVisionDelta.upvotes,
          downvotes: oldVisionDelta.downvotes,
          score: oldVisionDelta.score,
          voteCount: oldVisionDelta.vote_count,
        })
        const newVisionDelta = voteDeltaFromTransition(0, finalVoteValue)
        this.bumpVisionSummary(resolvedVisionId, {
          upvotes: newVisionDelta.upvotes,
          downvotes: newVisionDelta.downvotes,
          score: newVisionDelta.score,
          voteCount: newVisionDelta.vote_count,
        })
      } else {
        this.bumpVisionSummary(resolvedVisionId, {
          upvotes: assetDelta.upvotes,
          downvotes: assetDelta.downvotes,
          score: assetDelta.score,
          voteCount: assetDelta.vote_count,
        })
      }

      return {
        current_vote_value: currentVoteValue,
        final_vote_value: finalVoteValue,
        resolved_vision_id: resolvedVisionId,
        candidate_image_id: resolvedCandidateImageId,
        snapshot: this.snapshotForAsset(safeAssetSha, safeUserId, resolvedVisionId),
      }
    })
  }

  snapshotForAsset(assetSha256, userId, requestedVisionId = "") {
    const safeAssetSha = normalizeSha256(assetSha256)
    const safeUserId = normalizeUserId(userId || "")
    const assetRow =
      this.sqlFirst(
        `SELECT asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count
         FROM asset_summary
         WHERE asset_sha256 = ?`,
        safeAssetSha,
      ) || null
    const userVoteRow =
      this.sqlFirst(
        `SELECT vote_value
         FROM vote_by_user_asset
         WHERE user_id = ?
           AND asset_sha256 = ?
         LIMIT 1`,
        safeUserId,
        safeAssetSha,
      ) || null
    const resolvedVisionId = sanitizeVoteVisionId(requestedVisionId || assetRow?.vision_id || "")
    const visionRow =
      resolvedVisionId
        ? this.sqlFirst(
            `SELECT upvotes, downvotes, score, vote_count
             FROM vision_summary
             WHERE vision_id = ?`,
            resolvedVisionId,
          ) || null
        : null
    return {
      image_upvotes: Number(assetRow?.upvotes || 0),
      image_downvotes: Number(assetRow?.downvotes || 0),
      image_score: Number(assetRow?.score || 0),
      user_vote: Number(userVoteRow?.vote_value || 0),
      vision_upvotes: Number(visionRow?.upvotes || 0),
      vision_downvotes: Number(visionRow?.downvotes || 0),
      vision_score: Number(visionRow?.score || 0),
      candidate_ref: voteAssetIdentity(this.getMeta("symbol"), safeAssetSha) || "",
      vision_id: resolvedVisionId,
    }
  }

  exportAssetSummaries() {
    const symbol = this.getMeta("symbol")
    return this.state.storage.sql
      .exec(
        `SELECT asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count
         FROM asset_summary
         ORDER BY asset_sha256 ASC`,
      )
      .toArray()
      .map((row) => mapCoordinatorAssetSummaryRow({ ...row, gene_symbol: symbol }))
  }

  async ensureBootstrapped(symbol) {
    const safeSymbol = normalizeSymbol(symbol)
    if (!safeSymbol) throw new Error("Missing or invalid symbol")
    if (!this.env?.ICONOPLASM_DB) throw new Error("ICONOPLASM_DB binding missing")
    const bootstrapped = this.getMeta("bootstrapped")
    const storedSymbol = this.getMeta("symbol")
    if (bootstrapped === "1" && (!storedSymbol || storedSymbol === safeSymbol)) {
      if (!storedSymbol) this.setMeta("symbol", safeSymbol)
      return safeSymbol
    }
    await this.state.blockConcurrencyWhile(async () => {
      const boot = this.getMeta("bootstrapped")
      const existingSymbol = this.getMeta("symbol")
      if (boot === "1" && (!existingSymbol || existingSymbol === safeSymbol)) {
        if (!existingSymbol) this.setMeta("symbol", safeSymbol)
        return
      }

      const assetResp = await this.env.ICONOPLASM_DB.prepare(
        `SELECT asset_sha256, vision_id, candidate_image_id
         FROM icono_portrait_assets
         WHERE gene_symbol = ?`,
      )
        .bind(safeSymbol)
        .all()
      const voteResp = await this.env.ICONOPLASM_DB.prepare(
        `SELECT user_id, asset_sha256, vision_id, candidate_image_id, vote_value, created_at, updated_at
         FROM icono_image_votes
         WHERE gene_symbol = ?`,
      )
        .bind(safeSymbol)
        .all()
      const assetRows = Array.isArray(assetResp?.results) ? assetResp.results : []
      const voteRows = Array.isArray(voteResp?.results) ? voteResp.results : []

      const assetMap = new Map()
      const visionMap = new Map()
      const voteRowsNorm = []

      for (const rawAsset of Array.isArray(assetRows) ? assetRows : []) {
        const assetSha = normalizeSha256(rawAsset?.asset_sha256 || "")
        if (!assetSha) continue
        assetMap.set(assetSha, {
          asset_sha256: assetSha,
          vision_id: sanitizeVoteVisionId(rawAsset?.vision_id || "") || "",
          candidate_image_id: optionalInt(rawAsset?.candidate_image_id),
          upvotes: 0,
          downvotes: 0,
          score: 0,
          vote_count: 0,
        })
      }

      for (const rawVote of Array.isArray(voteRows) ? voteRows : []) {
        const assetSha = normalizeSha256(rawVote?.asset_sha256 || "")
        const userId = normalizeUserId(rawVote?.user_id || "")
        const voteValue = normalizeVoteValue(rawVote?.vote_value)
        if (!assetSha || !userId || voteValue == null || voteValue === 0) continue
        const current =
          assetMap.get(assetSha) || {
            asset_sha256: assetSha,
            vision_id: sanitizeVoteVisionId(rawVote?.vision_id || "") || "",
            candidate_image_id: optionalInt(rawVote?.candidate_image_id),
            upvotes: 0,
            downvotes: 0,
            score: 0,
            vote_count: 0,
          }
        current.vision_id = sanitizeVoteVisionId(current.vision_id || rawVote?.vision_id || "") || ""
        current.candidate_image_id = optionalInt(
          current.candidate_image_id ?? rawVote?.candidate_image_id,
        )
        current.upvotes += Number(voteValue === 1)
        current.downvotes += Number(voteValue === -1)
        current.score += Number(voteValue)
        current.vote_count += 1
        assetMap.set(assetSha, current)
        if (current.vision_id) {
          const currentVision = visionMap.get(current.vision_id) || {
            upvotes: 0,
            downvotes: 0,
            score: 0,
            vote_count: 0,
          }
          currentVision.upvotes += Number(voteValue === 1)
          currentVision.downvotes += Number(voteValue === -1)
          currentVision.score += Number(voteValue)
          currentVision.vote_count += 1
          visionMap.set(current.vision_id, currentVision)
        }
        voteRowsNorm.push({
          user_id: userId,
          asset_sha256: assetSha,
          vision_id: sanitizeVoteVisionId(rawVote?.vision_id || "") || "",
          candidate_image_id: optionalInt(rawVote?.candidate_image_id),
          vote_value: voteValue,
          created_at: sanitizeText(rawVote?.created_at || "", 64) || "",
          updated_at: sanitizeText(rawVote?.updated_at || "", 64) || "",
        })
      }

      this.state.storage.sql.exec(`
        DELETE FROM vote_by_user_asset;
        DELETE FROM asset_summary;
        DELETE FROM vision_summary;
        DELETE FROM meta;
      `)
      this.setMeta("symbol", safeSymbol)
      this.setMeta("bootstrapped", "1")
      this.setMeta("bootstrapped_at", new Date().toISOString())

      for (const asset of assetMap.values()) {
        this.state.storage.sql.exec(
          `INSERT INTO asset_summary (
             asset_sha256, vision_id, candidate_image_id, upvotes, downvotes, score, vote_count, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          asset.asset_sha256,
          asset.vision_id,
          asset.candidate_image_id,
          Number(asset.upvotes || 0),
          Number(asset.downvotes || 0),
          Number(asset.score || 0),
          Number(asset.vote_count || 0),
        )
      }
      for (const [visionId, vision] of visionMap.entries()) {
        this.state.storage.sql.exec(
          `INSERT INTO vision_summary (
             vision_id, upvotes, downvotes, score, vote_count, updated_at
           ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          visionId,
          Number(vision.upvotes || 0),
          Number(vision.downvotes || 0),
          Number(vision.score || 0),
          Number(vision.vote_count || 0),
        )
      }
      for (const vote of voteRowsNorm) {
        this.state.storage.sql.exec(
          `INSERT INTO vote_by_user_asset (
             user_id, asset_sha256, vision_id, candidate_image_id, vote_value, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          vote.user_id,
          vote.asset_sha256,
          vote.vision_id,
          vote.candidate_image_id,
          Number(vote.vote_value || 0),
          vote.created_at || new Date().toISOString(),
          vote.updated_at || new Date().toISOString(),
        )
      }
    })
    return safeSymbol
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === "/vote/set" && request.method === "POST") {
      const payload = await request.json()
      const requestedSymbol = normalizeSymbol(payload?.symbol || "")
      if (!requestedSymbol) {
        return Response.json({ error: "Missing or invalid symbol" }, { status: 400 })
      }
      const symbol = await this.ensureBootstrapped(requestedSymbol)
      const assetSha = normalizeSha256(payload?.asset_sha256 || "")
      const userId = normalizeUserId(payload?.user_id || "")
      const requested = normalizeVoteValue(payload?.vote_value)
      if (!assetSha || !userId || requested == null) {
        return Response.json({ error: "Missing or invalid vote payload" }, { status: 400 })
      }
      const ensuredAsset = await this.ensureAssetSummaryFromMetadata(
        symbol,
        assetSha,
        payload?.vision_id || "",
        payload?.candidate_image_id,
      )
      const result = this.applyVoteMutation({
        assetSha256: assetSha,
        userId,
        requestedVoteValue: requested,
        visionId: payload?.vision_id || "",
        candidateImageId: payload?.candidate_image_id,
        ensuredAsset,
        toggleOffWhenSame: true,
      })
      return Response.json({
        ok: true,
        symbol,
        asset_sha256: assetSha,
        ...result,
        asset_summaries: this.exportAssetSummaries(),
      })
    }

    if (path === "/vote/import" && request.method === "POST") {
      const payload = await request.json()
      const requestedSymbol = normalizeSymbol(payload?.symbol || "")
      if (!requestedSymbol) {
        return Response.json({ error: "Missing or invalid symbol" }, { status: 400 })
      }
      const symbol = await this.ensureBootstrapped(requestedSymbol)
      const items = Array.isArray(payload?.items) ? payload.items : []
      const results = []
      let upserted = 0
      let deleted = 0
      let invalid = 0

      for (const raw of items) {
        const assetSha = normalizeSha256(raw?.asset_sha256 || "")
        const userId = normalizeUserId(raw?.user_id || raw?.user || "")
        const requested = normalizeVoteValue(raw?.vote_value)
        if (!assetSha || !userId || requested == null) {
          invalid += 1
          continue
        }
        const ensuredAsset = await this.ensureAssetSummaryFromMetadata(
          symbol,
          assetSha,
          raw?.vision_id || "",
          raw?.candidate_image_id,
        )
        const result = this.applyVoteMutation({
          assetSha256: assetSha,
          userId,
          requestedVoteValue: requested,
          visionId: raw?.vision_id || "",
          candidateImageId: raw?.candidate_image_id,
          ensuredAsset,
          toggleOffWhenSame: false,
        })
        if (result.final_vote_value === 0) {
          deleted += 1
        } else {
          upserted += 1
        }
        results.push({
          candidate_ref: voteAssetIdentity(symbol, assetSha),
          symbol,
          asset_sha256: assetSha,
          vision_id: result.resolved_vision_id,
          candidate_image_id: result.candidate_image_id,
          user_id: userId,
          current_vote_value: result.current_vote_value,
          final_vote_value: result.final_vote_value,
        })
      }

      return Response.json({
        ok: true,
        symbol,
        upserted,
        deleted,
        invalid,
        results,
        asset_summaries: this.exportAssetSummaries(),
      })
    }

    if (path === "/vote/snapshot" && request.method === "POST") {
      const payload = await request.json()
      const requestedSymbol = normalizeSymbol(payload?.symbol || "")
      if (!requestedSymbol) {
        return Response.json({ error: "Missing or invalid symbol" }, { status: 400 })
      }
      const symbol = await this.ensureBootstrapped(requestedSymbol)
      const assetSha = normalizeSha256(payload?.asset_sha256 || "")
      const userId = normalizeUserId(payload?.user_id || "")
      if (!assetSha) {
        return Response.json({ error: "Missing or invalid asset_sha256" }, { status: 400 })
      }
      await this.ensureAssetSummaryFromMetadata(
        symbol,
        assetSha,
        payload?.vision_id || "",
        payload?.candidate_image_id,
      )
      return Response.json({
        ok: true,
        symbol,
        asset_sha256: assetSha,
        snapshot: this.snapshotForAsset(assetSha, userId, payload?.vision_id || ""),
      })
    }

    if (path === "/vote/snapshots" && request.method === "POST") {
      const payload = await request.json()
      const userId = normalizeUserId(payload?.user_id || "")
      const items = Array.isArray(payload?.items) ? payload.items : []
      const out = []
      for (const rawItem of items) {
        const symbol = await this.ensureBootstrapped(rawItem?.symbol || "")
        const assetSha = normalizeSha256(rawItem?.asset_sha256 || "")
        if (!assetSha) continue
        await this.ensureAssetSummaryFromMetadata(
          symbol,
          assetSha,
          rawItem?.vision_id || "",
          rawItem?.candidate_image_id,
        )
        const snapshot = this.snapshotForAsset(assetSha, userId, rawItem?.vision_id || "")
        out.push({
          candidate_ref: snapshot.candidate_ref,
          symbol,
          asset_sha256: assetSha,
          vision_id: snapshot.vision_id,
          snapshot,
        })
      }
      return Response.json({ ok: true, snapshots: out })
    }

    if (path === "/state" && request.method === "POST") {
      const payload = await request.json()
      const requestedSymbol = normalizeSymbol(payload?.symbol || "")
      if (!requestedSymbol) {
        return Response.json({ error: "Missing or invalid symbol" }, { status: 400 })
      }
      const symbol = await this.ensureBootstrapped(requestedSymbol)
      return Response.json({
        ok: true,
        symbol,
        asset_summaries: this.exportAssetSummaries(),
      })
    }

    return new Response("Not found", { status: 404 })
  }
}

function voteDeltaFromTransition(currentVoteValue, nextVoteValue) {
  const current = Number(currentVoteValue || 0)
  const next = Number(nextVoteValue || 0)
  return {
    upvotes: Number(next === 1) - Number(current === 1),
    downvotes: Number(next === -1) - Number(current === -1),
    score: next - current,
    vote_count: Number(next !== 0) - Number(current !== 0),
  }
}

async function iconoVoteSnapshot(env, { candidateRef, symbol, assetSha256, visionId, userId }) {
  // Read the hot snapshot from the coordinator first. If the coordinator has no
  // state yet, return the zero snapshot instead of falling back to a raw D1 vote
  // ledger aggregation. The previous "just count the ledger" shape is exactly
  // what turns a harmless click into a history-sized database bill.
  const coordinatorSnapshot = await iconoplasmVoteCoordinatorSnapshot(env, {
    candidateRef,
    symbol,
    assetSha256,
    visionId,
    userId,
  })
  if (coordinatorSnapshot?.snapshot) {
    return coordinatorSnapshot.snapshot
  }
  const symbolNorm = normalizeSymbol(symbol)
  const assetShaNorm = normalizeSha256(assetSha256)
  const candidateRefNorm = normalizeCandidateRef(candidateRef, symbolNorm, assetShaNorm)

  return {
    image_upvotes: 0,
    image_downvotes: 0,
    image_score: 0,
    user_vote: 0,
    vision_upvotes: 0,
    vision_downvotes: 0,
    vision_score: 0,
    candidate_ref: candidateRefNorm || voteAssetIdentity(symbolNorm, assetShaNorm) || "",
    vision_id: sanitizeVoteVisionId(visionId || ""),
  }
}

async function iconoVoteSnapshotsBatch(env, { items, userId }) {
  const normalizedItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item === "object")
    : []
  const coordinatorSnapshots = await iconoplasmVoteCoordinatorSnapshotsBatch(env, {
    items: normalizedItems,
    userId,
  })
  return Array.isArray(coordinatorSnapshots) ? coordinatorSnapshots : []
}

async function autoPromoteTopVotedPortrait(env, { symbol, actorId, reason } = {}) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  if (!symbolNorm) return { ok: false, changed: false, code: "BAD_SYMBOL" }

  const currentRow = await env.ICONOPLASM_DB.prepare(
    `SELECT current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
     FROM icono_publish_state
     WHERE gene_symbol = ?
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

  // Chesterton's fence: publish-state auto-promotion must rank candidates with
  // the exact same vote identity that admin/audit surfaces use. Older vote rows
  // may carry legacy `candidate_ref` values like `c:2704`, so canon selection
  // cannot depend on candidate_ref-shaped joins if the rest of the site already
  // treats `(gene_symbol, asset_sha256)` as the durable image identity.
  // D1 cost fence: the community vote route can call this immediately after a
  // public thumbs-up/down. The hot asset-key predicates therefore have to stay on
  // the canonical `(gene_symbol, asset_sha256)` columns with raw equality so the
  // vote index can do its job.
  const topRow = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
       COALESCE(pa.is_legacy, 0) AS is_legacy,
       COALESCE(vs.upvotes, 0) AS image_upvotes,
       COALESCE(vs.downvotes, 0) AS image_downvotes,
       COALESCE(vs.score, 0) AS image_score,
       pa.created_at,
       CASE
         WHEN pa.asset_sha256 = ? THEN 1
         ELSE 0
       END AS is_current
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE pa.gene_symbol = ?
       AND COALESCE(pa.autopick_eligible, 1) = 1
       AND COALESCE(pa.status, '') <> 'rejected'
       AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
     ORDER BY
       COALESCE(vs.score, 0) DESC,
       CASE
         WHEN COALESCE(pa.is_legacy, 0) = 0 THEN 1
         ELSE 0
       END DESC,
       COALESCE(vs.upvotes, 0) DESC,
       CASE
         WHEN pa.asset_sha256 = ? THEN 1
         ELSE 0
       END DESC,
       pa.created_at DESC,
       pa.asset_sha256 ASC
     LIMIT 1`,
  )
    .bind(currentAssetSha || "", symbolNorm, currentAssetSha || "")
    .first()

  const topAssetSha = normalizeSha256(topRow?.asset_sha256 || "")
  const topUpvotes = Number(topRow?.image_upvotes || 0)
  const topDownvotes = Number(topRow?.image_downvotes || 0)
  const topScore = Number(topRow?.image_score || 0)
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
     WHERE gene_symbol = ?
       AND asset_sha256 = ?`,
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
         COALESCE(pa.is_stale, 0) AS is_stale,
         pa.r2_key_full,
         pa.r2_key_medium,
         pa.r2_key_thumb,
         pa.vision_id,
         pa.emulsion_id,
         pa.workflow_id,
         pa.workflow_label,
         pa.workflow_path,
         pa.prompt_version,
         pa.variant_slot,
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
       lower(bl.artist_tag) AS artist_tag,
       MAX(NULLIF(bl.artist_name, '')) AS artist_name,
       0 AS total_count,
       0 AS visible_count,
       0 AS approved_count,
       0 AS draft_count,
       0 AS rejected_count,
       0 AS live_count,
       1 AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.created_by, '')) AS blacklist_created_by,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at
     FROM icono_artist_style_blacklist bl
     WHERE COALESCE(bl.artist_tag, '') <> ''
       AND (? = '' OR lower(bl.artist_tag) LIKE ?)
     GROUP BY lower(bl.artist_tag)
     ORDER BY
       blacklisted DESC,
       artist_tag ASC
     LIMIT ?`,
  )
    .bind(queryNorm, like, cleanedLimit)
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
      live_emulsion_id,
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
      leader_emulsion_id,
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
         COALESCE(pa.emulsion_id, '') AS emulsion_id,
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
         ab.emulsion_id,
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
         ab.emulsion_id,
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
      COALESCE(ca.emulsion_id, '') AS live_emulsion_id,
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
      COALESCE(la.emulsion_id, '') AS leader_emulsion_id,
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
       emulsion_id,
       workflow_id,
       workflow_label,
       prompt_version,
       variant_slot,
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
       MAX(NULLIF(pa.emulsion_id, '')) AS emulsion_id,
       MAX(NULLIF(pa.workflow_id, '')) AS workflow_id,
       MAX(NULLIF(pa.workflow_label, '')) AS workflow_label,
       MAX(NULLIF(pa.prompt_version, '')) AS prompt_version,
       MAX(NULLIF(pa.variant_slot, '')) AS variant_slot,
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
      pa.emulsion_id,
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
    emulsion_id: sanitizeText(row?.emulsion_id || "", 64) || "",
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
      live_emulsion_id,
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
      leader_emulsion_id,
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
      live_emulsion_id = excluded.live_emulsion_id,
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
      leader_emulsion_id = excluded.leader_emulsion_id,
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
      currentAsset?.emulsion_id || "",
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
      leaderAsset?.emulsion_id || "",
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
        MAX(NULLIF(pa.emulsion_id, '')) AS emulsion_id,
        MAX(NULLIF(pa.workflow_id, '')) AS workflow_id,
        MAX(NULLIF(pa.workflow_label, '')) AS workflow_label,
        MAX(NULLIF(pa.prompt_version, '')) AS prompt_version,
        MAX(NULLIF(pa.variant_slot, '')) AS variant_slot,
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
        emulsion_id,
        workflow_id,
        workflow_label,
        prompt_version,
        variant_slot,
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
         emulsion_id = excluded.emulsion_id,
         workflow_id = excluded.workflow_id,
         workflow_label = excluded.workflow_label,
         prompt_version = excluded.prompt_version,
         variant_slot = excluded.variant_slot,
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
        sanitizeText(row?.emulsion_id || "", 64) || "",
        sanitizeText(row?.workflow_id || "", 32) || "",
        sanitizeText(row?.workflow_label || "", 255) || "",
        sanitizeText(row?.prompt_version || "", 16) || "",
        sanitizeText(row?.variant_slot || "", 32) || "",
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
      live_emulsion_id,
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
      leader_emulsion_id,
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
         COALESCE(pa.emulsion_id, '') AS emulsion_id,
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
         ab.emulsion_id,
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
         ab.emulsion_id,
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
      COALESCE(ca.emulsion_id, '') AS live_emulsion_id,
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
      COALESCE(la.emulsion_id, '') AS leader_emulsion_id,
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
       emulsion_id,
       workflow_id,
       workflow_label,
       prompt_version,
       variant_slot,
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
       MAX(NULLIF(pa.emulsion_id, '')) AS emulsion_id,
       MAX(NULLIF(pa.workflow_id, '')) AS workflow_id,
       MAX(NULLIF(pa.workflow_label, '')) AS workflow_label,
       MAX(NULLIF(pa.prompt_version, '')) AS prompt_version,
       MAX(NULLIF(pa.variant_slot, '')) AS variant_slot,
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
  {
    symbols = [],
    visionIds = [],
    fullVision = false,
    fullRebuild = false,
    skipVoteSummaries = false,
    skipGeneRollups = false,
    skipVisionRollups = false,
    skipDashboard = false,
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { symbols: 0, visions: 0 }
  if (fullRebuild) {
    return bulkRebuildAdminReadModels(env)
  }

  const symbolList = Array.from(
    new Set(symbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  const finalVisionIdSet = new Set(
    visionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean),
  )
  const symbolBatchSize = ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT
  for (let start = 0; start < symbolList.length; start += symbolBatchSize) {
    const symbolChunk = symbolList.slice(start, start + symbolBatchSize)
    if (!symbolChunk.length) continue
    // Architecture guardrail: reconcile can touch most of the catalog in one
    // run. Rebuilding admin read models for all touched symbols in one giant
    // JSON-bound D1 statement turned the refresh into a single oversized point
    // of failure. Chunk the durable work so each slice can finish cleanly.
    if (!skipVoteSummaries) {
      await rebuildVoteAssetSummaryForSymbols(env, symbolChunk)
    }
    if (!skipGeneRollups) {
      await rebuildGeneRollupForSymbols(env, symbolChunk)
    }
    if (!skipVisionRollups) {
      const inferredVisionIds = await collectVisionIdsForSymbols(env, symbolChunk)
      for (const visionId of inferredVisionIds) {
        finalVisionIdSet.add(visionId)
      }
    }
  }
  const finalVisionIds = skipVisionRollups ? [] : Array.from(finalVisionIdSet)
  if (!skipVisionRollups) {
    if (fullVision) await rebuildVisionRollups(env, [], { full: true })
    else {
      const visionBatchSize = ADMIN_READ_MODEL_VISION_BATCH_DEFAULT
      for (let start = 0; start < finalVisionIds.length; start += visionBatchSize) {
        const visionChunk = finalVisionIds.slice(start, start + visionBatchSize)
        if (!visionChunk.length) continue
        await rebuildVisionRollupsBatch(env, visionChunk)
      }
    }
  }
  if (!skipDashboard) {
    await rebuildDashboardSummary(env)
  }
  adminReadModelState.ready = true
  return { symbols: symbolList.length, visions: fullVision ? -1 : finalVisionIds.length }
}

async function projectVoteCoordinatorLedgerRow(
  env,
  { symbol, assetSha256, visionId, candidateImageId, userId, voteValue } = {},
) {
  // This D1 table is now a projection for compatibility, audit, and imports.
  // Never turn it back into the live authority with a read-before-write tally.
  // The old pattern paid historical vote cost on every click, which is the dumb
  // part we are fencing against here.
  if (!env.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256)
  const safeUserId = normalizeUserId(userId || "")
  const safeVoteValue = normalizeVoteValue(voteValue)
  if (!safeSymbol || !safeAssetSha || !safeUserId || safeVoteValue == null) return false

  await env.ICONOPLASM_DB.prepare(
    `DELETE FROM icono_image_votes
     WHERE gene_symbol = ?
       AND asset_sha256 = ?
       AND user_id = ?`,
  )
    .bind(safeSymbol, safeAssetSha, safeUserId)
    .run()

  if (safeVoteValue === 0) return true

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_image_votes (
       candidate_ref, gene_symbol, asset_sha256, vision_id, candidate_image_id, user_id, vote_value, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      voteAssetIdentity(safeSymbol, safeAssetSha),
      safeSymbol,
      safeAssetSha,
      sanitizeVoteVisionId(visionId || ""),
      optionalInt(candidateImageId),
      safeUserId,
      safeVoteValue,
    )
    .run()
  return true
}

async function replaceVoteAssetSummaryForSymbolFromCoordinatorState(
  env,
  { symbol, assetSummaries = [] } = {},
) {
  if (!env.ICONOPLASM_DB) return 0
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return 0

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_vote_asset_summary WHERE gene_symbol = ?`)
    .bind(safeSymbol)
    .run()

  let written = 0
  for (const rawRow of Array.isArray(assetSummaries) ? assetSummaries : []) {
    const assetSha = normalizeSha256(rawRow?.asset_sha256 || "")
    if (!assetSha) continue
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
        safeSymbol,
        assetSha,
        voteAssetIdentity(safeSymbol, assetSha),
        sanitizeVoteVisionId(rawRow?.vision_id || "") || "",
        optionalInt(rawRow?.candidate_image_id),
        Math.max(0, Number(rawRow?.upvotes || 0) || 0),
        Math.max(0, Number(rawRow?.downvotes || 0) || 0),
        Number(rawRow?.score || 0) || 0,
        Math.max(0, Number(rawRow?.vote_count || 0) || 0),
      )
      .run()
    written += 1
  }
  return written
}

async function refreshProjectedVoteReadModelsFromCoordinatorState(
  env,
  { symbol, assetSummaries = [] } = {},
) {
  if (!env.ICONOPLASM_DB) return { symbols: 0, visions: 0 }
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return { symbols: 0, visions: 0 }

  await replaceVoteAssetSummaryForSymbolFromCoordinatorState(env, {
    symbol: safeSymbol,
    assetSummaries,
  })
  await rebuildGeneRollupForSymbol(env, safeSymbol)
  const visionIds = Array.from(
    new Set(
      (Array.isArray(assetSummaries) ? assetSummaries : [])
        .map((row) => validAdminRollupVisionId(row?.vision_id || ""))
        .filter(Boolean),
    ),
  )
  if (visionIds.length) {
    await rebuildVisionRollupsBatch(env, visionIds)
  }
  adminReadModelState.ready = true
  await invalidateGalleryCache(env)
  return { symbols: 1, visions: visionIds.length }
}

async function listAutopromoteCandidateAssetsForSymbol(env, rawSymbol) {
  if (!env.ICONOPLASM_DB) return []
  const symbol = normalizeSymbol(rawSymbol)
  if (!symbol) return []
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
       pa.emulsion_id,
       pa.artist_tag,
       pa.artist_name,
       pa.created_at
     FROM icono_portrait_assets pa
     WHERE pa.gene_symbol = ?`,
  )
    .bind(symbol)
    .all()
  return (Array.isArray(assetResp?.results) ? assetResp.results : []).map((row) => ({
    asset_sha256: normalizeSha256(row?.asset_sha256 || "") || null,
    r2_key_full: sanitizeText(row?.r2_key_full || "", 512) || "",
    r2_key_medium: sanitizeText(row?.r2_key_medium || "", 512) || "",
    r2_key_thumb: sanitizeText(row?.r2_key_thumb || "", 512) || "",
    status: sanitizeText(row?.status || "", 32) || "draft",
    autopick_eligible: Number(row?.autopick_eligible || 0) > 0,
    is_stale: Number(row?.is_stale || 0) > 0,
    is_legacy: Number(row?.is_legacy || 0) > 0,
    vision_id: validAdminRollupVisionId(row?.vision_id || ""),
    emulsion_id: sanitizeText(row?.emulsion_id || "", 64) || "",
    artist_tag: sanitizeText(row?.artist_tag || "", 255) || "",
    artist_name: sanitizeText(row?.artist_name || "", 255) || "",
    created_at: sanitizeText(row?.created_at || "", 64) || "",
    upvotes: 0,
    downvotes: 0,
    score: 0,
  }))
}

async function autoPromoteTopVotedPortraitFromCoordinatorState(
  env,
  { symbol, actorId, reason, assetSummaries = [] } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  if (!symbolNorm) return { ok: false, changed: false, code: "BAD_SYMBOL" }

  const currentRow = await env.ICONOPLASM_DB.prepare(
    `SELECT current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
     FROM icono_publish_state
     WHERE gene_symbol = ?
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

  const voteByAsset = new Map()
  for (const rawRow of Array.isArray(assetSummaries) ? assetSummaries : []) {
    const assetSha = normalizeSha256(rawRow?.asset_sha256 || "")
    if (!assetSha) continue
    voteByAsset.set(assetSha, {
      upvotes: Math.max(0, Number(rawRow?.upvotes || 0) || 0),
      downvotes: Math.max(0, Number(rawRow?.downvotes || 0) || 0),
      score: Number(rawRow?.score || 0) || 0,
      vision_id: sanitizeVoteVisionId(rawRow?.vision_id || "") || "",
      candidate_image_id: optionalInt(rawRow?.candidate_image_id),
    })
  }

  const assets = await listAutopromoteCandidateAssetsForSymbol(env, symbolNorm)
  const candidateAssets = assets
    .map((row) => {
      const vote = voteByAsset.get(row.asset_sha256 || "") || null
      return {
        ...row,
        vision_id: validAdminRollupVisionId(vote?.vision_id || row.vision_id || ""),
        candidate_image_id: optionalInt(vote?.candidate_image_id ?? row.candidate_image_id),
        upvotes: Number(vote?.upvotes || 0),
        downvotes: Number(vote?.downvotes || 0),
        score: Number(vote?.score || 0),
      }
    })
    .filter((row) => row.asset_sha256)
    .filter((row) => row.autopick_eligible && row.status !== "rejected" && assetHasRenderablePortrait(row))

  candidateAssets.sort((left, right) => compareAdminLeaderRows(left, right, currentAssetSha))
  const topAsset = candidateAssets[0] || null
  if (!topAsset?.asset_sha256) return { ok: true, changed: false, code: "NO_CANDIDATE" }
  if (currentAssetSha && topAsset.asset_sha256 === currentAssetSha) {
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
    .bind(symbolNorm, topAsset.asset_sha256, actorNorm)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_portrait_assets
     SET status = 'approved'
     WHERE gene_symbol = ?
       AND asset_sha256 = ?`,
  )
    .bind(symbolNorm, topAsset.asset_sha256)
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
    .bind(symbolNorm, currentAssetSha || null, topAsset.asset_sha256, actorNorm, eventReason)
    .run()

  return {
    ok: true,
    changed: true,
    code: "PROMOTED",
    from_asset_sha256: currentAssetSha || null,
    to_asset_sha256: topAsset.asset_sha256,
    image_score: Number(topAsset.score || 0),
    image_upvotes: Number(topAsset.upvotes || 0),
    image_downvotes: Number(topAsset.downvotes || 0),
  }
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
  {
    reset = false,
    symbolBatch = ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT,
    visionBatch = ADMIN_READ_MODEL_VISION_BATCH_DEFAULT,
  } = {},
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

export async function repairCanonInvariants(
  env,
  { limit = 250, actorId = "system", reason = "" } = {},
) {
  if (!env.ICONOPLASM_DB) {
    return { ok: false, scanned: 0, changed: 0, unresolved: 0, symbols: [] }
  }

  await ensureAdminReadModelsReady(env)
  const cleanedLimit = Math.max(1, Math.min(1000, Number.parseInt(String(limit || 250), 10) || 250))
  const auditReason =
    String(reason || "scheduled_canon_invariant_repair").slice(0, 2000) ||
    "scheduled_canon_invariant_repair"
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       gene_symbol,
       current_asset_sha256,
       leader_asset_sha256,
       candidate_count,
       current_asset_missing,
       admin_override
     FROM icono_admin_gene_rollup
     WHERE COALESCE(admin_override, 0) = 0
       AND (
         (COALESCE(candidate_count, 0) > 0 AND COALESCE(current_asset_sha256, '') = '')
         OR COALESCE(current_asset_missing, 0) = 1
         OR (
           COALESCE(candidate_count, 0) > 0
           AND COALESCE(current_asset_sha256, '') <> ''
           AND COALESCE(leader_asset_sha256, '') <> ''
           AND lower(current_asset_sha256) <> lower(leader_asset_sha256)
         )
       )
     ORDER BY
       COALESCE(current_asset_missing, 0) DESC,
       COALESCE(candidate_count, 0) DESC,
       gene_symbol ASC
     LIMIT ?`,
  )
    .bind(cleanedLimit)
    .all()

  const rows = Array.isArray(resp?.results) ? resp.results : []
  const touchedSymbols = []
  const changedSymbols = []
  const unresolved = []
  for (const row of rows) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol) continue
    touchedSymbols.push(symbol)
    const result = await autoPromoteTopVotedPortrait(env, {
      symbol,
      actorId,
      reason: auditReason,
    })
    if (result?.changed) changedSymbols.push(symbol)
    else unresolved.push(symbol)
  }

  if (touchedSymbols.length) {
    await syncAdminReadModelsAndInvalidateGallery(env, {
      symbols: touchedSymbols,
      skipVisionRollups: true,
    })
  }

  return {
    ok: true,
    scanned: touchedSymbols.length,
    changed: changedSymbols.length,
    unresolved: unresolved.length,
    symbols: touchedSymbols,
    changed_symbols: changedSymbols,
    unresolved_symbols: unresolved,
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
    emulsion_id: publicEmulsionIdForRow(row) || "",
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
    emulsion_id: publicEmulsionIdForRow(row) || "",
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
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
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
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
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

async function removePortraitAssetAndQueueLocalRemoval(
  env,
  {
    symbol,
    assetSha256,
    candidateImageId = null,
    actorId = "",
    reason = "",
    source = "admin_remove",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, changed: false, code: "NO_DB" }
  const symbolNorm = normalizeSymbol(symbol)
  const assetShaNorm = normalizeSha256(assetSha256 || "")
  if (!symbolNorm || !assetShaNorm) return { ok: false, changed: false, code: "BAD_INPUT" }
  const actorNorm = normalizeUserId(actorId || "admin_remove")
  const reasonNorm =
    sanitizeText(reason || "", 2000) ||
    "Removed candidate portrait that violates site moderation rules."

  const existing = await env.ICONOPLASM_DB.prepare(
    `SELECT
       r2_key_full,
       r2_key_medium,
       r2_key_thumb,
       candidate_image_id,
       vision_id
     FROM icono_portrait_assets
     WHERE upper(gene_symbol) = ?
       AND lower(asset_sha256) = ?
     LIMIT 1`,
  )
    .bind(symbolNorm, assetShaNorm)
    .first()
  if (!existing) {
    return { ok: false, changed: false, code: "NOT_FOUND" }
  }

  const current = await env.ICONOPLASM_DB.prepare(
    "SELECT current_asset_sha256 FROM icono_publish_state WHERE upper(gene_symbol)=? LIMIT 1",
  )
    .bind(symbolNorm)
    .first()
  const currentAssetSha = normalizeSha256(current?.current_asset_sha256 || "")
  const isCurrent = !!(currentAssetSha && currentAssetSha === assetShaNorm)

  const queuedRemoval = await queueLocalRemovalRequest(env, {
    symbol: symbolNorm,
    assetSha256: assetShaNorm,
    candidateImageId: optionalInt(candidateImageId ?? existing?.candidate_image_id),
    visionId: sanitizeText(existing?.vision_id || "", 255) || "",
    requestedBy: actorNorm,
    reason: reasonNorm,
    source,
  })

  if (isCurrent) {
    await env.ICONOPLASM_DB.prepare(
      "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=0, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
    )
      .bind(actorNorm, symbolNorm)
      .run()
    await env.ICONOPLASM_DB.prepare(
      "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unpublish', ?, ?, CURRENT_TIMESTAMP)",
    )
      .bind(symbolNorm, assetShaNorm, null, actorNorm, reasonNorm)
      .run()
  }

  await env.ICONOPLASM_DB.prepare(
    "DELETE FROM icono_image_votes WHERE upper(gene_symbol)=? AND lower(asset_sha256)=?",
  )
    .bind(symbolNorm, assetShaNorm)
    .run()
  await env.ICONOPLASM_DB.prepare(
    "DELETE FROM icono_portrait_assets WHERE upper(gene_symbol)=? AND lower(asset_sha256)=?",
  )
    .bind(symbolNorm, assetShaNorm)
    .run()
  await env.ICONOPLASM_DB.prepare(
    "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'remove_candidate', ?, ?, CURRENT_TIMESTAMP)",
  )
    .bind(symbolNorm, assetShaNorm, null, actorNorm, reasonNorm)
    .run()

  const keys = [existing?.r2_key_full, existing?.r2_key_medium, existing?.r2_key_thumb]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
  if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.delete === "function") {
    for (const key of keys) {
      await env.ICONOPLASM_PORTRAITS.delete(key)
    }
  }

  const autoPromote = await autoPromoteTopVotedPortrait(env, {
    symbol: symbolNorm,
    actorId: actorNorm,
    reason: `admin_remove_candidate:${assetShaNorm}`,
  })
  await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbolNorm] })

  return {
    ok: true,
    changed: true,
    code: "REMOVED",
    symbol: symbolNorm,
    asset_sha256: assetShaNorm,
    candidate_image_id:
      optionalInt(candidateImageId ?? existing?.candidate_image_id) ?? null,
    unpublished_current: isCurrent,
    deleted_r2_keys: keys.length,
    queued_local_removal: queuedRemoval || null,
    auto_promote: autoPromote,
  }
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
  let artistNameNorm = sanitizeText(artistName || "", 255) || ""
  if (!artistNameNorm) {
    const existingArtist = await env.ICONOPLASM_DB.prepare(
      `SELECT MAX(NULLIF(artist_name, '')) AS artist_name
       FROM icono_portrait_assets
       WHERE lower(COALESCE(artist_tag, '')) = ?`,
    )
      .bind(artistTagNorm)
      .first()
    artistNameNorm = sanitizeText(existingArtist?.artist_name || "", 255) || ""
  }
  const artistNameValue = artistNameNorm || null
  const actorNorm = normalizeUserId(actorId || "artist_style_blacklist")
  const reasonNorm =
    sanitizeText(reason || "", 2000) || `Removed blocklisted artist tag ${artistTagNorm}`

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
      .bind(artistTagNorm, artistNameValue, reasonNorm, actorNorm)
      .run()
  }

  return {
    ok: true,
    dry_run: dryRun,
    artist_tag: artistTagNorm,
    artist_name: artistNameNorm,
    affected_symbols: [],
    affected_assets: 0,
    affected_visible_assets: 0,
    affected_genes: 0,
    affected_live_genes: 0,
    promoted_genes: 0,
    unpublished_genes: 0,
    promotions: [],
    unpublished: [],
  }
}

function normalizeGalleryOrder(raw) {
  return normalizeIconoplasmHomeOrder(raw, "votes")
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

function compareNullableNumberDescWithNullBottom(left, right) {
  const leftValue = Number(left)
  const rightValue = Number(right)
  const leftPresent = Number.isFinite(leftValue)
  const rightPresent = Number.isFinite(rightValue)
  if (!leftPresent && !rightPresent) return 0
  if (!leftPresent) return 1
  if (!rightPresent) return -1
  return rightValue - leftValue
}

function compareNullableNumberAscWithNullBottom(left, right) {
  const leftValue = Number(left)
  const rightValue = Number(right)
  const leftPresent = Number.isFinite(leftValue)
  const rightPresent = Number.isFinite(rightValue)
  if (!leftPresent && !rightPresent) return 0
  if (!leftPresent) return 1
  if (!rightPresent) return -1
  return leftValue - rightValue
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

function compareDiscoveryNewestFallback(left, right) {
  return (
    compareNullableTextDesc(
      left.last_encountered_at || left.first_discovered_at,
      right.last_encountered_at || right.first_discovered_at,
    ) || compareNullableTextAsc(left.gene_symbol, right.gene_symbol)
  )
}

function compareDiscoveryPopularityFallback(left, right) {
  return (
    Number(right.popularity_score || 0) - Number(left.popularity_score || 0) ||
    Number(right.image_score || 0) - Number(left.image_score || 0) ||
    Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
    compareNullableTextDesc(
      left.published_at || left.asset_created_at,
      right.published_at || right.asset_created_at,
    ) ||
    compareDiscoveryNewestFallback(left, right)
  )
}

function discoveryRandomRank(seed, symbol) {
  const input = `${seed || "iconoplasm"}|${normalizeSymbol(symbol) || ""}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function sortDiscoveryRowsForOrder(rows, order, seed = null) {
  const sorted = Array.isArray(rows) ? rows.slice() : []
  sorted.sort((left, right) => {
    if (order === "votes") {
      return (
        Number(right.image_score || 0) - Number(left.image_score || 0) ||
        Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "uniqueness") {
      return (
        compareNullableNumberAscWithNullBottom(left.uniqueness_rank, right.uniqueness_rank) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "popularity") {
      return compareDiscoveryPopularityFallback(left, right)
    }
    if (order === "heaviest") {
      return (
        compareNullableNumberDescWithNullBottom(left.weight_kg, right.weight_kg) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "lightest") {
      return (
        compareNullableNumberAscWithNullBottom(left.weight_kg, right.weight_kg) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "oldest") {
      return (
        compareNullableNumberDescWithNullBottom(left.age_years, right.age_years) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "youngest") {
      return (
        compareNullableNumberAscWithNullBottom(left.age_years, right.age_years) ||
        compareDiscoveryPopularityFallback(left, right)
      )
    }
    if (order === "symbol") {
      return compareNullableTextAsc(left.gene_symbol, right.gene_symbol)
    }
    if (order === "shortest") {
      const leftName = String(left.full_name || left.gene_symbol || "").trim()
      const rightName = String(right.full_name || right.gene_symbol || "").trim()
      return (
        leftName.length - rightName.length ||
        compareNullableTextAsc(leftName, rightName) ||
        compareNullableTextAsc(left.gene_symbol, right.gene_symbol)
      )
    }
    if (order === "random") {
      return (
        discoveryRandomRank(seed, left.gene_symbol) - discoveryRandomRank(seed, right.gene_symbol) ||
        compareNullableTextAsc(left.gene_symbol, right.gene_symbol)
      )
    }
    return compareDiscoveryNewestFallback(left, right)
  })
  return sorted
}

function clearGallerySnapshotCache() {
  gallerySnapshotCache.catalogHash = null
  gallerySnapshotCache.base = null
  gallerySnapshotCache.loadedAt = 0
  gallerySnapshotCache.items = []
  gallerySnapshotCache.publishedTotal = 0
  gallerySnapshotCache.hasUniquenessRanks = false
  gallerySnapshotCache.sorted = new Map()
}

function clearSharedD1CostCaches() {
  publishedPortraitRefsCache.key = null
  publishedPortraitRefsCache.value = null
  publishedPortraitFingerprintCache.loadedAt = 0
  publishedPortraitFingerprintCache.value = null
  sharedPublishedPortraitFingerprintCache.loadedAt = 0
  sharedPublishedPortraitFingerprintCache.value = null
  galleryPublishedRowsCache.version = null
  galleryPublishedRowsCache.value = null
  galleryUniquenessRowsCache.version = null
  galleryUniquenessRowsCache.value = null
  hydratedCatalogArtifactCache.key = null
  hydratedCatalogArtifactCache.value = null
}

// Test-only reset hook. The cost-barrier regression tests use this to simulate a
// fresh isolate so they can prove the shared KV snapshots, not just module memory,
// are what keep public traffic off D1.
export function resetIconoplasmRuntimeCachesForTest() {
  catalogCache.hash = null
  catalogCache.bySymbol = new Map()
  catalogCache.symbolByUniprot = new Map()
  catalogCache.symbolByAlias = new Map()
  catalogCache.loadedAt = 0
  clearGallerySnapshotCache()
  clearSharedD1CostCaches()
  galleryVersionCache.value = "0"
  galleryVersionCache.loadedAt = 0
}

async function readVersionedSharedJson(env, prefix, version) {
  if (!env?.KV || !version) return null
  try {
    const raw = await env.KV.get(`${prefix}${version}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeVersionedSharedJson(env, prefix, version, value) {
  if (!env?.KV || !version) return
  try {
    await env.KV.put(`${prefix}${version}`, JSON.stringify(value))
  } catch {
    // Shared-cache writes are an optimization barrier, not the source of truth.
    // If KV write-through fails we can still fall back to the raw D1 result.
  }
}

async function hydratedCatalogArtifact(env, hash, { fresh = false } = {}) {
  if (!env?.KV || !hash) return null
  const requestedHash = String(hash || "").trim()
  const baseHash = catalogBaseHash(requestedHash)
  if (!baseHash) return null
  const cacheKey = requestedHash.includes("-")
    ? requestedHash
    : buildPortraitAwareManifestHash(
        baseHash,
        await sharedPublishedPortraitFingerprint(env, fresh ? { fresh: true } : undefined),
      ) || baseHash
  if (!fresh && hydratedCatalogArtifactCache.key === cacheKey && hydratedCatalogArtifactCache.value) {
    return hydratedCatalogArtifactCache.value
  }
  if (!fresh) {
    const cached = await readVersionedSharedJson(env, KV_HYDRATED_CATALOG_ARTIFACT_PREFIX, cacheKey)
    if (cached && typeof cached === "object") {
      hydratedCatalogArtifactCache.key = cacheKey
      hydratedCatalogArtifactCache.value = cached
      return cached
    }
  }

  const raw = await env.KV.get(`${KV_CATALOG_PREFIX}${baseHash}`)
  if (!raw) return null
  let artifact
  try {
    artifact = JSON.parse(raw)
  } catch {
    return null
  }

  // Cost barrier: this is the last whole-artifact hydration seam. Keep it behind
  // the shared versioned cache so a fresh isolate does not reparse + rehydrate
  // ~20k genes on its own just because it has never seen traffic before.
  const hydrated = mergePublishedPortraitRefsIntoArtifact(
    artifact,
    await publishedPortraitRefs(env, fresh ? { fresh: true } : undefined),
  )
  hydratedCatalogArtifactCache.key = cacheKey
  hydratedCatalogArtifactCache.value = hydrated
  if (!fresh) {
    await writeVersionedSharedJson(env, KV_HYDRATED_CATALOG_ARTIFACT_PREFIX, cacheKey, hydrated)
  }
  return hydrated
}

function gallerySnapshotMaxAgeMs(order) {
  return order === "votes" ? GALLERY_VOTES_SNAPSHOT_TTL_MS : GALLERY_SNAPSHOT_TTL_MS
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
  clearSharedD1CostCaches()
  await bumpGalleryVersion(env)
}

async function syncAdminReadModelsAndInvalidateGallery(
  env,
  {
    symbols = [],
    visionIds = [],
    fullVision = false,
    fullRebuild = false,
    skipVoteSummaries = false,
    skipGeneRollups = false,
    skipVisionRollups = false,
    skipDashboard = false,
  } = {},
) {
  const result = await syncAdminReadModels(env, {
    symbols,
    visionIds,
    fullVision,
    fullRebuild,
    // Keep the invalidate-gallery wrapper behaviorally identical to the plain
    // read-model sync path. The workstation relies on these skip flags to break
    // the large Website sync into smaller durable phases; dropping them here
    // turns a scoped refresh back into an accidental full rebuild.
    skipVoteSummaries,
    skipGeneRollups,
    skipVisionRollups,
    skipDashboard,
  })
  await invalidateGalleryCache(env)
  return result
}

function galleryCanUseEdgeCache(url) {
  const order = normalizeGalleryOrder(url.searchParams.get("order"))
  // Vote-sorted pages are the hot freshness path. Keeping them on the worker
  // edge cache meant globally visible score changes could trail behind writes
  // because cache invalidation was gated on eventually consistent KV version
  // bumps. Other orders can stay cheap and cacheable.
  if (order === "votes") return false
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

function gallerySortablePositiveMetric(value) {
  const metric = Number(value)
  return Number.isFinite(metric) && metric > 0 ? metric : null
}

function sortGalleryItems(items, order, seed = null) {
  const sorted = Array.isArray(items) ? items.slice() : []
  sorted.sort((left, right) => {
    if (order === "symbol") {
      return compareNullableTextAsc(left.symbol, right.symbol)
    }
    if (order === "shortest") {
      const leftName = String(left.full_name || left.symbol || "").trim()
      const rightName = String(right.full_name || right.symbol || "").trim()
      return (
        leftName.length - rightName.length ||
        compareNullableTextAsc(leftName, rightName) ||
        compareNullableTextAsc(left.symbol, right.symbol)
      )
    }
    if (order === "heaviest") {
      return (
        compareNullableNumberDescWithNullBottom(
          gallerySortablePositiveMetric(left.weight_kg),
          gallerySortablePositiveMetric(right.weight_kg),
        ) ||
        compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "lightest") {
      return (
        compareNullableNumberAscWithNullBottom(
          gallerySortablePositiveMetric(left.weight_kg),
          gallerySortablePositiveMetric(right.weight_kg),
        ) ||
        compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "oldest") {
      return (
        compareNullableNumberDescWithNullBottom(
          gallerySortablePositiveMetric(left.age_years),
          gallerySortablePositiveMetric(right.age_years),
        ) ||
        compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "youngest") {
      return (
        compareNullableNumberAscWithNullBottom(
          gallerySortablePositiveMetric(left.age_years),
          gallerySortablePositiveMetric(right.age_years),
        ) ||
        compareGalleryPopularityFallback(left, right)
      )
    }
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

function publishedGalleryItems(snapshot) {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : []
  return items.filter((item) => {
    if (!item || item.portrait?.status !== "published") return false
    return Boolean(item.portrait?.medium_url || item.portrait?.thumb_url || item.portrait?.hero_url)
  })
}

async function queryGalleryPublishedRows(env) {
  if (!env.ICONOPLASM_DB) return []
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT
       ps.gene_symbol AS symbol,
       ps.updated_at AS published_at,
       pa.created_at AS asset_created_at,
       ge.weight_kg,
       ge.age_years,
       pa.asset_sha256,
       pa.candidate_image_id,
       pa.vision_id,
      pa.emulsion_id,
       pa.r2_key_full,
       pa.r2_key_medium,
       pa.r2_key_thumb,
       pa.width,
       pa.height,
       COALESCE(vs.upvotes, 0) AS image_upvotes,
       COALESCE(vs.downvotes, 0) AS image_downvotes,
       COALESCE(vs.score, 0) AS image_score
     FROM icono_publish_state ps
     JOIN icono_portrait_assets pa
       ON pa.gene_symbol = ps.gene_symbol
      AND pa.asset_sha256 = ps.current_asset_sha256
     LEFT JOIN icono_gene_essence ge
       ON ge.gene_symbol = ps.gene_symbol
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = ps.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE ps.current_asset_sha256 IS NOT NULL
       AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''`,
  ).all()
  return Array.isArray(rows?.results) ? rows.results : []
}

async function galleryPublishedRows(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return []
  if (fresh) return queryGalleryPublishedRows(env)
  const version = await currentGalleryVersion(env)
  if (galleryPublishedRowsCache.version === version && Array.isArray(galleryPublishedRowsCache.value)) {
    return galleryPublishedRowsCache.value
  }
  const cached = await readVersionedSharedJson(env, KV_GALLERY_PUBLISHED_ROWS_PREFIX, version)
  if (Array.isArray(cached)) {
    galleryPublishedRowsCache.version = version
    galleryPublishedRowsCache.value = cached
    return cached
  }
  const rows = await queryGalleryPublishedRows(env)
  galleryPublishedRowsCache.version = version
  galleryPublishedRowsCache.value = rows
  await writeVersionedSharedJson(env, KV_GALLERY_PUBLISHED_ROWS_PREFIX, version, rows)
  return rows
}

async function queryGalleryUniquenessRows(env) {
  if (!env.ICONOPLASM_DB) return []
  const uniquenessRowsRaw = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, aesthetics_origin_json
       FROM icono_gene_essence`,
  ).all()
  return Array.isArray(uniquenessRowsRaw?.results) ? uniquenessRowsRaw.results : []
}

async function galleryUniquenessRows(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return []
  if (fresh) return queryGalleryUniquenessRows(env)
  const version = await currentGalleryVersion(env)
  if (galleryUniquenessRowsCache.version === version && Array.isArray(galleryUniquenessRowsCache.value)) {
    return galleryUniquenessRowsCache.value
  }
  const cached = await readVersionedSharedJson(env, KV_GALLERY_UNIQUENESS_ROWS_PREFIX, version)
  if (Array.isArray(cached)) {
    galleryUniquenessRowsCache.version = version
    galleryUniquenessRowsCache.value = cached
    return cached
  }
  const rows = await queryGalleryUniquenessRows(env)
  galleryUniquenessRowsCache.version = version
  galleryUniquenessRowsCache.value = rows
  await writeVersionedSharedJson(env, KV_GALLERY_UNIQUENESS_ROWS_PREFIX, version, rows)
  return rows
}

async function gallerySnapshot(env, url, { order = "votes" } = {}) {
  await warmCatalogCache(env)
  const catalogTotal = catalogCache.bySymbol.size
  const base = portraitBase(url, env)
  const now = Date.now()
  const snapshotMaxAgeMs = gallerySnapshotMaxAgeMs(order)
  const needsUniquenessRanks = order === "uniqueness"
  const cacheFresh =
    gallerySnapshotCache.catalogHash === catalogCache.hash &&
    gallerySnapshotCache.base === base &&
    now - gallerySnapshotCache.loadedAt < snapshotMaxAgeMs &&
    gallerySnapshotCache.items.length > 0 &&
    (!needsUniquenessRanks || gallerySnapshotCache.hasUniquenessRanks)
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

  // Cost barrier: this snapshot is allowed to read the full published gallery
  // inventory exactly once per shared gallery version. Fresh isolates must load
  // the shared snapshot from KV instead of repeating the D1 scan.
  const publishedRows = await galleryPublishedRows(env)
  const publishedMap = new Map()
  for (const row of publishedRows) {
    const symbol = normalizeSymbol(row?.symbol || "") || ""
    if (!symbol) continue
    const width = optionalInt(row?.width)
    const height = optionalInt(row?.height)
    publishedMap.set(symbol, {
      width,
      height,
      weight_kg:
        Number.isFinite(Number(row?.weight_kg)) && Number(row.weight_kg) > 0
          ? Number(row.weight_kg)
          : null,
      age_years:
        Number.isFinite(Number(row?.age_years)) && Number(row.age_years) >= 0
          ? Number(row.age_years)
          : null,
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
        emulsion_id: publicEmulsionIdForRow(row) || null,
        artist_id: publicArtistIdForRow(row) || null,
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
      },
    })
  }

  let uniquenessBySymbol = new Map()
  if (needsUniquenessRanks) {
    // This full-table scan is only needed for the uniqueness sort. Running it for
    // every gallery request pushed production D1 over its CPU limit and left the
    // homepage with zero cards, so keep the expensive work behind the one order
    // that actually uses it.
    //
    // Source of truth note: uniqueness must stay based on the synced NiceGUI
    // mapping/demographics pipeline. aesthetics_origin_json is the stored clan list.
    // Do not invent a separate website-only clan resolver here.
    const uniquenessRows = await galleryUniquenessRows(env)
    uniquenessBySymbol = buildGalleryUniquenessIndex(catalogCache.bySymbol, uniquenessRows)
  }

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
      weight_kg: published?.weight_kg ?? null,
      age_years: published?.age_years ?? null,
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
  gallerySnapshotCache.hasUniquenessRanks = needsUniquenessRanks
  gallerySnapshotCache.sorted = new Map()

  return {
    items,
    published_total: publishedRows.length,
    catalog_total: catalogTotal,
  }
}

async function galleryVotesFeed(env, url, rawLimit, rawOffset) {
  const limit = normalizeGalleryLimit(rawLimit)
  const offset = normalizeGalleryOffset(rawOffset)
  // Cost fence: the public gallery defaults to vote order. If this path goes
  // back to live D1 sorting, every anonymous home pageview becomes an avoidable
  // read-model scan and the billing graph starts screaming again.
  const snapshot = await gallerySnapshot(env, url, { order: "votes" })
  const publishedItems = publishedGalleryItems(snapshot)
  const sorted = sortGalleryItems(publishedItems, "votes")
  const items = sorted.slice(offset, offset + limit)

  return {
    order: "votes",
    total: snapshot.catalog_total,
    published_total: snapshot.published_total,
    offset,
    limit,
    has_more: offset + items.length < publishedItems.length,
    catalog_total: snapshot.catalog_total,
    items,
  }
}

function galleryMetricSpec(order) {
  switch (order) {
    case "heaviest":
      return {
        metricExpr: "ge.weight_kg",
        metricDirection: "DESC",
        invalidMetricExpr: "ge.weight_kg IS NULL OR ge.weight_kg <= 0",
        uniquenessFromLeakage: false,
      }
    case "lightest":
      return {
        metricExpr: "ge.weight_kg",
        metricDirection: "ASC",
        invalidMetricExpr: "ge.weight_kg IS NULL OR ge.weight_kg <= 0",
        uniquenessFromLeakage: false,
      }
    case "oldest":
      return {
        metricExpr: "ge.age_years",
        metricDirection: "DESC",
        invalidMetricExpr: "ge.age_years IS NULL OR ge.age_years <= 0",
        uniquenessFromLeakage: false,
      }
    case "youngest":
      return {
        metricExpr: "ge.age_years",
        metricDirection: "ASC",
        invalidMetricExpr: "ge.age_years IS NULL OR ge.age_years <= 0",
        uniquenessFromLeakage: false,
      }
    case "uniqueness":
      return {
        metricExpr: "ge.leakage_percent",
        metricDirection: "ASC",
        invalidMetricExpr: "ge.leakage_percent IS NULL",
        uniquenessFromLeakage: true,
      }
    case "newest":
      return {
        metricExpr: "gr.live_created_at",
        metricDirection: "DESC",
        invalidMetricExpr: "gr.live_created_at IS NULL",
        uniquenessFromLeakage: false,
      }
    default:
      return null
  }
}

async function galleryMetricFeed(env, url, order, rawLimit, rawOffset) {
  const metricSpec = galleryMetricSpec(order)
  if (!metricSpec) return null

  const limit = normalizeGalleryLimit(rawLimit)
  const offset = normalizeGalleryOffset(rawOffset)
  const base = portraitBase(url, env)
  const manifest = await catalogManifestObj(env)
  const catalogTotal = Number(manifest?.gene_count || 0)

  if (!env.ICONOPLASM_DB) {
    return {
      order,
      total: 0,
      published_total: 0,
      offset,
      limit,
      has_more: false,
      catalog_total: catalogTotal,
      items: [],
    }
  }

  const { metricExpr, metricDirection, invalidMetricExpr, uniquenessFromLeakage } = metricSpec
  // Keep impossible zero-valued demographics visible on the site if they exist,
  // but never let them outrank real positive values in youngest/lightest/oldest/
  // heaviest sorts. The cards can show the raw data; the ordering logic should
  // treat non-positive age/weight as "unknown for sorting" and sink them.
  const orderByClause = `
    CASE WHEN ${invalidMetricExpr} THEN 1 ELSE 0 END ASC,
    CASE WHEN ${invalidMetricExpr} THEN NULL ELSE ${metricExpr} END ${metricDirection},
    COALESCE(gr.live_score, 0) DESC,
    COALESCE(gr.live_upvotes, 0) DESC,
    COALESCE(gr.live_created_at, '') DESC,
    gr.gene_symbol ASC`

  const [publishedCountRow, rows] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT with_live AS published_total
         FROM icono_admin_dashboard_summary
        WHERE summary_key = ?
        LIMIT 1`,
    )
      .bind(ADMIN_DASHBOARD_SUMMARY_KEY)
      .first(),
    env.ICONOPLASM_DB.prepare(
      `SELECT
         gr.gene_symbol AS symbol,
         COALESCE(gc.full_name, gr.full_name) AS full_name,
         gr.live_created_at AS published_at,
         gr.live_created_at AS asset_created_at,
         gr.current_asset_sha256 AS asset_sha256,
         0 AS candidate_image_id,
         gr.live_vision_id AS vision_id,
         gr.live_emulsion_id AS emulsion_id,
         gr.live_r2_key_full AS r2_key_full,
         gr.live_r2_key_medium AS r2_key_medium,
         gr.live_r2_key_thumb AS r2_key_thumb,
         NULL AS width,
         NULL AS height,
         COALESCE(gr.live_upvotes, 0) AS image_upvotes,
         COALESCE(gr.live_downvotes, 0) AS image_downvotes,
         COALESCE(gr.live_score, 0) AS image_score,
         gc.color_hex,
         ge.weight_kg,
         ge.age_years,
         ge.leakage_percent
       FROM icono_admin_gene_rollup gr
       LEFT JOIN icono_gene_catalog gc
         ON gc.gene_symbol = gr.gene_symbol
       LEFT JOIN icono_gene_essence ge
         ON ge.gene_symbol = gr.gene_symbol
       WHERE COALESCE(gr.current_asset_sha256, '') <> ''
         AND COALESCE(gr.current_asset_missing, 0) = 0
         AND COALESCE(gr.live_r2_key_medium, gr.live_r2_key_thumb, gr.live_r2_key_full, '') <> ''
       ORDER BY ${orderByClause}
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all(),
  ])

  const publishedTotal = Number(publishedCountRow?.published_total || 0)
  const results = Array.isArray(rows?.results) ? rows.results : []
  const items = results
    .map((row) => {
      const symbol = normalizeSymbol(row?.symbol || "")
      if (!symbol) return null
      const width = optionalInt(row?.width)
      const height = optionalInt(row?.height)
      const weightKg =
        Number.isFinite(Number(row?.weight_kg)) && Number(row.weight_kg) > 0
          ? Number(row.weight_kg)
          : null
      const ageYears =
        Number.isFinite(Number(row?.age_years)) && Number(row.age_years) >= 0
          ? Number(row.age_years)
          : null
      const leakagePercent =
        Number.isFinite(Number(row?.leakage_percent)) && Number(row.leakage_percent) >= 0
          ? Number(row.leakage_percent)
          : null
      return {
        symbol,
        color: normalizeHexColor(row?.color_hex || "") || "#888",
        full_name: sanitizeText(row?.full_name || "", 255) || symbol,
        uniqueness_rank: uniquenessFromLeakage ? leakagePercent : null,
        width,
        height,
        weight_kg: weightKg,
        age_years: ageYears,
        popularity_score: wikiPageviewsForSymbol(symbol),
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
          emulsion_id: publicEmulsionIdForRow(row) || null,
          artist_id: publicArtistIdForRow(row) || null,
          ...(width != null ? { width } : {}),
          ...(height != null ? { height } : {}),
        },
      }
    })
    .filter(Boolean)

  return {
    order,
    total: catalogTotal,
    published_total: publishedTotal,
    offset,
    limit,
    has_more: offset + items.length < publishedTotal,
    catalog_total: catalogTotal,
    items,
  }
}

async function galleryFeed(env, url, rawOrder, rawLimit, rawOffset, rawSeed) {
  const order = normalizeGalleryOrder(rawOrder)
  const limit = normalizeGalleryLimit(rawLimit)
  const offset = normalizeGalleryOffset(rawOffset)
  const seed =
    order === "random" ? normalizeGallerySeed(rawSeed) || crypto.randomUUID().slice(0, 12) : null
  if (order === "votes") {
    return galleryVotesFeed(env, url, limit, offset)
  }
  const metricFeed = await galleryMetricFeed(env, url, order, limit, offset)
  if (metricFeed) return metricFeed
  const snapshot = await gallerySnapshot(env, url, { order })
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
    // D1 cost fence: this query runs on gene pages. gene_symbol + asset_sha256
    // are already normalized primary keys, so raw equality is the cheap path.
    // upper()/lower() here turns a single gene-page read into a scan.
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
      pa.emulsion_id,
       COALESCE(vs.upvotes, 0) AS image_upvotes,
       COALESCE(vs.downvotes, 0) AS image_downvotes,
       COALESCE(vs.score, 0) AS image_score
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE pa.gene_symbol = ?
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
      emulsion_id: publicEmulsionIdForRow(row) || null,
      emulsion_label: generationRequestVisionLabel(row) || null,
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

function normalizeRequestedSymbols(rawSymbols, maxCount = PUBLIC_MAX_GENE_BATCH_LIMIT) {
  const values = Array.isArray(rawSymbols)
    ? rawSymbols
    : typeof rawSymbols === "string"
      ? rawSymbols.split(",")
      : []
  return Array.from(new Set(values.map((value) => normalizeSymbol(value)).filter(Boolean))).slice(
    0,
    maxCount,
  )
}

function normalizePublicGeneSearchScope(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (value === "discoveries") return "discoveries"
  if (value === "starter") return "starter"
  return "catalog"
}

function normalizeSearchNeedle(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
}

function scorePublicGeneSearchValue(queryUpper, queryLower, rawValue, category) {
  const value = normalizeSearchNeedle(rawValue)
  if (!value) return null
  const valueUpper = value.toUpperCase()
  const valueLower = value.toLowerCase()
  let baseRank = 100
  if (category === "symbol") baseRank = 0
  else if (category === "full_name") baseRank = 10
  else if (category === "alias") baseRank = 20

  if (valueUpper === queryUpper) {
    return { rank: baseRank, matched_by: category, matched_value: value }
  }
  if (valueUpper.startsWith(queryUpper)) {
    return { rank: baseRank + 1, matched_by: category, matched_value: value }
  }
  if (valueLower.includes(queryLower)) {
    return { rank: baseRank + 2, matched_by: category, matched_value: value }
  }
  return null
}

function scorePublicGeneSearchMatch(queryUpper, queryLower, symbol, gene) {
  const candidates = []
  const symbolMatch = scorePublicGeneSearchValue(queryUpper, queryLower, symbol, "symbol")
  if (symbolMatch) candidates.push(symbolMatch)

  const fullName = normalizeSearchNeedle(gene?.n || symbol)
  const fullNameMatch = scorePublicGeneSearchValue(queryUpper, queryLower, fullName, "full_name")
  if (fullNameMatch) candidates.push(fullNameMatch)

  for (const alias of normalizeCatalogAliases(gene?.a || [])) {
    const aliasMatch = scorePublicGeneSearchValue(queryUpper, queryLower, alias, "alias")
    if (aliasMatch) candidates.push(aliasMatch)
  }

  if (!candidates.length) return null
  candidates.sort((left, right) => {
    return (
      Number(left.rank || 0) - Number(right.rank || 0) ||
      String(left.matched_value || "").length - String(right.matched_value || "").length ||
      compareNullableTextAsc(left.matched_value, right.matched_value)
    )
  })
  return candidates[0]
}

function publicGeneSearchEntry(url, env, symbol, gene, match) {
  const base = portraitBase(url, env)
  const entry = {
    symbol,
    color: gene?.c || "#888",
    full_name: gene?.n || symbol,
    matched_by: match?.matched_by || null,
    matched_value: match?.matched_value || null,
    match_rank: Number(match?.rank ?? 999),
  }
  if (gene?.pt) entry.pt = joinUrl(base, gene.pt)
  if (gene?.ph) entry.ph = joinUrl(base, gene.ph)
  return entry
}

async function parseJsonBody(request) {
  try {
    const body = await request.json()
    return body && typeof body === "object" ? body : {}
  } catch {
    return {}
  }
}

async function resolvePublicIdentifier(env, rawIdentifier) {
  await warmCatalogCache(env)
  const symbol = normalizeSymbol(rawIdentifier)
  if (symbol && catalogCache.bySymbol.has(symbol)) {
    return {
      requested: String(rawIdentifier || ""),
      canonical_symbol: symbol,
      matched_by: "symbol",
      found: true,
    }
  }
  const uniprot = normalizeUniprot(rawIdentifier)
  if (uniprot) {
    const resolvedSymbol = catalogCache.symbolByUniprot.get(uniprot)
    if (resolvedSymbol) {
      return {
        requested: String(rawIdentifier || ""),
        canonical_symbol: resolvedSymbol,
        matched_by: "uniprot",
        found: true,
      }
    }
  }
  const aliasKey = normalizeCatalogAliasLookupKey(rawIdentifier)
  if (aliasKey) {
    const resolvedSymbol = catalogCache.symbolByAlias.get(aliasKey)
    if (resolvedSymbol) {
      return {
        requested: String(rawIdentifier || ""),
        canonical_symbol: resolvedSymbol,
        matched_by: "alias",
        found: true,
      }
    }
  }
  return {
    requested: String(rawIdentifier || ""),
    canonical_symbol: null,
    matched_by: null,
    found: false,
  }
}

async function handlePublicMetadata(request, env) {
  const url = new URL(request.url)
  const metadata = await publicMetadataObj(url, env)
  if (!metadata) {
    return json({ error: "Public catalog metadata not found — publish the catalog first" }, 404)
  }
  const etag = metadata.build_version ? `"${metadata.build_version}"` : await etagFor(metadata)
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" },
    })
  }
  return json(metadata, 200, { ETag: etag, "Cache-Control": "public, max-age=300" })
}

function handlePublicSchema() {
  return json(publicSchemaDoc(), 200, { "Cache-Control": "public, max-age=3600" })
}

async function handlePublicCatalogManifest(request, env) {
  const url = new URL(request.url)
  const manifest = await extensionManifestObj(url, env)
  if (!manifest) {
    return json({ error: "Public catalog manifest not found — publish the catalog first" }, 404)
  }
  const portraitFingerprint = await sharedPublishedPortraitFingerprint(env)
  const buildHash = String(manifest.current_hash || "").trim() || null
  const catalogHash = catalogBaseHash(buildHash)
  const payload = {
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    catalog_hash: catalogHash,
    build_version: buildHash,
    portrait_hash: portraitFingerprintVersion(portraitFingerprint),
    released_at: manifest.generated_at || null,
    gene_count: manifest.gene_count || null,
    artifact_schema_version: manifest.schema_version || 1,
    artifact_url: buildHash
      ? publicUrl(url, `/catalog/${publicCatalogArtifactFilename(buildHash)}`)
      : null,
    dump_urls: {
      catalog_jsonl: catalogHash
        ? publicUrl(url, `/dumps/${publicCatalogJsonlFilename(catalogHash)}`)
        : null,
    },
  }
  const etag = payload.build_version ? `"${payload.build_version}"` : await etagFor(payload)
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ...corsHeaders(), ETag: etag, "Cache-Control": "public, max-age=300" },
    })
  }
  return json(payload, 200, { ETag: etag, "Cache-Control": "public, max-age=300" })
}

async function handlePublicCatalogArtifact(env, path) {
  const match = path.match(/\/api\/public\/v1\/catalog\/catalog\.([a-z0-9-]+)\.json$/i)
  if (!match) return json({ error: "Invalid public catalog artifact path" }, 400)
  return handleCatalogArtifact(
    env,
    publicCatalogArtifactPath(String(match[1] || "")).replace(PUBLIC_API_PREFIX, "/api"),
  )
}

async function handlePublicCatalogJsonlDump(env, path) {
  const match = path.match(/\/api\/public\/v1\/dumps\/catalog\.([a-z0-9-]+)\.jsonl$/i)
  if (!match) return json({ error: "Invalid public dump path" }, 400)
  if (!env.ICONOPLASM_PORTRAITS) return json({ error: "Portrait bucket binding missing" }, 500)
  const hash = String(match[1] || "").split("-")[0]
  const object = await env.ICONOPLASM_PORTRAITS.get(publicCatalogJsonlDumpKey(hash))
  if (!object) return json({ error: "Catalog dump not found" }, 404)
  return new Response(object.body, {
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${hash}"`,
    },
  })
}

async function handlePublicGeneBatch(request, env) {
  const body = await parseJsonBody(request)
  const symbols = normalizeRequestedSymbols(
    body.symbols || body.ids || body.identifiers || [],
    Number.parseInt(String(body.limit || PUBLIC_DEFAULT_GENE_BATCH_LIMIT), 10) ||
      PUBLIC_DEFAULT_GENE_BATCH_LIMIT,
  ).slice(0, PUBLIC_MAX_GENE_BATCH_LIMIT)
  const fields = body.fields || null
  if (!symbols.length) {
    return json({
      api_version: PUBLIC_API_VERSION,
      schema_version: API_SCHEMA_VERSION,
      genes: [],
      missing: [],
    })
  }
  const url = new URL(request.url)
  const records = []
  const missing = []
  for (const symbol of symbols) {
    const record = await geneRecord(env, url, symbol)
    if (!record) {
      missing.push(symbol)
      continue
    }
    records.push(projectGeneRecord(record, fields))
  }
  return json(
    {
      api_version: PUBLIC_API_VERSION,
      schema_version: API_SCHEMA_VERSION,
      canonical_key: "symbol",
      genes: records,
      missing,
    },
    200,
    { "Cache-Control": "public, max-age=120" },
  )
}

async function handlePublicResolve(request, env) {
  const body = await parseJsonBody(request)
  const identifiers = Array.isArray(body.identifiers)
    ? body.identifiers
    : Array.isArray(body.ids)
      ? body.ids
      : []
  const limited = identifiers.slice(0, PUBLIC_MAX_RESOLVE_BATCH_LIMIT)
  const results = []
  for (const identifier of limited) {
    results.push(await resolvePublicIdentifier(env, identifier))
  }
  return json({
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    results,
  })
}

async function handlePublicChanges(request, env) {
  if (!env.ICONOPLASM_DB) return json({ error: "ICONOPLASM_DB binding missing" }, 500)
  const url = new URL(request.url)
  const since = sanitizeText(url.searchParams.get("since") || "", 64) || "1970-01-01T00:00:00Z"
  const limit = Math.max(
    1,
    Math.min(500, Number.parseInt(url.searchParams.get("limit") || "200", 10)),
  )
  const perSourceLimit = Math.max(limit * 5, 250)
  const [catalogRows, essenceRows, portraitRows, publishStateRows] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT upper(gene_symbol) AS symbol, updated_at
         FROM icono_gene_catalog
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT upper(gene_symbol) AS symbol, updated_at
         FROM icono_gene_essence
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT upper(gene_symbol) AS symbol, updated_at
         FROM icono_publish_state
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT upper(gene_symbol) AS symbol, current_asset_sha256
         FROM icono_publish_state`,
    ).all(),
  ])

  const merged = []
  for (const row of Array.isArray(catalogRows?.results) ? catalogRows.results : []) {
    merged.push({
      symbol: normalizeSymbol(row?.symbol || ""),
      changed_at: row?.updated_at ? String(row.updated_at) : null,
      change_type: "catalog",
    })
  }
  for (const row of Array.isArray(essenceRows?.results) ? essenceRows.results : []) {
    merged.push({
      symbol: normalizeSymbol(row?.symbol || ""),
      changed_at: row?.updated_at ? String(row.updated_at) : null,
      change_type: "essence",
    })
  }
  for (const row of Array.isArray(portraitRows?.results) ? portraitRows.results : []) {
    merged.push({
      symbol: normalizeSymbol(row?.symbol || ""),
      changed_at: row?.updated_at ? String(row.updated_at) : null,
      change_type: "portrait",
    })
  }

  merged.sort((left, right) => {
    return (
      compareNullableTextAsc(left.changed_at, right.changed_at) ||
      compareNullableTextAsc(left.symbol, right.symbol) ||
      compareNullableTextAsc(left.change_type, right.change_type)
    )
  })

  const publishStateBySymbol = new Map(
    (Array.isArray(publishStateRows?.results) ? publishStateRows.results : [])
      .map((row) => [
        normalizeSymbol(row?.symbol || ""),
        normalizeSha256(row?.current_asset_sha256 || "") || null,
      ])
      .filter(([symbol]) => Boolean(symbol)),
  )

  const results = []
  const bySymbol = new Map()
  for (const row of merged) {
    if (!row.symbol || !row.changed_at) continue
    let entry = bySymbol.get(row.symbol)
    if (!entry) {
      if (results.length >= limit) break
      entry = {
        symbol: row.symbol,
        changed_at: row.changed_at,
        change_types: [],
        current_asset_sha256: publishStateBySymbol.get(row.symbol) || null,
      }
      bySymbol.set(row.symbol, entry)
      results.push(entry)
    }
    entry.changed_at =
      compareNullableTextAsc(entry.changed_at, row.changed_at) >= 0
        ? entry.changed_at
        : row.changed_at
    if (!entry.change_types.includes(row.change_type)) entry.change_types.push(row.change_type)
  }

  const nextCursor = results.length ? results[results.length - 1]?.changed_at || since : since
  return json({
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    since,
    next_cursor: nextCursor,
    changes: results,
  })
}

async function handlePublicMedia(request, env, symbol) {
  const url = new URL(request.url)
  const resolvedSymbol = normalizeSymbol(symbol)
  if (!resolvedSymbol) return json({ error: "Invalid symbol" }, 400)
  const portrait = await portraitState(env, resolvedSymbol, portraitBase(url, env))
  const media = publicMediaEnvelope(url, resolvedSymbol, portrait)
  if (!media) return json({ error: "Published media not found" }, 404)
  return json({
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    symbol: resolvedSymbol,
    media,
  })
}

async function handleSiteGeneDetail(request, env, path) {
  const url = new URL(request.url)
  const rawId = path.slice(`${SITE_GENE_API_PREFIX}/`.length)
  const resolved = await resolveGene(env, rawId)
  if (!resolved) return json({ error: "Gene not found" }, 404)
  const canonicalPath = `${SITE_GENE_API_PREFIX}/${encodeURIComponent(resolved.symbol)}`
  if (path !== canonicalPath) {
    return Response.redirect(`${url.origin}${canonicalPath}`, 302)
  }
  const payload = projectGeneRecord(
    await geneRecord(env, url, resolved.symbol),
    url.searchParams.get("fields"),
  )
  const etag = await etagFor(payload)
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders(),
        ETag: etag,
        "Cache-Control": "private, max-age=120",
      },
    })
  }
  return json(payload, 200, { ETag: etag, "Cache-Control": "private, max-age=120" })
}

async function listUserDiscoveredGeneSymbols(env, { userId, limit = 10000 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return []
  const cleanedLimit = Math.max(
    1,
    Math.min(10000, Number.parseInt(String(limit || "10000"), 10) || 10000),
  )
  const rows = await env.ICONOPLASM_DB.prepare(
    `SELECT d.gene_symbol
       FROM icono_gene_discoveries d
      WHERE d.user_id = ?
      ORDER BY d.first_discovered_at ASC, d.gene_symbol ASC
      LIMIT ?`,
  )
    .bind(userIdNorm, cleanedLimit)
    .all()
  return Array.from(
    new Set(
      (Array.isArray(rows?.results) ? rows.results : [])
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter(Boolean),
    ),
  )
}

async function handlePublicGeneSearch(request, env) {
  const url = new URL(request.url)
  const requestedScope = normalizePublicGeneSearchScope(url.searchParams.get("scope"))
  const rawQuery = normalizeSearchNeedle(url.searchParams.get("q") || "")
  const qUpper = rawQuery.toUpperCase()
  const qLower = rawQuery.toLowerCase()
  if (!rawQuery)
    return json(
      { genes: [], query: "", scope_applied: requestedScope },
      200,
      {
        "Cache-Control":
          requestedScope === "catalog" ? "public, max-age=30" : "no-store",
      },
    )
  await warmCatalogCache(env)
  const limit = Math.max(
    1,
    Math.min(100, Number.parseInt(url.searchParams.get("limit") || "20", 10)),
  )
  let appliedScope = requestedScope
  let candidateSymbols = []
  if (requestedScope === "discoveries") {
    const sessionUser = await iconoplasmSessionUser(request, env)
    if (sessionUser?.user_id) {
      candidateSymbols = await listUserDiscoveredGeneSymbols(env, { userId: sessionUser.user_id })
      if (!candidateSymbols.length) {
        await ensureStarterGeneDiscoveries(env, { userId: sessionUser.user_id })
        candidateSymbols = await listUserDiscoveredGeneSymbols(env, { userId: sessionUser.user_id })
      }
    } else {
      appliedScope = "starter"
      candidateSymbols = ICONOPLASM_STARTER_GENE_SYMBOLS.slice()
    }
  } else if (requestedScope === "starter") {
    candidateSymbols = ICONOPLASM_STARTER_GENE_SYMBOLS.slice()
  } else {
    candidateSymbols = Array.from(catalogCache.bySymbol.keys())
  }

  const matches = []
  for (const symbol of candidateSymbols) {
    const gene = catalogCache.bySymbol.get(symbol)
    if (!gene) continue
    const match = scorePublicGeneSearchMatch(qUpper, qLower, symbol, gene)
    if (!match) continue
    matches.push(publicGeneSearchEntry(url, env, symbol, gene, match))
  }

  matches.sort((left, right) => {
    return (
      Number(left.match_rank || 0) - Number(right.match_rank || 0) ||
      compareNullableTextAsc(left.symbol, right.symbol)
    )
  })

  const genes = matches.slice(0, limit)
  const cacheControl = requestedScope === "catalog" ? "public, max-age=30" : "no-store"
  return json(
    { genes, query: qUpper, scope_applied: appliedScope },
    200,
    { "Cache-Control": cacheControl },
  )
}

async function handlePublicGallery(request, env, ctx) {
  const url = new URL(request.url)
  const order = normalizeGalleryOrder(url.searchParams.get("order"))
  const edgeCacheable = request.method === "GET" && galleryCanUseEdgeCache(url)
  const cache = edgeCacheable ? caches.default : null
  const cacheKey = edgeCacheable ? await galleryEdgeCacheKey(url, env) : null
  if (cache && cacheKey) {
    const cached = await cache.match(cacheKey)
    if (cached) return cached
  }
  const payload = await galleryFeed(
    env,
    url,
    order,
    url.searchParams.get("limit"),
    url.searchParams.get("offset"),
    url.searchParams.get("seed"),
  )
  const cacheControl =
    order === "votes"
      ? "public, max-age=5, stale-while-revalidate=25"
      : "public, max-age=60, s-maxage=60"
  const response = json(payload, 200, { "Cache-Control": cacheControl })
  if (cache && cacheKey) ctx.waitUntil(cache.put(cacheKey, response.clone()))
  return response
}

export async function handleIconoplasmDbGatewayRequest(request, env, ctx = { waitUntil() {} }) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }
  if (isIconoplasmGatewayCanonRepairRequest(path, request.method)) {
    const payload = await parseJsonBody(request)
    return json(
      await repairCanonInvariants(env, {
        limit: payload?.limit,
        actorId: payload?.actorId,
        reason: payload?.reason,
      }),
      200,
      { "Cache-Control": "no-store" },
    )
  }
  if (!iconoplasmGatewayEligiblePath(path, request.method)) {
    return json({ error: "Not found" }, 404, { "Cache-Control": "no-store" })
  }

  if (path === publicApiPath("/metadata")) {
    return handlePublicMetadata(request, env)
  }
  if (path === publicApiPath("/catalog/manifest")) {
    return handlePublicCatalogManifest(request, env)
  }
  if (isPublicCatalogArtifactPath(path)) {
    return handlePublicCatalogArtifact(env, path)
  }
  if (path === publicApiPath("/gallery")) {
    return handlePublicGallery(request, env, ctx)
  }
  if (path === publicApiPath("/genes/search")) {
    return handlePublicGeneSearch(request, env)
  }
  if (path === publicApiPath("/genes/batch")) {
    return handlePublicGeneBatch(request, env)
  }
  if (path.startsWith(publicApiPath("/genes/"))) {
    const url = new URL(request.url)
    return json(publicRichRouteDeniedPayload(url, "gene_detail"), 403, { "Cache-Control": "no-store" })
  }
  if (path === publicApiPath("/resolve")) {
    return handlePublicResolve(request, env)
  }
  if (path === publicApiPath("/changes")) {
    return handlePublicChanges(request, env)
  }
  if (path.startsWith(publicApiPath("/media/"))) {
    const rawSymbol = path.slice(publicApiPath("/media/").length)
    return handlePublicMedia(request, env, rawSymbol)
  }
  if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) {
    return handleSiteGeneDetail(request, env, path)
  }
  if (path.startsWith("/api/iconoplasm/")) {
    const headers = new Headers(request.headers)
    headers.set(ICONOPLASM_GATEWAY_INTERNAL_HEADER, "1")
    const internalRequest = new Request(request, { headers })
    return handleIconoplasmGatewayRequest(internalRequest, env, ctx)
  }

  return json({ error: "Not found" }, 404, { "Cache-Control": "no-store" })
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
  const hash = String(m[1] || "").trim()
  // Cost barrier: this route is public and cacheable, so it must never do an ad
  // hoc whole-artifact hydration per cold isolate. Use the shared hydrated
  // artifact snapshot keyed by the portrait-aware build hash so immutable URLs
  // change whenever the canonical portrait changes.
  const hydrated = await hydratedCatalogArtifact(env, hash)
  if (!hydrated) return json({ error: "Artifact not found" }, 404)
  const responseBody = JSON.stringify(hydrated)
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
    `SELECT gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json
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
    const aliases = normalizeCatalogAliases(row?.aliases_json || [])
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
    if (aliases.length) entry.a = aliases
    genes.push(entry)
  }
  return genes
}

async function publishCatalogArtifact(env) {
  if (!env.KV) throw new Error("KV binding missing")
  const genes = await loadCatalogRowsForPublish(env)
  const artifact = {
    schema_version: 4,
    generated_at: new Date().toISOString(),
    gene_count: genes.length,
    genes,
  }
  // Publish-time is the one place where we intentionally rebuild the hydrated
  // artifact from source-of-truth rows. Every hot path should consume the
  // versioned shared result produced from here instead of re-doing this work.
  const hydrated = mergePublishedPortraitRefsIntoArtifact(
    artifact,
    await publishedPortraitRefs(env, { fresh: true }),
  )
  const artifactJson = JSON.stringify(hydrated)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(artifactJson))
  const hash = Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12)
  const filename = `catalog.${hash}.json`
  const catalogJsonl = `${hydrated.genes.map((gene) => JSON.stringify(gene)).join("\n")}\n`
  if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.put === "function") {
    // Keep dumps alongside portraits under a separate prefix so public sync clients
    // get a stable immutable snapshot without us needing a brand new bucket.
    await env.ICONOPLASM_PORTRAITS.put(publicCatalogJsonlDumpKey(hash), catalogJsonl, {
      httpMetadata: {
        contentType: "application/x-ndjson; charset=utf-8",
        cacheControl: "public, max-age=31536000, immutable",
      },
    })
  }
  const manifest = {
    current_hash: hash,
    filename,
    generated_at: hydrated.generated_at,
    schema_version: hydrated.schema_version,
    canonical_key: "symbol",
    gene_count: hydrated.gene_count,
    dumps: {
      catalog_jsonl_key: publicCatalogJsonlDumpKey(hash),
      catalog_jsonl_filename: publicCatalogJsonlFilename(hash),
    },
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
    catalog_jsonl_filename: publicCatalogJsonlFilename(hash),
  }
}

export async function handleIconoplasmGatewayRequest(request, env, ctx) {
  const started = Date.now()
  const url = new URL(request.url)
  const path = url.pathname
  const internalGatewayRequest = isIconoplasmGatewayInternalRequest(request)
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

    if (
      path.startsWith("/api/iconoplasm/") &&
      !internalGatewayRequest &&
      iconoplasmGatewayEligiblePath(path, request.method)
    ) {
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      return done(
        "iconoplasm_api_gateway",
        new Response(response.body, { status: response.status, headers: response.headers }),
      )
    }

    if (path === publicApiPath("/metadata")) {
      const rl = rateLimit(request, "public_metadata", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_metadata_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_metadata",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/schema")) {
      const rl = rateLimit(request, "public_schema", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_schema_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = handlePublicSchema()
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_schema",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/catalog/manifest")) {
      const rl = rateLimit(request, "public_catalog_manifest", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_catalog_manifest_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_catalog_manifest",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (isPublicCatalogArtifactPath(path)) {
      const rl = rateLimit(request, "public_catalog_artifact", 120)
      if (rl.retryAfterSeconds) {
        return done(
          "public_catalog_artifact_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_catalog_artifact",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path.startsWith(publicApiPath("/dumps/catalog.")) && path.endsWith(".jsonl")) {
      const rl = rateLimit(request, "public_catalog_dump", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_catalog_dump_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await handlePublicCatalogJsonlDump(env, path)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_catalog_dump",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/gallery")) {
      const rl = rateLimit(request, "public_gallery", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_gallery_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_gallery",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/genes/search")) {
      const rl = rateLimit(request, "public_gene_search", 120)
      if (rl.retryAfterSeconds) {
        return done(
          "public_gene_search_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_gene_search",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/genes/batch")) {
      if (!canAccessRichBatchRoute(request, env)) {
        return done(
          "public_gene_batch_denied",
          json(publicRichRouteDeniedPayload(url, "gene_batch"), 403),
          API_SCHEMA_VERSION,
        )
      }
      const rl = rateLimit(request, "public_gene_batch", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_gene_batch_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_gene_batch",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/resolve")) {
      const rl = rateLimit(request, "public_resolve", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_resolve_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_resolve",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/changes")) {
      const rl = rateLimit(request, "public_changes", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_changes_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_changes",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path.startsWith(publicApiPath("/media/"))) {
      const rl = rateLimit(request, "public_media", 120)
      if (rl.retryAfterSeconds) {
        return done(
          "public_media_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const rawSymbol = path.slice(publicApiPath("/media/").length)
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_media",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) {
      if (!hasTrustedIconoplasmBrowserOrigin(request) && !hasAdminToken(request, env)) {
        return done(
          "site_gene_denied",
          json(publicRichRouteDeniedPayload(url, "gene_detail"), 403),
          API_SCHEMA_VERSION,
        )
      }
      const rl = rateLimit(request, "site_gene", 120)
      if (rl.retryAfterSeconds) {
        return done(
          "site_gene_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToDbGateway(request, env)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "site_gene",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path.startsWith(publicApiPath("/genes/"))) {
      return done(
        "public_gene_denied",
        json(publicRichRouteDeniedPayload(url, "gene_detail"), 403),
        API_SCHEMA_VERSION,
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

    if (path === "/api/iconoplasm/discoveries/encounter" && request.method === "POST") {
      if (!env.ICONOPLASM_DB) {
        return done(
          "discoveries_encounter_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      }
      const payload = await parseJsonBody(request)
      const symbol = normalizeSymbol(payload?.symbol || payload?.gene_symbol || "")
      const source = normalizeDiscoverySource(payload?.source || DISCOVERY_SOURCE_EXTENSION_HOVER)
      const trigger = normalizeDiscoveryTrigger(payload?.trigger || DISCOVERY_TRIGGER_HOVER_DWELL)
      const dwellMs = normalizeDiscoveryDwellMs(payload?.dwell_ms ?? payload?.dwellMs)
      if (!symbol) {
        return done(
          "discoveries_encounter_400",
          json({ ok: false, error: "Missing or invalid gene symbol" }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }
      if (!source) {
        return done(
          "discoveries_encounter_400",
          json({ ok: false, error: "Missing or invalid discovery source" }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }
      if (!trigger) {
        return done(
          "discoveries_encounter_400",
          json({ ok: false, error: "Missing or invalid discovery trigger" }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }
      if (trigger === DISCOVERY_TRIGGER_HOVER_DWELL && dwellMs == null) {
        return done(
          "discoveries_encounter_400",
          json({ ok: false, error: "hover_dwell discovery events must include dwell_ms" }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }

      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "discoveries_encounter_guest",
          json(
            {
              ok: true,
              authenticated: false,
              recorded: false,
              symbol,
            },
            200,
            { "Cache-Control": "no-store" },
          ),
        )
      }

      const userId = normalizeUserId(sessionUser.user_id)
      // Cost fence: this hover-dwell route can fire at browser-hover cadence.
      // Starter seeding belongs on shelf/bootstrap endpoints like discoveries/me,
      // not here.

      const result = await recordGeneDiscoveryEncounter(env, {
        userId,
        geneSymbol: symbol,
        source,
        trigger,
        dwellMs,
      })
      if (!result.ok) {
        return done(
          "discoveries_encounter_400",
          json({ ok: false, error: String(result.error || "Could not record discovery") }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }

      return done(
        "discoveries_encounter",
        json(
          {
            ok: true,
            authenticated: true,
            recorded: true,
            created: Boolean(result.created),
            symbol,
            discovery: result.discovery,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/discoveries/me" && request.method === "GET") {
      if (!env.ICONOPLASM_DB) {
        return done(
          "discoveries_me_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      }
      const requestedOrder = normalizeIconoplasmHomeOrder(url.searchParams.get("order"), "newest")
      const requestedSeed =
        requestedOrder === "random"
          ? normalizeGallerySeed(url.searchParams.get("seed")) || crypto.randomUUID().slice(0, 12)
          : null
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "discoveries_me_guest",
          json(
            {
              ok: true,
              authenticated: false,
              user: null,
              order: requestedOrder,
              ...(requestedSeed ? { seed: requestedSeed } : {}),
              discoveries: [],
              discovered_symbols: [],
              discovered_count: 0,
            },
            200,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      const userId = normalizeUserId(sessionUser.user_id)
      const showAllRequested = normalizeBooleanQueryFlag(url.searchParams.get("show_all"))
      const showAllApplied = showAllRequested && (await isIconoplasmAdmin(request, env))
      if (!showAllApplied) {
        await ensureStarterGeneDiscoveries(env, { userId })
      }
      const discoveries = showAllApplied
        ? await listAllCatalogGeneDiscoveriesForAdmin(env, {
            userId,
            limit: 10000,
            order: requestedOrder,
            seed: requestedSeed,
          })
        : await listUserGeneDiscoveries(env, {
            userId,
            order: requestedOrder,
            seed: requestedSeed,
          })
      return done(
        "discoveries_me",
        json(
          {
            ok: true,
            authenticated: true,
            user: {
              id: userId,
              username: sessionUser.username || null,
            },
            order: requestedOrder,
            ...(requestedSeed ? { seed: requestedSeed } : {}),
            discoveries,
            show_all_requested: showAllRequested,
            show_all_applied: showAllApplied,
            discovered_symbols: discoveries.map((row) => row.gene_symbol).filter(Boolean),
            discovered_count: discoveries.length,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/discoveries/merge" && request.method === "POST") {
      if (!env.ICONOPLASM_DB) {
        return done(
          "discoveries_merge_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      }
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "discoveries_merge_401",
          json(
            { ok: false, code: "AUTH_REQUIRED", error: "Please log in first to merge guest discoveries." },
            401,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      const payload = await parseJsonBody(request)
      const result = await mergeGuestGeneDiscoveries(env, {
        userId: sessionUser.user_id,
        symbols: Array.isArray(payload?.symbols) ? payload.symbols : [],
      })
      if (!result.ok) {
        return done(
          "discoveries_merge_400",
          json({ ok: false, error: String(result.error || "Could not merge guest discoveries") }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }
      return done(
        "discoveries_merge",
        json(
          {
            ok: true,
            authenticated: true,
            merged_count: result.merged_count,
            discoveries: result.discoveries,
            discovered_symbols: result.discoveries.map((row) => row.gene_symbol).filter(Boolean),
            discovered_count: result.discoveries.length,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/me" && request.method === "GET") {
      const sessionUser = await iconoplasmSessionUser(request, env)
      const authenticated = !!sessionUser?.user_id
      const admin = authenticated ? await isIconoplasmAdmin(request, env) : false
      return done(
        "admin_me",
        json(
          {
            ok: true,
            authenticated,
            is_admin: admin,
            user: authenticated
              ? {
                  id: sessionUser.user_id,
                  username: sessionUser.username || null,
                }
              : null,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    const geneRequestMatch = path.match(/^\/api\/iconoplasm\/requests\/gene\/([^/]+)$/)
    if (geneRequestMatch && request.method === "GET") {
      if (!env.ICONOPLASM_DB)
        return done("gene_requests_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const symbol = normalizeSymbol(geneRequestMatch[1])
      if (!symbol) return done("gene_requests_400", json({ error: "Invalid symbol" }, 400))
      const sessionUser = await iconoplasmSessionUser(request, env)
      const userId = normalizeUserId(sessionUser?.user_id || "")
      const requestRows = await listOpenGenerationRequests(env, { limit: 500, geneSymbol: symbol })
      // Cost fence: logged-out visitors only need the queue summary + login CTA.
      // Do not burn a vision-rollup read for users who cannot submit a request yet.
      const requestOptions = sessionUser?.user_id ? await listGenerationRequestVisionOptions(env) : []
      const myRows = sessionUser?.user_id
        ? requestRows.filter((row) => row.requester_user_id === userId)
        : []
      return done(
        "gene_requests",
        json(
          {
            ok: true,
            authenticated: Boolean(sessionUser?.user_id),
            can_request: Boolean(sessionUser?.user_id),
            user: sessionUser?.user_id
              ? {
                  id: userId,
                  username: sessionUser.username || null,
                }
              : null,
            gene_symbol: symbol,
            request_options: requestOptions,
            my_open_requests: myRows,
            my_lane_summary: summarizeGenerationRequestRows(myRows, { requesterUserId: userId }),
            gene_lane_summary: summarizeGenerationRequestRows(requestRows, { requesterUserId: userId }),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/requests" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done("create_generation_request_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "create_generation_request_401",
          json({ ok: false, code: "AUTH_REQUIRED", error: "Please log in first to request new candidates." }, 401, {
            "Cache-Control": "no-store",
          }),
        )
      }
      let p
      try {
        p = await request.json()
      } catch {
        return done("create_generation_request_400", json({ error: "Invalid JSON" }, 400))
      }
      const result = await createGenerationRequest(env, {
        geneSymbol: p?.symbol || p?.gene_symbol || "",
        requesterUserId: sessionUser.user_id,
        requesterUsername: sessionUser.username || "",
        requestMode: p?.request_mode || p?.mode || "random",
        requestedVisionId: p?.requested_vision_id || p?.vision_id || "",
      })
      if (!result.ok) {
        return done(
          "create_generation_request_400",
          json({ ok: false, error: String(result.error || "Could not create request") }, 400, {
            "Cache-Control": "no-store",
          }),
        )
      }
      return done(
        "create_generation_request",
        json(
          {
            ok: true,
            request: result.request || null,
            message: "Request queued. The workstation will see it on the next refresh.",
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/requests/open" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_requests_open_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_requests_open_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      const limit = Math.max(
        1,
        Math.min(2000, Number.parseInt(url.searchParams.get("limit") || "500", 10) || 500),
      )
      const symbol = normalizeSymbol(url.searchParams.get("symbol") || "") || ""
      const rows = await listOpenGenerationRequests(env, { limit, geneSymbol: symbol })
      return done(
        "admin_requests_open",
        json(
          {
            ok: true,
            count: rows.length,
            rows,
            lane_summary: summarizeGenerationRequestRows(rows),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/requests/fulfill" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_requests_fulfill_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_requests_fulfill_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let p = {}
      try {
        p = await request.json()
      } catch {
        return done("admin_requests_fulfill_400", json({ error: "Invalid JSON" }, 400))
      }
      const result = await fulfillGenerationRequests(env, {
        items: Array.isArray(p?.items) ? p.items : [],
        resolvedBy: await actor(request, env),
      })
      return done(
        "admin_requests_fulfill",
        json(result, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === "/api/iconoplasm/votes/set" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done("votes_set_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "votes_set_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
        )
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
      const assetCandidateRef = voteAssetIdentity(symbol, assetSha)
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
      const coordinatorWrite = await iconoplasmVoteCoordinatorSetVote(env, {
        symbol,
        assetSha256: assetSha,
        visionId,
        candidateImageId,
        userId,
        requestedVoteValue: requested,
      })
      if (!coordinatorWrite?.ok) {
        return done("votes_set_502", json({ error: "Vote coordinator write failed" }, 502))
      }
      // Order matters:
      // 1. write the live vote to the per-symbol coordinator,
      // 2. project that settled state into D1 compatibility tables,
      // 3. refresh read models from coordinator summaries.
      // Do not reintroduce a "look at all historical vote rows, then decide"
      // step here. That old design made one public vote pay for the entire past.
      await projectVoteCoordinatorLedgerRow(env, {
        symbol,
        assetSha256: assetSha,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      await appendVoteEvent(env, {
        symbol,
        assetSha256: assetSha,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateRef: assetCandidateRef,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      const assetSummaries = Array.isArray(coordinatorWrite?.asset_summaries)
        ? coordinatorWrite.asset_summaries
        : []
      const autoPromote = await autoPromoteTopVotedPortraitFromCoordinatorState(env, {
        symbol,
        actorId: userId,
        reason: "vote_auto_promote",
        assetSummaries,
      })
      await refreshProjectedVoteReadModelsFromCoordinatorState(env, { symbol, assetSummaries })
      const snapshot =
        coordinatorWrite.snapshot ||
        (await iconoVoteSnapshot(env, {
          candidateRef: assetCandidateRef,
          symbol,
          assetSha256: assetSha,
          visionId: coordinatorWrite.resolved_vision_id,
          userId,
        }))
      return done(
        "votes_set",
        json(
          {
            ok: true,
            candidate_ref: assetCandidateRef,
            symbol,
            asset_sha256: assetSha,
            candidate_image_id: coordinatorWrite.candidate_image_id,
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
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "votes_snapshot_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
        )
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
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "admin_votes_import_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
        )
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

      let invalid = 0
      const groups = new Map()
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
        const assetCandidateRef = voteAssetIdentity(symbol, assetSha)
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
        const group = groups.get(symbol) || []
        group.push({
          candidate_ref: assetCandidateRef,
          symbol,
          asset_sha256: assetSha,
          vision_id: visionId,
          candidate_image_id: candidateImageId,
          user_id: userId,
          vote_value: voteValue,
        })
        groups.set(symbol, group)
      }

      let upserted = 0
      let deleted = 0
      let autoPromoted = 0
      for (const [symbol, groupItems] of groups.entries()) {
        const coordinatorImport = await iconoplasmVoteCoordinatorImportVotes(env, {
          symbol,
          items: groupItems,
        })
        if (!coordinatorImport?.ok) {
          return done(
            "admin_votes_import_502",
            json({ error: `Vote coordinator import failed for ${symbol}` }, 502),
          )
        }
        upserted += Math.max(0, Number(coordinatorImport?.upserted || 0) || 0)
        deleted += Math.max(0, Number(coordinatorImport?.deleted || 0) || 0)
        invalid += Math.max(0, Number(coordinatorImport?.invalid || 0) || 0)
        for (const row of Array.isArray(coordinatorImport?.results) ? coordinatorImport.results : []) {
          await projectVoteCoordinatorLedgerRow(env, {
            symbol,
            assetSha256: row?.asset_sha256,
            visionId: row?.vision_id,
            candidateImageId: row?.candidate_image_id,
            userId: row?.user_id,
            voteValue: row?.final_vote_value,
          })
          await appendVoteEvent(env, {
            symbol,
            assetSha256: row?.asset_sha256,
            visionId: row?.vision_id,
            candidateRef: row?.candidate_ref,
            candidateImageId: row?.candidate_image_id,
            userId: row?.user_id,
            voteValue: row?.final_vote_value,
          })
        }
        const assetSummaries = Array.isArray(coordinatorImport?.asset_summaries)
          ? coordinatorImport.asset_summaries
          : []
        const result = await autoPromoteTopVotedPortraitFromCoordinatorState(env, {
          symbol,
          actorId: "admin_import",
          reason: "vote_import_auto_promote",
          assetSummaries,
        })
        if (result?.changed) autoPromoted += 1
        await refreshProjectedVoteReadModelsFromCoordinatorState(env, {
          symbol,
          assetSummaries,
        })
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
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "admin_votes_set_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_votes_set_400", json({ error: "Invalid JSON" }, 400))
      }

      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      const assetSha = normalizeSha256(p?.asset_sha256 || p?.sha256 || "")
      const candidateImageId = optionalInt(p?.candidate_image_id ?? p?.emulsion_id)
      const candidateRef = normalizeCandidateRef(
        p?.candidate_ref || (p?.candidate_image_id ? `c:${String(p.candidate_image_id)}` : ""),
        symbol,
        assetSha,
      )
      const assetCandidateRef = voteAssetIdentity(symbol, assetSha)
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

      const coordinatorWrite = await iconoplasmVoteCoordinatorSetVote(env, {
        symbol,
        assetSha256: assetSha,
        visionId,
        candidateImageId,
        userId,
        requestedVoteValue: requested,
      })
      if (!coordinatorWrite?.ok) {
        return done("admin_votes_set_502", json({ error: "Vote coordinator write failed" }, 502))
      }
      // Keep admin writes on the same architecture as public writes. If the
      // admin route starts reading the raw vote ledger inline again, somebody
      // will eventually cargo-cult that pattern back into public traffic.
      await projectVoteCoordinatorLedgerRow(env, {
        symbol,
        assetSha256: assetSha,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      await appendVoteEvent(env, {
        symbol,
        assetSha256: assetSha,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateRef: assetCandidateRef,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      const assetSummaries = Array.isArray(coordinatorWrite?.asset_summaries)
        ? coordinatorWrite.asset_summaries
        : []
      const autoPromote = await autoPromoteTopVotedPortraitFromCoordinatorState(env, {
        symbol,
        actorId: userId,
        reason: "admin_vote_auto_promote",
        assetSummaries,
      })
      await refreshProjectedVoteReadModelsFromCoordinatorState(env, { symbol, assetSummaries })
      const snapshot =
        coordinatorWrite.snapshot ||
        (await iconoVoteSnapshot(env, {
          candidateRef: assetCandidateRef,
          symbol,
          assetSha256: assetSha,
          visionId: coordinatorWrite.resolved_vision_id,
          userId,
        }))
      return done(
        "admin_votes_set",
        json(
          {
            ok: true,
            candidate_ref: assetCandidateRef,
            symbol,
            asset_sha256: assetSha,
            candidate_image_id: coordinatorWrite.candidate_image_id,
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
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "admin_votes_snapshot_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
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
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "admin_votes_snapshots_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
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

    if (path === "/api/iconoplasm/admin/votes/ledger" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_ledger_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_votes_ledger_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const limit = Math.max(
        1,
        Math.min(5000, Number.parseInt(url.searchParams.get("limit") || "2000", 10) || 2000),
      )
      const afterUpdatedAt = String(url.searchParams.get("after_updated_at") || "").trim()
      const afterGeneSymbol = normalizeSymbol(url.searchParams.get("after_gene_symbol") || "") || ""
      const afterAssetSha = normalizeSha256(url.searchParams.get("after_asset_sha256") || "") || ""
      const afterUserId = normalizeUserId(url.searchParams.get("after_user_id") || "")

      const rowsResult = await env.ICONOPLASM_DB.prepare(
        `SELECT
           candidate_ref,
           gene_symbol,
           asset_sha256,
           vision_id,
           candidate_image_id,
           user_id,
           vote_value,
           updated_at
         FROM icono_image_votes
         WHERE (
           ? = ''
           OR updated_at > ?
           OR (
             updated_at = ?
             AND (
               upper(gene_symbol) > ?
               OR (
                 upper(gene_symbol) = ?
                 AND (
                   lower(asset_sha256) > ?
                   OR (
                     lower(asset_sha256) = ?
                     AND user_id > ?
                   )
                 )
               )
             )
           )
         )
         ORDER BY updated_at ASC, upper(gene_symbol) ASC, lower(asset_sha256) ASC, user_id ASC
         LIMIT ?`,
      )
        .bind(
          afterUpdatedAt,
          afterUpdatedAt,
          afterUpdatedAt,
          afterGeneSymbol,
          afterGeneSymbol,
          afterAssetSha,
          afterAssetSha,
          afterUserId,
          limit,
        )
        .all()
      const rows = Array.isArray(rowsResult?.results) ? rowsResult.results : []
      const last = rows.length > 0 ? rows[rows.length - 1] : null
      const maxEventRow = await env.ICONOPLASM_DB.prepare(
        "SELECT COALESCE(MAX(id), 0) AS max_event_id FROM icono_vote_events",
      ).first()
      return done(
        "admin_votes_ledger",
        json(
          {
            ok: true,
            count: rows.length,
            rows,
            next_cursor: last
              ? {
                  updated_at: String(last.updated_at || ""),
                  gene_symbol: String(last.gene_symbol || ""),
                  asset_sha256: String(last.asset_sha256 || ""),
                  user_id: String(last.user_id || ""),
                }
              : null,
            max_event_id: Number(maxEventRow?.max_event_id || 0),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/votes/events" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_votes_events_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_votes_events_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))

      const afterId = Math.max(0, Number.parseInt(url.searchParams.get("after_id") || "0", 10) || 0)
      const limit = Math.max(
        1,
        Math.min(5000, Number.parseInt(url.searchParams.get("limit") || "2000", 10) || 2000),
      )
      const rowsResult = await env.ICONOPLASM_DB.prepare(
        `SELECT
           id,
           candidate_ref,
           gene_symbol,
           asset_sha256,
           vision_id,
           candidate_image_id,
           user_id,
           vote_value,
           created_at
         FROM icono_vote_events
         WHERE id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
        .bind(afterId, limit)
        .all()
      const rows = Array.isArray(rowsResult?.results) ? rowsResult.results : []
      const nextAfterId = rows.length > 0 ? Number(rows[rows.length - 1]?.id || afterId) : afterId
      return done(
        "admin_votes_events",
        json(
          {
            ok: true,
            count: rows.length,
            rows,
            next_after_id: nextAfterId,
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
        return done("admin_votes_vision_detail_404", json({ error: "Vision not found" }, 404))
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

    if (path === "/api/iconoplasm/artist-blacklist-submissions" && request.method === "POST") {
      const adminSubmitter = await isIconoplasmAdmin(request, env)
      const rl = adminSubmitter
        ? { retryAfterSeconds: null, headers: {} }
        : rateLimit(request, "artist_blacklist_submission", 5)
      if (rl.retryAfterSeconds !== null) {
        return done(
          "artist_blacklist_submission_429",
          json(
            { error: "Too many submissions. Try again in a minute." },
            429,
            { "Cache-Control": "no-store", ...rl.headers },
          ),
        )
      }
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_blacklist_submission_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500, { ...rl.headers }),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Invalid JSON" }, 400, { ...rl.headers }),
        )
      }

      const honeypot = sanitizeText(p?.website || "", 255) || ""
      if (honeypot) {
        return done(
          "artist_blacklist_submission_bot",
          json(
            { ok: true, queued: false, ignored: true },
            200,
            { "Cache-Control": "no-store", ...rl.headers },
          ),
        )
      }

      const artistNameInput = normalizeArtistBlacklistSubmissionInput(
        p?.artist_name_input || p?.artistNameInput || p?.artist_input || "",
      )
      if (!artistNameInput) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Missing artist tag" }, 400, { ...rl.headers }),
        )
      }
      if (/\s/.test(artistNameInput)) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Artist tags cannot contain spaces. Example: @artist_(name)" }, 400, { ...rl.headers }),
        )
      }
      const artistTagInput = normalizeArtistTag(artistNameInput)
      if (!artistTagInput || artistTagInput !== artistNameInput) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Use the exact artist tag. Example: @artist_(name)" }, 400, { ...rl.headers }),
        )
      }

      const turnstile = await verifyTurnstileSubmission(
        env,
        request,
        p?.turnstile_token || p?.turnstileToken || p?.cf_turnstile_response || "",
      )
      if (turnstile.configured && !turnstile.passed) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Please complete the bot check and try again." }, 400, { ...rl.headers }),
        )
      }

      const requesterId = adminSubmitter
        ? "admin_artist_blacklist"
        : await buildArtistBlacklistRequesterId(request)
      const result = await queueArtistBlacklistSubmission(env, {
        artistNameInput: artistTagInput,
        requestedBy: requesterId,
        source: adminSubmitter ? "admin_form" : "public_form",
        turnstilePassed: turnstile.passed,
        enforceRequesterLock: !adminSubmitter,
      })
      if (!result) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Could not queue blacklist request." }, 400, { ...rl.headers }),
        )
      }
      if (result.requesterLocked) {
        return done(
          "artist_blacklist_submission_repeat",
          json(
            {
              ok: true,
              queued: false,
              accepted: false,
              ignored: true,
              requesterLocked: true,
              request: result.request,
            },
            200,
            { "Cache-Control": "no-store", ...rl.headers },
          ),
        )
      }
      return done(
        "artist_blacklist_submission",
        json(
          {
            ok: true,
            queued: Boolean(result.queued),
            duplicate: Boolean(result.duplicate),
            accepted: Boolean(result.queued),
            ignored: Boolean(result.duplicate),
            requesterLocked: Boolean(result.requesterLocked),
            request: result.request,
          },
          200,
          { "Cache-Control": "no-store", ...rl.headers },
        ),
      )
    }

    if (path === "/artist-styles" || path === "/artist-styles/" || path === "/blocklist/") {
      const redirectUrl = new URL("/blocklist", url)
      redirectUrl.search = url.search
      return done(
        "blocklist_redirect",
        Response.redirect(redirectUrl.toString(), 308),
      )
    }

    if (path === "/blocklist") {
      const artistStylesHtml = normalizeArtistStylesPageHtml(
        renderIconoplasmArtistStylesHtml({
          turnstileSiteKey: sanitizeText(env.ICONOPLASM_TURNSTILE_SITE_KEY || "", 255) || "",
        }),
      )
      return done(
        "blocklist_page",
        html(artistStylesHtml, 200, { "Cache-Control": "no-store" }),
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
          json({ error: String(error?.message || error || "Artist tag blocklist update failed") }, 400),
        )
      }
    }

    if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/pending" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done(
          "artist_blacklist_submissions_pending_403",
          json({ error: "Unauthorized" }, 403),
        )
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_blacklist_submissions_pending_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const limit = Math.max(
        1,
        Math.min(1000, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200),
      )
      const requests = await listPendingArtistBlacklistSubmissions(env, { limit })
      return done(
        "artist_blacklist_submissions_pending",
        json(
          {
            ok: true,
            count: requests.length,
            requests,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/ack" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done(
          "artist_blacklist_submissions_ack_403",
          json({ error: "Unauthorized" }, 403),
        )
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_blacklist_submissions_ack_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done(
          "artist_blacklist_submissions_ack_400",
          json({ error: "Invalid JSON" }, 400),
        )
      }
      const actorId = await actor(request, env)
      const resolved = await resolveArtistBlacklistSubmissions(env, {
        results: Array.isArray(p?.results) ? p.results : [],
        resolvedBy: actorId,
      })
      return done(
        "artist_blacklist_submissions_ack",
        json(
          {
            ok: true,
            resolved: resolved.resolved,
            requests: resolved.requests,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/read-models/sync" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_read_models_sync_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_read_models_sync_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p = {}
      try {
        p = await request.json()
      } catch {
        return done("admin_read_models_sync_400", json({ error: "Invalid JSON" }, 400))
      }

      const rawSymbols = Array.isArray(p?.symbols) ? p.symbols : []
      const rawVisionIds = Array.isArray(p?.vision_ids ?? p?.visionIds)
        ? p.vision_ids ?? p.visionIds
        : []
      if (rawSymbols.length > ADMIN_READ_MODEL_SYNC_REQUEST_SYMBOL_MAX)
        return done(
          "admin_read_models_sync_400",
          json(
            {
              error: `Too many symbols (max ${ADMIN_READ_MODEL_SYNC_REQUEST_SYMBOL_MAX})`,
            },
            400,
          ),
        )
      if (rawVisionIds.length > ADMIN_READ_MODEL_SYNC_REQUEST_VISION_MAX)
        return done(
          "admin_read_models_sync_400",
          json(
            {
              error: `Too many vision_ids (max ${ADMIN_READ_MODEL_SYNC_REQUEST_VISION_MAX})`,
            },
            400,
          ),
        )

      const symbols = Array.from(
        new Set(rawSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
      )
      const visionIds = Array.from(
        new Set(rawVisionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean)),
      )
      const fullVision = coerceBoolean(p?.full_vision ?? p?.fullVision, false)
      const fullRebuild = coerceBoolean(p?.full_rebuild ?? p?.fullRebuild, false)
      const skipVoteSummaries = coerceBoolean(
        p?.skip_vote_summaries ?? p?.skipVoteSummaries,
        false,
      )
      const skipGeneRollups = coerceBoolean(
        p?.skip_gene_rollups ?? p?.skipGeneRollups,
        false,
      )
      const skipVisionRollups = coerceBoolean(
        p?.skip_vision_rollups ?? p?.skipVisionRollups,
        false,
      )
      const skipDashboard = coerceBoolean(
        p?.skip_dashboard ?? p?.skipDashboard,
        false,
      )
      const invalidateGallery = coerceBoolean(
        p?.invalidate_gallery ?? p?.invalidateGallery,
        true,
      )

      // Bulk workstation sync now pushes the slow derived read-model refresh
      // into this dedicated endpoint after reconcile chunks land. That keeps a
      // fail-slow read-model rebuild from masquerading as one giant reconcile.
      const result = invalidateGallery
        ? await syncAdminReadModelsAndInvalidateGallery(env, {
            symbols,
            visionIds,
            fullVision,
            fullRebuild,
            skipVoteSummaries,
            skipGeneRollups,
            skipVisionRollups,
            skipDashboard,
          })
        : await syncAdminReadModels(env, {
            symbols,
            visionIds,
            fullVision,
            fullRebuild,
            skipVoteSummaries,
            skipGeneRollups,
            skipVisionRollups,
            skipDashboard,
          })

      return done(
        "admin_read_models_sync",
        json(
          {
            ok: true,
            symbols: Number(result?.symbols || 0),
            visions: Number(result?.visions || 0),
            invalidate_gallery: invalidateGallery,
            full_vision: fullVision,
            full_rebuild: fullRebuild,
            skip_vote_summaries: skipVoteSummaries,
            skip_gene_rollups: skipGeneRollups,
            skip_vision_rollups: skipVisionRollups,
            skip_dashboard: skipDashboard,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
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
          return done("admin_read_models_bootstrap_400", json({ error: "Invalid JSON" }, 400))
        }

        const reset = coerceBoolean(p?.reset ?? p?.restart, false)
        const steps = normalizeAdminReadModelBootstrapSteps(p?.steps)
        const symbolBatch = normalizeAdminReadModelSymbolBatch(p?.symbol_batch ?? p?.symbolBatch)
        const visionBatch = normalizeAdminReadModelVisionBatch(p?.vision_batch ?? p?.visionBatch)

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
            if (
              !latest?.advanced ||
              latest?.state?.status === ADMIN_READ_MODEL_BOOTSTRAP_STATUS_COMPLETE
            )
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

      return done("admin_read_models_bootstrap_405", json({ error: "Method not allowed" }, 405))
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
           pa.candidate_image_id,
           pa.vision_id,
           pa.emulsion_id,
           pa.artist_tag,
           pa.artist_name,
           pa.status,
           COALESCE(pa.is_stale, 0) AS is_stale,
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
          candidate_image_id: optionalInt(row?.candidate_image_id),
          vision_id: sanitizeText(row?.vision_id || "", 255) || "",
          emulsion_id: sanitizeText(row?.emulsion_id || "", 64) || "",
          workflow_id: sanitizeText(row?.workflow_id || "", 32) || "",
          workflow_label: sanitizeText(row?.workflow_label || "", 255) || "",
          workflow_path: sanitizeText(row?.workflow_path || "", 512) || "",
          prompt_version: sanitizeText(row?.prompt_version || "", 16) || "",
          variant_slot: sanitizeText(row?.variant_slot || "", 32) || "",
          artist_tag: normalizeArtistTag(row?.artist_tag || "") || "",
          artist_name: sanitizeText(row?.artist_name || "", 255) || "",
          status: normalizeAssetStatus(row?.status || "", "draft"),
          is_stale: Number(row?.is_stale || 0) > 0,
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

    if (path === "/api/iconoplasm/admin/local-removals/pending" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_local_removals_pending_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_local_removals_pending_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const limit = Math.max(
        1,
        Math.min(1000, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200),
      )
      const requests = await listPendingLocalRemovalRequests(env, { limit })
      return done(
        "admin_local_removals_pending",
        json(
          {
            ok: true,
            count: requests.length,
            requests,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/local-removals/ack" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_local_removals_ack_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_local_removals_ack_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_local_removals_ack_400", json({ error: "Invalid JSON" }, 400))
      }
      const actorId = await actor(request, env)
      const resolved = await resolveLocalRemovalRequests(env, {
        results: Array.isArray(p?.results) ? p.results : [],
        resolvedBy: actorId,
      })
      return done(
        "admin_local_removals_ack",
        json(
          {
            ok: true,
            resolved: Number(resolved?.resolved || 0),
            requests: Array.isArray(resolved?.requests) ? resolved.requests : [],
          },
          200,
          { "Cache-Control": "no-store" },
        ),
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
      const deferReadModels = coerceBoolean(
        p?.defer_read_models ?? p?.deferReadModels,
        false,
      )
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
             gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json, source, updated_by, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(gene_symbol) DO UPDATE SET
             full_name=excluded.full_name,
             uniprot=excluded.uniprot,
             color_hex=excluded.color_hex,
             tmh=excluded.tmh,
             aliases_json=excluded.aliases_json,
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
            item.aliases_json || "[]",
            source,
            actorId,
          )
          .run()
        processed += 1
        results.push({ ok: true, symbol: item.gene_symbol })
      }

      if (processed > 0 && !deferReadModels) {
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
            defer_read_models: deferReadModels,
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
      const deferReadModels = coerceBoolean(
        p?.defer_read_models ?? p?.deferReadModels,
        false,
      )
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

      if (toDelete.length > 0 && !deferReadModels) {
        await syncAdminReadModels(env, { symbols: toDelete })
      }

      return done(
        "admin_catalog_reconcile",
        json(
          {
            ok: true,
            kept: keepSymbols.size,
            deleted: toDelete.length,
            defer_read_models: deferReadModels,
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
      const deferReadModels = Boolean(p?.defer_read_models)
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

      if (processed > 0 && !deferReadModels) {
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
            defer_read_models: deferReadModels,
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
      const deferReadModels = coerceBoolean(
        p?.defer_read_models ?? p?.deferReadModels,
        false,
      )
      const reasonDefault = String(p?.reason || "").slice(0, 2000) || null
      const createdByDefault = String(p?.created_by || p?.createdBy || actorId || "unknown").slice(
        0,
        255,
      )
      const base = portraitBase(url, env)
      const prefetchedExistingAssets = await iconoExistingAssetsBatch(env, itemsRaw)
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
          const workflowPath =
            sanitizeText(item?.workflow_path || existingAsset?.workflow_path || "", 512) || null
          const workflowLabel =
            sanitizeText(
              item?.workflow_label ||
                existingAsset?.workflow_label ||
                workflowLabelFromPath(workflowPath || ""),
              255,
            ) || null
          const workflowId =
            sanitizeText(
              item?.workflow_id ||
                existingAsset?.workflow_id ||
                workflowIdentityFromPath(workflowPath || workflowLabel || ""),
              32,
            ) || null
          const promptVersion =
            sanitizeText(
              item?.prompt_version ||
                existingAsset?.prompt_version ||
                promptVersionFromVisionId(visionId || ""),
              16,
            ) || null
          const variantSlot =
            sanitizeText(
              item?.variant_slot ||
                existingAsset?.variant_slot ||
                variantSlotFromVisionId(visionId || ""),
              32,
            ) || null
          const emulsionId =
            sanitizeText(
              item?.emulsion_id ||
                existingAsset?.emulsion_id ||
                (workflowId && promptVersion && variantSlot
                  ? `${workflowId}${promptVersion}-${variantSlot}`
                  : ""),
              64,
            ) || null
          const candidateImageId =
            optionalInt(
              item?.candidate_image_id ?? item?.emulsion_id ?? existingAsset?.candidate_image_id,
            ) || null
          const artistTag = null
          const artistName = null
          const blacklisted = false
          const width = optionalInt(item?.width ?? fullPayload?.width)
          const height = optionalInt(item?.height ?? fullPayload?.height)
          const bytes = optionalInt(item?.bytes ?? fullPayload?.bytes ?? fullBytes?.byteLength)
          // Chesterton's fence: the workstation may tell us a candidate is stale,
          // but it does not get to disqualify website canon. Auto-pick
          // eligibility is website-owned policy: reject / blacklist paths can
          // force it off, while routine workstation sync should not.
          const existingStatus = normalizeAssetStatus(existingAsset?.status || "", "draft")
          const isStaleRequested = item?.is_stale ?? item?.isStale
          const isStale =
            isStaleRequested === undefined || isStaleRequested === null
              ? coerceBoolean(existingAsset?.is_stale, false)
              : coerceBoolean(isStaleRequested, false)
          const autopickEligibleRequested = item?.autopick_eligible ?? item?.autopickEligible
          const autopickEligibleBase =
            autopickEligibleRequested === undefined || autopickEligibleRequested === null
              ? true
              : coerceBoolean(autopickEligibleRequested, true)
          const autopickEligible = blacklisted ? false : autopickEligibleBase
          let finalStatus = statusRequested
          if (
            finalStatus === "draft" &&
            (existingStatus === "approved" || existingStatus === "rejected")
          ) {
            finalStatus = existingStatus
          }
          if (blacklisted) finalStatus = "rejected"
          const persistedAutopickEligible = finalStatus === "rejected" ? false : autopickEligible
          const persistedIsStale = finalStatus === "rejected" ? false : isStale

          if (!dryRun) {
            await env.ICONOPLASM_DB.prepare(
              `INSERT INTO icono_portrait_assets (
                 gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
                 mime, width, height, bytes, status, autopick_eligible, is_stale, is_legacy,
                 vision_id, emulsion_id, workflow_id, workflow_label, workflow_path, prompt_version, variant_slot,
                 candidate_image_id, artist_tag, artist_name, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
                 is_stale=excluded.is_stale,
                 is_legacy=0,
                 vision_id=COALESCE(excluded.vision_id, icono_portrait_assets.vision_id),
                 emulsion_id=COALESCE(excluded.emulsion_id, icono_portrait_assets.emulsion_id),
                 workflow_id=COALESCE(excluded.workflow_id, icono_portrait_assets.workflow_id),
                 workflow_label=COALESCE(excluded.workflow_label, icono_portrait_assets.workflow_label),
                 workflow_path=COALESCE(excluded.workflow_path, icono_portrait_assets.workflow_path),
                 prompt_version=COALESCE(excluded.prompt_version, icono_portrait_assets.prompt_version),
                 variant_slot=COALESCE(excluded.variant_slot, icono_portrait_assets.variant_slot),
                 candidate_image_id=COALESCE(excluded.candidate_image_id, icono_portrait_assets.candidate_image_id),
                  artist_tag=NULL,
                  artist_name=NULL,
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
                persistedAutopickEligible ? 1 : 0,
                persistedIsStale ? 1 : 0,
                visionId,
                emulsionId,
                workflowId,
                workflowLabel,
                workflowPath,
                promptVersion,
                variantSlot,
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
              emulsion_id: emulsionId,
              workflow_id: workflowId,
              workflow_label: workflowLabel,
              prompt_version: promptVersion,
              variant_slot: variantSlot,
              artist_tag: artistTag,
              artist_name: artistName,
              status: finalStatus,
              autopick_eligible: persistedAutopickEligible,
              is_stale: persistedIsStale,
              uploads,
              publish: "site_managed",
              blacklisted,
              blacklist_reason: null,
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

      if (!dryRun && processed > 0 && !deferReadModels) {
        // Bulk workstation sync already runs reconcile immediately after ingest.
        // Rebuilding admin read models and invalidating gallery caches on every
        // ingest batch turned one sync into hundreds of global refreshes. Keep
        // the eager behavior for direct admin calls, but let the sync defer the
        // expensive refresh until reconcile has the full touched-symbol set.
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
            defer_read_models: deferReadModels,
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
      const scopeSymbolsRaw = Array.isArray(p?.scope_symbols ?? p?.scopeSymbols)
        ? p.scope_symbols ?? p.scopeSymbols
        : []
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
      if (scopeSymbolsRaw.length > 5000)
        return done(
          "admin_reconcile_400",
          json({ error: "Too many scope_symbols entries (max 5000)" }, 400),
        )

      const scopeSymbols = Array.from(
        new Set(scopeSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean)),
      )
      const scopeSymbolsJson = JSON.stringify(scopeSymbols)
      const applyScope = scopeSymbols.length > 0 ? 1 : 0

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
      const deferReadModels = coerceBoolean(
        p?.defer_read_models ?? p?.deferReadModels,
        false,
      )
      const unpublishMissing = coerceBoolean(p?.unpublish_missing ?? p?.unpublishMissing, false)
      const actorId = await actor(request, env)
      const reason = String(p?.reason || "").slice(0, 2000) || "local_sync_reconcile"

      const { results: existingAssets = [] } = await env.ICONOPLASM_DB.prepare(
        `WITH incoming_scope AS (
           SELECT upper(value) AS gene_symbol
           FROM json_each(?)
         )
         SELECT gene_symbol, asset_sha256, status, COALESCE(is_stale, 0) AS is_stale, COALESCE(is_legacy, 0) AS is_legacy
         FROM icono_portrait_assets
         WHERE (? = 0 OR upper(gene_symbol) IN (SELECT gene_symbol FROM incoming_scope))`,
      )
        .bind(scopeSymbolsJson, applyScope)
        .all()

      const { results: existingStateRows = [] } = await env.ICONOPLASM_DB.prepare(
        `WITH incoming_scope AS (
           SELECT upper(value) AS gene_symbol
           FROM json_each(?)
         )
         SELECT gene_symbol, current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
         FROM icono_publish_state
         WHERE (? = 0 OR upper(gene_symbol) IN (SELECT gene_symbol FROM incoming_scope))`,
      )
        .bind(scopeSymbolsJson, applyScope)
        .all()
      const existingState = new Map()
      for (const row of existingStateRows) {
        const symbol = normalizeSymbol(row?.gene_symbol || "")
        if (!symbol) continue
        existingState.set(symbol, {
          current_asset_sha256: normalizeSha256(row?.current_asset_sha256 || "") || null,
          admin_override: Number(row?.admin_override || 0) > 0,
        })
      }
      const touchedSymbols = new Set(scopeSymbols.length ? scopeSymbols : keep.map((row) => row.symbol))

      let rejected = 0
      let restoredKeep = 0
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
        if (keepSet.has(key)) {
          const status = String(row?.status || "").toLowerCase()
          const restoreRejectedKeep =
            status === "rejected" || Number(row?.is_stale || 0) > 0 || Number(row?.is_legacy || 0) > 0
          if (!restoreRejectedKeep) continue
          touchedSymbols.add(symbol)
          restoredKeep += 1
          if (dryRun) continue
          // The workstation keep-set is the durable source of truth for which
          // candidates still exist locally. If a keep-item was previously
          // rejected by an old reconcile bug, leaving it rejected here makes
          // every later GUI sync look successful while the public site stays
          // quietly wrong. Restore these keep-items to ordinary sync-visible
          // state; operators who want a candidate gone permanently must queue a
          // local removal so it stops appearing in keep altogether.
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_portrait_assets SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END, autopick_eligible=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 1 ELSE COALESCE(autopick_eligible, 1) END, is_stale=0, is_legacy=0 WHERE upper(gene_symbol)=? AND asset_sha256=?",
          )
            .bind(symbol, assetSha)
            .run()
          await env.ICONOPLASM_DB.prepare(
            "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'restore_keep', ?, ?, CURRENT_TIMESTAMP)",
          )
            .bind(symbol, assetSha, assetSha, actorId, reason)
            .run()
          continue
        }
        if (legacySet.has(key)) {
          touchedSymbols.add(symbol)
          const alreadyLegacy =
            Number(row?.is_stale || 0) > 0 &&
            Number(row?.is_legacy || 0) > 0 &&
            String(row?.status || "").toLowerCase() !== "rejected"
          if (alreadyLegacy) {
            legacyAlreadyMarked += 1
            continue
          }
          legacyMarked += 1
          if (dryRun) continue
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_portrait_assets SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END, is_stale=1, is_legacy=1 WHERE upper(gene_symbol)=? AND asset_sha256=?",
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

      if (!dryRun && !deferReadModels)
        await syncAdminReadModelsAndInvalidateGallery(env, {
          symbols: Array.from(touchedSymbols),
        })
      return done(
        "admin_reconcile",
        json(
          {
            ok: true,
            dry_run: dryRun,
            scoped_symbols: scopeSymbols.length,
            keep_count: keep.length,
            legacy_count: legacy.length,
            touched_symbols: touchedSymbols.size,
            restored_keep: restoredKeep,
            legacy_marked: legacyMarked,
            legacy_already_marked: legacyAlreadyMarked,
            rejected,
            auto_resolved: autoResolved,
            unpublished,
            ignored_invalid: ignoredInvalid,
            defer_read_models: deferReadModels,
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
        "/api/iconoplasm/admin/unstale-batch",
        "/api/iconoplasm/admin/purge-legacy",
        "/api/iconoplasm/admin/remove-candidate",
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
      const actorId = await actor(request, env)

      if (path.endsWith("/unstale-batch")) {
        const symbols = Array.from(
          new Set(
            (Array.isArray(p?.symbols) ? p.symbols : [])
              .map((value) => normalizeSymbol(value || ""))
              .filter(Boolean),
          ),
        ).slice(0, ADMIN_READ_MODEL_SYMBOL_BATCH_MAX)
        if (!symbols.length)
          return done("unstale_batch_400", json({ error: "Missing symbols" }, 400))

        const placeholders = symbols.map(() => "?").join(",")
        const staleResp = await env.ICONOPLASM_DB.prepare(
          `SELECT upper(gene_symbol) AS gene_symbol, asset_sha256
             FROM icono_portrait_assets
            WHERE upper(gene_symbol) IN (${placeholders})
              AND COALESCE(is_stale, 0) = 1`,
        )
          .bind(...symbols)
          .all()
        const staleRows = Array.isArray(staleResp?.results) ? staleResp.results : []
        const touchedSymbols = Array.from(
          new Set(staleRows.map((row) => normalizeSymbol(row?.gene_symbol || "")).filter(Boolean)),
        )

        if (!staleRows.length) {
          return done(
            "unstale_batch",
            json({ ok: true, action: "unstale_batch", touched_symbols: 0, unstaled_assets: 0, symbols }),
          )
        }

        // The gallery narrows work with search/filter controls, so the batch
        // route restores every stale asset for that visible gene slice in one go.
        await env.ICONOPLASM_DB.prepare(
          `UPDATE icono_portrait_assets
              SET is_stale = 0,
                  is_legacy = 0
            WHERE upper(gene_symbol) IN (${placeholders})
              AND COALESCE(is_stale, 0) = 1`,
        )
          .bind(...symbols)
          .run()

        await env.ICONOPLASM_DB.batch(
          staleRows.map((row) => {
            const symbolValue = normalizeSymbol(row?.gene_symbol || "")
            const assetValue = String(row?.asset_sha256 || "").trim()
            return env.ICONOPLASM_DB.prepare(
              "INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at) VALUES (?, ?, ?, 'unstale', ?, ?, CURRENT_TIMESTAMP)",
            ).bind(symbolValue, assetValue, assetValue, actorId, String(p?.reason || "").slice(0, 2000) || null)
          }),
        )

        let autoResolved = 0
        for (const touchedSymbol of touchedSymbols) {
          const result = await autoPromoteTopVotedPortrait(env, {
            symbol: touchedSymbol,
            actorId,
            reason: "admin_unstale_batch_auto_promote",
          })
          if (result?.changed) autoResolved += 1
        }
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: touchedSymbols })
        return done(
          "unstale_batch",
          json({
            ok: true,
            action: "unstale_batch",
            touched_symbols: touchedSymbols.length,
            unstaled_assets: staleRows.length,
            auto_resolved: autoResolved,
            symbols: touchedSymbols,
          }),
        )
      }

      const symbol = normalizeSymbol(p?.symbol || p?.gene_symbol || "")
      if (!symbol) return done("admin_mut_400", json({ error: "Missing symbol" }, 400))

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
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=0, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE upper(gene_symbol)=?",
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
        // Chesterton's fence: rejecting an asset changes the eligible candidate
        // pool. That is moderation, not a request to pin "no portrait", so let
        // site-owned canon recompute immediately unless the operator later sets
        // an explicit override via publish/unpublish/rollback.
        const autoPromote = await autoPromoteTopVotedPortrait(env, {
          symbol,
          actorId,
          reason: "admin_reject_auto_promote",
        })
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "reject",
          json({ ok: true, action: "reject", symbol, asset_sha256: asset, auto_promote: autoPromote }),
        )
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
        const autoPromote = await autoPromoteTopVotedPortrait(env, {
          symbol,
          actorId,
          reason: "admin_unstale_auto_promote",
        })
        await syncAdminReadModelsAndInvalidateGallery(env, { symbols: [symbol] })
        return done(
          "unstale",
          json({ ok: true, action: "unstale", symbol, asset_sha256: asset, auto_promote: autoPromote }),
        )
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

        await env.ICONOPLASM_DB.prepare(
          "DELETE FROM icono_image_votes WHERE upper(gene_symbol)=? AND lower(asset_sha256)=?",
        )
          .bind(symbol, normalizeSha256(asset))
          .run()
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

      if (path.endsWith("/remove-candidate")) {
        const asset = String(p?.asset_sha256 || "").trim()
        if (!asset)
          return done("remove_candidate_400", json({ error: "Missing asset_sha256" }, 400))
        const removal = await removePortraitAssetAndQueueLocalRemoval(env, {
          symbol,
          assetSha256: asset,
          candidateImageId: optionalInt(p?.candidate_image_id ?? p?.emulsion_id),
          actorId,
          reason: String(p?.reason || "").slice(0, 2000) || "",
          source: "admin_remove",
        })
        if (!removal?.ok || removal?.code === "NOT_FOUND") {
          return done(
            "remove_candidate_404",
            json({ error: "Asset not found" }, 404),
          )
        }
        return done(
          "remove_candidate",
          json(
            {
              ok: true,
              action: "remove_candidate",
              symbol,
              asset_sha256: asset,
              candidate_image_id: optionalInt(p?.candidate_image_id ?? p?.emulsion_id),
              unpublished_current: !!removal.unpublished_current,
              deleted_r2_keys: Number(removal.deleted_r2_keys || 0),
              queued_local_removal: removal.queued_local_removal || null,
              auto_promote: removal.auto_promote || null,
            },
            200,
            { "Cache-Control": "no-store" },
          ),
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

    if (path.startsWith("/api/")) return done("api_404", json({ error: "Not found" }, 404))

    // Non-API routes are handled by the index.js proxy (serves Quartz HTML from Pages)
    return done("404", json({ error: "Not found" }, 404))
  } catch (e) {
    console.error("[Iconoplasm] Unhandled request error:", e)
    const out = json({ error: "Internal server error" }, 500)
    await logReq("error", request, 500, started, null)
    return asHead(request, out)
  }
}
