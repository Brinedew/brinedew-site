import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  iconoplasmAnimaEmulsionSlotFromExactAlias,
  iconoplasmAnimaEmulsionSlotIsPreallocated,
  iconoplasmPreallocatedAnimaEmulsionOption,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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
    if (
      this.sql.includes("FROM icono_generation_request_vision_option_rollup") &&
      this.sql.includes("emulsion_family_id = ?")
    ) {
      return String(this.args[0] || "") === "A1-93-19" ? { vision_id: "anima-v1-3001" } : null
    }
    if (
      this.sql.includes("COUNT(*) AS count") &&
      this.sql.includes("FROM icono_generation_requests gr")
    ) {
      return { count: this.requestRows().length }
    }
    return null
  }

  requestRows() {
    const rows = this.db.requestRows || [
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
    ]
    const statuses = this.args.filter((value) =>
      ["open", "delivery_pending", "fulfilled", "cancelled"].includes(value),
    )
    const statusFiltered = rows.filter((row) => !statuses.length || statuses.includes(row.status))
    if (!this.sql.includes("gr.requester_user_id = ?")) return statusFiltered
    const filterArgs = this.args.slice(statuses.length)
    if (this.sql.includes("LIMIT ?")) filterArgs.pop()
    if (this.sql.includes("gr.gene_symbol = ?")) filterArgs.shift()
    const requesterUserId = String(filterArgs.at(-1) || "")
    return statusFiltered.filter((row) => row.requester_user_id === requesterUserId)
  }

  async all() {
    if (this.sql.includes("FROM icono_user_emulsion_favorites")) {
      const userId = String(this.args[0] || "")
      return {
        results: Array.from(this.db.favoriteRows.values()).filter((row) => row.user_id === userId),
      }
    }
    if (
      this.sql.includes("FROM iconoplasm_user_emulsion_versions") &&
      this.sql.includes("revision > 0")
    ) {
      this.db.userEmulsionReads += 1
      this.db.lastUserEmulsionSql = this.sql
      const rows = [
        {
          user_id: "user-2",
          username: "loweren",
          emulsion_text: "cyan rim light, quiet archival scan texture",
          revision: 2,
          public_id: "LOWEREN-2",
          created_at: 1,
        },
      ]
      return { results: rows }
    }
    if (this.sql.includes("FROM icono_user_emulsion_option_rollup")) {
      this.db.userEmulsionPreviewReads += 1
      return {
        results: [
          {
            emulsion_id: "LOWEREN-2",
            image_count: 1,
            live_count: 1,
            preview_assets_json: JSON.stringify([
              {
                gene_symbol: "TTN",
                asset_sha256: "d".repeat(64),
                is_current: true,
                preview_rank: 1,
              },
            ]),
          },
        ],
      }
    }
    if (this.sql.includes("FROM icono_generation_request_factory_option_rollup")) {
      this.db.factoryOptionRollupReads += 1
      const rows = this.db.factoryOptionRows
      if (this.sql.includes("public_emulsion_code = ?")) {
        const publicId = String(this.args[0] || "").toUpperCase()
        return {
          results: rows.filter(
            (row) => String(row.public_emulsion_code || "").toUpperCase() === publicId,
          ),
        }
      }
      const slot = Number(this.args[0] || 0)
      return { results: rows.filter((row) => Number(row.emulsion_slot || 0) === slot) }
    }
    if (this.sql.includes("FROM icono_generation_request_vision_option_rollup")) {
      this.db.optionRollupReads += 1
      this.db.lastOptionRollupSql = this.sql
      this.db.lastOptionRollupArgs = this.args
      if (this.db.failOptionRollupRead) {
        throw new Error("D1_ERROR: request picker rollup missing or unreadable")
      }
      if (this.sql.includes("JOIN json_each(?) favorite")) {
        return { results: this.db.favoriteVisionRows }
      }
      if (this.db.queryVisionOptions && this.sql.includes("emulsion_id >= ?")) {
        const lower = String(this.args[0] || "")
        const upper = String(this.args[1] || "")
        const rows = [
          {
            vision_id: "anima-v1-2070",
            emulsion_id: "A1-2070",
            artist_tag: "anima",
            artist_name: "Anima Archive",
            workflow_id: "A1-",
            workflow_label: "Anima v1",
            prompt_version: "2",
            variant_slot: "070",
            image_count: 8,
            live_count: 6,
            score: 9,
            vote_h_index: 4,
            preview_assets_json: "[]",
          },
          {
            vision_id: "anima-v1-2375",
            emulsion_id: "A1-2375",
            artist_tag: "anima",
            artist_name: "Anima Archive",
            workflow_id: "A1-",
            workflow_label: "Anima v1",
            prompt_version: "2",
            variant_slot: "375",
            image_count: 7,
            live_count: 5,
            score: 8,
            vote_h_index: 3,
            preview_assets_json: "[]",
          },
          {
            vision_id: "anima-v1-3127",
            emulsion_id: "A1-3127",
            artist_tag: "anima",
            artist_name: "Anima Archive",
            workflow_id: "A1-",
            workflow_label: "Anima v1",
            prompt_version: "3",
            variant_slot: "127",
            image_count: 9,
            live_count: 7,
            score: 10,
            vote_h_index: 5,
            preview_assets_json: "[]",
          },
        ]
        return {
          results: rows.filter((row) => row.emulsion_id >= lower && row.emulsion_id < upper),
        }
      }
      if (this.sql.includes("AND emulsion_id = ?")) {
        const emulsionId = String(this.args[0] || "")
        return {
          results: this.db.legacySlotOptionRows.filter(
            (row) => String(row.emulsion_id || "") === emulsionId,
          ),
        }
      }
      if (this.db.manyVisionOptions) {
        return {
          results: Array.from({ length: 65 }, function (_unused, index) {
            const previewAssets = Array.from({ length: 6 }, function (__unused, previewIndex) {
              const suffix = String(index).padStart(2, "0") + String(previewIndex).padStart(2, "0")
              const sha = ("a".repeat(60) + suffix).slice(0, 64)
              return {
                gene_symbol: previewIndex % 2 === 0 ? "INS" : "A1BG",
                asset_sha256: sha,
                r2_key_medium: `portraits/v1/${sha.slice(0, 2)}/${sha}/medium.webp`,
                r2_key_thumb: `portraits/v1/${sha.slice(0, 2)}/${sha}/thumb.webp`,
                r2_key_full: "",
                is_current: previewIndex === 0,
                preview_rank: previewIndex + 1,
              }
            })
            return {
              vision_id: "anima-v1-" + String(3001 + index),
              emulsion_id: `A1-${3001 + index}`,
              artist_tag: "anima",
              artist_name: "Anima Archive",
              workflow_id: "A1-",
              prompt_version: String(93 + (index % 3)),
              variant_slot: String(19 + index),
              image_count: 10 - (index % 3),
              live_count: 5,
              score: 7 - (index % 2),
              vote_h_index: 5 - (index % 4),
              preview_assets_json: JSON.stringify(previewAssets),
            }
          }),
        }
      }
      return {
        results: [
          {
            vision_id: "anima-v1-3001",
            emulsion_id: "A1-93-19",
            artist_tag: "anima",
            artist_name: "Anima Archive",
            workflow_id: "A1-",
            prompt_version: "93",
            variant_slot: "19",
            image_count: 10,
            live_count: 5,
            score: 7,
            vote_h_index: 4,
            preview_assets_json: JSON.stringify(
              Array.from({ length: 6 }, function (_unused, previewIndex) {
                const sha = ("a".repeat(60) + String(previewIndex).padStart(4, "0")).slice(0, 64)
                return {
                  gene_symbol: previewIndex % 2 === 0 ? "INS" : "A1BG",
                  asset_sha256: sha,
                  r2_key_medium: `portraits/v1/${sha.slice(0, 2)}/${sha}/medium.webp`,
                  r2_key_thumb: `portraits/v1/${sha.slice(0, 2)}/${sha}/thumb.webp`,
                  r2_key_full: "",
                  is_current: previewIndex === 0,
                  preview_rank: previewIndex + 1,
                }
              }),
            ),
          },
        ],
      }
    }

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
              vote_h_index: 5 - (index % 4),
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
            vote_h_index: 4,
          },
        ],
      }
    }

    if (this.sql.includes("FROM icono_generation_requests gr")) {
      this.db.requestReads += 1
      return {
        results: this.requestRows(),
      }
    }

    return { results: [] }
  }

  async run() {
    if (this.sql.includes("INSERT OR IGNORE INTO icono_user_emulsion_favorites")) {
      const userId = String(this.args[0] || "")
      const emulsionId = String(this.args[1] || "")
      const key = `${userId}:${emulsionId}`
      if (!this.db.favoriteRows.has(key)) {
        this.db.favoriteRows.set(key, {
          user_id: userId,
          emulsion_family_id: emulsionId,
          created_at: "2026-07-20T10:00:00Z",
        })
      }
      return { success: true }
    }
    if (this.sql.includes("DELETE FROM icono_user_emulsion_favorites")) {
      this.db.favoriteRows.delete(`${this.args[0]}:${this.args[1]}`)
      return { success: true }
    }
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeRequestDb {
  constructor(options = {}) {
    this.requestReads = 0
    this.visionRollupReads = 0
    this.optionRollupReads = 0
    this.factoryOptionRollupReads = 0
    this.userEmulsionReads = 0
    this.userEmulsionPreviewReads = 0
    this.previewReads = 0
    this.manyVisionOptions = !!options.manyVisionOptions
    this.queryVisionOptions = !!options.queryVisionOptions
    this.failPreviewHydration = !!options.failPreviewHydration
    this.failOptionRollupRead = !!options.failOptionRollupRead
    this.lastOptionRollupArgs = []
    this.requestRows = Array.isArray(options.requestRows) ? options.requestRows : null
    this.favoriteRows = new Map()
    this.favoriteVisionRows = Array.isArray(options.favoriteVisionRows)
      ? options.favoriteVisionRows
      : []
    this.factoryOptionRows = Array.isArray(options.factoryOptionRows)
      ? options.factoryOptionRows
      : []
    this.legacySlotOptionRows = Array.isArray(options.legacySlotOptionRows)
      ? options.legacySlotOptionRows
      : []
  }

  prepare(sql) {
    return new FakeRequestStatement(this, sql)
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

function buildEnv({ bindGateway = true, dbOptions = {} } = {}) {
  const gatewayDb = new FakeRequestDb(dbOptions)
  const gatewayEnv = {
    DB: gatewayDb,
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

test("assigned Anima emulsion contract accepts exact aliases and rejects unassigned numbers", () => {
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("A1-50817"), 50817)
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("C2-50817"), 50817)
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("Z9-50817"), 0)
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("anima-v1-50817"), 50817)
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("A1-50817-e"), 50817)
  assert.equal(iconoplasmAnimaEmulsionSlotFromExactAlias("A1-50817 trailing"), 0)
  assert.equal(iconoplasmAnimaEmulsionSlotIsPreallocated(50817), true)
  assert.equal(iconoplasmAnimaEmulsionSlotIsPreallocated(5000), false)
  assert.equal(iconoplasmAnimaEmulsionSlotIsPreallocated(58250), true)
  assert.equal(iconoplasmAnimaEmulsionSlotIsPreallocated(58251), false)

  assert.deepEqual(iconoplasmPreallocatedAnimaEmulsionOption("A1-50817"), {
    vision_id: "anima-v1-50817",
    label: "50817",
    primary_label: "50817",
    secondary_label: "Ready for first blot",
    search_text: "0-50817 anima-v1-50817",
    emulsion_id: "0-50817",
    emulsion_family_id: "0-50817",
    image_count: 0,
    live_count: 0,
    score: 0,
    vote_h_index: 0,
    preview_assets: [],
    is_preallocated_without_preview: true,
  })
  assert.equal(iconoplasmPreallocatedAnimaEmulsionOption("A1-5000"), null)
})

