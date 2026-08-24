import {
  ICONOPLASM_GENE_RANGE_CONTRACT_VERSION,
  ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION,
  buildIconoplasmGeneDiscoverySnapshot,
  buildIconoplasmGeneRangeSitemapXml,
  buildIconoplasmLlmsTxt,
  buildIconoplasmSitemapIndexXml,
  buildIconoplasmStaticPagesSitemapXml,
  iconoplasmGeneRangeBySlug,
  iconoplasmPublishedGeneRecordIsDiscoveryCandidate,
  renderIconoplasmGeneIndexHtml,
  renderIconoplasmGeneRangeHtml,
} from "./iconoplasm-gene-discovery.js"
import {
  readIconoplasmPublishedGeneDiscoveryCatalog,
  readIconoplasmPublishedGeneDiscoveryProjections,
  resolveIconoplasmCanonicalGeneRouteRecordInsideTheOnlyAllowedStatefulWorkerDoNotDuplicate,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { appendIconoplasmServiceDiscoveryLinks } from "./iconoplasm-service-discovery.js"

const ICONOPLASM_HOST = "iconoplasm.brinedew.bio"

const snapshotCache = {
  version: null,
  value: null,
}

async function publishedSnapshot(env) {
  const published = await readIconoplasmPublishedGeneDiscoveryCatalog(env)
  if (!published?.version || !Array.isArray(published.genes)) return null
  if (snapshotCache.version === published.version && snapshotCache.value) {
    return snapshotCache.value
  }
  const snapshot = buildIconoplasmGeneDiscoverySnapshot(published)
  snapshotCache.version = published.version
  snapshotCache.value = snapshot
  return snapshot
}

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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow,noarchive"><title>Gene profile temporarily unavailable | Iconoplasm</title></head><body><main><h1>Gene profile temporarily unavailable</h1><p>The published profile could not be rendered safely. Please retry shortly.</p><p><a href="/genes">Gene reference catalog</a></p></main></body></html>`
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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow,noarchive"><title>Gene not found | Iconoplasm</title></head><body><main><h1>Gene not found</h1><p>This symbol is not in the published Iconoplasm catalog.</p><p><a href="/genes">Gene reference catalog</a></p></main></body></html>`
  return new Response(method === "HEAD" ? null : html, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, follow, noarchive",
    },
  })
}

function discoveryDocumentResponse(
  request,
  body,
  contentType,
  snapshot,
  { cardVersion = "" } = {},
) {
  const headers = appendIconoplasmServiceDiscoveryLinks({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    "X-Iconoplasm-Catalog-Version": snapshot.version,
    "X-Iconoplasm-Portrait-Discovery-Version": ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION,
    "X-Iconoplasm-Range-Contract": ICONOPLASM_GENE_RANGE_CONTRACT_VERSION,
  })
  if (cardVersion) {
    const pathname = new URL(request.url).pathname
    const responseVersion = [
      ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION,
      snapshot.version,
      cardVersion,
      pathname,
    ].join(":")
    headers.set("ETag", `"${encodeURIComponent(responseVersion)}"`)
    headers.set("X-Iconoplasm-Card-Version", cardVersion)
  }
  return new Response(request.method === "HEAD" ? null : body, { headers })
}

