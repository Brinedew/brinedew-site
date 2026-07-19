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
    this.entries.set(key, String(value))
  }
}

class FakeChangesStatement {
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
    return null
  }

  async all() {
    if (
      this.sql.includes("SELECT gene_symbol AS symbol") &&
      this.sql.includes("current_asset_sha256 AS asset_sha256") &&
      this.sql.includes("ORDER BY gene_symbol ASC")
    ) {
      return {
        results: this.db.listPublishedPortraitRefs().map((row) => ({
          symbol: row.symbol,
          asset_sha256: row.asset_sha256,
        })),
      }
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      return { results: this.db.listPublishedPortraitRefs() }
    }
    if (this.sql.includes("FROM icono_gene_catalog") && this.sql.includes("updated_at")) {
      return {
        results: [
          { symbol: "PRL", updated_at: "2026-04-06T00:00:01Z" },
          { symbol: "INS", updated_at: "2026-04-06T00:00:04Z" },
        ],
      }
    }
    if (this.sql.includes("FROM icono_gene_essence") && this.sql.includes("updated_at")) {
      return {
        results: [{ symbol: "PRL", updated_at: "2026-04-06T00:00:02Z" }],
      }
    }
    if (
      this.sql.includes("FROM icono_publish_state") &&
      this.sql.includes("updated_at") &&
      !this.sql.includes("current_asset_sha256")
    ) {
      return {
        results: [{ symbol: "PRL", updated_at: "2026-04-06T00:00:03Z" }],
      }
    }
    if (
      this.sql.includes("FROM icono_publish_state") &&
      this.sql.includes("current_asset_sha256")
    ) {
      return {
        results: [
          {
            symbol: "PRL",
            current_asset_sha256: "a".repeat(64),
          },
          {
            symbol: "INS",
            current_asset_sha256: "b".repeat(64),
          },
        ],
      }
    }
    throw new Error(`Unexpected SQL in fake changes DB all(): ${this.sql}`)
  }

  async run() {
    throw new Error(`Unexpected SQL in fake changes DB run(): ${this.sql}`)
  }
}

class FakeChangesDb {
  constructor({ publishedPortraits = [] } = {}) {
    this.publishedPortraits = new Map()
    for (const row of publishedPortraits) {
      const symbol = String(row?.symbol || "")
        .trim()
        .toUpperCase()
      if (!symbol) continue
      this.publishedPortraits.set(symbol, {
        symbol,
        asset_sha256: row?.asset_sha256 || null,
        ph: row?.ph || null,
        pt: row?.pt || null,
      })
    }
  }

  prepare(sql) {
    return new FakeChangesStatement(this, sql)
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
      body: cloned.method === "GET" || cloned.method === "HEAD" ? null : await cloned.text(),
    })
    return this.responseFactory(cloned)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        gatewayEnv,
        ctx,
      )
    },
  }
  return env
}

function buildCatalogArtifact() {
  return {
    schema_version: 4,
    generated_at: "2026-04-05T00:00:00Z",
    gene_count: 7,
    genes: [
      { s: "CCNH", n: "Cyclin H", c: "#6b705c", tmh: false, a: [] },
      { s: "CDH1", n: "cadherin 1", c: "#6b705c", tmh: true, a: ["CD324"] },
      { s: "CDH2", n: "cadherin 2", c: "#6b705c", tmh: true, a: ["NCAD"] },
      {
        s: "CDH17",
        n: "cadherin 17",
        c: "#6b705c",
        tmh: true,
        a: ["HPT-1", "cadherin"],
      },
      { s: "INS", n: "Insulin", c: "#d85c57", tmh: false, a: ["INSULIN"] },
      { s: "PRL", n: "Prolactin", c: "#7a5861", tmh: false, a: [] },
      { s: "TP53", n: "Tumor protein p53", c: "#5f6e52", tmh: false, a: ["P53"] },
    ],
  }
}

