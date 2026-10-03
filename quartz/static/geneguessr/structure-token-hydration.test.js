// The page's structure tokens come from the bootstrap, and the browser HTTP cache keeps the
// bytes. Source-level guards for what e2e/geneguessr-reload-tokens.e2e.mjs proves in a
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

test("a guess's structure loads by its URL and only a target is fetched and validated first", () => {
  assert.match(
    source,
    /if \(!cacheKey\) \{[\s\S]*?no cacheKey - validating target structure response/,
  )
})
