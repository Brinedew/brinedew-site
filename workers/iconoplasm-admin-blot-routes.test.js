import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminBlotHandlers } from "./iconoplasm-admin-blot-routes.js"

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function blotServices(overrides = {}) {
  return {
    isAdmin: async () => true,
    json,
    listBacklog: async (_env, context) => ({ payload: context.payload }),
    upload: async (_env, context) => ({ symbol: context.symbol }),
    ...overrides,
  }
}

function invoke(handler, { body, match, method = "POST" } = {}) {
  const request = new Request("https://iconoplasm.brinedew.bio/internal-test", {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  return handler({
    request,
    env: { ICONOPLASM_DB: {} },
    match,
    done: async (_route, response) => response,
  })
}

test("blot handler factory rejects incomplete service composition", () => {
  const services = blotServices()
  delete services.upload
  assert.throws(() => createIconoplasmAdminBlotHandlers(services), /service is missing: upload/)
})

test("blot handler registry is immutable and complete", () => {
  const handlers = createIconoplasmAdminBlotHandlers(blotServices())
  assert.equal(Object.isFrozen(handlers), true)
  assert.deepEqual(Object.keys(handlers).sort(), ["admin_blots.backlog", "admin_blots.upload"])
})

test("blot backlog is admin-only, bounded by its service, and never cached", async () => {
  let reads = 0
  const handlers = createIconoplasmAdminBlotHandlers(
    blotServices({
      isAdmin: async () => false,
      listBacklog: async () => {
        reads += 1
        return {}
      },
    }),
  )
  const response = await invoke(handlers["admin_blots.backlog"], { body: { scope: "published" } })

  assert.equal(response.status, 403)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(reads, 0)
})

test("blot backlog accepts GET and POST request scopes", async () => {
  const handlers = createIconoplasmAdminBlotHandlers(blotServices())
  const getResponse = await invoke(handlers["admin_blots.backlog"], { method: "GET" })
  const postResponse = await invoke(handlers["admin_blots.backlog"], {
    body: { scope: "candidate", symbols: ["TP53"] },
  })

  assert.deepEqual(await getResponse.json(), { payload: {} })
  assert.deepEqual(await postResponse.json(), {
    payload: { scope: "candidate", symbols: ["TP53"] },
  })
})

test("blot upload forwards the route symbol and preserves typed failures", async () => {
  const handlers = createIconoplasmAdminBlotHandlers(
    blotServices({
      upload: async (_env, { symbol }) => {
        if (symbol === "BAD") {
          throw Object.assign(new Error("Fingerprint mismatch"), {
            status: 409,
            code: "GENE_BLOT_FINGERPRINT_MISMATCH",
          })
        }
        return { symbol }
      },
    }),
  )

  const accepted = await invoke(handlers["admin_blots.upload"], {
    method: "PUT",
    match: { params: { symbol: "TP53" } },
  })
  const rejected = await invoke(handlers["admin_blots.upload"], {
    method: "PUT",
    match: { params: { symbol: "BAD" } },
  })

  assert.deepEqual(await accepted.json(), { symbol: "TP53" })
  assert.equal(rejected.status, 409)
  assert.deepEqual(await rejected.json(), {
    error: "Fingerprint mismatch",
    code: "GENE_BLOT_FINGERPRINT_MISMATCH",
  })
})