function buildEnv(overrides = {}, { bindGateway = true } = {}) {
  const hash = "resolvefixture01"
  const artifact = buildCatalogArtifact()
  const gatewayDb =
    overrides.ICONOPLASM_DB === undefined
      ? new FakeChangesDb({
          publishedPortraits: [
            {
              symbol: "PRL",
              asset_sha256: "a".repeat(64),
              ph: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/full.webp`,
              pt: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/medium.webp`,
            },
          ],
        })
      : overrides.ICONOPLASM_DB
  const gatewayEnv = {
    KV: new FakeKV({
      "iconoplasm:catalog-manifest": JSON.stringify({
        current_hash: hash,
        filename: `catalog.${hash}.json`,
        generated_at: artifact.generated_at,
        schema_version: artifact.schema_version,
        canonical_key: "symbol",
        gene_count: artifact.gene_count,
      }),
      [`iconoplasm:catalog:${hash}`]: JSON.stringify(artifact),
    }),
    ICONOPLASM_DB: gatewayDb,
    ...overrides,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test.beforeEach(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test.after(() => {
  resetIconoplasmRuntimeCachesForTest()
})

test("public resolve route works through THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: [
            "P53",
            "Cyclin H",
            "cadherin",
            "Cadherin",
            "E-cadherin",
            "E-Cadherins",
            "E cadherins",
            "N-cadherin",
            "N-Cadherins",
            "N cadherins",
            "INS",
          ],
        }),
      }),
      buildEnv(),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload?.results?.map((item) => ({
      requested: item.requested,
      canonical_symbol: item.canonical_symbol,
      matched_by: item.matched_by,
    })),
    [
      { requested: "P53", canonical_symbol: "TP53", matched_by: "alias" },
      { requested: "Cyclin H", canonical_symbol: "CCNH", matched_by: "alias" },
      { requested: "cadherin", canonical_symbol: null, matched_by: null },
      { requested: "Cadherin", canonical_symbol: null, matched_by: null },
      { requested: "E-cadherin", canonical_symbol: "CDH1", matched_by: "alias" },
      { requested: "E-Cadherins", canonical_symbol: "CDH1", matched_by: "alias" },
      { requested: "E cadherins", canonical_symbol: "CDH1", matched_by: "alias" },
      { requested: "N-cadherin", canonical_symbol: "CDH2", matched_by: "alias" },
      { requested: "N-Cadherins", canonical_symbol: "CDH2", matched_by: "alias" },
      { requested: "N cadherins", canonical_symbol: "CDH2", matched_by: "alias" },
      { requested: "INS", canonical_symbol: "INS", matched_by: "symbol" },
    ],
  )
})

test("public changes route works through THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/public/v1/changes?since=2026-04-06T00:00:00Z&limit=10",
      ),
      buildEnv(),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(Array.isArray(payload?.changes), true)
  assert.equal(payload?.changes?.[0]?.symbol, "PRL")
  assert.deepEqual(payload?.changes?.[0]?.change_types, ["catalog", "essence", "portrait"])
  assert.equal(payload?.changes?.[0]?.current_asset_sha256, "a".repeat(64))
})

test("public resolve uses THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE when explicitly bound", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      results: [{ requested: "P53", canonical_symbol: "TP53", matched_by: "alias", found: true }],
    }),
  )

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/public/v1/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ["P53"] }),
      }),
      buildEnv(
        { THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway },
        { bindGateway: false },
      ),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.results?.[0]?.canonical_symbol, "TP53")
  assert.equal(gateway.calls.length, 1)
  assert.equal(
    gateway.calls[0]?.url,
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/resolve",
  )
  assert.equal(gateway.calls[0]?.method, "POST")
  assert.deepEqual(JSON.parse(gateway.calls[0]?.body || "null"), { identifiers: ["P53"] })
})

test("public changes fails closed when THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE is missing", async () => {
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/public/v1/changes?since=2026-04-06T00:00:00Z&limit=10",
      ),
      buildEnv({ THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: null }, { bindGateway: false }),
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "THE_ONLY_ALLOWED_STATEFUL_WORKER_REQUIRED")
  assert.match(String(payload?.error || ""), /THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE/i)
})
