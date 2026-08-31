import assert from "node:assert/strict"
import test from "node:test"

import { forwardManifestationCutoverActionToCoordinator } from "./manifestation-cutover-durable-coordinator.js"

function coordinatorBinding(seen) {
  return {
    idFromName(name) {
      seen.names.push(name)
      return name
    },
    get(id) {
      return {
        async fetch(request) {
          seen.ids.push(id)
          seen.bodies.push(await request.json())
          return Response.json({ coordinated: true })
        },
      }
    },
  }
}

test("materialization actions are isolated by run and deterministic shard lane", async () => {
  const seen = { names: [], ids: [], bodies: [] }
  const request = new Request(
    "https://iconoplasm.test/api/iconoplasm/authority/cutover/runs/cutover_12345678/actions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test",
        "x-iconoplasm-cutover-shard": "32:23",
      },
      body: JSON.stringify({
        action: "materialize",
        limit: 25,
        shard_count: 32,
        shard_index: 23,
      }),
    },
  )
  const response = await forwardManifestationCutoverActionToCoordinator(request, {
    ICONOPLASM_MANIFESTATION_CUTOVER_COORDINATORS: coordinatorBinding(seen),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(seen.names, ["cutover_12345678:shard:32:23"])
  assert.deepEqual(seen.ids, seen.names)
  assert.equal(seen.bodies[0].limit, 25)
  assert.equal(seen.bodies[0].action, "materialize")
})

test("control actions serialize separately and non-actions stay on the edge route", async () => {
  const seen = { names: [], ids: [], bodies: [] }
  const base = "https://iconoplasm.test/api/iconoplasm/authority/cutover/runs/cutover_abcdefgh"
  assert.equal(
    await forwardManifestationCutoverActionToCoordinator(new Request(base), {
      ICONOPLASM_MANIFESTATION_CUTOVER_COORDINATORS: coordinatorBinding(seen),
    }),
    null,
  )
  const response = await forwardManifestationCutoverActionToCoordinator(
    new Request(`${base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify" }),
    }),
    { ICONOPLASM_MANIFESTATION_CUTOVER_COORDINATORS: coordinatorBinding(seen) },
  )
  assert.equal(response.status, 200)
  assert.deepEqual(seen.names, ["cutover_abcdefgh:control"])
})

test("cutover actions fail closed when the coordinator binding is absent", async () => {
  const response = await forwardManifestationCutoverActionToCoordinator(
    new Request(
      "https://iconoplasm.test/api/iconoplasm/authority/cutover/runs/cutover_12345678/actions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    ),
    {},
  )
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error.code, "MANIFESTATION_CUTOVER_COORDINATOR_REQUIRED")
})

test("a rejected Durable Object fetch stays a bounded retryable service error", async () => {
  const originalError = console.error
  const logged = []
  console.error = (...values) => logged.push(values)
  try {
    const response = await forwardManifestationCutoverActionToCoordinator(
      new Request(
        "https://iconoplasm.test/api/iconoplasm/authority/cutover/runs/cutover_12345678/actions",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-iconoplasm-cutover-shard": "32:7",
          },
          body: JSON.stringify({ action: "materialize", shard_count: 32, shard_index: 7 }),
        },
      ),
      {
        ICONOPLASM_MANIFESTATION_CUTOVER_COORDINATORS: {
          idFromName: (name) => name,
          get: () => ({
            fetch: async () => {
              throw new Error("coordinator transport failed")
            },
          }),
        },
      },
    )
    assert.equal(response.status, 503)
    assert.equal(
      (await response.json()).error.code,
      "MANIFESTATION_CUTOVER_COORDINATOR_UNAVAILABLE",
    )
    assert.equal(logged.length, 1)
    assert.equal(logged[0][0], "[ICONOPLASM_CUTOVER_COORDINATOR_UNAVAILABLE]")
    assert.equal(logged[0][1].lane, "shard:32:7")
  } finally {
    console.error = originalError
  }
})
