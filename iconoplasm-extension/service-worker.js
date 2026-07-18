// Iconoplasm service worker
// Symbol-first contract: gene symbols are canonical keys.
// Chesterton's fence: generated gene facts still come from the immutable catalog
// artifact. The small human-curated publication alias overlay is intentionally
// website-owned so an alias edit does not force a 19k-gene workstation sync or a
// multi-megabyte catalog refetch.

if (!globalThis.IconoplasmPublicationAliasOverlay && typeof importScripts === "function") {
  importScripts("publication-alias-overlay.js")
}
const IconoPublicationAliasOverlay = globalThis.IconoplasmPublicationAliasOverlay
if (!IconoPublicationAliasOverlay) {
  throw new Error("Iconoplasm publication alias overlay runtime is required")
}

const HOST = "https://iconoplasm.brinedew.bio"
const API_PUBLIC = `${HOST}/api/public/v1`
const API_CATALOG_MANIFEST = `${API_PUBLIC}/catalog/manifest`
const DATA_REFRESH_TTL_MS = 5 * 60 * 1000
const PORTRAIT_DATA_URL_CACHE_LIMIT = 48
const PORTRAIT_DATA_URL_ERROR_CACHE_LIMIT = 96
const PORTRAIT_DATA_URL_ERROR_TTL_MS = 30 * 1000
const PORTRAIT_SOURCE_TIMEOUT_MS = 2500
const PORTRAIT_PRIMARY_ORIGIN = "https://iconoplasmportraits.b-cdn.net"
const PORTRAIT_FALLBACK_ORIGIN = HOST
const PORTRAIT_SOURCE_SESSION_KEY = "iconoplasm_portrait_source_by_tab"
const REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION = 4
const CONTRACT_ERROR_INVALID_MANIFEST = "invalid_manifest"
const CONTRACT_ERROR_INCOMPATIBLE_ARTIFACT = "incompatible_artifact"
const CONTRACT_ERROR_INCOMPATIBLE_EXTENSION = "incompatible_extension"
const portraitDataUrlCache = new Map()
const portraitDataUrlErrorCache = new Map()
const portraitSourceByTab = new Map()
const portraitSourceDecisionByTab = new Map()
let portraitSourceStateLoaded = false

chrome.runtime.onInstalled.addListener(() => {
  fetchGeneData()
})

chrome.runtime.onStartup.addListener(() => {
  fetchGeneData()
})

if (chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await loadPortraitSourceState()
    portraitSourceByTab.delete(portraitTabKey(tabId))
    portraitSourceDecisionByTab.delete(portraitTabKey(tabId))
    const session = chrome.storage?.session
    if (!session?.set) return
    try {
      await session.set({
        [PORTRAIT_SOURCE_SESSION_KEY]: Object.fromEntries(portraitSourceByTab),
      })
    } catch (_err) {}
  })
}

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
    warmPortraitDataUrls(msg.urls, sender?.tab?.id).then((count) =>
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
    fetchPortraitDataUrl(msg.url, sender?.tab?.id).then((result) =>
      sendResponse({
        ok: Boolean(result?.dataUrl || result?.sourceUrl),
        dataUrl: result?.dataUrl || "",
        sourceUrl: result?.sourceUrl || "",
      }),
    )
    return true
  }
})

function currentExtensionVersion() {
  return String(chrome.runtime.getManifest()?.version || "0.0.0")
}

function compareSemver(left, right) {
  const leftParts = String(left || "0.0.0")
    .split(".")
    .map((value) => Number.parseInt(String(value || "0"), 10) || 0)
  const rightParts = String(right || "0.0.0")
    .split(".")
    .map((value) => Number.parseInt(String(value || "0"), 10) || 0)
  const length = Math.max(leftParts.length, rightParts.length, 3)
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] || 0
    const rightValue = rightParts[index] || 0
    if (leftValue > rightValue) return 1
    if (leftValue < rightValue) return -1
  }
  return 0
}

