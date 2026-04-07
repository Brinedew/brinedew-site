import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmDbGatewayRequest,
  handleIconoplasmRequest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm.js"

class FakeVotesStatement {
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
    if (this.sql.includes("FROM icono_admin_gene_rollup gr")) {
      this.db.rollupReads += 1
      throw new Error("vote gallery should stay on the snapshot path")
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("JOIN icono_portrait_assets pa")
    ) {
      this.db.snapshotReads += 1
      return {
        results: this.db.rows.map((row) => ({
          symbol: row.symbol,
          published_at: row.published_at,
          asset_created_at: row.asset_created_at,
          weight_kg: row.weight_kg,
          age_years: row.age_years,
          asset_sha256: row.asset_sha256,
          candidate_image_id: row.candidate_image_id,
          vision_id: row.vision_id,
          r2_key_full: row.r2_key_full,
          r2_key_medium: row.r2_key_medium,
          r2_key_thumb: row.r2_key_thumb,
          width: row.width,
          height: row.height,
          image_upvotes: row.image_upvotes,
          image_downvotes: row.image_downvotes,
          image_score: row.image_score,
        })),
      }
    }

    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeVotesDb {
  constructor(rows) {
    this.rows = rows
    this.rollupReads = 0
    this.snapshotReads = 0
  }

  prepare(sql) {
    return new FakeVotesStatement(this, sql)
  }
}

class FakeKv {
  constructor(hash, artifact) {
    this.hash = hash
    this.artifact = artifact
  }

  async get(key) {
    if (key === "iconoplasm:catalog-manifest") {
      return JSON.stringify({ current_hash: this.hash, gene_count: this.artifact.genes.length })
    }
    if (key === `iconoplasm:catalog:${this.hash}`) {
      return JSON.stringify(this.artifact)
    }
    return null
  }
}

function bindOnlyAllowedGateway(env, gatewayEnv = env, ctx = { waitUntil() {} }) {
  if (!env.THE_ONLY_ALLOWED_DB_GATEWAY) {
    env.THE_ONLY_ALLOWED_DB_GATEWAY = {
      fetch(request) {
        return handleIconoplasmDbGatewayRequest(request, gatewayEnv, ctx)
      },
    }
  }
  return env
}

function buildEnv({ bindGateway = true } = {}) {
  const hash = "votescache01"
  const gatewayDb = new FakeVotesDb([
      {
        symbol: "TP53",
        published_at: "2026-04-04T10:00:00Z",
        asset_created_at: "2026-04-04T10:00:00Z",
        weight_kg: 9,
        age_years: 12,
        asset_sha256: "a".repeat(64),
        candidate_image_id: 11,
        vision_id: "anima-v1-2001",
        r2_key_full: "portraits/full-tp53.webp",
        r2_key_medium: "portraits/medium-tp53.webp",
        r2_key_thumb: "portraits/thumb-tp53.webp",
        width: 384,
        height: 512,
        image_upvotes: 15,
        image_downvotes: 2,
        image_score: 13,
      },
      {
        symbol: "A1BG",
        published_at: "2026-04-04T09:00:00Z",
        asset_created_at: "2026-04-04T09:00:00Z",
        weight_kg: 4,
        age_years: 6,
        asset_sha256: "b".repeat(64),
        candidate_image_id: 12,
        vision_id: "anima-v1-2002",
        r2_key_full: "portraits/full-a1bg.webp",
        r2_key_medium: "portraits/medium-a1bg.webp",
        r2_key_thumb: "portraits/thumb-a1bg.webp",
        width: 384,
        height: 512,
        image_upvotes: 4,
        image_downvotes: 0,
        image_score: 4,
      },
    ])
  const gatewayEnv = {
    ICONOPLASM_DB: gatewayDb,
    KV: new FakeKv(hash, {
      genes: [
        { s: "A1BG", n: "alpha-1-B glycoprotein", c: "#dd8c9d" },
        { s: "TP53", n: "tumor protein p53", c: "#5a7fff" },
      ],
    }),
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb,
  }
  return bindGateway ? bindOnlyAllowedGateway(env, gatewayEnv) : env
}

test("vote-sorted gallery uses the cached snapshot instead of live rollup reads", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv()
  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes&limit=10"),
    env,
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload.items.map((item) => item.symbol),
    ["TP53", "A1BG"],
  )
  assert.equal(env.gatewayDb.rollupReads, 0)
  assert.ok(env.gatewayDb.snapshotReads >= 1)
})
