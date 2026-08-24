import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  handleIconoplasmGatewayRequest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmExtensionBlocklistKvKey } from "./iconoplasm-extension-blocklist-policy.js"

const amidBlocklistVersion = `ebl1-${createHash("sha256")
  .update(JSON.stringify(["AMID"]))
  .digest("hex")
  .slice(0, 16)}`

// DO NOT DELETE THIS FILE.
//
// This test exists because the real failure mode is not "the page is a bit slow".
// The real failure mode is "fresh Cloudflare isolates quietly re-scan the same
// 20k-row snapshot until the bill gets stupid again." If this file fails, fix the
// barrier or replace it with something stricter in the same change.

if (!globalThis.caches) {
  globalThis.caches = {
    default: {
      async match() {
        return null
      },
      async put() {},
    },
  }
}

class FakeCostBarrierStatement {
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
    if (
      this.sql.includes("FROM icono_publish_state") &&
      !this.sql.includes("JOIN icono_portrait_assets")
    ) {
      this.db.fingerprintReads += 1
      return {
        results: [
          { symbol: "A1BG", asset_sha256: "a".repeat(64) },
          { symbol: "TP53", asset_sha256: "b".repeat(64) },
        ],
      }
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa") &&
      this.sql.includes("ps.current_asset_sha256 AS asset_sha256") &&
      !this.sql.includes("COALESCE(vs.upvotes, 0)")
    ) {
      this.db.portraitRefReads += 1
      return {
        results: [
          {
            symbol: "A1BG",
            asset_sha256: "a".repeat(64),
            ph: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/full.webp`,
            pt: `portraits/v1/${"a".repeat(2)}/${"a".repeat(64)}/medium.webp`,
          },
          {
            symbol: "TP53",
            asset_sha256: "b".repeat(64),
            ph: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/full.webp`,
            pt: `portraits/v1/${"b".repeat(2)}/${"b".repeat(64)}/medium.webp`,
          },
        ],
      }
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("JOIN icono_portrait_assets pa") &&
      this.sql.includes("COALESCE(vs.upvotes, 0)")
    ) {
      this.db.galleryPublishedReads += 1
      return {
        results: [
          {
            symbol: "TP53",
            published_at: "2026-04-05T10:00:00Z",
            asset_created_at: "2026-04-05T10:00:00Z",
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
            published_at: "2026-04-05T09:00:00Z",
            asset_created_at: "2026-04-05T09:00:00Z",
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
        ],
      }
    }

    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeCostBarrierDb {
  constructor() {
    this.portraitRefReads = 0
    this.galleryPublishedReads = 0
    this.fingerprintReads = 0
  }

  prepare(sql) {
    return new FakeCostBarrierStatement(this, sql)
  }
}

class FakeSharedKv {
  constructor(hash = "costbarrier01", version = "gallery-version-1") {
    this.hash = hash
    this.version = version
    this.getCounts = new Map()
    const mobileCards = [completeMobileCard("A1BG", version), completeMobileCard("TP53", version)]
    const fingerprint = { published_count: 2, latest: "publisherownedv1" }
    const portraitRefVersion = `v3-${fingerprint.published_count}-${fingerprint.latest}`
    const portraitRefs = [
      { symbol: "A1BG", asset_sha256: "a".repeat(64) },
      { symbol: "TP53", asset_sha256: "b".repeat(64) },
    ]
    this.store = new Map([
      [
        "iconoplasm:catalog-manifest",
        JSON.stringify({
          current_hash: hash,
          generated_at: "2026-04-05T00:00:00Z",
          schema_version: 4,
          canonical_key: "symbol",
          gene_count: 2,
        }),
      ],
      [
        "iconoplasm:published-portrait-fingerprint:v3",
        JSON.stringify({
          schema: "iconoplasm.publishedPortraitFingerprint.v1",
          // Deliberately ancient. Publication metadata is immutable until the
          // publisher replaces it; readers do not reinterpret age as authority
          // to rebuild it from D1.
          published_at: "2000-01-01T00:00:00.000Z",
          fingerprint,
        }),
      ],
      [`iconoplasm:published-portrait-refs:${portraitRefVersion}`, JSON.stringify(portraitRefs)],
      [
        `iconoplasm:catalog:${hash}`,
        JSON.stringify({
          schema_version: 4,
          generated_at: "2026-04-05T00:00:00Z",
          gene_count: 2,
          genes: [
            { s: "A1BG", n: "alpha-1-B glycoprotein", c: "#dd8c9d" },
            { s: "TP53", n: "tumor protein p53", c: "#5a7fff" },
          ],
        }),
      ],
      [
        `iconoplasm:card-catalog:${version}`,
        JSON.stringify({
          schema: "iconoplasm.cardCatalog.v1",
          artifact_version: version,
          snapshot_version: version,
          artifact_validated_at: "2026-04-05T00:00:00Z",
          source: "published_card_catalog",
          storage: "kv_sharded",
          shard_size: 750,
          shard_count: 2,
          catalog_gene_count: 2,
          card_count: 2,
          shards: [
            {
              key: `iconoplasm:card-catalog:${version}:shard:0`,
              index: 0,
              card_count: 1,
              first_symbol: "A1BG",
              last_symbol: "ZZZZ",
            },
            {
              key: `iconoplasm:card-catalog:${version}:shard:1`,
              index: 1,
              card_count: 1,
              first_symbol: "A000",
              last_symbol: "ZZZZ",
            },
          ],
          symbol_shard_index: {
            A1BG: 0,
            TP53: 1,
          },
        }),
      ],
      [
        `iconoplasm:card-catalog:${version}:shard:0`,
        JSON.stringify({
          schema: "iconoplasm.cardCatalog.v1",
          artifact_version: version,
          shard_index: 0,
          cards: [mobileCards[0]],
        }),
      ],
      [
        `iconoplasm:card-catalog:${version}:shard:1`,
        JSON.stringify({
          schema: "iconoplasm.cardCatalog.v1",
          artifact_version: version,
          shard_index: 1,
          cards: [mobileCards[1]],
        }),
      ],
      ["iconoplasm:gallery-version", version],
      [
        iconoplasmExtensionBlocklistKvKey(1),
        JSON.stringify({
          schema_version: 1,
          revision: 1,
          version: amidBlocklistVersion,
          term_count: 1,
          terms: ["AMID"],
        }),
      ],
    ])
  }

  async get(key) {
    this.getCounts.set(key, (this.getCounts.get(key) || 0) + 1)
    return this.store.has(key) ? this.store.get(key) : null
  }

  async put(key, value) {
    this.store.set(key, String(value))
  }

  async list({ prefix = "", limit = 1_000, cursor = "" } = {}) {
    const names = [...this.store.keys()].filter((key) => key.startsWith(prefix)).sort()
    const offset = Number.parseInt(cursor, 10) || 0
    const page = names.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    return {
      keys: page.map((name) => ({ name })),
      list_complete: nextOffset >= names.length,
      cursor: nextOffset < names.length ? String(nextOffset) : "",
    }
  }
}

function completeMobileCard(symbol, version) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  const portraitAssetSha256 = normalized === "TP53" ? "b".repeat(64) : "a".repeat(64)
  const portraitUrl = `https://iconoplasmportraits.b-cdn.net/portraits/${normalized}/medium.webp`
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: version,
    data_source: "published_card_catalog",
    symbol: normalized,
    full_name: `${normalized} full name`,
    display_color: "#5a7fff",
    portrait: {
      status: "published",
      url: portraitUrl,
      full_url: `https://iconoplasmportraits.b-cdn.net/portraits/${normalized}/full.webp`,
      thumb_url: `https://iconoplasmportraits.b-cdn.net/portraits/${normalized}/thumb.webp`,
      width: 384,
      height: 512,
      asset_sha256: portraitAssetSha256,
      candidate_image_id: normalized === "TP53" ? 12 : 11,
      vision_id: `anima-v1-${normalized}`,
      emulsion_id: `A1-${normalized}`,
    },
    field_status: {
      full_name: "present",
      manifestation: "known_absent",
      portrait: "present",
    },
    payload: {
      symbol: normalized,
      full_name: `${normalized} full name`,
      portrait: {
        status: "published",
        medium_url: portraitUrl,
        asset_sha256: portraitAssetSha256,
      },
    },
  }
}

