import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeRequestStatement {
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
    return null
  }

  async all() {
    if (this.sql.includes("WITH ranked_previews AS")) {
      this.db.previewReads += 1
      return {
        results: [
          {
            vision_id: "anima-v1-3001",
            gene_symbol: "INS",
            asset_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            r2_key_medium: "portraits/v1/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/medium.webp",
            r2_key_thumb: "portraits/v1/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/thumb.webp",
            is_current: 1,
            preview_rank: 1,
          },
        ],
      }
    }

    if (this.sql.includes("FROM icono_admin_vision_rollup")) {
      this.db.visionRollupReads += 1
      return {
        results: [
          {
            vision_id: "anima-v1-3001",
            artist_tag: "anima",
            artist_name: "Anima Archive",
            workflow_id: "A1-",
            prompt_version: "93",
            variant_slot: "19",
            image_count: 10,
            live_count: 5,
            score: 7,
          },
        ],
      }
    }

    if (this.sql.includes("FROM icono_generation_requests gr")) {
      this.db.requestReads += 1
      return {
        results: [
          {
            id: 1,
            gene_symbol: "A1BG",
            full_name: "alpha-1-B glycoprotein",
            requester_user_id: "user-1",
            requester_username: "tester",
            request_mode: "random",
            requested_vision_id: "",
            status: "open",
            created_at: "2026-04-04T10:00:00Z",
            updated_at: "2026-04-04T10:00:00Z",
            fulfilled_at: "",
            fulfilled_by: "",
            fulfilled_asset_sha256: "",
            fulfilled_vision_id: "",
            fulfillment_note: "",
          },
        ],
      }
    }

    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeRequestDb {
  constructor() {
    this.requestReads = 0
    this.visionRollupReads = 0
    this.previewReads = 0
  }

  prepare(sql) {
    return new FakeRequestStatement(this, sql)
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
  const gatewayDb = new FakeRequestDb()
  const gatewayEnv = {
    ICONOPLASM_DB: gatewayDb,
    GAME_SESSIONS: null,
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

function buildSessionBinding(session) {
  return {
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch() {
          return new Response(JSON.stringify(session), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        },
      }
    },
  }
}

test("anonymous gene request state skips the vision-options rollup", async () => {
  const env = buildEnv()
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, false)
  assert.deepEqual(payload.request_options, [])
  assert.equal(env.gatewayDb.requestReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(payload.gene_lane_summary[0]?.request_count, 1)
})

test("authenticated gene request state returns rich emulsion options with previews", async () => {
  const env = buildEnv()
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG", {
      headers: {
        Cookie: "session=abc123",
      },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, true)
  assert.equal(payload.request_options.length, 1)
  assert.equal(payload.request_options[0]?.label, "A1-93-19")
  assert.equal(payload.request_options[0]?.artist_tag, "anima")
  assert.equal(payload.request_options[0]?.preview_assets[0]?.gene_symbol, "INS")
  assert.match(
    String(payload.request_options[0]?.preview_assets[0]?.thumb_url || ""),
    /\/portraits\/v1\/aa\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/thumb\.webp$/,
  )
  assert.equal(env.gatewayDb.visionRollupReads, 1)
  assert.equal(env.gatewayDb.previewReads, 1)
})

