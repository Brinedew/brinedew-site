import { withErrorReporting, withScheduledErrorReporting } from "./lib/the-only-error-reporter.js"
import { iconoplasmPageTitle } from "../quartz/static/iconoplasm/page-title.js"
import { matchIconoplasmRouteContract } from "./iconoplasm-route-contract.js"
import {
  enforceIconoplasmRateLimit,
  withIconoplasmRateLimitHeaders,
} from "./iconoplasm-rate-limit.js"
import {
  ackCompletedResult,
  getPendingResults,
  storeGameState,
} from "./lib/the-only-geneguessr-completed-result-ledger-do-not-duplicate.js"

// CORS headers for frontend access - supports both main domain and subdomain
function getCorsHeaders(origin, requestHost = "") {
  const allowedOrigins = [
    "https://brinedew.bio",
    "https://geneguessr.brinedew.bio",
    "https://iconoplasm.brinedew.bio",
  ]
  const stagingOrigins = [
    "https://staging.brinedew.bio",
    "https://brinedew-bio-staging.pages.dev",
    "https://staging.brinedew-bio.pages.dev",
  ]
  const lowerHost = String(requestHost || "").toLowerCase()
  const lowerOrigin = String(origin || "").toLowerCase()
  const isWorkersDev = lowerHost.endsWith(".workers.dev")
  const isLocalHost =
    lowerHost === "localhost" || lowerHost === "127.0.0.1" || lowerHost === "0.0.0.0"
  const isLocalOrigin =
    lowerOrigin.startsWith("http://localhost") ||
    lowerOrigin.startsWith("http://127.0.0.1") ||
    lowerOrigin.startsWith("http://0.0.0.0")

  // Allow localhost origins only when we're running on localhost (wrangler dev)
  // or on a workers.dev hostname (staging/dev). Do NOT allow localhost origins on prod custom domains.
  const allowLocalOrigin = isLocalOrigin && (isLocalHost || isWorkersDev)
  const corsOrigin =
    allowedOrigins.includes(origin) ||
    (isWorkersDev && stagingOrigins.includes(origin)) ||
    allowLocalOrigin
      ? origin
      : "https://brinedew.bio"
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  }
}

// Backward compatibility - default CORS headers for main domain
const JSON_HEADERS = { "Content-Type": "application/json" }
const DAILY_TARGET_SALT = "geneguessr-v2-939b5a0b"
const DAILY_BOOTSTRAP_CACHE_PREFIX = "daily_bootstrap:"

const GENEGUESSR_HOST = "geneguessr.brinedew.bio"
const BENCHMARK_HOST = "geneguessr-bench.brinedew.bio"
const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const STATIC_SITE_ORIGIN_PROD = "https://brinedew-bio.pages.dev"
const STATIC_SITE_ORIGIN_STAGING = "https://brinedew-bio-staging.pages.dev"
// One owner only. The 00:03 trigger belongs to GeneGuessr recap delivery and
// must not silently repeat Iconoplasm's full maintenance eight minutes later.
const KATEX_VENDOR_PREFIX = "/static/vendor/katex/"
const KATEX_VENDOR_VERSION = "0.16.21"

const ANALYTICS_CONSENT_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
])

function requestCountryCode(request) {
  return String(request.headers.get("CF-IPCountry") || request.cf?.country || "").toUpperCase()
}

function requestRequiresAnalyticsConsent(request) {
  return ANALYTICS_CONSENT_COUNTRIES.has(requestCountryCode(request))
}

function shouldShowAnalyticsConsentPrompt(request) {
  try {
    const host = new URL(request.url).hostname
    return (
      isProductionBrinedewHtmlHost(host) &&
      requestRequiresAnalyticsConsent(request) &&
      !requestHasAnalyticsConsent(request)
    )
  } catch {
    return false
  }
}

function injectAnalyticsConsentBootstrap(html, request) {
  if (!html || !shouldShowAnalyticsConsentPrompt(request)) return html
  const bootstrap = "<script>window.__brinedewAnalyticsConsentRequired=true</script>"
  return String(html).replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
}

function iconoplasmGeneNotFoundResponse(method) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow,noarchive"><title>${iconoplasmPageTitle("Gene not found")}</title></head><body><main><h1>Gene not found</h1><p>This symbol is not in the published Iconoplasm catalog.</p><p><a href="/">Iconoplasm gene character archive</a></p></main></body></html>`
  return new Response(method === "HEAD" ? null : html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, follow, noarchive",
    },
  })
}

function buildPublicSubdomainRobotsTxt(host) {
  // ARCHITECTURE FENCE [IPD-003]: the crawl frontier exists for search and
  // user-directed retrieval, not unlimited model-training ingestion. The WAF
  // enforces this before Worker execution; robots.txt mirrors the same intent
  // for cooperative crawlers while preserving OAI/Claude/Perplexity search.
  return `# robots.txt for ${host}
#
# Notes:
# - Non-standard directives are not valid robots.txt and break parsers.
# - Google ignores crawler-rate fields here, so keep rate control outside robots.txt.

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: OAI-SearchBot
Allow: /
Disallow: /api/

User-agent: ChatGPT-User
Allow: /
Disallow: /api/

User-agent: Claude-SearchBot
Allow: /
Disallow: /api/

User-agent: Claude-User
Allow: /
Disallow: /api/

User-agent: PerplexityBot
Allow: /
Disallow: /api/

User-agent: Perplexity-User
Allow: /
Disallow: /api/

User-agent: *
Allow: /
Disallow: /api/

User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: BLEXBot
Disallow: /

User-agent: DataForSeoBot
Disallow: /

Sitemap: https://${host}/sitemap.xml
`
}

function buildGeneguessrSubdomainRobotsTxt() {
  return buildPublicSubdomainRobotsTxt(GENEGUESSR_HOST)
}

async function runScheduledIconoplasmMaintenanceStep(env, ctx, path, body) {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`https://geneguessr-api/__internal/iconoplasm/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    )
  const result = await response.json()
  if (!response.ok || result?.ok === false)
    throw new Error(
      `Scheduled ${path} failed: ${response.status} ${result.code || result.error || "unknown"}`,
    )
  return result
}

async function runScheduledIconoplasmFulfillment(env) {
  const delivery = await deliverPendingRequestFulfillmentNotifications(env, { limit: 1 })
  const requestIds = delivery.delivered_request_ids || []
  let finalized = 0
  for (let offset = 0; offset < requestIds.length; offset += 50) {
    const settled = await reconcileDeliveredRequestFulfillments(env, {
      requestIds: requestIds.slice(offset, offset + 50),
    })
    finalized += settled.finalized
  }
  const recovery = await reconcileDeliveredRequestFulfillments(env)
  return { ...delivery, finalized: finalized + recovery.finalized }
}
function stableSitemapDate() {
  // Keep `lastmod` stable within a day to avoid thrashing crawlers with a constantly-changing sitemap.
  return new Date().toISOString().slice(0, 10)
}

function buildSubdomainSitemapXml(entries) {
  const now = stableSitemapDate()
  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${entry.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

function buildGeneguessrSubdomainSitemapXml() {
  return buildSubdomainSitemapXml([
    { loc: `https://${GENEGUESSR_HOST}/`, changefreq: "daily", priority: "1.0" },
    { loc: `https://${GENEGUESSR_HOST}/privacy`, changefreq: "monthly", priority: "0.3" },
  ])
}

function buildGeneguessrSubdomainLlmsTxt() {
  return `# GeneGuessr

GeneGuessr is a daily protein guessing game. Players infer the target gene from a protein structure, biological hints, similarity feedback, domains, pathways, and molecular-function clues.

## Core links

- [GeneGuessr](https://${GENEGUESSR_HOST}/): Daily protein guessing game
- [Privacy Policy](https://${GENEGUESSR_HOST}/privacy): Data handling for gameplay and login
- [Sitemap](https://${GENEGUESSR_HOST}/sitemap.xml): Crawlable GeneGuessr URLs
`
}

function replaceOrInsertHeadMarkup(html, pattern, replacement) {
  const source = String(html || "")
  if (pattern.test(source)) return source.replace(pattern, replacement)
  return source.replace(/<\/head>/i, `${replacement}\n</head>`)
}

