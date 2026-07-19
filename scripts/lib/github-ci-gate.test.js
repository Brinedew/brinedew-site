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
