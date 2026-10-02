import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminReadModelHandlers } from "./iconoplasm-admin-read-model-routes.js"

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function readModelServices(overrides = {}) {
  return {
    bootstrapCompleteStatus: "complete",
    coerceBoolean: (value, fallback = false) => (value == null ? fallback : Boolean(value)),
    ensureBootstrapInitialized: async () => ({ status: "pending" }),
    fetchBootstrapState: async () => ({ status: "pending" }),
    isAdmin: async () => true,
    json,
    normalizeBootstrapSteps: () => 1,
    normalizeSymbol: (value) =>
      String(value || "")
        .trim()
        .toUpperCase(),
    normalizeSymbolBatch: () => 10,
    normalizeVisionBatch: () => 10,
    runBootstrapStep: async () => ({
      advanced: false,
      processed: { symbols: 0, visions: 0 },
      state: { status: "complete" },
    }),
    sanitizeText: (value, limit) => String(value || "").slice(0, limit),
    symbolRequestMax: 100,
    syncReadModels: async () => ({ symbols: 0, visions: 0 }),
    validVisionId: (value) => {
      const normalized = String(value || "").trim()
      return normalized.startsWith("vision-") ? normalized : ""
    },
    visionRequestMax: 100,
    writeBootstrapState: async () => {},
    ...overrides,
  }
}

async function responseFrom(handler, { body = {}, method = "POST" } = {}) {
  return handler({
    request: new Request("https://iconoplasm.brinedew.bio/internal-test", {
      method,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    env: { ICONOPLASM_DB: {} },
    done: async (_route, response) => response,
  })
}

test("read-model handler factory rejects incomplete composition roots", () => {
  const services = readModelServices()
  delete services.syncReadModels
  assert.throws(
    () => createIconoplasmAdminReadModelHandlers(services),
    /service is missing: syncReadModels/,
  )
})

test("read-model handler registry is immutable and domain-complete", () => {
  const handlers = createIconoplasmAdminReadModelHandlers(readModelServices())
  assert.equal(Object.isFrozen(handlers), true)
  assert.deepEqual(Object.keys(handlers).sort(), [
    "admin_read_models.bootstrap",
    "admin_read_models.sync",
  ])
})

test("scoped read-model sync remains D1-only and normalizes targets", async () => {
  const directCalls = []
  const handlers = createIconoplasmAdminReadModelHandlers(
    readModelServices({
      syncReadModels: async (_env, options) => {
        directCalls.push(options)
        return { symbols: 1, visions: 1 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_read_models.sync"], {
    body: {
      symbols: [" tp53 ", "TP53", ""],
      vision_ids: ["vision-one", "invalid", "vision-one"],
    },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(directCalls, [
    {
      symbols: ["TP53"],
      visionIds: ["vision-one"],
      fullVision: false,
      fullRebuild: false,
      skipVoteSummaries: false,
      skipGeneRollups: false,
      skipVisionRollups: false,
      skipDashboard: false,
    },
  ])
})

const emptyScopes = [
  ["missing scope", {}],
  ["null payload", null],
  ["null scope", { symbols: null, vision_ids: null }],
  ["empty arrays", { symbols: [], vision_ids: [] }],
  ["non-array scope", { symbols: "TP53", vision_ids: "vision-one" }],
  ["scope empty after normalization", { symbols: ["", "  ", null], vision_ids: ["invalid"] }],
  ["camel-case vision scope empty after normalization", { visionIds: ["invalid", null] }],
]

for (const [description, body] of emptyScopes) {
  test(`rejects ${description} before any sync`, async () => {
    const calls = []
    const handlers = createIconoplasmAdminReadModelHandlers(
      readModelServices({ syncReadModels: async () => calls.push("direct") }),
    )
    const response = await responseFrom(handlers["admin_read_models.sync"], { body })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.match(payload.error, /at least one symbol or vision_id/)
    assert.deepEqual(calls, [])
  })
}

for (const flag of ["full_rebuild", "fullRebuild", "full_vision", "fullVision"]) {
  test(`scoped sync rejects ${flag}`, async () => {
    const calls = []
    const handlers = createIconoplasmAdminReadModelHandlers(
      readModelServices({ syncReadModels: async () => calls.push("direct") }),
    )
    const response = await responseFrom(handlers["admin_read_models.sync"], {
      body: { symbols: ["TP53"], [flag]: true },
    })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.match(payload.error, /does not allow full_vision or full_rebuild/)
    assert.deepEqual(calls, [])
  })
}

test("vision-only sync keeps its explicit scope", async () => {
  const calls = []
  const handlers = createIconoplasmAdminReadModelHandlers(
    readModelServices({
      syncReadModels: async (_env, options) => {
        calls.push(options)
        return { symbols: 0, visions: 1 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_read_models.sync"], {
    body: {
      visionIds: [" vision-one ", "invalid", "vision-one"],
      full_vision: false,
      full_rebuild: false,
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.visions, 1)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].symbols, [])
  assert.deepEqual(calls[0].visionIds, ["vision-one"])
  assert.equal(calls[0].fullVision, false)
  assert.equal(calls[0].fullRebuild, false)
})

test("bootstrap implements the HEAD method admitted by its route contract", async () => {
  let stateReads = 0
  const handlers = createIconoplasmAdminReadModelHandlers(
    readModelServices({
      fetchBootstrapState: async () => {
        stateReads += 1
        return { status: "complete" }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_read_models.bootstrap"], { method: "HEAD" })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(stateReads, 1)
})
