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
      if (this.db.failPreviewHydration) {
        throw new Error("D1_ERROR: too many SQL variables at offset 1179: SQLITE_ERROR")
      }
      const requestedVisionIds = this.args
        .slice(0, Math.max(0, this.args.length - 1))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
      return {
        results: requestedVisionIds.flatMap((visionId, index) =>
          Array.from({ length: 6 }, function (_unused, previewIndex) {
            const suffix = String(index).padStart(2, "0") + String(previewIndex).padStart(2, "0")
            const sha = ("a".repeat(60) + suffix).slice(0, 64)
            return {
              vision_id: visionId,
              gene_symbol: previewIndex % 2 === 0 ? "INS" : "A1BG",
              asset_sha256: sha,
              r2_key_medium: `portraits/v1/${sha.slice(0, 2)}/${sha}/medium.webp`,
              r2_key_thumb: `portraits/v1/${sha.slice(0, 2)}/${sha}/thumb.webp`,
              is_current: previewIndex === 0 ? 1 : 0,
              preview_rank: previewIndex + 1,
            }
          }),
        ),
      }
    }

    if (this.sql.includes("FROM icono_admin_vision_rollup")) {
      this.db.visionRollupReads += 1
      if (this.db.manyVisionOptions) {
        return {
          results: Array.from({ length: 65 }, function (_unused, index) {
            return {
              vision_id: "anima-v1-" + String(3001 + index),
              artist_tag: "anima",
              artist_name: "Anima Archive",
              workflow_id: "A1-",
              prompt_version: String(93 + (index % 3)),
              variant_slot: String(19 + index),
              image_count: 10 - (index % 3),
              live_count: 5,
              score: 7 - (index % 2),
            }
          }),
        }
      }
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
  constructor(options = {}) {
    this.requestReads = 0
    this.visionRollupReads = 0
    this.previewReads = 0
    this.manyVisionOptions = !!options.manyVisionOptions
    this.failPreviewHydration = !!options.failPreviewHydration
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

function buildEnv({ bindGateway = true, dbOptions = {} } = {}) {
  const gatewayDb = new FakeRequestDb(dbOptions)
  const gatewayEnv = {
    ICONOPLASM_DB: gatewayDb,
    GAME_SESSIONS: null,
    ICONOPLASM_ADMIN_TOKEN: "test-admin-token",
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
  assert.equal(payload.request_options[0]?.preview_assets.length, 6)
  assert.equal(payload.request_options[0]?.preview_assets[0]?.gene_symbol, "INS")
  assert.match(
    String(payload.request_options[0]?.preview_assets[0]?.thumb_url || ""),
    /\/portraits\/v1\/aa\/a{60}0000\/thumb\.webp$/,
  )
  assert.equal(env.gatewayDb.visionRollupReads, 1)
  assert.equal(env.gatewayDb.previewReads, 1)
})

test("authenticated gene request state infers emulsion code from vision id when rollup row omits workflow fields", async () => {
  const env = buildEnv()
  env.gatewayDb.prepare = function (sql) {
    const statement = new FakeRequestStatement(this, sql)
    statement.all = async () => {
      if (String(sql).includes("WITH ranked_previews AS")) {
        return {
          results: [
            {
              vision_id: "anima-v1-3696",
              gene_symbol: "A1BG",
              asset_sha256: "b".repeat(64),
              r2_key_medium: `portraits/v1/bb/${"b".repeat(64)}/medium.webp`,
              r2_key_thumb: `portraits/v1/bb/${"b".repeat(64)}/thumb.webp`,
              is_current: 1,
              preview_rank: 1,
            },
          ],
        }
      }
      if (String(sql).includes("FROM icono_admin_vision_rollup")) {
        return {
          results: [
            {
              vision_id: "anima-v1-3696",
              artist_tag: "",
              artist_name: "",
              workflow_id: "",
              prompt_version: "",
              variant_slot: "",
              image_count: 8,
              live_count: 7,
              score: 5,
            },
          ],
        }
      }
      if (String(sql).includes("FROM icono_generation_requests gr")) {
        return {
          results: [],
        }
      }
      return { results: [] }
    }
    return statement
  }
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
  assert.equal(payload.request_options[0]?.label, "A1-3696")
})

test("authenticated gene request state chunks preview hydration instead of failing on long option lists", async () => {
  const env = buildEnv({ dbOptions: { manyVisionOptions: true } })
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
          ICONOPLASM_ADMIN_TOKEN: "test-admin-token",
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
  assert.equal(payload.request_options.length, 65)
  assert.equal(env.gatewayDb.previewReads, 3)
})

test("admin diagnostics returns request-option failure details instead of another opaque 500", async () => {
  const env = buildEnv({ dbOptions: { failPreviewHydration: true } })
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/requests/gene/A1BG/diagnostics", {
      headers: {
        "x-iconoplasm-admin-token": "test-admin-token",
      },
    }),
    {
      ICONOPLASM_DB: env.gatewayDb,
      GAME_SESSIONS: null,
      ICONOPLASM_ADMIN_TOKEN: "test-admin-token",
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.gene_symbol, "A1BG")
  assert.equal(payload.request_options.ok, false)
  assert.match(String(payload.request_options.error || ""), /too many SQL variables/i)
})

test("gene request summary stays cheap and skips vision-rollup reads", async () => {
  const env = buildEnv()
  const response = await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG/summary"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, false)
  assert.equal(env.gatewayDb.requestReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
  assert.equal(payload.gene_lane_summary[0]?.request_count, 1)
})

test("request options load through the dedicated options endpoint only for authenticated users", async () => {
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
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options", {
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
  assert.equal(env.gatewayDb.visionRollupReads, 1)
  assert.equal(env.gatewayDb.previewReads, 1)
})

