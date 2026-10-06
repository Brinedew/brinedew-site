import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  DailyMutationLaneReservations,
  MUTATION_MAX_TRACKED_IDENTITIES_AT_70K_PER_DAY,
} from "../lib/iconoplasm-mutation-lane-reservations.js"
import { secondsUntilCloudflareDailyReset } from "../lib/cloudflare-availability.js"

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

function pressureLedger() {
  const raw = new DatabaseSync(":memory:")
  const ledger = new DailyMutationLaneReservations(sqliteDoStorage(raw))
  ledger.initialize()
  return { raw, ledger }
}

// B-1036, 2026-10-06: the provider sample was missing all day, and the
// formula added every receipt since midnight to a local tally that already held
// those operations' real writes. 49,300 written plus 72,380 reserved read as
// 121,680, and the B-994 rewrites were refused with half the day unused.
// Failure modes, written first:
// 1. Completed receipts still count on top of the live tally (the bug).
// 2. Open receipts stop counting (an operation in flight is unprotected).
// 3. With a provider sample, recent receipts stop counting (analytics lag).
// 4. user_action receipts, whose writes are not in the tally, stop counting.
test("a completed operation counts once: in the live tally, not again as a receipt", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const day = "2026-10-06"
  const now = "2026-10-06T13:40:00.000Z"
  for (let index = 0; index < 600; index += 1) {
    const id = `rewrite:${index}`
    assert.equal(
      ledger.reserve({ day, lane: "laptop_delivery", operation_id: id, units: 96, now }).ok,
      true,
    )
    ledger.complete({ operation_id: id, completed_at: now })
  }
  // 600 x 96 = 57,600 completed receipts; their real writes are in the tally.
  const next = { day, lane: "laptop_delivery", units: 96, local_rows_written: 49_300, now }
  assert.equal(ledger.reserve({ ...next, operation_id: "rewrite:600" }).ok, true) // 1

  // 2. Open receipts still count: 49,300 + 20,096 open + 1,000 is over 70,000.
  for (let index = 0; index < 20; index += 1) {
    ledger.reserve({ ...next, operation_id: `open:${index}`, units: 1_000 })
  }
  const crowded = ledger.reserve({ ...next, operation_id: "rewrite:601", units: 1_000 })
  assert.equal(crowded.ok, false)
  assert.equal(crowded.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")

  // 3. With a provider sample, receipts made since its window count against it,
  // completed or not: the sample cannot see them yet.
  const { raw: raw2, ledger: sampled } = pressureLedger()
  t.after(() => raw2.close())
  const observed = { observed_at: "2026-10-06T13:39:00.000Z", now }
  for (let index = 0; index < 300; index += 1) {
    const id = `recent:${index}`
    sampled.reserve({ day, lane: "laptop_delivery", operation_id: id, units: 96, ...observed })
    sampled.complete({ operation_id: id, completed_at: now })
  }
  const lagging = sampled.reserve({
    day,
    lane: "laptop_delivery",
    operation_id: "recent:300",
    units: 96,
    provider_rows_written: 41_300,
    local_rows_written: 0,
    ...observed,
  })
  assert.equal(lagging.ok, false) // 41,300 + 28,800 + 96 is over 70,000

  // 4. user_action receipts always count on the tally side.
  const { raw: raw3, ledger: votes } = pressureLedger()
  t.after(() => raw3.close())
  for (let index = 0; index < 30; index += 1) {
    const id = `discovery:${index}`
    votes.reserve({ day, lane: "user_action", operation_id: id, units: 1_000, now })
    votes.complete({ operation_id: id, completed_at: now })
  }
  const background = votes.reserve({
    day,
    lane: "laptop_delivery",
    operation_id: "after-votes",
    units: 96,
    local_rows_written: 41_000,
    now,
  })
  assert.equal(background.ok, false) // 41,000 + 30,000 + 96 is over 70,000
})

