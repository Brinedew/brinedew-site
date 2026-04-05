import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequest } from "./iconoplasm.js"

function sortSymbols(values) {
  return (Array.isArray(values) ? values : []).slice().sort()
}

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
    if (this.sql.includes("FROM icono_gene_catalog gc")) {
      const [userId] = this.args
      return {
        results: this.db.listAllCatalogDiscoveries(userId),
      }
    }
    if (this.sql.includes("FROM icono_gene_discoveries d")) {
      const [userId] = this.args
      return {
        results: this.db.listDiscoveries(userId),
      }
    }
    throw new Error(`Unexpected SQL in fake discovery DB all(): ${this.sql}`)
  }
}

class FakeDiscoveryDb {
  constructor() {
    this.calls = []
    this.rows = new Map()
    this.tick = 0
    this.geneNames = new Map([
      ["INS", "Insulin"],
      ["RHO", "Rhodopsin"],
      ["PRL", "Prolactin"],
      ["TP53", "Tumor protein p53"],
      ["BRCA1", "BRCA1 DNA repair associated"],
      ["EGFR", "Epidermal growth factor receptor"],
      ["FURIN", "Furin"],
      ["NRM", "Nurim"],
    ])
    this.geneMetrics = new Map([
      ["INS", { weight_kg: 5.1, age_years: 2.4, uniqueness_rank: 7, image_upvotes: 2, image_downvotes: 0, image_score: 2, published_at: "2025-04-01T00:00:01Z", asset_created_at: "2025-04-01T00:00:01Z" }],
      ["RHO", { weight_kg: 6.3, age_years: 3.8, uniqueness_rank: 4, image_upvotes: 8, image_downvotes: 1, image_score: 7, published_at: "2025-04-01T00:00:02Z", asset_created_at: "2025-04-01T00:00:02Z" }],
      ["PRL", { weight_kg: 4.4, age_years: 1.9, uniqueness_rank: 10, image_upvotes: 1, image_downvotes: 0, image_score: 1, published_at: "2025-04-01T00:00:03Z", asset_created_at: "2025-04-01T00:00:03Z" }],
      ["TP53", { weight_kg: 9.9, age_years: 12.2, uniqueness_rank: 2, image_upvotes: 20, image_downvotes: 2, image_score: 18, published_at: "2025-04-01T00:00:04Z", asset_created_at: "2025-04-01T00:00:04Z" }],
      ["BRCA1", { weight_kg: 7.7, age_years: 8.1, uniqueness_rank: 5, image_upvotes: 14, image_downvotes: 3, image_score: 11, published_at: "2025-04-01T00:00:05Z", asset_created_at: "2025-04-01T00:00:05Z" }],
      ["EGFR", { weight_kg: 3.6, age_years: 6.5, uniqueness_rank: 8, image_upvotes: 4, image_downvotes: 1, image_score: 3, published_at: "2025-04-01T00:00:06Z", asset_created_at: "2025-04-01T00:00:06Z" }],
      ["FURIN", { weight_kg: 8.4, age_years: 4.5, uniqueness_rank: 3, image_upvotes: 17, image_downvotes: 1, image_score: 16, published_at: "2025-04-01T00:00:07Z", asset_created_at: "2025-04-01T00:00:07Z" }],
      ["NRM", { weight_kg: 2.8, age_years: 9.4, uniqueness_rank: 6, image_upvotes: 6, image_downvotes: 0, image_score: 6, published_at: "2025-04-01T00:00:08Z", asset_created_at: "2025-04-01T00:00:08Z" }],
    ])
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
    return row ? this.enrichDiscoveryRow(row) : null
  }

  enrichDiscoveryRow(row) {
    const symbol = String(row?.gene_symbol || "").toUpperCase()
    return {
      ...row,
      full_name: this.geneNames.get(symbol) || symbol,
      ...(this.geneMetrics.get(symbol) || {}),
    }
  }

  listDiscoveries(userId) {
    return Array.from(this.rows.values())
      .filter((row) => row.user_id === String(userId))
      .sort((left, right) => {
        return String(left.first_discovered_at || "").localeCompare(String(right.first_discovered_at || "")) ||
          String(left.gene_symbol || "").localeCompare(String(right.gene_symbol || ""))
      })
      .map((row) => this.enrichDiscoveryRow(row))
  }

