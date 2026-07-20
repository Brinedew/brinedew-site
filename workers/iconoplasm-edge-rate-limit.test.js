import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import toml from "toml"

import {
  enforceIconoplasmRateLimitAtPublicEdge,
  resolveIconoplasmEdgeRateLimitPolicy,
} from "./iconoplasm-edge-rate-limit.js"
import worker from "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js"

function request(path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set("CF-Connecting-IP", "203.0.113.42")
  return new Request(`https://iconoplasm.brinedew.bio${path}`, { ...init, headers })
}

test("route policy is method-aware and leaves private and unrelated traffic alone", () => {
  assert.deepEqual(
    {
      id: resolveIconoplasmEdgeRateLimitPolicy(request("/api/public/v1/metadata"))?.id,
      binding: resolveIconoplasmEdgeRateLimitPolicy(request("/api/public/v1/metadata"))?.binding,
    },
    { id: "metadata", binding: "ICONOPLASM_RATE_LIMIT_60" },
  )
  assert.equal(
    resolveIconoplasmEdgeRateLimitPolicy(
      request("/api/iconoplasm/artist-blacklist-submissions", { method: "POST" }),
    )?.binding,
    "ICONOPLASM_RATE_LIMIT_5",
  )
  assert.equal(
    resolveIconoplasmEdgeRateLimitPolicy(request("/api/public/v1/genes/batch", { method: "GET" })),
    null,
  )
  assert.equal(resolveIconoplasmEdgeRateLimitPolicy(request("/api/iconoplasm/admin/me")), null)
  assert.equal(
    resolveIconoplasmEdgeRateLimitPolicy(
      new Request("https://brinedew.bio/api/public/v1/metadata"),
    ),
    null,
  )
})

test("the registry owns every intentionally quota-limited public route class", () => {
  const cases = [
    ["GET", "/api/public/v1/metadata", "metadata", 60],
    ["GET", "/api/public/v1/stats", "stats", 60],
    ["GET", "/api/public/v1/schema", "schema", 60],
    ["GET", "/api/public/v1/catalog/manifest", "catalog_manifest", 60],
    ["GET", "/api/public/v1/catalog/catalog.deadbeef.json", "catalog_artifact", 120],
    ["GET", "/api/public/v1/dumps/catalog.deadbeef.jsonl", "catalog_dump", 60],
    ["GET", "/api/public/v1/gallery", "gallery", 60],
    ["GET", "/api/public/v1/genes/search?q=TP53", "gene_search", 120],
    ["POST", "/api/public/v1/genes/batch", "gene_batch", 60],
    ["POST", "/api/public/v1/resolve", "resolve", 60],
    ["GET", "/api/public/v1/changes", "changes", 60],
    ["GET", "/api/public/v1/media/TP53", "media", 120],
    ["GET", "/api/iconoplasm/site/genes/TP53", "site_gene", 120],
    ["POST", "/api/iconoplasm/artist-blacklist-submissions", "artist_blocklist_submission", 5],
  ]

  for (const [method, path, id, limit] of cases) {
    const policy = resolveIconoplasmEdgeRateLimitPolicy(request(path, { method }))
    assert.deepEqual(
      { id: policy?.id, limit: policy?.limit, period: policy?.period },
      { id, limit, period: 60 },
      `${method} ${path}`,
    )
  }
})

test("allowed public requests consume a native binding and receive truthful policy headers", async () => {
  const keys = []
  let upstreamCalls = 0
  const response = await worker.fetch(
    request("/api/public/v1/gallery?order=votes"),
    {
      ICONOPLASM_RATE_LIMIT_60: {
        async limit({ key }) {
          keys.push(key)
          return { success: true }
        },
      },
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
        async fetch() {
          upstreamCalls += 1
          return Response.json({ ok: true })
        },
      },
    },
    {},
  )

  assert.equal(response.status, 200)
  assert.equal(upstreamCalls, 1)
  assert.equal(keys.length, 1)
  assert.match(keys[0], /^[a-f0-9]{64}$/)
  assert.equal(keys[0].includes("203.0.113.42"), false)
  assert.equal(response.headers.get("RateLimit-Policy"), '"gallery";q=60;w=60')
  assert.equal(response.headers.get("X-RateLimit-Limit"), "60")
  assert.equal(response.headers.get("X-RateLimit-Period"), "60")
  assert.equal(response.headers.has("RateLimit"), false)
  assert.equal(response.headers.has("X-RateLimit-Remaining"), false)
})

test("a denied request returns 429 without touching the stateful Worker", async () => {
  let upstreamCalls = 0
  const response = await worker.fetch(
    request("/api/public/v1/media/TP53"),
    {
      ICONOPLASM_RATE_LIMIT_120: {
        async limit() {
          return { success: false }
        },
      },
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
        async fetch() {
          upstreamCalls += 1
          return Response.json({ ok: true })
        },
      },
    },
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 429)
  assert.equal(upstreamCalls, 0)
  assert.equal(payload.code, "ICONOPLASM_RATE_LIMIT_EXCEEDED")
  assert.equal(response.headers.get("Retry-After"), "60")
  assert.equal(response.headers.get("RateLimit"), '"media";r=0;t=60')
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*")
})

test("a missing or failed native binding fails closed", async () => {
  const missing = await enforceIconoplasmRateLimitAtPublicEdge(request("/api/public/v1/stats"), {})
  assert.equal(missing.response?.status, 503)
  assert.equal((await missing.response.json()).code, "ICONOPLASM_RATE_LIMIT_UNAVAILABLE")

  const failed = await enforceIconoplasmRateLimitAtPublicEdge(
    request("/api/public/v1/genes/search?q=TP53"),
    {
      ICONOPLASM_RATE_LIMIT_120: {
        async limit() {
          throw new Error("binding unavailable")
        },
      },
    },
  )
  assert.equal(failed.response?.status, 503)
})

test("production and staging declare isolated native quota bindings", () => {
  const config = toml.parse(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"))
  const production = config.ratelimits
  const staging = config.env.staging.ratelimits

  assert.deepEqual(
    production.map(({ name, simple }) => [name, simple.limit, simple.period]),
    [
      ["ICONOPLASM_RATE_LIMIT_5", 5, 60],
      ["ICONOPLASM_RATE_LIMIT_60", 60, 60],
      ["ICONOPLASM_RATE_LIMIT_120", 120, 60],
    ],
  )
  assert.deepEqual(
    staging.map(({ name, simple }) => [name, simple.limit, simple.period]),
    [
      ["ICONOPLASM_RATE_LIMIT_5", 5, 60],
      ["ICONOPLASM_RATE_LIMIT_60", 60, 60],
      ["ICONOPLASM_RATE_LIMIT_120", 120, 60],
    ],
  )
  const namespaceIds = [...production, ...staging].map(({ namespace_id }) => namespace_id)
  assert.equal(new Set(namespaceIds).size, namespaceIds.length)
})
