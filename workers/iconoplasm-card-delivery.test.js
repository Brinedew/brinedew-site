import assert from "node:assert/strict"
import test from "node:test"
import { canonicalPublishedJson, publishedObjectHash } from "./lib/iconoplasm-published-card-objects.js"
import { createPublishedCardDeliveryHandlers } from "./lib/iconoplasm-card-delivery.js"
import { readIconoplasmPublishedCardCatalogArtifactForTest, handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

test("tiny current metadata revalidates browsers while remaining shared-cacheable", async () => {
  const handlers = createPublishedCardDeliveryHandlers({ barrier: async () => ({ current: "ccv2-test", previous: null }) })
  const response = await handlers.current({ env: {} })
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, s-maxage=30, must-revalidate")
  assert.equal(response.headers.get("access-control-allow-origin"), "*")
  assert.ok((await response.text()).length < 1024)
})

test("real public card reader uses exact Bunny objects without KV or D1 or packed-shard reads", async () => {
  const bodies = new Map()
  async function object(kind, value) {
    const text = canonicalPublishedJson(value)
    const hash = await publishedObjectHash(new TextEncoder().encode(text))
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    bodies.set(key, text)
    return { key, hash }
  }
  const card = { __complete: true, schema_version: "iconoplasm.mobileCard.v1", symbol: "EZH2", full_name: "enhancer of zeste 2", portrait: { status: "missing" }, field_status: {}, payload: { symbol: "EZH2", portrait: { status: "missing" } } }
  const full = await object("cards", card)
  const index = await object("indexes", { schema_version: 2, entries: [["EZH2", full.hash, "a".repeat(64), "b".repeat(64)]] })
  const root = await object("manifests", {
    schema: "iconoplasm.cardCatalog.v1", storage: "bunny_card_catalog_v2", card_count: 1, catalog_gene_count: 1,
    shards: [{ key: "must-not-load-packed-shard", card_count: 1, first_symbol: "EZH2", last_symbol: "EZH2", delivery_indexes: [{ key: index.key, first_symbol: "EZH2", last_symbol: "EZH2" }] }],
  })
  const env = { ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "fixture", ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only", ICONOPLASM_DB: { prepare() { throw new Error("public D1 forbidden") } } }
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method })
    const key = new URL(url).pathname.replace(/^\/fixture\//, "")
    assert.ok(bodies.has(key), key)
    return new Response(bodies.get(key))
  }
  try {
    const version = `ccv2-${root.hash}`
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(env, version, ["EZH2"], { allowWholeArtifact: false })
    assert.equal(artifact.bySymbol.get("EZH2").snapshot_version, version)
    assert.equal(artifact.bySymbol.get("EZH2").full_name, card.full_name)
    assert.equal(calls.length, 3)
    assert.ok(calls.every(call => call.method === "GET"))
    const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(new Request(`https://iconoplasm.brinedew.bio/${full.key}`), env)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), card)
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable")
  } finally { globalThis.fetch = original }
})
