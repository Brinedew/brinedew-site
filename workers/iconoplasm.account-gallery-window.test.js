import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { ICONOPLASM_ROUTE_CONTRACTS } from "./iconoplasm-route-contract.js"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./iconoplasm/discovery-compact-store.js"

const source = readFileSync(
  new URL(
    "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)

// Real SQLite under the route handlers. Discovery fixtures are seeded into the
// compact representation (membership bitmap, chronology events, shared arrays)
// exactly as a migrated account would look.
function epochSeconds(value) {
  const ms = Date.parse(String(value || ""))
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
}

function base64Bytes(bytes) {
  return Buffer.from(bytes).toString("base64")
}

class FakeStatement {
  constructor(db, sql, args = []) {
    this.db = db
    this.sql = String(sql || "")
    this.args = args
  }

  bind(...args) {
    return new FakeStatement(this.db, this.sql, args)
  }

  async first() {
    this.db.calls.push({ method: "first", sql: this.sql, args: this.args })
    return this.db.raw.prepare(this.sql).get(...this.args) ?? null
  }

  async run() {
    this.db.calls.push({ method: "run", sql: this.sql, args: this.args })
    const info = this.db.raw.prepare(this.sql).run(...this.args)
    return { success: true, meta: { changes: Number(info.changes || 0) } }
  }

  async all() {
    this.db.calls.push({ method: "all", sql: this.sql, args: this.args })
    return { results: this.db.raw.prepare(this.sql).all(...this.args) }
  }
}

class FakeDb {
  constructor() {
    this.calls = []
    this.raw = new DatabaseSync(":memory:")
    this.raw.exec(DISCOVERY_COMPACT_SCHEMA_SQL)
    this.raw.exec(`
      CREATE TABLE icono_gene_catalog (
        gene_symbol TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        uniprot TEXT,
        color_hex TEXT,
        tmh INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        updated_by TEXT,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE icono_gene_essence (
        gene_symbol TEXT PRIMARY KEY,
        full_name TEXT,
        weight_kg REAL,
        age_years REAL,
        leakage_percent REAL
      );
      CREATE TABLE icono_admin_gene_rollup (
        gene_symbol TEXT PRIMARY KEY,
        live_upvotes INTEGER NOT NULL DEFAULT 0,
        live_downvotes INTEGER NOT NULL DEFAULT 0,
        live_score INTEGER NOT NULL DEFAULT 0,
        live_created_at TEXT,
        current_asset_sha256 TEXT
      );
      CREATE TABLE icono_shared_gene_discoveries (
        gene_symbol TEXT PRIMARY KEY,
        first_non_admin_discovered_at TEXT,
        latest_non_admin_encountered_at TEXT,
        non_admin_discoverer_count INTEGER NOT NULL DEFAULT 0,
        non_admin_encounter_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT
      );
      CREATE TABLE icono_gene_discoveries (
        user_id TEXT NOT NULL,
        gene_symbol TEXT NOT NULL,
        first_discovered_at TEXT NOT NULL,
        last_encountered_at TEXT NOT NULL,
        encounter_count INTEGER NOT NULL DEFAULT 1,
        first_source TEXT,
        last_source TEXT,
        first_trigger TEXT,
        last_trigger TEXT,
        first_dwell_ms INTEGER,
        last_dwell_ms INTEGER,
        PRIMARY KEY (user_id, gene_symbol)
      );
    `)
    this.rows = [
      this.row("user-123", "INS", "2026-01-03T00:00:00Z", 2),
      this.row("user-123", "PRL", "2026-01-02T00:00:00Z", 1),
      this.row("user-123", "RHO", "2026-01-01T00:00:00Z", 7),
      this.row("user-123", "TP53", "2026-01-05T00:00:00Z", 18),
      this.row("user-123", "BRCA1", "2026-01-04T00:00:00Z", 11),
    ]
  }

  get rows() {
    return this._rows
  }

  set rows(value) {
    this._rows = Array.isArray(value) ? value : []
    this.syncCompactState()
  }

  row(userId, symbol, lastEncounteredAt, score, firstDiscoveredAt = lastEncounteredAt) {
    return {
      user_id: userId,
      gene_symbol: symbol,
      first_discovered_at: firstDiscoveredAt,
      last_encountered_at: lastEncounteredAt,
      encounter_count: 1,
      first_source: "test",
      last_source: "test",
      first_trigger: "test",
      last_trigger: "test",
      image_score: score,
    }
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = statements.map((statement) => {
        const prepared = this.raw.prepare(statement.sql)
        if (
          /^\s*(SELECT|WITH|PRAGMA)/i.test(statement.sql) ||
          /\bRETURNING\b/i.test(statement.sql)
        ) {
          return { results: prepared.all(...statement.args) }
        }
        const info = prepared.run(...statement.args)
        return { results: [], meta: { changes: Number(info.changes || 0) } }
      })
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }

  discovery(userId, symbol) {
    return this.rows.find(
      (row) => row.user_id === String(userId) && row.gene_symbol === String(symbol).toUpperCase(),
    )
  }

  enrich(row) {
    return {
      ...row,
      full_name: `${row.gene_symbol} full name`,
      weight_kg: null,
      age_years: null,
      uniqueness_rank: null,
      image_upvotes: Math.max(0, Number(row.image_score || 0)),
      image_downvotes: 0,
      published_at: row.last_encountered_at,
      asset_created_at: row.last_encountered_at,
      asset_sha256: "7b".repeat(32),
      image_width: 384,
      image_height: 512,
    }
  }

  sharedRows() {
    const adminUserId = "founder-admin"
    const bySymbol = new Map()
    for (const row of this.rows) {
      if (row.user_id === adminUserId) continue
      const existing = bySymbol.get(row.gene_symbol)
      if (!existing) {
        bySymbol.set(row.gene_symbol, {
          ...row,
          user_id: "",
          encounter_count: Number(row.encounter_count || 0) || 0,
        })
        continue
      }
      if (String(row.first_discovered_at || "") < String(existing.first_discovered_at || "")) {
        existing.first_discovered_at = row.first_discovered_at
      }
      if (String(row.last_encountered_at || "") > String(existing.last_encountered_at || "")) {
        existing.last_encountered_at = row.last_encountered_at
      }
      existing.encounter_count += Number(row.encounter_count || 0) || 0
    }
    return Array.from(bySymbol.values())
  }

  syncCompactState() {
    this.raw.exec(`
      DELETE FROM icono_discovery_user_state_v2;
      DELETE FROM icono_discovery_ordinals_v2;
      DELETE FROM icono_discovery_dictionary_meta_v2;
      DELETE FROM icono_gene_catalog;
      DELETE FROM icono_gene_essence;
      DELETE FROM icono_admin_gene_rollup;
    `)
    const symbols = [...new Set(this.rows.map((row) => String(row.gene_symbol).toUpperCase()))]
      .filter(Boolean)
      .sort()
    const ordinalBySymbol = new Map(symbols.map((symbol, index) => [symbol, index]))
    const insertOrdinal = this.raw.prepare(
      "INSERT INTO icono_discovery_ordinals_v2 (name, ordinal, canonical, active) VALUES (?, ?, ?, 1)",
    )
    const insertCatalog = this.raw.prepare(
      "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)",
    )
    for (const symbol of symbols) {
      insertOrdinal.run(symbol, ordinalBySymbol.get(symbol), symbol)
      insertCatalog.run(symbol, `${symbol} full name`)
    }
    this.raw
      .prepare(
        "INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at) VALUES (1, 1, CURRENT_TIMESTAMP)",
      )
      .run()

    const userRows = new Map()
    const maxOrdinal = Math.max(0, symbols.length - 1)
    const byteLength = Math.ceil((maxOrdinal + 1) / 8)
    for (const row of this.rows) {
      const userId = String(row.user_id)
      const symbol = String(row.gene_symbol).toUpperCase()
      const ordinal = ordinalBySymbol.get(symbol)
      if (ordinal == null) continue
      let user = userRows.get(userId)
      if (!user) {
        user = {
          membership: new Uint8Array(byteLength),
          memberCount: 0,
          events: [],
          nextEventSeq: 1,
        }
        userRows.set(userId, user)
      }
      const byte = ordinal >> 3
      const mask = 1 << (ordinal & 7)
      if (!(user.membership[byte] & mask)) {
        user.membership[byte] |= mask
        user.memberCount += 1
      }
      const count = Math.max(1, Number(row.encounter_count) || 1)
      for (let index = 0; index < count; index++) {
        user.events.push({
          seq: user.nextEventSeq++,
          ordinal,
          symbol,
          at:
            index === 0
              ? epochSeconds(row.first_discovered_at)
              : epochSeconds(row.last_encountered_at),
          source: index === 0 ? String(row.first_source || "") : String(row.last_source || ""),
          trigger: index === 0 ? String(row.first_trigger || "") : String(row.last_trigger || ""),
          dwell_ms: null,
        })
      }
    }
    const insertUser = this.raw.prepare(
      `INSERT INTO icono_discovery_user_state_v2 (
        user_id, dictionary_version, state_version, membership_b64, member_count,
        next_event_seq, next_chunk_seq, active_events_json, recent_receipts_json, last_batch_id
      ) VALUES (?, 1, 1, ?, ?, ?, 1, ?, '[]', 'migrated')`,
    )
    for (const [userId, user] of userRows) {
      insertUser.run(
        userId,
        base64Bytes(user.membership),
        user.memberCount,
        user.nextEventSeq,
        JSON.stringify(user.events),
      )
    }

    const arrayLength = maxOrdinal + 1
    const discoverers = new Uint32Array(arrayLength)
    const encounters = new Uint32Array(arrayLength)
    const firstAt = new Uint32Array(arrayLength)
    const latestAt = new Uint32Array(arrayLength)
    for (const row of this.sharedRows()) {
      const ordinal = ordinalBySymbol.get(String(row.gene_symbol).toUpperCase())
      if (ordinal == null) continue
      discoverers[ordinal] = Number(row.encounter_count ? 1 : 0) || 1
      encounters[ordinal] = Number(row.encounter_count || 0) || 1
      firstAt[ordinal] = epochSeconds(row.first_discovered_at)
      latestAt[ordinal] = epochSeconds(row.last_encountered_at)
    }
    this.raw
      .prepare(
        `UPDATE icono_discovery_shared_state_v2 SET
          dictionary_version = 1, state_version = 1,
          discoverer_counts_b64 = ?, encounter_counts_b64 = ?,
          first_at_b64 = ?, latest_at_b64 = ?`,
      )
      .run(
        base64Bytes(new Uint8Array(discoverers.buffer)),
        base64Bytes(new Uint8Array(encounters.buffer)),
        base64Bytes(new Uint8Array(firstAt.buffer)),
        base64Bytes(new Uint8Array(latestAt.buffer)),
      )
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
      fetch: async () =>
        session ? Response.json(session) : new Response("missing", { status: 404 }),
    }
  }
}

function completeMobileCardVM(symbol, version = "test-vm-version") {
  const normalized = String(symbol || "").toUpperCase()
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: version,
    data_source: "published_card_catalog",
    symbol: normalized,
    full_name: `${normalized} full name`,
    display_color: "#423D37",
    portrait: {
      status: "published",
      url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
      width: 768,
      height: 1024,
      asset_sha256: "7b".repeat(32),
      candidate_image_id: 1,
      vision_id: "artist-random-v1",
      emulsion_id: `A1-${normalized}`,
    },
    field_status: {
      symbol: "present",
      full_name: "present",
      color: "present",
      portrait: "present",
    },
    payload: {
      symbol: normalized,
      full_name: `${normalized} full name`,
      color: "#423D37",
      portrait: {
        status: "published",
        hero_url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
        medium_url: `https://iconoplasmportraits.b-cdn.net/${normalized}.jpg`,
        asset_sha256: "7b".repeat(32),
      },
    },
  }
}

