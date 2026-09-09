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
    inspectionId: "inspect-123-8",
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

test("a corrected canonical commit resumes the old migration identity with fresh inspection identity", async () => {
  const now = Date.parse("2026-09-08T12:00:00Z")
  const common = {
    path: ".github/workflows/deploy-quartz.yml",
    head_branch: "main",
    workflow_id: 42,
    head_repository: { full_name: "Brinedew/brinedew-site" },
  }
  const old = {
    ...common,
    id: 123,
    created_at: new Date(now - 10000).toISOString(),
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "failure",
  }
  const current = {
    ...common,
    id: 456,
    created_at: new Date(now).toISOString(),
    head_sha: "b".repeat(40),
    run_attempt: 3,
  }
  const options = {
    repository: "Brinedew/brinedew-site",
    runId: "456",
    resumeRunId: "123",
    token: "test",
    now,
  }
  const fetcher =
    (prior, comparison = "ahead") =>
    async (url) => {
      if (url.endsWith("/runs/456")) return Response.json(current)
      if (url.endsWith("/runs/123")) return Response.json(prior)
      assert.ok(url.includes(`/compare/${old.head_sha}...${current.head_sha}`))
      return Response.json({ status: comparison })
    }
  assert.deepEqual(await readReleaseOrigin({ ...options, fetcher: fetcher(old) }), {
    releaseId: "deploy-123",
    inspectionId: "inspect-456-3",
    started: now - 10000,
  })
  for (const patch of [
    { path: ".github/workflows/unreviewed.yml" },
    { head_branch: "another-branch" },
    { workflow_id: 99 },
    { head_repository: { full_name: "another/repository" } },
    { conclusion: "success" },
    { status: "in_progress" },
  ])
    await assert.rejects(
      readReleaseOrigin({ ...options, fetcher: fetcher({ ...old, ...patch }) }),
      /CONTINUATION_ORIGIN_INVALID/,
    )
  await assert.rejects(
    readReleaseOrigin({ ...options, fetcher: fetcher(old, "diverged") }),
    /CONTINUATION_ORIGIN_INVALID/,
  )
})

test("a verified D1-free reader containment run may establish a later migration origin", async () => {
  const now = Date.parse("2026-09-09T10:00:00Z")
  const common = {
    path: ".github/workflows/deploy-quartz.yml",
    head_branch: "main",
    workflow_id: 42,
    head_repository: { full_name: "Brinedew/brinedew-site" },
  }
  const origin = {
    ...common,
    id: 123,
    created_at: new Date(now - 10_000).toISOString(),
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
  }
  const current = {
    ...common,
    id: 456,
    created_at: new Date(now).toISOString(),
    head_sha: "b".repeat(40),
    run_attempt: 1,
  }
  const readerJobs = {
    jobs: [
      {
        name: "reader-recovery-only",
        conclusion: "success",
        steps: [
          { name: "Deploy the D1-free reader containment artifact", conclusion: "success" },
          {
            name: "Verify published readers and retained application protection",
            conclusion: "success",
          },
        ],
      },
      { name: "deploy-production", conclusion: "skipped", steps: [] },
    ],
  }
  const fetcher = async (url) => {
    if (url.endsWith("/runs/456")) return Response.json(current)
    if (url.endsWith("/runs/123")) return Response.json(origin)
    if (url.endsWith("/runs/123/jobs?per_page=100")) return Response.json(readerJobs)
    assert.ok(url.includes(`/compare/${origin.head_sha}...${current.head_sha}`))
    return Response.json({ status: "ahead" })
  }
  const options = {
    repository: "Brinedew/brinedew-site",
    runId: "456",
    resumeRunId: "123",
    token: "test",
    now,
    fetcher,
  }
  await assert.rejects(readReleaseOrigin(options), /CONTINUATION_ORIGIN_INVALID/)
  assert.deepEqual(await readReleaseOrigin({ ...options, allowReaderRecoveryOrigin: true }), {
    releaseId: "deploy-123",
    inspectionId: "inspect-456-1",
    started: now - 10_000,
  })
  for (const jobs of [
    { jobs: [] },
    { jobs: [{ ...readerJobs.jobs[0], conclusion: "failure" }] },
    { jobs: [{ ...readerJobs.jobs[0], steps: [] }] },
    { jobs: [readerJobs.jobs[0], { name: "deploy-production", conclusion: "success" }] },
  ]) {
    const invalidFetcher = async (url) => {
      if (url.endsWith("/runs/456")) return Response.json(current)
      if (url.endsWith("/runs/123")) return Response.json(origin)
      if (url.endsWith("/runs/123/jobs?per_page=100")) return Response.json(jobs)
      return Response.json({ status: "ahead" })
    }
    await assert.rejects(
      readReleaseOrigin({ ...options, allowReaderRecoveryOrigin: true, fetcher: invalidFetcher }),
      /CONTINUATION_ORIGIN_INVALID/,
    )
  }
})
