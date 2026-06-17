import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  invalidateIconoplasmGalleryCacheForTest,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const source = readFileSync(
  new URL(
    "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const appSource = readFileSync(
  new URL("../quartz/static/iconoplasm/app.js", import.meta.url),
  "utf8",
)

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
    if (this.sql.includes("FROM icono_gene_catalog")) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      return this.db.catalog.get(symbol) || null
    }
    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      return this.db.published.get(symbol) || null
    }
    if (this.sql.includes("FROM icono_gene_essence")) {
      const symbol = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      return this.db.essence.get(symbol) || null
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("FROM icono_gene_catalog gc") &&
      this.sql.includes("LEFT JOIN icono_gene_essence ge")
    ) {
      let symbols = Array.from(this.db.catalog.keys()).sort()
      if (this.sql.includes("WHERE gc.gene_symbol IN")) {
        const requested = new Set(
          this.args.map((arg) =>
            String(arg || "")
              .trim()
              .toUpperCase(),
          ),
        )
        symbols = symbols.filter((symbol) => requested.has(symbol))
      }
      return {
        results: symbols.map((symbol) => {
          const catalog = this.db.catalog.get(symbol) || {}
          const essence = this.db.essence.get(symbol) || {}
          const portrait = this.db.published.get(symbol) || {}
          return {
            gene_symbol: symbol,
            catalog_full_name: catalog.full_name,
            color_hex: catalog.color_hex,
            tmh: catalog.tmh,
            essence_full_name: essence.full_name,
            ...essence,
            asset_sha256: portrait.asset_sha256,
            width: portrait.width,
            height: portrait.height,
            vision_id: portrait.vision_id,
            candidate_image_id: portrait.candidate_image_id,
            emulsion_id: portrait.emulsion_id,
          }
        }),
      }
    }
    if (
      this.sql.includes("SELECT gene_symbol") &&
      this.sql.includes("FROM icono_gene_catalog") &&
      this.sql.includes("WHERE gene_symbol > ?")
    ) {
      const cursor = String(this.args[0] || "")
        .trim()
        .toUpperCase()
      const limit = Number(this.args[1] || 1000)
      const rows = Array.from(this.db.catalog.keys())
        .filter((symbol) => symbol > cursor)
        .sort()
        .slice(0, limit)
        .map((gene_symbol) => ({ gene_symbol }))
      return { results: rows }
    }
    return { results: [] }
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor() {
    this.catalog = new Map([
      [
        "ERBB2",
        {
          gene_symbol: "ERBB2",
          full_name: "erb-b2 receptor tyrosine kinase 2",
          uniprot: "",
          color_hex: "#423D37",
          tmh: 1,
          aliases_json: "[]",
        },
      ],
      [
        "INS",
        {
          gene_symbol: "INS",
          full_name: "insulin",
          uniprot: "",
          color_hex: "#B0304A",
          tmh: 0,
          aliases_json: "[]",
        },
      ],
    ])
    this.published = new Map([
      [
        "ERBB2",
        {
          asset_sha256: "7b".repeat(32),
          width: 768,
          height: 1024,
          vision_id: "artist-random-v1",
          candidate_image_id: 5423,
          emulsion_id: "A1-5423",
        },
      ],
      [
        "INS",
        {
          asset_sha256: "9c".repeat(32),
          width: 768,
          height: 1024,
          vision_id: "artist-random-v1",
          candidate_image_id: 4352,
          emulsion_id: "A1-4352",
        },
      ],
    ])
    this.essence = new Map([
      [
        "ERBB2",
        {
          full_name: "erb-b2 receptor tyrosine kinase 2",
          weight_kg: 137.9,
          molecular_weight_kda: 137.9,
          height_cm: null,
          sex: "male",
          age: null,
          age_years: 35,
          first_publication_year: 1985,
          faction: "pro-growth",
          skin_hex: "#423D37",
          skin_name: "Mocha Black",
          tissue_tau: 0.26,
          primary_tissue: "ubiquitous",
          loeuf: 0.518,
          constraint_percentile: null,
          aesthetics_json: JSON.stringify(["Pirate", "Post-Apocalyptic", "Neoclassicism"]),
          aesthetics_origin_json: JSON.stringify([
            "Growth factor receptor cysteine-rich",
            "Leucine Rich Repeat",
            "Protein Kinase",
          ]),
          politics_origin_json: JSON.stringify(["oncogene"]),
          family_surname: "ERBB",
          family_members: 3,
          family_feature: "",
          manifestation:
            "Internal sample prose for image generation. Public mobile card payloads must not expose it.",
        },
      ],
      [
        "INS",
        {
          full_name: "insulin",
          weight_kg: 12,
          molecular_weight_kda: 12,
          height_cm: null,
          sex: "female",
          age: null,
          age_years: 61,
          first_publication_year: 1959,
          faction: "",
          skin_hex: "#B0304A",
          skin_name: "Ruby",
          tissue_tau: 0.87,
          primary_tissue: "tissue-specific",
          loeuf: 0.9,
          constraint_percentile: null,
          aesthetics_json: JSON.stringify(["Sweet Lolita"]),
          aesthetics_origin_json: JSON.stringify(["Insulin"]),
          politics_origin_json: JSON.stringify([]),
          family_surname: "INS",
          family_members: 1,
          family_feature: "",
          manifestation: "",
        },
      ],
    ])
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function completeCardCatalogArtifact(symbols = ["ERBB2", "INS"], version = "test-vm-version") {
  const cards = symbols.map((symbol) =>
    completeMobileCardVM(symbol, version, "published_card_catalog"),
  )
  return {
    schema: "iconoplasm.cardCatalog.v1",
    artifact_version: version,
    snapshot_version: version,
    artifact_validated_at: "2026-05-09T00:00:00.000Z",
    source: "published_card_catalog",
    catalog_gene_count: cards.length,
    card_count: cards.length,
    cards,
  }
}

function putShardedCardCatalogArtifact(
  kvStore,
  symbols = ["ERBB2", "INS"],
  version = "test-vm-version",
) {
  const cards = symbols.map((symbol) =>
    completeMobileCardVM(symbol, version, "published_card_catalog"),
  )
  const shards = cards.map((card, index) => ({
    key: `iconoplasm:card-catalog:${version}:shard:${index}`,
    index,
    card_count: 1,
    first_symbol: card.symbol,
    last_symbol: card.symbol,
  }))
  kvStore.set(
    `iconoplasm:card-catalog:${version}`,
    JSON.stringify({
      schema: "iconoplasm.cardCatalog.v1",
      artifact_version: version,
      snapshot_version: version,
      artifact_validated_at: "2026-05-09T00:00:00.000Z",
      source: "published_card_catalog",
      storage: "kv_sharded",
      shard_size: 1,
      shard_count: shards.length,
      catalog_gene_count: cards.length,
      card_count: cards.length,
      shards,
    }),
  )
  for (const shard of shards) {
    kvStore.set(
      shard.key,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: version,
        shard_index: shard.index,
        cards: [cards[shard.index]],
      }),
    )
  }
}