function rewritePrivacyCanonicalMetadata(html, host) {
  const privacyUrl = `https://${host}/privacy`
  let next = String(html || "")
  next = replaceOrInsertHeadMarkup(
    next,
    /<link\b[^>]*\brel=["']canonical["'][^>]*>/i,
    `<link rel="canonical" href="${privacyUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/i,
    `<meta property="og:url" content="${privacyUrl}">`,
  )
  next = replaceOrInsertHeadMarkup(
    next,
    /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/i,
    `<meta name="twitter:url" content="${privacyUrl}">`,
  )
  return next
}

function resolveStaticSiteOrigin(hostname) {
  const host = String(hostname || "").toLowerCase()
  if (
    host === "staging.brinedew.bio" ||
    host.endsWith(".workers.dev") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0"
  ) {
    return STATIC_SITE_ORIGIN_STAGING
  }
  return STATIC_SITE_ORIGIN_PROD
}

function buildStaticSiteUrl(url, pathOverride = null) {
  const targetPath = pathOverride ?? url.pathname
  const upstreamUrl = new URL(targetPath, resolveStaticSiteOrigin(url.hostname))
  upstreamUrl.search = url.search
  return upstreamUrl
}

function canonicalGeneguessrSubdomainPath(pathname) {
  if (
    pathname === "/apps/geneguessr" ||
    pathname === "/apps/geneguessr/" ||
    pathname === "/apps/geneguessr/index" ||
    pathname === "/apps/geneguessr/index/"
  ) {
    return "/"
  }

  if (pathname === "/apps/geneguessr/privacy" || pathname === "/apps/geneguessr/privacy/") {
    return "/privacy"
  }

  return ""
}

function redirectToGeneguessrCanonicalHost(url, targetPath) {
  const targetUrl = new URL(`https://${GENEGUESSR_HOST}${targetPath}`)
  targetUrl.search = url.search
  return Response.redirect(targetUrl.toString(), 301)
}

// Similarity configuration
// SIMILARITY_MODE: 'legacy' (HiG2Vec only), 'blended' (HiG2Vec + ESM2)
// ESM2_WEIGHT: 0-1, how much to weight ESM2 structural similarity (0.5 = equal blend)
const SIMILARITY_MODE = "blended"
const ESM2_WEIGHT = 0.25

// Import auth handlers
import {
  getDiscordAuthConfigStatus,
  handleLogin,
  handleCallback,
  handleMe,
  handleLogout,
  resolveDiscordSessionAuthorization,
} from "./auth.js"
// Import Iconoplasm stateful handlers
import {
  isIconoplasmRequest,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
  drainIconoplasmAuthorityAccountProjection,
  drainIconoplasmManifestationAuthorityProjection,
  handleIconoplasmQueue,
  publishSharedGeneDiscoverySymbols,
  publishRequestPickerObject,
  rebuildDirtyVisionRollups,
  drainIconoplasmSharedDiscoveryDeliveriesForScheduled,
  migrateIconoplasmCompactDiscoveryForScheduled,
  publishIconoplasmGeneStableObject,
  refreshIconoplasmRegisteredGeneSummaries,
  recoverDueIconoplasmGeneCardMaterializationsForScheduled,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createIconoplasmApp } from "./iconoplasm/app.js"
import { createOperationCostAccountUsageReader } from "./iconoplasm/operation-cost-account-usage.js"
import {
  deliverPendingRequestFulfillmentNotifications,
  reconcileDeliveredRequestFulfillments,
} from "./iconoplasm-request-notifications.js"
import {
  deliverPendingCaretakerCommentNotifications,
  deliverPendingCaretakerSupervoteNotifications,
} from "./iconoplasm-caretaker-comment-notifications.js"
import { reconcileIconoplasmRecognitionPolicies } from "./iconoplasm-recognition-policy-reconciliation.js"
import { archiveColdIconoplasmPublishEvents } from "./iconoplasm-publish-event-archive.js"
import { releaseAbandonedManifestationUploads } from "./iconoplasm/caretaker/manifestation-upload-intents.js"
import { dispatchIconoplasmCatalogPublication } from "./iconoplasm-catalog-dispatch.js"
import {
  iconoplasmBackgroundJob,
  runIconoplasmBackgroundJob,
} from "./iconoplasm-background-schedule.js"
import { handleRequestAtTheOnlyAllowedStatefulWorkerForBenchmarkDoNotDuplicate } from "./benchmark/the-only-allowed-benchmark-stateful-runtime-do-not-duplicate.js"

export { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate }
export { IconoplasmSyncGovernor }
// Import Discord bot handlers
import {
  handleDailySummary,
  handleInteractions,
  handleMarkPosted,
  handlePostCatchupRecaps,
  handlePostDailyRecap,
  handlePostRecap,
  handleRepairPostedRecap,
  handleRenderPage,
} from "./discord.js"
import { handleContactSubmission } from "./contact-form.js"
// Import stats handlers
import {
  handleMigrateStats,
  handleGetStats,
  handleUpdateStats,
  handleGetLeaderboard,
  handleSetLeaderboardVisibility,
} from "./stats.js"
// Import admin handlers
import {
  handleOverrideProtein,
  handleFeatureFlags,
  handleAdminStatus,
  handleDeleteOverride,
  handleAdminDiscordRecapImageUpload,
  handleAdminDiscordRecapImageStatus,
  handleAdminDiscordRecapImageStatuses,
  handleGraphicsSettings,
  readGraphicsSettings,
  publicGraphicsSections,
  DEFAULT_GRAPHICS_SETTINGS,
  handleAdminSchedule,
  handleAdminScheduleAvailabilityReplacement,
  handleAdminCards,
  handleAdminGuessStats,
  handleAdminGuessAnalytics,
  handleAdminSimilarity,
  isAdmin,
} from "./admin.js"
// Import admin HTML
import { ADMIN_HTML } from "./admin-html.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { renderIconoplasmAdminHtml } from "./iconoplasm-admin-assets.js"
import {
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
  MAX_GUESSES,
  cleanGeneSummary,
  buildClueSections,
  buildFeedbackSections,
  getDomainSpoilerTokensFromFullName,
  collectMatchedHintTexts,
  extractHintData,
  maskClueSections,
  sanitizeTargetProtein,
  scoreGuess,
} from "./lib/game-engine.js"
import {
  ProteinReadUnavailableError,
  fetchProteinByUniprot,
  searchProteins,
  pickDailyTarget,
  pickPracticeCandidateIds,
  getBlendedSimilarity,
  getHig2vecSimilarity,
  markStructureFailure,
  clearStructureFailure,
} from "./lib/protein-store.js"
import { buildStructureMetaFromStoredSource } from "./lib/structure-utils.js"
import {
  ANONYMOUS_PDB_HEADER,
  isStructureProviderUrl,
  limitStructureBody,
  structureNeedsAnonymousHeader,
} from "../quartz/static/geneguessr/structure-bytes.js"
import {
  StructureUpstreamRefusedError,
  fetchStructureUpstream,
  structureContentType,
  structureFormatFromKey,
} from "./lib/structure-upstream.js"
import { recordDailyGuessAggregates } from "./lib/guess-aggregates.js"
import { publishLeaderboardObject } from "./lib/leaderboard-publication.js"
import { withObservedGameSessionWrite } from "./lib/game-session-write-evidence.js"
import {
  BrinedewAccountIdentityError,
  hydrateBrinedewSessionAccountIdentity,
} from "./lib/brinedew-account-identity.js"
import { geneguessrMolstarVendorUpstreamUrl } from "./lib/the-only-geneguessr-molstar-vendor-path-do-not-duplicate.js"
import { extractAvatarUpstreamFromRequest } from "./lib/avatar-proxy.js"
import { selectAvailableDailyTarget } from "./lib/daily-target-availability.js"
import {
  getDailyTargetFamilyKey,
  readDailyTargetAvailabilityPin,
} from "./lib/daily-target-availability-pins.js"
import { isUsableStructureProbe } from "./lib/structure-probe-validation.js"

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
}

function proteinReadUnavailableResponse(error, headers) {
  if (!(error instanceof ProteinReadUnavailableError)) return null
  return Response.json(
    { error: "Protein data is temporarily unavailable. Please try again." },
    { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
  )
}

// Hard-path rationale:
// Mol* uses dynamic evaluation/WASM bootstrap patterns that require `unsafe-eval`
// and `data:`/`blob:` fetches. We intentionally scope that CSP relaxation to the
// smallest GeneGuessr surface instead of weakening CSP for the whole site.
function shouldAllowUnsafeEval(url) {
  const host = String(url?.hostname || "").toLowerCase()
  const path = String(url?.pathname || "")
  if (host === GENEGUESSR_HOST && path === "/") {
    return true
  }
  if (path.startsWith("/static/geneguessr/") || path.startsWith("/static/vendor/pdbe-molstar@")) {
    return true
  }
  // The general admin panels load Mol* for protein preview. Iconoplasm's admin
  // has no evaluator or WASM runtime, so never inherit that host-wide exemption.
  if (host !== ICONOPLASM_HOST && path === "/admin") {
    return true
  }
  return (
    path === "/apps/geneguessr" ||
    path === "/apps/geneguessr/" ||
    path === "/apps/geneguessr/index" ||
    path === "/apps/geneguessr/index/" ||
    path === "/apps/geneguessr/render"
  )
}

function isIconoplasmAdminSurface(url) {
  const host = String(url?.hostname || "").toLowerCase()
  const path = String(url?.pathname || "")
  return host === ICONOPLASM_HOST && path === "/admin"
}

function shouldAllowIconoplasmShoelaceDataIcons(url) {
  const host = String(url?.hostname || "").toLowerCase()
  const path = String(url?.pathname || "")
  // Shoelace's bundled system icon library resolves checkbox/select/dialog icons
  // as data: SVG URLs and then fetches them. Scope that connect-src exception to
  // Iconoplasm surfaces instead of weakening the shared site CSP.
  if (host === ICONOPLASM_HOST) {
    return true
  }
  return path === "/apps/iconoplasm" || path.startsWith("/apps/iconoplasm/")
}

function isSiteSettingsBridgeRequest(request) {
  try {
    const reqUrl = new URL(request.url)
    return reqUrl.pathname === "/static/site-preferences/bridge.html"
  } catch {
    return false
  }
}

function buildContentSecurityPolicy(request) {
  let allowUnsafeEval = false
  let allowInlineScripts = true
  let allowInlineStyles = true
  try {
    const url = new URL(request.url)
    allowUnsafeEval = shouldAllowUnsafeEval(url)
    allowInlineScripts = !isIconoplasmAdminSurface(url)
    allowInlineStyles = !isIconoplasmAdminSurface(url)
  } catch {
    allowUnsafeEval = false
    allowInlineScripts = true
    allowInlineStyles = true
  }

  const scriptTokens = ["script-src", "'self'"]
  if (allowInlineScripts) scriptTokens.push("'unsafe-inline'")
  if (allowUnsafeEval) scriptTokens.push("'unsafe-eval'")
  scriptTokens.push(
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
  )
  const scriptSrc = scriptTokens.join(" ")
  const styleSrc = allowInlineStyles ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'"
  const allowIconoplasmShoelaceDataIcons = (() => {
    try {
      return shouldAllowIconoplasmShoelaceDataIcons(new URL(request.url))
    } catch {
      return false
    }
  })()
  const connectSrc = allowUnsafeEval
    ? "connect-src 'self' data: blob: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
    : allowIconoplasmShoelaceDataIcons
      ? "connect-src 'self' data: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
      : "connect-src 'self' https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
  const frameAncestors = isSiteSettingsBridgeRequest(request)
    ? "frame-ancestors https://brinedew.bio https://*.brinedew.bio"
    : "frame-ancestors 'none'"
  const frameSrc = isSiteSettingsBridgeRequest(request)
    ? "frame-src 'self' https://brinedew.bio https://*.brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com"
    : "frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com"

  return `default-src 'self'; base-uri 'self'; object-src 'none'; ${frameAncestors}; img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net; font-src 'self' data:; ${styleSrc}; ${scriptSrc}; ${connectSrc}; ${frameSrc}; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests`
}

function crossOriginResourcePolicyForRequest(request) {
  try {
    const reqUrl = new URL(request.url)
    if (
      reqUrl.hostname === ICONOPLASM_HOST &&
      (reqUrl.pathname.startsWith("/portraits/") ||
        reqUrl.pathname.startsWith("/gene-cards/") ||
        reqUrl.pathname.startsWith("/blot/") ||
        reqUrl.pathname.startsWith("/blots/"))
    ) {
      return "cross-origin"
    }
  } catch {
    // Ignore malformed request URLs and fall back to the default site-wide policy.
  }
  return SECURITY_HEADERS["Cross-Origin-Resource-Policy"]
}

const STRIP_RESPONSE_HEADERS = [
  "x-powered-by",
  "x-github-request-id",
  "x-proxy-cache",
  "x-served-by",
  "x-cache",
  "x-cache-hits",
  "x-timer",
  "x-fastly-request-id",
  "via",
]

function cloneHeadersPreservingCookies(sourceHeaders) {
  const headers = new Headers()
  for (const [name, value] of sourceHeaders.entries()) {
    if (name.toLowerCase() === "set-cookie") continue
    headers.append(name, value)
  }
  if (typeof sourceHeaders.getSetCookie === "function") {
    const cookies = sourceHeaders.getSetCookie()
    for (const cookie of cookies) {
      headers.append("Set-Cookie", cookie)
    }
  } else {
    const cookie = sourceHeaders.get("set-cookie")
    if (cookie) headers.append("Set-Cookie", cookie)
  }
  return headers
}

function appendCacheControlDirective(cacheControl, directive) {
  const existing = String(cacheControl || "").trim()
  const normalizedDirective = String(directive || "")
    .trim()
    .toLowerCase()
  if (!existing) return directive
  const hasDirective = existing
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(normalizedDirective)
  return hasDirective ? existing : `${existing}, ${directive}`
}

function removeCacheControlDirective(cacheControl, directive) {
  const existing = String(cacheControl || "").trim()
  const normalizedDirective = String(directive || "")
    .trim()
    .toLowerCase()
  if (!existing) return existing
  return existing
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.toLowerCase() !== normalizedDirective)
    .join(", ")
}

function isProductionBrinedewHtmlHost(hostname) {
  const host = String(hostname || "").toLowerCase()
  return (
    host === "brinedew.bio" ||
    host === "www.brinedew.bio" ||
    host === "iconoplasm.brinedew.bio" ||
    host === "geneguessr.brinedew.bio"
  )
}

function requestHasAnalyticsConsent(request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  return cookies.brinedew_analytics_consent === "accepted"
}

function enforceNoTransformForHtml(headers, request) {
  const contentType = String(headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("text/html")) {
    return
  }
  const host = (() => {
    try {
      return new URL(request.url).hostname.toLowerCase()
    } catch {
      return ""
    }
  })()
  if (
    isProductionBrinedewHtmlHost(host) &&
    (!requestRequiresAnalyticsConsent(request) || requestHasAnalyticsConsent(request))
  ) {
    const updated = removeCacheControlDirective(headers.get("cache-control"), "no-transform")
    if (updated) headers.set("Cache-Control", updated)
    else headers.delete("Cache-Control")
    return
  }
  // Hard-path rationale:
  // Cloudflare Web Analytics automatic setup mutates HTML by injecting its beacon.
  // Keep that transform blocked unless the visitor has explicitly opted in. This
  // gives EU visitors analytics coverage after consent without tracking anyone on
  // the first page load or relying on a client-only race.
  const updated = appendCacheControlDirective(headers.get("cache-control"), "no-transform")
  headers.set("Cache-Control", updated)
}

export function applySecurityHeaders(response, request) {
  const headers = cloneHeadersPreservingCookies(response.headers)
  for (const name of STRIP_RESPONSE_HEADERS) {
    headers.delete(name)
  }
  try {
    const reqUrl = new URL(request.url)
    if (reqUrl.pathname.startsWith("/api/auth/")) {
      // OAuth state, session identity, callback cookies, and logout responses
      // must never survive a browser, intermediary, or shared edge cache.
      headers.set("Cache-Control", "no-store")
    }
  } catch {
    // Ignore malformed request URLs and retain the response's existing policy.
  }
  enforceNoTransformForHtml(headers, request)
  headers.set("Content-Security-Policy", buildContentSecurityPolicy(request))
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  if (isSiteSettingsBridgeRequest(request)) {
    headers.delete("X-Frame-Options")
  }
  headers.set("Cross-Origin-Resource-Policy", crossOriginResourcePolicyForRequest(request))
  try {
    const reqUrl = new URL(request.url)
    if (reqUrl.protocol === "https:") {
      headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
    }
  } catch {
    // Ignore malformed request URL.
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isStagingOrDevHost(hostname) {
  const host = String(hostname || "").toLowerCase()
  return (
    host.endsWith(".workers.dev") ||
    host.endsWith(".pages.dev") ||
    host === "staging.brinedew.bio" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0"
  )
}

function isHealthCheckAuthorized(request, env, url) {
  if (isStagingOrDevHost(url.hostname)) return true
  const token = String(env?.HEALTHCHECK_TOKEN || "").trim()
  if (!token) return false
  const headerToken = String(request.headers.get("X-Health-Token") || "").trim()
  const authHeader = String(request.headers.get("Authorization") || "").trim()
  return headerToken === token || authHeader === `Bearer ${token}`
}

function isDraftHtmlDocument(html) {
  const source = String(html || "")
  return (
    /\bdata-page-draft=["']true["']/i.test(source) ||
    /<article\b[^>]*\bdata-draft=["']true["']/i.test(source)
  )
}

function draftNotFoundResponse(method) {
  return new Response(method === "HEAD" ? null : "Not found", { status: 404 })
}

async function getUserAccessLevel(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = cookies.session
  if (!sessionId) return 1

  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    const session = await resp.json()
    if (!session || !session.user_id) return 1
    if (Date.now() > session.expires_at) return 1

    const adminUserId = String(env.ADMIN_DISCORD_USER_ID || "").trim()
    if (adminUserId.length > 0 && session.user_id === adminUserId) return 4
    if (session.is_guild_member) return 3
    return 2
  } catch {
    return 1
  }
}

function truncateDraftHtml(html, request) {
  if (/data-truncated=["']/i.test(html)) return html

  const articleMatch = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/i)
  if (!articleMatch) return html

  const fullArticle = articleMatch[0]
  const closeTag = "</article>"
  const articleContent = fullArticle.slice(0, -closeTag.length)

  // Strip .draft-locked content entirely from the HTML served to low-access users.
  // This prevents locked text from being in the source even though CSS hides it.
  let cleanedContent = articleContent.replace(
    /<div\b[^>]*class="[^"]*draft-locked[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    "",
  )

  // Also strip the draft-cta article (it will be re-added by the template)
  cleanedContent = cleanedContent.replace(
    /<article\b[^>]*id="draft-cta"[^>]*>[\s\S]*?<\/article>/gi,
    "",
  )

  // Try to find first <hr> at top level (not inside tables/blockquotes/figures)
  let hrIdx = -1
  let depth = 0
  const skipTags = /^<\/(td|th|table|tr|blockquote|figure|details)>/i
  const enterTags = /^<(td|th|table|tr|blockquote|figure|details)\b/i
  for (let i = 0; i < cleanedContent.length; i++) {
    if (cleanedContent[i] !== "<") continue
    const tagEnd = cleanedContent.indexOf(">", i)
    if (tagEnd < 0) continue
    const tag = cleanedContent.substring(i, tagEnd + 1)
    if (skipTags.test(tag)) depth--
    else if (enterTags.test(tag)) depth++
    else if (/^<hr\b/i.test(tag) && depth === 0) {
      hrIdx = i
      break
    }
    i = tagEnd
  }

  if (hrIdx >= 0) {
    const preview = cleanedContent.substring(0, hrIdx)
    return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
  }

  // 100-word fallback: count words only from cleaned (non-locked) content
  const textOnly = cleanedContent.replace(/<[^>]+>/g, " ")
  const words = textOnly.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  if (words.length <= 100) {
    return html.replace(fullArticle, cleanedContent + closeTag)
  }

  // Find table position
  const tableStart = cleanedContent.match(/<(table|div class="table-container")/i)

  // 100-word truncation
  let wordCount = 0
  let inTag = false
  let truncIdx = -1
  for (let i = 0; i < cleanedContent.length; i++) {
    const ch = cleanedContent[i]
    if (ch === "<") inTag = true
    else if (ch === ">") {
      inTag = false
      continue
    }
    if (inTag) continue
    if (ch === " " && i > 0 && cleanedContent[i - 1] !== ">" && cleanedContent[i + 1] !== "<") {
      wordCount++
      if (wordCount >= 100) {
        truncIdx = i
        break
      }
    }
  }
  if (truncIdx < 0) {
    return html.replace(fullArticle, cleanedContent + closeTag)
  }
  // If truncation point lands inside/after a table, back up to before the table
  if (tableStart && tableStart.index > 0 && tableStart.index <= truncIdx) {
    const preview = cleanedContent.substring(0, tableStart.index).trim()
    if (preview.length > 0) {
      return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
    }
    return html.replace(fullArticle, cleanedContent + closeTag)
  }
  const preview = cleanedContent.substring(0, truncIdx)
  return html.replace(fullArticle, preview + closeTag + '<div data-truncated="true"></div>')
}

export async function handleRequestAtTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx,
) {
  const url = new URL(request.url)
  console.log(`[WORKER] Incoming: ${request.method} ${url.pathname}`)
  const origin = request.headers.get("Origin") || ""
  const corsHeaders = getCorsHeaders(origin, url.hostname)
  const routeRequest = async () => {
    if (url.hostname === BENCHMARK_HOST) {
      return handleRequestAtTheOnlyAllowedStatefulWorkerForBenchmarkDoNotDuplicate(request, env)
    }

    if (url.hostname === "www.brinedew.bio") {
      const canonicalUrl = new URL(url)
      canonicalUrl.host = "brinedew.bio"
      return Response.redirect(
        canonicalUrl.toString(),
        request.method === "GET" || request.method === "HEAD" ? 301 : 308,
      )
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/apps/iconoplasm" ||
        url.pathname === "/apps/iconoplasm/" ||
        url.pathname === "/apps/iconoplasm/index" ||
        url.pathname === "/apps/iconoplasm/index/")
    ) {
      return Response.redirect(`https://${ICONOPLASM_HOST}/`, 301)
    }

    // Staging workers.dev and production read the same Pages-owned initializer.
    // The old embedded base64 copy drifted from this source and was a second owner.
    if (
      url.pathname === "/static/geneguessr/molstar-shared.js" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      let upstream
      try {
        upstream = await fetch(buildStaticSiteUrl(url).toString(), {
          method: request.method,
          cf: { cacheEverything: false, cacheTtl: 0 },
        })
      } catch {
        // A missing source must not turn into a successful HTML app shell.
      }
      if (
        !upstream?.ok ||
        !String(upstream.headers.get("Content-Type") || "").includes("javascript")
      ) {
        return new Response("Molstar initializer temporarily unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        })
      }
      return new Response(request.method === "HEAD" ? null : upstream.body, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache, max-age=0",
        },
      })
    }

    // Proxy Mol* assets through the Worker so worker-served pages do not depend on the client being
    // able to reach jsDelivr directly (helps CI screenshots and restrictive networks).
    if (request.method === "GET" || request.method === "HEAD") {
      const upstream = geneguessrMolstarVendorUpstreamUrl(url.pathname)
      if (upstream) {
        const upstreamResp = await fetch(upstream, {
          cf: {
            cacheEverything: true,
            cacheTtl: 86400,
          },
        })
        const headers = new Headers(upstreamResp.headers)
        headers.set("Cache-Control", "public, max-age=86400")
        return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
          status: upstreamResp.status,
          headers,
        })
      }
    }

    // Serve KaTeX assets from same-origin vendor paths.
    // Hard-path rationale:
    // We rewrite stale upstream HTML from jsDelivr URLs to `/static/vendor/katex/*` to keep CSP strict.
    // Some upstream builds don't yet contain those local files, so the worker must backfill them.
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname.startsWith(KATEX_VENDOR_PREFIX)
    ) {
      const relativePath = url.pathname.slice(KATEX_VENDOR_PREFIX.length)
      const normalized = relativePath.replace(/^\/+/, "")
      if (normalized.length === 0) {
        return new Response("Not found", { status: 404 })
      }
      const upstream = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VENDOR_VERSION}/dist/${normalized}`
      const upstreamResp = await fetch(upstream, {
        cf: {
          cacheEverything: true,
          cacheTtl: 86400,
        },
      })
      const headers = new Headers(upstreamResp.headers)
      headers.set("Cache-Control", "public, max-age=86400")
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers,
      })
    }

    // Serve host-scoped robots/sitemap for the geneguessr subdomain.
    // This prevents Google Search Console from seeing a sitemap full of brinedew.bio URLs.
    if (
      url.hostname === GENEGUESSR_HOST &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (url.pathname === "/robots.txt") {
        return new Response(
          request.method === "HEAD" ? null : buildGeneguessrSubdomainRobotsTxt(),
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "max-age=600",
            },
          },
        )
      }

      if (url.pathname === "/sitemap.xml") {
        return new Response(
          request.method === "HEAD" ? null : buildGeneguessrSubdomainSitemapXml(),
          {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "max-age=600",
            },
          },
        )
      }

      if (url.pathname === "/llms.txt") {
        return new Response(request.method === "HEAD" ? null : buildGeneguessrSubdomainLlmsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "max-age=600",
          },
        })
      }
    }

    // Discord render page for screenshots - served by worker, not proxied
    if (url.pathname === "/apps/geneguessr/render" && request.method === "GET") {
      return handleRenderPage(request, env)
    }

    // Shared platform route: avatar proxy belongs to the common shell, not any single app router.
    // Handle it before host-based dispatch so every Brinedew app resolves avatars through one path
    // instead of re-implementing the same proxy inside each app-specific API surface.
    if (url.pathname === "/api/avatar" && (request.method === "GET" || request.method === "HEAD")) {
      const upstreamUrl = extractAvatarUpstreamFromRequest(url)
      if (!upstreamUrl) {
        return Response.json({ error: "Invalid avatar URL" }, { status: 400, headers: corsHeaders })
      }
      const upstreamResp = await fetch(upstreamUrl, {
        cf: {
          cacheEverything: true,
          cacheTtl: 86400,
        },
      })
      if (!upstreamResp.ok) {
        return Response.json({ error: "Avatar not found" }, { status: 404, headers: corsHeaders })
      }
      const headers = new Headers(corsHeaders)
      headers.set("Content-Type", upstreamResp.headers.get("Content-Type") || "image/png")
      headers.set("Cache-Control", "public, max-age=86400")
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        headers,
      })
    }

    // Shared platform route: auth is a site-wide concern (cookie domain = .brinedew.bio),
    // not a feature of any single subdomain. Handle it before host-based dispatch so every
    // Brinedew app can initiate and complete the Discord OAuth flow through one code path.
    if (url.pathname.startsWith("/api/auth/")) {
      if (url.pathname === "/api/auth/login" && request.method === "GET") {
        return handleLogin(request, env)
      }
      if (url.pathname === "/api/auth/config" && request.method === "GET") {
        if (!(await isAdmin(request, env))) {
          return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders })
        }
        return Response.json(getDiscordAuthConfigStatus(env), { headers: corsHeaders })
      }
      if (url.pathname === "/api/auth/callback" && request.method === "GET") {
        return handleCallback(request, env)
      }
      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const response = await handleMe(request, env)
        const headers = new Headers(response.headers)
        for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
        return new Response(response.body, {
          status: response.status,
          headers,
        })
      }
      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const response = await handleLogout(request, env)
        const headers = new Headers(response.headers)
        for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value)
        return new Response(response.body, {
          status: response.status,
          headers,
        })
      }
    }

    // Site-wide contact form (brinedew.bio/About). Lives next to /api/auth/*
    // because both are platform-level concerns that don't belong to any single
    // Brinedew app subdomain.
    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContactSubmission(request, env, ctx, corsHeaders)
    }

    // The live settings page runs on brinedew.bio and probes Iconoplasm admin state via
    // same-origin /api/iconoplasm/* requests. Route those to the Iconoplasm caller worker no
    // matter which Brinedew host receives them, otherwise apex settings fetches fall through
    // to a generic 404 despite the endpoint existing in the caller boundary module.
    if (
      (url.pathname === "/api/iconoplasm" || url.pathname.startsWith("/api/iconoplasm/")) &&
      request.method !== "OPTIONS"
    ) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        env,
        ctx,
      )
    }

    // Portrait binaries must resolve even after service-binding hops or route
    // reassignment, so do not make them depend on the incoming hostname still
    // looking like iconoplasm.brinedew.bio.
    if (
      url.pathname.startsWith("/portraits/") ||
      url.pathname.startsWith("/gene-cards/") ||
      url.pathname.startsWith("/blots/v1/")
    ) {
      const key = url.pathname.replace(/^\/+/, "")
      const object = await env.ICONOPLASM_PORTRAITS?.get?.(key)
      if (object) {
        const fallbackContentType = url.pathname.startsWith("/gene-cards/")
          ? "image/png"
          : "image/webp"
        return new Response(request.method === "HEAD" ? null : object.body, {
          status: 200,
          headers: {
            "Content-Type": object.httpMetadata?.contentType || fallbackContentType,
            "Cache-Control": "public, max-age=31536000, immutable",
            ETag: `"${object.httpEtag || key}"`,
            "Access-Control-Allow-Origin": "*",
          },
        })
      }
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        env,
        ctx,
      )
    }

    // ARCHITECTURE FENCE [IPD-007]
    // Iconoplasm subdomain: static assets bypass this code; dynamic misses are
    // owned directly by this one stateful Worker. Do not add a public proxy,
    // service-binding hop, or second state owner here.
    // The API, published-image and admin routes go to the Iconoplasm handler;
    // nothing else is served from here.
    if (isIconoplasmRequest(url.hostname)) {
      if (url.pathname === "/admin/iconoplasm" || url.pathname === "/admin/iconoplasm/") {
        return Response.redirect(`https://${ICONOPLASM_HOST}/admin#costs`, 302)
      }

      if (/^\/portrait\/[^/]+\.webp$/.test(url.pathname)) {
        return new Response("Not Found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        })
      }

      const isApiOrWorker =
        Boolean(matchIconoplasmRouteContract(url.pathname, request.method)) ||
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/portraits/") ||
        url.pathname.startsWith("/gene-cards/") ||
        url.pathname.startsWith("/blot/") ||
        url.pathname.startsWith("/blots/") ||
        url.pathname === "/admin" ||
        url.pathname === "/blocklist" ||
        url.pathname === "/blocklist/" ||
        url.pathname === "/artist-styles" ||
        url.pathname === "/artist-styles/" ||
        url.pathname === "/health"

      if (isApiOrWorker) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          env,
          ctx,
        )
      }

      // The crawler documents (robots.txt, sitemap.xml, llms.txt, the /genes
      // redirects) are static files in the asset bundle and never reach here.
      // No standard AI well-known document exists. Fail explicitly so a missing
      // experimental convention cannot masquerade as the app shell.
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        url.pathname === "/.well-known/ai"
      ) {
        return new Response(null, {
          status: 404,
          headers: {
            "Cache-Control": "public, max-age=300",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
          },
        })
      }

      // Static Assets answer every other Iconoplasm path (the documents, the
      // scripts, the 404 page) before this Worker runs, and nothing in the route
      // list reaches here with a page to give. Say so, and never read D1 or fetch
      // a shell.
      if (url.pathname.startsWith("/gene/")) return iconoplasmGeneNotFoundResponse(request.method)
      return new Response(request.method === "HEAD" ? null : "Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=60",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
      })
    }

    // Route all non-API apex requests through the worker so we can enforce
    // consistent security headers for the static site.
    if (
      (url.hostname === "brinedew.bio" || url.hostname === "www.brinedew.bio") &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/admin" &&
      url.pathname !== "/admin/iconoplasm" &&
      url.pathname !== "/admin/iconoplasm/" &&
      url.pathname !== "/admin-v2"
    ) {
      if (request.method === "GET" || request.method === "HEAD") {
        const geneguessrCanonicalPath = canonicalGeneguessrSubdomainPath(url.pathname)
        if (geneguessrCanonicalPath) {
          return redirectToGeneguessrCanonicalHost(url, geneguessrCanonicalPath)
        }
      }

      if (request.method === "GET" || request.method === "HEAD") {
        if (url.pathname === "/posts" || url.pathname === "/posts/") {
          return Response.redirect("https://brinedew.bio/tags/content/post", 301)
        }
        if (url.pathname === "/wiki" || url.pathname === "/wiki/") {
          return Response.redirect("https://brinedew.bio/tags/content/wiki", 301)
        }
        if (url.pathname === "/settings" || url.pathname === "/settings/") {
          return Response.redirect(`${url.origin}/settings/index`, 301)
        }
      }

      const upstreamUrl = buildStaticSiteUrl(url)
      const upstreamResp = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        cf: { cacheEverything: false, cacheTtl: 0 },
      })
      const contentType = String(upstreamResp.headers.get("content-type") || "").toLowerCase()
      if (contentType.includes("text/html")) {
        let html = await upstreamResp.text()
        const responseHeaders = new Headers(upstreamResp.headers)
        if (isDraftHtmlDocument(html)) {
          const level = await getUserAccessLevel(request, env)
          if (level < 3) {
            html = truncateDraftHtml(html, request)
            responseHeaders.set("Cache-Control", "public, max-age=3600")
          } else {
            responseHeaders.set("Cache-Control", "private, no-cache, no-store")
          }
        }
        html = injectAnalyticsConsentBootstrap(html, request)
        return new Response(request.method === "HEAD" ? null : html, {
          status: upstreamResp.status,
          statusText: upstreamResp.statusText,
          headers: responseHeaders,
        })
      }
      const nonHtmlHeaders = new Headers(upstreamResp.headers)
      // Static assets should be cached aggressively to prevent SPA re-fetch white flash
      if (url.searchParams.has("v") || url.pathname.match(/\.(woff2|woff|ttf|otf|eot)$/)) {
        nonHtmlHeaders.set("Cache-Control", "public, max-age=31536000, immutable")
      }
      return new Response(request.method === "HEAD" ? null : upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: nonHtmlHeaders,
      })
    }

    // Handle geneguessr subdomain proxy - proxy NON-API, NON-ADMIN requests from subdomain to main site
    // /admin is served here; old /admin-v2 links redirect to that same page.
    if (
      url.hostname === GENEGUESSR_HOST &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/admin" &&
      url.pathname !== "/admin-v2" &&
      url.pathname !== "/admin-v2/"
    ) {
      // Avoid duplicate content at multiple paths on the subdomain.
      // Keep the canonical entrypoint at `/` and normalize a few common variants.
      if (request.method === "GET" || request.method === "HEAD") {
        if (
          url.pathname === "/apps/geneguessr" ||
          url.pathname === "/apps/geneguessr/" ||
          url.pathname === "/apps/geneguessr/index" ||
          url.pathname === "/apps/geneguessr/index/"
        ) {
          return Response.redirect(`https://${GENEGUESSR_HOST}/`, 301)
        }

        if (url.pathname === "/privacy/") {
          return Response.redirect(`https://${GENEGUESSR_HOST}/privacy`, 301)
        }

        if (
          url.pathname === "/apps/geneguessr/privacy" ||
          url.pathname === "/apps/geneguessr/privacy/"
        ) {
          return Response.redirect(`https://${GENEGUESSR_HOST}/privacy`, 301)
        }
      }

      // For root path, fetch the geneguessr app page
      let targetPath =
        url.pathname === "/"
          ? "/apps/geneguessr/index"
          : url.pathname === "/privacy"
            ? "/apps/geneguessr/privacy"
            : url.pathname

      const targetUrl = buildStaticSiteUrl(url, targetPath)

      // GeneGuessr bundle hotfix removed:
      // The app bundle now avoids global `const` redeclarations, so we can serve it directly and allow caching.

      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      })

      // For versioned GeneGuessr static assets, extend cache lifetime aggressively.
      // The upstream build emits `?v=<timestamp>` for cache busting, so `immutable` is safe here.
      if (
        url.pathname.startsWith("/static/geneguessr/") &&
        url.searchParams.has("v") &&
        (request.method === "GET" || request.method === "HEAD")
      ) {
        const headers = new Headers(response.headers)
        headers.set("Cache-Control", "public, max-age=31536000, immutable")
        return new Response(request.method === "HEAD" ? null : response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      // For HTML, rewrite links so navigation goes to main site, not subdomain
      if (response.headers.get("content-type")?.includes("text/html")) {
        let html = await response.text()
        if (isDraftHtmlDocument(html) && !(await isAdmin(request, env))) {
          return draftNotFoundResponse(request.method)
        }
        // Rewrite site-brand/home links to absolute main site URL.
        // Quartz renders: <a href={baseDir} class="site-brand"> where baseDir may be "/" or "../..".
        // If left relative on the subdomain, client-side navigation can re-inject scripts and
        // cause reload-time errors (e.g., redeclared top-level consts in app bundles).
        html = html.replace(
          /<a\b[^>]*\bclass=["'][^"']*\bsite-brand\b[^"']*["'][^>]*>/gi,
          (tag) => {
            if (!/\bhref\s*=/i.test(tag)) {
              return tag
            }
            return tag.replace(/\bhref=["'][^"']*["']/i, 'href="https://brinedew.bio/"')
          },
        )

        // Rewrite all internal navigation links to point to main domain
        // This prevents SPA navigation on the subdomain from going to wrong paths
        // Match href="/tags/...", href="/posts/...", href="/wiki/...", etc.
        html = html.replace(
          /href=["']\/(tags|posts|wiki|About|index)([^"']*)["']/g,
          'href="https://brinedew.bio/$1$2"',
        )

        // Keep share/debug metadata consistent with the subdomain host.
        if (url.pathname === "/") {
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/gi,
            `<meta property="og:url" content="https://${GENEGUESSR_HOST}/">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/gi,
            `<meta name="twitter:url" content="https://${GENEGUESSR_HOST}/">`,
          )
          // Use GeneGuessr-specific og:image for Discord/social embeds
          const geneGuessrOgImage = "https://brinedew.bio/static/geneguessr/og-image.png"
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image["'][^>]*>/gi,
            `<meta property="og:image" content="${geneGuessrOgImage}">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image:url["'][^>]*>/gi,
            `<meta property="og:image:url" content="${geneGuessrOgImage}">`,
          )
          html = html.replace(
            /<meta\b[^>]*\b(?:name)=["']twitter:image["'][^>]*>/gi,
            `<meta name="twitter:image" content="${geneGuessrOgImage}">`,
          )
        }
        html = html.replace(
          /<meta\b[^>]*\b(?:property|name)=["']twitter:domain["'][^>]*>/gi,
          `<meta name="twitter:domain" content="${GENEGUESSR_HOST}">`,
        )
        if (url.pathname === "/privacy") {
          html = rewritePrivacyCanonicalMetadata(html, GENEGUESSR_HOST)
        }

        // Hard-path rationale:
        // Upstream static deploys can lag behind worker deploys. When stale HTML still references
        // jsDelivr KaTeX assets, strict CSP blocks them and math rendering regresses.
        // We normalize legacy CDN URLs to self-hosted vendored assets at the edge so behavior
        // stays stable without globally loosening CSP.
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/katex\.min\.css/gi,
          `/static/vendor/katex/katex.min.css?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^"']+\/dist\/contrib\/copy-tex\.min\.js/gi,
          `/static/vendor/katex/contrib/copy-tex.min.js?v=${KATEX_VENDOR_VERSION}`,
        )
        html = html.replace(
          /<link\b[^>]*rel=["']preconnect["'][^>]*href=["']https:\/\/cdn\.jsdelivr\.net["'][^>]*>/gi,
          "",
        )
        html = injectAnalyticsConsentBootstrap(html, request)
        return new Response(html, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }

      return response
    }

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
      })
    }

    // Health check endpoint
    if (url.pathname === "/api/health") {
      if (!isHealthCheckAuthorized(request, env, url)) {
        return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders })
      }
      return Response.json(
        {
          status: "ok",
          timestamp: Date.now(),
          database: await checkD1Health(env.DB),
          kv: await checkKVHealth(env.KV),
          durableObjects: "configured",
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Normalize directory-style app path to include trailing slash.
    // This avoids edge/origin mismatches where a non-trailing-slash request
    // could resolve to an upstream origin that serves a 503/GitHub outage page.
    if (url.pathname === "/apps/geneguessr" && request.method === "GET") {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `${url.origin}/apps/geneguessr/`,
        },
      })
    }

    // Discord bot endpoints
    if (url.pathname === "/api/discord/daily-summary" && request.method === "GET") {
      return handleDailySummary(request, env)
    }

    if (url.pathname === "/api/discord/interactions" && request.method === "POST") {
      return handleInteractions(request, env)
    }

    if (url.pathname === "/api/discord/mark-posted" && request.method === "POST") {
      return handleMarkPosted(request, env)
    }

    if (url.pathname === "/api/discord/post-recap" && request.method === "POST") {
      return handlePostRecap(request, env)
    }

    if (url.pathname === "/api/discord/post-feed" && request.method === "POST") {
      // B-1070: the feed's HTML parsers (about 630 KiB) load with the feed only.
      const { handlePostFeed } = await import("./discord-feed.js")
      return handlePostFeed(request, env)
    }

    // Stats endpoints
    if (url.pathname === "/api/migrate-stats" && request.method === "POST") {
      const response = await handleMigrateStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const response = await handleGetStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/leaderboard" && request.method === "GET") {
      const response = await handleGetLeaderboard(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/leaderboard-visibility" && request.method === "POST") {
      const response = await handleSetLeaderboardVisibility(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/stats/update" && request.method === "POST") {
      const response = await handleUpdateStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Admin panel UI (restricted to admin Discord session)
    if (url.pathname === "/admin" && request.method === "GET") {
      if (!(await isAdmin(request, env))) {
        return new Response("Unauthorized", { status: 403 })
      }
      return new Response(ADMIN_HTML, {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
        },
      })
    }

    // Keep Iconoplasm operations on an apex-hosted admin route so the real GUI
    // uses the same working site-admin session and does not depend on subdomain
    // cookie quirks. This is intentionally separate from the general admin page:
    // cost graphs and image triage should not be entangled with unrelated controls.
    if (
      (url.pathname === "/admin/iconoplasm" || url.pathname === "/admin/iconoplasm/") &&
      request.method === "GET"
    ) {
      if (!(await isAdmin(request, env))) {
        return new Response("Unauthorized", { status: 403 })
      }
      return new Response(renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, env), {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          "Cache-Control": "no-store",
        },
      })
    }

    // Retired graphics experiment: the live operator page owns preview and publication.
    if (
      (url.pathname === "/admin-v2" || url.pathname === "/admin-v2/") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const target = new URL("/admin", url)
      target.search = url.search
      return Response.redirect(target.toString(), 301)
    }

    // Admin endpoints (protected by Cloudflare Access)
    if (url.pathname === "/api/admin/override-protein" && request.method === "POST") {
      const response = await handleOverrideProtein(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/override-protein" && request.method === "DELETE") {
      const response = await handleDeleteOverride(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-image" && request.method === "POST") {
      const response = await handleAdminDiscordRecapImageUpload(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-image" && request.method === "GET") {
      const response = await handleAdminDiscordRecapImageStatus(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/discord-recap-images" && request.method === "GET") {
      const response = await handleAdminDiscordRecapImageStatuses(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/post-recap" && request.method === "POST") {
      if (!(await isAdmin(request, env))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
      let day = null
      try {
        const body = await request.json()
        if (typeof body?.day === "string") day = body.day
      } catch {
        // Optional JSON body
      }
      const result = await handlePostDailyRecap(env, { day: day || undefined })
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (url.pathname === "/api/admin/repair-posted-recap" && request.method === "POST") {
      if (!(await isAdmin(request, env))) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }
      let day = null
      try {
        const body = await request.json()
        if (typeof body?.day === "string") day = body.day
      } catch {
        // Invalid input is reported by the handler.
      }
      try {
        const result = await handleRepairPostedRecap(env, { day })
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 409,
          headers: { "Content-Type": "application/json" },
        })
      } catch (error) {
        console.error("Posted recap repair failed:", error)
        return Response.json(
          {
            ok: false,
            error: "recap_repair_failed",
            day,
            details: error instanceof Error ? error.message : String(error),
          },
          { status: 502 },
        )
      }
    }

    if (url.pathname === "/api/admin/feature-flags" && request.method === "POST") {
      const response = await handleFeatureFlags(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/graphics-settings" && request.method === "POST") {
      const response = await handleGraphicsSettings(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/similarity" && request.method === "GET") {
      const response = await handleAdminSimilarity(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    // Public graphics settings endpoint (no auth required). The game page does not call it (its
    // bootstrap carries the settings); the admin preview and the Discord recap do.
    if (url.pathname === "/api/graphics-settings" && request.method === "GET") {
      return Response.json(await readGraphicsSettings(env, request), {
        headers: corsHeaders,
      })
    }

    if (url.pathname === "/api/admin/status" && request.method === "GET") {
      const response = await handleAdminStatus(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/schedule" && request.method === "GET") {
      const response = await handleAdminSchedule(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (
      url.pathname === "/api/admin/schedule/availability-replacement" &&
      request.method === "POST"
    ) {
      const response = await handleAdminScheduleAvailabilityReplacement(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/cards" && request.method === "GET") {
      const response = await handleAdminCards(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/guess-stats" && request.method === "GET") {
      const response = await handleAdminGuessStats(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/admin/guess-analytics" && request.method === "GET") {
      const response = await handleAdminGuessAnalytics(request, env)
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
      })
    }

    if (url.pathname === "/api/structure-token" && request.method === "GET") {
      return handleStructureToken(request, env, corsHeaders)
    }

    // Direct structure access by cacheKey - stable URLs for client-side caching
    // Safe because cacheKey (e.g., "pdb/8J07.bcif") doesn't reveal protein identity
    // Support both GET (fetch) and HEAD (validation) requests
    if (
      url.pathname === "/api/structure-cached" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      return handleCachedStructureFetch(request, env, corsHeaders)
    }

    if (url.pathname === "/api/game/bootstrap" && request.method === "GET") {
      return handleGameBootstrap(request, env, ctx, corsHeaders)
    }

    if (url.pathname === "/api/game/practice/start" && request.method === "POST") {
      return handlePracticeStart(request, env, ctx, corsHeaders)
    }

    if (url.pathname === "/api/game/guess" && request.method === "POST") {
      return handleGuessSubmission(request, env, corsHeaders)
    }

    if (url.pathname === "/api/game/reveal-hint" && request.method === "POST") {
      return handleHintReveal(request, env, corsHeaders)
    }

    // Public proteins endpoint for autocomplete
    if (url.pathname === "/api/protein" && request.method === "GET") {
      try {
        const uniprot = (url.searchParams.get("uniprot") || "").toUpperCase()
        if (!uniprot) {
          return Response.json(
            { error: "Missing uniprot parameter" },
            { status: 400, headers: corsHeaders },
          )
        }
        const protein = await fetchProteinByUniprot(env.DB, uniprot)
        if (!protein) {
          return Response.json(
            { error: "Protein not found" },
            { status: 404, headers: corsHeaders },
          )
        }
        return Response.json(sanitizeTargetProtein(protein, { revealIdentity: true }), {
          headers: corsHeaders,
        })
      } catch (error) {
        console.error("Failed to load protein details", error)
        const unavailable = proteinReadUnavailableResponse(error, corsHeaders)
        if (unavailable) return unavailable
        return Response.json(
          { error: "Failed to load protein" },
          {
            status: 500,
            headers: corsHeaders,
          },
        )
      }
    }

    if (url.pathname === "/api/proteins" && request.method === "GET") {
      try {
        const query = (url.searchParams.get("query") || "").trim()
        if (!query) {
          return Response.json([], { headers: corsHeaders })
        }
        const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 100)
        const excludeRaw = url.searchParams.get("exclude") || ""
        const exclude = excludeRaw
          ? excludeRaw
              .split(",")
              .map((id) => id.trim().toUpperCase())
              .filter(Boolean)
          : []
        const matches = await searchProteins(env.DB, query, limit, exclude)
        return Response.json(matches, { headers: corsHeaders })
      } catch (error) {
        console.error("Failed to load protein search results", error)
        const unavailable = proteinReadUnavailableResponse(error, corsHeaders)
        if (unavailable) return unavailable
        return Response.json(
          { error: "Failed to load protein database" },
          {
            status: 500,
            headers: corsHeaders,
          },
        )
      }
    }

    return Response.json(
      { error: "Not found" },
      {
        status: 404,
        headers: corsHeaders,
      },
    )
  }
  const response = await routeRequest()
  return applySecurityHeaders(response, request)
}

// B-1063: Hono answers the routes it knows and hands every other request to
// the legacy handler above.
let factoryUsageReader = null
const app = createIconoplasmApp({
  legacy: handleRequestAtTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  publishGene: publishIconoplasmGeneStableObject,
  refreshSummaries: refreshIconoplasmRegisteredGeneSummaries,
  // Today's account-wide D1 usage from Cloudflare's analytics, one reader per
  // isolate (it caches 30 s and backs off after a failure).
  accountUsage: (env) => {
    factoryUsageReader ??= createOperationCostAccountUsageReader({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      token: env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
    })
    return factoryUsageReader.refresh()
  },
})

export default {
  async fetch(request, env, ctx) {
    // B-832: thrown errors and 5xx responses go to Sentry after the response.
    return withErrorReporting(env, ctx, request, "internal", async () => {
      // Rate limiting belongs at the one runtime that actually owns these
      // routes. Enforcing here applies exactly once to direct custom-domain and
      // service-binding traffic and cannot be bypassed by changing entry hosts.
      const rateLimit = await enforceIconoplasmRateLimit(request, env)
      if (rateLimit.response) return rateLimit.response
      const response = await app.fetch(request, env, ctx)
      return withIconoplasmRateLimitHeaders(response, rateLimit.headers)
    })
  },

  async queue(batch, env, ctx) {
    if (env.ICONOPLASM_SCHEMA_TRANSITION === "1") {
      batch.retryAll({ delaySeconds: 60 })
      return
    }
    return handleIconoplasmQueue(batch, env, ctx)
  },

  /**
   * Scheduled handler:
   * - 23:55 UTC: pre-warm next day's target structure/bootstrap cache
   * - 00:03 UTC: post Discord recap for yesterday using the pre-rendered day image (Bunny)
   */
  async scheduled(event, env, ctx) {
    const cronExprRaw = event?.cron || ""
    const cronExpr = cronExprRaw
      .trim()
      .split(/\s+/)
      .map((part, idx) => {
        if ((idx === 0 || idx === 1) && /^\d+$/.test(part)) {
          return String(Number(part))
        }
        return part
      })
      .join(" ")
    console.log(
      `[CRON] Triggered at ${new Date().toISOString()} via "${cronExprRaw}" -> "${cronExpr}"`,
    )

    const backgroundEvent = { cron: cronExpr, scheduledTime: event?.scheduledTime }
    if (iconoplasmBackgroundJob(backgroundEvent)) {
      if (env.ICONOPLASM_SCHEMA_TRANSITION === "1") return
      const background = await runIconoplasmBackgroundJob(backgroundEvent, {
        // B-898: the quarter-hour catalog tick. One D1 row read and one KV read;
        // when the newest canonical publish event moved past the last dispatch
        // it sends one repository_dispatch so GitHub Actions rebuilds the
        // stable catalog object and republishes the dirty genes.
        gallery: async () => ({
          catalog_dispatch: await dispatchIconoplasmCatalogPublication(env).catch((error) => ({
            dispatched: false,
            reason: String(error?.message || error),
          })),
        }),
        fulfillment: () => runScheduledIconoplasmFulfillment(env),
        sharedDiscovery: () => publishSharedGeneDiscoverySymbols(env),
        discoveryMigration: () => migrateIconoplasmCompactDiscoveryForScheduled(env),
        sharedDelivery: () => drainIconoplasmSharedDiscoveryDeliveriesForScheduled(env),
        materialization: () => recoverDueIconoplasmGeneCardMaterializationsForScheduled(env),
        recognition: () => reconcileIconoplasmRecognitionPolicies(env),
        // B-965: GeneGuessr's "Top Streaks" object on the CDN. Reads the GeneGuessr D1 (26 rows),
        // not an Iconoplasm one.
        geneguessrBoard: () => publishLeaderboardObject(env),
        // B-896: the style picker's first page on the CDN (121 rows, written on change).
        // B-1057: first rebuild, once each, the visions sync finalization marked, so
        // the page is built from fresh rollups. A failed rebuild re-marks its visions
        // and never blocks the page.
        requestPicker: async () => {
          const visionRollups = await rebuildDirtyVisionRollups(env).catch((error) => ({
            ok: false,
            error: String(error?.message || error),
          }))
          const picker = await publishRequestPickerObject(env)
          return { ...picker, vision_rollups: visionRollups }
        },
        accounts: () => drainIconoplasmAuthorityAccountProjection(env, { limit: 25 }),
        // B-985: after the projection drain, release uploads a caretaker abandoned and
        // never retried (at most 3 per run), so their reserved bytes and stored body return.
        manifestations: async () => {
          const projection = await drainIconoplasmManifestationAuthorityProjection(env, 25)
          const uploadSweep = await releaseAbandonedManifestationUploads(env)
          return { ...projection, upload_sweep: uploadSweep, ok: projection.ok && uploadSweep.ok }
        },
        caretakerComments: () => deliverPendingCaretakerCommentNotifications(env),
        caretakerSupervotes: () => deliverPendingCaretakerSupervoteNotifications(env),
        archive: () => archiveColdIconoplasmPublishEvents(env),
        canonRepair: () =>
          runScheduledIconoplasmMaintenanceStep(env, ctx, "repair-canon-invariants", {
            limit: 250,
            actorId: "cron",
            reason: "scheduled_canon_invariant_repair",
          }),
      })
      if (background.handled) {
        const result = background.result
        if (
          result?.ok === false ||
          Object.values(result || {}).some((step) => step?.status === "rejected")
        ) {
          console.error(`[CRON] Iconoplasm ${background.job} remains pending:`, result)
        } else {
          console.log(`[CRON] Iconoplasm ${background.job}:`, result)
        }
        return
      }
    }
    if (cronExpr === "3 0 * * *") {
      try {
        const result = await handlePostDailyRecap(env)
        console.log("[CRON] Recap post result:", result)
      } catch (err) {
        console.error("[CRON] Recap posting failed:", err)
      }
      // Catch-up: scan recent days for any recaps missed due to cron failures
      // (e.g. CPU budget exhaustion from gallery dirty-shard publication). Posts at most 3 days
      // back, stopping at the first day with no puzzle data.
      try {
        const catchup = await handlePostCatchupRecaps(env, 3)
        if (catchup.results?.length > 0) {
          const posted = catchup.results.filter((r) => r.ok && r.message_id)
          if (posted.length > 0) {
            console.log(
              "[CRON] Catch-up posted missed recaps:",
              posted.map((r) => r.day).join(", "),
            )
          }
        }
      } catch (err) {
        console.error("[CRON] Catch-up recap failed:", err)
      }
      return
    }

    if (cronExpr === "6 12 * * *") {
      try {
        const { handlePostDailyFeed } = await import("./discord-feed.js")
        const result = await handlePostDailyFeed(env)
        console.log("[CRON] Feed post result:", result)
      } catch (err) {
        console.error("[CRON] Feed posting failed:", err)
      }
      return
    }

    if (cronExpr && cronExpr !== "55 23 * * *") {
      console.warn(
        `[CRON] No handler for cron expression "${cronExprRaw}" (normalized: "${cronExpr}")`,
      )
      return
    }

    // The pre-warm's failure is logged, sent to Sentry and thrown, so the invocation's
    // status says it failed. A swallowed failure would make Cloudflare report a night
    // with no pick as `success` (B-918).
    return withScheduledErrorReporting(
      env,
      ctx,
      "internal",
      cronExpr || "55 23 * * *",
      async () => {
        try {
          await runDailyPreWarm(env)
        } catch (err) {
          console.error("[CRON] Pre-warm failed:", err)
          throw err
        }
      },
    )
  },
}

// The 23:55 UTC pre-warm: choose tomorrow's target, verify its structure, record the
// pick, then warm each public origin's bootstrap entry. This is the one place a daily
// structure is verified, so the player path serves what it recorded and probes nothing.
// The pick is recorded before anything is warmed because it is the one write that must
// succeed. Throws when it cannot leave a verified, recorded pick.
async function runDailyPreWarm(env) {
  console.log("[CRON] Daily pre-warm triggered at", new Date().toISOString())

  // Get tomorrow's date
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  // 1. Check for admin override first
  const overrideKey = `puzzle_override:${tomorrowStr}`
  let overrideId = await env.KV.get(overrideKey)
  if (!overrideId && env.PROD_KV?.get) {
    overrideId = await env.PROD_KV.get(overrideKey)
  }
  const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT
  const computedSelection = await pickDailyTarget(env.DB, salt, tomorrowStr)
  let targetProtein
  let source
  let availabilityPin = null
  let skippedAlphaFold = null

  if (overrideId) {
    targetProtein = await fetchProteinByUniprot(env.DB, overrideId)
    source = "admin_override"
    console.log(`[CRON] Using admin override for ${tomorrowStr}: ${overrideId}`)
  } else {
    availabilityPin = await readDailyTargetAvailabilityPin(env.DB, {
      date: tomorrowStr,
      salt,
      selectionPoolFingerprint: computedSelection?.poolFingerprint,
    })
    targetProtein = availabilityPin?.uniprot_id
      ? await fetchProteinByUniprot(env.DB, availabilityPin.uniprot_id)
      : computedSelection?.protein
    skippedAlphaFold = Number.isFinite(computedSelection?.skippedAlphaFold)
      ? computedSelection.skippedAlphaFold
      : null
    source = availabilityPin ? "availability_replacement" : "computed"
    console.log(`[CRON] ${source} target for ${tomorrowStr}: ${targetProtein?.uniprot}`)
  }

  if (!targetProtein) {
    throw new Error(`Pre-warm found no target protein for ${tomorrowStr}`)
  }

  const cronAudit = {
    date: tomorrowStr,
    source: source === "admin_override" ? "override" : source,
    override_id: overrideId || null,
    rejected: (availabilityPin?.rejected_uniprot_ids || []).map((uniprot) => ({
      uniprot_id: uniprot,
      reason: "catalog_render_unavailable",
    })),
    skipped_alpha_fold: skippedAlphaFold,
  }

  // 3. Verify the exact canonical structure before committing tomorrow's
  // puzzle. Metadata presence is not availability: the 2026-07-17 IMMP2L
  // incident had a perfectly formed SWISS-MODEL URL that returned 404.
  const balancedCandidateIds = Array.isArray(computedSelection?.candidateIds)
    ? computedSelection.candidateIds
    : []
  const availabilityIds = [
    targetProtein.uniprot,
    ...balancedCandidateIds.filter((uniprot) => uniprot !== targetProtein.uniprot),
  ]
  const availableTarget = await selectAvailableDailyTarget({
    initialProtein: targetProtein,
    eligibleIds: availabilityIds,
    startIndex: 0,
    loadProtein: (uniprot) => fetchProteinByUniprot(env.DB, uniprot),
    resolveStructureMeta: (protein) => getCanonicalStructureMeta(protein),
    isStructureAvailable: (structureMeta, protein) =>
      verifyDailyTargetStructure(env, structureMeta, protein),
    isCandidateIneligible:
      source === "admin_override"
        ? () => false
        : (candidate) =>
            isAlphaFoldOnlyProtein(candidate) ||
            (candidate.uniprot !== availabilityPin?.uniprot_id &&
              isForbiddenByAvailabilityPin(candidate, availabilityPin)),
    maxCandidates: 10,
  })
  cronAudit.rejected.push(...availableTarget.rejected)
  cronAudit.skipped_alpha_fold =
    Number(cronAudit.skipped_alpha_fold || 0) + availableTarget.skippedIneligible
  targetProtein = availableTarget.protein
  const structureMeta = availableTarget.structureMeta
  if (!targetProtein || !structureMeta?.r2Key) {
    throw new Error(
      `Pre-warm found no reachable target structure for ${tomorrowStr} (${cronAudit.rejected.length} candidates rejected)`,
    )
  }

  console.log(`[CRON] Structure verified: ${structureMeta.r2Key} for ${tomorrowStr}`)

  // 4. Record the pick first, so the recap and every visitor have it even if nobody
  // plays tomorrow and even if a later write fails.
  if (!(await recordDailyPickOnce(env, tomorrowStr, targetProtein.uniprot, cronAudit))) {
    throw new Error(`Pre-warm could not record puzzle_actual:${tomorrowStr}`)
  }
  console.log(`[CRON] puzzle_actual:${tomorrowStr} written`)

  // 5. Pre-warm bootstrap KV cache for tomorrow (for all public origins)
  const origins = [
    "https://brinedew.bio",
    "https://geneguessr.brinedew.bio",
    "https://iconoplasm.brinedew.bio",
  ]
  for (const origin of origins) {
    const structureSelection = await buildTargetStructureSelection(targetProtein, {
      practiceMode: false,
      origin,
    })
    const structureToken = structureSelection?.token || null
    if (!structureToken) continue
    await setDailyBootstrapCache(
      env,
      tomorrowStr,
      origin,
      targetProtein,
      structureToken,
      structureSelection.meta,
      cronAudit,
    )
  }
  console.log(`[CRON] Bootstrap cache warmed for ${tomorrowStr} (${origins.length} origins)`)

  console.log(`[CRON] Pre-warm complete: ${targetProtein.uniprot} (${source})`)
}

function parseCookies(cookieHeader) {
  const cookies = {}
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=")
    if (name) {
      cookies[name] = rest.join("=")
    }
  })
  return cookies
}

async function getAuthenticatedUserIdFromRequest(request, env) {
  const cookieHeader = request.headers.get("Cookie") || ""
  const cookies = parseCookies(cookieHeader)
  const authSession = cookies.session
  if (!authSession) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(authSession)) return null

  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${authSession}`)
    const stub = env.GAME_SESSIONS.get(id)
    const resp = await stub.fetch("http://internal/get")
    if (!resp.ok) return null
    const session = await resp.json()
    return session?.user_id || null
  } catch {
    return null
  }
}

/**
 * Check if request has a session cookie, if not generate one
 * Returns { sessionToken, isNew } where isNew indicates we need to set the cookie
 */
function resolveSessionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || ""
  const sessionMatch = cookieHeader.match(/geneguessr_session=([a-zA-Z0-9_-]+)/)

  if (sessionMatch) {
    return { sessionToken: sessionMatch[1], isNew: false }
  }

  // Generate a new random session token (URL-safe base64-ish)
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const sessionToken = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 32)

  return { sessionToken, isNew: true }
}

async function resolveSessionContextAsync(request, env, options = {}) {
  const url = new URL(request.url)
  const practiceMode = url.searchParams.get("practice") === "1"
  const practiceRestart = practiceMode && url.searchParams.get("restart") === "1"
  const { sessionToken, isNew } = resolveSessionCookie(request)
  const guestBaseSessionId = `guest_${sessionToken}`

  const authenticatedUserId = await getAuthenticatedUserIdFromRequest(request, env)
  const baseSessionId = authenticatedUserId ? `user_${authenticatedUserId}` : guestBaseSessionId

  // Optional migration: if the user just logged in, keep their current same-day progress.
  // Only do this on bootstrap to avoid extra DO reads on every guess/hint.
  if (options.migrateGuestState && authenticatedUserId) {
    const today = new Date().toISOString().slice(0, 10)
    const userSessionId = practiceMode
      ? `practice_user_${authenticatedUserId}`
      : `user_${authenticatedUserId}`
    const guestSessionId = practiceMode ? `practice_${guestBaseSessionId}` : guestBaseSessionId
    try {
      const [userState, guestState] = await Promise.all([
        getGameState(env, userSessionId).catch(() => null),
        getGameState(env, guestSessionId).catch(() => null),
      ])

      const userGuesses = Array.isArray(userState?.guesses) ? userState.guesses.length : 0
      const guestGuesses = Array.isArray(guestState?.guesses) ? guestState.guesses.length : 0
      const shouldMigrate =
        guestState?.date === today &&
        (userState?.date !== today || userGuesses === 0) &&
        guestGuesses > 0

      if (shouldMigrate) {
        await saveGameState(env, userSessionId, guestState, {
          operation: "bootstrap_guest_state_migration",
          requestPath: "/api/game/bootstrap",
        })
      }
    } catch {
      // Non-fatal: fallback is a fresh user session.
    }
  }

  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId,
    sessionToken,
    needsSessionCookie: isNew,
    authenticatedUserId,
  }
}