test("public Anima allocation contract contains numeric facts but no private artist identities", () => {
  const contract = readFileSync(
    new URL("./generated/iconoplasm-anima-emulsion-slot-contract.js", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(contract, /@[a-z0-9_()]+/i)
  assert.doesNotMatch(contract, /pablo|suerte|uchida/i)
  assert.match(contract, /"callable_slot_intervals"/)
  assert.doesNotMatch(contract, /reserved_legacy/i)
  assert.match(contract, /"schema": "iconoplasm\.anima-emulsion-slot-contract\.v2"/)
})

test("admin request history keeps fulfilled rows and attaches their result image", async () => {
  const fulfilledSha = "a".repeat(64)
  const env = buildEnv({
    dbOptions: {
      requestRows: [
        {
          id: 41,
          gene_symbol: "NR3C2",
          full_name: "nuclear receptor subfamily 3 group C member 2",
          requester_user_id: "user-1",
          requester_username: "tester",
          request_kind: "new_candidate",
          request_mode: "specific",
          requested_vision_id: "anima-v1-19",
          status: "open",
          created_at: "2026-07-17 12:34:55",
        },
        {
          id: 39,
          gene_symbol: "NR3C2",
          full_name: "nuclear receptor subfamily 3 group C member 2",
          requester_user_id: "user-1",
          requester_username: "tester",
          request_kind: "new_candidate",
          request_mode: "specific",
          requested_vision_id: "anima-v1-18",
          status: "fulfilled",
          created_at: "2026-07-17 12:30:00",
          fulfilled_at: "2026-07-17 12:33:00",
          fulfilled_asset_sha256: fulfilledSha,
          fulfilled_asset_status: "approved",
          fulfilled_candidate_image_id: 59995,
          fulfilled_asset_vision_id: "anima-v1-18",
          fulfilled_asset_emulsion_id: "A1-18",
          fulfilled_asset_width: 882,
          fulfilled_asset_height: 1134,
        },
        {
          id: 1,
          gene_symbol: "A1BG",
          requester_user_id: "user-2",
          request_kind: "new_candidate",
          request_mode: "random",
          status: "cancelled",
          created_at: "2026-07-01 00:00:00",
        },
      ],
    },
  })
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/requests/history?limit=500",
        { headers: { "x-iconoplasm-admin-token": "test-admin-token" } },
      ),
      env,
      {},
    )
  const payload = await response.json()
  const fulfilled = payload.rows.find((row) => row.id === 39)

  assert.equal(response.status, 200)
  assert.equal(payload.rows.length, 3)
  assert.equal(payload.status_counts.open, 1)
  assert.equal(payload.status_counts.fulfilled, 1)
  assert.equal(payload.status_counts.cancelled, 1)
  assert.equal(payload.lane_summary.length, 1)
  assert.equal(fulfilled.fulfilled_asset.asset_sha256, fulfilledSha)
  assert.equal(fulfilled.fulfilled_asset.emulsion_id, "A1-18")
  assert.equal(fulfilled.fulfilled_asset.candidate_image_id, 59995)
  assert.match(fulfilled.fulfilled_asset.thumb_url, /^https:\/\/iconoplasm\.brinedew\.bio\//)
  assert.match(fulfilled.fulfilled_asset.thumb_url, new RegExp(fulfilledSha + "/thumb\\.webp$"))
  assert.match(fulfilled.fulfilled_asset.medium_url, new RegExp(fulfilledSha + "/medium\\.webp$"))
})

test("admin drain plan selects only the requester who can receive a DM during the live test", async () => {
  const brinedewId = "1289482311557058641"
  const rows = [
    {
      id: 20,
      gene_symbol: "DNMT3B",
      requester_user_id: "another-user",
      requester_username: "l_chart",
      request_mode: "specific",
      requested_vision_id: "anima-v1-1370",
      status: "open",
      created_at: "2026-07-17T01:00:00Z",
    },
    {
      id: 37,
      gene_symbol: "DNMT3B",
      requester_user_id: brinedewId,
      requester_username: "brinedew",
      request_mode: "specific",
      requested_vision_id: "anima-v1-1370",
      requested_emulsion_slot: 30593,
      request_origin: "user",
      status: "open",
      created_at: "2026-07-17T02:00:00Z",
    },
  ]
  const env = buildEnv({ bindGateway: false, dbOptions: { requestRows: rows } })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/requests/drain-plan", {
        headers: { "X-Iconoplasm-Admin-Token": "test-admin-token" },
      }),
      {
        ICONOPLASM_DB: env.gatewayDb,
        ICONOPLASM_ADMIN_TOKEN: "test-admin-token",
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.delivery_mode, "brinedew_test")
  assert.equal(payload.total_open_count, 2)
  assert.equal(payload.eligible_count, 1)
  assert.deepEqual(
    payload.rows.map((row) => row.id),
    [37],
  )
  assert.equal(payload.rows[0]?.requested_emulsion_slot, 30593)
  assert.equal(payload.rows[0]?.request_origin, "user")
})

