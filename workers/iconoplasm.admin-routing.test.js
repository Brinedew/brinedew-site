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