/**
 * Build response headers, optionally adding Set-Cookie for new sessions
 * Cookie is HttpOnly, SameSite=Lax by default, 1 year expiry - "strictly necessary" for game function.
 *
 * Note: For localhost dev against a `*.workers.dev` API (cross-origin), SameSite=Lax cookies will not
 * be sent by the browser, which breaks session continuity (every request looks like a fresh session).
 * For those allowed dev origins, we switch to SameSite=None so local playtests behave like prod.
 */
function shouldUseSameSiteNoneCookie(origin, requestHost = "") {
  const lowerHost = String(requestHost || "").toLowerCase()
  const lowerOrigin = String(origin || "").toLowerCase()
  const isWorkersDev = lowerHost.endsWith(".workers.dev")
  const isLocalOrigin =
    lowerOrigin.startsWith("http://localhost") ||
    lowerOrigin.startsWith("http://127.0.0.1") ||
    lowerOrigin.startsWith("http://0.0.0.0")
  return isWorkersDev && isLocalOrigin
}

function buildResponseHeaders(corsHeaders, sessionContext, request) {
  if (!sessionContext?.needsSessionCookie) {
    return corsHeaders
  }

  let requestHost = ""
  try {
    requestHost = new URL(request?.url || "").hostname || ""
  } catch {
    requestHost = ""
  }
  const origin = request?.headers?.get?.("Origin") || ""
  const sameSite = shouldUseSameSiteNoneCookie(origin, requestHost) ? "None" : "Lax"

  const maxAge = 365 * 24 * 60 * 60 // 1 year in seconds
  const cookie = `geneguessr_session=${sessionContext.sessionToken}; Path=/; Max-Age=${maxAge}; SameSite=${sameSite}; HttpOnly; Secure`

  return {
    ...corsHeaders,
    "Set-Cookie": cookie,
  }
}

