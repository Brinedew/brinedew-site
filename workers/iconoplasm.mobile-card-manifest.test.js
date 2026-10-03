import assert from "node:assert/strict"
import test from "node:test"

import {
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
  mergePublishedPortraitRefsIntoArtifact,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  listIconoplasmTestKv,
  seedIconoplasmTestRecognitionPair,
} from "./iconoplasm-recognition-policy-test-fixture.js"
import {
  installStableGeneStorage,
  stableGeneObjectFromRecord,
  stableGeneObjectPath,
  stableGeneStorageEnv,
} from "./test-helpers/stable-gene-objects.js"

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
          const blot = this.db.blots.get(symbol) || {}
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
            gene_blot_fingerprint: blot.blot_fingerprint,
            gene_blot_portrait_asset_sha256: blot.portrait_asset_sha256,
            gene_blot_asset_sha256: blot.blot_asset_sha256,
            gene_blot_object_key: blot.object_key,
            gene_blot_width: blot.width,
            gene_blot_height: blot.height,
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
    if (
      this.sql.includes("icono_published_gene_routes") ||
      this.sql.includes("icono_card_catalog_publication_audit")
    ) {
      return { success: true, meta: { changes: 0 } }
    }
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  constructor() {
    this.changedSymbols = []
    this.maxEventAt = "2026-05-10 00:00:00"
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
      [
        "PTEN",
        {
          gene_symbol: "PTEN",
          full_name: "phosphatase and tensin homolog",
          uniprot: "P60484",
          color_hex: "#495254",
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
      [
        "PTEN",
        {
          asset_sha256: "c8".repeat(32),
          width: 882,
          height: 1134,
          vision_id: "anima-v1-343",
          candidate_image_id: 55228,
          emulsion_id: "A1-343",
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
      [
        "PTEN",
        {
          full_name:
            "Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase and dual-specificity protein phosphatase PTEN",
          weight_kg: 47.2,
          molecular_weight_kda: 47.2,
          height_cm: 40,
          sex: "female",
          age: "25",
          age_years: 25,
          first_publication_year: 1995,
          faction: "pro-control",
          skin_hex: "#495254",
          skin_name: "Diamond Grey",
          tissue_tau: 0.21,
          primary_tissue: "ubiquitous",
          loeuf: 0.685,
          constraint_percentile: 72.77,
          aesthetics_json: JSON.stringify(["Electro Swing", "Metrosexual"]),
          aesthetics_origin_json: JSON.stringify(["C2 domain", "Phosphatase"]),
          politics_origin_json: JSON.stringify(["tumor suppressor"]),
          family_surname: "PTEN",
          family_members: 1,
          family_feature: "",
          manifestation: "",
        },
      ],
    ])
    this.blots = new Map()
    for (const symbol of this.catalog.keys()) this.materializeBlot(symbol)
  }

  materializeBlot(symbolValue) {
    const symbol = String(symbolValue || "")
      .trim()
      .toUpperCase()
    const catalog = this.catalog.get(symbol)
    const portrait = this.published.get(symbol)
    if (!catalog || !portrait?.asset_sha256) {
      this.blots.delete(symbol)
      return
    }
    const blotFingerprint = iconoplasmGeneBlotFingerprint({
      symbol,
      full_name: catalog.full_name,
      portrait: { status: "published", asset_sha256: portrait.asset_sha256 },
    })
    this.blots.set(symbol, {
      blot_fingerprint: blotFingerprint,
      portrait_asset_sha256: portrait.asset_sha256,
      blot_asset_sha256: "ef".repeat(32),
      object_key: iconoplasmGeneBlotObjectKey(symbol, blotFingerprint),
      width: 768,
      height: 1024,
    })
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
    `iconoplasm:hydrated-catalog-artifact:a5c1:${hash}-a5c1`,
    JSON.stringify(mergePublishedPortraitRefsIntoArtifact({ schema_version: 4, genes }, [])),
  )
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

// B-898 Stage 1 (step B): mobile card manifest, the per-symbol card endpoint
// and the print-copy path read ONE stable gene object per symbol from Bunny
// Storage. Failure modes these tests cover, written before the handlers
// changed:
//   1. Objects present: 200, complete VMs built from the objects, exactly one
//      storage read per requested symbol, zero reads of the KV head
//      (iconoplasm:gallery-version) or any card-catalog manifest/shard key.
//   2. Object missing (storage 404): the symbol lands in `missing`; the
//      per-symbol endpoint answers 404 after trying alias resolution.
//   3. Storage error (5xx): 503 CARD_ARTIFACT_UNAVAILABLE, no-store, with the
//      stable label as artifact_version.
//   4. Symbol limit (100 per manifest request) unchanged: a request past it
//      reads only the first 100 objects.
//   5. Print copy reads the same object and keeps its asset-mismatch 409
//      without any D1 fallback.
let stableStorage = null

function stableObjectForSymbol(symbol, version = "test-vm-version") {
  return stableGeneObjectFromRecord(
    completeMobileCardVM(symbol, version, "published_card_catalog").payload,
  )
}

function seedStableGeneObjects(symbols, version = "test-vm-version") {
  for (const symbol of symbols) {
    stableStorage.objects.set(String(symbol).toUpperCase(), stableObjectForSymbol(symbol, version))
  }
}

test.beforeEach(() => {
  stableStorage = installStableGeneStorage(new Map())
  seedStableGeneObjects(["ERBB2", "INS"])
})

test.afterEach(() => {
  stableStorage?.restore()
  stableStorage = null
})

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
  const recognitionPairReady = seedIconoplasmTestRecognitionPair(kvStore)
  return {
    ...stableGeneStorageEnv(),
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    KV: {
      async get(key) {
        await recognitionPairReady
        if (typeof onKvGet === "function") onKvGet(key)
        if (kvStore.has(key)) return kvStore.get(key)
        if (key === "iconoplasm:gallery-version") return version
        if (key === `iconoplasm:card-catalog:${version}` && cardArtifact) {
          return JSON.stringify(cardArtifact)
        }
        return kvStore.get(key) || null
      },
      async put(key, value) {
        await recognitionPairReady
        if (typeof onKvPut === "function") onKvPut(key, value)
        kvStore.set(key, value)
        return true
      },
      async list(options) {
        await recognitionPairReady
        return listIconoplasmTestKv(kvStore, options)
      },
    },
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
    ...extraEnv,
  }
}

function completeMobileCardVM(
  symbol = "ERBB2",
  version = "test-vm-version",
  dataSource = "kv_snapshot",
) {
  const normalized = String(symbol || "ERBB2").toUpperCase()
  const fullName = normalized === "INS" ? "insulin" : "erb-b2 receptor tyrosine kinase 2"
  const portraitUrl = `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`
  const portraitAssetSha = normalized === "INS" ? "9c".repeat(32) : "7b".repeat(32)
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
      url: portraitUrl,
      full_url: portraitUrl,
      thumb_url: portraitUrl,
      width: 768,
      height: 1024,
      asset_sha256: portraitAssetSha,
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
      portrait: {
        status: "published",
        hero_url: portraitUrl,
        medium_url: portraitUrl,
        thumb_url: portraitUrl,
        width: 768,
        height: 1024,
        asset_sha256: portraitAssetSha,
      },
      molecular_weight_kda: normalized === "INS" ? 12 : 137.9,
      first_publication_year: normalized === "INS" ? 1959 : 1985,
      primary_tissue: normalized === "INS" ? "tissue-specific" : "ubiquitous",
      essence: {
        age_years: normalized === "INS" ? 61 : 35,
        weight_kg: normalized === "INS" ? 12 : 137.9,
        tissue_tau: normalized === "INS" ? 0.87 : 0.26,
        faction: normalized === "INS" ? "" : "pro-growth",
        // field_status is derived from the payload by the runtime; the
        // fixture must carry what it claims is present.
        family_surname: normalized === "INS" ? "insulin family" : "ErbB receptor family",
      },
    },
  }
}

