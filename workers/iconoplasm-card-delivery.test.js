import assert from "node:assert/strict"
import test from "node:test"
import {
  canonicalPublishedJson,
  publishedObjectHash,
} from "./lib/iconoplasm-published-card-objects.js"
import { createPublishedCardDeliveryHandlers } from "./lib/iconoplasm-card-delivery.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { createHoverDeliveryHandlers } from "./iconoplasm-hover-delivery-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import {
  readIconoplasmPublishedCardCatalogArtifactForTest,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

test("tiny current metadata revalidates browsers while remaining shared-cacheable", async () => {
  const handlers = createPublishedCardDeliveryHandlers({
    barrier: async () => ({ current: "ccv2-test", previous: null }),
  })
  const response = await handlers.current({ env: {} })
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, s-maxage=30, must-revalidate",
  )
  assert.equal(response.headers.get("access-control-allow-origin"), "*")
  assert.ok((await response.text()).length < 1024)
})

test("public card and released hover readers use exact Bunny objects without KV card, D1 or packed-shard reads", async () => {
  const bodies = new Map()
  async function object(kind, value) {
    const text = canonicalPublishedJson(value)
    const hash = await publishedObjectHash(new TextEncoder().encode(text))
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    bodies.set(key, text)
    return { key, hash }
  }
  const card = {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    symbol: "EZH2",
    full_name: "enhancer of zeste 2",
    portrait: { status: "missing" },
    field_status: {},
    payload: { symbol: "EZH2", portrait: { status: "missing" } },
  }
  const full = await object("cards", card)
  const gene = await object("genes", card.payload)
  const portrait = await object("portraits", { symbol: card.symbol, portrait: card.portrait })
  const index = await object("indexes", {
    schema_version: 2,
    entries: [["EZH2", full.hash, gene.hash, portrait.hash]],
  })
  const root = await object("manifests", {
    schema: "iconoplasm.cardCatalog.v1",
    storage: "bunny_card_catalog_v2",
    card_count: 1,
    catalog_gene_count: 1,
    shards: [
      {
        key: "must-not-load-packed-shard",
        content_hash: "c".repeat(64),
        card_count: 1,
        first_symbol: "EZH2",
        last_symbol: "EZH2",
        delivery_indexes: [{ key: index.key, first_symbol: "EZH2", last_symbol: "EZH2" }],
      },
    ],
  })
  const env = {
    PUBLIC_RATE_LIMIT_120: { limit: async () => ({ success: true }) },
    KV: {
      get(key) {
        assert.equal(key, "iconoplasm:gallery-version")
        return JSON.stringify({ current: `ccv2-${root.hash}`, previous: null })
      },
    },
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "fixture",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    ICONOPLASM_DB: {
      prepare() {
        throw new Error("public D1 forbidden")
      },
    },
  }
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method })
    const key = new URL(url).pathname.replace(/^\/fixture\//, "")
    assert.ok(bodies.has(key), key)
    return new Response(bodies.get(key))
  }
  try {
    resetIconoplasmRuntimeCachesForTest()
    const version = `ccv2-${root.hash}`
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(
      env,
      version,
      ["EZH2"],
      { allowWholeArtifact: false },
    )
    assert.equal(artifact.bySymbol.get("EZH2").snapshot_version, version)
    assert.equal(artifact.bySymbol.get("EZH2").full_name, card.full_name)
    assert.equal(calls.length, 3)
    assert.ok(calls.every((call) => call.method === "GET"))
    // Exercise the deployed composition, not only its nested API handler:
    // otherwise a declared object route can still fall through to Pages 404.
    const response = await worker.fetch(
      new Request(`https://iconoplasm.brinedew.bio/${full.key}`),
      env,
      { waitUntil() {} },
    )
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), card)
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable")

    // The actually released 0.5.3 still uses these v1 URLs after the v2 cutover.
    // Exercise the real handler wiring, then forbid full cards and packed reads.
    const read = (path) =>
      handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio/api/public/v1/${path}`, {
          headers: { "X-Iconoplasm-Extension-Version": "0.5.3" },
        }),
        env,
      )
    const deliveryIndex = await read(`card-snapshots/${version}/delivery-index`)
    assert.equal(deliveryIndex.status, 200)
    const ranges = (await deliveryIndex.json()).ranges
    assert.deepEqual(ranges, [["EZH2", "EZH2", "c".repeat(64)]])
    resetIconoplasmRuntimeCachesForTest()
    bodies.delete(full.key)
    calls.length = 0
    for (const lane of ["portraits", "genes"]) {
      const projected = await read(`card-content/v1/${ranges[0][2]}/${lane}/EZH2`)
      assert.equal(projected.status, 200)
      const payload = await projected.json()
      assert.equal(payload.symbol, "EZH2")
      assert.equal(payload.lane, lane)
      assert.deepEqual(
        payload.record,
        lane === "genes" ? card.payload : { symbol: card.symbol, portrait: card.portrait },
      )
    }
    assert.equal(calls.length, 4, "one manifest, one shared directory, two separate lane objects")
    assert.ok(calls.every((call) => call.method === "GET"))
  } finally {
    globalThis.fetch = original
    resetIconoplasmRuntimeCachesForTest()
  }
})

// IPD-001 / B-881: when Bunny is unreachable the website reader retries the
// same path on the canonical origin. Seen live on 27 Sep: the gallery object
// 404'd there because this route only knew five kinds, so TP53 still showed
// "Gene page temporarily unavailable" with Bunny blocked. The kind list is read
// from the reader itself, so the two cannot drift apart again.
test("the canonical origin serves every object kind the website reader requests", async () => {
  const { readFile } = await import("node:fs/promises")
  const readerSource = await readFile(
    new URL("../quartz/static/iconoplasm/publication-reader.js", import.meta.url),
    "utf8",
  )
  const kinds = [
    ...new Set([...readerSource.matchAll(/immutableObject\("([a-z]+)"/g)].map((m) => m[1])),
  ]
  assert.equal(kinds.length >= 6, true, `reader kinds parsed: ${kinds.join(", ")}`)
  const bodies = new Map()
  const env = {
    PUBLIC_RATE_LIMIT_120: { limit: async () => ({ success: true }) },
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "fixture",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    ICONOPLASM_DB: {
      prepare() {
        throw new Error("public D1 forbidden")
      },
    },
  }
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.replace(/^\/fixture\//, "")
    return bodies.has(key) ? new Response(bodies.get(key)) : new Response(null, { status: 404 })
  }
  try {
    for (const kind of [...kinds, "shards"]) {
      const text = canonicalPublishedJson({ kind, fixture: true })
      const hash = await publishedObjectHash(new TextEncoder().encode(text))
      const key = `published-cards/v2/immutable/${kind}/${hash}.json`
      bodies.set(key, text)
      const response = await worker.fetch(
        new Request(`https://iconoplasm.brinedew.bio/${key}`),
        env,
        { waitUntil() {} },
      )
      if (kind === "shards") {
        // Packed shards (up to 4 MiB) are never a reader fallback.
        assert.equal(response.status, 404, "shards stay off the canonical origin")
      } else {
        assert.equal(response.status, 200, `${kind} is served by the canonical origin`)
        assert.equal(await response.text(), text, `${kind} bytes are exact`)
      }
    }
  } finally {
    globalThis.fetch = original
    resetIconoplasmRuntimeCachesForTest()
  }
})

