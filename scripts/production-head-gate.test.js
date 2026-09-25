import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { parse } from "yaml"
import { assertCurrentProductionHead, enforceProductionHead } from "./lib/production-head-gate.mjs"

const headSha = "a".repeat(40)
const options = { repository: "Brinedew/brinedew-site", headSha, token: "fixture-token" }
const ref = (sha) => ({ ref: "refs/heads/main", object: { type: "commit", sha } })

test("a delayed old push cannot deploy after main has advanced", async () => {
  const fetchImpl = async (url, request) => {
    assert.equal(url, "https://api.github.com/repos/Brinedew/brinedew-site/git/ref/heads/main")
    assert.ok(request.signal)
    return Response.json(ref(headSha))
  }
  assert.equal(await assertCurrentProductionHead({ ...options, fetchImpl }), headSha)
  await assert.rejects(
    assertCurrentProductionHead({ ...options, headSha: "b".repeat(40), fetchImpl }),
    /Stale production run refused/,
  )
})

// B-857: merging PRs seconds apart made the older push's run fail red here,
// and red reads as "production is broken". A superseded push is not a
// failure: a newer push's run is already queued. It ends cancelled, like any
// other superseded run, and must still never reach a deploy step.
test("a superseded push cancels its own run instead of failing, and never proceeds", async () => {
  const calls = []
  const fetchImpl = async (url, request = {}) => {
    calls.push([request.method || "GET", url])
    if (url.endsWith("/git/ref/heads/main")) return Response.json(ref("b".repeat(40)))
    return new Response(null, { status: 202 })
  }
  const outcome = await enforceProductionHead({
    env: {
      GITHUB_REPOSITORY: "Brinedew/brinedew-site",
      GITHUB_SHA: headSha,
      GITHUB_TOKEN: "fixture-token",
      GITHUB_EVENT_NAME: "push",
      GITHUB_RUN_ID: "123",
    },
    fetchImpl,
  })
  assert.equal(outcome, "superseded")
  assert.deepEqual(calls.at(-1), [
    "POST",
    "https://api.github.com/repos/Brinedew/brinedew-site/actions/runs/123/cancel",
  ])
})

test("a stale manual dispatch, a failed cancel, or an unreadable head still fails red", async () => {
  const env = {
    GITHUB_REPOSITORY: "Brinedew/brinedew-site",
    GITHUB_SHA: headSha,
    GITHUB_TOKEN: "fixture-token",
    GITHUB_RUN_ID: "123",
  }
  const stale = async (url) =>
    url.endsWith("/git/ref/heads/main")
      ? Response.json(ref("b".repeat(40)))
      : new Response(null, { status: 403 })
  let cancels = 0
  const dispatch = async (url, request = {}) => {
    if (request.method === "POST") cancels += 1
    return Response.json(ref("b".repeat(40)))
  }
  await assert.rejects(
    enforceProductionHead({
      env: { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" },
      fetchImpl: dispatch,
    }),
    /Stale production run refused/,
  )
  assert.equal(cancels, 0)
  await assert.rejects(
    enforceProductionHead({ env: { ...env, GITHUB_EVENT_NAME: "push" }, fetchImpl: stale }),
    /could not cancel/i,
  )
  await assert.rejects(
    enforceProductionHead({
      env: { ...env, GITHUB_EVENT_NAME: "push" },
      fetchImpl: async () => new Response(null, { status: 500 }),
    }),
    /Cannot verify current production source/,
  )
  assert.equal(
    await enforceProductionHead({
      env: { ...env, GITHUB_EVENT_NAME: "push" },
      fetchImpl: async () => Response.json(ref(headSha)),
    }),
    "current",
  )
})

test("unverifiable source stops release admission", async () => {
  for (const response of [new Response(null, { status: 403 }), Response.json({})]) {
    await assert.rejects(
      assertCurrentProductionHead({ ...options, fetchImpl: async () => response }),
    )
  }
})

test("a queued release cannot interrupt Worker and Pages activation", () => {
  const workflow = parse(
    readFileSync(new URL("../.github/workflows/deploy-quartz.yml", import.meta.url), "utf8"),
  )
  assert.equal(workflow.concurrency.group, "production-deploy")
  assert.equal(workflow.concurrency["cancel-in-progress"], false)
  const steps = workflow.jobs["deploy-production"].steps
  assert.equal(steps[1].run, "node scripts/assert-production-head.mjs")
  assert.equal(steps[1].env.GITHUB_TOKEN, "${{ github.token }}")
  // The superseded-push self-cancel needs exactly this, on this job only.
  assert.deepEqual(workflow.jobs["deploy-production"].permissions, {
    contents: "read",
    actions: "write",
  })
  assert.equal(workflow.permissions.actions, "read")
})