function completeCardCatalogArtifact(symbols, version = "test-vm-version") {
  const cards = symbols.map((symbol) => completeMobileCardVM(symbol, version))
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

function buildEnv({ db = new FakeDb(), version = "test-vm-version" } = {}) {
  resetIconoplasmRuntimeCachesForTest()
  const symbols = ["INS", "PRL", "RHO", "TP53", "BRCA1"]
  const portraitAssetSha = "7b".repeat(32)
  const portraitFingerprint = {
    published_count: symbols.length,
    latest: portraitAssetSha,
  }
  const kvStore = new Map([
    [
      `iconoplasm:card-catalog:${version}`,
      JSON.stringify(completeCardCatalogArtifact(symbols, version)),
    ],
    [
      "iconoplasm:published-portrait-fingerprint:v3",
      JSON.stringify({ cached_at: Date.now(), fingerprint: portraitFingerprint }),
    ],
    [
      `iconoplasm:published-portrait-refs:v3-${symbols.length}-${portraitAssetSha}`,
      JSON.stringify(
        symbols.map((symbol) => ({
          symbol,
          asset_sha256: portraitAssetSha,
        })),
      ),
    ],
  ])
  return {
    ICONOPLASM_DB: db,
    ADMIN_DISCORD_USER_ID: "founder-admin",
    GAME_SESSIONS: new FakeGameSessions({
      "session:abc": { user_id: "user-123", username: "alex" },
    }),
    KV: {
      async get(key) {
        if (key === "iconoplasm:gallery-version") return version
        return kvStore.get(key) || null
      },
      async put(key, value) {
        kvStore.set(key, value)
      },
    },
  }
}

test("account gallery window returns strict rich cards for newest without full shelf sort", async () => {
  const db = new FakeDb()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      buildEnv({ db }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.schema, "iconoplasm.accountGalleryWindow.v2")
  assert.equal(payload.order, "newest")
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["TP53", "BRCA1"],
  )
  assert.equal(payload.has_more, true)
  assert.equal(payload.discovered_count, 5)
  assert.ok(payload.next_cursor)
  assert.equal(payload.diagnostics.d1_composed, 0)
  assert.equal(payload.diagnostics.d1_window_rows, 2)
  assert.equal(payload.diagnostics.source, "published_card_catalog")
  assert.equal(payload.diagnostics.artifact_version, "test-vm-version")
  assert.equal(payload.missing.length, 0)
  assert.equal(payload.items[0]?.card, undefined)
  const serverTiming = response.headers.get("Server-Timing") || ""
  for (const stage of [
    "acct_session",
    "acct_starter",
    "acct_window",
    "acct_count",
    "acct_version",
    "acct_catalog",
  ]) {
    assert.match(serverTiming, new RegExp(`${stage};dur=`))
  }
  assert.equal(
    db.calls.some((call) => call.sql.includes("FROM icono_gene_discoveries")),
    false,
    "the personal window must read compact state, never legacy discovery rows",
  )
})

