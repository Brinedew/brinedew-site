import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
  mutationLaneForSyncFinalizationRows,
  processPendingSyncFinalizationJobs,
  processVoteProjectionRefreshJobBatch,
  scheduleVoteProjectionRefresh,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  DailyMutationLaneReservations,
  MUTATION_MAX_TRACKED_IDENTITIES_AT_70K_PER_DAY,
  MUTATION_LANE_DAILY_LIMITS,
} from "../lib/iconoplasm-mutation-lane-reservations.js"

const voteProjectionSchema = [
  readFileSync(
    new URL(
      "../../migrations-iconoplasm/0026_add_vote_projection_refresh_jobs.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFileSync(
    new URL("../../migrations-iconoplasm/0098_vote_projection_job_version.sql", import.meta.url),
    "utf8",
  ),
  readFileSync(
    new URL(
      "../../migrations-iconoplasm/0107_vote_projection_wake_generation.sql",
      import.meta.url,
    ),
    "utf8",
  ),
].join("\n")

test("laptop publications spend only the laptop-delivery mutation lane", () => {
  assert.equal(
    mutationLaneForSyncFinalizationRows([
      { reason: "generation_session_publish" },
      { reason: "generation_session_publish" },
    ]),
    "laptop_delivery",
  )
  assert.equal(
    mutationLaneForSyncFinalizationRows([{ reason: "workstation_sync_finalization" }]),
    "finalization_recovery",
  )
  assert.equal(mutationLaneForSyncFinalizationRows([]), "finalization_recovery")
})

class BoundStatement {
  constructor(raw, sql, args = []) {
    this.raw = raw
    this.sql = String(sql)
    this.args = args
  }

  bind(...args) {
    return new BoundStatement(this.raw, this.sql, args)
  }

  async first() {
    return this.raw.prepare(this.sql).get(...this.args) ?? null
  }

  async all() {
    return { results: this.raw.prepare(this.sql).all(...this.args) }
  }

  async run() {
    const result = this.raw.prepare(this.sql).run(...this.args)
    return { meta: { changes: Number(result.changes || 0) } }
  }
}

class SqliteD1 {
  constructor(schema) {
    this.raw = new DatabaseSync(":memory:")
    this.raw.exec(schema)
  }

  prepare(sql) {
    return new BoundStatement(this.raw, sql)
  }
}

class MeteredSqliteD1 extends SqliteD1 {
  constructor(schema) {
    super(schema)
    this.rowsWritten = 0
  }

  changes() {
    return Number(this.raw.prepare("SELECT total_changes() AS n").get().n)
  }

  prepare(sql) {
    const raw = this.raw
    const owner = this
    const build = (args = []) => ({
      sql: String(sql),
      args,
      bind(...next) {
        return build(next)
      },
      async first() {
        const before = owner.changes()
        const row = raw.prepare(String(sql)).get(...args) ?? null
        owner.rowsWritten += owner.changes() - before
        return row
      },
      async all() {
        const before = owner.changes()
        const results = raw.prepare(String(sql)).all(...args)
        owner.rowsWritten += owner.changes() - before
        return { results }
      },
      async run() {
        const before = owner.changes()
        const result = raw.prepare(String(sql)).run(...args)
        owner.rowsWritten += owner.changes() - before
        return { meta: { changes: Number(result.changes || 0) } }
      },
    })
    return build()
  }

  async batch(statements) {
    if (typeof this.beforeBatch === "function") await this.beforeBatch(statements)
    this.raw.exec("BEGIN IMMEDIATE")
    try {
      const results = []
      for (const statement of statements) {
        if (/^\s*(SELECT|WITH|PRAGMA)/i.test(statement.sql) || /\bRETURNING\b/i.test(statement.sql))
          results.push(await statement.all())
        else results.push(await statement.run())
      }
      this.raw.exec("COMMIT")
      return results
    } catch (error) {
      this.raw.exec("ROLLBACK")
      throw error
    }
  }
}

function providerObservationKv({ rowsWritten = 0, generatedAt = new Date().toISOString() } = {}) {
  return {
    async get(key, type) {
      assert.equal(key, "iconoplasm:observability-snapshot:v1")
      assert.equal(type, "json")
      return {
        schemaVersion: 3,
        generatedAt,
        providerAdmission: {
          accountId: "account-test",
          dayKey: new Date(generatedAt).toISOString().slice(0, 10),
          rowsWritten,
        },
      }
    },
  }
}

function discoveryAdmissionFixtureDb(onMutation) {
  return {
    prepare(sql) {
      const text = String(sql)
      if (text.includes("icono_discovery_compact_activation_v2")) {
        return { first: async () => ({ status: "complete" }) }
      }
      if (text.includes("FROM icono_discovery_ordinals_v2")) {
        return {
          bind() {
            return this
          },
          all: async () => ({ results: [] }),
        }
      }
      if (text.includes("icono_discovery_dictionary_meta_v2")) {
        return { first: async () => ({ version: 1 }) }
      }
      throw new Error(`Unexpected discovery admission query: ${text}`)
    },
    batch() {
      onMutation()
    },
  }
}

function sqliteDoStorage(raw) {
  return {
    sql: {
      exec(sql, ...args) {
        const statement = raw.prepare(String(sql))
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(callback) {
      raw.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        raw.exec("COMMIT")
        return result
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    },
  }
}

test("one hundred votes for one dirty gene retain one durable job and one pending Queue wake", async (t) => {
  const db = new SqliteD1(voteProjectionSchema)
  t.after(() => db.raw.close())
  const messages = []
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      async send(body) {
        messages.push(body)
      },
    },
  }

  for (let vote = 0; vote < 100; vote += 1) {
    const result = await scheduleVoteProjectionRefresh(env, null, {
      symbol: "TP53",
      actorId: `voter-${vote}`,
      reason: "vote_auto_promote",
    })
    assert.equal(result.durable, true)
  }

  const durable = db.raw
    .prepare(
      "SELECT COUNT(*) AS jobs, MIN(job_version) AS min_version, MAX(job_version) AS max_version FROM icono_vote_projection_refresh_jobs",
    )
    .get()
  assert.equal(durable.jobs, 1)
  assert.equal(durable.min_version, 100)
  assert.equal(durable.max_version, 100)
  assert.equal(messages.length, 1)
})

test("concurrent first votes claim exactly one durable wake", async (t) => {
  const db = new SqliteD1(voteProjectionSchema)
  t.after(() => db.raw.close())
  const messages = []
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      async send(body) {
        messages.push(body)
      },
    },
  }
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      scheduleVoteProjectionRefresh(env, null, {
        symbol: "TP53",
        actorId: `parallel-${index}`,
        reason: "vote_auto_promote",
      }),
    ),
  )
  assert.equal(messages.length, 1)
  const row = db.raw
    .prepare(
      "SELECT job_version,wake_outstanding,wake_version FROM icono_vote_projection_refresh_jobs WHERE gene_symbol='TP53'",
    )
    .get()
  assert.equal(row.job_version, 20)
  assert.equal(row.wake_outstanding, 1)
  assert.equal(row.wake_version >= 1, true)
})

