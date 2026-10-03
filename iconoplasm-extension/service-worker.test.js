import assert from "node:assert/strict"

import test from "node:test"

// ARCHITECTURE FENCE [IPD-008]: arbitrary tabs receive a bounded, portrait-free scanner index.

const storageState = new Map()
const sessionState = new Map()
const tabsMessages = []
let tabsQueryResult = []
let messageListener
const requestedOverlay = {
  schema_version: 1,
  version: "v1-test",
  alias_count: 8,
  by_symbol: {
    CEBPB: ["C/EBPβ"],
    CGAS: ["cGAS"],
    IL1A: ["IL-1", "IL-1α"],
    IL1B: ["IL-1β"],
    NOTCH1: ["N1ICD"],
    RELA: ["p65"],
    TGFB1: ["TGF-β"],
  },
}

const portraitDeliveryPolicy = {
  version: 1,
  canonical_origin: "https://iconoplasm.brinedew.bio",
  accelerator: {
    id: "bunny",
    origin: "https://iconoplasmportraits.b-cdn.net",
    enabled: true,
  },
  probe_timeout_ms: 2500,
  decision_scope: "tab",
}
const scannerContract = {
  schemaVersion: 1,
  revision: 1,
}

function scannerManifest(buildVersion, byteSize = 128) {
  return {
    schema_version: scannerContract.schemaVersion,
    contract_revision: scannerContract.revision,
    build_version: buildVersion,
    byte_size: byteSize,
    artifact_url: `https://iconoplasm.brinedew.bio/api/public/v1/catalog/scanner.${buildVersion}.json`,
  }
}

function sharedBlocklistProjection(revision, terms) {
  return {
    schema_version: 1,
    revision,
    version: `ebl1-${revision.toString(16).padStart(16, "0")}`,
    term_count: terms.length,
    terms,
  }
}

function rememberScannerState(buildVersion) {
  storageState.set("iconoplasm_scanner_hash", buildVersion)
  storageState.set("iconoplasm_scanner_schema_version", scannerContract.schemaVersion)
  storageState.set("iconoplasm_scanner_contract_revision", scannerContract.revision)
  storageState.set("iconoplasm_scanner_index_storage_version", 1)
}

function storageArea(state) {
  return {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: state.get(keys) }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, state.get(key)]))
      }
      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.keys(keys).map((key) => [key, state.has(key) ? state.get(key) : keys[key]]),
        )
      }
      return {}
    },
    async set(values) {
      for (const [key, value] of Object.entries(values || {})) state.set(key, value)
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) state.delete(key)
    },
  }
}

globalThis.chrome = {
  runtime: {
    getManifest() {
      return { version: "1.2.3" }
    },
    onInstalled: {
      addListener() {},
    },
    onStartup: {
      addListener() {},
    },
    onMessage: {
      addListener(listener) {
        messageListener = listener
      },
    },
  },
  storage: {
    local: storageArea(storageState),
    session: storageArea(sessionState),
  },
  tabs: {
    onRemoved: { addListener() {} },
    query(_query, callback) {
      callback(tabsQueryResult)
    },
    sendMessage(tabId, message, callback) {
      tabsMessages.push({ tabId, message })
      if (callback) callback()
    },
  },
}

globalThis.btoa = (value) => Buffer.from(String(value || ""), "binary").toString("base64")
globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__ = {}
globalThis.IconoplasmPortraitDelivery =
  await import("../shared/iconoplasm-portrait/portrait-delivery-core.js")

await import("./generated/catalog-contract.js")
await import("./publication-alias-overlay.js")
await import("./content-settings.js")
await import("./immutable-response-cache.js")
await import("./content-portrait-cache.js")
await import("./service-worker.js")

const hooks = globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__

