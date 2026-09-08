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

function buildPublishedCardKv(version = "reader-recovery-v1") {
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
      snapshot_version: version,
    }
    return {
      __complete: true,
      schema_version: "iconoplasm.mobileCard.v1",
      snapshot_version: version,
      symbol: gene.symbol,
      full_name: gene.full_name,
      portrait: payload.portrait,
      field_status: { symbol: "present", portrait: "present" },
      payload,
    }
  })
  const shardKey = `iconoplasm:card-catalog-shard:${version}:0`
  return new FakeKV({
    "iconoplasm:gallery-version": JSON.stringify({ current: version, status: "active" }),
    [`iconoplasm:card-catalog:${version}`]: JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      storage: "kv_sharded",
      artifact_version: version,
      snapshot_version: version,
      catalog_gene_count: cards.length,
      card_count: cards.length,
      shards: [
        {
          key: shardKey,
          index: 0,
          card_count: cards.length,
          first_symbol: "BRCA1",
          last_symbol: "TP53",
        },
      ],
    }),
    [shardKey]: JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      artifact_version: version,
      shard_index: 0,
      cards,
    }),
  })
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

function pageShell() {
  return '<!doctype html><html><head><title>Iconoplasm</title></head><body><div id="iconoplasm-root"><!-- iconoplasm-static-gene-shell:start --><div id="icono-gene-content">generic</div><!-- iconoplasm-static-gene-shell:end --></div></body></html>'
}

test.beforeEach(() => resetIconoplasmRuntimeCachesForTest())
test.after(() => resetIconoplasmRuntimeCachesForTest())

test("the actual release verifier proves the published reader with every D1 binding forbidden", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  const kv = buildPublishedCardKv()
  const env = buildForbiddenEnv(kv, d1Calls)
  const objectReads = []
  env.ICONOPLASM_PORTRAITS = {
    async get(key) {
      objectReads.push(key)
      return { body: new Uint8Array([82, 73, 70, 70]), httpMetadata: { contentType: "image/webp" } }
    },
  }
  globalThis.fetch = async () =>
    new Response(pageShell(), { headers: { "Content-Type": "text/html" } })
  try {
    const result = await verifyIconoplasmReaderRecovery({
      fetcher: async (url, options) => {
        resetIconoplasmRuntimeCachesForTest()
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
    assert.ok(kv.reads <= 100, `cold verification spent ${kv.reads} KV reads`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery serves real published gene content and API without D1", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://brinedew-bio.pages.dev/apps/iconoplasm/index")
    return new Response(pageShell(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  }
  try {
    const env = buildForbiddenEnv(buildPublishedCardKv(), d1Calls)
    const response = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
      env,
      { waitUntil() {} },
    )
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("X-B742-Reader-Recovery"), "published-card-only")
    assert.ok(response.headers.get("Content-Security-Policy"))
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
    assert.match(response.headers.get("Strict-Transport-Security"), /includeSubDomains/)
    assert.match(html, /data-icono-server-rendered-gene="true"/)
    assert.match(html, /tumor protein p53/)
    assert.match(html, /The published TP53 manifestation\./)
    assert.match(html, /portraits\/v1\/aa\/a{64}\/full\.webp/)
    assert.match(html, /reader-recovery-v1/)
    assert.doesNotMatch(html, /data-b742-d1-free-gene-shell/)

    const apiResponse = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/site/genes/TP53"),
      env,
      { waitUntil() {} },
    )
    const payload = await apiResponse.json()
    assert.equal(apiResponse.status, 200)
    assert.equal(payload.symbol, "TP53")
    assert.equal(payload.full_name, "tumor protein p53")
    assert.equal(payload.canonical_manifestation.prose, "The published TP53 manifestation.")
    assert.deepEqual(payload.portrait_candidates, [])
    assert.equal(payload.detail_availability.live_candidates, "temporarily_unavailable")
    assert.equal(d1Calls.count, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("B-742 reader recovery preserves HEAD and unknown-versus-unavailable semantics", async () => {
  const originalFetch = globalThis.fetch
  const d1Calls = { count: 0 }
  globalThis.fetch = async () =>
    new Response(pageShell(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  try {
    const env = buildForbiddenEnv(buildPublishedCardKv(), d1Calls)
    const headPage = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53", { method: "HEAD" }),
      env,
      { waitUntil() {} },
    )
    assert.equal(headPage.status, 200)
    assert.equal(await headPage.text(), "")

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
      new Request("https://iconoplasm.brinedew.bio/gene/NOT_IN_PUBLISHED_CARD"),
      env,
      { waitUntil() {} },
    )
    assert.equal(unknown.status, 404)
    assert.match(await unknown.text(), /Gene not found/)

    resetIconoplasmRuntimeCachesForTest()
    const unavailable = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
      buildForbiddenEnv(
        new FakeKV({ "iconoplasm:gallery-version": JSON.stringify({ current: "missing" }) }),
        d1Calls,
      ),
      { waitUntil() {} },
    )
    assert.equal(unavailable.status, 503)
    assert.match(await unavailable.text(), /temporarily unavailable/i)
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
      buildForbiddenEnv(buildPublishedCardKv(), d1Calls),
      { waitUntil() {} },
    )
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, "ICONOPLASM_SCHEMA_TRANSITION")
  }
  assert.equal(d1Calls.count, 0)
})

test("B-742 transition mode is explicit; a missing mode cannot open the reader", async () => {
  const d1Calls = { count: 0 }
  const env = buildForbiddenEnv(buildPublishedCardKv(), d1Calls)
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
