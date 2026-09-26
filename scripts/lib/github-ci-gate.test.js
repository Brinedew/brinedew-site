import assert from "node:assert/strict"
import test from "node:test"

import { waitForSuccessfulPushCi } from "./github-ci-gate.mjs"

function response(workflowRuns) {
  return new Response(JSON.stringify({ workflow_runs: workflowRuns }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

test("store CI gate waits for the matching push run to succeed", async () => {
  const calls = []
  const responses = [
    response([]),
    response([{ id: 41, head_sha: "release-sha", event: "push", status: "in_progress" }]),
    response([
      {
        id: 41,
        head_sha: "release-sha",
        event: "push",
        status: "completed",
        conclusion: "success",
      },
    ]),
  ]
  const run = await waitForSuccessfulPushCi({
    repository: "Brinedew/brinedew-site",
    headSha: "release-sha",
    token: "test-token",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return responses.shift()
    },
    sleep: async () => {},
  })

  assert.equal(run.id, 41)
  assert.equal(calls.length, 3)
  assert.match(calls[0].url, /head_sha=release-sha/)
  assert.match(calls[0].url, /event=push/)
})

test("store CI gate blocks every non-successful conclusion", async () => {
  await assert.rejects(
    waitForSuccessfulPushCi({
      repository: "Brinedew/brinedew-site",
      headSha: "release-sha",
      token: "test-token",
      fetchImpl: async () =>
        response([
          {
            id: 42,
            head_sha: "release-sha",
            event: "push",
            status: "completed",
            conclusion: "failure",
          },
        ]),
      sleep: async () => {},
    }),
    /Store submission blocked: Build and Test concluded failure/,
  )
})

// 26 Sep 2026: the #359 production deploy died at "Require successful tests for
// the exact deployed commit" on one `fetch failed` while Build and Test was still
// running. The gate polls about 180 times in 15 minutes; one blip must not kill a
// release, but a real refusal must still stop it at once.
function success() {
  return response([
    { id: 7, head_sha: "sha", event: "push", status: "completed", conclusion: "success" },
  ])
}

function gate(fetchImpl) {
  return waitForSuccessfulPushCi({
    repository: "Brinedew/brinedew-site",
    headSha: "sha",
    token: "test-token",
    fetchImpl,
    sleep: async () => {},
  })
}

test("a network blip or a GitHub 5xx while polling does not fail the release", async () => {
  const replies = [
    () => {
      throw new TypeError("fetch failed")
    },
    () => new Response("bad gateway", { status: 502 }),
    () => new Response("slow down", { status: 429 }),
    () => success(),
  ]
  const run = await gate(async () => replies.shift()())
  assert.equal(run.id, 7)
})

test("a lasting outage still fails after a few consecutive transient errors", async () => {
  let calls = 0
  await assert.rejects(
    gate(async () => {
      calls += 1
      throw new TypeError("fetch failed")
    }),
    /GitHub API unreachable/,
  )
  assert.equal(calls, 5)
})

test("a refusal such as 401 or 404 fails at once", async () => {
  let calls = 0
  await assert.rejects(
    gate(async () => {
      calls += 1
      return new Response("nope", { status: 401 })
    }),
    /GitHub API returned 401/,
  )
  assert.equal(calls, 1)
})