test("generation requests purge unrelated-gene reference snapshots", () => {
  const worker = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0071_diagnostic_matrices.sql", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(worker, /requested_reference_asset_sha256/)
  assert.doesNotMatch(worker, /requested_reference_gene_symbol/)
  assert.match(migration, /DROP COLUMN requested_reference_asset_sha256/)
  assert.match(migration, /DROP COLUMN requested_reference_gene_symbol/)
  assert.match(migration, /requested_emulsion_slot INTEGER/)
})

test("legacy one-shot gene request route is gone and fails loudly", async () => {
  const env = buildEnv()
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG"),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 410)
  assert.equal(payload.code, "LEGACY_GENE_REQUEST_ROUTE_REMOVED")
  assert.match(String(payload.error || ""), /removed/i)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.optionRollupReads, 0)
  assert.equal(env.gatewayDb.requestReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})

test("anonymous gene request summary stays cheap and skips options rollups", async () => {
  const env = buildEnv()
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG/summary"),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, false)
  assert.equal(env.gatewayDb.requestReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.optionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
  assert.equal(payload.gene_lane_summary[0]?.request_count, 1)
})

test("authenticated request options return rich emulsion rows from the dedicated rollup", async () => {
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
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
  assert.equal(payload.request_options[0]?.artist_tag, "anima")
  assert.equal(payload.request_options[0]?.vote_h_index, 4)
  assert.equal(payload.request_options[0]?.preview_assets.length, 6)
  assert.equal(payload.request_options[0]?.preview_assets[0]?.gene_symbol, "INS")
  assert.match(
    String(payload.request_options[0]?.preview_assets[0]?.thumb_url || ""),
    /\/portraits\/v1\/aa\/a{60}0000\/thumb\.webp$/,
  )
  assert.equal(env.gatewayDb.optionRollupReads, 1)
  assert.match(
    String(env.gatewayDb.lastOptionRollupSql || ""),
    /ORDER BY vote_h_index DESC,\s*live_count DESC,\s*score DESC,\s*image_count DESC,\s*vision_id ASC/,
  )
  assert.match(String(env.gatewayDb.lastOptionRollupSql || ""), /builder_version = 3/)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})

test("request options include a favorite outside the normal ranked window and place it first", async () => {
  const favoriteVisionRow = {
    vision_id: "anima-v1-9999",
    emulsion_id: "0-9999",
    emulsion_family_id: "0-9999",
    artist_tag: "anima",
    artist_name: "Anima Archive",
    workflow_id: "A1-",
    workflow_label: "Anima v1",
    prompt_version: "9",
    variant_slot: "999",
    image_count: 1,
    live_count: 0,
    score: 0,
    vote_h_index: 0,
    preview_assets_json: "[]",
  }
  const env = buildEnv({ dbOptions: { favoriteVisionRows: [favoriteVisionRow] } })
  env.gatewayDb.favoriteRows.set("user-1:0-9999", {
    user_id: "user-1",
    emulsion_family_id: "0-9999",
    created_at: "2026-07-20T10:00:00Z",
  })
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options", {
        headers: { Cookie: "session=abc123" },
      }),
      env,
      {},
    )
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.favorite_count, 1)
  assert.equal(payload.request_options[0]?.emulsion_id, "0-9999")
  assert.equal(payload.request_options[0]?.is_favorite, true)
})

