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
