import assert from "node:assert/strict"
import test from "node:test"

// ARCHITECTURE FENCE [IPD-010]

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  publishIconoplasmGalleryDirtyShardsForTest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

const WATERMARK_KEY = "iconoplasm:card-catalog-publish-watermark:v1"
const PUBLICATION_KEY = "iconoplasm:card-catalog-dirty-shard-publication:v1"
const SHARD_PREFIX = "iconoplasm:card-catalog-shard:"

function geneRow(symbol, sha = "7b".repeat(32), { blotReady = true } = {}) {
  const fullName = `full name ${symbol}`
  const blotFingerprint = iconoplasmGeneBlotFingerprint({
    symbol,
    full_name: fullName,
    portrait: { status: "published", asset_sha256: sha },
  })
  return {
    gene_symbol: symbol,
    catalog_full_name: fullName,
    color_hex: "#423D37",
    tmh: 1,
    essence_full_name: fullName,
    full_name: fullName,
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
    gene_blot_fingerprint: blotReady ? blotFingerprint : null,
    gene_blot_portrait_asset_sha256: blotReady ? sha : null,
    gene_blot_asset_sha256: blotReady ? "ef".repeat(32) : null,
    gene_blot_object_key: blotReady ? iconoplasmGeneBlotObjectKey(symbol, blotFingerprint) : null,
    gene_blot_width: blotReady ? 768 : null,
    gene_blot_height: blotReady ? 1024 : null,
  }
}

function baselineCard(symbol, sha = "7b".repeat(32)) {
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: "baseline-v2",
    data_source: "published_card_catalog",
    symbol,
    full_name: `full name ${symbol}`,
    display_color: "#423D37",
    portrait: {
      status: "published",
      url: `https://iconoplasmportraits.b-cdn.net/${sha}.webp`,
      full_url: `https://iconoplasmportraits.b-cdn.net/${sha}.webp`,
      thumb_url: `https://iconoplasmportraits.b-cdn.net/${sha}.webp`,
      width: 768,
      height: 1024,
      asset_sha256: sha,
      candidate_image_id: 5423,
      vision_id: "artist-random-v1",
      emulsion_id: "A1-5423",
    },
    field_status: { symbol: "present", portrait: "present" },
    payload: { symbol, full_name: `full name ${symbol}`, portrait: { status: "published" } },
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
    if (this.sql.includes("icono_manifestation_projection_authority")) {
      return { mode: "legacy_write" }
    }
    if (this.sql.includes("ORDER BY id DESC") && this.sql.includes("icono_publish_events")) {
      return { id: 100, created_at: this.db.maxEventAt }
    }
    if (this.sql.includes("COUNT(DISTINCT gene_symbol)")) {
      return {
        changed_symbol_count: this.db.changedSymbols.length,
        event_count: this.db.changedSymbols.length,
        min_created_at: this.db.changedSymbols.length ? this.db.maxEventAt : null,
        max_created_at: this.db.changedSymbols.length ? this.db.maxEventAt : null,
      }
    }
    return null
  }
  async all() {
    if (
      this.sql.includes("SELECT DISTINCT gene_symbol") &&
      this.sql.includes("icono_publish_events")
    ) {
      const limit = Number(this.args[this.args.length - 1] || 1)
      return {
        results: this.db.changedSymbols.slice(0, limit).map((gene_symbol) => ({ gene_symbol })),
      }
    }
    if (
      this.sql.includes("FROM icono_gene_catalog gc") &&
      this.sql.includes("LEFT JOIN icono_gene_essence ge")
    ) {
      const requested = new Set(this.args.map((value) => String(value || "").toUpperCase()))
      const symbols = this.db.symbols.filter((symbol) => !requested.size || requested.has(symbol))
      return {
        results: symbols.map((symbol) =>
          geneRow(symbol, this.db.shaBySymbol.get(symbol), {
            blotReady: !this.db.missingBlotSymbols.has(symbol),
          }),
        ),
      }
    }
    if (this.sql.includes("gene_symbol >= ?") && this.sql.includes("gene_symbol <= ?")) {
      const [first, last] = this.args
      return {
        results: this.db.symbols
          .filter((symbol) => symbol >= first && symbol <= last)
          .map((gene_symbol) => ({ gene_symbol })),
      }
    }
    return { results: [] }
  }
  async run() {
    if (this.sql.includes("icono_card_catalog_publication_audit")) {
      assert.equal(
        (this.sql.match(/\?/g) || []).length,
        this.args.length,
        "publication audit SQL placeholders must match its bound values",
      )
      this.db.auditBinds.push(this.args.slice())
    }
    return { success: true, meta: { changes: 0 } }
  }
}

