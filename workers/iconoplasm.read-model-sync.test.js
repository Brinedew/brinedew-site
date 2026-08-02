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
      this.sql.includes("FROM icono_admin_vision_rollup") &&
      this.args.some((value) => String(value).includes("anima-v1-18"))
    ) {
      return {
        results: [
          {
            vision_id: "anima-v1-18",
            emulsion_id: "A1-18",
            workflow_id: "A1-",
            workflow_label: "Anima v1",
            prompt_version: "1",
            variant_slot: "18",
            artist_tag: "anima",
            artist_name: "Anima",
            image_count: 2,
            live_count: 2,
            score: 0,
          },
        ],
      }
    }
    if (this.sql.includes("ranked_previews AS") && this.args[0]?.includes("anima-v1-18")) {
      return {
        results: [
          {
            vision_id: "anima-v1-18",
            gene_symbol: "CD4",
            asset_sha256: "66".repeat(32),
            is_current: 1,
            preview_rank: 1,
          },
        ],
      }
    }
    if (
      this.sql.includes("COALESCE(vs.upvotes, 0) AS upvotes") &&
      this.args[0]?.includes("anima-v1-18")
    ) {
      return { results: [{ vision_id: "anima-v1-18", upvotes: 0 }] }
    }
    if (this.sql.includes("FROM icono_gene_catalog")) {
      return {
        results: [
          {
            gene_symbol: "TP53",
            full_name: "tumor protein p53",
            uniprot: "",
            color_hex: "#423D37",
            tmh: 0,
            aliases_json: "[]",
          },
        ],
      }
    }
    return { results: [] }
  }

  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("FROM icono_gene_catalog")) {
      return {
        gene_symbol: "TP53",
        full_name: "tumor protein p53",
        uniprot: "",
        color_hex: "#423D37",
        tmh: 0,
        aliases_json: "[]",
      }
    }
    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      return {
        asset_sha256: "7b".repeat(32),
        width: 768,
        height: 1024,
        vision_id: "artist-random-v1",
        candidate_image_id: 1,
        emulsion_id: "A1-TP53",
      }
    }
    if (this.sql.includes("FROM icono_gene_essence")) {
      return {
        full_name: "tumor protein p53",
        sex: "male",
        age_years: 53,
        faction: "guardian",
        skin_hex: "#423D37",
        skin_name: "Mocha Black",
        tissue_tau: 0.2,
        loeuf: 0.5,
        aesthetics_json: "[]",
        aesthetics_origin_json: "[]",
        politics_origin_json: "[]",
        family_surname: "TP53",
        family_members: 1,
        family_feature: "",
        manifestation: "",
      }
    }
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

function buildEnv({ bindGateway = true } = {}) {
  const gatewayDb = new FakeIconoplasmDb()
  const baselineVersion = "test-version"
  const baselineShardKey = "iconoplasm:card-catalog-shard:test-baseline"
  const baselineStore = new Map([
    ["iconoplasm:gallery-version", baselineVersion],
    [
      `iconoplasm:card-catalog:${baselineVersion}`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        build_revision: 2,
        artifact_version: baselineVersion,
        snapshot_version: baselineVersion,
        artifact_validated_at: "2026-04-16T00:00:00.000Z",
        content_hash: baselineVersion,
        source: "published_card_catalog",
        storage: "kv_card_catalog_content_addressed_shards",
        shard_size: 750,
        shard_count: 1,
        catalog_gene_count: 1,
        card_count: 1,
        shards: [
          {
            key: baselineShardKey,
            index: 0,
            card_count: 1,
            content_hash: "test-baseline",
            first_symbol: "TP53",
            last_symbol: "TP53",
          },
        ],
      }),
    ],
  ])
  const gatewayEnv = {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: gatewayDb,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    KV: {
      store: baselineStore,
      async get(key) {
        return this.store.get(key) || null
      },
      async put(key, value) {
        this.store.set(key, value)
      },
    },
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test("admin read-model sync with publish_gallery_dirty_shards still honors skip flags", async () => {
  const env = buildEnv()

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
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
          publish_gallery_dirty_shards: true,
        }),
      }),
      env,
      {},
    )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.card_catalog?.artifact_gene_count, 1)
  assert.equal(payload?.card_catalog?.catalog_gene_count, 1)
  assert.equal(payload?.card_catalog?.source, "published_card_catalog")

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

