import assert from "node:assert/strict"
import test from "node:test"

import { createIconoplasmAdminGalleryHandlers } from "./iconoplasm-admin-gallery-routes.js"

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function galleryServices(overrides = {}) {
  return {
    fetchGallery: async (_env, _url, options) => ({
      ...options,
      total: 0,
      count: 0,
      rows: [],
    }),
    fetchPublishStatus: async () => ({ changes_since_publish: 0 }),
    publishIconoplasmGalleryDirtyShards: async () => ({ version: "current" }),
    isAdmin: async () => true,
    json,
    normalizeFilter: (value) => `filter:${value}`,
    normalizeLimit: (value) => Number.parseInt(String(value), 10),
    normalizeMode: (value) => `mode:${value}`,
    normalizePage: (value) => Number.parseInt(String(value), 10),
    normalizeSort: (value) => `sort:${value}`,
    sanitizeText: (value, limit) => String(value || "").slice(0, limit),
    ...overrides,
  }
}

async function responseFrom(
  handler,
  { body = {}, env = { ICONOPLASM_DB: {}, KV: {} }, method = "GET", path = "/internal-test" } = {},
) {
  return handler({
    request: new Request(`https://iconoplasm.brinedew.bio${path}`, {
      method,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    env,
    done: async (_route, response) => response,
  })
}

test("gallery handler factory rejects incomplete composition roots", () => {
  const services = galleryServices()
  delete services.fetchGallery
  assert.throws(
    () => createIconoplasmAdminGalleryHandlers(services),
    /service is missing: fetchGallery/,
  )
})

test("gallery handler registry is immutable and domain-complete", () => {
  const handlers = createIconoplasmAdminGalleryHandlers(galleryServices())
  assert.equal(Object.isFrozen(handlers), true)
  assert.deepEqual(Object.keys(handlers).sort(), [
    "admin_gallery.list",
    "admin_gallery.publish_dirty_shards",
    "admin_gallery.publish_status",
  ])
})

test("gallery publish status executes its declared HEAD path", async () => {
  let reads = 0
  const handlers = createIconoplasmAdminGalleryHandlers(
    galleryServices({
      fetchPublishStatus: async () => {
        reads += 1
        return { changes_since_publish: 0 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_gallery.publish_status"], {
    method: "HEAD",
    path: "/api/iconoplasm/admin/gallery/publish-status",
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(reads, 1)
})

test("gallery list executes HEAD through the same normalized bounded query", async () => {
  const calls = []
  const handlers = createIconoplasmAdminGalleryHandlers(
    galleryServices({
      fetchGallery: async (_env, url, options) => {
        calls.push({ url: url.href, options })
        return {
          page: options.page,
          limit: options.limit,
          total: 1,
          count: 1,
          mode: options.mode,
          rows: [],
        }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_gallery.list"], {
    method: "HEAD",
    path: "/api/iconoplasm/admin/gallery?page=2&limit=25&filter=stale&sort=score&mode=audit&q=tp53",
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(calls[0].options, {
    page: 2,
    limit: 25,
    filter: "filter:stale",
    sort: "sort:score",
    mode: "mode:audit",
    query: "tp53",
  })
})

test("dirty-shard publication ignores caller work sizing and reports safe refusal", async () => {
  const publicationEnvs = []
  const publicationOptions = []
  const statusEnvs = []
  const refusal = Object.assign(new Error("write budget exhausted"), {
    code: "CARD_CATALOG_KV_WRITE_BUDGET_EXHAUSTED",
  })
  const handlers = createIconoplasmAdminGalleryHandlers(
    galleryServices({
      publishIconoplasmGalleryDirtyShards: async (env, options) => {
        publicationEnvs.push(env)
        publicationOptions.push(options)
        throw refusal
      },
      fetchPublishStatus: async (env) => {
        statusEnvs.push(env)
        return { changes_since_publish: 4 }
      },
    }),
  )
  const response = await responseFrom(handlers["admin_gallery.publish_dirty_shards"], {
    method: "POST",
    path: "/api/iconoplasm/admin/gallery/publish-dirty-shards",
    body: { chunk_size: 37, reason: "manual_cost_verification" },
  })
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(statusEnvs[0], publicationEnvs[0])
  assert.equal(publicationOptions[0].triggerReason, "manual_cost_verification")
  assert.equal(payload.ok, false)
  assert.equal(payload.skipped, true)
  assert.equal(payload.code, "CARD_CATALOG_KV_WRITE_BUDGET_EXHAUSTED")
  assert.equal(payload.publish_status.changes_since_publish, 4)
})
