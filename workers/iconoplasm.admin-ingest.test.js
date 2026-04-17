import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeStatement {
  constructor(sql) {
    this.sql = String(sql || "")
    this.boundValues = []
  }

  bind(...values) {
    this.boundValues = values
    return this
  }

  async all() {
    if (this.sql.includes("FROM icono_portrait_assets")) {
      return {
        results: [
          {
            symbol: "ABCA1",
            asset_sha256: "bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6",
            r2_key_full:
              "portraits/v1/bc/bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6/full.webp",
            r2_key_medium:
              "portraits/v1/bc/bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6/medium.webp",
            r2_key_thumb:
              "portraits/v1/bc/bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6/thumb.webp",
          },
        ],
      }
    }
    throw new Error(`Unexpected SQL in fake DB all(): ${this.sql}`)
  }

  async first() {
    return null
  }

  async run() {
    if (this.sql.includes("INSERT INTO icono_portrait_assets")) {
      return { success: true, meta: { changes: 1 } }
    }
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  prepare(sql) {
    return new FakeStatement(sql)
  }
}

class FakePortraitBucket {
  async head() {
    return { etag: "already-present" }
  }

  async put() {
    throw new Error("Dry-run ingest should not upload portrait bytes")
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
    ICONOPLASM_PORTRAITS: new FakePortraitBucket(),
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test("admin ingest dry-run accepts a normal sync payload without crashing", async () => {
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: true,
      defer_read_models: true,
      items: [
        {
          symbol: "ABCA1",
          asset_sha256: "bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6",
          vision_id: "anima-v1-42",
          workflow_path: "d:/Coding/Datasets/iconoplasm/data/comfyui/workflows/anima-preview.api.json",
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, buildEnv(), {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.equal(payload?.failed, 0)
  assert.equal(payload?.results?.[0]?.ok, true)
  assert.equal(payload?.results?.[0]?.symbol, "ABCA1")
  assert.equal(payload?.results?.[0]?.emulsion_id, "A1-42")
  assert.equal(payload?.results?.[0]?.blacklisted, false)
  assert.equal(payload?.results?.[0]?.blacklist_reason, null)
})

test("admin ingest non-dry-run writes a portrait asset row without SQL column mismatch", async () => {
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: false,
      defer_read_models: true,
      items: [
        {
          symbol: "ABCA1",
          asset_sha256: "bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6",
          vision_id: "anima-v1-42",
          workflow_path: "d:/Coding/Datasets/iconoplasm/data/comfyui/workflows/anima-preview.api.json",
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, buildEnv(), {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.equal(payload?.failed, 0)
  assert.equal(payload?.results?.[0]?.ok, true)
  assert.equal(payload?.results?.[0]?.symbol, "ABCA1")
})

test("admin ingest success returns current mutation-limiter telemetry for sync forecasting", async () => {
  const budgetNamespace = {
    idFromName(name) {
      return String(name || "")
    },
    get() {
      return {
        fetch: async () =>
          new Response(
            JSON.stringify({
              day_key: "2026-04-16",
              cycle_key: "2026-04",
              days_remaining_in_cycle: 12,
              rows_written: 24,
              rows_written_daily_smart_limit: 100,
              rows_written_daily_remaining: 76,
              rows_written_monthly_limit: 1000,
              rows_written_monthly_remaining: 976,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
      }
    },
  }
  const gatewayDb = new FakeIconoplasmDb()
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
    ICONOPLASM_PORTRAITS: new FakePortraitBucket(),
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "1000",
    ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
    ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "3",
  }
  const env = bindOnlyAllowedGateway(
    {
      ...gatewayEnv,
      ICONOPLASM_DB: null,
      gatewayDb,
    },
    gatewayEnv,
  )
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: true,
      defer_read_models: true,
      items: [
        {
          symbol: "ABCA1",
          asset_sha256: "bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6",
          vision_id: "anima-v1-42",
          workflow_path: "d:/Coding/Datasets/iconoplasm/data/comfyui/workflows/anima-preview.api.json",
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(request, env, {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.mutation_limiter?.target_daily_percent, 90)
  assert.equal(payload?.mutation_limiter?.target_rows_written_ceiling, 90)
  assert.equal(payload?.mutation_limiter?.rows_written_target_remaining, 66)
  assert.equal(payload?.mutation_limiter?.budget_snapshot?.rows_written, 24)
})