test("batched vision sync atomically refreshes the request-picker projection", async () => {
  const env = buildEnv()

  const response =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/read-models/sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vision_ids: ["anima-v1-18"],
          skip_vote_summaries: true,
          skip_gene_rollups: true,
          skip_dashboard: true,
          publish_gallery_dirty_shards: false,
        }),
      }),
      env,
      {},
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.visions, 1)

  const pickerDelete = env.gatewayDb.calls.find(
    (call) =>
      call.method === "run" &&
      call.sql.includes("DELETE FROM icono_generation_request_vision_option_rollup"),
  )
  const pickerWrite = env.gatewayDb.calls.find(
    (call) =>
      call.method === "run" &&
      call.sql.includes("INSERT INTO icono_generation_request_vision_option_rollup"),
  )

  assert.ok(pickerDelete, "the dependent picker row must be invalidated in the same sync")
  assert.ok(pickerWrite, "the dependent picker row must be rebuilt before sync succeeds")
  assert.equal(pickerWrite.args[0], "anima-v1-18")
  assert.equal(pickerWrite.args[2], "A1-18")
  assert.equal(pickerWrite.args[9], 2)
  assert.equal(pickerWrite.args[10], 2)
  assert.deepEqual(JSON.parse(pickerWrite.args[13]), [
    {
      vision_id: "anima-v1-18",
      gene_symbol: "CD4",
      asset_sha256: "66".repeat(32),
      is_current: true,
      preview_rank: 1,
    },
  ])
  assert.equal(pickerWrite.args[14], 3)
})

test("admin overview summary is scoped to canonical catalog rows", async () => {
  const env = buildEnv()

  // The sync-complete proof depends on this behavior. Non-catalog asset/rollup
  // rows can exist for admin/debug reasons, but they must not inflate the
  // canonical public summary. This regression test protects the specific
  // incident where the GUI showed 70 no-live genes even though the canonical
  // catalog had 19,023 live portraits.
  const syncResponse =
    await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/read-models/sync", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbols: [],
          skip_vote_summaries: true,
          skip_gene_rollups: true,
          skip_vision_rollups: true,
          publish_gallery_dirty_shards: false,
        }),
      }),
      env,
      {},
    )
  assert.equal(syncResponse.status, 200)

  const dashboardSummarySql = env.gatewayDb.calls.find(
    (call) =>
      call.method === "first" &&
      call.sql.includes("COUNT(gc.gene_symbol) AS genes") &&
      call.sql.includes("AS no_live"),
  )?.sql

  assert.match(
    dashboardSummarySql || "",
    /FROM icono_gene_catalog gc\s+LEFT JOIN icono_admin_gene_rollup gr\s+ON gr\.gene_symbol = gc\.gene_symbol/,
  )

  const countCacheSql = env.gatewayDb.calls
    .filter((call) => call.method === "run" && call.sql.includes("icono_admin_gallery_count_cache"))
    .map((call) => call.sql)
  // D1 rejected the old one-shot UNION ALL count-cache insert in production.
  // Keeping these as separate INSERT statements is intentional budget hygiene,
  // not verbose test machinery.
  assert.equal(
    countCacheSql.some((sql) => sql.includes("UNION ALL")),
    false,
  )
  assert.equal(countCacheSql.filter((sql) => sql.includes("INSERT INTO")).length, 10)

  await handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/overview?event_limit=0", {
      headers: {
        Authorization: "Bearer secret-admin-token",
      },
    }),
    env,
    {},
  )

  const attentionSql = env.gatewayDb.calls.find(
    (call) =>
      call.method === "all" &&
      call.sql.includes("current_asset_missing") &&
      call.sql.includes("LIMIT 12"),
  )?.sql

  assert.match(
    attentionSql || "",
    /FROM icono_gene_catalog gc\s+JOIN icono_admin_gene_rollup gr\s+ON gr\.gene_symbol = gc\.gene_symbol/,
  )
})
