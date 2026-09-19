import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate } from "./iconoplasm-public-edge-proxy-to-the-only-allowed-stateful-worker-do-not-duplicate.js"
import {
  drainIconoplasmSharedDiscoveryDeliveriesForScheduled,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  publishSharedGeneDiscoverySymbols,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./iconoplasm/discovery-compact-store.js"
import {
  claimCompactDiscoveryMigrationLease,
  migrateLegacyDiscoveryPage,
} from "./iconoplasm/discovery-compact-migrate.js"
import { evolveAndPersistDiscoveryDictionary } from "./iconoplasm/discovery-ordinal-store.js"

// Real SQLite behind a D1-shaped adapter: route behavior is exercised through
// the actual handlers with the actual compact SQL, not a SQL-string mock.

const CATALOG = [
  ["INS", "Insulin"],
  ["RHO", "Rhodopsin"],
  ["PRL", "Prolactin"],
  ["TP53", "Tumor protein p53"],
  ["BRCA1", "BRCA1 DNA repair associated"],
  ["EGFR", "Epidermal growth factor receptor"],
  ["FURIN", "Furin"],
  ["NRM", "Nurim"],
]

class Result {
  constructor(rows) {
    this.results = rows
  }
  first() {
    return this.results[0] ?? null
  }
}

class Bound {
  constructor(raw, sql, args = []) {
    this.raw = raw
    this.sql = sql
    this.args = args
  }
  bind(...args) {
    return new Bound(this.raw, this.sql, args)
  }
  async all() {
    return new Result(this.raw.prepare(this.sql).all(...this.args))
  }
  async first() {
    return this.raw.prepare(this.sql).get(...this.args) ?? null
  }
  async run() {
    const info = this.raw.prepare(this.sql).run(...this.args)
    return { success: true, meta: { changes: Number(info.changes || 0) } }
  }
}

class D1Like {
  constructor() {
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
      CREATE TABLE icono_gene_discoveries (
        user_id TEXT NOT NULL,
        gene_symbol TEXT NOT NULL,
        first_discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_encountered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  }
  prepare(sql) {
    return new Bound(this.raw, sql)
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
}

class FakeKv {
  constructor() {
    this.store = new Map()
  }
  async get(key) {
    return this.store.has(key) ? this.store.get(key) : null
  }
  async put(key, value) {
    this.store.set(key, String(value))
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

function acceptingMutationAuthority() {
  return {
    idFromName: () => "global",
    get: () => ({
      fetch: async () => Response.json({ ok: true, replayed: false }),
    }),
  }
}

async function buildEnv({ sessions, migrationComplete = true } = {}) {
  const db = new D1Like()
  if (migrationComplete) {
    db.raw.exec(
      `UPDATE icono_discovery_compact_activation_v2
       SET status='complete', completed_at=CURRENT_TIMESTAMP WHERE singleton=1`,
    )
  }
  const insertCatalog = db.raw.prepare(
    "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)",
  )
  for (const [symbol, name] of CATALOG) insertCatalog.run(symbol, name)
  db.raw
    .prepare(
      "INSERT INTO icono_gene_essence (gene_symbol, full_name, weight_kg, age_years, leakage_percent) VALUES (?, ?, ?, ?, ?)",
    )
    .run("TP53", "Tumor protein p53", 53.1, 44, 12)
  db.raw
    .prepare(
      "INSERT INTO icono_admin_gene_rollup (gene_symbol, live_upvotes, live_score, live_created_at, current_asset_sha256) VALUES (?, ?, ?, ?, ?)",
    )
    .run("TP53", 3, 3, "2025-04-01T00:00:01Z", "a".repeat(64))
  await evolveAndPersistDiscoveryDictionary(db, { symbols: CATALOG.map(([symbol]) => symbol) })
  const gatewayEnv = {
    ICONOPLASM_DB: db,
    GAME_SESSIONS: new FakeGameSessions(sessions),
    ICONOPLASM_ADMIN_TOKEN: "admin-token",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: acceptingMutationAuthority(),
    KV: new FakeKv(),
  }
  const env = {
    ...gatewayEnv,
    ICONOPLASM_DB: null,
    gatewayDb: db,
    gatewayEnv,
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      fetch(request) {
        return handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
          request,
          gatewayEnv,
          { waitUntil() {} },
        )
      },
    },
  }
  return env
}

function post(path, { cookie = "", body = null } = {}) {
  return new Request(`https://iconoplasm.brinedew.bio${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  })
}

function get(path, { cookie = "" } = {}) {
  return new Request(`https://iconoplasm.brinedew.bio${path}`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  })
}

async function invoke(request, env) {
  return handleIconoplasmRequestAtPublicEdgeByProxyingToTheOnlyAllowedStatefulWorkerDoNotDuplicate(
    request,
    env,
    {},
  )
}

function sessionFor(userId) {
  return { "session:abc": { user_id: userId, username: userId } }
}

async function postBatch(env, { userId, batchId, encounters }) {
  const response = await invoke(
    post("/api/iconoplasm/discoveries/batch", {
      cookie: "session=abc",
      body: { batch_id: batchId, encounters },
    }),
    env,
  )
  return { response, payload: await response.json() }
}

function hoverEncounter(symbol, at, overrides = {}) {
  return {
    symbol,
    at,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
    ...overrides,
  }
}

async function compactRowCount(env) {
  return Number(
    (await env.gatewayDb.prepare("SELECT COUNT(*) AS n FROM icono_discovery_user_state_v2").first())
      .n,
  )
}

test("the retired per-hover encounter writer is a write-free 410", async () => {
  const env = await buildEnv()
  const response = await invoke(
    post("/api/iconoplasm/discoveries/encounter", {
      cookie: "session=abc",
      body: { symbol: "TP53", source: "extension_hover", trigger: "hover_dwell", dwell_ms: 900 },
    }),
    env,
  )
  assert.equal(response.status, 410)
  const payload = await response.json()
  assert.equal(payload.code, "LEGACY_DISCOVERY_WRITER_RETIRED")
  assert.equal(await compactRowCount(env), 0)
})

test("signed-out batches are acknowledged without touching storage", async () => {
  const env = await buildEnv()
  const guestResponse = await invoke(
    post("/api/iconoplasm/discoveries/batch", {
      body: { batch_id: "device-a:1", encounters: [hoverEncounter("TP53", 100)] },
    }),
    env,
  )
  assert.equal(guestResponse.status, 200)
  const guestPayload = await guestResponse.json()
  assert.equal(guestPayload.authenticated, false)
  assert.equal(guestPayload.persisted, false)
  assert.equal(await compactRowCount(env), 0)
})

test("a ten-hover batch commits one compact state and replays without duplicates", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  const encounters = [
    "TP53",
    "BRCA1",
    "EGFR",
    "TP53",
    "INS",
    "TP53",
    "BRCA1",
    "RHO",
    "PRL",
    "NRM",
  ].map((symbol, index) => hoverEncounter(symbol, 1000 + index))
  const first = await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters,
  })
  assert.equal(first.payload.ok, true)
  assert.equal(first.payload.authenticated, true)
  assert.equal(first.payload.replay, false)
  assert.equal(first.payload.attempts, 1)
  assert.equal(first.payload.recorded, 10)
  const state = await env.gatewayDb
    .prepare(
      "SELECT member_count, state_version, active_events_json FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'",
    )
    .first()
  assert.equal(Number(state.member_count), 7)
  assert.equal(JSON.parse(state.active_events_json).length, 10)

  // The exact same batch id replays: no second state version, no new events.
  const replay = await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [hoverEncounter("TP53", 9999)],
  })
  assert.equal(replay.payload.replay, true)
  assert.equal(replay.payload.recorded, 1)
  const afterReplay = await env.gatewayDb
    .prepare(
      "SELECT member_count, state_version, active_events_json FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'",
    )
    .first()
  assert.deepEqual(
    [
      Number(afterReplay.member_count),
      Number(afterReplay.state_version),
      JSON.parse(afterReplay.active_events_json).length,
    ],
    [7, Number(state.state_version), 10],
  )
  console.log(
    "B764_ROUTE_BATCH_RECEIPT",
    JSON.stringify({ member_count: 7, events: 10, state_version: Number(state.state_version) }),
  )
})

