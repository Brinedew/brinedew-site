import assert from "node:assert/strict"
import test from "node:test"

import {
  handleIconoplasmDbGatewayRequest,
  handleIconoplasmRequest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm.js"

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
    if (this.sql.includes("COUNT(*) AS published_count")) {
      this.db.fingerprintReads += 1
      return {
        published_count: 2,
        latest_updated_at: "2026-04-05T00:00:00Z",
      }
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa") &&
      this.sql.includes("pa.r2_key_full") &&
      !this.sql.includes("COALESCE(vs.upvotes, 0)")
    ) {
      this.db.portraitRefReads += 1
      return {
        results: [
          {
            symbol: "A1BG",
            r2_key_full: "portraits/full-a1bg.webp",
            r2_key_medium: "portraits/medium-a1bg.webp",
            r2_key_thumb: "portraits/thumb-a1bg.webp",
          },
          {
            symbol: "TP53",
            r2_key_full: "portraits/full-tp53.webp",
            r2_key_medium: "portraits/medium-tp53.webp",
            r2_key_thumb: "portraits/thumb-tp53.webp",
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
      ["iconoplasm:gallery-version", version],
    ])
  }

  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null
  }

  async put(key, value) {
    this.store.set(key, String(value))
  }
}

function buildEnv(sharedKv, db) {
  const env = {
    ICONOPLASM_DB: db,
    KV: sharedKv,
  }
  env.THE_ONLY_ALLOWED_DB_GATEWAY = {
    fetch(request) {
      return handleIconoplasmDbGatewayRequest(request, env, { waitUntil() {} })
    },
  }
  return env
}

test("DO NOT DELETE: catalog manifest reuses the shared portrait fingerprint cache across isolate resets", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(first.status, 200)
  assert.equal(db.fingerprintReads, 1)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(second.status, 200)
  assert.equal(db.fingerprintReads, 1)
})

test("DO NOT DELETE: search warm-up reuses shared portrait refs instead of rescanning D1 after isolate reset", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/search?q=alpha"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(first.status, 200)
  assert.equal(db.portraitRefReads, 1)

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/search?q=alpha"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  assert.equal(second.status, 200)
  assert.equal(db.portraitRefReads, 1)
})

test("DO NOT DELETE: vote gallery reuses the shared published gallery snapshot after isolate reset", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmRequest(
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
  const second = await handleIconoplasmRequest(
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

test("DO NOT DELETE: public catalog artifact reuses the shared hydrated artifact after isolate reset", async () => {
  const kv = new FakeSharedKv()
  const db = new FakeCostBarrierDb()

  resetIconoplasmRuntimeCachesForTest()
  const first = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.costbarrier01.json"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const firstPayload = await first.json()
  assert.equal(first.status, 200)
  assert.equal(db.portraitRefReads, 1)
  assert.equal(firstPayload.genes[0]?.pt != null || firstPayload.genes[0]?.ph != null, true)
  const hydratedArtifactKeys = Array.from(kv.store.keys()).filter((key) =>
    String(key).startsWith("iconoplasm:hydrated-catalog-artifact:costbarrier01"),
  )
  assert.equal(
    hydratedArtifactKeys.length > 0,
    true,
  )

  resetIconoplasmRuntimeCachesForTest()
  const second = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/catalog/catalog.costbarrier01.json"),
    buildEnv(kv, db),
    { waitUntil() {} },
  )
  const secondPayload = await second.json()
  assert.equal(second.status, 200)
  assert.equal(db.portraitRefReads, 1)
  assert.equal(secondPayload.genes[0]?.pt != null || secondPayload.genes[0]?.ph != null, true)
})
