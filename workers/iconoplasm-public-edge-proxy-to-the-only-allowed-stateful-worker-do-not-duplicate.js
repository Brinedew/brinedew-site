import { handleMe } from "./auth.js"
import { isAdmin } from "./admin.js"
import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { renderIconoplasmAdminHtml } from "./iconoplasm-admin-assets.js"
import { renderIconoplasmArtistStylesHtml } from "./iconoplasm-artist-styles-html.js"
import {
  ICONOPLASM_API_SCHEMA_VERSION as API_SCHEMA_VERSION,
  ICONOPLASM_PUBLIC_API_VERSION as PUBLIC_API_VERSION,
  ICONOPLASM_SITE_GENE_API_PREFIX as SITE_GENE_API_PREFIX,
  iconoplasmPublicApiPath as publicApiPath,
  matchIconoplasmRouteContract,
} from "./iconoplasm-route-contract.js"

// ARCHITECTURE FENCE [IPD-008]: trusted hover reads are admitted from the shared route contract.

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"
const PUBLIC_DUMP_PREFIX = "public-dumps"
const PUBLIC_DEFAULT_GENE_BATCH_LIMIT = 100
const PUBLIC_MAX_GENE_BATCH_LIMIT = 250
const PUBLIC_MAX_RESOLVE_BATCH_LIMIT = 250
const ICONOPLASM_CANON_REPAIR_PATH_ON_THE_ONLY_ALLOWED_STATEFUL_WORKER =
  "/__internal/iconoplasm/repair-canon-invariants"
const ICONOPLASM_INTERNAL_STATEFUL_WORKER_ORIGIN_DO_NOT_DUPLICATE =
  "https://the-only-allowed-internal-stateful-worker-do-not-duplicate"