test("shared blocklist acceptance rejects incomplete high revisions and accepts later valid policy", async () => {
  storageState.clear()
  const accepted = sharedBlocklistProjection(3, ["SPATIAL"])
  try {
    await hooks.acceptPublishedExtensionBlocklist(accepted, null)
    assert.deepEqual(storageState.get("iconoplasm_extension_blocklist"), accepted)

    const missingVersion = sharedBlocklistProjection(9, ["POISON"])
    delete missingVersion.version
    const missingTermCount = sharedBlocklistProjection(10, ["POISON"])
    delete missingTermCount.term_count

    for (const candidate of [
      null,
      { ...sharedBlocklistProjection(4, ["BAD"]), schema_version: 2 },
      missingVersion,
      missingTermCount,
      sharedBlocklistProjection(2, ["OLDER"]),
      sharedBlocklistProjection(3, ["SAME-REVISION-MUTATION"]),
    ]) {
      await hooks.acceptPublishedExtensionBlocklist(
        candidate,
        storageState.get("iconoplasm_extension_blocklist"),
      )
      assert.deepEqual(storageState.get("iconoplasm_extension_blocklist"), accepted)
    }

    const intentionalEmpty = sharedBlocklistProjection(4, [])
    await hooks.acceptPublishedExtensionBlocklist(
      intentionalEmpty,
      storageState.get("iconoplasm_extension_blocklist"),
    )
    assert.deepEqual(storageState.get("iconoplasm_extension_blocklist"), intentionalEmpty)
  } finally {
    storageState.clear()
  }
})

// ARCHITECTURE FENCE [IPD-001]: an ISP failure belongs to one tab, not a country
// or the shared extension worker. Exercise the native image planning boundary.
test("a blocked tab cannot disable Bunny for healthy tabs or new VPN sessions", async () => {
  const originalFetch = globalThis.fetch
  let workerFetches = 0
  globalThis.fetch = async () => {
    workerFetches += 1
    throw new Error("native source planning must not buffer image bytes")
  }
  await hooks.clearPortraitSourceStates()
  try {
    const canonical = "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp"
    const blocked = await hooks.portraitSourcePlan(canonical, 301)
    await hooks.reportPortraitSourceResult(blocked.primaryUrl, false, 301)
    await hooks.reportPortraitSourceResult(blocked.fallbackUrl, true, 301)

    const healthy = await hooks.portraitSourcePlan(canonical, 302)
    assert.equal(healthy.primarySource, "accelerator")
    await hooks.reportPortraitSourceResult(healthy.primaryUrl, true, 302)

    const plans = await Promise.all(
      Array.from({ length: 100 }, async (_, index) => {
        const url = `https://iconoplasm.brinedew.bio/portraits/v1/aa/asset-${index}/medium.webp`
        return Promise.all([hooks.portraitSourcePlan(url, 301), hooks.portraitSourcePlan(url, 302)])
      }),
    )
    for (const [fallback, direct] of plans) {
      assert.equal(fallback.primarySource, "canonical")
      assert.equal(direct.primarySource, "accelerator")
      assert.equal(new URL(direct.primaryUrl).origin, portraitDeliveryPolicy.accelerator.origin)
      assert.equal(new URL(fallback.primaryUrl).pathname, new URL(direct.primaryUrl).pathname)
    }
    // A new tab on a working VPN gets its own probe; it must not inherit 301.
    const fresh = await hooks.portraitSourcePlan(canonical, 303)
    assert.equal(fresh.primarySource, "accelerator")
    assert.equal(fresh.hedgeDelayMs, 350)
    assert.equal(workerFetches, 0)
  } finally {
    globalThis.fetch = originalFetch
    await hooks.clearPortraitSourceStates()
  }
})