test("account gallery newest window orders by first discovery, not repeat encounters", async () => {
  const db = new FakeDb()
  const oldHover = db.row("user-123", "OLDHOVER", "2026-05-02T00:00:00Z", 4, "2026-04-01T00:00:00Z")
  oldHover.encounter_count = 2
  db.rows = [
    db.row("user-123", "INS", "2026-01-03T00:00:00Z", 2),
    db.row("user-123", "PRL", "2026-01-02T00:00:00Z", 1),
    db.row("user-123", "RHO", "2026-01-01T00:00:00Z", 7),
    oldHover,
    db.row("user-123", "NEWDISC", "2026-05-01T00:00:00Z", 5, "2026-05-01T00:00:00Z"),
    db.row("user-123", "MIDDISC", "2026-04-15T00:00:00Z", 3, "2026-04-15T00:00:00Z"),
  ]
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-first-discovery" })
  env.KV.put(
    "iconoplasm:card-catalog:test-vm-version-first-discovery",
    JSON.stringify(
      completeCardCatalogArtifact(
        db.rows.map((row) => row.gene_symbol),
        "test-vm-version-first-discovery",
      ),
    ),
  )

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=3",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["NEWDISC", "MIDDISC", "OLDHOVER"],
  )
  assert.equal(payload.items[2]?.discovery?.first_discovered_at, "2026-04-01T00:00:00Z")
  assert.equal(payload.items[2]?.discovery?.last_encountered_at, "2026-05-02T00:00:00Z")
})

