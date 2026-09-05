import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { acquireReleasePlan, readReleaseOrigin } from "./operation-cost-release-plan.mjs"
import { OperationCostLedger } from "../workers/lib/operation-cost-ledger.js"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"

test("release retry preserves unknown spending through expiry and lost continuation response", async (t) => {
  const db = new DatabaseSync(":memory:")
  t.after(() => db.close())
  let now = Date.parse("2026-09-05T12:00:00Z")
  const storage = {
    sql: {
      exec(sql, ...args) {
        const statement = db.prepare(sql)
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(fn) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.exec("COMMIT")
        return result
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
  }
  const ledger = new OperationCostLedger(
    storage,
    () => now,
    () => ({
      day: new Date(now).toISOString().slice(0, 10),
      measured_at: now,
      rows_read: 0,
      rows_written: 0,
      requests: 0,
    }),
  )
  ledger.initialize()
  let loseRegistration = false
  const options = {
    releaseId: "deploy-123",
    adapter: { id: "migration-1", resource: "iconoplasm" },
    prediction: { rows_read: 100, rows_written: 10, requests: 1 },
    features: ["preserved-budget-continuation"],
    send: async (suffix, method, body) => {
      if (suffix === "/receipt") return { plan: ledger.readPlan(body.id) }
      const plan = ledger.register({ ...body, principal: "admin" })
      if (loseRegistration) {
        loseRegistration = false
        throw new Error("response lost")
      }
      return { plan }
    },
  }
  const first = await acquireReleasePlan({ ...options, now })
  ledger.reserve({
    id: first.plan.id,
    step_id: first.stepId,
    step_sha256: "c".repeat(64),
    ...OPERATION_COST_IDENTITIES,
    resource: "iconoplasm",
    adapter_id: "migration-1",
    bound: { rows_read: 80, rows_written: 8, requests: 1 },
  })
  const retry = await acquireReleasePlan({ ...options, now })
  assert.equal(retry.plan.id, first.plan.id)
  assert.equal(retry.plan.expires_at, first.plan.expires_at)
  assert.equal(retry.stepId, "execute-1")
  now += 86_400_000
  loseRegistration = true
  await assert.rejects(acquireReleasePlan({ ...options, now }), /response lost/)
  const continued = await acquireReleasePlan({ ...options, now })
  assert.equal(continued.plan.predecessor_id, first.plan.id)
  assert.deepEqual(ledger.readPlan(continued.plan.id).used, {
    rows_read: 80,
    rows_written: 8,
    requests: 1,
  })
  assert.equal(ledger.readPlan(first.plan.id).status, "continued")
  await assert.rejects(
    acquireReleasePlan({ ...options, prediction: { ...options.prediction, rows_read: 101 }, now }),
    /PRESERVE_PREDICTION/,
  )
})

test("GitHub run identity and original creation date survive reruns and bound receipt retention", async () => {
  const now = Date.parse("2026-09-05T12:00:00Z")
  const options = { repository: "Brinedew/brinedew-site", runId: "123", token: "test", now }
  const fetcher = async () =>
    Response.json({ id: 123, run_attempt: 8, created_at: new Date(now - 10000).toISOString() })
  assert.deepEqual(await readReleaseOrigin({ ...options, fetcher }), {
    releaseId: "deploy-123",
    started: now - 10000,
  })
  for (const run of [
    { id: 456, created_at: new Date(now).toISOString() },
    { id: 123, created_at: new Date(now - 7 * 86_400_000).toISOString() },
    { id: 123, created_at: new Date(now + 1).toISOString() },
  ])
    await assert.rejects(
      readReleaseOrigin({ ...options, fetcher: async () => Response.json(run) }),
      /RETENTION_EXCEEDED/,
    )
  await assert.rejects(readReleaseOrigin({ ...options, token: "" }), /ORIGIN_REQUIRED/)
})