test("failed portrait bytes never poison reuse or suppress a later successful request", async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  let shouldFail = true

  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async () => {
    fetchCalls += 1
    if (shouldFail) {
      return new Response("missing", { status: 503 })
    }
    return new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })
  }

  try {
    const url = "https://iconoplasm.brinedew.bio/media/tp53-thumb.webp"

    const first = await hooks.fetchPortraitDataUrl(url)
    const second = await hooks.fetchPortraitDataUrl(url)

    assert.equal(first.dataUrl, "")
    assert.equal(second.dataUrl, "")
    assert.equal(fetchCalls, 2)
    shouldFail = false

    const third = await hooks.fetchPortraitDataUrl(url)
    const fourth = await hooks.fetchPortraitDataUrl(url)

    assert.match(third.dataUrl, /^data:image\/png;base64,/)
    assert.equal(fourth.dataUrl, third.dataUrl)
    assert.equal(fetchCalls, 3)
  } finally {
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
  }
})

// B-898 stage 1: the hover card reads one stable object per gene from the free
// CDN. Failure modes pinned here:
// 1. Stable object served -> one CDN fetch, credentials omitted, record mapped.
// 2. Cache hit within the 5-minute TTL -> no second fetch, across tabs.
// 3. The catalog manifest is read from the CDN first and falls back to the
//    origin, without a client-version header that would fragment the cache.

const STABLE_CDN = "https://iconoplasmportraits.b-cdn.net/genes/v3/"

function stableObject(symbol) {
  return {
    symbol,
    canonical_symbol: symbol,
    full_name: `${symbol} full name`,
    color: "#35353c",
    essence: { name: `${symbol} full name` },
    stable_object_version: 3,
    candidate_count: 1,
    portrait: {
      asset_sha256: "e".repeat(64),
      status: "published",
      medium_url: `https://iconoplasm.brinedew.bio/portraits/v1/ee/${"e".repeat(64)}/medium.webp`,
      width: 768,
      height: 1024,
    },
    portrait_candidates: [],
    published_at: "2026-10-01T00:00:00.000Z",
  }
}

function sendStableGene(symbol, tabId = 1301) {
  return new Promise((resolve) =>
    messageListener({ type: "ICONOPLASM_STABLE_GENE", symbol }, { tab: { id: tabId } }, resolve),
  )
}

test("the hover card reads one stable object per gene from the CDN and caches it across tabs", async () => {
  const originalFetch = globalThis.fetch
  hooks.stableGeneCache.clear()
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === `${STABLE_CDN}TP53.json`) return Response.json(stableObject("TP53"))
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    const wikipedia = await sendStableGene("tp53", 1301)
    assert.equal(wikipedia.ok, true)
    assert.equal(wikipedia.status, "found")
    assert.equal(wikipedia.gene.full_name, "TP53 full name")
    assert.equal(wikipedia.gene.portrait.asset_sha256, "e".repeat(64))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.credentials, "omit")
    assert.equal(calls[0].init.cache, "no-cache", "a 30-day CDN max-age must not pin a stale gene")
    assert.equal(
      new Headers(calls[0].init.headers || {}).has("X-Iconoplasm-Extension-Version"),
      false,
      "a client-version header would fragment the shared CDN cache",
    )
    const paper = await sendStableGene("TP53", 1302)
    assert.equal(paper.status, "found")
    assert.equal(calls.length, 1, "a second tab reuses the cached object within the TTL")
    const entry = hooks.stableGeneCache.get("TP53")
    assert.ok(entry.expiresAt - Date.now() > 290_000 && entry.expiresAt - Date.now() <= 300_000)
  } finally {
    globalThis.fetch = originalFetch
    hooks.stableGeneCache.clear()
  }
})

