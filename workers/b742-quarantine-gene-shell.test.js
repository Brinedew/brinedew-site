import assert from "node:assert/strict"
import test from "node:test"
import runtime from "./b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { resetIconoplasmRuntimeCachesForTest } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { verifyIconoplasmReaderRecovery } from "../scripts/verify-iconoplasm-reader-recovery.mjs"

class FakeKV {
  constructor(entries) {
    this.entries = new Map(Object.entries(entries))
    this.reads = 0
  }

  async get(key) {
    this.reads++
    return this.entries.get(key) || null
  }
}

// B-898 Stage 1, step B: the reader-recovery route resolves a gene from the one
// stable object at genes/v3/<SYMBOL>.json on Bunny Storage. The fixture seeds
// those objects (storage path -> JSON) instead of the retired KV head,
// manifest and shard tree; KV stays empty so any KV read is visible.
const STABLE_PUBLISHED_AT = "2026-10-01T13:53:49.742Z"
const STORAGE_HOST = "storage.test"

function stableObjectPath(symbol) {
  return `/test-zone/genes/v3/${symbol}.json`
}

function buildStableGeneObjects(publishedAt = STABLE_PUBLISHED_AT) {
  const cards = [
    {
      symbol: "BRCA1",
      full_name: "BRCA1 DNA repair associated",
      prose: "The published BRCA1 manifestation.",
      portraitSha: "b".repeat(64),
      emulsionId: "C9-0001",
    },
    {
      symbol: "TP53",
      full_name: "tumor protein p53",
      prose: "The published TP53 manifestation.",
      portraitSha: "a".repeat(64),
      emulsionId: "C9-0002",
    },
  ].map((gene) => {
    const payload = {
      api_version: "v1",
      schema_version: 1,
      canonical_key: "symbol",
      canonical_symbol: gene.symbol,
      symbol: gene.symbol,
      full_name: gene.full_name,
      color: "#dd8c9d",
      essence: { name: gene.full_name, sex: "Unknown", sex_origin: [] },
      canonical_manifestation: {
        schema_version: 1,
        gene_id: `gene_${gene.symbol.toLowerCase()}`,
        manifestation_id: `manifestation_${gene.symbol.toLowerCase()}`,
        prose: gene.prose,
      },
      portrait: {
        status: "published",
        hero_url: `https://iconoplasm.brinedew.bio/portraits/v1/${gene.portraitSha.slice(0, 2)}/${gene.portraitSha}/full.webp`,
        medium_url: `https://iconoplasm.brinedew.bio/portraits/v1/${gene.portraitSha.slice(0, 2)}/${gene.portraitSha}/medium.webp`,
        thumb_url: `https://iconoplasm.brinedew.bio/portraits/v1/${gene.portraitSha.slice(0, 2)}/${gene.portraitSha}/thumb.webp`,
        asset_sha256: gene.portraitSha,
        width: 384,
        height: 512,
        emulsion_id: gene.emulsionId,
      },
      portrait_candidates: [],
      candidate_count: 0,
      stable_object_version: 3,
      published_at: publishedAt,
    }
    return [stableObjectPath(gene.symbol), JSON.stringify(payload)]
  })
  return new Map(cards)
}

// Routes authenticated Bunny Storage reads to the seeded stable objects. The
// containment Worker fetches nothing else (no Pages shell), so any other URL
// fails the test. `status` other than 200 makes storage fail for every object,
// which is the "published reader unavailable" branch.
function recoveryFetch(objects, { status = 200, storageReads = [] } = {}) {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (!url.hostname.endsWith(STORAGE_HOST))
      throw new Error(`the containment Worker fetched ${url.href}, which is not storage`)
    storageReads.push(url.pathname)
    if (status !== 200) return new Response(null, { status })
    const value = objects.get(url.pathname)
    return value
      ? new Response(value, { status: 200, headers: { "content-type": "application/json" } })
      : new Response(null, { status: 404 })
  }
}