// B-897: the old fixed lanes summed every reservation started today at its
// worst-case size and never subtracted, so 200 retried 50-unit phases parked
// the laptop lane for a whole UTC day while the provider meter sat at 12%.
test("reservations the provider meter can already see stop counting against admission", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const day = "2026-09-30"
  for (let index = 0; index < 200; index += 1) {
    const receipt = ledger.reserve({
      day,
      lane: "laptop_delivery",
      operation_id: `finalization:EPYC:${index}:vision_rollups`,
      units: 50,
      now: "2026-09-30T08:30:00.000Z",
    })
    assert.equal(receipt.ok, true)
  }
  const admitted = ledger.reserve({
    day,
    lane: "laptop_delivery",
    operation_id: "finalization:EPYC:201:vision_rollups",
    units: 50,
    provider_rows_written: 12_000,
    observed_at: "2026-09-30T13:00:00.000Z",
    now: "2026-09-30T13:02:00.000Z",
  })
  assert.equal(admitted.ok, true)
  assert.equal(admitted.replayed, false)
  assert.equal(admitted.pressure, 12_050)
})

test("recent reservations accumulate until the background ceiling refuses", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const day = "2026-09-30"
  const at = {
    provider_rows_written: 0,
    observed_at: "2026-09-30T12:00:00.000Z",
    now: "2026-09-30T12:01:00.000Z",
  }
  for (let index = 0; index < 7; index += 1) {
    assert.equal(
      ledger.reserve({
        day,
        lane: "laptop_delivery",
        operation_id: `burst:${index}`,
        units: 10_000,
        ...at,
      }).ok,
      true,
    )
  }
  const refused = ledger.reserve({
    day,
    lane: "laptop_delivery",
    operation_id: "burst:7",
    units: 1,
    ...at,
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")
  assert.equal(refused.in_flight_units, 70_000)
  assert.equal(refused.ceiling, 70_000)
  // Users keep the band above background work.
  assert.equal(
    ledger.reserve({ day, lane: "user_action", operation_id: "burst:user", units: 20_000, ...at })
      .ok,
    true,
  )
  assert.equal(
    ledger.reserve({ day, lane: "user_action", operation_id: "burst:user:over", units: 1, ...at })
      .ok,
    false,
  )
})

test("without any provider observation today every reservation since midnight counts", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const day = "2026-09-30"
  const early = ledger.reserve({
    day,
    lane: "finalization_recovery",
    operation_id: "blind:early",
    units: 69_950,
    now: "2026-09-30T00:05:00.000Z",
  })
  assert.equal(early.ok, true)
  const late = ledger.reserve({
    day,
    lane: "finalization_recovery",
    operation_id: "blind:late",
    units: 51,
    now: "2026-09-30T23:55:00.000Z",
  })
  assert.equal(late.ok, false)
  assert.equal(late.in_flight_units, 69_950)
  // Yesterday's observation is not a baseline for today.
  const stale = ledger.reserve({
    day,
    lane: "finalization_recovery",
    operation_id: "blind:stale-observation",
    units: 51,
    provider_rows_written: 0,
    observed_at: "2026-09-29T23:59:00.000Z",
    now: "2026-09-30T23:55:00.000Z",
  })
  assert.equal(stale.ok, false)
  // A future-dated observation is ignored the same way.
  const future = ledger.reserve({
    day,
    lane: "finalization_recovery",
    operation_id: "blind:future-observation",
    units: 51,
    provider_rows_written: 0,
    observed_at: "2026-09-30T23:58:00.000Z",
    now: "2026-09-30T23:55:00.000Z",
  })
  assert.equal(future.ok, false)
})

test("user actions are admitted above the background ceiling up to 90 percent", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const day = "2026-09-30"
  const at = {
    provider_rows_written: 69_999,
    observed_at: "2026-09-30T12:00:00.000Z",
    now: "2026-09-30T12:01:00.000Z",
  }
  assert.equal(
    ledger.reserve({ day, lane: "laptop_delivery", operation_id: "tier:bg", units: 2, ...at }).ok,
    false,
  )
  assert.equal(
    ledger.reserve({ day, lane: "user_action", operation_id: "tier:user", units: 20_001, ...at })
      .ok,
    true,
  )
  assert.equal(
    ledger.reserve({ day, lane: "user_action", operation_id: "tier:user:over", units: 1, ...at })
      .ok,
    false,
  )
})

