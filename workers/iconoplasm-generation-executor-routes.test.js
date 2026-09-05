import assert from "node:assert/strict"
import test from "node:test"

import { authorizeIconoplasmAuthorityGenerationBearer } from "./iconoplasm-authority-service-auth.js"
import { createIconoplasmGenerationExecutorHandler } from "./iconoplasm-generation-executor-routes.js"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const SERVICE_TOKEN = "authority-service-token-0000000000000001"
const ADMIN_TOKEN = "legacy-admin-token-0000000000000000001"

function request(path, body, token = SERVICE_TOKEN) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function route(id, params = {}) {
  return { route: { id }, params }
}

function fixture(overrides = {}) {
  const calls = []
  const handler = createIconoplasmGenerationExecutorHandler({
    authorizeGenerationBearer: authorizeIconoplasmAuthorityGenerationBearer,
    claimGenerationLeases: async (_env, input) => {
      calls.push(["claim", input])
      return { schema_version: 1, leases: [{ generation_request_id: "request_1" }] }
    },
    renewGenerationLease: async (input) => {
      calls.push(["renew", input])
      return { generation_lease_version: 2, generation_lease_status: "active" }
    },
    failGenerationLease: async (input) => {
      calls.push(["fail", input])
      return { generation_lease_status: "failed" }
    },
    fulfillGenerationRequests: async (_env, input) => {
      calls.push(["complete", input])
      return { ok: true, fulfilled: 1, request_ids: [41] }
    },
    deliverPendingNotifications: async (_env, input) => {
      calls.push(["deliver", input])
      return { ok: true, failed: 0, unknown: 0, suppressed: 0 }
    },
    reconcileDeliveredFulfillments: async (_env, input) => {
      calls.push(["reconcile", input])
      return { ok: true, finalized: 1, pending_request_ids: [] }
    },
    logger: { error() {} },
    ...overrides,
  })
  return { calls, handler }
}

const env = {
  ICONOPLASM_DB: { prepare() {} },
  ICONOPLASM_AUTHORITY_GENERATION_TOKEN: SERVICE_TOKEN,
  ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
}

test("claim is service-token-only and forwards one atomic owner-bound claim", async () => {
  const { calls, handler } = fixture()
  const path = "/api/iconoplasm/authority/generation-leases/claim"
  const denied = await handler({
    match: route("authority_generation_lease_claim"),
    request: request(path, { lease_owner_id: "workstation_1" }, ADMIN_TOKEN),
    env,
  })
  assert.equal(denied.status, 401)
  assert.equal(calls.length, 0)

  const accepted = await handler({
    match: route("authority_generation_lease_claim"),
    request: request(path, { lease_owner_id: "workstation_1", limit: 4, lease_seconds: 600 }),
    env,
  })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(calls, [
    ["claim", { leaseOwnerId: "workstation_1", leaseSeconds: 600, limit: 4 }],
  ])
  assert.equal((await accepted.json()).leases[0].generation_request_id, "request_1")
})

test("renew and fail bind the opaque route token plus owner and lease-version CAS", async () => {
  const { calls, handler } = fixture()
  const token = "generation_lease_0001"
  const body = { lease_owner_id: "workstation_1", expected_lease_version: 7, lease_seconds: 800 }

  const renewed = await handler({
    match: route("authority_generation_lease_renew", { lease_token: token }),
    request: request(`/api/iconoplasm/authority/generation-leases/${token}/renew`, body),
    env,
  })
  assert.equal(renewed.status, 200)
  assert.equal((await renewed.json()).generation_lease_version, 2)

  const failed = await handler({
    match: route("authority_generation_lease_fail", { lease_token: token }),
    request: request(`/api/iconoplasm/authority/generation-leases/${token}/fail`, {
      lease_owner_id: "workstation_1",
      expected_lease_version: 8,
      failure_code: "gpu_worker_failed",
    }),
    env,
  })
  assert.equal(failed.status, 200)
  assert.deepEqual(calls[0], [
    "renew",
    {
      db: env.ICONOPLASM_DB,
      expectedLeaseVersion: 7,
      failureCode: undefined,
      leaseOwnerId: "workstation_1",
      leaseSeconds: 800,
      leaseToken: token,
    },
  ])
  assert.equal(calls[1][0], "fail")
  assert.equal(calls[1][1].failureCode, "gpu_worker_failed")
})

test("complete requires the same service bearer and settles the exact published request batch", async () => {
  const { calls, handler } = fixture()
  const item = {
    request_ids: [41],
    generation_request_id: "generation_request_0001",
    generation_attempt_id: "generation_attempt_0001",
    generation_lease_token: "generation_lease_0001",
    generation_lease_owner_id: "workstation_1",
    generation_lease_version: 1,
  }
  const response = await handler({
    match: route("authority_generation_lease_complete"),
    request: request("/api/iconoplasm/authority/generation-leases/complete", {
      publication_id: "publication_0001",
      items: [item],
    }),
    env,
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.fulfilled, 1)
  assert.deepEqual(calls[0], [
    "complete",
    {
      items: [item],
      publicationId: "publication_0001",
      resolvedBy: "authority-generation-executor",
    },
  ])
  assert.deepEqual(calls[1], ["deliver", { limit: 1, requestIds: [41] }])
  assert.deepEqual(calls[2], ["reconcile", { requestIds: [41] }])
})

test("invalid JSON and missing primary binding fail closed before generation work", async () => {
  const { calls, handler } = fixture()
  const invalid = new Request(`${ORIGIN}/api/iconoplasm/authority/generation-leases/claim`, {
    method: "POST",
    headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    body: "{",
  })
  const invalidResponse = await handler({
    match: route("authority_generation_lease_claim"),
    request: invalid,
    env,
  })
  assert.equal(invalidResponse.status, 400)

  const missingDb = await handler({
    match: route("authority_generation_lease_claim"),
    request: request("/api/iconoplasm/authority/generation-leases/claim", {
      lease_owner_id: "workstation_1",
    }),
    env: { ICONOPLASM_AUTHORITY_GENERATION_TOKEN: SERVICE_TOKEN },
  })
  assert.equal(missingDb.status, 500)
  assert.equal(calls.length, 0)
})

test("private lease material requires the generation capability and is never cached", async () => {
  let reads = 0
  const { handler } = fixture({
    readGenerationMaterial: async (input) => {
      reads++
      assert.equal(input.leaseOwnerId, "owner_0001")
      assert.equal(input.expectedLeaseVersion, 2)
      return { prose: "private" }
    },
  })
  const path = "/api/iconoplasm/authority/generation-leases/lease_token_0001/material"
  const match = route("authority_generation_lease_material", { lease_token: "lease_token_0001" })
  const body = { lease_owner_id: "owner_0001", expected_lease_version: 2 }
  assert.equal(
    (await handler({ match, request: request(path, body, ADMIN_TOKEN), env })).status,
    401,
  )
  assert.equal(reads, 0)
  const response = await handler({ match, request: request(path, body), env })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(await response.json(), { prose: "private" })
  assert.equal(reads, 1)
})