test("print-copy accepts only the stable gene object's portrait and never falls back to D1", async () => {
  const db = new FakeIconoplasmDb()
  const d1OnlyAssetSha = "8d".repeat(32)
  const artifactAssetSha = "7b".repeat(32)
  db.published.set("ERBB2", {
    ...db.published.get("ERBB2"),
    asset_sha256: d1OnlyAssetSha,
  })
  let d1PrepareCalls = 0
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    d1PrepareCalls += 1
    return prepare(sql)
  }
  const env = buildEnv({ db, cardArtifact: null })

  const mismatchResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/print-copy/ERBB2.png?asset=${d1OnlyAssetSha}`,
      ),
      env,
    )
  const mismatchPayload = await mismatchResponse.json()

  assert.equal(mismatchResponse.status, 409)
  assert.equal(mismatchResponse.headers.get("Cache-Control"), "no-store")
  assert.equal(mismatchPayload.code, "PRINT_COPY_ASSET_MISMATCH")
  assert.equal(mismatchPayload.requested_asset_sha256, d1OnlyAssetSha)
  assert.equal(mismatchPayload.published_asset_sha256, artifactAssetSha)
  assert.equal(mismatchPayload.snapshot_version, "stable-v3")
  assert.deepEqual(stableStorage.reads, [stableGeneObjectPath("ERBB2")])
  assert.equal(d1PrepareCalls, 0, "a mismatched asset must not trigger the removed D1 fallback")

  const invalidResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/print-copy/ERBB2.png?asset=not-a-sha",
      ),
      env,
    )
  assert.equal(invalidResponse.status, 400)
  assert.equal((await invalidResponse.json()).code, "INVALID_PRINT_COPY_ASSET")
  assert.equal(d1PrepareCalls, 0)

  const exactArtifactResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/print-copy/ERBB2.png?asset=${artifactAssetSha}`,
        { method: "HEAD" },
      ),
      env,
    )
  assert.equal(exactArtifactResponse.status, 404)
  assert.equal(exactArtifactResponse.headers.get("Cache-Control"), "no-store")
  assert.equal(exactArtifactResponse.headers.get("X-Iconoplasm-Print-Copy-Renderer"), null)
})

