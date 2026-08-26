import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-008]: arbitrary tabs receive a bounded, portrait-free scanner index.

const storageState = new Map()
const sessionState = new Map()
const mimeHandlerOptions = []
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
const cadherinPolicy = {
  schema_version: 1,
  version: "v1-cadherin-policy",
  alias_count: 4,
  removal_count: 1,
  by_symbol: {
    CDH1: ["E-cadherin", "E-Cadherin"],
    CDH2: ["N-cadherin", "N-Cadherin"],
  },
  remove_by_symbol: { CDH17: ["cadherin"] },
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
  mimeHandler: {
    async getMimeHandlerOptions() {
      return mimeHandlerOptions.at(-1)?.options || { enabled: false }
    },
    async setMimeHandlerOptions(mimeType, options) {
      mimeHandlerOptions.push({ mimeType, options })
    },
  },
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
      addListener() {},
    },
  },
  storage: {
    local: storageArea(storageState),
    session: storageArea(sessionState),
  },
}

globalThis.btoa = (value) => Buffer.from(String(value || ""), "binary").toString("base64")
globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__ = {}
globalThis.IconoplasmPortraitDelivery =
  await import("../shared/iconoplasm-portrait/portrait-delivery-core.js")

await import("./generated/catalog-contract.js")
await import("./publication-alias-overlay.js")
await import("./content-settings.js")
await import("./service-worker.js")

const hooks = globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__

test("shared appearance settings have one canonical two-state timing policy", () => {
  const settings = globalThis.IconoplasmContentSettings
  assert.equal(settings.normalizeHighlightVisibility("hover"), "hover")
  assert.equal(settings.normalizeHighlightVisibility(" HOVER "), "hover")
  assert.equal(settings.normalizeHighlightVisibility("always"), "always")
  assert.equal(settings.normalizeHighlightVisibility("unexpected"), "always")
  assert.equal(settings.normalizeHighlightMode("ellipse"), "ellipse")
  assert.equal(settings.normalizeHighlightMode("unexpected"), "pill")
})

test("shared blocklist projections normalize to the bounded public contract", () => {
  const settings = globalThis.IconoplasmContentSettings
  assert.deepEqual(
    settings.normalizeSharedBlocklistProjection({
      schema_version: 1,
      revision: 3,
      version: "ebl1-0000000000000003",
      term_count: 2,
      terms: [" spatial ", "IL\u20111", "SPATIAL"],
    }),
    {
      schema_version: 1,
      revision: 3,
      version: "ebl1-0000000000000003",
      term_count: 2,
      terms: ["IL-1", "SPATIAL"],
    },
  )
  assert.equal(settings.normalizeSharedBlocklistProjection(sharedBlocklistProjection(0, [])), null)
  assert.equal(
    settings.normalizeSharedBlocklistProjection({
      ...sharedBlocklistProjection(1, ["SAFE"]),
      terms: ["BAD\nTERM"],
    }),
    null,
  )
  assert.equal(
    settings.normalizeSharedBlocklistProjection({
      ...sharedBlocklistProjection(1, ["SAFE"]),
      version: "not-a-policy-version",
    }),
    null,
  )
  const missingVersion = sharedBlocklistProjection(9, ["SAFE"])
  delete missingVersion.version
  assert.equal(settings.normalizeSharedBlocklistProjection(missingVersion), null)
  const missingTermCount = sharedBlocklistProjection(9, ["SAFE"])
  delete missingTermCount.term_count
  assert.equal(settings.normalizeSharedBlocklistProjection(missingTermCount), null)
  const oversizedTerms = Array.from(
    { length: settings.sharedBlocklistMaxTerms },
    (_, index) => `${String(index).padStart(4, "0")}${"😀".repeat(30)}`,
  )
  assert.equal(
    oversizedTerms.every((term) => term.length === 64),
    true,
  )
  assert.equal(
    settings.normalizeSharedBlocklistProjection(sharedBlocklistProjection(5, oversizedTerms)),
    null,
    "the last-known-good item must stay inside its 48 KiB storage budget",
  )
})

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

