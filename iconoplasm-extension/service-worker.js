// Iconoplasm service worker
// Symbol-first contract: gene symbols are canonical keys.
// Chesterton's fence: generated gene facts still come from the immutable catalog
// artifact. The small administrator-owned publication alias overlay is delivered
// by the Website manifest so an alias edit does not force a 19k-gene workstation
// sync or a multi-megabyte catalog refetch.

if (typeof importScripts === "function") {
  if (!globalThis.IconoplasmCatalogContract) {
    importScripts("generated/catalog-contract.js")
  }
  if (!globalThis.IconoplasmPortraitDelivery) {
    importScripts("generated/portrait-delivery-core.js")
  }
  if (!globalThis.IconoplasmPublicationAliasOverlay) {
    importScripts("publication-alias-overlay.js")
  }
  if (!globalThis.IconoplasmContentSettings) {
    importScripts("content-settings.js")
  }
}
const IconoCatalogContract = globalThis.IconoplasmCatalogContract
const IconoPortraitDelivery = globalThis.IconoplasmPortraitDelivery
const IconoPublicationAliasOverlay = globalThis.IconoplasmPublicationAliasOverlay
const IconoContentSettings = globalThis.IconoplasmContentSettings
if (!IconoPortraitDelivery) {
  throw new Error("Iconoplasm portrait delivery runtime is required")
}
if (!IconoPublicationAliasOverlay) {
  throw new Error("Iconoplasm publication alias overlay runtime is required")
}
if (!IconoCatalogContract) {
  throw new Error("Iconoplasm catalog contract runtime is required")
}
if (!IconoContentSettings) {
  throw new Error("Iconoplasm content settings runtime is required")
}

const HOST = "https://iconoplasm.brinedew.bio"
const API_PUBLIC = `${HOST}/api/public/v1`
const API_CATALOG_MANIFEST = `${API_PUBLIC}/catalog/manifest`
const DATA_REFRESH_TTL_MS = 5 * 60 * 1000
const MANIFEST_FETCH_TIMEOUT_MS = 5 * 1000
const ARTIFACT_FETCH_TIMEOUT_MS = 30 * 1000
const PORTRAIT_DATA_URL_CACHE_LIMIT = 48
const PORTRAIT_DATA_URL_ERROR_CACHE_LIMIT = 96
const PORTRAIT_DATA_URL_ERROR_TTL_MS = 30 * 1000
const PORTRAIT_SOURCE_SESSION_KEY = "iconoplasm_portrait_source_by_tab"
const REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION = Number(
  IconoCatalogContract.catalog?.schemaVersion,
)
const REQUIRED_PUBLISHED_CATALOG_CONTRACT_REVISION = Number(IconoCatalogContract.catalog?.revision)
const REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION = Number(IconoCatalogContract.scanner?.schemaVersion)
const REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION = Number(IconoCatalogContract.scanner?.revision)
const SCANNER_INDEX_STORAGE_VERSION = 1
const SCANNER_ARTIFACT_MAX_BYTES = 3 * 1024 * 1024
const SCANNER_INDEX_MAX_BYTES = SCANNER_ARTIFACT_MAX_BYTES + 128 * 1024
const SHARED_BLOCKLIST_STORAGE_KEY = IconoContentSettings.storageKeys.sharedBlocklist
if (
  !Number.isInteger(REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION) ||
  REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION < 1 ||
  !Number.isInteger(REQUIRED_PUBLISHED_CATALOG_CONTRACT_REVISION) ||
  REQUIRED_PUBLISHED_CATALOG_CONTRACT_REVISION < 1 ||
  !Number.isInteger(REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION) ||
  REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION < 1 ||
  !Number.isInteger(REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION) ||
  REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION < 1
) {
  throw new Error("Iconoplasm catalog contract runtime is invalid")
}
const CONTRACT_ERROR_INVALID_MANIFEST = "invalid_manifest"
const CONTRACT_ERROR_INCOMPATIBLE_ARTIFACT = "incompatible_artifact"
const CONTRACT_ERROR_INCOMPATIBLE_EXTENSION = "incompatible_extension"
const portraitDataUrlCache = new Map()
const portraitDataUrlErrorCache = new Map()
const portraitSourceByTab = new Map()
const portraitDeliverySessionByTab = new Map()
const portraitDeliverySessionPromiseByTab = new Map()
let portraitSourceStateLoaded = false
let portraitDeliveryPolicy = IconoPortraitDelivery.normalizePortraitDeliveryPolicy()
let geneDataRefreshState = null

