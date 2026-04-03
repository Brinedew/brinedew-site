import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

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
      const row = this.db.catalog.get(symbol)
      return row ? { ...row } : null
    }

    if (
      this.sql.includes("FROM icono_publish_state ps") &&
      this.sql.includes("LEFT JOIN icono_portrait_assets pa")
    ) {
      const symbol = String(this.args[0] || "").trim().toUpperCase()
      const row = this.db.published.get(symbol)
      return row ? { ...row } : null
    }

    if (this.sql.includes("FROM icono_gene_essence")) {
      return null
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
        "A1BG",
        {
          gene_symbol: "A1BG",
          full_name: "alpha-1-B glycoprotein",
          uniprot: "P04217",
          color_hex: "#dd8c9d",
          tmh: 0,
          aliases_json: "[]",
          updated_at: "2026-04-04 00:00:00",
        },
      ],
    ])
    this.published = new Map([
      [
        "A1BG",
        {
          asset_sha256: "4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212",
          r2_key_full:
            "portraits/v1/47/4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212/full.webp",
          r2_key_medium:
            "portraits/v1/47/4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212/medium.webp",
          r2_key_thumb:
            "portraits/v1/47/4713c9ed62d593a88fc73239fc9409d1486d149a456c78a1e6b5cbdcd9cff212/thumb.webp",
          width: 384,
          height: 512,
          vision_id: "anima-v1-2397",
          candidate_image_id: 4155,
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
    DB: null,
  }
}

test("public gene payload includes published portrait dimensions", async () => {
  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/genes/A1BG"),
    buildEnv(),
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.portrait?.status, "published")
  assert.equal(payload?.portrait?.width, 384)
  assert.equal(payload?.portrait?.height, 512)
})

test("public media payload includes published portrait dimensions", async () => {
  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/media/A1BG"),
    buildEnv(),
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.media?.width, 384)
  assert.equal(payload?.media?.height, 512)
})
