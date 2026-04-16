import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeKV {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
  }

  async get(key) {
    return this.entries.has(key) ? this.entries.get(key) : null
  }

  async put(key, value) {
    this.entries.set(key, value)
  }
}

class FakeSearchStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async first() {
    if (
      this.sql.includes("COUNT(*) AS published_count") &&
      this.sql.includes("GROUP_CONCAT(symbol_asset, '|')")
    ) {
      return this.db.getPublishedPortraitFingerprint()
    }
    if (this.sql.includes("FROM icono_gene_discoveries") && this.sql.includes("LIMIT 1")) {
      const [userId, geneSymbol] = this.args
      return this.db.getDiscovery(userId, geneSymbol)
    }
    throw new Error(`Unexpected SQL in fake search DB first(): ${this.sql}`)
  }

  async all() {
    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      return { results: this.db.listPublishedPortraitRefs() }
    }
    if (this.sql.includes("SELECT d.gene_symbol") && this.sql.includes("FROM icono_gene_discoveries d")) {
      const [userId] = this.args
      return {
        results: this.db.listDiscoverySymbols(userId),
      }
    }
    throw new Error(`Unexpected SQL in fake search DB all(): ${this.sql}`)
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_gene_discoveries")) {
      this.db.insertDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_gene_discoveries")) {
      this.db.updateDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    throw new Error(`Unexpected SQL in fake search DB run(): ${this.sql}`)
  }
}

class FakeSearchDb {
  constructor({ publishedPortraits = [] } = {}) {
    this.rows = new Map()
    this.tick = 0
    this.publishedPortraits = new Map()
    this.setPublishedPortraits(publishedPortraits)
  }

  prepare(sql) {
    return new FakeSearchStatement(this, sql)
  }

  key(userId, geneSymbol) {
    return `${String(userId)}|${String(geneSymbol || "").trim().toUpperCase()}`
  }

  now() {
    this.tick += 1
    return `2026-04-05T00:00:${String(this.tick).padStart(2, "0")}Z`
  }

  getDiscovery(userId, geneSymbol) {
    const row = this.rows.get(this.key(userId, geneSymbol))
    return row ? { ...row } : null
  }

  listDiscoverySymbols(userId) {
    return Array.from(this.rows.values())
      .filter((row) => row.user_id === String(userId))
      .sort((left, right) => {
        return (
          String(left.first_discovered_at || "").localeCompare(String(right.first_discovered_at || "")) ||
          String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
        )
      })
      .map((row) => ({ gene_symbol: row.gene_symbol }))
  }

  insertDiscovery(args) {
    const [userId, geneSymbol, firstSource, lastSource, firstTrigger, lastTrigger, firstDwellMs, lastDwellMs] = args
    const timestamp = this.now()
    this.rows.set(this.key(userId, geneSymbol), {
      user_id: String(userId),
      gene_symbol: String(geneSymbol || "").trim().toUpperCase(),
      first_discovered_at: timestamp,
      last_encountered_at: timestamp,
      encounter_count: 1,
      first_source: String(firstSource || ""),
      last_source: String(lastSource || ""),
      first_trigger: String(firstTrigger || ""),
      last_trigger: String(lastTrigger || ""),
      first_dwell_ms: firstDwellMs == null ? null : Number(firstDwellMs),
      last_dwell_ms: lastDwellMs == null ? null : Number(lastDwellMs),
    })
  }

  updateDiscovery(args) {
    const [lastSource, lastTrigger, lastDwellMs, userId, geneSymbol] = args
    const key = this.key(userId, geneSymbol)
    const existing = this.rows.get(key)
    if (!existing) {
      throw new Error(`Cannot update missing discovery row for ${key}`)
    }
    this.rows.set(key, {
      ...existing,
      last_encountered_at: this.now(),
      encounter_count: Number(existing.encounter_count || 0) + 1,
      last_source: String(lastSource || ""),
      last_trigger: String(lastTrigger || ""),
      last_dwell_ms: lastDwellMs == null ? null : Number(lastDwellMs),
    })
  }

  seedDiscovery(userId, geneSymbol) {
    this.insertDiscovery([
      userId,
      geneSymbol,
      "extension_hover",
      "extension_hover",
      "hover_dwell",
      "hover_dwell",
      900,
      900,
    ])
  }

  setPublishedPortraits(rows = []) {
    this.publishedPortraits = new Map()
    for (const row of rows) {
      const symbol = String(row?.symbol || row?.gene_symbol || "").trim().toUpperCase()
      if (!symbol) continue
      this.publishedPortraits.set(symbol, {
        symbol,
        asset_sha256: row?.asset_sha256 || null,
        ph: row?.ph || null,
        pt: row?.pt || null,
        updated_at: row?.updated_at || null,
      })
    }
  }