test("Chromium builds keep the scanner index bounded without unlimited storage", () => {
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"))
  const publishedGeneCount = 19_023
  const legacyGenes = Object.fromEntries(
    Array.from({ length: publishedGeneCount }, (_, index) => {
      const symbol = `GENE${String(index).padStart(5, "0")}`
      return [
        symbol,
        {
          c: "#abcdef",
          n: `representative gene ${index}`,
          u: `P${String(index).padStart(5, "0")}`,
          a: [`G-${index}`],
          p: { asset_sha256: "a".repeat(64) },
        },
      ]
    }),
  )
  const scannerIndex = hooks.normalizeScannerIndex(legacyGenes)
  const scannerBytes = hooks.jsonByteLength(scannerIndex)

  assert.equal(manifest.permissions.includes("unlimitedStorage"), false)
  assert.ok(scannerBytes < hooks.scannerIndexMaxBytes)
  assert.equal(Object.keys(scannerIndex).length, publishedGeneCount)
  assert.equal(
    Object.values(scannerIndex).some((gene) => "p" in gene),
    false,
  )
})

test("Chromium manifest owns PDFs through the public MIME handler without broad host access", () => {
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"))

  assert.deepEqual(manifest.mime_types_handler, {
    "application/pdf": {
      handler_url: "pdf-reader.html",
      can_embed: true,
    },
  })
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false)
})

test("PDF highlighting has only native-off and highlighted-on states", async () => {
  storageState.clear()
  mimeHandlerOptions.length = 0

  await hooks.initializePdfPreferences()
  assert.equal(storageState.get("iconoplasm_pdf_highlighting_enabled"), false)
  assert.deepEqual(mimeHandlerOptions.at(-1), {
    mimeType: "application/pdf",
    options: { enabled: false },
  })

  storageState.set("iconoplasm_pdf_highlighting_enabled", true)
  await hooks.initializePdfPreferences()
  assert.deepEqual(mimeHandlerOptions.at(-1), {
    mimeType: "application/pdf",
    options: { enabled: true },
  })
  assert.equal(storageState.has("iconoplasm_pdf_automatic_open_enabled"), false)

  const capability = await hooks.getPdfOwnershipCapability()
  assert.deepEqual(capability, {
    supported: true,
    driver: "chromium-mime-handler",
    enabled: true,
  })

  const disabled = await hooks.setPdfOwnershipEnabled(false)
  assert.equal(disabled.supported, true)
  assert.equal(disabled.enabled, false)
  assert.equal(storageState.get("iconoplasm_pdf_highlighting_enabled"), false)
})

test("legacy portrait-heavy storage is compacted before a tab can receive it", async () => {
  storageState.clear()
  storageState.set("iconoplasm_genes", {
    TP53: {
      n: "tumor protein p53",
      c: "#abcdef",
      a: ["p53"],
      p: {
        asset_sha256: "a".repeat(64),
        renditions: {
          medium: {
            canonical_url: "https://iconoplasm.brinedew.bio/portraits/tp53/medium.webp",
          },
        },
      },
    },
  })
  storageState.set("iconoplasm_hash", "legacy-portrait-catalog")
  storageState.set("iconoplasm_last_fetch", new Date().toISOString())

  try {
    const migrated = await hooks.migrateLegacyStoredScannerIndex(
      await chrome.storage.local.get([
        "iconoplasm_genes",
        "iconoplasm_hash",
        "iconoplasm_last_fetch",
        "iconoplasm_scanner_index_storage_version",
      ]),
    )

    assert.deepEqual(migrated.iconoplasm_genes.TP53, {
      n: "tumor protein p53",
      c: "#abcdef",
      a: ["p53"],
    })
    assert.equal(storageState.get("iconoplasm_genes").TP53.p, undefined)
    assert.equal(storageState.get("iconoplasm_scanner_index_storage_version"), 1)
    assert.match(storageState.get("iconoplasm_scanner_hash"), /^legacy:/)
    assert.equal(storageState.get("iconoplasm_last_fetch"), null)
  } finally {
    storageState.clear()
  }
})

