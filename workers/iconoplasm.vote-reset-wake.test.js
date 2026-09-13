import assert from "node:assert/strict"
import test from "node:test"
import {
  IconoplasmSyncGovernor,
  handleIconoplasmVoteProjectionQueue,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function governorFixture(env) {
  const values = new Map(),
    alarms = []
  const transaction = {
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
    setAlarm: async (value) => alarms.push(value),
  }
  const state = { storage: { ...transaction, transaction: (fn) => fn(transaction) } }
  const governor = new IconoplasmSyncGovernor(state, env)
  env.ICONOPLASM_SYNC_GOVERNOR = {
    idFromName: (name) => name,
    get: () => ({ fetch: (request) => governor.fetch(request) }),
  }
  return { governor, state, values, alarms }
}

test("vote and finalization reset wakes share one alarm without losing either retained lane", async (t) => {
  let now = Date.parse("2026-09-13T12:00:00Z"),
    failVotes = true
  t.mock.method(Date, "now", () => now)
  const finals = [],
    votes = []
  const env = {
    ICONOPLASM_SCHEMA_TRANSITION: "1",
    ICONOPLASM_SYNC_FINALIZATION_QUEUE: { send: async (body) => finals.push(body) },
    ICONOPLASM_VOTE_PROJECTION_QUEUE: {
      send: async (body) => {
        if (failVotes) throw new Error("temporary transport failure")
        votes.push(body)
      },
    },
  }
  const { governor, values, alarms, state } = governorFixture(env)
  const first = await governor.deferVoteProjectionToReset()
  await governor.deferFinalizationToReset()
  const writes = alarms.length
  for (let i = 0; i < 100; i++) await governor.deferVoteProjectionToReset()
  assert.equal(alarms.length, writes)
  now = first.reset_at
  await governor.alarm()
  assert.equal(finals.length + votes.length, 0)
  env.ICONOPLASM_SCHEMA_TRANSITION = "0"
  now += 300000
  await new IconoplasmSyncGovernor(state, env).alarm()
  assert.equal(finals.length, 1)
  assert.equal(values.has("finalization_reset_wake"), false)
  assert.equal(values.has("vote_projection_reset_wake"), true)
  assert.equal(alarms.at(-1), now + 900000)
  failVotes = false
  now += 900000
  await new IconoplasmSyncGovernor(state, env).alarm()
  assert.deepEqual(votes, [{ kind: "drain_vote_projection_ledger" }])
  assert.equal(values.size, 0)
  await governor.alarm()
  assert.equal(finals.length, 1)
  assert.equal(votes.length, 1)
})

test("daily vote refusal retains a reset wake before transport ack and does no D1 work", async () => {
  let reads = 0,
    acked = 0
  const env = {
    ICONOPLASM_ADMIN_TOKEN: "test",
    ICONOPLASM_DB: {
      prepare() {
        reads++
        throw new Error("unexpected D1")
      },
    },
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "40000000",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
      idFromName: () => "global",
      get: () => ({
        fetch: async (request) => {
          const body = await request.json()
          return Response.json({
            day_key: body.day_key,
            cycle_key: body.cycle_key,
            rows_read: 1000000,
            rows_written: 0,
            rows_read_daily_smart_limit: 1000000,
            rows_written_daily_smart_limit: 20000,
            exhausted: true,
            exhausted_by: "rows_read_daily_smart",
          })
        },
      }),
    },
  }
  const { values } = governorFixture(env)
  const body = { kind: "process_vote_projection_refresh", symbol: "TP53" }
  const message = {
    body,
    ack() {
      assert.ok(values.has("vote_projection_reset_wake"))
      acked++
    },
    retry() {
      assert.fail("daily refusal must not consume Queue retries")
    },
  }
  const result = await handleIconoplasmVoteProjectionQueue({ messages: [message] }, env)
  assert.equal(result.deferred, true)
  assert.equal(acked, 1)
  assert.equal(reads, 0)
  assert.deepEqual(message.body, body)
  env.ICONOPLASM_SYNC_GOVERNOR.get = () => ({
    fetch: async () => {
      throw new Error("wake unavailable")
    },
  })
  await assert.rejects(
    handleIconoplasmVoteProjectionQueue({ messages: [message] }, env),
    /wake unavailable/,
  )
  assert.equal(acked, 1, "uncertain durable handoff must retain the transport")
})

test("daily failure at a vote job lookup is handed off without rewriting the job", async () => {
  let acked = 0,
    lookups = 0
  const env = {
    ICONOPLASM_DB: {
      prepare() {
        return {
          bind() {
            return this
          },
          async first() {
            lookups++
            throw Object.assign(new Error("daily cap"), { code: "COST_SHARED_DAILY_LIMIT" })
          },
        }
      },
    },
  }
  const { values } = governorFixture(env)
  const result = await handleIconoplasmVoteProjectionQueue(
    {
      messages: [
        {
          body: { kind: "process_vote_projection_refresh", symbol: "TP53" },
          ack() {
            assert.ok(values.has("vote_projection_reset_wake"))
            acked++
          },
          retry() {
            assert.fail("budget refusal cannot burn a retry")
          },
        },
      ],
    },
    env,
  )
  assert.equal(result.deferred, true)
  assert.equal(lookups, 1)
  assert.equal(acked, 1)
})