async function getStatus() {
  const result = await chrome.storage.local.get([
    "iconoplasm_hash",
    "iconoplasm_gene_count",
    "iconoplasm_last_fetch",
    "iconoplasm_schema_version",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
  ])
  return {
    hash: result.iconoplasm_hash || null,
    geneCount: result.iconoplasm_gene_count || 0,
    lastFetch: result.iconoplasm_last_fetch || null,
    schemaVersion: result.iconoplasm_schema_version || null,
    aliasOverlayVersion: result.iconoplasm_alias_overlay_version || null,
    contractError: result.iconoplasm_contract_error || null,
    minExtensionVersion: result.iconoplasm_min_extension_version || null,
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
        "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
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
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
  ])
  return {
    genes: result.iconoplasm_genes || null,
    portraitBaseUrl: result.iconoplasm_portrait_base_url || "",
    contractError: result.iconoplasm_contract_error || null,
    minExtensionVersion: result.iconoplasm_min_extension_version || null,
  }
}

async function getStoredGeneSnapshot() {
  return chrome.storage.local.get([
    "iconoplasm_genes",
    "iconoplasm_hash",
    "iconoplasm_last_fetch",
    "iconoplasm_schema_version",
    "iconoplasm_portrait_base_url",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_alias_overlay_applied",
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
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

function normalizePublishedManifest(rawManifest) {
  const manifest = rawManifest && typeof rawManifest === "object" ? rawManifest : null
  if (!manifest) return null
  const currentHash = String(
    manifest.build_version || manifest.current_hash || manifest.catalog_hash || "",
  ).trim()
  const catalogHash = String(manifest.catalog_hash || "").trim()
  const filename = String(
    manifest.filename || (catalogHash ? `catalog.${catalogHash}.json` : ""),
  ).trim()
  const artifactUrl = String(manifest.artifact_url || "").trim()
  const portraitBaseUrl = String(manifest.portrait_base_url || "").trim()
  const schemaVersion = Number.parseInt(
    String(manifest.artifact_schema_version ?? manifest.schema_version ?? 0),
    10,
  )
  const minExtensionVersion = String(
    manifest.min_extension_version ||
      manifest.minimum_extension_version ||
      currentExtensionVersion(),
  ).trim()
  const publicationAliases = IconoPublicationAliasOverlay.normalizePublishedAliasOverlay(
    manifest.publication_aliases,
  )
  if (
    !currentHash ||
    (!filename && !artifactUrl) ||
    !portraitBaseUrl ||
    !Number.isFinite(schemaVersion) ||
    !publicationAliases
  ) {
    return null
  }
  return {
    current_hash: currentHash,
    filename: filename || null,
    artifact_url: artifactUrl || null,
    portrait_base_url: portraitBaseUrl,
    schema_version: schemaVersion,
    gene_count: Number.isFinite(Number(manifest.gene_count)) ? Number(manifest.gene_count) : null,
    min_extension_version: minExtensionVersion || currentExtensionVersion(),
    publication_aliases: publicationAliases,
  }
}

async function rememberContractError({ code, message, minExtensionVersion = "" } = {}) {
  await chrome.storage.local.set({
    iconoplasm_contract_error: {
      code: String(code || "contract_error"),
      message: String(message || "Published Iconoplasm contract error"),
      detectedAt: new Date().toISOString(),
    },
    iconoplasm_min_extension_version: String(minExtensionVersion || ""),
  })
}

async function clearContractError() {
  await chrome.storage.local.remove([
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
  ])
}

async function invalidateStoredPublishedSnapshot({ code, message, minExtensionVersion = "" } = {}) {
  // Chesterton's fence: stale published data is worse than empty data here.
  // If the worker says the artifact contract changed, letting the extension keep
  // serving an older incompatible snapshot just creates quiet wrongness that
  // looks healthy from the UI. Clear the snapshot and surface the contract error
  // instead of limping along on cached lies.
  clearPortraitDataUrlCaches()
  await chrome.storage.local.remove([
    "iconoplasm_genes",
    "iconoplasm_hash",
    "iconoplasm_gene_count",
    "iconoplasm_last_fetch",
    "iconoplasm_schema_version",
    "iconoplasm_portrait_base_url",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_alias_overlay_applied",
  ])
  await rememberContractError({ code, message, minExtensionVersion })
}

async function ensureFreshGeneData() {
  const stored = await getStoredGeneSnapshot()
  const geneCount = getStoredGeneCount(stored.iconoplasm_genes)
  const hasPublishedCatalogSchema =
    Number(stored.iconoplasm_schema_version || 0) >= REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION &&
    Boolean(stored.iconoplasm_portrait_base_url)
  const hasContractError = Boolean(stored.iconoplasm_contract_error)
  const needsArtifactRebuild = geneCount === 0 || !hasPublishedCatalogSchema
  const needsRefresh =
    hasContractError || needsArtifactRebuild || isStaleFetch(stored.iconoplasm_last_fetch)

  if (needsRefresh) {
    // A manifest-overlay contract error is retried against the manifest only.
    // The immutable artifact is already known-good and must not become a 6 MB
    // retry penalty just because a small alias overlay was rejected.
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
  portraitDataUrlErrorCache.delete(url)
  portraitDataUrlCache.delete(url)
  portraitDataUrlCache.set(url, dataUrl)
  while (portraitDataUrlCache.size > PORTRAIT_DATA_URL_CACHE_LIMIT) {
    const oldestKey = portraitDataUrlCache.keys().next().value
    portraitDataUrlCache.delete(oldestKey)
  }
}

function rememberPortraitDataUrlError(url, reason = "") {
  if (!url) return
  portraitDataUrlCache.delete(url)
  portraitDataUrlErrorCache.delete(url)
  portraitDataUrlErrorCache.set(url, {
    until: Date.now() + PORTRAIT_DATA_URL_ERROR_TTL_MS,
    reason: String(reason || "").trim(),
  })
  while (portraitDataUrlErrorCache.size > PORTRAIT_DATA_URL_ERROR_CACHE_LIMIT) {
    const oldestKey = portraitDataUrlErrorCache.keys().next().value
    portraitDataUrlErrorCache.delete(oldestKey)
  }
}

function hasFreshPortraitDataUrlError(url) {
  if (!url || !portraitDataUrlErrorCache.has(url)) return false
  const cached = portraitDataUrlErrorCache.get(url)
  const until = Number(cached && cached.until ? cached.until : 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    portraitDataUrlErrorCache.delete(url)
    return false
  }
  return true
}

function clearPortraitDataUrlCaches() {
  portraitDataUrlCache.clear()
  portraitDataUrlErrorCache.clear()
}

async function clearPortraitSourceStates() {
  portraitSourceByTab.clear()
  portraitSourceDecisionByTab.clear()
  portraitSourceStateLoaded = true
  const session = chrome.storage?.session
  if (session?.remove) await session.remove([PORTRAIT_SOURCE_SESSION_KEY])
}

function portraitPath(rawUrl) {
  const value = String(rawUrl || "").trim()
  if (!value) return ""
  try {
    const parsed = new URL(value, HOST)
    if (parsed.origin !== PORTRAIT_PRIMARY_ORIGIN && parsed.origin !== PORTRAIT_FALLBACK_ORIGIN) {
      return ""
    }
    if (!parsed.pathname.startsWith("/portraits/")) return ""
    return parsed.pathname + parsed.search
  } catch (_err) {
    return ""
  }
}

function portraitTabKey(tabId) {
  return Number.isInteger(tabId) && tabId >= 0 ? String(tabId) : "extension"
}

function normalizedPortraitState(value) {
  const source = value?.source === "primary" || value?.source === "fallback" ? value.source : ""
  const failed = Array.isArray(value?.failed)
    ? Array.from(new Set(value.failed.filter((item) => item === "primary" || item === "fallback")))
    : []
  return { source, failed }
}

async function loadPortraitSourceState() {
  if (portraitSourceStateLoaded) return
  portraitSourceStateLoaded = true
  const session = chrome.storage?.session
  if (!session?.get) return
  try {
    const stored = await session.get([PORTRAIT_SOURCE_SESSION_KEY])
    const values = stored?.[PORTRAIT_SOURCE_SESSION_KEY]
    if (!values || typeof values !== "object") return
    for (const [key, value] of Object.entries(values)) {
      portraitSourceByTab.set(key, normalizedPortraitState(value))
    }
  } catch (_err) {
    // In-memory tab state still prevents fanout while this worker is alive.
  }
}

async function rememberPortraitSourceState(tabId, state) {
  await loadPortraitSourceState()
  portraitSourceByTab.set(portraitTabKey(tabId), normalizedPortraitState(state))
  const session = chrome.storage?.session
  if (!session?.set) return
  try {
    await session.set({
      [PORTRAIT_SOURCE_SESSION_KEY]: Object.fromEntries(portraitSourceByTab),
    })
  } catch (_err) {
    // The live worker state remains authoritative for this tab.
  }
}

async function portraitSourceState(tabId) {
  await loadPortraitSourceState()
  return normalizedPortraitState(portraitSourceByTab.get(portraitTabKey(tabId)))
}

function portraitUrlForSource(path, source) {
  return `${source === "fallback" ? PORTRAIT_FALLBACK_ORIGIN : PORTRAIT_PRIMARY_ORIGIN}${path}`
}

async function fetchPortraitBytes(resolvedUrl, cacheKey) {
  if (portraitDataUrlCache.has(cacheKey)) return portraitDataUrlCache.get(cacheKey)
  if (hasFreshPortraitDataUrlError(resolvedUrl)) return ""
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), PORTRAIT_SOURCE_TIMEOUT_MS)
  try {
    const resp = await fetch(resolvedUrl, {
      headers: {
        "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
      },
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!resp.ok) {
      console.error("[Iconoplasm] Portrait fetch failed:", resp.status, resolvedUrl)
      rememberPortraitDataUrlError(resolvedUrl, `http_${resp.status}`)
      return ""
    }
    const contentType = resp.headers.get("Content-Type") || "image/webp"
    const buffer = await resp.arrayBuffer()
    const dataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`
    // Chesterton's fence: only successful portrait bytes enter the cache.
    // Earlier blank-image behavior became hard to reason about because a caller
    // could treat an empty string like a valid warmed result. Keep failures
    // uncached so the next request can recover as soon as the CDN/object is healthy.
    rememberPortraitDataUrl(cacheKey, dataUrl)
    return dataUrl
  } catch (err) {
    console.error("[Iconoplasm] Portrait fetch error:", err)
    rememberPortraitDataUrlError(
      resolvedUrl,
      err && err.message ? err.message : String(err || "fetch_error"),
    )
    return ""
  } finally {
    clearTimeout(timer)
  }
}

async function ensurePortraitSource(rawUrl, tabId) {
  const path = portraitPath(rawUrl)
  if (!path) return ""
  const key = portraitTabKey(tabId)
  const existing = await portraitSourceState(tabId)
  if (existing.source) return existing.source
  if (portraitSourceDecisionByTab.has(key)) return portraitSourceDecisionByTab.get(key)

  const decision = (async () => {
    const primaryUrl = portraitUrlForSource(path, "primary")
    const dataUrl = await fetchPortraitBytes(primaryUrl, path)
    if (dataUrl) {
      await rememberPortraitSourceState(tabId, { source: "primary", failed: [] })
      return "primary"
    }
    await rememberPortraitSourceState(tabId, { source: "fallback", failed: ["primary"] })
    return "fallback"
  })().finally(() => {
    portraitSourceDecisionByTab.delete(key)
  })
  portraitSourceDecisionByTab.set(key, decision)
  return decision
}

async function fetchPortraitDataUrl(url, tabId) {
  const normalizedUrl = String(url || "").trim()
  if (!normalizedUrl) return { dataUrl: "", sourceUrl: "" }
  const path = portraitPath(normalizedUrl)
  if (!path) {
    const dataUrl = await fetchPortraitBytes(normalizedUrl, normalizedUrl)
    return { dataUrl, sourceUrl: normalizedUrl }
  }

  const source = await ensurePortraitSource(normalizedUrl, tabId)
  const resolvedUrl = portraitUrlForSource(path, source)
  let dataUrl = portraitDataUrlCache.get(path) || ""
  if (!dataUrl) dataUrl = await fetchPortraitBytes(resolvedUrl, path)
  if (dataUrl) return { dataUrl, sourceUrl: resolvedUrl }

  const current = await portraitSourceState(tabId)
  const failed = Array.from(new Set(current.failed.concat(source)))
  const alternate = source === "primary" ? "fallback" : "primary"
  if (failed.includes(alternate)) {
    await rememberPortraitSourceState(tabId, { source, failed })
    return { dataUrl: "", sourceUrl: resolvedUrl }
  }
  await rememberPortraitSourceState(tabId, { source: alternate, failed })
  const alternateUrl = portraitUrlForSource(path, alternate)
  dataUrl = await fetchPortraitBytes(alternateUrl, path)
  if (!dataUrl) {
    await rememberPortraitSourceState(tabId, {
      source: alternate,
      failed: Array.from(new Set(failed.concat(alternate))),
    })
  }
  return { dataUrl, sourceUrl: alternateUrl }
}

async function warmPortraitDataUrls(urls, tabId) {
  const normalized = Array.isArray(urls)
    ? Array.from(new Set(urls.map((url) => String(url || "").trim()).filter(Boolean)))
    : []
  if (!normalized.length) return 0

  const results = await Promise.all(
    normalized.map((url) => fetchPortraitDataUrl(url, tabId).catch(() => null)),
  )
  return results.filter((result) => Boolean(result?.dataUrl)).length
}

async function fetchManifest() {
  const manifestResp = await fetch(API_CATALOG_MANIFEST, {
    headers: {
      "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
    },
  })

  if (!manifestResp.ok) {
    return null
  }
  return normalizePublishedManifest(await manifestResp.json())
}

function artifactUrl(manifest) {
  if (manifest?.artifact_url) return manifest.artifact_url
  if (!manifest?.filename) return null
  const cacheKey = encodeURIComponent(String(manifest.current_hash || manifest.filename))
  return `${API_PUBLIC}/catalog/${manifest.filename}?v=${cacheKey}`
}

function projectPublishedArtifactGenes(artifact) {
  const lookup = {}
  for (const gene of artifact.genes) {
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
  return lookup
}

async function fetchPublishedArtifact(manifest) {
  const url = artifactUrl(manifest)
  if (!url) return { error: "missing_url", artifact: null }
  const response = await fetch(url, {
    headers: {
      "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
    },
  })
  if (!response.ok) return { error: `http_${response.status}`, artifact: null }
  const artifact = await response.json()
  if (!artifact || !Array.isArray(artifact.genes)) {
    return { error: "invalid_artifact", artifact: null }
  }
  return { error: "", artifact }
}

async function fetchGeneData({ forceArtifactRefresh = false } = {}) {
  try {
    const manifest = await fetchManifest()
    if (!manifest) {
      console.error("[Iconoplasm] Manifest fetch failed")
      return null
    }

    if (manifest.schema_version < REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION) {
      await invalidateStoredPublishedSnapshot({
        code: CONTRACT_ERROR_INCOMPATIBLE_ARTIFACT,
        minExtensionVersion: manifest.min_extension_version,
        message:
          "Published catalog artifact is older than the minimum schema this extension now requires.",
      })
      console.error("[Iconoplasm] Published artifact schema is too old:", manifest.schema_version)
      return null
    }

    if (compareSemver(currentExtensionVersion(), manifest.min_extension_version) < 0) {
      await invalidateStoredPublishedSnapshot({
        code: CONTRACT_ERROR_INCOMPATIBLE_EXTENSION,
        minExtensionVersion: manifest.min_extension_version,
        message:
          "Published catalog requires a newer extension build. Refusing to serve stale cached data.",
      })
      console.error(
        "[Iconoplasm] Extension version is too old:",
        currentExtensionVersion(),
        "<",
        manifest.min_extension_version,
      )
      return null
    }

    const stored = await getStoredGeneSnapshot()
    const storedGeneCount = getStoredGeneCount(stored.iconoplasm_genes)
    const artifactChanged = stored.iconoplasm_hash !== manifest.current_hash
    const aliasOverlayChanged =
      String(stored.iconoplasm_alias_overlay_version || "") !==
      String(manifest.publication_aliases.version || "")
    const needsArtifact = forceArtifactRefresh || artifactChanged || storedGeneCount === 0
    const fetchedAt = new Date().toISOString()

    if (!needsArtifact && !aliasOverlayChanged) {
      await clearContractError()
      await chrome.storage.local.set({
        iconoplasm_last_fetch: fetchedAt,
        iconoplasm_schema_version: manifest.schema_version,
        iconoplasm_portrait_base_url: manifest.portrait_base_url,
        iconoplasm_min_extension_version: manifest.min_extension_version,
      })
      return {
        schema_version: manifest.schema_version,
        gene_count: manifest.gene_count || storedGeneCount,
      }
    }

    let lookup = stored.iconoplasm_genes
    let geneCount = manifest.gene_count || storedGeneCount
    let previousApplied = stored.iconoplasm_alias_overlay_applied || {}

    if (needsArtifact) {
      const { artifact, error } = await fetchPublishedArtifact(manifest)
      if (!artifact) {
        if (error === "missing_url" || error === "invalid_artifact") {
          await invalidateStoredPublishedSnapshot({
            code: CONTRACT_ERROR_INVALID_MANIFEST,
            minExtensionVersion: manifest.min_extension_version,
            message:
              error === "missing_url"
                ? "Published catalog manifest is missing a usable artifact URL or filename."
                : "Published catalog artifact is missing the genes array required by the extension runtime.",
          })
        }
        console.error("[Iconoplasm] Artifact fetch failed:", error)
        return null
      }
      lookup = projectPublishedArtifactGenes(artifact)
      geneCount = artifact.gene_count || Object.keys(lookup).length
      previousApplied = {}
    }

    const overlayResult = IconoPublicationAliasOverlay.applyPublishedAliasOverlay(
      lookup,
      manifest.publication_aliases,
      previousApplied,
    )
    if (overlayResult.errors.length) {
      await rememberContractError({
        code: CONTRACT_ERROR_INVALID_MANIFEST,
        minExtensionVersion: manifest.min_extension_version,
        message: `Published alias overlay is invalid: ${overlayResult.errors.join("; ")}`,
      })
      console.error("[Iconoplasm] Alias overlay validation failed:", overlayResult.errors)
      return null
    }

    await chrome.storage.local.set({
      iconoplasm_genes: overlayResult.genes,
      iconoplasm_hash: manifest.current_hash,
      iconoplasm_gene_count: geneCount,
      iconoplasm_last_fetch: fetchedAt,
      iconoplasm_schema_version: manifest.schema_version,
      iconoplasm_portrait_base_url: manifest.portrait_base_url,
      iconoplasm_min_extension_version: manifest.min_extension_version,
      iconoplasm_alias_overlay_version: manifest.publication_aliases.version,
      iconoplasm_alias_overlay_applied: overlayResult.applied,
    })
    if (needsArtifact) clearPortraitDataUrlCaches()
    await clearContractError()

    return {
      schema_version: manifest.schema_version,
      gene_count: geneCount,
    }
  } catch (err) {
    console.error("[Iconoplasm] Fetch error:", err)
    return null
  }
}

if (globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__) {
  Object.assign(globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__, {
    fetchPortraitDataUrl,
    warmPortraitDataUrls,
    clearPortraitDataUrlCaches,
    clearPortraitSourceStates,
    hasFreshPortraitDataUrlError,
    portraitSourceState,
    portraitErrorTtlMs: PORTRAIT_DATA_URL_ERROR_TTL_MS,
    normalizePublishedManifest,
    fetchGeneData,
    ensureFreshGeneData,
  })
}