test("authenticated emulsion favorites are private and idempotent", async () => {
  const env = buildEnv()
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }
  const request = (path, method = "GET") =>
    handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        method,
        headers: { Cookie: "session=abc123" },
      }),
      env,
      {},
    )

  assert.equal((await request("/api/iconoplasm/emulsion-favorites/A1-93-19-e", "PUT")).status, 200)
  assert.equal((await request("/api/iconoplasm/emulsion-favorites/A1-93-19", "PUT")).status, 200)
  var listResponse = await request("/api/iconoplasm/emulsion-favorites")
  var listPayload = await listResponse.json()
  assert.equal(listResponse.status, 200)
  assert.deepEqual(listPayload.favorite_emulsion_ids, ["A1-93-19"])
  assert.equal(listResponse.headers.get("Cache-Control"), "no-store")

  assert.equal((await request("/api/iconoplasm/emulsion-favorites/A1-93-19", "DELETE")).status, 200)
  assert.equal((await request("/api/iconoplasm/emulsion-favorites/A1-93-19", "DELETE")).status, 200)
  listResponse = await request("/api/iconoplasm/emulsion-favorites")
  listPayload = await listResponse.json()
  assert.equal(listPayload.count, 0)
})

test("emulsion favorites reject anonymous reads and unknown additions", async () => {
  const anonymousEnv = buildEnv()
  const anonymousResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/emulsion-favorites"),
      anonymousEnv,
      {},
    )
  assert.equal(anonymousResponse.status, 401)

  const env = buildEnv()
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }
  const missingResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/emulsion-favorites/DOES-NOT-EXIST",
        { method: "PUT", headers: { Cookie: "session=abc123" } },
      ),
      env,
      {},
    )
  assert.equal(missingResponse.status, 404)
})

