import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("apex admin route stays on the worker instead of getting swallowed by the static-site proxy", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/admin", { method: "GET" }),
    {},
    {},
  )

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

test("posted recap repair is reachable only through the admin gate", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/admin/repair-posted-recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: "2026-08-03" }),
    }),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: "Unauthorized" })
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

test("labelled gene-card binaries have the same first-party storage fallback", async () => {
  const key = "gene-cards/v1/S/SOX12/fingerprint/SOX12-iconoplasm-gene-card.png"
  const response = await worker.fetch(
    new Request(`https://iconoplasm.brinedew.bio/${key}`, { method: "GET" }),
    {
      ICONOPLASM_PORTRAITS: {
        async get(requestedKey) {
          assert.equal(requestedKey, key)
          return {
            body: "png-bytes",
            httpMetadata: { contentType: "image/png" },
            httpEtag: "gene-card-etag",
          }
        },
      },
    },
    { waitUntil() {} },
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "image/png")
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable")
})

test("iconoplasm admin gallery mutation routes reach the admin gate instead of 404", async () => {
  const mutationPaths = [
    "/api/iconoplasm/admin/publish",
    "/api/iconoplasm/admin/clear-override",
    "/api/iconoplasm/admin/reject",
    "/api/iconoplasm/admin/rollback",
    "/api/iconoplasm/admin/unpublish",
    "/api/iconoplasm/admin/unstale",
    "/api/iconoplasm/admin/unstale-batch",
    "/api/iconoplasm/admin/purge-legacy",
    "/api/iconoplasm/admin/remove-candidate",
  ]

  for (const path of mutationPaths) {
    const response = await worker.fetch(
      new Request(`https://iconoplasm.brinedew.bio${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "TP53" }),
      }),
      {},
      { waitUntil() {} },
    )

    assert.equal(response.status, 403, `${path} should be gated, not missing`)
    assert.match(await response.text(), /Unauthorized/)
  }
})