class FakeDb {
  constructor(symbols) {
    this.symbols = symbols.slice().sort()
    this.changedSymbols = []
    this.maxEventAt = "2026-06-05 12:00:00"
    this.shaBySymbol = new Map()
    this.missingBlotSymbols = new Set()
    this.auditBinds = []
  }
  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function seedBaseline(kvStore, symbols, { buildRevision = 2, shardSize = 2 } = {}) {
  const version = "baseline-v2"
  const shards = []
  for (let offset = 0; offset < symbols.length; offset += shardSize) {
    const cards = symbols.slice(offset, offset + shardSize).map((symbol) => baselineCard(symbol))
    const index = shards.length
    const contentHash = `baseline-${index}`
    const key = `${SHARD_PREFIX}${contentHash}`
    kvStore.set(
      key,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: contentHash,
        cards,
      }),
    )
    shards.push({
      key,
      index,
      card_count: cards.length,
      content_hash: contentHash,
      first_symbol: cards[0].symbol,
      last_symbol: cards[cards.length - 1].symbol,
    })
  }
  kvStore.set(
    `iconoplasm:card-catalog:${version}`,
    JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      build_revision: buildRevision,
      artifact_version: version,
      snapshot_version: version,
      artifact_validated_at: "2026-06-05T11:00:00.000Z",
      content_hash: version,
      source: "published_card_catalog",
      storage: "kv_card_catalog_content_addressed_shards",
      shard_size: shardSize,
      shard_count: shards.length,
      catalog_gene_count: symbols.length,
      card_count: symbols.length,
      shards,
    }),
  )
  kvStore.set("iconoplasm:gallery-version", JSON.stringify({ current: version }))
  kvStore.set(
    WATERMARK_KEY,
    JSON.stringify({
      schema: "iconoplasm.cardCatalogPublishWatermark.v1",
      artifact_version: version,
      watermark_event_at: "2026-06-05 11:00:00",
      watermark_event_id: 99,
      card_count: symbols.length,
      catalog_gene_count: symbols.length,
      published_at: "2026-06-05T11:00:00.000Z",
    }),
  )
  return version
}

function buildEnv(db, kvStore, putKeys = []) {
  resetIconoplasmRuntimeCachesForTest()
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    ICONOPLASM_CARD_CATALOG_SHARD_SIZE: "2",
    KV: {
      async get(key) {
        return kvStore.has(key) ? kvStore.get(key) : null
      },
      async put(key, value) {
        putKeys.push(key)
        kvStore.set(key, value)
      },
      async delete(key) {
        kvStore.delete(key)
      },
    },
  }
}

test("routine publication refuses cold bootstrap instead of manufacturing a full rebuild", async () => {
  const db = new FakeDb(["GENA"])
  db.changedSymbols = ["GENA"]
  const env = buildEnv(db, new Map())
  await assert.rejects(
    () => publishIconoplasmGalleryDirtyShardsForTest(env),
    (error) => error?.code === "CARD_CATALOG_BASELINE_REQUIRED",
  )
})

test("canonical publication does not wait for a workstation blot", async () => {
  const db = new FakeDb(["GENA"])
  const kvStore = new Map()
  seedBaseline(kvStore, ["GENA"])
  db.changedSymbols = ["GENA"]
  db.missingBlotSymbols.add("GENA")
  let reservations = 0
  const putKeys = []
  const env = buildEnv(db, kvStore, putKeys)
  env.ICONOPLASM_CARD_CATALOG_KV_WRITE_BUDGET_REQUIRED_DO_NOT_SET_CASUALLY = "1"
  env.ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE = {
    idFromName(name) {
      return name
    },
    get() {
      return {
        async fetch() {
          reservations += 1
          return Response.json({ ok: true })
        },
      }
    },
  }

  const result = await publishIconoplasmGalleryDirtyShardsForTest(env)

  assert.equal(result.card_catalog.dirty_shard_publication, true)
  assert.equal(result.card_catalog.publication_more, false)
  assert.equal(reservations, 1)
  assert.ok(putKeys.length > 0)
})