function buildEnv(sharedKv, db) {
  const env = {
    ICONOPLASM_DB: db,
    KV: sharedKv,
  }
  env.THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE = {
    fetch(request) {
      return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        request,
        env,
        { waitUntil() {} },
      )
    },
  }
  return env
}

test("DO NOT DELETE: catalog manifest never rebuilds publisher-owned fingerprint metadata", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(first.status, 200)
  assert.equal(db.fingerprintReads, 0)
  const firstPayload = await first.json()
  assert.match(firstPayload.artifact_url, /catalog\.costbarrier01-a5c1-v3-2-/)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(second.status, 200)
  const secondPayload = await second.json()
  assert.equal(secondPayload.build_version, firstPayload.build_version)
  assert.equal(db.fingerprintReads, 0)
})

test("DO NOT DELETE: missing publication metadata is retryable without a D1 repair or isolate reset", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()
  const key = "iconoplasm:published-portrait-fingerprint:v3"
  const published = kv.store.get(key)
  kv.store.delete(key)
  resetIconoplasmRuntimeCachesForTest()

  const missing = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(missing.status, 503)
  assert.equal(db.fingerprintReads, 0)

  kv.store.set(key, published)
  const repaired = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(repaired.status, 200)
  assert.equal(db.fingerprintReads, 0)
})

