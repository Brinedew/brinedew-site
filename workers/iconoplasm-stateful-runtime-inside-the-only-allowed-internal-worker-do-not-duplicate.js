import { isAdmin } from "./admin.js"
import { parseCookies } from "./auth.js"
import { fetchProteinByUniprot } from "./lib/protein-store.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { writeIconoplasmBudgetAttributionDataPoint } from "./iconoplasm-budget-attribution-analytics.js"
import { ICONOPLASM_OBSERVABILITY_SNAPSHOT } from "./generated/iconoplasm-observability-snapshot.js"
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
const KV_PUBLIC_STATS = "iconoplasm:public-stats:v1"
const KV_HYDRATED_CATALOG_ARTIFACT_PREFIX = "iconoplasm:hydrated-catalog-artifact:"
const KV_CARD_CATALOG_ARTIFACT_PREFIX = "iconoplasm:card-catalog:"
const CARD_CATALOG_ARTIFACT_SCHEMA = "iconoplasm.cardCatalog.v1"
const CARD_CATALOG_ARTIFACT_SHARD_SIZE = 750
const CARD_ARTIFACT_UNAVAILABLE = "CARD_ARTIFACT_UNAVAILABLE"
const MOBILE_CARD_VM_FULL_REBUILD_WARM_SYMBOL_LIMIT = 25000
const MOBILE_CARD_MANIFEST_SCHEMA = "iconoplasm.mobileCardManifest.v1"
const MOBILE_CARD_VM_SCHEMA = "iconoplasm.mobileCard.v1"
const MOBILE_CARD_LAYOUT = "mobile-dossier-v1"
const PUBLIC_DUMP_PREFIX = "public-dumps"
const PUBLIC_DEFAULT_GENE_BATCH_LIMIT = 100
const PUBLIC_MAX_GENE_BATCH_LIMIT = 250
const PUBLIC_MAX_RESOLVE_BATCH_LIMIT = 250
const PUBLIC_STATS_SCHEMA_VERSION = "iconoplasm.publicStats.v1"
const DISCOVERY_SOURCE_EXTENSION_HOVER = "extension_hover"
const DISCOVERY_SOURCE_EXTENSION_GUEST_MERGE = "extension_guest_merge"
const DISCOVERY_SOURCE_STARTER_SEED = "starter_seed"
const DISCOVERY_TRIGGER_HOVER_DWELL = "hover_dwell"
const DISCOVERY_TRIGGER_GUEST_BUFFER_MERGE = "guest_buffer_merge"
const DISCOVERY_TRIGGER_STARTER_SEED = "starter_seed"
const ICONOPLASM_STARTER_GENE_SYMBOLS = ["INS", "RHO", "PRL"]
const ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_BINDING_DO_NOT_DUPLICATE =
  "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE"
const ICONOPLASM_SYNC_FINALIZATION_QUEUE_BINDING = "ICONOPLASM_SYNC_FINALIZATION_QUEUE"
const ICONOPLASM_SYNC_GOVERNOR_BINDING = "ICONOPLASM_SYNC_GOVERNOR"
const ICONOPLASM_SYNC_GOVERNOR_ID = "global"
const ICONOPLASM_SYNC_FINALIZATION_QUEUE_DISABLED_ENV =
  "ICONOPLASM_SYNC_FINALIZATION_QUEUE_DISABLED"
const ICONOPLASM_SYNC_FINALIZATION_QUEUE_FREE_DAILY_OPERATION_LIMIT = 10_000
const ICONOPLASM_SYNC_FINALIZATION_QUEUE_DRAIN_BATCH_LIMIT = 100
const ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_ENV_DO_NOT_SET_CASUALLY =
  "ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY"
const ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_ENV_DO_NOT_SET_CASUALLY =
  "ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY"
const ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_ENV_DO_NOT_SET_CASUALLY =
  "ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY"
const ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_ENV_DO_NOT_SET_CASUALLY =
  "ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY"
const ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_ID_DO_NOT_DUPLICATE = "global"
// Alerts did not solve the real failure mode here because the expensive query day
// was already over by the time a human could notice and react. Keep the hard stop
// loud in names and bindings so future edits do not quietly downgrade it to a
// notification-only system.
const RAW_ICONOPLASM_D1_PREPARED_STATEMENT_DO_NOT_DUPLICATE = Symbol(
  "RAW_ICONOPLASM_D1_PREPARED_STATEMENT_DO_NOT_DUPLICATE",
)
const ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH = Symbol(
  "ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH",
)
const ICONOPLASM_MUTATION_LIMITER_TARGET_DAILY_PERCENT_ENV_DO_NOT_SET_CASUALLY =
  "ICONOPLASM_MUTATION_LIMITER_TARGET_DAILY_PERCENT_DO_NOT_SET_CASUALLY"
const ICONOPLASM_SYNC_GOVERNOR_TARGET_UTILIZATION = 0.93
const ICONOPLASM_SYNC_GOVERNOR_MIN_BATCH_PERMITS = 1
const ICONOPLASM_SYNC_GOVERNOR_MAX_BATCH_PERMITS = 250

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
// The extension manifest refreshes on a five-minute cadence, so a five-second
// shared fingerprint TTL mostly just guarantees extra D1 probes on fresh
// isolates without buying meaningfully fresher client behavior. Keep this long
// enough to act like a real billing barrier, not a theatrical one.
const PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS = 5 * 60 * 1000
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
const cardCatalogArtifactCache = {
  version: null,
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

function positiveIntFromEnv(raw, fallback = 0) {
  const value = Number.parseInt(String(raw ?? ""), 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function positiveNumberFromEnv(raw, fallback = 0) {
  const value = Number.parseFloat(String(raw ?? ""))
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

function iconoplasmUtcDayKey(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10)
}

function iconoplasmBudgetCycleInfo(now = new Date(), cycleDayOfMonth = 7) {
  const safeCycleDay = Math.min(28, Math.max(1, positiveIntFromEnv(cycleDayOfMonth, 7) || 7))
  const asDate = new Date(now)
  const year = asDate.getUTCFullYear()
  const month = asDate.getUTCMonth()
  const day = asDate.getUTCDate()
  const cycleStartMonthOffset = day >= safeCycleDay ? 0 : -1
  const cycleStart = new Date(
    Date.UTC(year, month + cycleStartMonthOffset, safeCycleDay, 0, 0, 0, 0),
  )
  const nextCycleStart = new Date(
    Date.UTC(cycleStart.getUTCFullYear(), cycleStart.getUTCMonth() + 1, safeCycleDay, 0, 0, 0, 0),
  )
  return {
    dayKey: iconoplasmUtcDayKey(asDate),
    cycleKey: cycleStart.toISOString().slice(0, 10),
    cycleStartIso: cycleStart.toISOString(),
    nextCycleStartIso: nextCycleStart.toISOString(),
    daysRemainingInCycle: Math.max(
      1,
      Math.ceil((nextCycleStart.getTime() - asDate.getTime()) / 86400000),
    ),
  }
}

// Chesterton's fence for the Iconoplasm budget path:
//
// The previous implementation was "safe" in three separate ways that fought
// each other and collectively became the most expensive part of the system:
// 1) monthly D1 ceilings lived in one helper,
// 2) the admin mutation limiter derived a second write ceiling elsewhere, and
// 3) the shared budget Durable Object flushed mid-request and also wrote
//    attribution rows on the hot path.
//
// That meant one logical admin sync request could pay several times just to
// narrate its own spending: once for the real D1 work, again for repeated DO
// `/record` flushes, and again for attribution writes inside the same global
// ledger object. Cloudflare's current guidance points the other direction:
// keep shared coordination narrow, keep hot telemetry off synchronous request
// paths, and do not turn a global DO into a universal accounting singleton.
//
// This unified policy function exists so every budget-derived decision comes
// from one source of truth. The D1 monthly limits, cycle math, burst factor,
// and mutation-limiter target percentage are intentionally read together here
// so future edits cannot quietly reintroduce a second or third independent cap
// with slightly different semantics. If a future refactor moves detailed cost
// attribution into Analytics Engine or Queues, this policy should remain the
// enforcement/configuration boundary while the attribution plumbing changes
// underneath it.
function iconoplasmBudgetPolicyFromEnv(env, now = new Date()) {
  const rowsReadMonthlyLimit = positiveIntFromEnv(
    env?.[ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_ENV_DO_NOT_SET_CASUALLY],
    0,
  )
  const rowsWrittenMonthlyLimit = positiveIntFromEnv(
    env?.[ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_ENV_DO_NOT_SET_CASUALLY],
    0,
  )
  if (rowsReadMonthlyLimit <= 0 && rowsWrittenMonthlyLimit <= 0) return null
  const cycleDayOfMonth = positiveIntFromEnv(
    env?.[ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_ENV_DO_NOT_SET_CASUALLY],
    7,
  )
  const dailyBurstMultiplier = positiveNumberFromEnv(
    env?.[ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_ENV_DO_NOT_SET_CASUALLY],
    3,
  )
  const targetDailyPercent = Math.max(
    1,
    Math.min(
      100,
      positiveNumberFromEnv(
        env?.[ICONOPLASM_MUTATION_LIMITER_TARGET_DAILY_PERCENT_ENV_DO_NOT_SET_CASUALLY],
        90,
      ),
    ),
  )
  return {
    d1: {
      rowsReadMonthlyLimit,
      rowsWrittenMonthlyLimit,
      cycleDayOfMonth,
      dailyBurstMultiplier,
      cycleInfo: iconoplasmBudgetCycleInfo(now, cycleDayOfMonth),
    },
    mutationLimiter: {
      active: true,
      budgetBasis: "d1_rows_written_daily_smart_limit",
      budgetBasisLabel: "D1 rows_written daily smart limit",
      targetDailyPercent,
      explainsDoCap: false,
      explanation:
        "This worker now derives its mutation-write ceiling from one shared Iconoplasm budget policy built on the D1 rows_written daily smart limit, not the Cloudflare Durable Objects rows_written daily cap. The Durable Objects cap is tracked separately in Cloudflare observability instead of being copied into a second hot-path limiter.",
    },
  }
}

function iconoplasmD1BudgetConfigFromEnv(env, now = new Date()) {
  return iconoplasmBudgetPolicyFromEnv(env, now)?.d1 || null
}

function iconoplasmMutationLimiterPolicyFromEnv(env, now = new Date()) {
  const policy = iconoplasmBudgetPolicyFromEnv(env, now)
  return (
    policy?.mutationLimiter || {
      active: false,
      budgetBasis: "d1_rows_written_daily_smart_limit",
      budgetBasisLabel: "D1 rows_written daily smart limit",
      targetDailyPercent: 90,
      explainsDoCap: false,
      explanation:
        "This worker derives mutation ceilings from the shared Iconoplasm D1 budget policy when that policy is enabled.",
    }
  )
}

function numberOrInfinity(value) {
  if (value === null || value === undefined || value === "") return Number.POSITIVE_INFINITY
  const n = Number(value)
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

function readIconoplasmLiveBudgetSnapshot(env) {
  const raw =
    env?.ICONOPLASM_LIVE_BUDGET_SNAPSHOT_FOR_TEST || env?.ICONOPLASM_LIVE_BUDGET_SNAPSHOT || null
  if (!raw) return null
  if (typeof raw === "object") return raw
  try {
    return JSON.parse(String(raw || ""))
  } catch {
    return null
  }
}

export function iconoplasmCardCatalogBudgetPreflightStatus(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return {
      ok: false,
      code: "LIVE_BUDGET_TELEMETRY_MISSING",
      failures: ["live_budget_telemetry_missing"],
      checks: [],
    }
  }
  const checks = [
    ["kv_reads", numberOrInfinity(snapshot?.kv?.reads_remaining), 1],
    ["kv_writes", numberOrInfinity(snapshot?.kv?.writes_remaining), 2],
    ["kv_lists", numberOrInfinity(snapshot?.kv?.lists_remaining), 0],
    ["d1_rows_read", numberOrInfinity(snapshot?.d1?.rows_read_remaining), 1],
    ["d1_rows_written", numberOrInfinity(snapshot?.d1?.rows_written_remaining), 1],
    ["queue_operations", numberOrInfinity(snapshot?.queues?.operations_remaining), 1],
    ["worker_requests", numberOrInfinity(snapshot?.workers?.requests_remaining), 1],
    ["worker_cpu_ms", numberOrInfinity(snapshot?.workers?.cpu_ms_remaining), 1],
    ["durable_object_requests", numberOrInfinity(snapshot?.durable_objects?.requests_remaining), 0],
    [
      "durable_object_rows_written",
      numberOrInfinity(snapshot?.durable_objects?.rows_written_remaining),
      0,
    ],
    ["logs_events", numberOrInfinity(snapshot?.logs?.events_remaining), 1],
  ].map(([name, remaining, required]) => ({
    name,
    remaining,
    required,
    ok: remaining >= required,
  }))
  const r2Required = Boolean(snapshot?.r2?.required)
  checks.push({
    name: "r2_available",
    remaining: snapshot?.r2?.available === true ? 1 : 0,
    required: r2Required ? 1 : 0,
    ok: !r2Required || snapshot?.r2?.available === true,
  })
  const failures = checks.filter((check) => !check.ok).map((check) => check.name)
  return {
    ok: failures.length === 0,
    code: failures.length ? "CARD_CATALOG_BUDGET_PREFLIGHT_FAILED" : "OK",
    failures,
    checks,
  }
}

function assertIconoplasmCardCatalogBudgetPreflight(env) {
  const required = String(env?.ICONOPLASM_CARD_CATALOG_BUDGET_PREFLIGHT_REQUIRED || "")
    .trim()
    .toLowerCase()
  if (required !== "1" && required !== "true") return
  const status = iconoplasmCardCatalogBudgetPreflightStatus(readIconoplasmLiveBudgetSnapshot(env))
  if (status.ok) return
  throw new Error(`Iconoplasm card catalog budget preflight failed: ${status.failures.join(", ")}`)
}

function iconoplasmBudgetRouteFamilyFromPath(path) {
  if (path === publicApiPath("/metadata")) return "public_metadata"
  if (path === publicApiPath("/stats")) return "public_stats"
  if (path === publicApiPath("/catalog/manifest") || isPublicCatalogArtifactPath(path))
    return "public_catalog"
  if (path.startsWith(publicApiPath("/dumps/catalog."))) return "public_catalog_dump"
  if (path === publicApiPath("/gallery")) return "public_gallery"
  if (path === publicApiPath("/genes/search")) return "public_gene_search"
  if (path === publicApiPath("/genes/batch")) return "public_gene_batch"
  if (path === "/api/iconoplasm/mobile-card-manifest") return "mobile_card_manifest"
  if (path.startsWith(publicApiPath("/genes/"))) return "public_gene_detail"
  if (path === publicApiPath("/resolve")) return "public_resolve"
  if (path === publicApiPath("/changes")) return "public_changes"
  if (path.startsWith(publicApiPath("/media/"))) return "public_media"
  if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) return "site_gene_detail"
  if (path === "/api/iconoplasm/discoveries/encounter") return "discoveries_encounter"
  if (path === "/api/iconoplasm/discoveries/me") return "discoveries_me"
  if (path === "/api/iconoplasm/account-gallery-window") return "account_gallery_window"
  if (path === "/api/iconoplasm/discoveries/merge") return "discoveries_merge"
  if (path === "/api/iconoplasm/requests") return "gene_request_submit"
  if (path === "/api/iconoplasm/requests/options") return "gene_request_options"
  if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(path))
    return "gene_request_summary"
  if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+$/.test(path)) return "gene_request_state_gone"
  if (path === "/api/iconoplasm/candidates/copy") return "candidate_copy"
  if (path === "/api/iconoplasm/votes/me") return "votes_me"
  if (path === "/api/iconoplasm/votes/set") return "votes_set"
  if (path === "/api/iconoplasm/votes/snapshot") return "votes_snapshot"
  if (path === "/api/iconoplasm/artist-styles/search") return "artist_styles_search"
  if (path === "/api/iconoplasm/artist-blacklist-submissions") return "artist_blacklist_submission"
  if (path === "/api/iconoplasm/admin/me") return "admin_me"
  if (path === "/api/iconoplasm/admin/ingest") return "admin_ingest"
  if (path === "/api/iconoplasm/admin/reconcile") return "admin_reconcile"
  if (path === "/api/iconoplasm/admin/overview") return "admin_overview"
  if (path === "/api/iconoplasm/admin/mutation-limiter/policy")
    return "admin_mutation_limiter_policy"
  if (path === "/api/iconoplasm/admin/coverage") return "admin_coverage"
  if (path === "/api/iconoplasm/admin/public-stats/audit") return "admin_public_stats_audit"
  if (path === "/api/iconoplasm/admin/canon-audit") return "admin_canon_audit"
  if (path === "/api/iconoplasm/admin/read-models/bootstrap") return "admin_read_models_bootstrap"
  if (path === "/api/iconoplasm/admin/card-vms/warm") return "admin_card_vms_warm"
  if (path.startsWith("/api/iconoplasm/admin/catalog/")) return "admin_catalog"
  if (path.startsWith("/api/iconoplasm/admin/essence/")) return "admin_essence"
  if (path.startsWith("/api/iconoplasm/admin/read-models/")) return "admin_read_models"
  if (path.startsWith("/api/iconoplasm/admin/votes/")) return "admin_votes"
  if (path === "/api/iconoplasm/admin/assets/summary") return "admin_assets_summary"
  if (path === "/api/iconoplasm/admin/assets/state") return "admin_assets_state"
  if (path.startsWith("/api/iconoplasm/admin/assets")) return "admin_assets"
  if (path === "/api/iconoplasm/admin/gallery") return "admin_gallery"
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
    ].includes(path)
  )
    return "admin_gallery_mutation"
  if (/^\/api\/iconoplasm\/admin\/gene\/[^/]+$/.test(path)) return "admin_gene_detail"
  if (path === "/api/iconoplasm/admin/local-removals/pending") return "admin_local_removals_pending"
  if (path === "/api/iconoplasm/admin/local-removals/ack") return "admin_local_removals_ack"
  if (path === "/api/iconoplasm/admin/artist-styles/remove") return "admin_artist_styles_remove"
  if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/pending")
    return "admin_artist_blacklist_pending"
  if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/ack")
    return "admin_artist_blacklist_ack"
  if (path === "/api/iconoplasm/admin/finalization/pending") return "admin_finalization_pending"
  if (path === "/api/iconoplasm/admin/finalization/enqueue") return "admin_finalization_enqueue"
  if (path === "/api/iconoplasm/admin/finalization/kick") return "admin_finalization_enqueue"
  if (path === "/api/iconoplasm/admin/finalization/process") return "admin_finalization_process"
  if (path === "/api/iconoplasm/admin/catalog/state") return "admin_catalog_state"
  if (path === "/api/iconoplasm/admin/catalog/upsert") return "admin_catalog_upsert"
  if (path === "/api/iconoplasm/admin/catalog/reconcile") return "admin_catalog_reconcile"
  if (path === "/api/iconoplasm/admin/catalog/publish") return "admin_catalog_publish"
  if (path === "/api/iconoplasm/admin/essence/upsert") return "admin_essence_upsert"
  if (path === "/api/iconoplasm/admin/essence/state") return "admin_essence_state"
  if (path === "/api/iconoplasm/admin/requests/open") return "admin_requests_open"
  if (path === "/api/iconoplasm/admin/requests/fulfill") return "admin_requests_fulfill"
  if (/^\/api\/iconoplasm\/admin\/requests\/gene\/[^/]+\/diagnostics$/.test(path))
    return "admin_gene_request_diagnostics"
  if (path === "/api/iconoplasm/admin/cost/usage" || path === "/api/iconoplasm/admin/cost/snapshot")
    return "admin_cost_usage"
  if (path === ICONOPLASM_CANON_REPAIR_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER)
    return "internal_repair"
  if (path === ICONOPLASM_VOTE_PROJECTION_REFRESH_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER)
    return "internal_vote_projection_refresh"
  if (path.startsWith("/api/iconoplasm/admin/")) {
    throw new IconoplasmUnclassifiedHandledRouteError(path)
  }
  if (path.startsWith("/api/iconoplasm/")) {
    throw new IconoplasmUnclassifiedHandledRouteError(path)
  }
  return "non_iconoplasm"
}

function iconoplasmBudgetClassFromRouteFamily(routeFamily) {
  const family = String(routeFamily || "").trim()
  if (!family || family === "non_iconoplasm") return "non_iconoplasm"
  if (family.startsWith("public_")) return "public_read"
  if (family === "site_gene_detail") return "first_party_read"
  if (family === "mobile_card_manifest") return "first_party_read"
  if (family === "account_gallery_window") return "first_party_read"
  if (family.startsWith("discoveries_")) return "first_party_write"
  if (family.startsWith("gene_request_")) return "first_party_request"
  if (family === "candidate_copy") return "first_party_write"
  if (family.startsWith("votes_"))
    return family === "votes_me" ? "first_party_read" : "first_party_write"
  if (family === "artist_styles_search") return "public_read"
  if (family === "artist_blacklist_submission") return "public_submission"
  if (family === "internal_repair") return "internal_maintenance"
  if (family === "internal_vote_projection_refresh") return "internal_maintenance"
  if (
    family === "admin_overview" ||
    family === "admin_coverage" ||
    family === "admin_cost_usage" ||
    family === "admin_mutation_limiter_policy" ||
    family === "admin_me"
  )
    return "admin_dashboard"
  if (
    family === "admin_ingest" ||
    family === "admin_reconcile" ||
    family === "admin_read_models" ||
    family === "admin_read_models_bootstrap" ||
    family === "admin_card_vms_warm" ||
    family === "admin_finalization_enqueue" ||
    family === "admin_finalization_process" ||
    family === "admin_catalog" ||
    family === "admin_catalog_state" ||
    family === "admin_catalog_upsert" ||
    family === "admin_catalog_reconcile" ||
    family === "admin_catalog_publish" ||
    family === "admin_essence" ||
    family === "admin_essence_upsert" ||
    family === "admin_essence_state"
  ) {
    return "admin_sync"
  }
  if (
    family === "admin_votes" ||
    family === "admin_gallery" ||
    family === "admin_gallery_mutation" ||
    family === "admin_assets" ||
    family === "admin_assets_summary" ||
    family === "admin_assets_state" ||
    family === "admin_gene_detail" ||
    family === "admin_canon_audit" ||
    family === "admin_public_stats_audit" ||
    family === "admin_finalization_pending" ||
    family === "admin_requests_open" ||
    family === "admin_requests_fulfill" ||
    family === "admin_gene_request_diagnostics" ||
    family === "admin_local_removals_pending" ||
    family === "admin_local_removals_ack" ||
    family === "admin_artist_styles_remove" ||
    family === "admin_artist_blacklist_pending" ||
    family === "admin_artist_blacklist_ack"
  ) {
    return "admin_operational"
  }
  throw new IconoplasmUnclassifiedHandledRouteError(`budget-class:${family}`)
}

function iconoplasmBudgetClassFromHistoricalRouteFamilyForReport(routeFamily) {
  try {
    return iconoplasmBudgetClassFromRouteFamily(routeFamily)
  } catch {
    // CHESTERTON'S FENCE: old budget rows already stored before the fail-loud
    // classifier existed must stay visible in the dashboard, or the curiosity
    // layer becomes useless right when we need to understand old damage. This
    // helper is for historical report rows only. Live request attribution must
    // still throw loudly above instead of quietly inventing a bucket.
    return "legacy_unclassified_pre_fail_loud_do_not_reuse"
  }
}

function iconoplasmBudgetSourceClassFromRequest(request, path, routeFamily) {
  if (routeFamily === "internal_repair") return "internal_maintenance"
  if (path.startsWith("/api/iconoplasm/admin/")) {
    if (
      routeFamily === "admin_ingest" ||
      routeFamily === "admin_reconcile" ||
      routeFamily === "admin_catalog" ||
      routeFamily === "admin_essence" ||
      routeFamily === "admin_read_models"
    ) {
      return "workstation_sync"
    }
    return "admin_ui"
  }
  if (hasExtensionClientHeader(request)) return "extension"
  if (hasTrustedIconoplasmBrowserOrigin(request)) return "first_party_site"
  if (isInternalRequestForTheOnlyAllowedStatefulWorker(request)) return "public_edge_proxy"
  return "public_api"
}

function iconoplasmBudgetActorClassFromRequest(request, path) {
  if (path.startsWith("/api/iconoplasm/admin/")) {
    return hasAdminTokenCredentialPresent(request) ? "admin_token" : "admin_session"
  }
  if (hasExtensionClientHeader(request)) return "extension_user"
  if (hasTrustedIconoplasmBrowserOrigin(request)) return "first_party_browser"
  return "anonymous_public"
}

function iconoplasmD1BudgetAttributionFromRequest(request) {
  const path = new URL(request.url).pathname
  const routeFamily = iconoplasmBudgetRouteFamilyFromPath(path)
  return {
    route_family: routeFamily,
    budget_class: iconoplasmBudgetClassFromRouteFamily(routeFamily),
    actor_class: iconoplasmBudgetActorClassFromRequest(request, path),
    source_class: iconoplasmBudgetSourceClassFromRequest(request, path, routeFamily),
  }
}

function iconoplasmD1BudgetRowsReadFromMeta(meta) {
  const value = Number(meta?.rows_read ?? meta?.rowsRead ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function iconoplasmD1BudgetRowsWrittenFromMeta(meta) {
  const value = Number(meta?.rows_written ?? meta?.rowsWritten ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

function isIconoplasmHighRiskAdminMutationRouteFamily(routeFamily) {
  return new Set([
    "admin_ingest",
    "admin_reconcile",
    "admin_catalog",
    "admin_catalog_upsert",
    "admin_catalog_reconcile",
    "admin_catalog_publish",
    "admin_essence",
    "admin_essence_upsert",
    "admin_read_models",
    "admin_read_models_bootstrap",
    "admin_finalization_enqueue",
    "admin_finalization_process",
  ]).has(String(routeFamily || "").trim())
}

function iconoplasmMutationLimiterChunkSlowZoneRows(snapshot) {
  const smartLimit = Math.max(0, Number(snapshot?.rows_written_daily_smart_limit || 0) || 0)
  if (smartLimit <= 0) return 0
  return Math.max(1000, Math.min(50000, Math.ceil(smartLimit * 0.005)))
}

function iconoplasmMutationLimiterTargetDailyPercent(env) {
  return iconoplasmMutationLimiterPolicyFromEnv(env).targetDailyPercent
}

function iconoplasmMutationLimiterTargetRowsWrittenCeiling(snapshot, env) {
  const smartLimit =
    snapshot?.rows_written_daily_smart_limit === null ||
    snapshot?.rows_written_daily_smart_limit === undefined
      ? null
      : Math.max(0, Number(snapshot?.rows_written_daily_smart_limit || 0) || 0)
  if (smartLimit === null) return null
  return Math.max(
    0,
    Math.floor(smartLimit * (iconoplasmMutationLimiterPolicyFromEnv(env).targetDailyPercent / 100)),
  )
}

function iconoplasmMutationLimiterBudgetStatus(state, snapshot = null) {
  const currentSnapshot =
    snapshot || iconoplasmD1DailyBudgetProjectedSnapshot(state) || state?.lastSnapshot || null
  const targetDailyPercent =
    Math.max(1, Math.min(100, Number(state?.mutationLimiter?.targetDailyPercent || 0) || 0)) ||
    iconoplasmMutationLimiterTargetDailyPercent(state?.rawEnv)
  const targetRowsWrittenCeiling =
    state?.mutationLimiter?.targetRowsWrittenCeiling === null ||
    state?.mutationLimiter?.targetRowsWrittenCeiling === undefined
      ? iconoplasmMutationLimiterTargetRowsWrittenCeiling(currentSnapshot, state?.rawEnv)
      : Math.max(0, Number(state?.mutationLimiter?.targetRowsWrittenCeiling || 0) || 0)
  const rowsWritten = Math.max(0, Number(currentSnapshot?.rows_written || 0) || 0)
  const rowsWrittenTargetRemaining =
    targetRowsWrittenCeiling === null ? null : Math.max(0, targetRowsWrittenCeiling - rowsWritten)
  return {
    snapshot: currentSnapshot,
    target_daily_percent: targetDailyPercent,
    target_rows_written_ceiling: targetRowsWrittenCeiling,
    rows_written_target_remaining: rowsWrittenTargetRemaining,
    target_cap_reached:
      targetRowsWrittenCeiling !== null && rowsWritten >= targetRowsWrittenCeiling,
  }
}

function iconoplasmMutationLimiterSuggestedChunkUnits(
  state,
  { requestedUnits = 0, observedRowsWrittenPerUnit = 0 } = {},
) {
  const safeRequestedUnits = Math.max(0, Number.parseInt(String(requestedUnits || 0), 10) || 0)
  if (safeRequestedUnits <= 0) return 0
  if (!state?.mutationLimiter?.active) return safeRequestedUnits
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state)
  const targetRemaining = budgetStatus.rows_written_target_remaining
  if (targetRemaining === null) return safeRequestedUnits
  if (targetRemaining <= 0) return 0

  const observedCost = Math.max(0, Number(observedRowsWrittenPerUnit || 0) || 0)
  if (observedCost > 0) {
    const estimatedUnits = Math.floor(targetRemaining / observedCost)
    if (estimatedUnits <= 0) return 0
    return Math.max(1, Math.min(safeRequestedUnits, estimatedUnits))
  }

  const slowZone = Math.max(1, Number(state?.mutationLimiter?.chunkSlowZoneRows || 0) || 0)
  // The old headroom rule used to hard-stop the whole request. Keep it only as
  // a slow-zone hint now: when we get close to the cap and do not yet have a
  // measured chunk cost, shrink admission so we learn on smaller bites instead
  // of gambling the whole remaining day on one blind chunk.
  if (targetRemaining <= slowZone) return 1
  if (targetRemaining <= slowZone * 2)
    return Math.max(1, Math.min(safeRequestedUnits, Math.ceil(safeRequestedUnits / 4)))
  if (targetRemaining <= slowZone * 4)
    return Math.max(1, Math.min(safeRequestedUnits, Math.ceil(safeRequestedUnits / 2)))
  return safeRequestedUnits
}

function iconoplasmD1DailyBudgetProjectedSnapshot(state) {
  const base = state?.lastSnapshot || null
  if (!base) return null
  const pendingRowsRead = Math.max(0, Number(state?.pendingUsage?.rowsRead || 0) || 0)
  const pendingRowsWritten = Math.max(0, Number(state?.pendingUsage?.rowsWritten || 0) || 0)
  const pendingQueryCount = Math.max(0, Number(state?.pendingUsage?.queryCount || 0) || 0)
  const pendingRequestCount = Math.max(0, Number(state?.pendingUsage?.requestCount || 0) || 0)
  const rowsRead = Math.max(0, Number(base.rows_read || 0) || 0) + pendingRowsRead
  const rowsWritten = Math.max(0, Number(base.rows_written || 0) || 0) + pendingRowsWritten
  const cycleRowsRead = Math.max(0, Number(base.cycle_rows_read || 0) || 0) + pendingRowsRead
  const cycleRowsWritten =
    Math.max(0, Number(base.cycle_rows_written || 0) || 0) + pendingRowsWritten
  const queryCount = Math.max(0, Number(base.query_count || 0) || 0) + pendingQueryCount
  const requestCount = Math.max(0, Number(base.request_count || 0) || 0) + pendingRequestCount
  const cycleQueryCount = Math.max(0, Number(base.cycle_query_count || 0) || 0) + pendingQueryCount
  const cycleRequestCount =
    Math.max(0, Number(base.cycle_request_count || 0) || 0) + pendingRequestCount
  const rowsReadMonthlyLimit = Number(base.rows_read_monthly_limit || 0) || 0
  const rowsWrittenMonthlyLimit = Number(base.rows_written_monthly_limit || 0) || 0
  const rowsReadDailySmartLimit =
    base.rows_read_daily_smart_limit === null || base.rows_read_daily_smart_limit === undefined
      ? null
      : Math.max(0, Number(base.rows_read_daily_smart_limit || 0) || 0)
  const rowsWrittenDailySmartLimit =
    base.rows_written_daily_smart_limit === null ||
    base.rows_written_daily_smart_limit === undefined
      ? null
      : Math.max(0, Number(base.rows_written_daily_smart_limit || 0) || 0)
  const rowsReadMonthlyRemaining =
    rowsReadMonthlyLimit > 0 ? Math.max(0, rowsReadMonthlyLimit - cycleRowsRead) : null
  const rowsWrittenMonthlyRemaining =
    rowsWrittenMonthlyLimit > 0 ? Math.max(0, rowsWrittenMonthlyLimit - cycleRowsWritten) : null
  const rowsReadDailyRemaining =
    rowsReadDailySmartLimit !== null ? Math.max(0, rowsReadDailySmartLimit - rowsRead) : null
  const rowsWrittenDailyRemaining =
    rowsWrittenDailySmartLimit !== null
      ? Math.max(0, rowsWrittenDailySmartLimit - rowsWritten)
      : null
  const exhaustedBy =
    rowsReadMonthlyLimit > 0 && cycleRowsRead >= rowsReadMonthlyLimit
      ? "rows_read_monthly"
      : rowsWrittenMonthlyLimit > 0 && cycleRowsWritten >= rowsWrittenMonthlyLimit
        ? "rows_written_monthly"
        : rowsReadDailySmartLimit !== null && rowsRead >= rowsReadDailySmartLimit
          ? "rows_read_daily_smart"
          : rowsWrittenDailySmartLimit !== null && rowsWritten >= rowsWrittenDailySmartLimit
            ? "rows_written_daily_smart"
            : null
  return {
    ...base,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    query_count: queryCount,
    request_count: requestCount,
    cycle_rows_read: cycleRowsRead,
    cycle_rows_written: cycleRowsWritten,
    cycle_query_count: cycleQueryCount,
    cycle_request_count: cycleRequestCount,
    rows_read_monthly_remaining: rowsReadMonthlyRemaining,
    rows_written_monthly_remaining: rowsWrittenMonthlyRemaining,
    rows_read_daily_remaining: rowsReadDailyRemaining,
    rows_written_daily_remaining: rowsWrittenDailyRemaining,
    exhausted: Boolean(exhaustedBy),
    exhausted_by: exhaustedBy,
  }
}

function iconoplasmD1DailyBudgetShouldFlushPendingUsage(state) {
  // 2026 sanity fence: this DO is the shared enforcement counter, not a
  // per-query telemetry firehose. Threshold-based flushes multiplied DO writes
  // during big sync requests and turned the guardrail into the dominant bill.
  // Keep the hot path to one shared ledger write at request end unless the
  // projected budget is already exhausted and we need an immediate hard stop.
  return false
}

class IconoplasmD1DailyBudgetExceededError extends Error {
  constructor(snapshot) {
    super("ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
    this.name = "IconoplasmD1DailyBudgetExceededError"
    this.snapshot = snapshot || null
  }
}

class IconoplasmD1DailyBudgetConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = "IconoplasmD1DailyBudgetConfigurationError"
  }
}

class IconoplasmAdminMutationLimiterActiveError extends Error {
  constructor(detail) {
    super("ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
    this.name = "IconoplasmAdminMutationLimiterActiveError"
    this.detail = detail || null
  }
}

class IconoplasmUnclassifiedHandledRouteError extends Error {
  constructor(routePath) {
    super(`Handled Iconoplasm route is missing classification: ${String(routePath || "")}`)
    this.name = "IconoplasmUnclassifiedHandledRouteError"
  }
}

function iconoplasmD1DailyBudgetExceededPayload(snapshot) {
  return {
    error:
      "Iconoplasm D1 daily budget exhausted. The only allowed stateful worker is failing closed to stop further bill growth.",
    code: "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED",
    budget: snapshot || null,
  }
}

function iconoplasmD1DailyBudgetConfigurationPayload(message) {
  return {
    error: String(message || "Iconoplasm D1 daily budget kill switch is misconfigured"),
    code: "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_MISCONFIGURED",
  }
}

function iconoplasmAdminMutationLimiterActivePayload(detail) {
  return {
    error:
      "Iconoplasm paused another write-heavy admin run because the only allowed stateful worker reached the configured daily write cap for mutation work, or the shared telemetry fence is no longer trustworthy.",
    code: "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE",
    limiter: detail || null,
  }
}

function iconoplasmD1DailyBudgetKillSwitchStub(env) {
  const namespace = env?.[ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_BINDING_DO_NOT_DUPLICATE]
  if (
    !namespace ||
    typeof namespace.idFromName !== "function" ||
    typeof namespace.get !== "function"
  ) {
    return null
  }
  return namespace.get(
    namespace.idFromName(ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_ID_DO_NOT_DUPLICATE),
  )
}

async function iconoplasmD1DailyBudgetKillSwitchJson(stub, path, payload) {
  const response = await stub.fetch(
    new Request(`https://iconoplasm-d1-daily-budget-kill-switch${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload || {}),
    }),
  )
  if (!response.ok) {
    const detail = await response.text().catch(function () {
      return ""
    })
    throw new IconoplasmD1DailyBudgetConfigurationError(
      `ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE failed (${response.status})${detail ? `: ${detail}` : ""}`,
    )
  }
  return response.json()
}

function iconoplasmAdminMutationLimiterDetail(
  state,
  { stage = "preflight", reason = "", telemetryLocked = false, telemetryLockedReason = "" } = {},
) {
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state)
  return {
    stage,
    reason: String(reason || "").trim() || null,
    route_family: state?.attribution?.route_family || null,
    budget_class: state?.attribution?.budget_class || null,
    actor_class: state?.attribution?.actor_class || null,
    source_class: state?.attribution?.source_class || null,
    target_daily_percent: budgetStatus.target_daily_percent || null,
    target_rows_written_ceiling: budgetStatus.target_rows_written_ceiling,
    rows_written_target_remaining: budgetStatus.rows_written_target_remaining,
    target_cap_reached: budgetStatus.target_cap_reached,
    telemetry_locked: Boolean(telemetryLocked),
    telemetry_locked_reason: telemetryLocked
      ? String(telemetryLockedReason || "").trim() || null
      : null,
    budget_snapshot: budgetStatus.snapshot || state?.lastSnapshot || null,
  }
}

function iconoplasmBudgetAttributionOutcomeClass(responseStatus, errorCode = "") {
  const status = Math.max(0, Number(responseStatus || 0) || 0)
  const code = String(errorCode || "").trim()
  if (code === "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE") return "limited"
  if (code === "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED") return "budget_exhausted"
  if (status >= 500) return "server_error"
  if (status >= 400) return "client_error"
  if (status >= 200 && status < 400) return "ok"
  return "unknown"
}

function emitIconoplasmBudgetAttributionTelemetryFromState(
  env,
  request,
  state,
  { responseStatus = 0, errorCode = "", limiterDetail = null } = {},
) {
  if (!state || !request) return false
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state)
  return writeIconoplasmBudgetAttributionDataPoint(env, {
    cycleKey: state?.cycleKey || budgetStatus?.snapshot?.cycle_key || "",
    routeFamily: state?.attribution?.route_family || null,
    budgetClass: state?.attribution?.budget_class || null,
    actorClass: state?.attribution?.actor_class || null,
    sourceClass: state?.attribution?.source_class || null,
    outcomeClass: iconoplasmBudgetAttributionOutcomeClass(responseStatus, errorCode),
    errorCode,
    requestMethod: request.method,
    limiterStage: limiterDetail?.stage || (state?.mutationLimiter?.active ? "request_end" : ""),
    rowsRead: state?.requestUsage?.rowsRead || 0,
    rowsWritten: state?.requestUsage?.rowsWritten || 0,
    queryCount: state?.requestUsage?.queryCount || 0,
    requestCount: state?.requestUsage?.requestCountRecorded ? 1 : 0,
    responseStatus,
    targetDailyPercent: budgetStatus?.target_daily_percent,
    targetRowsWrittenCeiling: budgetStatus?.target_rows_written_ceiling,
    rowsWrittenTargetRemaining: budgetStatus?.rows_written_target_remaining,
    targetCapReached: budgetStatus?.target_cap_reached,
    telemetryLocked: Boolean(limiterDetail?.telemetry_locked),
  })
}

function emitIconoplasmBudgetAttributionTelemetryForLimiterRejection(
  env,
  request,
  detail,
  { responseStatus = 503 } = {},
) {
  if (!request || !detail) return false
  const fallbackBudgets = iconoplasmD1BudgetConfigFromEnv(env)
  const fallbackAttribution = iconoplasmD1BudgetAttributionFromRequest(request)
  return writeIconoplasmBudgetAttributionDataPoint(env, {
    cycleKey: detail?.budget_snapshot?.cycle_key || fallbackBudgets?.cycleInfo?.cycleKey || "",
    routeFamily: detail?.route_family || fallbackAttribution?.route_family || null,
    budgetClass: detail?.budget_class || fallbackAttribution?.budget_class || null,
    actorClass: detail?.actor_class || fallbackAttribution?.actor_class || null,
    sourceClass: detail?.source_class || fallbackAttribution?.source_class || null,
    outcomeClass: iconoplasmBudgetAttributionOutcomeClass(
      responseStatus,
      "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE",
    ),
    errorCode: "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE",
    requestMethod: request.method,
    limiterStage: detail?.stage || "preflight",
    rowsRead: detail?.rows_read_request || 0,
    rowsWritten: detail?.rows_written_request || 0,
    queryCount: detail?.query_count_request || 0,
    requestCount: 1,
    responseStatus,
    targetDailyPercent: detail?.target_daily_percent,
    targetRowsWrittenCeiling: detail?.target_rows_written_ceiling,
    rowsWrittenTargetRemaining: detail?.rows_written_target_remaining,
    targetCapReached: detail?.target_cap_reached,
    telemetryLocked: Boolean(detail?.telemetry_locked),
  })
}

async function flushIconoplasmD1DailyBudgetPendingUsage(state) {
  const safeRowsRead = Math.max(0, Number(state?.pendingUsage?.rowsRead || 0) || 0)
  const safeRowsWritten = Math.max(0, Number(state?.pendingUsage?.rowsWritten || 0) || 0)
  const safeQueryCount = Math.max(0, Number(state?.pendingUsage?.queryCount || 0) || 0)
  const safeRequestCount = Math.max(0, Number(state?.pendingUsage?.requestCount || 0) || 0)
  if (safeRowsRead <= 0 && safeRowsWritten <= 0 && safeRequestCount <= 0) {
    return iconoplasmD1DailyBudgetProjectedSnapshot(state) || state?.lastSnapshot || null
  }
  try {
    const snapshot = await iconoplasmD1DailyBudgetKillSwitchJson(state.stub, "/record", {
      day_key: state.dayKey,
      cycle_key: state.cycleKey,
      rows_read: safeRowsRead,
      rows_written: safeRowsWritten,
      budgets: state.budgets,
      days_remaining_in_cycle: state.daysRemainingInCycle,
      attribution: state.attribution,
      request_count: safeRequestCount,
      query_count: safeQueryCount,
    })
    state.requestUsage.requestCountRecorded =
      state.requestUsage.requestCountRecorded || safeRequestCount > 0
    state.pendingUsage = {
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCount: 0,
    }
    state.lastSnapshot = snapshot
    state.exhausted = Boolean(snapshot?.exhausted)
    return snapshot
  } catch (error) {
    if (!isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error)) {
      throw error
    }
    const saturatedReport = iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(
      state?.budgets,
    )
    state.pendingUsage = {
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCount: 0,
    }
    state.lastSnapshot = saturatedReport?.snapshot || state?.lastSnapshot || null
    state.exhausted = true
    if (state?.mutationLimiter?.active) {
      throw new IconoplasmAdminMutationLimiterActiveError(
        iconoplasmAdminMutationLimiterDetail(state, {
          stage: "in_flight",
          reason: "telemetry_locked_mid_run",
          telemetryLocked: true,
          telemetryLockedReason:
            "Cloudflare is already refusing Durable Objects writes, so the shared limiter ledger cannot safely accept more write-heavy admin work right now.",
        }),
      )
    }
    return state.lastSnapshot
  }
}

async function flushIconoplasmD1DailyBudgetUsageFromEnv(env) {
  const state = env?.[ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH]
  if (!state) return null
  return flushIconoplasmD1DailyBudgetPendingUsage(state)
}

function assertIconoplasmAdminMutationLimiterMayStart(state) {
  if (!state?.mutationLimiter?.active) return
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state)
  if (budgetStatus.rows_written_target_remaining === null) return
  if (budgetStatus.rows_written_target_remaining > 0) return
  throw new IconoplasmAdminMutationLimiterActiveError(
    iconoplasmAdminMutationLimiterDetail(state, {
      stage: "preflight",
      reason: "rows_written_target_cap_reached_before_start",
    }),
  )
}

async function iconoplasmD1DailyBudgetRecordUsage(state, { rowsRead = 0, rowsWritten = 0 } = {}) {
  const safeRowsRead = Math.max(0, Number(rowsRead || 0) || 0)
  const safeRowsWritten = Math.max(0, Number(rowsWritten || 0) || 0)
  if (safeRowsRead <= 0 && safeRowsWritten <= 0) {
    return iconoplasmD1DailyBudgetProjectedSnapshot(state) || state?.lastSnapshot || null
  }
  state.requestUsage.rowsRead += safeRowsRead
  state.requestUsage.rowsWritten += safeRowsWritten
  state.requestUsage.queryCount += 1
  state.pendingUsage.rowsRead += safeRowsRead
  state.pendingUsage.rowsWritten += safeRowsWritten
  state.pendingUsage.queryCount += 1
  if (!state.requestUsage.requestCountRecorded && state.pendingUsage.requestCount <= 0) {
    state.pendingUsage.requestCount = 1
  }
  const projectedSnapshot = iconoplasmD1DailyBudgetProjectedSnapshot(state)
  if (projectedSnapshot?.exhausted || iconoplasmD1DailyBudgetShouldFlushPendingUsage(state)) {
    const flushedSnapshot = await flushIconoplasmD1DailyBudgetPendingUsage(state)
    if (flushedSnapshot?.exhausted) {
      throw new IconoplasmD1DailyBudgetExceededError(flushedSnapshot)
    }
    return flushedSnapshot
  }
  state.exhausted = Boolean(projectedSnapshot?.exhausted)
  return projectedSnapshot
}

async function assertIconoplasmD1DailyBudgetStillAvailable(state) {
  const snapshot = iconoplasmD1DailyBudgetProjectedSnapshot(state) || state?.lastSnapshot || null
  if (state?.exhausted || snapshot?.exhausted) {
    throw new IconoplasmD1DailyBudgetExceededError(snapshot)
  }
}

function wrapIconoplasmD1PreparedStatementWithDailyBudgetKillSwitch(statement, state) {
  return {
    [RAW_ICONOPLASM_D1_PREPARED_STATEMENT_DO_NOT_DUPLICATE]: statement,
    bind(...args) {
      const bound = typeof statement.bind === "function" ? statement.bind(...args) : statement
      return wrapIconoplasmD1PreparedStatementWithDailyBudgetKillSwitch(bound, state)
    },
    async first(columnName) {
      // D1 accounting metadata is exposed on the full result object. If we call
      // first() directly here, rows_read can bypass the hard daily budget and we
      // are back to trusting alerts after the money is already gone.
      await assertIconoplasmD1DailyBudgetStillAvailable(state)
      const response = await statement.all()
      await iconoplasmD1DailyBudgetRecordUsage(state, {
        rowsRead: iconoplasmD1BudgetRowsReadFromMeta(response?.meta),
        rowsWritten: iconoplasmD1BudgetRowsWrittenFromMeta(response?.meta),
      })
      const row = Array.isArray(response?.results) ? response.results[0] || null : null
      if (columnName) return row ? (row[columnName] ?? null) : null
      return row
    },
    async all() {
      await assertIconoplasmD1DailyBudgetStillAvailable(state)
      const response = await statement.all()
      await iconoplasmD1DailyBudgetRecordUsage(state, {
        rowsRead: iconoplasmD1BudgetRowsReadFromMeta(response?.meta),
        rowsWritten: iconoplasmD1BudgetRowsWrittenFromMeta(response?.meta),
      })
      return response
    },
    async run() {
      await assertIconoplasmD1DailyBudgetStillAvailable(state)
      const response = await statement.run()
      await iconoplasmD1DailyBudgetRecordUsage(state, {
        rowsRead: iconoplasmD1BudgetRowsReadFromMeta(response?.meta),
        rowsWritten: iconoplasmD1BudgetRowsWrittenFromMeta(response?.meta),
      })
      return response
    },
    async raw() {
      throw new IconoplasmD1DailyBudgetConfigurationError(
        "raw() is not allowed on metered Iconoplasm D1 paths until explicit budget accounting is added",
      )
    },
  }
}

function wrapIconoplasmD1DatabaseWithDailyBudgetKillSwitch(db, state) {
  if (!db || typeof db.prepare !== "function") return db
  return {
    prepare(sql) {
      return wrapIconoplasmD1PreparedStatementWithDailyBudgetKillSwitch(db.prepare(sql), state)
    },
    async batch(statements) {
      await assertIconoplasmD1DailyBudgetStillAvailable(state)
      const rawStatements = Array.isArray(statements)
        ? statements.map(function (statement) {
            return statement?.[RAW_ICONOPLASM_D1_PREPARED_STATEMENT_DO_NOT_DUPLICATE] || statement
          })
        : []
      const results = await db.batch(rawStatements)
      let rowsRead = 0
      let rowsWritten = 0
      for (const result of Array.isArray(results) ? results : []) {
        rowsRead += iconoplasmD1BudgetRowsReadFromMeta(result?.meta)
        rowsWritten += iconoplasmD1BudgetRowsWrittenFromMeta(result?.meta)
      }
      await iconoplasmD1DailyBudgetRecordUsage(state, { rowsRead, rowsWritten })
      return results
    },
    async exec(query) {
      await assertIconoplasmD1DailyBudgetStillAvailable(state)
      const result = await db.exec(query)
      if (Array.isArray(result)) {
        let rowsRead = 0
        let rowsWritten = 0
        for (const item of result) {
          rowsRead += iconoplasmD1BudgetRowsReadFromMeta(item?.meta)
          rowsWritten += iconoplasmD1BudgetRowsWrittenFromMeta(item?.meta)
        }
        await iconoplasmD1DailyBudgetRecordUsage(state, { rowsRead, rowsWritten })
      } else {
        await iconoplasmD1DailyBudgetRecordUsage(state, {
          rowsRead: iconoplasmD1BudgetRowsReadFromMeta(result?.meta),
          rowsWritten: iconoplasmD1BudgetRowsWrittenFromMeta(result?.meta),
        })
      }
      return result
    },
  }
}

function iconoplasmD1DailyBudgetUsageSnapshotFromEnv(env) {
  const state = env?.[ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH]
  if (!state) return null
  return {
    rows_read_request: state.requestUsage?.rowsRead || 0,
    rows_written_request: state.requestUsage?.rowsWritten || 0,
    query_count_request: state.requestUsage?.queryCount || 0,
    route_family: state.attribution?.route_family || null,
    actor_class: state.attribution?.actor_class || null,
    source_class: state.attribution?.source_class || null,
    budget_snapshot: iconoplasmD1DailyBudgetProjectedSnapshot(state) || state.lastSnapshot || null,
  }
}

function iconoplasmAdminMutationLimiterSnapshotFromEnv(env) {
  const state = env?.[ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH]
  if (!state?.mutationLimiter?.active) return null
  const usage = iconoplasmD1DailyBudgetUsageSnapshotFromEnv(env) || null
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state)
  const policy = iconoplasmMutationLimiterPolicyFromEnv(state?.rawEnv)
  return {
    budget_basis: policy.budgetBasis,
    budget_basis_label: policy.budgetBasisLabel,
    target_daily_percent: budgetStatus.target_daily_percent || null,
    target_rows_written_ceiling: budgetStatus.target_rows_written_ceiling,
    rows_written_target_remaining: budgetStatus.rows_written_target_remaining,
    target_cap_reached: budgetStatus.target_cap_reached,
    budget_snapshot: budgetStatus.snapshot || usage?.budget_snapshot || null,
    rows_read_request: usage?.rows_read_request || 0,
    rows_written_request: usage?.rows_written_request || 0,
    query_count_request: usage?.query_count_request || 0,
    route_family: usage?.route_family || state?.attribution?.route_family || null,
    actor_class: usage?.actor_class || state?.attribution?.actor_class || null,
    source_class: usage?.source_class || state?.attribution?.source_class || null,
  }
}

function iconoplasmAdminMutationLimiterPolicyFromEnv(env) {
  const snapshot = iconoplasmAdminMutationLimiterSnapshotFromEnv(env)
  const budgetConfig = iconoplasmD1BudgetConfigFromEnv(env)
  const policy = iconoplasmMutationLimiterPolicyFromEnv(env)
  return {
    active: Boolean(snapshot || policy.active || budgetConfig),
    budget_basis: snapshot?.budget_basis || policy.budgetBasis,
    budget_basis_label: snapshot?.budget_basis_label || policy.budgetBasisLabel,
    target_daily_percent: snapshot?.target_daily_percent || policy.targetDailyPercent,
    explains_do_cap: policy.explainsDoCap,
    explanation: policy.explanation,
  }
}

async function iconoplasmAdminMutationLimiterPolicyWithSnapshotFromEnv(env) {
  const policy = iconoplasmAdminMutationLimiterPolicyFromEnv(env)
  const budgets = iconoplasmD1BudgetConfigFromEnv(env)
  const stub = iconoplasmD1DailyBudgetKillSwitchStub(env)
  if (!budgets || !stub) return policy

  let snapshot = null
  let telemetryLocked = false
  let telemetryLockedReason = ""
  try {
    snapshot = await iconoplasmD1DailyBudgetKillSwitchJson(stub, "/snapshot", {
      day_key: budgets.cycleInfo.dayKey,
      cycle_key: budgets.cycleInfo.cycleKey,
      budgets,
      days_remaining_in_cycle: budgets.cycleInfo.daysRemainingInCycle,
    })
  } catch (error) {
    if (!isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error)) {
      throw error
    }
    const saturated = iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets)
    snapshot = saturated?.snapshot || null
    telemetryLocked = true
    telemetryLockedReason =
      saturated?.telemetry_locked_reason || iconoplasmBudgetTelemetryLockedReason()
  }

  const state = {
    rawEnv: env,
    lastSnapshot: snapshot,
    mutationLimiter: {
      active: true,
      targetDailyPercent: iconoplasmMutationLimiterTargetDailyPercent(env),
      targetRowsWrittenCeiling: iconoplasmMutationLimiterTargetRowsWrittenCeiling(snapshot, env),
    },
  }
  const budgetStatus = iconoplasmMutationLimiterBudgetStatus(state, snapshot)
  return {
    ...policy,
    active: true,
    target_daily_percent: budgetStatus.target_daily_percent || policy.target_daily_percent,
    target_rows_written_ceiling: budgetStatus.target_rows_written_ceiling,
    rows_written_target_remaining: budgetStatus.rows_written_target_remaining,
    target_cap_reached: budgetStatus.target_cap_reached,
    budget_snapshot: budgetStatus.snapshot || snapshot || null,
    telemetry_locked: telemetryLocked,
    telemetry_locked_reason: telemetryLocked ? telemetryLockedReason : null,
  }
}

function iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets) {
  const dayKey = String(budgets?.cycleInfo?.dayKey || "")
  const cycleKey = String(budgets?.cycleInfo?.cycleKey || dayKey)
  const daysRemainingInCycle = Math.max(
    1,
    Number(budgets?.cycleInfo?.daysRemainingInCycle || 1) || 1,
  )
  const knownRowsWrittenFloor = 100000
  return {
    snapshot: {
      day_key: dayKey,
      cycle_key: cycleKey,
      rows_read: 0,
      rows_written: knownRowsWrittenFloor,
      query_count: 0,
      request_count: 0,
      cycle_rows_read: 0,
      cycle_rows_written: knownRowsWrittenFloor,
      cycle_query_count: 0,
      cycle_request_count: 0,
      rows_read_monthly_limit: Math.max(0, Number(budgets?.rowsReadMonthlyLimit || 0) || 0) || null,
      rows_written_monthly_limit:
        Math.max(0, Number(budgets?.rowsWrittenMonthlyLimit || 0) || 0) || null,
      rows_read_monthly_remaining: null,
      rows_written_monthly_remaining: null,
      rows_read_daily_smart_limit: null,
      rows_written_daily_smart_limit: knownRowsWrittenFloor,
      rows_read_daily_remaining: null,
      rows_written_daily_remaining: 0,
      days_remaining_in_cycle: daysRemainingInCycle,
      daily_burst_multiplier: Math.max(1, Number(budgets?.dailyBurstMultiplier || 1) || 1),
      exhausted: true,
      exhausted_by: "durable_object_rows_written_free_tier",
      updated_at: "",
    },
    cycle_days: [],
    daily_attribution: [],
    cycle_attribution: [],
    telemetry_locked: true,
    telemetry_locked_reason:
      "Cloudflare is already refusing Durable Objects writes for the day, so the detailed ledger cannot be read until reset. Reporting the known free-tier floor of 100,000 rows_written/day.",
  }
}

async function iconoplasmD1DailyBudgetReport(env, now = new Date()) {
  const budgets = iconoplasmD1BudgetConfigFromEnv(env, now)
  if (!budgets) return null
  const stub = iconoplasmD1DailyBudgetKillSwitchStub(env)
  if (!stub) {
    throw new IconoplasmD1DailyBudgetConfigurationError(
      "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE binding missing while budget reporting is enabled",
    )
  }
  try {
    return await iconoplasmD1DailyBudgetKillSwitchJson(stub, "/report", {
      day_key: budgets.cycleInfo.dayKey,
      cycle_key: budgets.cycleInfo.cycleKey,
      days_remaining_in_cycle: budgets.cycleInfo.daysRemainingInCycle,
      budgets,
    })
  } catch (error) {
    // Chesterton's fence: when the DO free-tier write cap is already blown,
    // asking the kill-switch object for a detailed report can fail before it can
    // read its own ledger. The admin GUI still needs an honest alarm state, so
    // return the known saturated floor instead of hiding the exhaustion behind a
    // useless 500.
    if (!isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error)) {
      throw error
    }
    return iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets)
  }
}

function iconoplasmBudgetTelemetryLockedReason() {
  return "Cloudflare is already refusing Durable Objects writes for the shared Iconoplasm budget ledger, so per-request preflight telemetry cannot be trusted right now."
}

async function wrapEnvWithIconoplasmD1DailyBudgetKillSwitch(env, request) {
  const budgets = iconoplasmD1BudgetConfigFromEnv(env)
  if (!budgets) return env
  const attribution = request ? iconoplasmD1BudgetAttributionFromRequest(request) : null
  if (!isIconoplasmHighRiskAdminMutationRouteFamily(attribution?.route_family)) {
    return env
  }
  const stub = iconoplasmD1DailyBudgetKillSwitchStub(env)
  if (!stub) {
    throw new IconoplasmD1DailyBudgetConfigurationError(
      "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE binding missing while smart monthly budgets are enabled",
    )
  }
  let snapshot
  try {
    snapshot = await iconoplasmD1DailyBudgetKillSwitchJson(stub, "/snapshot", {
      day_key: budgets.cycleInfo.dayKey,
      cycle_key: budgets.cycleInfo.cycleKey,
      budgets,
      days_remaining_in_cycle: budgets.cycleInfo.daysRemainingInCycle,
    })
  } catch (error) {
    if (!isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error)) {
      throw error
    }
    // Public serving has to stay up even when the shared DO ledger is already at
    // Cloudflare's daily write wall. In that state the telemetry barrier is gone,
    // so let non-mutation traffic keep flowing instead of turning every catalog
    // read into a fake outage. The one place we still fail closed is the exact
    // write-heavy admin mutation family that could make the day more expensive.
    if (!isIconoplasmHighRiskAdminMutationRouteFamily(attribution?.route_family)) {
      return env
    }
    throw new IconoplasmAdminMutationLimiterActiveError(
      iconoplasmAdminMutationLimiterDetail(
        {
          rawEnv: env,
          budgets,
          attribution,
          lastSnapshot:
            iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets)?.snapshot || null,
          mutationLimiter: {
            active: true,
            chunkSlowZoneRows: iconoplasmMutationLimiterChunkSlowZoneRows(
              iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets)?.snapshot || null,
            ),
            targetDailyPercent: iconoplasmMutationLimiterTargetDailyPercent(env),
            targetRowsWrittenCeiling: iconoplasmMutationLimiterTargetRowsWrittenCeiling(
              iconoplasmDurableObjectRowsWrittenFreeTierSaturatedReport(budgets)?.snapshot || null,
              env,
            ),
          },
        },
        {
          stage: "preflight",
          reason: "telemetry_locked_before_snapshot",
          telemetryLocked: true,
          telemetryLockedReason: iconoplasmBudgetTelemetryLockedReason(),
        },
      ),
    )
  }
  if (snapshot?.exhausted) {
    throw new IconoplasmD1DailyBudgetExceededError(snapshot)
  }
  const targetDailyPercent = iconoplasmMutationLimiterTargetDailyPercent(env)
  const targetRowsWrittenCeiling = iconoplasmMutationLimiterTargetRowsWrittenCeiling(snapshot, env)
  const state = {
    rawEnv: env,
    stub,
    budgets,
    dayKey: budgets.cycleInfo.dayKey,
    cycleKey: budgets.cycleInfo.cycleKey,
    daysRemainingInCycle: budgets.cycleInfo.daysRemainingInCycle,
    exhausted: false,
    lastSnapshot: snapshot,
    attribution,
    requestUsage: {
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCountRecorded: false,
    },
    pendingUsage: {
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCount: 0,
    },
    mutationLimiter: {
      active: isIconoplasmHighRiskAdminMutationRouteFamily(attribution?.route_family),
      chunkSlowZoneRows: iconoplasmMutationLimiterChunkSlowZoneRows(snapshot),
      targetDailyPercent,
      targetRowsWrittenCeiling,
    },
  }
  assertIconoplasmAdminMutationLimiterMayStart(state)
  return {
    ...env,
    ICONOPLASM_DB: wrapIconoplasmD1DatabaseWithDailyBudgetKillSwitch(env.ICONOPLASM_DB, state),
    [ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH]: state,
  }
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
    .replaceAll(
      "If an Iconoplasm image looks like your style, enter your name or @tag and send it.",
      "If an Iconoplasm image matches your style, send the artist tag exactly as shown on the site.",
    )
    .replaceAll("Artist name or @tag", "Artist tag")
    .replaceAll("Loish or @loish", "@artist_(name)")
    .replaceAll(
      "Use the name or @tag from the style list.",
      "Use the exact @tag as shown on the site. Spaces are not allowed.",
    )
    .replaceAll(
      "Use the exact tag from the emulsion or style list. Spaces are not allowed.",
      "Use the exact @tag as shown on the site. Spaces are not allowed.",
    )
    .replaceAll(
      "Enter the artist name or @tag first.",
      "Enter the artist tag first. Example: @artist_(name)",
    )
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
  return filename
    .replace(/\.json$/i, "")
    .replace(WORKFLOW_SUFFIX_RE, "")
    .trim()
}

function workflowLabelFromPath(raw) {
  const stem = workflowStem(raw)
  if (!stem) return ""
  const parts = stem.replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean)
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

function workflowIdentityFromVisionId(raw) {
  const visionId = normalizeVisionId(raw).toLowerCase()
  if (!visionId) return ""
  const match = visionId.match(/^([a-z0-9]+)-v\d+(?:-\d+)?$/)
  if (!match || !match[1]) return ""
  return match[1].slice(0, 1).toUpperCase()
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
    workflowIdentityFromVisionId(row?.requested_vision_id || row?.vision_id || "") ||
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
  if (workflowId && promptVersion && variantSlot)
    return `${workflowId}${promptVersion}-${variantSlot}`
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
  {
    symbol,
    assetSha256,
    visionId = "",
    candidateRef = "",
    candidateImageId = null,
    userId,
    voteValue,
  },
) {
  if (!env?.ICONOPLASM_DB) return
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256)
  const safeUserId = normalizeUserId(userId)
  const safeVoteValue = normalizeVoteValue(voteValue)
  if (!safeSymbol || !safeAssetSha || !safeUserId || safeVoteValue === null) return
  const safeCandidateRef =
    normalizeCandidateRef(candidateRef, safeSymbol, safeAssetSha) ||
    voteAssetIdentity(safeSymbol, safeAssetSha)
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

function externalPortraitCdnBase(env) {
  const raw = String(
    env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || env?.ICONOPLASM_PORTRAIT_CDN_BASE_URL || "",
  ).trim()
  return raw ? raw.replace(/\/+$/, "") : ""
}

function externalPortraitStorageZone(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE || "").trim()
}

function externalPortraitStorageHost(env) {
  const raw = String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST || "").trim()
  return raw || "storage.bunnycdn.com"
}

function externalPortraitStoragePassword(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD || "").trim()
}

function canReadExternalPortraitStorage(env) {
  return Boolean(externalPortraitCdnBase(env))
}

function canWriteExternalPortraitStorage(env) {
  return Boolean(
    externalPortraitStorageZone(env) &&
    externalPortraitStorageHost(env) &&
    externalPortraitStoragePassword(env),
  )
}

function externalPortraitPublicUrl(env, key) {
  const base = externalPortraitCdnBase(env)
  if (!base) return null
  return joinUrl(base, key)
}

function externalPortraitStorageWriteUrl(env, key) {
  const zone = externalPortraitStorageZone(env)
  const host = externalPortraitStorageHost(env)
  if (!zone || !host) return null
  return joinUrl(`https://${host}/${zone}`, key)
}

async function readPortraitStorageObject(env, key, { fallbackContentType = "image/webp" } = {}) {
  if (env.ICONOPLASM_PORTRAITS) {
    const object = await env.ICONOPLASM_PORTRAITS.get(key)
    if (!object) return null
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType || fallbackContentType,
      etag: object.httpEtag || key,
    }
  }
  const publicUrl = externalPortraitPublicUrl(env, key)
  if (!publicUrl) return null
  const response = await fetch(publicUrl)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`External portrait fetch failed (${response.status}) for ${key}`)
  }
  return {
    body: response.body,
    contentType: response.headers.get("content-type") || fallbackContentType,
    etag: response.headers.get("etag") || key,
  }
}

async function headPortraitStorageObject(env, key) {
  if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.head === "function") {
    return env.ICONOPLASM_PORTRAITS.head(key)
  }
  const writeUrl = externalPortraitStorageWriteUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!writeUrl || !password) return null
  const response = await fetch(writeUrl, {
    method: "HEAD",
    headers: {
      AccessKey: password,
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`External portrait HEAD failed (${response.status}) for ${key}`)
  }
  return { ok: true }
}

async function putPortraitStorageObject(
  env,
  key,
  bytes,
  { contentType = "application/octet-stream", cacheControl = "", customMetadata = null } = {},
) {
  if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.put === "function") {
    return env.ICONOPLASM_PORTRAITS.put(key, bytes, {
      httpMetadata: {
        contentType,
        ...(cacheControl ? { cacheControl } : {}),
      },
      ...(customMetadata ? { customMetadata } : {}),
    })
  }
  const writeUrl = externalPortraitStorageWriteUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!writeUrl || !password) {
    throw new Error("External portrait storage is not configured for writes")
  }
  const response = await fetch(writeUrl, {
    method: "PUT",
    headers: {
      AccessKey: password,
      "Content-Type": contentType,
      ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    },
    body: bytes,
  })
  if (!response.ok) {
    throw new Error(`External portrait PUT failed (${response.status}) for ${key}`)
  }
  return { ok: true }
}

async function deletePortraitStorageObject(env, key) {
  if (env.ICONOPLASM_PORTRAITS && typeof env.ICONOPLASM_PORTRAITS.delete === "function") {
    return env.ICONOPLASM_PORTRAITS.delete(key)
  }
  const writeUrl = externalPortraitStorageWriteUrl(env, key)
  const password = externalPortraitStoragePassword(env)
  if (!writeUrl || !password) return null
  const response = await fetch(writeUrl, {
    method: "DELETE",
    headers: {
      AccessKey: password,
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`External portrait DELETE failed (${response.status}) for ${key}`)
  }
  return { ok: true }
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
    portraitFingerprint.latest_updated_at ??
      portraitFingerprint.latest ??
      portraitFingerprint.content_hash ??
      "",
  )
  if (!count && !latest) return base
  return latest
    ? `${base}-${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}-${count}-${latest}`
    : `${base}-${PUBLISHED_PORTRAIT_SNAPSHOT_SCHEMA_VERSION}-${count}`
}

function catalogBaseHash(rawHash) {
  return (
    String(rawHash || "")
      .trim()
      .split("-")[0] || null
  )
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
    // Chesterton's fence: the hydrated catalog is the public read contract for
    // search, resolve, and extension refreshes. Keep it fed by the canonical
    // portrait refs (`ph`/`pt`) we own now instead of quietly accepting old
    // `r2_key_*` cargo from legacy snapshot shapes.
    const heroRef = String(row?.ph || "").trim()
    const thumbRef = String(row?.pt || "").trim()
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
    now - sharedPublishedPortraitFingerprintCache.loadedAt <
      PUBLISHED_PORTRAIT_FINGERPRINT_CACHE_TTL_MS
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
         ps.current_asset_sha256 AS asset_sha256
       FROM icono_publish_state ps
       LEFT JOIN icono_portrait_assets pa
         ON pa.gene_symbol = ps.gene_symbol
        AND pa.asset_sha256 = ps.current_asset_sha256
       WHERE ps.current_asset_sha256 IS NOT NULL
         AND pa.asset_sha256 IS NOT NULL`,
    ).all()
    return (Array.isArray(rows?.results) ? rows.results : [])
      .map((row) => {
        const symbol = normalizeSymbol(row?.symbol || row?.gene_symbol || "")
        const assetSha = normalizeSha256(row?.asset_sha256 || "")
        if (!symbol || !assetSha) return null
        return {
          symbol,
          ph: r2PortraitKey(assetSha, "full"),
          pt: r2PortraitKey(assetSha, "medium"),
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

async function publishedPortraitRefs(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return []
  if (fresh) return queryPublishedPortraitRefs(env)
  const version = portraitSnapshotVersion(await publishedPortraitFingerprint(env))
  if (
    publishedPortraitRefsCache.key === version &&
    Array.isArray(publishedPortraitRefsCache.value)
  ) {
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

function normalizeGenerationRequestKind(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  return value === "edit" || value === "edit_image" ? "edit_image" : "new_candidate"
}

function sanitizeGenerationRequestPrompt(raw) {
  return sanitizeText(raw || "", 2000) || ""
}

function buildGenerationRequestLaneKey({
  geneSymbol,
  requestMode,
  requestedVisionId,
  requestKind,
  requestPrompt,
  sourceGeneSymbol,
  sourceAssetSha256,
} = {}) {
  const symbol = normalizeSymbol(geneSymbol || "") || ""
  const mode = normalizeGenerationRequestMode(requestMode)
  const visionId = mode === "specific" ? sanitizeVoteVisionId(requestedVisionId || "") : ""
  const kind = normalizeGenerationRequestKind(requestKind)
  const prompt = sanitizeGenerationRequestPrompt(requestPrompt || "")
  const sourceSymbol = normalizeSymbol(sourceGeneSymbol || "") || ""
  const sourceAsset = normalizeSha256(sourceAssetSha256 || "") || ""
  return [
    symbol,
    kind,
    mode,
    visionId || "random",
    sourceSymbol || "none",
    sourceAsset || "none",
    prompt || "none",
  ].join("|")
}

function generationRequestVisionLabel(row) {
  const emulsionId = publicEmulsionIdForRow(row)
  if (emulsionId) return emulsionId
  const artistTag = sanitizeText(row?.requested_artist_tag || row?.artist_tag || "", 255) || ""
  if (artistTag) return artistTag
  const artistName = sanitizeText(row?.requested_artist_name || row?.artist_name || "", 255) || ""
  if (artistName) return artistName
  return sanitizeVoteVisionId(row?.requested_vision_id || row?.vision_id || "") || ""
}

function mapGenerationRequestRow(row) {
  const geneSymbol = normalizeSymbol(row?.gene_symbol || "") || ""
  const requestMode = normalizeGenerationRequestMode(row?.request_mode)
  const requestedVisionId =
    requestMode === "specific" ? sanitizeVoteVisionId(row?.requested_vision_id || "") : ""
  const requestKind = normalizeGenerationRequestKind(row?.request_kind || "")
  const requestPrompt = sanitizeGenerationRequestPrompt(row?.request_prompt || "")
  const sourceGeneSymbol = normalizeSymbol(row?.source_gene_symbol || "") || ""
  const sourceAssetSha = normalizeSha256(row?.source_asset_sha256 || "") || ""
  return {
    id: Number(row?.id || 0),
    gene_symbol: geneSymbol,
    full_name: sanitizeText(row?.full_name || "", 255) || "",
    requester_user_id: sanitizeText(row?.requester_user_id || "", 255) || "",
    requester_username: sanitizeText(row?.requester_username || "", 255) || "",
    request_kind: requestKind,
    request_prompt: requestPrompt,
    source_gene_symbol: sourceGeneSymbol,
    source_asset_sha256: sourceAssetSha,
    request_mode: requestMode,
    requested_vision_id: requestedVisionId,
    requested_emulsion_id: requestMode === "specific" ? publicEmulsionIdForRow(row) : "",
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
      requestKind,
      requestPrompt,
      sourceGeneSymbol,
      sourceAssetSha256: sourceAssetSha,
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
      request_kind: row.request_kind,
      request_prompt: row.request_prompt,
      source_gene_symbol: row.source_gene_symbol,
      source_asset_sha256: row.source_asset_sha256,
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
    return (
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      String(a.lane_key || "").localeCompare(String(b.lane_key || ""))
    )
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
  const cleanedLimit = Math.max(
    1,
    Math.min(2000, Number.parseInt(String(limit || "500"), 10) || 500),
  )
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
       COALESCE(avr.artist_tag, '') AS requested_artist_tag,
       COALESCE(avr.artist_name, '') AS requested_artist_name,
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
    requestKind = "new_candidate",
    requestPrompt = "",
    sourceGeneSymbol = "",
    sourceAssetSha256 = "",
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
  const kind = normalizeGenerationRequestKind(requestKind)
  const prompt = sanitizeGenerationRequestPrompt(requestPrompt || "")
  if (kind === "edit_image" && !prompt) {
    return { ok: false, error: "Describe the image correction before submitting an edit request." }
  }
  const sourceSymbolNorm = normalizeSymbol(sourceGeneSymbol || geneSymbol || "") || symbolNorm
  const sourceAssetNorm = normalizeSha256(sourceAssetSha256 || "") || ""
  const insertResp = await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_generation_requests (
       gene_symbol,
       requester_user_id,
       requester_username,
       request_kind,
       request_prompt,
       source_gene_symbol,
       source_asset_sha256,
       request_mode,
       requested_vision_id,
       status,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)`,
  )
    .bind(
      symbolNorm,
      requesterNorm,
      sanitizeText(requesterUsername || "", 255) || "",
      kind,
      prompt,
      sourceSymbolNorm,
      sourceAssetNorm,
      mode,
      visionNorm,
    )
    .run()
  const requestId = Number(insertResp?.meta?.last_row_id || 0)
  const created = requestId
    ? await env.ICONOPLASM_DB.prepare(
        `SELECT gr.*, COALESCE(gc.full_name, '') AS full_name
         , COALESCE(avr.emulsion_id, '') AS requested_emulsion_id
         , COALESCE(avr.artist_tag, '') AS requested_artist_tag
         , COALESCE(avr.artist_name, '') AS requested_artist_name
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

async function copyPortraitCandidateToGene(
  env,
  { sourceGeneSymbol, targetGeneSymbol, assetSha256, actorId } = {},
) {
  if (!env.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  const sourceSymbol = normalizeSymbol(sourceGeneSymbol || "") || ""
  const targetSymbol = normalizeSymbol(targetGeneSymbol || "") || ""
  const assetSha = normalizeSha256(assetSha256 || "") || ""
  const actorNorm = normalizeUserId(actorId || "") || "public_user"
  if (!sourceSymbol) return { ok: false, error: "Missing source gene symbol" }
  if (!targetSymbol) return { ok: false, error: "Missing target gene symbol" }
  if (!assetSha) return { ok: false, error: "Missing asset SHA" }
  if (sourceSymbol === targetSymbol) {
    return { ok: false, error: "Choose a different target gene." }
  }
  const targetRow = await env.ICONOPLASM_DB.prepare(
    // D1 cost fence: target symbols come from the normalized public search API.
    // Keep the equality raw so copy-to-gene does not become a catalog scan.
    `SELECT gene_symbol, COALESCE(full_name, '') AS full_name
     FROM icono_gene_catalog
     WHERE gene_symbol = ?
     LIMIT 1`,
  )
    .bind(targetSymbol)
    .first()
  if (!targetRow?.gene_symbol) return { ok: false, error: "Target gene not found" }

  const sourceRow = await env.ICONOPLASM_DB.prepare(
    // D1 cost fence: icono_portrait_assets primary key is (gene_symbol, asset_sha256).
    // Do not wrap either side in lower()/upper(); public copy writes must stay point lookups.
    `SELECT
       gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
       mime, width, height, bytes, status, autopick_eligible, is_stale, is_legacy,
       vision_id, emulsion_id, workflow_id, workflow_label, workflow_path, prompt_version, variant_slot,
       candidate_image_id, created_by
     FROM icono_portrait_assets
     WHERE gene_symbol = ?
       AND asset_sha256 = ?
       AND COALESCE(status, '') <> 'rejected'
     LIMIT 1`,
  )
    .bind(sourceSymbol, assetSha)
    .first()
  if (!sourceRow?.asset_sha256) return { ok: false, error: "Source candidate not found" }

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_portrait_assets (
       gene_symbol, asset_sha256, r2_key_full, r2_key_medium, r2_key_thumb,
       mime, width, height, bytes, status, autopick_eligible, is_stale, is_legacy,
       vision_id, emulsion_id, workflow_id, workflow_label, workflow_path, prompt_version, variant_slot,
       candidate_image_id, artist_tag, artist_name, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 1, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
       status=CASE WHEN COALESCE(icono_portrait_assets.status, '')='rejected' THEN 'approved' ELSE icono_portrait_assets.status END,
       autopick_eligible=1,
       is_stale=0,
       is_legacy=0,
       vision_id=COALESCE(icono_portrait_assets.vision_id, excluded.vision_id),
       emulsion_id=COALESCE(icono_portrait_assets.emulsion_id, excluded.emulsion_id),
       workflow_id=COALESCE(icono_portrait_assets.workflow_id, excluded.workflow_id),
       workflow_label=COALESCE(icono_portrait_assets.workflow_label, excluded.workflow_label),
       workflow_path=COALESCE(icono_portrait_assets.workflow_path, excluded.workflow_path),
       prompt_version=COALESCE(icono_portrait_assets.prompt_version, excluded.prompt_version),
       variant_slot=COALESCE(icono_portrait_assets.variant_slot, excluded.variant_slot),
       candidate_image_id=COALESCE(icono_portrait_assets.candidate_image_id, excluded.candidate_image_id)`,
  )
    .bind(
      targetSymbol,
      assetSha,
      String(sourceRow.r2_key_full || ""),
      String(sourceRow.r2_key_medium || ""),
      String(sourceRow.r2_key_thumb || ""),
      String(sourceRow.mime || "image/webp"),
      optionalInt(sourceRow.width),
      optionalInt(sourceRow.height),
      optionalInt(sourceRow.bytes),
      sanitizeVoteVisionId(sourceRow.vision_id || "") || null,
      sanitizeText(sourceRow.emulsion_id || "", 64) || null,
      sanitizeText(sourceRow.workflow_id || "", 32) || null,
      sanitizeText(sourceRow.workflow_label || "", 255) || null,
      sanitizeText(sourceRow.workflow_path || "", 512) || null,
      sanitizeText(sourceRow.prompt_version || "", 16) || null,
      sanitizeText(sourceRow.variant_slot || "", 32) || null,
      optionalInt(sourceRow.candidate_image_id),
      actorNorm,
    )
    .run()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_publish_events (gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason)
     VALUES (?, ?, ?, 'copy_candidate', ?, ?)`,
  )
    .bind(
      targetSymbol,
      null,
      assetSha,
      actorNorm,
      `Copied from ${sourceSymbol} by public copy-to-gene flow`,
    )
    .run()
  return {
    ok: true,
    source_gene_symbol: sourceSymbol,
    target_gene_symbol: targetSymbol,
    target_full_name: sanitizeText(targetRow.full_name || "", 255) || "",
    asset_sha256: assetSha,
    candidate_image_id: optionalInt(sourceRow.candidate_image_id),
    vision_id: sanitizeVoteVisionId(sourceRow.vision_id || "") || "",
  }
}

function generationRequestVisionOptionLabels(row) {
  const emulsionId = publicEmulsionIdForRow(row)
  const artistId = publicArtistIdForRow(row)
  const artistTag = sanitizeText(row?.artist_tag || "", 255) || ""
  const artistName = sanitizeText(row?.artist_name || "", 255) || ""
  const visionId = sanitizeVoteVisionId(row?.vision_id || "")
  const workflowLabel = sanitizeText(row?.workflow_label || "", 255) || ""
  const primaryLabel = emulsionId || artistTag || artistName || artistId || visionId
  const secondaryParts = []
  if (artistTag && artistTag !== primaryLabel) secondaryParts.push(artistTag)
  if (artistName && artistName !== primaryLabel && artistName !== artistTag)
    secondaryParts.push(artistName)
  if (artistId && artistId !== primaryLabel && artistId !== artistTag)
    secondaryParts.push(`artist ${artistId}`)
  if (workflowLabel && workflowLabel !== primaryLabel) secondaryParts.push(workflowLabel)
  if (visionId && visionId !== primaryLabel) secondaryParts.push(visionId)
  return {
    emulsionId,
    artistId,
    artistTag,
    artistName,
    visionId,
    primaryLabel: primaryLabel || "Specific emulsion",
    secondaryLabel: secondaryParts.join(" · "),
    searchText: [emulsionId, artistId, artistTag, artistName, workflowLabel, visionId]
      .filter(Boolean)
      .join(" "),
  }
}

function normalizeGenerationRequestPreviewAssetRow(row) {
  const assetSha = normalizeSha256(row?.asset_sha256 || "") || ""
  if (!assetSha) return null
  return {
    vision_id: validAdminRollupVisionId(row?.vision_id || "") || "",
    gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
    asset_sha256: assetSha,
    is_current: Number(row?.is_current || 0) > 0,
    preview_rank: Math.max(0, Number(row?.preview_rank || 0) || 0),
  }
}

function serializeGenerationRequestPreviewAssetsJson(previewRows) {
  const normalized = (Array.isArray(previewRows) ? previewRows : [])
    .map(normalizeGenerationRequestPreviewAssetRow)
    .filter(Boolean)
    .sort((left, right) => {
      return (
        Number(left.preview_rank || 0) - Number(right.preview_rank || 0) ||
        compareNullableTextAsc(left.asset_sha256, right.asset_sha256)
      )
    })
  return JSON.stringify(normalized)
}

function computeGenerationRequestVoteHIndex(upvoteCounts) {
  const counts = (Array.isArray(upvoteCounts) ? upvoteCounts : [])
    .map((value) => Math.max(0, Number(value || 0) || 0))
    .sort((left, right) => right - left)
  let hIndex = 0
  for (let index = 0; index < counts.length; index += 1) {
    const threshold = index + 1
    if (counts[index] < threshold) break
    hIndex = threshold
  }
  return hIndex
}

function parseGenerationRequestPreviewAssetsJson(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(String(raw))
    return (Array.isArray(parsed) ? parsed : [])
      .map(normalizeGenerationRequestPreviewAssetRow)
      .filter(Boolean)
  } catch {
    return []
  }
}

function materializeGenerationRequestPreviewAssetsForPublic(url, env, rawPreviewRows) {
  const base = portraitBase(url, env)
  return parseGenerationRequestPreviewAssetsJson(rawPreviewRows).map((row) => ({
    gene_symbol: row.gene_symbol,
    asset_sha256: row.asset_sha256,
    is_current: Boolean(row.is_current),
    preview_rank: Number(row.preview_rank || 0) || 0,
    medium_url: adminPortraitUrl(base, row.asset_sha256 || "", "medium"),
    thumb_url: adminPortraitUrl(base, row.asset_sha256 || "", "thumb"),
  }))
}

async function fetchGenerationRequestVisionPreviewRowsForRollup(
  env,
  { visionIds = [], perVisionLimit = 6 } = {},
) {
  if (!env.ICONOPLASM_DB) return []
  const cleanedVisionIds = Array.from(
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
  )
  if (!cleanedVisionIds.length) return []
  const cleanedLimit = normalizeAdminVisionAssetLimit(perVisionLimit, 6, 12)
  const response = await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     ),
     ranked_previews AS (
       SELECT
         pa.vision_id,
         pa.gene_symbol AS gene_symbol,
         pa.asset_sha256 AS asset_sha256,
         CASE
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current,
         ROW_NUMBER() OVER (
           PARTITION BY pa.vision_id
           ORDER BY
             CASE
               WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
               ELSE 0
             END DESC,
             COALESCE(vs.upvotes, 0) DESC,
             COALESCE(vs.score, 0) DESC,
             COALESCE(pa.created_at, '') DESC,
             pa.asset_sha256 ASC
         ) AS preview_rank
       FROM icono_portrait_assets pa
       JOIN incoming i
         ON i.vision_id = pa.vision_id
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = pa.gene_symbol
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = pa.gene_symbol
        AND vs.asset_sha256 = pa.asset_sha256
       -- Chesterton's fence: request-option previews are now identified by the
       -- canonical asset SHA and materialized into URLs later. Keep vision
       -- preview rollups keyed by vision_id plus asset_sha256 so we do not drop
       -- healthy previews just because old copied r2_key_* columns drifted.
       WHERE COALESCE(pa.asset_sha256, '') <> ''
     )
     SELECT
       vision_id,
       gene_symbol,
       asset_sha256,
       is_current,
       preview_rank
     FROM ranked_previews
     WHERE preview_rank <= ?
     ORDER BY vision_id ASC, preview_rank ASC`,
  )
    .bind(JSON.stringify(cleanedVisionIds), cleanedLimit)
    .all()
  return (Array.isArray(response?.results) ? response.results : [])
    .map(normalizeGenerationRequestPreviewAssetRow)
    .filter(Boolean)
}

async function fetchGenerationRequestVisionVoteHIndexMap(env, { visionIds = [] } = {}) {
  if (!env.ICONOPLASM_DB) return new Map()
  const cleanedVisionIds = Array.from(
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
  )
  if (!cleanedVisionIds.length) return new Map()
  const response = await env.ICONOPLASM_DB.prepare(
    `WITH incoming AS (
       SELECT value AS vision_id
       FROM json_each(?)
     )
     SELECT
       pa.vision_id,
       COALESCE(vs.upvotes, 0) AS upvotes
     FROM icono_portrait_assets pa
     JOIN incoming i
       ON i.vision_id = pa.vision_id
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE COALESCE(pa.vision_id, '') <> ''
     ORDER BY pa.vision_id ASC, COALESCE(vs.upvotes, 0) DESC, pa.asset_sha256 ASC`,
  )
    .bind(JSON.stringify(cleanedVisionIds))
    .all()
  const rows = Array.isArray(response?.results) ? response.results : []
  const upvoteMap = new Map()
  for (const row of rows) {
    const visionId = validAdminRollupVisionId(row?.vision_id || "")
    if (!visionId) continue
    const existing = upvoteMap.get(visionId) || []
    existing.push(Math.max(0, Number(row?.upvotes || 0) || 0))
    upvoteMap.set(visionId, existing)
  }
  const hIndexMap = new Map()
  for (const [visionId, counts] of upvoteMap.entries()) {
    hIndexMap.set(visionId, computeGenerationRequestVoteHIndex(counts))
  }
  for (const visionId of cleanedVisionIds) {
    if (!hIndexMap.has(visionId)) hIndexMap.set(visionId, 0)
  }
  return hIndexMap
}

async function rebuildGenerationRequestVisionOptionRollupsBatch(env, visionIds = []) {
  if (!env.ICONOPLASM_DB) return 0
  const cleanedVisionIds = Array.from(
    new Set(
      (Array.isArray(visionIds) ? visionIds : [])
        .map((value) => validAdminRollupVisionId(value))
        .filter(Boolean),
    ),
  )
  if (!cleanedVisionIds.length) return 0

  const placeholders = cleanedVisionIds.map(() => "?").join(", ")
  await env.ICONOPLASM_DB.prepare(
    `DELETE FROM icono_generation_request_vision_option_rollup
     WHERE vision_id IN (${placeholders})`,
  )
    .bind(...cleanedVisionIds)
    .run()

  const summaryResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       vision_id,
       emulsion_id,
       workflow_id,
       workflow_label,
       prompt_version,
       variant_slot,
       artist_tag,
       artist_name,
       image_count,
       live_count,
       score
     FROM icono_admin_vision_rollup
     WHERE vision_id IN (${placeholders})`,
  )
    .bind(...cleanedVisionIds)
    .all()
  const summaryRows = Array.isArray(summaryResp?.results) ? summaryResp.results : []
  if (!summaryRows.length) return 0

  const [previewRows, voteHIndexMap] = await Promise.all([
    fetchGenerationRequestVisionPreviewRowsForRollup(env, {
      visionIds: cleanedVisionIds,
      perVisionLimit: 5,
    }),
    fetchGenerationRequestVisionVoteHIndexMap(env, {
      visionIds: cleanedVisionIds,
    }),
  ])
  const previewMap = new Map()
  for (const previewRow of previewRows) {
    const visionId = sanitizeVoteVisionId(previewRow?.vision_id || "")
    if (!visionId) continue
    const existing = previewMap.get(visionId) || []
    existing.push(previewRow)
    previewMap.set(visionId, existing)
  }

  let written = 0
  for (const row of summaryRows) {
    const visionId = validAdminRollupVisionId(row?.vision_id || "")
    if (!visionId) continue
    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_generation_request_vision_option_rollup (
         vision_id,
         emulsion_id,
         workflow_id,
         workflow_label,
         prompt_version,
         variant_slot,
         artist_tag,
         artist_name,
         image_count,
         live_count,
         score,
         vote_h_index,
         preview_assets_json,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(vision_id) DO UPDATE SET
         emulsion_id = excluded.emulsion_id,
         workflow_id = excluded.workflow_id,
         workflow_label = excluded.workflow_label,
         prompt_version = excluded.prompt_version,
         variant_slot = excluded.variant_slot,
         artist_tag = excluded.artist_tag,
         artist_name = excluded.artist_name,
         image_count = excluded.image_count,
         live_count = excluded.live_count,
         score = excluded.score,
         vote_h_index = excluded.vote_h_index,
         preview_assets_json = excluded.preview_assets_json,
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
        Math.max(0, Number(row?.image_count || 0) || 0),
        Math.max(0, Number(row?.live_count || 0) || 0),
        Number(row?.score || 0) || 0,
        Math.max(0, Number(voteHIndexMap.get(visionId) || 0) || 0),
        serializeGenerationRequestPreviewAssetsJson(previewMap.get(visionId) || []),
      )
      .run()
    written += 1
  }
  return written
}

async function listGenerationRequestVisionOptions(env, url) {
  if (!env.ICONOPLASM_DB) return []
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       vision_id,
       emulsion_id,
       artist_tag,
       artist_name,
       workflow_id,
       workflow_label,
       prompt_version,
       variant_slot,
       image_count,
       live_count,
       score,
       vote_h_index,
       preview_assets_json
     FROM icono_generation_request_vision_option_rollup
     WHERE COALESCE(vision_id, '') <> ''
     ORDER BY vote_h_index DESC, live_count DESC, score DESC, image_count DESC, vision_id ASC
     LIMIT 120`,
  ).all()
  const rows = Array.isArray(resp?.results) ? resp.results : []
  const mapped = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const labels = generationRequestVisionOptionLabels(row)
      if (!labels.visionId) return null
      return {
        vision_id: labels.visionId,
        label: labels.primaryLabel,
        primary_label: labels.primaryLabel,
        secondary_label: labels.secondaryLabel,
        search_text: labels.searchText,
        emulsion_id: labels.emulsionId,
        artist_id: labels.artistId,
        artist_tag: labels.artistTag,
        artist_name: labels.artistName,
        image_count: Number(row?.image_count || 0),
        live_count: Number(row?.live_count || 0),
        score: Number(row?.score || 0),
        vote_h_index: Math.max(0, Number(row?.vote_h_index || 0) || 0),
        preview_assets: materializeGenerationRequestPreviewAssetsForPublic(
          url,
          env,
          row?.preview_assets_json || "[]",
        ),
      }
    })
    .filter(Boolean)
  return mapped
}

async function generationRequestSummaryPayload(env, request, symbol) {
  const normalized = normalizeSymbol(symbol || "")
  if (!normalized) return { ok: false, error: "Invalid symbol" }
  const sessionUser = await iconoplasmSessionUser(request, env)
  const userId = normalizeUserId(sessionUser?.user_id || "")
  const requestRows = await listOpenGenerationRequests(env, { limit: 500, geneSymbol: normalized })
  const myRows = sessionUser?.user_id
    ? requestRows.filter((row) => row.requester_user_id === userId)
    : []
  return {
    ok: true,
    authenticated: Boolean(sessionUser?.user_id),
    can_request: Boolean(sessionUser?.user_id),
    user: sessionUser?.user_id
      ? {
          id: userId,
          username: sessionUser.username || null,
        }
      : null,
    gene_symbol: normalized,
    my_lane_summary: summarizeGenerationRequestRows(myRows, { requesterUserId: userId }),
    gene_lane_summary: summarizeGenerationRequestRows(requestRows, { requesterUserId: userId }),
  }
}

async function generationRequestOptionsPayload(env, url, request) {
  const sessionUser = await iconoplasmSessionUser(request, env)
  if (!sessionUser?.user_id) {
    return {
      ok: false,
      status: 401,
      code: "AUTH_REQUIRED",
      error: "Please log in first to request new candidates.",
    }
  }
  return {
    ok: true,
    authenticated: true,
    can_request: true,
    user: {
      id: normalizeUserId(sessionUser.user_id || "") || null,
      username: sessionUser.username || null,
    },
    request_options: await listGenerationRequestVisionOptions(env, url),
  }
}

async function generationRequestDiagnostics(env, url, request, symbol) {
  const normalized = normalizeSymbol(symbol || "")
  if (!normalized) return { ok: false, error: "Invalid symbol" }
  const sessionUser = await iconoplasmSessionUser(request, env)
  const requestRows = await listOpenGenerationRequests(env, { limit: 500, geneSymbol: normalized })
  const result = {
    ok: true,
    gene_symbol: normalized,
    authenticated: Boolean(sessionUser?.user_id),
    requester_user_id: normalizeUserId(sessionUser?.user_id || "") || null,
    open_request_count: Array.isArray(requestRows) ? requestRows.length : 0,
    lane_count: summarizeGenerationRequestRows(requestRows, {
      requesterUserId: normalizeUserId(sessionUser?.user_id || ""),
    }).length,
    request_options: {
      ok: true,
      count: 0,
      sample: [],
    },
  }
  try {
    const options = await listGenerationRequestVisionOptions(env, url)
    result.request_options = {
      ok: true,
      count: Array.isArray(options) ? options.length : 0,
      sample: (Array.isArray(options) ? options : []).slice(0, 8).map((option) => ({
        vision_id: sanitizeVoteVisionId(option?.vision_id || "") || "",
        label: sanitizeText(option?.label || "", 255) || "",
        secondary_label: sanitizeText(option?.secondary_label || "", 255) || "",
        preview_count: Array.isArray(option?.preview_assets) ? option.preview_assets.length : 0,
      })),
    }
  } catch (error) {
    result.ok = false
    result.request_options = {
      ok: false,
      error:
        sanitizeText(error?.message || "Request option hydration failed", 500) ||
        "Request option hydration failed",
      count: 0,
      sample: [],
    }
  }
  return result
}

async function fulfillGenerationRequests(
  env,
  { items = [], resolvedBy = "workstation_sync" } = {},
) {
  if (!env.ICONOPLASM_DB)
    return { ok: false, fulfilled: 0, request_ids: [], error: "ICONOPLASM_DB binding missing" }
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
           AND gene_symbol = ?
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
    const fulfilledVisionId = sanitizeVoteVisionId(
      rawItem.fulfilled_vision_id || rawItem.vision_id || "",
    )
    const fulfilledAssetSha =
      normalizeSha256(rawItem.fulfilled_asset_sha256 || rawItem.asset_sha256 || "") || ""
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
  if (!userIdNorm || isGuestUserId(userIdNorm))
    return { ok: false, error: "Authentication required" }
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

async function listUserGeneDiscoveries(
  env,
  { userId, limit = 5000, order = "newest", seed = null } = {},
) {
  if (!env.ICONOPLASM_DB) return []
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return []
  const cleanedLimit = Math.max(
    1,
    Math.min(10000, Number.parseInt(String(limit || "5000"), 10) || 5000),
  )
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

const ACCOUNT_GALLERY_WINDOW_SCHEMA = "iconoplasm.accountGalleryWindow.v1"
const ACCOUNT_GALLERY_WINDOW_LIMIT_MAX = 48
const ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS = new Set(["newest", "symbol"])

// Account windows are one signed-in shelf path, not the global gallery model.
// Only these supported orders can use this cursor shape. Other personal-shelf
// orders are loaded from discovery rows and ordered elsewhere, so card caches
// must not assume a single universal sequence.
function encodeAccountGalleryCursor(cursor) {
  if (!cursor || typeof cursor !== "object") return ""
  try {
    return btoa(JSON.stringify(cursor))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/g, "")
  } catch {
    return ""
  }
}

function decodeAccountGalleryCursor(raw) {
  const value = sanitizeText(raw || "", 2048)
  if (!value) return null
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=")
    const parsed = JSON.parse(atob(padded))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function accountGalleryWindowCursorForRow(row, order) {
  const symbol = normalizeSymbol(row?.gene_symbol || "")
  if (!symbol) return null
  if (order === "symbol") {
    return {
      order,
      symbol,
    }
  }
  return {
    order: "newest",
    last_encountered_at:
      sanitizeText(row?.last_encountered_at || row?.first_discovered_at || "", 64) || "",
    symbol,
  }
}

async function listUserGeneDiscoveryWindow(
  env,
  { userId, limit = 24, order = "newest", cursor = null } = {},
) {
  if (!env.ICONOPLASM_DB) return { rows: [], hasMore: false, nextCursor: "" }
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) {
    return { rows: [], hasMore: false, nextCursor: "" }
  }
  const resolvedOrder = normalizeIconoplasmHomeOrder(order, "newest")
  if (!ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS.has(resolvedOrder)) {
    return {
      rows: [],
      hasMore: false,
      nextCursor: "",
      unsupportedOrder: resolvedOrder,
    }
  }
  const cleanedLimit = Math.max(
    1,
    Math.min(ACCOUNT_GALLERY_WINDOW_LIMIT_MAX, Number.parseInt(String(limit || "24"), 10) || 24),
  )
  const fetchLimit = cleanedLimit + 1
  const decodedCursor = decodeAccountGalleryCursor(cursor)
  const selectSql = `SELECT
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
     WHERE d.user_id = ?`
  let rowsResult
  if (resolvedOrder === "symbol") {
    const cursorSymbol =
      decodedCursor && decodedCursor.order === "symbol"
        ? normalizeSymbol(decodedCursor.symbol || "")
        : ""
    const whereCursor = cursorSymbol ? " AND d.gene_symbol > ?" : ""
    const sql = `${selectSql}${whereCursor}
     ORDER BY d.gene_symbol ASC
     LIMIT ?`
    const statement = env.ICONOPLASM_DB.prepare(sql)
    rowsResult = cursorSymbol
      ? await statement.bind(userIdNorm, cursorSymbol, fetchLimit).all()
      : await statement.bind(userIdNorm, fetchLimit).all()
  } else {
    const cursorTime =
      decodedCursor && decodedCursor.order === "newest"
        ? sanitizeText(decodedCursor.last_encountered_at || "", 64)
        : ""
    const cursorSymbol =
      decodedCursor && decodedCursor.order === "newest"
        ? normalizeSymbol(decodedCursor.symbol || "")
        : ""
    const whereCursor =
      cursorTime && cursorSymbol
        ? " AND (d.last_encountered_at < ? OR (d.last_encountered_at = ? AND d.gene_symbol > ?))"
        : ""
    const sql = `${selectSql}${whereCursor}
     ORDER BY d.last_encountered_at DESC, d.gene_symbol ASC
     LIMIT ?`
    const statement = env.ICONOPLASM_DB.prepare(sql)
    rowsResult =
      cursorTime && cursorSymbol
        ? await statement.bind(userIdNorm, cursorTime, cursorTime, cursorSymbol, fetchLimit).all()
        : await statement.bind(userIdNorm, fetchLimit).all()
  }
  const allRows = (Array.isArray(rowsResult?.results) ? rowsResult.results : []).map(
    mapGeneDiscoveryRow,
  )
  const pageRows = allRows.slice(0, cleanedLimit)
  const hasMore = allRows.length > cleanedLimit
  const lastRow = pageRows[pageRows.length - 1] || null
  return {
    rows: pageRows,
    hasMore,
    nextCursor: hasMore
      ? encodeAccountGalleryCursor(accountGalleryWindowCursorForRow(lastRow, resolvedOrder))
      : "",
    unsupportedOrder: "",
  }
}

async function countUserGeneDiscoveries(env, { userId } = {}) {
  if (!env.ICONOPLASM_DB) return 0
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return 0
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS discovered_count
     FROM icono_gene_discoveries
     WHERE user_id = ?`,
  )
    .bind(userIdNorm)
    .first()
  return Math.max(0, Number(row?.discovered_count || 0) || 0)
}

async function listAllCatalogGeneDiscoveriesForAdmin(
  env,
  { userId, limit = 5000, order = "newest", seed = null } = {},
) {
  if (!env.ICONOPLASM_DB) return []
  const userIdNorm = normalizeUserId(userId || "")
  if (!userIdNorm || isGuestUserId(userIdNorm)) return []
  const cleanedLimit = Math.max(
    1,
    Math.min(10000, Number.parseInt(String(limit || "5000"), 10) || 5000),
  )
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

async function mergeGuestGeneDiscoveries(env, { userId, symbols = [] } = {}) {
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
     WHERE gene_symbol = ?
       AND asset_sha256 = ?
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
     WHERE gene_symbol = ?
       AND asset_sha256 = ?
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

async function resolveArtistBlacklistSubmissions(env, { results = [], resolvedBy = "" } = {}) {
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

async function resolveLocalRemovalRequests(env, { results = [], resolvedBy = "" } = {}) {
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
    cleaned = cleaned
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
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

function hasAdminTokenCredentialPresent(request) {
  const fromHeader = String(request.headers.get("x-iconoplasm-admin-token") || "").trim()
  const authHeader = String(request.headers.get("Authorization") || "").trim()
  const fromBearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : ""
  return Boolean(fromHeader || fromBearer)
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
      stats: publicUrl(url, "/stats"),
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

async function logReq(route, request, status, started, schema = null, usage = null) {
  console.log(
    JSON.stringify({
      service: "iconoplasm",
      route,
      status,
      latency_ms: Date.now() - started,
      schema_version: schema,
      ext_version: extVersion(request),
      method: request.method,
      ...(usage || {}),
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
  // Chesterton's fence: publish the extension contract explicitly here instead of
  // making the browser runtime infer it from mixed legacy fields and fallbacks.
  // Earlier extension code guessed from `schema_version`, guessed from missing
  // portrait_base_url, and then limped along on stale cache when the published
  // shape drifted. That is exactly the kind of quiet mismatch that lets a broken
  // release look healthy. Keep the manifest blunt about the artifact schema and
  // minimum extension version so incompatible clients fail loud.
  const buildVersion = buildPortraitAwareManifestHash(
    manifest.current_hash,
    await sharedPublishedPortraitFingerprint(env),
  )
  const minExtensionVersion = env.ICONOPLASM_MIN_EXTENSION_VERSION || MIN_EXTENSION_VERSION
  const artifactSchemaVersion = 4
  return {
    ...manifest,
    current_hash: buildVersion,
    build_version: buildVersion,
    catalog_hash: catalogBaseHash(buildVersion),
    artifact_schema_version: artifactSchemaVersion,
    schema_version: artifactSchemaVersion,
    min_extension_version: minExtensionVersion,
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

const ICONOPLASM_INTERNAL_STATEFUL_WORKER_REQUEST_HEADER_DO_NOT_DUPLICATE =
  "x-iconoplasm-only-allowed-stateful-worker-internal"
const ICONOPLASM_CANON_REPAIR_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER =
  "/__internal/iconoplasm/repair-canon-invariants"
const ICONOPLASM_VOTE_PROJECTION_REFRESH_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER =
  "/__internal/iconoplasm/process-vote-projection-refresh"
const ICONOPLASM_SYNC_FINALIZATION_PROCESS_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER =
  "/__internal/iconoplasm/process-sync-finalization"

function isInternalRequestForTheOnlyAllowedStatefulWorker(request) {
  return (
    String(
      request?.headers?.get(ICONOPLASM_INTERNAL_STATEFUL_WORKER_REQUEST_HEADER_DO_NOT_DUPLICATE) ||
        "",
    ) === "1"
  )
}

function isIconoplasmCanonRepairRequestForTheOnlyAllowedStatefulWorker(path, method = "GET") {
  return (
    path === ICONOPLASM_CANON_REPAIR_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER &&
    String(method || "GET").toUpperCase() === "POST"
  )
}

function isIconoplasmVoteProjectionRefreshRequestForTheOnlyAllowedStatefulWorker(
  path,
  method = "GET",
) {
  return (
    path === ICONOPLASM_VOTE_PROJECTION_REFRESH_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER &&
    String(method || "GET").toUpperCase() === "POST"
  )
}

function isIconoplasmSyncFinalizationProcessRequestForTheOnlyAllowedStatefulWorker(
  path,
  method = "GET",
) {
  return (
    path === ICONOPLASM_SYNC_FINALIZATION_PROCESS_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER &&
    String(method || "GET").toUpperCase() === "POST"
  )
}

function isIconoplasmPathHandledInsideTheOnlyAllowedStatefulWorker(path, method = "GET") {
  const requestMethod = String(method || "GET").toUpperCase()
  if (!["GET", "HEAD", "POST"].includes(requestMethod)) return false
  if (path === "/health" || path === "/api/health") return true
  if (path === "/admin") return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/blocklist") return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/blocklist/" || path === "/artist-styles" || path === "/artist-styles/") {
    return requestMethod === "GET" || requestMethod === "HEAD"
  }
  if (path === publicApiPath("/metadata")) return true
  if (path === publicApiPath("/stats")) return true
  if (path === publicApiPath("/catalog/manifest")) return true
  if (isPublicCatalogArtifactPath(path)) return true
  if (path.startsWith(publicApiPath("/dumps/catalog.")) && path.endsWith(".jsonl")) return true
  if (path === publicApiPath("/gallery")) return true
  if (path === publicApiPath("/genes/search")) return true
  if (path === publicApiPath("/genes/batch")) return requestMethod === "POST"
  if (path === "/api/iconoplasm/mobile-card-manifest") return requestMethod === "POST"
  if (path.startsWith(publicApiPath("/genes/"))) return true
  if (path === publicApiPath("/resolve")) return true
  if (path === publicApiPath("/changes")) return true
  if (path.startsWith(publicApiPath("/media/"))) return true
  if (path.startsWith("/portraits/")) return true
  if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) return true
  if (path === "/api/iconoplasm/votes/me")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/discoveries/encounter") return requestMethod === "POST"
  if (path === "/api/iconoplasm/discoveries/me")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/account-gallery-window")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/discoveries/merge") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/me")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(path))
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/requests/options")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+$/.test(path))
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/requests") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/requests/open")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/requests/fulfill") return requestMethod === "POST"
  if (path === "/api/iconoplasm/candidates/copy") return requestMethod === "POST"
  if (path === "/api/iconoplasm/votes/set") return requestMethod === "POST"
  if (path === "/api/iconoplasm/votes/snapshot") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/import") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/set") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/snapshot") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/snapshots") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/ledger")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/votes/events")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/votes/vision-stats")
    return requestMethod === "GET" || requestMethod === "HEAD" || requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/vision-previews")
    return requestMethod === "GET" || requestMethod === "HEAD" || requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/votes/vision-detail")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/votes/projection-refresh/pending")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === ICONOPLASM_VOTE_PROJECTION_REFRESH_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER)
    return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/finalization/pending")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/finalization/enqueue") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/finalization/kick") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/finalization/process") return requestMethod === "POST"
  if (path === ICONOPLASM_SYNC_FINALIZATION_PROCESS_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER)
    return requestMethod === "POST"
  if (path === "/api/iconoplasm/artist-styles/search")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/artist-blacklist-submissions") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/artist-styles/remove") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/pending")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/artist-blacklist-submissions/ack")
    return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/read-models/sync") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/card-vms/warm") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/read-models/bootstrap") return true
  if (path === "/api/iconoplasm/admin/mutation-limiter/policy")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/overview")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/cost/usage" || path === "/api/iconoplasm/admin/cost/snapshot")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (/^\/api\/iconoplasm\/admin\/requests\/gene\/[^/]+\/diagnostics$/.test(path))
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/coverage")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/public-stats/audit")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/gallery")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (/^\/api\/iconoplasm\/admin\/gene\/[^/]+$/.test(path))
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/canon-audit")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/assets")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/assets/summary")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/assets/storage-audit") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/assets/repair-scope") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/assets/state")
    return requestMethod === "GET" || requestMethod === "HEAD" || requestMethod === "POST"
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
    ].includes(path)
  ) {
    return requestMethod === "POST"
  }
  if (path === "/api/iconoplasm/admin/local-removals/pending")
    return requestMethod === "GET" || requestMethod === "HEAD"
  if (path === "/api/iconoplasm/admin/local-removals/ack") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/catalog/state")
    return requestMethod === "GET" || requestMethod === "HEAD" || requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/catalog/upsert") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/catalog/reconcile") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/catalog/publish") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/essence/upsert") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/essence/state") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/ingest") return requestMethod === "POST"
  if (path === "/api/iconoplasm/admin/reconcile") return requestMethod === "POST"
  return false
}

function missingTheOnlyAllowedStatefulWorkerResponse() {
  return json(
    {
      error:
        "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE binding missing for a fail-closed public route",
      code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED",
    },
    503,
    { "Cache-Control": "no-store" },
  )
}

async function proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env) {
  // BILLING / CAPABILITY BARRIER: these Iconoplasm routes must go
  // through THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE. If you are tempted to point these
  // paths back at raw ICONOPLASM_DB.prepare(...), stop and read the
  // cost-barrier tests first.
  const theOnlyAllowedStatefulWorker = env?.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE
  const url = new URL(request.url)
  if (!isIconoplasmPathHandledInsideTheOnlyAllowedStatefulWorker(url.pathname, request.method))
    return null
  if (!theOnlyAllowedStatefulWorker || typeof theOnlyAllowedStatefulWorker.fetch !== "function") {
    return missingTheOnlyAllowedStatefulWorkerResponse()
  }
  const upstreamRequest = new Request(
    `https://the-only-allowed-internal-stateful-worker-do-not-duplicate${url.pathname}${url.search}`,
    {
      method: request.method,
      headers: request.headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.clone().text(),
    },
  )
  try {
    return await theOnlyAllowedStatefulWorker.fetch(upstreamRequest)
  } catch {
    return json(
      {
        error: "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE request failed",
        code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_UNAVAILABLE",
      },
      503,
      { "Cache-Control": "no-store" },
    )
  }
}

export async function handleIconoplasmGatewayRequest(request, env) {
  return proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env)
}

export async function runIconoplasmCanonMaintenanceThroughTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  env,
  { limit = 250, actorId = "system", reason = "" } = {},
) {
  const theOnlyAllowedStatefulWorker = env?.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE
  if (!theOnlyAllowedStatefulWorker || typeof theOnlyAllowedStatefulWorker.fetch !== "function") {
    throw new Error(
      "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE binding missing for canon maintenance",
    )
  }
  const response = await theOnlyAllowedStatefulWorker.fetch(
    new Request(
      `https://the-only-allowed-internal-stateful-worker-do-not-duplicate${ICONOPLASM_CANON_REPAIR_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit, actorId, reason }),
      },
    ),
  )
  if (!response.ok) {
    let detail = ""
    try {
      detail = await response.text()
    } catch {}
    throw new Error(
      `THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE canon maintenance failed (${response.status})${detail ? `: ${detail}` : ""}`,
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
    artifact_schema_version: manifest.artifact_schema_version || manifest.schema_version || 1,
    min_extension_version:
      manifest.min_extension_version ||
      env.ICONOPLASM_MIN_EXTENSION_VERSION ||
      MIN_EXTENSION_VERSION,
    portrait_base_url: manifest.portrait_base_url || portraitBase(url, env),
    urls: {
      metadata: publicUrl(url, "/metadata"),
      stats: publicUrl(url, "/stats"),
      schema: publicUrl(url, "/schema"),
      catalog_manifest: publicUrl(url, "/catalog/manifest"),
      catalog_artifact: buildHash ? `${url.origin}${publicCatalogArtifactPath(buildHash)}` : null,
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

async function fetchCatalogStateRows(env, requestedSymbols = null) {
  if (!env.ICONOPLASM_DB) return []
  const wantedSymbols = Array.isArray(requestedSymbols)
    ? requestedSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)
    : []
  let results = []
  if (wantedSymbols.length && wantedSymbols.length <= 1000) {
    const placeholders = wantedSymbols.map(() => "?").join(", ")
    const response = await env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json
         FROM icono_gene_catalog
        WHERE gene_symbol IN (${placeholders})
        ORDER BY gene_symbol ASC`,
    )
      .bind(...wantedSymbols)
      .all()
    results = Array.isArray(response?.results) ? response.results : []
  } else {
    const response = await env.ICONOPLASM_DB.prepare(
      `WITH incoming_scope AS (
         SELECT value AS gene_symbol
         FROM json_each(?)
       )
       SELECT gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json
         FROM icono_gene_catalog
        WHERE (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM incoming_scope))
        ORDER BY gene_symbol ASC`,
    )
      .bind(JSON.stringify(wantedSymbols), wantedSymbols.length > 0 ? 1 : 0)
      .all()
    results = Array.isArray(response?.results) ? response.results : []
  }
  const out = []
  for (const row of results) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol) continue
    out.push({
      symbol,
      content_hash: await hashCatalogItems([
        {
          gene_symbol: symbol,
          full_name: sanitizeText(row?.full_name || "", 255) || "",
          uniprot: normalizeUniprot(row?.uniprot || "") || "",
          color_hex: normalizeHexColor(row?.color_hex || "") || "",
          tmh: Number(row?.tmh || 0) > 0,
          aliases_json: String(row?.aliases_json || "[]"),
        },
      ]),
    })
  }
  return out
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
        WHERE gene_symbol IN (${placeholders})
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

async function fetchAssetStateRows(env, requestedSymbols = null) {
  if (!env.ICONOPLASM_DB) return []
  const wantedSymbols = Array.isArray(requestedSymbols)
    ? requestedSymbols.map((value) => normalizeSymbol(value)).filter(Boolean)
    : []
  const applyScope = wantedSymbols.length > 0 ? 1 : 0
  const response = await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     ),
     scoped_assets AS (
       SELECT *
       FROM icono_portrait_assets
       WHERE (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM incoming_scope))
     ),
     scoped_votes AS (
       SELECT
         candidate_ref,
         COALESCE(SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
         COALESCE(SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
         COALESCE(SUM(vote_value), 0) AS score
       FROM icono_image_votes
       WHERE (? = 0 OR candidate_ref IN (
         SELECT 'a:' || gene_symbol || '|' || asset_sha256
         FROM scoped_assets
       ))
       GROUP BY candidate_ref
     )
     SELECT
       sa.gene_symbol,
       sa.asset_sha256,
       sa.candidate_image_id,
       sa.vision_id,
       sa.emulsion_id,
       sa.workflow_id,
       sa.workflow_label,
       sa.workflow_path,
       sa.prompt_version,
       sa.variant_slot,
       sa.artist_tag,
       sa.artist_name,
       sa.status,
       COALESCE(sa.is_stale, 0) AS is_stale,
       COALESCE(sa.is_legacy, 0) AS is_legacy,
       COALESCE(v.upvotes, 0) AS image_upvotes,
       COALESCE(v.downvotes, 0) AS image_downvotes,
       COALESCE(v.score, 0) AS image_score
     FROM scoped_assets sa
     LEFT JOIN scoped_votes v
       ON v.candidate_ref = ('a:' || sa.gene_symbol || '|' || sa.asset_sha256)
     ORDER BY sa.gene_symbol ASC, sa.asset_sha256 ASC`,
  )
    .bind(JSON.stringify(wantedSymbols), applyScope, applyScope)
    .all()
  return Array.isArray(response?.results) ? response.results : []
}

const ICONO_WEBSITE_TRUTH_SUMMARY_KEY = "iconoplasm_website_truth_summary"
const ICONO_STORAGE_AUDIT_QUEUE_KEY = "iconoplasm_storage_audit"
const ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH = 200
// Cloudflare gives each invocation a finite request budget. Each audited asset
// costs three storage HEADs plus the queue bookkeeping around it, so keep a
// single pass intentionally small and make progress across repeated clicks.
const ICONO_STORAGE_AUDIT_SAFE_INSPECTION_BATCH = 8
// Each asset probes full + medium + thumb. Two assets at a time keeps the
// Worker on the documented six-open-connections ceiling instead of pointlessly
// stampeding Bunny/Cloudflare with eighteen parallel HEADs.
const ICONO_STORAGE_AUDIT_INSPECT_CONCURRENCY = 2

function normalizeAdminAssetMaintenanceSymbols(rawSymbols, max = 5000) {
  const values = Array.isArray(rawSymbols) ? rawSymbols : []
  if (values.length > max) {
    throw new Error(`Too many symbols (max ${max})`)
  }
  return Array.from(new Set(values.map((value) => normalizeSymbol(value)).filter(Boolean)))
}

function normalizeAdminAssetMaintenanceLimit(rawLimit, fallback = 50, max = 500) {
  const value = Number.parseInt(String(rawLimit ?? fallback), 10)
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.min(max, value || fallback))
}

function parseAdminAssetMissingRenditions(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"))
    return Array.isArray(parsed)
      ? Array.from(
          new Set(
            parsed
              .map((value) =>
                String(value || "")
                  .trim()
                  .toLowerCase(),
              )
              .filter((value) => ["full", "medium", "thumb"].includes(value)),
          ),
        )
      : []
  } catch {
    return []
  }
}

function normalizeStorageAuditInspectionLimit(rawLimit, fallback = 100) {
  const requested = normalizeAdminAssetMaintenanceLimit(rawLimit, fallback, 500)
  return Math.max(1, Math.min(ICONO_STORAGE_AUDIT_SAFE_INSPECTION_BATCH, requested))
}

function mapWebsiteTruthSummaryRow(row) {
  return {
    candidate_assets: Math.max(0, Number(row?.candidate_assets || 0)),
    catalog_candidate_assets: Math.max(0, Number(row?.catalog_candidate_assets || 0)),
    stale_assets: Math.max(0, Number(row?.stale_assets || 0)),
    legacy_assets: Math.max(0, Number(row?.legacy_assets || 0)),
    auditable_assets: Math.max(0, Number(row?.auditable_assets || 0)),
    catalog_auditable_assets: Math.max(0, Number(row?.catalog_auditable_assets || 0)),
    catalog_published_live_portraits: Math.max(
      0,
      Number(row?.catalog_published_live_portraits || 0),
    ),
    published_live_portraits: Math.max(0, Number(row?.published_live_portraits || 0)),
    audited_assets: Math.max(0, Number(row?.audited_assets || 0)),
    verified_renderable_images: Math.max(0, Number(row?.verified_renderable_images || 0)),
    storage_audit_coverage_percent: Number(row?.storage_audit_coverage_percent || 0),
    storage_incomplete_assets: Math.max(0, Number(row?.storage_incomplete_assets || 0)),
    broken_live_images: Math.max(0, Number(row?.broken_live_images || 0)),
    renderable_live_confirmed: Math.max(0, Number(row?.renderable_live_confirmed || 0)),
    unverified_live_portraits: Math.max(0, Number(row?.unverified_live_portraits || 0)),
    renderable_live_exact_known: Number(row?.renderable_live_exact_known || 0) > 0,
    last_exact_audit_total:
      row?.last_exact_audit_total === null || row?.last_exact_audit_total === undefined
        ? null
        : Math.max(0, Number(row?.last_exact_audit_total || 0)),
    last_exact_audit_at: sanitizeText(row?.last_exact_audit_at || "", 64) || "",
    storage_queue_backlog_assets: Math.max(0, Number(row?.storage_queue_backlog_assets || 0)),
    storage_queue_seeded_complete: Number(row?.storage_queue_seeded_complete || 0) > 0,
    storage_audit_status_note:
      sanitizeText(row?.storage_audit_status_note || "", 2000) ||
      "Website storage truth has not been computed yet.",
    updated_at: sanitizeText(row?.updated_at || "", 64) || "",
  }
}

function formatPublicStatsNumber(value) {
  return Math.max(0, Number(value || 0)).toLocaleString("en-US")
}

function publicStatsCopy(payload) {
  const genes = Math.max(0, Number(payload?.gene_count || 0))
  const candidates = Math.max(0, Number(payload?.generated_candidate_blot_count || 0))
  if (!genes || !candidates) return ""
  return `${formatPublicStatsNumber(genes)} genes · ${formatPublicStatsNumber(candidates)} AI blots`
}

async function publicStatsPayloadFromSummary(env, summary) {
  const row = mapWebsiteTruthSummaryRow(summary || {})
  const manifest = await catalogManifestObj(env)
  const geneCount = Math.max(0, Number(manifest?.gene_count || 0))
  const payload = {
    schema_version: PUBLIC_STATS_SCHEMA_VERSION,
    gene_count: geneCount,
    canonical_blot_count: row.catalog_published_live_portraits,
    generated_candidate_blot_count: row.catalog_candidate_assets,
    auditable_candidate_blot_count: row.catalog_auditable_assets,
    storage_verified_candidate_blot_count: row.verified_renderable_images,
    storage_audit_coverage_percent: row.storage_audit_coverage_percent,
    storage_audit_complete: Boolean(row.renderable_live_exact_known),
    updated_at: row.updated_at || new Date().toISOString(),
  }
  return {
    ...payload,
    public_copy: publicStatsCopy(payload),
  }
}

function normalizePublicStatsPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") return null
  const payload = {
    schema_version: String(rawPayload.schema_version || PUBLIC_STATS_SCHEMA_VERSION),
    gene_count: Math.max(0, Number(rawPayload.gene_count || 0)),
    canonical_blot_count: Math.max(0, Number(rawPayload.canonical_blot_count || 0)),
    generated_candidate_blot_count: Math.max(
      0,
      Number(rawPayload.generated_candidate_blot_count || 0),
    ),
    auditable_candidate_blot_count: Math.max(
      0,
      Number(rawPayload.auditable_candidate_blot_count || 0),
    ),
    storage_verified_candidate_blot_count: Math.max(
      0,
      Number(rawPayload.storage_verified_candidate_blot_count || 0),
    ),
    storage_audit_coverage_percent: Number(rawPayload.storage_audit_coverage_percent || 0),
    storage_audit_complete: Boolean(rawPayload.storage_audit_complete),
    updated_at: sanitizeText(rawPayload.updated_at || "", 64) || "",
  }
  if (!payload.gene_count || !payload.generated_candidate_blot_count) return null
  return {
    ...payload,
    public_copy: publicStatsCopy(payload),
  }
}

async function writePublicStatsProjection(env, summary) {
  if (!env?.KV) return null
  const payload = await publicStatsPayloadFromSummary(env, summary)
  if (!payload.gene_count || !payload.generated_candidate_blot_count) return null
  await env.KV.put(KV_PUBLIC_STATS, JSON.stringify(payload))
  return payload
}

async function fetchAdminPublicStatsAudit(env, { sampleLimit = 25 } = {}) {
  if (!env?.ICONOPLASM_DB) return { ok: false, error: "ICONOPLASM_DB binding missing" }
  const cleanedSampleLimit = Math.max(
    1,
    Math.min(100, Number.parseInt(String(sampleLimit || "25"), 10) || 25),
  )
  const counts = await env.ICONOPLASM_DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM icono_gene_catalog) AS catalog_gene_rows,
       (SELECT COUNT(*)
          FROM icono_publish_state
         WHERE COALESCE(current_asset_sha256, '') <> '') AS canonical_blot_rows,
       (SELECT COUNT(DISTINCT gene_symbol)
          FROM icono_publish_state
         WHERE COALESCE(current_asset_sha256, '') <> '') AS canonical_distinct_symbols,
       (SELECT COUNT(*)
          FROM icono_gene_catalog gc
          JOIN icono_publish_state ps
            ON ps.gene_symbol = gc.gene_symbol
         WHERE COALESCE(ps.current_asset_sha256, '') <> '') AS catalog_genes_with_canonical,
       (SELECT COUNT(*)
          FROM icono_portrait_assets pa
          JOIN icono_gene_catalog gc
            ON gc.gene_symbol = pa.gene_symbol) AS catalog_candidate_assets,
       (SELECT COUNT(*)
          FROM icono_portrait_assets pa
          JOIN icono_gene_catalog gc
            ON gc.gene_symbol = pa.gene_symbol
         WHERE COALESCE(pa.is_legacy, 0) = 0
           AND lower(COALESCE(pa.status, 'draft')) <> 'rejected') AS catalog_auditable_assets,
       (SELECT COUNT(*)
          FROM icono_gene_catalog gc
          LEFT JOIN icono_publish_state ps
            ON ps.gene_symbol = gc.gene_symbol
           AND COALESCE(ps.current_asset_sha256, '') <> ''
         WHERE ps.gene_symbol IS NULL) AS catalog_genes_without_canonical,
       (SELECT COUNT(*)
          FROM icono_publish_state ps
          LEFT JOIN icono_gene_catalog gc
            ON gc.gene_symbol = ps.gene_symbol
         WHERE COALESCE(ps.current_asset_sha256, '') <> ''
           AND gc.gene_symbol IS NULL) AS canonical_symbols_missing_from_catalog`,
  ).first()

  const missingResp = await env.ICONOPLASM_DB.prepare(
    `SELECT ps.gene_symbol, ps.current_asset_sha256, ps.updated_at, ps.updated_by
       FROM icono_publish_state ps
       LEFT JOIN icono_gene_catalog gc
         ON gc.gene_symbol = ps.gene_symbol
      WHERE COALESCE(ps.current_asset_sha256, '') <> ''
        AND gc.gene_symbol IS NULL
      ORDER BY ps.gene_symbol ASC
      LIMIT ?`,
  )
    .bind(cleanedSampleLimit)
    .all()

  const duplicateCaseResp = await env.ICONOPLASM_DB.prepare(
    `SELECT upper(gene_symbol) AS normalized_symbol, COUNT(*) AS rows
       FROM icono_publish_state
      WHERE COALESCE(current_asset_sha256, '') <> ''
      GROUP BY upper(gene_symbol)
     HAVING COUNT(*) > 1
      ORDER BY rows DESC, normalized_symbol ASC
      LIMIT ?`,
  )
    .bind(cleanedSampleLimit)
    .all()

  const payload = {
    ok: true,
    catalog_gene_rows: Math.max(0, Number(counts?.catalog_gene_rows || 0)),
    canonical_blot_rows: Math.max(0, Number(counts?.canonical_blot_rows || 0)),
    canonical_distinct_symbols: Math.max(0, Number(counts?.canonical_distinct_symbols || 0)),
    catalog_genes_with_canonical: Math.max(0, Number(counts?.catalog_genes_with_canonical || 0)),
    catalog_candidate_assets: Math.max(0, Number(counts?.catalog_candidate_assets || 0)),
    catalog_auditable_assets: Math.max(0, Number(counts?.catalog_auditable_assets || 0)),
    catalog_genes_without_canonical: Math.max(
      0,
      Number(counts?.catalog_genes_without_canonical || 0),
    ),
    canonical_symbols_missing_from_catalog: Math.max(
      0,
      Number(counts?.canonical_symbols_missing_from_catalog || 0),
    ),
    sample_limit: cleanedSampleLimit,
    missing_from_catalog_sample: (Array.isArray(missingResp?.results)
      ? missingResp.results
      : []
    ).map((row) => ({
      gene_symbol: normalizeSymbol(row?.gene_symbol || "") || "",
      current_asset_sha256: normalizeSha256(row?.current_asset_sha256 || "") || "",
      updated_at: sanitizeText(row?.updated_at || "", 64) || "",
      updated_by: sanitizeText(row?.updated_by || "", 255) || "",
    })),
    duplicate_normalized_publish_symbols_sample: (Array.isArray(duplicateCaseResp?.results)
      ? duplicateCaseResp.results
      : []
    ).map((row) => ({
      normalized_symbol: normalizeSymbol(row?.normalized_symbol || "") || "",
      rows: Math.max(0, Number(row?.rows || 0)),
    })),
  }
  payload.expected_public_gene_count =
    payload.catalog_genes_with_canonical + payload.catalog_genes_without_canonical
  payload.canonical_minus_catalog_delta = payload.canonical_blot_rows - payload.catalog_gene_rows
  return payload
}

function mapStorageAuditQueueStateRow(row) {
  const seedStatus = sanitizeText(row?.seed_status || "idle", 32).toLowerCase() || "idle"
  return {
    queue_key: String(row?.queue_key || ICONO_STORAGE_AUDIT_QUEUE_KEY),
    seed_status: ["idle", "running", "complete"].includes(seedStatus) ? seedStatus : "idle",
    last_seeded_symbol: normalizeSymbol(row?.last_seeded_symbol || "") || "",
    processed_symbols: Math.max(0, Number(row?.processed_symbols || 0)),
    total_symbols: Math.max(0, Number(row?.total_symbols || 0)),
    seeded_complete: Number(row?.seeded_complete || 0) > 0,
    last_error: sanitizeText(row?.last_error || "", 2000) || "",
    started_at: sanitizeText(row?.started_at || "", 64) || "",
    updated_at: sanitizeText(row?.updated_at || "", 64) || "",
    completed_at: sanitizeText(row?.completed_at || "", 64) || "",
  }
}

async function fetchStorageAuditQueueState(env) {
  if (!env.ICONOPLASM_DB) return null
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_storage_audit_queue_state
     WHERE queue_key = ?
     LIMIT 1`,
  )
    .bind(ICONO_STORAGE_AUDIT_QUEUE_KEY)
    .first()
  return row ? mapStorageAuditQueueStateRow(row) : null
}

async function ensureStorageAuditQueueState(env) {
  if (!env.ICONOPLASM_DB) return null
  const existing = await fetchStorageAuditQueueState(env)
  if (existing) return existing

  const totalSymbolsRow = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM icono_admin_gene_rollup
     WHERE COALESCE(total_assets, 0) > 0`,
  ).first()

  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_storage_audit_queue_state (
       queue_key,
       seed_status,
       last_seeded_symbol,
       processed_symbols,
       total_symbols,
       seeded_complete,
       last_error,
       started_at,
       updated_at,
       completed_at
     ) VALUES (?, 'idle', '', 0, ?, 0, '', NULL, CURRENT_TIMESTAMP, NULL)`,
  )
    .bind(ICONO_STORAGE_AUDIT_QUEUE_KEY, Math.max(0, Number(totalSymbolsRow?.count || 0)))
    .run()

  return fetchStorageAuditQueueState(env)
}

async function writeStorageAuditQueueState(env, patch = {}) {
  if (!env.ICONOPLASM_DB) return null
  const current = (await ensureStorageAuditQueueState(env)) || mapStorageAuditQueueStateRow({})
  const next = mapStorageAuditQueueStateRow({ ...current, ...patch })
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_storage_audit_queue_state (
       queue_key,
       seed_status,
       last_seeded_symbol,
       processed_symbols,
       total_symbols,
       seeded_complete,
       last_error,
       started_at,
       updated_at,
       completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(queue_key) DO UPDATE SET
       seed_status = excluded.seed_status,
       last_seeded_symbol = excluded.last_seeded_symbol,
       processed_symbols = excluded.processed_symbols,
       total_symbols = excluded.total_symbols,
       seeded_complete = excluded.seeded_complete,
       last_error = excluded.last_error,
       started_at = excluded.started_at,
       updated_at = CURRENT_TIMESTAMP,
       completed_at = excluded.completed_at`,
  )
    .bind(
      ICONO_STORAGE_AUDIT_QUEUE_KEY,
      next.seed_status,
      next.last_seeded_symbol,
      next.processed_symbols,
      next.total_symbols,
      next.seeded_complete ? 1 : 0,
      next.last_error,
      next.started_at || null,
      next.completed_at || null,
    )
    .run()
  return fetchStorageAuditQueueState(env)
}

async function listStorageAuditSeedSymbolsAfter(
  env,
  rawAfterSymbol = "",
  limit = ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH,
) {
  if (!env.ICONOPLASM_DB) return []
  const afterSymbol = normalizeSymbol(rawAfterSymbol) || ""
  const cleanedLimit = normalizeAdminAssetMaintenanceLimit(
    limit,
    ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH,
    500,
  )
  const response = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol
     FROM icono_admin_gene_rollup
     WHERE COALESCE(total_assets, 0) > 0
       AND (? = '' OR gene_symbol > ?)
     ORDER BY gene_symbol ASC
     LIMIT ?`,
  )
    .bind(afterSymbol, afterSymbol, cleanedLimit)
    .all()
  return Array.from(
    new Set(
      (Array.isArray(response?.results) ? response.results : [])
        .map((row) => normalizeSymbol(row?.gene_symbol || ""))
        .filter(Boolean),
    ),
  )
}

async function upsertStorageAuditQueueRowsForSymbols(env, rawSymbols) {
  if (!env.ICONOPLASM_DB) return { symbols: 0, auditable_assets: 0 }
  const symbols = normalizeAdminAssetMaintenanceSymbols(rawSymbols, 5000)
  if (!symbols.length) return { symbols: 0, auditable_assets: 0 }
  const symbolsJson = JSON.stringify(symbols)

  const countRow = await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT COUNT(*) AS count
     FROM icono_portrait_assets pa
     WHERE pa.gene_symbol IN (SELECT gene_symbol FROM incoming_scope)
       AND COALESCE(pa.asset_sha256, '') <> ''
       AND COALESCE(pa.is_legacy, 0) = 0
       AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'`,
  )
    .bind(symbolsJson)
    .first()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     ),
     current_assets AS (
       SELECT
         pa.gene_symbol,
         pa.asset_sha256,
         lower(COALESCE(pa.status, 'draft')) AS asset_status,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.created_at, '') AS created_at,
         CASE
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current
       FROM icono_portrait_assets pa
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = pa.gene_symbol
       WHERE pa.gene_symbol IN (SELECT gene_symbol FROM incoming_scope)
         AND COALESCE(pa.asset_sha256, '') <> ''
         AND COALESCE(pa.is_legacy, 0) = 0
         AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
     )
     INSERT OR IGNORE INTO icono_storage_audit_queue (
       gene_symbol,
       asset_sha256,
       status,
       audit_state,
       missing_renditions_json,
       is_current,
       is_stale,
       is_legacy,
       asset_status,
       created_at,
       last_seen_at,
       last_audited_at,
       last_error,
       attempts,
       next_attempt_at,
       updated_at
     )
     SELECT
       gene_symbol,
       asset_sha256,
       'queued',
       'unknown',
       '[]',
       is_current,
       is_stale,
       is_legacy,
       asset_status,
       created_at,
       CURRENT_TIMESTAMP,
       NULL,
       '',
       0,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     FROM current_assets`,
  )
    .bind(symbolsJson)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     ),
     current_assets AS (
       SELECT
         pa.gene_symbol,
         pa.asset_sha256,
         lower(COALESCE(pa.status, 'draft')) AS asset_status,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.created_at, '') AS created_at,
         CASE
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current
       FROM icono_portrait_assets pa
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = pa.gene_symbol
       WHERE pa.gene_symbol IN (SELECT gene_symbol FROM incoming_scope)
         AND COALESCE(pa.asset_sha256, '') <> ''
         AND COALESCE(pa.is_legacy, 0) = 0
         AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
     )
     UPDATE icono_storage_audit_queue
     SET is_current = COALESCE((
           SELECT ca.is_current
           FROM current_assets ca
           WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
             AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
           LIMIT 1
         ), icono_storage_audit_queue.is_current),
         is_stale = COALESCE((
           SELECT ca.is_stale
           FROM current_assets ca
           WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
             AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
           LIMIT 1
         ), icono_storage_audit_queue.is_stale),
         is_legacy = COALESCE((
           SELECT ca.is_legacy
           FROM current_assets ca
           WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
             AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
           LIMIT 1
         ), icono_storage_audit_queue.is_legacy),
         asset_status = COALESCE((
           SELECT ca.asset_status
           FROM current_assets ca
           WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
             AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
           LIMIT 1
         ), icono_storage_audit_queue.asset_status),
         created_at = COALESCE((
           SELECT ca.created_at
           FROM current_assets ca
           WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
             AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
           LIMIT 1
         ), icono_storage_audit_queue.created_at),
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP,
         status = CASE
           WHEN icono_storage_audit_queue.audit_state = 'unknown' THEN 'queued'
           ELSE icono_storage_audit_queue.status
         END,
         next_attempt_at = CASE
           WHEN icono_storage_audit_queue.audit_state = 'unknown' THEN CURRENT_TIMESTAMP
           ELSE icono_storage_audit_queue.next_attempt_at
         END
     WHERE EXISTS (
       SELECT 1
       FROM current_assets ca
       WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
         AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
     )`,
  )
    .bind(symbolsJson)
    .run()

  await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     ),
     current_assets AS (
       SELECT pa.gene_symbol, pa.asset_sha256
       FROM icono_portrait_assets pa
       WHERE pa.gene_symbol IN (SELECT gene_symbol FROM incoming_scope)
         AND COALESCE(pa.asset_sha256, '') <> ''
         AND COALESCE(pa.is_legacy, 0) = 0
         AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
     )
     DELETE FROM icono_storage_audit_queue
     WHERE gene_symbol IN (SELECT gene_symbol FROM incoming_scope)
       AND NOT EXISTS (
         SELECT 1
         FROM current_assets ca
         WHERE ca.gene_symbol = icono_storage_audit_queue.gene_symbol
           AND ca.asset_sha256 = icono_storage_audit_queue.asset_sha256
       )`,
  )
    .bind(symbolsJson)
    .run()

  return {
    symbols: symbols.length,
    auditable_assets: Math.max(0, Number(countRow?.count || 0)),
  }
}

async function seedStorageAuditQueueStep(
  env,
  { requestedSymbols = null, symbolBatch = ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH } = {},
) {
  if (!env.ICONOPLASM_DB) return { seeded_symbols: 0, seeded_complete: false, scoped: false }
  const scopedSymbols = Array.isArray(requestedSymbols)
    ? normalizeAdminAssetMaintenanceSymbols(requestedSymbols, 5000)
    : []
  if (scopedSymbols.length > 0) {
    const upserted = await upsertStorageAuditQueueRowsForSymbols(env, scopedSymbols)
    return {
      seeded_symbols: upserted.symbols,
      seeded_complete: false,
      scoped: true,
    }
  }

  const state = await ensureStorageAuditQueueState(env)
  if (state?.seeded_complete) {
    return {
      seeded_symbols: 0,
      seeded_complete: true,
      scoped: false,
    }
  }

  const symbols = await listStorageAuditSeedSymbolsAfter(
    env,
    state?.last_seeded_symbol || "",
    symbolBatch,
  )
  if (!symbols.length) {
    await writeStorageAuditQueueState(env, {
      ...state,
      seed_status: "complete",
      seeded_complete: true,
      completed_at: new Date().toISOString(),
      last_error: "",
    })
    return {
      seeded_symbols: 0,
      seeded_complete: true,
      scoped: false,
    }
  }

  const startedAt = state?.started_at || new Date().toISOString()
  await writeStorageAuditQueueState(env, {
    ...state,
    seed_status: "running",
    started_at: startedAt,
    completed_at: "",
    last_error: "",
  })
  const upserted = await upsertStorageAuditQueueRowsForSymbols(env, symbols)
  const seededComplete =
    symbols.length <
    normalizeAdminAssetMaintenanceLimit(symbolBatch, ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH, 500)
  const nextState = await writeStorageAuditQueueState(env, {
    ...state,
    seed_status: seededComplete ? "complete" : "running",
    last_seeded_symbol: symbols[symbols.length - 1] || state?.last_seeded_symbol || "",
    processed_symbols: Math.min(
      Math.max(0, Number(state?.total_symbols || 0)),
      Math.max(0, Number(state?.processed_symbols || 0)) + upserted.symbols,
    ),
    seeded_complete: seededComplete,
    started_at: startedAt,
    completed_at: seededComplete ? new Date().toISOString() : "",
    last_error: "",
  })
  return {
    seeded_symbols: upserted.symbols,
    seeded_complete: Boolean(nextState?.seeded_complete),
    scoped: false,
  }
}

async function fetchAdminAssetSummaryBaseline(env) {
  if (!env.ICONOPLASM_DB) {
    return {
      candidate_assets: 0,
      catalog_candidate_assets: 0,
      auditable_assets: 0,
      catalog_auditable_assets: 0,
      stale_assets: 0,
      legacy_assets: 0,
      catalog_published_live_portraits: 0,
      published_live_portraits: 0,
    }
  }

  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT
       COUNT(*) AS candidate_assets,
       SUM(CASE WHEN gc.gene_symbol IS NOT NULL THEN 1 ELSE 0 END) AS catalog_candidate_assets,
       SUM(CASE WHEN COALESCE(pa.is_legacy, 0) = 0 AND lower(COALESCE(pa.status, 'draft')) <> 'rejected' THEN 1 ELSE 0 END) AS auditable_assets,
       SUM(CASE WHEN gc.gene_symbol IS NOT NULL AND COALESCE(pa.is_legacy, 0) = 0 AND lower(COALESCE(pa.status, 'draft')) <> 'rejected' THEN 1 ELSE 0 END) AS catalog_auditable_assets,
       SUM(CASE WHEN COALESCE(pa.is_stale, 0) = 1 THEN 1 ELSE 0 END) AS stale_assets,
       SUM(CASE WHEN COALESCE(pa.is_legacy, 0) = 1 THEN 1 ELSE 0 END) AS legacy_assets,
       (
         SELECT COUNT(*)
         FROM icono_publish_state
         WHERE COALESCE(current_asset_sha256, '') <> ''
       ) AS published_live_portraits,
       (
         SELECT COUNT(*)
         FROM icono_publish_state ps
         JOIN icono_gene_catalog gc2
           ON gc2.gene_symbol = ps.gene_symbol
         WHERE COALESCE(ps.current_asset_sha256, '') <> ''
       ) AS catalog_published_live_portraits
     FROM icono_portrait_assets pa
     LEFT JOIN icono_gene_catalog gc
       ON gc.gene_symbol = pa.gene_symbol`,
  ).first()

  return {
    candidate_assets: Math.max(0, Number(row?.candidate_assets || 0)),
    catalog_candidate_assets: Math.max(0, Number(row?.catalog_candidate_assets || 0)),
    auditable_assets: Math.max(0, Number(row?.auditable_assets || 0)),
    catalog_auditable_assets: Math.max(0, Number(row?.catalog_auditable_assets || 0)),
    stale_assets: Math.max(0, Number(row?.stale_assets || 0)),
    legacy_assets: Math.max(0, Number(row?.legacy_assets || 0)),
    catalog_published_live_portraits: Math.max(
      0,
      Number(row?.catalog_published_live_portraits || 0),
    ),
    published_live_portraits: Math.max(0, Number(row?.published_live_portraits || 0)),
  }
}

async function fetchPersistedWebsiteTruthSummary(env) {
  if (!env.ICONOPLASM_DB) return null
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT *
     FROM icono_website_truth_summary
     WHERE summary_key = ?
     LIMIT 1`,
  )
    .bind(ICONO_WEBSITE_TRUTH_SUMMARY_KEY)
    .first()
  return row ? mapWebsiteTruthSummaryRow(row) : null
}

async function computeWebsiteTruthSummary(env) {
  const baseline = await fetchAdminAssetSummaryBaseline(env)
  const queueState = await ensureStorageAuditQueueState(env)
  const previous = await fetchPersistedWebsiteTruthSummary(env)

  if (!env.ICONOPLASM_DB) {
    return mapWebsiteTruthSummaryRow({
      ...baseline,
      audited_assets: 0,
      verified_renderable_images: 0,
      storage_audit_coverage_percent: 0,
      storage_incomplete_assets: 0,
      broken_live_images: 0,
      renderable_live_confirmed: 0,
      unverified_live_portraits: baseline.published_live_portraits,
      renderable_live_exact_known: 0,
      last_exact_audit_total: previous?.last_exact_audit_total ?? null,
      last_exact_audit_at: previous?.last_exact_audit_at || "",
      storage_queue_backlog_assets: 0,
      storage_queue_seeded_complete: 0,
      storage_audit_status_note:
        "Website storage truth is unavailable because ICONOPLASM_DB is missing.",
      updated_at: "",
    })
  }

  const queueRow = await env.ICONOPLASM_DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN q.audit_state <> 'unknown' THEN 1 ELSE 0 END), 0) AS audited_assets,
       COALESCE(SUM(CASE WHEN q.audit_state = 'renderable' THEN 1 ELSE 0 END), 0) AS verified_renderable_images,
       COALESCE(SUM(CASE WHEN q.audit_state = 'broken' THEN 1 ELSE 0 END), 0) AS storage_incomplete_assets,
       COALESCE(SUM(CASE WHEN q.is_current = 1 AND q.audit_state = 'broken' THEN 1 ELSE 0 END), 0) AS broken_live_images,
       COALESCE(SUM(CASE WHEN q.is_current = 1 AND q.audit_state = 'renderable' THEN 1 ELSE 0 END), 0) AS renderable_live_confirmed,
       COALESCE(SUM(CASE WHEN q.audit_state = 'unknown' THEN 1 ELSE 0 END), 0) AS storage_queue_backlog_assets
     FROM icono_storage_audit_queue q
     WHERE EXISTS (
       SELECT 1
       FROM icono_portrait_assets pa
       WHERE pa.gene_symbol = q.gene_symbol
         AND pa.asset_sha256 = q.asset_sha256
         AND COALESCE(pa.asset_sha256, '') <> ''
         AND COALESCE(pa.is_legacy, 0) = 0
         AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
     )`,
  ).first()

  const auditableAssets = Math.max(0, Number(baseline?.auditable_assets || 0))
  const catalogAuditableAssets = Math.max(0, Number(baseline?.catalog_auditable_assets || 0))
  const candidateAssets = Math.max(0, Number(baseline?.candidate_assets || 0))
  const catalogCandidateAssets = Math.max(0, Number(baseline?.catalog_candidate_assets || 0))
  const auditedAssets = Math.max(0, Number(queueRow?.audited_assets || 0))
  const verifiedRenderableImages = Math.max(0, Number(queueRow?.verified_renderable_images || 0))
  const storageIncompleteAssets = Math.max(0, Number(queueRow?.storage_incomplete_assets || 0))
  const brokenLiveImages = Math.max(0, Number(queueRow?.broken_live_images || 0))
  const renderableLiveConfirmed = Math.max(0, Number(queueRow?.renderable_live_confirmed || 0))
  const storageQueueBacklogAssets = Math.max(0, Number(queueRow?.storage_queue_backlog_assets || 0))
  const coveragePercent =
    auditableAssets > 0 ? Number(((auditedAssets / auditableAssets) * 100).toFixed(1)) : 100.0
  const exactKnown =
    auditableAssets === 0 ||
    (Boolean(queueState?.seeded_complete) &&
      auditedAssets >= auditableAssets &&
      storageQueueBacklogAssets <= 0)
  const updatedAt = new Date().toISOString()
  const lastExactAuditTotal = exactKnown
    ? verifiedRenderableImages
    : (previous?.last_exact_audit_total ?? null)
  const lastExactAuditAt = exactKnown ? updatedAt : previous?.last_exact_audit_at || ""
  const publishedLivePortraits = Math.max(0, Number(baseline?.published_live_portraits || 0))
  const catalogPublishedLivePortraits = Math.max(
    0,
    Number(baseline?.catalog_published_live_portraits || 0),
  )
  const unverifiedLivePortraits = Math.max(
    0,
    publishedLivePortraits - renderableLiveConfirmed - brokenLiveImages,
  )
  const statusNote = exactKnown
    ? `Storage audit has a complete persisted verdict for all ${auditableAssets.toLocaleString("en-US")} auditable website assets.`
    : queueState?.seeded_complete
      ? `Storage audit has persisted verdicts for ${auditedAssets.toLocaleString("en-US")} of ${auditableAssets.toLocaleString("en-US")} auditable website assets (${coveragePercent.toFixed(1)}% coverage); ${storageQueueBacklogAssets.toLocaleString("en-US")} rows still need verification.`
      : `Storage audit backlog is still being seeded from persisted asset rows. Persisted verdicts currently cover ${auditedAssets.toLocaleString("en-US")} of ${auditableAssets.toLocaleString("en-US")} auditable website assets (${coveragePercent.toFixed(1)}% coverage).`

  return mapWebsiteTruthSummaryRow({
    candidate_assets: candidateAssets,
    catalog_candidate_assets: catalogCandidateAssets,
    auditable_assets: auditableAssets,
    catalog_auditable_assets: catalogAuditableAssets,
    stale_assets: baseline?.stale_assets || 0,
    legacy_assets: baseline?.legacy_assets || 0,
    catalog_published_live_portraits: catalogPublishedLivePortraits,
    published_live_portraits: publishedLivePortraits,
    audited_assets: auditedAssets,
    verified_renderable_images: verifiedRenderableImages,
    storage_audit_coverage_percent: coveragePercent,
    storage_incomplete_assets: storageIncompleteAssets,
    broken_live_images: brokenLiveImages,
    renderable_live_confirmed: renderableLiveConfirmed,
    unverified_live_portraits: unverifiedLivePortraits,
    renderable_live_exact_known: exactKnown ? 1 : 0,
    last_exact_audit_total: lastExactAuditTotal,
    last_exact_audit_at: lastExactAuditAt,
    storage_queue_backlog_assets: storageQueueBacklogAssets,
    storage_queue_seeded_complete: queueState?.seeded_complete ? 1 : 0,
    storage_audit_status_note: statusNote,
    updated_at: updatedAt,
  })
}

async function writeWebsiteTruthSummary(env, summary) {
  if (!env.ICONOPLASM_DB) return null
  const row = mapWebsiteTruthSummaryRow(summary || {})
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_website_truth_summary (
       summary_key,
       candidate_assets,
       stale_assets,
       legacy_assets,
       published_live_portraits,
       audited_assets,
       verified_renderable_images,
       storage_audit_coverage_percent,
       storage_incomplete_assets,
       broken_live_images,
       renderable_live_confirmed,
       unverified_live_portraits,
       renderable_live_exact_known,
       last_exact_audit_total,
       last_exact_audit_at,
       storage_queue_backlog_assets,
       storage_queue_seeded_complete,
       storage_audit_status_note,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(summary_key) DO UPDATE SET
       candidate_assets = excluded.candidate_assets,
       stale_assets = excluded.stale_assets,
       legacy_assets = excluded.legacy_assets,
       published_live_portraits = excluded.published_live_portraits,
       audited_assets = excluded.audited_assets,
       verified_renderable_images = excluded.verified_renderable_images,
       storage_audit_coverage_percent = excluded.storage_audit_coverage_percent,
       storage_incomplete_assets = excluded.storage_incomplete_assets,
       broken_live_images = excluded.broken_live_images,
       renderable_live_confirmed = excluded.renderable_live_confirmed,
       unverified_live_portraits = excluded.unverified_live_portraits,
       renderable_live_exact_known = excluded.renderable_live_exact_known,
       last_exact_audit_total = excluded.last_exact_audit_total,
       last_exact_audit_at = excluded.last_exact_audit_at,
       storage_queue_backlog_assets = excluded.storage_queue_backlog_assets,
       storage_queue_seeded_complete = excluded.storage_queue_seeded_complete,
       storage_audit_status_note = excluded.storage_audit_status_note,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      ICONO_WEBSITE_TRUTH_SUMMARY_KEY,
      row.candidate_assets,
      row.stale_assets,
      row.legacy_assets,
      row.published_live_portraits,
      row.audited_assets,
      row.verified_renderable_images,
      row.storage_audit_coverage_percent,
      row.storage_incomplete_assets,
      row.broken_live_images,
      row.renderable_live_confirmed,
      row.unverified_live_portraits,
      row.renderable_live_exact_known ? 1 : 0,
      row.last_exact_audit_total,
      row.last_exact_audit_at || null,
      row.storage_queue_backlog_assets,
      row.storage_queue_seeded_complete ? 1 : 0,
      row.storage_audit_status_note,
    )
    .run()
  await writePublicStatsProjection(env, row)
  return fetchPersistedWebsiteTruthSummary(env)
}

async function refreshWebsiteTruthSummaryRow(env) {
  const summary = await computeWebsiteTruthSummary(env)
  return writeWebsiteTruthSummary(env, summary)
}

async function fetchAdminAssetSummaryCounts(env, { refresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return mapWebsiteTruthSummaryRow({})
  if (refresh) return refreshWebsiteTruthSummaryRow(env)
  const row = await fetchPersistedWebsiteTruthSummary(env)
  if (row) return row
  return refreshWebsiteTruthSummaryRow(env)
}

async function selectStorageAuditQueueRowsToProcess(
  env,
  { requestedSymbols = null, limit = 100 } = {},
) {
  if (!env.ICONOPLASM_DB) return []
  const wantedSymbols = Array.isArray(requestedSymbols)
    ? normalizeAdminAssetMaintenanceSymbols(requestedSymbols, 5000)
    : []
  const applyScope = wantedSymbols.length > 0 ? 1 : 0
  const cleanedLimit = normalizeAdminAssetMaintenanceLimit(limit, 100, 500)
  const response = await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT
       q.gene_symbol,
       q.asset_sha256,
       q.asset_status AS status,
       q.is_stale,
       q.is_legacy,
       q.created_at,
       q.is_current,
       q.attempts
     FROM icono_storage_audit_queue q
     JOIN icono_portrait_assets pa
       ON pa.gene_symbol = q.gene_symbol
      AND pa.asset_sha256 = q.asset_sha256
     WHERE q.audit_state = 'unknown'
       AND q.next_attempt_at <= CURRENT_TIMESTAMP
       AND (? = 0 OR q.gene_symbol IN (SELECT gene_symbol FROM incoming_scope))
       AND COALESCE(pa.is_legacy, 0) = 0
       AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
     ORDER BY
       q.is_current DESC,
       COALESCE(q.is_stale, 0) ASC,
       COALESCE(q.created_at, '') DESC,
       q.gene_symbol ASC,
       q.asset_sha256 ASC
     LIMIT ?`,
  )
    .bind(JSON.stringify(wantedSymbols), applyScope, cleanedLimit)
    .all()
  return Array.isArray(response?.results) ? response.results : []
}

async function inspectAdminAssetStorageRows(
  env,
  rawRows,
  { concurrency = ICONO_STORAGE_AUDIT_INSPECT_CONCURRENCY } = {},
) {
  const rows = Array.isArray(rawRows) ? rawRows : []
  const safeConcurrency = Math.max(
    1,
    Math.min(
      16,
      Number.parseInt(String(concurrency || ICONO_STORAGE_AUDIT_INSPECT_CONCURRENCY), 10) ||
        ICONO_STORAGE_AUDIT_INSPECT_CONCURRENCY,
    ),
  )
  const out = []

  const inspectOne = async (rawRow) => {
    const symbol = normalizeSymbol(rawRow?.gene_symbol || rawRow?.symbol || "")
    const assetSha = normalizeSha256(rawRow?.asset_sha256 || rawRow?.sha256 || "")
    if (!symbol || !assetSha) return null

    try {
      const keys = {
        full: r2PortraitKey(assetSha, "full"),
        medium: r2PortraitKey(assetSha, "medium"),
        thumb: r2PortraitKey(assetSha, "thumb"),
      }
      const [fullHead, mediumHead, thumbHead] = await Promise.all([
        headPortraitStorageObject(env, keys.full),
        headPortraitStorageObject(env, keys.medium),
        headPortraitStorageObject(env, keys.thumb),
      ])

      const missingRenditions = []
      if (!fullHead) missingRenditions.push("full")
      if (!mediumHead) missingRenditions.push("medium")
      if (!thumbHead) missingRenditions.push("thumb")

      return {
        ok: true,
        symbol,
        asset_sha256: assetSha,
        status: normalizeAssetStatus(rawRow?.status || "", "draft"),
        is_stale: Number(rawRow?.is_stale || 0) > 0,
        is_legacy: Number(rawRow?.is_legacy || 0) > 0,
        is_current: Number(rawRow?.is_current || 0) > 0,
        created_at: sanitizeText(rawRow?.created_at || "", 64) || "",
        attempts: Math.max(0, Number(rawRow?.attempts || 0)),
        storage_complete: missingRenditions.length === 0,
        missing_renditions: missingRenditions,
      }
    } catch (error) {
      return {
        ok: false,
        symbol,
        asset_sha256: assetSha,
        status: normalizeAssetStatus(rawRow?.status || "", "draft"),
        is_stale: Number(rawRow?.is_stale || 0) > 0,
        is_legacy: Number(rawRow?.is_legacy || 0) > 0,
        is_current: Number(rawRow?.is_current || 0) > 0,
        created_at: sanitizeText(rawRow?.created_at || "", 64) || "",
        attempts: Math.max(0, Number(rawRow?.attempts || 0)),
        error:
          sanitizeText(String(error?.message || error || "storage audit failed"), 2000) ||
          "storage audit failed",
      }
    }
  }

  for (let start = 0; start < rows.length; start += safeConcurrency) {
    const chunk = rows.slice(start, start + safeConcurrency)
    const chunkResults = await Promise.all(chunk.map((row) => inspectOne(row)))
    for (const result of chunkResults) {
      if (result) out.push(result)
    }
  }

  return out
}

async function writeStorageAuditQueueInspectionResult(env, result) {
  return (await writeStorageAuditQueueInspectionResults(env, [result])) > 0
}

async function writeStorageAuditQueueInspectionResults(env, rows) {
  if (!env.ICONOPLASM_DB) return 0
  const successRows = []
  const retryRows = []

  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = normalizeSymbol(row?.symbol || row?.gene_symbol || "")
    const assetSha = normalizeSha256(row?.asset_sha256 || "")
    if (!symbol || !assetSha) continue

    if (row?.ok) {
      successRows.push({
        gene_symbol: symbol,
        asset_sha256: assetSha,
        audit_state: row?.storage_complete ? "renderable" : "broken",
        missing_renditions_json: JSON.stringify(
          Array.isArray(row?.missing_renditions) ? row.missing_renditions : [],
        ),
        is_current: row?.is_current ? 1 : 0,
        is_stale: row?.is_stale ? 1 : 0,
        is_legacy: row?.is_legacy ? 1 : 0,
        asset_status: normalizeAssetStatus(row?.status || "", "draft"),
        created_at: sanitizeText(row?.created_at || "", 64) || "",
        last_audited_at: new Date().toISOString(),
      })
      continue
    }

    const attempts = Math.max(0, Number(row?.attempts || 0) || 0)
    const delayMinutes = Math.max(1, Math.min(60, Math.pow(2, attempts)))
    retryRows.push({
      gene_symbol: symbol,
      asset_sha256: assetSha,
      is_current: row?.is_current ? 1 : 0,
      is_stale: row?.is_stale ? 1 : 0,
      is_legacy: row?.is_legacy ? 1 : 0,
      asset_status: normalizeAssetStatus(row?.status || "", "draft"),
      created_at: sanitizeText(row?.created_at || "", 64) || "",
      last_error:
        sanitizeText(row?.error || "storage audit failed", 2000) || "storage audit failed",
      next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
    })
  }

  if (successRows.length > 0) {
    await env.ICONOPLASM_DB.prepare(
      `WITH incoming_results AS (
         SELECT
           json_extract(value, '$.gene_symbol') AS gene_symbol,
           json_extract(value, '$.asset_sha256') AS asset_sha256,
           json_extract(value, '$.audit_state') AS audit_state,
           json_extract(value, '$.missing_renditions_json') AS missing_renditions_json,
           CAST(COALESCE(json_extract(value, '$.is_current'), 0) AS INTEGER) AS is_current,
           CAST(COALESCE(json_extract(value, '$.is_stale'), 0) AS INTEGER) AS is_stale,
           CAST(COALESCE(json_extract(value, '$.is_legacy'), 0) AS INTEGER) AS is_legacy,
           json_extract(value, '$.asset_status') AS asset_status,
           json_extract(value, '$.created_at') AS created_at,
           json_extract(value, '$.last_audited_at') AS last_audited_at
         FROM json_each(?)
       )
       INSERT OR IGNORE INTO icono_storage_audit_queue (
         gene_symbol,
         asset_sha256,
         status,
         audit_state,
         missing_renditions_json,
         is_current,
         is_stale,
         is_legacy,
         asset_status,
         created_at,
         last_seen_at,
         last_audited_at,
         last_error,
         attempts,
         next_attempt_at,
         updated_at
       )
       SELECT
         gene_symbol,
         asset_sha256,
         'completed',
         audit_state,
         missing_renditions_json,
         is_current,
         is_stale,
         is_legacy,
         asset_status,
         created_at,
         CURRENT_TIMESTAMP,
         last_audited_at,
         '',
         0,
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       FROM incoming_results`,
    )
      .bind(JSON.stringify(successRows))
      .run()

    await env.ICONOPLASM_DB.prepare(
      `WITH incoming_results AS (
         SELECT
           json_extract(value, '$.gene_symbol') AS gene_symbol,
           json_extract(value, '$.asset_sha256') AS asset_sha256,
           json_extract(value, '$.audit_state') AS audit_state,
           json_extract(value, '$.missing_renditions_json') AS missing_renditions_json,
           CAST(COALESCE(json_extract(value, '$.is_current'), 0) AS INTEGER) AS is_current,
           CAST(COALESCE(json_extract(value, '$.is_stale'), 0) AS INTEGER) AS is_stale,
           CAST(COALESCE(json_extract(value, '$.is_legacy'), 0) AS INTEGER) AS is_legacy,
           json_extract(value, '$.asset_status') AS asset_status,
           json_extract(value, '$.created_at') AS created_at,
           json_extract(value, '$.last_audited_at') AS last_audited_at
         FROM json_each(?)
       )
       UPDATE icono_storage_audit_queue
       SET status = 'completed',
           audit_state = COALESCE((
             SELECT ir.audit_state
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.audit_state),
           missing_renditions_json = COALESCE((
             SELECT ir.missing_renditions_json
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.missing_renditions_json),
           is_current = COALESCE((
             SELECT ir.is_current
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_current),
           is_stale = COALESCE((
             SELECT ir.is_stale
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_stale),
           is_legacy = COALESCE((
             SELECT ir.is_legacy
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_legacy),
           asset_status = COALESCE((
             SELECT ir.asset_status
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.asset_status),
           created_at = COALESCE((
             SELECT ir.created_at
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.created_at),
           last_seen_at = CURRENT_TIMESTAMP,
           last_audited_at = COALESCE((
             SELECT ir.last_audited_at
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.last_audited_at),
           last_error = '',
           attempts = 0,
           next_attempt_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1
         FROM incoming_results ir
         WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
           AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
       )`,
    )
      .bind(JSON.stringify(successRows))
      .run()
  }

  if (retryRows.length > 0) {
    await env.ICONOPLASM_DB.prepare(
      `WITH incoming_results AS (
         SELECT
           json_extract(value, '$.gene_symbol') AS gene_symbol,
           json_extract(value, '$.asset_sha256') AS asset_sha256,
           CAST(COALESCE(json_extract(value, '$.is_current'), 0) AS INTEGER) AS is_current,
           CAST(COALESCE(json_extract(value, '$.is_stale'), 0) AS INTEGER) AS is_stale,
           CAST(COALESCE(json_extract(value, '$.is_legacy'), 0) AS INTEGER) AS is_legacy,
           json_extract(value, '$.asset_status') AS asset_status,
           json_extract(value, '$.created_at') AS created_at,
           json_extract(value, '$.last_error') AS last_error,
           json_extract(value, '$.next_attempt_at') AS next_attempt_at
         FROM json_each(?)
       )
       INSERT OR IGNORE INTO icono_storage_audit_queue (
         gene_symbol,
         asset_sha256,
         status,
         audit_state,
         missing_renditions_json,
         is_current,
         is_stale,
         is_legacy,
         asset_status,
         created_at,
         last_seen_at,
         last_audited_at,
         last_error,
         attempts,
         next_attempt_at,
         updated_at
       )
       SELECT
         gene_symbol,
         asset_sha256,
         'retrying',
         'unknown',
         '[]',
         is_current,
         is_stale,
         is_legacy,
         asset_status,
         created_at,
         CURRENT_TIMESTAMP,
         NULL,
         last_error,
         1,
         next_attempt_at,
         CURRENT_TIMESTAMP
       FROM incoming_results`,
    )
      .bind(JSON.stringify(retryRows))
      .run()

    await env.ICONOPLASM_DB.prepare(
      `WITH incoming_results AS (
         SELECT
           json_extract(value, '$.gene_symbol') AS gene_symbol,
           json_extract(value, '$.asset_sha256') AS asset_sha256,
           CAST(COALESCE(json_extract(value, '$.is_current'), 0) AS INTEGER) AS is_current,
           CAST(COALESCE(json_extract(value, '$.is_stale'), 0) AS INTEGER) AS is_stale,
           CAST(COALESCE(json_extract(value, '$.is_legacy'), 0) AS INTEGER) AS is_legacy,
           json_extract(value, '$.asset_status') AS asset_status,
           json_extract(value, '$.created_at') AS created_at,
           json_extract(value, '$.last_error') AS last_error,
           json_extract(value, '$.next_attempt_at') AS next_attempt_at
         FROM json_each(?)
       )
       UPDATE icono_storage_audit_queue
       SET status = 'retrying',
           is_current = COALESCE((
             SELECT ir.is_current
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_current),
           is_stale = COALESCE((
             SELECT ir.is_stale
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_stale),
           is_legacy = COALESCE((
             SELECT ir.is_legacy
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.is_legacy),
           asset_status = COALESCE((
             SELECT ir.asset_status
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.asset_status),
           created_at = COALESCE((
             SELECT ir.created_at
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.created_at),
           last_seen_at = CURRENT_TIMESTAMP,
           last_error = COALESCE((
             SELECT ir.last_error
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.last_error),
           attempts = COALESCE(icono_storage_audit_queue.attempts, 0) + 1,
           next_attempt_at = COALESCE((
             SELECT ir.next_attempt_at
             FROM incoming_results ir
             WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
               AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
             LIMIT 1
           ), icono_storage_audit_queue.next_attempt_at),
           updated_at = CURRENT_TIMESTAMP
       WHERE EXISTS (
         SELECT 1
         FROM incoming_results ir
         WHERE ir.gene_symbol = icono_storage_audit_queue.gene_symbol
           AND ir.asset_sha256 = icono_storage_audit_queue.asset_sha256
       )`,
    )
      .bind(JSON.stringify(retryRows))
      .run()
  }

  return successRows.length + retryRows.length
}

async function recordStorageAuditRenderableAsset(
  env,
  {
    symbol,
    assetSha256,
    status = "draft",
    isStale = false,
    isLegacy = false,
    isCurrent = false,
    createdAt = "",
  } = {},
) {
  if (!env.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  const safeAssetSha = normalizeSha256(assetSha256 || "")
  if (!safeSymbol || !safeAssetSha) return false
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_storage_audit_queue (
       gene_symbol,
       asset_sha256,
       status,
       audit_state,
       missing_renditions_json,
       is_current,
       is_stale,
       is_legacy,
       asset_status,
       created_at,
       last_seen_at,
       last_audited_at,
       last_error,
       attempts,
       next_attempt_at,
       updated_at
     ) VALUES (?, ?, 'completed', 'renderable', '[]', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
       status = 'completed',
       audit_state = 'renderable',
       missing_renditions_json = '[]',
       is_current = excluded.is_current,
       is_stale = excluded.is_stale,
       is_legacy = excluded.is_legacy,
       asset_status = excluded.asset_status,
       created_at = excluded.created_at,
       last_seen_at = CURRENT_TIMESTAMP,
       last_audited_at = CURRENT_TIMESTAMP,
       last_error = '',
       attempts = 0,
       next_attempt_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      safeSymbol,
      safeAssetSha,
      isCurrent ? 1 : 0,
      isStale ? 1 : 0,
      isLegacy ? 1 : 0,
      normalizeAssetStatus(status || "", "draft"),
      sanitizeText(createdAt || "", 64) || "",
    )
    .run()
  return true
}

async function fetchKnownBrokenStorageAuditRows(env, { requestedSymbols = null, limit = 50 } = {}) {
  if (!env.ICONOPLASM_DB) return []
  const wantedSymbols = Array.isArray(requestedSymbols)
    ? normalizeAdminAssetMaintenanceSymbols(requestedSymbols, 5000)
    : []
  const applyScope = wantedSymbols.length > 0 ? 1 : 0
  const cleanedLimit = normalizeAdminAssetMaintenanceLimit(limit, 50, 250)
  // Chesterton's fence: repairing only the already-broken audit backlog turns
  // Website Ops into a hall pass for inaction. The real missing-image problem
  // shows up long before the storage audit has crawled the whole corpus, so the
  // repair button has to work from the currently published portrait whenever it
  // is not yet proven renderable. Keep broken audited rows first, but fall back
  // to current live portraits whose storage truth is still unknown so each
  // repair click can make bounded forward progress instead of waiting for a
  // near-complete audit sweep.
  const response = await env.ICONOPLASM_DB.prepare(
    `WITH incoming_scope AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT
       ps.gene_symbol,
       ps.current_asset_sha256 AS asset_sha256,
       COALESCE(pa.status, 'draft') AS status,
       COALESCE(pa.is_stale, 0) AS is_stale,
       COALESCE(pa.is_legacy, 0) AS is_legacy,
       COALESCE(pa.created_at, '') AS created_at,
       1 AS is_current,
       COALESCE(q.last_audited_at, '') AS last_audited_at,
       COALESCE(q.missing_renditions_json, '[]') AS missing_renditions_json,
       COALESCE(q.audit_state, 'unknown') AS audit_state
     FROM icono_publish_state ps
     JOIN icono_portrait_assets pa
       ON pa.gene_symbol = ps.gene_symbol
      AND pa.asset_sha256 = ps.current_asset_sha256
     LEFT JOIN icono_storage_audit_queue q
       ON q.gene_symbol = ps.gene_symbol
      AND q.asset_sha256 = ps.current_asset_sha256
     WHERE COALESCE(ps.current_asset_sha256, '') <> ''
       AND (? = 0 OR ps.gene_symbol IN (SELECT gene_symbol FROM incoming_scope))
       AND COALESCE(pa.is_legacy, 0) = 0
       AND lower(COALESCE(pa.status, 'draft')) <> 'rejected'
      AND COALESCE(q.audit_state, 'unknown') <> 'renderable'
     ORDER BY
       CASE COALESCE(q.audit_state, 'unknown')
         WHEN 'broken' THEN 0
         ELSE 1
       END ASC,
       CASE WHEN COALESCE(q.last_audited_at, '') = '' THEN 0 ELSE 1 END ASC,
       COALESCE(q.last_audited_at, '') ASC,
       COALESCE(pa.created_at, '') DESC,
       ps.gene_symbol ASC,
       ps.current_asset_sha256 ASC
     LIMIT ?`,
  )
    .bind(JSON.stringify(wantedSymbols), applyScope, cleanedLimit)
    .all()
  return (Array.isArray(response?.results) ? response.results : []).map((row) => ({
    symbol: normalizeSymbol(row?.gene_symbol || "") || "",
    asset_sha256: normalizeSha256(row?.asset_sha256 || "") || "",
    status: normalizeAssetStatus(row?.status || "", "draft"),
    is_stale: Number(row?.is_stale || 0) > 0,
    is_legacy: Number(row?.is_legacy || 0) > 0,
    is_current: Number(row?.is_current || 0) > 0,
    created_at: sanitizeText(row?.created_at || "", 64) || "",
    last_audited_at: sanitizeText(row?.last_audited_at || "", 64) || "",
    storage_complete: false,
    missing_renditions: parseAdminAssetMissingRenditions(row?.missing_renditions_json),
  }))
}

async function fetchAdminAssetStorageAudit(env, { requestedSymbols = null, limit = 100 } = {}) {
  await seedStorageAuditQueueStep(env, {
    requestedSymbols,
    symbolBatch: ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH,
  })
  const safeLimit = normalizeStorageAuditInspectionLimit(limit, 100)
  const queuedRows = await selectStorageAuditQueueRowsToProcess(env, {
    requestedSymbols,
    limit: safeLimit,
  })
  const inspectedRows = await inspectAdminAssetStorageRows(env, queuedRows, {
    concurrency: ICONO_STORAGE_AUDIT_INSPECT_CONCURRENCY,
  })
  await writeStorageAuditQueueInspectionResults(env, inspectedRows)
  return {
    rows: inspectedRows.filter((row) => row?.ok),
    processed_assets: inspectedRows.filter((row) => row?.ok).length,
    summary: await fetchAdminAssetSummaryCounts(env, { refresh: true }),
  }
}

async function fetchAdminAssetRepairScope(env, { requestedSymbols = null, limit = 50 } = {}) {
  await seedStorageAuditQueueStep(env, {
    requestedSymbols,
    symbolBatch: ICONO_STORAGE_AUDIT_SEED_SYMBOL_BATCH,
  })
  const summary = await fetchAdminAssetSummaryCounts(env, { refresh: true })
  return {
    rows: await fetchKnownBrokenStorageAuditRows(env, { requestedSymbols, limit }),
    scanned_assets: Math.max(0, Number(summary?.audited_assets || 0)),
    summary,
  }
}

async function fetchCatalogRow(env, symbol) {
  if (!env.ICONOPLASM_DB || !symbol) return null
  try {
    const row = await env.ICONOPLASM_DB.prepare(
      // D1 cost fence: icono_gene_catalog is keyed by normalized gene_symbol.
      // Leave the primary key unwrapped so single-gene lookups stay index-backed.
      `SELECT gene_symbol, full_name, uniprot, color_hex, tmh, aliases_json, updated_at
       FROM icono_gene_catalog
       WHERE gene_symbol = ?
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

async function resolveGene(env, rawId, { includeProtein = true } = {}) {
  const symbol = normalizeSymbol(rawId)
  if (!symbol) return null
  const catalog = await fetchCatalogRow(env, symbol)
  if (!catalog) return null

  let protein = null
  if (includeProtein && catalog.uniprot && env.DB) {
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
      `SELECT ps.current_asset_sha256 AS asset_sha256, pa.width, pa.height, pa.vision_id, pa.candidate_image_id, pa.emulsion_id
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
      // Chesterton's fence: the public runtime owns the portrait URL contract.
      // Derive it from the published asset SHA instead of depending on legacy
      // per-row key copies that were easy to drift and hard to reason about.
      hero_url: adminPortraitUrl(base, row.asset_sha256, "full"),
      medium_url: adminPortraitUrl(base, row.asset_sha256, "medium"),
      thumb_url: adminPortraitUrl(base, row.asset_sha256, "thumb"),
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

function requestedFieldSet(rawFields) {
  const fields = parseProjectedFields(rawFields)
  return Array.isArray(fields) && fields.length ? new Set(fields) : null
}

function wantsProjectedField(fieldSet, field) {
  return !fieldSet || fieldSet.has(field)
}

async function geneRecord(env, url, rawId, { fields = null } = {}) {
  // Cost fence: extension hover traffic hits /genes/batch repeatedly across
  // arbitrary pages. When the caller projects a lean field set, treat that as a
  // real permission to skip the richer request-time work instead of building the
  // full deluxe gene record and throwing most of it away afterward.
  const fieldSet = requestedFieldSet(fields)
  const needsPortrait =
    wantsProjectedField(fieldSet, "portrait") ||
    wantsProjectedField(fieldSet, "media") ||
    wantsProjectedField(fieldSet, "portrait_candidates")
  const needsPortraitCandidates = wantsProjectedField(fieldSet, "portrait_candidates")
  const needsEssence =
    wantsProjectedField(fieldSet, "essence") ||
    wantsProjectedField(fieldSet, "manifestation") ||
    wantsProjectedField(fieldSet, "weight_kg") ||
    wantsProjectedField(fieldSet, "tissue_tau") ||
    wantsProjectedField(fieldSet, "loeuf") ||
    wantsProjectedField(fieldSet, "constraint_percentile")
  const needsProtein =
    !fieldSet ||
    wantsProjectedField(fieldSet, "protein_length_aa") ||
    wantsProjectedField(fieldSet, "molecular_weight_kda") ||
    wantsProjectedField(fieldSet, "first_publication_year") ||
    wantsProjectedField(fieldSet, "primary_tissue")
  const needsUniprot =
    wantsProjectedField(fieldSet, "uniprot") || wantsProjectedField(fieldSet, "source_links")
  const needsMedia = wantsProjectedField(fieldSet, "media")
  const needsSourceLinks = wantsProjectedField(fieldSet, "source_links")
  const needsPageUrl = wantsProjectedField(fieldSet, "page_url")
  const needsAliases = wantsProjectedField(fieldSet, "aliases")
  const needsFullName = wantsProjectedField(fieldSet, "full_name")
  const needsColor = wantsProjectedField(fieldSet, "color")
  const needsPopularityScore = wantsProjectedField(fieldSet, "popularity_score")
  const wantsWeightKg = wantsProjectedField(fieldSet, "weight_kg")
  const wantsProteinLengthAa = wantsProjectedField(fieldSet, "protein_length_aa")
  const wantsMolecularWeightKda = wantsProjectedField(fieldSet, "molecular_weight_kda")
  const wantsFirstPublicationYear = wantsProjectedField(fieldSet, "first_publication_year")
  const wantsTissueTau = wantsProjectedField(fieldSet, "tissue_tau")
  const wantsLoeuf = wantsProjectedField(fieldSet, "loeuf")
  const wantsConstraintPercentile = wantsProjectedField(fieldSet, "constraint_percentile")
  const wantsPrimaryTissue = wantsProjectedField(fieldSet, "primary_tissue")

  const r = await resolveGene(env, rawId, { includeProtein: needsProtein })
  if (!r?.symbol) return null
  const base = needsPortrait ? portraitBase(url, env) : null
  const portrait = needsPortrait ? await portraitState(env, r.symbol, base) : null
  const portraitCandidates = needsPortraitCandidates
    ? await portraitCandidatesForGene(env, url, r.symbol, portrait?.asset_sha256 || null)
    : []
  const syncedEssenceState = needsEssence ? await essenceState(env, r.symbol) : null
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
  const tooltipEssence = needsEssence
    ? {
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
              politics_origin: syncedPoliticsOrigin.length
                ? syncedPoliticsOrigin
                : livePoliticsOrigin,
            }
          : {}),
        ...((syncedSexOrigin.length ? syncedSexOrigin : liveSexOrigin).length
          ? {
              sex_origin: syncedSexOrigin.length ? syncedSexOrigin : liveSexOrigin,
            }
          : {}),
      }
    : null
  const uniprot = needsUniprot
    ? normalizeUniprot(r?.catalog?.uniprot || r?.protein?.uniprot || null)
    : null
  const fullName = needsFullName
    ? sanitizeText(r?.catalog?.full_name, 255) || identityFullName
    : null
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
    ...(needsFullName ? { full_name: fullName } : {}),
    ...(needsAliases && Array.isArray(r?.catalog?.aliases) && r.catalog.aliases.length
      ? { aliases: r.catalog.aliases }
      : {}),
    ...(needsColor ? { color: r?.catalog?.color_hex || null } : {}),
    ...(uniprot ? { uniprot } : {}),
    ...(wantsWeightKg && weightKg != null ? { weight_kg: weightKg } : {}),
    ...(wantsProteinLengthAa && proteinLengthAa != null
      ? { protein_length_aa: proteinLengthAa }
      : {}),
    ...(wantsMolecularWeightKda && molecularWeightKda != null
      ? { molecular_weight_kda: molecularWeightKda }
      : {}),
    ...(wantsFirstPublicationYear && firstPublicationYear != null
      ? { first_publication_year: firstPublicationYear }
      : {}),
    ...(wantsTissueTau && tissueTau != null ? { tissue_tau: tissueTau } : {}),
    ...(wantsLoeuf && loeuf != null ? { loeuf } : {}),
    ...(wantsConstraintPercentile && constraintPercentile != null
      ? { constraint_percentile: constraintPercentile }
      : {}),
    ...(wantsPrimaryTissue && primaryTissue ? { primary_tissue: primaryTissue } : {}),
    ...(needsPopularityScore ? { popularity_score: wikiPageviewsForSymbol(r.symbol) } : {}),
    ...(needsEssence ? { essence: tooltipEssence || {} } : {}),
    ...(wantsProjectedField(fieldSet, "manifestation") && syncedEssenceState?.manifestation
      ? { manifestation: syncedEssenceState.manifestation }
      : {}),
    ...(needsPortrait ? { portrait } : {}),
    ...(needsMedia ? { media: publicMediaEnvelope(url, r.symbol, portrait) } : {}),
    ...(needsPortraitCandidates ? { portrait_candidates: portraitCandidates } : {}),
    ...(needsSourceLinks ? { source_links: sourceLinks(r.symbol, uniprot) } : {}),
    ...(needsPageUrl ? { page_url: `${url.origin}/gene/${encodeURIComponent(r.symbol)}` } : {}),
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

async function iconoplasmVoteCoordinatorState(env, { symbol } = {}) {
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return null
  const stub = iconoplasmVoteCoordinatorStub(env, safeSymbol)
  if (!stub) return null
  return iconoplasmVoteCoordinatorJson(stub, "/state", {
    symbol: safeSymbol,
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
    return row
      ? mapCoordinatorAssetSummaryRow({ ...row, gene_symbol: this.getMeta("symbol") })
      : null
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
    return row
      ? mapCoordinatorAssetSummaryRow({ ...row, gene_symbol: this.getMeta("symbol") })
      : null
  }

  async ensureAssetSummaryFromMetadata(
    symbol,
    assetSha256,
    visionId = "",
    candidateImageId = null,
  ) {
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

  applyVoteMutation({
    assetSha256,
    userId,
    requestedVoteValue,
    visionId = "",
    candidateImageId = null,
    ensuredAsset = null,
    toggleOffWhenSame = true,
  } = {}) {
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
    const visionRow = resolvedVisionId
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
        const current = assetMap.get(assetSha) || {
          asset_sha256: assetSha,
          vision_id: sanitizeVoteVisionId(rawVote?.vision_id || "") || "",
          candidate_image_id: optionalInt(rawVote?.candidate_image_id),
          upvotes: 0,
          downvotes: 0,
          score: 0,
          vote_count: 0,
        }
        current.vision_id =
          sanitizeVoteVisionId(current.vision_id || rawVote?.vision_id || "") || ""
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

function isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error) {
  const message = String(error?.message || error || "").trim()
  return message.includes("Exceeded allowed rows written in Durable Objects free tier")
}

export class IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate {
  constructor(state) {
    this.state = state
    this.state.blockConcurrencyWhile(async () => {
      try {
        // The budget ledger lives in a single durable object so all isolates spend
        // from one shared counter. Module-memory counters were exactly the kind of
        // fake safety that let the old model explode financially.
        this.state.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS daily_budget_usage (
            day_key TEXT PRIMARY KEY,
            cycle_key TEXT NOT NULL DEFAULT '',
            rows_read INTEGER NOT NULL DEFAULT 0,
            rows_written INTEGER NOT NULL DEFAULT 0,
            query_count INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `)
        const usageColumns = this.state.storage.sql
          .exec(`PRAGMA table_info(daily_budget_usage)`)
          .toArray()
        const usageColumnNames = new Set(usageColumns.map((column) => String(column?.name || "")))
        if (!usageColumnNames.has("cycle_key")) {
          this.state.storage.sql.exec(
            `ALTER TABLE daily_budget_usage ADD COLUMN cycle_key TEXT NOT NULL DEFAULT ''`,
          )
        }
        if (!usageColumnNames.has("request_count")) {
          this.state.storage.sql.exec(
            `ALTER TABLE daily_budget_usage ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0`,
          )
        }
        this.state.storage.sql.exec(`
          CREATE TABLE IF NOT EXISTS daily_budget_usage_attribution (
            day_key TEXT NOT NULL,
            cycle_key TEXT NOT NULL,
            route_family TEXT NOT NULL,
            actor_class TEXT NOT NULL,
            source_class TEXT NOT NULL,
            rows_read INTEGER NOT NULL DEFAULT 0,
            rows_written INTEGER NOT NULL DEFAULT 0,
            query_count INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (day_key, cycle_key, route_family, actor_class, source_class)
          );
        `)
        const attributionColumns = this.state.storage.sql
          .exec(`PRAGMA table_info(daily_budget_usage_attribution)`)
          .toArray()
        const attributionColumnNames = new Set(
          attributionColumns.map((column) => String(column?.name || "")),
        )
        const attributionPrimaryKey = attributionColumns
          .filter((column) => Number(column?.pk || 0) > 0)
          .sort((left, right) => Number(left?.pk || 0) - Number(right?.pk || 0))
          .map((column) => String(column?.name || ""))
        const expectedAttributionPrimaryKey = [
          "day_key",
          "cycle_key",
          "route_family",
          "actor_class",
          "source_class",
        ]
        const attributionNeedsRebuild =
          !expectedAttributionPrimaryKey.every((name) => attributionColumnNames.has(name)) ||
          attributionPrimaryKey.length !== expectedAttributionPrimaryKey.length ||
          expectedAttributionPrimaryKey.some(
            (name, index) => attributionPrimaryKey[index] !== name,
          ) ||
          !attributionColumnNames.has("request_count")
        if (attributionNeedsRebuild) {
          // Chesterton's fence: `/api/iconoplasm/admin/cost/usage` is supposed to
          // explain past D1 spend, including rows recorded before we added
          // cycle_key/request_count to the attribution ledger. If we only CREATE
          // TABLE IF NOT EXISTS here, older live durable-object storage keeps the
          // stale schema forever and the report crashes the first time it asks for
          // the newer columns. Rebuild the table in place so production can read
          // its old history instead of faceplanting on a migration it never got.
          this.state.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS daily_budget_usage_attribution_v2_do_not_delete (
              day_key TEXT NOT NULL,
              cycle_key TEXT NOT NULL,
              route_family TEXT NOT NULL,
              actor_class TEXT NOT NULL,
              source_class TEXT NOT NULL,
              rows_read INTEGER NOT NULL DEFAULT 0,
              rows_written INTEGER NOT NULL DEFAULT 0,
              query_count INTEGER NOT NULL DEFAULT 0,
              request_count INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (day_key, cycle_key, route_family, actor_class, source_class)
            );
          `)
          const attributionDayKeyExpr = attributionColumnNames.has("day_key") ? "day_key" : "''"
          const attributionCycleKeyExpr = attributionColumnNames.has("cycle_key")
            ? "cycle_key"
            : attributionColumnNames.has("day_key")
              ? "day_key"
              : "''"
          const attributionRouteFamilyExpr = attributionColumnNames.has("route_family")
            ? "route_family"
            : "'unknown'"
          const attributionActorClassExpr = attributionColumnNames.has("actor_class")
            ? "actor_class"
            : "'unknown'"
          const attributionSourceClassExpr = attributionColumnNames.has("source_class")
            ? "source_class"
            : "'unknown'"
          const attributionRowsReadExpr = attributionColumnNames.has("rows_read")
            ? "COALESCE(SUM(rows_read), 0)"
            : "0"
          const attributionRowsWrittenExpr = attributionColumnNames.has("rows_written")
            ? "COALESCE(SUM(rows_written), 0)"
            : "0"
          const attributionQueryCountExpr = attributionColumnNames.has("query_count")
            ? "COALESCE(SUM(query_count), 0)"
            : "0"
          const attributionRequestCountExpr = attributionColumnNames.has("request_count")
            ? "COALESCE(SUM(request_count), 0)"
            : "0"
          const attributionUpdatedAtExpr = attributionColumnNames.has("updated_at")
            ? "COALESCE(MAX(updated_at), CURRENT_TIMESTAMP)"
            : "CURRENT_TIMESTAMP"
          this.state.storage.sql.exec(
            `INSERT INTO daily_budget_usage_attribution_v2_do_not_delete (
               day_key,
               cycle_key,
               route_family,
               actor_class,
               source_class,
               rows_read,
               rows_written,
               query_count,
               request_count,
               updated_at
             )
             SELECT
               ${attributionDayKeyExpr} AS day_key,
               ${attributionCycleKeyExpr} AS cycle_key,
               ${attributionRouteFamilyExpr} AS route_family,
               ${attributionActorClassExpr} AS actor_class,
               ${attributionSourceClassExpr} AS source_class,
               ${attributionRowsReadExpr} AS rows_read,
               ${attributionRowsWrittenExpr} AS rows_written,
               ${attributionQueryCountExpr} AS query_count,
               ${attributionRequestCountExpr} AS request_count,
               ${attributionUpdatedAtExpr} AS updated_at
             FROM daily_budget_usage_attribution
             GROUP BY day_key, cycle_key, route_family, actor_class, source_class`,
          )
          this.state.storage.sql.exec(`DROP TABLE daily_budget_usage_attribution`)
          this.state.storage.sql.exec(
            `ALTER TABLE daily_budget_usage_attribution_v2_do_not_delete RENAME TO daily_budget_usage_attribution`,
          )
        }
      } catch (error) {
        // Chesterton's fence: when Cloudflare has already started rejecting DO
        // writes for the day, the read-only cost report still needs to work so a
        // human can see how bad the damage is. Swallow only the specific free-tier
        // write-cap error from constructor-time schema DDL; actual request writes
        // should still fail loudly later in `/record`.
        if (!isIconoplasmDurableObjectRowsWrittenFreeTierExceededError(error)) {
          throw error
        }
      }
    })
  }

  usageRow(dayKey) {
    return (
      this.state.storage.sql
        .exec(
          `SELECT day_key, cycle_key, rows_read, rows_written, query_count, request_count, updated_at
           FROM daily_budget_usage
           WHERE day_key = ?`,
          String(dayKey || ""),
        )
        .toArray()[0] || null
    )
  }

  cycleUsageRow(cycleKey) {
    return (
      this.state.storage.sql
        .exec(
          `SELECT
             COALESCE(SUM(rows_read), 0) AS rows_read,
             COALESCE(SUM(rows_written), 0) AS rows_written,
             COALESCE(SUM(query_count), 0) AS query_count,
             COALESCE(SUM(request_count), 0) AS request_count
           FROM daily_budget_usage
           WHERE cycle_key = ?`,
          String(cycleKey || ""),
        )
        .toArray()[0] || null
    )
  }

  smartDailyLimit(monthlyRemainingAtStartOfDay, daysRemainingInCycle, burstMultiplier) {
    const remaining = Math.max(0, Number(monthlyRemainingAtStartOfDay || 0) || 0)
    const daysRemaining = Math.max(1, Number(daysRemainingInCycle || 1) || 1)
    const burst = Math.max(1, Number(burstMultiplier || 1) || 1)
    if (remaining <= 0) return 0
    const baseAllowance = Math.ceil(remaining / daysRemaining)
    return Math.min(remaining, Math.max(baseAllowance, Math.ceil(baseAllowance * burst)))
  }

  attributionRows(dayKey, cycleKey, mode = "daily") {
    const sql =
      mode === "cycle"
        ? `SELECT
             route_family,
             actor_class,
             source_class,
             SUM(rows_read) AS rows_read,
             SUM(rows_written) AS rows_written,
             SUM(query_count) AS query_count,
             SUM(request_count) AS request_count,
             MAX(updated_at) AS updated_at
           FROM daily_budget_usage_attribution
           WHERE cycle_key = ?
           GROUP BY route_family, actor_class, source_class
           ORDER BY rows_read DESC, rows_written DESC, request_count DESC, route_family ASC`
        : `SELECT
             route_family,
             actor_class,
             source_class,
             rows_read,
             rows_written,
             query_count,
             request_count,
             updated_at
           FROM daily_budget_usage_attribution
           WHERE day_key = ?
           ORDER BY rows_read DESC, rows_written DESC, request_count DESC, route_family ASC`
    return this.state.storage.sql
      .exec(sql, mode === "cycle" ? String(cycleKey || "") : String(dayKey || ""))
      .toArray()
      .map((row) => ({
        ...row,
        budget_class: iconoplasmBudgetClassFromHistoricalRouteFamilyForReport(
          row?.route_family || "",
        ),
      }))
  }

  cycleDayRows(cycleKey) {
    return this.state.storage.sql
      .exec(
        `SELECT
           day_key,
           cycle_key,
           rows_read,
           rows_written,
           query_count,
           request_count,
           updated_at
         FROM daily_budget_usage
         WHERE cycle_key = ?
         ORDER BY day_key ASC`,
        String(cycleKey || ""),
      )
      .toArray()
  }

  cycleDayRowsWithBudgetHistory(cycleKey, budgets) {
    const rows = this.cycleDayRows(cycleKey)
    const rowsReadMonthlyLimit = Math.max(0, Number(budgets?.rowsReadMonthlyLimit || 0) || 0)
    const rowsWrittenMonthlyLimit = Math.max(0, Number(budgets?.rowsWrittenMonthlyLimit || 0) || 0)
    const burstMultiplier = Math.max(1, Number(budgets?.dailyBurstMultiplier || 1) || 1)
    const cycleStart = new Date(String(cycleKey || "") + "T00:00:00.000Z")
    const cycleStartMs = cycleStart.getTime()
    const nextCycleStartMs = Number.isFinite(cycleStartMs)
      ? Date.UTC(
          cycleStart.getUTCFullYear(),
          cycleStart.getUTCMonth() + 1,
          cycleStart.getUTCDate(),
          0,
          0,
          0,
          0,
        )
      : NaN
    let cycleRowsReadBeforeDay = 0
    let cycleRowsWrittenBeforeDay = 0
    return rows.map((row) => {
      const dayStart = new Date(String(row?.day_key || "") + "T00:00:00.000Z")
      const dayStartMs = dayStart.getTime()
      const daysRemainingInCycle =
        Number.isFinite(nextCycleStartMs) && Number.isFinite(dayStartMs)
          ? Math.max(1, Math.ceil((nextCycleStartMs - dayStartMs) / 86400000))
          : 1
      const rowsRead = Math.max(0, Number(row?.rows_read || 0) || 0)
      const rowsWritten = Math.max(0, Number(row?.rows_written || 0) || 0)
      const rowsReadDailySmartLimit =
        rowsReadMonthlyLimit > 0
          ? this.smartDailyLimit(
              rowsReadMonthlyLimit - cycleRowsReadBeforeDay,
              daysRemainingInCycle,
              burstMultiplier,
            )
          : null
      const rowsWrittenDailySmartLimit =
        rowsWrittenMonthlyLimit > 0
          ? this.smartDailyLimit(
              rowsWrittenMonthlyLimit - cycleRowsWrittenBeforeDay,
              daysRemainingInCycle,
              burstMultiplier,
            )
          : null
      const out = {
        ...row,
        days_remaining_in_cycle: daysRemainingInCycle,
        rows_read_daily_smart_limit: rowsReadDailySmartLimit,
        rows_written_daily_smart_limit: rowsWrittenDailySmartLimit,
        rows_read_daily_remaining:
          rowsReadDailySmartLimit !== null ? Math.max(0, rowsReadDailySmartLimit - rowsRead) : null,
        rows_written_daily_remaining:
          rowsWrittenDailySmartLimit !== null
            ? Math.max(0, rowsWrittenDailySmartLimit - rowsWritten)
            : null,
      }
      cycleRowsReadBeforeDay += rowsRead
      cycleRowsWrittenBeforeDay += rowsWritten
      return out
    })
  }

  snapshot(dayKey, cycleKey, budgets, daysRemainingInCycle) {
    const row = this.usageRow(dayKey) || {}
    const cycleRow = this.cycleUsageRow(cycleKey) || {}
    const rowsRead = Math.max(0, Number(row?.rows_read || 0) || 0)
    const rowsWritten = Math.max(0, Number(row?.rows_written || 0) || 0)
    const cycleRowsRead = Math.max(0, Number(cycleRow?.rows_read || 0) || 0)
    const cycleRowsWritten = Math.max(0, Number(cycleRow?.rows_written || 0) || 0)
    const rowsReadMonthlyLimit = Math.max(0, Number(budgets?.rowsReadMonthlyLimit || 0) || 0)
    const rowsWrittenMonthlyLimit = Math.max(0, Number(budgets?.rowsWrittenMonthlyLimit || 0) || 0)
    const burstMultiplier = Math.max(1, Number(budgets?.dailyBurstMultiplier || 1) || 1)
    const cycleRowsReadBeforeToday = Math.max(0, cycleRowsRead - rowsRead)
    const cycleRowsWrittenBeforeToday = Math.max(0, cycleRowsWritten - rowsWritten)
    const rowsReadMonthlyRemaining =
      rowsReadMonthlyLimit > 0 ? Math.max(0, rowsReadMonthlyLimit - cycleRowsRead) : null
    const rowsWrittenMonthlyRemaining =
      rowsWrittenMonthlyLimit > 0 ? Math.max(0, rowsWrittenMonthlyLimit - cycleRowsWritten) : null
    const rowsReadDailySmartLimit =
      rowsReadMonthlyLimit > 0
        ? this.smartDailyLimit(
            rowsReadMonthlyLimit - cycleRowsReadBeforeToday,
            daysRemainingInCycle,
            burstMultiplier,
          )
        : null
    const rowsWrittenDailySmartLimit =
      rowsWrittenMonthlyLimit > 0
        ? this.smartDailyLimit(
            rowsWrittenMonthlyLimit - cycleRowsWrittenBeforeToday,
            daysRemainingInCycle,
            burstMultiplier,
          )
        : null
    const rowsReadDailyExceeded =
      rowsReadDailySmartLimit !== null && rowsRead >= rowsReadDailySmartLimit
    const rowsWrittenDailyExceeded =
      rowsWrittenDailySmartLimit !== null && rowsWritten >= rowsWrittenDailySmartLimit
    const rowsReadMonthlyExceeded =
      rowsReadMonthlyLimit > 0 && cycleRowsRead >= rowsReadMonthlyLimit
    const rowsWrittenMonthlyExceeded =
      rowsWrittenMonthlyLimit > 0 && cycleRowsWritten >= rowsWrittenMonthlyLimit
    return {
      day_key: dayKey,
      cycle_key: cycleKey,
      rows_read: rowsRead,
      rows_written: rowsWritten,
      query_count: Math.max(0, Number(row?.query_count || 0) || 0),
      request_count: Math.max(0, Number(row?.request_count || 0) || 0),
      cycle_rows_read: cycleRowsRead,
      cycle_rows_written: cycleRowsWritten,
      cycle_query_count: Math.max(0, Number(cycleRow?.query_count || 0) || 0),
      cycle_request_count: Math.max(0, Number(cycleRow?.request_count || 0) || 0),
      rows_read_monthly_limit: rowsReadMonthlyLimit || null,
      rows_written_monthly_limit: rowsWrittenMonthlyLimit || null,
      rows_read_monthly_remaining: rowsReadMonthlyRemaining,
      rows_written_monthly_remaining: rowsWrittenMonthlyRemaining,
      rows_read_daily_smart_limit: rowsReadDailySmartLimit,
      rows_written_daily_smart_limit: rowsWrittenDailySmartLimit,
      rows_read_daily_remaining:
        rowsReadDailySmartLimit !== null ? Math.max(0, rowsReadDailySmartLimit - rowsRead) : null,
      rows_written_daily_remaining:
        rowsWrittenDailySmartLimit !== null
          ? Math.max(0, rowsWrittenDailySmartLimit - rowsWritten)
          : null,
      days_remaining_in_cycle: Math.max(1, Number(daysRemainingInCycle || 1) || 1),
      daily_burst_multiplier: burstMultiplier,
      exhausted:
        rowsReadMonthlyExceeded ||
        rowsWrittenMonthlyExceeded ||
        rowsReadDailyExceeded ||
        rowsWrittenDailyExceeded,
      exhausted_by: rowsReadMonthlyExceeded
        ? "rows_read_monthly"
        : rowsWrittenMonthlyExceeded
          ? "rows_written_monthly"
          : rowsReadDailyExceeded
            ? "rows_read_daily_smart"
            : rowsWrittenDailyExceeded
              ? "rows_written_daily_smart"
              : null,
      updated_at: row?.updated_at || null,
    }
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 })
    }
    let payload = {}
    try {
      payload = (await request.json()) || {}
    } catch {}
    const dayKeyRaw = String(payload?.day_key || "").trim()
    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(dayKeyRaw) ? dayKeyRaw : iconoplasmUtcDayKey()
    const cycleKeyRaw = String(payload?.cycle_key || "").trim()
    const cycleKey = /^\d{4}-\d{2}-\d{2}$/.test(cycleKeyRaw) ? cycleKeyRaw : dayKey
    const daysRemainingInCycle = Math.max(1, Number(payload?.days_remaining_in_cycle || 1) || 1)
    const budgets = {
      rowsReadMonthlyLimit: positiveIntFromEnv(payload?.budgets?.rowsReadMonthlyLimit, 0),
      rowsWrittenMonthlyLimit: positiveIntFromEnv(payload?.budgets?.rowsWrittenMonthlyLimit, 0),
      dailyBurstMultiplier: positiveNumberFromEnv(payload?.budgets?.dailyBurstMultiplier, 1),
    }

    if (url.pathname === "/snapshot") {
      return Response.json(this.snapshot(dayKey, cycleKey, budgets, daysRemainingInCycle))
    }

    if (url.pathname === "/record") {
      const rowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
      const rowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
      const queryCount = Math.max(0, Number(payload?.query_count || 0) || 0)
      const requestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
      this.state.storage.sql.exec(
        `INSERT INTO daily_budget_usage (
           day_key,
           cycle_key,
           rows_read,
           rows_written,
           query_count,
           request_count,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(day_key) DO UPDATE SET
           cycle_key = excluded.cycle_key,
           rows_read = daily_budget_usage.rows_read + excluded.rows_read,
           rows_written = daily_budget_usage.rows_written + excluded.rows_written,
           query_count = daily_budget_usage.query_count + excluded.query_count,
           request_count = daily_budget_usage.request_count + excluded.request_count,
           updated_at = CURRENT_TIMESTAMP`,
        dayKey,
        cycleKey,
        rowsRead,
        rowsWritten,
        queryCount,
        requestCount,
      )
      // 2026 architecture fence: this DO remains the shared enforcement ledger,
      // but route-level attribution no longer belongs on the synchronous admin
      // mutation hot path. Updating both tables per request made the budget DO
      // pay twice to describe each write. Keep historical attribution rows
      // readable for forensics, but stop minting new ones here; detailed cost
      // attribution now comes from Cloudflare observability and baked snapshots.
      return Response.json(this.snapshot(dayKey, cycleKey, budgets, daysRemainingInCycle))
    }

    if (url.pathname === "/report") {
      return Response.json({
        snapshot: this.snapshot(dayKey, cycleKey, budgets, daysRemainingInCycle),
        cycle_days: this.cycleDayRowsWithBudgetHistory(cycleKey, budgets),
        daily_attribution: this.attributionRows(dayKey, cycleKey, "daily"),
        cycle_attribution: this.attributionRows(dayKey, cycleKey, "cycle"),
      })
    }

    return Response.json({ error: "Not found" }, { status: 404 })
  }
}

function clampIconoplasmSyncGovernorPermits(value) {
  const parsed = Number.parseInt(String(value || 0), 10)
  if (!Number.isFinite(parsed)) return ICONOPLASM_SYNC_GOVERNOR_MIN_BATCH_PERMITS
  return Math.max(
    ICONOPLASM_SYNC_GOVERNOR_MIN_BATCH_PERMITS,
    Math.min(ICONOPLASM_SYNC_GOVERNOR_MAX_BATCH_PERMITS, parsed),
  )
}

function iconoplasmSyncGovernorDefaultState() {
  return {
    batch_permits: 8,
    target_utilization: ICONOPLASM_SYNC_GOVERNOR_TARGET_UTILIZATION,
    observed_utilization: 0,
    current_bottleneck: "warming_up",
    active_consumers: 0,
    last_error_rate: 0,
    last_latency_ms: 0,
    public_health: "unknown",
    updated_at: new Date().toISOString(),
  }
}

function iconoplasmSyncGovernorStateFromRaw(raw) {
  const base = iconoplasmSyncGovernorDefaultState()
  if (!raw || typeof raw !== "object") return base
  return {
    ...base,
    ...raw,
    batch_permits: clampIconoplasmSyncGovernorPermits(raw.batch_permits ?? base.batch_permits),
    target_utilization:
      Number(raw.target_utilization || base.target_utilization) || base.target_utilization,
    observed_utilization: Math.max(0, Math.min(1, Number(raw.observed_utilization || 0) || 0)),
    active_consumers: Math.max(0, Number.parseInt(String(raw.active_consumers || 0), 10) || 0),
    updated_at: String(raw.updated_at || base.updated_at),
  }
}

export class IconoplasmSyncGovernor {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async storedState() {
    const raw = await this.state.storage.get("state")
    return iconoplasmSyncGovernorStateFromRaw(raw)
  }

  async persistState(state) {
    const next = iconoplasmSyncGovernorStateFromRaw({
      ...state,
      updated_at: new Date().toISOString(),
    })
    await this.state.storage.put("state", next)
    return next
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/permit") {
      const stored = await this.storedState()
      const requestedRaw = Number(url.searchParams.get("requested") || "1") || 1
      const requested = Math.max(1, Math.min(100, Math.floor(requestedRaw)))
      const updatedAtMs = Date.parse(String(stored.updated_at || ""))
      const staleMs = Number.isFinite(updatedAtMs)
        ? Date.now() - updatedAtMs
        : Number.POSITIVE_INFINITY
      const stalePublicBrake = stored.public_health !== "healthy" && staleMs > 60_000
      const state = stalePublicBrake
        ? {
            ...stored,
            batch_permits: Math.max(4, Number(stored.batch_permits || 0) || 0),
            current_bottleneck: "cloudflare_queue_consumer",
            public_health: "healthy",
          }
        : stored
      const granted = Math.max(1, Math.min(requested, state.batch_permits))
      const next = await this.persistState({
        ...state,
        active_consumers: Math.max(0, Number(state.active_consumers || 0) + 1),
        observed_utilization: Math.min(
          1,
          Math.max(state.observed_utilization || 0, granted / Math.max(1, requested)),
        ),
      })
      return Response.json({ ok: true, granted, governor: next })
    }
    if (request.method === "POST" && url.pathname === "/release") {
      const payload = await request.json().catch(() => ({}))
      const state = await this.storedState()
      const processed = Math.max(0, Number(payload?.processed || 0) || 0)
      const failed = Math.max(0, Number(payload?.failed || 0) || 0)
      const retrying = Math.max(0, Number(payload?.retrying || 0) || 0)
      const latencyMs = Math.max(0, Number(payload?.latency_ms || payload?.latencyMs || 0) || 0)
      const publicHealth = String(payload?.public_health || "healthy").trim() || "healthy"
      const total = Math.max(1, processed + failed + retrying)
      const errorRate = Math.min(1, (failed + retrying) / total)
      let permits = clampIconoplasmSyncGovernorPermits(state.batch_permits)
      let bottleneck = "cloudflare_queue_consumer"
      if (publicHealth !== "healthy") {
        permits = Math.max(1, Math.floor(permits / 2))
        bottleneck = "public_health"
      } else if (errorRate > 0.05) {
        permits = Math.max(1, Math.floor(permits / 2))
        bottleneck = "worker_errors"
      } else if (latencyMs > 25000) {
        permits = Math.max(1, Math.floor(permits / 2))
        bottleneck = "d1_query_latency"
      } else if (processed > 0 && errorRate === 0) {
        permits = clampIconoplasmSyncGovernorPermits(permits + 1)
        bottleneck = "seeking_bottleneck"
      }
      const next = await this.persistState({
        ...state,
        batch_permits: permits,
        current_bottleneck: bottleneck,
        active_consumers: Math.max(0, Number(state.active_consumers || 0) - 1),
        observed_utilization: Math.min(1, Math.max(0, processed / total)),
        last_error_rate: errorRate,
        last_latency_ms: latencyMs,
        public_health: publicHealth,
      })
      return Response.json({ ok: true, governor: next })
    }
    if (request.method === "POST" && url.pathname === "/cancel") {
      const payload = await request.json().catch(() => ({}))
      const state = await this.storedState()
      const next = await this.persistState({
        ...state,
        cancelled_run_id: String(payload?.run_id || payload?.runId || "").trim(),
        current_bottleneck: "operator_cancelled",
      })
      return Response.json({ ok: true, governor: next })
    }
    return Response.json({ ok: true, governor: await this.storedState() })
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
       AND COALESCE(pa.is_stale, 0) = 0
       AND COALESCE(pa.asset_sha256, '') <> ''
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
         pa.gene_symbol AS symbol,
         pa.asset_sha256 AS asset_sha256,
         pa.status,
         pa.autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         CASE
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current,
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
         ON pa.gene_symbol = i.symbol
        AND pa.asset_sha256 = i.asset_sha256
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = pa.gene_symbol`,
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
         ps.gene_symbol AS symbol,
         COALESCE(ps.current_asset_sha256, '') AS current_asset_sha256,
         COALESCE(ps.admin_override, 0) AS admin_override
       FROM icono_publish_state ps
       JOIN incoming i
         ON ps.gene_symbol = i.symbol`,
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
  // Chesterton's fence: public portrait URLs now derive from asset_sha256.
  // Treat that SHA as the renderability contract too, otherwise the runtime can
  // keep classifying perfectly good published assets as "missing" just because
  // some legacy copied key columns drifted.
  return Boolean(normalizeSha256(row?.asset_sha256 || ""))
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
       SELECT gene_symbol FROM icono_gene_catalog
       UNION
       SELECT gene_symbol FROM icono_portrait_assets
       UNION
       SELECT gene_symbol FROM icono_publish_state
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
       ON pa.gene_symbol = i.gene_symbol
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
       pa.gene_symbol AS gene_symbol,
       pa.asset_sha256 AS asset_sha256,
       'a:' || pa.gene_symbol || '|' || pa.asset_sha256 AS candidate_ref,
       COALESCE(MAX(NULLIF(iv.vision_id, '')), MAX(NULLIF(pa.vision_id, '')), '') AS vision_id,
       COALESCE(MAX(iv.candidate_image_id), MAX(pa.candidate_image_id)) AS candidate_image_id,
       COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
       COALESCE(SUM(iv.vote_value), 0) AS score,
       COALESCE(COUNT(iv.user_id), 0) AS vote_count,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     JOIN incoming i
       ON pa.gene_symbol = i.gene_symbol
     LEFT JOIN icono_image_votes iv
       ON iv.gene_symbol = pa.gene_symbol
      AND iv.asset_sha256 = pa.asset_sha256
     GROUP BY pa.gene_symbol, pa.asset_sha256
     ON CONFLICT(gene_symbol, asset_sha256) DO UPDATE SET
       candidate_ref = excluded.candidate_ref,
       vision_id = excluded.vision_id,
       candidate_image_id = excluded.candidate_image_id,
       upvotes = excluded.upvotes,
       downvotes = excluded.downvotes,
       score = excluded.score,
       vote_count = excluded.vote_count,
       updated_at = CURRENT_TIMESTAMP`,
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
       leader_asset_sha256,
       leader_vision_id,
      leader_emulsion_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
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
         ON gc.gene_symbol = i.gene_symbol
       LEFT JOIN icono_gene_essence ge
         ON ge.gene_symbol = i.gene_symbol
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = i.gene_symbol
     ),
     asset_base AS (
       SELECT
         pa.gene_symbol AS gene_symbol,
         pa.asset_sha256 AS asset_sha256,
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
         ON pa.gene_symbol = i.gene_symbol
       LEFT JOIN icono_vote_asset_summary vs
         ON vs.gene_symbol = pa.gene_symbol
        AND vs.asset_sha256 = pa.asset_sha256
     ),
     asset_counts AS (
       SELECT
         gene_symbol,
         COUNT(*) AS total_assets,
         SUM(
           CASE
             WHEN COALESCE(autopick_eligible, 1) = 1
              AND COALESCE(status, 'draft') <> 'rejected'
              AND COALESCE(asset_sha256, '') <> '' THEN 1
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
         ab.created_at
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
         AND COALESCE(ab.asset_sha256, '') <> ''
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
            OR COALESCE(ca.asset_sha256, '') = ''
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
       la.asset_sha256 AS leader_asset_sha256,
       COALESCE(la.vision_id, '') AS leader_vision_id,
      COALESCE(la.emulsion_id, '') AS leader_emulsion_id,
       COALESCE(la.artist_tag, '') AS leader_artist_tag,
       COALESCE(la.artist_name, '') AS leader_artist_name,
       COALESCE(la.upvotes, 0) AS leader_upvotes,
       COALESCE(la.downvotes, 0) AS leader_downvotes,
       COALESCE(la.score, 0) AS leader_score,
       COALESCE(la.created_at, '') AS leader_created_at,
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
        OR NULLIF(pi.current_asset_sha256, '') IS NOT NULL
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
       leader_asset_sha256 = excluded.leader_asset_sha256,
       leader_vision_id = excluded.leader_vision_id,
       leader_emulsion_id = excluded.leader_emulsion_id,
       leader_artist_tag = excluded.leader_artist_tag,
       leader_artist_name = excluded.leader_artist_name,
       leader_upvotes = excluded.leader_upvotes,
       leader_downvotes = excluded.leader_downvotes,
       leader_score = excluded.leader_score,
       leader_created_at = excluded.leader_created_at,
       updated_at = CURRENT_TIMESTAMP`,
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
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
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
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     LEFT JOIN icono_publish_state ps
       ON ps.gene_symbol = pa.gene_symbol
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     GROUP BY pa.vision_id
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
       leader_asset_sha256,
       leader_vision_id,
      leader_emulsion_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
       leader_asset_sha256 = excluded.leader_asset_sha256,
       leader_vision_id = excluded.leader_vision_id,
      leader_emulsion_id = excluded.leader_emulsion_id,
       leader_artist_tag = excluded.leader_artist_tag,
       leader_artist_name = excluded.leader_artist_name,
       leader_upvotes = excluded.leader_upvotes,
       leader_downvotes = excluded.leader_downvotes,
       leader_score = excluded.leader_score,
       leader_created_at = excluded.leader_created_at,
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
      leaderAsset?.asset_sha256 || null,
      leaderAsset?.vision_id || "",
      leaderAsset?.emulsion_id || "",
      leaderAsset?.artist_tag || "",
      leaderAsset?.artist_name || "",
      Number(leaderAsset?.upvotes || 0),
      Number(leaderAsset?.downvotes || 0),
      Number(leaderAsset?.score || 0),
      leaderAsset?.created_at || "",
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
            WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
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
      await env.ICONOPLASM_DB.prepare(
        `DELETE FROM icono_generation_request_vision_option_rollup WHERE vision_id = ?`,
      )
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
  if (rebuilt > 0) {
    await rebuildGenerationRequestVisionOptionRollupsBatch(env, visionIds)
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
       pa.gene_symbol AS gene_symbol,
       pa.asset_sha256 AS asset_sha256,
       'a:' || pa.gene_symbol || '|' || pa.asset_sha256 AS candidate_ref,
       COALESCE(MAX(NULLIF(iv.vision_id, '')), MAX(NULLIF(pa.vision_id, '')), '') AS vision_id,
       COALESCE(MAX(iv.candidate_image_id), MAX(pa.candidate_image_id)) AS candidate_image_id,
       COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
       COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
       COALESCE(SUM(iv.vote_value), 0) AS score,
       COALESCE(COUNT(iv.user_id), 0) AS vote_count,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_image_votes iv
       ON iv.gene_symbol = pa.gene_symbol
      AND iv.asset_sha256 = pa.asset_sha256
     GROUP BY pa.gene_symbol, pa.asset_sha256`,
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
       leader_asset_sha256,
       leader_vision_id,
      leader_emulsion_id,
       leader_artist_tag,
       leader_artist_name,
       leader_upvotes,
       leader_downvotes,
       leader_score,
       leader_created_at,
       updated_at
     )
     WITH all_symbols AS (
       SELECT gene_symbol FROM icono_gene_catalog
       UNION
       SELECT gene_symbol FROM icono_portrait_assets
       UNION
       SELECT gene_symbol FROM icono_publish_state
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
         ON gc.gene_symbol = s.gene_symbol
       LEFT JOIN icono_gene_essence ge
         ON ge.gene_symbol = s.gene_symbol
       LEFT JOIN icono_publish_state ps
         ON ps.gene_symbol = s.gene_symbol
     ),
     asset_base AS (
       SELECT
         pa.gene_symbol AS gene_symbol,
         pa.asset_sha256 AS asset_sha256,
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
         ON vs.gene_symbol = pa.gene_symbol
        AND vs.asset_sha256 = pa.asset_sha256
     ),
     asset_counts AS (
       SELECT
         gene_symbol,
         COUNT(*) AS total_assets,
         SUM(
           CASE
             WHEN COALESCE(autopick_eligible, 1) = 1
              AND COALESCE(status, 'draft') <> 'rejected'
              AND COALESCE(asset_sha256, '') <> '' THEN 1
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
         ab.created_at
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
         AND COALESCE(ab.asset_sha256, '') <> ''
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
            OR COALESCE(ca.asset_sha256, '') = ''
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
       la.asset_sha256 AS leader_asset_sha256,
       COALESCE(la.vision_id, '') AS leader_vision_id,
      COALESCE(la.emulsion_id, '') AS leader_emulsion_id,
       COALESCE(la.artist_tag, '') AS leader_artist_tag,
       COALESCE(la.artist_name, '') AS leader_artist_name,
       COALESCE(la.upvotes, 0) AS leader_upvotes,
       COALESCE(la.downvotes, 0) AS leader_downvotes,
       COALESCE(la.score, 0) AS leader_score,
       COALESCE(la.created_at, '') AS leader_created_at,
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
           WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END
       ), 0) AS live_count,
       MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
       MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
       MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at,
       CURRENT_TIMESTAMP AS updated_at
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     LEFT JOIN icono_publish_state ps
       ON ps.gene_symbol = pa.gene_symbol
     LEFT JOIN icono_artist_style_blacklist bl
       ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
     WHERE COALESCE(pa.vision_id, '') <> ''
       AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
     GROUP BY pa.vision_id`,
  ).run()

  await env.ICONOPLASM_DB.prepare(`DELETE FROM icono_generation_request_vision_option_rollup`).run()
  const requestPickerVisionIdRows = await env.ICONOPLASM_DB.prepare(
    `SELECT vision_id
     FROM icono_admin_vision_rollup
     WHERE COALESCE(vision_id, '') <> ''
     ORDER BY vision_id ASC`,
  ).all()
  const requestPickerVisionIds = (
    Array.isArray(requestPickerVisionIdRows?.results) ? requestPickerVisionIdRows.results : []
  )
    .map((row) => validAdminRollupVisionId(row?.vision_id || ""))
    .filter(Boolean)
  const requestPickerBatchSize = 48
  for (let start = 0; start < requestPickerVisionIds.length; start += requestPickerBatchSize) {
    const visionChunk = requestPickerVisionIds.slice(start, start + requestPickerBatchSize)
    if (!visionChunk.length) continue
    await rebuildGenerationRequestVisionOptionRollupsBatch(env, visionChunk)
  }

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

  const budgetState = env?.[ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH] || null
  const symbolList = Array.from(
    new Set(symbols.map((value) => normalizeSymbol(value)).filter(Boolean)),
  )
  const finalVisionIdSet = new Set(
    visionIds.map((value) => validAdminRollupVisionId(value)).filter(Boolean),
  )
  const symbolBatchSize = ADMIN_READ_MODEL_SYMBOL_BATCH_DEFAULT
  let processedSymbols = 0
  let processedVisions = 0
  let symbolIndex = 0
  let visionIndex = 0
  let partial = false
  let stopReason = ""
  let observedRowsWrittenPerSymbol = 0
  let observedRowsWrittenPerVision = 0
  let sampledSymbolUnits = 0
  let sampledVisionUnits = 0

  while (symbolIndex < symbolList.length) {
    const requestedSymbolUnits = Math.min(symbolBatchSize, symbolList.length - symbolIndex)
    const allowedSymbolUnits = budgetState
      ? iconoplasmMutationLimiterSuggestedChunkUnits(budgetState, {
          requestedUnits: requestedSymbolUnits,
          observedRowsWrittenPerUnit: observedRowsWrittenPerSymbol,
        })
      : requestedSymbolUnits
    if (allowedSymbolUnits <= 0) {
      partial = true
      stopReason = "rows_written_target_cap_reached_before_symbol_chunk"
      break
    }
    const symbolChunk = symbolList.slice(symbolIndex, symbolIndex + allowedSymbolUnits)
    if (!symbolChunk.length) break
    // Architecture guardrail: reconcile can touch most of the catalog in one
    // run. Rebuilding admin read models for all touched symbols in one giant
    // JSON-bound D1 statement turned the refresh into a single oversized point
    // of failure. Chunk the durable work so each slice can finish cleanly.
    const beforeRowsWritten = Math.max(0, Number(budgetState?.lastSnapshot?.rows_written || 0) || 0)
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
    processedSymbols += symbolChunk.length
    symbolIndex += symbolChunk.length
    if (budgetState) {
      const flushedSnapshot = await flushIconoplasmD1DailyBudgetPendingUsage(budgetState)
      const afterRowsWritten = Math.max(0, Number(flushedSnapshot?.rows_written || 0) || 0)
      const chunkRowsWritten = Math.max(0, afterRowsWritten - beforeRowsWritten)
      if (chunkRowsWritten > 0) {
        observedRowsWrittenPerSymbol =
          (observedRowsWrittenPerSymbol * sampledSymbolUnits + chunkRowsWritten) /
          (sampledSymbolUnits + symbolChunk.length)
        sampledSymbolUnits += symbolChunk.length
      }
      const budgetStatus = iconoplasmMutationLimiterBudgetStatus(budgetState, flushedSnapshot)
      if (
        budgetStatus.rows_written_target_remaining !== null &&
        budgetStatus.rows_written_target_remaining <= 0
      ) {
        if (symbolIndex < symbolList.length) {
          partial = true
          stopReason = "rows_written_target_cap_reached_after_symbol_chunk"
          break
        }
      }
    }
    if (symbolChunk.length < requestedSymbolUnits) {
      partial = true
      stopReason = "rows_written_target_cap_reached_mid_symbol_window"
      break
    }
  }
  const finalVisionIds = skipVisionRollups ? [] : Array.from(finalVisionIdSet)
  if (!partial && !skipVisionRollups) {
    if (fullVision) {
      // This path is not part of the workstation sync contract. Keep the old
      // behavior for explicit operator rebuilds until there is a separately
      // durable full-rebuild resume story.
      await rebuildVisionRollups(env, [], { full: true })
      processedVisions = -1
    } else {
      const visionBatchSize = ADMIN_READ_MODEL_VISION_BATCH_DEFAULT
      while (visionIndex < finalVisionIds.length) {
        const requestedVisionUnits = Math.min(visionBatchSize, finalVisionIds.length - visionIndex)
        const allowedVisionUnits = budgetState
          ? iconoplasmMutationLimiterSuggestedChunkUnits(budgetState, {
              requestedUnits: requestedVisionUnits,
              observedRowsWrittenPerUnit: observedRowsWrittenPerVision,
            })
          : requestedVisionUnits
        if (allowedVisionUnits <= 0) {
          partial = true
          stopReason = "rows_written_target_cap_reached_before_vision_chunk"
          break
        }
        const visionChunk = finalVisionIds.slice(visionIndex, visionIndex + allowedVisionUnits)
        if (!visionChunk.length) break
        const beforeRowsWritten = Math.max(
          0,
          Number(budgetState?.lastSnapshot?.rows_written || 0) || 0,
        )
        await rebuildVisionRollupsBatch(env, visionChunk)
        processedVisions += visionChunk.length
        visionIndex += visionChunk.length
        if (budgetState) {
          const flushedSnapshot = await flushIconoplasmD1DailyBudgetPendingUsage(budgetState)
          const afterRowsWritten = Math.max(0, Number(flushedSnapshot?.rows_written || 0) || 0)
          const chunkRowsWritten = Math.max(0, afterRowsWritten - beforeRowsWritten)
          if (chunkRowsWritten > 0) {
            observedRowsWrittenPerVision =
              (observedRowsWrittenPerVision * sampledVisionUnits + chunkRowsWritten) /
              (sampledVisionUnits + visionChunk.length)
            sampledVisionUnits += visionChunk.length
          }
          const budgetStatus = iconoplasmMutationLimiterBudgetStatus(budgetState, flushedSnapshot)
          if (
            budgetStatus.rows_written_target_remaining !== null &&
            budgetStatus.rows_written_target_remaining <= 0 &&
            visionIndex < finalVisionIds.length
          ) {
            partial = true
            stopReason = "rows_written_target_cap_reached_after_vision_chunk"
            break
          }
        }
        if (visionChunk.length < requestedVisionUnits) {
          partial = true
          stopReason = "rows_written_target_cap_reached_mid_vision_window"
          break
        }
      }
    }
  }

  const dashboardPending = !skipDashboard && !partial
  if (!skipDashboard && !partial) {
    const allowedDashboardUnits = budgetState
      ? iconoplasmMutationLimiterSuggestedChunkUnits(budgetState, {
          requestedUnits: 1,
          observedRowsWrittenPerUnit: 0,
        })
      : 1
    if (allowedDashboardUnits <= 0) {
      partial = true
      stopReason = "rows_written_target_cap_reached_before_dashboard_refresh"
    }
  }
  if (!skipDashboard && !partial) {
    await rebuildDashboardSummary(env)
    if (budgetState) {
      await flushIconoplasmD1DailyBudgetPendingUsage(budgetState)
    }
  }
  adminReadModelState.ready = true
  const budgetStatus = budgetState ? iconoplasmMutationLimiterBudgetStatus(budgetState) : null
  return {
    symbols: processedSymbols,
    visions: fullVision ? processedVisions : processedVisions,
    partial,
    stop_reason: partial ? stopReason || "rows_written_target_cap_reached" : null,
    deferred: partial
      ? {
          symbols: Math.max(0, symbolList.length - symbolIndex),
          visions: fullVision ? null : Math.max(0, finalVisionIds.length - visionIndex),
          dashboard: Boolean(!skipDashboard),
        }
      : { symbols: 0, visions: 0, dashboard: false },
    budget: budgetStatus?.snapshot || null,
    target_daily_percent: budgetStatus?.target_daily_percent || null,
  }
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

function voteProjectionRefreshJobReason(rawReason, fallback = "vote_projection_refresh") {
  return sanitizeText(rawReason || "", 2000) || fallback
}

async function ensureVoteProjectionRefreshJobsTable(env) {
  if (!env?.ICONOPLASM_DB) return false
  await env.ICONOPLASM_DB.prepare(
    `CREATE TABLE IF NOT EXISTS icono_vote_projection_refresh_jobs (
       gene_symbol TEXT PRIMARY KEY,
       actor_id TEXT,
       reason TEXT NOT NULL DEFAULT '',
       requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       last_attempt_at TEXT,
       next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       attempts INTEGER NOT NULL DEFAULT 0,
       last_error TEXT NOT NULL DEFAULT ''
     )`,
  ).run()
  await env.ICONOPLASM_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_icono_vote_projection_refresh_jobs_next_attempt
     ON icono_vote_projection_refresh_jobs (next_attempt_at, requested_at)`,
  ).run()
  return true
}

async function enqueueVoteProjectionRefreshJob(env, { symbol, actorId, reason } = {}) {
  if (!env?.ICONOPLASM_DB) return { ok: false, code: "NO_DB" }
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return { ok: false, code: "BAD_SYMBOL" }
  await ensureVoteProjectionRefreshJobsTable(env)
  const nowIso = new Date().toISOString()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_vote_projection_refresh_jobs (
       gene_symbol,
       actor_id,
       reason,
       requested_at,
       last_attempt_at,
       next_attempt_at,
       attempts,
       last_error
     ) VALUES (?, ?, ?, ?, NULL, ?, 0, '')
     ON CONFLICT(gene_symbol) DO UPDATE SET
       actor_id = excluded.actor_id,
       reason = excluded.reason,
       requested_at = excluded.requested_at,
       next_attempt_at = excluded.next_attempt_at,
       attempts = 0,
       last_error = ''`,
  )
    .bind(
      safeSymbol,
      normalizeUserId(actorId || "vote_projection"),
      voteProjectionRefreshJobReason(reason),
      nowIso,
      nowIso,
    )
    .run()
  return { ok: true, symbol: safeSymbol }
}

async function clearVoteProjectionRefreshJob(env, symbol) {
  if (!env?.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return false
  await env.ICONOPLASM_DB.prepare(
    `DELETE FROM icono_vote_projection_refresh_jobs
     WHERE gene_symbol = ?`,
  )
    .bind(safeSymbol)
    .run()
  return true
}

async function recordVoteProjectionRefreshFailure(
  env,
  { symbol, actorId, reason, error, attemptCount = 0 } = {},
) {
  if (!env?.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return false
  await ensureVoteProjectionRefreshJobsTable(env)
  const delayMinutes = Math.max(
    1,
    Math.min(60, Math.pow(2, Math.max(0, Number(attemptCount || 0)))),
  )
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_vote_projection_refresh_jobs (
       gene_symbol,
       actor_id,
       reason,
       requested_at,
       last_attempt_at,
       next_attempt_at,
       attempts,
       last_error
     ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, 1, ?)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       actor_id = excluded.actor_id,
       reason = excluded.reason,
       last_attempt_at = CURRENT_TIMESTAMP,
       next_attempt_at = excluded.next_attempt_at,
       attempts = icono_vote_projection_refresh_jobs.attempts + 1,
       last_error = excluded.last_error`,
  )
    .bind(
      safeSymbol,
      normalizeUserId(actorId || "vote_projection"),
      voteProjectionRefreshJobReason(reason),
      nextAttemptAt,
      sanitizeText(String(error?.message || error || "vote projection refresh failed"), 2000) ||
        "vote projection refresh failed",
    )
    .run()
  return true
}

async function processVoteProjectionRefreshForSymbol(
  env,
  { symbol, actorId = "vote_projection", reason = "vote_projection_refresh" } = {},
) {
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return { ok: false, code: "BAD_SYMBOL" }
  const coordinatorState = await iconoplasmVoteCoordinatorState(env, { symbol: safeSymbol })
  const assetSummaries = Array.isArray(coordinatorState?.asset_summaries)
    ? coordinatorState.asset_summaries
    : []
  const autoPromote = await autoPromoteTopVotedPortraitFromCoordinatorState(env, {
    symbol: safeSymbol,
    actorId: normalizeUserId(actorId || "vote_projection"),
    reason: voteProjectionRefreshJobReason(reason),
    assetSummaries,
  })
  const readModels = await refreshProjectedVoteReadModelsFromCoordinatorState(env, {
    symbol: safeSymbol,
    assetSummaries,
  })
  await clearVoteProjectionRefreshJob(env, safeSymbol)
  return {
    ok: true,
    symbol: safeSymbol,
    asset_count: assetSummaries.length,
    auto_promote: autoPromote,
    read_models: readModels,
  }
}

async function processPendingVoteProjectionRefreshJobs(env, { limit = 100 } = {}) {
  if (!env?.ICONOPLASM_DB)
    return { ok: false, code: "NO_DB", processed: 0, failed: 0, remaining: 0 }
  await ensureVoteProjectionRefreshJobsTable(env)
  const safeLimit = Math.max(1, Math.min(500, Number.parseInt(String(limit || 100), 10) || 100))
  const nowIso = new Date().toISOString()
  const queued = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, actor_id, reason, attempts
     FROM icono_vote_projection_refresh_jobs
     WHERE next_attempt_at <= ?
     ORDER BY requested_at ASC
     LIMIT ?`,
  )
    .bind(nowIso, safeLimit)
    .all()
  const rows = Array.isArray(queued?.results) ? queued.results : []
  const results = []
  let processed = 0
  let failed = 0
  for (const row of rows) {
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol) continue
    try {
      results.push(
        await processVoteProjectionRefreshForSymbol(env, {
          symbol,
          actorId: row?.actor_id || "vote_projection",
          reason: row?.reason || "vote_projection_refresh",
        }),
      )
      processed += 1
    } catch (error) {
      failed += 1
      await recordVoteProjectionRefreshFailure(env, {
        symbol,
        actorId: row?.actor_id || "vote_projection",
        reason: row?.reason || "vote_projection_refresh",
        error,
        attemptCount: Number(row?.attempts || 0),
      })
      results.push({
        ok: false,
        symbol,
        error:
          sanitizeText(String(error?.message || error || "vote projection refresh failed"), 2000) ||
          "vote projection refresh failed",
      })
    }
  }
  const remainingRow = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM icono_vote_projection_refresh_jobs
     WHERE next_attempt_at <= ?`,
  )
    .bind(nowIso)
    .first()
  return {
    ok: true,
    processed,
    failed,
    remaining: Number(remainingRow?.count || 0),
    results,
  }
}

async function listPendingVoteProjectionRefreshJobs(env, { limit = 200 } = {}) {
  if (!env?.ICONOPLASM_DB) return []
  await ensureVoteProjectionRefreshJobsTable(env)
  const cleanedLimit = Math.max(
    1,
    Math.min(1000, Number.parseInt(String(limit || "200"), 10) || 200),
  )
  const resp = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol, actor_id, reason, requested_at, last_attempt_at, next_attempt_at, attempts, last_error
     FROM icono_vote_projection_refresh_jobs
     ORDER BY next_attempt_at ASC, requested_at ASC, gene_symbol ASC
     LIMIT ?`,
  )
    .bind(cleanedLimit)
    .all()
  // Chesterton's fence: this queue is the durable breadcrumb for vote-driven
  // auto-promote/read-model work that got kicked off the request path on purpose.
  // Keep the operator view tied to the actual D1 job rows instead of reconstructing
  // "probably deferred" from response flags later.
  return (Array.isArray(resp?.results) ? resp.results : []).map((row) => ({
    symbol: normalizeSymbol(row?.gene_symbol || ""),
    actor_id: normalizeUserId(row?.actor_id || "vote_projection"),
    reason: sanitizeText(row?.reason || "", 2000) || "vote_projection_refresh",
    requested_at: sanitizeText(row?.requested_at || "", 64) || "",
    last_attempt_at: sanitizeText(row?.last_attempt_at || "", 64) || "",
    next_attempt_at: sanitizeText(row?.next_attempt_at || "", 64) || "",
    attempts: Math.max(0, Number.parseInt(String(row?.attempts || 0), 10) || 0),
    last_error: sanitizeText(row?.last_error || "", 2000) || "",
    retrying: Math.max(0, Number.parseInt(String(row?.attempts || 0), 10) || 0) > 0,
  }))
}

const ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED = "queued"
const ICONOPLASM_SYNC_FINALIZATION_STATUS_RUNNING = "running"
const ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING = "retrying"
const ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED = "completed"

const ICONOPLASM_SYNC_FINALIZATION_PHASE_RECONCILE = "reconcile"
const ICONOPLASM_SYNC_FINALIZATION_PHASE_VOTE_SUMMARIES = "vote_summaries"
const ICONOPLASM_SYNC_FINALIZATION_PHASE_GENE_ROLLUPS = "gene_rollups"
const ICONOPLASM_SYNC_FINALIZATION_PHASE_VISION_ROLLUPS = "vision_rollups"
const ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE = "completed_pending_finalize"
const ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED = "completed"

function normalizeSyncFinalizationJobStatus(rawStatus) {
  const value = sanitizeText(rawStatus || "", 32).toLowerCase()
  if (
    [
      ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_RUNNING,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
    ].includes(value)
  ) {
    return value
  }
  return ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED
}

function normalizeSyncFinalizationJobPhase(rawPhase) {
  const value = sanitizeText(rawPhase || "", 64).toLowerCase()
  if (
    [
      ICONOPLASM_SYNC_FINALIZATION_PHASE_RECONCILE,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_VOTE_SUMMARIES,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_GENE_ROLLUPS,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_VISION_ROLLUPS,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED,
    ].includes(value)
  ) {
    return value
  }
  return ICONOPLASM_SYNC_FINALIZATION_PHASE_RECONCILE
}

function normalizeSyncFinalizationAssetPairs(rawPairs, { maxItems = 500 } = {}) {
  const out = []
  const seen = new Set()
  for (const rawPair of Array.isArray(rawPairs) ? rawPairs : []) {
    const symbol = normalizeSymbol(rawPair?.symbol || rawPair?.gene_symbol || "")
    const assetSha256 = normalizeSha256(rawPair?.asset_sha256 || rawPair?.sha256 || "")
    if (!symbol || !assetSha256) continue
    const key = `${symbol}|${assetSha256}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ symbol, asset_sha256: assetSha256 })
    if (out.length >= maxItems) break
  }
  return out
}

function normalizeSyncFinalizationVisionIds(rawVisionIds, { maxItems = 1000 } = {}) {
  const out = []
  const seen = new Set()
  for (const rawVisionId of Array.isArray(rawVisionIds) ? rawVisionIds : []) {
    const visionId = validAdminRollupVisionId(rawVisionId)
    if (!visionId || seen.has(visionId)) continue
    seen.add(visionId)
    out.push(visionId)
    if (out.length >= maxItems) break
  }
  return out
}

function normalizeSyncFinalizationJobSymbols(rawSymbols, { maxItems = 5000 } = {}) {
  const out = []
  const seen = new Set()
  for (const rawSymbol of Array.isArray(rawSymbols) ? rawSymbols : []) {
    const symbol = normalizeSymbol(rawSymbol)
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    out.push(symbol)
    if (out.length >= maxItems) break
  }
  return out
}

function parseSyncFinalizationJsonArray(rawValue, fallback = []) {
  try {
    const parsed = JSON.parse(String(rawValue || "[]"))
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function mapSyncFinalizationJobRow(row) {
  const symbol = normalizeSymbol(row?.gene_symbol || "")
  const keepAssets = normalizeSyncFinalizationAssetPairs(
    parseSyncFinalizationJsonArray(row?.keep_assets_json),
    { maxItems: 5000 },
  )
  const legacyAssets = normalizeSyncFinalizationAssetPairs(
    parseSyncFinalizationJsonArray(row?.legacy_assets_json),
    { maxItems: 5000 },
  )
  const visionIds = normalizeSyncFinalizationVisionIds(
    parseSyncFinalizationJsonArray(row?.vision_ids_json),
    { maxItems: 5000 },
  )
  return {
    symbol,
    actor_id: normalizeUserId(row?.actor_id || "workstation_sync"),
    reason: sanitizeText(row?.reason || "", 2000) || "sync_finalization",
    status: normalizeSyncFinalizationJobStatus(row?.status),
    phase: normalizeSyncFinalizationJobPhase(row?.phase),
    keep_assets: keepAssets,
    legacy_assets: legacyAssets,
    vision_ids: visionIds,
    requested_at: sanitizeText(row?.requested_at || "", 64) || "",
    updated_at: sanitizeText(row?.updated_at || "", 64) || "",
    last_attempt_at: sanitizeText(row?.last_attempt_at || "", 64) || "",
    next_attempt_at: sanitizeText(row?.next_attempt_at || "", 64) || "",
    attempts: Math.max(0, Number.parseInt(String(row?.attempts || 0), 10) || 0),
    last_error: sanitizeText(row?.last_error || "", 2000) || "",
    completed_at: sanitizeText(row?.completed_at || "", 64) || "",
  }
}

function iconoplasmSyncFinalizationQueueBinding(env) {
  if (iconoplasmSyncFinalizationQueueDisabled(env)) return null
  const queue = env?.[ICONOPLASM_SYNC_FINALIZATION_QUEUE_BINDING]
  return queue && typeof queue.send === "function" ? queue : null
}

function iconoplasmSyncFinalizationQueueDisabled(env) {
  const disabled = String(env?.[ICONOPLASM_SYNC_FINALIZATION_QUEUE_DISABLED_ENV] || "")
    .trim()
    .toLowerCase()
  return disabled === "1" || disabled === "true" || disabled === "yes" || disabled === "on"
}

function iconoplasmSyncGovernorStub(env) {
  const namespace = env?.[ICONOPLASM_SYNC_GOVERNOR_BINDING]
  if (
    !namespace ||
    typeof namespace.idFromName !== "function" ||
    typeof namespace.get !== "function"
  ) {
    return null
  }
  return namespace.get(namespace.idFromName(ICONOPLASM_SYNC_GOVERNOR_ID))
}

async function iconoplasmSyncGovernorJson(env, path, payload = {}) {
  const stub = iconoplasmSyncGovernorStub(env)
  if (!stub || typeof stub.fetch !== "function") {
    return {
      ok: true,
      granted: Math.max(1, Number(payload?.requested || payload?.messages || 1) || 1),
      governor: iconoplasmSyncGovernorDefaultState(),
      unavailable: true,
    }
  }
  const response = await stub.fetch(
    new Request(`https://iconoplasm-sync-governor${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }),
  )
  if (!response.ok) {
    return {
      ok: false,
      granted: 1,
      governor: iconoplasmSyncGovernorDefaultState(),
      unavailable: true,
    }
  }
  return response.json()
}

function buildSyncFinalizationDrainQueueMessage({ runId = "", symbols = [], reason = "" } = {}) {
  const safeRunId = sanitizeText(runId || reason || "", 128) || "manual"
  const safeSymbols = normalizeSyncFinalizationJobSymbols(symbols, { maxItems: 5000 })
  return {
    kind: "drain_finalization_ledger",
    run_id: safeRunId,
    symbols: safeSymbols,
    idempotency_key: `${safeRunId}:drain:${safeSymbols.length}:${safeSymbols[0] || "all"}:${safeSymbols.at(-1) || "all"}`,
  }
}

async function sendSyncFinalizationDrainQueueMessage(env, message) {
  const queue = iconoplasmSyncFinalizationQueueBinding(env)
  if (!queue) {
    return {
      ok: false,
      code: "QUEUE_BINDING_MISSING",
      error: "ICONOPLASM_SYNC_FINALIZATION_QUEUE binding is missing or disabled.",
    }
  }
  const safeMessage = buildSyncFinalizationDrainQueueMessage(message)
  try {
    await queue.send(safeMessage)
    return { ok: true, message: safeMessage }
  } catch (error) {
    const detail = String(error?.message || error || "").slice(0, 2000)
    console.warn(
      "Iconoplasm sync finalization drain queue send failed; durable ledger remains authoritative",
      {
        run_id: safeMessage.run_id,
        symbols: safeMessage.symbols.length,
        error: detail,
      },
    )
    return {
      ok: false,
      code: "QUEUE_SEND_FAILED",
      error: "Cloudflare rejected the sync finalization Queue message.",
      detail,
    }
  }
}

// Iconoplasm sync finalization has exactly one production execution path:
// durable D1 ledger rows are advanced by Cloudflare Queue messages of kind
// `drain_finalization_ledger` consumed by this worker. Do not add a GitHub
// Actions Queue kick, workstation drain, direct API processor, or admin-token
// workaround here. If Queue sends fail with HTTP 429 or Cloudflare auth code
// 10000, fix the Cloudflare account/token/allowance in the dashboard and let
// this code fail loud until the canonical Queue path works again.
async function ensureSyncFinalizationJobsTable(env) {
  if (!env?.ICONOPLASM_DB) return false
  await env.ICONOPLASM_DB.prepare(
    `CREATE TABLE IF NOT EXISTS icono_sync_finalization_jobs (
       gene_symbol TEXT PRIMARY KEY,
       actor_id TEXT,
       reason TEXT NOT NULL DEFAULT '',
       status TEXT NOT NULL DEFAULT 'queued',
       phase TEXT NOT NULL DEFAULT 'reconcile',
       keep_assets_json TEXT NOT NULL DEFAULT '[]',
       legacy_assets_json TEXT NOT NULL DEFAULT '[]',
       vision_ids_json TEXT NOT NULL DEFAULT '[]',
       requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       last_attempt_at TEXT,
       next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       attempts INTEGER NOT NULL DEFAULT 0,
       last_error TEXT NOT NULL DEFAULT '',
       completed_at TEXT
     )`,
  ).run()
  await env.ICONOPLASM_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_icono_sync_finalization_jobs_status_next_attempt
     ON icono_sync_finalization_jobs (status, next_attempt_at, requested_at)`,
  ).run()
  await env.ICONOPLASM_DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_icono_sync_finalization_jobs_phase_status
     ON icono_sync_finalization_jobs (phase, status, requested_at)`,
  ).run()
  return true
}

async function enqueueSyncFinalizationJobs(
  env,
  { rows = [], actorId = "workstation_sync", reason = "sync_finalization", runId = "" } = {},
) {
  if (!env?.ICONOPLASM_DB) return { ok: false, code: "NO_DB", queued: 0 }
  await ensureSyncFinalizationJobsTable(env)
  const safeActorId = normalizeUserId(actorId || "workstation_sync")
  const safeReason = sanitizeText(reason || "", 2000) || "sync_finalization"
  const nowIso = new Date().toISOString()
  let queued = 0
  let queueMessages = 0
  let queueSendFailures = 0
  const symbols = []
  const safeRunId = sanitizeText(runId || reason || "manual", 128) || "manual"
  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const symbol = normalizeSymbol(rawRow?.symbol || rawRow?.gene_symbol || "")
    if (!symbol) continue
    const startingPhase = normalizeSyncFinalizationJobPhase(
      rawRow?.phase || rawRow?.start_phase || rawRow?.startPhase,
    )
    const keepAssets = normalizeSyncFinalizationAssetPairs(rawRow?.keep || rawRow?.keep_assets, {
      maxItems: 5000,
    }).filter((item) => item.symbol === symbol)
    const legacyAssets = normalizeSyncFinalizationAssetPairs(
      rawRow?.legacy || rawRow?.legacy_assets,
      {
        maxItems: 5000,
      },
    ).filter((item) => item.symbol === symbol)
    const visionIds = normalizeSyncFinalizationVisionIds(rawRow?.vision_ids || rawRow?.visionIds, {
      maxItems: 5000,
    })
    await env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_sync_finalization_jobs (
         gene_symbol,
         actor_id,
         reason,
         status,
         phase,
         keep_assets_json,
         legacy_assets_json,
         vision_ids_json,
         requested_at,
         updated_at,
         last_attempt_at,
         next_attempt_at,
         attempts,
         last_error,
         completed_at
        ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, NULL, ?, 0, '', NULL)
       ON CONFLICT(gene_symbol) DO UPDATE SET
         actor_id = excluded.actor_id,
         reason = excluded.reason,
         status = 'queued',
         phase = excluded.phase,
         keep_assets_json = excluded.keep_assets_json,
         legacy_assets_json = excluded.legacy_assets_json,
         vision_ids_json = excluded.vision_ids_json,
         requested_at = excluded.requested_at,
         updated_at = excluded.updated_at,
         last_attempt_at = NULL,
         next_attempt_at = excluded.next_attempt_at,
         attempts = 0,
         last_error = '',
         completed_at = NULL`,
    )
      .bind(
        symbol,
        safeActorId,
        safeReason,
        startingPhase,
        JSON.stringify(keepAssets),
        JSON.stringify(legacyAssets),
        JSON.stringify(visionIds),
        nowIso,
        nowIso,
        nowIso,
      )
      .run()
    queued += 1
    symbols.push(symbol)
  }
  if (queued > 0) {
    const sentQueueMessage = await sendSyncFinalizationDrainQueueMessage(env, {
      runId: safeRunId,
      reason: safeReason,
      symbols,
    })
    if (sentQueueMessage?.ok) {
      queueMessages += 1
    } else if (iconoplasmSyncFinalizationQueueBinding(env)) {
      queueSendFailures += 1
    }
    var queueSendError = sentQueueMessage?.ok ? null : sentQueueMessage
  }
  if (queued > 0 && queueMessages <= 0) {
    return {
      ok: false,
      code: queueSendError?.code || "QUEUE_MESSAGE_REQUIRED",
      error:
        queueSendError?.error ||
        "Iconoplasm finalization requires the Cloudflare Queue path; queued D1 ledger rows without a Queue message are not a valid sync path.",
      queue_send_error: queueSendError || null,
      queued,
      queue_messages: queueMessages,
      queue_send_failures: queueSendFailures,
      queue_enabled: false,
      symbols,
    }
  }
  return {
    ok: true,
    queued,
    queue_messages: queueMessages,
    queue_send_failures: queueSendFailures,
    queue_enabled: Boolean(iconoplasmSyncFinalizationQueueBinding(env)) && queueSendFailures <= 0,
    symbols,
  }
}

async function listPendingSyncFinalizationJobs(env, { limit = 200, symbols = null } = {}) {
  if (!env?.ICONOPLASM_DB) return []
  await ensureSyncFinalizationJobsTable(env)
  const cleanedLimit = Math.max(1, Math.min(1000, Number.parseInt(String(limit || 200), 10) || 200))
  const scopedSymbols = normalizeSyncFinalizationJobSymbols(symbols, { maxItems: 5000 })
  const scopedSymbolsJson = JSON.stringify(scopedSymbols)
  const scopedEnabled = scopedSymbols.length > 0 ? 1 : 0
  const resp = await env.ICONOPLASM_DB.prepare(
    `WITH scoped_symbols AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT *
     FROM icono_sync_finalization_jobs
     WHERE status <> ?
       AND (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM scoped_symbols))
     ORDER BY
       CASE
         WHEN phase = ? THEN 1
         ELSE 0
       END ASC,
       next_attempt_at ASC,
       requested_at ASC,
       gene_symbol ASC
     LIMIT ?`,
  )
    .bind(
      scopedSymbolsJson,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
      scopedEnabled,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      cleanedLimit,
    )
    .all()
  return (Array.isArray(resp?.results) ? resp.results : []).map(mapSyncFinalizationJobRow)
}

async function countSyncFinalizationJobs(env, { whereSql = "1 = 1", bindArgs = [] } = {}) {
  if (!env?.ICONOPLASM_DB) return 0
  await ensureSyncFinalizationJobsTable(env)
  const row = await env.ICONOPLASM_DB.prepare(
    `SELECT COUNT(*) AS count
     FROM icono_sync_finalization_jobs
     WHERE ${whereSql}`,
  )
    .bind(...(Array.isArray(bindArgs) ? bindArgs : []))
    .first()
  return Math.max(0, Number(row?.count || 0) || 0)
}

async function writeSyncFinalizationJobState(
  env,
  {
    symbol,
    status,
    phase,
    nextAttemptAt = null,
    lastAttemptAt = null,
    attempts = null,
    lastError = null,
    completedAt = null,
  } = {},
) {
  if (!env?.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return false
  const fields = ["status = ?", "phase = ?", "updated_at = CURRENT_TIMESTAMP"]
  const bindArgs = [
    normalizeSyncFinalizationJobStatus(status),
    normalizeSyncFinalizationJobPhase(phase),
  ]
  if (nextAttemptAt !== null) {
    fields.push("next_attempt_at = ?")
    bindArgs.push(nextAttemptAt)
  }
  if (lastAttemptAt !== null) {
    fields.push("last_attempt_at = ?")
    bindArgs.push(lastAttemptAt)
  }
  if (attempts !== null) {
    fields.push("attempts = ?")
    bindArgs.push(Math.max(0, Number(attempts || 0) || 0))
  }
  if (lastError !== null) {
    fields.push("last_error = ?")
    bindArgs.push(sanitizeText(lastError || "", 2000) || "")
  }
  if (completedAt !== null) {
    fields.push("completed_at = ?")
    bindArgs.push(completedAt)
  }
  bindArgs.push(safeSymbol)
  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_sync_finalization_jobs
     SET ${fields.join(", ")}
     WHERE gene_symbol = ?`,
  )
    .bind(...bindArgs)
    .run()
  return true
}

async function recordSyncFinalizationJobFailure(
  env,
  { symbol, error, attemptCount = 0, phase = ICONOPLASM_SYNC_FINALIZATION_PHASE_RECONCILE } = {},
) {
  if (!env?.ICONOPLASM_DB) return false
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return false
  const delayMinutes = Math.max(
    1,
    Math.min(60, Math.pow(2, Math.max(0, Number(attemptCount || 0)))),
  )
  const nextAttemptAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString()
  await writeSyncFinalizationJobState(env, {
    symbol: safeSymbol,
    status: ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING,
    phase,
    nextAttemptAt,
    lastAttemptAt: new Date().toISOString(),
    attempts: Math.max(0, Number(attemptCount || 0) || 0) + 1,
    lastError:
      sanitizeText(String(error?.message || error || "sync finalization failed"), 2000) ||
      "sync finalization failed",
  })
  return true
}

const ICONOPLASM_SYNC_FINALIZATION_RUNNING_STALE_MINUTES = 2
const ICONOPLASM_SYNC_FINALIZATION_STALE_RECOVERY_BATCH_LIMIT = 250

async function recoverStaleRunningSyncFinalizationJobs(
  env,
  { symbols = null, staleAfterMinutes = ICONOPLASM_SYNC_FINALIZATION_RUNNING_STALE_MINUTES } = {},
) {
  if (!env?.ICONOPLASM_DB) return { ok: false, recovered: 0 }
  await ensureSyncFinalizationJobsTable(env)
  const scopedSymbols = normalizeSyncFinalizationJobSymbols(symbols, { maxItems: 5000 })
  const scopedSymbolsJson = JSON.stringify(scopedSymbols)
  const scopedEnabled = scopedSymbols.length > 0 ? 1 : 0
  const safeMinutes = Math.max(1, Math.min(240, Number(staleAfterMinutes || 0) || 2))
  const cutoffIso = new Date(Date.now() - safeMinutes * 60 * 1000).toISOString()
  const retryAtIso = new Date().toISOString()
  const recoveredError =
    sanitizeText(
      `Recovered stale running finalization lease after ${safeMinutes} minute(s) without progress`,
      2000,
    ) || "Recovered stale running finalization lease"
  // Chesterton's fence: stale `running` rows from an aborted workstation run
  // still count as pending forever, but the normal processor only selects
  // queued/retrying work. Requeue old leases here so the backlog can become
  // real work again instead of an undead counter that never drains.
  const runningRowsResp = await env.ICONOPLASM_DB.prepare(
    `WITH scoped_symbols AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT gene_symbol, phase, attempts, requested_at, last_attempt_at
     FROM icono_sync_finalization_jobs
     WHERE status = ?
       AND phase <> ?
       AND (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM scoped_symbols))
     ORDER BY COALESCE(NULLIF(last_attempt_at, ''), NULLIF(requested_at, '')) ASC, gene_symbol ASC
     LIMIT ?`,
  )
    .bind(
      scopedSymbolsJson,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_RUNNING,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      scopedEnabled,
      ICONOPLASM_SYNC_FINALIZATION_STALE_RECOVERY_BATCH_LIMIT,
    )
    .all()
  const runningRows = Array.isArray(runningRowsResp?.results) ? runningRowsResp.results : []
  let recovered = 0
  for (const row of runningRows) {
    const leaseAt = sanitizeText(String(row?.last_attempt_at || row?.requested_at || ""), 64) || ""
    if (!leaseAt || leaseAt > cutoffIso) continue
    const symbol = normalizeSymbol(row?.gene_symbol || "")
    if (!symbol) continue
    await writeSyncFinalizationJobState(env, {
      symbol,
      status: ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING,
      phase: row?.phase,
      nextAttemptAt: retryAtIso,
      lastAttemptAt: retryAtIso,
      attempts: Math.max(1, Number(row?.attempts || 0) || 0),
      lastError: recoveredError,
      completedAt: null,
    })
    recovered += 1
  }
  return {
    ok: true,
    recovered,
    stale_after_minutes: safeMinutes,
  }
}

async function callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  env,
  ctx,
  { path, payload = null, method = "POST" } = {},
) {
  const adminToken = sanitizeText(env?.ICONOPLASM_ADMIN_TOKEN || "", 255) || ""
  if (!adminToken) {
    throw new Error("ICONOPLASM_ADMIN_TOKEN is required for internal finalization work")
  }
  const request = new Request(
    `https://the-only-allowed-internal-stateful-worker-do-not-duplicate${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
        [ICONOPLASM_INTERNAL_STATEFUL_WORKER_REQUEST_HEADER_DO_NOT_DUPLICATE]: "1",
      },
      body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(payload || {}),
    },
  )
  const response = await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    request,
    env,
    ctx || { waitUntil() {} },
  )
  const text = await response.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { ok: false, error: text || `Internal call to ${path} returned non-JSON` }
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(
      sanitizeText(
        String(data?.error || data?.detail || text || `Internal call to ${path} failed`),
        2000,
      ) || `Internal call to ${path} failed`,
    )
  }
  return data
}

async function processSyncFinalizationJobPhase(env, ctx, job) {
  const symbol = normalizeSymbol(job?.symbol || "")
  if (!symbol) throw new Error("Finalization job is missing gene_symbol")
  const reason = sanitizeText(job?.reason || "", 2000) || "sync_finalization"
  const phase = normalizeSyncFinalizationJobPhase(job?.phase)
  const pauseCurrentPhase = (result, stopReasonFallback) => ({
    symbol,
    phase,
    next_phase: phase,
    partial: true,
    stop_reason:
      sanitizeText(
        result?.stop_reason || stopReasonFallback || "rows_written_target_cap_reached",
        255,
      ) || "rows_written_target_cap_reached",
    result,
  })
  if (phase === ICONOPLASM_SYNC_FINALIZATION_PHASE_RECONCILE) {
    const reconcile =
      await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
        path: "/api/iconoplasm/admin/reconcile",
        payload: {
          dry_run: false,
          reason,
          defer_read_models: true,
          scope_symbols: [symbol],
          keep: normalizeSyncFinalizationAssetPairs(job?.keep_assets || [], { maxItems: 5000 }),
          legacy: normalizeSyncFinalizationAssetPairs(job?.legacy_assets || [], { maxItems: 5000 }),
        },
      })
    if (reconcile?.partial) {
      return pauseCurrentPhase({ reconcile }, "rows_written_target_cap_reached_during_reconcile")
    }
    return {
      symbol,
      phase,
      next_phase: ICONOPLASM_SYNC_FINALIZATION_PHASE_VOTE_SUMMARIES,
      result: { reconcile },
    }
  }
  if (phase === ICONOPLASM_SYNC_FINALIZATION_PHASE_VOTE_SUMMARIES) {
    const voteSummaries =
      await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
        path: "/api/iconoplasm/admin/read-models/sync",
        payload: {
          symbols: [symbol],
          invalidate_gallery: false,
          skip_gene_rollups: true,
          skip_vision_rollups: true,
          skip_dashboard: true,
        },
      })
    if (voteSummaries?.partial) {
      return pauseCurrentPhase(
        { vote_summaries: voteSummaries },
        "rows_written_target_cap_reached_before_vote_summaries",
      )
    }
    return {
      symbol,
      phase,
      next_phase: ICONOPLASM_SYNC_FINALIZATION_PHASE_GENE_ROLLUPS,
      result: { vote_summaries: voteSummaries },
    }
  }
  if (phase === ICONOPLASM_SYNC_FINALIZATION_PHASE_GENE_ROLLUPS) {
    const geneRollups =
      await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
        path: "/api/iconoplasm/admin/read-models/sync",
        payload: {
          symbols: [symbol],
          invalidate_gallery: false,
          skip_vote_summaries: true,
          skip_vision_rollups: true,
          skip_dashboard: true,
        },
      })
    if (geneRollups?.partial) {
      return pauseCurrentPhase(
        { gene_rollups: geneRollups },
        "rows_written_target_cap_reached_before_gene_rollups",
      )
    }
    return {
      symbol,
      phase,
      next_phase:
        Array.isArray(job?.vision_ids) && job.vision_ids.length
          ? ICONOPLASM_SYNC_FINALIZATION_PHASE_VISION_ROLLUPS
          : ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      result: { gene_rollups: geneRollups },
    }
  }
  if (phase === ICONOPLASM_SYNC_FINALIZATION_PHASE_VISION_ROLLUPS) {
    const visionIds = normalizeSyncFinalizationVisionIds(job?.vision_ids || [], { maxItems: 5000 })
    if (visionIds.length) {
      const visionRollups =
        await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
          path: "/api/iconoplasm/admin/read-models/sync",
          payload: {
            vision_ids: visionIds,
            invalidate_gallery: false,
            skip_dashboard: true,
          },
        })
      if (visionRollups?.partial) {
        return pauseCurrentPhase(
          { vision_rollups: visionRollups },
          "rows_written_target_cap_reached_before_vision_rollups",
        )
      }
      return {
        symbol,
        phase,
        next_phase: ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
        result: { vision_rollups: visionRollups },
      }
    }
    return {
      symbol,
      phase,
      next_phase: ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      result: { vision_rollups: { ok: true, visions: 0 } },
    }
  }
  return {
    symbol,
    phase,
    next_phase: ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
    result: { skipped: true },
  }
}

async function finalizeCompletedSyncFinalizationJobsIfDrained(env, ctx, { symbols = null } = {}) {
  if (!env?.ICONOPLASM_DB) return { ok: false, finalized: 0, remaining: 0 }
  const scopedSymbols = normalizeSyncFinalizationJobSymbols(symbols, { maxItems: 5000 })
  const scopedSymbolsJson = JSON.stringify(scopedSymbols)
  const scopedEnabled = scopedSymbols.length > 0 ? 1 : 0
  const remainingBeforeFinalize = await countSyncFinalizationJobs(env, {
    whereSql: `status <> ? AND phase NOT IN (?, ?)
      AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
    bindArgs: [
      ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED,
      scopedEnabled,
      scopedSymbolsJson,
    ],
  })
  const pendingFinalizeCount = await countSyncFinalizationJobs(env, {
    whereSql: `status <> ? AND phase = ?
      AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
    bindArgs: [
      ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      scopedEnabled,
      scopedSymbolsJson,
    ],
  })
  if (remainingBeforeFinalize > 0 || pendingFinalizeCount <= 0) {
    return {
      ok: true,
      finalized: 0,
      remaining: remainingBeforeFinalize + pendingFinalizeCount,
    }
  }

  const pendingFinalizeRowsResp = await env.ICONOPLASM_DB.prepare(
    `SELECT vision_ids_json
     FROM icono_sync_finalization_jobs
     WHERE status <> ?
       AND phase = ?
       AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
  )
    .bind(
      ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      scopedEnabled,
      scopedSymbolsJson,
    )
    .all()
  const pendingFinalizeRows = Array.isArray(pendingFinalizeRowsResp?.results)
    ? pendingFinalizeRowsResp.results
    : []
  const uniqueVisionIds = normalizeSyncFinalizationVisionIds(
    pendingFinalizeRows.flatMap((row) => {
      try {
        const parsed = JSON.parse(String(row?.vision_ids_json || "[]"))
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }),
    { maxItems: 5000 },
  )

  // Chesterton's fence: dashboard refresh + gallery invalidation is the one
  // intentionally global tail step. Keep it out of every per-symbol phase so a
  // single finalizer runs once after the queue drains, instead of repeating the
  // same global work until the worker falls over near the finish line. Vision
  // rollups follow the same rule: dedupe them across the whole scoped drain
  // instead of recomputing the same shared vision IDs once per symbol.
  for (
    let start = 0;
    start < uniqueVisionIds.length;
    start += ADMIN_READ_MODEL_SYNC_REQUEST_VISION_MAX
  ) {
    const visionChunk = uniqueVisionIds.slice(
      start,
      start + ADMIN_READ_MODEL_SYNC_REQUEST_VISION_MAX,
    )
    await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
      path: "/api/iconoplasm/admin/read-models/sync",
      payload: {
        symbols: [],
        vision_ids: visionChunk,
        skip_vote_summaries: true,
        skip_gene_rollups: true,
        skip_vision_rollups: false,
        skip_dashboard: true,
        invalidate_gallery: false,
      },
    })
  }
  await callIconoplasmAdminRouteInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(env, ctx, {
    path: "/api/iconoplasm/admin/read-models/sync",
    payload: {
      symbols: [],
      vision_ids: [],
      skip_vote_summaries: true,
      skip_gene_rollups: true,
      skip_vision_rollups: true,
      skip_dashboard: false,
      invalidate_gallery: true,
    },
  })
  const completedAt = new Date().toISOString()
  if (scopedEnabled > 0) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_sync_finalization_jobs
       SET status = ?,
           phase = ?,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = ?,
           last_error = ''
       WHERE status <> ?
         AND phase = ?
         AND gene_symbol IN (SELECT value FROM json_each(?))`,
    )
      .bind(
        ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
        ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED,
        completedAt,
        ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
        ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
        scopedSymbolsJson,
      )
      .run()
  } else {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_sync_finalization_jobs
       SET status = ?,
           phase = ?,
           updated_at = CURRENT_TIMESTAMP,
           completed_at = ?,
           last_error = ''
       WHERE status <> ?
         AND phase = ?`,
    )
      .bind(
        ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
        ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED,
        completedAt,
        ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
        ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      )
      .run()
  }
  return {
    ok: true,
    finalized: pendingFinalizeCount,
    remaining: 0,
  }
}

async function processSyncFinalizationQueueMessage(env, ctx, rawMessage) {
  if (!env?.ICONOPLASM_DB) return { ok: false, skipped: true, reason: "NO_DB" }
  await ensureSyncFinalizationJobsTable(env)
  const body = rawMessage && typeof rawMessage === "object" ? rawMessage : {}
  const kind = sanitizeText(body.kind || "", 80)
  if (kind === "drain_finalization_ledger") {
    const runId = sanitizeText(body.run_id || body.runId || "", 128) || "manual"
    const symbols = normalizeSyncFinalizationJobSymbols(body.symbols, { maxItems: 5000 })
    const drainResult = await processPendingSyncFinalizationJobs(env, ctx, {
      limit: ICONOPLASM_SYNC_FINALIZATION_QUEUE_DRAIN_BATCH_LIMIT,
      finalizeIfDrained: true,
      symbols,
    })
    const remaining = Math.max(0, Number(drainResult?.remaining || 0) || 0)
    let sentNext = false
    if (remaining > 0) {
      sentNext = await sendSyncFinalizationDrainQueueMessage(env, {
        runId,
        symbols,
      })
      if (!sentNext?.ok) {
        console.warn("Iconoplasm sync finalization Queue self-reschedule deferred", {
          run_id: runId,
          symbols: symbols.length,
          remaining,
          error: sanitizeText(
            String(sentNext?.detail || sentNext?.error || sentNext?.code || "unknown Queue send failure"),
            500,
          ),
        })
      }
    }
    return {
      ok: true,
      kind,
      processed: Math.max(0, Number(drainResult?.processed || 0) || 0),
      failed: Math.max(0, Number(drainResult?.failed || 0) || 0),
      finalized: Math.max(0, Number(drainResult?.finalized || 0) || 0),
      remaining,
      queue_message_sent: sentNext,
      result: drainResult,
    }
  }
  throw new Error(
    "Unsupported Iconoplasm sync finalization Queue message. The only supported Queue path is drain_finalization_ledger.",
  )
}

export async function handleIconoplasmSyncFinalizationQueue(batch, env, ctx) {
  const messages = Array.isArray(batch?.messages) ? batch.messages : []
  if (iconoplasmSyncFinalizationQueueDisabled(env)) {
    for (const message of messages) {
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 300 })
    }
    return {
      ok: false,
      processed: 0,
      failed: 0,
      retrying: messages.length,
      finalized: 0,
      granted: 0,
      skipped_disabled: messages.length,
      error: "Iconoplasm finalization Queue path is disabled; refusing to ack without processing.",
    }
  }
  const permit = await iconoplasmSyncGovernorJson(
    env,
    `/permit?requested=${encodeURIComponent(String(messages.length || 1))}`,
    { requested: messages.length || 1 },
  )
  const permitGranted = Math.max(
    0,
    Math.min(messages.length || 0, Number(permit?.granted || 0) || 0),
  )
  let retrying = 0
  const permittedMessages = messages.slice(0, permitGranted)
  const delayedMessages = messages.slice(permitGranted)
  for (const message of delayedMessages) {
    retrying += 1
    if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 })
  }
  if (permitGranted <= 0) {
    return {
      ok: false,
      processed: 0,
      failed: 0,
      retrying,
      finalized: 0,
      granted: 0,
      permit_granted: permitGranted,
      error: "Iconoplasm sync governor granted no Queue finalization permits.",
    }
  }
  const started = Date.now()
  let processed = 0
  let failed = 0
  let finalized = 0
  for (const message of permittedMessages) {
    try {
      const result = await processSyncFinalizationQueueMessage(env, ctx, message?.body)
      if (result?.kind === "drain_finalization_ledger") {
        processed += Math.max(0, Number(result?.processed || 0) || 0)
        failed += Math.max(0, Number(result?.failed || 0) || 0)
        finalized += Math.max(0, Number(result?.finalized || 0) || 0)
      } else if (!result?.skipped) {
        processed += 1
      }
      if (typeof message?.ack === "function") message.ack()
    } catch (error) {
      failed += 1
      retrying += 1
      if (typeof message?.retry === "function") {
        message.retry({ delaySeconds: 30 })
      } else {
        throw error
      }
    }
  }
  if (processed > 0) {
    const finalizeResult = await finalizeCompletedSyncFinalizationJobsIfDrained(env, ctx, {
      symbols: null,
    })
    finalized += Math.max(0, Number(finalizeResult?.finalized || 0) || 0)
  }
  await iconoplasmSyncGovernorJson(env, "/release", {
    processed,
    failed,
    retrying,
    latency_ms: Date.now() - started,
    // Queue message failures are retry pressure, not public-route health.
    // The workstation and live probes report public health separately; feeding
    // retry pressure into this field parks the whole factory even when public
    // routes are responding normally.
    public_health: "healthy",
  })
  return {
    ok: failed <= 0,
    processed,
    failed,
    retrying,
    finalized,
    granted: permitGranted,
    permit_granted: permitGranted,
  }
}

async function processPendingSyncFinalizationJobs(
  env,
  ctx,
  { limit = 25, finalizeIfDrained = true, symbols = null } = {},
) {
  if (!env?.ICONOPLASM_DB) {
    return { ok: false, code: "NO_DB", processed: 0, failed: 0, finalized: 0, remaining: 0 }
  }
  await ensureSyncFinalizationJobsTable(env)
  const safeLimit = Math.max(1, Math.min(250, Number.parseInt(String(limit || 25), 10) || 25))
  const scopedSymbols = normalizeSyncFinalizationJobSymbols(symbols, { maxItems: 5000 })
  const scopedSymbolsJson = JSON.stringify(scopedSymbols)
  const scopedEnabled = scopedSymbols.length > 0 ? 1 : 0
  const staleRecovery = await recoverStaleRunningSyncFinalizationJobs(env, {
    symbols: scopedSymbols,
  })
  const nowIso = new Date().toISOString()
  const queued = await env.ICONOPLASM_DB.prepare(
    `WITH scoped_symbols AS (
       SELECT value AS gene_symbol
       FROM json_each(?)
     )
     SELECT *
     FROM icono_sync_finalization_jobs
     WHERE status IN (?, ?)
       AND phase <> ?
       AND next_attempt_at <= ?
       AND (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM scoped_symbols))
     -- Live lesson: oldest-first alone made the queue look honest but drain
     -- badly, because late-phase rows kept sitting behind fresh reconcile work.
     -- Prefer jobs that are already closest to completed_pending_finalize so the
     -- visible pending bucket can actually collapse instead of endlessly
     -- recycling half-finished symbols.
     ORDER BY
       CASE phase
         WHEN ? THEN 0
         WHEN ? THEN 1
         WHEN ? THEN 2
         ELSE 3
       END ASC,
       requested_at ASC,
       gene_symbol ASC
     LIMIT ?`,
  )
    .bind(
      scopedSymbolsJson,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED,
      ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
      nowIso,
      scopedEnabled,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_VISION_ROLLUPS,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_GENE_ROLLUPS,
      ICONOPLASM_SYNC_FINALIZATION_PHASE_VOTE_SUMMARIES,
      safeLimit,
    )
    .all()
  const rows = (Array.isArray(queued?.results) ? queued.results : []).map(mapSyncFinalizationJobRow)
  const results = []
  let processed = 0
  let failed = 0
  let partial = false
  let stopReason = ""
  let partialBudget = null
  for (const job of rows) {
    const attemptCount = Math.max(0, Number(job?.attempts || 0) || 0)
    console.log("[Iconoplasm] finalization Queue job start", {
      symbol: job.symbol,
      phase: job.phase,
      attempts: attemptCount,
    })
    await writeSyncFinalizationJobState(env, {
      symbol: job.symbol,
      status: ICONOPLASM_SYNC_FINALIZATION_STATUS_RUNNING,
      phase: job.phase,
      lastAttemptAt: new Date().toISOString(),
      nextAttemptAt: nowIso,
      lastError: "",
    })
    try {
      const phaseResult = await processSyncFinalizationJobPhase(env, ctx, job)
      if (phaseResult?.partial) {
        await writeSyncFinalizationJobState(env, {
          symbol: job.symbol,
          status: ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED,
          phase: phaseResult.next_phase || job.phase,
          nextAttemptAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
          attempts: attemptCount,
          lastError: "",
          completedAt: null,
        })
        partial = true
        stopReason =
          sanitizeText(phaseResult?.stop_reason || "rows_written_target_cap_reached", 255) ||
          "rows_written_target_cap_reached"
        partialBudget =
          phaseResult?.result?.reconcile?.budget ||
          phaseResult?.result?.vote_summaries?.budget ||
          phaseResult?.result?.gene_rollups?.budget ||
          phaseResult?.result?.vision_rollups?.budget ||
          null
        results.push({
          ok: true,
          partial: true,
          symbol: job.symbol,
          phase: job.phase,
          next_phase: phaseResult.next_phase || job.phase,
          stop_reason: stopReason,
          result: phaseResult.result,
        })
        break
      }
      await writeSyncFinalizationJobState(env, {
        symbol: job.symbol,
        status: ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED,
        phase: phaseResult.next_phase,
        nextAttemptAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        attempts: attemptCount,
        lastError: "",
        completedAt:
          phaseResult.next_phase === ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE
            ? ""
            : null,
      })
      processed += 1
      console.log("[Iconoplasm] finalization Queue job advanced", {
        symbol: job.symbol,
        phase: job.phase,
        next_phase: phaseResult.next_phase,
      })
      results.push({
        ok: true,
        symbol: job.symbol,
        phase: job.phase,
        next_phase: phaseResult.next_phase,
        result: phaseResult.result,
      })
    } catch (error) {
      failed += 1
      console.error("[Iconoplasm] finalization Queue job failed", {
        symbol: job.symbol,
        phase: job.phase,
        error: sanitizeText(String(error?.message || error || "sync finalization failed"), 500),
      })
      await recordSyncFinalizationJobFailure(env, {
        symbol: job.symbol,
        error,
        attemptCount,
        phase: job.phase,
      })
      results.push({
        ok: false,
        symbol: job.symbol,
        phase: job.phase,
        error:
          sanitizeText(String(error?.message || error || "sync finalization failed"), 2000) ||
          "sync finalization failed",
      })
    }
  }
  const finalizeResult =
    !partial && finalizeIfDrained
      ? await finalizeCompletedSyncFinalizationJobsIfDrained(env, ctx, { symbols: scopedSymbols })
      : { ok: true, finalized: 0, remaining: 0 }
  const remaining = await countSyncFinalizationJobs(env, {
    whereSql: `status <> ?
      AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
    bindArgs: [ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED, scopedEnabled, scopedSymbolsJson],
  })
  return {
    ok: true,
    processed,
    failed,
    partial,
    stop_reason: partial ? stopReason : null,
    budget: partial ? partialBudget : null,
    recovered_stale_running: Math.max(0, Number(staleRecovery?.recovered || 0) || 0),
    finalized: Math.max(0, Number(finalizeResult?.finalized || 0) || 0),
    remaining,
    results,
  }
}

async function scheduleVoteProjectionRefresh(
  env,
  ctx,
  { symbol, actorId = "vote_projection", reason = "vote_projection_refresh" } = {},
) {
  const safeSymbol = normalizeSymbol(symbol)
  if (!safeSymbol) return { ok: false, code: "BAD_SYMBOL", queued: false }
  const safeActorId = normalizeUserId(actorId || "vote_projection")
  const safeReason = voteProjectionRefreshJobReason(reason)

  let queued = false
  try {
    const job = await enqueueVoteProjectionRefreshJob(env, {
      symbol: safeSymbol,
      actorId: safeActorId,
      reason: safeReason,
    })
    queued = Boolean(job?.ok)
  } catch (error) {
    queued = false
    console.error("[Iconoplasm] vote projection queue enqueue failed:", error)
  }

  const task = processVoteProjectionRefreshForSymbol(env, {
    symbol: safeSymbol,
    actorId: safeActorId,
    reason: safeReason,
  }).catch(async (error) => {
    console.error("[Iconoplasm] vote projection refresh failed:", error)
    if (queued) {
      await recordVoteProjectionRefreshFailure(env, {
        symbol: safeSymbol,
        actorId: safeActorId,
        reason: safeReason,
        error,
      })
    }
  })
  if (ctx?.waitUntil) ctx.waitUntil(task)
  else void task
  return {
    ok: true,
    queued,
    mode: queued ? "durable" : "best_effort",
    symbol: safeSymbol,
  }
}

async function listAutopromoteCandidateAssetsForSymbol(env, rawSymbol) {
  if (!env.ICONOPLASM_DB) return []
  const symbol = normalizeSymbol(rawSymbol)
  if (!symbol) return []
  const assetResp = await env.ICONOPLASM_DB.prepare(
    `SELECT
       pa.asset_sha256,
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
    .filter(
      (row) =>
        row.autopick_eligible && row.status !== "rejected" && assetHasRenderablePortrait(row),
    )

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
         SELECT gene_symbol FROM icono_gene_catalog
         UNION
         SELECT gene_symbol FROM icono_portrait_assets
         UNION
         SELECT gene_symbol FROM icono_publish_state
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
      updated_at: sanitizeText(summaryRow?.updated_at || "", 64) || "",
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
    whereParts.push("COALESCE(pa.asset_sha256, '') <> ''")
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

    let orderClause = "pa.gene_symbol ASC, COALESCE(vs.score, 0) DESC, pa.created_at DESC"
    if (cleanedSort === "votes") {
      orderClause =
        "COALESCE(vs.score, 0) DESC, COALESCE(vs.upvotes, 0) DESC, pa.gene_symbol ASC, pa.created_at DESC"
    } else if (cleanedSort === "recency") {
      orderClause = "pa.created_at DESC, pa.gene_symbol ASC, pa.asset_sha256 ASC"
    } else if (cleanedSort === "mismatch") {
      orderClause =
        "COALESCE(gr.current_asset_missing, 0) DESC, COALESCE(pa.is_stale, 0) DESC, pa.gene_symbol ASC, COALESCE(vs.score, 0) DESC"
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
        thumb_url: adminPortraitUrl(base, row?.asset_sha256 || "", "thumb"),
        medium_url: adminPortraitUrl(base, row?.asset_sha256 || "", "medium"),
        full_url: adminPortraitUrl(base, row?.asset_sha256 || "", "full"),
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

  let orderClause = "gr.gene_symbol ASC"
  if (cleanedSort === "votes") {
    orderClause =
      "COALESCE(gr.leader_score, gr.live_score, 0) DESC, COALESCE(gr.leader_upvotes, gr.live_upvotes, 0) DESC, gr.gene_symbol ASC"
  } else if (cleanedSort === "recency") {
    orderClause =
      "COALESCE(gr.updated_at, gr.leader_created_at, gr.last_asset_at, '') DESC, gr.gene_symbol ASC"
  } else if (cleanedSort === "mismatch") {
    orderClause =
      "COALESCE(gr.current_asset_missing, 0) DESC, COALESCE(gr.stale_count, 0) DESC, gr.gene_symbol ASC"
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
       gr.leader_asset_sha256 AS leader_sha,
       gr.leader_vision_id,
       gr.leader_artist_tag,
       gr.leader_artist_name,
       gr.leader_created_at,
       gr.leader_upvotes,
       gr.leader_downvotes,
       gr.leader_score,
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
      live_thumb_url: adminPortraitUrl(base, row?.live_sha || "", "thumb"),
      live_medium_url: adminPortraitUrl(base, row?.live_sha || "", "medium"),
      leader_sha: normalizeSha256(row?.leader_sha || "") || null,
      leader_vision_id: sanitizeText(row?.leader_vision_id || "", 255) || "",
      leader_artist_tag: sanitizeText(row?.leader_artist_tag || "", 255) || "",
      leader_artist_name: sanitizeText(row?.leader_artist_name || "", 255) || "",
      leader_upvotes: Number(row?.leader_upvotes || 0),
      leader_downvotes: Number(row?.leader_downvotes || 0),
      leader_score: Number(row?.leader_score || 0),
      leader_thumb_url: adminPortraitUrl(base, row?.leader_sha || "", "thumb"),
      leader_medium_url: adminPortraitUrl(base, row?.leader_sha || "", "medium"),
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
       pa.asset_sha256 AS asset_sha256,
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
       COALESCE(vs.score, 0) AS score,
       CASE
         WHEN COALESCE(?, '') = pa.asset_sha256 THEN 1
         ELSE 0
       END AS is_live
     FROM icono_portrait_assets pa
     LEFT JOIN icono_vote_asset_summary vs
       ON vs.gene_symbol = pa.gene_symbol
      AND vs.asset_sha256 = pa.asset_sha256
     WHERE pa.gene_symbol = ?
       AND COALESCE(pa.asset_sha256, '') <> ''
     ORDER BY
       is_live DESC,
       COALESCE(vs.score, 0) DESC,
       COALESCE(vs.upvotes, 0) DESC,
       pa.created_at DESC,
       pa.asset_sha256 ASC`,
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
     WHERE gene_symbol = ?
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
      full_url: adminPortraitUrl(base, row?.asset_sha256 || "", "full"),
      medium_url: adminPortraitUrl(base, row?.asset_sha256 || "", "medium"),
      thumb_url: adminPortraitUrl(base, row?.asset_sha256 || "", "thumb"),
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
    // Chesterton's fence: admin review must look at the same immutable blob
    // contract that public clients use. If this mapper keeps preferring copied
    // `r2_key_*` columns, operators can see a different portrait path than the
    // one the rest of the platform publishes from asset_sha256.
    hero_url: adminPortraitUrl(base, assetSha, "full"),
    medium_url: adminPortraitUrl(base, assetSha, "medium"),
    thumb_url: adminPortraitUrl(base, assetSha, "thumb"),
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
        pa.gene_symbol AS gene_symbol,
        pa.asset_sha256 AS asset_sha256,
         COALESCE(pa.artist_tag, '') AS artist_tag,
         COALESCE(pa.artist_name, '') AS artist_name,
         pa.candidate_image_id,
         lower(COALESCE(pa.status, 'draft')) AS status,
         pa.width,
         pa.height,
         pa.bytes,
         COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
         COALESCE(pa.is_stale, 0) AS is_stale,
         COALESCE(pa.is_legacy, 0) AS is_legacy,
         COALESCE(pa.created_at, '') AS created_at,
         COALESCE(vs.upvotes, 0) AS upvotes,
         COALESCE(vs.downvotes, 0) AS downvotes,
         COALESCE(vs.score, 0) AS score,
         COALESCE(vs.vote_count, 0) AS vote_count,
         CASE
          WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
           ELSE 0
         END AS is_current,
         ROW_NUMBER() OVER (
           PARTITION BY pa.vision_id
           ORDER BY
             CASE
              WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
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
            pa.asset_sha256 ASC
         ) AS row_num
       FROM icono_portrait_assets pa
       JOIN incoming i
         ON i.vision_id = pa.vision_id
       LEFT JOIN icono_vote_asset_summary vs
        ON vs.gene_symbol = pa.gene_symbol
       AND vs.asset_sha256 = pa.asset_sha256
       LEFT JOIN icono_publish_state ps
        ON ps.gene_symbol = pa.gene_symbol
       WHERE COALESCE(pa.asset_sha256, '') <> ''
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
          WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
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
     WHERE gene_symbol = ?
       AND asset_sha256 = ?
     LIMIT 1`,
  )
    .bind(symbolNorm, assetShaNorm)
    .first()
  if (!existing) {
    return { ok: false, changed: false, code: "NOT_FOUND" }
  }

  const current = await env.ICONOPLASM_DB.prepare(
    "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
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
      "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=0, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
    "DELETE FROM icono_image_votes WHERE gene_symbol=? AND asset_sha256=?",
  )
    .bind(symbolNorm, assetShaNorm)
    .run()
  await env.ICONOPLASM_DB.prepare(
    "DELETE FROM icono_portrait_assets WHERE gene_symbol=? AND asset_sha256=?",
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
  for (const key of keys) {
    await deletePortraitStorageObject(env, key)
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
    candidate_image_id: optionalInt(candidateImageId ?? existing?.candidate_image_id) ?? null,
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
        discoveryRandomRank(seed, left.gene_symbol) -
          discoveryRandomRank(seed, right.gene_symbol) ||
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
  cardCatalogArtifactCache.version = null
  cardCatalogArtifactCache.value = null
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
  if (!env?.KV || !version) return false
  try {
    await env.KV.put(`${prefix}${version}`, JSON.stringify(value))
    return true
  } catch {
    // Shared-cache writes are an optimization barrier, not the source of truth.
    // If KV write-through fails we can still fall back to the raw D1 result.
    return false
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
  if (
    !fresh &&
    hydratedCatalogArtifactCache.key === cacheKey &&
    hydratedCatalogArtifactCache.value
  ) {
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
  const barrier = await currentGalleryVersionBarrier(env)
  return barrier.current
}

function normalizeGalleryVersionBarrierValue(value) {
  if (value && typeof value === "object") {
    const current = String(value.current || "").trim() || "0"
    const previous = String(value.previous || "").trim()
    return {
      current,
      previous: previous && previous !== current ? previous : null,
      raw: value,
    }
  }
  const current = String(value || "0").trim() || "0"
  return { current, previous: null, raw: value || "0" }
}

async function currentGalleryVersionBarrier(env) {
  const now = Date.now()
  if (!env.KV) {
    galleryVersionCache.loadedAt = now
    return normalizeGalleryVersionBarrierValue(galleryVersionCache.value || "0")
  }
  try {
    const raw = await env.KV.get(KV_GALLERY_VERSION)
    let value = null
    try {
      value = raw ? JSON.parse(raw) : null
    } catch {
      value = null
    }
    galleryVersionCache.value =
      value && typeof value === "object" ? value : String(raw || "0").trim() || "0"
  } catch {
    galleryVersionCache.value = galleryVersionCache.value || "0"
  }
  galleryVersionCache.loadedAt = now
  return normalizeGalleryVersionBarrierValue(galleryVersionCache.value || "0")
}

async function currentMobileCardSnapshotVersion(env) {
  return currentGalleryVersionBarrier(env)
}

function nextGalleryVersionBarrier(previousBarrier) {
  const previous = String(previousBarrier.current || "").trim()
  const next = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  return {
    current: next,
    previous: previous && previous !== next && previous !== "0" ? previous : null,
    schema: MOBILE_CARD_VM_SCHEMA,
    published_at: new Date().toISOString(),
    status: "active",
  }
}

async function publishGalleryVersionBarrier(env, barrier) {
  galleryVersionCache.value = barrier
  galleryVersionCache.loadedAt = Date.now()
  if (env.KV) {
    await env.KV.put(KV_GALLERY_VERSION, JSON.stringify(barrier))
  }
  return String(barrier?.current || "")
}

async function bumpGalleryVersion(env) {
  const barrier = nextGalleryVersionBarrier(await currentGalleryVersionBarrier(env))
  return publishGalleryVersionBarrier(env, barrier)
}

async function invalidateGalleryCache(env) {
  clearGallerySnapshotCache()
  clearSharedD1CostCaches()
  const barrier = nextGalleryVersionBarrier(await currentGalleryVersionBarrier(env))
  const cardCatalog = await publishCardCatalogArtifact(env, {
    version: barrier.current,
    requestUrl: "https://iconoplasm.brinedew.bio/",
  })
  const version = await publishGalleryVersionBarrier(env, barrier)
  return { version, card_catalog: cardCatalog }
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
  const invalidation = await invalidateGalleryCache(env)
  return { ...result, card_catalog: invalidation.card_catalog }
}

function parseJsonTextList(raw) {
  try {
    const parsed = JSON.parse(String(raw || "[]"))
    if (!Array.isArray(parsed)) return []
    return parsed.map((value) => String(value || "").trim()).filter(Boolean)
  } catch {
    return []
  }
}

function cardCatalogEssenceFromRow(row) {
  const aesthetics = parseJsonTextList(row?.aesthetics_json)
  const aestheticsOrigin = parseJsonTextList(row?.aesthetics_origin_json)
  const politicsOrigin = parseJsonTextList(row?.politics_origin_json)
  return {
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
    ...(row?.essence_full_name ? { name: String(row.essence_full_name) } : {}),
  }
}

function cardCatalogRecordFromJoinedRow(row, { base, snapshotVersion }) {
  const symbol = normalizeSymbol(row?.gene_symbol || "")
  if (!symbol) return null
  const assetSha = normalizeSha256(row?.asset_sha256 || "")
  const essence = cardCatalogEssenceFromRow(row)
  const essenceFullName = sanitizeText(row?.essence_full_name || "", 255)
  const catalogFullName = sanitizeText(row?.catalog_full_name || "", 255)
  const fullName = essenceFullName || catalogFullName || symbol
  const portrait = assetSha
    ? {
        status: "published",
        hero_url: adminPortraitUrl(base, assetSha, "full"),
        medium_url: adminPortraitUrl(base, assetSha, "medium"),
        thumb_url: adminPortraitUrl(base, assetSha, "thumb"),
        width: optionalInt(row?.width),
        height: optionalInt(row?.height),
        asset_sha256: assetSha,
        candidate_image_id: optionalInt(row?.candidate_image_id),
        vision_id: sanitizeText(row?.vision_id || "", 128) || null,
        emulsion_id: publicEmulsionIdForRow(row) || null,
        emulsion_label: generationRequestVisionLabel(row) || null,
        artist_id: publicArtistIdForRow(row) || null,
      }
    : {
        status: "missing",
        hero_url: null,
        medium_url: null,
        thumb_url: null,
        width: null,
        height: null,
        asset_sha256: null,
        candidate_image_id: null,
        emulsion_id: null,
        emulsion_label: null,
        artist_id: null,
      }
  return {
    api_version: PUBLIC_API_VERSION,
    schema_version: API_SCHEMA_VERSION,
    canonical_key: "symbol",
    canonical_symbol: symbol,
    symbol,
    full_name: fullName,
    color: normalizeHexColor(row?.color_hex || "") || null,
    ...(row?.weight_kg != null ? { weight_kg: Number(row.weight_kg) } : {}),
    ...(row?.tissue_tau != null ? { tissue_tau: Number(row.tissue_tau) } : {}),
    ...(row?.loeuf != null ? { loeuf: Number(row.loeuf) } : {}),
    ...(row?.constraint_percentile != null
      ? { constraint_percentile: Number(row.constraint_percentile) }
      : {}),
    essence: {
      ...essence,
      name: fullName,
      ...(essence.sex
        ? {}
        : row?.tmh != null
          ? { sex: coerceBoolean(row.tmh, false) ? "Male" : "Female" }
          : {}),
      ...(essence.sex_origin
        ? {}
        : row?.tmh != null
          ? { sex_origin: [coerceBoolean(row.tmh, false) ? "Transmembrane" : "Soluble"] }
          : {}),
    },
    ...(row?.manifestation ? { manifestation: String(row.manifestation) } : {}),
    portrait,
    resolved_from: "published_card_catalog_bulk",
    snapshot_version: snapshotVersion,
  }
}

async function cardCatalogRecordsForArtifact(env, { requestUrl, symbols = null, snapshotVersion }) {
  if (!env?.ICONOPLASM_DB) throw new Error("ICONOPLASM_DB binding missing")
  const base = portraitBase(new URL(requestUrl || "https://iconoplasm.brinedew.bio/"), env)
  const symbolList = Array.isArray(symbols)
    ? normalizeRequestedSymbols(symbols, MOBILE_CARD_VM_FULL_REBUILD_WARM_SYMBOL_LIMIT)
    : []
  const sql = `SELECT
       gc.gene_symbol,
       gc.full_name AS catalog_full_name,
       gc.color_hex,
       gc.tmh,
       ge.full_name AS essence_full_name,
       ge.weight_kg,
       ge.height_cm,
       ge.sex,
       ge.age,
       ge.age_years,
       ge.faction,
       ge.skin_hex,
       ge.skin_name,
       ge.tissue_tau,
       ge.loeuf,
       ge.constraint_percentile,
       ge.aesthetics_json,
       ge.aesthetics_origin_json,
       ge.politics_origin_json,
       ge.family_surname,
       ge.family_members,
       ge.family_feature,
       ge.manifestation,
       ps.current_asset_sha256 AS asset_sha256,
       pa.width,
       pa.height,
       pa.vision_id,
       pa.candidate_image_id,
       pa.emulsion_id,
       pa.workflow_id,
       pa.workflow_label,
       pa.workflow_path,
       pa.prompt_version,
       pa.variant_slot
     FROM icono_gene_catalog gc
     LEFT JOIN icono_gene_essence ge
       ON ge.gene_symbol = gc.gene_symbol
     LEFT JOIN icono_publish_state ps
       ON ps.gene_symbol = gc.gene_symbol
     LEFT JOIN icono_portrait_assets pa
       ON pa.gene_symbol = ps.gene_symbol
      AND pa.asset_sha256 = ps.current_asset_sha256
     ${symbolList.length ? `WHERE gc.gene_symbol IN (${symbolList.map(() => "?").join(",")})` : ""}
     ORDER BY gc.gene_symbol ASC`
  const stmt = env.ICONOPLASM_DB.prepare(sql)
  const result = symbolList.length ? await stmt.bind(...symbolList).all() : await stmt.all()
  const rows = Array.isArray(result?.results) ? result.results : []
  return rows
    .map((row) => cardCatalogRecordFromJoinedRow(row, { base, snapshotVersion }))
    .filter(Boolean)
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
        ) || compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "lightest") {
      return (
        compareNullableNumberAscWithNullBottom(
          gallerySortablePositiveMetric(left.weight_kg),
          gallerySortablePositiveMetric(right.weight_kg),
        ) || compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "oldest") {
      return (
        compareNullableNumberDescWithNullBottom(
          gallerySortablePositiveMetric(left.age_years),
          gallerySortablePositiveMetric(right.age_years),
        ) || compareGalleryPopularityFallback(left, right)
      )
    }
    if (order === "youngest") {
      return (
        compareNullableNumberAscWithNullBottom(
          gallerySortablePositiveMetric(left.age_years),
          gallerySortablePositiveMetric(right.age_years),
        ) || compareGalleryPopularityFallback(left, right)
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
         AND COALESCE(pa.asset_sha256, '') <> ''`,
  ).all()
  return Array.isArray(rows?.results) ? rows.results : []
}

async function galleryPublishedRows(env, { fresh = false } = {}) {
  if (!env.ICONOPLASM_DB) return []
  if (fresh) return queryGalleryPublishedRows(env)
  const version = await currentGalleryVersion(env)
  if (
    galleryPublishedRowsCache.version === version &&
    Array.isArray(galleryPublishedRowsCache.value)
  ) {
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
  if (
    galleryUniquenessRowsCache.version === version &&
    Array.isArray(galleryUniquenessRowsCache.value)
  ) {
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
      ph: adminPortraitUrl(base, row?.asset_sha256, "full"),
      pt: adminPortraitUrl(base, row?.asset_sha256, "medium"),
      portrait: {
        status: "published",
        hero_url: adminPortraitUrl(base, row?.asset_sha256, "full"),
        medium_url: adminPortraitUrl(base, row?.asset_sha256, "medium"),
        thumb_url: adminPortraitUrl(base, row?.asset_sha256, "thumb"),
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
        ph: adminPortraitUrl(base, row?.asset_sha256, "full"),
        pt: adminPortraitUrl(base, row?.asset_sha256, "medium"),
        portrait: {
          status: "published",
          hero_url: adminPortraitUrl(base, row?.asset_sha256, "full"),
          medium_url: adminPortraitUrl(base, row?.asset_sha256, "medium"),
          thumb_url: adminPortraitUrl(base, row?.asset_sha256, "thumb"),
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
  // Classic public gallery mode has its own order machinery. It is separate
  // from signed-in shelves and account gallery windows, so no cache should infer
  // "the next genes a user will see" from this path alone.
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
         AND COALESCE(pa.asset_sha256, '') <> ''
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
      full_url: adminPortraitUrl(base, assetSha, "full"),
      medium_url: adminPortraitUrl(base, assetSha, "medium"),
      thumb_url: adminPortraitUrl(base, assetSha, "thumb"),
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

async function handlePublicStats(request, env) {
  if (!env?.KV) {
    return json({ error: "Public stats not available" }, 404, {
      "Cache-Control": "public, max-age=300",
    })
  }
  let payload = null
  try {
    const raw = await env.KV.get(KV_PUBLIC_STATS)
    payload = normalizePublicStatsPayload(raw ? JSON.parse(raw) : null)
  } catch {
    payload = null
  }
  if (!payload) {
    return json({ error: "Public stats not published yet" }, 404, {
      "Cache-Control": "public, max-age=300",
    })
  }
  const etag = await etagFor(payload)
  if (etagMatches(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ...corsHeaders(),
        ETag: etag,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  }
  return json(payload, 200, {
    ETag: etag,
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
  })
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
    // Chesterton's fence: this manifest route is the extension's release
    // contract, not just another generic public API envelope. We already burned
    // ourselves by publishing the stricter contract in extensionManifestObj()
    // and then quietly overwriting schema_version here with the unrelated
    // public API schema number. That made the route look healthy while serving
    // an older contract to the browser. Keep the manifest schema explicit here
    // so the extension can fail loud on incompatible published state instead of
    // guessing from mixed version numbers.
    schema_version: manifest.schema_version || manifest.artifact_schema_version || 1,
    canonical_key: "symbol",
    catalog_hash: catalogHash,
    build_version: buildHash,
    portrait_hash: portraitFingerprintVersion(portraitFingerprint),
    released_at: manifest.generated_at || null,
    gene_count: manifest.gene_count || null,
    artifact_schema_version: manifest.artifact_schema_version || manifest.schema_version || 1,
    min_extension_version:
      manifest.min_extension_version ||
      env.ICONOPLASM_MIN_EXTENSION_VERSION ||
      MIN_EXTENSION_VERSION,
    portrait_base_url: manifest.portrait_base_url || portraitBase(url, env),
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
  const hash = String(match[1] || "").split("-")[0]
  const object = await readPortraitStorageObject(env, publicCatalogJsonlDumpKey(hash), {
    fallbackContentType: "application/x-ndjson; charset=utf-8",
  })
  if (!object) return json({ error: "Catalog dump not found" }, 404)
  return new Response(object.body, {
    headers: {
      ...corsHeaders(),
      "Content-Type": object.contentType || "application/x-ndjson; charset=utf-8",
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
    const record = await geneRecord(env, url, symbol, { fields })
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

function mobileCardFieldStatusForGeneRecord(record) {
  const essence = record?.essence && typeof record.essence === "object" ? record.essence : {}
  const portrait = record?.portrait && typeof record.portrait === "object" ? record.portrait : null
  const status = {
    symbol: record?.symbol ? "present" : "failed_to_resolve",
    full_name: record?.full_name ? "present" : "known_absent",
    color: record?.color ? "present" : "known_absent",
    portrait:
      portrait && String(portrait.status || "").trim()
        ? String(portrait.status) === "published"
          ? "present"
          : "known_absent"
        : "known_absent",
    family: essence.family_surname ? "present" : "known_absent",
    family_feature: essence.family_feature ? "present" : "known_absent",
    category:
      record?.protein_length_aa != null || record?.molecular_weight_kda != null
        ? "present"
        : "known_absent",
    age:
      record?.first_publication_year != null || essence.age_years != null || essence.age
        ? "present"
        : "known_absent",
    weight:
      record?.molecular_weight_kda != null || record?.weight_kg != null
        ? "present"
        : "known_absent",
    pfam_clans:
      Array.isArray(essence.aesthetics_origin) && essence.aesthetics_origin.length
        ? "present"
        : "known_absent",
    style_notes:
      Array.isArray(essence.aesthetics) && essence.aesthetics.length ? "present" : "known_absent",
    alignment:
      Array.isArray(essence.politics_origin) && essence.politics_origin.length
        ? "present"
        : "known_absent",
    political_note: essence.politics || essence.faction ? "present" : "known_absent",
    color_breakdown:
      record?.tissue_tau != null || record?.loeuf != null || record?.constraint_percentile != null
        ? "present"
        : "known_absent",
  }
  return status
}

function buildMobileCardVMFromGeneRecord(
  record,
  { snapshotVersion = "0", source = "request_composed" } = {},
) {
  const symbol = normalizeSymbol(record?.symbol || record?.canonical_symbol || "")
  if (!symbol) return null
  const fullName = sanitizeText(record?.full_name || "", 255) || symbol
  const portrait = record?.portrait && typeof record.portrait === "object" ? record.portrait : {}
  const portraitStatus = String(portrait.status || "").trim() || "missing"
  return {
    __complete: true,
    schema_version: MOBILE_CARD_VM_SCHEMA,
    snapshot_version: String(snapshotVersion || "0"),
    data_source: source,
    symbol,
    full_name: fullName,
    display_color: normalizeHexColor(record?.color || "") || "#888",
    portrait: {
      status: portraitStatus === "pending" ? "missing" : portraitStatus,
      url: portrait.medium_url || portrait.hero_url || portrait.thumb_url || null,
      full_url: portrait.hero_url || portrait.medium_url || portrait.thumb_url || null,
      thumb_url: portrait.thumb_url || null,
      width: optionalInt(portrait.width),
      height: optionalInt(portrait.height),
      asset_sha256: normalizeSha256(portrait.asset_sha256 || "") || null,
      candidate_image_id: optionalInt(portrait.candidate_image_id),
      vision_id: sanitizeText(portrait.vision_id || "", 128) || null,
      emulsion_id: sanitizeText(portrait.emulsion_id || portrait.emulsion_label || "", 128) || null,
    },
    field_status: mobileCardFieldStatusForGeneRecord(record),
    payload: record,
  }
}

function assertCompleteMobileCardVM(vm) {
  if (!vm || typeof vm !== "object") return false
  if (vm.__complete !== true) return false
  if (vm.schema_version !== MOBILE_CARD_VM_SCHEMA) return false
  if (!normalizeSymbol(vm.symbol || "")) return false
  if (!vm.full_name) return false
  if (!vm.portrait || typeof vm.portrait !== "object") return false
  if (!vm.field_status || typeof vm.field_status !== "object") return false
  if (String(vm.portrait.status || "").trim() === "pending") return false
  return true
}

function normalizeCardCatalogArtifact(raw) {
  if (!raw || typeof raw !== "object") return null
  if (raw.schema !== CARD_CATALOG_ARTIFACT_SCHEMA) return null
  const artifactVersion = String(raw.artifact_version || raw.snapshot_version || "").trim()
  const cards = Array.isArray(raw.cards) ? raw.cards : []
  const bySymbol = new Map()
  for (const card of cards) {
    if (!assertCompleteMobileCardVM(card)) return null
    const symbol = normalizeSymbol(card.symbol || "")
    if (!symbol || bySymbol.has(symbol)) return null
    bySymbol.set(symbol, card)
  }
  const catalogGeneCount = Math.max(0, Number(raw.catalog_gene_count || 0) || 0)
  if (catalogGeneCount > 0 && bySymbol.size !== catalogGeneCount) return null
  if (Math.max(0, Number(raw.card_count || 0) || 0) !== bySymbol.size) return null
  return {
    ...raw,
    artifact_version: artifactVersion,
    snapshot_version: artifactVersion,
    catalog_gene_count: catalogGeneCount || bySymbol.size,
    card_count: bySymbol.size,
    cards,
    bySymbol,
  }
}

function cardCatalogArtifactStoreKey(artifactVersion) {
  return `${KV_CARD_CATALOG_ARTIFACT_PREFIX}${artifactVersion}`
}

function cardCatalogArtifactShardKey(artifactVersion, index) {
  return `${cardCatalogArtifactStoreKey(artifactVersion)}:shard:${index}`
}

function cardCatalogShardMayContainSymbol(shard, symbol) {
  const normalized = normalizeSymbol(symbol || "")
  if (!normalized) return false
  const first = normalizeSymbol(shard?.first_symbol || "")
  const last = normalizeSymbol(shard?.last_symbol || "")
  if (!first || !last) return true
  return normalized >= first && normalized <= last
}

function normalizePartialCardCatalogArtifact(raw, cards) {
  if (!raw || typeof raw !== "object") return null
  const artifactVersion = String(raw.artifact_version || raw.snapshot_version || "").trim()
  if (!artifactVersion || raw.schema !== CARD_CATALOG_ARTIFACT_SCHEMA) return null
  const bySymbol = new Map()
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!assertCompleteMobileCardVM(card)) return null
    const symbol = normalizeSymbol(card.symbol || "")
    if (!symbol || bySymbol.has(symbol)) return null
    bySymbol.set(symbol, card)
  }
  return {
    ...raw,
    artifact_version: artifactVersion,
    snapshot_version: artifactVersion,
    catalog_gene_count: Math.max(0, Number(raw.catalog_gene_count || 0) || 0),
    card_count: Math.max(0, Number(raw.card_count || 0) || 0),
    cards,
    bySymbol,
  }
}

function cardCatalogArtifactManifestFromCards({
  artifactVersion,
  artifactValidatedAt,
  catalogGeneCount,
  cards,
}) {
  const shards = []
  for (let index = 0; index * CARD_CATALOG_ARTIFACT_SHARD_SIZE < cards.length; index += 1) {
    const shardCards = cards.slice(
      index * CARD_CATALOG_ARTIFACT_SHARD_SIZE,
      (index + 1) * CARD_CATALOG_ARTIFACT_SHARD_SIZE,
    )
    shards.push({
      key: cardCatalogArtifactShardKey(artifactVersion, index),
      index,
      card_count: shardCards.length,
      first_symbol: shardCards[0]?.symbol || null,
      last_symbol: shardCards[shardCards.length - 1]?.symbol || null,
    })
  }
  return {
    schema: CARD_CATALOG_ARTIFACT_SCHEMA,
    artifact_version: artifactVersion,
    snapshot_version: artifactVersion,
    artifact_validated_at: artifactValidatedAt,
    source: "published_card_catalog",
    storage: "kv_sharded",
    shard_size: CARD_CATALOG_ARTIFACT_SHARD_SIZE,
    shard_count: shards.length,
    catalog_gene_count: catalogGeneCount,
    card_count: cards.length,
    shards,
  }
}

async function writeCardCatalogArtifactToKV(env, artifact) {
  const cards = Array.isArray(artifact?.cards) ? artifact.cards : []
  const artifactVersion = String(artifact?.artifact_version || "").trim()
  const manifest = cardCatalogArtifactManifestFromCards({
    artifactVersion,
    artifactValidatedAt: artifact.artifact_validated_at,
    catalogGeneCount: artifact.catalog_gene_count,
    cards,
  })
  for (const shard of manifest.shards) {
    const shardCards = cards.slice(
      shard.index * CARD_CATALOG_ARTIFACT_SHARD_SIZE,
      (shard.index + 1) * CARD_CATALOG_ARTIFACT_SHARD_SIZE,
    )
    await env.KV.put(
      shard.key,
      JSON.stringify({
        schema: CARD_CATALOG_ARTIFACT_SCHEMA,
        artifact_version: artifactVersion,
        shard_index: shard.index,
        cards: shardCards,
      }),
    )
  }
  await env.KV.put(cardCatalogArtifactStoreKey(artifactVersion), JSON.stringify(manifest))
}

async function readPublishedCardCatalogArtifact(env, version, symbols = null) {
  const artifactVersion = String(version || "").trim()
  if (!artifactVersion || !env?.KV?.get) return null
  const requestedSymbols = Array.isArray(symbols)
    ? normalizeRequestedSymbols(symbols, MOBILE_CARD_VM_FULL_REBUILD_WARM_SYMBOL_LIMIT)
    : null
  if (
    !requestedSymbols &&
    cardCatalogArtifactCache.version === artifactVersion &&
    normalizeCardCatalogArtifact(cardCatalogArtifactCache.value)
  ) {
    return cardCatalogArtifactCache.value
  }
  if (
    requestedSymbols &&
    cardCatalogArtifactCache.version === artifactVersion &&
    normalizeCardCatalogArtifact(cardCatalogArtifactCache.value) &&
    requestedSymbols.every((symbol) => cardCatalogArtifactCache.value.bySymbol.has(symbol))
  ) {
    return cardCatalogArtifactCache.value
  }
  const raw = await env.KV.get(cardCatalogArtifactStoreKey(artifactVersion))
  let parsed = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  if (
    parsed?.schema === CARD_CATALOG_ARTIFACT_SCHEMA &&
    parsed.storage === "kv_sharded" &&
    Array.isArray(parsed.shards)
  ) {
    const cards = []
    const shards = requestedSymbols
      ? parsed.shards.filter((shard) =>
          requestedSymbols.some((symbol) => cardCatalogShardMayContainSymbol(shard, symbol)),
        )
      : parsed.shards
    const shardPayloads = await Promise.all(
      shards.map(async (shard) => {
        const shardRaw = await env.KV.get(String(shard?.key || ""))
        let shardParsed = null
        try {
          shardParsed = shardRaw ? JSON.parse(shardRaw) : null
        } catch {
          shardParsed = null
        }
        return { shard, shardParsed }
      }),
    )
    for (const { shard, shardParsed } of shardPayloads) {
      if (
        shardParsed?.schema !== CARD_CATALOG_ARTIFACT_SCHEMA ||
        String(shardParsed.artifact_version || "") !== artifactVersion ||
        Number(shardParsed.shard_index) !== Number(shard.index) ||
        !Array.isArray(shardParsed.cards) ||
        shardParsed.cards.length !== Number(shard.card_count || 0)
      ) {
        return null
      }
      cards.push(...shardParsed.cards)
    }
    if (requestedSymbols) {
      const requestedSet = new Set(requestedSymbols)
      const artifact = normalizePartialCardCatalogArtifact(
        parsed,
        cards.filter((card) => requestedSet.has(normalizeSymbol(card?.symbol || ""))),
      )
      return artifact
    }
    parsed = { ...parsed, cards }
  }
  const artifact = normalizeCardCatalogArtifact(parsed)
  if (!artifact) return null
  cardCatalogArtifactCache.version = artifactVersion
  cardCatalogArtifactCache.value = artifact
  return artifact
}

function cardArtifactUnavailablePayload(version, detail = "") {
  return {
    ok: false,
    code: CARD_ARTIFACT_UNAVAILABLE,
    error:
      "The published Iconoplasm card catalog artifact is unavailable or invalid. Runtime browsing has one card data path and will not compose per-gene fallback cards.",
    artifact_version: String(version || ""),
    detail: sanitizeText(detail || "", 500) || null,
  }
}

async function publishCardCatalogArtifact(
  env,
  { version, requestUrl = "https://iconoplasm.brinedew.bio/", symbols = null } = {},
) {
  if (!env?.KV?.put) throw new Error("KV binding missing")
  if (!env?.ICONOPLASM_DB) throw new Error("ICONOPLASM_DB binding missing")
  assertIconoplasmCardCatalogBudgetPreflight(env)
  const artifactVersion = String(version || "").trim()
  if (!artifactVersion) throw new Error("Card catalog artifact version missing")
  const requestedSymbols = Array.isArray(symbols)
    ? normalizeRequestedSymbols(symbols, MOBILE_CARD_VM_FULL_REBUILD_WARM_SYMBOL_LIMIT)
    : null
  if (Array.isArray(requestedSymbols) && !requestedSymbols.length) {
    throw new Error("Card catalog has no catalog symbols")
  }
  const records = await cardCatalogRecordsForArtifact(env, {
    requestUrl,
    symbols: requestedSymbols,
    snapshotVersion: artifactVersion,
  })
  const catalogSymbols = Array.isArray(requestedSymbols)
    ? requestedSymbols
    : records.map((record) => normalizeSymbol(record?.symbol || "")).filter(Boolean)
  if (!catalogSymbols.length) throw new Error("Card catalog has no catalog symbols")
  const cards = []
  const missing = []
  const seen = new Set()
  for (const record of records) {
    const vm = buildMobileCardVMFromGeneRecord(record, {
      snapshotVersion: artifactVersion,
      source: "published_card_catalog",
    })
    const symbol = normalizeSymbol(record?.symbol || "")
    if (!assertCompleteMobileCardVM(vm)) {
      missing.push(symbol)
      continue
    }
    const normalized = normalizeSymbol(vm.symbol || "")
    if (!normalized || seen.has(normalized)) {
      missing.push(symbol)
      continue
    }
    seen.add(normalized)
    cards.push({ ...vm, snapshot_version: artifactVersion, data_source: "published_card_catalog" })
  }
  if (missing.length || cards.length !== catalogSymbols.length) {
    throw new Error(
      `Card catalog artifact refused to publish: ${missing.length} missing/invalid card(s)`,
    )
  }
  const artifact = normalizeCardCatalogArtifact({
    schema: CARD_CATALOG_ARTIFACT_SCHEMA,
    artifact_version: artifactVersion,
    snapshot_version: artifactVersion,
    artifact_validated_at: new Date().toISOString(),
    source: "published_card_catalog",
    catalog_gene_count: catalogSymbols.length,
    card_count: cards.length,
    cards,
  })
  if (!artifact) throw new Error("Card catalog artifact failed validation")
  await writeCardCatalogArtifactToKV(env, artifact)
  cardCatalogArtifactCache.version = artifactVersion
  cardCatalogArtifactCache.value = artifact
  return {
    artifact_version: artifactVersion,
    artifact_gene_count: artifact.card_count,
    catalog_gene_count: artifact.catalog_gene_count,
    artifact_validated_at: artifact.artifact_validated_at,
    source: "published_card_catalog",
  }
}

async function handleMobileCardManifest(request, env) {
  // Card payloads have one runtime path: the published card-catalog artifact.
  // No per-gene KV probing and no previous-version fallback belongs here. The
  // release gate keeps the old live artifact active until the new one validates.
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405)
  const body = await parseJsonBody(request)
  const symbols = normalizeRequestedSymbols(body.symbols || [], 100)
  const layout = sanitizeText(body.layout || MOBILE_CARD_LAYOUT, 64) || MOBILE_CARD_LAYOUT
  if (layout !== MOBILE_CARD_LAYOUT) {
    return json({ error: "Unsupported mobile card layout", layout }, 400, {
      "Cache-Control": "no-store",
    })
  }
  const versionInfo = await currentMobileCardSnapshotVersion(env)
  const requestedVersion = sanitizeText(body.version || "", 128)
  const snapshotVersion =
    requestedVersion && requestedVersion === versionInfo.current
      ? requestedVersion
      : versionInfo.current
  if (!symbols.length) {
    return json(
      {
        schema: MOBILE_CARD_MANIFEST_SCHEMA,
        snapshot_version: snapshotVersion,
        data_source: "published_card_catalog",
        cards: [],
        missing: [],
        diagnostics: {
          artifact_version: snapshotVersion,
          artifact_gene_count: 0,
          catalog_gene_count: 0,
          artifact_validated_at: null,
          source: "published_card_catalog",
          layout,
        },
      },
      200,
      { "Cache-Control": "no-store" },
    )
  }

  const artifact = await readPublishedCardCatalogArtifact(env, snapshotVersion, symbols)
  if (!artifact) {
    return json(cardArtifactUnavailablePayload(snapshotVersion), 503, {
      "Cache-Control": "no-store",
      "X-Iconoplasm-Data-Source": "artifact-unavailable",
      "X-Iconoplasm-Snapshot-State": "card-artifact-unavailable",
    })
  }
  const cards = []
  const missing = []
  for (const symbol of symbols) {
    const card = artifact.bySymbol.get(symbol)
    if (card) cards.push(card)
    else missing.push(symbol)
  }

  return json(
    {
      schema: MOBILE_CARD_MANIFEST_SCHEMA,
      snapshot_version: snapshotVersion,
      data_source: "published_card_catalog",
      cards: cards.sort(
        (left, right) => symbols.indexOf(left.symbol) - symbols.indexOf(right.symbol),
      ),
      missing,
      diagnostics: {
        artifact_version: artifact.artifact_version,
        artifact_gene_count: artifact.card_count,
        catalog_gene_count: artifact.catalog_gene_count,
        artifact_validated_at: artifact.artifact_validated_at,
        source: "published_card_catalog",
        d1_composed: 0,
        layout,
      },
    },
    200,
    {
      "Cache-Control": "no-store",
      "X-Iconoplasm-VM-Version": snapshotVersion,
      "X-Iconoplasm-Data-Source": "published-card-catalog",
      "X-Iconoplasm-Snapshot-State": "published-card-catalog",
    },
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
      `SELECT gene_symbol AS symbol, updated_at
         FROM icono_gene_catalog
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol AS symbol, updated_at
         FROM icono_gene_essence
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol AS symbol, updated_at
         FROM icono_publish_state
        WHERE COALESCE(updated_at, '') > ?
        ORDER BY updated_at ASC, gene_symbol ASC
        LIMIT ?`,
    )
      .bind(since, perSourceLimit)
      .all(),
    env.ICONOPLASM_DB.prepare(
      `SELECT gene_symbol AS symbol, current_asset_sha256
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
    await geneRecord(env, url, resolved.symbol, {
      fields: url.searchParams.get("fields"),
    }),
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
    return json({ genes: [], query: "", scope_applied: requestedScope }, 200, {
      "Cache-Control": requestedScope === "catalog" ? "public, max-age=30" : "no-store",
    })
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
  return json({ genes, query: qUpper, scope_applied: appliedScope }, 200, {
    "Cache-Control": cacheControl,
  })
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

export async function handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx = { waitUntil() {} },
) {
  const url = new URL(request.url)
  const path = url.pathname
  let meteredEnv = env
  let responseStatus = 0
  let handledError = null
  try {
    if (request.method === "OPTIONS") {
      responseStatus = 204
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (!isIconoplasmPathHandledInsideTheOnlyAllowedStatefulWorker(path, request.method)) {
      responseStatus = 404
      return json({ error: "Not found" }, 404, { "Cache-Control": "no-store" })
    }

    meteredEnv = await wrapEnvWithIconoplasmD1DailyBudgetKillSwitch(env, request)

    if (
      path === "/health" ||
      path === "/api/health" ||
      path === "/admin" ||
      path === "/blocklist" ||
      path === "/blocklist/" ||
      path === "/artist-styles" ||
      path === "/artist-styles/"
    ) {
      const response =
        await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          request,
          meteredEnv,
          ctx,
        )
      responseStatus = response.status
      return response
    }

    if (isIconoplasmCanonRepairRequestForTheOnlyAllowedStatefulWorker(path, request.method)) {
      const payload = await parseJsonBody(request)
      const response = json(
        await repairCanonInvariants(meteredEnv, {
          limit: payload?.limit,
          actorId: payload?.actorId,
          reason: payload?.reason,
        }),
        200,
        { "Cache-Control": "no-store" },
      )
      responseStatus = response.status
      return response
    }

    if (
      isIconoplasmVoteProjectionRefreshRequestForTheOnlyAllowedStatefulWorker(path, request.method)
    ) {
      const payload = await parseJsonBody(request)
      const response = json(
        await processPendingVoteProjectionRefreshJobs(meteredEnv, {
          limit: payload?.limit,
        }),
        200,
        { "Cache-Control": "no-store" },
      )
      responseStatus = response.status
      return response
    }

    if (
      isIconoplasmSyncFinalizationProcessRequestForTheOnlyAllowedStatefulWorker(
        path,
        request.method,
      )
    ) {
      const payload = await parseJsonBody(request)
      const response = json(
        await processPendingSyncFinalizationJobs(meteredEnv, ctx, {
          limit: payload?.limit,
          symbols: payload?.symbols,
          finalizeIfDrained: coerceBoolean(
            payload?.finalize_if_drained ?? payload?.finalizeIfDrained,
            true,
          ),
        }),
        200,
        { "Cache-Control": "no-store" },
      )
      responseStatus = response.status
      return response
    }

    if (path === publicApiPath("/metadata")) {
      const response = await handlePublicMetadata(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/stats")) {
      const response = await handlePublicStats(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/catalog/manifest")) {
      const response = await handlePublicCatalogManifest(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (isPublicCatalogArtifactPath(path)) {
      const response = await handlePublicCatalogArtifact(meteredEnv, path)
      responseStatus = response.status
      return response
    }
    if (path.startsWith(publicApiPath("/dumps/catalog.")) && path.endsWith(".jsonl")) {
      const response =
        await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          request,
          meteredEnv,
          ctx,
        )
      responseStatus = response.status
      return response
    }
    if (path.startsWith("/portraits/")) {
      const response =
        await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          request,
          meteredEnv,
          ctx,
        )
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/gallery")) {
      const response = await handlePublicGallery(request, meteredEnv, ctx)
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/genes/search")) {
      const response = await handlePublicGeneSearch(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/genes/batch")) {
      const response = await handlePublicGeneBatch(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path === "/api/iconoplasm/mobile-card-manifest") {
      const response = await handleMobileCardManifest(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path.startsWith(publicApiPath("/genes/"))) {
      const deniedUrl = new URL(request.url)
      const response = json(publicRichRouteDeniedPayload(deniedUrl, "gene_detail"), 403, {
        "Cache-Control": "no-store",
      })
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/resolve")) {
      const response = await handlePublicResolve(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path === publicApiPath("/changes")) {
      const response = await handlePublicChanges(request, meteredEnv)
      responseStatus = response.status
      return response
    }
    if (path.startsWith(publicApiPath("/media/"))) {
      const rawSymbol = path.slice(publicApiPath("/media/").length)
      const response = await handlePublicMedia(request, meteredEnv, rawSymbol)
      responseStatus = response.status
      return response
    }
    if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) {
      const response = await handleSiteGeneDetail(request, meteredEnv, path)
      responseStatus = response.status
      return response
    }
    if (path.startsWith("/api/iconoplasm/")) {
      const headers = new Headers(request.headers)
      headers.set(ICONOPLASM_INTERNAL_STATEFUL_WORKER_REQUEST_HEADER_DO_NOT_DUPLICATE, "1")
      const internalRequest = new Request(request, { headers })
      const response =
        await handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          internalRequest,
          meteredEnv,
          ctx,
        )
      responseStatus = response.status
      return response
    }

    responseStatus = 404
    return json({ error: "Not found" }, 404, { "Cache-Control": "no-store" })
  } catch (error) {
    handledError = error
    if (error instanceof IconoplasmD1DailyBudgetExceededError) {
      responseStatus = 503
      return json(iconoplasmD1DailyBudgetExceededPayload(error.snapshot), 503, {
        "Cache-Control": "no-store",
      })
    }
    if (error instanceof IconoplasmD1DailyBudgetConfigurationError) {
      responseStatus = 500
      return json(iconoplasmD1DailyBudgetConfigurationPayload(error.message), 500, {
        "Cache-Control": "no-store",
      })
    }
    if (error instanceof IconoplasmAdminMutationLimiterActiveError) {
      responseStatus = 503
      return json(iconoplasmAdminMutationLimiterActivePayload(error.detail), 503, {
        "Cache-Control": "no-store",
      })
    }
    if (error instanceof IconoplasmUnclassifiedHandledRouteError) {
      responseStatus = 500
      return json(
        {
          error:
            "A handled Iconoplasm route is missing a named cost classification. Fix the route contract before using this endpoint.",
          code: "ICONOPLASM_ROUTE_CLASSIFICATION_MISSING",
          detail: String(error.message || ""),
        },
        500,
        { "Cache-Control": "no-store" },
      )
    }
    throw error
  } finally {
    await flushIconoplasmD1DailyBudgetUsageFromEnv(meteredEnv)
    const budgetState = meteredEnv?.[ICONOPLASM_D1_REQUEST_USAGE_STATE_DO_NOT_TOUCH] || null
    if (budgetState) {
      emitIconoplasmBudgetAttributionTelemetryFromState(meteredEnv, request, budgetState, {
        responseStatus,
        errorCode:
          handledError instanceof IconoplasmD1DailyBudgetExceededError
            ? "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED"
            : handledError instanceof IconoplasmAdminMutationLimiterActiveError
              ? "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE"
              : handledError instanceof IconoplasmD1DailyBudgetConfigurationError
                ? "ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_MISCONFIGURED"
                : handledError instanceof IconoplasmUnclassifiedHandledRouteError
                  ? "ICONOPLASM_ROUTE_CLASSIFICATION_MISSING"
                  : "",
        limiterDetail:
          handledError instanceof IconoplasmAdminMutationLimiterActiveError
            ? handledError.detail
            : null,
      })
    } else if (handledError instanceof IconoplasmAdminMutationLimiterActiveError) {
      emitIconoplasmBudgetAttributionTelemetryForLimiterRejection(
        meteredEnv,
        request,
        handledError.detail,
        {
          responseStatus,
        },
      )
    }
  }
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
  if (env.ICONOPLASM_PORTRAITS || canWriteExternalPortraitStorage(env)) {
    // Keep dumps alongside portraits under a separate prefix so public sync clients
    // get a stable immutable snapshot without us needing a brand new bucket.
    await putPortraitStorageObject(env, publicCatalogJsonlDumpKey(hash), catalogJsonl, {
      contentType: "application/x-ndjson; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable",
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

export async function handleIconoplasmApiRequestInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx,
) {
  const started = Date.now()
  const url = new URL(request.url)
  const path = url.pathname
  const internalGatewayRequest = isInternalRequestForTheOnlyAllowedStatefulWorker(request)
  const done = async (route, res, schema = null) => {
    const out = asHead(request, res)
    await logReq(
      route,
      request,
      out.status,
      started,
      schema,
      iconoplasmD1DailyBudgetUsageSnapshotFromEnv(env),
    )
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
      isIconoplasmPathHandledInsideTheOnlyAllowedStatefulWorker(path, request.method)
    ) {
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
      return done(
        "iconoplasm_api_only_allowed_stateful_worker",
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_metadata",
        new Response(response.body, { status: response.status, headers }),
        API_SCHEMA_VERSION,
      )
    }

    if (path === publicApiPath("/stats")) {
      const rl = rateLimit(request, "public_stats", 60)
      if (rl.retryAfterSeconds) {
        return done(
          "public_stats_rl",
          json(
            { error: "Rate limit exceeded", retry_after_seconds: rl.retryAfterSeconds },
            429,
            rl.headers,
          ),
          API_SCHEMA_VERSION,
        )
      }
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(rl.headers)) headers.set(key, value)
      return done(
        "public_stats",
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
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
      const key = path.replace(/^\/+/, "")
      const obj = await readPortraitStorageObject(env, key, { fallbackContentType: "image/webp" })
      if (!obj && !env.ICONOPLASM_PORTRAITS && !canReadExternalPortraitStorage(env)) {
        return done("portrait_no_binding", json({ error: "Portrait bucket not configured" }, 404))
      }
      if (!obj) return done("portrait_404", json({ error: "Portrait not found" }, 404))
      return done(
        "portrait",
        new Response(obj.body, {
          headers: {
            "Content-Type": obj.contentType || "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: `"${obj.etag || key}"`,
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
        return done("discoveries_me_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
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

    if (path === "/api/iconoplasm/account-gallery-window" && request.method === "GET") {
      if (!env.ICONOPLASM_DB) {
        return done(
          "account_gallery_window_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      }
      const requestedOrder = normalizeIconoplasmHomeOrder(url.searchParams.get("order"), "newest")
      if (!ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS.has(requestedOrder)) {
        return done(
          "account_gallery_window_order_409",
          json(
            {
              ok: false,
              code: "ORDER_INDEX_NOT_READY",
              error:
                "This order needs a per-user order index before it can be served as a bounded account gallery window.",
              order: requestedOrder,
              supported_orders: Array.from(ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS),
            },
            409,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "account_gallery_window_guest",
          json(
            {
              ok: true,
              schema: ACCOUNT_GALLERY_WINDOW_SCHEMA,
              authenticated: false,
              user: null,
              order: requestedOrder,
              vm_version: "",
              items: [],
              cards: [],
              missing: [],
              has_more: false,
              next_cursor: "",
              diagnostics: {
                d1_composed: 0,
                d1_window_rows: 0,
                artifact_version: "",
                artifact_gene_count: 0,
                catalog_gene_count: 0,
                artifact_validated_at: null,
                source: "published_card_catalog",
              },
            },
            200,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      const userId = normalizeUserId(sessionUser.user_id)
      await ensureStarterGeneDiscoveries(env, { userId })
      const cleanedLimit = Math.max(
        1,
        Math.min(
          ACCOUNT_GALLERY_WINDOW_LIMIT_MAX,
          Number.parseInt(String(url.searchParams.get("limit") || "24"), 10) || 24,
        ),
      )
      const windowData = await listUserGeneDiscoveryWindow(env, {
        userId,
        order: requestedOrder,
        limit: cleanedLimit,
        cursor: url.searchParams.get("cursor") || "",
      })
      const discoveredCount = await countUserGeneDiscoveries(env, { userId })
      const versionInfo = await currentMobileCardSnapshotVersion(env)
      const snapshotVersion = versionInfo.current
      const symbols = windowData.rows
        .map((row) => normalizeSymbol(row.gene_symbol || ""))
        .filter(Boolean)
      const artifact = await readPublishedCardCatalogArtifact(env, snapshotVersion, symbols)
      if (!artifact) {
        return done(
          "account_gallery_window_card_artifact_unavailable",
          json(cardArtifactUnavailablePayload(snapshotVersion), 503, {
            "Cache-Control": "no-store",
            "X-Iconoplasm-Data-Source": "artifact-unavailable",
            "X-Iconoplasm-Snapshot-State": "card-artifact-unavailable",
          }),
        )
      }
      const vmBySymbol = new Map()
      const missing = []
      for (const symbol of symbols) {
        const vm = artifact.bySymbol.get(symbol)
        if (vm) {
          vmBySymbol.set(symbol, vm)
        } else {
          missing.push(symbol)
        }
      }
      const cards = []
      const items = []
      for (const row of windowData.rows) {
        const symbol = normalizeSymbol(row.gene_symbol || "")
        const vm = vmBySymbol.get(symbol)
        if (vm) cards.push(vm)
        items.push({
          symbol,
          discovery: row,
        })
      }
      return done(
        "account_gallery_window",
        json(
          {
            ok: true,
            schema: ACCOUNT_GALLERY_WINDOW_SCHEMA,
            authenticated: true,
            user: {
              id: userId,
              username: sessionUser.username || null,
            },
            order: requestedOrder,
            discovered_count: discoveredCount,
            vm_version: snapshotVersion,
            items,
            cards,
            missing,
            has_more: !!windowData.hasMore,
            next_cursor: windowData.nextCursor || "",
            diagnostics: {
              d1_composed: 0,
              d1_window_rows: windowData.rows.length,
              requested_limit: cleanedLimit,
              artifact_version: artifact.artifact_version,
              artifact_gene_count: artifact.card_count,
              catalog_gene_count: artifact.catalog_gene_count,
              artifact_validated_at: artifact.artifact_validated_at,
              source: "published_card_catalog",
              supported_orders: Array.from(ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS),
            },
          },
          200,
          {
            "Cache-Control": "no-store",
            "X-Iconoplasm-VM-Version": snapshotVersion,
            "X-Iconoplasm-Data-Source": missing.length ? "mixed-or-missing" : "kv-snapshot",
          },
        ),
      )
    }

    if (path === "/api/iconoplasm/discoveries/merge" && request.method === "POST") {
      if (!env.ICONOPLASM_DB) {
        return done("discoveries_merge_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      }
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "discoveries_merge_401",
          json(
            {
              ok: false,
              code: "AUTH_REQUIRED",
              error: "Please log in first to merge guest discoveries.",
            },
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
          json(
            { ok: false, error: String(result.error || "Could not merge guest discoveries") },
            400,
            {
              "Cache-Control": "no-store",
            },
          ),
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

    const geneRequestSummaryMatch = path.match(
      /^\/api\/iconoplasm\/requests\/gene\/([^/]+)\/summary$/,
    )
    if (geneRequestSummaryMatch && request.method === "GET") {
      if (!env.ICONOPLASM_DB)
        return done(
          "gene_request_summary_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const symbol = normalizeSymbol(geneRequestSummaryMatch[1])
      if (!symbol) return done("gene_request_summary_400", json({ error: "Invalid symbol" }, 400))
      return done(
        "gene_request_summary",
        json(await generationRequestSummaryPayload(env, request, symbol), 200, {
          "Cache-Control": "no-store",
        }),
      )
    }

    if (path === "/api/iconoplasm/requests/options" && request.method === "GET") {
      if (!env.ICONOPLASM_DB)
        return done(
          "gene_request_options_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const payload = await generationRequestOptionsPayload(env, url, request)
      if (!payload.ok) {
        return done(
          "gene_request_options_401",
          json(
            {
              ok: false,
              code: payload.code || "AUTH_REQUIRED",
              error: payload.error || "Unauthorized",
            },
            payload.status || 401,
            {
              "Cache-Control": "no-store",
            },
          ),
        )
      }
      return done(
        "gene_request_options",
        json(payload, 200, {
          "Cache-Control": "no-store",
        }),
      )
    }

    const geneRequestLegacyMatch = path.match(/^\/api\/iconoplasm\/requests\/gene\/([^/]+)$/)
    if (geneRequestLegacyMatch && request.method === "GET") {
      // Chesterton fence: this old one-shot route used to mix summary state,
      // auth gating, and request-option hydration in one response. That shape is
      // exactly how the request picker drifted back into a hot-path cost hazard.
      // Do not resurrect it as a "convenient aggregate" route. The split
      // contract is the architecture now:
      //   GET /api/iconoplasm/requests/gene/:symbol/summary
      //   GET /api/iconoplasm/requests/options
      //   POST /api/iconoplasm/requests
      return done(
        "gene_request_state_gone_410",
        json(
          {
            ok: false,
            code: "LEGACY_GENE_REQUEST_ROUTE_REMOVED",
            error:
              "This legacy request-state route was removed. Use /api/iconoplasm/requests/gene/:symbol/summary plus /api/iconoplasm/requests/options instead.",
          },
          410,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/requests" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done(
          "create_generation_request_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "create_generation_request_401",
          json(
            {
              ok: false,
              code: "AUTH_REQUIRED",
              error: "Please log in first to request new candidates.",
            },
            401,
            {
              "Cache-Control": "no-store",
            },
          ),
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
        requestKind: p?.request_kind || p?.kind || "new_candidate",
        requestPrompt: p?.request_prompt || p?.prompt || "",
        sourceGeneSymbol:
          p?.source_gene_symbol || p?.source_symbol || p?.symbol || p?.gene_symbol || "",
        sourceAssetSha256: p?.source_asset_sha256 || p?.asset_sha256 || "",
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
        return done(
          "admin_requests_open_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
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
        return done(
          "admin_requests_fulfill_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
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
      return done("admin_requests_fulfill", json(result, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/api/iconoplasm/candidates/copy" && request.method === "POST") {
      if (!env.ICONOPLASM_DB)
        return done("candidate_copy_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      if (!iconoplasmVoteCoordinatorBinding(env))
        return done(
          "candidate_copy_500",
          json({ error: "ICONOPLASM_VOTE_COORDINATORS binding missing" }, 500),
        )
      const sessionUser = await iconoplasmSessionUser(request, env)
      if (!sessionUser?.user_id) {
        return done(
          "candidate_copy_401",
          json(
            {
              ok: false,
              code: "AUTH_REQUIRED",
              error: "Please log in first to copy a candidate blot.",
            },
            401,
            {
              "Cache-Control": "no-store",
            },
          ),
        )
      }
      let p
      try {
        p = await request.json()
      } catch {
        return done("candidate_copy_400", json({ error: "Invalid JSON" }, 400))
      }
      const userId = normalizeUserId(sessionUser.user_id)
      const copyResult = await copyPortraitCandidateToGene(env, {
        sourceGeneSymbol:
          p?.source_gene_symbol || p?.source_symbol || p?.symbol || p?.gene_symbol || "",
        targetGeneSymbol: p?.target_gene_symbol || p?.target_symbol || "",
        assetSha256: p?.asset_sha256 || p?.sha256 || "",
        actorId: userId,
      })
      if (!copyResult.ok) {
        return done(
          "candidate_copy_400",
          json(
            { ok: false, error: String(copyResult.error || "Could not copy candidate blot") },
            400,
            {
              "Cache-Control": "no-store",
            },
          ),
        )
      }
      const coordinatorWrite = await iconoplasmVoteCoordinatorSetVote(env, {
        symbol: copyResult.target_gene_symbol,
        assetSha256: copyResult.asset_sha256,
        visionId: copyResult.vision_id,
        candidateImageId: copyResult.candidate_image_id,
        userId,
        requestedVoteValue: 1,
      })
      if (!coordinatorWrite?.ok) {
        return done("candidate_copy_502", json({ error: "Vote coordinator write failed" }, 502))
      }
      const assetCandidateRef = voteAssetIdentity(
        copyResult.target_gene_symbol,
        copyResult.asset_sha256,
      )
      await projectVoteCoordinatorLedgerRow(env, {
        symbol: copyResult.target_gene_symbol,
        assetSha256: copyResult.asset_sha256,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      await appendVoteEvent(env, {
        symbol: copyResult.target_gene_symbol,
        assetSha256: copyResult.asset_sha256,
        visionId: coordinatorWrite.resolved_vision_id,
        candidateRef: assetCandidateRef,
        candidateImageId: coordinatorWrite.candidate_image_id,
        userId,
        voteValue: coordinatorWrite.final_vote_value,
      })
      const projectionRefresh = await scheduleVoteProjectionRefresh(env, ctx, {
        symbol: copyResult.target_gene_symbol,
        actorId: userId,
        reason: "candidate_copy_auto_checkmark",
      })
      return done(
        "candidate_copy",
        json(
          {
            ok: true,
            source_gene_symbol: copyResult.source_gene_symbol,
            target_gene_symbol: copyResult.target_gene_symbol,
            target_full_name: copyResult.target_full_name,
            asset_sha256: copyResult.asset_sha256,
            candidate_image_id: coordinatorWrite.candidate_image_id,
            target_url: `/gene/${encodeURIComponent(copyResult.target_gene_symbol)}`,
            vote: {
              candidate_ref: assetCandidateRef,
              vote_value: coordinatorWrite.final_vote_value,
            },
            auto_promote: {
              deferred: true,
              queued: Boolean(projectionRefresh?.queued),
            },
            message: `Copied to ${copyResult.target_gene_symbol} and checkmarked.`,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
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
      const projectionRefresh = await scheduleVoteProjectionRefresh(env, ctx, {
        symbol,
        actorId: userId,
        reason: "vote_auto_promote",
      })
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
            auto_promote: {
              deferred: true,
              queued: Boolean(projectionRefresh?.queued),
              mode: projectionRefresh?.mode || "best_effort",
            },
            projection_refresh: projectionRefresh,
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
      let projectionRefreshQueued = 0
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
        for (const row of Array.isArray(coordinatorImport?.results)
          ? coordinatorImport.results
          : []) {
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
        const projectionRefresh = await scheduleVoteProjectionRefresh(env, ctx, {
          symbol,
          actorId: "admin_import",
          reason: "vote_import_auto_promote",
        })
        if (projectionRefresh?.queued) projectionRefreshQueued += 1
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
            auto_promoted: null,
            projection_refresh_queued: projectionRefreshQueued,
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
      const projectionRefresh = await scheduleVoteProjectionRefresh(env, ctx, {
        symbol,
        actorId: userId,
        reason: "admin_vote_auto_promote",
      })
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
            auto_promote: {
              deferred: true,
              queued: Boolean(projectionRefresh?.queued),
              mode: projectionRefresh?.mode || "best_effort",
            },
            projection_refresh: projectionRefresh,
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
               gene_symbol > ?
               OR (
                 gene_symbol = ?
                 AND (
                   asset_sha256 > ?
                   OR (
                     asset_sha256 = ?
                     AND user_id > ?
                   )
                 )
               )
             )
           )
         )
         ORDER BY updated_at ASC, gene_symbol ASC, asset_sha256 ASC, user_id ASC
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
      path === "/api/iconoplasm/admin/votes/projection-refresh/pending" &&
      request.method === "GET"
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done(
          "admin_votes_projection_refresh_pending_403",
          json({ error: "Unauthorized" }, 403),
        )
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_votes_projection_refresh_pending_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      const limit = Math.max(
        1,
        Math.min(1000, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200),
      )
      const requests = await listPendingVoteProjectionRefreshJobs(env, { limit })
      return done(
        "admin_votes_projection_refresh_pending",
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
          json({ error: "Too many submissions. Try again in a minute." }, 429, {
            "Cache-Control": "no-store",
            ...rl.headers,
          }),
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
          json({ ok: true, queued: false, ignored: true }, 200, {
            "Cache-Control": "no-store",
            ...rl.headers,
          }),
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
          json({ error: "Artist tags cannot contain spaces. Example: @artist_(name)" }, 400, {
            ...rl.headers,
          }),
        )
      }
      const artistTagInput = normalizeArtistTag(artistNameInput)
      if (!artistTagInput || artistTagInput !== artistNameInput) {
        return done(
          "artist_blacklist_submission_400",
          json({ error: "Use the exact artist tag. Example: @artist_(name)" }, 400, {
            ...rl.headers,
          }),
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
      return done("blocklist_redirect", Response.redirect(redirectUrl.toString(), 308))
    }

    if (path === "/blocklist") {
      const artistStylesHtml = normalizeArtistStylesPageHtml(
        renderIconoplasmArtistStylesHtml({
          turnstileSiteKey: sanitizeText(env.ICONOPLASM_TURNSTILE_SITE_KEY || "", 255) || "",
        }),
      )
      return done("blocklist_page", html(artistStylesHtml, 200, { "Cache-Control": "no-store" }))
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
          json(
            { error: String(error?.message || error || "Artist tag blocklist update failed") },
            400,
          ),
        )
      }
    }

    if (
      path === "/api/iconoplasm/admin/artist-blacklist-submissions/pending" &&
      request.method === "GET"
    ) {
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

    if (
      path === "/api/iconoplasm/admin/artist-blacklist-submissions/ack" &&
      request.method === "POST"
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("artist_blacklist_submissions_ack_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "artist_blacklist_submissions_ack_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      let p
      try {
        p = await request.json()
      } catch {
        return done("artist_blacklist_submissions_ack_400", json({ error: "Invalid JSON" }, 400))
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

    if (path === "/api/iconoplasm/admin/finalization/pending" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_finalization_pending_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_finalization_pending_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      const limit = Math.max(
        1,
        Math.min(1000, Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200),
      )
      const scopedSymbols = normalizeSyncFinalizationJobSymbols(
        (() => {
          const raw = sanitizeText(url.searchParams.get("symbols") || "", 200000)
          if (!raw) return []
          try {
            const parsed = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return raw.split(",")
          }
        })(),
        { maxItems: 5000 },
      )
      const scopedSymbolsJson = JSON.stringify(scopedSymbols)
      const scopedEnabled = scopedSymbols.length > 0 ? 1 : 0
      const jobs = await listPendingSyncFinalizationJobs(env, { limit, symbols: scopedSymbols })
      const [
        queuedCount,
        runningCount,
        retryingCount,
        pendingFinalizeCount,
        unfinishedCount,
        completedCount,
        latestCompletedRow,
      ] = await Promise.all([
        countSyncFinalizationJobs(env, {
          whereSql: `status = ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [ICONOPLASM_SYNC_FINALIZATION_STATUS_QUEUED, scopedEnabled, scopedSymbolsJson],
        }),
        countSyncFinalizationJobs(env, {
          whereSql: `status = ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [ICONOPLASM_SYNC_FINALIZATION_STATUS_RUNNING, scopedEnabled, scopedSymbolsJson],
        }),
        countSyncFinalizationJobs(env, {
          whereSql: `status = ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [
            ICONOPLASM_SYNC_FINALIZATION_STATUS_RETRYING,
            scopedEnabled,
            scopedSymbolsJson,
          ],
        }),
        countSyncFinalizationJobs(env, {
          whereSql: `phase = ? AND status <> ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [
            ICONOPLASM_SYNC_FINALIZATION_PHASE_COMPLETED_PENDING_FINALIZE,
            ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
            scopedEnabled,
            scopedSymbolsJson,
          ],
        }),
        countSyncFinalizationJobs(env, {
          whereSql: `status <> ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [
            ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
            scopedEnabled,
            scopedSymbolsJson,
          ],
        }),
        countSyncFinalizationJobs(env, {
          whereSql: `status = ?
              AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))`,
          bindArgs: [
            ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED,
            scopedEnabled,
            scopedSymbolsJson,
          ],
        }),
        env.ICONOPLASM_DB.prepare(
          `SELECT MAX(completed_at) AS completed_at
             FROM icono_sync_finalization_jobs
             WHERE status = ?
               AND (? = 0 OR gene_symbol IN (SELECT value FROM json_each(?)))
               AND completed_at <> ''`,
        )
          .bind(ICONOPLASM_SYNC_FINALIZATION_STATUS_COMPLETED, scopedEnabled, scopedSymbolsJson)
          .first(),
      ])
      const latestCompletedAt = sanitizeText(latestCompletedRow?.completed_at || "", 64) || ""
      const governorStatus = await iconoplasmSyncGovernorJson(env, "/status", {})

      return done(
        "admin_finalization_pending",
        json(
          {
            ok: true,
            count: jobs.length,
            jobs,
            queue: {
              enabled: Boolean(iconoplasmSyncFinalizationQueueBinding(env)),
              disabled: iconoplasmSyncFinalizationQueueDisabled(env),
              disabled_reason: iconoplasmSyncFinalizationQueueDisabled(env)
                ? "cloudflare_queue_operations_budget_exhausted"
                : "",
              operations_daily_limit: ICONOPLASM_SYNC_FINALIZATION_QUEUE_FREE_DAILY_OPERATION_LIMIT,
              operations_usage_known: false,
              queued: queuedCount,
              in_flight: runningCount,
              completed: completedCount,
              retrying: retryingCount,
              dlq: null,
              active_consumers: Number(governorStatus?.governor?.active_consumers || 0) || 0,
              current_bottleneck: String(governorStatus?.governor?.current_bottleneck || "unknown"),
              target_utilization: Number(
                governorStatus?.governor?.target_utilization ||
                  ICONOPLASM_SYNC_GOVERNOR_TARGET_UTILIZATION,
              ),
              observed_utilization:
                Number(governorStatus?.governor?.observed_utilization || 0) || 0,
              public_health: String(governorStatus?.governor?.public_health || "unknown"),
            },
            summary: {
              queued: queuedCount,
              running: runningCount,
              retrying: retryingCount,
              pending_finalize: pendingFinalizeCount,
              completed: completedCount,
              unfinished: unfinishedCount,
              last_completed_at: latestCompletedAt,
              total_pending: unfinishedCount,
            },
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/finalization/enqueue" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_finalization_enqueue_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_finalization_enqueue_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p = {}
      try {
        p = await request.json()
      } catch {
        return done("admin_finalization_enqueue_400", json({ error: "Invalid JSON" }, 400))
      }

      const rows = Array.isArray(p?.rows) ? p.rows : Array.isArray(p?.jobs) ? p.jobs : []
      if (!rows.length)
        return done(
          "admin_finalization_enqueue_400",
          json({ error: "No finalization rows provided" }, 400),
        )
      if (rows.length > 5000)
        return done(
          "admin_finalization_enqueue_400",
          json({ error: "Too many finalization rows (max 5000)" }, 400),
        )

      const actorId = await actor(request, env)
      const reason =
        sanitizeText(p?.reason || "workstation_sync_finalization", 2000) ||
        "workstation_sync_finalization"
      const enqueueResult = await enqueueSyncFinalizationJobs(env, {
        rows,
        actorId,
        reason,
        runId: p?.run_id ?? p?.runId ?? reason,
      })

      if (coerceBoolean(p?.process_now ?? p?.processNow, false)) {
        return done(
          "admin_finalization_enqueue_process_now_410",
          json(
            {
              ok: false,
              code: "QUEUE_PATH_REQUIRED",
              error:
                "process_now is no longer supported. Iconoplasm finalization must run through the Cloudflare Queue drain path.",
            },
            410,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      if (!enqueueResult?.ok) {
        return done(
          "admin_finalization_enqueue_queue_required",
          json(
            {
              ...enqueueResult,
              mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
            },
            503,
            { "Cache-Control": "no-store" },
          ),
        )
      }

      return done(
        "admin_finalization_enqueue",
        json(
          {
            ok: true,
            queued: Number(enqueueResult?.queued || 0),
            queue_enabled: Boolean(enqueueResult?.queue_enabled),
            queue_messages: Number(enqueueResult?.queue_messages || 0),
            queue_send_failures: Number(enqueueResult?.queue_send_failures || 0),
            symbols: Array.isArray(enqueueResult?.symbols) ? enqueueResult.symbols : [],
            mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
            process: null,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/finalization/kick" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_finalization_kick_403", json({ error: "Unauthorized" }, 403))
      if (iconoplasmSyncFinalizationQueueDisabled(env)) {
        return done(
          "admin_finalization_kick_disabled",
          json(
            {
              ok: false,
              code: "QUEUE_PATH_DISABLED",
              error: "Iconoplasm finalization Queue path is disabled; refusing to fake progress.",
              disabled_reason: iconoplasmSyncFinalizationQueueDisabledReason(env),
            },
            503,
            { "Cache-Control": "no-store" },
          ),
        )
      }

      let p = {}
      try {
        p = await request.json()
      } catch {
        p = {}
      }
      const sentQueueMessage = await sendSyncFinalizationDrainQueueMessage(env, {
        runId: p?.run_id ?? p?.runId ?? p?.reason ?? "admin_finalization_kick",
        reason: p?.reason ?? "admin_finalization_kick",
        symbols: Array.isArray(p?.symbols) ? p.symbols : [],
      })
      if (!sentQueueMessage?.ok) {
        return done(
          "admin_finalization_kick_queue_required",
          json(
            {
              ok: false,
              code: sentQueueMessage?.code || "QUEUE_MESSAGE_REQUIRED",
              error:
                sentQueueMessage?.error ||
                "Iconoplasm finalization has one processing path: Cloudflare Queue drain messages. The worker could not enqueue a drain message.",
              queue_send_error: sentQueueMessage || null,
            },
            503,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      return done(
        "admin_finalization_kick",
        json(
          {
            ok: true,
            queue_enabled: true,
            queue_messages: 1,
            process: null,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/finalization/process" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_finalization_process_403", json({ error: "Unauthorized" }, 403))
      // This route intentionally remains as a loud tombstone. Reusing it as a
      // "temporary" processor is the crutch that caused the Queue bypass problem.
      return done(
        "admin_finalization_process_410",
        json(
          {
            ok: false,
            code: "QUEUE_PATH_REQUIRED",
            error:
              "Direct finalization processing is no longer supported. Iconoplasm finalization must run through the Cloudflare Queue drain path.",
          },
          410,
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
        ? (p.vision_ids ?? p.visionIds)
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
      const skipVoteSummaries = coerceBoolean(p?.skip_vote_summaries ?? p?.skipVoteSummaries, false)
      const skipGeneRollups = coerceBoolean(p?.skip_gene_rollups ?? p?.skipGeneRollups, false)
      const skipVisionRollups = coerceBoolean(p?.skip_vision_rollups ?? p?.skipVisionRollups, false)
      const skipDashboard = coerceBoolean(p?.skip_dashboard ?? p?.skipDashboard, false)
      const invalidateGallery = coerceBoolean(p?.invalidate_gallery ?? p?.invalidateGallery, true)

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
            partial: Boolean(result?.partial),
            stop_reason: sanitizeText(result?.stop_reason || "", 255) || null,
            deferred:
              result?.deferred && typeof result.deferred === "object"
                ? {
                    symbols: Math.max(0, Number(result?.deferred?.symbols || 0) || 0),
                    visions:
                      result?.deferred?.visions === null || result?.deferred?.visions === undefined
                        ? null
                        : Math.max(0, Number(result?.deferred?.visions || 0) || 0),
                    dashboard: Boolean(result?.deferred?.dashboard),
                  }
                : { symbols: 0, visions: 0, dashboard: false },
            budget: result?.budget || null,
            target_daily_percent:
              result?.target_daily_percent === null || result?.target_daily_percent === undefined
                ? null
                : Number(result.target_daily_percent || 0) || null,
            invalidate_gallery: invalidateGallery,
            full_vision: fullVision,
            full_rebuild: fullRebuild,
            skip_vote_summaries: skipVoteSummaries,
            skip_gene_rollups: skipGeneRollups,
            skip_vision_rollups: skipVisionRollups,
            skip_dashboard: skipDashboard,
            card_catalog:
              result?.card_catalog && typeof result.card_catalog === "object"
                ? {
                    artifact_version:
                      sanitizeText(result.card_catalog.artifact_version || "", 128) || null,
                    artifact_gene_count: Math.max(
                      0,
                      Number(result.card_catalog.artifact_gene_count || 0) || 0,
                    ),
                    catalog_gene_count: Math.max(
                      0,
                      Number(result.card_catalog.catalog_gene_count || 0) || 0,
                    ),
                    artifact_validated_at:
                      sanitizeText(result.card_catalog.artifact_validated_at || "", 64) || null,
                    source: "published_card_catalog",
                  }
                : null,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/card-vms/warm" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_card_vms_warm_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_card_vms_warm_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p = {}
      try {
        p = await request.json()
      } catch {
        return done("admin_card_vms_warm_400", json({ error: "Invalid JSON" }, 400))
      }

      const versionInfo = await currentMobileCardSnapshotVersion(env)
      const snapshotVersion =
        sanitizeText(p?.version || "", 128) === versionInfo.previous
          ? versionInfo.previous
          : versionInfo.current
      const scope = String(p?.scope || "")
        .trim()
        .toLowerCase()
      if (scope && scope !== "catalog") {
        return done(
          "admin_card_vms_warm_scope_409",
          json(
            {
              ok: false,
              code: "CARD_ARTIFACT_REQUIRES_FULL_CATALOG",
              error:
                "Card artifact publication has one valid scope: the full catalog. Symbol-scoped artifacts are not allowed because they make unrelated catalog genes look missing.",
              supported_scope: "catalog",
            },
            409,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      if (Array.isArray(p?.symbols) && p.symbols.length) {
        return done(
          "admin_card_vms_warm_symbols_409",
          json(
            {
              ok: false,
              code: "CARD_ARTIFACT_REQUIRES_FULL_CATALOG",
              error:
                "Card artifact publication has one valid scope: the full catalog. Symbol-scoped artifacts are not allowed because they make unrelated catalog genes look missing.",
              supported_scope: "catalog",
            },
            409,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      let publishResult
      try {
        publishResult = await publishCardCatalogArtifact(env, {
          version: snapshotVersion,
          requestUrl: request.url,
          symbols: null,
        })
      } catch (error) {
        return done(
          "admin_card_vms_warm_card_artifact_refused",
          json(
            {
              ok: false,
              code: CARD_ARTIFACT_UNAVAILABLE,
              error: sanitizeText(String(error?.message || error), 1000),
              version: snapshotVersion,
              scope: scope === "catalog" ? "catalog" : "symbols",
            },
            409,
            { "Cache-Control": "no-store" },
          ),
        )
      }
      return done(
        "admin_card_vms_warm",
        json(
          {
            ok: true,
            scope: "catalog",
            version: snapshotVersion,
            after: sanitizeText(p?.after || p?.cursor || "", 64) || "",
            next_cursor: "",
            done: true,
            requested: publishResult.catalog_gene_count,
            warmed: publishResult.artifact_gene_count,
            missing: 0,
            artifact_version: publishResult.artifact_version,
            artifact_gene_count: publishResult.artifact_gene_count,
            catalog_gene_count: publishResult.catalog_gene_count,
            artifact_validated_at: publishResult.artifact_validated_at,
            source: "published_card_catalog",
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

    if (path === "/api/iconoplasm/admin/mutation-limiter/policy" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_mutation_limiter_policy_403", json({ error: "Unauthorized" }, 403))
      return done(
        "admin_mutation_limiter_policy",
        json(
          {
            ok: true,
            mutation_limiter: await iconoplasmAdminMutationLimiterPolicyWithSnapshotFromEnv(env),
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/cost/usage" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_cost_usage_403", json({ error: "Unauthorized" }, 403))
      return done(
        "admin_cost_usage",
        json(
          {
            ok: true,
            code: "ICONOPLASM_CLOUDFLARE_OBSERVABILITY_REQUIRED",
            message:
              "Iconoplasm no longer exposes an internal request-path D1 usage report here. Use Cloudflare dashboard Durable Object and D1 analytics, or the GraphQL analytics API, for visibility.",
            observability: {
              source_of_truth: "cloudflare_dashboard_and_graphql",
              dashboard_surfaces: [
                "Cloudflare dashboard Durable Objects metrics",
                "Cloudflare dashboard D1 metrics",
              ],
              graphql_datasets: [
                "durableObjectsInvocationsAdaptiveGroups",
                "durableObjectsPeriodicGroups",
                "durableObjectsStorageGroups",
                "durableObjectsSubrequestsAdaptiveGroups",
              ],
            },
          },
          410,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/cost/snapshot" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_cost_snapshot_403", json({ error: "Unauthorized" }, 403))
      return done(
        "admin_cost_snapshot",
        json(
          {
            ok: true,
            snapshot: ICONOPLASM_OBSERVABILITY_SNAPSHOT,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    const geneRequestDiagnosticsMatch = path.match(
      /^\/api\/iconoplasm\/admin\/requests\/gene\/([^/]+)\/diagnostics$/,
    )
    if (geneRequestDiagnosticsMatch && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_gene_request_diagnostics_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_gene_request_diagnostics_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const symbol = normalizeSymbol(geneRequestDiagnosticsMatch[1])
      if (!symbol)
        return done("admin_gene_request_diagnostics_400", json({ error: "Invalid symbol" }, 400))
      const diagnostics = await generationRequestDiagnostics(env, url, request, symbol)
      return done(
        "admin_gene_request_diagnostics",
        json(diagnostics, 200, { "Cache-Control": "no-store" }),
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

    if (path === "/api/iconoplasm/admin/public-stats/audit" && request.method === "GET") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_public_stats_audit_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_public_stats_audit_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      const sampleLimit = Number.parseInt(url.searchParams.get("sample_limit") || "25", 10)
      const audit = await fetchAdminPublicStatsAudit(env, { sampleLimit })
      return done("admin_public_stats_audit", json(audit, 200, { "Cache-Control": "no-store" }))
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
                hero_url: adminPortraitUrl(base, currentResolvedAssetSha, "full"),
                medium_url: adminPortraitUrl(base, currentResolvedAssetSha, "medium"),
                thumb_url: adminPortraitUrl(base, currentResolvedAssetSha, "thumb"),
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
                hero_url: adminPortraitUrl(base, leaderAssetSha, "full"),
                medium_url: adminPortraitUrl(base, leaderAssetSha, "medium"),
                thumb_url: adminPortraitUrl(base, leaderAssetSha, "thumb"),
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
        whereParts.push("pa.gene_symbol=?")
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
             gene_symbol AS gene_symbol,
             asset_sha256 AS asset_sha256,
             SUM(CASE WHEN vote_value = 1 THEN 1 ELSE 0 END) AS upvotes,
             SUM(CASE WHEN vote_value = -1 THEN 1 ELSE 0 END) AS downvotes,
             SUM(vote_value) AS score
           FROM icono_image_votes
           GROUP BY gene_symbol, asset_sha256
         )
         SELECT
           pa.gene_symbol,
           pa.asset_sha256,
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
             WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
             ELSE 0
           END AS is_current,
           COALESCE(ps.admin_override, 0) AS admin_override,
           0 AS is_vote_leader
         FROM icono_portrait_assets pa
         LEFT JOIN vote_agg v
          ON v.gene_symbol = pa.gene_symbol
         AND v.asset_sha256 = pa.asset_sha256
         LEFT JOIN icono_publish_state ps
          ON ps.gene_symbol = pa.gene_symbol
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
        // Chesterton's fence: admin asset lists are part of the operator's
        // source of truth during cutover. If this route keeps echoing copied
        // storage keys, people will treat those keys as authoritative again
        // and reintroduce the exact blob-contract ambiguity B-430 is removing.
        hero_url: adminPortraitUrl(base, r?.asset_sha256, "full"),
        medium_url: adminPortraitUrl(base, r?.asset_sha256, "medium"),
        thumb_url: adminPortraitUrl(base, r?.asset_sha256, "thumb"),
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
      const summaryRow = await fetchAdminAssetSummaryCounts(env, { refresh: true })
      return done(
        "admin_assets_summary",
        json(
          {
            ok: true,
            candidate_assets: Number(summaryRow?.candidate_assets || 0),
            stale_assets: Number(summaryRow?.stale_assets || 0),
            legacy_assets: Number(summaryRow?.legacy_assets || 0),
            published_live_portraits: Number(summaryRow?.published_live_portraits || 0),
            audited_assets: Number(summaryRow?.audited_assets || 0),
            verified_renderable_images: Number(summaryRow?.verified_renderable_images || 0),
            storage_audit_coverage_percent: Number(summaryRow?.storage_audit_coverage_percent || 0),
            storage_incomplete_assets: Number(summaryRow?.storage_incomplete_assets || 0),
            broken_live_images: Number(summaryRow?.broken_live_images || 0),
            renderable_live_confirmed: Number(summaryRow?.renderable_live_confirmed || 0),
            unverified_live_portraits: Number(summaryRow?.unverified_live_portraits || 0),
            renderable_live_exact_known: Boolean(summaryRow?.renderable_live_exact_known),
            last_exact_audit_total:
              summaryRow?.last_exact_audit_total === null ||
              summaryRow?.last_exact_audit_total === undefined
                ? null
                : Number(summaryRow?.last_exact_audit_total || 0),
            last_exact_audit_at: sanitizeText(summaryRow?.last_exact_audit_at || "", 64) || null,
            storage_queue_backlog_assets: Number(summaryRow?.storage_queue_backlog_assets || 0),
            storage_queue_seeded_complete: Boolean(summaryRow?.storage_queue_seeded_complete),
            storage_audit_status_note:
              sanitizeText(summaryRow?.storage_audit_status_note || "", 2000) ||
              "Website storage truth has not been computed yet.",
            updated_at: sanitizeText(summaryRow?.updated_at || "", 64) || null,
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/assets/storage-audit" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_storage_audit_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_assets_storage_audit_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_assets_storage_audit_400", json({ error: "Invalid JSON" }, 400))
      }

      let requestedSymbols = []
      let limit = 100
      const mode = sanitizeText(p?.mode || "backlog-batch", 64).toLowerCase() || "backlog-batch"
      try {
        requestedSymbols = normalizeAdminAssetMaintenanceSymbols(p?.symbols, 5000)
        limit = normalizeAdminAssetMaintenanceLimit(p?.limit, 100, 500)
      } catch (error) {
        return done(
          "admin_assets_storage_audit_400",
          json({ error: String(error?.message || error || "Invalid storage audit scope") }, 400),
        )
      }

      const audit = await fetchAdminAssetStorageAudit(env, {
        requestedSymbols,
        limit,
      })

      return done(
        "admin_assets_storage_audit",
        json(
          {
            ok: true,
            mode,
            requested_symbols: requestedSymbols.length,
            count: Array.isArray(audit?.rows) ? audit.rows.length : 0,
            audited_assets: Number(audit?.summary?.audited_assets || 0),
            assets: Array.isArray(audit?.rows) ? audit.rows : [],
            summary: audit?.summary || {},
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (path === "/api/iconoplasm/admin/assets/repair-scope" && request.method === "POST") {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_repair_scope_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_assets_repair_scope_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )

      let p
      try {
        p = await request.json()
      } catch {
        return done("admin_assets_repair_scope_400", json({ error: "Invalid JSON" }, 400))
      }

      let requestedSymbols = []
      let limit = 50
      const mode = sanitizeText(p?.mode || "backlog-batch", 64).toLowerCase() || "backlog-batch"
      try {
        requestedSymbols = normalizeAdminAssetMaintenanceSymbols(p?.symbols, 5000)
        limit = normalizeAdminAssetMaintenanceLimit(p?.limit, 50, 250)
      } catch (error) {
        return done(
          "admin_assets_repair_scope_400",
          json({ error: String(error?.message || error || "Invalid repair scope") }, 400),
        )
      }

      const repairScope = await fetchAdminAssetRepairScope(env, {
        requestedSymbols,
        limit,
      })

      return done(
        "admin_assets_repair_scope",
        json(
          {
            ok: true,
            mode,
            requested_symbols: requestedSymbols.length,
            scanned_assets: Number(repairScope?.scanned_assets || 0),
            count: Array.isArray(repairScope?.rows) ? repairScope.rows.length : 0,
            assets: Array.isArray(repairScope?.rows) ? repairScope.rows : [],
            summary: repairScope?.summary || {},
          },
          200,
          { "Cache-Control": "no-store" },
        ),
      )
    }

    if (
      path === "/api/iconoplasm/admin/assets/state" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_assets_state_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done("admin_assets_state_500", json({ error: "ICONOPLASM_DB binding missing" }, 500))
      let requestedSymbols = null
      if (request.method === "POST") {
        let p
        try {
          p = await request.json()
        } catch {
          return done("admin_assets_state_400", json({ error: "Invalid JSON" }, 400))
        }
        const rawSymbols = Array.isArray(p?.symbols) ? p.symbols : []
        if (rawSymbols.length > 25000)
          return done(
            "admin_assets_state_400",
            json({ error: "Too many symbols (max 25000)" }, 400),
          )
        requestedSymbols = rawSymbols
      }
      const assets = (await fetchAssetStateRows(env, requestedSymbols))
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

    if (
      path === "/api/iconoplasm/admin/catalog/state" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      if (!(await isIconoplasmAdmin(request, env)))
        return done("admin_catalog_state_403", json({ error: "Unauthorized" }, 403))
      if (!env.ICONOPLASM_DB)
        return done(
          "admin_catalog_state_500",
          json({ error: "ICONOPLASM_DB binding missing" }, 500),
        )
      if (request.method === "POST") {
        let p
        try {
          p = await request.json()
        } catch {
          return done("admin_catalog_state_400", json({ error: "Invalid JSON" }, 400))
        }
        const rawSymbols = Array.isArray(p?.symbols) ? p.symbols : []
        if (rawSymbols.length > 25000)
          return done(
            "admin_catalog_state_400",
            json({ error: "Too many symbols (max 25000)" }, 400),
          )
        const rows = await fetchCatalogStateRows(env, rawSymbols.length ? rawSymbols : null)
        return done(
          "admin_catalog_state",
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
      const deferReadModels = coerceBoolean(p?.defer_read_models ?? p?.deferReadModels, false)
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
            mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
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
      const deleteSymbolsRaw = Array.isArray(p?.delete_symbols) ? p.delete_symbols : []
      const deferReadModels = coerceBoolean(p?.defer_read_models ?? p?.deferReadModels, false)
      if (keepSymbolsRaw.length > 25000)
        return done(
          "admin_catalog_reconcile_400",
          json({ error: "Too many keep_symbols (max 25000)" }, 400),
        )
      if (deleteSymbolsRaw.length > 25000)
        return done(
          "admin_catalog_reconcile_400",
          json({ error: "Too many delete_symbols (max 25000)" }, 400),
        )
      const keepSymbols = new Set(
        keepSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean),
      )
      const explicitDeleteSymbols = Array.from(
        new Set(deleteSymbolsRaw.map((value) => normalizeSymbol(value)).filter(Boolean)),
      )
      if (!keepSymbols.size && !explicitDeleteSymbols.length)
        return done(
          "admin_catalog_reconcile_400",
          json({ error: "No keep_symbols or delete_symbols provided" }, 400),
        )

      let toDelete = explicitDeleteSymbols
      if (keepSymbols.size) {
        const currentRows = await env.ICONOPLASM_DB.prepare(
          "SELECT gene_symbol FROM icono_gene_catalog",
        ).all()
        const currentSymbols = Array.isArray(currentRows?.results) ? currentRows.results : []
        toDelete = currentSymbols
          .map((row) => normalizeSymbol(row?.gene_symbol || ""))
          .filter((symbol) => symbol && !keepSymbols.has(symbol))
      }

      for (const symbol of toDelete) {
        await env.ICONOPLASM_DB.prepare("DELETE FROM icono_gene_catalog WHERE gene_symbol=?")
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
            mode: keepSymbols.size ? "keep_symbols" : "delete_symbols",
            defer_read_models: deferReadModels,
            mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
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
            mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
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
      if (!env.ICONOPLASM_PORTRAITS && !canWriteExternalPortraitStorage(env))
        return done(
          "admin_ingest_500",
          json({ error: "Portrait storage backend is not configured" }, 500),
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
      const deferReadModels = coerceBoolean(p?.defer_read_models ?? p?.deferReadModels, false)
      const verifyStorageDefault = coerceBoolean(p?.verify_storage ?? p?.verifyStorage, false)
      const forceUploadDefault = coerceBoolean(p?.force_upload ?? p?.forceUpload, false)
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
      const binaryUploadLikelyItemCount = itemsRaw.filter((rawItem) => {
        const item = rawItem && typeof rawItem === "object" ? rawItem : {}
        if (coerceBoolean(item?.force_upload ?? item?.forceUpload, false)) return true
        return !coerceBoolean(item?.remote_known, false)
      }).length
      // B-437 / live GUI sync hardening: each binary item can fan out into
      // full/medium/thumb portrait PUTs. Cloudflare Workers allow only a small
      // number of simultaneous outgoing connections per request, so keep one
      // request to at most two binary assets and let the workstation feed more
      // Worker invocations concurrently instead.
      const ingestConcurrency = dryRun ? 8 : binaryUploadLikelyItemCount > 0 ? 2 : 1

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
          const verifyStorage = coerceBoolean(
            item?.verify_storage ?? item?.verifyStorage,
            verifyStorageDefault,
          )
          const forceUpload = coerceBoolean(
            item?.force_upload ?? item?.forceUpload,
            forceUploadDefault,
          )
          // optimize/harden: repeated syncs should not re-probe and re-require
          // binary renditions for assets the website already knows about.
          // But repair runs need an escape hatch because production can have D1
          // rows whose portrait keys survived while the backing Bunny objects
          // vanished during an interrupted cutover or partial upload failure.
          // In that mode, trust real storage HEADs over "the row has keys".
          // And when operators already know the storage layer is empty or stale,
          // force-upload lets them overwrite the canonical sha-key paths without
          // spending the request budget proving those missing blobs are missing.
          const storedRenditionsPresent =
            Boolean(existingAsset?.r2_key_full) &&
            Boolean(existingAsset?.r2_key_medium) &&
            Boolean(existingAsset?.r2_key_thumb)
          const isNewAsset = !existingAsset
          let exists = {
            full: !forceUpload && !isNewAsset && storedRenditionsPresent && !verifyStorage,
            medium: !forceUpload && !isNewAsset && storedRenditionsPresent && !verifyStorage,
            thumb: !forceUpload && !isNewAsset && storedRenditionsPresent && !verifyStorage,
          }
          let fullPayload = null
          let mediumPayload = null
          let thumbPayload = null
          let fullBytes = null
          let mediumBytes = null
          let thumbBytes = null
          let uploadedAny = false
          if (!forceUpload && !isNewAsset && (!storedRenditionsPresent || verifyStorage)) {
            // Brand-new assets cannot already exist in portrait storage under
            // this sha-key contract. Skipping pointless HEAD probes here keeps
            // bulk backfills under the Worker subrequest ceiling.
            const [headFull, headMedium, headThumb] = await Promise.all([
              headPortraitStorageObject(env, keys.full),
              headPortraitStorageObject(env, keys.medium),
              headPortraitStorageObject(env, keys.thumb),
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
                putPortraitStorageObject(env, keys.full, fullBytes, {
                  contentType: "image/webp",
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
                putPortraitStorageObject(env, keys.medium, mediumBytes, {
                  contentType: "image/webp",
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
                putPortraitStorageObject(env, keys.thumb, thumbBytes, {
                  contentType: "image/webp",
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
              uploadedAny = true
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

            // Keep the durable storage truth in step with successful repair or
            // verification work. The whole point of the queue redesign is to
            // stop re-discovering image truth with fresh Bunny HEAD storms on
            // every admin request.
            if (finalStatus !== "rejected" && (verifyStorage || forceUpload || uploadedAny)) {
              await recordStorageAuditRenderableAsset(env, {
                symbol,
                assetSha256: assetSha,
                status: finalStatus,
                isStale: persistedIsStale,
                isLegacy: false,
                isCurrent:
                  coerceBoolean(item?.is_current ?? item?.isCurrent, false) ||
                  Number(existingAsset?.is_current || 0) > 0,
                createdAt: existingAsset?.created_at || "",
              })
            }
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
            mutation_limiter: iconoplasmAdminMutationLimiterSnapshotFromEnv(env),
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
        ? (p.scope_symbols ?? p.scopeSymbols)
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
      const deferReadModels = coerceBoolean(p?.defer_read_models ?? p?.deferReadModels, false)
      const unpublishMissing = coerceBoolean(p?.unpublish_missing ?? p?.unpublishMissing, false)
      const actorId = await actor(request, env)
      const reason = String(p?.reason || "").slice(0, 2000) || "local_sync_reconcile"

      const { results: existingAssets = [] } = await env.ICONOPLASM_DB.prepare(
        `WITH incoming_scope AS (
           SELECT value AS gene_symbol
           FROM json_each(?)
         )
         SELECT gene_symbol, asset_sha256, status, COALESCE(is_stale, 0) AS is_stale, COALESCE(is_legacy, 0) AS is_legacy
         FROM icono_portrait_assets
         WHERE (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM incoming_scope))`,
      )
        .bind(scopeSymbolsJson, applyScope)
        .all()

      const { results: existingStateRows = [] } = await env.ICONOPLASM_DB.prepare(
        `WITH incoming_scope AS (
           SELECT value AS gene_symbol
           FROM json_each(?)
         )
         SELECT gene_symbol, current_asset_sha256, COALESCE(admin_override, 0) AS admin_override
         FROM icono_publish_state
         WHERE (? = 0 OR gene_symbol IN (SELECT gene_symbol FROM incoming_scope))`,
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
      const touchedSymbols = new Set(
        scopeSymbols.length ? scopeSymbols : keep.map((row) => row.symbol),
      )

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
            status === "rejected" ||
            Number(row?.is_stale || 0) > 0 ||
            Number(row?.is_legacy || 0) > 0
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
            "UPDATE icono_portrait_assets SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END, autopick_eligible=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 1 ELSE COALESCE(autopick_eligible, 1) END, is_stale=0, is_legacy=0 WHERE gene_symbol=? AND asset_sha256=?",
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
            "UPDATE icono_portrait_assets SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END, is_stale=1, is_legacy=1 WHERE gene_symbol=? AND asset_sha256=?",
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
          "UPDATE icono_portrait_assets SET status='rejected', is_stale=0, is_legacy=0 WHERE gene_symbol=? AND asset_sha256=?",
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
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
          `SELECT gene_symbol, asset_sha256
             FROM icono_portrait_assets
            WHERE gene_symbol IN (${placeholders})
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
            json({
              ok: true,
              action: "unstale_batch",
              touched_symbols: 0,
              unstaled_assets: 0,
              symbols,
            }),
          )
        }

        // The gallery narrows work with search/filter controls, so the batch
        // route restores every stale asset for that visible gene slice in one go.
        await env.ICONOPLASM_DB.prepare(
          `UPDATE icono_portrait_assets
              SET is_stale = 0,
                  is_legacy = 0
            WHERE gene_symbol IN (${placeholders})
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
            ).bind(
              symbolValue,
              assetValue,
              assetValue,
              actorId,
              String(p?.reason || "").slice(0, 2000) || null,
            )
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
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
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
          "UPDATE icono_portrait_assets SET status='approved' WHERE gene_symbol=? AND asset_sha256=?",
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
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
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
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const currentAssetSha = normalizeSha256(current?.current_asset_sha256 || "")
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET status='rejected', is_stale=0, is_legacy=0 WHERE gene_symbol=? AND asset_sha256=?",
        )
          .bind(symbol, asset)
          .run()
        if (currentAssetSha && currentAssetSha === normalizeSha256(asset)) {
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=0, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
          json({
            ok: true,
            action: "reject",
            symbol,
            asset_sha256: asset,
            auto_promote: autoPromote,
          }),
        )
      }

      if (path.endsWith("/unpublish")) {
        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const from = current?.current_asset_sha256 || null
        if (!from) return done("unpublish_400", json({ error: "No published state to clear" }, 400))
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
          "SELECT COALESCE(is_stale, 0) AS is_stale, COALESCE(is_legacy, 0) AS is_legacy FROM icono_portrait_assets WHERE gene_symbol=? AND asset_sha256=? LIMIT 1",
        )
          .bind(symbol, asset)
          .first()
        if (!existing) return done("unstale_404", json({ error: "Asset not found" }, 404))
        await env.ICONOPLASM_DB.prepare(
          "UPDATE icono_portrait_assets SET is_stale=0, is_legacy=0 WHERE gene_symbol=? AND asset_sha256=?",
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
          json({
            ok: true,
            action: "unstale",
            symbol,
            asset_sha256: asset,
            auto_promote: autoPromote,
          }),
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
           WHERE gene_symbol=? AND asset_sha256=?
           LIMIT 1`,
        )
          .bind(symbol, asset)
          .first()
        if (!existing) return done("purge_legacy_404", json({ error: "Asset not found" }, 404))
        if (Number(existing?.is_legacy || 0) <= 0)
          return done("purge_legacy_400", json({ error: "Asset is not marked legacy" }, 400))

        const current = await env.ICONOPLASM_DB.prepare(
          "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
        )
          .bind(symbol)
          .first()
        const from = normalizeSha256(current?.current_asset_sha256 || "")
        const isCurrent = !!(from && from === normalizeSha256(asset))
        if (isCurrent) {
          await env.ICONOPLASM_DB.prepare(
            "UPDATE icono_publish_state SET current_asset_sha256=NULL, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
          "DELETE FROM icono_image_votes WHERE gene_symbol=? AND asset_sha256=?",
        )
          .bind(symbol, normalizeSha256(asset))
          .run()
        await env.ICONOPLASM_DB.prepare(
          "DELETE FROM icono_portrait_assets WHERE gene_symbol=? AND asset_sha256=?",
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
        for (const key of keys) {
          await deletePortraitStorageObject(env, key)
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
          return done("remove_candidate_404", json({ error: "Asset not found" }, 404))
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
        "SELECT current_asset_sha256 FROM icono_publish_state WHERE gene_symbol=? LIMIT 1",
      )
        .bind(symbol)
        .first()
      const from = current?.current_asset_sha256 || null
      if (!from)
        return done("rollback_400", json({ error: "No published state to roll back" }, 400))
      let target = String(p?.target_asset_sha256 || "").trim() || null
      if (!target) {
        const prev = await env.ICONOPLASM_DB.prepare(
          "SELECT to_asset_sha256 FROM icono_publish_events WHERE gene_symbol=? AND action='publish' AND to_asset_sha256 IS NOT NULL AND to_asset_sha256 != ? ORDER BY id DESC LIMIT 1",
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
        "UPDATE icono_publish_state SET current_asset_sha256=?, admin_override=1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE gene_symbol=?",
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
    if (
      e instanceof IconoplasmD1DailyBudgetExceededError ||
      e instanceof IconoplasmD1DailyBudgetConfigurationError ||
      e instanceof IconoplasmAdminMutationLimiterActiveError ||
      e instanceof IconoplasmUnclassifiedHandledRouteError
    ) {
      throw e
    }
    console.error("[Iconoplasm] Unhandled request error:", e)
    const adminToken = String(env?.ICONOPLASM_ADMIN_TOKEN || "").trim()
    const requestAdminToken = String(request.headers.get("X-Iconoplasm-Admin-Token") || "").trim()
    const adminErrorDetail =
      adminToken && requestAdminToken && requestAdminToken === adminToken
        ? {
            code: "ICONOPLASM_ADMIN_UNHANDLED_ERROR",
            detail: String(e?.message || e || "Internal server error").slice(0, 2000),
          }
        : {}
    const out = json({ error: "Internal server error", ...adminErrorDetail }, 500)
    await logReq("error", request, 500, started, null)
    return asHead(request, out)
  }
}