function iconoplasmGeneSitemapUnavailableResponse(method) {
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<error>Sitemap publication snapshot temporarily unavailable.</error>\n`
  return new Response(method === "HEAD" ? null : body, {
    status: 503,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "60",
      "X-Robots-Tag": "noindex, follow, noarchive",
    },
  })
}

function iconoplasmGeneDiscoveryProjectionIsUsable(genes, projection) {
  if (
    !projection?.version ||
    !(projection.bySymbol instanceof Map) ||
    !(projection.cardSymbols instanceof Set)
  ) {
    return false
  }
  // Every catalog candidate must resolve to a structurally valid card in the
  // selected immutable artifact. A resolved card without a published portrait
  // is legitimately omitted; a missing requested card means the snapshot read
  // is incomplete and the whole document must fail closed.
  return genes.every((gene) => projection.cardSymbols.has(gene.symbol))
}

// ARCHITECTURE FENCE [IPD-003]
// All crawlable documents pass through this adapter and therefore through one
// immutable-catalog snapshot. Do not add an archive or sitemap route elsewhere.
export async function handleIconoplasmGeneDiscoveryDocument(request, env, path) {
  const snapshot = await publishedSnapshot(env)
  if (!snapshot) return iconoplasmGeneUnavailableResponse(request.method)

  if (path === "/genes/") {
    return Response.redirect(`https://${ICONOPLASM_HOST}/genes`, 301)
  }
  if (path === "/genes") {
    return discoveryDocumentResponse(
      request,
      renderIconoplasmGeneIndexHtml(snapshot),
      "text/html; charset=utf-8",
      snapshot,
    )
  }

  const rangeMatch = /^\/genes\/([^/]+)\/?$/.exec(path)
  if (rangeMatch) {
    const range = iconoplasmGeneRangeBySlug(rangeMatch[1])
    if (!range) return iconoplasmGeneNotFoundResponse(request.method)
    const canonicalPath = `/genes/${range.slug}`
    if (path !== canonicalPath) {
      return Response.redirect(`https://${ICONOPLASM_HOST}${canonicalPath}`, 301)
    }
    const genes = snapshot.ranges.get(range.slug) || []
    const projection = await readIconoplasmPublishedGeneDiscoveryProjections(
      env,
      genes.map((gene) => gene.symbol),
    )
    if (!iconoplasmGeneDiscoveryProjectionIsUsable(genes, projection)) {
      return iconoplasmGeneUnavailableResponse(request.method)
    }
    return discoveryDocumentResponse(
      request,
      renderIconoplasmGeneRangeHtml(snapshot, range, projection),
      "text/html; charset=utf-8",
      snapshot,
      { cardVersion: projection.version },
    )
  }

  if (path === "/sitemap.xml") {
    const projection = await readIconoplasmPublishedGeneDiscoveryProjections(env, [])
    if (!iconoplasmGeneDiscoveryProjectionIsUsable([], projection)) {
      return iconoplasmGeneSitemapUnavailableResponse(request.method)
    }
    return discoveryDocumentResponse(
      request,
      buildIconoplasmSitemapIndexXml(snapshot, projection),
      "application/xml; charset=utf-8",
      snapshot,
      { cardVersion: projection.version },
    )
  }
  if (path === "/sitemaps/pages.xml") {
    const projection = await readIconoplasmPublishedGeneDiscoveryProjections(env, [])
    if (!iconoplasmGeneDiscoveryProjectionIsUsable([], projection)) {
      return iconoplasmGeneSitemapUnavailableResponse(request.method)
    }
    return discoveryDocumentResponse(
      request,
      buildIconoplasmStaticPagesSitemapXml(snapshot, projection),
      "application/xml; charset=utf-8",
      snapshot,
      { cardVersion: projection.version },
    )
  }
  const sitemapRangeMatch = /^\/sitemaps\/genes\/([^/]+)\.xml$/.exec(path)
  if (sitemapRangeMatch) {
    const range = iconoplasmGeneRangeBySlug(sitemapRangeMatch[1])
    if (!range) return iconoplasmGeneNotFoundResponse(request.method)
    const genes = snapshot.ranges.get(range.slug) || []
    const projection = await readIconoplasmPublishedGeneDiscoveryProjections(
      env,
      genes.map((gene) => gene.symbol),
      { includeBlotReadiness: true },
    )
    if (!iconoplasmGeneDiscoveryProjectionIsUsable(genes, projection)) {
      return iconoplasmGeneSitemapUnavailableResponse(request.method)
    }
    return discoveryDocumentResponse(
      request,
      buildIconoplasmGeneRangeSitemapXml(snapshot, range, projection),
      "application/xml; charset=utf-8",
      snapshot,
      { cardVersion: projection.version },
    )
  }
  if (path === "/llms.txt") {
    return discoveryDocumentResponse(
      request,
      buildIconoplasmLlmsTxt(snapshot),
      "text/plain; charset=utf-8",
      snapshot,
    )
  }
  return iconoplasmGeneNotFoundResponse(request.method)
}
