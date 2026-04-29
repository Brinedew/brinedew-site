import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const appPath = new URL("./app.js", import.meta.url)

test("home collection cards do not wait for public gallery counts before loading discoveries", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function ensureCollectionReady()")
  const end = app.indexOf("function updateSentinelObserver()", start)
  assert.notEqual(start, -1, "missing ensureCollectionReady")
  assert.notEqual(end, -1, "missing ensureCollectionReady boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(
    block,
    /Promise\.all\(\[\s*initialSharedSettingsPromise,\s*fetchHomeCollectionCounts\(\)/,
    "the first personalized collection paint must not be blocked behind the slower public gallery count/bootstrap request",
  )
  assert.doesNotMatch(
    block,
    /Promise\.all\(\[\s*fetchDiscoveryState\(galleryState\.order, galleryState\.seed\),\s*fetchHomeCollectionCounts\(\)/,
    "cards should render as soon as discovery data is available; counts may update the sidebar later",
  )
  assert.match(
    block,
    /initialSharedSettingsPromise[\s\S]*fetchHomeCollectionCounts\(\)\.then[\s\S]*return fetchDiscoveryState\(galleryState\.order, galleryState\.seed\)/,
    "after settings sync, counts should load as a side update while discovery data owns first card paint",
  )
})

test("home collection first paint uses discovery rows before rich detail hydration", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("if (orderEl)", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing loadNextGalleryPage boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(
    block,
    /Promise\.all\(\s*pageEntries\.map\(function \(entry\) \{\s*return loadDiscoveredGeneCardData\(entry\)/,
    "the first personalized grid paint must not wait for one rich detail request per visible gene",
  )
  assert.match(
    block,
    /var immediateItems = pageEntries\.map\(function \(entry\) \{\s*return fallbackDiscoveredGene\(entry\)/,
    "discovery rows should create immediate real cards while rich gene details hydrate afterward",
  )
  assert.match(
    block,
    /void hydrateBrickCards\(newCards\)/,
    "rich card detail should still hydrate after first paint",
  )
  assert.match(
    block,
    /if \(homeLayout === "masonry"\)[\s\S]*void hydrateBrickCards\(newCards\)[\s\S]*} else \{[\s\S]*void hydrateBrickCards\(newCards\)/,
    "both desktop masonry and mobile/non-masonry home layouts must hydrate fallback cards after first paint",
  )
  const hydrateCalls = block.match(/void hydrateBrickCards\(newCards\)/g) || []
  assert.ok(
    hydrateCalls.length >= 2,
    "both public/gallery masonry and personalized collection masonry paths must hydrate fallback cards",
  )
})

test("archival fallback cards clear missing portrait state during hydration", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function hydrateBrickCard(card, genePayload)")
  const end = app.indexOf("function hydrateBrickCards(cards)", start)
  assert.notEqual(start, -1, "missing hydrateBrickCard")
  assert.notEqual(end, -1, "missing hydrateBrickCard boundary")
  const block = app.slice(start, end)

  assert.match(
    block,
    /portraitShell\.classList\.remove\("iconoplasm-tooltip-portrait-missing"\)/,
    "archival hydration must remove the missing state after a real portrait arrives",
  )
  assert.match(
    block,
    /portraitShell\.classList\.add\("iconoplasm-tooltip-portrait--ready"\)/,
    "archival hydration must mark the portrait shell ready, not only inject an image",
  )
  assert.match(
    block,
    /card\.style\.setProperty\("--width", String\(dims\.width\)\)/,
    "archival hydration must replace fallback square dimensions with the real portrait width",
  )
  assert.match(
    block,
    /card\.style\.setProperty\("--icono-card-accent", String\(\(genePayload && genePayload\.color\) \|\| "#888"\)\)/,
    "archival hydration must restore the card accent from rich gene data",
  )
  assert.doesNotMatch(
    block,
    /geneAccentColor\(/,
    "archival hydration must not call undefined helper names that only fail in the live browser",
  )
})