export function isIconoplasmRequest(host) {
  return host === ICONOPLASM_HOST || String(host || "").startsWith("iconoplasm.")
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
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

function requestHeaderHost(request, headerName) {
  const raw = String(request.headers.get(headerName) || "").trim()
  if (!raw) return ""
  try {
    return new URL(raw).host.toLowerCase()
  } catch {
    return ""
  }
}

function extVersion(request) {
  return request.headers.get("x-iconoplasm-extension-version") || null
}

const TRUSTED_ICONOPLASM_CLIENT_HOSTS = new Set([
  "brinedew.bio",
  "www.brinedew.bio",
  "iconoplasm.brinedew.bio",
  "staging.brinedew.bio",
  "localhost",
  "127.0.0.1",
])

function hasTrustedIconoplasmBrowserOrigin(request) {
  const originHost = requestHeaderHost(request, "Origin")
  const refererHost = requestHeaderHost(request, "Referer")
  if (originHost && TRUSTED_ICONOPLASM_CLIENT_HOSTS.has(originHost)) return true
  if (refererHost && TRUSTED_ICONOPLASM_CLIENT_HOSTS.has(refererHost)) return true
  return false
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

function hasExtensionClientHeader(request) {
  return Boolean(String(extVersion(request) || "").trim())
}

function canAccessRichBatchRoute(request, env) {
  if (hasAdminToken(request, env)) return true
  if (hasExtensionClientHeader(request)) return true
  return hasTrustedIconoplasmBrowserOrigin(request)
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

function handlePublicSchema() {
  return json(publicSchemaDoc(), 200, { "Cache-Control": "public, max-age=3600" })
}

function publicCatalogJsonlFilename(hash) {
  return `catalog.${hash}.jsonl`
}

function publicCatalogJsonlDumpKey(hash) {
  return `${PUBLIC_DUMP_PREFIX}/${publicCatalogJsonlFilename(hash)}`
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

function normalizeArtistStylesPageHtml(htmlSource) {
  const source = String(htmlSource || "")
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

function isPathHandledAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  path,
  method = "GET",
) {
  const requestMethod = String(method || "GET").toUpperCase()
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(requestMethod)) return false
  const declaredRoute = matchIconoplasmRouteContract(path, requestMethod)
  if (declaredRoute) return declaredRoute.methodAllowed
  if (path.startsWith("/api/iconoplasm/")) {
    if (path === "/api/iconoplasm/admin/me") return false
    if (path === "/api/iconoplasm/votes/me") return false
    return true
  }
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
  // This proxy is the public safety fence. Do not "simplify" by handling these
  // routes directly in the caller worker. The previous arrangement left the D1
  // implementation close enough to public routes that one config mistake could
  // put raw database access back on hot traffic.
  const theOnlyAllowedStatefulWorker = env?.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE
  const url = new URL(request.url)
  if (
    !isPathHandledAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      url.pathname,
      request.method,
    )
  ) {
    return null
  }
  if (!theOnlyAllowedStatefulWorker || typeof theOnlyAllowedStatefulWorker.fetch !== "function") {
    return missingTheOnlyAllowedStatefulWorkerResponse()
  }
  // Hard-path rationale:
  // Website sync ingest batches can carry base64 payloads for three portrait
  // renditions per item. Re-buffering those POST bodies as text here doubles
  // memory pressure in the public edge worker and can turn a perfectly valid
  // internal request into a fake "stateful worker unavailable" 503 before the
  // real worker ever sees it. Forward the original request stream directly so
  // the public shell stays a thin transport boundary instead of becoming the
  // upload bottleneck.
  const upstreamRequest = new Request(
    `https://the-only-allowed-internal-stateful-worker-do-not-duplicate${url.pathname}${url.search}`,
    request,
  )
  try {
    const response = await theOnlyAllowedStatefulWorker.fetch(upstreamRequest)
    const headers = new Headers(response.headers)
    const location = headers.get("Location")
    if (location?.startsWith(ICONOPLASM_INTERNAL_STATEFUL_WORKER_ORIGIN_DO_NOT_DUPLICATE)) {
      headers.set(
        "Location",
        `${url.origin}${location.slice(ICONOPLASM_INTERNAL_STATEFUL_WORKER_ORIGIN_DO_NOT_DUPLICATE.length)}`,
      )
    }
    if (request.method === "HEAD") {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    const contentType = String(response.headers.get("Content-Type") || "").toLowerCase()
    const isTextual =
      contentType.includes("application/json") ||
      contentType.includes("application/problem+json") ||
      contentType.startsWith("text/")
    if (!isTextual) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    const body = await response.clone().text()
    if (!body.includes(ICONOPLASM_INTERNAL_STATEFUL_WORKER_ORIGIN_DO_NOT_DUPLICATE)) {
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    headers.delete("Content-Length")
    return new Response(
      body.replaceAll(ICONOPLASM_INTERNAL_STATEFUL_WORKER_ORIGIN_DO_NOT_DUPLICATE, url.origin),
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    )
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

async function sessionUserFromAuth(request, env) {
  if (!env?.GAME_SESSIONS) return null
  const response = await handleMe(request, env)
  if (!response.ok) return null
  const payload = await response.json()
  const user = payload?.user
  const userId = String(user?.id || "").trim()
  if (!userId) return null
  return {
    user_id: userId,
    username: String(user?.username || "").trim() || null,
  }
}

function done(request, response) {
  return asHead(request, response)
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

export async function handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx = { waitUntil() {} },
) {
  const url = new URL(request.url)
  const path = url.pathname

  try {
    if (request.method === "OPTIONS") {
      return done(request, new Response(null, { status: 204, headers: corsHeaders() }))
    }
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      return done(request, json({ error: "Method not allowed" }, 405))
    }

    if (path === "/health" || path === "/api/health") {
      return done(
        request,
        json({ status: "ok", service: "iconoplasm" }, 200, { "Cache-Control": "no-store" }),
      )
    }

    if (path === publicApiPath("/schema")) {
      return done(request, handlePublicSchema())
    }

    if (path.startsWith(publicApiPath("/dumps/catalog.")) && path.endsWith(".jsonl")) {
      const response = env.ICONOPLASM_PORTRAITS
        ? await handlePublicCatalogJsonlDump(env, path)
        : await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env)
      return done(request, response)
    }

    if (
      path.startsWith("/portraits/") ||
      path.startsWith("/gene-cards/") ||
      path.startsWith("/blots/v1/")
    ) {
      if (!env.ICONOPLASM_PORTRAITS) {
        const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          request,
          env,
        )
        if (response) {
          return done(
            request,
            new Response(response.body, { status: response.status, headers: response.headers }),
          )
        }
        return done(request, json({ error: "Portrait bucket not configured" }, 404))
      }
      const key = path.replace(/^\/+/, "")
      const obj = await env.ICONOPLASM_PORTRAITS.get(key)
      if (!obj) {
        const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
          request,
          env,
        )
        if (response && response.status !== 404) {
          return done(
            request,
            new Response(response.body, { status: response.status, headers: response.headers }),
          )
        }
        return done(request, json({ error: "Portrait not found" }, 404))
      }
      return done(
        request,
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
      const sessionUser = await sessionUserFromAuth(request, env)
      if (!sessionUser?.user_id) {
        return done(
          request,
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
        request,
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

    if (path === "/api/iconoplasm/admin/me" && request.method === "GET") {
      const sessionUser = await sessionUserFromAuth(request, env)
      const authenticated = !!sessionUser?.user_id
      const admin = authenticated
        ? (await isAdmin(request, env)) || hasAdminToken(request, env)
        : false
      return done(
        request,
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

    if (path === "/artist-styles" || path === "/artist-styles/" || path === "/blocklist/") {
      const redirectUrl = new URL("/blocklist", url)
      redirectUrl.search = url.search
      return done(request, Response.redirect(redirectUrl.toString(), 308))
    }

    if (path === "/blocklist") {
      const artistStylesHtml = normalizeArtistStylesPageHtml(
        renderIconoplasmArtistStylesHtml({
          turnstileSiteKey: String(env.ICONOPLASM_TURNSTILE_SITE_KEY || "")
            .trim()
            .slice(0, 255),
        }),
      )
      return done(request, html(artistStylesHtml, 200, { "Cache-Control": "no-store" }))
    }

    if (path === "/admin") {
      if (!(await isAdmin(request, env))) {
        return done(request, html("<h1>403 Unauthorized</h1>", 403))
      }
      return done(
        request,
        html(renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, env), 200, {
          "Cache-Control": "no-store",
        }),
      )
    }

    if (
      isPathHandledAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        path,
        request.method,
      )
    ) {
      const declaredRoute = matchIconoplasmRouteContract(path, request.method)
      if (
        declaredRoute?.route?.auth === "trusted-client" &&
        !canAccessRichBatchRoute(request, env)
      ) {
        return done(
          request,
          json(
            {
              error:
                "High-fanout batch reads are reserved for the Iconoplasm website UI and browser extension",
              code: "FIRST_PARTY_ONLY",
              faq_url: "https://brinedew.bio/wiki/iconoplasm-faq",
            },
            403,
          ),
        )
      }
      if (path.startsWith(`${SITE_GENE_API_PREFIX}/`)) {
        if (!hasTrustedIconoplasmBrowserOrigin(request) && !hasAdminToken(request, env)) {
          return done(
            request,
            json(
              {
                error: "Rich per-gene detail is reserved for the Iconoplasm website UI",
                code: "FIRST_PARTY_ONLY",
                faq_url: "https://brinedew.bio/wiki/iconoplasm-faq",
              },
              403,
            ),
          )
        }
      }
      const response = await proxyIconoplasmRequestToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        request,
        env,
      )
      return done(
        request,
        new Response(response.body, { status: response.status, headers: response.headers }),
      )
    }

    if (path.startsWith("/api/")) return done(request, json({ error: "Not found" }, 404))
    return done(request, json({ error: "Not found" }, 404))
  } catch (error) {
    console.error(
      "[Iconoplasm public edge proxy to the only allowed stateful worker] Unhandled request error:",
      error,
    )
    return done(request, json({ error: "Internal server error" }, 500))
  }
}
