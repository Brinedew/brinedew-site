import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

test("iconoplasm top-level admin route stays wired instead of silently falling through to 404", async () => {
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://iconoplasm.brinedew.bio/admin", { method: "GET" }),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 403)
  assert.match(await response.text(), /403 Unauthorized/)
})

test("iconoplasm legacy admin path redirects to the apex-hosted ops page instead of going dead", async () => {
  const worker = (await import("./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js")).default
  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/admin/iconoplasm", { method: "GET", redirect: "manual" }),
    {},
    {},
  )

  assert.equal(response.status, 302)
  assert.equal(response.headers.get("location"), "https://brinedew.bio/admin/iconoplasm#costs")
})
