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
    return { results: [] }
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
  constructor() {
    this.calls = []
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
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

function buildEnv({ bindGateway = true } = {}) {
  const gatewayDb = new FakeIconoplasmDb()
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

test("admin read-model sync with invalidate_gallery still honors skip flags", async () => {
  const env = buildEnv()

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/read-models/sync", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-admin-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        symbols: ["TP53"],
        skip_vote_summaries: true,
        skip_gene_rollups: true,
        skip_vision_rollups: true,
        skip_dashboard: true,
        invalidate_gallery: true,
      }),
    }),
    env,
    {},
  )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)

  // This regression matters because the workstation uses skip flags to split a
  // 1,000-item Website sync into smaller durable phases. If the invalidate-
  // gallery wrapper drops those flags, the worker quietly does the expensive
  // vote summary / gene rollup work anyway and can tip the sync into a 500.
  const writeSql = env.gatewayDb.calls
    .filter((call) => call.method === "run")
    .map((call) => call.sql)
    .join("\n")

  assert.equal(writeSql.includes("icono_vote_asset_summary"), false)
  assert.equal(writeSql.includes("icono_admin_gene_rollup"), false)
})
