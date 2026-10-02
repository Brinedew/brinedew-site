import { iconoplasmPublishedGeneRecordIsDiscoveryCandidate } from "./iconoplasm-gene-discovery.js"
import { resolveIconoplasmCanonicalGeneRouteRecordInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function rawGeneIdentifierFromPath(path) {
  const match = /^\/gene\/([^/?#]+)\/?$/.exec(String(path || ""))
  if (!match) return null
  try {
    return decodeURIComponent(match[1] || "").trim()
  } catch (_) {
    return null
  }
}

export async function iconoplasmGeneDiscoveryStateForPath(env, path) {
  const rawIdentifier = rawGeneIdentifierFromPath(path)
  if (!rawIdentifier) return { kind: "unknown", canonicalSymbol: "", record: null }
  const resolved =
    await resolveIconoplasmCanonicalGeneRouteRecordInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      env,
      rawIdentifier,
    )
  if (!resolved || resolved.kind === "unavailable") {
    return { kind: "unavailable", canonicalSymbol: "", record: null }
  }
  if (resolved.kind === "unknown") {
    return { kind: "unknown", canonicalSymbol: "", record: null }
  }
  return {
    kind: resolved.kind,
    canonicalSymbol: resolved.canonicalSymbol,
    record: resolved.record,
    discoveryCandidate: iconoplasmPublishedGeneRecordIsDiscoveryCandidate(resolved.record),
  }
}

export function iconoplasmGeneCanonicalRedirect(requestUrl, canonicalSymbol) {
  const target = new URL(requestUrl)
  target.pathname = `/gene/${encodeURIComponent(canonicalSymbol)}`
  return Response.redirect(target.toString(), 301)
}

export function iconoplasmGeneUnavailableResponse(method) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow,noarchive"><title>Gene profile temporarily unavailable | Iconoplasm</title></head><body><main><h1>Gene profile temporarily unavailable</h1><p>The published profile could not be rendered safely. Please retry shortly.</p><p><a href="/">Iconoplasm gene character archive</a></p></main></body></html>`
  return new Response(method === "HEAD" ? null : html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "60",
      "X-Robots-Tag": "noindex, follow, noarchive",
    },
  })
}

export function iconoplasmGeneNotFoundResponse(method) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow,noarchive"><title>Gene not found | Iconoplasm</title></head><body><main><h1>Gene not found</h1><p>This symbol is not in the published Iconoplasm catalog.</p><p><a href="/">Iconoplasm gene character archive</a></p></main></body></html>`
  return new Response(method === "HEAD" ? null : html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, follow, noarchive",
    },
  })
}
