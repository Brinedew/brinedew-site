import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  invalidateIconoplasmGalleryCacheForTest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const SYMBOLS = ["GENA", "GENB", "GENC", "GEND", "GENE"]

function geneRow(symbol, sha = "7b".repeat(32)) {
  return {
    gene_symbol: symbol,
    catalog_full_name: `full name ${symbol}`,
    color_hex: "#423D37",
    tmh: 1,
    essence_full_name: `full name ${symbol}`,
    full_name: `full name ${symbol}`,
    weight_kg: 137.9,
    molecular_weight_kda: 137.9,
    age_years: 35,
    first_publication_year: 1985,
    faction: "pro-growth",
    skin_hex: "#423D37",
    skin_name: "Mocha Black",
    tissue_tau: 0.26,
    primary_tissue: "ubiquitous",
    loeuf: 0.518,
    sex: "male",
    aesthetics_json: JSON.stringify(["Pirate"]),
    aesthetics_origin_json: JSON.stringify(["Protein Kinase"]),
    politics_origin_json: JSON.stringify(["oncogene"]),
    family_surname: "FAM",
    family_members: 3,
    asset_sha256: sha,
    width: 768,
    height: 1024,
    vision_id: "artist-random-v1",
    candidate_image_id: 5423,
    emulsion_id: "A1-5423",
  }
}

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
  async first() {
    if (this.sql.includes("MAX(created_at)") && this.sql.includes("FROM icono_publish_events")) {
      return { max_created_at: "2026-06-05 12:00:00" }
    }
    return null
  }
  async all() {
    if (
      this.sql.includes("SELECT DISTINCT gene_symbol") &&
      this.sql.includes("FROM icono_publish_events")
    ) {
      const limit = Number(this.args[this.args.length - 1] || 1)
      return {
        results: this.db.changedSymbols.slice(0, limit).map((gene_symbol) => ({ gene_symbol })),
      }
    }
    if (
      this.sql.includes("FROM icono_gene_catalog") &&
      this.sql.includes("WHERE gene_symbol > ?") &&
      !this.sql.includes("LEFT JOIN")
    ) {
      const cursor = String(this.args[0] || "").toUpperCase()
      const limit = Number(this.args[1] || 1)
      const rows = SYMBOLS.filter((s) => s > cursor)
        .sort()
        .slice(0, limit)
        .map((gene_symbol) => ({ gene_symbol }))
      return { results: rows }
    }
    if (
      this.sql.includes("FROM icono_gene_catalog gc") &&
      this.sql.includes("LEFT JOIN icono_gene_essence ge")
    ) {
      const scoped = this.sql.includes("WHERE gc.gene_symbol IN")
      let symbols = SYMBOLS.slice().sort()
      if (scoped) {
        const requested = new Set(this.args.map((a) => String(a || "").toUpperCase()))
        symbols = symbols.filter((s) => requested.has(s))
      }
      return { results: symbols.map((s) => geneRow(s, this.db.shaOverride.get(s))) }
    }
    return { results: [] }
  }
  async run() {
    return { success: true }
  }
}

class FakeDb {
  constructor() {
    this.changedSymbols = SYMBOLS.slice()
    this.shaOverride = new Map()
  }
  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function buildEnv(db, kvStore, putKeys) {
  resetIconoplasmRuntimeCachesForTest()
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_PORTRAIT_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    // Small shards (2 genes) + 1 shard/chunk so 5 genes drain across 3 chunks.
    ICONOPLASM_CARD_CATALOG_SHARD_SIZE: "2",
    ICONOPLASM_CARD_CATALOG_REBUILD_CHUNK_SIZE: "2",
    KV: {
      async get(key) {
        if (key === "iconoplasm:gallery-version") return kvStore.get(key) || "old-seed"
        return kvStore.has(key) ? kvStore.get(key) : null
      },
      async put(key, value) {
        if (putKeys) putKeys.push(key)
        kvStore.set(key, value)
      },
      async delete(key) {
        kvStore.delete(key)
      },
    },
  }
}

const WATERMARK_KEY = "iconoplasm:card-catalog-publish-watermark:v1"
const CURSOR_KEY = "iconoplasm:card-catalog-rebuild-cursor:v1"
const SHARD_PREFIX = "iconoplasm:card-catalog-shard:"

// Drive a cold staging rebuild to completion. The cold path (no baseline manifest)
// IS the multi-chunk rebuild; loop until the final chunk flips + finalizes.
async function drainCold(env) {
  let result
  do {
    result = await invalidateIconoplasmGalleryCacheForTest(env)
  } while (result.card_catalog.bootstrap_more)
  return result
}