function buildForbiddenEnv(kv, d1Calls) {
  const forbiddenDb = {
    prepare() {
      d1Calls.count += 1
      throw new Error("reader recovery touched D1")
    },
  }
  return {
    ICONOPLASM_SCHEMA_TRANSITION: "1",
    ICONOPLASM_SCHEMA_TRANSITION_MODE: "reader-recovery",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test-zone",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: STORAGE_HOST,
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-password",
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
    KV: kv,
    DB: forbiddenDb,
    ICONOPLASM_DB: forbiddenDb,
    ICONOPLASM_AUTHORING_DB: forbiddenDb,
    ICONOPLASM_AUDIT_DB: forbiddenDb,
    PUBLIC_RATE_LIMIT_120: { limit: async () => ({ success: true }) },
  }
}

test.beforeEach(() => resetIconoplasmRuntimeCachesForTest())
test.after(() => resetIconoplasmRuntimeCachesForTest())

test("the actual release verifier proves the published reader with every D1 binding forbidden", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  const kv = new FakeKV({})
  const env = buildForbiddenEnv(kv, d1Calls)
  const objectReads = []
  const storageReads = []
  env.ICONOPLASM_PORTRAITS = {
    async get(key) {
      objectReads.push(key)
      return { body: new Uint8Array([82, 73, 70, 70]), httpMetadata: { contentType: "image/webp" } }
    },
  }
  globalThis.fetch = recoveryFetch(buildStableGeneObjects(), { storageReads })
  try {
    const result = await verifyIconoplasmReaderRecovery({
      fetcher: async (url, options) => {
        resetIconoplasmRuntimeCachesForTest()
        // The asset layer answers a published gene's page before the Worker runs
        // (its retained bytes hold the document); this stands in for it. The
        // Worker answers everything else.
        const symbol = /^\/gene\/(TP53|BRCA1)$/.exec(new URL(url).pathname)?.[1]
        if (symbol)
          return new Response(
            options?.method === "HEAD"
              ? null
              : `<link rel="canonical" href="https://iconoplasm.brinedew.bio/gene/${symbol}">`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          )
        return runtime.fetch(new Request(url, options), env, { waitUntil() {} })
      },
    })
    assert.equal(result.reader_recovered, true)
    assert.equal(result.application_active, false)
    assert.equal(result.evidence.length, 11)
    assert.deepEqual(objectReads, [
      `portraits/v1/aa/${"a".repeat(64)}/full.webp`,
      `portraits/v1/bb/${"b".repeat(64)}/full.webp`,
    ])
    assert.equal(d1Calls.count, 0)
    // The verifier probes TP53 and BRCA1 (page + API + HEAD each) and one
    // unknown symbol; the API's gene resolution is one stable-object read and the
    // retired KV publication tree is never consulted.
    assert.ok(
      storageReads.every((path) => /^\/test-zone\/genes\/v3\/[A-Z0-9_]+\.json$/.test(path)),
      `unexpected storage reads: ${storageReads.join(", ")}`,
    )
    assert.ok(storageReads.includes(stableObjectPath("TP53")))
    assert.ok(storageReads.includes(stableObjectPath("BRCA1")))
    // NOT_A_REAL_GENE_B742 fails symbol normalization and answers 404 before
    // any storage read, so it never appears here.
    assert.equal(kv.reads, 0, `cold verification spent ${kv.reads} KV reads`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery serves the published card API without D1", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  const storageReads = []
  globalThis.fetch = recoveryFetch(buildStableGeneObjects(), { storageReads })
  try {
    const kv = new FakeKV({})
    const env = buildForbiddenEnv(kv, d1Calls)
    const apiResponse = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/TP53"),
      env,
      { waitUntil() {} },
    )
    const payload = await apiResponse.json()
    assert.equal(apiResponse.status, 200)
    assert.equal(apiResponse.headers.get("X-B742-Reader-Recovery"), "published-card-only")
    assert.ok(apiResponse.headers.get("Content-Security-Policy"))
    assert.equal(apiResponse.headers.get("X-Content-Type-Options"), "nosniff")
    assert.match(apiResponse.headers.get("Strict-Transport-Security"), /includeSubDomains/)
    assert.equal(payload.symbol, "TP53")
    assert.equal(payload.full_name, "tumor protein p53")
    assert.equal(payload.canonical_manifestation.prose, "The published TP53 manifestation.")
    assert.deepEqual(payload.portrait_candidates, [])
    assert.equal(payload.card_snapshot_version, STABLE_PUBLISHED_AT)
    assert.equal(payload.detail_availability.live_candidates, "temporarily_unavailable")
    assert.equal("stable_object_version" in payload, false)
    assert.equal("candidate_count" in payload, false)
    // The API resolved TP53 from its stable object exactly once.
    assert.deepEqual(storageReads, [stableObjectPath("TP53")])
    assert.equal(d1Calls.count, 0)
    assert.equal(kv.reads, 0)

    // The Worker owns no gene page: a /gene/ path that reaches it is a 404 that
    // reads no storage, D1 or shell (the asset layer serves the real documents).
    const page = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
      env,
      { waitUntil() {} },
    )
    assert.equal(page.status, 404)
    assert.match(await page.text(), /Gene not found/)
    assert.deepEqual(storageReads, [stableObjectPath("TP53")])
    assert.equal(d1Calls.count, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery preserves HEAD and unknown-versus-unavailable semantics", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  globalThis.fetch = recoveryFetch(buildStableGeneObjects())
  try {
    const env = buildForbiddenEnv(new FakeKV({}), d1Calls)
    const headApi = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/TP53", {
        method: "HEAD",
      }),
      env,
      { waitUntil() {} },
    )
    assert.equal(headApi.status, 200)
    assert.equal(await headApi.text(), "")

    const unknown = await runtime.fetch(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/NOT_IN_PUBLISHED_CARD",
      ),
      env,
      { waitUntil() {} },
    )
    assert.equal(unknown.status, 404)

    // Bunny Storage failing (5xx on every attempt) is "published reader
    // unavailable", not "gene unknown": 503, never a 404.
    resetIconoplasmRuntimeCachesForTest()
    globalThis.fetch = recoveryFetch(buildStableGeneObjects(), { status: 500 })
    const unavailable = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/TP53"),
      buildForbiddenEnv(new FakeKV({}), d1Calls),
      { waitUntil() {} },
    )
    assert.equal(unavailable.status, 503)
    assert.equal(d1Calls.count, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery leaves voting and authority routes behind the transition fence", async () => {
  const d1Calls = { count: 0 }
  for (const [path, method] of [
    ["/api/iconoplasm/authority/events", "GET"],
    ["/api/iconoplasm/votes/set", "POST"],
    ["/api/iconoplasm/discoveries/encounter", "POST"],
  ]) {
    const response = await runtime.fetch(
      new Request(`https://iconoplasm.brinedew.bio${path}`, { method }),
      buildForbiddenEnv(new FakeKV({}), d1Calls),
      { waitUntil() {} },
    )
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, "ICONOPLASM_SCHEMA_TRANSITION")
  }
  assert.equal(d1Calls.count, 0)
})

test("B-742 transition mode is explicit; a missing mode cannot open the reader", async () => {
  const d1Calls = { count: 0 }
  const env = buildForbiddenEnv(new FakeKV({}), d1Calls)
  delete env.ICONOPLASM_SCHEMA_TRANSITION_MODE
  const response = await runtime.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/TP53"),
    env,
    { waitUntil() {} },
  )
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, "ICONOPLASM_SCHEMA_TRANSITION")
  assert.equal(d1Calls.count, 0)
})
