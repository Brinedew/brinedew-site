import assert from "node:assert/strict"
import test from "node:test"
import { matchIconoplasmRouteContract } from "./iconoplasm-route-contract.js"

// The delivery handler serves the canonical-origin copies of the two
// published objects.
test("the stable object routes are declared", () => {
  assert.equal(
    matchIconoplasmRouteContract("/api/public/v1/stable-genes/TP53.json", "GET")?.route?.id,
    "public_stable_gene_object",
  )
  assert.equal(
    matchIconoplasmRouteContract("/api/public/v1/stable-catalog.json", "GET")?.route?.id,
    "public_stable_catalog_object",
  )
})

test("the stable gene object route serves storage bytes with a short shared TTL and no Workers Cache", async () => {
  const { createPublishedCardDeliveryHandlers } = await import("./lib/iconoplasm-card-delivery.js")
  const stored = new Map([
    ["genes/v3/TP53.json", JSON.stringify({ symbol: "TP53", stable_object_version: 3 })],
  ])
  const requests = []
  const env = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "zone",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.example.test",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "pw",
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  globalThis.caches = {
    default: {
      match: async () => {
        throw new Error("Workers Cache must not be consulted for a mutable object")
      },
      put: async () => {
        throw new Error("Workers Cache must not store a mutable object")
      },
    },
  }
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    requests.push({ url: parsed.href, headers: init?.headers })
    const key = parsed.pathname.replace(/^\/zone\//, "")
    return stored.has(key)
      ? new Response(stored.get(key), { status: 200 })
      : new Response(null, { status: 404 })
  }
  try {
    const handlers = createPublishedCardDeliveryHandlers()
    const hit = await handlers.stableGene({ env, match: { params: { symbol: "tp53" } } })
    assert.equal(hit.status, 200)
    assert.equal(
      hit.headers.get("Cache-Control"),
      "public, max-age=300, stale-while-revalidate=86400",
    )
    assert.equal(hit.headers.get("Access-Control-Allow-Origin"), "*")
    assert.equal((await hit.json()).symbol, "TP53")
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, "https://storage.example.test/zone/genes/v3/TP53.json")
    assert.equal(requests[0].headers.AccessKey, "pw")

    const miss = await handlers.stableGene({ env, match: { params: { symbol: "NOPE" } } })
    assert.equal(miss.status, 404)
    const bad = await handlers.stableGene({ env, match: { params: { symbol: "../x" } } })
    assert.equal(bad.status, 404)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})

// B-898: the canonical-origin fallback for the one stable catalog object.
test("the stable catalog route serves storage bytes with the stable TTL and no Workers Cache", async () => {
  const { createPublishedCardDeliveryHandlers } = await import("./lib/iconoplasm-card-delivery.js")
  const stored = new Map([["catalog/v3/index.json", JSON.stringify({ schema: 3, genes: [] })]])
  const env = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "zone",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.example.test",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "pw",
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const originalFetch = globalThis.fetch
  const originalCaches = globalThis.caches
  globalThis.caches = {
    default: {
      match: async () => {
        throw new Error("Workers Cache must not be consulted for a mutable object")
      },
      put: async () => {
        throw new Error("Workers Cache must not store a mutable object")
      },
    },
  }
  const requests = []
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    requests.push({ url: parsed.href, headers: init?.headers })
    const key = parsed.pathname.replace(/^\/zone\//, "")
    return stored.has(key)
      ? new Response(stored.get(key), { status: 200 })
      : new Response(null, { status: 404 })
  }
  try {
    const handlers = createPublishedCardDeliveryHandlers()
    const hit = await handlers.stableCatalog({ env })
    assert.equal(hit.status, 200)
    assert.equal(
      hit.headers.get("Cache-Control"),
      "public, max-age=300, stale-while-revalidate=86400",
    )
    assert.equal(hit.headers.get("Access-Control-Allow-Origin"), "*")
    assert.equal((await hit.json()).schema, 3)
    assert.equal(requests[0].url, "https://storage.example.test/zone/catalog/v3/index.json")
    assert.equal(requests[0].headers.AccessKey, "pw")
    stored.clear()
    assert.equal((await handlers.stableCatalog({ env })).status, 404)
  } finally {
    globalThis.fetch = originalFetch
    globalThis.caches = originalCaches
  }
})