/**
 * Hash IP address for guest session identification
 */
async function getGameState(env, sessionId) {
  const id = env.GAME_SESSIONS.idFromName(sessionId)
  const stub = env.GAME_SESSIONS.get(id)
  const response = await stub.fetch("https://sessions/game/state", { method: "GET" })
  if (!response.ok) {
    throw new Error("Failed to load session state")
  }
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function saveGameState(env, sessionId, state, observation = {}) {
  // Keep the evidence path off the Durable Object itself. If GameSession writes are
  // what is failing, recording that failure through another GameSession write would
  // be a pretty spectacular own goal.
  return withObservedGameSessionWrite(
    env,
    {
      operation: observation?.operation || "game_session_state_write",
      requestPath: observation?.requestPath || null,
      sessionId,
    },
    async () => {
      const id = env.GAME_SESSIONS.idFromName(sessionId)
      const stub = env.GAME_SESSIONS.get(id)
      const response = await stub.fetch("https://sessions/game/state", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(state || null),
      })
      if (!response.ok) {
        throw new Error("Failed to persist session state")
      }
    },
  )
}

async function checkD1Health(db) {
  try {
    const result = await db.prepare("SELECT 1 as test").first()
    return result?.test === 1 ? "connected" : "error"
  } catch (e) {
    return "error"
  }
}

async function checkKVHealth(kv) {
  // Read-only probe. A GET exercises the binding + KV read path and is enough to
  // confirm connectivity. We deliberately do NOT write here: KV writes are the
  // scarce free-tier resource (1k/day), and a health endpoint that writes per hit
  // is a latent budget sink the moment any uptime monitor points at it. A missing
  // key returns null without throwing, which still proves the binding works.
  try {
    await kv.get("health_check")
    return "connected"
  } catch (e) {
    return "error"
  }
}

/**
 * GameSession Durable Object
 * Manages per-user game sessions and guest rate limiting
 */
export class GameSession {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Route requests
    if (path === "/game/state" && request.method === "GET") {
      return this.getGameState()
    } else if (path === "/game/state" && request.method === "POST") {
      return this.setGameState(request)
    } else if (path === "/game/results" && request.method === "GET") {
      return Response.json(await getPendingResults(this.state.storage))
    } else if (path === "/game/results/ack" && request.method === "POST") {
      const { date } = await request.json()
      await ackCompletedResult(this.state.storage, date)
      return Response.json({ success: true })
    } else if (path === "/store" && request.method === "POST") {
      // Internal route for OAuth session storage
      return this.storeData(request)
    } else if (path === "/get" && request.method === "GET") {
      // Internal route for OAuth session retrieval
      return this.getData()
    } else if (path === "/consume" && request.method === "POST") {
      // OAuth callbacks must be one-shot. Reading and deleting in one Durable
      // Object transaction prevents two callback requests from reusing state.
      return this.consumeData()
    } else if (path === "/reset" && request.method === "POST") {
      // Internal route for clearing OAuth session
      return this.clearData()
    } else if (path === "/auth/resolve" && request.method === "POST") {
      return this.resolveAuthSession()
    } else if (path === "/auth/patch" && request.method === "POST") {
      return this.patchAuthSession(request)
    } else {
      return new Response("Not found", { status: 404 })
    }
  }

  async getGameState() {
    const state = await this.state.storage.get("game_state")
    return new Response(JSON.stringify(state || null), {
      headers: JSON_HEADERS,
    })
  }

  async setGameState(request) {
    const payload = await request.json()
    await storeGameState(this.state.storage, payload)
    return new Response(JSON.stringify({ success: true }), {
      headers: JSON_HEADERS,
    })
  }

  /**
   * Store arbitrary data (for OAuth sessions)
   * Internal route only
   */
  async storeData(request) {
    const data = await request.json()
    await this.state.storage.put("data", data)
    if (Number.isFinite(data?.delete_storage_at)) {
      await this.state.storage.setAlarm(data.delete_storage_at)
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  /**
   * Get stored data (for OAuth sessions)
   * Internal route only
   */
  async getData() {
    let data = (await this.state.storage.get("data")) || {}
    if (data.user_id && this.env?.DB) {
      let hydrated
      try {
        hydrated = await hydrateBrinedewSessionAccountIdentity(this.env.DB, data)
      } catch (error) {
        if (error instanceof BrinedewAccountIdentityError && error.status < 500) {
          await this.state.storage.deleteAll()
          return Response.json(
            { error: "Brinedew account identity is not active" },
            { status: 401, headers: { "X-Brinedew-Account-Status": "identity_unlinked" } },
          )
        }
        console.warn("Brinedew account status could not be verified for a stored session", {
          error: error?.message || String(error || "unknown"),
        })
        return Response.json({ error: "Account status unavailable" }, { status: 503 })
      }
      if (!hydrated.active) {
        await this.state.storage.deleteAll()
        return Response.json(
          { error: "Brinedew account is not active" },
          {
            status: 401,
            headers: { "X-Brinedew-Account-Status": hydrated.session.account_status },
          },
        )
      }
      data = hydrated.session
      if (hydrated.changed) await this.state.storage.put("data", data)
    }
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json" },
    })
  }

  async resolveAuthSession() {
    const resolve = async () => {
      let stored = (await this.state.storage.get("data")) || {}
      let accountIdentityChanged = false
      if (stored?.user_id && this.env?.DB) {
        let hydrated
        try {
          hydrated = await hydrateBrinedewSessionAccountIdentity(this.env.DB, stored)
        } catch (error) {
          if (error instanceof BrinedewAccountIdentityError && error.status < 500) {
            await this.state.storage.deleteAll()
            return Response.json(
              { error: "Brinedew account identity is not active" },
              { status: 401, headers: { "X-Brinedew-Account-Status": "identity_unlinked" } },
            )
          }
          console.warn("Brinedew account status could not be verified for an auth session", {
            error: error?.message || String(error || "unknown"),
          })
          return Response.json({ error: "Account status unavailable" }, { status: 503 })
        }
        if (!hydrated.active) {
          await this.state.storage.deleteAll()
          return Response.json(
            { error: "Brinedew account is not active" },
            {
              status: 401,
              headers: { "X-Brinedew-Account-Status": hydrated.session.account_status },
            },
          )
        }
        stored = hydrated.session
        accountIdentityChanged = hydrated.changed
      }
      const result = await resolveDiscordSessionAuthorization(stored, this.env)
      const resolvedSession = result.session
      if (result.changed || accountIdentityChanged) {
        await this.state.storage.put("data", resolvedSession)
        if (
          result.outcome === "reauthorization_required" &&
          stored.tier !== "registered" &&
          this.env?.DB
        ) {
          try {
            await this.env.DB.prepare(
              `UPDATE users SET tier = ?, updated_at = ? WHERE discord_id = ?`,
            )
              .bind("registered", Date.now(), stored.user_id)
              .run()
          } catch (error) {
            console.warn("Discord authorization downgrade could not update the user projection", {
              error: error?.message || String(error || "unknown"),
            })
          }
        }
      }
      return new Response(JSON.stringify(resolvedSession || {}), {
        headers: {
          "Content-Type": "application/json",
          "X-Brinedew-Discord-Authorization": result.outcome,
        },
      })
    }
    return typeof this.state.blockConcurrencyWhile === "function"
      ? this.state.blockConcurrencyWhile(resolve)
      : resolve()
  }

  async patchAuthSession(request) {
    const patch = await request.json()
    const stored = (await this.state.storage.get("data")) || {}
    const expectedAccessToken = String(patch?.expected_access_token || "")
    if (expectedAccessToken && expectedAccessToken !== String(stored.access_token || "")) {
      return Response.json({ applied: false }, { status: 409 })
    }
    for (const key of ["tier", "is_guild_member", "last_discord_role_verify"]) {
      if (Object.hasOwn(patch || {}, key)) stored[key] = patch[key]
    }
    await this.state.storage.put("data", stored)
    return Response.json({ applied: true })
  }

  /**
   * Atomically retrieve and delete one-time data (OAuth callback state).
   */
  async consumeData() {
    let data
    await this.state.storage.transaction(async (transaction) => {
      data = await transaction.get("data")
      if (data !== undefined) {
        await transaction.delete("data")
      }
    })
    return new Response(JSON.stringify(data || {}), {
      headers: { "Content-Type": "application/json" },
    })
  }

  /**
   * Clear stored data (for logout)
   * Internal route only
   */
  async clearData() {
    await this.state.storage.deleteAll()
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })
  }

  async alarm() {
    // OAuth attempts that are abandoned at Discord should not leave Durable
    // Object storage behind forever. Only records with delete_storage_at set
    // schedule this alarm; persistent login sessions are unaffected.
    await this.state.storage.deleteAll()
  }
}

/**
 * Build structure token payload for a target protein.
 * Shared by bootstrap (embedded) and structure-token endpoint (fallback).
 * Returns null if structure unavailable.
 *
 * IMPORTANT: target tokens deliberately point at `type=target`, not at a
 * concrete `key=pdb/...` or `key=swissmodel/...` URL. That is both a gameplay
 * rule and a correctness rule:
 *
 * - Gameplay: putting `pdb/1B64.bcif` directly in the browser-visible URL leaks
 *   the answer path for some targets.
 * - Correctness: the token format and the bytes served by `type=target` must be
 *   derived from the same server-owned `structureMeta`. If bootstrap says
 *   `format: "bcif"` while `/api/structure-cached?type=target` independently
 *   falls back to a `.pdb` SWISS-MODEL file, Mol* receives PDB text through a
 *   BCIF parser and throws opaque internal errors like
 *   `Cannot read properties of undefined (reading 'transform')`.
 *
 * Do not "simplify" this by rebuilding the target URL from whatever cache key
 * is convenient. The URL is intentionally opaque; the selected bytes are pinned
 * in session state and resolved server-side.
 */
