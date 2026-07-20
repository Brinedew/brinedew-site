import assert from "node:assert/strict"
import test from "node:test"

import { ICONOPLASM_CACHE_POLICY, iconoplasmCacheControl } from "./iconoplasm-cache-policy.js"

test("Iconoplasm cache policies classify shared and private data without overlap", () => {
  assert.match(iconoplasmCacheControl("publicMutable"), /^public,/)
  assert.match(iconoplasmCacheControl("publicImmutable"), /^public,/)
  assert.doesNotMatch(iconoplasmCacheControl("authenticated"), /\bpublic\b/)
  assert.match(iconoplasmCacheControl("authenticated"), /private/)
  assert.match(iconoplasmCacheControl("sensitive"), /no-store/)
  assert.ok(Object.isFrozen(ICONOPLASM_CACHE_POLICY))
})

test("Iconoplasm cache policy lookup fails closed for an unclassified response", () => {
  assert.throws(() => iconoplasmCacheControl("maybePublic"), /Unknown Iconoplasm cache policy/)
})