test("request-option v2 migration repairs previews from canonical SHA identity", () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0051_request_option_rollup_v2.sql", import.meta.url),
    "utf8",
  )

  assert.match(
    migration,
    /ADD COLUMN builder_version INTEGER NOT NULL DEFAULT 0/,
    "the picker projection must declare which builder semantics produced each row",
  )
  assert.match(
    migration,
    /FROM icono_portrait_assets pa[\s\S]*LEFT JOIN icono_publish_state ps/,
    "the repair must derive from portrait and publish truth instead of copying the stale picker/admin projection",
  )
  assert.match(migration, /COALESCE\(pa\.asset_sha256, ''\) <> ''/)
  assert.doesNotMatch(
    migration,
    /COALESCE\(pa\.r2_key_medium, pa\.r2_key_thumb, pa\.r2_key_full, ''\) <> ''/,
    "healthy SHA-addressed portraits must not disappear because copied legacy R2-key columns drifted",
  )
  assert.match(migration, /preview_rank <= 5/)
  assert.match(migration, /builder_version = excluded\.builder_version/)
  assert.match(migration, /NOT EXISTS \(\s*SELECT 1\s*FROM icono_portrait_assets pa/)
})

test("factory request options are projected only from authoritative public lineage", () => {
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0075_factory_request_option_rollup.sql", import.meta.url),
    "utf8",
  )

  assert.match(migration, /icono_generation_request_factory_option_rollup/)
  assert.match(migration, /public_emulsion_code TEXT PRIMARY KEY/)
  assert.match(migration, /PARTITION BY public_emulsion_code/)
  assert.match(migration, /idx_icono_generation_request_factory_option_slot/)
  assert.doesNotMatch(
    migration,
    /COALESCE\([^\n]*public_emulsion_code[^\n]*emulsion_id/i,
    "legacy emulsion IDs must never be promoted into exact factory lineage",
  )
})

