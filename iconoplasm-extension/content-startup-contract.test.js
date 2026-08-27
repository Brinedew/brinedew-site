import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
await import("./content-matcher.js")

const content = readFileSync(new URL("./content.js", import.meta.url), "utf8")
const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"))

test("article startup separates recognition from portrait freshness without a second authority", () => {
  assert.equal(
    manifest.content_scripts.find((entry) => entry.js.includes("content.js")).run_at,
    "document_end",
  )
  assert.match(content, /requestGeneData\(chrome,\s*{[\s\S]*?cacheOnly: true/)
  assert.match(content, /async function fetchGeneDetailsBatch[^]*?await ensureArticleCards\(\)/)
  assert.match(
    content,
    /async function fetchPortraitLocatorsBatch[^]*?await ensureArticleCards\(\)/,
  )
  const cards = content.slice(
    content.indexOf("function ensureArticleCards()"),
    content.indexOf("// -- DOM scanning"),
  )
  assert.ok(
    cards.indexOf("adoptCardSnapshotRevision(revision)") <
      cards.indexOf("hydratePersistentCache()"),
  )
  assert.match(cards, /articleScannerPayload.cardFreshness/)
  assert.match(cards, /GET_CARD_FRESHNESS/)
})

test("cooperative matcher yields on busy turns and remains lexically identical to synchronous matcher", async () => {
  const genes = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [`GENE${i}`, { a: [`Alias-${i}`] }]),
  )
  genes.TP53 = { a: ["p53", "shared"] }
  genes.EZH2 = { a: ["shared"] }
  const options = { blocklist: ["GENE1", "p53 inhibitor"] }
  const api = globalThis.IconoplasmContentMatcher
  const callbacks = []
  let clock = 0
  const pending = api.createGeneMatcherCooperatively(genes, options, {
    performance: { now: () => clock++ },
    requestIdleCallback(cb, timeout) {
      assert.equal(timeout, undefined)
      callbacks.push(cb)
    },
  })
  callbacks.shift()({ timeRemaining: () => 0 })
  assert.equal(callbacks.length, 1)
  let turns = 0
  while (callbacks.length) {
    callbacks.shift()({ timeRemaining: () => 20 })
    assert.ok(++turns < 2000)
  }
  assert.ok(turns > 1)
  const matcher = await pending
  const synchronous = api.createGeneMatcher(genes, options)
  for (const text of [
    "TP53 p53 p53 inhibitor",
    "EZH2 shared",
    "GENE1 GENE20 Alias-20",
    "alias-20 ordinary words",
    "GENE299 GENE3",
  ]) {
    assert.deepEqual(matcher.findMatches(text), synchronous.findMatches(text))
  }
})
