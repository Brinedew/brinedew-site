import { iconoplasmPublicationAliasManifest } from "../workers/iconoplasm-publication-aliases.js"

const DEFAULT_PUBLIC_BASE_URL = "https://iconoplasm.brinedew.bio"
const EXTENSION_VERSION = "0.4.8"
const MAX_ATTEMPTS = 6
const RETRY_DELAY_MS = 10_000
const REQUEST_TIMEOUT_MS = 20_000

function fail(message) {
  throw new Error(`[verify-iconoplasm-publication-aliases] ${message}`)
}

function publicBaseUrl() {
  const value = String(process.env.ICONOPLASM_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).trim()
  const url = new URL(value)
  if (!/^https?:$/.test(url.protocol)) fail(`Unsupported public base URL: ${value}`)
  return url
}

function extensionHeaders(extra = {}) {
  return {
    "X-Iconoplasm-Extension-Version": EXTENSION_VERSION,
    ...extra,
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: extensionHeaders(options.headers),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    fail(`${url} returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok) {
    fail(`${url} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`)
  }
  return { payload, response }
}

function sameOverlay(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null)
}

async function waitForPublishedOverlay(baseUrl, expectedOverlay) {
  const manifestUrl = new URL("/api/public/v1/catalog/manifest", baseUrl)
  let lastObservedVersion = ""

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    manifestUrl.searchParams.set(
      "publication_alias_verify",
      `${expectedOverlay.version}-${Date.now()}`,
    )
    const { payload, response } = await fetchJson(manifestUrl)
    const publishedOverlay = payload?.publication_aliases
    lastObservedVersion = String(publishedOverlay?.version || "")
    if (sameOverlay(publishedOverlay, expectedOverlay)) {
      return {
        etag: response.headers.get("etag") || "",
        manifestUrl: manifestUrl.toString(),
        overlay: publishedOverlay,
      }
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  fail(
    `live manifest did not publish ${expectedOverlay.version} after ${MAX_ATTEMPTS} attempts; ` +
      `last observed ${lastObservedVersion || "no overlay version"}`,
  )
}

function resolutionMismatches(payload, expectedPairs) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  if (results.length !== expectedPairs.length) {
    return [`received ${results.length} results for ${expectedPairs.length} curated aliases`]
  }

  return expectedPairs.flatMap((expected, index) => {
    const result = results[index]
    if (
      result?.found === true &&
      String(result?.requested || "") === expected.alias &&
      String(result?.canonical_symbol || "") === expected.symbol
    ) {
      return []
    }
    return [
      `${JSON.stringify(expected.alias)} expected ${expected.symbol}, received ` +
        JSON.stringify(result || null),
    ]
  })
}

async function waitForResolution(baseUrl, expectedOverlay) {
  const expectedPairs = Object.entries(expectedOverlay.by_symbol).flatMap(([symbol, aliases]) =>
    aliases.map((alias) => ({ alias, symbol })),
  )
  const resolveUrl = new URL("/api/public/v1/resolve", baseUrl)
  let lastMismatches = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { payload } = await fetchJson(resolveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: expectedPairs.map(({ alias }) => alias) }),
    })
    lastMismatches = resolutionMismatches(payload, expectedPairs)
    if (lastMismatches.length === 0) return expectedPairs.length
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  fail(
    `live resolver remained inconsistent after ${MAX_ATTEMPTS} attempts: ` +
      lastMismatches.join("; "),
  )
}

const expectedOverlay = await iconoplasmPublicationAliasManifest()
const baseUrl = publicBaseUrl()
const published = await waitForPublishedOverlay(baseUrl, expectedOverlay)
const resolvedCount = await waitForResolution(baseUrl, expectedOverlay)
const overlayBytes = Buffer.byteLength(JSON.stringify(expectedOverlay), "utf8")

console.log(
  JSON.stringify(
    {
      ok: true,
      base_url: baseUrl.toString(),
      overlay_version: expectedOverlay.version,
      alias_count: expectedOverlay.alias_count,
      overlay_bytes: overlayBytes,
      resolved_count: resolvedCount,
      manifest_etag: published.etag,
    },
    null,
    2,
  ),
)