function buildTargetStructureTokenFromMeta(meta, { practiceMode, origin }) {
  if (!meta) return null

  const practiceParam = practiceMode ? "&practice=1" : ""
  const structureUrl = `${origin}/api/structure-cached?type=target${practiceParam}`

  return {
    sourceLabel: meta.shortLabel,
    displayLabel: `Source: ${meta.shortLabel}`,
    format: meta.format || "cif",
    url: structureUrl,
    targetChainHints: null,
    totalChainCount: 0,
  }
}

function sameStructureMeta(a, b) {
  if (!a || !b) return false
  return (
    a.source === b.source &&
    a.r2Key === b.r2Key &&
    a.upstreamUrl === b.upstreamUrl &&
    a.format === b.format &&
    a.shortLabel === b.shortLabel
  )
}

function isSessionTargetStructureMetaStillValid(protein, meta) {
  // General stale-state rule, learned the hard way on 2026-05-19:
  // a browser reload is not a state reset.
  //
  // Ctrl+Shift+R / "hard reload" can bypass the HTTP cache, but it does not
  // delete:
  //
  // - Durable Object session state
  // - KV entries
  // - D1 rows
  // - IndexedDB / localStorage / sessionStorage in every browser profile
  //
  // The Edge recurrence of the Mol* `transform` crash happened because Edge had
  // a still-valid session cookie pointing at a Durable Object state record that
  // was written during the broken deployment. Chrome looked fixed because its
  // session happened to be clean; Edge was still faithfully replaying old
  // server-side state. Any future migration that changes the meaning of a stored
  // field must validate that field against the current source of truth, not just
  // assume the latest code will overwrite it.
  //
  // For target structures, the current explicit DB structure source is the
  // compatibility boundary. A session pin is allowed to win only while it still
  // matches that DB-backed decision.
  if (!meta?.r2Key || !meta?.upstreamUrl) {
    return false
  }

  const explicitMeta = getCanonicalStructureMeta(protein)
  if (!explicitMeta) {
    return true
  }

  return sameStructureMeta(meta, explicitMeta)
}

async function buildTargetStructureSelection(protein, { practiceMode, origin }) {
  if (!protein) return null

  const meta = getCanonicalStructureMeta(protein)
  if (!meta) {
    console.warn("GeneGuessr: buildTargetStructureToken - no structure meta for", protein.uniprot)
    return null
  }

  // This function is the single place that pairs target structure metadata with
  // the browser token that describes it. Keep `meta` and `token` together.
  //
  // Historical failure, 2026-05-19:
  // - Bootstrap chose the DB-backed RCSB PDB structure for P24534 and emitted a
  //   BCIF token.
  // - `/api/structure-cached?type=target` later re-ran source selection and hit a
  //   stale KV entry for the same UniProt that pointed at SWISS-MODEL PDB text.
  // - The browser had no way to detect the disagreement before Mol* tried to
  //   parse the wrong format and crashed.
  //
  // The permanent invariant is: if a player is shown a token, the session must
  // store the exact metadata that the target endpoint will use for bytes.

  // ⚠️ LAZY LOADING: Don't fetch structure bytes on bootstrap.
  // Bytes are fetched from the provider on the /api/structure-cached request. This
  // avoids adding a multi-second upstream fetch to every bootstrap, but it does NOT
  // mean bootstrap and structure fetch may make separate source choices.

  // Parse chain labels to create redacted hints for the target. These hints must
  // describe the same source as `meta`; mixing PDB hints with SWISS-MODEL bytes
  // would be another form of the same split-brain bug.
  let targetChainHints = null
  let totalChainCount = 0
  const chainLabelsRaw =
    meta.source === "alphafold"
      ? null
      : meta.source === "swissmodel"
        ? protein.swissmodel_chain_labels
        : protein.pdb_chain_labels
  if (chainLabelsRaw) {
    try {
      const chainLabels =
        typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
      totalChainCount = chainLabels?.reduce((sum, l) => sum + (l.chains?.length || 0), 0) || 0
      targetChainHints = chainLabels?.filter((l) => l.is_target)?.map((l) => ({ chains: l.chains }))
      if (targetChainHints?.length === 0) targetChainHints = null
    } catch (e) {
      console.warn("Failed to parse chain_labels for target hints", e)
    }
  }

  return {
    meta,
    token: {
      ...buildTargetStructureTokenFromMeta(meta, { practiceMode, origin }),
      targetChainHints,
      totalChainCount,
    },
  }
}

async function buildTargetStructureToken(protein, options) {
  const selection = await buildTargetStructureSelection(protein, options)
  return selection?.token || null
}

/**
 * Build structure token for a guess protein: where the browser loads the structure
 * from, and its labels. Fetches nothing, so it can be derived from a row that is
 * already loaded: the guess response, the bootstrap's guess entries and
 * `/api/structure-token?uniprot=` all return exactly this object.
 * Returns null if the protein has no stored structure.
 *
 * A guess is not a secret (the player typed it), so its structure loads straight from
 * the provider: `directUrl` is the stored upstream URL the Worker route would have
 * fetched, and a view of it costs no Worker request. `url` is the same structure
 * through the Worker route, which the page uses only if the provider fails for that
 * visitor. `directUrl` appears only if it passes the provider allowlist.
 *
 * NEVER build a target token with this function. The target's structure stays behind
 * `buildTargetStructureTokenFromMeta`'s opaque `type=target` URL, because a provider
 * URL or a structure key would name the answer.
 */
function buildGuessStructureToken(protein, { origin }) {
  if (!protein) return null

  const meta = getCanonicalStructureMeta(protein)
  if (!meta) {
    console.warn("GeneGuessr: buildGuessStructureToken - no structure meta for", protein.uniprot)
    return null
  }

  // ⚡ LAZY STRUCTURE: Don't fetch the structure during guess submission; the browser
  // loads the bytes itself. This saves 2-4 seconds per guess.

  // The fallback route takes only the key. It finds the upstream itself: RCSB for a
  // PDB id, and the protein's stored row for SWISS-MODEL and AlphaFold, whose URLs
  // carry templates, ranges and isoform numbers that the key does not.
  const structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(meta.r2Key)}`

  // Parse chain labels if present
  let chainLabels = null
  const chainLabelsRaw =
    meta.source === "alphafold"
      ? null
      : meta.source === "swissmodel"
        ? protein.swissmodel_chain_labels
        : protein.pdb_chain_labels
  if (chainLabelsRaw) {
    try {
      chainLabels = typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
    } catch (e) {
      console.warn("Failed to parse chain_labels for guess", e)
    }
  }

  return {
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || "cif",
    url: structureUrl,
    ...(isStructureProviderUrl(meta.upstreamUrl) ? { directUrl: meta.upstreamUrl } : {}),
    cacheKey: meta.r2Key,
    chainLabels,
    linkUrl: meta.linkUrl,
  }
}

async function handleStructureToken(request, env, corsHeaders) {
  try {
    const url = new URL(request.url)
    const type = url.searchParams.get("type")
    if (type === "target") {
      // Fallback endpoint for clients without embedded bootstrap token.
      // Most calls should be eliminated by embedding token in bootstrap payload.
      const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env)
      let protein = null

      try {
        const state = await getGameState(env, sessionId)
        console.log(`[B-206] structure-token: sessionId=${sessionId}, targetId=${state?.targetId}`)
        if (state?.targetId) {
          protein = await fetchProteinByUniprot(env.DB, state.targetId)
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to get target from session, falling back to daily", err)
      }

      if (!protein) {
        protein = await getDailyTargetProtein(env, { practice: practiceMode })
      }

      if (!protein) {
        console.error("GeneGuessr: handleStructureToken - no target protein found")
        return Response.json({ error: "Target unavailable" }, { status: 500, headers: corsHeaders })
      }

      console.log(
        "GeneGuessr: handleStructureToken (fallback) - building token for",
        protein.uniprot,
      )
      const token = await buildTargetStructureToken(protein, {
        practiceMode,
        origin: url.origin,
      })

      if (!token) {
        return Response.json(
          { error: "Structure unavailable" },
          { status: 404, headers: corsHeaders },
        )
      }

      return Response.json(token, { headers: corsHeaders })
    }

    const uniprot = (url.searchParams.get("uniprot") || "").toUpperCase()
    if (!uniprot) {
      return Response.json(
        { error: "Missing uniprot parameter" },
        { status: 400, headers: corsHeaders },
      )
    }
    // A structure exists only for a protein in the catalog that has a stored
    // structure source. The row is the whole decision: nothing is fetched, probed
    // or written here, whatever accession a caller makes up.
    const protein = await fetchProteinByUniprot(env.DB, uniprot)
    const meta = protein ? getCanonicalStructureMeta(protein) : null
    if (!meta) {
      return Response.json(
        { error: "Structure unavailable" },
        { status: 404, headers: corsHeaders },
      )
    }

    return Response.json(buildGuessStructureToken(protein, { origin: url.origin }), {
      headers: corsHeaders,
    })
  } catch (err) {
    console.error("GeneGuessr: handleStructureToken unhandled error", err)
    return Response.json(
      { error: "Internal server error", details: String(err) },
      { status: 500, headers: corsHeaders },
    )
  }
}

/**
 * Serves structure files by streaming them from the provider.
 *
 * Callers: the page for the daily target (`type=target`, never stored anywhere), the
 * page for a guess whose provider failed for that visitor (the guess token's `url`),
 * the Discord recap render page and the admin preview. A guess's ordinary view does
 * not come here: the page loads it from the provider named by the token's `directUrl`
 * (B-943), so it costs no Worker request.
 *
 * CRITICAL ARCHITECTURE DECISIONS (do not revert without understanding):
 *
 * 1. The upstream URL is never taken from the caller. A key-based request
 *    learns it from the key: RCSB for `pdb/` keys, the stored `proteins` row for
 *    `alphafold/` and `swissmodel/` keys, and the derived AlphaFold file as the
 *    last resort. A caller-chosen URL would make this public GET an open relay
 *    that serves the caller's own bytes from our origin. Every fetch also goes
 *    through `fetchStructureUpstream`, which allows https on exactly three
 *    provider hosts and checks each redirect hop. The response's Content-Type is
 *    set from the key's format, never copied from the upstream.
 *
 * 2. The body is streamed and never buffered, and it is capped at
 *    MAX_STRUCTURE_FILE_BYTES counted as it arrives (`limitStructureBody`).
 *    Do not trust an upstream `Content-Length`: RCSB sends none, AlphaFold's is the
 *    gzip size (workerd drops it on decompression) and SWISS-MODEL's depends on the
 *    encoding it negotiates. Past the cap the upstream is cancelled and
 *    the response errors. A SWISS-MODEL PDB gets its anonymous HEADER line
 *    streamed ahead of the body, not prepended to a buffered copy: one 5.5 MB
 *    model buffered twice is 11 MB of a 128 MB isolate that serves many requests.
 *    There is no R2 cache in front of this route (R2 is not enabled on the
 *    account), so every view is one Worker request and one provider fetch.
 *
 * 3. `type=target` must prefer the session-pinned `targetStructureMeta`.
 *    The target structure endpoint is not a general "pick the best structure
 *    again" endpoint. Bootstrap already picked the structure and told the
 *    browser its format. If this endpoint reconsiders the source from the DB
 *    independently, it can serve bytes that disagree with the token. That exact
 *    split caused the live P24534 incident on 2026-05-19: bootstrap advertised
 *    RCSB BCIF while a stale cached structure source routed bytes to a
 *    SWISS-MODEL PDB file. Mol* then failed deep inside its transform pipeline.
 *
 *    The order below is therefore deliberate:
 *    a. Load the game session.
 *    b. Use `state.targetStructureMeta` only if it is still compatible with the
 *       current DB-backed source decision.
 *    c. Backfill from canonical metadata if old state lacks the pin or carries
 *       a stale pre-migration pin.
 *    d. Save the backfill so subsequent requests stop re-deciding.
 *
 *    Do not make `type=target` depend on a browser-provided upstream hint. Do
 *    not silently fall back to a different source after the token has already
 *    reached the player.
 *
 * 4. Treat Durable Object state as persistent migration data.
 *    If one browser keeps failing while another works, do not stop at "clear
 *    cache" advice. Browsers can share the same deployment and different server
 *    sessions. A hard reload bypasses static assets; it does not erase the DO
 *    record selected by that browser's cookie. Any stored session field that can
 *    outlive a deploy needs a compatibility check before it is trusted.
 */
async function handleCachedStructureFetch(request, env, corsHeaders) {
  const url = new URL(request.url)
  let cacheKey = url.searchParams.get("key")
  let protein = null // Hoist to function scope for lazy loading
  let targetStructureMeta = null

  // SECURITY + CORRECTNESS: `type=target` fetches the current target without
  // exposing the storage key, and it keeps the response bytes aligned with the
  // already-issued target token. The old bug was not that Mol* was fragile; it
  // was that this endpoint could choose a different source than bootstrap.
  const type = url.searchParams.get("type")
  if (type === "target") {
    const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env)
    let state = null

    try {
      state = await getGameState(env, sessionId)
      console.log("GeneGuessr: structure-cached targetId from session:", state?.targetId)
      if (state?.targetId) {
        protein = await fetchProteinByUniprot(env.DB, state.targetId)
        console.log(
          "GeneGuessr: structure-cached protein from DB:",
          protein?.uniprot,
          protein?.gene,
          protein?.structure_source,
        )
      }
    } catch (err) {
      console.warn("GeneGuessr: structure-cached target lookup failed", err)
    }

    if (!protein) {
      try {
        protein = await getDailyTargetProtein(env, { practice: practiceMode })
      } catch (err) {
        console.warn("GeneGuessr: structure-cached daily target lookup failed", err)
        protein = null
      }
      console.log(
        "GeneGuessr: structure-cached fallback to daily:",
        protein?.uniprot,
        protein?.gene,
      )
    }

    // D1-independent byte delivery. The exact structure identity was already
    // selected and issued to this browser with the bootstrap target token, and
    // the session pins that same identity. Serving bytes must not depend on a
    // fresh D1 target-selection read: on 2026-09-11 an account-wide D1 read
    // limit turned an available RCSB structure into 404 "Target unavailable".
    // Prefer the issued day cache (authoritative for today), then the session
    // pin, and only re-derive from the DB when neither is present. This keeps
    // the token/bytes invariant because every source here is the exact metadata
    // that produced the token the client already holds.
    let issuedFromDailyCache = false
    if (!practiceMode) {
      const dailyCached = await getDailyBootstrapCache(
        env,
        new Date().toISOString().slice(0, 10),
        url.origin,
      )
      if (dailyCached?.structureMeta?.r2Key) {
        targetStructureMeta = dailyCached.structureMeta
        issuedFromDailyCache = true
      }
      if (!protein && dailyCached?.targetProtein) {
        protein = dailyCached.targetProtein
      }
    }
    if (!protein && !targetStructureMeta?.r2Key && state?.targetStructureMeta?.r2Key) {
      targetStructureMeta = state.targetStructureMeta
    }

    if (!protein && !targetStructureMeta?.r2Key) {
      return Response.json({ error: "Target unavailable" }, { status: 404, headers: corsHeaders })
    }

    if (protein && !issuedFromDailyCache) {
      // First-class invariant: a valid session-pinned metadata value wins. This
      // field is the server's memory of "what structure did we tell this player
      // they are looking at?" Valid pins are deliberately stronger than KV.
      //
      // Compatibility check matters for old Edge/Chrome profiles that loaded the
      // game during the 2026-05-19 incident. Those sessions may already contain a
      // bad pin such as `swissmodel/P24534_5dqs.pdb` while the current DB row says
      // `structure_source='pdb', pdb_id='1B64'`. If we blindly trust that old pin,
      // Ctrl+Shift+R cannot fix the browser because the stale value lives in the
      // Durable Object session, not in the HTTP cache. A pin is authoritative only
      // while it still matches the current explicit stored source for the target.
      targetStructureMeta = state?.targetStructureMeta || null
      if (!isSessionTargetStructureMetaStillValid(protein, targetStructureMeta)) {
        // Old or corrupted sessions created before the pin invariant was correct
        // have only `targetId`, or have a pin that contradicts today's DB-backed
        // source. Backfill once from the canonical source and persist it. This is
        // not a convenience fallback; it is a migration path that moves stale
        // browser sessions onto the same invariant as new sessions.
        targetStructureMeta = getCanonicalStructureMeta(protein)
        if (
          targetStructureMeta?.r2Key &&
          state?.targetId &&
          !sameStructureMeta(state.targetStructureMeta, targetStructureMeta)
        ) {
          state.targetStructureMeta = targetStructureMeta
          try {
            await saveGameState(env, sessionId, state, {
              operation: "structure_cached_target_selection_backfill",
              requestPath: "/api/structure-cached",
            })
          } catch (err) {
            console.warn(
              "GeneGuessr: failed to backfill target structure selection",
              err?.message || err,
            )
          }
        }
      }
    }
    console.log(
      "GeneGuessr: structure-cached meta:",
      targetStructureMeta?.source,
      targetStructureMeta?.r2Key,
    )
    if (!targetStructureMeta?.r2Key) {
      return Response.json(
        { error: "Structure unavailable" },
        { status: 404, headers: corsHeaders },
      )
    }
    cacheKey = targetStructureMeta.r2Key
  }

  if (!cacheKey) {
    return Response.json({ error: "Missing key parameter" }, { status: 400, headers: corsHeaders })
  }

  // Validate cacheKey format to prevent path traversal
  // Valid formats: "pdb/XXXX.bcif", "alphafold/XXXXX.cif", "swissmodel/XXXXX.pdb"
  const validKeyPattern = /^(pdb|alphafold|swissmodel)\/[A-Za-z0-9_-]+\.(bcif|cif|pdb)$/
  if (!validKeyPattern.test(cacheKey)) {
    return Response.json({ error: "Invalid key format" }, { status: 400, headers: corsHeaders })
  }

  // The media type follows the key's format, never the upstream's header, and the
  // browser may not sniff it into anything else: these bytes are served from our
  // API origin.
  const contentType = structureContentType(structureFormatFromKey(cacheKey))
  const bodyTypeHeaders = { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" }

  const derivePdbUpstreamUrl = (id, format) => {
    if (format === "bcif") {
      return `https://models.rcsb.org/v1/${id}/full?encoding=bcif&copy_all_categories=false`
    }
    return `https://models.rcsb.org/${id}.${format}`
  }

  const resolveMetaFromCacheKey = async () => {
    const [source, filename] = cacheKey.split("/")
    const format = filename.endsWith(".bcif") ? "bcif" : filename.endsWith(".pdb") ? "pdb" : "cif"
    const id = filename.replace(/\.(bcif|cif|pdb)$/, "")

    if (source === "pdb") {
      return {
        r2Key: cacheKey,
        upstreamUrl: derivePdbUpstreamUrl(id, format),
        format,
        source,
      }
    }

    let row = null
    // ⚠️ COST BARRIER: compare the bare `uniprot` column to an upper-cased bound
    // value, never `upper(uniprot) = ?`. The column is UNIQUE and every stored
    // accession is already upper-case (19,110 of 19,110 on 2026-10-03; the other
    // reader, fetchProteinByUniprot, relies on the same contract). Wrapping the
    // column in a function defeats the index and reads the whole table: 19,110 rows
    // for each view of a guess structure. Every SWISS-MODEL or AlphaFold key reaches
    // this lookup (nothing caches the bytes), so that cost grows with players. A test
    // pins one row read per request at production shape.
    const structureRowSql = `SELECT uniprot, structure_source, pdb_id, alphafold_url, swissmodel_url, swissmodel_template
      FROM proteins
      WHERE uniprot = ?`
    try {
      if (source === "alphafold" && env?.DB?.prepare) {
        row = await env.DB.prepare(structureRowSql).bind(id.toUpperCase()).first()
      } else if (source === "swissmodel" && env?.DB?.prepare) {
        const uniprotFromKey = id.includes("_") ? id.slice(0, id.indexOf("_")) : ""
        if (uniprotFromKey) {
          row = await env.DB.prepare(structureRowSql).bind(uniprotFromKey.toUpperCase()).first()
        }
      }
    } catch (err) {
      console.warn(
        "GeneGuessr: failed to recover structure metadata from DB for",
        cacheKey,
        err?.message || err,
      )
    }

    if (row) {
      const exactStoredMeta = buildStoredStructureCandidates(row).find(
        (candidate) => candidate?.r2Key === cacheKey,
      )
      if (exactStoredMeta?.upstreamUrl) {
        return exactStoredMeta
      }
    }

    if (source === "alphafold") {
      return {
        r2Key: cacheKey,
        upstreamUrl: `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v6.cif`,
        format,
        source,
      }
    }

    return null
  }

  // The target's pinned structure, or the structure the key names.
  const meta =
    type === "target" && protein
      ? targetStructureMeta || getCanonicalStructureMeta(protein)
      : await resolveMetaFromCacheKey()

  if (!meta?.upstreamUrl || !isStructureProviderUrl(meta.upstreamUrl)) {
    if (meta?.upstreamUrl) {
      console.warn("GeneGuessr: structure upstream is not on a provider host", cacheKey)
    }
    return Response.json({ error: "Structure unavailable" }, { status: 404, headers: corsHeaders })
  }

  console.log(`[STRUCTURE] Fetching ${cacheKey} from ${meta.upstreamUrl}`)
  let upstreamResp
  try {
    upstreamResp = await fetchStructureUpstream(meta.upstreamUrl, {
      method: "GET",
      headers: { "User-Agent": "GeneGuessr-Worker/1.0" },
    })
  } catch (err) {
    if (!(err instanceof StructureUpstreamRefusedError)) throw err
    console.warn("GeneGuessr: structure upstream redirect refused", cacheKey, err.message)
    return Response.json(
      { error: "Upstream structure unavailable" },
      { status: 502, headers: corsHeaders },
    )
  }

  if (!upstreamResp.ok || !upstreamResp.body) {
    console.warn(
      "GeneGuessr: upstream structure fetch failed",
      meta.upstreamUrl,
      upstreamResp.status,
    )
    return Response.json(
      { error: "Upstream structure unavailable" },
      { status: 502, headers: corsHeaders },
    )
  }

  // Stream the body to the browser, never buffer it, and cut it off past
  // MAX_STRUCTURE_FILE_BYTES however the upstream announced (or did not announce)
  // its size. SWISS-MODEL PDB responses commonly omit the HEADER record Mol*
  // requires, so that one anonymous line is streamed ahead of the body.
  const body = limitStructureBody(upstreamResp.body, {
    prefix: structureNeedsAnonymousHeader(cacheKey) ? ANONYMOUS_PDB_HEADER : null,
    onTooLarge: (bytes) =>
      console.warn("GeneGuessr: upstream structure over the size cap", cacheKey, `${bytes} bytes`),
  })

  const responseHeaders = {
    ...corsHeaders,
    ...bodyTypeHeaders,
    // The target changes daily but its URL is static, so it is never stored. A key
    // names one structure, so the browser keeps it a week.
    "Cache-Control":
      type === "target"
        ? "private, no-store, must-revalidate"
        : "public, max-age=604800, immutable",
  }
  return new Response(body, { headers: responseHeaders })
}

