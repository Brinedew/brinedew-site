import assert from "node:assert/strict"
import test from "node:test"

import { listIconoplasmGeneBlotBacklog } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const WATERMARK_KEY = "iconoplasm:card-catalog-publish-watermark:v1"

function geneRow(symbol, sha) {
  return {
    gene_symbol: symbol,
    catalog_full_name: `full name ${symbol}`,
    essence_full_name: `full name ${symbol}`,
    full_name: `full name ${symbol}`,
    color_hex: "#423D37",
    skin_hex: "#423D37",
    skin_name: "Mocha Black",
    weight_kg: 70,
    molecular_weight_kda: 70,
    age_years: 30,
    first_publication_year: 1990,
    tissue_tau: 0.5,
    primary_tissue: "ubiquitous",
    loeuf: 0.5,
    sex: "female",
    aesthetics_json: "[]",
    aesthetics_origin_json: "[]",
    politics_origin_json: "[]",
    family_surname: "FAM",
    family_members: 1,
    asset_sha256: sha,
    width: 768,
    height: 1024,
    vision_id: "artist-random-v1",
    candidate_image_id: 1,
    emulsion_id: "A1-1",
    gene_blot_fingerprint: null,
    gene_blot_portrait_asset_sha256: null,
    gene_blot_asset_sha256: null,
    gene_blot_object_key: null,
    gene_blot_width: null,
    gene_blot_height: null,
  }
}

class Statement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql)
    this.args = []
  }
  bind(...args) {
    this.args = args
    return this
  }
  async first() {
    if (this.sql.includes("ORDER BY id DESC") && this.sql.includes("icono_publish_events")) {
      return { id: 12, created_at: "2026-08-24 12:00:00" }
    }
    return null
  }
  async all() {
    if (this.sql.includes("SELECT DISTINCT gene_symbol")) {
      this.db.priorityActionArgs = this.args.slice(0, -1)
      return { results: [{ gene_symbol: "TP53" }, { gene_symbol: "WNT7B" }] }
    }
    if (this.sql.includes("FROM icono_gene_catalog gc")) {
      return {
        results: [geneRow("TP53", "a".repeat(64)), geneRow("WNT7B", "b".repeat(64))],
      }
    }
    return { results: [] }
  }
}

test("automatic candidate backlog prioritizes canonical decisions and remains bounded", async () => {
  const db = {
    priorityActionArgs: [],
    prepare(sql) {
      return new Statement(this, sql)
    },
  }
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    KV: {
      async get(key) {
        if (key !== WATERMARK_KEY) return null
        return JSON.stringify({
          watermark_event_id: 10,
          watermark_event_at: "2026-08-24 11:00:00",
        })
      },
    },
  }
  const request = new Request(
    "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/blots/backlog",
    {
      method: "POST",
    },
  )

  const result = await listIconoplasmGeneBlotBacklog(env, {
    request,
    payload: { scope: "candidate", limit: 1 },
  })

  assert.equal(result.automatic, true)
  assert.deepEqual(result.symbols, ["TP53", "WNT7B"])
  assert.equal(result.pending_item_count, 2)
  assert.equal(result.items.length, 1)
  assert.equal(result.render_queue_complete, false)
  assert.equal(result.through_event_id, 12)
  assert.equal(db.priorityActionArgs.includes("vote_auto_promote"), true)
  assert.equal(db.priorityActionArgs.includes("gene_blot_materialized"), false)
  assert.equal(db.priorityActionArgs.includes("gene_card_materialized"), false)
})

test("empty automatic priority backlog returns before the unscoped catalog loader", async () => {
  let catalogReads = 0
  const db = {
    prepare(sql) {
      const statement = new Statement(this, sql)
      const originalAll = statement.all.bind(statement)
      statement.all = async () => {
        if (statement.sql.includes("SELECT DISTINCT gene_symbol")) return { results: [] }
        if (statement.sql.includes("FROM icono_gene_catalog gc")) catalogReads += 1
        return originalAll()
      }
      return statement
    },
  }
  const env = {
    ICONOPLASM_DB: db,
    KV: {
      async get(key) {
        return key === WATERMARK_KEY
          ? JSON.stringify({ watermark_event_id: 10, watermark_event_at: "2026-08-24 11:00:00" })
          : null
      },
    },
  }

  const result = await listIconoplasmGeneBlotBacklog(env, {
    request: new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/blots/backlog", {
      method: "POST",
    }),
    payload: { scope: "candidate", limit: 25 },
  })

  assert.equal(result.scanned, 0)
  assert.deepEqual(result.symbols, [])
  assert.equal(catalogReads, 0)
})
