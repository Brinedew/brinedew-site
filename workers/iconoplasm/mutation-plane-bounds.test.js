import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  processPendingSyncFinalizationJobs,
  processVoteProjectionRefreshJobBatch,
  scheduleVoteProjectionRefresh,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import {
  DailyMutationLaneReservations,
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
].join("\n")

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

test("discovery overload stays pending and refuses before any D1 dispatch", async () => {
  let d1Touches = 0
  const capacity = {
    idFromName: () => "global",
    get: () => ({
      async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/reserve-mutation-writes")
        const body = await request.json()
        assert.equal(body.lane, "user_action")
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
        ICONOPLASM_DB: {
          prepare() {
            d1Touches += 1
            throw new Error("D1 must not be reached after capacity refusal")
          },
        },
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
  assert.equal(d1Touches, 0)
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
    [{ lane: "publication", operation_id: "vote-projection:TP53:9", units: 8 }],
  )
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
