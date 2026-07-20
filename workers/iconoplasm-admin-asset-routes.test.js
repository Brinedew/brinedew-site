import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminAssetHandlers } from "./iconoplasm-admin-asset-routes.js"

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function assetServices(overrides = {}) {
  return {
    adminPortraitUrl: (base, sha, size) => `${base}/${sha}-${size}.webp`,
    buildSummaryScope: () => ({
      public_scope: {
        catalog_candidate_assets: 1,
        catalog_auditable_assets: 1,
        catalog_published_live_portraits: 1,
      },
      ledger_scope: { candidate_assets: 1 },
    }),
    fetchAssetStateRows: async () => [],
    fetchRepairScope: async () => ({ rows: [], scanned_assets: 0, summary: {} }),
    fetchStorageAudit: async () => ({ rows: [], summary: {} }),
    fetchSummaryCounts: async () => ({}),
    isAdmin: async () => true,
    json,
    normalizeMaintenanceLimit: (value, fallback, max) =>
      Math.min(max, Math.max(1, Number(value || fallback))),
    normalizeMaintenanceSymbols: (symbols, max) => {
      const normalized = Array.from(
        new Set(
          (Array.isArray(symbols) ? symbols : [])
            .map((value) =>
              String(value || "")
                .trim()
                .toUpperCase(),
            )
            .filter(Boolean),
        ),
      )
      if (normalized.length > max) throw new Error("Too many symbols")
      return normalized
    },
    normalizeArtistTag: (value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    normalizeAssetStatus: (value, fallback) =>
      String(value || fallback)
        .trim()
        .toLowerCase(),
    normalizeSha256: (value) => (/^[a-f0-9]{64}$/i.test(String(value || "")) ? String(value) : ""),
    normalizeSymbol: (value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    optionalInt: (value) => (value == null ? null : Number.parseInt(String(value), 10)),
    portraitBase: () => "https://iconoplasm.brinedew.bio/portraits",
    readPublicStatsProjection: async () => ({}),
    sanitizeText: (value, limit) => String(value || "").slice(0, limit),
    stateSymbolMax: 25_000,
    ...overrides,
  }
}

async function responseFrom(
  handler,
  { body = {}, env = { ICONOPLASM_DB: {} }, method = "POST", path = "/internal-test" } = {},
) {
  return handler({
    request: new Request(`https://iconoplasm.brinedew.bio${path}`, {
      method,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    env,
    done: async (_route, response) => response,
  })
}

test("asset handler factory rejects incomplete composition roots", () => {
  const services = assetServices()
  delete services.fetchAssetStateRows
  assert.throws(
    () => createIconoplasmAdminAssetHandlers(services),
    /service is missing: fetchAssetStateRows/,
  )
})

test("asset handler registry is immutable and domain-complete", () => {
  const handlers = createIconoplasmAdminAssetHandlers(assetServices())
  assert.equal(Object.isFrozen(handlers), true)
  assert.deepEqual(Object.keys(handlers).sort(), [
    "admin_assets.list",
    "admin_assets.repair_scope",
    "admin_assets.state",
    "admin_assets.storage_audit",
    "admin_assets.summary",
  ])
})

test("asset list implements HEAD and keeps filters inside the bounded query", async () => {
  const statements = []
  const sha = "a".repeat(64)
  const handlers = createIconoplasmAdminAssetHandlers(assetServices())
  const response = await responseFrom(handlers["admin_assets.list"], {
    method: "HEAD",
    path: "/api/iconoplasm/admin/assets?symbol=tp53&status=live&stale=no&legacy=no&limit=5",
    env: {
      ICONOPLASM_DB: {
        prepare(sql) {
          return {
            bind(...args) {
              statements.push({ sql, args })
              return {
                async all() {
                  return { results: [{ gene_symbol: "TP53", asset_sha256: sha }] }
                },
              }
            },
          }
        },
      },
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(statements[0].args, ["TP53", "live", 5])
  assert.match(statements[0].sql, /COALESCE\(pa\.is_stale, 0\) = 0/)
  assert.match(statements[0].sql, /COALESCE\(pa\.is_legacy, 0\) = 0/)
})

test("asset summary implements HEAD without turning it into a refresh", async () => {
  const refreshValues = []
  const handlers = createIconoplasmAdminAssetHandlers(
    assetServices({
      fetchSummaryCounts: async (_env, { refresh }) => {
        refreshValues.push(refresh)
        return { candidate_assets: 1 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_assets.summary"], {
    method: "HEAD",
    path: "/api/iconoplasm/admin/assets/summary",
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(refreshValues, [false])
})

test("unscoped asset-state HEAD returns the declared bounded-scope response", async () => {
  let stateReads = 0
  const handlers = createIconoplasmAdminAssetHandlers(
    assetServices({
      fetchAssetStateRows: async () => {
        stateReads += 1
        return []
      },
    }),
  )
  const response = await responseFrom(handlers["admin_assets.state"], {
    method: "HEAD",
    path: "/api/iconoplasm/admin/assets/state",
  })
  const payload = await response.json()

  assert.equal(response.status, 400)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(payload.code, "ICONOPLASM_ASSET_STATE_SCOPE_REQUIRED")
  assert.equal(stateReads, 0)
})

test("scoped asset state normalizes rows and drops invalid asset identities", async () => {
  const requested = []
  const sha = "b".repeat(64)
  const handlers = createIconoplasmAdminAssetHandlers(
    assetServices({
      fetchAssetStateRows: async (_env, symbols) => {
        requested.push(symbols)
        return [
          {
            gene_symbol: " tp53 ",
            asset_sha256: sha,
            candidate_image_id: "7",
            artist_tag: "  Human Artist ",
            status: "LIVE",
            is_stale: 1,
            image_upvotes: "4",
          },
          { gene_symbol: "", asset_sha256: sha },
        ]
      },
    }),
  )
  const response = await responseFrom(handlers["admin_assets.state"], {
    body: { symbols: ["TP53"] },
    path: "/api/iconoplasm/admin/assets/state",
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(requested, [["TP53"]])
  assert.equal(payload.count, 1)
  assert.deepEqual(
    {
      symbol: payload.assets[0].symbol,
      sha: payload.assets[0].asset_sha256,
      candidate: payload.assets[0].candidate_image_id,
      artist: payload.assets[0].artist_tag,
      status: payload.assets[0].status,
      stale: payload.assets[0].is_stale,
      upvotes: payload.assets[0].image_upvotes,
    },
    {
      symbol: "TP53",
      sha,
      candidate: 7,
      artist: "human artist",
      status: "live",
      stale: true,
      upvotes: 4,
    },
  )
})