test("activation blocks incomplete legacy migration, then migrated membership remains visible without request-time scans", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader"), migrationComplete: false })
  env.gatewayDb.raw
    .prepare(
      `INSERT INTO icono_gene_discoveries
       (user_id, gene_symbol, first_discovered_at, last_encountered_at, encounter_count,
        first_source, last_source, first_trigger, last_trigger, first_dwell_ms, last_dwell_ms)
       VALUES ('reader', 'TP53', '2026-01-03 04:05:06', '2026-01-04 05:06:07', 3,
        'extension_hover', 'extension_hover', 'hover_dwell', 'hover_dwell', 900, 1200)`,
    )
    .run()
  const request = get(
    `/api/iconoplasm/discoveries/membership?symbols=${encodeURIComponent(JSON.stringify(["TP53", "EGFR"]))}`,
    { cookie: "session=abc" },
  )
  const blocked = await invoke(request, env)
  assert.equal(blocked.status, 503)
  assert.equal((await blocked.json()).code, "DISCOVERY_COMPACT_MIGRATION_INCOMPLETE")
  assert.equal(await compactRowCount(env), 0)

  const leaseToken = "discovery-test-lease"
  await claimCompactDiscoveryMigrationLease(env.gatewayDb, { token: leaseToken })
  const migration = await migrateLegacyDiscoveryPage({
    db: env.gatewayDb,
    rowLimit: 8,
    leaseToken,
  })
  assert.equal(migration.complete, true)
  const payload = await (await invoke(request, env)).json()
  assert.deepEqual(payload.discovered_symbols, ["TP53"])
  assert.equal(await compactRowCount(env), 1)

  // After the activation receipt is complete, request membership stays on the
  // compact record even when the retired source rows are removed.
  env.gatewayDb.raw.exec("DELETE FROM icono_gene_discoveries")
  const again = await (
    await invoke(
      get(
        `/api/iconoplasm/discoveries/membership?symbols=${encodeURIComponent(JSON.stringify(["TP53", "EGFR"]))}`,
        { cookie: "session=abc" },
      ),
      env,
    )
  ).json()
  assert.deepEqual(again.discovered_symbols, ["TP53"])
})