test("mobile card manifest returns complete VMs from the stable gene objects", async () => {
  const kvGets = []
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["ERBB2"] }),
      }),
      buildEnv({ db: null, cardArtifact: null, onKvGet: (key) => kvGets.push(key) }),
    )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "stable-gene-object")
  const payload = await response.json()
  assert.equal(payload.schema, "iconoplasm.mobileCardManifest.v1")
  assert.equal(payload.snapshot_version, "stable-v3")
  assert.equal(payload.data_source, "stable_gene_object")
  assert.deepEqual(payload.missing, [])
  assert.equal(payload.diagnostics.artifact_version, "stable-v3")
  assert.equal(payload.diagnostics.source, "stable_gene_object")
  assert.equal(payload.cards.length, 1)
  assert.deepEqual(stableStorage.reads, [stableGeneObjectPath("ERBB2")])
  assert.deepEqual(
    kvGets.filter((key) => key === "iconoplasm:gallery-version" || key.includes("card-catalog")),
    [],
    "the manifest must not read the KV head or any card-catalog key",
  )
  const card = payload.cards[0]
  assert.equal(card.__complete, true)
  assert.equal(card.schema_version, "iconoplasm.mobileCard.v1")
  assert.equal(card.snapshot_version, "2026-10-01T13:53:49.742Z")
  assert.equal(card.data_source, "stable_gene_object")
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

