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