/**
 * ⚠️ DAILY BOOTSTRAP CACHE ⚠️
 *
 * Caches the expensive-to-compute parts of daily mode bootstrap:
 * - Target protein metadata
 * - Structure token (source, URL, chain hints, etc.)
 *
 * This eliminates D1 queries for repeat visitors on the same day.
 * KV lookup: ~1-5ms vs full computation: ~500-2000ms
 *
 * The 23:55 pre-warm verifies the structure and writes one entry per public
 * origin; a visitor with no entry for their origin writes it once. An entry is
 * served for the whole UTC day as written: a reader never probes a provider,
 * rewrites the entry or deletes it, because a probe that misses its 5 second timer
 * proves nothing about the structure and every refresh is a KV write against the
 * account's 1,000 a day (B-918). An override deletes the day's entries.
 */
async function getDailyBootstrapCache(env, date, origin) {
  const cacheKey = buildDailyBootstrapCacheKey(date, origin)
  try {
    const cached = await env.KV.get(cacheKey, { type: "json" })
    if (cached) {
      console.log(`[PERF] Daily bootstrap cache HIT for ${date}`)
      return cached
    }
  } catch (e) {
    console.warn("Daily bootstrap cache read failed:", e)
  }
  return null
}

async function setDailyBootstrapCache(
  env,
  date,
  origin,
  targetProtein,
  structureToken,
  structureMeta,
  audit,
) {
  const cacheKey = buildDailyBootstrapCacheKey(date, origin)
  const payload = {
    origin,
    targetProtein,
    structureToken,
    structureMeta,
    audit: audit || null,
    cachedAt: Date.now(),
  }
  try {
    // Calculate TTL to expire at end of day (UTC)
    const now = new Date()
    const endOfDay = new Date(date + "T23:59:59.999Z")
    const ttlSeconds = Math.max(60, Math.floor((endOfDay - now) / 1000))
    await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSeconds })
    console.log(`[PERF] Daily bootstrap cache SET for ${date} (TTL: ${ttlSeconds}s)`)
  } catch (e) {
    console.warn("Daily bootstrap cache write failed:", e)
  }
}

function buildDailyBootstrapCacheKey(date, origin) {
  const safeDate = String(date || "").trim()
  let hostKey = "unknown"
  try {
    hostKey = new URL(String(origin || "")).host.toLowerCase() || hostKey
  } catch {
    hostKey =
      String(origin || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "") || hostKey
  }
  return `${DAILY_BOOTSTRAP_CACHE_PREFIX}${safeDate}:${hostKey}`
}

async function getProdDailyBootstrapCache(env, date) {
  if (!env?.PROD_KV?.get) {
    return null
  }

  const candidateOrigins = [
    `https://${GENEGUESSR_HOST}`,
    "https://brinedew.bio",
    "https://www.brinedew.bio",
  ]
  for (const origin of candidateOrigins) {
    const keyed = await env.PROD_KV.get(buildDailyBootstrapCacheKey(date, origin), {
      type: "json",
    })
    if (keyed) {
      return keyed
    }
  }

  // Legacy single-origin key fallback (pre origin-scoped cache keys).
  return env.PROD_KV.get(`${DAILY_BOOTSTRAP_CACHE_PREFIX}${date}`, {
    type: "json",
  })
}

/**
 * ⚠️ PERFORMANCE CRITICAL - BOOTSTRAP LATENCY DIRECTLY AFFECTS TTFP ⚠️
 *
 * This handler is the main bottleneck for initial page load.
 * Every millisecond here = millisecond of blank screen for users.
 *
 * OPTIMIZATIONS APPLIED:
 * 1. DAILY CACHE: KV lookup for target + structure token (~1-5ms vs ~500-2000ms)
 * 2. Parallel fetch (daily mode): getDailyTargetProtein runs concurrently with
 *    session load. Practice mode reads the session first and picks only when
 *    nothing names a target, because a returning player's pick was discarded.
 * 3. Batched hydration: hydrateGuessProteins uses Promise.all, not sequential loop
 * 4. Skip redundant work: similarity scores not recalculated if already stored
 *
 * DO NOT add sequential awaits here without measuring impact.
 * DO NOT call hydrateGuessProteins with sequential DB calls.
 */
async function handleGameBootstrap(request, env, ctx, corsHeaders) {
  console.log("[BOOTSTRAP] Handler started")
  try {
    const sessionContext = await resolveSessionContextAsync(request, env, {
      migrateGuestState: true,
    })
    const { sessionId, practiceMode, practiceRestart } = sessionContext
    console.log(`[BOOTSTRAP] Session resolved: practiceMode=${practiceMode}`)
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)
    const url = new URL(request.url)
    const today = new Date().toISOString().slice(0, 10)

    // The graphics settings ride along (B-957): the admin tunes them live in KV, the first viewer
    // needs them, and the page used to spend a Worker request on them. The read starts now and
    // runs beside everything below; one that fails leaves the page the defaults.
    const graphicsSettingsRead = readGraphicsSettings(env, request).catch((err) => {
      console.warn(
        "GeneGuessr: graphics settings unreadable, serving defaults",
        err?.message || err,
      )
      return DEFAULT_GRAPHICS_SETTINGS
    })

    // ⚠️ DAILY MODE: CHECK KV CACHE FIRST ⚠️
    // Eliminates D1 queries for repeat visitors (~500-2000ms savings)
    let cachedDaily = null
    if (!practiceMode) {
      cachedDaily = await getDailyBootstrapCache(env, today, url.origin)
    }

    // Staging-only: If prod has already recorded today's actual pick, ensure our daily bootstrap cache
    // matches it. This prevents a stale staging cache from masking the mirrored prod target.
    if (!practiceMode && cachedDaily && env.PROD_KV?.get) {
      try {
        let prodUniprot = ""
        const prodActualRaw = await env.PROD_KV.get(`puzzle_actual:${today}`)
        if (prodActualRaw) {
          const prodActual = JSON.parse(prodActualRaw)
          prodUniprot = (prodActual?.uniprot_id || "").toString().trim().toUpperCase()
        }
        if (!prodUniprot) {
          const prodDailyCache = await getProdDailyBootstrapCache(env, today)
          prodUniprot = (prodDailyCache?.targetProtein?.uniprot || "")
            .toString()
            .trim()
            .toUpperCase()
        }

        const cachedUniprot = (cachedDaily?.targetProtein?.uniprot || "")
          .toString()
          .trim()
          .toUpperCase()
        if (prodUniprot && cachedUniprot && prodUniprot !== cachedUniprot) {
          console.log(
            `[BOOTSTRAP] Staging cache mismatch with prod; ignoring cache (${cachedUniprot} != ${prodUniprot})`,
          )
          cachedDaily = null
        }
      } catch (err) {
        console.warn(
          "GeneGuessr: failed to validate staging bootstrap cache against prod",
          err?.message || err,
        )
      }
    }
    console.log(`[BOOTSTRAP] Cache checked: ${cachedDaily ? "HIT" : "MISS"}`)

    let targetSeedRaw = null
    let existingState = null
    if (practiceMode) {
      // ⚠️ PRACTICE READS THE SESSION BEFORE IT PICKS ⚠️
      // A returning player's own session names their target, and so can a stored
      // practice pool, a `date=` link or `same_target=1`. A pick made in parallel
      // with the session read is thrown away in all of those cases, yet it costs a
      // D1 round, an outbound structure probe the player waits for, and a KV put
      // on every page load. So the pick happens below, only when nothing names a
      // target. A browser with no session cookie has no session (the id is minted
      // for this request), so it skips the read and reaches the pick at once.
      const sessionCannotExist =
        sessionContext.needsSessionCookie && !sessionContext.authenticatedUserId
      existingState = sessionCannotExist
        ? null
        : await getGameState(env, sessionId).catch(() => null)
    } else {
      // ⚠️ PARALLEL FETCH - DO NOT SERIALIZE ⚠️
      // Daily target lookup and session state load are independent
      // Running in parallel saves 50-150ms per request
      console.log("[BOOTSTRAP] Starting parallel fetch: targetSeed + existingState")
      const [dailyTarget, dailyState] = await Promise.all([
        cachedDaily?.targetProtein
          ? Promise.resolve(cachedDaily.targetProtein) // Use cached target
          : getDailyTargetProtein(env, { practice: false, returnAudit: true }),
        getGameState(env, sessionId).catch(() => null), // Graceful fallback if session doesn't exist
      ])
      targetSeedRaw = dailyTarget
      existingState = dailyState
    }
    let targetSeed = targetSeedRaw?.protein ? targetSeedRaw.protein : targetSeedRaw
    // Prefer audit from the API response, but fall back to cached audit from bootstrap cache
    const targetAudit = targetSeedRaw?.audit ? targetSeedRaw.audit : cachedDaily?.audit || null
    console.log(
      `[BOOTSTRAP] Session and target loaded: targetSeed=${targetSeed?.uniprot || "null"}, hasSession=${Boolean(existingState)}`,
    )

    // When set, `date` should override any existing practice session for today.
    let dateOverrideUniprot = null
    let dateOverrideProtein = null

    // Practice-list overrides:
    // - `date=YYYY-MM-DD` loads a historical daily puzzle for sharing with friends.
    // - `same_target=1&target_id=...` replays the same (already revealed) practice target.
    // - If `existingState.practicePool` exists, restarts pick from that pool instead of global practice picking.
    if (practiceMode) {
      // Historical puzzle sharing: ?practice=1&date=YYYY-MM-DD
      // Check PROD_KV first (for staging), fall back to local KV
      const dateParam = url.searchParams.get("date")
      console.log(
        `[BOOTSTRAP] Practice mode: dateParam=${dateParam}, hasProdKV=${!!env.PROD_KV?.get}`,
      )
      if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        let puzzleActual = null
        if (env.PROD_KV?.get) {
          puzzleActual = await env.PROD_KV.get(`puzzle_actual:${dateParam}`, { type: "json" })
          console.log(
            `[BOOTSTRAP] PROD_KV lookup: key=puzzle_actual:${dateParam}, found=${!!puzzleActual}`,
          )
        }
        if (!puzzleActual) {
          puzzleActual = await env.KV.get(`puzzle_actual:${dateParam}`, { type: "json" })
          console.log(
            `[BOOTSTRAP] Local KV lookup: key=puzzle_actual:${dateParam}, found=${!!puzzleActual}`,
          )
        }
        if (puzzleActual?.uniprot_id) {
          console.log(`[BOOTSTRAP] Found puzzle_actual with uniprot_id=${puzzleActual.uniprot_id}`)
          const historicalProtein = await fetchProteinByUniprot(env.DB, puzzleActual.uniprot_id)
          if (historicalProtein) {
            dateOverrideUniprot = historicalProtein.uniprot
            dateOverrideProtein = historicalProtein
            targetSeed = historicalProtein
            console.log(`[BOOTSTRAP] Practice mode: loaded historical puzzle from ${dateParam}`)
          } else {
            console.log(
              `[BOOTSTRAP] Failed to fetch protein for uniprot_id=${puzzleActual.uniprot_id}`,
            )
          }
        } else {
          console.log(`[BOOTSTRAP] No puzzle_actual found for date=${dateParam}`)
        }
      }

      const sameTargetRequested = url.searchParams.get("same_target") === "1"
      const requestedTargetId = sameTargetRequested
        ? (url.searchParams.get("target_id") || "").trim().toUpperCase() || null
        : null

      const pool = Array.isArray(existingState?.practicePool)
        ? existingState.practicePool.filter(Boolean)
        : []
      let desiredUniprot = null
      if (dateOverrideUniprot) {
        desiredUniprot = dateOverrideUniprot
      } else if (sameTargetRequested && requestedTargetId) {
        desiredUniprot = requestedTargetId
      } else if (!practiceRestart && existingState?.targetId && existingState?.date === today) {
        desiredUniprot = existingState.targetId
      } else if (pool.length) {
        desiredUniprot = pool[Math.floor(Math.random() * pool.length)]
      }

      if (desiredUniprot) {
        const overrideProtein =
          dateOverrideProtein && desiredUniprot === dateOverrideUniprot
            ? dateOverrideProtein
            : await fetchProteinByUniprot(env.DB, desiredUniprot)
        if (overrideProtein) {
          targetSeed = overrideProtein
          console.log(
            `[BOOTSTRAP] Practice override target: ${overrideProtein.uniprot} (poolSize=${pool.length})`,
          )
        }
      }

      // Nothing named a loadable target (a first-time or restarting player with no
      // stored pool, yesterday's session, or a named protein the catalog lacks):
      // pick one from the stored practice pool.
      if (!targetSeed) {
        targetSeed = await getDailyTargetProtein(env, { practice: true })
      }
    }

    if (!targetSeed && !practiceMode) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    // Determine if session needs reset (uses pre-fetched existingState)
    // When the daily schedule gives a different target than the session's pin,
    // the daily schedule wins — this handles admin overrides after users already
    // have sessions, without any separate session-cleanup step.
    const forceReset =
      practiceRestart ||
      (practiceMode && dateOverrideUniprot && existingState?.targetId !== dateOverrideUniprot) ||
      (!practiceMode &&
        targetSeed &&
        existingState?.targetId &&
        existingState.targetId !== targetSeed.uniprot)

    const state = await ensureSessionForTodayWithState(env, sessionId, targetSeed, existingState, {
      practiceMode,
      forceReset,
      preservePracticePool: true,
      writeObservation: {
        operation: "bootstrap_session_ensure",
        requestPath: "/api/game/bootstrap",
      },
    })
    console.log(
      `[B-206] bootstrap: sessionId=${sessionId}, forceReset=${forceReset}, targetId=${state.targetId}, seedId=${targetSeed?.uniprot}`,
    )
    const targetProtein =
      targetSeed && state.targetId === targetSeed.uniprot
        ? targetSeed
        : await fetchProteinByUniprot(env.DB, state.targetId)
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    // ⚠️ PARALLEL EXECUTION - structure token + guess hydration run concurrently.
    // This eliminates a client-side /api/structure-token round-trip, but the
    // structure selection still has to be treated as durable state, not just as
    // an optimization artifact. The token describes what Mol* will parse. The
    // matching `structureMeta` describes what `/api/structure-cached?type=target`
    // will serve. Persist them together so the player path is:
    //
    //   bootstrap token.format
    //     == session.targetStructureMeta.format
    //     == structure endpoint response bytes
    //
    // If a future refactor keeps the token but drops the `structureMeta` save,
    // it reopens the exact 2026-05-19 failure: RCSB/BCIF token with SWISS-MODEL
    // PDB bytes because another resolver path found stale cache state.
    let structureToken = cachedDaily?.structureToken || null
    let structureMeta = isSessionTargetStructureMetaStillValid(
      targetProtein,
      state?.targetStructureMeta,
    )
      ? state.targetStructureMeta
      : cachedDaily?.structureMeta || null
    if (
      state?.targetStructureMeta &&
      !isSessionTargetStructureMetaStillValid(targetProtein, state.targetStructureMeta)
    ) {
      // Existing sessions from before the source-of-truth fix can carry a bad
      // pin. Force a fresh selection even if daily bootstrap cache has a token,
      // otherwise the bootstrap response and the target endpoint can remain
      // split for that one browser forever.
      //
      // This is the "works in Chrome, fails in Edge after Ctrl+Shift+R" class of
      // failure. The browser reloads the page, but the Worker still loads the
      // same Durable Object state through the same cookie. Do not remove this
      // compatibility gate unless there is a stronger migration for every
      // existing GameSession object.
      structureToken = null
      structureMeta = null
    }
    // Older cached tokens used a relative `url` (e.g. `/api/structure-cached?key=...`) which breaks
    // when the client page is not on the same origin as the API host (e.g. brinedew.bio → geneguessr.brinedew.bio).
    // They can also contain extra fields we no longer want to expose. Treat those as invalid and rebuild.
    const cachedTokenUrl = typeof structureToken?.url === "string" ? structureToken.url : ""
    const cachedTokenLooksLegacy = cachedTokenUrl.includes("/api/structure-cached?key=")
    if (cachedTokenLooksLegacy) {
      structureToken = null
    }
    const needsStructureToken = !structureToken

    const [_, freshStructureSelection] = await Promise.all([
      hydrateGuessProteins(env, sessionId, state, targetProtein),
      needsStructureToken
        ? buildTargetStructureSelection(targetProtein, {
            practiceMode,
            origin: url.origin,
          }).catch((err) => {
            console.warn("GeneGuessr: bootstrap structure token failed (non-fatal)", err)
            return null // Client falls back to /api/structure-token if null
          })
        : Promise.resolve(null), // Already have cached token
    ])

    // Use fresh token if we computed one. Keep the returned metadata with it;
    // separating these two values is the unsafe state.
    if (freshStructureSelection?.token) {
      structureToken = freshStructureSelection.token
      structureMeta = freshStructureSelection.meta || structureMeta
    }

    if (
      structureToken &&
      structureMeta &&
      !sameStructureMeta(state.targetStructureMeta, structureMeta)
    ) {
      // This write is intentional and budget-conscious: `sameStructureMeta`
      // prevents repeated Durable Object writes for equivalent metadata, while
      // still ensuring a newly selected target gets pinned before the browser
      // asks for bytes. Do not replace the value comparison with object identity;
      // cached JSON and freshly computed objects are different references even
      // when they describe the same structure.
      state.targetStructureMeta = structureMeta
      await saveGameState(env, sessionId, state, {
        operation: "bootstrap_target_structure_selection",
        requestPath: "/api/game/bootstrap",
      })
    }

    // Record what was actually shown to players (daily mode only).
    // Uses waitUntil so we don't add latency to bootstrap.
    if (!practiceMode && targetProtein?.uniprot) {
      const audit =
        targetAudit && targetAudit.date === today
          ? targetAudit
          : { date: today, source: "unknown", rejected: [] }
      ctx.waitUntil(recordDailyPickOnce(env, today, targetProtein.uniprot, audit))

      // ⚠️ POPULATE CACHE FOR NEXT REQUEST (daily mode only) ⚠️
      // Include audit so future cache hits preserve override source info.
      if (!cachedDaily && targetProtein && structureToken) {
        ctx.waitUntil(
          setDailyBootstrapCache(
            env,
            today,
            url.origin,
            targetProtein,
            structureToken,
            structureMeta,
            audit,
          ).catch((e) => console.warn("Cache population failed:", e)),
        )
      }
    }

    // If a completed daily game never got recorded (retry/crash), backfill aggregates in the background.
    // This stores only per-day guess counts (no user ids, no IPs).
    const guessStatsThrough = Number(state?.guessStatsRecordedThrough || 0)
    if (!practiceMode && (!Number.isFinite(guessStatsThrough) || guessStatsThrough === 0)) {
      ctx.waitUntil(
        (async () => {
          try {
            const latest = await getGameState(env, sessionId).catch(() => null)
            if (!latest) return
            const didUpdate = await maybeRecordDailyGuessAggregatesDelta(env, latest, {
              practiceMode,
            })
            if (didUpdate) {
              await saveGameState(env, sessionId, latest, {
                operation: "bootstrap_guess_aggregate_backfill",
                requestPath: "/api/game/bootstrap",
              })
            }
          } catch (err) {
            console.warn("Guess aggregate backfill failed (non-fatal):", err?.message || err)
          }
        })(),
      )
    }

    const payload = buildGamePayload(state, targetProtein, { structureTokenOrigin: url.origin })
    payload.graphicsSettings = publicGraphicsSections(await graphicsSettingsRead)
    // Embed structure token in bootstrap response - client uses this instead of separate API call
    if (structureToken) {
      try {
        if (typeof structureToken.url === "string" && structureToken.url.startsWith("/")) {
          structureToken = { ...structureToken, url: `${url.origin}${structureToken.url}` }
        }
      } catch {
        // ignore; client will fall back if needed
      }
      payload.targetStructureToken = structureToken
    }
    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: bootstrap failed", err)
    return Response.json(
      { error: "Failed to load game state" },
      { status: 500, headers: corsHeaders },
    )
  }
}