  listPublishedPortraitRefs() {
    return Array.from(this.publishedPortraits.values()).map((row) => ({
      symbol: row.symbol,
      asset_sha256: row.asset_sha256,
      ph: row.ph,
      pt: row.pt,
    }))
  }

  getPublishedPortraitFingerprint() {
    if (this.publishedPortraits.size === 0) {
      return { published_count: 0, published_pairs: "" }
    }
    const publishedPairs = Array.from(this.publishedPortraits.values())
      .sort((left, right) => String(left.symbol || "").localeCompare(String(right.symbol || "")))
      .map((row) => `${row.symbol}:${row.asset_sha256 || ""}`)
      .join("|")
    return {
      published_count: this.publishedPortraits.size,
      published_pairs: publishedPairs,
    }
  }
}

class FakeGameSessions {
  constructor(sessions = {}) {
    this.sessions = sessions
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    const session = this.sessions[String(id || "")]
    return {
      fetch: async () => {
        if (!session) {
          return new Response("missing", { status: 404 })
        }
        return Response.json(session)
      },
    }
  }
}

class FakeOnlyAllowedGateway {
  constructor(responseFactory) {
    this.responseFactory = responseFactory
    this.calls = []
  }

  async fetch(request) {
    const cloned = request.clone()
    this.calls.push({
      url: cloned.url,
      method: cloned.method,
      headers: Object.fromEntries(cloned.headers.entries()),
    })
    return this.responseFactory(cloned)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE) {
    env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(request, gatewayEnv, ctx)
      },
    }
  }
  return env
}

function buildCatalogArtifact() {
  const genes = [
    { s: "INS", n: "Insulin", c: "#d85c57", tmh: false, a: ["INSULIN"] },
    { s: "RHO", n: "Rhodopsin", c: "#4b5b7c", tmh: true, a: ["OPN2"] },
    {
      s: "PRL",
      n: "Prolactin",
      c: "#7a5861",
      tmh: false,
      a: [],
      pt: "https://iconoplasm.brinedew.bio/portraits/v1/stale/stale-prl/medium.webp",
      ph: "https://iconoplasm.brinedew.bio/portraits/v1/stale/stale-prl/full.webp",
    },
    { s: "TP53", n: "Tumor protein p53", c: "#5f6e52", tmh: false, a: ["P53"] },
    { s: "GUARDIAN1", n: "Cell cycle regulator", c: "#856b47", tmh: false, a: [] },
    { s: "BAX", n: "Guardian pathway effector", c: "#556b2f", tmh: false, a: [] },
    { s: "MDM2", n: "Mouse double minute 2 homolog", c: "#8a7d5c", tmh: false, a: ["GUARDIAN"] },
  ]
  return {
    schema_version: 4,
    generated_at: "2026-04-05T00:00:00Z",
    gene_count: genes.length,
    genes,
  }
}

