import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

class FakeDiscoveryStatement {
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
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("FROM icono_gene_discoveries")) {
      const [userId, geneSymbol] = this.args
      return this.db.getDiscovery(userId, geneSymbol)
    }
    throw new Error(`Unexpected SQL in fake discovery DB first(): ${this.sql}`)
  }

  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    if (this.sql.includes("INSERT INTO icono_gene_discoveries")) {
      this.db.insertDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    if (this.sql.includes("UPDATE icono_gene_discoveries")) {
      this.db.updateDiscovery(this.args)
      return { success: true, meta: { changes: 1 } }
    }
    throw new Error(`Unexpected SQL in fake discovery DB run(): ${this.sql}`)
  }

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    throw new Error(`Unexpected SQL in fake discovery DB all(): ${this.sql}`)
  }
}

class FakeDiscoveryDb {
  constructor() {
    this.calls = []
    this.rows = new Map()
    this.tick = 0
  }

  prepare(sql) {
    return new FakeDiscoveryStatement(this, sql)
  }

  key(userId, geneSymbol) {
    return `${String(userId)}|${String(geneSymbol).toUpperCase()}`
  }

  now() {
    this.tick += 1
    return `2025-04-01T00:00:${String(this.tick).padStart(2, "0")}Z`
  }

  getDiscovery(userId, geneSymbol) {
    const row = this.rows.get(this.key(userId, geneSymbol))
    return row ? { ...row } : null
  }

  insertDiscovery(args) {
    const [userId, geneSymbol, firstSource, lastSource, firstTrigger, lastTrigger, firstDwellMs, lastDwellMs] = args
    const timestamp = this.now()
    this.rows.set(this.key(userId, geneSymbol), {
      user_id: String(userId),
      gene_symbol: String(geneSymbol).toUpperCase(),
      first_discovered_at: timestamp,
      last_encountered_at: timestamp,
      encounter_count: 1,
      first_source: String(firstSource),
      last_source: String(lastSource),
      first_trigger: String(firstTrigger),
      last_trigger: String(lastTrigger),
      first_dwell_ms: Number(firstDwellMs),
      last_dwell_ms: Number(lastDwellMs),
    })
  }

  updateDiscovery(args) {
    const [lastSource, lastTrigger, lastDwellMs, userId, geneSymbol] = args
    const key = this.key(userId, geneSymbol)
    const existing = this.rows.get(key)
    if (!existing) {
      throw new Error(`Cannot update missing discovery row for ${key}`)
    }
    this.rows.set(key, {
      ...existing,
      last_encountered_at: this.now(),
      encounter_count: Number(existing.encounter_count || 0) + 1,
      last_source: String(lastSource),
      last_trigger: String(lastTrigger),
      last_dwell_ms: Number(lastDwellMs),
    })
  }
}

class FakeGameSessions {
  constructor(sessions = {}) {
    this.sessions = sessions
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    const session = this.sessions[String(id || "")]
    return {
      fetch: async () => {
        if (!session) {
          return new Response("missing", { status: 404 })
        }
        return Response.json(session)
      },
    }
  }
}

function buildEnv({ sessions } = {}) {
  return {
    ICONOPLASM_DB: new FakeDiscoveryDb(),
    GAME_SESSIONS: new FakeGameSessions(sessions),
  }
}

function buildEncounterRequest({ cookie = "", symbol = "TP53", dwellMs = 900 } = {}) {
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/encounter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      symbol,
      source: "extension_hover",
      trigger: "hover_dwell",
      dwell_ms: dwellMs,
    }),
  })
}

test("discovery encounter quietly skips writes for signed-out visitors", async () => {
  const env = buildEnv()
  const response = await handleIconoplasmRequest(buildEncounterRequest(), env, {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, false)
  assert.equal(payload?.recorded, false)
  assert.equal(env.ICONOPLASM_DB.rows.size, 0)
})

test("discovery encounter inserts the first authenticated gene discovery", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  const response = await handleIconoplasmRequest(
    buildEncounterRequest({ cookie: "session=abc" }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, true)
  assert.equal(payload?.recorded, true)
  assert.equal(payload?.created, true)
  assert.equal(payload?.discovery?.gene_symbol, "TP53")
  assert.equal(payload?.discovery?.encounter_count, 1)

  const stored = env.ICONOPLASM_DB.getDiscovery("user-123", "TP53")
  assert.ok(stored)
  assert.equal(stored?.first_source, "extension_hover")
  assert.equal(stored?.first_trigger, "hover_dwell")
  assert.equal(stored?.first_dwell_ms, 900)
})

test("discovery encounter increments count instead of duplicating the row", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })

  const firstResponse = await handleIconoplasmRequest(
    buildEncounterRequest({ cookie: "session=abc", dwellMs: 900 }),
    env,
    {},
  )
  const firstPayload = await firstResponse.json()

  const secondResponse = await handleIconoplasmRequest(
    buildEncounterRequest({ cookie: "session=abc", dwellMs: 1200 }),
    env,
    {},
  )
  const secondPayload = await secondResponse.json()

  assert.equal(firstPayload?.created, true)
  assert.equal(secondResponse.status, 200)
  assert.equal(secondPayload?.ok, true)
  assert.equal(secondPayload?.authenticated, true)
  assert.equal(secondPayload?.created, false)
  assert.equal(secondPayload?.discovery?.encounter_count, 2)
  assert.equal(secondPayload?.discovery?.first_dwell_ms, 900)
  assert.equal(secondPayload?.discovery?.last_dwell_ms, 1200)

  const stored = env.ICONOPLASM_DB.getDiscovery("user-123", "TP53")
  assert.ok(stored)
  assert.equal(stored?.encounter_count, 2)
  assert.equal(stored?.first_discovered_at, firstPayload?.discovery?.first_discovered_at)
  assert.equal(stored?.last_dwell_ms, 1200)
})