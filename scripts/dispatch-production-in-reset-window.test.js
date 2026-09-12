import assert from "node:assert/strict"
import test from "node:test"
import {
  dispatchResetTick,
  isFullRelease,
  FULL_RELEASE_STEPS,
  deploymentHeadroom,
} from "./dispatch-production-in-reset-window.mjs"

const sha = "a".repeat(40),
  instant = Date.parse("2026-09-13T00:00:10Z")
const intent = { required_head_sha: sha, reset_day: "2026-09-13", deadline: "2026-09-13T00:30:00Z" }
const run = {
  id: 123,
  head_sha: sha,
  head_branch: "main",
  path: ".github/workflows/deploy-quartz.yml",
  status: "completed",
  conclusion: "success",
  run_attempt: 2,
  created_at: "2026-09-13T00:00:10Z",
}
function fixture() {
  const writes = [],
    posts = [],
    calls = []
  const usage = Object.fromEntries(
    [
      "rows_read",
      "rows_written",
      "requests",
      "do_rows_read",
      "do_rows_written",
      "do_requests",
      "do_duration_gb_seconds",
      "queue_operations",
      "kv_reads",
      "kv_writes",
      "kv_lists",
      "kv_deletes",
    ].map((m) => [m, 0]),
  )
  Object.assign(usage, { day: intent.reset_day, measured_at: instant })
  const context = { runs: [], jobs: [], usage, writes, posts, calls }
  context.options = {
    intent,
    now: () => instant,
    persist: async (s) => writes.push(structuredClone(s)),
    readUsage: async () => usage,
    readState: async () => ({ schema_transition: false }),
    gh: async (args) => {
      calls.push(args)
      if (args[0] === "--method") {
        posts.push(args)
        assert.equal(writes.at(-1).phase, "dispatch_reserved")
        if (context.uncertain) throw Error("network interrupted")
        return {}
      }
      const endpoint = args[0]
      if (endpoint.endsWith("commits/main")) return { sha }
      if (endpoint.includes("/check-runs?"))
        return {
          check_runs: [
            {
              name: "build-and-test",
              status: "completed",
              conclusion: "success",
              started_at: new Date(instant).toISOString(),
            },
          ],
        }
      if (endpoint.includes("/attempts/")) {
        assert.ok(endpoint.includes("/attempts/2/jobs"))
        return { jobs: context.jobs }
      }
      if (endpoint.includes("/runs?")) return { workflow_runs: context.runs }
      assert.fail(endpoint)
    },
  }
  return context
}

