import assert from "node:assert/strict"
import test from "node:test"

import { forwardReplicaCostRequest } from "./operation-cost-replica-gateway.js"

// B-978: the operation-cost authority's daily refusals reach the client with the time to the UTC
// reset, in the header and the body, like every other daily refusal (B-968). Failure modes:
// 1. A daily refusal reaches the client with no retry time.
// 2. A refusal that is not daily (a bad receipt, a missing step) claims a retry time.

const TOKEN = "replica-test-token-0123456789abcdef0123456789abcdef"
const env = { ICONOPLASM_AUTHORITY_REPLICA_TOKEN: TOKEN }

function authorityRefusing(code, status = 503) {
  return { fetch: async () => Response.json({ code }, { status }) }
}

function replicaRequest() {
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/authority/revisions/x/body", {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "x-iconoplasm-operation-id": "op-1",
      "x-iconoplasm-operation-step": "step-1",
    },
  })
}

for (const code of ["COST_SHARED_DAILY_LIMIT", "COST_ACCOUNT_HEADROOM_LIMIT"]) {
  test(`${code} says when to retry`, async () => {
    const response = await forwardReplicaCostRequest(replicaRequest(), env, authorityRefusing(code))
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.equal(body.error.code, code)
    const header = Number(response.headers.get("Retry-After"))
    assert.equal(header, body.retry_after_seconds)
    assert.equal(header > 0 && header <= 86_405, true, `Retry-After ${header}`)
  })
}

// B-1036, 2026-10-06: "midnight" for the account check parked the workstation's text pulls
// for ten hours; that refusal clears once the provider sample catches up, within one lag.
test("the account check says come back after one analytics lag, not at midnight", async () => {
  const response = await forwardReplicaCostRequest(
    replicaRequest(),
    env,
    authorityRefusing("COST_ACCOUNT_HEADROOM_LIMIT"),
  )
  const header = Number(response.headers.get("Retry-After"))
  assert.equal(header <= 900, true, `Retry-After ${header}`)
})

test("a refusal that is not daily states no retry time", async () => {
  const response = await forwardReplicaCostRequest(
    replicaRequest(),
    env,
    authorityRefusing("COST_EXECUTION_FAILED"),
  )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Retry-After"), null)
  assert.equal("retry_after_seconds" in (await response.json()), false)
})
