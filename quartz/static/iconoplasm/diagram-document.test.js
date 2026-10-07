import assert from "node:assert/strict"
import test from "node:test"

import {
  addCompartmentNode,
  addGeneNode,
  addTextNode,
  connectGeneNodes,
  createDiagramDocument,
  createDiagramWorkspace,
  diagramAssetManifest,
  diagramReferences,
  referenceUrl,
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
  assert.equal(document.schema_version, 3)
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
  assert.equal(document.background, "paper")
  assert.ok(document.nodes.every((node) => node.type === "gene"))
})

// B-1045 golden: a diagram the version 2 studio saved in a reader's browser
// (copied from its localStorage shape) opens in version 3 with every gene,
// relationship and text box intact, white sheet included.
test("a version 2 diagram from a reader's browser opens intact as page one", () => {
  const saved = {
    schema_version: 2,
    id: "iconoplasm-diagram",
    title: "EGFR–MAPK signaling",
    width: 1200,
    height: 800,
    background: "#ffffff",
    nodes: [
      {
        id: "gene-egfr",
        type: "gene",
        symbol: "EGFR",
        label: "EGFR",
        x: 50,
        y: 70,
        width: 132,
        height: 176,
        asset: asset("EGFR"),
      },
      {
        id: "gene-kras",
        type: "gene",
        symbol: "KRAS",
        label: "KRAS",
        x: 272,
        y: 70,
        width: 132,
        height: 176,
        asset: asset("KRAS"),
      },
      {
        id: "text-1",
        type: "text",
        text: "Membrane",
        x: 40,
        y: 400,
        width: 260,
        height: 88,
        font_size: 24,
        align: "left",
      },
    ],
    edges: [
      {
        id: "edge-1",
        type: "relationship",
        from: "gene-egfr",
        to: "gene-kras",
        kind: "inhibition",
        label: "activates",
      },
    ],
  }
  const workspace = createDiagramWorkspace(saved)
  const page = workspace.pages[0]

  assert.equal(workspace.pages.length, 1)
  assert.equal(workspace.active, page.id)
  assert.equal(page.background, "white")
  assert.deepEqual(
    page.nodes.map(({ id, type, x, y, width, height }) => [id, type, x, y, width, height]),
    [
      ["gene-egfr", "gene", 50, 70, 132, 176],
      ["gene-kras", "gene", 272, 70, 132, 176],
      ["text-1", "text", 40, 400, 260, 88],
    ],
  )
  assert.equal(page.edges[0].kind, "inhibition")
  assert.equal(page.edges[0].label, "activates")
  assert.equal(page.edges[0].routing, "straight")
  assert.deepEqual(page.edges[0].evidence, { reference: "", note: "" })
})

test("KEGG relation subtypes survive, unknown kinds fall back to activation", () => {
  let document = createDiagramDocument()
  document = addGeneNode(document, { symbol: "BRAF", asset: asset("BRAF") }).document
  document = addGeneNode(document, { symbol: "MAP2K1", asset: asset("MAP2K1") }).document
  const [from, to] = document.nodes.map((node) => node.id)
  const phosphorylation = connectGeneNodes(document, { from, to, kind: "phosphorylation" })
  const nonsense = connectGeneNodes(phosphorylation.document, {
    from: to,
    to: from,
    kind: "telepathy",
  })

  assert.equal(phosphorylation.edge.kind, "phosphorylation")
  assert.equal(nonsense.edge.kind, "activation")
})

test("panel edits are clamped by the same rules as a fresh document", () => {
  let document = createDiagramDocument()
  document = addGeneNode(document, { symbol: "TP53", asset: asset("TP53") }).document
  document = addGeneNode(document, { symbol: "MDM2", asset: asset("MDM2") }).document
  const outcome = connectGeneNodes(document, {
    from: document.nodes[1].id,
    to: document.nodes[0].id,
    kind: "ubiquitination",
  })
  const edited = updateDiagramItem(outcome.document, outcome.edge.id, {
    width: 99,
    opacity: -2,
    color: "red; stroke: url(javascript:alert(1))",
    routing: "teleport",
    evidence: { reference: "PMID: 9153395" },
  })
  const edge = edited.edges[0]
  const gene = updateDiagramItem(edited, edited.nodes[0].id, { width: 180 }).nodes[0]

  assert.equal(edge.width, 8)
  assert.equal(edge.opacity, 0.1)
  assert.equal(edge.color, "")
  assert.equal(edge.routing, "straight")
  assert.equal(gene.height, 240)
  assert.deepEqual(diagramReferences(edited), [
    {
      edge_id: outcome.edge.id,
      from: "MDM2",
      to: "TP53",
      kind: "ubiquitination",
      reference: "PMID: 9153395",
      note: "",
      url: "https://pubmed.ncbi.nlm.nih.gov/9153395/",
    },
  ])
})

test("evidence links only the identifier shapes biologists cite", () => {
  assert.equal(referenceUrl("10.1038/nature12373"), "https://doi.org/10.1038/nature12373")
  assert.equal(referenceUrl("R-HSA-5673001"), "https://reactome.org/content/detail/R-HSA-5673001")
  assert.equal(referenceUrl("Smith et al. 2020"), "")
  assert.equal(referenceUrl("javascript:alert(1)"), "")
})

test("compartments sit behind every character in the stack", () => {
  let document = addGeneNode(createDiagramDocument(), {
    symbol: "EGFR",
    asset: asset("EGFR"),
  }).document
  document = addTextNode(document, { text: "note" }).document
  document = addCompartmentNode(document, { shape: "membrane" }).document

  assert.deepEqual(
    document.nodes.map((node) => node.type),
    ["compartment", "gene", "text"],
  )
})
