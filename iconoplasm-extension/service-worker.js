// Iconoplasm service worker
// Symbol-first contract: gene symbols are canonical keys.
// Chesterton's fence: this extension only consumes the published catalog artifact.
// Do not treat `d:\\Coding\\Website\\iconoplasm-extension` as the source of truth
// for aliases, publish state, or candidate facts. The local authoring/control-plane
// lives at `d:\\Coding\\Datasets\\iconoplasm`, and Website Ops sync publishes the
// snapshot this service worker reads.

const HOST = "https://iconoplasm.brinedew.bio"
const API_PUBLIC = `${HOST}/api/public/v1`
const API_CATALOG_MANIFEST = `${API_PUBLIC}/catalog/manifest`
const DATA_REFRESH_TTL_MS = 5 * 60 * 1000
const PORTRAIT_DATA_URL_CACHE_LIMIT = 48
const portraitDataUrlCache = new Map()

chrome.runtime.onInstalled.addListener(() => {
  fetchGeneData()
})

chrome.runtime.onStartup.addListener(() => {
  fetchGeneData()
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_GENE_DATA") {
    ensureFreshGeneData().then((data) => sendResponse(data))
    return true
  }
  if (msg.type === "ICONOPLASM_API_FETCH") {
    fetchIconoplasmApi(msg).then((result) => sendResponse(result))
    return true
  }
  if (msg.type === "WARM_PORTRAIT_DATA_URLS") {
    warmPortraitDataUrls(msg.urls).then((count) =>
      sendResponse({
        ok: true,
        count,
      }),
    )
    return true
  }
  if (msg.type === "REFRESH_DATA") {
    fetchGeneData({ forceArtifactRefresh: true }).then((result) =>
      sendResponse({
        ok: Boolean(result),
        count: result?.gene_count || 0,
        schemaVersion: result?.schema_version || null,
      }),
    )
    return true
  }
  if (msg.type === "GET_STATUS") {
    getStatus().then((status) => sendResponse(status))
    return true
  }
  if (msg.type === "GET_PORTRAIT_DATA_URL") {
    fetchPortraitDataUrl(msg.url).then((dataUrl) =>
      sendResponse({
        ok: Boolean(dataUrl),
        dataUrl: dataUrl || "",
      }),
    )
    return true
  }
})

async function getStatus() {
  const result = await chrome.storage.local.get([
    "iconoplasm_hash",
    "iconoplasm_gene_count",
    "iconoplasm_last_fetch",
    "iconoplasm_schema_version",
  ])
  return {
    hash: result.iconoplasm_hash || null,
    geneCount: result.iconoplasm_gene_count || 0,
    lastFetch: result.iconoplasm_last_fetch || null,
    schemaVersion: result.iconoplasm_schema_version || null,
  }
}

function normalizeIconoplasmApiPath(rawUrl) {
  const value = String(rawUrl || "").trim()
  if (!value) return ""
  try {
    const url =
      value.startsWith("http://") || value.startsWith("https://")
        ? new URL(value)
        : new URL(value, HOST)
    if (url.origin !== HOST) return ""
    if (!url.pathname.startsWith("/api/")) return ""
    return `${url.pathname}${url.search}`
  } catch (_err) {
    return ""
  }
}

async function fetchIconoplasmApi(msg) {
  const path = normalizeIconoplasmApiPath(msg.url || msg.path)
  if (!path) {
    return {
      ok: false,
      status: 400,
      text: JSON.stringify({ error: "Invalid Iconoplasm API path" }),
    }
  }
  try {
    const resp = await fetch(`${HOST}${path}`, {
      method: String(msg.method || "GET").toUpperCase(),
      headers: {
        ...(msg.headers && typeof msg.headers === "object" ? msg.headers : {}),
        "X-Iconoplasm-Extension-Version": chrome.runtime.getManifest().version,
      },
      body: typeof msg.body === "string" ? msg.body : undefined,
      credentials: msg.credentials === "include" ? "include" : "same-origin",
    })
    return {
      ok: resp.ok,
      status: resp.status,
      text: await resp.text(),
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      text: JSON.stringify({ error: String(err && err.message ? err.message : err) }),
    }
  }
}

async function getStoredGeneData() {
  const result = await chrome.storage.local.get([
    "iconoplasm_genes",
    "iconoplasm_portrait_base_url",
  ])
  return {
    genes: result.iconoplasm_genes || null,
    portraitBaseUrl: result.iconoplasm_portrait_base_url || "",
  }
}

async function getStoredGeneSnapshot() {
  return chrome.storage.local.get([
    "iconoplasm_genes",
    "iconoplasm_hash",
    "iconoplasm_last_fetch",
    "iconoplasm_schema_version",
    "iconoplasm_portrait_base_url",
  ])
}

function getStoredGeneCount(genes) {
  if (!genes || typeof genes !== "object") return 0
  return Object.keys(genes).length
}

function isStaleFetch(lastFetchIso) {
  if (!lastFetchIso) return true
  const lastFetchMs = Date.parse(lastFetchIso)
  if (!Number.isFinite(lastFetchMs)) return true
  return Date.now() - lastFetchMs >= DATA_REFRESH_TTL_MS
}

