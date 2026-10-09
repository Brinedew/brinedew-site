import assert from "node:assert/strict"
import test from "node:test"
import { FakeDailyBudgetNamespace } from "./test-helpers/fake-daily-budget-namespace.js"
import { DatabaseSync } from "node:sqlite"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./iconoplasm/discovery-compact-store.js"
import {
  installStableGeneStorage,
  stableGeneObjectFromRecord,
  stableGeneObjectPath,
  stableGeneStorageEnv,
} from "./test-helpers/stable-gene-objects.js"

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
    this.raw
      .prepare(
        "UPDATE icono_discovery_compact_activation_v2 SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE singleton = 1",
      )
      .run()
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
        // The runtime derives the VM from this payload (B-898); the fixture
        // must carry the dimensions it claims at the top level.
        width: 768,
        height: 1024,
      },
    },
  }
}

// B-898 Stage 1 (step B): the account gallery window reads ONE stable gene
// object per returned row (at most ACCOUNT_GALLERY_WINDOW_LIMIT_MAX = 12 per
// request) from Bunny Storage. Failure modes these tests cover, written before
// the handler changed:
//   1. Objects present: 200, complete VMs built from the objects, exactly one
//      storage read per returned row, no read of the KV head or any
//      card-catalog key; the image-only projection takes its portrait identity
//      from the same object.
//   2. Object missing: the symbol is listed in `missing` and the row keeps its
//      discovery item; the window never falls back to discovery-row SHAs or
//      legacy portrait refs.
//   3. Storage error: 503 CARD_ARTIFACT_UNAVAILABLE, no-store, with the
//      acct_catalog stage still reported.
let stableStorage = null

function seedStableGeneObjects(symbols, { assetSha256 = "7b".repeat(32) } = {}) {
  for (const symbol of symbols) {
    const vm = completeMobileCardVM(symbol)
    vm.payload.portrait.asset_sha256 = assetSha256
    stableStorage.objects.set(vm.symbol, stableGeneObjectFromRecord(vm.payload))
  }
}

test.beforeEach(() => {
  stableStorage = installStableGeneStorage(new Map())
})

test.afterEach(() => {
  stableStorage?.restore()
  stableStorage = null
})

