import assert from "node:assert/strict"
import test from "node:test"

import {
  addGeneNode,
  addTextNode,
  connectGeneNodes,
  createDiagramDocument,
  diagramAssetManifest,
  updateDiagramItem,
} from "./diagram-document.js"

const asset = (symbol) => ({
  canonical_url: "https://iconoplasm.brinedew.bio/blot/" + symbol + ".webp",
  immutable_url: "https://cdn.example/" + symbol + ".webp",
  width: 768,
  height: 1024,
  blot_fingerprint: "fingerprint-" + symbol,
})

// ARCHITECTURE FENCE [IPD-003]
test("diagram documents retain 3:2 geometry and canonical blot identity", () => {
  let document = createDiagramDocument({ title: "p53 response" })
  assert.equal(document.schema_version, 2)
  assert.equal(document.width / document.height, 1.5)

  document = addGeneNode(document, { symbol: "TP53", asset: asset("TP53") }).document
  document = addGeneNode(document, { symbol: "MDM2", asset: asset("MDM2") }).document
  document = connectGeneNodes(document, {
    from: document.nodes[0].id,
    to: document.nodes[1].id,
    kind: "inhibition",
    label: "restrains",
  }).document

  assert.deepEqual(
    diagramAssetManifest(document).map(({ symbol, canonical_url }) => ({ symbol, canonical_url })),
    [
      { symbol: "TP53", canonical_url: "https://iconoplasm.brinedew.bio/blot/TP53.webp" },
      { symbol: "MDM2", canonical_url: "https://iconoplasm.brinedew.bio/blot/MDM2.webp" },
    ],
  )
})

test("text boxes are first-class movable, resizable diagram items", () => {
  const added = addTextNode(createDiagramDocument(), {
    text: "DNA damage response",
    x: 120,
    y: 90,
    width: 320,
    height: 96,
    font_size: 28,
    align: "center",
  })
  const document = updateDiagramItem(added.document, added.node.id, {
    text: "p53-dependent DNA damage response",
    x: 180,
    width: 420,
  })
  const text = document.nodes[0]

  assert.equal(text.type, "text")
  assert.equal(text.text, "p53-dependent DNA damage response")
  assert.equal(text.x, 180)
  assert.equal(text.width, 420)
  assert.equal(text.align, "center")
  assert.deepEqual(diagramAssetManifest(document), [])
})

test("relationships connect genes, never annotation boxes", () => {
  let document = createDiagramDocument()
  document = addGeneNode(document, { symbol: "TP53", asset: asset("TP53") }).document
  document = addTextNode(document, { text: "note" }).document

  assert.throws(
    () =>
      connectGeneNodes(document, {
        from: document.nodes[0].id,
        to: document.nodes[1].id,
        kind: "activation",
      }),
    /requires two different genes/,
  )
})

test("duplicate gene symbols reuse the existing character", () => {
  const first = addGeneNode(createDiagramDocument(), { symbol: "EGFR", asset: asset("EGFR") })
  const second = addGeneNode(first.document, { symbol: "egfr", asset: asset("EGFR") })

  assert.equal(second.added, false)
  assert.equal(second.document.nodes.length, 1)
  assert.equal(second.node.id, first.node.id)
})

test("documents retain 100 pathway members without clipping the model", () => {
  let document = createDiagramDocument()
  for (let index = 1; index <= 100; index += 1) {
    const symbol = `GENE${index}`
    document = addGeneNode(document, { symbol, asset: asset(symbol) }).document
  }

  assert.equal(document.nodes.length, 100)
  assert.equal(document.background, "#ffffff")
  assert.ok(document.nodes.every((node) => node.type === "gene"))
})