function putCatalogResolveArtifact(
  kvStore,
  genes = [
    {
      s: "SOSTDC1",
      n: "sclerostin domain containing 1",
      u: "Q6X4U4",
      c: "#6F8B4E",
      tmh: false,
      a: ["USAG1"],
    },
  ],
  hash = "aliascatalog01",
) {
  kvStore.set(
    "iconoplasm:catalog-manifest",
    JSON.stringify({
      current_hash: hash,
      generated_at: "2026-05-21T00:00:00.000Z",
      schema_version: 4,
      canonical_key: "symbol",
      gene_count: genes.length,
    }),
  )
  kvStore.set(
    `iconoplasm:catalog:${hash}`,
    JSON.stringify({
      schema_version: 4,
      generated_at: "2026-05-21T00:00:00.000Z",
      gene_count: genes.length,
      genes,
    }),
  )
}

function buildEnv({
  kvStore = new Map(),
  db = new FakeIconoplasmDb(),
  version = "test-vm-version",
  cardArtifact = completeCardCatalogArtifact(["ERBB2", "INS"], version),
  onKvGet = null,
  onKvPut = null,
  extraEnv = {},
} = {}) {
  resetIconoplasmRuntimeCachesForTest()
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    KV: {
      async get(key) {
        if (typeof onKvGet === "function") onKvGet(key)
        if (kvStore.has(key)) return kvStore.get(key)
        if (key === "iconoplasm:gallery-version") return version
        if (key === `iconoplasm:card-catalog:${version}` && cardArtifact) {
          return JSON.stringify(cardArtifact)
        }
        return kvStore.get(key) || null
      },
      async put(key, value) {
        if (typeof onKvPut === "function") onKvPut(key, value)
        kvStore.set(key, value)
        return true
      },
    },
    ICONOPLASM_PORTRAIT_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    ...extraEnv,
  }
}

