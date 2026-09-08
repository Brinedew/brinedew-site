import baseRuntime, {
  GameSession,
  IconoplasmVoteCoordinator,
  IconoplasmCardPublicationCoordinator,
  IconoplasmManifestationCutoverCoordinator,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
  serveIconoplasmReaderRecoveryGenePage,
  applySecurityHeaders,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  handleIconoplasmReaderRecoverySiteGeneDetail,
  handlePublishedImageAssetRoute,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  enforceIconoplasmRateLimit,
  withIconoplasmRateLimitHeaders,
} from "./iconoplasm-rate-limit.js"

export {
  GameSession,
  IconoplasmVoteCoordinator,
  IconoplasmCardPublicationCoordinator,
  IconoplasmManifestationCutoverCoordinator,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  IconoplasmSyncGovernor,
}

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const READER_RECOVERY_MODE = "reader-recovery"

function geneSymbolFromPath(pathname) {
  const match = /^\/gene\/([^/?#]+)\/?$/.exec(String(pathname || ""))
  if (!match) return ""
  try {
    return decodeURIComponent(match[1]).trim().toUpperCase()
  } catch {
    return String(match[1] || "")
      .trim()
      .toUpperCase()
  }
}

function readerRecoveryEnabled(env) {
  return (
    String(env?.ICONOPLASM_SCHEMA_TRANSITION || "") === "1" &&
    String(env?.ICONOPLASM_SCHEMA_TRANSITION_MODE || "").trim() === READER_RECOVERY_MODE
  )
}

function readerRecoveryResponse(response) {
  const headers = new Headers(response.headers)
  headers.set("X-B742-Reader-Recovery", "published-card-only")
  headers.set("X-Iconoplasm-Reader-Recovery", "published-card-only")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function serveReaderRecoveryRoute(request, env, ctx, url) {
  if (url.hostname !== ICONOPLASM_HOST || !readerRecoveryEnabled(env)) return null
  if (request.method !== "GET" && request.method !== "HEAD") return null
  const genePage = Boolean(geneSymbolFromPath(url.pathname))
  const geneDetail = /^\/api\/iconoplasm\/site\/genes\/[^/]+$/.test(url.pathname)
  const portraitMatch =
    /^\/portraits\/v1\/([a-f0-9]{2})\/([a-f0-9]{64})\/(?:full|medium|thumb)\.webp$/.exec(
      url.pathname,
    )
  const portrait = portraitMatch && portraitMatch[1] === portraitMatch[2].slice(0, 2)
  if (!genePage && !geneDetail && !portrait) return null

  const rateLimit = await enforceIconoplasmRateLimit(request, env)
  if (rateLimit.response) return readerRecoveryResponse(rateLimit.response)

  // Preserve IPD-001's first-party byte path when Bunny is unreachable in the
  // reader's network. The existing object adapter reads one immutable key;
  // it does not select canon, consult D1, or repair publication.
  if (portrait) {
    return readerRecoveryResponse(
      withIconoplasmRateLimitHeaders(
        await handlePublishedImageAssetRoute(request, env, ctx, url.pathname),
        rateLimit.headers,
      ),
    )
  }

  if (genePage) {
    return readerRecoveryResponse(
      withIconoplasmRateLimitHeaders(
        await serveIconoplasmReaderRecoveryGenePage(request, env, ctx),
        rateLimit.headers,
      ),
    )
  }

  if (geneDetail) {
    return readerRecoveryResponse(
      withIconoplasmRateLimitHeaders(
        await handleIconoplasmReaderRecoverySiteGeneDetail(request, env, url.pathname),
        rateLimit.headers,
      ),
    )
  }
  return null
}

const runtime = {
  async fetch(request, env, ctx) {
    const readerRecoveryResponseValue = await serveReaderRecoveryRoute(
      request,
      env,
      ctx,
      new URL(request.url),
    )
    if (readerRecoveryResponseValue)
      return applySecurityHeaders(readerRecoveryResponseValue, request)
    return baseRuntime.fetch(request, env, ctx)
  },
  scheduled(event, env, ctx) {
    return baseRuntime.scheduled(event, env, ctx)
  },
  queue(batch, env, ctx) {
    return baseRuntime.queue(batch, env, ctx)
  },
}

export default runtime
