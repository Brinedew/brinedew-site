import assert from "node:assert/strict"
import test from "node:test"

import {
  createIconoplasmAdminCatalogObjectHandlers,
  STABLE_CATALOG_OBJECT_KEY,
  STABLE_CATALOG_OBJECT_LIMIT,
} from "./iconoplasm-admin-catalog-object-route.js"

// B-898 Stage 1: the GitHub Actions publisher uploads the one catalog object
// through the Worker, which holds the Bunny storage password. Failure modes
// written before the code:
// 1. not an administrator -> 403, nothing written;
// 2. a well-formed upload is stored at the fixed key with the stable
//    Cache-Control, and the reply carries the byte count;
// 3. an empty body or a body over the limit -> 4xx, nothing written;
// 4. a body that is not a JSON object -> 400, nothing written;
// 5. a storage failure -> 503 no-store.
function harness({ admin = true, putError = null } = {}) {
  const writes = []
  const handlers = createIconoplasmAdminCatalogObjectHandlers({
    isAdmin: async () => admin,
    json: (body, status = 200, headers = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    putObject: async (env, key, bytes, options) => {
      if (putError) throw putError
      writes.push({ key, bytes, options })
    },
  })
  const put = handlers["admin_publication.catalog_object_put"]
  const call = (body, headers = {}) =>
    put({
      env: {},
      done: (_name, response) => response,
      request: new Request(
        "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/catalog-object",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...headers },
          body,
        },
      ),
    })
  return { call, writes }
}

test("a non-administrator is refused and nothing is written", async () => {
  const h = harness({ admin: false })
  const response = await h.call('{"schema":3}')
  assert.equal(response.status, 403)
  assert.equal(h.writes.length, 0)
})

test("a well-formed upload is stored at the fixed key and reported", async () => {
  const h = harness()
  const body = '{"schema":3,"rows":[["A1BG","alpha-1-B glycoprotein"]]}'
  const response = await h.call(body)
  assert.equal(response.status, 200)
  const reply = await response.json()
  assert.equal(reply.ok, true)
  assert.equal(reply.key, STABLE_CATALOG_OBJECT_KEY)
  assert.equal(reply.bytes, body.length)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].key, "catalog/v3/index.json")
  assert.equal(new TextDecoder().decode(h.writes[0].bytes), body)
  assert.equal(h.writes[0].options.contentType, "application/json")
  assert.equal(
    h.writes[0].options.cacheControl,
    "public, max-age=300, stale-while-revalidate=86400",
  )
})

test("an empty body is refused and nothing is written", async () => {
  const h = harness()
  const response = await h.call("")
  assert.equal(response.status, 400)
  assert.equal(h.writes.length, 0)
})

test("a body over the limit is refused by its declared length before it is read", async () => {
  const h = harness()
  const response = await h.call("{}", { "Content-Length": String(STABLE_CATALOG_OBJECT_LIMIT + 1) })
  assert.equal(response.status, 413)
  assert.equal(h.writes.length, 0)
})

test("a body that is not a JSON object is refused", async () => {
  const h = harness()
  const response = await h.call("[1,2,3]")
  assert.equal(response.status, 400)
  assert.equal(h.writes.length, 0)
})

test("a storage failure is a 503", async () => {
  const h = harness({ putError: new Error("Bunny PUT failed (500)") })
  const response = await h.call('{"schema":3}')
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
})