function fakeCardCatalogKvWriteBudgetBinding({
  dailyLimit = 900,
  initialEstimatedWrites = 0,
} = {}) {
  let estimatedWrites = initialEstimatedWrites
  const reservations = []
  return {
    reservations,
    binding: {
      idFromName(name) {
        return String(name || "global")
      },
      get() {
        return {
          async fetch(request) {
            const url = new URL(request.url)
            if (url.pathname !== "/reserve-card-catalog-kv-writes") {
              return Response.json({ error: "Not found" }, { status: 404 })
            }
            const payload = await request.json()
            const requestedWrites = Math.max(0, Number(payload.estimated_kv_writes || 0) || 0)
            const projectedWrites = estimatedWrites + requestedWrites
            reservations.push({ ...payload, requestedWrites, projectedWrites })
            if (projectedWrites > dailyLimit) {
              return Response.json(
                {
                  ok: false,
                  code: "CARD_CATALOG_KV_WRITE_BUDGET_EXHAUSTED",
                  daily_limit: dailyLimit,
                  estimated_writes: estimatedWrites,
                  requested_writes: requestedWrites,
                  projected_writes: projectedWrites,
                },
                { status: 429 },
              )
            }
            estimatedWrites = projectedWrites
            return Response.json({
              ok: true,
              code: "OK",
              daily_limit: dailyLimit,
              estimated_writes: estimatedWrites,
              requested_writes: requestedWrites,
              projected_writes: projectedWrites,
            })
          },
        }
      },
    },
  }
}

function completeMobileCardVM(
  symbol = "ERBB2",
  version = "test-vm-version",
  dataSource = "kv_snapshot",
) {
  const normalized = String(symbol || "ERBB2").toUpperCase()
  const fullName = normalized === "INS" ? "insulin" : "erb-b2 receptor tyrosine kinase 2"
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: version,
    data_source: dataSource,
    symbol: normalized,
    full_name: fullName,
    display_color: normalized === "INS" ? "#B0304A" : "#423D37",
    portrait: {
      status: "published",
      url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
      full_url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
      thumb_url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
      width: 768,
      height: 1024,
      asset_sha256: normalized === "INS" ? "9c".repeat(32) : "7b".repeat(32),
      candidate_image_id: normalized === "INS" ? 4352 : 5423,
      vision_id: "artist-random-v1",
      emulsion_id: normalized === "INS" ? "A1-4352" : "A1-5423",
    },
    field_status: {
      symbol: "present",
      full_name: "present",
      color: "present",
      portrait: "present",
      family: "present",
      family_feature: "known_absent",
      category: "present",
      age: "present",
      weight: "present",
    },
    payload: {
      symbol: normalized,
      full_name: fullName,
      color: normalized === "INS" ? "#B0304A" : "#423D37",
      portrait: { status: "published" },
      molecular_weight_kda: normalized === "INS" ? 12 : 137.9,
      first_publication_year: normalized === "INS" ? 1959 : 1985,
      primary_tissue: normalized === "INS" ? "tissue-specific" : "ubiquitous",
      essence: {
        age_years: normalized === "INS" ? 61 : 35,
        weight_kg: normalized === "INS" ? 12 : 137.9,
        tissue_tau: normalized === "INS" ? 0.87 : 0.26,
        faction: normalized === "INS" ? "" : "pro-growth",
      },
    },
  }
}