function buildEnv({ sessions = {}, publishedPortraits = [], artifact = null, overrides = {} } = {}) {
  const hash = "searchfixture01"
  const catalogArtifact = artifact || buildCatalogArtifact()
  const gatewayDb = overrides.ICONOPLASM_DB === undefined
    ? new FakeSearchDb({ publishedPortraits })
    : overrides.ICONOPLASM_DB
  const gatewayEnv = {
    KV: new FakeKV({
      "iconoplasm:catalog-manifest": JSON.stringify({
        current_hash: hash,
        filename: `catalog.${hash}.json`,
        generated_at: catalogArtifact.generated_at,
        schema_version: catalogArtifact.schema_version,
        canonical_key: "symbol",
        gene_count: catalogArtifact.gene_count,
      }),
      [`iconoplasm:catalog:${hash}`]: JSON.stringify(catalogArtifact),
    }),
    ICONOPLASM_DB: gatewayDb,
    GAME_SESSIONS: new FakeGameSessions(sessions),
    ...overrides,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindOnlyAllowedGateway(env, gatewayEnv)
}

function buildRequest(path, { cookie = "" } = {}) {
  return new Request(`https://iconoplasm.brinedew.bio${path}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : undefined,
  })
}

test.beforeEach(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test.after(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test("catalog search refreshes canonical portraits even if gallery version does not bump", async () => {
  const env = buildEnv({
    publishedPortraits: [
      {
        symbol: "PRL",
        asset_sha256: "a".repeat(64),
        ph: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/full.webp`,
        pt: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/medium.webp`,
        updated_at: "2026-04-05T00:00:01Z",
      },
    ],
  })

  const firstResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=prl&scope=catalog&limit=5"),
    env,
    {},
  )
  const firstPayload = await firstResponse.json()

  assert.equal(firstResponse.status, 200)
  assert.match(firstPayload?.genes?.[0]?.pt || "", /a{64}\/medium\.webp$/)
  assert.match(firstPayload?.genes?.[0]?.ph || "", /a{64}\/full\.webp$/)

  env.gatewayDb.setPublishedPortraits([
    {
      symbol: "PRL",
      asset_sha256: "b".repeat(64),
      ph: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/full.webp`,
      pt: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/medium.webp`,
      updated_at: "2026-04-05T00:00:01Z",
    },
  ])

  resetIconoplasmRuntimeCachesForTest()

  const secondResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=prl&scope=catalog&limit=5"),
    env,
    {},
  )
  const secondPayload = await secondResponse.json()

  assert.equal(secondResponse.status, 200)
  assert.match(secondPayload?.genes?.[0]?.pt || "", /b{64}\/medium\.webp$/)
  assert.match(secondPayload?.genes?.[0]?.ph || "", /b{64}\/full\.webp$/)
})

test("catalog search ranks symbol matches before full names before aliases", async () => {
  const env = buildEnv()
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=guardian&scope=catalog&limit=10"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.scope_applied, "catalog")
  assert.deepEqual(
    payload?.genes?.slice(0, 3).map((gene) => gene.symbol),
    ["GUARDIAN1", "BAX", "MDM2"],
  )
  assert.deepEqual(
    payload?.genes?.slice(0, 3).map((gene) => gene.matched_by),
    ["symbol", "full_name", "alias"],
  )
})

test("guest discovery search falls back to the starter trio instead of the full catalog", async () => {
  const env = buildEnv()

  const starterResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=rho&scope=discoveries&limit=10"),
    env,
    {},
  )
  const starterPayload = await starterResponse.json()

  assert.equal(starterResponse.status, 200)
  assert.equal(starterPayload?.scope_applied, "starter")
  assert.deepEqual(
    starterPayload?.genes?.map((gene) => gene.symbol),
    ["RHO"],
  )
  assert.equal(starterResponse.headers.get("Cache-Control"), "no-store")

  const hiddenResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=tp53&scope=discoveries&limit=10"),
    env,
    {},
  )
  const hiddenPayload = await hiddenResponse.json()

  assert.equal(hiddenResponse.status, 200)
  assert.deepEqual(hiddenPayload?.genes, [])
})

test("signed-in discovery search searches the user's shelf and seeds starters for empty accounts", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })

  const starterResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=rho&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const starterPayload = await starterResponse.json()

  assert.equal(starterResponse.status, 200)
  assert.equal(starterPayload?.scope_applied, "discoveries")
  assert.deepEqual(
    starterPayload?.genes?.map((gene) => gene.symbol),
    ["RHO"],
  )
  assert.deepEqual(
    env.gatewayDb.listDiscoverySymbols("user-123").map((row) => row.gene_symbol),
    ["INS", "RHO", "PRL"],
  )

  env.gatewayDb.seedDiscovery("user-123", "TP53")

  const discoveredResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=tp53&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const discoveredPayload = await discoveredResponse.json()

  assert.equal(discoveredResponse.status, 200)
  assert.deepEqual(
    discoveredPayload?.genes?.map((gene) => gene.symbol),
    ["TP53"],
  )

  const hiddenResponse = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=guardian&scope=discoveries&limit=10", {
      cookie: "session=abc",
    }),
    env,
    {},
  )
  const hiddenPayload = await hiddenResponse.json()

  assert.equal(hiddenResponse.status, 200)
  assert.deepEqual(hiddenPayload?.genes, [])
  assert.equal(hiddenResponse.headers.get("Cache-Control"), "no-store")
})

test("catalog search uses THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE when bound", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      genes: [{ symbol: "PRL", matched_by: "symbol" }],
      query: "PRL",
      scope_applied: "catalog",
    }),
  )
  const env = buildEnv({
    overrides: {
      ICONOPLASM_DB: null,
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
    },
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/genes/search?q=prl&scope=catalog&limit=5"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.genes?.[0]?.symbol, "PRL")
  assert.equal(gateway.calls.length, 1)
  assert.equal(gateway.calls[0]?.url, "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/genes/search?q=prl&scope=catalog&limit=5")
  assert.equal(gateway.calls[0]?.method, "GET")
})

test("catalog artifact uses THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE when bound", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      schema_version: 4,
      gene_count: 1,
      genes: [{ s: "PRL", n: "Gateway Prolactin" }],
    }),
  )
  const env = buildEnv({
    overrides: {
      ICONOPLASM_DB: null,
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
    },
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    buildRequest("/api/public/v1/catalog/catalog.searchfixture01.json"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.gene_count, 1)
  assert.equal(payload?.genes?.[0]?.n, "Gateway Prolactin")
  assert.equal(gateway.calls[0]?.url, "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/catalog/catalog.searchfixture01.json")
  assert.equal(gateway.calls[0]?.method, "GET")
})

