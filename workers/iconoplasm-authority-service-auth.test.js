import assert from "node:assert/strict"
import test from "node:test"

import {
  AUTHORITY_BEARER_BINDINGS,
  authorizeIconoplasmAuthorityBackupBearer,
  authorizeIconoplasmAuthorityCutoverBearer,
  authorizeIconoplasmAuthorityGenerationBearer,
  authorizeIconoplasmAuthorityMaintenanceBearer,
  authorizeIconoplasmAuthorityReplicaBearer,
} from "./iconoplasm-authority-service-auth.js"

const ADMIN_TOKEN = "legacy-admin-token-0000000000000000001"
const AUDIENCES = Object.freeze({
  replica: authorizeIconoplasmAuthorityReplicaBearer,
  generation: authorizeIconoplasmAuthorityGenerationBearer,
  maintenance: authorizeIconoplasmAuthorityMaintenanceBearer,
  backup: authorizeIconoplasmAuthorityBackupBearer,
  cutover: authorizeIconoplasmAuthorityCutoverBearer,
})
const TOKENS = Object.freeze(
  Object.fromEntries(
    Object.keys(AUDIENCES).map((audience) => [
      audience,
      `authority-${audience}-token-0000000000000001`,
    ]),
  ),
)
const ENV = Object.freeze(
  Object.fromEntries(
    Object.entries(AUTHORITY_BEARER_BINDINGS).map(([audience, binding]) => [
      binding,
      TOKENS[audience],
    ]),
  ),
)

function request(token, header = "authorization") {
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/authority/events", {
    headers: token ? { [header]: header === "authorization" ? `Bearer ${token}` : token } : {},
  })
}

test("each authority bearer is accepted only by its exact audience", async () => {
  for (const [expectedAudience, authorize] of Object.entries(AUDIENCES)) {
    for (const [presentedAudience, token] of Object.entries(TOKENS)) {
      const result = await authorize(request(token), ENV)
      assert.equal(
        result.authorized,
        presentedAudience === expectedAudience,
        `${presentedAudience} token against ${expectedAudience} audience`,
      )
      assert.equal(result.audience, expectedAudience)
    }
    assert.equal((await authorize(request(ADMIN_TOKEN), ENV)).authorized, false)
    assert.equal((await authorize(request(""), ENV)).authorized, false)
  }
})

test("authority bearers have no generic, admin-token, or alternate-header fallback", async () => {
  const envWithRetiredGeneric = {
    ...ENV,
    ICONOPLASM_AUTHORITY_SERVICE_TOKEN: TOKENS.replica,
    ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
  }
  assert.equal(
    (
      await authorizeIconoplasmAuthorityReplicaBearer(
        request(TOKENS.replica, "x-iconoplasm-admin-token"),
        envWithRetiredGeneric,
      )
    ).authorized,
    false,
  )
  assert.equal(
    (
      await authorizeIconoplasmAuthorityReplicaBearer(request(TOKENS.replica), {
        ICONOPLASM_AUTHORITY_SERVICE_TOKEN: TOKENS.replica,
        ICONOPLASM_ADMIN_TOKEN: ADMIN_TOKEN,
      })
    ).authorized,
    false,
  )
})