function buildEnv({ db = new FakeDb(), version = "test-vm-version" } = {}) {
  resetIconoplasmRuntimeCachesForTest()
  const symbols = ["INS", "PRL", "RHO", "TP53", "BRCA1"]
  seedStableGeneObjects(symbols)
  const portraitAssetSha = "7b".repeat(32)
  const portraitFingerprint = {
    published_count: symbols.length,
    latest: portraitAssetSha,
  }
  const kvStore = new Map([
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
    ...stableGeneStorageEnv(),
    ICONOPLASM_DB: db,
    ADMIN_DISCORD_USER_ID: "founder-admin",
    GAME_SESSIONS: new FakeGameSessions({
      "session:abc": { user_id: "user-123", username: "alex" },
    }),
    KV: {
      async get(key) {
        return kvStore.get(key) || null
      },
      async put(key, value) {
        kvStore.set(key, value)
      },
    },
  }
}

test("account gallery window returns strict rich cards from one stable object per row without full shelf sort", async () => {
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
  assert.equal(payload.diagnostics.source, "stable_gene_object")
  assert.equal(payload.diagnostics.artifact_version, "stable-v3")
  assert.equal(payload.vm_version, "stable-v3")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "stable-gene-object")
  assert.equal(payload.missing.length, 0)
  assert.equal(payload.items[0]?.card, undefined)
  assert.equal(payload.cards[0]?.snapshot_version, "2026-10-01T13:53:49.742Z")
  assert.deepEqual([...stableStorage.reads].sort(), [
    stableGeneObjectPath("BRCA1"),
    stableGeneObjectPath("TP53"),
  ])
  const serverTiming = response.headers.get("Server-Timing") || ""
  for (const stage of [
    "acct_session",
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
  const env = buildEnv({ db })
  seedStableGeneObjects(db.rows.map((row) => row.gene_symbol))

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
  const env = buildEnv({ db })
  seedStableGeneObjects(db.rows.map((row) => row.gene_symbol))

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
  const env = buildEnv({ db })
  seedStableGeneObjects(["INS", "GCK", "PRL"])

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
  const env = buildEnv({ db })
  seedStableGeneObjects(["INS", "GCK"])

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
  // The admin rebuild is a budgeted mutation, so the budget object is bound (idle day).
  env.ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE = new FakeDailyBudgetNamespace()
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

test("image-only account gallery window projects compact cards from the stable gene objects", async () => {
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
  assert.equal(payload.diagnostics.source, "stable_gene_object_image_only")
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "stable-gene-object-image-only")
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
// Keep the discarded legacy published-portrait-ref snapshot stale on purpose.
// This test must fail if an agent restores it as the image-only account gallery
// authority. Compact discovery state holds no image identity at all.
test("image-only account gallery ignores a stale legacy portrait-ref snapshot", async () => {
  const db = new FakeDb()
  const staleRowSha = "95".repeat(32)
  const publishedSha = "fb".repeat(32)
  const env = buildEnv({ db })
  seedStableGeneObjects(["INS", "PRL", "RHO", "TP53", "BRCA1"], { assetSha256: publishedSha })
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

test("account gallery window lists a missing stable object and fails loud on storage errors", async () => {
  const db = new FakeDb()
  const env = buildEnv({ db })
  stableStorage.objects.delete("TP53")
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2",
        { headers: { Cookie: "session=abc" } },
      ),
      env,
    )
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(payload.missing, ["TP53"])
  assert.deepEqual(
    payload.cards.map((card) => card.symbol),
    ["BRCA1"],
  )
  assert.deepEqual(
    payload.items.map((item) => item.symbol),
    ["TP53", "BRCA1"],
  )
  assert.equal(response.headers.get("X-Iconoplasm-Data-Source"), "mixed-or-missing")

  stableStorage.restore()
  stableStorage = installStableGeneStorage(new Map(), { status: 500 })
  const outage =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=2",
        { headers: { Cookie: "session=abc" } },
      ),
      buildEnv({ db: new FakeDb() }),
    )
  assert.equal(outage.status, 503)
  assert.equal(outage.headers.get("Cache-Control"), "no-store")
  assert.equal(outage.headers.get("X-Iconoplasm-Data-Source"), "artifact-unavailable")
  assert.equal((await outage.json()).code, "CARD_ARTIFACT_UNAVAILABLE")
  assert.match(outage.headers.get("Server-Timing") || "", /acct_catalog;dur=/)
})

// B-885 (27 Sep 2026): the home collection died with Cloudflare 1102 "Worker
// exceeded resource limits" for the two largest shelves (2,106 and 1,584
// genes). Every window enriched the WHOLE shelf (a three-table join, 250 genes
// per query, one mapped object per gene) and only then kept 24. B-1064 (9 Oct
// 2026): the browser renders the page's published cards and reads only the
// symbols from the discovery rows, so the window reads no gene facts at all,
// for either scope, and its rows carry only the reader's own facts.
function manyGeneDb() {
  const db = new FakeDb()
  db.rows = Array.from({ length: 101 }, (_, index) => {
    const number = String(index).padStart(3, "0")
    const day = String(1 + Math.floor(index / 24)).padStart(2, "0")
    const hour = String(index % 24).padStart(2, "0")
    return db.row(
      index % 2 ? "user-123" : "user-456",
      `G${number}`,
      `2026-04-${day}T${hour}:00:00Z`,
      index,
    )
  })
  return db
}

function enrichmentCalls(db) {
  return db.calls
    .filter((call) => /FROM icono_gene_catalog gc/.test(call.sql))
    .map((call) => JSON.parse(String(call.args[0] || "[]")))
}

for (const scope of ["personal", "shared"]) {
  test(`${scope} account gallery window reads no gene facts (B-885, B-1064)`, async () => {
    const db = manyGeneDb()
    resetIconoplasmRuntimeCachesForTest()
    const env = buildEnv({ db })
    seedStableGeneObjects(db.rows.map((row) => row.gene_symbol))
    const query = scope === "shared" ? "&scope=shared" : ""
    const first =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=3${query}`,
          { headers: { Cookie: "session=abc" } },
        ),
        env,
      )
    const payload = await first.json()
    assert.equal(first.status, 200)
    assert.equal(payload.items.length, 3)
    assert.deepEqual(enrichmentCalls(db), [], `${scope}: the window joined gene facts`)
    for (const item of payload.items) {
      assert.deepEqual(
        Object.keys(item.discovery).sort(),
        ["encounter_count", "first_discovered_at", "gene_symbol", "last_encountered_at"],
        `${scope}: a discovery row carries more than the reader's facts`,
      )
      assert.equal(item.discovery.gene_symbol, item.symbol)
    }

    // The next page (after the cursor) is still correct and still bounded.
    db.calls.length = 0
    const next =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=3${query}&after=${encodeURIComponent(payload.next_cursor)}`,
          { headers: { Cookie: "session=abc" } },
        ),
        env,
      )
    const nextPayload = await next.json()
    assert.equal(next.status, 200)
    assert.equal(nextPayload.items.length, 3)
    assert.ok(
      nextPayload.items[0].discovery.first_discovered_at <=
        payload.items[2].discovery.first_discovered_at,
      `${scope}: the next page is not older than the first`,
    )
    assert.deepEqual(enrichmentCalls(db), [], `${scope}: the second page joined gene facts`)
  })
}

// B-885 step 2: the shared window mapped EVERY shared discovery's ordinal to
// its symbol (8 lookup queries of 500 at 3,681 discoveries; 42% of all D1 rows
// read on 27 Sep, with the hourly publisher) to show one page. Newest order
// pages by time first and names only the page, including ties that share a
// second, walked end to end in both directions.
test("shared newest window names only the page and pages ties exactly (B-885)", async () => {
  const db = new FakeDb()
  // 60 genes in 12 distinct seconds: ties of five share every timestamp.
  db.rows = Array.from({ length: 60 }, (_, index) => {
    const second = String(Math.floor(index / 5)).padStart(2, "0")
    return db.row(
      `user-${index % 7}`,
      `T${String(59 - index).padStart(2, "0")}`,
      `2026-05-01T00:00:${second}Z`,
      index,
    )
  })
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db })
  seedStableGeneObjects(db.rows.map((row) => row.gene_symbol))
  const expected = [...db.rows]
    .sort(
      (a, b) =>
        b.first_discovered_at.localeCompare(a.first_discovered_at) ||
        a.gene_symbol.localeCompare(b.gene_symbol),
    )
    .map((row) => row.gene_symbol)
  const ordinalLookups = () =>
    db.calls
      .filter((call) => /FROM icono_discovery_ordinals_v2\s+WHERE ordinal IN/.test(call.sql))
      .flatMap((call) => JSON.parse(String(call.args[0] || "[]")))
  const page = async (cursorParam) => {
    db.calls.length = 0
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(
          `https://iconoplasm.brinedew.bio/api/iconoplasm/account-gallery-window?order=newest&limit=7&scope=shared${cursorParam}`,
        ),
        env,
      )
    assert.equal(response.status, 200)
    const payload = await response.json()
    // At most the page, one look-ahead, and the ties on both boundaries.
    assert.ok(ordinalLookups().length <= 7 + 1 + 5 + 5, `named ${ordinalLookups().length} genes`)
    return payload
  }
  const forward = []
  let payload = await page("")
  const pages = [payload]
  forward.push(...payload.items.map((item) => item.symbol))
  while (payload.has_more) {
    payload = await page(`&after=${encodeURIComponent(payload.next_cursor)}`)
    pages.push(payload)
    forward.push(...payload.items.map((item) => item.symbol))
  }
  assert.deepEqual(forward, expected, "forward walk")
  assert.equal(pages.length, Math.ceil(60 / 7))

  // Backward from the last page reproduces every earlier page.
  let back = pages[pages.length - 1]
  for (let index = pages.length - 2; index >= 0; index--) {
    back = await page(`&before=${encodeURIComponent(back.previous_cursor)}`)
    assert.deepEqual(
      back.items.map((item) => item.symbol),
      pages[index].items.map((item) => item.symbol),
      `backward page ${index}`,
    )
  }
})