test("account gallery newest window puts the newly discovered 101st gene first", async () => {
  const db = new FakeDb()
  db.rows = ["INS", "RHO", "PRL"].map((symbol, index) =>
    db.row("user-123", symbol, `2026-04-29T00:0${index}:00Z`, index),
  )
  db.rows = db.rows.concat(
    Array.from({ length: 97 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0")
      return db.row("user-123", `G${number}`, `2026-04-29T00:${number.slice(1)}:00Z`, index)
    }),
  )
  db.rows = db.rows.concat(db.row("user-123", "NEW101", "2026-04-30T00:00:00Z", 0))
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-101" })
  const allSymbols = db.rows.map((row) => row.gene_symbol)
  env.KV.put(
    "iconoplasm:card-catalog:test-vm-version-101",
    JSON.stringify(completeCardCatalogArtifact(allSymbols, "test-vm-version-101")),
  )

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=3",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.discovered_count, 101)
  assert.equal(payload.cards[0]?.symbol, "NEW101")
  assert.equal(payload.items[0]?.discovery?.last_encountered_at, "2026-04-30T00:00:00Z")
})

test("shared account gallery window pages non-admin discoveries from the shared rollup", async () => {
  const db = new FakeDb()
  db.rows = [
    db.row("founder-admin", "ADMINONLY", "2026-05-05T00:00:00Z", 9),
    db.row("founder-admin", "INS", "2026-05-04T00:00:00Z", 8),
    db.row("user-456", "INS", "2026-05-03T00:00:00Z", 7),
    db.row("user-789", "GCK", "2026-05-02T00:00:00Z", 6),
    db.row("user-456", "PRL", "2026-05-01T00:00:00Z", 5),
  ]
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-shared" })
  env.KV.put(
    "iconoplasm:card-catalog:test-vm-version-shared",
    JSON.stringify(completeCardCatalogArtifact(["INS", "GCK", "PRL"], "test-vm-version-shared")),
  )

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2&scope=shared",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.scope, "shared")
  assert.equal(payload.discovered_count, 3)
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["INS", "GCK"],
  )
  assert.ok(!payload.cards.some((card) => card.symbol === "ADMINONLY"))
  assert.match(response.headers.get("Server-Timing") || "", /acct_shared_window;dur=/)
  assert.doesNotMatch(response.headers.get("Server-Timing") || "", /acct_starter;dur=/)
  assert.equal(
    db.calls.some((call) => call.sql.includes("FROM icono_shared_gene_discoveries")),
    false,
    "the shared window must read compact shared state, never the legacy rollup table",
  )
})