// Records the pick players are shown for `date`, once. Returns true when the record
// now names `uniprotId` (written now, or already there), and false when it does not: a
// failed write, an unreadable record, or a record that names a different pick, which is
// left as it is. It never throws, because the player path calls it from waitUntil; the
// pre-warm turns a false into a failed invocation.
async function recordDailyPickOnce(env, date, uniprotId, audit) {
  try {
    const key = `puzzle_actual:${date}`
    const existing = await env.KV.get(key)
    if (existing) {
      let existingRecord = null
      try {
        existingRecord = JSON.parse(existing)
      } catch {
        return false
      }
      const existingUniprot = String(existingRecord?.uniprot_id || "")
        .trim()
        .toUpperCase()
      const selectedUniprot = String(uniprotId || "")
        .trim()
        .toUpperCase()
      if (existingUniprot === selectedUniprot) {
        return true
      }
      console.warn(
        `[TARGET-PICK] Refusing to replace recorded ${date} target ${existingUniprot} with ${selectedUniprot}`,
      )
      return false
    }
    const record = {
      date,
      uniprot_id: uniprotId,
      source: audit?.source || "unknown",
      override_id: audit?.override_id || null,
      rejected: Array.isArray(audit?.rejected) ? audit.rejected : [],
      skipped_alpha_fold: Number.isFinite(audit?.skipped_alpha_fold)
        ? audit.skipped_alpha_fold
        : null,
      recorded_at: Date.now(),
    }
    const rejectedCount = Array.isArray(record.rejected) ? record.rejected.length : 0
    await env.KV.put(key, JSON.stringify(record), {
      metadata: {
        uniprot_id: record.uniprot_id,
        source: record.source,
        override_id: record.override_id,
        rejected_count: rejectedCount,
        recorded_at: record.recorded_at,
      },
    })
    return true
  } catch (err) {
    console.warn("Daily pick record write failed:", err)
    return false
  }
}

async function handleGuessSubmission(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId, practiceMode } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)

    const body = await safeJson(request)
    const uniprot = (body?.uniprot || "").toUpperCase()
    if (!uniprot) {
      return Response.json({ error: "Missing uniprot" }, { status: 400, headers: responseHeaders })
    }

    // ⚡ PERFORMANCE: Get state FIRST - it already contains the targetId
    // Avoids slow getDailyTargetProtein call on every guess (was ~2-3s for practice mode)
    let state = null
    try {
      state = await getGameState(env, sessionId)
    } catch (err) {
      console.warn("GeneGuessr: failed to load session for guess", err)
    }

    if (!state?.targetId) {
      // No session or missing target - this shouldn't happen in normal flow
      // Fall back to daily target lookup (slow path)
      const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode })
      if (!targetSeed && !practiceMode) {
        return Response.json(
          { error: "Target unavailable" },
          { status: 500, headers: responseHeaders },
        )
      }
      state = await ensureSessionForToday(env, sessionId, targetSeed, {
        practiceMode,
        writeObservation: {
          operation: "guess_session_ensure",
          requestPath: "/api/game/guess",
        },
      })
    }

    // ⚡ PERFORMANCE: Fetch target and guess proteins in parallel
    const [targetProtein, guessProtein] = await Promise.all([
      fetchProteinByUniprot(env.DB, state.targetId),
      fetchProteinByUniprot(env.DB, uniprot),
    ])

    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }
    if (!guessProtein) {
      return Response.json(
        { error: "Protein not found" },
        { status: 404, headers: responseHeaders },
      )
    }
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json(
        { error: "Round already completed" },
        { status: 409, headers: responseHeaders },
      )
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json(
        { error: "Protein already guessed" },
        { status: 409, headers: responseHeaders },
      )
    }

    // The score is part of the answer (B-957): one request for the guess, not a second for its
    // similarity. The embeddings read starts here and runs while the aggregates are recorded;
    // a correct guess is 100% and reads nothing.
    const correct = guessProtein.uniprot === targetProtein.uniprot
    const scorePromise = correct
      ? Promise.resolve(scoreGuess(guessProtein, targetProtein, { similarity: 100 }))
      : scoreAgainstTarget(env, guessProtein, targetProtein)
    const guessEntry = {
      guessId: crypto.randomUUID(),
      uniprot,
      correct,
      score: null, // set below, once the embeddings are read
      createdAt: Date.now(),
      protein: {
        ...guessProtein,
        gene_summary: cleanGeneSummary(guessProtein.gene_summary),
      },
    }
    state.guesses = [...(state.guesses || []), guessEntry]
    if (correct) {
      state.won = true
    } else {
      state.hintBalance = (state.hintBalance || 0) + HINT_REWARD_ON_INCORRECT
    }

    // Record aggregate guess stats for daily mode as the player guesses.
    // Stores only per-day counts (no user ids, no IPs) and is safe to retry.
    try {
      await maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode })
    } catch (err) {
      console.warn("Guess aggregate recording failed (non-fatal):", err?.message || err)
    }
    guessEntry.score = await scorePromise

    // ⚡ PERFORMANCE: Build guess structure token in parallel with saveGameState
    // This eliminates ~3s API round-trip on client after guess submission
    const url = new URL(request.url)
    const [, guessStructureToken] = await Promise.all([
      saveGameState(env, sessionId, state, {
        operation: "guess_submission",
        requestPath: "/api/game/guess",
      }),
      buildGuessStructureToken(guessProtein, { origin: url.origin }),
    ])

    const payload = buildGamePayload(state, targetProtein, { includeProteins: true })
    // Embed structure token so client can cache it immediately
    if (guessStructureToken) {
      payload.guessStructureToken = guessStructureToken
    }
    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: guess submission failed", err)
    const unavailable = proteinReadUnavailableResponse(err, corsHeaders)
    if (unavailable) return unavailable
    return Response.json(
      { error: "Guess submission failed" },
      { status: 500, headers: corsHeaders },
    )
  }
}

/**
 * ⚠️ PERFORMANCE CRITICAL - HINT REVEAL MUST BE FAST ⚠️
 *
 * This endpoint reveals a single hint. It should be INSTANT.
 *
 * BEFORE (slow - 2-3 seconds):
 *   - getDailyTargetProtein (2-3 DB queries)
 *   - ensureSessionForToday (DO read)
 *   - hydrateGuessProteins (N × 2-3 DB queries for ALL guesses)
 *   - buildGamePayload (CPU work to build full payload)
 *
 * AFTER (fast - <200ms):
 *   - Parallel: session state + target lookup
 *   - NO hydrateGuessProteins (client already has guess data!)
 *   - Minimal payload: just the hint text + updated status
 *
 * The client already has all guess proteins from bootstrap.
 * Hint reveal only needs to return the revealed text and updated hint balance.
 *
 * DO NOT add hydrateGuessProteins back. It's not needed here.
 * See Linear issue B-205 for full context.
 */
async function handleHintReveal(request, env, corsHeaders) {
  const t0 = Date.now()
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId, practiceMode } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)

    const body = await safeJson(request)
    const hintId = body?.hintId || body?.id
    if (!hintId) {
      return Response.json({ error: "Missing hintId" }, { status: 400, headers: responseHeaders })
    }
    const t1 = Date.now()

    // ⚠️ PERFORMANCE FIX: DON'T call getDailyTargetProtein here! ⚠️
    // getDailyTargetProtein validates structure availability with HTTP requests to upstream,
    // which takes 500-800ms. For hint reveals, we already HAVE a session with targetId.
    // Just load the existing state and fetch the protein directly from D1.
    const existingState = await getGameState(env, sessionId).catch(() => null)
    const t2 = Date.now()

    // For hint reveal, we MUST have an existing session (you can't reveal hints without playing)
    if (!existingState || !existingState.targetId) {
      return Response.json(
        { error: "No active game session" },
        { status: 400, headers: responseHeaders },
      )
    }

    // Use existing state directly - no need for ensureSessionForTodayWithState
    const state = existingState
    const t3 = Date.now()
    const targetProtein = await fetchProteinByUniprot(env.DB, state.targetId)
    const t4 = Date.now()
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    const clueSections = buildClueSections(targetProtein)
    const hintData = extractHintData(clueSections, hintId)
    if (!hintData || !hintData.text) {
      return Response.json({ error: "Hint not found" }, { status: 404, headers: responseHeaders })
    }

    // B-222: Locked hints are visible as spoiler bars but cannot be revealed early.
    // Clicking them should not spend credits.
    if (hintData.locked) {
      return Response.json(
        {
          lockedHint: { id: hintId, locked: true },
          status: {
            hintBalance: state.hintBalance,
            revealedHints: state.revealedHints || [],
          },
        },
        { headers: responseHeaders },
      )
    }

    // ⚠️ DO NOT CALL hydrateGuessProteins HERE ⚠️
    // Client already has guess data from bootstrap. We just need to reveal the hint.
    // Adding guess hydration here caused 3+ second delays (B-205).

    let t5 = t4
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json(
          { error: "Insufficient hints" },
          { status: 402, headers: responseHeaders },
        )
      }
      state.revealedHints = [...(state.revealedHints || []), hintId]
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST)
      await saveGameState(env, sessionId, state, {
        operation: "hint_reveal",
        requestPath: "/api/game/reveal-hint",
      })
      t5 = Date.now()
    }
    console.log(
      `[HINT REVEAL TIMING] parse:${t1 - t0}ms parallel:${t2 - t1}ms session:${t3 - t2}ms protein:${t4 - t3}ms save:${t5 - t4}ms total:${t5 - t0}ms`,
    )

    // ⚠️ CRITICAL PERFORMANCE - MINIMAL PAYLOAD ONLY ⚠️
    // DO NOT add guesses, clue, target, or ANY other data here!
    // The client does a surgical DOM update (just swaps the redaction span).
    // Adding more data triggers full re-render + 3D viewer reload = 3+ second delay.
    // See B-205 for the full horror story. This exact format is REQUIRED:
    return Response.json(
      {
        revealedHint: { id: hintId, text: hintData.text },
        status: {
          hintBalance: state.hintBalance,
          revealedHints: state.revealedHints,
        },
      },
      { headers: responseHeaders },
    )
  } catch (err) {
    console.error("GeneGuessr: hint reveal failed", err)
    const unavailable = proteinReadUnavailableResponse(err, corsHeaders)
    if (unavailable) return unavailable
    return Response.json({ error: "Hint reveal failed" }, { status: 500, headers: corsHeaders })
  }
}

/**
 * THE ONLY SIMILARITY SCORE PATH. A guess's score is its similarity to the target (HiG2Vec and
 * SaProt, blended), the ladder rank when the guess is one of the target's closest neighbours,
 * and the clue matches. The guess response carries it (B-957: it used to be a second request
 * after the card appeared, to save "1-2 seconds" that the in-isolate embedding caches and the
 * calibrated cosine no longer cost), and the bootstrap computes it for a guess a session stored
 * without one.
 *
 * A failed embeddings read must not fail the guess it belongs to: the player has made the move,
 * the hint is earned. The score then has no similarity, the card says N/A, and the next load
 * computes it (`hydrateGuessProteins` scores every guess that has none).
 */
async function scoreAgainstTarget(env, guessProtein, targetProtein) {
  let similarity = null
  let isLadder = false
  let ladderRank = null
  try {
    if (SIMILARITY_MODE === "blended") {
      const simResult = await getBlendedSimilarity(
        env.DB,
        guessProtein.gene || guessProtein.hgnc,
        targetProtein.gene,
        {
          esm2Weight: ESM2_WEIGHT,
          targetNeighbors: targetProtein.neighbors,
        },
      )
      similarity = simResult.blended
      isLadder = simResult.isLadder
      ladderRank = simResult.ladderRank
    } else {
      similarity = await getHig2vecSimilarity(
        env.DB,
        guessProtein.gene || guessProtein.hgnc,
        targetProtein.gene,
      )
    }
  } catch (err) {
    console.warn("GeneGuessr: similarity read failed, scoring without it", err?.message || err)
    similarity = null
    isLadder = false
    ladderRank = null
  }
  return scoreGuess(guessProtein, targetProtein, { similarity, isLadder, ladderRank })
}

function isForbiddenByAvailabilityPin(protein, availabilityPin) {
  if (!protein || !availabilityPin) {
    return false
  }
  const uniprot = String(protein.uniprot || "")
    .trim()
    .toUpperCase()
  const surname = getDailyTargetFamilyKey(protein)
  return (
    availabilityPin.forbidden_uniprot_ids.includes(uniprot) ||
    availabilityPin.forbidden_gene_surnames.includes(surname)
  )
}

async function getDailyTargetProtein(env, options = {}) {
  // Practice candidates come from the stored practice pool: the primary pick
  // first, then other random families for the availability walk below.
  const practiceIds = options.practice ? await pickPracticeCandidateIds(env.DB) : []
  if (options.practice && !practiceIds.length) {
    return null
  }

  let protein = null
  let startIdx = 0
  let explicitOverrideSelected = false
  let dailyCandidateIds = []
  let availabilityPin = null
  let computedDailySelection = null
  let dailySelectionAttempted = false
  // True when the pick is one the 23:55 pre-warm already verified and recorded (or the
  // production mirror of it). The player path serves such a pick as it is and never
  // probes it again: a probe that misses its 5 second timer proves nothing about a
  // structure (RCSB's ModelServer takes 2 to 5 seconds to build one), and acting on it
  // would swap a verified pick for the next candidate (B-918).
  let pickIsRecorded = false

  const wantsAudit = Boolean(options.returnAudit)
  const audit = wantsAudit
    ? {
        date: null,
        source: options.practice ? "practice" : "computed",
        override_id: null,
        rejected: [],
        skipped_alpha_fold: null,
      }
    : null

  if (options.practice) {
    // Practice mode: the first candidate that loads is the pick. Each candidate
    // is a different surname family, so the large families (ZNF, OR, KRTAP) weigh
    // no more than a family of one, and the availability walk below continues
    // with the candidates after it.
    for (let index = 0; index < practiceIds.length && !protein; index += 1) {
      protein = await fetchProteinByUniprot(env.DB, practiceIds[index])
      startIdx = index
    }
    if (protein) {
      console.log(`[PRACTICE] Balanced pick: ${protein.gene}`)
    }
  } else {
    // THE ONLY DAILY TARGET SELECTION PATH — DO NOT DUPLICATE. Read the
    // recorded server-side pick before loading the stored selection pool. The
    // pool (one D1 row) is needed only to choose a new pick or replace an
    // unplayable one.
    const today = new Date().toISOString().slice(0, 10)
    const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT
    if (audit) {
      audit.date = today
    }
    const overrideKey = `puzzle_override:${today}`
    let overrideId = await env.KV.get(overrideKey)
    if (!overrideId && env.PROD_KV?.get) {
      overrideId = await env.PROD_KV.get(overrideKey)
    }
    if (overrideId) {
      const overrideProtein = await fetchProteinByUniprot(env.DB, overrideId)
      if (overrideProtein) {
        protein = overrideProtein
        explicitOverrideSelected = true
        if (audit) {
          audit.source = "override"
          audit.override_id = overrideId
          audit.skipped_alpha_fold = 0
        }
      }
    }

    // A verified pre-warm pick is the production source of truth for the day.
    // Read it before recomputing so an origin cache miss cannot reshuffle the
    // target. Nothing on the player path verifies or replaces it: the pre-warm
    // probed its structure, and a structure that dies later is an override away.
    if (!protein) {
      try {
        const actualRaw = await env.KV.get(`puzzle_actual:${today}`)
        if (actualRaw) {
          const actual = JSON.parse(actualRaw)
          const actualUniprot = String(actual?.uniprot_id || "")
            .trim()
            .toUpperCase()
          if (actualUniprot) {
            const actualProtein = await fetchProteinByUniprot(env.DB, actualUniprot)
            if (actualProtein) {
              protein = actualProtein
              pickIsRecorded = true
              explicitOverrideSelected =
                actual?.source === "override" || Boolean(actual?.override_id)
              if (audit) {
                audit.source = actual?.source || "recorded_actual"
                audit.override_id = actual?.override_id || null
                audit.skipped_alpha_fold = Number.isFinite(actual?.skipped_alpha_fold)
                  ? actual.skipped_alpha_fold
                  : 0
              }
            }
          }
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to load recorded daily pick", err?.message || err)
      }
    }

    // Staging uses the same recorded production answer when it has no local
    // pick. Check that server-side record before computing a fresh selection,
    // so staging and production name the same target.
    if (!protein && env.PROD_KV?.get) {
      try {
        const prodActualRaw = await env.PROD_KV.get(`puzzle_actual:${today}`)
        if (prodActualRaw) {
          const prodActual = JSON.parse(prodActualRaw)
          const prodUniprot = (prodActual?.uniprot_id || "").toString().trim().toUpperCase()
          if (prodUniprot) {
            const prodProtein = await fetchProteinByUniprot(env.DB, prodUniprot)
            if (prodProtein) {
              protein = prodProtein
              pickIsRecorded = true
              if (audit) {
                audit.source = "prod_actual"
                audit.override_id = null
                audit.skipped_alpha_fold = 0
              }
            }
          }
        }

        // The verified production bootstrap can name the pick before its
        // puzzle_actual record appears.
        if (!protein) {
          const prodDailyCache = await getProdDailyBootstrapCache(env, today)
          const prodDailyUniprot = (prodDailyCache?.targetProtein?.uniprot || "")
            .toString()
            .trim()
            .toUpperCase()
          if (prodDailyUniprot) {
            const prodProtein = await fetchProteinByUniprot(env.DB, prodDailyUniprot)
            if (prodProtein) {
              protein = prodProtein
              pickIsRecorded = true
              if (audit) {
                audit.source = "prod_daily_cache"
                audit.override_id = null
                audit.skipped_alpha_fold = 0
              }
            }
          }
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to mirror prod daily pick", err?.message || err)
      }
    }

    // A future availability replacement is an automatic operational pin, not
    // a manual override. It keeps a dead curated structure out of the mystery
    // game without switching that protein to AlphaFold. The pin is valid only
    // for the exact selector salt and playable-pool fingerprint that produced
    // it; algorithm or pool changes fall back to normal computed selection.
    if (!protein) {
      try {
        dailySelectionAttempted = true
        computedDailySelection = await pickDailyTarget(env.DB, salt, today)
        dailyCandidateIds = computedDailySelection?.candidateIds || []
        if (computedDailySelection) {
          availabilityPin = await readDailyTargetAvailabilityPin(env.DB, {
            date: today,
            salt,
            selectionPoolFingerprint: computedDailySelection.poolFingerprint,
          })
        }
        if (availabilityPin?.uniprot_id) {
          const pinnedProtein = await fetchProteinByUniprot(env.DB, availabilityPin.uniprot_id)
          if (pinnedProtein && !isAlphaFoldOnlyProtein(pinnedProtein)) {
            protein = pinnedProtein
            startIdx = 0
            if (audit) {
              audit.source = "availability_replacement"
              audit.rejected = availabilityPin.rejected_uniprot_ids.map((uniprot) => ({
                uniprot_id: uniprot,
                reason: "catalog_render_unavailable",
              }))
              audit.skipped_alpha_fold = 0
            }
          }
        }
      } catch (err) {
        console.warn("GeneGuessr: failed to load availability replacement", err?.message || err)
      }
    }

    if (!protein) {
      if (!dailySelectionAttempted) {
        dailySelectionAttempted = true
        computedDailySelection = await pickDailyTarget(env.DB, salt, today)
      }
      dailyCandidateIds = computedDailySelection?.candidateIds || []
      protein = computedDailySelection?.protein || null
      if (audit) {
        audit.source = "computed"
        audit.skipped_alpha_fold = Number.isFinite(computedDailySelection?.skippedAlphaFold)
          ? computedDailySelection.skippedAlphaFold
          : null
      }
    }
  }

  // Validate the exact canonical structure before committing to a pick nobody has
  // verified yet (computed here, a pin, an override, a practice pick). A stored URL is
  // only metadata; it may still return 404 or 5xx. Preserve the curated source
  // decision, reject the whole protein when that source is unreachable, and advance
  // through the deterministic pool. A recorded pick skips this: see `pickIsRecorded`.
  if (protein && env && !pickIsRecorded) {
    const selectAvailable = (ids) =>
      selectAvailableDailyTarget({
        initialProtein: protein,
        eligibleIds: ids,
        startIndex: options.practice ? startIdx : 0,
        loadProtein: (uniprot) => fetchProteinByUniprot(env.DB, uniprot),
        resolveStructureMeta: (candidate) => getCanonicalStructureMeta(candidate),
        isStructureAvailable: (structureMeta, candidate) =>
          verifyDailyTargetStructure(env, structureMeta, candidate),
        isCandidateIneligible:
          options.practice || explicitOverrideSelected
            ? () => false
            : (candidate) =>
                isAlphaFoldOnlyProtein(candidate) ||
                (candidate.uniprot !== availabilityPin?.uniprot_id &&
                  isForbiddenByAvailabilityPin(candidate, availabilityPin)),
        maxCandidates: 10,
      })
    const availabilityIds = options.practice
      ? practiceIds
      : [protein.uniprot, ...dailyCandidateIds.filter((uniprot) => uniprot !== protein.uniprot)]
    let availableTarget = await selectAvailable(availabilityIds)
    if (!options.practice && !availableTarget.protein && !dailySelectionAttempted) {
      const today = new Date().toISOString().slice(0, 10)
      const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT
      dailySelectionAttempted = true
      computedDailySelection = await pickDailyTarget(env.DB, salt, today)
      dailyCandidateIds = computedDailySelection?.candidateIds || []
      if (dailyCandidateIds.length) {
        availableTarget = await selectAvailable([
          protein.uniprot,
          ...dailyCandidateIds.filter((uniprot) => uniprot !== protein.uniprot),
        ])
      }
    }
    if (audit) {
      audit.rejected.push(...availableTarget.rejected)
      audit.skipped_alpha_fold =
        Number(audit.skipped_alpha_fold || 0) + availableTarget.skippedIneligible
    }
    protein = availableTarget.protein

    if (!protein) {
      console.error(
        `[TARGET-PICK] Failed to find a reachable structure after ${availableTarget.rejected.length} candidates`,
      )
    } else {
      console.log(
        `[TARGET-PICK] ${protein.uniprot} verified with ${availableTarget.structureMeta.source} (${availableTarget.structureMeta.r2Key})`,
      )
      if (availableTarget.rejected.length > 0) {
        console.log(
          `[TARGET-PICK] Skipped ${availableTarget.rejected.length} proteins with unavailable structures`,
        )
      }
    }
  }

  return audit ? { protein, audit } : protein
}

function createInitialGameState(date, targetId, options = {}) {
  return {
    version: 2,
    date,
    targetId,
    guesses: [],
    hintBalance: DEFAULT_HINT_COST,
    revealedHints: [],
    won: false,
    guessStatsRecordedThrough: 0,
    practiceMode: Boolean(options.practiceMode),
    practicePool: Array.isArray(options.practicePool) ? options.practicePool.slice() : null,
    createdAt: Date.now(),
  }
}

async function maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode }) {
  const isPractice = Boolean(practiceMode) || Boolean(state?.practiceMode)
  if (isPractice) return false
  if (!state?.date || !state?.targetId) return false

  const guesses = Array.isArray(state.guesses) ? state.guesses : []
  let recordedThrough = Number(state.guessStatsRecordedThrough)
  if (!Number.isFinite(recordedThrough) || recordedThrough < 0) recordedThrough = 0

  // Backwards-compat: if an older session already marked aggregates as recorded, don't double-count.
  if (state.guessStatsRecorded === true && state.guessStatsRecordedThrough == null) {
    state.guessStatsRecordedThrough = guesses.length
    return false
  }

  if (guesses.length <= recordedThrough) return false

  const delta = guesses.slice(recordedThrough)
  const result = await recordDailyGuessAggregates(env.DB, {
    day: state.date,
    targetUniprot: state.targetId,
    guesses: delta,
  })

  if (!result.ok) return false
  state.guessStatsRecordedThrough = guesses.length
  return true
}

