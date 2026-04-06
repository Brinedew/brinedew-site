import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

class FakeRequestStatement {
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
    if (this.sql.includes("FROM icono_admin_vision_rollup")) {
      this.db.visionRollupReads += 1
      return {
        results: [
          {
            vision_id: "anima-v1-3001",
            image_count: 10,
            live_count: 5,
          },
        ],
      }
    }

    if (this.sql.includes("FROM icono_generation_requests gr")) {
      this.db.requestReads += 1
      return {
        results: [
          {
            id: 1,
            gene_symbol: "A1BG",
            full_name: "alpha-1-B glycoprotein",
            requester_user_id: "user-1",
            requester_username: "tester",
            request_mode: "random",
            requested_vision_id: "",
            status: "open",
            created_at: "2026-04-04T10:00:00Z",
            updated_at: "2026-04-04T10:00:00Z",
            fulfilled_at: "",
            fulfilled_by: "",
            fulfilled_asset_sha256: "",
            fulfilled_vision_id: "",
            fulfillment_note: "",
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

class FakeRequestDb {
  constructor() {
    this.requestReads = 0
    this.visionRollupReads = 0
  }

  prepare(sql) {
    return new FakeRequestStatement(this, sql)
  }
}

function buildEnv() {
  return {
    ICONOPLASM_DB: new FakeRequestDb(),
    GAME_SESSIONS: null,
  }
}

test("anonymous gene request state skips the vision-options rollup", async () => {
  const env = buildEnv()
  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/requests/gene/A1BG"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, false)
  assert.deepEqual(payload.request_options, [])
  assert.equal(env.ICONOPLASM_DB.requestReads, 1)
  assert.equal(env.ICONOPLASM_DB.visionRollupReads, 0)
  assert.equal(payload.gene_lane_summary[0]?.request_count, 1)
})
