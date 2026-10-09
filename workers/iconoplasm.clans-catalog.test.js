import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { ICONOPLASM_CLAN_CATALOG } from "./generated/iconoplasm-clan-catalog.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// B-1070: the clan catalogue (113 KiB of the Worker bundle) loads on the first
// clans request instead of in every cold isolate's start-up. Failure mode: the
// lazy load breaks and the overview reports no clans, or a members page can no
// longer find its clan. The real route on the real D1 schema, as a guest.
test("the clans overview reads the catalogue it loads on first use", async () => {
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/clans"),
      { ICONOPLASM_DB: iconoplasmDatabase() },
    )
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.authenticated, false)
  assert.equal(body.total_clans, ICONOPLASM_CLAN_CATALOG.length)
  assert.ok(body.total_clans > 500, "the whole catalogue, not an empty table")
  assert.equal(body.sealed_count, body.total_clans)
})
