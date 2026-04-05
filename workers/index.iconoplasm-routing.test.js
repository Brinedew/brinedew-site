import assert from "node:assert/strict"
import test from "node:test"

import worker from "./index.js"

test("apex settings host routes iconoplasm admin me through the iconoplasm worker", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/iconoplasm/admin/me", { method: "GET" }),
    {},
    {},
  )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, false)
  assert.equal(payload?.is_admin, false)
})