async function ensureSessionForToday(env, sessionId, targetProtein, options = {}) {
  const practiceMode = Boolean(options.practiceMode)
  const forceReset = Boolean(options.forceReset)
  const today = new Date().toISOString().slice(0, 10)
  let state = null
  try {
    state = await getGameState(env, sessionId)
  } catch (err) {
    console.warn("GeneGuessr: failed to load session, resetting", err)
    state = null
  }
  return ensureSessionForTodayWithState(env, sessionId, targetProtein, state, options)
}

/**
 * ⚠️ PERFORMANCE OPTIMIZATION - ACCEPTS PRE-FETCHED STATE ⚠️
 *
 * This variant accepts an already-fetched state to avoid redundant DO calls.
 * Used by handleGameBootstrap which fetches state in parallel with target protein.
 *
 * DO NOT remove this function or inline it - the parallel fetch optimization depends on it.
 */
async function ensureSessionForTodayWithState(
  env,
  sessionId,
  targetProtein,
  existingState,
  options = {},
) {
  const practiceMode = Boolean(options.practiceMode)
  const forceReset = Boolean(options.forceReset)
  const preservePracticePool = Boolean(options.preservePracticePool)
  const writeObservation = options.writeObservation || null
  const today = new Date().toISOString().slice(0, 10)
  let state = existingState
  const applyDesiredTarget = forceReset || !state
  const desiredTargetId = applyDesiredTarget && targetProtein ? targetProtein.uniprot : null
  const needsReset =
    forceReset ||
    !state ||
    state.date !== today ||
    (desiredTargetId && state.targetId !== desiredTargetId)
  if (needsReset) {
    if (!targetProtein?.uniprot) {
      throw new Error("Target protein required to initialize session")
    }
    const practicePool =
      practiceMode && preservePracticePool && Array.isArray(existingState?.practicePool)
        ? existingState.practicePool
        : null
    state = createInitialGameState(today, targetProtein.uniprot, { practiceMode, practicePool })
    await saveGameState(env, sessionId, state, writeObservation)
  } else if (state.practiceMode !== practiceMode) {
    state.practiceMode = practiceMode
    await saveGameState(env, sessionId, state, writeObservation)
  }
  return state
}

/**
 * ⚠️ PERFORMANCE CRITICAL - BATCHED HYDRATION ⚠️
 *
 * This function hydrates protein data and similarity scores for all guesses.
 *
 * BEFORE (slow): Sequential for-loop, N guesses × 2-3 DB calls each = 15+ serial queries
 * AFTER (fast): Promise.all for protein fetches, skip similarity if already stored
 *
 * For a returning player with 5 guesses, this saves 500-1500ms.
 *
 * DO NOT change this back to a sequential for-loop.
 * DO NOT recalculate similarity if entry.score already exists.
 */
async function hydrateGuessProteins(env, sessionId, state, targetProtein) {
  if (!Array.isArray(state?.guesses) || state.guesses.length === 0) {
    return
  }

  let dirty = false
  const validEntries = state.guesses.filter((e) => e != null)

  // ⚠️ BATCH PROTEIN FETCHES - DO NOT SERIALIZE ⚠️
  // Fetch all missing proteins in parallel
  const proteinFetchPromises = validEntries.map(async (entry) => {
    if (!entry.protein) {
      const protein = await fetchProteinByUniprot(env.DB, entry.uniprot)
      if (protein) {
        entry.protein = {
          ...protein,
          gene_summary: cleanGeneSummary(protein.gene_summary),
        }
        return true // indicates dirty
      }
    }
    return false
  })

  const proteinResults = await Promise.all(proteinFetchPromises)
  if (proteinResults.some((r) => r)) {
    dirty = true
  }

  // ⚠️ SKIP SIMILARITY RECALC IF THE SCORE EXISTS ⚠️
  // The guess handler scores a guess when it is made, so a stored guess already has its score and
  // recalculating on every bootstrap would waste 100-300ms per guess. A guess with none gets one
  // here: one whose embeddings read failed when it was made, or one an earlier version stored
  // as `similarityPending` (the flag is dropped).
  const entriesNeedingScore = validEntries.filter(
    (entry) => entry.protein && targetProtein && !entry.score?.similarity,
  )

  if (entriesNeedingScore.length > 0) {
    await Promise.all(
      entriesNeedingScore.map(async (entry) => {
        entry.score = await scoreAgainstTarget(env, entry.protein, targetProtein)
        delete entry.similarityPending
      }),
    )
    dirty = true
  }

  if (dirty && sessionId) {
    await saveGameState(env, sessionId, state, {
      operation: "hydrate_guess_proteins",
      requestPath: null,
    })
  }
}

// `options.structureTokenOrigin`: put each guess's structure token in its entry. The
// bootstrap sets it, because a page load needs a token for every guess and the row each
// token comes from is already loaded here; without it the browser asks
// `/api/structure-token` once per guess on every load.
function buildGamePayload(state, targetProtein, options = {}) {
  const revealedHints = new Set(state.revealedHints || [])
  const domainSpoilerTokens = getDomainSpoilerTokensFromFullName(targetProtein?.full_name)
  const clueSections = options.clueSections || buildClueSections(targetProtein)
  const maskedSections = maskClueSections(clueSections, revealedHints)
  const clueTarget = sanitizeTargetProtein(targetProtein, {
    revealIdentity: state.won || (state.guesses?.length || 0) >= MAX_GUESSES,
  })
  const guessEntries = []
  const aggregatedMatches = {}
  let latestMatches = {}
  ;(state.guesses || []).forEach((entry, index) => {
    const guessProtein = entry.protein || null
    if (!guessProtein) {
      return
    }
    const guessProteinCleaned = {
      ...guessProtein,
      gene_summary: cleanGeneSummary(guessProtein.gene_summary),
    }
    const resolvedScore = entry.score || scoreGuess(guessProtein, targetProtein)
    const matches = collectMatchedHintTexts(targetProtein, guessProtein, resolvedScore, {
      domainSpoilerTokens,
    })
    aggregateMatches(aggregatedMatches, matches)
    const isLatest = index === state.guesses.length - 1
    if (isLatest) {
      latestMatches = matches
    }
    const structureToken = options.structureTokenOrigin
      ? buildGuessStructureToken(guessProtein, { origin: options.structureTokenOrigin })
      : null
    guessEntries.push({
      ...(structureToken ? { structureToken } : {}),
      guessId: entry.guessId,
      uniprot: entry.uniprot,
      correct: Boolean(entry.correct),
      createdAt: entry.createdAt,
      score: resolvedScore,
      matchedHints: matches,
      sections: buildFeedbackSections(guessProteinCleaned, { domainSpoilerTokens }),
      headerLabel: guessProtein.hgnc || guessProtein.uniprot,
      fullName: guessProtein.full_name || "",
      isLatest,
    })
  })
  const lost = !state.won && guessEntries.length >= MAX_GUESSES
  const targetReveal =
    state.won || lost ? sanitizeTargetProtein(targetProtein, { revealIdentity: true }) : null
  const targetRevealSections = targetReveal ? buildFeedbackSections(targetProtein) : null
  const shareText = targetReveal ? buildShareText(state, guessEntries) : null
  applyMatchReveals(maskedSections, aggregatedMatches)

  // B-217: Some clue-domain items may be filtered out server-side.
  // Ensure clue highlight metadata only refers to items that actually exist in clue sections.
  const latestMatchesForClue = filterMatchesToExistingSectionItems(maskedSections, latestMatches)
  applyLatestHighlights(maskedSections, latestMatchesForClue)
  // Only reveal targetId after game ends (won or lost) to prevent cheating
  const gameOver = Boolean(state.won) || lost
  return {
    status: {
      date: state.date,
      won: Boolean(state.won),
      lost,
      guessCount: guessEntries.length,
      maxGuesses: MAX_GUESSES,
      hintBalance: state.hintBalance,
      revealedHints: state.revealedHints || [],
      practiceMode: Boolean(state.practiceMode),
      ...(gameOver && { targetId: state.targetId }),
    },
    clueTarget,
    clue: {
      sections: maskedSections,
      allMatches: aggregatedMatches,
      latestMatches: latestMatchesForClue,
    },
    guesses: guessEntries,
    targetReveal,
    targetRevealSections,
    shareText,
  }
}

function filterMatchesToExistingSectionItems(sections, matches) {
  if (!matches || typeof matches !== "object" || !Array.isArray(sections)) {
    return matches || {}
  }
  const filtered = {}
  for (const section of sections) {
    if (!section?.id || !Array.isArray(section.items)) {
      continue
    }
    const values = matches?.[section.id]
    if (!Array.isArray(values) || values.length === 0) {
      continue
    }
    const allowed = new Set(
      section.items
        .map((item) =>
          item?.fullText ? String(item.fullText) : item?.text ? String(item.text) : "",
        )
        .filter(Boolean),
    )
    const kept = values.filter((value) => allowed.has(value))
    if (kept.length) {
      filtered[section.id] = kept
    }
  }
  return filtered
}

function aggregateMatches(destination, matches) {
  Object.entries(matches || {}).forEach(([sectionId, values]) => {
    if (!destination[sectionId]) {
      destination[sectionId] = []
    }
    values.forEach((value) => {
      if (!destination[sectionId].includes(value)) {
        destination[sectionId].push(value)
      }
    })
  })
}

function buildShareText(state, guesses) {
  const emoji = state.won ? "You Win!" : "Game Over"
  const guessCount = guesses.length
  const today = state.date || new Date().toISOString().slice(0, 10)
  const grid = guesses
    .map((entry) => {
      if (entry.correct) {
        return "??"
      }
      const simScore = typeof entry.score?.similarity === "number" ? entry.score.similarity : 0
      return simScore >= 0.35 ? "??" : "?"
    })
    .join("")
  return `Geneguessr ${today}
${emoji} ${guessCount}/${MAX_GUESSES}

${grid}

https://geneguessr.brinedew.bio/`
}

function applyMatchReveals(sections, matches) {
  if (!Array.isArray(sections)) {
    return
  }
  sections.forEach((section) => {
    const matchedValues = matches?.[section.id]
    if (!Array.isArray(matchedValues) || matchedValues.length === 0) {
      return
    }
    const set = new Set(matchedValues)
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        return
      }
      // Don't reveal locked hints through matching
      if (item.locked) {
        return
      }
      if (set.has(item.fullText)) {
        item.revealed = true
        item.text = item.fullText
      }
    })
  })
}

function applyLatestHighlights(sections, latestMatches) {
  if (!Array.isArray(sections) || !latestMatches) {
    return
  }
  sections.forEach((section) => {
    const values = latestMatches?.[section.id]
    if (!Array.isArray(values) || !values.length) {
      section.items.forEach((item) => {
        if (item) {
          item.highlighted = false
        }
      })
      return
    }
    const set = new Set(values)
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        item && (item.highlighted = false)
        return
      }
      item.highlighted = set.has(item.fullText)
    })
  })
}

async function handlePracticeStart(request, env, ctx, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env)
    const { sessionId } = sessionContext
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext, request)
    const url = new URL(request.url)
    const practiceMode = url.searchParams.get("practice") === "1"
    if (!practiceMode) {
      return Response.json(
        { error: "Practice mode required" },
        { status: 400, headers: responseHeaders },
      )
    }

    const body = await safeJson(request)
    const raw = Array.isArray(body?.uniprots) ? body.uniprots : []
    const pool = []
    const seen = new Set()
    for (const value of raw) {
      const id = String(value || "")
        .trim()
        .toUpperCase()
      if (!id) continue
      if (seen.has(id)) continue
      seen.add(id)
      pool.push(id)
    }

    if (pool.length === 0) {
      return Response.json(
        { error: "Empty practice pool" },
        { status: 400, headers: responseHeaders },
      )
    }

    const today = new Date().toISOString().slice(0, 10)
    const targetId = pool[Math.floor(Math.random() * pool.length)]
    const targetProtein = await fetchProteinByUniprot(env.DB, targetId)
    if (!targetProtein) {
      return Response.json(
        { error: "Target unavailable" },
        { status: 500, headers: responseHeaders },
      )
    }

    const state = createInitialGameState(today, targetProtein.uniprot, {
      practiceMode: true,
      practicePool: pool,
    })

    let structureToken = null
    try {
      const structureSelection = await buildTargetStructureSelection(targetProtein, {
        practiceMode: true,
        origin: url.origin,
      })
      structureToken = structureSelection?.token || null
      if (structureSelection?.meta) {
        state.targetStructureMeta = structureSelection.meta
      }
    } catch (err) {
      console.warn("GeneGuessr: practice start structure token failed (non-fatal)", err)
      structureToken = null
    }

    await saveGameState(env, sessionId, state, {
      operation: "practice_start",
      requestPath: "/api/game/practice/start",
    })

    const payload = buildGamePayload(state, targetProtein)
    if (structureToken) {
      payload.targetStructureToken = structureToken
    }

    return Response.json(payload, { headers: responseHeaders })
  } catch (err) {
    console.error("GeneGuessr: practice start failed", err)
    return Response.json({ error: "Practice start failed" }, { status: 500, headers: corsHeaders })
  }
}

async function safeJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function hasStoredStructureSource(protein, source) {
  if (!protein || !source) {
    return false
  }
  if (source === "pdb") {
    return Boolean(protein.pdb_id)
  }
  if (source === "swissmodel") {
    return Boolean(protein.swissmodel_url)
  }
  if (source === "alphafold") {
    return Boolean(protein.alphafold_url)
  }
  return false
}

function buildStoredStructureCandidates(protein) {
  if (!protein) {
    return []
  }

  const candidates = []
  const seenKeys = new Set()
  const explicitSource = String(protein.structure_source || "")
    .trim()
    .toLowerCase()

  const pushCandidate = (source) => {
    if (!hasStoredStructureSource(protein, source)) {
      return
    }
    const meta = buildStructureMetaFromStoredSource({ ...protein, structure_source: source })
    if (!meta?.r2Key || seenKeys.has(meta.r2Key)) {
      return
    }
    seenKeys.add(meta.r2Key)
    candidates.push(meta)
  }

  pushCandidate(explicitSource)
  pushCandidate("pdb")
  pushCandidate("swissmodel")
  pushCandidate("alphafold")

  return candidates
}

// Whether a structure's upstream answers with usable bytes, for the daily-target
// availability check: tomorrow's puzzle is committed only if its exact structure
// loads (the 2026-07-17 IMMP2L target had a well-formed SWISS-MODEL URL that
// returned 404). One bounded ranged GET, five seconds at most.
async function isStructureMetaAvailable(meta) {
  if (!meta?.r2Key || !meta.upstreamUrl) {
    return false
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const upstreamResp = await fetchStructureUpstream(meta.upstreamUrl, {
      method: "GET",
      headers: {
        "User-Agent": "GeneGuessr-Worker/1.0",
        Range: "bytes=0-65535",
      },
      signal: controller.signal,
    })
    if (!upstreamResp.ok && upstreamResp.status !== 206) {
      return false
    }
    if (!upstreamResp.body) {
      return false
    }

    const reader = upstreamResp.body.getReader()
    try {
      const first = await reader.read()
      const probeBytes = first.value instanceof Uint8Array ? first.value : new Uint8Array()
      return isUsableStructureProbe({
        format: meta.format,
        contentType: upstreamResp.headers.get("Content-Type"),
        bytes: probeBytes,
      })
    } finally {
      await reader.cancel().catch(() => {})
    }
  } catch (err) {
    console.warn(`GeneGuessr: structure probe failed for ${meta.r2Key}`, err?.message || err)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function verifyDailyTargetStructure(env, structureMeta, protein) {
  const uniprot = String(protein?.uniprot || "")
    .trim()
    .toUpperCase()
  if (!uniprot || !structureMeta?.r2Key) {
    return false
  }

  const ready = await isStructureMetaAvailable(structureMeta)

  try {
    if (ready) {
      await clearStructureFailure(env?.DB, uniprot)
    } else {
      await markStructureFailure(env?.DB, uniprot)
    }
  } catch (err) {
    console.warn(
      `GeneGuessr: failed to persist structure health for ${uniprot}`,
      err?.message || err,
    )
  }

  return ready
}

// The stored `proteins.structure_source` is the canonical structure decision, and
// the only one. A protein with no stored source has no structure: nothing is
// discovered, probed or cached for it, whatever else its row holds (production, on
// 2026-10-03: 749 of 19,110 proteins have no source and none of the three structure
// columns; the other 18,361 each have the column their source needs). The row is
// returned without probing and without trying "better-looking" alternatives: a
// short network probe is not allowed to overrule it. On 2026-05-19 a stale cached
// source and an aborted five-second probe each made bootstrap and structure bytes
// disagree, and Mol* crashed on the mismatch.
function getCanonicalStructureMeta(protein) {
  const source = String(protein?.structure_source || "")
    .trim()
    .toLowerCase()
  if (!source) {
    return null
  }
  return buildStructureMetaFromStoredSource({ ...protein, structure_source: source })
}

function isAlphaFoldOnlyProtein(protein) {
  if (!protein) {
    return false
  }
  // With flat schema, just check if structure_source is alphafold
  return protein.structure_source === "alphafold"
}