test("authenticated request options include shared user emulsions with preview thumbnails", async () => {
  const env = buildEnv()
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options?query=lower", {
        headers: {
          Cookie: "session=abc123",
        },
      }),
      env,
      {},
    )
  const payload = await response.json()
  const userOption = payload.request_options.find(
    (option) => option.option_type === "user_emulsion",
  )

  assert.equal(response.status, 200)
  assert.ok(userOption)
  assert.equal(userOption.emulsion_id, "LOWEREN-2")
  assert.equal(userOption.label, "Saved emulsion")
  assert.notEqual(userOption.label, userOption.emulsion_id)
  assert.equal(userOption.owner_username, "loweren")
  assert.equal(userOption.preview_assets.length, 1)
  assert.match(
    String(userOption.preview_assets[0].thumb_url || ""),
    /\/portraits\/v1\/dd\/d{64}\/thumb\.webp$/,
  )
  assert.equal(env.gatewayDb.userEmulsionReads, 1)
  assert.equal(env.gatewayDb.userEmulsionPreviewReads, 1)
})

test("a fully qualified factory code resolves to one pipeline-neutral emulsion", async () => {
  const env = buildEnv({ dbOptions: { queryVisionOptions: true } })
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

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options?query=A1-2", {
        headers: {
          Cookie: "session=abc123",
        },
      }),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload.request_options.map((option) => option.label),
    ["2"],
  )
  assert.equal(env.gatewayDb.factoryOptionRollupReads, 1)
  assert.equal(env.gatewayDb.optionRollupReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})

