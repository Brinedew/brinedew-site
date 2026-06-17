import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    if (
      this.sql.includes("FROM icono_portrait_assets") &&
      this.sql.includes("COALESCE(is_legacy, 0) AS is_legacy")
    ) {
      return {
        results: this.db.existingAssets,
      }
    }
    if (
      this.sql.includes("FROM icono_publish_state") &&
      this.sql.includes("current_asset_sha256")
    ) {
      return { results: [] }
    }
    if (
      this.sql.includes("SELECT DISTINCT pa.emulsion_id") &&
      this.sql.includes("FROM icono_portrait_assets pa")
    ) {
      return {
        results: this.db.distinctEmulsionIdsForIncomingSymbols(this.args[0]),
      }
    }
    throw new Error(`Unexpected SQL in fake DB all(): ${this.sql}`)
  }

  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    return null
  }

  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    return { success: true }
  }
}

class FakeIconoplasmDb {
  constructor({ existingAssets } = {}) {
    this.calls = []
    this.existingAssets = Array.isArray(existingAssets) ? existingAssets : []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  distinctEmulsionIdsForIncomingSymbols(rawSymbols) {
    let symbols = []
    try {
      symbols = JSON.parse(String(rawSymbols || "[]"))
    } catch {
      symbols = []
    }
    const wanted = new Set(symbols.map((symbol) => String(symbol || "").toUpperCase()))
    return Array.from(
      new Set(
        this.existingAssets
          .filter((asset) => wanted.has(String(asset.gene_symbol || "").toUpperCase()))
          .map((asset) => String(asset.emulsion_id || "").trim())
          .filter(Boolean),
      ),
    ).map((emulsionId) => ({ emulsion_id: emulsionId }))
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE) {
    env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          ctx,
        )
      },
    }
  }
  return env
}

function buildEnv({ existingAssets } = {}, { bindGateway = true } = {}) {
  const gatewayDb = new FakeIconoplasmDb({ existingAssets })
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test("admin reconcile restores rejected legacy assets instead of leaving them hidden", async () => {
  const env = buildEnv({
    existingAssets: [
      {
        gene_symbol: "TP53",
        asset_sha256: "b".repeat(64),
        status: "rejected",
        is_stale: 0,
        is_legacy: 0,
      },
    ],
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defer_read_models: true,
          scope_symbols: ["TP53"],
          keep: [],
          legacy: [{ symbol: "TP53", asset_sha256: "b".repeat(64) }],
        }),
      }),
      env,
      {},
    )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.legacy_marked, 1)
  assert.equal(payload?.rejected, undefined) // reject path removed entirely

  const legacyUpdate = env.gatewayDb.calls.find(
    (call) =>
      call.method === "run" &&
      call.sql.includes(
        "SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END",
      ) &&
      call.sql.includes("is_stale=1, is_legacy=1"),
  )

  assert.ok(legacyUpdate)
  assert.deepEqual(legacyUpdate.args, ["TP53", "b".repeat(64)])
})

test("admin reconcile restores rejected keep-assets so sync repairs become publicly visible", async () => {
  const env = buildEnv({
    existingAssets: [
      {
        gene_symbol: "TP53",
        asset_sha256: "c".repeat(64),
        status: "rejected",
        is_stale: 0,
        is_legacy: 0,
      },
    ],
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defer_read_models: true,
          scope_symbols: ["TP53"],
          keep: [{ symbol: "TP53", asset_sha256: "c".repeat(64) }],
          legacy: [],
        }),
      }),
      env,
      {},
    )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.restored_keep, 1)
  assert.equal(payload?.rejected, undefined) // reject path removed entirely

  const keepRestoreUpdate = env.gatewayDb.calls.find(
    (call) =>
      call.method === "run" &&
      call.sql.includes(
        "SET status=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 'draft' ELSE status END",
      ) &&
      call.sql.includes(
        "autopick_eligible=CASE WHEN lower(COALESCE(status, ''))='rejected' THEN 1",
      ) &&
      call.sql.includes("is_stale=0, is_legacy=0"),
  )

  assert.ok(keepRestoreUpdate)
  assert.deepEqual(keepRestoreUpdate.args, ["TP53", "c".repeat(64)])
})

test("admin reconcile NEVER rejects: an asset absent from keep is left untouched", async () => {
  // Regression for the 2026-06-04 mass-deletion: an under-inclusive keep set must
  // never wipe candidates. Absence is not a delete signal — deletions only flow
  // through the explicit removal channel. This asset is absent from keep/legacy
  // and must be left untouched (counted as kept_absent), with zero reject writes.
  // There is no longer any flag that re-enables the destructive path.
  const env = buildEnv({
    existingAssets: [
      {
        gene_symbol: "TP53",
        asset_sha256: "d".repeat(64),
        status: "draft",
        is_stale: 0,
        is_legacy: 0,
      },
    ],
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defer_read_models: true,
          scope_symbols: ["TP53"],
          keep: [],
          legacy: [],
        }),
      }),
      env,
      {},
    )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.kept_absent, 1)
  // The destructive path is gone entirely — no flag, no reject counter.
  assert.equal(payload?.rejected, undefined)
  assert.equal(payload?.reject_absent_from_keep, undefined)

  const rejectWrite = env.gatewayDb.calls.find(
    (call) => call.method === "run" && call.sql.includes("SET status='rejected'"),
  )
  assert.equal(rejectWrite, undefined)
})

test("admin reconcile has no flag that re-enables destructive keep-set rejection", async () => {
  // Even if a caller passes the old escape-hatch flag, it must be inert: the
  // destructive path was removed, not gated. Absence stays a no-op.
  const env = buildEnv({
    existingAssets: [
      {
        gene_symbol: "TP53",
        asset_sha256: "e".repeat(64),
        status: "draft",
        is_stale: 0,
        is_legacy: 0,
      },
    ],
  })

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/reconcile", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defer_read_models: true,
          scope_symbols: ["TP53"],
          keep: [],
          legacy: [],
          reject_absent_from_keep: true,
          confirm_mass_reject: true,
        }),
      }),
      env,
      {},
    )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.kept_absent, 1)

  const rejectWrite = env.gatewayDb.calls.find(
    (call) => call.method === "run" && call.sql.includes("SET status='rejected'"),
  )
  assert.equal(rejectWrite, undefined)
})
