import assert from "node:assert/strict"
import test from "node:test"
import {
  createOperationCostAccountUsageReader,
  parseOperationCostAccountUsage,
} from "./operation-cost-account-usage.js"

const day = "2026-09-06"
const time = Date.parse(day + "T12:00:00Z")
function payload(reads = 10) {
  return {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [{ sum: { requests: 2 } }],
            d1AnalyticsAdaptiveGroups: [
              {
                dimensions: { date: day, databaseId: "one" },
                sum: { rowsRead: reads, rowsWritten: 3 },
              },
              {
                dimensions: { date: day, databaseId: "two" },
                sum: { rowsRead: 20, rowsWritten: 4 },
              },
            ],
          },
        ],
      },
    },
  }
}

test("account admission sums every database and rejects ambiguous or truncated telemetry", () => {
  assert.deepEqual(parseOperationCostAccountUsage(payload(), day, time), {
    day,
    measured_at: time,
    rows_read: 30,
    rows_written: 7,
    requests: 2,
  })
  for (const value of [
    null,
    {},
    { errors: [{}], ...payload() },
    { data: { viewer: { accounts: [] } } },
  ]) {
    assert.throws(() => parseOperationCostAccountUsage(value, day, time), /UNAVAILABLE/)
  }
  const bad = payload()
  bad.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[0].dimensions.date = "2026-09-05"
  assert.throws(() => parseOperationCostAccountUsage(bad, day, time), /UNAVAILABLE/)
  bad.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups = Array(1000).fill(
    payload().data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[0],
  )
  assert.throws(() => parseOperationCostAccountUsage(bad, day, time), /UNAVAILABLE/)
  assert.throws(() => parseOperationCostAccountUsage(payload(NaN), day, time), /UNAVAILABLE/)
})

test("KV telemetry covers all action types and never treats unavailable data as zero", () => {
  const p = payload()
  const account = p.data.viewer.accounts[0]
  account.kvOperationsAdaptiveGroups = ["read", "write", "delete", "list"].map((actionType, i) => ({
    dimensions: { date: day, actionType },
    sum: { requests: i + 1 },
  }))
  const usage = parseOperationCostAccountUsage(p, day, time, { includeKv: true })
  assert.deepEqual(
    [usage.kv_reads, usage.kv_writes, usage.kv_deletes, usage.kv_lists],
    [1, 2, 3, 4],
  )
  assert.equal(usage.kv_measured_at, time)
  for (const bad of [
    undefined,
    null,
    Array(10000).fill(account.kvOperationsAdaptiveGroups[0]),
    [{ dimensions: { date: day, actionType: "unknown" }, sum: { requests: 1 } }],
  ]) {
    account.kvOperationsAdaptiveGroups = bad
    assert.throws(
      () => parseOperationCostAccountUsage(p, day, time, { includeKv: true }),
      /UNAVAILABLE/,
    )
  }
})

test("Durable SQL telemetry sums the complete account and rejects missing, malformed or truncated samples", () => {
  const p = payload()
  const account = p.data.viewer.accounts[0]
  const valid = [
    { dimensions: { date: day }, sum: { rowsRead: 10, rowsWritten: 2 } },
    { dimensions: { date: day }, sum: { rowsRead: 20, rowsWritten: 3 } },
  ]
  account.durableObjectsPeriodicGroups = valid
  const usage = parseOperationCostAccountUsage(p, day, time, { includeDoSql: true })
  assert.deepEqual(
    [usage.do_rows_read, usage.do_rows_written, usage.do_sql_measured_at],
    [30, 5, time],
  )
  for (const invalid of [
    undefined,
    null,
    Array(10000).fill(valid[0]),
    [{ dimensions: { date: day }, sum: { rowsRead: 1 } }],
    [{ dimensions: { date: "2026-09-05" }, sum: { rowsRead: 1, rowsWritten: 1 } }],
    [{ dimensions: { date: day }, sum: { rowsRead: -1, rowsWritten: 1 } }],
    [{ dimensions: { date: day }, sum: { rowsRead: 1.5, rowsWritten: 1 } }],
  ]) {
    account.durableObjectsPeriodicGroups = invalid
    assert.throws(
      () => parseOperationCostAccountUsage(p, day, time, { includeDoSql: true }),
      /UNAVAILABLE/,
    )
  }
})

