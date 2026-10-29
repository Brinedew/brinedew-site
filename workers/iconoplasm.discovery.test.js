import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { viaStatefulWorker } from "./test-helpers/via-stateful-worker.js"
import { secondsUntilCloudflareDailyReset } from "./lib/cloudflare-availability.js"
import {
  drainIconoplasmSharedDiscoveryDeliveriesForScheduled,
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  publishSharedGeneDiscoverySymbols,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { DISCOVERY_COMPACT_SCHEMA_SQL } from "./iconoplasm/discovery-compact-store.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

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

async function buildEnv() {
  const db = new D1Like()
  const insertCatalog = db.raw.prepare(
    "INSERT INTO icono_gene_catalog (gene_symbol, full_name) VALUES (?, ?)",
  )
  for (const [symbol, name] of CATALOG) insertCatalog.run(symbol, name)
  db.raw
    .prepare(
      "INSERT INTO icono_gene_essence (gene_symbol, full_name, weight_kg, age_years, leakage_percent) VALUES (?, ?, ?, ?, ?)",
    )
    .run("TP53", "Tumor protein p53", 53.1, 44, 12)
  const gatewayEnv = {
    ICONOPLASM_DB: db,
    SESSION_SECRET: TEST_SESSION_SECRET,
    ICONOPLASM_ADMIN_TOKEN: "admin-token",
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
  return viaStatefulWorker(request, env, {})
}

// The reader's browser, signed in (B-1069: a sealed cookie, no session store).
const READER = await sessionCookieFor({ user_id: "reader", username: "reader" })

async function postBatch(env, { userId, batchId, encounters }) {
  const response = await invoke(
    post("/api/iconoplasm/discoveries/batch", {
      cookie: READER,
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
  const env = await buildEnv()
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

// B-1013: the owner's browser, 2026-10-05. Batch 2 arrives while the session has
// lapsed; the server answers "not signed in", the browser counts it as sent and
// keeps the encounter on its guest shelf. Batch 3 after signing back in used to
// get 400 DISCOVERY_BATCH_SEQUENCE_GAP forever.
test("a device that sent a batch while signed out keeps syncing after signing back in", async () => {
  const env = await buildEnv()
  const first = await postBatch(env, {
    userId: "reader",
    batchId: "41db9ccfb8f31e7f7695cbc7:1",
    encounters: [hoverEncounter("BRCA1", 1000)],
  })
  assert.equal(first.payload.ok, true)

  const signedOut = await invoke(
    post("/api/iconoplasm/discoveries/batch", {
      body: { batch_id: "41db9ccfb8f31e7f7695cbc7:2", encounters: [hoverEncounter("EGFR", 1001)] },
    }),
    env,
  )
  assert.equal((await signedOut.json()).authenticated, false)

  const back = await postBatch(env, {
    userId: "reader",
    batchId: "41db9ccfb8f31e7f7695cbc7:3",
    encounters: [hoverEncounter("TP53", 1002, { source: "gene_page_visit" })],
  })
  assert.equal(back.response.status, 200)
  assert.equal(back.payload.ok, true)
  assert.equal(back.payload.replay, false)
  const row = await env.gatewayDb
    .prepare("SELECT member_count FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'")
    .first()
  assert.equal(Number(row.member_count), 2)
})

test("shared aggregates stay exact through the durable deferred delivery drain", async () => {
  const env = await buildEnv()
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
  const env = await buildEnv()
  const first = await invoke(
    post("/api/iconoplasm/discoveries/merge", {
      cookie: READER,
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
      cookie: READER,
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

// Production's dictionary is lazy (3,678 of ~19k genes had ordinals on
// 2026-09-26). A merged catalog gene nobody has discovered yet must be
// recorded, and a name outside the catalog must be reported, not stored.
test("guest merge records never-seen catalog genes and reports non-catalog names", async () => {
  const env = await buildEnv()
  const response = await invoke(
    post("/api/iconoplasm/discoveries/merge", {
      cookie: READER,
      body: { symbols: ["TP53", "NOTAGENE"] },
    }),
    env,
  )
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.dropped_symbols, ["NOTAGENE"])
  const state = await env.gatewayDb
    .prepare("SELECT member_count FROM icono_discovery_user_state_v2 WHERE user_id = 'reader'")
    .first()
  assert.equal(Number(state.member_count), 1)
})

test("discoveries me returns the compact shelf with exact first/last and counts", async () => {
  const env = await buildEnv()
  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [
      hoverEncounter("TP53", 1000),
      hoverEncounter("TP53", 1010),
      hoverEncounter("EGFR", 1020),
    ],
  })
  const response = await invoke(get("/api/iconoplasm/discoveries/me", { cookie: READER }), env)
  const payload = await response.json()
  assert.equal(payload.authenticated, true)
  const tp53 = payload.discoveries.find((row) => row.gene_symbol === "TP53")
  assert.equal(tp53.encounter_count, 2)
  assert.equal(tp53.first_discovered_at, "1970-01-01T00:16:40Z")
  assert.equal(tp53.last_encountered_at, "1970-01-01T00:16:50Z")
  const egfr = payload.discoveries.find((row) => row.gene_symbol === "EGFR")
  assert.equal(egfr.encounter_count, 1)
})

test("passive discovery reads never manufacture starter membership", async () => {
  const env = await buildEnv()
  const first = await invoke(get("/api/iconoplasm/discoveries/me", { cookie: READER }), env)
  const firstPayload = await first.json()
  assert.deepEqual(firstPayload.discoveries, [])
  assert.equal(await compactRowCount(env), 0)
  await invoke(get("/api/iconoplasm/discoveries/me", { cookie: READER }), env)
  assert.equal(await compactRowCount(env), 0)
})

test("the hourly symbol publisher reads compact shared state", async () => {
  const env = await buildEnv()
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

// B-887 step 5: the hourly publisher named EVERY shared discovery each run
// (~15k D1 rows an hour on 27 Sep, 42% of all reads with the shared window,
// growing with every new discovery). It now names only ordinals that are new
// since the published list; a quiet hour costs the shared-state row alone. A
// renamed canonical symbol is picked up by one full rebuild per UTC day.
test("the hourly symbol publisher names only new shared ordinals (B-887)", async () => {
  const env = await buildEnv()
  const db = env.gatewayEnv.ICONOPLASM_DB
  const named = []
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    const statement = prepare(sql)
    if (!/FROM icono_discovery_ordinals_v2\s+WHERE ordinal IN/.test(sql)) return statement
    const bind = statement.bind.bind(statement)
    statement.bind = (...args) => {
      named.push(...JSON.parse(String(args[0] || "[]")))
      return bind(...args)
    }
    return statement
  }
  const publish = (now) => publishSharedGeneDiscoverySymbols(env.gatewayEnv, { now })
  const day1 = Date.parse("2026-09-28T10:00:00Z")

  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:1",
    encounters: [hoverEncounter("TP53", 1000), hoverEncounter("EGFR", 1001)],
  })
  await drainIconoplasmSharedDiscoveryDeliveriesForScheduled(env.gatewayEnv)
  const first = await publish(day1)
  assert.equal(first.changed, true)
  assert.equal(named.length, 2, "the first publish names every shared ordinal")

  named.length = 0
  const quiet = await publish(day1 + 3_600_000)
  assert.equal(quiet.changed, false)
  assert.equal(named.length, 0, `a quiet hour named ${named.length} genes`)

  await postBatch(env, {
    userId: "reader",
    batchId: "device-a:2",
    encounters: [hoverEncounter("FURIN", 2000), hoverEncounter("TP53", 2001)],
  })
  await drainIconoplasmSharedDiscoveryDeliveriesForScheduled(env.gatewayEnv)
  named.length = 0
  const grown = await publish(day1 + 7_200_000)
  assert.equal(grown.changed, true)
  assert.equal(named.length, 1, `named ${named.length} genes for one new discovery`)
  const published = JSON.parse(
    await env.gatewayEnv.KV.get("iconoplasm:shared-gene-discovery-symbols:v1"),
  )
  assert.deepEqual(published.symbols, ["EGFR", "FURIN", "TP53"])

  // The next UTC day rebuilds in full once, then goes quiet again.
  named.length = 0
  await publish(day1 + 24 * 3_600_000)
  assert.equal(named.length, 3, "the daily full rebuild did not run")
  named.length = 0
  await publish(day1 + 25 * 3_600_000)
  assert.equal(named.length, 0)
})