// B-885 step 3: /discoveries/me served every non-newest home sort by enriching
// the whole shelf (1,601 calls on 27 Sep, ~4.6 D1 rows per gene each). The
// browser already downloads the published catalog, which carries every sort
// field, so `shape=compact` returns the bare shelf: no enrichment query, no
// server sort. Tabs still running the old script keep the enriched shape.
test("discoveries/me shape=compact returns the bare shelf without enriching it (B-885)", async () => {
  const db = new FakeDb()
  db.rows = Array.from({ length: 101 }, (_, index) =>
    db.row(
      "user-123",
      `C${String(index).padStart(3, "0")}`,
      `2026-04-${String(1 + (index % 28)).padStart(2, "0")}T00:00:00Z`,
      index,
    ),
  )
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db, version: "test-vm-version-compact" })
  const call = (query) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(`https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me?${query}`, {
        headers: { Cookie: "session=abc" },
      }),
      env,
    )
  const enrichments = () => db.calls.filter((c) => /FROM icono_gene_catalog gc/.test(c.sql)).length

  db.calls.length = 0
  const response = await call("order=popularity&shape=compact")
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.shape, "compact")
  assert.equal(enrichments(), 0, "compact shape ran an enrichment query")
  assert.equal(payload.discovered_count, 101)
  assert.equal(payload.discoveries.length, 101)
  const first = payload.discoveries[0]
  assert.deepEqual(Object.keys(first).sort(), [
    "encounter_count",
    "first_discovered_at",
    "gene_symbol",
    "last_encountered_at",
  ])
  assert.match(first.first_discovered_at, /^2026-04-\d\dT00:00:00Z$/)

  // The enriched shape is unchanged for tabs on the old script.
  // B-908: a gene has one public name. The essence row carries the UniProt
  // protein name; the shelf must name each gene from the catalog (HGNC) row,
  // as the catalog object, the stable object and the static document do.
  db.raw.exec(
    "INSERT INTO icono_gene_essence (gene_symbol, full_name) SELECT gene_symbol, 'UniProt ' || gene_symbol FROM icono_gene_catalog",
  )
  db.calls.length = 0
  const legacy = await (await call("order=popularity")).json()
  assert.equal(legacy.shape, undefined)
  assert.ok(enrichments() > 0, "the legacy shape stopped enriching")
  assert.equal(legacy.discoveries[0].full_name.endsWith("full name"), true)
  for (const item of legacy.discoveries) {
    assert.equal(item.full_name, `${item.gene_symbol} full name`, `${item.gene_symbol}: shelf name`)
  }
})