async function ensureFreshGeneData() {
  const stored = await getStoredGeneSnapshot()
  const geneCount = getStoredGeneCount(stored.iconoplasm_genes)
  const hasPublishedCatalogSchema =
    Number(stored.iconoplasm_schema_version || 0) >= 4 &&
    Boolean(stored.iconoplasm_portrait_base_url)
  const needsArtifactRebuild = geneCount === 0 || !hasPublishedCatalogSchema
  const needsRefresh = needsArtifactRebuild || isStaleFetch(stored.iconoplasm_last_fetch)

  if (needsRefresh) {
    await fetchGeneData({ forceArtifactRefresh: needsArtifactRebuild })
  }

  return getStoredGeneData()
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function rememberPortraitDataUrl(url, dataUrl) {
  if (!url || !dataUrl) return
  portraitDataUrlCache.delete(url)
  portraitDataUrlCache.set(url, dataUrl)
  while (portraitDataUrlCache.size > PORTRAIT_DATA_URL_CACHE_LIMIT) {
    const oldestKey = portraitDataUrlCache.keys().next().value
    portraitDataUrlCache.delete(oldestKey)
  }
}

async function fetchPortraitDataUrl(url) {
  const normalizedUrl = String(url || "").trim()
  if (!normalizedUrl) return ""
  if (portraitDataUrlCache.has(normalizedUrl)) {
    return portraitDataUrlCache.get(normalizedUrl)
  }
  try {
    const resp = await fetch(normalizedUrl, {
      headers: {
        "X-Iconoplasm-Extension-Version": chrome.runtime.getManifest().version,
      },
    })
    if (!resp.ok) {
      console.error("[Iconoplasm] Portrait fetch failed:", resp.status, normalizedUrl)
      return ""
    }
    const contentType = resp.headers.get("Content-Type") || "image/webp"
    const buffer = await resp.arrayBuffer()
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`
    rememberPortraitDataUrl(normalizedUrl, dataUrl)
    return dataUrl
  } catch (err) {
    console.error("[Iconoplasm] Portrait fetch error:", err)
    return ""
  }
}

async function warmPortraitDataUrls(urls) {
  const normalized = Array.isArray(urls)
    ? Array.from(new Set(urls.map((url) => String(url || "").trim()).filter(Boolean)))
    : []
  if (!normalized.length) return 0

  await Promise.all(normalized.map((url) => fetchPortraitDataUrl(url).catch(() => "")))
  return normalized.length
}

async function fetchManifest() {
  const manifestResp = await fetch(API_CATALOG_MANIFEST, {
    headers: {
      "X-Iconoplasm-Extension-Version": chrome.runtime.getManifest().version,
    },
  })

  if (!manifestResp.ok) {
    return null
  }
  const manifest = await manifestResp.json()
  return {
    current_hash: manifest.build_version || manifest.catalog_hash,
    filename: manifest.catalog_hash ? `catalog.${manifest.catalog_hash}.json` : null,
    artifact_url: manifest.artifact_url || null,
    schema_version: manifest.artifact_schema_version || manifest.schema_version || 4,
    portrait_base_url: manifest.portrait_base_url || HOST,
    gene_count: manifest.gene_count || null,
  }
}

function artifactUrl(manifest) {
  if (manifest?.artifact_url) return manifest.artifact_url
  if (!manifest?.filename) return null
  const cacheKey = encodeURIComponent(String(manifest.current_hash || manifest.filename))
  return `${API_PUBLIC}/catalog/${manifest.filename}?v=${cacheKey}`
}

async function fetchGeneData({ forceArtifactRefresh = false } = {}) {
  try {
    const manifest = await fetchManifest()
    if (!manifest?.current_hash || !manifest.filename) {
      console.error("[Iconoplasm] Manifest fetch failed")
      return null
    }

    const stored = await chrome.storage.local.get(["iconoplasm_hash"])
    if (!forceArtifactRefresh && stored.iconoplasm_hash === manifest.current_hash) {
      return {
        schema_version: manifest.schema_version,
        gene_count: manifest.gene_count || 0,
      }
    }

    const url = artifactUrl(manifest)
    if (!url) {
      console.error("[Iconoplasm] Invalid artifact URL")
      return null
    }

    const artifactResp = await fetch(url, {
      headers: {
        "X-Iconoplasm-Extension-Version": chrome.runtime.getManifest().version,
      },
    })
    if (!artifactResp.ok) {
      console.error("[Iconoplasm] Artifact fetch failed:", artifactResp.status)
      return null
    }
    const artifact = await artifactResp.json()

    // Build symbol-keyed lookup map:
    // { SYMBOL: { c?, n?, u?, a?, pt?, ph? } }
    // Fence: keep this a pure projection of the published artifact. If a field is
    // missing here, fix the workstation export in `d:\\Coding\\Datasets\\iconoplasm`
    // or the website ingest, not this runtime cache.
    const lookup = {}
    for (const gene of artifact.genes || []) {
      const symbol = String(gene.s || "").toUpperCase()
      if (!symbol) continue
      const entry = {}
      if (gene.c) entry.c = gene.c
      if (gene.n) entry.n = gene.n
      if (gene.u) entry.u = gene.u
      if (Array.isArray(gene.a) && gene.a.length) entry.a = gene.a
      if (gene.pt) entry.pt = gene.pt
      if (gene.ph) entry.ph = gene.ph
      lookup[symbol] = entry
    }

    await chrome.storage.local.set({
      iconoplasm_genes: lookup,
      iconoplasm_hash: manifest.current_hash,
      iconoplasm_gene_count: artifact.gene_count || Object.keys(lookup).length,
      iconoplasm_last_fetch: new Date().toISOString(),
      iconoplasm_schema_version: manifest.schema_version || artifact.schema_version || 1,
      iconoplasm_portrait_base_url: manifest.portrait_base_url || HOST,
    })

    return {
      schema_version: manifest.schema_version || artifact.schema_version || 1,
      gene_count: artifact.gene_count || Object.keys(lookup).length,
    }
  } catch (err) {
    console.error("[Iconoplasm] Fetch error:", err)
    return null
  }
}