test("native portrait source planning is fetch-free and persists the winning regional source", async () => {
  const originalFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    throw new Error("source planning must not fetch portrait bytes")
  }
  await hooks.clearPortraitSourceStates()
  try {
    const canonical = "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp"
    const plan = await hooks.portraitSourcePlan(canonical, 77)
    assert.equal(plan.primarySource, "accelerator")
    assert.equal(plan.fallbackSource, "canonical")
    assert.equal(plan.hedgeDelayMs, 350)
    assert.equal(plan.timeoutMs, 2500)
    assert.match(plan.primaryUrl, /^https:\/\/iconoplasmportraits\.b-cdn\.net\//)

    const result = await hooks.reportPortraitSourceResult(plan.fallbackUrl, true, 77)
    assert.equal(result.state.state, "canonical")
    assert.equal((await hooks.portraitSourcePlan(canonical, 77)).primarySource, "canonical")
    assert.equal(fetchCount, 0)
  } finally {
    globalThis.fetch = originalFetch
    await hooks.clearPortraitSourceStates()
  }
})

test("portrait fetch failures back off briefly but recover after the error TTL", async () => {
  const originalDateNow = Date.now
  const originalFetch = globalThis.fetch
  let now = 1_710_000_000_000
  let fetchCalls = 0
  let shouldFail = true

  Date.now = () => now
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
    assert.equal(fetchCalls, 1)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), true)

    now += hooks.portraitErrorTtlMs + 1
    shouldFail = false

    const third = await hooks.fetchPortraitDataUrl(url)
    const fourth = await hooks.fetchPortraitDataUrl(url)

    assert.match(third.dataUrl, /^data:image\/png;base64,/)
    assert.equal(fourth.dataUrl, third.dataUrl)
    assert.equal(fetchCalls, 2)
    assert.equal(hooks.hasFreshPortraitDataUrlError(url), false)
  } finally {
    Date.now = originalDateNow
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
  }
})

test("concurrent requests for the same successful portrait share one byte transfer", async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  let releaseFetch
  const fetchGate = new Promise((resolve) => {
    releaseFetch = resolve
  })
  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async () => {
    fetchCalls += 1
    await fetchGate
    return new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    })
  }

  try {
    const url = "https://iconoplasm.brinedew.bio/media/shared.webp"
    const first = hooks.fetchPortraitDataUrl(url)
    const second = hooks.fetchPortraitDataUrl(url)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(fetchCalls, 1)

    releaseFetch()
    const [left, right] = await Promise.all([first, second])
    assert.equal(left.dataUrl, right.dataUrl)
    assert.match(left.dataUrl, /^data:image\/webp;base64,/)
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
  }
})