test("an initial Queue send failure leaves the durable gene retryable and the next vote sends one wake", async (t) => {
  const db = new SqliteD1(voteProjectionSchema)
  t.after(() => db.raw.close())
  const messages = []
  let sends = 0
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      async send(body) {
        sends += 1
        if (sends === 1) throw new Error("injected Queue outage")
        messages.push(body)
      },
    },
  }
  const first = await scheduleVoteProjectionRefresh(env, null, {
    symbol: "TP53",
    actorId: "first",
  })
  assert.equal(first.mode, "durable_pending")
  const second = await scheduleVoteProjectionRefresh(env, null, {
    symbol: "TP53",
    actorId: "second",
  })
  assert.equal(second.queue_sent, true)
  assert.equal(messages.length, 1)
  const row = db.raw
    .prepare(
      "SELECT job_version,wake_outstanding,wake_version FROM icono_vote_projection_refresh_jobs WHERE gene_symbol='TP53'",
    )
    .get()
  assert.equal(row.job_version, 2)
  assert.equal(row.wake_outstanding, 1)
  assert.equal(row.wake_version, 2)
})

test("mutation lanes retain 30 percent global headroom and cannot borrow another lane", () => {
  const raw = new DatabaseSync(":memory:")
  raw.exec(`
    CREATE TABLE mutation_reservation_audit (
      operation_id TEXT NOT NULL,
      lane TEXT NOT NULL,
      reserved_units INTEGER NOT NULL
    );
  `)
  const storage = {
    sql: {
      exec(sql, ...args) {
        const statement = raw.prepare(sql)
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(callback) {
      raw.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        raw.exec("COMMIT")
        return result
      } catch (error) {
        raw.exec("ROLLBACK")
        throw error
      }
    },
  }
  const ledger = new DailyMutationLaneReservations(storage)
  ledger.initialize()
  raw.exec(`
    CREATE TRIGGER mutation_reservation_write_audit
    AFTER INSERT ON daily_mutation_lane_reservations
    BEGIN
      INSERT INTO mutation_reservation_audit(operation_id, lane, reserved_units)
      VALUES (NEW.operation_id, NEW.lane, NEW.reserved_units);
    END;
  `)

  const day = "2026-09-19"
  const reserve = (lane, operationId, units) =>
    ledger.reserve({ day, lane, operation_id: operationId, units })
  for (const [lane, limit] of Object.entries(MUTATION_LANE_DAILY_LIMITS)) {
    const receipt = reserve(lane, `${lane}:full`, limit)
    assert.equal(receipt.ok, true)
    assert.equal(receipt.replayed, false)
  }
  assert.equal(
    Object.values(MUTATION_LANE_DAILY_LIMITS).reduce((sum, value) => sum + value, 0),
    70_000,
  )
  assert.equal(
    reserve("user_action", "user-action:overflow", 1).code,
    "MUTATION_LANE_CAPACITY_EXHAUSTED",
  )
  assert.equal(reserve("publication", "publication:overflow", 1).ok, false)
  const replay = reserve("laptop_delivery", "laptop_delivery:full", 10_000)
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  const afterMidnight = ledger.reserve({
    day: "2026-09-20",
    lane: "laptop_delivery",
    operation_id: "laptop_delivery:full",
    units: 10_000,
  })
  assert.equal(afterMidnight.ok, true)
  assert.equal(afterMidnight.replayed, true)
  assert.equal(afterMidnight.day, day)
  assert.equal(afterMidnight.requested_day, "2026-09-20")
  assert.equal(afterMidnight.carried_from_day, day)
  assert.equal(ledger.snapshot("2026-09-20").lanes.laptop_delivery.reserved, 0)
  assert.throws(
    () => reserve("laptop_delivery", "laptop_delivery:full", 9_999),
    /MUTATION_RESERVATION_IDENTITY_MISMATCH/,
  )
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM mutation_reservation_audit").get().n, 4)
  raw.close()
})

test("authoritative provider writes consume the same 70 percent ordinary ceiling as lane reservations", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const storage = sqliteDoStorage(raw)
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage,
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    { KV: providerObservationKv({ rowsWritten: 0 }) },
  )
  const post = (path, body) =>
    owner.fetch(
      new Request(`https://iconoplasm-d1-daily-budget-kill-switch${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    )
  // The provider observation is deliberately generated at test runtime. Keep
  // the request on that same UTC day so this contract does not turn into a
  // midnight-expiry test merely because the calendar advanced.
  const day = new Date().toISOString().slice(0, 10)
  const recorded = await post("/record", {
    day_key: day,
    cycle_key: day,
    rows_written: 65_000,
  })
  assert.equal(recorded.status, 200)

  const accepted = await post("/reserve-mutation-writes", {
    day_key: day,
    lane: "user_action",
    operation_id: "known-headroom:accepted",
    units: 5_000,
  })
  assert.equal(accepted.status, 200)

  const refused = await post("/reserve-mutation-writes", {
    day_key: day,
    lane: "publication",
    operation_id: "known-headroom:refused",
    units: 1,
  })
  assert.equal(refused.status, 429)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(await refused.json()).filter(([key]) =>
        ["code", "provider_rows_written", "all_lane_reserved_units", "ordinary_ceiling"].includes(
          key,
        ),
      ),
    ),
    {
      code: "MUTATION_PROVIDER_HEADROOM_RESERVED",
      provider_rows_written: 65_000,
      all_lane_reserved_units: 5_000,
      ordinary_ceiling: 70_000,
    },
  )
})

test("mutation admission fails closed when the account-wide provider observation is missing", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate({
    storage: sqliteDoStorage(raw),
    blockConcurrencyWhile(callback) {
      return callback()
    },
  })
  const response = await owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: new Date().toISOString().slice(0, 10),
        lane: "user_action",
        operation_id: "provider-observation:missing",
        units: 1,
      }),
    }),
  )
  assert.equal(response.status, 429)
  assert.equal((await response.json()).code, "MUTATION_PROVIDER_OBSERVATION_MISSING")
})

test("staging admission reads the shared account-wide provider observation from PROD_KV", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    {
      KV: { get: async () => null },
      PROD_KV: providerObservationKv({ rowsWritten: 0 }),
    },
  )
  const response = await owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: new Date().toISOString().slice(0, 10),
        lane: "user_action",
        operation_id: "provider-observation:shared-production-kv",
        units: 1,
      }),
    }),
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
})

test("mutation admission accepts the equivalent legacy snapshot during rolling deployment", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const generatedAt = new Date().toISOString()
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    {
      KV: {
        async get(key, type) {
          assert.equal(key, "iconoplasm:observability-snapshot:v1")
          assert.equal(type, "json")
          return {
            schemaVersion: 3,
            generatedAt,
            d1: {
              currentDay: {
                date: generatedAt.slice(0, 10),
                rowsWritten: 14,
                covered: true,
              },
            },
          }
        },
      },
    },
  )
  const response = await owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: generatedAt.slice(0, 10),
        lane: "user_action",
        operation_id: "provider-observation:legacy-rollout",
        units: 1,
      }),
    }),
  )
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
})

test("mutation admission fails closed when the account-wide provider observation is stale", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const staleAt = new Date(Date.now() - 91 * 60_000).toISOString()
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    { KV: providerObservationKv({ generatedAt: staleAt }) },
  )
  const response = await owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: new Date().toISOString().slice(0, 10),
        lane: "user_action",
        operation_id: "provider-observation:stale",
        units: 1,
      }),
    }),
  )
  assert.equal(response.status, 429)
  assert.equal((await response.json()).code, "MUTATION_PROVIDER_OBSERVATION_STALE")
})

test("stale projected telemetry is refreshed once from the live provider authority", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const staleAt = new Date(Date.now() - 91 * 60_000).toISOString()
  const day = new Date().toISOString().slice(0, 10)
  let refreshes = 0
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    { KV: providerObservationKv({ generatedAt: staleAt }) },
    {
      accountUsage: {
        async refresh() {
          refreshes += 1
          return {
            day,
            measured_at: Date.now(),
            rows_read: 0,
            rows_written: 123,
            requests: 1,
          }
        },
      },
    },
  )
  const reserve = (operationId) =>
    owner.fetch(
      new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_key: day,
          lane: "user_action",
          operation_id: operationId,
          units: 1,
        }),
      }),
    )

  const first = await reserve("provider-observation:live-refresh:first")
  assert.equal(first.status, 200)
  assert.equal((await first.json()).ok, true)
  assert.equal(owner.providerObservationCache?.rows_written, 123)
  assert.equal(owner.providerObservationCache?.source, "live_provider")
  const second = await reserve("provider-observation:live-refresh:second")
  assert.equal(second.status, 200)
  assert.equal(refreshes, 1)
})

test("fresh account-wide provider writes from other databases consume ordinary headroom", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    { KV: providerObservationKv({ rowsWritten: 69_999 }) },
  )
  const response = await owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: new Date().toISOString().slice(0, 10),
        lane: "user_action",
        operation_id: "provider-observation:cross-database",
        units: 2,
      }),
    }),
  )
  assert.equal(response.status, 429)
  const payload = await response.json()
  assert.equal(payload.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")
  assert.equal(payload.provider_rows_written, 69_999)
})

test("daily-budget owner schedules terminal compaction at the next no-traffic eligibility", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const alarms = []
  const storage = {
    ...sqliteDoStorage(raw),
    async setAlarm(at) {
      alarms.push(at)
    },
  }
  const owner = new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate({
    storage,
    blockConcurrencyWhile(callback) {
      return callback()
    },
  })
  owner.mutationReservations.reserve({
    day: "2026-09-19",
    lane: "user_action",
    operation_id: "no-traffic-aging",
    units: 1,
  })
  owner.mutationReservations.complete({
    operation_id: "no-traffic-aging",
    completed_at: "2026-09-19T00:00:00.000Z",
  })
  await owner.alarm()
  assert.equal(alarms.at(-1), Date.parse("2026-10-21T00:00:00.000Z"))
})

test("unresolved reservations survive indefinitely while old completed identities compact to anti-reuse tombstones", () => {
  const raw = new DatabaseSync(":memory:")
  const storage = sqliteDoStorage(raw)
  const ledger = new DailyMutationLaneReservations(storage)
  ledger.initialize()
  const oldDay = "2026-07-01"
  ledger.reserve({
    day: oldDay,
    lane: "user_action",
    operation_id: "lifecycle:uncertain",
    units: 3,
  })
  ledger.reserve({
    day: oldDay,
    lane: "publication",
    operation_id: "lifecycle:completed",
    units: 7,
  })
  ledger.complete({ operation_id: "lifecycle:completed", completed_at: "2026-07-02T00:00:00Z" })
  const compacted = ledger.compactTerminal({ now: "2026-08-04T00:00:00Z", limit: 100 })
  assert.equal(compacted.compacted, 1)
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM daily_mutation_lane_reservations WHERE operation_id='lifecycle:uncertain'",
      )
      .get().n,
    1,
  )
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM daily_mutation_lane_reservation_tombstones WHERE operation_id='lifecycle:completed'",
      )
      .get().n,
    1,
  )
  const replay = ledger.reserve({
    day: "2026-09-19",
    lane: "publication",
    operation_id: "lifecycle:completed",
    units: 7,
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.terminal, true)
  assert.equal(replay.day, oldDay)
  assert.throws(
    () =>
      ledger.reserve({
        day: "2026-09-19",
        lane: "publication",
        operation_id: "lifecycle:completed",
        units: 8,
      }),
    /MUTATION_RESERVATION_IDENTITY_MISMATCH/,
  )
  const expired = ledger.compactTerminal({ now: "2026-09-05T00:00:00Z", limit: 100 })
  assert.equal(expired.expired_tombstones, 1)
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM daily_mutation_lane_reservation_tombstones WHERE operation_id='lifecycle:completed'",
      )
      .get().n,
    0,
  )
  assert.equal(MUTATION_MAX_TRACKED_IDENTITIES_AT_70K_PER_DAY, 4_480_000)
  raw.close()
})

test("discovery overload stays pending and refuses before any D1 mutation", async () => {
  let d1Mutations = 0
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/reserve-mutation-writes")
        const body = await request.json()
        assert.equal(body.lane, "user_action")
        assert.equal(body.units, 8)
        return Response.json(
          {
            ok: false,
            code: "MUTATION_LANE_CAPACITY_EXHAUSTED",
            disposition: "pending_or_retryable_refusal",
          },
          { status: 429 },
        )
      },
    }),
  }
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/discoveries/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=test" },
          body: JSON.stringify({
            batch_id: "device-1:7",
            encounters: [
              {
                symbol: "TP53",
                at: 1_800_000_000,
                source: "extension_hover",
                trigger: "hover_dwell",
                dwell_ms: 900,
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: discoveryAdmissionFixtureDb(() => {
          d1Mutations += 1
        }),
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: capacity,
        GAME_SESSIONS: {
          idFromName: () => "session",
          get: () => ({ fetch: async () => Response.json({ user_id: "reader-1" }) }),
        },
      },
      { waitUntil() {} },
    )
  const payload = await response.json()
  assert.equal(response.status, 429)
  assert.equal(payload.pending, true)
  assert.equal(payload.persisted, false)
  assert.equal(payload.batch_id, "device-1:7")
  assert.equal(d1Mutations, 0)
})

test("provider headroom refusal reaches discovery unchanged before D1 dispatch", async () => {
  let d1Mutations = 0
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/discoveries/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=test" },
          body: JSON.stringify({
            batch_id: "device-1:provider-headroom",
            encounters: [
              {
                symbol: "TP53",
                at: 1_800_000_000,
                source: "extension_hover",
                trigger: "hover_dwell",
                dwell_ms: 900,
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: discoveryAdmissionFixtureDb(() => {
          d1Mutations += 1
        }),
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
          idFromName: () => "global",
          get: () => ({
            fetch: async () =>
              Response.json(
                {
                  ok: false,
                  code: "MUTATION_PROVIDER_HEADROOM_RESERVED",
                  disposition: "pending_or_retryable_refusal",
                },
                { status: 429 },
              ),
          }),
        },
        GAME_SESSIONS: {
          idFromName: () => "session",
          get: () => ({ fetch: async () => Response.json({ user_id: "reader-1" }) }),
        },
      },
      { waitUntil() {} },
    )
  const payload = await response.json()
  assert.equal(response.status, 429)
  assert.equal(payload.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")
  assert.equal(payload.pending, true)
  assert.equal(payload.persisted, false)
  assert.equal(d1Mutations, 0)
})

test("discovery request fails closed before D1 when the shared mutation authority is unbound", async () => {
  let d1Mutations = 0
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/discoveries/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=test" },
          body: JSON.stringify({
            batch_id: "device-1:missing-authority",
            encounters: [
              {
                symbol: "TP53",
                at: 1_800_000_000,
                source: "extension_hover",
                trigger: "hover_dwell",
                dwell_ms: 900,
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: discoveryAdmissionFixtureDb(() => {
          d1Mutations += 1
        }),
        GAME_SESSIONS: {
          idFromName: () => "session",
          get: () => ({ fetch: async () => Response.json({ user_id: "reader-1" }) }),
        },
      },
      { waitUntil() {} },
    )
  const payload = await response.json()
  assert.equal(response.status, 503)
  assert.equal(payload.code, "ICONOPLASM_D1_DAILY_BUDGET_CONFIGURATION_ERROR")
  assert.equal(d1Mutations, 0)
})

test("cold ten-symbol discovery reserves measured dictionary writes while the warm retry reserves six", async (t) => {
  const migrationRoot = new URL("../../migrations-iconoplasm/", import.meta.url)
  const schema = readdirSync(migrationRoot)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationRoot), "utf8"))
    .join("\n")
  const db = new MeteredSqliteD1(schema)
  t.after(() => db.raw.close())
  const symbols = Array.from({ length: 10 }, (_, index) => `COLD${index}`)
  const insert = db.raw.prepare(
    "INSERT INTO icono_gene_catalog(gene_symbol, full_name) VALUES (?, ?)",
  )
  for (const symbol of symbols) insert.run(symbol, symbol)
  db.raw
    .prepare(
      "UPDATE icono_discovery_compact_activation_v2 SET status='complete', completed_at=CURRENT_TIMESTAMP WHERE singleton=1",
    )
    .run()
  const reservations = []
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
      idFromName: () => "global",
      get: () => ({
        async fetch(request) {
          const body = await request.json()
          if (new URL(request.url).pathname === "/reserve-mutation-writes") reservations.push(body)
          return Response.json({ ok: true })
        },
      }),
    },
    GAME_SESSIONS: {
      idFromName: () => "session",
      get: () => ({ fetch: async () => Response.json({ user_id: "reader-cold" }) }),
    },
  }
  const send = (batchId) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/discoveries/batch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: "session=test" },
          body: JSON.stringify({
            batch_id: batchId,
            encounters: symbols.map((symbol, index) => ({
              symbol,
              at: 1_800_000_000 + index,
              source: "extension_hover",
              trigger: "hover_dwell",
              dwell_ms: 900,
            })),
          }),
        },
      ),
      env,
      { waitUntil() {} },
    )

  const beforeCold = db.rowsWritten
  assert.equal((await send("cold:1")).status, 200)
  const coldWrites = db.rowsWritten - beforeCold
  assert.equal(reservations[0].units, 17)
  assert.ok(reservations[0].units >= coldWrites, JSON.stringify({ coldWrites }))

  const beforeWarm = db.rowsWritten
  assert.equal((await send("warm:2")).status, 200)
  const warmWrites = db.rowsWritten - beforeWarm
  assert.equal(reservations[1].units, 6)
  assert.ok(reservations[1].units >= warmWrites, JSON.stringify({ warmWrites }))
  assert.ok(coldWrites > warmWrites, JSON.stringify({ coldWrites, warmWrites }))
  t.diagnostic(
    JSON.stringify({ operation: "discovery-batch-10", coldWrites, warmWrites, coldUnits: 17 }),
  )
})

test("finalization recovery lane refuses a durable phase before its first mutation", async () => {
  let mutations = 0
  let reads = 0
  const reservations = []
  const db = {
    prepare() {
      return {
        bind() {
          return this
        },
        async all() {
          reads += 1
          if (reads === 1) return { results: [] }
          return {
            results: [
              {
                gene_symbol: "TP53",
                job_version: 7,
                status: "queued",
                phase: "reconcile",
                keep_assets_json: "[]",
                legacy_assets_json: "[]",
                vision_ids_json: "[]",
                attempts: 0,
              },
            ],
          }
        },
        async run() {
          mutations += 1
          throw new Error("finalization must refuse before mutation")
        },
      }
    },
    async batch() {
      mutations += 1
      throw new Error("finalization must refuse before mutation")
    },
  }
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        const body = await request.json()
        reservations.push(body)
        return Response.json(
          { ok: false, code: "MUTATION_LANE_CAPACITY_EXHAUSTED" },
          { status: 429 },
        )
      },
    }),
  }

  await assert.rejects(
    processPendingSyncFinalizationJobs(
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: capacity,
      },
      { waitUntil() {} },
      { symbols: ["TP53"], limit: 1, recoveryLimit: 1, finalizeIfDrained: false },
    ),
    /ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED/,
  )
  assert.equal(mutations, 0)
  assert.deepEqual(
    reservations.map(({ lane, operation_id, units }) => ({ lane, operation_id, units })),
    [
      {
        lane: "finalization_recovery",
        operation_id: "finalization:TP53:7:reconcile",
        units: 50,
      },
    ],
  )
})

test("completed-pending finalization reserves once for one bounded completion page", async () => {
  let mutations = 0
  const reservations = []
  const db = {
    prepare(sql) {
      const text = String(sql)
      return {
        bind() {
          return this
        },
        async all() {
          if (
            text.includes("phase IN ('completed_pending_finalize', 'completed')") &&
            text.includes("SELECT gene_symbol, job_version")
          ) {
            return {
              results: [
                {
                  gene_symbol: "BRCA1",
                  job_version: 12,
                  reason: "generation_session_publish",
                },
                {
                  gene_symbol: "TP53",
                  job_version: 11,
                  reason: "generation_session_publish",
                },
              ],
            }
          }
          return { results: [] }
        },
        async first() {
          throw new Error(`unexpected first: ${text}`)
        },
        async run() {
          mutations += 1
          throw new Error("completed finalization must refuse before mutation")
        },
      }
    },
  }
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        const body = await request.json()
        reservations.push(body)
        return Response.json(
          { ok: false, code: "MUTATION_LANE_CAPACITY_EXHAUSTED" },
          { status: 429 },
        )
      },
    }),
  }
  await assert.rejects(
    processPendingSyncFinalizationJobs(
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: capacity,
      },
      { waitUntil() {} },
      { symbols: ["TP53"], limit: 1, recoveryLimit: 1, finalizeIfDrained: true },
    ),
    /ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED/,
  )
  assert.equal(mutations, 0)
  assert.equal(reservations.length, 1)
  assert.equal(reservations[0].lane, "laptop_delivery")
  assert.equal(reservations[0].units, 50)
  assert.match(reservations[0].operation_id, /^finalization-complete-page:[a-f0-9]{64}$/)
})

test("publication lane refuses vote projection before D1 mutation", async () => {
  let d1Touches = 0
  const reservations = []
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        const body = await request.json()
        reservations.push(body)
        return Response.json(
          { ok: false, code: "MUTATION_LANE_CAPACITY_EXHAUSTED" },
          { status: 429 },
        )
      },
    }),
  }
  const result = await processVoteProjectionRefreshJobBatch(
    {
      ICONOPLASM_DB: {
        prepare() {
          d1Touches += 1
          throw new Error("publication must refuse before D1")
        },
      },
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: capacity,
    },
    [
      {
        gene_symbol: "TP53",
        actor_id: "reader-1",
        reason: "vote_auto_promote",
        attempts: 0,
        job_version: 9,
      },
    ],
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].ok, false)
  assert.match(result[0].error, /ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED/)
  assert.equal(d1Touches, 0)
  assert.deepEqual(
    reservations.map(({ lane, operation_id, units }) => ({ lane, operation_id, units })),
    [{ lane: "publication", operation_id: "vote-projection:TP53:9", units: 4 }],
  )
})

test("publication reservation covers the measured worst accepted projection on real schema and triggers", async (t) => {
  const migrationRoot = new URL("../../migrations-iconoplasm/", import.meta.url)
  const schema = readdirSync(migrationRoot)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, migrationRoot), "utf8"))
    .join("\n")
  const db = new MeteredSqliteD1(schema)
  t.after(() => db.raw.close())
  const symbol = "TP53"
  db.raw
    .prepare("INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES(?,?)")
    .run(symbol, symbol)
  const assets = Array.from({ length: 8 }, (_, index) => ({
    asset_sha256: index.toString(16).padStart(64, "0"),
    vision_id: `anima-v1-${index + 1}`,
    upvotes: index === 0 ? 10 : 0,
    downvotes: 0,
    score: index === 0 ? 10 : 0,
    vote_count: index === 0 ? 10 : 0,
  }))
  const insertAsset = db.raw.prepare(
    `INSERT INTO icono_portrait_assets
     (gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id)
     VALUES(?,?,'full','thumb',?,?,?)`,
  )
  for (const [index, asset] of assets.entries())
    insertAsset.run(
      symbol,
      asset.asset_sha256,
      index === 0 ? "approved" : "draft",
      asset.vision_id,
      `A1-${index + 1}`,
    )
  db.raw
    .prepare("INSERT INTO icono_publish_state(gene_symbol,current_asset_sha256) VALUES(?,?)")
    .run(symbol, assets[0].asset_sha256)
  db.raw
    .prepare(
      "INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,actor_id,reason,next_attempt_at,job_version) VALUES(?,'tester','vote_auto_promote','2020-01-01',7)",
    )
    .run(symbol)
  const reservations = []
  const result = await processVoteProjectionRefreshJobBatch(
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
        idFromName: () => "global",
        get: () => ({
          fetch: async (request) => {
            const body = await request.json()
            if (body.lane) reservations.push(body)
            return Response.json({ ok: true })
          },
        }),
      },
      ICONOPLASM_VOTE_COORDINATORS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => Response.json({ ok: true, symbol, asset_summaries: assets }),
        }),
      },
    },
    [{ gene_symbol: symbol, actor_id: "tester", reason: "vote_auto_promote", job_version: 7 }],
  )
  assert.equal(result[0].ok, true, JSON.stringify(result[0]))
  assert.equal(result[0].asset_count, 8)
  assert.equal(reservations.length, 1)
  assert.ok(
    reservations[0].units >= db.rowsWritten,
    JSON.stringify({ reserved: reservations[0].units, measured: db.rowsWritten }),
  )
  assert.ok(db.rowsWritten > 8, JSON.stringify({ measured: db.rowsWritten }))

  db.raw
    .prepare(
      "INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,actor_id,reason,next_attempt_at,job_version) VALUES(?,'tester','vote_auto_promote','2020-01-01',8)",
    )
    .run(symbol)
  const ninth = {
    asset_sha256: "f".repeat(64),
    vision_id: "anima-v1-9",
    upvotes: 0,
    downvotes: 0,
    score: 0,
    vote_count: 0,
  }
  const beforeOverflow = db.rowsWritten
  const overflowReservations = []
  const overBound = await processVoteProjectionRefreshJobBatch(
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
        idFromName: () => "global",
        get: () => ({
          fetch: async (request) => {
            const body = await request.json()
            if (body.lane) overflowReservations.push(body)
            return Response.json({ ok: true })
          },
        }),
      },
      ICONOPLASM_VOTE_COORDINATORS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () =>
            Response.json({ ok: true, symbol, asset_summaries: [...assets, ninth] }),
        }),
      },
    },
    [{ gene_symbol: symbol, actor_id: "tester", reason: "vote_auto_promote", job_version: 8 }],
  )
  assert.equal(overBound[0].ok, true, JSON.stringify(overBound[0]))
  assert.equal(overBound[0].asset_count, 9)
  assert.equal(overflowReservations.length, 1)
  assert.ok(
    overflowReservations[0].units >= db.rowsWritten - beforeOverflow,
    JSON.stringify({
      reserved: overflowReservations[0].units,
      measured: db.rowsWritten - beforeOverflow,
    }),
  )

  const auditAssets = Array.from({ length: 65 }, (_, index) => ({
    asset_sha256: (index + 100).toString(16).padStart(64, "0"),
    vision_id: `anima-audit-${index + 1}`,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    vote_count: 0,
  }))
  const auditRequired = await processVoteProjectionRefreshJobBatch(
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
        idFromName: () => "global",
        get: () => ({ fetch: async () => assert.fail("audit refusal must precede admission") }),
      },
      ICONOPLASM_VOTE_COORDINATORS: {
        idFromName: (name) => name,
        get: () => ({
          fetch: async () => Response.json({ ok: true, symbol, asset_summaries: auditAssets }),
        }),
      },
    },
    [{ gene_symbol: symbol, actor_id: "audit", reason: "vote_auto_promote", job_version: 99 }],
  )
  assert.equal(auditRequired[0].ok, false)
  assert.match(auditRequired[0].error, /VOTE_PROJECTION_HISTORICAL_ASSET_AUDIT_REQUIRED/)

  db.raw.exec("DELETE FROM icono_vote_projection_refresh_jobs")
  db.raw
    .prepare(
      "INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,actor_id,reason,next_attempt_at,job_version) VALUES(?,'tester','vote_auto_promote','2020-01-01',9)",
    )
    .run(symbol)
  const raceWakes = []
  const raceEnv = {
    ICONOPLASM_DB: db,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
      idFromName: () => "global",
      get: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
    ICONOPLASM_VOTE_COORDINATORS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => Response.json({ ok: true, symbol, asset_summaries: assets }),
      }),
    },
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      async send(body) {
        raceWakes.push(body)
      },
    },
  }
  let injected = false
  db.beforeBatch = async (statements) => {
    if (
      !injected &&
      statements.some((statement) =>
        String(statement.sql).includes("DELETE FROM icono_vote_projection_refresh_jobs"),
      )
    ) {
      injected = true
      await scheduleVoteProjectionRefresh(raceEnv, null, {
        symbol,
        actorId: "racing-voter",
        reason: "vote_auto_promote",
      })
    }
  }
  const raced = await processVoteProjectionRefreshJobBatch(raceEnv, [
    { gene_symbol: symbol, actor_id: "tester", reason: "vote_auto_promote", job_version: 9 },
  ])
  db.beforeBatch = null
  assert.equal(raced[0].ok, true)
  assert.equal(raced[0].superseded, true)
  assert.equal(
    db.raw
      .prepare(
        "SELECT job_version FROM icono_vote_projection_refresh_jobs WHERE gene_symbol='TP53'",
      )
      .get().job_version,
    10,
  )
  assert.equal(raceWakes.length, 1)
})

test("workstation mutation route refuses in the laptop lane before D1", async () => {
  let d1Touches = 0
  const calls = []
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        const path = new URL(request.url).pathname
        const body = await request.json()
        calls.push({ path, body })
        assert.equal(path, "/reserve-mutation-writes")
        return Response.json(
          { ok: false, code: "MUTATION_LANE_CAPACITY_EXHAUSTED" },
          { status: 429 },
        )
      },
    }),
  }
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/authority/revisions/revision_0001/tags-derivatives",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer replica-secret",
          },
          body: JSON.stringify({ derivative_id: "derivative_0001" }),
        },
      ),
      {
        ICONOPLASM_DB: {
          prepare() {
            d1Touches += 1
            throw new Error("laptop route must refuse before D1")
          },
        },
        ICONOPLASM_AUTHORITY_REPLICA_TOKEN: "replica-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: capacity,
        ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
        ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "40000000",
      },
      { waitUntil() {} },
    )
  const payload = await response.json()
  assert.equal(response.status, 503)
  assert.equal(payload.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(d1Touches, 0)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.lane, "laptop_delivery")
  assert.equal(calls[0].body.units, 50)
  assert.match(calls[0].body.operation_id, /^laptop:[a-f0-9]{64}$/)
})