test("mobile card symbol endpoint resolves aliases when the requested symbol has no stable object", async () => {
  const kvStore = new Map()
  putCatalogResolveArtifact(kvStore)
  seedStableGeneObjects(["SOSTDC1"])
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/USAG1"),
      buildEnv({ kvStore, db: null, cardArtifact: null }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "stable-gene-object")
  assert.equal(payload?.card?.symbol, "SOSTDC1")
  assert.equal(payload?.card?.payload?.symbol, "SOSTDC1")
  assert.equal(payload?.snapshot_version, "stable-v3")
  assert.equal(Object.hasOwn(payload, "payload"), false)
  assert.deepEqual(payload?.missing, [])
  // The alias miss costs one 404 read, the canonical hit one more; nothing else.
  assert.deepEqual(stableStorage.reads, [
    stableGeneObjectPath("USAG1"),
    stableGeneObjectPath("SOSTDC1"),
  ])
})

test("mobile card symbol endpoint answers 404 when neither the symbol nor an alias has a stable object", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/NOPE1"),
      buildEnv({ db: null, cardArtifact: null }),
    )
  const payload = await response.json()

  assert.equal(response.status, 404)
  assert.equal(payload.card, null)
  assert.deepEqual(payload.missing, ["NOPE1"])
  assert.deepEqual(stableStorage.reads, [stableGeneObjectPath("NOPE1")])
})

test("mobile card symbol endpoint fails loud with 503 no-store when storage errors", async () => {
  stableStorage.restore()
  stableStorage = installStableGeneStorage(new Map(), { status: 500 })
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/ERBB2"),
      buildEnv({ db: null, cardArtifact: null }),
    )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "artifact-unavailable")
  assert.equal((await response.json()).code, "CARD_ARTIFACT_UNAVAILABLE")
})

test("mobile card manifest keeps its 100-symbol limit and reads at most one object per accepted symbol", async () => {
  const symbols = Array.from({ length: 120 }, (_, index) => `G${String(index).padStart(4, "0")}`)
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: "mobile-dossier-v1", symbols }),
      }),
      buildEnv({ db: null, cardArtifact: null }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.cards.length, 0)
  assert.equal(payload.missing.length, 100)
  assert.equal(stableStorage.reads.length, 100)
  assert.equal(new Set(stableStorage.reads).size, 100)
})

test("mobile card manifest fails loud when stable object storage errors", async () => {
  resetIconoplasmRuntimeCachesForTest()
  stableStorage.restore()
  stableStorage = installStableGeneStorage(new Map(), { status: 500 })
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
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "artifact-unavailable")
  assert.equal(response.headers.get("X-Iconoplasm-Snapshot-State"), "card-artifact-unavailable")
  const payload = await response.json()
  assert.equal(payload.code, "CARD_ARTIFACT_UNAVAILABLE")
  assert.equal(payload.artifact_version, "stable-v3")
})

// The print-copy renderer reads the stable gene object the per-gene publisher composes; its
// name is the HGNC name when UniProt differs.
test("print-copy renders the HGNC gene name from the stable gene object", async () => {
  resetIconoplasmRuntimeCachesForTest()
  const kvStore = new Map()
  const pten = completeMobileCardVM("PTEN", "stable-v3")
  pten.full_name = "phosphatase and tensin homolog"
  pten.payload = {
    ...pten.payload,
    full_name: "phosphatase and tensin homolog",
    essence: { ...(pten.payload.essence || {}), name: "phosphatase and tensin homolog" },
  }
  stableStorage.objects.set("PTEN", stableGeneObjectFromRecord(pten.payload))
  resetIconoplasmRuntimeCachesForTest()
  const printCopyRender =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/print-copy-render/PTEN?v=stable-v3&asset=${"7b".repeat(32)}`,
      ),
      buildEnv({ kvStore, cardArtifact: null }),
    )
  const printCopyHtml = await printCopyRender.text()

  assert.equal(printCopyRender.status, 200)
  assert.match(printCopyHtml, /phosphatase and tensin homolog/)
  assert.doesNotMatch(printCopyHtml, /Phosphatidylinositol 3,4,5-trisphosphate 3-phosphatase/)
})