test("guest shared account gallery window is public read-only discovery browsing", async () => {
  const db = new FakeDb()
  db.rows = [
    db.row("user-456", "INS", "2026-05-03T00:00:00Z", 7),
    db.row("user-789", "GCK", "2026-05-02T00:00:00Z", 6),
    db.row("founder-admin", "ADMINONLY", "2026-05-01T00:00:00Z", 5),
  ]
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-guest-shared" })
  env.KV.put(
    "iconoplasm:card-catalog:test-vm-version-guest-shared",
    JSON.stringify(completeCardCatalogArtifact(["INS", "GCK"], "test-vm-version-guest-shared")),
  )

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2&scope=shared",
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, false)
  assert.equal(payload.user, null)
  assert.equal(payload.scope, "shared")
  assert.equal(payload.discovered_count, 2)
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["INS", "GCK"],
  )
  assert.doesNotMatch(response.headers.get("Server-Timing") || "", /acct_starter;dur=/)
})

test("shared discovery read-model rebuild is admin-only and excludes the configured admin user", async () => {
  const db = new FakeDb()
  db.rows = [
    db.row("founder-admin", "ADMINONLY", "2026-05-05T00:00:00Z", 9),
    db.row("user-456", "INS", "2026-05-03T00:00:00Z", 7),
    db.row("user-789", "GCK", "2026-05-02T00:00:00Z", 6),
  ]
  const env = buildEnv({ db })
  env.GAME_SESSIONS = new FakeGameSessions({
    "session:abc": { user_id: "founder-admin", username: "founder" },
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/read-models/shared-discoveries",
        {
          method: "POST",
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.admin_user_excluded, true)
  assert.equal(payload.discovered_count, 2)
  assert.ok(Number(payload.rebuilt_deliveries) >= 2)
  assert.equal(
    db.calls.some((call) => call.sql.includes("icono_shared_gene_discoveries")),
    false,
    "the repair must rebuild compact shared state without the legacy rollup table",
  )
})

test("image-only account gallery window projects compact cards from the canonical card artifact", async () => {
  const db = new FakeDb()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2&view=image-only",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      buildEnv({ db }),
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.view, "image-only")
  assert.equal(payload.diagnostics.source, "published_card_catalog_image_only")
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["TP53", "BRCA1"],
  )
  assert.equal(payload.cards[0]?.portrait?.status, "published")
  assert.match(payload.cards[0]?.pt || "", /\/portraits\/v1\/7b\//)
  assert.equal(payload.cards[0]?.portrait?.asset_sha256, "7b".repeat(32))
  assert.equal(payload.cards[0]?.ph, undefined)
  assert.equal(payload.cards[0]?.portrait?.hero_url, undefined)
  assert.equal(payload.cards[0]?.portrait?.medium_url, undefined)
  assert.equal(payload.cards[0]?.width, 768)
  assert.equal(payload.cards[0]?.height, 1024)
  assert.notEqual(payload.cards[0]?.schema_version, "iconoplasm.mobileCard.v1")
  assert.match(response.headers.get("Server-Timing") || "", /acct_catalog/)
  assert.doesNotMatch(response.headers.get("Server-Timing") || "", /acct_portrait_refs/)
})

// ARCHITECTURE FENCE [IPD-011]
// Keep both discarded sources stale on purpose. This test must fail if an agent
// restores either the discovery-row SHA or the legacy published-portrait-ref
// snapshot as the image-only account gallery authority.
test("image-only account gallery ignores stale discovery and legacy portrait-ref identities", async () => {
  const db = new FakeDb()
  const staleRowSha = "95".repeat(32)
  const publishedSha = "fb".repeat(32)
  db.enrich = (row) => ({
    ...row,
    full_name: `${row.gene_symbol} full name`,
    asset_sha256: staleRowSha,
    image_width: 384,
    image_height: 512,
  })
  const env = buildEnv({ db, version: "test-published-identity" })
  const canonicalArtifact = completeCardCatalogArtifact(
    ["INS", "PRL", "RHO", "TP53", "BRCA1"],
    "test-published-identity",
  )
  for (const card of canonicalArtifact.cards) {
    card.portrait.asset_sha256 = publishedSha
    card.payload.portrait.asset_sha256 = publishedSha
  }
  await env.KV.put(
    "iconoplasm:card-catalog:test-published-identity",
    JSON.stringify(canonicalArtifact),
  )
  await env.KV.put(
    `iconoplasm:published-portrait-fingerprint:v3`,
    JSON.stringify({
      fingerprint: { published_count: 5, latest: staleRowSha },
    }),
  )
  await env.KV.put(
    `iconoplasm:published-portrait-refs:v3-5-${staleRowSha}`,
    JSON.stringify(
      ["INS", "PRL", "RHO", "TP53", "BRCA1"].map((symbol) => ({
        symbol,
        asset_sha256: staleRowSha,
      })),
    ),
  )
  resetIconoplasmRuntimeCachesForTest()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2&view=image-only",
        { headers: { Cookie: "session=abc" } },
      ),
      env,
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.match(payload.cards[0].pt, new RegExp(`/portraits/v1/fb/${publishedSha}/medium\\.webp$`))
  assert.equal(payload.cards[0].portrait.asset_sha256, publishedSha)
  assert.notEqual(payload.cards[0].portrait.asset_sha256, staleRowSha)
})

