// The page's structure tokens come from the bootstrap, a guess's bytes come from its provider
// and the browser HTTP cache keeps them. Source-level guards for what
// e2e/geneguessr-reload-tokens.e2e.mjs and e2e/geneguessr-direct-structures.e2e.mjs prove in a
// real browser.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(new URL("./app.js", import.meta.url), "utf8")

test("the page keeps no structure in IndexedDB: the browser HTTP cache serves a repeat view", () => {
  assert.doesNotMatch(source, /indexedDB|IndexedDB/)
  assert.doesNotMatch(source, /sizeBytes/)
  for (const name of [
    "STRUCTURE_CACHE",
    "putStructureInCache",
    "getStructureFromCache",
    "evictIfNeeded",
    "getCachedStructureInfo",
    "putCachedStructureInfo",
  ]) {
    assert.doesNotMatch(source, new RegExp(name), `${name} is back`)
  }
})

test("the bootstrap's guess entries seed the token cache, so a reload asks the route for none", () => {
  assert.match(
    source,
    /for \(const entry of guessEntries\) \{[\s\S]*?entry\.structureToken\?\.url[\s\S]*?structureTokenCache\.set\(key, structureInfoFromToken\(entry\.structureToken\)\)/,
  )
})

test("the token route is the one fallback for a guess no entry carried a token for", () => {
  assert.equal((source.match(/\/api\/structure-token\?uniprot=/g) || []).length, 1)
})

test("a target is fetched through the Worker and validated first, and never from a provider", () => {
  assert.match(
    source,
    /if \(!cacheKey\) \{[\s\S]*?no cacheKey - validating target structure response/,
  )
  // The provider branch needs a key and a direct URL, and a target token has neither.
  assert.match(source, /if \(cacheKey && structureInfo\.directUrl\) \{/)
})

test("a guess's structure loads from its provider: checked, bounded, cached, with a Worker fallback", () => {
  const start = source.indexOf("async function fetchStructureFromProvider")
  const body = source.slice(start, source.indexOf("\n  }\n", start))
  assert.ok(start > 0, "the provider fetch exists")
  assert.match(body, /isStructureProviderUrl\(directUrl\)/, "checked against the provider list")
  assert.match(body, /credentials: "omit"/, "no credentials to a third party")
  assert.match(body, /referrerPolicy: "no-referrer"/, "no referrer to a third party")
  assert.match(body, /cache: "force-cache"/, "a repeat view is the browser's, not the provider's")
  assert.match(body, /limitStructureBody\(response\.body/, "the Worker's cap and HEADER line")
  assert.match(body, /PROVIDER_STALL_MS/, "a stalled provider ends")
  // Any failure but an oversize body leaves the Worker route as the way; an oversize body does
  // not retry there, because the route would cut it off too.
  assert.match(source, /err instanceof StructureTooLargeError/)
  assert.match(source, /provider failed for a guess structure; using the Worker/)
})

test("the page's provider list is the shared module's, and it writes no provider host itself", () => {
  assert.match(source, /from "\.\/structure-bytes\.js\?v=[0-9a-f]{16}"/)
  assert.doesNotMatch(
    source,
    /models\.rcsb\.org|files\.rcsb\.org|alphafold\.ebi\.ac\.uk|swissmodel\.expasy\.org|pdbe\/model-server/,
  )
  assert.doesNotMatch(source, /buildMolstarOptionsFromRepresentation|applyStructureOverrides/)
})