test("concurrent KV and Durable SQL work upgrade a shared sample without discarding either meter", async () => {
  let calls = 0
  let clock = time
  let reads = 100
  const reader = createOperationCostAccountUsageReader({
    accountId: "a".repeat(32),
    token: "test-token",
    now: () => clock,
    fetcher: async (_url, options) => {
      calls++
      const p = payload()
      const query = JSON.parse(options.body).query
      if (query.includes("kvOperationsAdaptiveGroups"))
        p.data.viewer.accounts[0].kvOperationsAdaptiveGroups = []
      if (query.includes("durableObjectsPeriodicGroups"))
        p.data.viewer.accounts[0].durableObjectsPeriodicGroups = [
          { dimensions: { date: day }, sum: { rowsRead: reads, rowsWritten: 10 } },
        ]
      return Response.json(p)
    },
  })
  await Promise.all([
    reader.refresh(),
    reader.refresh({ includeKv: true }),
    reader.refresh({ includeDoSql: true }),
  ])
  const current = await reader.refresh({ includeKv: true, includeDoSql: true })
  assert.equal(current.kv_reads, 0)
  assert.equal(current.do_rows_read, 100)
  assert.ok(calls <= 3)
  const before = calls
  clock += 30000
  reads = 1
  assert.equal((await reader.refresh()).do_rows_read, 100)
  assert.equal(calls, before + 1)
})

test("a KV operation upgrades a shared D1-only refresh instead of reusing incomplete telemetry", async () => {
  let calls = 0
  const reader = createOperationCostAccountUsageReader({
    accountId: "a".repeat(32),
    token: "test-token",
    now: () => time,
    fetcher: async (_url, options) => {
      calls++
      const p = payload()
      if (JSON.parse(options.body).query.includes("kvOperationsAdaptiveGroups"))
        p.data.viewer.accounts[0].kvOperationsAdaptiveGroups = []
      return Response.json(p)
    },
  })
  const [base, kv] = await Promise.all([reader.refresh(), reader.refresh({ includeKv: true })])
  assert.equal(base.kv_reads, undefined)
  assert.equal(kv.kv_reads, 0)
  assert.equal(calls, 2)
  await reader.refresh({ includeKv: true })
  assert.equal(calls, 2)
})

test("concurrent operations share one control-plane refresh and decreasing samples cannot refund observed usage", async () => {
  let calls = 0
  let clock = time
  let reads = 100
  const reader = createOperationCostAccountUsageReader({
    accountId: "a".repeat(32),
    token: "test-token",
    now: () => clock,
    fetcher: async () => {
      calls++
      return Response.json(payload(reads))
    },
  })
  const results = await Promise.all([reader.refresh(), reader.refresh(), reader.refresh()])
  assert.equal(calls, 1)
  assert.equal(results[0].rows_read, 120)
  await reader.refresh()
  assert.equal(calls, 1)
  clock += 30_000
  reads = 10
  assert.equal((await reader.refresh()).rows_read, 120)
  assert.equal(calls, 2)
})

test("failed refreshes erase admissible telemetry and make no automatic retry", async () => {
  let calls = 0
  let clock = time
  const reader = createOperationCostAccountUsageReader({
    accountId: "a".repeat(32),
    token: "test-token",
    now: () => clock,
    fetcher: () => {
      calls++
      if (calls > 1) throw new Error("network failure")
      return Promise.resolve(Response.json(payload()))
    },
  })
  await reader.refresh()
  clock += 30_000
  await assert.rejects(reader.refresh(), /UNAVAILABLE/)
  assert.equal(reader.current(), null)
  assert.equal(calls, 2)
  await assert.rejects(reader.refresh(), /UNAVAILABLE/)
  assert.equal(calls, 2)
  clock += 30_000
  await assert.rejects(reader.refresh(), /UNAVAILABLE/)
  assert.equal(calls, 3)
})