test("staging rebuild drains a cold catalog across chunks, flips/watermarks only at the end", async () => {
  const db = new FakeDb()
  const kvStore = new Map()
  const env = buildEnv(db, kvStore, null)

  // Cold (no manifest) -> staging rebuild. 5 genes / shard size 2 = 3 shards = 3 chunks.
  const c1 = await invalidateIconoplasmGalleryCacheForTest(env)
  assert.equal(c1.card_catalog.rebuild, true)
  assert.equal(c1.card_catalog.bootstrap_more, true)
  assert.ok(kvStore.has(CURSOR_KEY))
  assert.ok(!kvStore.has(WATERMARK_KEY)) // no freshness claim mid-rebuild
  assert.ok(!kvStore.has("iconoplasm:gallery-version")) // not flipped yet

  const c2 = await invalidateIconoplasmGalleryCacheForTest(env)
  assert.equal(c2.card_catalog.bootstrap_more, true)
  assert.ok(!kvStore.has(WATERMARK_KEY))

  // Chunk 3 -> finalize: flip + watermark + content-addressed manifest.
  const c3 = await invalidateIconoplasmGalleryCacheForTest(env)
  assert.equal(c3.card_catalog.rebuild_complete, true)
  assert.equal(c3.card_catalog.bootstrap_more, false)
  assert.match(c3.version, /^ccv1-[a-f0-9]{32}$/)
  assert.ok(!kvStore.has(CURSOR_KEY))
  assert.ok(kvStore.has(WATERMARK_KEY))
  const watermark = JSON.parse(kvStore.get(WATERMARK_KEY))
  assert.equal(watermark.watermark_event_at, "2026-06-05 12:00:00")

  const manifest = JSON.parse(kvStore.get(`iconoplasm:card-catalog:${c3.version}`))
  assert.equal(manifest.storage, "kv_card_catalog_content_addressed_shards")
  assert.equal(manifest.shard_count, 3)
  assert.equal(manifest.catalog_gene_count, 5)
  for (const shard of manifest.shards) {
    assert.ok(String(shard.key).startsWith(SHARD_PREFIX))
    assert.ok(shard.content_hash)
  }
})

test("re-running a completed rebuild with no changes writes zero new shards", async () => {
  const db = new FakeDb()
  const kvStore = new Map()
  const env = buildEnv(db, kvStore, null)

  const last = await drainCold(env)
  assert.equal(last.card_catalog.rebuild_complete, true)

  // Now no changes remain -> reuse, zero shard writes.
  db.changedSymbols = []
  const putKeys = []
  const env2 = buildEnv(db, kvStore, putKeys)
  env2.KV.get = async (key) => (kvStore.has(key) ? kvStore.get(key) : null)
  const reuse = await invalidateIconoplasmGalleryCacheForTest(env2)
  assert.equal(reuse.card_catalog.reused_existing, true)
  assert.equal(reuse.version, last.version)
  assert.equal(
    putKeys.filter((k) => k.startsWith(SHARD_PREFIX)).length,
    0,
    "no content-addressed shard writes on a no-op republish",
  )
})

test("public mobile-card read path resolves cards from a content-addressed artifact", async () => {
  const db = new FakeDb()
  const kvStore = new Map()
  const env = buildEnv(db, kvStore, null)

  await drainCold(env)
  // Live version now points at the content-addressed artifact.
  resetIconoplasmRuntimeCachesForTest()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["GENA", "GEND"] }),
      }),
      env,
      { waitUntil() {} },
    )
  assert.equal(response.status, 200)
  const payload = await response.json()
  const returned = (payload.cards || []).map((c) => c.symbol).sort()
  assert.deepEqual(returned, ["GENA", "GEND"])
  assert.equal(payload.data_source, "published_card_catalog")
})

test("shard-level incremental rebuilds only the affected shard and flips immediately", async () => {
  const db = new FakeDb()
  const kvStore = new Map()
  const env = buildEnv(db, kvStore, null)

  const last = await drainCold(env)
  const contentAddressedVersion = last.version

  // One concentrated change: GENB's canonical asset changes (GENB lives in shard 0
  // with GENA, since shard size is 2). This is a single-shard delta.
  const newSha = "ab".repeat(32)
  db.changedSymbols = ["GENB"]
  db.shaOverride.set("GENB", newSha)
  const putKeys = []
  const env2 = buildEnv(db, kvStore, putKeys)
  env2.KV.get = async (key) => (kvStore.has(key) ? kvStore.get(key) : null)

  const inc = await invalidateIconoplasmGalleryCacheForTest(env2)
  assert.equal(inc.card_catalog.shard_level, true)
  assert.equal(inc.card_catalog.affected_shards, 1)
  assert.equal(inc.card_catalog.reused_existing, false)
  assert.notEqual(inc.version, contentAddressedVersion) // flipped immediately
  // Exactly one new content-addressed shard was written (the affected one).
  assert.equal(putKeys.filter((k) => k.startsWith(SHARD_PREFIX)).length, 1)

  // The public read path now serves GENB's new canonical asset.
  kvStore.set("iconoplasm:gallery-version", JSON.stringify({ current: inc.version }))
  resetIconoplasmRuntimeCachesForTest()
  const env3 = buildEnv(db, kvStore, null)
  env3.KV.get = async (key) => (kvStore.has(key) ? kvStore.get(key) : null)
  const resp =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["GENB"] }),
      }),
      env3,
      { waitUntil() {} },
    )
  const body = await resp.json()
  const genb = (body.cards || []).find((c) => c.symbol === "GENB")
  assert.ok(genb)
  assert.equal(genb.portrait.asset_sha256, newSha)
})