chrome.runtime.onInstalled.addListener(() => {
  void refreshGeneData()
})

chrome.runtime.onStartup.addListener(() => {
  void refreshGeneData()
})

if (chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await loadPortraitSourceState()
    portraitSourceByTab.delete(portraitTabKey(tabId))
    portraitDeliverySessionByTab.delete(portraitTabKey(tabId))
    portraitDeliverySessionPromiseByTab.delete(portraitTabKey(tabId))
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
    refreshGeneData({ forceArtifactRefresh: true }).then((result) =>
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
    "iconoplasm_contract_revision",
    "iconoplasm_scanner_hash",
    "iconoplasm_scanner_schema_version",
    "iconoplasm_scanner_contract_revision",
    "iconoplasm_scanner_index_storage_version",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_card_snapshot_version",
    SHARED_BLOCKLIST_STORAGE_KEY,
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
  ])
  return {
    hash: result.iconoplasm_hash || null,
    geneCount: result.iconoplasm_gene_count || 0,
    lastFetch: result.iconoplasm_last_fetch || null,
    schemaVersion: result.iconoplasm_schema_version || null,
    contractRevision: result.iconoplasm_contract_revision || null,
    scannerHash: result.iconoplasm_scanner_hash || null,
    scannerSchemaVersion: result.iconoplasm_scanner_schema_version || null,
    scannerContractRevision: result.iconoplasm_scanner_contract_revision || null,
    aliasOverlayVersion: result.iconoplasm_alias_overlay_version || null,
    cardSnapshotVersion: result.iconoplasm_card_snapshot_version || null,
    sharedBlocklistRevision:
      IconoContentSettings.normalizeSharedBlocklistProjection(result[SHARED_BLOCKLIST_STORAGE_KEY])
        ?.revision || null,
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
    "iconoplasm_contract_error",
    "iconoplasm_min_extension_version",
  ])
  return {
    genes: result.iconoplasm_genes || null,
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
    "iconoplasm_contract_revision",
    "iconoplasm_scanner_hash",
    "iconoplasm_scanner_schema_version",
    "iconoplasm_scanner_contract_revision",
    "iconoplasm_scanner_index_storage_version",
    "iconoplasm_portrait_delivery",
    "iconoplasm_card_snapshot_version",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_alias_overlay_applied",
    SHARED_BLOCKLIST_STORAGE_KEY,
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
  let portraitDelivery
  try {
    portraitDelivery = IconoPortraitDelivery.normalizePortraitDeliveryPolicy(
      manifest.portrait_delivery,
    )
  } catch (_error) {
    return null
  }
  const schemaVersion = Number.parseInt(
    String(manifest.artifact_schema_version ?? manifest.schema_version ?? 0),
    10,
  )
  const contractRevision = Number.parseInt(
    String(manifest.artifact_contract_revision ?? manifest.contract_revision ?? 0),
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
  const extensionBlocklist = IconoContentSettings.normalizeSharedBlocklistProjection(
    manifest.extension_blocklist,
  )
  const scannerArtifact =
    manifest.scanner_artifact && typeof manifest.scanner_artifact === "object"
      ? manifest.scanner_artifact
      : null
  const scannerSchemaVersion = Number.parseInt(String(scannerArtifact?.schema_version ?? 0), 10)
  const scannerContractRevision = Number.parseInt(
    String(scannerArtifact?.contract_revision ?? 0),
    10,
  )
  const scannerBuildVersion = String(scannerArtifact?.build_version || "").trim()
  const scannerArtifactUrl = String(scannerArtifact?.artifact_url || "").trim()
  const scannerByteSize = Number(scannerArtifact?.byte_size || 0)
  if (
    !currentHash ||
    (!filename && !artifactUrl) ||
    !Number.isFinite(schemaVersion) ||
    !Number.isFinite(contractRevision) ||
    !publicationAliases ||
    !scannerBuildVersion ||
    !scannerArtifactUrl ||
    !Number.isInteger(scannerSchemaVersion) ||
    !Number.isInteger(scannerContractRevision) ||
    !Number.isInteger(scannerByteSize) ||
    scannerByteSize < 1 ||
    scannerByteSize > SCANNER_ARTIFACT_MAX_BYTES
  ) {
    return null
  }
  return {
    current_hash: currentHash,
    filename: filename || null,
    artifact_url: artifactUrl || null,
    portrait_delivery: portraitDelivery,
    schema_version: schemaVersion,
    contract_revision: contractRevision,
    gene_count: Number.isFinite(Number(manifest.gene_count)) ? Number(manifest.gene_count) : null,
    min_extension_version: minExtensionVersion || currentExtensionVersion(),
    publication_aliases: publicationAliases,
    extension_blocklist: extensionBlocklist,
    card_snapshot_version: String(manifest.card_snapshot_version || "").trim() || null,
    scanner_artifact: {
      schema_version: scannerSchemaVersion,
      contract_revision: scannerContractRevision,
      build_version: scannerBuildVersion,
      artifact_url: scannerArtifactUrl,
      byte_size: scannerByteSize,
    },
  }
}

async function acceptPublishedExtensionBlocklist(publishedProjection, storedProjection) {
  const stored = IconoContentSettings.normalizeSharedBlocklistProjection(storedProjection)
  const published = IconoContentSettings.normalizeSharedBlocklistProjection(publishedProjection)
  if (!published || (stored && published.revision <= stored.revision)) return stored

  // ARCHITECTURE FENCE [IPD-008]: one storage item is the atomic last-known-good
  // policy. A valid empty terms array is authoritative; missing, malformed, equal,
  // or lower revisions never erase or replace the accepted projection.
  await chrome.storage.local.set({ [SHARED_BLOCKLIST_STORAGE_KEY]: published })
  return published
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
    "iconoplasm_contract_revision",
    "iconoplasm_scanner_hash",
    "iconoplasm_scanner_schema_version",
    "iconoplasm_scanner_contract_revision",
    "iconoplasm_scanner_index_storage_version",
    "iconoplasm_portrait_delivery",
    "iconoplasm_alias_overlay_version",
    "iconoplasm_alias_overlay_applied",
  ])
  await rememberContractError({ code, message, minExtensionVersion })
}

