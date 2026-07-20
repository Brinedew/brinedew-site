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
    cardArtifactUnavailableCode: "CARD_ARTIFACT_UNAVAILABLE",
    coerceBoolean: (value, fallback = false) => (value == null ? fallback : Boolean(value)),
    currentMobileCardSnapshotVersion: async () => ({ current: "current", previous: "previous" }),
    ensureBootstrapInitialized: async () => ({ status: "pending" }),
    fetchBootstrapState: async () => ({ status: "pending" }),
    invalidateGalleryCache: async () => ({
      version: "current",
      card_catalog: {
        artifact_gene_count: 1,
        catalog_gene_count: 1,
        artifact_version: "artifact",
        artifact_validated_at: "2026-07-20T00:00:00.000Z",
      },
    }),
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
    syncReadModelsAndInvalidateGallery: async () => ({ symbols: 0, visions: 0 }),
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
    "admin_read_models.card_artifacts_warm",
    "admin_read_models.sync",
  ])
})

test("scoped read-model sync remains D1-only and normalizes targets", async () => {
  let invalidatingCalls = 0
  const directCalls = []
  const handlers = createIconoplasmAdminReadModelHandlers(
    readModelServices({
      syncReadModels: async (_env, options) => {
        directCalls.push(options)
        return { symbols: 1, visions: 1 }
      },
      syncReadModelsAndInvalidateGallery: async () => {
        invalidatingCalls += 1
        return { symbols: 0, visions: 0 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_read_models.sync"], {
    body: {
      symbols: [" tp53 ", "TP53", ""],
      vision_ids: ["vision-one", "invalid", "vision-one"],
      invalidate_gallery: false,
    },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(invalidatingCalls, 0)
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
  assert.equal(payload.invalidate_gallery, false)
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

test("card artifact warming rejects symbol scope before publication", async () => {
  let publicationCalls = 0
  const handlers = createIconoplasmAdminReadModelHandlers(
    readModelServices({
      invalidateGalleryCache: async () => {
        publicationCalls += 1
        return {}
      },
    }),
  )
  const response = await responseFrom(handlers["admin_read_models.card_artifacts_warm"], {
    body: { symbols: ["TP53"] },
  })
  const payload = await response.json()

  assert.equal(response.status, 409)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(payload.code, "CARD_ARTIFACT_REQUIRES_FULL_CATALOG")
  assert.equal(publicationCalls, 0)
})