test("gallery invalidation reuses the card catalog artifact when public card material is unchanged", async () => {
  const kvStore = new Map()
  const putKeys = []
  const env = buildEnv({
    kvStore,
    cardArtifact: null,
    version: "old-random-version",
    onKvPut(key) {
      putKeys.push(key)
    },
  })

  const first = await invalidateIconoplasmGalleryCacheForTest(env)

  assert.match(first.version, /^ccv1-[a-f0-9]{32}$/)
  assert.equal(first.card_catalog.reused_existing, false)
  // Content-addressed: one shard blob (2 genes < shard size), one manifest, one flip.
  assert.equal(putKeys.filter((key) => key.startsWith("iconoplasm:card-catalog-shard:")).length, 1)
  assert.equal(
    putKeys.filter((key) => key === `iconoplasm:card-catalog:${first.version}`).length,
    1,
  )
  assert.equal(putKeys.filter((key) => key === "iconoplasm:gallery-version").length, 1)

  const firstPutCount = putKeys.length
  const second = await invalidateIconoplasmGalleryCacheForTest(env)

  assert.equal(second.version, first.version)
  assert.equal(second.card_catalog.reused_existing, true)
  assert.equal(second.card_catalog.reused_gallery_version, true)
  assert.equal(putKeys.length, firstPutCount)
})

test("gallery invalidation reserves the shared KV write budget before publishing", async () => {
  const kvStore = new Map()
  const events = []
  const budget = fakeCardCatalogKvWriteBudgetBinding()
  const env = buildEnv({
    kvStore,
    cardArtifact: null,
    version: "old-random-version",
    onKvPut(key) {
      events.push(`put:${key}`)
    },
    extraEnv: {
      ICONOPLASM_CARD_CATALOG_KV_WRITE_BUDGET_REQUIRED_DO_NOT_SET_CASUALLY: "1",
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budget.binding,
    },
  })

  const first = await invalidateIconoplasmGalleryCacheForTest(env)

  // The content-addressed staging rebuild reserves the shared KV-write budget
  // before each write: a shard-publish reservation precedes the shard blob, and a
  // manifest-publish reservation precedes the manifest + version flip.
  const ops = budget.reservations.map((r) => r.operation)
  assert.ok(ops.includes("card_catalog_staging_shard_publish"))
  assert.ok(ops.includes("card_catalog_staging_manifest_publish"))
  assert.equal(budget.reservations[0].operation, "card_catalog_staging_shard_publish")
  // First KV write is a content-addressed shard, and it came after a reservation.
  assert.match(events[0], /^put:iconoplasm:card-catalog-shard:/)
  assert.equal(first.card_catalog.rebuild_complete, true)
})

test("gallery invalidation fails closed before KV puts when the shared write budget is exhausted", async () => {
  const kvStore = new Map()
  const putKeys = []
  // dailyLimit 1 is below the first chunk's shard-publish reservation, so the
  // budget gate trips before any KV write happens.
  const budget = fakeCardCatalogKvWriteBudgetBinding({ dailyLimit: 1 })
  const env = buildEnv({
    kvStore,
    cardArtifact: null,
    version: "old-random-version",
    onKvPut(key) {
      putKeys.push(key)
    },
    extraEnv: {
      ICONOPLASM_CARD_CATALOG_KV_WRITE_BUDGET_REQUIRED_DO_NOT_SET_CASUALLY: "1",
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budget.binding,
    },
  })

  await assert.rejects(
    () => invalidateIconoplasmGalleryCacheForTest(env),
    /CARD_CATALOG_KV_WRITE_BUDGET_EXHAUSTED/,
  )
  assert.equal(putKeys.length, 0)
})

