import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const source = readFileSync(
  new URL("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js", import.meta.url),
  "utf8",
)
const appSource = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

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
      const symbol = String(this.args[0] || "").trim().toUpperCase()
      return this.db.catalog.get(symbol) || null
    }
    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      const symbol = String(this.args[0] || "").trim().toUpperCase()
      return this.db.published.get(symbol) || null
    }
    if (this.sql.includes("FROM icono_gene_essence")) {
      const symbol = String(this.args[0] || "").trim().toUpperCase()
      return this.db.essence.get(symbol) || null
    }
    return null
  }

  async all() {
    if (
      this.sql.includes("SELECT gene_symbol") &&
      this.sql.includes("FROM icono_gene_catalog") &&
      this.sql.includes("WHERE gene_symbol > ?")
    ) {
      const cursor = String(this.args[0] || "").trim().toUpperCase()
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
          weight_kg: null,
          height_cm: null,
          sex: "male",
          age: null,
          age_years: 35,
          faction: "pro-growth",
          skin_hex: "#423D37",
          skin_name: "Mocha Black",
          tissue_tau: 0.26,
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
          manifestation: "",
        },
      ],
      [
        "INS",
        {
          full_name: "insulin",
          weight_kg: null,
          height_cm: null,
          sex: "female",
          age: null,
          age_years: 61,
          faction: "",
          skin_hex: "#B0304A",
          skin_name: "Ruby",
          tissue_tau: 0.11,
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

function buildEnv({ kvStore = new Map(), db = new FakeIconoplasmDb(), version = "test-vm-version" } = {}) {
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    KV: {
      async get(key) {
        if (key === "iconoplasm:gallery-version") return version
        return kvStore.get(key) || null
      },
      async put(key, value) {
        kvStore.set(key, value)
      },
    },
    ICONOPLASM_PORTRAIT_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  }
}

function completeMobileCardVM(symbol = "ERBB2", version = "test-vm-version", dataSource = "kv_snapshot") {
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
    },
    payload: {
      symbol: normalized,
      full_name: fullName,
      color: normalized === "INS" ? "#B0304A" : "#423D37",
      portrait: { status: "published" },
      essence: { faction: normalized === "INS" ? "" : "pro-growth" },
    },
  }
}

test("mobile card manifest returns complete VMs from KV without pending portrait placeholders", async () => {
  const kvStore = new Map([
    [
      "iconoplasm:mobile-card-vm:test-vm-version:ERBB2",
      JSON.stringify(completeMobileCardVM("ERBB2")),
    ],
  ])
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["ERBB2"] }),
    }),
    buildEnv({ kvStore, db: null }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "kv-snapshot")
  const payload = await response.json()
  assert.equal(payload.schema, "iconoplasm.mobileCardManifest.v1")
  assert.equal(payload.snapshot_version, "test-vm-version")
  assert.deepEqual(payload.missing, [])
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
  assert.equal(card.payload.essence.faction, "pro-growth")
})

test("mobile card manifest never composes missing public cards from D1", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["INS"] }),
    }),
    buildEnv({ kvStore: new Map(), db: new FakeIconoplasmDb() }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "snapshot-missing")
  assert.equal(response.headers.get("X-Iconoplasm-Snapshot-State"), "snapshot-missing")
  const payload = await response.json()
  assert.equal(payload.data_source, "snapshot_missing")
  assert.deepEqual(payload.missing, ["INS"])
  assert.equal(payload.cards.length, 0)
  assert.equal(payload.diagnostics.d1_composed, 0)
})