test("account gallery window paginates symbol order with a stable cursor", async () => {
  const env = buildEnv()
  const first =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const firstPayload = await first.json()
  const second =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2&after=${encodeURIComponent(firstPayload.next_cursor)}`,
        { headers: { Cookie: "session=abc" } },
      ),
      env,
    )
  const secondPayload = await second.json()

  assert.deepEqual(
    firstPayload.cards.map((card) => card.symbol),
    ["BRCA1", "INS"],
  )
  assert.deepEqual(
    secondPayload.cards.map((card) => card.symbol),
    ["PRL", "RHO"],
  )
  assert.equal(secondPayload.has_previous, true)
  assert.ok(secondPayload.previous_cursor)

  const previous =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2&before=${encodeURIComponent(secondPayload.previous_cursor)}`,
        { headers: { Cookie: "session=abc" } },
      ),
      env,
    )
  const previousPayload = await previous.json()
  assert.deepEqual(
    previousPayload.cards.map((card) => card.symbol),
    ["BRCA1", "INS"],
  )
  assert.equal(previousPayload.has_previous, false)
  assert.equal(previousPayload.has_more, true)
})

test("account gallery window traverses newest order forward and backward", async () => {
  const env = buildEnv()
  const request = async (query) => {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2${query}`,
          { headers: { Cookie: "session=abc" } },
        ),
        env,
      )
    assert.equal(response.status, 200)
    return response.json()
  }
  const first = await request("")
  const second = await request(`&after=${encodeURIComponent(first.next_cursor)}`)
  const previous = await request(`&before=${encodeURIComponent(second.previous_cursor)}`)

  assert.deepEqual(
    first.cards.map((card) => card.symbol),
    ["TP53", "BRCA1"],
  )
  assert.deepEqual(
    second.cards.map((card) => card.symbol),
    ["INS", "PRL"],
  )
  assert.deepEqual(
    previous.cards.map((card) => card.symbol),
    ["TP53", "BRCA1"],
  )
  assert.equal(previous.has_previous, false)
  assert.equal(previous.has_more, true)
})

test("shared account gallery window traverses symbol order forward and backward", async () => {
  const env = buildEnv()
  const request = async (query) => {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&scope=shared&limit=2${query}`,
        ),
        env,
      )
    assert.equal(response.status, 200)
    return response.json()
  }
  const first = await request("")
  const second = await request(`&after=${encodeURIComponent(first.next_cursor)}`)
  const previous = await request(`&before=${encodeURIComponent(second.previous_cursor)}`)

  assert.deepEqual(
    first.cards.map((card) => card.symbol),
    ["BRCA1", "INS"],
  )
  assert.deepEqual(
    second.cards.map((card) => card.symbol),
    ["PRL", "RHO"],
  )
  assert.deepEqual(
    previous.cards.map((card) => card.symbol),
    ["BRCA1", "INS"],
  )
  assert.equal(previous.has_previous, false)
  assert.equal(previous.has_more, true)
})