test("print-copy honors the displayed canonical asset when the public card artifact is stale", async () => {
  const db = new FakeIconoplasmDb()
  const currentAssetSha = "8d".repeat(32)
  db.published.set("ERBB2", {
    ...db.published.get("ERBB2"),
    asset_sha256: currentAssetSha,
  })
  const env = buildEnv({
    db,
    version: "old-card-artifact",
    cardArtifact: completeCardCatalogArtifact(["ERBB2"], "old-card-artifact"),
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/print-copy/ERBB2.png?asset=${currentAssetSha}`,
        {
          method: "HEAD",
        },
      ),
      env,
    )

  assert.equal(response.status, 302)
  const location = response.headers.get("Location") || ""
  assert.match(location, /\/api\/iconoplasm\/print-copy\/ERBB2\.png/)
  assert.match(location, new RegExp(`asset=${currentAssetSha}`))
  assert.match(location, new RegExp(`v=site-gene-detail-${currentAssetSha}`))
  assert.doesNotMatch(location, /7b7b7b/)

  const resolved =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(location, { method: "HEAD" }),
      env,
    )

  assert.equal(resolved.status, 200)
  assert.equal(resolved.headers.get("X-Iconoplasm-Asset-Sha256"), currentAssetSha)
  assert.equal(
    resolved.headers.get("X-Iconoplasm-VM-Version"),
    `site-gene-detail-${currentAssetSha}`,
  )
})

test("mobile card manifest returns complete VMs from the published card catalog artifact", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["ERBB2"] }),
      }),
      buildEnv({ db: null }),
    )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "published-card-catalog")
  const payload = await response.json()
  assert.equal(payload.schema, "iconoplasm.mobileCardManifest.v1")
  assert.equal(payload.snapshot_version, "test-vm-version")
  assert.equal(payload.data_source, "published_card_catalog")
  assert.deepEqual(payload.missing, [])
  assert.equal(payload.diagnostics.artifact_version, "test-vm-version")
  assert.equal(payload.diagnostics.source, "published_card_catalog")
  assert.equal(payload.cards.length, 1)
  const card = payload.cards[0]
  assert.equal(card.__complete, true)
  assert.equal(card.schema_version, "iconoplasm.mobileCard.v1")
  assert.equal(card.symbol, "ERBB2")
  assert.equal(card.full_name, "erb-b2 receptor tyrosine kinase 2")
  assert.equal(card.portrait.status, "published")
  assert.notEqual(card.portrait.status, "pending")
  assert.equal(card.field_status.family, "present")
  assert.equal(card.field_status.family_feature, "known_absent")
  assert.equal(card.payload.first_publication_year, 1985)
  assert.equal(card.payload.molecular_weight_kda, 137.9)
  assert.equal(card.payload.primary_tissue, "ubiquitous")
  assert.equal(card.payload.essence.faction, "pro-growth")
})

test("mobile card symbol endpoint resolves aliases before reading the published card artifact", async () => {
  const kvStore = new Map()
  putCatalogResolveArtifact(kvStore)
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/USAG1"),
      buildEnv({
        kvStore,
        db: null,
        cardArtifact: completeCardCatalogArtifact(["SOSTDC1"], "test-vm-version"),
      }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.card?.symbol, "SOSTDC1")
  assert.equal(payload?.payload?.symbol, "SOSTDC1")
  assert.deepEqual(payload?.missing, [])
})

test("mobile card manifest reads only needed shards from the one published card catalog artifact path", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const kvStore = new Map()
  const kvGets = []
  putShardedCardCatalogArtifact(kvStore, ["BRCA1", "ERBB2", "INS", "TP53"], "test-vm-version")
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["INS", "ERBB2"] }),
      }),
      buildEnv({ kvStore, db: null, cardArtifact: null, onKvGet: (key) => kvGets.push(key) }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.data_source, "published_card_catalog")
  assert.equal(payload.diagnostics.artifact_gene_count, 4)
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["INS", "ERBB2"],
  )
  assert.deepEqual(kvGets.filter((key) => key.includes(":shard:")).sort(), [
    "iconoplasm:card-catalog:test-vm-version:shard:1",
    "iconoplasm:card-catalog:test-vm-version:shard:2",
  ])
})

test("mobile card manifest fails loud when the published card catalog artifact is unavailable", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["INS"] }),
      }),
      buildEnv({ kvStore: new Map(), db: new FakeIconoplasmDb(), cardArtifact: null }),
    )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "artifact-unavailable")
  assert.equal(response.headers.get("X-Iconoplasm-Snapshot-State"), "card-artifact-unavailable")
  const payload = await response.json()
  assert.equal(payload.code, "CARD_ARTIFACT_UNAVAILABLE")
  assert.equal(payload.artifact_version, "test-vm-version")
})

test("mobile card manifest does not fall back to a previous card catalog version", async () => {
  const barrier = JSON.stringify({
    current: "current-vm-version",
    previous: "previous-vm-version",
    schema: "iconoplasm.mobileCard.v1",
    status: "active",
  })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["INS"] }),
      }),
      buildEnv({
        db: null,
        version: barrier,
        cardArtifact: completeCardCatalogArtifact(["INS"], "previous-vm-version"),
      }),
    )
  assert.equal(response.status, 503)
  const payload = await response.json()
  assert.equal(payload.code, "CARD_ARTIFACT_UNAVAILABLE")
  assert.equal(payload.artifact_version, "current-vm-version")
})

test("admin card catalog publish refuses symbol-scoped artifacts", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const kvStore = new Map()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/card-vms/warm", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ symbols: ["ERBB2"] }),
      }),
      buildEnv({ kvStore }),
    )
  assert.equal(response.status, 409)
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.code, "CARD_ARTIFACT_REQUIRES_FULL_CATALOG")
  assert.equal(payload.supported_scope, "catalog")
  assert.equal(kvStore.size, 0)
})

test("admin card catalog publish preserves the molecular companion fields used by existing card renderers", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const kvStore = new Map()
  const env = buildEnv({ kvStore, cardArtifact: null })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/card-vms/warm", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope: "catalog" }),
      }),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)

  const artifactVersion = payload.artifact_version
  assert.match(artifactVersion, /^ccv1-[a-f0-9]{32}$/)
  const manifest = JSON.parse(kvStore.get(`iconoplasm:card-catalog:${artifactVersion}`))
  const shard = JSON.parse(kvStore.get(manifest.shards[0].key))
  const erbb2 = shard.cards.find((card) => card.symbol === "ERBB2")
  const ins = shard.cards.find((card) => card.symbol === "INS")

  assert.ok(erbb2, "published artifact should contain ERBB2")
  assert.equal(erbb2.payload.molecular_weight_kda, 137.9)
  assert.equal(erbb2.payload.first_publication_year, 1985)
  assert.equal(erbb2.payload.primary_tissue, "ubiquitous")
  assert.equal(erbb2.field_status.category, "present")
  assert.equal(erbb2.field_status.age, "present")
  assert.equal(erbb2.field_status.weight, "present")

  assert.ok(ins, "published artifact should contain INS")
  assert.equal(ins.payload.molecular_weight_kda, 12)
  assert.equal(ins.payload.first_publication_year, 1959)
  assert.equal(ins.payload.primary_tissue, "tissue-specific")
})

test("admin card catalog publish does not count failed KV writes as published cards", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/card-vms/warm", {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-admin-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope: "catalog" }),
      }),
      {
        ...buildEnv(),
        KV: {
          async get(key) {
            if (key === "iconoplasm:gallery-version") return "test-vm-version"
            return null
          },
          async put() {
            throw new Error("KV write failed")
          },
        },
      },
    )
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, "CARD_ARTIFACT_UNAVAILABLE")
})

test("card catalog records do not copy raw sample prose into public card payloads", () => {
  const start = source.indexOf("function cardCatalogRecordFromJoinedRow")
  const end = source.indexOf("async function cardCatalogRecordsForArtifact", start)
  assert.notEqual(start, -1, "missing card catalog row mapper")
  assert.notEqual(end, -1, "missing card catalog row mapper boundary")
  const block = source.slice(start, end)

  assert.doesNotMatch(
    block,
    /manifestation:\s*String\(row\.manifestation\)|description:\s*String\(row\.manifestation\)/,
    "published card payloads must not expose raw sample prose",
  )
})

test("card catalog mapper copies public card companion fields from the synced read model", () => {
  const start = source.indexOf("function cardCatalogRecordFromJoinedRow")
  const end = source.indexOf("async function cardCatalogRecordsForArtifact", start)
  assert.notEqual(start, -1, "missing card catalog row mapper")
  assert.notEqual(end, -1, "missing card catalog row mapper boundary")
  const block = source.slice(start, end)

  assert.match(block, /row\?\.molecular_weight_kda/)
  assert.match(block, /row\?\.first_publication_year/)
  assert.match(block, /row\?\.primary_tissue/)
  assert.match(block, /sample_label:\s*sanitizeText\(row\?\.sample_label \|\| "", 64\) \|\| null/)
  assert.match(block, /sample_number:\s*optionalInt\(row\?\.sample_number\)/)
  assert.match(
    block,
    /sample_text_hash:\s*normalizeSha256\(row\?\.sample_text_hash \|\| ""\) \|\| null/,
  )
  assert.doesNotMatch(
    block,
    /2020\s*-|DEMOGRAPHIC_MAPPING_BASE_YEAR|tissueTau\s*>=|optionalFloat\(row\?\.weight_kg/,
    "card artifacts should not rebuild renderer companion facts path-locally",
  )
})

test("card catalog artifact query carries public portrait sample provenance", () => {
  const start = source.indexOf("async function cardCatalogRecordsForArtifact")
  const end = source.indexOf("function galleryCanUseEdgeCache", start)
  assert.notEqual(start, -1, "missing card catalog artifact query")
  assert.notEqual(end, -1, "missing card catalog artifact query boundary")
  const block = source.slice(start, end)

  assert.match(block, /pa\.sample_label/)
  assert.match(block, /pa\.sample_number/)
  assert.match(block, /pa\.sample_text_hash/)
})

test("admin card VM warm endpoint keeps catalog warming behind admin auth", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/card-vms/warm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "catalog", limit: 2 }),
      }),
      buildEnv(),
    )
  assert.equal(response.status, 403)
})

test("mobile manifest route is wired before the generic /api/iconoplasm proxy", () => {
  const start = source.indexOf('if (path === "/api/iconoplasm/mobile-card-manifest")')
  const generic = source.indexOf('if (path.startsWith("/api/iconoplasm/"))')
  assert.notEqual(start, -1, "missing mobile manifest route")
  assert.notEqual(generic, -1, "missing generic iconoplasm route")
  assert.ok(start < generic, "mobile manifest must not fall through to the legacy generic handler")
})

test("mobile manifest runtime block does not call per-gene KV or D1 composition", () => {
  const start = source.indexOf("async function handleMobileCardManifest")
  const end = source.indexOf("function mobileCardSymbolClientHeaders", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = source.slice(start, end)
  assert.doesNotMatch(block, /readMobileCardVMFromSharedSnapshot/)
  assert.doesNotMatch(block, /writeMobileCardVMToSharedSnapshot/)
  assert.doesNotMatch(block, /composeAndCacheMobileCardVMs/)
  assert.doesNotMatch(block, /geneRecord\(/)
  assert.match(block, /readPublishedCardCatalogArtifact/)
})

test("frontend mobile path uses the card catalog manifest and rejects fallback records", () => {
  assert.match(appSource, /function assertCompleteMobileCardVM\(card\)/)
  assert.match(appSource, /\/api\/iconoplasm\/mobile-card-manifest/)
  assert.match(appSource, /card\.__complete !== true/)
  assert.match(source, /KV_CARD_CATALOG_ARTIFACT_PREFIX/)
  assert.match(source, /readPublishedCardCatalogArtifact/)
  assert.doesNotMatch(source, /KV_MOBILE_CARD_VM_PREFIX/)
  assert.doesNotMatch(source, /composeAndCacheMobileCardVMs/)
  assert.doesNotMatch(source, /readMobileCardVMFromSharedSnapshot/)
  assert.doesNotMatch(source, /writeMobileCardVMToSharedSnapshot/)
  const mobileBranch = appSource.slice(
    appSource.indexOf("return loadMobileCardPageVM(pageEntries)"),
    appSource.indexOf(
      "if (orderEl)",
      appSource.indexOf("return loadMobileCardPageVM(pageEntries)"),
    ),
  )
  assert.doesNotMatch(
    mobileBranch,
    /fallbackDiscoveredGene|loadDiscoveredGeneCardData|hydrateBrickCards/,
    "mobile collection branch must not render fallback cards or rely on later card hydration",
  )
})

test("gallery invalidation publishes a validated card catalog before flipping the live version", () => {
  assert.match(source, /async function runCardCatalogStagingRebuildChunk/)
  assert.match(source, /CARD_CATALOG_ARTIFACT_SCHEMA/)
  assert.match(source, /ICONOPLASM_STARTER_GENE_SYMBOLS/)
  assert.match(source, /\/api\/iconoplasm\/admin\/card-vms\/warm/)
  assert.match(source, /await warmCatalogCache\(env\)/)
  assert.match(source, /Array\.from\(catalogCache\.bySymbol\.keys\(\)\)/)
  // Build-before-flip invariant: the card-catalog artifact (incremental or full,
  // via the smart publisher) must be produced before KV_GALLERY_VERSION is moved.
  assert.match(
    source,
    /const cardCatalog = await publishCardCatalogArtifactSmart\(env,[\s\S]*publishGalleryVersionBarrier\(env, barrier\)/,
  )
  // ONE publish path: the smart publisher routes cold/large/scattered deltas to
  // the bounded, content-addressed staging rebuild — no legacy full builder.
  assert.match(source, /async function publishCardCatalogArtifactSmart/)
  assert.match(source, /return runCardCatalogStagingRebuildChunk\(env, \{/)
  assert.match(source, /CARD_CATALOG_CONTENT_ADDRESSED_STORAGE/)
  assert.match(source, /CARD_ARTIFACT_REQUIRES_FULL_CATALOG/)
  assert.match(source, /published_card_catalog/)
  // The legacy version-keyed full publisher and its writer are gone — assert they
  // can't creep back as a parallel path.
  assert.doesNotMatch(source, /async function publishCardCatalogArtifact\(/)
  assert.doesNotMatch(source, /async function writeCardCatalogArtifactToKV/)
  assert.doesNotMatch(source, /:shard:\$\{index\}/)
  assert.doesNotMatch(
    source,
    /const warmedSymbols = await mobileCardSnapshotWarmSymbolsForInvalidation/,
    "gallery invalidation must not warm per-gene mobile-card KV after publishing the card catalog",
  )
  assert.doesNotMatch(
    source,
    /readMobileCardVMFromSharedSnapshot\(env, versionInfo\.previous/,
    "runtime card loading must not probe a previous version fallback",
  )
})
