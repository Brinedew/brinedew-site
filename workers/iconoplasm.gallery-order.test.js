import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

if (!globalThis.caches) {
  globalThis.caches = {
    default: {
      async match() {
        return null
      },
      async put() {},
    },
  }
}

class FakeStatement {
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
    if (this.sql.includes("FROM icono_admin_dashboard_summary")) {
      return { published_total: this.db.rows.length }
    }

    return null
  }

  async all() {
    if (
      this.sql.includes("FROM icono_admin_gene_rollup gr") &&
      this.sql.includes("LEFT JOIN icono_gene_catalog gc") &&
      this.sql.includes("LEFT JOIN icono_gene_essence ge")
    ) {
      const limit = Number(this.args[0] || 0)
      const offset = Number(this.args[1] || 0)
      const metricKey = this.sql.includes("CASE WHEN ge.weight_kg")
        ? "weight_kg"
        : "age_years"
      const descending = this.sql.includes(`${metricKey === "age_years" ? "ge.age_years" : "ge.weight_kg"} DESC`)
      const invalidatesNonPositive = this.sql.includes(`${metricKey === "age_years" ? "ge.age_years" : "ge.weight_kg"} <= 0`)

      const sorted = this.db.rows.slice().sort((left, right) => {
        const leftMetric = Number(left[metricKey])
        const rightMetric = Number(right[metricKey])
        const leftInvalid = !Number.isFinite(leftMetric) || (invalidatesNonPositive && leftMetric <= 0)
        const rightInvalid = !Number.isFinite(rightMetric) || (invalidatesNonPositive && rightMetric <= 0)

        if (leftInvalid !== rightInvalid) return Number(leftInvalid) - Number(rightInvalid)
        if (!leftInvalid && !rightInvalid && leftMetric !== rightMetric) {
          return descending ? rightMetric - leftMetric : leftMetric - rightMetric
        }
        return (
          Number(right.image_score || 0) - Number(left.image_score || 0) ||
          Number(right.image_upvotes || 0) - Number(left.image_upvotes || 0) ||
          String(right.published_at || "").localeCompare(String(left.published_at || "")) ||
          String(left.symbol || "").localeCompare(String(right.symbol || ""))
        )
      })

      return {
        results: sorted.slice(offset, offset + limit).map((row) => ({
          symbol: row.symbol,
          full_name: row.full_name,
          published_at: row.published_at,
          asset_created_at: row.asset_created_at,
          asset_sha256: row.asset_sha256,
          candidate_image_id: 0,
          vision_id: row.vision_id,
          r2_key_full: row.r2_key_full,
          r2_key_medium: row.r2_key_medium,
          r2_key_thumb: row.r2_key_thumb,
          width: null,
          height: null,
          image_upvotes: row.image_upvotes,
          image_downvotes: row.image_downvotes,
          image_score: row.image_score,
          color_hex: row.color_hex,
          weight_kg: row.weight_kg,
          age_years: row.age_years,
          leakage_percent: null,
        })),
      }
    }

    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor(rows) {
    this.rows = rows
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
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
    })
    return this.responseFactory(cloned)
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = buildCtx()) {
  if (!env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE) {
    env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(request, gatewayEnv, ctx)
      },
    }
  }
  return env
}

