import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("apex admin route stays on the worker instead of getting swallowed by the static-site proxy", async () => {
  const response = await worker.fetch(new Request("https://brinedew.bio/admin", { method: "GET" }), {}, {})

  assert.equal(response.status, 403)
  assert.match(await response.text(), /Unauthorized/)
})

test("apex iconoplasm admin route stays on the worker and uses the same admin gate", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/admin/iconoplasm", { method: "GET" }),
    {},
    {},
  )

  assert.equal(response.status, 403)
  assert.match(await response.text(), /Unauthorized/)
})

test("portrait binaries stay wired even when they arrive through a non-iconoplasm host boundary", async () => {
  const response = await worker.fetch(
    new Request(
      "https://brinedew.bio/portraits/v1/aa/aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900/medium.webp",
      { method: "GET" },
    ),
    {
      ICONOPLASM_PORTRAITS: {
        async get(key) {
          assert.equal(
            key,
            "portraits/v1/aa/aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900/medium.webp",
          )
          return {
            body: "image-bytes",
            httpMetadata: { contentType: "image/webp" },
            httpEtag: "portrait-etag",
          }
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/webp")
})
