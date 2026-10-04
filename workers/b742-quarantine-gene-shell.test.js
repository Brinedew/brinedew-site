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

// The reader-recovery containment Worker answers one thing for a reader: the
// first-party portrait fallback, from the object store binding, with every D1
// binding forbidden. The gene's card is the stable object on the CDN
// (genes/v3/<SYMBOL>.json), which the page and the release verifier read
// directly; the Worker never fetches it. This fixture stands in for the CDN.
const CDN_HOST = "iconoplasmportraits.b-cdn.net"

function stableObject(symbol, portraitSha) {
  return JSON.stringify({
    symbol,
    canonical_symbol: symbol,
    portrait: {
      status: "published",
      asset_sha256: portraitSha,
      medium_url: `https://iconoplasm.brinedew.bio/portraits/v1/${portraitSha.slice(0, 2)}/${portraitSha}/medium.webp`,
    },
  })
}

const STABLE_OBJECTS = new Map([
  ["/genes/v3/BRCA1.json", stableObject("BRCA1", "b".repeat(64))],
  ["/genes/v3/TP53.json", stableObject("TP53", "a".repeat(64))],
])

// The containment Worker fetches nothing: its bytes come from the R2 binding,
// so any fetch it makes fails the test.
function forbidWorkerFetch(fetched) {
  return async (input) => {
    const href = String(input instanceof Request ? input.url : input)
    fetched.push(href)
    throw new Error(`the containment Worker fetched ${href}`)
  }
}

function portraitBucket(objectReads) {
  return {
    async get(key) {
      objectReads.push(key)
      return { body: new Uint8Array([82, 73, 70, 70]), httpMetadata: { contentType: "image/webp" } }
    },
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
  const workerFetches = []
  env.ICONOPLASM_PORTRAITS = portraitBucket(objectReads)
  globalThis.fetch = forbidWorkerFetch(workerFetches)
  try {
    const result = await verifyIconoplasmReaderRecovery({
      fetcher: async (url, options) => {
        resetIconoplasmRuntimeCachesForTest()
        const target = new URL(url)
        // The asset layer answers a published gene's page before the Worker runs
        // (its retained bytes hold the document); this stands in for it.
        const symbol = /^\/gene\/(TP53|BRCA1)$/.exec(target.pathname)?.[1]
        if (symbol && target.hostname === "iconoplasm.brinedew.bio")
          return new Response(
            options?.method === "HEAD"
              ? null
              : `<link rel="canonical" href="https://iconoplasm.brinedew.bio/gene/${symbol}">`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          )
        // The CDN answers each gene's stable object.
        if (target.hostname === CDN_HOST) {
          const body = STABLE_OBJECTS.get(target.pathname)
          return body
            ? new Response(body, { status: 200, headers: { "content-type": "application/json" } })
            : new Response(null, { status: 404 })
        }
        // The Worker answers everything else.
        return runtime.fetch(new Request(url, options), env, { waitUntil() {} })
      },
    })
    assert.equal(result.reader_recovered, true)
    assert.equal(result.application_active, false)
    // Per gene: the page, its stable object, a HEAD of the page, its portrait.
    // Then the unknown gene's page and the fenced authority route.
    assert.equal(result.evidence.length, 10)
    assert.deepEqual(objectReads, [
      `portraits/v1/aa/${"a".repeat(64)}/full.webp`,
      `portraits/v1/bb/${"b".repeat(64)}/full.webp`,
    ])
    assert.equal(d1Calls.count, 0)
    assert.deepEqual(workerFetches, [])
    assert.equal(kv.reads, 0, `cold verification spent ${kv.reads} KV reads`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery serves the first-party portrait without D1 and under the security headers", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  const objectReads = []
  const workerFetches = []
  globalThis.fetch = forbidWorkerFetch(workerFetches)
  try {
    const kv = new FakeKV({})
    const env = buildForbiddenEnv(kv, d1Calls)
    env.ICONOPLASM_PORTRAITS = portraitBucket(objectReads)
    const sha = "a".repeat(64)
    const response = await runtime.fetch(
      new Request(`https://iconoplasm.brinedew.bio/portraits/v1/aa/${sha}/full.webp`),
      env,
      { waitUntil() {} },
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Content-Type"), "image/webp")
    assert.equal(response.headers.get("X-B742-Reader-Recovery"), "published-card-only")
    assert.ok(response.headers.get("Content-Security-Policy"))
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
    assert.match(response.headers.get("Strict-Transport-Security"), /includeSubDomains/)
    assert.deepEqual(objectReads, [`portraits/v1/aa/${sha}/full.webp`])
    assert.deepEqual(workerFetches, [])
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
    // Nor does it proxy a shell: any other path that reaches the Worker (here, the
    // leftovers of the /admin* pattern) is a 404 that fetches nothing.
    for (const path of ["/admin/nothing-here", "/no/such/page"]) {
      const stray = await runtime.fetch(
        new Request(`https://iconoplasm.brinedew.bio${path}`),
        env,
        { waitUntil() {} },
      )
      assert.equal(stray.status, 404, path)
      assert.equal(await stray.text(), "Not Found", path)
    }
    assert.deepEqual(workerFetches, [])
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

// Production has no R2 binding (the bytes live in Bunny Storage), so without the shell the
// portrait request reaches the transition fence. A bound R2 bucket would be served by the
// base Worker's own early portrait path before the fence, which is not what this proves.
test("B-742 transition mode is explicit; a missing mode cannot open the reader", async () => {
  const d1Calls = { count: 0 }
  const workerFetches = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = forbidWorkerFetch(workerFetches)
  const env = buildForbiddenEnv(new FakeKV({}), d1Calls)
  delete env.ICONOPLASM_SCHEMA_TRANSITION_MODE
  let response
  try {
    response = await runtime.fetch(
      new Request(`https://iconoplasm.brinedew.bio/portraits/v1/aa/${"a".repeat(64)}/full.webp`),
      env,
      { waitUntil() {} },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, "ICONOPLASM_SCHEMA_TRANSITION")
  assert.deepEqual(workerFetches, [])
  assert.equal(d1Calls.count, 0)
})