function buildEnv(overrides = {}, { bindGateway = true } = {}) {
  const gatewayDb = overrides.ICONOPLASM_DB === undefined ? new FakeIconoplasmDb([
      {
        symbol: "ZEROAGE",
        full_name: "Zero Age",
        color_hex: "#111111",
        weight_kg: 10,
        age_years: 0,
        image_upvotes: 1,
        image_downvotes: 0,
        image_score: 1,
        published_at: "2026-04-04 10:00:00",
        asset_created_at: "2026-04-04 10:00:00",
        asset_sha256: "a".repeat(64),
        vision_id: "anima-v1-1001",
        r2_key_full: "portraits/full-zeroage.webp",
        r2_key_medium: "portraits/medium-zeroage.webp",
        r2_key_thumb: "portraits/thumb-zeroage.webp",
      },
      {
        symbol: "LIGHTEST",
        full_name: "Lightest Valid",
        color_hex: "#222222",
        weight_kg: 1,
        age_years: 7,
        image_upvotes: 2,
        image_downvotes: 0,
        image_score: 2,
        published_at: "2026-04-04 09:00:00",
        asset_created_at: "2026-04-04 09:00:00",
        asset_sha256: "b".repeat(64),
        vision_id: "anima-v1-1002",
        r2_key_full: "portraits/full-lightest.webp",
        r2_key_medium: "portraits/medium-lightest.webp",
        r2_key_thumb: "portraits/thumb-lightest.webp",
      },
      {
        symbol: "ZEROWEIGHT",
        full_name: "Zero Weight",
        color_hex: "#333333",
        weight_kg: 0,
        age_years: 15,
        image_upvotes: 1,
        image_downvotes: 0,
        image_score: 1,
        published_at: "2026-04-04 08:00:00",
        asset_created_at: "2026-04-04 08:00:00",
        asset_sha256: "c".repeat(64),
        vision_id: "anima-v1-1003",
        r2_key_full: "portraits/full-zeroweight.webp",
        r2_key_medium: "portraits/medium-zeroweight.webp",
        r2_key_thumb: "portraits/thumb-zeroweight.webp",
      },
      {
        symbol: "OLDER",
        full_name: "Older Valid",
        color_hex: "#444444",
        weight_kg: 3,
        age_years: 12,
        image_upvotes: 1,
        image_downvotes: 0,
        image_score: 1,
        published_at: "2026-04-04 07:00:00",
        asset_created_at: "2026-04-04 07:00:00",
        asset_sha256: "d".repeat(64),
        vision_id: "anima-v1-1004",
        r2_key_full: "portraits/full-older.webp",
        r2_key_medium: "portraits/medium-older.webp",
        r2_key_thumb: "portraits/thumb-older.webp",
      },
    ]) : overrides.ICONOPLASM_DB
  const gatewayEnv = {
    ICONOPLASM_DB: gatewayDb,
    KV: null,
    ...overrides,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

function buildCtx() {
  return {
    waitUntil() {},
  }
}

test("youngest sort keeps zero-age genes off the top while leaving them in the results", async () => {
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=youngest&limit=10"),
    buildEnv(),
    buildCtx(),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.items[0]?.symbol, "LIGHTEST")
  assert.ok(payload.items.some((item) => item.symbol === "ZEROAGE"))
  assert.ok(
    payload.items.findIndex((item) => item.symbol === "ZEROAGE") >
      payload.items.findIndex((item) => item.symbol === "LIGHTEST"),
  )
})

test("lightest sort keeps zero-weight genes off the top while leaving them in the results", async () => {
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=lightest&limit=10"),
    buildEnv(),
    buildCtx(),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.items[0]?.symbol, "LIGHTEST")
  assert.ok(payload.items.some((item) => item.symbol === "ZEROWEIGHT"))
  assert.ok(
    payload.items.findIndex((item) => item.symbol === "ZEROWEIGHT") >
      payload.items.findIndex((item) => item.symbol === "LIGHTEST"),
  )
})

test("public gallery hot path uses THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE when bound", async () => {
  const gateway = new FakeOnlyAllowedGateway(async () =>
    Response.json({
      items: [{ symbol: "GATEWAY" }],
      order: "votes",
      limit: 10,
      offset: 0,
      total: 1,
      has_more: false,
    }),
  )

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes&limit=10"),
    buildEnv({
      ICONOPLASM_DB: null,
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: gateway,
    }),
    buildCtx(),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.items[0]?.symbol, "GATEWAY")
  assert.equal(gateway.calls.length, 1)
  assert.equal(gateway.calls[0]?.url, "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/public/v1/gallery?order=votes&limit=10")
  assert.equal(gateway.calls[0]?.method, "GET")
})