test("a preallocated emulsion search returns one pipeline-neutral first-blot option", async () => {
  const env = buildEnv({ dbOptions: { queryVisionOptions: true } })
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options?query=50817", {
        headers: { Cookie: "session=abc123" },
      }),
      env,
      {},
    )
  const payload = await response.json()
  const option = payload.request_options[0]

  assert.equal(response.status, 200)
  assert.equal(payload.request_options.length, 1)
  assert.equal(option?.vision_id, "anima-v1-50817")
  assert.equal(option?.label, "50817")
  assert.equal(option?.secondary_label, "Ready for first blot")
  assert.equal(option?.is_preallocated_without_preview, true)
  assert.deepEqual(option?.preview_assets, [])
})

test("a slot collapses every factory line into one image-backed emulsion", async () => {
  const preview = (geneSymbol, character) => ({
    gene_symbol: geneSymbol,
    asset_sha256: character.repeat(64),
    is_current: true,
    preview_rank: 1,
  })
  const legacyPreviews = [
    preview("CHST10", "a"),
    preview("VAPA", "b"),
    preview("GLMP", "c"),
    preview("CRNKL1", "d"),
  ]
  const exactPreviews = [preview("AFF2", "e"), preview("VAMP7", "f")]
  const env = buildEnv({
    dbOptions: {
      factoryOptionRows: [
        {
          public_emulsion_code: "C9-1003",
          emulsion_slot: 1003,
          image_count: 2,
          live_count: 2,
          score: 4,
          vote_h_index: 1,
          preview_assets_json: JSON.stringify(exactPreviews),
        },
      ],
      legacySlotOptionRows: [
        {
          vision_id: "anima-v1-1003",
          emulsion_id: "0-1003",
          artist_tag: "anima",
          artist_name: "Anima Archive",
          workflow_id: "A1-",
          workflow_label: "Anima v1",
          prompt_version: "1",
          variant_slot: "1003",
          image_count: 4,
          live_count: 2,
          score: 2,
          vote_h_index: 1,
          preview_assets_json: JSON.stringify(legacyPreviews),
        },
      ],
    },
  })
  env.GAME_SESSIONS = buildSessionBinding({ user_id: "user-1", username: "tester" })
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        {
          DB: env.gatewayDb,
          ICONOPLASM_DB: env.gatewayDb,
          GAME_SESSIONS: env.GAME_SESSIONS,
        },
        { waitUntil() {} },
      )
    },
  }
  const load = async (query) => {
    const response =
      await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options?query=${encodeURIComponent(query)}`,
          { headers: { Cookie: "session=abc123" } },
        ),
        env,
        {},
      )
    assert.equal(response.status, 200)
    return response.json()
  }

  const bare = await load("1003")
  assert.equal(bare.request_options.length, 1)
  assert.equal(bare.request_options[0]?.label, "1003")
  assert.equal(bare.request_options[0]?.preview_assets.length, 4)
  assert.equal(bare.request_options[0]?.image_count, 6)

  const unprovenExact = await load("A1-1003")
  assert.deepEqual(
    unprovenExact.request_options.map((option) => option.label),
    ["1003"],
  )
  assert.equal(unprovenExact.request_options[0]?.preview_assets.length, 4)

  const provenExact = await load("C9-1003")
  assert.deepEqual(
    provenExact.request_options.map((option) => option.label),
    ["1003"],
  )
  assert.equal(provenExact.request_options[0]?.preview_assets.length, 4)
  assert.equal(provenExact.request_options[0]?.is_preallocated_without_preview, undefined)
})

test("another fully qualified factory code also resolves to one neutral emulsion", async () => {
  const env = buildEnv({ dbOptions: { queryVisionOptions: true } })
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

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/options?query=A1-3", {
        headers: {
          Cookie: "session=abc123",
        },
      }),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload.request_options.map((option) => option.label),
    ["3"],
  )
  assert.equal(env.gatewayDb.factoryOptionRollupReads, 1)
  assert.equal(env.gatewayDb.optionRollupReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})

test("authenticated request options infer emulsion code from vision id when rollup row omits workflow fields", async () => {
  const env = buildEnv()
  env.gatewayDb.prepare = function (sql) {
    const statement = new FakeRequestStatement(this, sql)
    statement.all = async () => {
      if (String(sql).includes("FROM icono_generation_request_vision_option_rollup")) {
        return {
          results: [
            {
              vision_id: "anima-v1-3696",
              emulsion_id: "",
              artist_tag: "",
              artist_name: "",
              workflow_id: "",
              prompt_version: "",
              variant_slot: "",
              image_count: 8,
              live_count: 7,
              score: 5,
              vote_h_index: 3,
              preview_assets_json: JSON.stringify([
                {
                  gene_symbol: "A1BG",
                  asset_sha256: "b".repeat(64),
                  r2_key_medium: `portraits/v1/bb/${"b".repeat(64)}/medium.webp`,
                  r2_key_thumb: `portraits/v1/bb/${"b".repeat(64)}/thumb.webp`,
                  r2_key_full: "",
                  is_current: true,
                  preview_rank: 1,
                },
              ]),
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

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
  assert.equal(payload.request_options[0]?.label, "3696")
})

test("user emulsion request examples are rebuilt from portrait assets instead of narrow increments", () => {
  const worker = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const migration = readFileSync(
    new URL("../migrations-iconoplasm/0040_user_emulsion_rollup_source_index.sql", import.meta.url),
    "utf8",
  )

  assert.match(migration, /idx_icono_portrait_assets_emulsion_status_created/)
  assert.match(migration, /Source of truth: icono_portrait_assets\.emulsion_id/)
  assert.match(migration, /Do not make the picker API scan icono_portrait_assets on demand/)
  assert.match(migration, /DELETE FROM icono_user_emulsion_option_rollup/)
  assert.match(migration, /INSERT INTO icono_user_emulsion_option_rollup/)
  assert.match(migration, /FROM icono_portrait_assets pa/)
  assert.match(migration, /PARTITION BY emulsion_id/)
  assert.match(worker, /icono_user_emulsion_option_rollup is only a cheap request-picker/)
  assert.match(worker, /never let the authenticated picker compute examples by scanning/)
  assert.match(worker, /heaviest symbols are dozens of rows/)
  assert.match(worker, /function rebuildUserEmulsionOptionRollupsBatch\(env, emulsionIds = \[\]\)/)
  assert.match(worker, /function rebuildUserEmulsionOptionRollupsForSymbols\(env, symbols = \[\]\)/)
  assert.match(worker, /JOIN incoming i\s+ON i\.emulsion_id = pa\.emulsion_id/)
  assert.match(worker, /rebuildUserEmulsionOptionRollupsBatch\(env, \[publishedEmulsionId\]\)/)
  assert.match(worker, /rebuildUserEmulsionOptionRollupsForSymbols\(env, \[symbol\]\)/)
  assert.doesNotMatch(worker, /icono_user_emulsion_option_rollup\.image_count \+ 1/)
})

test("authenticated request options stay cheap even on long option lists", async () => {
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
  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
  assert.equal(payload.request_options.length, 65)
  assert.equal(env.gatewayDb.optionRollupReads, 1)
  assert.equal(env.gatewayDb.requestReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})

test("admin diagnostics returns request-option failure details instead of another opaque 500", async () => {
  const env = buildEnv({ dbOptions: { failOptionRollupRead: true } })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/requests/gene/A1BG/diagnostics",
        {
          headers: {
            "x-iconoplasm-admin-token": "test-admin-token",
          },
        },
      ),
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
  assert.match(String(payload.request_options.error || ""), /rollup missing or unreadable/i)
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

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
  assert.equal(env.gatewayDb.optionRollupReads, 1)
  assert.equal(env.gatewayDb.visionRollupReads, 0)
  assert.equal(env.gatewayDb.previewReads, 0)
})