test("an exact operation replays its original reservation without counting twice", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const at = {
    provider_rows_written: 0,
    observed_at: "2026-09-19T12:00:00.000Z",
    now: "2026-09-19T12:01:00.000Z",
  }
  const first = ledger.reserve({
    day: "2026-09-19",
    lane: "laptop_delivery",
    operation_id: "exact:op",
    units: 69_000,
    ...at,
  })
  assert.equal(first.ok, true)
  const replay = ledger.reserve({
    day: "2026-09-19",
    lane: "laptop_delivery",
    operation_id: "exact:op",
    units: 69_000,
    ...at,
  })
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(ledger.snapshot("2026-09-19", { ...at }).in_flight_units, 69_000)
  const afterMidnight = ledger.reserve({
    day: "2026-09-20",
    lane: "laptop_delivery",
    operation_id: "exact:op",
    units: 69_000,
    now: "2026-09-20T00:01:00.000Z",
  })
  assert.equal(afterMidnight.replayed, true)
  assert.equal(afterMidnight.carried_from_day, "2026-09-19")
  assert.equal(
    ledger.snapshot("2026-09-20", { now: "2026-09-20T00:01:00.000Z" }).in_flight_units,
    0,
  )
  assert.throws(
    () =>
      ledger.reserve({
        day: "2026-09-19",
        lane: "laptop_delivery",
        operation_id: "exact:op",
        units: 68_999,
        ...at,
      }),
    /MUTATION_RESERVATION_IDENTITY_MISMATCH/,
  )
  assert.throws(
    () =>
      ledger.reserve({
        day: "2026-09-19",
        lane: "user_action",
        operation_id: "exact:op",
        units: 69_000,
        ...at,
      }),
    /MUTATION_RESERVATION_IDENTITY_MISMATCH/,
  )
})

test("admission reads pressure buckets by primary key, never the reservation table", (t) => {
  const { raw, ledger } = pressureLedger()
  t.after(() => raw.close())
  const plan = raw
    .prepare(`EXPLAIN QUERY PLAN ${ledger.pressureSql}`)
    .all("2026-09-30", "2026-09-30T11:45")
    .map((row) => String(row.detail))
    .join("\n")
  assert.match(plan, /daily_mutation_pressure_buckets USING (PRIMARY KEY|INDEX sqlite_autoindex)/)
  assert.doesNotMatch(plan, /daily_mutation_lane_reservations/)
})

test("locally recorded writes and recent reservations share the background ceiling", async (t) => {
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
    lane: "laptop_delivery",
    operation_id: "known-headroom:refused",
    units: 1,
  })
  assert.equal(refused.status, 429)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(await refused.json()).filter(([key]) =>
        ["code", "provider_rows_written", "in_flight_units", "ceiling"].includes(key),
      ),
    ),
    {
      code: "MUTATION_PROVIDER_HEADROOM_RESERVED",
      provider_rows_written: 65_000,
      in_flight_units: 5_000,
      ceiling: 70_000,
    },
  )
})

function budgetOwner(raw, env = {}, options = {}) {
  return new IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(
    {
      storage: sqliteDoStorage(raw),
      blockConcurrencyWhile(callback) {
        return callback()
      },
    },
    env,
    options,
  )
}

function reserveThrough(owner, { lane = "user_action", operationId, units = 1, day } = {}) {
  return owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: day || new Date().toISOString().slice(0, 10),
        lane,
        operation_id: operationId,
        units,
      }),
    }),
  )
}

// B-897 / #180: a missing or late telemetry sample used to answer 429 for
// every lane while the provider had room. Unknown capacity is still never
// assumed: the baseline is midnight's exact zero plus every worst-case receipt.
test("missing provider telemetry admits against our own worst-case receipts, never a 429", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const owner = budgetOwner(raw)
  const response = await reserveThrough(owner, { operationId: "provider-observation:missing" })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
})

test("staging admission reads the shared account-wide provider observation from PROD_KV", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const owner = budgetOwner(raw, {
    KV: { get: async () => null },
    PROD_KV: providerObservationKv({ rowsWritten: 50_000 }),
  })
  const response = await reserveThrough(owner, {
    lane: "laptop_delivery",
    operationId: "provider-observation:shared-production-kv",
    units: 20_001,
  })
  assert.equal(response.status, 429)
  assert.equal((await response.json()).provider_rows_written, 50_000)
})