async function ensureFreshGeneData() {
  const stored = await migrateLegacyStoredScannerIndex(await getStoredGeneSnapshot())
  const geneCount = getStoredGeneCount(stored.iconoplasm_genes)
  const hasPublishedCatalogSchema =
    Number(stored.iconoplasm_schema_version || 0) === REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION &&
    Number(stored.iconoplasm_contract_revision || 0) ===
      REQUIRED_PUBLISHED_CATALOG_CONTRACT_REVISION &&
    Boolean(stored.iconoplasm_portrait_delivery)
  const hasScannerIndexSchema =
    Number(stored.iconoplasm_scanner_schema_version || 0) ===
      REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION &&
    Number(stored.iconoplasm_scanner_contract_revision || 0) ===
      REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION &&
    Number(stored.iconoplasm_scanner_index_storage_version || 0) === SCANNER_INDEX_STORAGE_VERSION
  const hasContractError = Boolean(stored.iconoplasm_contract_error)
  const needsArtifactRebuild =
    geneCount === 0 || !hasPublishedCatalogSchema || !hasScannerIndexSchema
  const needsRefresh =
    hasContractError || needsArtifactRebuild || isStaleFetch(stored.iconoplasm_last_fetch)

  const hasUsableCache =
    geneCount > 0 && hasPublishedCatalogSchema && hasScannerIndexSchema && !hasContractError
  if (hasUsableCache) {
    // Stale-while-revalidate is the page-start contract. A valid local catalog is
    // immediately useful; network freshness must never hold every tab hostage.
    if (needsRefresh) void refreshGeneData()
    return {
      genes: stored.iconoplasm_genes,
      contractError: null,
      minExtensionVersion: stored.iconoplasm_min_extension_version || null,
    }
  }

  if (needsRefresh) {
    // A manifest-overlay contract error is retried against the manifest only.
    // The immutable scanner artifact is already known-good and must not become
    // a whole-index retry penalty just because a small alias overlay was rejected.
    await refreshGeneData({ forceArtifactRefresh: needsArtifactRebuild })
  }

  return getStoredGeneData()
}