test("the catalog manifest is read from the CDN first and falls back to the origin", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  const calls = []
  const manifest = {
    build_version: "catalog-cdn-first",
    catalog_hash: "catalog-cdn-first",
    artifact_url: "https://example.test/catalog.json",
    artifact_schema_version: 5,
    artifact_contract_revision: 1,
    min_extension_version: "1.0.0",
    gene_count: 7,
    portrait_delivery: portraitDeliveryPolicy,
    scanner_artifact: scannerManifest("scanner-cdn-first"),
    publication_aliases: requestedOverlay,
  }
  let cdnHealthy = false
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, init })
    if (url === "https://iconoplasmportraits.b-cdn.net/api/public/v1/catalog/manifest") {
      if (!cdnHealthy) return new Response("edge error", { status: 502 })
      return Response.json(manifest)
    }
    if (url === "https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest") {
      return Response.json(manifest)
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  try {
    storageState.set("iconoplasm_genes", { RELA: { n: "RELA" } })
    storageState.set("iconoplasm_gene_count", 1)
    rememberScannerState("scanner-cdn-first")
    storageState.set("iconoplasm_alias_overlay_version", "v1-test")
    storageState.set("iconoplasm_alias_overlay_applied", {})
    const fallback = await hooks.fetchGeneData()
    assert.equal(fallback.gene_count, 7)
    assert.deepEqual(
      calls.map((call) => new URL(call.url).host),
      ["iconoplasmportraits.b-cdn.net", "iconoplasm.brinedew.bio"],
    )
    for (const call of calls) {
      assert.equal(call.init.credentials, "omit")
      assert.equal(
        new Headers(call.init.headers || {}).has("X-Iconoplasm-Extension-Version"),
        false,
      )
    }
    calls.length = 0
    cdnHealthy = true
    const healthy = await hooks.fetchGeneData()
    assert.equal(healthy.gene_count, 7)
    assert.deepEqual(
      calls.map((call) => new URL(call.url).host),
      ["iconoplasmportraits.b-cdn.net"],
    )
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("the extension fetches the compact scanner artifact and never stores portrait references", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  const scannerPayload = {
    schema_version: 1,
    contract_revision: 1,
    generated_at: "2026-07-30T00:00:00.000Z",
    gene_count: 1,
    genes: {
      A1BG: {
        n: "alpha-1-B glycoprotein",
        c: "#abcdef",
        p: { asset_sha256: "a".repeat(64) },
      },
    },
  }
  const scannerJson = JSON.stringify(scannerPayload)
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "schema-5-test",
        card_snapshot_version: "ccv1-schema-5-test",
        artifact_url:
          "https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.schema-5-test.json",
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "0.4.7",
        gene_count: 1,
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("schema-5-test", Buffer.byteLength(scannerJson, "utf8")),
        publication_aliases: {
          schema_version: 1,
          version: "v1-empty",
          alias_count: 0,
          removal_count: 0,
          by_symbol: {},
          remove_by_symbol: {},
        },
      })
    }
    if (url.includes("scanner.schema-5-test.json")) {
      return new Response(scannerJson, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const result = await hooks.fetchGeneData({ forceArtifactRefresh: true })
    assert.equal(result.gene_count, 1)
    assert.deepEqual(storageState.get("iconoplasm_genes").A1BG, {
      n: "alpha-1-B glycoprotein",
      c: "#abcdef",
    })
    assert.equal(storageState.get("iconoplasm_scanner_hash"), "schema-5-test")
    assert.equal(storageState.get("iconoplasm_scanner_index_storage_version"), 1)
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("a shared-blocklist-only manifest revision persists without a scanner download", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { SPATIAL: { n: "spatial" } })
  storageState.set("iconoplasm_hash", "catalog-policy-only")
  rememberScannerState("scanner-policy-only")
  storageState.set("iconoplasm_gene_count", 1)
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-test")
  storageState.set("iconoplasm_alias_overlay_applied", {})
  storageState.set("iconoplasm_extension_blocklist", sharedBlocklistProjection(1, ["OLD"]))

  let artifactFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "catalog-policy-only",
        catalog_hash: "catalog-policy-only",
        artifact_url: "https://example.test/catalog.json",
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
        gene_count: 1,
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("scanner-policy-only"),
        publication_aliases: requestedOverlay,
        extension_blocklist: sharedBlocklistProjection(2, ["POKEMON", "SPATIAL"]),
      })
    }
    artifactFetches += 1
    throw new Error(`Policy-only refresh must not fetch the scanner artifact: ${url}`)
  }

  try {
    const result = await hooks.fetchGeneData()
    assert.equal(result.gene_count, 1)
    assert.equal(artifactFetches, 0)
    assert.deepEqual(
      storageState.get("iconoplasm_extension_blocklist"),
      sharedBlocklistProjection(2, ["POKEMON", "SPATIAL"]),
    )
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("an alias-only policy refresh broadcasts one recognition update to open tabs", async () => {
  const originalFetch = globalThis.fetch
  const baseGenes = Object.fromEntries(
    Object.keys({
      CEBPB: 1,
      CGAS: 1,
      IL1A: 1,
      IL1B: 1,
      NOTCH1: 1,
      RELA: 1,
      TGFB1: 1,
    }).map((symbol) => [symbol, { n: symbol }]),
  )
  storageState.clear()
  storageState.set("iconoplasm_genes", baseGenes)
  storageState.set("iconoplasm_hash", "catalog-alias-only")
  rememberScannerState("scanner-alias-only")
  storageState.set("iconoplasm_gene_count", 7)
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-before")
  storageState.set("iconoplasm_alias_overlay_applied", {})

  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "catalog-alias-only",
        catalog_hash: "catalog-alias-only",
        card_snapshot_version: "ccv1-alias-only-broadcast",
        artifact_url: "https://example.test/catalog.json",
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
        gene_count: 7,
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("scanner-alias-only"),
        publication_aliases: requestedOverlay,
      })
    }
    throw new Error(`Alias-only refresh must not fetch the scanner artifact: ${url}`)
  }

  tabsQueryResult = [{ id: 11 }, { id: 12 }]
  try {
    const result = await hooks.fetchGeneData()
    assert.equal(result.gene_count, 7)
    assert.equal(storageState.get("iconoplasm_alias_overlay_version"), requestedOverlay.version)
    assert.deepEqual(
      tabsMessages.map((entry) => [entry.tabId, entry.message.type]),
      [
        [11, "RECOGNITION_POLICY_UPDATED"],
        [12, "RECOGNITION_POLICY_UPDATED"],
      ],
    )
    tabsMessages.length = 0
    const unchanged = await hooks.fetchGeneData()
    assert.equal(unchanged.gene_count, 7)
    assert.deepEqual(tabsMessages, [], "an unchanged policy refresh must not broadcast")
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
    tabsQueryResult = []
    tabsMessages.length = 0
  }
})

