import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

class FakeStatement {
  constructor(sql) {
    this.sql = String(sql || "")
  }

  bind() {
    return this
  }

  async all() {
    if (this.sql.includes("FROM icono_portrait_assets")) {
      return { results: [] }
    }
    throw new Error(`Unexpected SQL in fake DB all(): ${this.sql}`)
  }

  async first() {
    return null
  }

  async run() {
    throw new Error(`Unexpected SQL in fake DB run(): ${this.sql}`)
  }
}

class FakeIconoplasmDb {
  prepare(sql) {
    return new FakeStatement(sql)
  }
}

class FakePortraitBucket {
  async head() {
    return { etag: "already-present" }
  }

  async put() {
    throw new Error("Dry-run ingest should not upload portrait bytes")
  }
}

function buildEnv() {
  return {
    ICONOPLASM_ADMIN_TOKEN: "secret-admin-token",
    ICONOPLASM_DB: new FakeIconoplasmDb(),
    ICONOPLASM_PORTRAITS: new FakePortraitBucket(),
  }
}

test("admin ingest dry-run accepts a normal sync payload without crashing", async () => {
  const request = new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/ingest", {
    method: "POST",
    headers: {
      Authorization: "Bearer secret-admin-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dry_run: true,
      defer_read_models: true,
      items: [
        {
          symbol: "ABCA1",
          asset_sha256: "bc77289ec8c179a2847351b2250fcb08dce316fddd8ebafb4a30b6a2376c41f6",
        },
      ],
    }),
  })

  const response = await handleIconoplasmRequest(request, buildEnv(), {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.processed, 1)
  assert.equal(payload?.failed, 0)
  assert.equal(payload?.results?.[0]?.ok, true)
  assert.equal(payload?.results?.[0]?.symbol, "ABCA1")
  assert.equal(payload?.results?.[0]?.blacklisted, false)
  assert.equal(payload?.results?.[0]?.blacklist_reason, null)
})