test("a late projection is refreshed once from the live provider authority", async (t) => {
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  const staleAt = new Date(Date.now() - 91 * 60_000).toISOString()
  const day = new Date().toISOString().slice(0, 10)
  let refreshes = 0
  const owner = budgetOwner(
    raw,
    { KV: providerObservationKv({ generatedAt: staleAt }) },
    {
      accountUsage: {
        async refresh() {
          refreshes += 1
          return { day, measured_at: Date.now(), rows_read: 0, rows_written: 123, requests: 1 }
        },
      },
    },
  )
  const first = await reserveThrough(owner, {
    day,
    operationId: "provider-observation:live-refresh:first",
  })
  assert.equal(first.status, 200)
  assert.equal((await first.json()).ok, true)
  assert.equal(owner.providerObservationCache?.rows_written, 123)
  assert.equal(owner.providerObservationCache?.source, "live_provider")
  const second = await reserveThrough(owner, {
    day,
    operationId: "provider-observation:live-refresh:second",
  })
  assert.equal(second.status, 200)
  assert.equal(refreshes, 1)
})

test("a failed live refresh keeps the last good same-day observation", async (t) => {
  // A stale same-day sample needs a clock at least five minutes past midnight;
  // the real clock gives none in the first minutes of a UTC day, when the
  // late-UTC releases this test gates actually run.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-03T12:00:00.000Z") })
  const raw = new DatabaseSync(":memory:")
  t.after(() => raw.close())
  let kvReads = 0
  const owner = budgetOwner(
    raw,
    {
      KV: {
        async get() {
          kvReads += 1
          if (kvReads > 1) throw new Error("KV unavailable")
          return {
            generatedAt: new Date().toISOString(),
            providerAdmission: {
              accountId: "account-test",
              dayKey: new Date().toISOString().slice(0, 10),
              rowsWritten: 69_990,
            },
          }
        },
      },
    },
    {
      accountUsage: {
        async refresh() {
          throw new Error("analytics unavailable")
        },
      },
    },
  )
  assert.equal(
    (await reserveThrough(owner, { lane: "laptop_delivery", operationId: "good:1", units: 5 }))
      .status,
    200,
  )
  owner.providerObservationCheckedAt = 0
  owner.providerObservationCache = {
    ...owner.providerObservationCache,
    observed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  }
  const refused = await reserveThrough(owner, {
    lane: "laptop_delivery",
    operationId: "good:2",
    units: 6,
  })
  assert.equal(refused.status, 429)
  assert.equal((await refused.json()).provider_rows_written, 69_990)
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
    lane: "laptop_delivery",
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
    lane: "laptop_delivery",
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
        lane: "laptop_delivery",
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
        // Reservations in flight are the only reason it does not fit (60,000 + 8 would).
        return Response.json(
          {
            ok: false,
            code: "MUTATION_PROVIDER_HEADROOM_RESERVED",
            disposition: "pending_or_retryable_refusal",
            lane: "user_action",
            requested_units: 8,
            provider_rows_written: 60_000,
            in_flight_units: 40_000,
            ceiling: 90_000,
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
  // B-968: told when to ask again (15 minutes, in the header and the body), not a made-up 60.
  assert.equal(response.headers.get("Retry-After"), "900")
  assert.equal(payload.retry_after_seconds, 900)
})

test("provider headroom refusal reaches discovery unchanged before D1 dispatch", async () => {
  let d1Mutations = 0
  const before = secondsUntilCloudflareDailyReset()
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
  const after = secondsUntilCloudflareDailyReset()
  const payload = await response.json()
  assert.equal(response.status, 429)
  assert.equal(payload.code, "MUTATION_PROVIDER_HEADROOM_RESERVED")
  assert.equal(payload.pending, true)
  assert.equal(payload.persisted, false)
  assert.equal(d1Mutations, 0)
  // B-968: a refusal that says nothing more clears only at the UTC reset.
  assert.equal(Number(response.headers.get("Retry-After")), payload.retry_after_seconds)
  assert.ok(payload.retry_after_seconds <= before && payload.retry_after_seconds >= after)
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
