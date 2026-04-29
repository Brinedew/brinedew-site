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
    ])
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function buildEnv() {
  return {
    ICONOPLASM_DB: new FakeIconoplasmDb(),
    KV: {
      async get(key) {
        if (key === "iconoplasm:gallery-version") return "test-vm-version"
        return null
      },
    },
    ICONOPLASM_PORTRAIT_BASE_URL: "https://iconoplasmportraits.b-cdn.net",
  }
}

test("mobile card manifest returns complete VMs without pending portrait placeholders", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/mobile-card-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: "mobile-dossier-v1", symbols: ["ERBB2"] }),
    }),
    buildEnv(),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "request-composed")
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