test("shared aggregates stay exact through the durable deferred delivery drain", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [
      hoverEncounter("TP53", 1000),
      hoverEncounter("TP53", 1005),
      hoverEncounter("EGFR", 1010),
    ],
  })
  const beforeDrain = await env.gatewayDb
    .prepare("SELECT discoverer_counts_b64 FROM icono_discovery_shared_state_v2")
    .first()
  assert.equal(String(beforeDrain.discoverer_counts_b64), "")
  const outbox = await env.gatewayDb
    .prepare("SELECT COUNT(*) AS n FROM icono_discovery_shared_delivery_outbox_v2")
    .first()
  assert.equal(Number(outbox.n), 1)

  const drain = await drainIconoplasmSharedDiscoveryDeliveriesForScheduled(env.gatewayEnv)
  assert.deepEqual(
    { drained: drain.drained, applied: drain.applied, duplicates: drain.duplicates },
    { drained: 1, applied: 1, duplicates: 0 },
  )
  const rows = await env.gatewayDb
    .prepare(`SELECT name, ordinal FROM icono_discovery_ordinals_v2 WHERE active = 1 ORDER BY name`)
    .all()
  const ordinalBySymbol = new Map(rows.results.map((row) => [row.name, Number(row.ordinal)]))
  const shared = await env.gatewayDb
    .prepare(
      "SELECT discoverer_counts_b64, encounter_counts_b64, first_at_b64, latest_at_b64 FROM icono_discovery_shared_state_v2",
    )
    .first()
  const decode = (b64) => {
    const bytes = Buffer.from(String(b64), "base64")
    return new Uint32Array(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
  }
  const tp53 = ordinalBySymbol.get("TP53")
  const egfr = ordinalBySymbol.get("EGFR")
  assert.equal(decode(shared.discoverer_counts_b64)[tp53], 1)
  assert.equal(decode(shared.encounter_counts_b64)[tp53], 2)
  assert.equal(decode(shared.first_at_b64)[tp53], 1000)
  assert.equal(decode(shared.latest_at_b64)[tp53], 1005)
  assert.equal(decode(shared.encounter_counts_b64)[egfr], 1)
  console.log(
    "B764_SHARED_DRAIN_RECEIPT",
    JSON.stringify({ drained: drain.drained, applied: drain.applied }),
  )
})