test("one canonical change rewrites one shard and flips on the next publication tick", async () => {
  const symbols = ["GENA", "GENB", "GENC", "GEND"]
  const db = new FakeDb(symbols)
  const kvStore = new Map()
  const oldVersion = seedBaseline(kvStore, symbols)
  db.changedSymbols = ["GENB"]
  db.shaBySymbol.set("GENB", "ab".repeat(32))
  const putKeys = []

  const result = await publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore, putKeys), {
    triggerReason: "test_one_gene_tick",
  })

  assert.equal(result.card_catalog.dirty_shard_publication, true)
  assert.equal(result.card_catalog.publication_more, false)
  assert.equal(result.card_catalog.affected_shards, 1)
  assert.notEqual(result.version, oldVersion)
  assert.equal(putKeys.filter((key) => key.startsWith(SHARD_PREFIX)).length, 1)
  assert.equal(kvStore.has(PUBLICATION_KEY), false)
  assert.equal(JSON.parse(kvStore.get(WATERMARK_KEY)).watermark_event_at, db.maxEventAt)
  const completedAudit = db.auditBinds.at(-1)
  assert.equal(completedAudit[10], "test_one_gene_tick")
  assert.equal(completedAudit[11], 1, "one baseline shard read")
  assert.equal(completedAudit[12], 1, "one replacement shard written")
  assert.equal(completedAudit[13], 6, "bounded step KV writes reserved")
  assert.equal(completedAudit[14], 4, "shard, manifest, barrier, and watermark writes used")
  assert.ok(completedAudit[15] >= 0, "completed operation records duration")
  assert.equal(completedAudit[16], "completed")
})

test("a seven-shard delta is prepared in bounded steps and flips atomically only at completion", async () => {
  const symbols = Array.from({ length: 14 }, (_, index) => `G${String(index).padStart(2, "0")}`)
  const db = new FakeDb(symbols)
  const kvStore = new Map()
  const oldVersion = seedBaseline(kvStore, symbols)
  db.changedSymbols = symbols.slice()
  for (const symbol of symbols) db.shaBySymbol.set(symbol, "cd".repeat(32))

  const first = await publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore))
  assert.equal(first.version, oldVersion)
  assert.equal(first.card_catalog.publication_more, true)
  assert.equal(first.card_catalog.prepared_shard_count, 6)
  assert.equal(JSON.parse(kvStore.get("iconoplasm:gallery-version")).current, oldVersion)
  assert.equal(JSON.parse(kvStore.get(WATERMARK_KEY)).watermark_event_at, "2026-06-05 11:00:00")
  assert.ok(kvStore.has(PUBLICATION_KEY))

  const second = await publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore))
  assert.equal(second.card_catalog.publication_more, false)
  assert.equal(second.card_catalog.dirty_shard_count, 7)
  assert.notEqual(second.version, oldVersion)
  assert.equal(kvStore.has(PUBLICATION_KEY), false)
  const completedAudit = db.auditBinds.at(-1)
  assert.equal(completedAudit[11], 7)
  assert.equal(completedAudit[12], 7)
  assert.equal(completedAudit[13], 19)
  assert.equal(completedAudit[14], 12)
})

test("a new symbol is inserted by splitting only its local shard", async () => {
  const baselineSymbols = ["GENA", "GENB", "GENC", "GEND"]
  const db = new FakeDb([...baselineSymbols, "GENZ"])
  const kvStore = new Map()
  seedBaseline(kvStore, baselineSymbols)
  db.changedSymbols = ["GENZ"]
  db.shaBySymbol.set("GENZ", "ef".repeat(32))
  const untouchedKey = JSON.parse(kvStore.get("iconoplasm:card-catalog:baseline-v2")).shards[0].key

  const result = await publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore))
  const manifest = JSON.parse(kvStore.get(`iconoplasm:card-catalog:${result.version}`))

  assert.equal(manifest.card_count, 5)
  assert.equal(manifest.shard_count, 3)
  assert.equal(manifest.shards[0].key, untouchedKey)
  assert.deepEqual(
    manifest.shards.map((shard) => shard.index),
    [0, 1, 2],
  )
})

test("a mapper revision mismatch fails closed and never starts routine publication", async () => {
  const symbols = ["GENA", "GENB"]
  const db = new FakeDb(symbols)
  const kvStore = new Map()
  seedBaseline(kvStore, symbols, { buildRevision: 1 })
  db.changedSymbols = ["GENA"]
  const putKeys = []

  await assert.rejects(
    () => publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore, putKeys)),
    (error) => error?.code === "CARD_CATALOG_SCHEMA_MIGRATION_REQUIRED",
  )
  assert.deepEqual(putKeys, [])
  assert.equal(kvStore.has(PUBLICATION_KEY), false)
})

test("public mobile-card reads resolve the atomically published dirty-shard manifest", async () => {
  const symbols = ["GENA", "GENB"]
  const db = new FakeDb(symbols)
  const kvStore = new Map()
  seedBaseline(kvStore, symbols)
  db.changedSymbols = ["GENB"]
  db.shaBySymbol.set("GENB", "ab".repeat(32))
  const published = await publishIconoplasmGalleryDirtyShardsForTest(buildEnv(db, kvStore))
  kvStore.set("iconoplasm:gallery-version", JSON.stringify({ current: published.version }))

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: ["GENB"] }),
      }),
      buildEnv(db, kvStore),
      { waitUntil() {} },
    )
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.cards[0].portrait.asset_sha256, "ab".repeat(32))
})
