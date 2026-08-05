const THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE =
  "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE"
const STATIC_SITE_ORIGIN_PROD = "https://brinedew-bio.pages.dev"
const STATIC_SITE_ORIGIN_STAGING = "https://brinedew-bio-staging.pages.dev"
const GENEGUESSR_HOST = "geneguessr.brinedew.bio"
const MAIN_SITE_HOSTS = new Set(["brinedew.bio", "www.brinedew.bio", "staging.brinedew.bio"])
const ROOT_DOCUMENT_PATHS = new Set(["/", "/index", "/index/", "/index.html"])
const PRIVACY_DOCUMENT_PATHS = new Set(["/privacy", "/privacy/", "/privacy.html"])
const SUPPORT_ALIAS_PATHS = new Set([
  "/support",
  "/support/",
  "/posts/support-me.html",
  "/posts/support-me/",
  "/posts/Support-me",
  "/posts/Support-me/",
  "/posts/Support-me.html",
])
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

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-site",
}

function parseCookies(cookieHeader) {
  const cookies = {}
  for (const segment of String(cookieHeader || "").split(";")) {
    const separator = segment.indexOf("=")
    if (separator < 0) continue
    const name = segment.slice(0, separator).trim()
    if (!name) continue
    const value = segment.slice(separator + 1).trim()
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

function requestRequiresAnalyticsConsent(request) {
  const country = String(
    request.headers.get("CF-IPCountry") || request.cf?.country || "",
  ).toUpperCase()
  return ANALYTICS_CONSENT_COUNTRIES.has(country)
}

function requestHasAnalyticsConsent(request) {
  return parseCookies(request.headers.get("Cookie")).brinedew_analytics_consent === "accepted"
}

function injectAnalyticsConsentBootstrap(html, request) {
  if (!requestRequiresAnalyticsConsent(request) || requestHasAnalyticsConsent(request)) return html
  const bootstrap = "<script>window.__brinedewAnalyticsConsentRequired=true</script>"
  return String(html).replace(/<head([^>]*)>/i, `<head$1>${bootstrap}`)
}

function publicContentSecurityPolicy(request) {
  const url = new URL(request.url)
  const allowUnsafeEval = url.hostname === GENEGUESSR_HOST && ROOT_DOCUMENT_PATHS.has(url.pathname)
  const scriptSrc = [
    "script-src",
    "'self'",
    "'unsafe-inline'",
    ...(allowUnsafeEval ? ["'unsafe-eval'"] : []),
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://challenges.cloudflare.com",
    "https://static.cloudflareinsights.com",
  ].join(" ")
  const connectSrc = allowUnsafeEval
    ? "connect-src 'self' data: blob: https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
    : "connect-src 'self' https://brinedew.bio https://geneguessr.brinedew.bio https://iconoplasm.brinedew.bio https://challenges.cloudflare.com https://cloudflareinsights.com"
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob: https://cdn.discordapp.com https://iconoplasmportraits.b-cdn.net; font-src 'self' data:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; ${connectSrc}; frame-src 'self' https://brinedew.bio https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com; worker-src 'self' blob:; form-action 'self'; upgrade-insecure-requests`
}

function applyPublicDocumentHeaders(response, request) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  headers.set("Content-Security-Policy", publicContentSecurityPolicy(request))
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
  headers.set("X-Brinedew-Static-Route", "public-edge")
  const contentType = String(headers.get("Content-Type") || "").toLowerCase()
  if (
    contentType.includes("text/html") &&
    requestRequiresAnalyticsConsent(request) &&
    !requestHasAnalyticsConsent(request)
  ) {
    const cacheControl = String(headers.get("Cache-Control") || "").trim()
    const directives = cacheControl
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    if (!directives.includes("no-transform")) {
      headers.set("Cache-Control", cacheControl ? `${cacheControl}, no-transform` : "no-transform")
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function canonicalDocumentRedirect(url) {
  // Keep human-facing support aliases as HTTP redirects. The Quartz alias
  // emitter uses a noindex meta-refresh shell, which browsers follow but many
  // AI fetchers do not; a direct 301 preserves one crawlable canonical page.
  if (MAIN_SITE_HOSTS.has(url.hostname) && SUPPORT_ALIAS_PATHS.has(url.pathname)) {
    const canonicalHost = url.hostname === "www.brinedew.bio" ? "brinedew.bio" : url.hostname
    const target = new URL(`https://${canonicalHost}/posts/support-me`)
    target.search = url.search
    return Response.redirect(target.toString(), 301)
  }

  if (url.hostname === "www.brinedew.bio" && ROOT_DOCUMENT_PATHS.has(url.pathname)) {
    const target = new URL("https://brinedew.bio/")
    target.search = url.search
    return Response.redirect(target.toString(), 301)
  }

  if (url.hostname !== GENEGUESSR_HOST) return null
  const legacyRoot =
    ROOT_DOCUMENT_PATHS.has(url.pathname) ||
    url.pathname === "/apps/geneguessr" ||
    url.pathname === "/apps/geneguessr/" ||
    url.pathname === "/apps/geneguessr/index" ||
    url.pathname === "/apps/geneguessr/index/"
  if (legacyRoot && url.pathname !== "/") {
    const target = new URL(`https://${GENEGUESSR_HOST}/`)
    target.search = url.search
    return Response.redirect(target.toString(), 301)
  }
  const legacyPrivacy =
    PRIVACY_DOCUMENT_PATHS.has(url.pathname) ||
    url.pathname === "/apps/geneguessr/privacy" ||
    url.pathname === "/apps/geneguessr/privacy/"
  if (legacyPrivacy && url.pathname !== "/privacy") {
    const target = new URL(`https://${GENEGUESSR_HOST}/privacy`)
    target.search = url.search
    return Response.redirect(target.toString(), 301)
  }
  return null
}

function publicStaticDocumentPath(url) {
  if (url.hostname === GENEGUESSR_HOST) {
    if (ROOT_DOCUMENT_PATHS.has(url.pathname)) return "/apps/geneguessr/index.html"
    if (PRIVACY_DOCUMENT_PATHS.has(url.pathname)) return "/apps/geneguessr/privacy.html"
    return ""
  }
  if (!MAIN_SITE_HOSTS.has(url.hostname)) return ""
  if (ROOT_DOCUMENT_PATHS.has(url.pathname)) return "/index.html"
  // The Iconoplasm asset bundle also contains privacy.html. The main site has
  // no /privacy document, so route these aliases to Pages and preserve its 404
  // instead of leaking Iconoplasm's privacy page onto the wrong hostname.
  if (PRIVACY_DOCUMENT_PATHS.has(url.pathname)) return url.pathname
  return ""
}

async function maybeServeHostnameSensitiveStaticDocument(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null
  const url = new URL(request.url)
  const redirect = canonicalDocumentRedirect(url)
  if (redirect) return applyPublicDocumentHeaders(redirect, request)

  const targetPath = publicStaticDocumentPath(url)
  if (!targetPath) return null
  const staticOrigin =
    url.hostname === "staging.brinedew.bio" ? STATIC_SITE_ORIGIN_STAGING : STATIC_SITE_ORIGIN_PROD
  const targetUrl = new URL(targetPath, staticOrigin)
  targetUrl.search = url.search
  const upstreamHeaders = new Headers(request.headers)
  upstreamHeaders.delete("Authorization")
  upstreamHeaders.delete("Cookie")
  let upstream
  try {
    upstream = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      cf: { cacheEverything: false, cacheTtl: 0 },
    })
  } catch {
    return applyPublicDocumentHeaders(
      new Response("Static site temporarily unavailable", {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      }),
      request,
    )
  }
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("text/html")) {
    return applyPublicDocumentHeaders(upstream, request)
  }

  let html = await upstream.text()
  html = injectAnalyticsConsentBootstrap(html, request)
  const responseHeaders = new Headers(upstream.headers)
  responseHeaders.delete("Content-Encoding")
  responseHeaders.delete("Content-Length")
  responseHeaders.delete("ETag")
  const response = new Response(request.method === "HEAD" ? null : html, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
  return applyPublicDocumentHeaders(response, request)
}

function missingTheOnlyAllowedStatefulWorkerResponse() {
  return Response.json(
    {
      error:
        "THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE binding missing for a fail-closed public worker",
      code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED",
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  )
}

export async function handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
  request,
  env,
  ctx = { waitUntil() {} },
) {
  // ARCHITECTURE FENCE [IPD-007]: service-binding requests enter the stateful
  // Worker through its asset-first dispatcher. Its deterministic Iconoplasm
  // bundle intentionally owns `/` and `/privacy` on the Iconoplasm hostname,
  // but those same filenames must never capture Brinedew or GeneGuessr.
  //
  // This edge owns only the hostname-sensitive public HTML documents. It has no
  // state bindings and fetches the canonical Pages deployment directly. Every
  // API, authenticated request, draft check, and non-colliding static path
  // continues through the single internal stateful Worker.
  const publicDocumentResponse = await maybeServeHostnameSensitiveStaticDocument(request)
  if (publicDocumentResponse) return publicDocumentResponse

  // Repo-wide hard fence:
  // this public worker is never allowed to gain D1/KV/R2/session capability.
  // It is only allowed to forward requests to the one internal worker that may
  // touch state. If someone tries to "just add a binding here for one feature",
  // they are recreating the exact failure mode this architecture is meant to end.
  const statefulWorker = env?.[THE_ONLY_ALLOWED_STATEFUL_WORKER_BINDING_DO_NOT_DUPLICATE]
  if (!statefulWorker || typeof statefulWorker.fetch !== "function") {
    return missingTheOnlyAllowedStatefulWorkerResponse()
  }

  // ICONOPLASM CANONICAL PORTRAIT PUBLISH CONTRACT.
  // Search terms: PRL split-brain, public edge card cache, canonical blot,
  // logged-out stale card, KV_GALLERY_VERSION.
  //
  // Do not cache `/api/iconoplasm/cards/:symbol` in this public edge worker.
  // This worker intentionally has no KV binding, so it cannot include the live
  // KV_GALLERY_VERSION barrier in a cache key. A symbol-only edge cache is the
  // wrong architecture: after a vote promotes a new canonical portrait and the
  // stateful worker publishes a new card artifact, logged-out users can still
  // receive the old symbol-only edge response until that cache expires or an
  // operator purges it by hand. The internal stateful worker already has the
  // version-aware cache key because it can read the barrier. Keep this proxy
  // state-free and let the stateful worker own public card freshness.

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()

  try {
    const response = await statefulWorker.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        redirect: "manual",
      }),
    )
    return response
  } catch {
    return Response.json(
      {
        error: "The only allowed stateful worker is unavailable",
        code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequestByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env, ctx)
  },
}
