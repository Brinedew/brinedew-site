import assert from "node:assert/strict"
import test from "node:test"
import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate as gateway } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import runtime from "../the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("rejected authority requests cannot schedule projection repairs or touch D1", async () => {
  let queries = 0
  const background = []
  const db = {
    prepare() {
      queries++
      throw new Error("Unadmitted database work")
    },
  }
  const env = {
    DB: db,
    ICONOPLASM_DB: db,
    ICONOPLASM_AUTHORING_DB: db,
    ICONOPLASM_AUTHORITY_REPLICA_TOKEN: "test-replica",
    ICONOPLASM_AUTHORITY_GENERATION_TOKEN: "test-generation",
  }
  const ctx = {
    waitUntil(promise) {
      background.push(promise)
    },
  }
  for (const [path, method] of [
    ["/api/iconoplasm/authority/snapshots/missing", "GET"],
    ["/api/iconoplasm/authority/events", "GET"],
    ["/api/iconoplasm/authority/revisions/revision-cost/tags-derivative-head", "POST"],
    ["/api/iconoplasm/authority/generation-leases/claim", "POST"],
  ]) {
    const result = await gateway(
      new Request(`https://iconoplasm.brinedew.bio${path}`, { method }),
      env,
      ctx,
    )
    assert.ok([401, 403].includes(result.status), `${path}: ${result.status}`)
  }
  for (const method of ["GET", "HEAD"]) {
    const result = await gateway(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/authority/snapshots/missing", {
        method,
        headers: { Authorization: "Bearer test-replica" },
      }),
      env,
      ctx,
    )
    assert.equal(result.status, 428)
  }
  const selection = await gateway(
    new Request(
      "https://iconoplasm.brinedew.bio/api/iconoplasm/authority/revisions/revision-cost/tags-derivative-head",
      { method: "POST", headers: { Authorization: "Bearer test-replica" }, body: "{}" },
    ),
    env,
    ctx,
  )
  assert.equal(selection.status, 428)
  await Promise.allSettled(background)
  assert.equal(queries, 0)
  assert.equal(background.length, 0)
})

test("schema transition refuses application D1, preserves queued work and leaves admission reachable", async () => {
  let queries = 0
  let admitted = 0
  let retry = null
  const db = {
    prepare() {
      queries++
      throw new Error("unready schema queried")
    },
  }
  const env = {
    ICONOPLASM_SCHEMA_TRANSITION: "1",
    ICONOPLASM_DB: db,
    ICONOPLASM_AUTHORING_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "test-admin",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: {
      idFromName: () => "global",
      get: () => ({
        fetch() {
          admitted++
          return Response.json({ code: "COST_PREDICTION_NOT_REGISTERED" }, { status: 428 })
        },
      }),
    },
  }
  const ctx = {
    waitUntil() {
      assert.fail("transition scheduled work")
    },
  }
  const blocked = await gateway(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/authority/events"),
    env,
    ctx,
  )
  assert.equal(blocked.status, 503)
  assert.equal((await blocked.json()).code, "ICONOPLASM_SCHEMA_TRANSITION")
  const cost = await gateway(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations/execute", {
      method: "POST",
      headers: { "x-iconoplasm-admin-token": "test-admin" },
      body: "{}",
    }),
    env,
    ctx,
  )
  assert.equal(cost.status, 428)
  assert.equal(admitted, 1)
  await runtime.queue(
    {
      retryAll(options) {
        retry = options
      },
    },
    env,
    ctx,
  )
  assert.deepEqual(retry, { delaySeconds: 60 })
  await runtime.scheduled({ cron: "*/15 * * * *" }, env, ctx)
  assert.equal(queries, 0)
})