test("100 extension portraits share one failed primary decision per tab", async () => {
  const originalFetch = globalThis.fetch
  let primaryFetches = 0
  let fallbackFetches = 0
  let releasePrimary
  const primaryGate = new Promise((resolve) => {
    releasePrimary = resolve
  })

  await hooks.clearPortraitSourceStates()
  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.startsWith("https://iconoplasmportraits.b-cdn.net/")) {
      primaryFetches += 1
      await primaryGate
      return new Response("unavailable", { status: 503 })
    }
    if (url.startsWith("https://iconoplasm.brinedew.bio/portraits/")) {
      fallbackFetches += 1
      return new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/webp" },
      })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const requests = Array.from({ length: 100 }, (_, index) =>
      hooks.fetchPortraitDataUrl(
        `https://iconoplasmportraits.b-cdn.net/portraits/v1/${index}.webp`,
        42,
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(primaryFetches, 1)
    releasePrimary()
    const results = await Promise.all(requests)

    assert.equal(primaryFetches, 1)
    assert.equal(fallbackFetches, 100)
    assert.ok(
      results.every(
        (result) =>
          result.dataUrl.startsWith("data:image/webp;base64,") &&
          result.sourceUrl.startsWith("https://iconoplasm.brinedew.bio/portraits/"),
      ),
    )
    assert.deepEqual(await hooks.portraitSourceState(42), {
      state: "canonical",
      failed: ["accelerator"],
    })
  } finally {
    globalThis.fetch = originalFetch
    hooks.clearPortraitDataUrlCaches()
    await hooks.clearPortraitSourceStates()
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
    assert.equal(storageState.get("iconoplasm_card_snapshot_version"), "ccv1-schema-5-test")
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

test("the extension rejects a catalog revision it was not packaged to understand", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  let artifactFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "future-revision",
        artifact_url:
          "https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.future-revision.json",
        artifact_schema_version: 5,
        artifact_contract_revision: 2,
        min_extension_version: "1.0.0",
        gene_count: 1,
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("future-revision"),
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
    artifactFetches += 1
    throw new Error(`Incompatible contract must not fetch its artifact: ${url}`)
  }

  try {
    const result = await hooks.fetchGeneData({ forceArtifactRefresh: true })
    assert.equal(result, null)
    assert.equal(artifactFetches, 0)
    assert.equal(storageState.get("iconoplasm_contract_error")?.code, "incompatible_artifact")
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
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
    assert.equal(storageState.get("iconoplasm_card_snapshot_version"), "ccv1-alias-only")
    assert.deepEqual(storedGenes.RELA.a, ["p65"])
    assert.deepEqual(storedGenes.IL1A.a, ["IL-1", "IL-1α"])
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("mapping removals and specific cadherin labels update without refetching the catalog", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", {
    CDH1: { n: "cadherin 1", a: ["CD324"] },
    CDH2: { n: "cadherin 2", a: ["NCAD"] },
    CDH17: { n: "cadherin 17", a: ["HPT-1", "cadherin"] },
  })
  storageState.set("iconoplasm_hash", "catalog-v2-portraits")
  rememberScannerState("scanner-catalog-v2")
  storageState.set("iconoplasm_gene_count", 3)
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-old")
  storageState.set("iconoplasm_alias_overlay_applied", {})

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
        gene_count: 3,
        publication_aliases: cadherinPolicy,
      })
    }
    artifactFetches += 1
    throw new Error(`Catalog artifact should not be fetched for a policy-only update: ${url}`)
  }

  try {
    await hooks.fetchGeneData()
    const storedGenes = storageState.get("iconoplasm_genes")
    const applied = storageState.get("iconoplasm_alias_overlay_applied")

    assert.equal(artifactFetches, 0)
    assert.deepEqual(storedGenes.CDH1.a, ["CD324", "E-cadherin", "E-Cadherin"])
    assert.deepEqual(storedGenes.CDH2.a, ["NCAD", "N-cadherin", "N-Cadherin"])
    assert.deepEqual(storedGenes.CDH17.a, ["HPT-1"])
    assert.deepEqual(applied, {
      added_by_symbol: {
        CDH1: ["E-cadherin", "E-Cadherin"],
        CDH2: ["N-cadherin", "N-Cadherin"],
      },
      removed_by_symbol: { CDH17: ["cadherin"] },
    })
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
  storageState.set("iconoplasm_card_snapshot_version", "ccv1-stale")
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
    assert.equal(result.cardSnapshotVersion, "ccv1-stale")
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

test("a retired card snapshot cache-busts only the manifest and adopts the new revision", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { RIPOR1: { n: "RHO family interacting regulator 1" } })
  storageState.set("iconoplasm_hash", "catalog-current")
  rememberScannerState("scanner-current")
  storageState.set("iconoplasm_gene_count", 1)
  storageState.set("iconoplasm_last_fetch", new Date().toISOString())
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_card_snapshot_version", "ccv1-retired")
  storageState.set("iconoplasm_alias_overlay_version", "v1-test")
  storageState.set("iconoplasm_alias_overlay_applied", {})

  let manifestUrl = ""
  let artifactFetches = 0
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.includes("/api/public/v1/catalog/manifest")) {
      manifestUrl = url
      return Response.json({
        build_version: "catalog-current",
        card_snapshot_version: "ccv1-current",
        catalog_hash: "catalog-current",
        artifact_url: "https://example.test/catalog.json",
        portrait_delivery: portraitDeliveryPolicy,
        scanner_artifact: scannerManifest("scanner-current"),
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
        gene_count: 1,
        publication_aliases: requestedOverlay,
      })
    }
    artifactFetches += 1
    throw new Error(`Retired-card recovery must not fetch the scanner artifact: ${url}`)
  }

  try {
    await hooks.refreshGeneData({ manifestCacheBustRevision: "ccv1-retired" })
    assert.equal(new URL(manifestUrl).searchParams.get("retired_snapshot"), "ccv1-retired")
    assert.equal(storageState.get("iconoplasm_card_snapshot_version"), "ccv1-current")
    assert.equal(artifactFetches, 0)
  } finally {
    globalThis.fetch = originalFetch
    storageState.clear()
  }
})

test("catalog requests have a hard deadline even when fetch ignores abort", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => new Promise(() => {})
  try {
    await assert.rejects(
      hooks.fetchWithTimeout("https://example.test/hangs", {}, 10),
      /timed out after 10 ms/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
