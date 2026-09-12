import assert from "node:assert/strict"
import test from "node:test"
import {
  parseAccountBudget,
  accountBudgetChecks,
  readAccountBudget,
} from "./lib/cloudflare-account-budget.mjs"

const day = "2026-09-13"
function fixture() {
  return {
    data: {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [{ sum: { requests: 123 } }],
            d1AnalyticsAdaptiveGroups: [
              {
                dimensions: { date: day, databaseId: "one" },
                sum: { rowsRead: 20, rowsWritten: 2 },
              },
            ],
            kvOperationsAdaptiveGroups: [
              { dimensions: { date: day, actionType: "write" }, sum: { requests: 3 } },
            ],
            durableObjectsInvocationsAdaptiveGroups: [
              { dimensions: { date: day }, sum: { requests: 456 } },
            ],
            durableObjectsPeriodicGroups: [
              { dimensions: { date: day }, sum: { rowsRead: 40, rowsWritten: 4, duration: 12.25 } },
            ],
            queueMessageOperationsAdaptiveGroups: [
              { dimensions: { date: day }, sum: { billableOperations: 32 } },
            ],
          },
        ],
      },
    },
  }
}

test("account watch covers the independent DO meter and refuses partial or invalid telemetry", () => {
  const usage = parseAccountBudget(fixture(), day, 1)
  assert.equal(usage.do_rows_read, 40)
  assert.equal(usage.rows_read, 20)
  assert.equal(usage.do_duration_gb_seconds, 12.25)
  assert.equal(usage.queue_operations, 32)
  assert.equal(accountBudgetChecks(usage).length, 12)
  assert.equal(
    accountBudgetChecks({ ...usage, do_rows_read: 4000000 }).find((c) => c.meter === "do_rows_read")
      .ok,
    false,
  )
  for (const mutate of [
    (p) => {
      p.errors = [{ message: "partial analytics" }]
    },
    (p) => {
      delete p.data.viewer.accounts[0].durableObjectsPeriodicGroups
    },
    (p) => {
      p.data.viewer.accounts[0].durableObjectsPeriodicGroups[0].dimensions.date = "2026-09-12"
    },
    (p) => {
      p.data.viewer.accounts[0].durableObjectsPeriodicGroups[0].sum.rowsRead = null
    },
    (p) => {
      p.data.viewer.accounts[0].durableObjectsPeriodicGroups[0].sum.duration = null
    },
    (p) => {
      p.data.viewer.accounts[0].durableObjectsInvocationsAdaptiveGroups[0].sum.requests = -1
    },
    (p) => {
      p.data.viewer.accounts[0].kvOperationsAdaptiveGroups[0].dimensions.actionType = "unknown"
    },
  ]) {
    const payload = fixture()
    mutate(payload)
    assert.throws(() => parseAccountBudget(payload, day, 1), /UNAVAILABLE/)
  }
})

test("telemetry uses one deadline-bound request and rejects a non-successful response", async () => {
  let calls = 0
  await assert.rejects(
    () =>
      readAccountBudget({
        accountId: "a".repeat(32),
        token: "test",
        day,
        fetcher: async (url, options) => {
          calls++
          assert.ok(options.signal instanceof AbortSignal)
          return new Response("unavailable", { status: 503 })
        },
      }),
    /HTTP_503/,
  )
  assert.equal(calls, 1)
})