test("guest merge converges into compact membership without double counting", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  const first = await invoke(
    post("/api/iconoplasm/discoveries/merge", {
      cookie: "session=abc",
      body: { symbols: ["TP53", "BRCA1"] },
    }),
    env,
  )
  const firstPayload = await first.json()
  assert.equal(firstPayload.ok, true)
  assert.deepEqual(firstPayload.merged_symbols, ["TP53", "BRCA1"])
  const state = await env.gatewayDb
    .prepare(
      "SELECT member_count, active_events_json FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'",
    )
    .first()
  assert.equal(Number(state.member_count), 2)
  assert.equal(JSON.parse(state.active_events_json).length, 2)

  const replay = await invoke(
    post("/api/iconoplasm/discoveries/merge", {
      cookie: "session=abc",
      body: { symbols: ["TP53", "BRCA1"] },
    }),
    env,
  )
  assert.equal((await replay.json()).ok, true)
  const after = await env.gatewayDb
    .prepare(
      "SELECT member_count, active_events_json FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'",
    )
    .first()
  assert.equal(Number(after.member_count), 2)
  assert.equal(JSON.parse(after.active_events_json).length, 2)
})

test("discoveries me returns the compact shelf with exact first/last and counts", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [
      hoverEncounter("TP53", 1000),
      hoverEncounter("TP53", 1010),
      hoverEncounter("EGFR", 1020),
    ],
  })
  const response = await invoke(
    get("/api/iconoplasm/discoveries/me", { cookie: "session=abc" }),
    env,
  )
  const payload = await response.json()
  assert.equal(payload.authenticated, true)
  const tp53 = payload.discoveries.find((row) => row.gene_symbol === "TP53")
  assert.equal(tp53.encounter_count, 2)
  assert.equal(tp53.first_discovered_at, "1970-01-01T00:16:40Z")
  assert.equal(tp53.last_encountered_at, "1970-01-01T00:16:50Z")
  assert.equal(tp53.full_name, "Tumor protein p53")
  const egfr = payload.discoveries.find((row) => row.gene_symbol === "EGFR")
  assert.equal(egfr.encounter_count, 1)
})

test("passive discovery reads never manufacture starter membership", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  const first = await invoke(get("/api/iconoplasm/discoveries/me", { cookie: "session=abc" }), env)
  const firstPayload = await first.json()
  assert.deepEqual(firstPayload.discovered_symbols, [])
  assert.equal(await compactRowCount(env), 0)
  await invoke(get("/api/iconoplasm/discoveries/me", { cookie: "session=abc" }), env)
  assert.equal(await compactRowCount(env), 0)
})

test("the hourly symbol publisher reads compact shared state", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [hoverEncounter("TP53", 1000)],
  })
  await drainIconoplasmSharedDiscoveryDeliveriesForScheduled(env.gatewayEnv)
  const first = await publishSharedGeneDiscoverySymbols(env.gatewayEnv)
  assert.equal(first.ok, true)
  assert.equal(first.changed, true)
  assert.deepEqual(first.symbol_count, 1)
  const second = await publishSharedGeneDiscoverySymbols(env.gatewayEnv)
  assert.equal(second.changed, false)
  const published = JSON.parse(
    await env.gatewayEnv.KV.get("iconoplasm:shared-gene-discovery-symbols:v1"),
  )
  assert.deepEqual(published.symbols, ["TP53"])
})

test("admins may show the full catalog while non-admins cannot", async () => {
  const env = await buildEnv({ sessions: sessionFor("reader") })
  const adminRequest = new Request(
    "https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/me?show_all=1",
    {
      method: "GET",
      headers: { Cookie: "session=abc", "x-iconoplasm-admin-token": "admin-token" },
    },
  )
  const payload = await (await invoke(adminRequest, env)).json()
  assert.equal(payload.show_all_requested, true)
  assert.equal(payload.show_all_applied, true)
  assert.equal(payload.discoveries.length, CATALOG.length)
  assert.ok(payload.discovered_symbols.includes("FURIN"))
  const nonAdmin = await (
    await invoke(get("/api/iconoplasm/discoveries/me?show_all=1", { cookie: "session=abc" }), env)
  ).json()
  assert.equal(nonAdmin.show_all_applied, false)
})