test("v2 hover compatibility keeps lane failures independent and rejects unbound identities", async () => {
  const hash = "a".repeat(64)
  const indexKey = `published-cards/v2/immutable/indexes/${"b".repeat(64)}.json`
  const portraitKey = `published-cards/v2/immutable/portraits/${"c".repeat(64)}.json`
  const geneKey = `published-cards/v2/immutable/genes/${"d".repeat(64)}.json`
  const portrait = { symbol: "TP53", portrait: { asset_sha256: "e".repeat(64) } }
  const directory = {
    schema_version: 2,
    entries: [["TP53", "f".repeat(64), "d".repeat(64), "c".repeat(64)]],
  }
  const manifest = {
    storage: "bunny_card_catalog_v2",
    shards: [
      {
        content_hash: hash,
        first_symbol: "TP53",
        last_symbol: "TP53",
        delivery_indexes: [{ first_symbol: "TP53", last_symbol: "TP53", key: indexKey }],
      },
    ],
  }
  const objects = new Map([
    [indexKey, directory],
    [portraitKey, portrait],
  ])
  let current = "first"
  const calls = []
  const handlers = createHoverDeliveryHandlers({
    barrier: async () => ({ current }),
    manifest: async () => manifest,
    shard: () => assert.fail("v2 hover must never read a packed shard"),
    object: async (_env, key, validate) => {
      calls.push(key)
      const value = objects.get(key)
      return value && validate(value) ? value : null
    },
    json: (value, status, headers) => Response.json(value, { status, headers }),
  })
  const read = (lane, contentHash = hash, symbol = "TP53") =>
    handlers.content({
      request: new Request(
        `https://iconoplasm.brinedew.bio/api/public/v1/card-content/v1/${contentHash}/${lane}/${symbol}`,
      ),
      env: {},
      match: { params: { hash: contentHash, lane, symbol } },
    })
  const first = await read("portraits")
  assert.equal(first.status, 200)
  const before = await first.text()
  assert.deepEqual(calls, [indexKey, portraitKey])
  const failedDetail = await read("genes")
  assert.equal(failedDetail.status, 503)
  assert.equal(failedDetail.headers.get("cache-control"), "no-store")
  assert.ok(calls.includes(geneKey))
  current = "second"
  assert.equal(
    await (await read("portraits")).text(),
    before,
    "unchanged range retains byte identity across epochs",
  )
  assert.equal((await read("portraits", "0".repeat(64))).status, 410)
  assert.equal((await read("portraits", hash, "OTHER")).status, 410)
  objects.set(portraitKey, { ...portrait, symbol: "OTHER" })
  assert.equal((await read("portraits")).status, 503)
  directory.entries[0][3] = "invalid"
  assert.equal((await read("portraits")).status, 503)
})