test("mobile card manifest falls back to previous version without D1", async () => {
  const kvStore = new Map([
    [
      "iconoplasm:mobile-card-vm:previous-vm-version:INS",
      JSON.stringify(completeMobileCardVM("INS", "previous-vm-version")),
    ],
  ])
  const barrier = JSON.stringify({
    current: "current-vm-version",
    previous: "previous-vm-version",
    schema: "iconoplasm.mobileCard.v1",
    status: "active",
  })
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["INS"] }),
    }),
    buildEnv({ kvStore, db: null, version: barrier }),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "kv-previous")
  const payload = await response.json()
  assert.equal(payload.snapshot_version, "current-vm-version")
  assert.equal(payload.data_source, "kv_previous")
  assert.equal(payload.diagnostics.fallback_version_used, "previous-vm-version")
  assert.equal(payload.diagnostics.kv_keys_missing, 1)
  assert.equal(payload.diagnostics.kv_previous_hits, 1)
  assert.equal(payload.diagnostics.d1_composed, 0)
  assert.deepEqual(payload.missing, [])
  assert.equal(payload.cards[0].symbol, "INS")
  assert.equal(payload.cards[0].data_source, "kv_previous")
})

test("admin card VM warm endpoint fills bounded symbol chunks", async () => {
  const kvStore = new Map()
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
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
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.scope, "symbols")
  assert.equal(payload.requested, 1)
  assert.equal(payload.warmed, 1)
  assert.equal(payload.missing, 0)
  assert.equal(payload.next_cursor, "ERBB2")
  const manifestResponse = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["ERBB2"] }),
    }),
    buildEnv({ kvStore }),
  )
  const manifest = await manifestResponse.json()
  assert.deepEqual(manifest.missing, [])
  assert.equal(manifest.cards.length, 1)
  assert.deepEqual(
    manifest.cards.map((card) => card.symbol),
    ["ERBB2"],
  )
})

test("admin card VM warm endpoint keeps catalog warming behind admin auth", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
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

test("frontend mobile path uses card VM manifest and rejects fallback records", () => {
  assert.match(appSource, /function assertCompleteMobileCardVM\(card\)/)
  assert.match(appSource, /\/api\/iconoplasm\/mobile-card-manifest/)
  assert.match(appSource, /card\.__complete !== true/)
  assert.match(source, /KV_MOBILE_CARD_VM_PREFIX/)
  assert.match(source, /readMobileCardVMFromSharedSnapshot/)
  assert.match(source, /writeMobileCardVMToSharedSnapshot/)
  const mobileBranch = appSource.slice(
    appSource.indexOf("return loadMobileCardPageVM(pageEntries)"),
    appSource.indexOf("if (orderEl)", appSource.indexOf("return loadMobileCardPageVM(pageEntries)")),
  )
  assert.doesNotMatch(
    mobileBranch,
    /fallbackDiscoveredGene|loadDiscoveredGeneCardData|hydrateBrickCards/,
    "mobile collection branch must not render fallback cards or rely on later card hydration",
  )
})

test("gallery invalidation warms a real shared card VM snapshot instead of an empty version", () => {
  assert.match(source, /async function mobileCardSnapshotWarmSymbolsForInvalidation/)
  assert.match(source, /async function warmMobileCardSnapshotSymbols/)
  assert.match(source, /ICONOPLASM_STARTER_GENE_SYMBOLS/)
  assert.match(source, /\/api\/iconoplasm\/admin\/card-vms\/warm/)
  assert.match(source, /await warmCatalogCache\(env\)/)
  assert.match(source, /Array\.from\(catalogCache\.bySymbol\.keys\(\)\)/)
  assert.match(source, /const warmedSymbols = await mobileCardSnapshotWarmSymbolsForInvalidation/)
  assert.match(source, /if \(fullRebuild\) \{[\s\S]*catalogSymbolsForMobileCardSnapshotWarm/)
  assert.doesNotMatch(source, /void fullRebuild/)
  assert.match(source, /scope === "catalog"/)
  assert.match(source, /mobile_card_vms:/)
  assert.doesNotMatch(
    source,
    /const warmedSymbols = Array\.from\(new Set\(symbols\.map/,
    "snapshot warm set must not be only the narrow touched-symbol array",
  )
})