test("alias-only manifest updates do not refetch the scanner artifact", async () => {
  const originalFetch = globalThis.fetch
  const baseGenes = Object.fromEntries(
    Object.keys({
      CEBPB: 1,
      CGAS: 1,
      IL1A: 1,
      IL1B: 1,
      NOTCH1: 1,
      RELA: 1,
      TGFB1: 1,
    }).map((symbol) => [symbol, { n: symbol }]),
  )
  storageState.clear()
  storageState.set("iconoplasm_genes", baseGenes)
  storageState.set("iconoplasm_hash", "catalog-v2-portraits")
  rememberScannerState("scanner-catalog-v2")
  storageState.set("iconoplasm_gene_count", 7)
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-old")
  storageState.set("iconoplasm_alias_overlay_applied", {})

  let manifestFetches = 0
  let artifactFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      manifestFetches += 1
      return Response.json({
        build_version: "catalog-v2-portraits",
        card_snapshot_version: "ccv1-alias-only",
        catalog_hash: "catalog",
        artifact_url: "https://example.test/catalog.json",
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("scanner-catalog-v2"),
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
        gene_count: 7,
        publication_aliases: requestedOverlay,
      })
    }
    artifactFetches += 1
    throw new Error(`Catalog artifact should not be fetched for an alias-only update: ${url}`)
  }

  try {
    const result = await hooks.fetchGeneData()
    const storedGenes = storageState.get("iconoplasm_genes")

    assert.equal(result.gene_count, 7)
    assert.equal(manifestFetches, 1)
    assert.equal(artifactFetches, 0)
    assert.equal(storageState.get("iconoplasm_alias_overlay_version"), "v1-test")
    assert.deepEqual(storedGenes.RELA.a, ["p65"])
    assert.deepEqual(storedGenes.IL1A.a, ["IL-1", "IL-1α"])
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("an overlay contract retry does not turn into a scanner artifact download", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { RELA: { n: "RELA", a: ["p65"] } })
  storageState.set("iconoplasm_hash", "catalog-v2-portraits")
  rememberScannerState("scanner-catalog-v2")
  storageState.set("iconoplasm_gene_count", 1)
  storageState.set("iconoplasm_last_fetch", "2020-01-01T00:00:00.000Z")
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-test")
  storageState.set("iconoplasm_alias_overlay_applied", { RELA: ["p65"] })
  storageState.set("iconoplasm_contract_error", { code: "invalid_manifest" })

  let artifactFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "catalog-v2-portraits",
        catalog_hash: "catalog",
        artifact_url: "https://example.test/catalog.json",
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("scanner-catalog-v2"),
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
        card_snapshot_version: "ccv1-stale",
        gene_count: 1,
        publication_aliases: {
          schema_version: 1,
          version: "v1-test",
          alias_count: 1,
          by_symbol: { RELA: ["p65"] },
        },
      })
    }
    artifactFetches += 1
    throw new Error(`Artifact must not be fetched while retrying an overlay error: ${url}`)
  }

  try {
    const result = await hooks.ensureFreshGeneData()
    assert.equal(artifactFetches, 0)
    assert.deepEqual(result.genes.RELA.a, ["p65"])
    assert.equal(storageState.has("iconoplasm_contract_error"), false)
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("a fresh valid scanner returns immediately without an unnecessary manifest request", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { TP53: { n: "tumor protein p53" } })
  storageState.set("iconoplasm_hash", "catalog-stale")
  rememberScannerState("scanner-stale")
  storageState.set("iconoplasm_gene_count", 1)
  storageState.set("iconoplasm_last_fetch", new Date().toISOString())
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-test")
  storageState.set("iconoplasm_alias_overlay_applied", {})

  let manifestFetches = 0
  globalThis.fetch = () => {
    manifestFetches += 1
    throw new Error("fresh cache must not fetch")
  }

  try {
    const first = await Promise.race([
      hooks.ensureFreshGeneData(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("cache response blocked")), 50)),
    ])
    const second = await hooks.ensureFreshGeneData()

    assert.deepEqual(first.genes.TP53, { n: "tumor protein p53" })
    assert.deepEqual(second.genes.TP53, { n: "tumor protein p53" })
    assert.equal(manifestFetches, 0)
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("pre-load cache-only request never refreshes a stale index or downloads a missing one", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => {
    throw new Error("cache-only path reached network")
  }
  storageState.clear()
  const send = () =>
    new Promise((resolve) =>
      messageListener({ type: "GET_GENE_DATA", cacheOnly: true }, { tab: { id: 801 } }, resolve),
    )
  try {
    assert.equal(await send(), null)
    storageState.set("iconoplasm_genes", { TP53: { n: "p53" } })
    rememberScannerState("valid")
    storageState.set("iconoplasm_schema_version", 5)
    storageState.set("iconoplasm_contract_revision", 1)
    storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
    storageState.set("iconoplasm_last_fetch", "2000-01-01T00:00:00Z")
    assert.ok((await send()).genes.TP53)
    storageState.set("iconoplasm_contract_error", { code: "invalid" })
    assert.equal(await send(), null)
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})