test("DO NOT DELETE: search consumes publisher-owned portrait refs across isolate resets", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/search?q=alpha"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(first.status, 200)
  assert.equal(db.portraitRefReads, 0)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/search?q=alpha"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(second.status, 200)
  assert.equal(db.portraitRefReads, 0)
})

test("DO NOT DELETE: vote gallery reuses the shared published gallery snapshot after isolate reset", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes&limit=10"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const firstPayload = await first.json()
  assert.equal(first.status, 200)
  assert.deepEqual(
    firstPayload.items.map((item) => item.symbol),
    ["TP53", "A1BG"],
  )
  assert.equal(db.galleryPublishedReads, 1)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes&limit=10"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const secondPayload = await second.json()
  assert.equal(second.status, 200)
  assert.deepEqual(
    secondPayload.items.map((item) => item.symbol),
    ["TP53", "A1BG"],
  )
  assert.equal(db.galleryPublishedReads, 1)
})

test("DO NOT DELETE: corrupt portrait publication fails retryably instead of repairing from D1", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()
  const retiredCacheKey = "iconoplasm:hydrated-catalog-artifact:costbarrier01"
  kv.store.set(
    retiredCacheKey,
    JSON.stringify({
      schema_version: 4,
      gene_count: 1,
      genes: [{ s: "A1BG", ph: "retired-full.webp", pt: "retired-medium.webp" }],
    }),
  )
  resetIconoplasmRuntimeCachesForTest()
  const manifestResponse = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const manifestPayload = await manifestResponse.json()
  const fingerprintEnvelope = JSON.parse(
    kv.store.get("iconoplasm:published-portrait-fingerprint:v3"),
  )
  const portraitRefVersion = `v3-${fingerprintEnvelope.fingerprint.published_count}-${fingerprintEnvelope.fingerprint.latest}`
  const incompletePortraitRefCacheKey = `iconoplasm:published-portrait-refs:${portraitRefVersion}`
  kv.store.set(incompletePortraitRefCacheKey, "[]")
  const invalidCurrentCacheKey = `iconoplasm:hydrated-catalog-artifact:a5c1:${manifestPayload.build_version}`
  kv.store.set(
    invalidCurrentCacheKey,
    JSON.stringify({
      schema_version: 4,
      gene_count: 1,
      genes: [{ s: "A1BG", ph: "retired-full.webp", pt: "retired-medium.webp" }],
    }),
  )

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.costbarrier01.json"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const firstPayload = await first.json()
  assert.equal(first.status, 503)
  assert.equal(db.portraitRefReads, 0)
  assert.match(firstPayload.error, /temporarily unavailable/)
  assert.equal(kv.getCounts.get(retiredCacheKey) || 0, 0)
  assert.equal(kv.getCounts.get(invalidCurrentCacheKey), 1)
  assert.equal(kv.getCounts.get(incompletePortraitRefCacheKey), 1)
  assert.equal(JSON.parse(kv.store.get(incompletePortraitRefCacheKey)).length, 0)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.costbarrier01.json"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const secondPayload = await second.json()
  assert.equal(second.status, 503)
  assert.equal(db.portraitRefReads, 0)
  assert.match(secondPayload.error, /temporarily unavailable/)
})

test("DO NOT DELETE: mobile card manifest reuses the in-isolate gallery version barrier", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()
  const env = buildEnv(kv, db)
  const requestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: ["TP53"] }),
  }

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", requestInit),
    env,
    { waitUntil() {} },
  )
  assert.equal(first.status, 200)
  const second = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", requestInit),
    env,
    { waitUntil() {} },
  )
  assert.equal(second.status, 200)

  assert.equal(kv.getCounts.get("iconoplasm:gallery-version"), 1)
})

test("DO NOT DELETE: symbol-scoped card manifest reads only exact indexed shards", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const response = await handleIconoplasmGatewayRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: ["TP53"] }),
    }),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["TP53"],
  )
  assert.equal(kv.getCounts.get(`iconoplasm:card-catalog:${kv.version}:shard:1`), 1)
  assert.equal(kv.getCounts.get(`iconoplasm:card-catalog:${kv.version}:shard:0`) || 0, 0)
})
