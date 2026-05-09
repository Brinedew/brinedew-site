import assert from "node:assert/strict"
import test from "node:test"

import { iconoplasmCardCatalogBudgetPreflightStatus } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function healthySnapshot(overrides = {}) {
  return {
    kv: { reads_remaining: 100, writes_remaining: 100, lists_remaining: 100 },
    d1: { rows_read_remaining: 1000, rows_written_remaining: 1000 },
    queues: { operations_remaining: 100 },
    workers: { requests_remaining: 100, cpu_ms_remaining: 1000 },
    durable_objects: { requests_remaining: 100, rows_written_remaining: 100 },
    r2: { available: false, required: false },
    logs: { events_remaining: 100 },
    ...overrides,
  }
}

test("card catalog budget preflight fails loud when live telemetry is missing", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(null)
  assert.equal(status.ok, false)
  assert.equal(status.code, "LIVE_BUDGET_TELEMETRY_MISSING")
  assert.deepEqual(status.failures, ["live_budget_telemetry_missing"])
})

test("card catalog budget preflight covers KV exhaustion", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({ kv: { reads_remaining: 0, writes_remaining: 0, lists_remaining: 0 } }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /kv_reads/)
  assert.match(status.failures.join(","), /kv_writes/)
})

test("card catalog budget preflight covers D1 exhaustion", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({ d1: { rows_read_remaining: 0, rows_written_remaining: 0 } }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /d1_rows_read/)
  assert.match(status.failures.join(","), /d1_rows_written/)
})

test("card catalog budget preflight covers Queue exhaustion", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({ queues: { operations_remaining: 0 } }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /queue_operations/)
})

test("card catalog budget preflight covers Worker and Durable Object headroom", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({
      workers: { requests_remaining: 0, cpu_ms_remaining: 0 },
      durable_objects: { requests_remaining: -1, rows_written_remaining: -1 },
    }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /worker_requests/)
  assert.match(status.failures.join(","), /worker_cpu_ms/)
  assert.match(status.failures.join(","), /durable_object_requests/)
  assert.match(status.failures.join(","), /durable_object_rows_written/)
})

test("card catalog budget preflight records R2 unavailable without blocking when R2 is not required", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(healthySnapshot())
  assert.equal(status.ok, true)
  const r2 = status.checks.find((check) => check.name === "r2_available")
  assert.equal(r2.ok, true)
  assert.equal(r2.remaining, 0)
})

test("card catalog budget preflight fails when R2 is required but unavailable", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({ r2: { available: false, required: true } }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /r2_available/)
})

test("card catalog budget preflight covers log volume", () => {
  const status = iconoplasmCardCatalogBudgetPreflightStatus(
    healthySnapshot({ logs: { events_remaining: 0 } }),
  )
  assert.equal(status.ok, false)
  assert.match(status.failures.join(","), /logs_events/)
})
