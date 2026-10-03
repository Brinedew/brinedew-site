import assert from "node:assert/strict"
import test from "node:test"

await import("./content-vote-bridge.js")

// B-913: the hover card's refused-vote sentence has to reach the reader.
//
// The shared runtime hands a finished sentence to `onVoteFailed(message, err)`. The bridge is
// the only road between the page adapter (content.js) and that runtime for the hover card, so
// it must carry the callback across.
//
// Ways this can fail, written before the code:
//  1. the bridge builds the runtime config without `onVoteFailed`, so the runtime has nobody to
//     tell and a refused vote on the hover card says nothing (the state before B-913);
//  2. while adding it the bridge drops `onAuthRequired` or `onError`, so the login prompt or the
//     console record stops working;
//  3. an adapter that passes no `onVoteFailed` makes the bridge hand the runtime something that
//     is not a function, or throw while wiring.
const bridge = globalThis.IconoplasmContentVoteBridge

const geneDetail = {
  symbol: "TP53",
  portrait: { asset_sha256: "AB12", vision_id: "v1", candidate_image_id: 0 },
}

function wire(extra = {}) {
  const box = { id: "vote-box" }
  const wired = []
  bridge.wireRenderedTooltipVoteBox({
    tooltip: { querySelector: (selector) => (selector === "[data-icono-vote-box]" ? box : null) },
    geneDetail,
    activeSymbol: "TP53",
    cardShared: { wireVoteBox: (target, config) => wired.push({ target, config }) },
    apiBaseUrl: "https://iconoplasm.brinedew.bio",
    fetchImpl: async () => null,
    ...extra,
  })
  return { box, wired }
}

test("the hover card's wiring carries the refused-vote callback to the runtime", () => {
  const onVoteFailed = () => {}
  const onAuthRequired = () => {}
  const onError = () => {}
  const { box, wired } = wire({ onVoteFailed, onAuthRequired, onError })
  assert.equal(wired.length, 1)
  assert.equal(wired[0].target === box, true)
  assert.equal(wired[0].config.onVoteFailed === onVoteFailed, true)
  assert.equal(wired[0].config.onAuthRequired === onAuthRequired, true)
  assert.equal(wired[0].config.onError === onError, true)
  assert.equal(wired[0].config.symbol, "TP53")
  assert.equal(wired[0].config.assetSha, "ab12")
  assert.equal(wired[0].config.deferSnapshot, true)
})

test("an adapter with no refused-vote callback wires the box without one", () => {
  const { wired } = wire({})
  assert.equal(wired.length, 1)
  assert.equal(wired[0].config.onVoteFailed === undefined, true)
})