// B-885: the signed-in home window asks for 12 cards whose genes are scattered
// across the catalog. Above 10 symbols the reader loaded every packed shard
// that held one of them (up to 450 cards and ~2 MB of JSON each, all at once),
// which blew the 128 MB isolate limit: Cloudflare 1102 on every 24-card window
// and on scattered 12-card ones (measured live, 27 Sep). A home window must use
// exact card objects: at most 12 cards + 12 directories = 24 subrequests,
// under the Free plan's 50.
test("a scattered 12-card window reads exact card objects, never packed shards (B-885)", async () => {
  const bodies = new Map()
  async function object(kind, value) {
    const text = canonicalPublishedJson(value)
    const hash = await publishedObjectHash(new TextEncoder().encode(text))
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    bodies.set(key, text)
    return { key, hash }
  }
  const symbols = Array.from({ length: 12 }, (_, i) => `G${String(i).padStart(2, "0")}`)
  const shards = []
  for (const symbol of symbols) {
    const card = {
      __complete: true,
      schema_version: "iconoplasm.mobileCard.v1",
      symbol,
      full_name: `${symbol} full name`,
      portrait: { status: "missing" },
      field_status: {},
      payload: { symbol, portrait: { status: "missing" } },
    }
    const full = await object("cards", card)
    const gene = await object("genes", card.payload)
    const portrait = await object("portraits", { symbol, portrait: card.portrait })
    const index = await object("indexes", {
      schema_version: 2,
      entries: [[symbol, full.hash, gene.hash, portrait.hash]],
    })
    shards.push({
      key: `published-cards/v2/immutable/shards/${"d".repeat(60)}${String(shards.length).padStart(4, "0")}.json`,
      content_hash: "c".repeat(64),
      card_count: 450,
      first_symbol: symbol,
      last_symbol: symbol,
      delivery_indexes: [{ key: index.key, first_symbol: symbol, last_symbol: symbol }],
    })
  }
  const root = await object("manifests", {
    schema: "iconoplasm.cardCatalog.v1",
    storage: "bunny_card_catalog_v2",
    card_count: symbols.length,
    catalog_gene_count: symbols.length,
    shards,
  })
  const env = {
    KV: { get: () => JSON.stringify({ current: `ccv2-${root.hash}`, previous: null }) },
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "fixture",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
  }
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    const key = new URL(url).pathname.replace(/^\/fixture\//, "")
    calls.push(key)
    assert.equal(key.includes("/shards/"), false, `read a packed shard: ${key}`)
    assert.ok(bodies.has(key), key)
    return new Response(bodies.get(key))
  }
  try {
    resetIconoplasmRuntimeCachesForTest()
    const artifact = await readIconoplasmPublishedCardCatalogArtifactForTest(
      env,
      `ccv2-${root.hash}`,
      symbols,
      { allowWholeArtifact: false },
    )
    assert.deepEqual([...artifact.bySymbol.keys()].sort(), symbols)
    assert.ok(calls.length <= 1 + 24, `${calls.length} subrequests for 12 cards`)
  } finally {
    globalThis.fetch = original
  }
})