async function refreshGeneData({ forceArtifactRefresh = false } = {}) {
  const wantsForcedArtifact = Boolean(forceArtifactRefresh)
  if (geneDataRefreshState) {
    const activeRefresh = geneDataRefreshState
    const result = await activeRefresh.promise
    if (!wantsForcedArtifact || activeRefresh.forceArtifactRefresh) return result
    return refreshGeneData({ forceArtifactRefresh: true })
  }

  const refreshState = {
    forceArtifactRefresh: wantsForcedArtifact,
    promise: null,
  }
  refreshState.promise = fetchGeneData({ forceArtifactRefresh: wantsForcedArtifact }).finally(
    () => {
      if (geneDataRefreshState === refreshState) geneDataRefreshState = null
    },
  )
  geneDataRefreshState = refreshState
  return refreshState.promise
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
  portraitDeliverySessionByTab.clear()
  portraitDeliverySessionPromiseByTab.clear()
  portraitSourceStateLoaded = true
  const session = chrome.storage?.session
  if (session?.remove) await session.remove([PORTRAIT_SOURCE_SESSION_KEY])
}

function portraitTabKey(tabId) {
  return Number.isInteger(tabId) && tabId >= 0 ? String(tabId) : "extension"
}

function normalizedPortraitState(value) {
  return IconoPortraitDelivery.normalizePortraitDeliveryState(value, portraitDeliveryPolicy)
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

function configurePortraitDeliveryPolicy(rawPolicy) {
  portraitDeliveryPolicy = IconoPortraitDelivery.normalizePortraitDeliveryPolicy(rawPolicy)
  for (const session of portraitDeliverySessionByTab.values())
    session.configure(portraitDeliveryPolicy)
  return portraitDeliveryPolicy
}

async function fetchPortraitBytes(resolvedUrl, cacheKey) {
  if (portraitDataUrlCache.has(cacheKey)) return portraitDataUrlCache.get(cacheKey)
  if (hasFreshPortraitDataUrlError(resolvedUrl)) return ""
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timer = setTimeout(() => controller?.abort(), portraitDeliveryPolicy.probe_timeout_ms)
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

async function portraitDeliverySession(tabId) {
  const key = portraitTabKey(tabId)
  if (portraitDeliverySessionByTab.has(key)) return portraitDeliverySessionByTab.get(key)
  if (portraitDeliverySessionPromiseByTab.has(key)) {
    return portraitDeliverySessionPromiseByTab.get(key)
  }
  const loading = (async () => {
    const initialState = await portraitSourceState(tabId)
    const session = IconoPortraitDelivery.createPortraitDeliverySession({
      policy: portraitDeliveryPolicy,
      initialState,
      probe: async (url) => {
        const path = IconoPortraitDelivery.portraitPath(url, portraitDeliveryPolicy)
        return Boolean(path && (await fetchPortraitBytes(url, path)))
      },
      persist(state) {
        return rememberPortraitSourceState(tabId, state)
      },
    })
    portraitDeliverySessionByTab.set(key, session)
    return session
  })().finally(() => portraitDeliverySessionPromiseByTab.delete(key))
  portraitDeliverySessionPromiseByTab.set(key, loading)
  return loading
}

async function fetchPortraitDataUrl(url, tabId) {
  const normalizedUrl = String(url || "").trim()
  if (!normalizedUrl) return { dataUrl: "", sourceUrl: "" }
  const path = IconoPortraitDelivery.portraitPath(normalizedUrl, portraitDeliveryPolicy)
  if (!path) {
    const dataUrl = await fetchPortraitBytes(normalizedUrl, normalizedUrl)
    return { dataUrl, sourceUrl: normalizedUrl }
  }

  const session = await portraitDeliverySession(tabId)
  const resolvedUrl = await session.ensure(normalizedUrl)
  let dataUrl = portraitDataUrlCache.get(path) || ""
  if (!dataUrl) dataUrl = await fetchPortraitBytes(resolvedUrl, path)
  if (dataUrl) return { dataUrl, sourceUrl: resolvedUrl }

  const failure = session.reportFailure(resolvedUrl)
  if (!failure.changed || failure.state.state === "terminal_failure") {
    return { dataUrl: "", sourceUrl: resolvedUrl }
  }
  const alternateUrl = failure.replacementUrl
  dataUrl = await fetchPortraitBytes(alternateUrl, path)
  if (!dataUrl) {
    session.reportFailure(alternateUrl)
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

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort()
      reject(new Error(`Iconoplasm request timed out after ${timeoutMs} ms`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      fetch(url, { ...(options || {}), signal: controller.signal }),
      timeoutPromise,
    ])
  } finally {
    clearTimeout(timeoutId)
  }
}

async function fetchManifest() {
  const manifestResp = await fetchWithTimeout(
    API_CATALOG_MANIFEST,
    {
      headers: {
        "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
      },
    },
    MANIFEST_FETCH_TIMEOUT_MS,
  )

  if (!manifestResp.ok) {
    return null
  }
  return normalizePublishedManifest(await manifestResp.json())
}

function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function normalizeScannerIndex(rawGenes) {
  const lookup = {}
  const entries = Array.isArray(rawGenes)
    ? rawGenes.map((gene) => [gene?.s, gene])
    : Object.entries(rawGenes && typeof rawGenes === "object" ? rawGenes : {})
  for (const [rawSymbol, gene] of entries) {
    const symbol = String(rawSymbol || "")
      .trim()
      .toUpperCase()
    if (!symbol) continue
    if (!gene || typeof gene !== "object") continue
    const entry = {}
    if (gene.c) entry.c = gene.c
    if (gene.n) entry.n = gene.n
    if (gene.u) entry.u = gene.u
    if (Array.isArray(gene.a) && gene.a.length) entry.a = gene.a
    lookup[symbol] = entry
  }
  return lookup
}

async function migrateLegacyStoredScannerIndex(stored) {
  const snapshot = stored && typeof stored === "object" ? stored : {}
  const genes = snapshot.iconoplasm_genes
  if (!genes || typeof genes !== "object") return snapshot
  const alreadyCurrent =
    Number(snapshot.iconoplasm_scanner_index_storage_version || 0) ===
      SCANNER_INDEX_STORAGE_VERSION &&
    Number(snapshot.iconoplasm_scanner_schema_version || 0) ===
      REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION &&
    Number(snapshot.iconoplasm_scanner_contract_revision || 0) ===
      REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION
  if (alreadyCurrent) return snapshot

  // ARCHITECTURE FENCE [IPD-008]: 0.4.11 stored portrait references inside the
  // page scanner map. Replace that item atomically with its compact projection
  // before any tab can receive the legacy multi-megabyte payload.
  const compactGenes = normalizeScannerIndex(genes)
  const compactBytes = jsonByteLength(compactGenes)
  if (compactBytes > SCANNER_INDEX_MAX_BYTES) {
    await chrome.storage.local.remove([
      "iconoplasm_genes",
      "iconoplasm_gene_count",
      "iconoplasm_scanner_hash",
      "iconoplasm_scanner_schema_version",
      "iconoplasm_scanner_contract_revision",
      "iconoplasm_scanner_index_storage_version",
    ])
    return {
      ...snapshot,
      iconoplasm_genes: null,
      iconoplasm_gene_count: 0,
      iconoplasm_scanner_hash: null,
      iconoplasm_scanner_schema_version: null,
      iconoplasm_scanner_contract_revision: null,
      iconoplasm_scanner_index_storage_version: null,
    }
  }
  const migration = {
    iconoplasm_genes: compactGenes,
    iconoplasm_gene_count: Object.keys(compactGenes).length,
    // Force an immediate background fetch of the authoritative scanner artifact.
    // The compact legacy projection is safe to serve while that refresh runs.
    iconoplasm_last_fetch: null,
    iconoplasm_scanner_hash: `legacy:${String(snapshot.iconoplasm_hash || "unknown")}`,
    iconoplasm_scanner_schema_version: REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION,
    iconoplasm_scanner_contract_revision: REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION,
    iconoplasm_scanner_index_storage_version: SCANNER_INDEX_STORAGE_VERSION,
  }
  await chrome.storage.local.set(migration)
  return { ...snapshot, ...migration }
}

async function fetchPublishedScannerArtifact(manifest) {
  const url = manifest?.scanner_artifact?.artifact_url
  if (!url) return { error: "missing_url", artifact: null }
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        "X-Iconoplasm-Extension-Version": currentExtensionVersion(),
      },
    },
    ARTIFACT_FETCH_TIMEOUT_MS,
  )
  if (!response.ok) return { error: `http_${response.status}`, artifact: null }
  const rawArtifact = await response.text()
  const artifactBytes = new TextEncoder().encode(rawArtifact).byteLength
  if (
    artifactBytes > SCANNER_ARTIFACT_MAX_BYTES ||
    artifactBytes !== Number(manifest.scanner_artifact.byte_size)
  ) {
    return { error: "invalid_artifact_size", artifact: null }
  }
  let artifact
  try {
    artifact = JSON.parse(rawArtifact)
  } catch (_error) {
    return { error: "invalid_artifact", artifact: null }
  }
  if (
    !artifact ||
    Number(artifact.schema_version || 0) !== REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION ||
    Number(artifact.contract_revision || 0) !== REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION ||
    !artifact.genes ||
    Array.isArray(artifact.genes) ||
    typeof artifact.genes !== "object"
  ) {
    return { error: "invalid_artifact", artifact: null }
  }
  const genes = normalizeScannerIndex(artifact.genes)
  const geneCount = Object.keys(genes).length
  if (
    geneCount !== Number(artifact.gene_count || 0) ||
    (manifest.gene_count != null && geneCount !== Number(manifest.gene_count))
  ) {
    return { error: "invalid_gene_count", artifact: null }
  }
  return { error: "", artifact: { ...artifact, genes } }
}