  listAllCatalogDiscoveries(userId) {
    return Array.from(this.geneNames.entries())
      .sort((left, right) => String(left[0] || "").localeCompare(String(right[0] || "")))
      .map(([geneSymbol, fullName]) => {
        const existing = this.getDiscovery(userId, geneSymbol)
        return {
          gene_symbol: geneSymbol,
          full_name: fullName,
          first_discovered_at: existing?.first_discovered_at || "",
          last_encountered_at: existing?.last_encountered_at || "",
          encounter_count: existing?.encounter_count || 0,
          first_source: existing?.first_source || "",
          last_source: existing?.last_source || "",
          first_trigger: existing?.first_trigger || "",
          last_trigger: existing?.last_trigger || "",
          first_dwell_ms: existing?.first_dwell_ms ?? null,
          last_dwell_ms: existing?.last_dwell_ms ?? null,
          ...(this.geneMetrics.get(geneSymbol) || {}),
        }
      })
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
    ICONOPLASM_ADMIN_TOKEN: "admin-token",
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
  assert.equal(env.ICONOPLASM_DB.rows.size, 4)
  assert.ok(env.ICONOPLASM_DB.getDiscovery("user-123", "INS"))
  assert.ok(env.ICONOPLASM_DB.getDiscovery("user-123", "RHO"))
  assert.ok(env.ICONOPLASM_DB.getDiscovery("user-123", "PRL"))
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

test("discoveries me returns the signed-in user's discovered symbols", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "TP53" }), env, {})
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "BRCA1" }), env, {})

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me", {
      method: "GET",
      headers: { Cookie: "session=abc" },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, true)
  assert.equal(payload?.order, "newest")
  assert.deepEqual(sortSymbols(payload?.discovered_symbols), ["BRCA1", "INS", "PRL", "RHO", "TP53"])
  assert.equal(payload?.discovered_count, 5)
  assert.equal(
    payload?.discoveries?.find((row) => row.gene_symbol === "TP53")?.full_name,
    "Tumor protein p53",
  )
  assert.equal(payload?.show_all_applied, false)
})

test("discoveries me honors gallery-style sort orders on the shelf", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "TP53" }), env, {})
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "BRCA1" }), env, {})
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "EGFR" }), env, {})

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me?order=heaviest", {
      method: "GET",
      headers: { Cookie: "session=abc" },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.order, "heaviest")
  assert.deepEqual(
    payload?.discoveries?.map((row) => row.gene_symbol),
    ["TP53", "BRCA1", "RHO", "INS", "PRL", "EGFR"],
  )
})

test("discoveries me seeds the starter trio for an empty signed-in shelf", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me", {
      method: "GET",
      headers: { Cookie: "session=abc" },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.authenticated, true)
  assert.equal(payload?.discovered_count, 3)
  assert.deepEqual(sortSymbols(payload?.discovered_symbols), ["INS", "PRL", "RHO"])
  assert.ok(payload?.discoveries?.every((row) => row.first_source === "starter_seed"))
  assert.ok(payload?.discoveries?.every((row) => row.first_trigger === "starter_seed"))
})

test("discoveries me ignores show-all requests from non-admin users", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "TP53" }), env, {})

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me?show_all=1", {
      method: "GET",
      headers: { Cookie: "session=abc" },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.show_all_requested, true)
  assert.equal(payload?.show_all_applied, false)
  assert.deepEqual(sortSymbols(payload?.discovered_symbols), ["INS", "PRL", "RHO", "TP53"])
})

test("discoveries me lets admins override their shelf with the full catalog", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "TP53" }), env, {})

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me?show_all=1", {
      method: "GET",
      headers: {
        Cookie: "session=abc",
        "x-iconoplasm-admin-token": "admin-token",
      },
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.show_all_requested, true)
  assert.equal(payload?.show_all_applied, true)
  assert.equal(payload?.discovered_count, 8)
  assert.ok(payload?.discovered_symbols.includes("FURIN"))
  assert.ok(payload?.discovered_symbols.includes("INS"))
  assert.equal(
    payload?.discoveries?.find((row) => row.gene_symbol === "TP53")?.full_name,
    "Tumor protein p53",
  )
})

test("discoveries merge upserts guest-local symbols into the signed-in account", async () => {
  const env = buildEnv({
    sessions: {
      "session:abc": { user_id: "user-123", username: "alex" },
    },
  })
  await handleIconoplasmRequest(buildEncounterRequest({ cookie: "session=abc", symbol: "TP53" }), env, {})

  const response = await handleIconoplasmRequest(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/merge", {
      method: "POST",
      headers: {
        Cookie: "session=abc",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbols: ["BRCA1", "TP53", "BRCA1", "EGFR"] }),
    }),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, true)
  assert.equal(payload?.merged_count, 3)
  assert.deepEqual(sortSymbols(payload?.discovered_symbols), ["BRCA1", "EGFR", "INS", "PRL", "RHO", "TP53"])
  assert.equal(payload?.discovered_count, 6)

  const stored = env.ICONOPLASM_DB.listDiscoveries("user-123")
  assert.equal(stored.length, 6)
})