// B-887: with a current shelf the home window and the compact shelf read one
// user-state row and never the chronology; a shelf not stamped with the
// current state version is never trusted, even when its content is wrong.
test("home reads use a current shelf and ignore a stale one (B-887)", async () => {
  const db = new FakeDb()
  db.rows = Array.from({ length: 30 }, (_, index) =>
    db.row(
      "user-123",
      `S${String(index).padStart(2, "0")}`,
      `2026-03-${String(1 + index).padStart(2, "0")}T00:00:00Z`,
      index,
    ),
  )
  resetIconoplasmRuntimeCachesForTest()
  const env = buildEnv({ db })
  seedStableGeneObjects(db.rows.map((row) => row.gene_symbol))
  const call = async (path) => {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://iconoplasm.brinedew.bio${path}`, {
          headers: { Cookie: "session=abc" },
        }),
        env,
      )
    assert.equal(response.status, 200, path)
    return response.json()
  }
  const window = "/api/iconoplasm/account-gallery-window?order=newest&limit=5"
  const compact = "/api/iconoplasm/discoveries/me?order=popularity&shape=compact"
  const chronologyReads = () =>
    db.calls.filter((c) => /FROM icono_discovery_chronology_v2/.test(c.sql)).length
  const view = (payload) => ({
    window: payload.window.items.map((item) => [
      item.symbol,
      item.discovery.first_discovered_at,
      item.discovery.last_encountered_at,
      item.discovery.encounter_count,
    ]),
    compact: payload.compact.discoveries,
  })

  // The truth: the chronology fold (no row has a current shelf yet).
  const truth = view({ window: await call(window), compact: await call(compact) })
  assert.ok(chronologyReads() > 0)

  // A current shelf: same answers, zero chronology reads.
  const shelf = db.rows.map((row) => {
    const at = Math.floor(Date.parse(row.first_discovered_at) / 1000)
    return [row.gene_symbol, at, at, 1]
  })
  db.raw
    .prepare(
      "UPDATE icono_discovery_user_state_v2 SET shelf_json = ?, shelf_state_version = state_version WHERE user_id = 'user-123'",
    )
    .run(JSON.stringify(shelf))
  db.calls.length = 0
  const fromShelf = view({ window: await call(window), compact: await call(compact) })
  assert.equal(chronologyReads(), 0, "read the chronology with a current shelf")
  assert.deepEqual(fromShelf, truth)

  // A stale stamp with wrong content: the chronology answers, not the shelf.
  db.raw
    .prepare(
      "UPDATE icono_discovery_user_state_v2 SET shelf_json = '[[\"WRONG\",1,1,1]]', shelf_state_version = state_version - 1 WHERE user_id = 'user-123'",
    )
    .run()
  db.calls.length = 0
  const fromStale = view({ window: await call(window), compact: await call(compact) })
  assert.ok(chronologyReads() > 0, "trusted a stale shelf")
  assert.deepEqual(fromStale, truth)
})
