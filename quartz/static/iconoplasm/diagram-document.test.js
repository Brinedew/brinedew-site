import assert from "node:assert/strict"
import test from "node:test"

import {
  addGeneNode,
  autoLayoutDiagram,
  connectGeneNodes,
  createDiagramDocument,
  diagramAssetManifest,
  renderDiagramSvg,
} from "./diagram-document.js"

const asset = (symbol) => ({
  canonical_url: `https://iconoplasm.brinedew.bio/blot/${symbol}.webp`,
  immutable_url: `https://cdn.example/${symbol}.webp`,
  width: 768,
  height: 1024,
  blot_fingerprint: `fingerprint-${symbol}`,
})

// ARCHITECTURE FENCE [IPD-003]
test("diagram documents use a 3:2 page and retain canonical blot identity", () => {
  let document = createDiagramDocument({ title: "p53 response" })
  assert.equal(document.width / document.height, 1.5)

  document = addGeneNode(document, { symbol: "TP53", asset: asset("TP53") }).document
  document = addGeneNode(document, { symbol: "MDM2", asset: asset("MDM2") }).document
  document = connectGeneNodes(document, {
    from: document.nodes[0].id,
    to: document.nodes[1].id,
    kind: "inhibition",
    label: "restrains",
  }).document
  document = autoLayoutDiagram(document)

  assert.deepEqual(
    diagramAssetManifest(document).map(({ symbol, canonical_url }) => ({ symbol, canonical_url })),
    [
      { symbol: "TP53", canonical_url: "https://iconoplasm.brinedew.bio/blot/TP53.webp" },
      { symbol: "MDM2", canonical_url: "https://iconoplasm.brinedew.bio/blot/MDM2.webp" },
    ],
  )
  const svg = renderDiagramSvg(document)
  assert.match(svg, /viewBox="0 0 1200 800"/)
  assert.match(svg, /https:\/\/cdn\.example\/TP53\.webp/)
  assert.match(svg, /ICONOPLASM · CC0 GENE CHARACTERS/)
})

test("duplicate gene symbols reuse the existing character", () => {
  const first = addGeneNode(createDiagramDocument(), { symbol: "EGFR", asset: asset("EGFR") })
  const second = addGeneNode(first.document, { symbol: "egfr", asset: asset("EGFR") })

  assert.equal(second.added, false)
  assert.equal(second.document.nodes.length, 1)
  assert.equal(second.node.id, first.node.id)
})