async function fetchGeneData({ forceArtifactRefresh = false } = {}) {
  try {
    const manifest = await fetchManifest()
    if (!manifest) {
      console.error("[Iconoplasm] Manifest fetch failed")
      return null
    }
    configurePortraitDeliveryPolicy(manifest.portrait_delivery)

    if (
      manifest.schema_version !== REQUIRED_PUBLISHED_CATALOG_SCHEMA_VERSION ||
      manifest.contract_revision !== REQUIRED_PUBLISHED_CATALOG_CONTRACT_REVISION
    ) {
      await invalidateStoredPublishedSnapshot({
        code: CONTRACT_ERROR_INCOMPATIBLE_ARTIFACT,
        minExtensionVersion: manifest.min_extension_version,
        message:
          "Published catalog contract does not exactly match the schema and revision required by this extension.",
      })
      console.error("[Iconoplasm] Published catalog contract is incompatible:", {
        schemaVersion: manifest.schema_version,
        contractRevision: manifest.contract_revision,
      })
      return null
    }
    if (
      manifest.scanner_artifact.schema_version !== REQUIRED_SCANNER_ARTIFACT_SCHEMA_VERSION ||
      manifest.scanner_artifact.contract_revision !== REQUIRED_SCANNER_ARTIFACT_CONTRACT_REVISION
    ) {
      await invalidateStoredPublishedSnapshot({
        code: CONTRACT_ERROR_INCOMPATIBLE_ARTIFACT,
        minExtensionVersion: manifest.min_extension_version,
        message:
          "Published scanner artifact contract does not match the schema and revision required by this extension.",
      })
      console.error("[Iconoplasm] Published scanner artifact contract is incompatible:", {
        schemaVersion: manifest.scanner_artifact.schema_version,
        contractRevision: manifest.scanner_artifact.contract_revision,
      })
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

    const stored = await migrateLegacyStoredScannerIndex(await getStoredGeneSnapshot())
    await acceptPublishedExtensionBlocklist(
      manifest.extension_blocklist,
      stored[SHARED_BLOCKLIST_STORAGE_KEY],
    )
    const storedGeneCount = getStoredGeneCount(stored.iconoplasm_genes)
    const artifactChanged =
      String(stored.iconoplasm_scanner_hash || "") !==
      String(manifest.scanner_artifact.build_version || "")
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
        iconoplasm_contract_revision: manifest.contract_revision,
        iconoplasm_hash: manifest.current_hash,
        iconoplasm_scanner_hash: manifest.scanner_artifact.build_version,
        iconoplasm_scanner_schema_version: manifest.scanner_artifact.schema_version,
        iconoplasm_scanner_contract_revision: manifest.scanner_artifact.contract_revision,
        iconoplasm_scanner_index_storage_version: SCANNER_INDEX_STORAGE_VERSION,
        iconoplasm_portrait_delivery: manifest.portrait_delivery,
        iconoplasm_min_extension_version: manifest.min_extension_version,
        iconoplasm_card_snapshot_version: manifest.card_snapshot_version,
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
      const { artifact, error } = await fetchPublishedScannerArtifact(manifest)
      if (!artifact) {
        if (
          error === "missing_url" ||
          error === "invalid_artifact" ||
          error === "invalid_artifact_size" ||
          error === "invalid_gene_count"
        ) {
          await invalidateStoredPublishedSnapshot({
            code: CONTRACT_ERROR_INVALID_MANIFEST,
            minExtensionVersion: manifest.min_extension_version,
            message:
              error === "missing_url"
                ? "Published catalog manifest is missing a usable scanner artifact URL."
                : "Published scanner artifact is invalid or exceeds the extension storage budget.",
          })
        }
        console.error("[Iconoplasm] Scanner artifact fetch failed:", error)
        return null
      }
      lookup = artifact.genes
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
    const scannerIndexBytes = jsonByteLength(overlayResult.genes)
    if (scannerIndexBytes > SCANNER_INDEX_MAX_BYTES) {
      await rememberContractError({
        code: CONTRACT_ERROR_INVALID_MANIFEST,
        minExtensionVersion: manifest.min_extension_version,
        message: `Published scanner index exceeds its ${SCANNER_INDEX_MAX_BYTES}-byte storage budget.`,
      })
      console.error("[Iconoplasm] Scanner index storage budget exceeded:", scannerIndexBytes)
      return null
    }

    await chrome.storage.local.set({
      iconoplasm_genes: overlayResult.genes,
      iconoplasm_hash: manifest.current_hash,
      iconoplasm_scanner_hash: manifest.scanner_artifact.build_version,
      iconoplasm_scanner_schema_version: manifest.scanner_artifact.schema_version,
      iconoplasm_scanner_contract_revision: manifest.scanner_artifact.contract_revision,
      iconoplasm_scanner_index_storage_version: SCANNER_INDEX_STORAGE_VERSION,
      iconoplasm_gene_count: geneCount,
      iconoplasm_last_fetch: fetchedAt,
      iconoplasm_schema_version: manifest.schema_version,
      iconoplasm_contract_revision: manifest.contract_revision,
      iconoplasm_portrait_delivery: manifest.portrait_delivery,
      iconoplasm_min_extension_version: manifest.min_extension_version,
      iconoplasm_card_snapshot_version: manifest.card_snapshot_version,
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
    acceptPublishedExtensionBlocklist,
    normalizeScannerIndex,
    migrateLegacyStoredScannerIndex,
    fetchPublishedScannerArtifact,
    jsonByteLength,
    scannerArtifactMaxBytes: SCANNER_ARTIFACT_MAX_BYTES,
    scannerIndexMaxBytes: SCANNER_INDEX_MAX_BYTES,
    fetchGeneData,
    fetchWithTimeout,
    refreshGeneData,
    ensureFreshGeneData,
  })
}
