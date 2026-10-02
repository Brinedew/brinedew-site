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
  assert.deepEqual(Object.keys(handlers).sort(), ["admin_gallery.list"])
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