test("account gallery window rejects malformed, mismatched, and legacy cursors explicitly", async () => {
  const env = buildEnv()
  const first =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&limit=2",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      env,
    )
  const cursor = (await first.json()).next_cursor
  const urls = [
    "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&after=not-base64",
    `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&after=${encodeURIComponent(cursor)}`,
    `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&scope=shared&after=${encodeURIComponent(cursor)}`,
    `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&cursor=${encodeURIComponent(cursor)}`,
    `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=symbol&after=${encodeURIComponent(cursor)}&before=${encodeURIComponent(cursor)}`,
  ]
  for (const url of urls) {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(url, { headers: { Cookie: "session=abc" } }),
        env,
      )
    const payload = await response.json()
    assert.equal(response.status, 400)
    assert.match(payload.code, /CURSOR|INVALID/)
  }
})

test("account gallery window rejects metric orders until a real order index exists", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=votes&limit=2",
        {
          headers: { Cookie: "session=abc" },
        },
      ),
      buildEnv(),
    )
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(payload.code, "ORDER_INDEX_NOT_READY")
  assert.deepEqual(payload.supported_orders.sort(), ["newest", "symbol"])
})

test("account gallery endpoint block does not sort a bounded discovery slice for metric orders", () => {
  const start = source.lastIndexOf('if (path === "/api/iconoplasm/account-gallery-window"')
  const end = source.indexOf('if (path === "/api/iconoplasm/discoveries/merge"', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = source.slice(start, end)

  assert.doesNotMatch(block, /sortDiscoveryRowsForOrder/)
  assert.match(block, /ORDER_INDEX_NOT_READY/)
  assert.match(block, /ACCOUNT_GALLERY_WINDOW_SUPPORTED_ORDERS/)
})

test("account gallery endpoint block reads cards from the published artifact, not per-gene KV", () => {
  const start = source.lastIndexOf('if (path === "/api/iconoplasm/account-gallery-window"')
  const end = source.indexOf('if (path === "/api/iconoplasm/discoveries/merge"', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = source.slice(start, end)

  assert.match(block, /readPublishedCardCatalogArtifact/)
  assert.doesNotMatch(block, /readMobileCardVMFromSharedSnapshot/)
  assert.doesNotMatch(block, /versionInfo\.previous/)
})

test("account gallery endpoint has an explicit budget class", () => {
  const route = ICONOPLASM_ROUTE_CONTRACTS.find((entry) => entry.id === "account_gallery_window")
  assert.equal(route?.budgetFamily, "account_gallery_window")
  assert.match(source, /if \(family === "account_gallery_window"\) return "first_party_read"/)
})
