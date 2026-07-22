import assert from "node:assert/strict"
import test from "node:test"

const storageState = new Map()
const sessionState = new Map()
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
await import("./service-worker.js")

const hooks = globalThis.__ICONOPLASM_EXTENSION_TEST_HOOKS__

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

test("100 extension portraits bypass the disabled accelerator", async () => {
  const originalFetch = globalThis.fetch
  let primaryFetches = 0
  let fallbackFetches = 0

  await hooks.clearPortraitSourceStates()
  hooks.clearPortraitDataUrlCaches()
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.startsWith("https://iconoplasmportraits.b-cdn.net/")) {
      primaryFetches += 1
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
    const results = await Promise.all(requests)

    assert.equal(primaryFetches, 0)
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

test("schema-5 catalog assets remain inspectable canonical references in extension storage", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  const sha = "a".repeat(64)
  const asset = {
    schema_version: 1,
    asset_sha256: sha,
    renditions: {
      full: {
        path: `portraits/v1/aa/${sha}/full.webp`,
        canonical_url: `https://iconoplasm.brinedew.bio/portraits/v1/aa/${sha}/full.webp`,
      },
      medium: {
        path: `portraits/v1/aa/${sha}/medium.webp`,
        canonical_url: `https://iconoplasm.brinedew.bio/portraits/v1/aa/${sha}/medium.webp`,
      },
      thumb: {
        path: `portraits/v1/aa/${sha}/thumb.webp`,
        canonical_url: `https://iconoplasm.brinedew.bio/portraits/v1/aa/${sha}/thumb.webp`,
      },
    },
  }
  globalThis.fetch = async (input) => {
    const url = String(input || "")
    if (url.endsWith("/api/public/v1/catalog/manifest")) {
      return Response.json({
        build_version: "schema-5-test",
        artifact_url:
          "https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.schema-5-test.json",
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "0.4.7",
        gene_count: 1,
        portrait_delivery: portraitDeliveryPolicy,
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
    if (url.includes("catalog.schema-5-test.json")) {
      return Response.json({ schema_version: 5, gene_count: 1, genes: [{ s: "A1BG", p: asset }] })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const result = await hooks.fetchGeneData({ forceArtifactRefresh: true })
    assert.equal(result.gene_count, 1)
    assert.deepEqual(storageState.get("iconoplasm_genes").A1BG.p, asset)
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

test("alias-only manifest updates do not refetch the six-megabyte catalog artifact", async () => {
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
        catalog_hash: "catalog",
        artifact_url: "https://example.test/catalog.json",
        portrait_delivery: portraitDeliveryPolicy,
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

test("mapping removals and specific cadherin labels update without refetching the catalog", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", {
    CDH1: { n: "cadherin 1", a: ["CD324"] },
    CDH2: { n: "cadherin 2", a: ["NCAD"] },
    CDH17: { n: "cadherin 17", a: ["HPT-1", "cadherin"] },
  })
  storageState.set("iconoplasm_hash", "catalog-v2-portraits")
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

test("an overlay contract retry does not turn into a full artifact download", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { RELA: { n: "RELA", a: ["p65"] } })
  storageState.set("iconoplasm_hash", "catalog-v2-portraits")
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
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        min_extension_version: "1.0.0",
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

test("a stale valid catalog returns immediately while one refresh runs in the background", async () => {
  const originalFetch = globalThis.fetch
  storageState.clear()
  storageState.set("iconoplasm_genes", { TP53: { n: "tumor protein p53" } })
  storageState.set("iconoplasm_hash", "catalog-stale")
  storageState.set("iconoplasm_gene_count", 1)
  storageState.set("iconoplasm_last_fetch", "2020-01-01T00:00:00.000Z")
  storageState.set("iconoplasm_schema_version", 5)
  storageState.set("iconoplasm_contract_revision", 1)
  storageState.set("iconoplasm_portrait_delivery", portraitDeliveryPolicy)
  storageState.set("iconoplasm_alias_overlay_version", "v1-test")
  storageState.set("iconoplasm_alias_overlay_applied", {})

  let manifestFetches = 0
  let releaseManifest
  globalThis.fetch = () => {
    manifestFetches += 1
    return new Promise((resolve) => {
      releaseManifest = resolve
    })
  }

  try {
    const first = await Promise.race([
      hooks.ensureFreshGeneData(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("cache response blocked")), 50)),
    ])
    const second = await hooks.ensureFreshGeneData()

    assert.deepEqual(first.genes.TP53, { n: "tumor protein p53" })
    assert.deepEqual(second.genes.TP53, { n: "tumor protein p53" })
    assert.equal(manifestFetches, 1, "concurrent tabs should share the same refresh")

    releaseManifest(new Response("unavailable", { status: 503 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
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