test("reader/repair success and stale attempt steps never count as a full release", async () => {
  const f = fixture()
  f.runs = [run]
  f.jobs = [
    {
      name: "worker-repair-only",
      status: "completed",
      conclusion: "success",
      steps: FULL_RELEASE_STEPS.map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
  ]
  assert.equal(isFullRelease(run, f.jobs), false)
  assert.equal((await dispatchResetTick(f.options)).phase, "dispatched")
  assert.equal(f.posts.length, 1)
})

test("the latest full release requires every activation step plus current installed normal mode", async () => {
  const f = fixture()
  f.runs = [run]
  f.jobs = [
    {
      name: "deploy-production",
      status: "completed",
      conclusion: "success",
      steps: FULL_RELEASE_STEPS.map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
  ]
  assert.equal((await dispatchResetTick(f.options)).phase, "deployed")
  assert.equal(f.posts.length, 0)
  f.options.readState = async () => ({ schema_transition: true })
  assert.equal((await dispatchResetTick(f.options)).phase, "dispatched")
})

test("uncertain POST survives restart without repeating the dispatch or renewing its lineage", async () => {
  const f = fixture()
  f.uncertain = true
  const first = await dispatchResetTick(f.options)
  assert.equal(first.phase, "dispatch_outcome_unknown")
  assert.equal(
    (await dispatchResetTick({ ...f.options, state: first })).phase,
    "dispatch_outcome_unknown",
  )
  assert.equal(f.posts.length, 1)
  assert.equal(
    (await dispatchResetTick({ ...f.options, state: first, now: () => instant + 86400000 })).phase,
    "failed",
  )
  assert.equal(f.posts.length, 1)
})

test("a newer failed attempt supersedes an older full deployment", async () => {
  const f = fixture()
  f.runs = [run, { ...run, id: 456, conclusion: "failure", run_started_at: "2026-09-13T00:01:00Z" }]
  f.jobs = [
    {
      name: "deploy-production",
      status: "completed",
      conclusion: "success",
      steps: FULL_RELEASE_STEPS.map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
  ]
  const result = await dispatchResetTick(f.options)
  assert.notEqual(result.phase, "deployed")
  assert.equal(
    f.calls.some((args) => args[0].includes("/attempts/")),
    false,
  )
})

test("adopted active release is followed to failure without dispatching a replacement", async () => {
  const f = fixture()
  f.runs = [{ ...run, status: "in_progress", conclusion: null }]
  const active = await dispatchResetTick(f.options)
  assert.equal(active.phase, "running")
  f.runs = [{ ...run, conclusion: "failure" }]
  const failed = await dispatchResetTick({ ...f.options, state: active })
  assert.equal(failed.phase, "failed")
  assert.equal(failed.run_id, 123)
  assert.equal(f.posts.length, 0)
})

test("unknown or stale usage never becomes zero; readiness mode never mutates", async () => {
  const f = fixture()
  assert.throws(() => deploymentHeadroom({ ...f.usage, do_rows_read: null }, instant), /INVALID/)
  assert.throws(() => deploymentHeadroom({ ...f.usage, day: "2026-09-12" }, instant), /STALE/)
  assert.equal((await dispatchResetTick({ ...f.options, verifyOnly: true })).phase, "ready")
  assert.equal(f.posts.length, 0)
  assert.equal(f.writes.length, 0)
})

test("a proven migration checkpoint continues its installed origin once and retains an uncertain dispatch", async () => {
  const f = fixture()
  f.runs = [{ ...run, status: "in_progress", conclusion: null }]
  const active = await dispatchResetTick(f.options)
  f.runs = [run]
  f.jobs = [
    {
      name: "deploy-production",
      status: "completed",
      conclusion: "success",
      steps: [
        ...FULL_RELEASE_STEPS.map((name) => ({ name, status: "completed", conclusion: "skipped" })),
        ...[
          "Apply reviewed D1 migrations through prediction admission",
          "Record staged migration continuation checkpoint",
        ].map((name) => ({ name, status: "completed", conclusion: "success" })),
      ],
    },
  ]
  f.options.readState = async () => ({ schema_transition: true, origin_run_id: "99" })
  f.uncertain = true
  const continuation = await dispatchResetTick({ ...f.options, state: active })
  assert.equal(continuation.phase, "dispatch_outcome_unknown")
  assert.deepEqual(continuation.completed_checkpoints, ["123:2"])
  assert.ok(f.posts[0].includes("inputs[resume_run_id]=99"))
  assert.equal(
    (await dispatchResetTick({ ...f.options, state: continuation })).phase,
    "dispatch_outcome_unknown",
  )
  assert.equal(f.posts.length, 1)
  f.runs = [
    {
      ...run,
      id: 456,
      status: "in_progress",
      conclusion: null,
      created_at: new Date(instant + 1000).toISOString(),
    },
    run,
  ]
  const adopted = await dispatchResetTick({ ...f.options, state: continuation })
  assert.equal(adopted.phase, "running")
  assert.equal(adopted.run_id, 456)
  f.runs[0] = { ...f.runs[0], status: "completed", conclusion: "success" }
  f.jobs[0].steps = FULL_RELEASE_STEPS.map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
  }))
  f.options.readState = async () => ({ schema_transition: false })
  assert.equal((await dispatchResetTick({ ...f.options, state: adopted })).phase, "deployed")
  assert.equal(f.posts.length, 1)
})

test("checkpoint continuation refuses missing installed lineage and a skipped migration", async () => {
  const f = fixture()
  f.runs = [run]
  f.jobs = [
    {
      name: "deploy-production",
      status: "completed",
      conclusion: "success",
      steps: [
        ...FULL_RELEASE_STEPS.map((name) => ({ name, status: "completed", conclusion: "skipped" })),
        ...[
          "Apply reviewed D1 migrations through prediction admission",
          "Record staged migration continuation checkpoint",
        ].map((name) => ({ name, status: "completed", conclusion: "success" })),
      ],
    },
  ]
  await assert.rejects(dispatchResetTick(f.options), /CHECKPOINT_STATE_INVALID/)
  assert.equal(f.posts.length, 0)
  f.jobs[0].steps.find(
    (step) => step.name === "Apply reviewed D1 migrations through prediction admission",
  ).conclusion = "skipped"
  const result = await dispatchResetTick({
    ...f.options,
    state: { day: intent.reset_day, sha, reserved_at: run.created_at, known_run_ids: [] },
  })
  assert.equal(result.phase, "failed")
  assert.equal(f.posts.length, 0)
})
