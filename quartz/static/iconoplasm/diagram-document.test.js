import assert from "node:assert/strict"
import test from "node:test"

import {
  RELATIONSHIP_NOTATIONS,
  addCompartmentNode,
  addGaugeNode,
  addGeneNode,
  addMoleculeNode,
  addTextNode,
  connectGeneNodes,
  createDiagramDocument,
  createDiagramWorkspace,
  diagramAssetManifest,
  diagramReferences,
  effectiveLine,
  isDarkColour,
  lineEnds,
  linesPreset,
  pageBackgroundColour,
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
  assert.equal(document.schema_version, 5)
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
  // An old relationship's "straight" follows the page now, which draws straight.
  assert.equal(page.edges[0].routing, "")
  assert.equal(effectiveLine(page.edges[0], page.lines).routing, "straight")
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
  assert.equal(edge.routing, "", "an unknown routing follows the page")
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

// B-1050: a molecule (PIP3, an ion, a control variable) is an actor that
// relationships join, like a gene, but it carries no blot.
test("relationships join genes and molecules alike", () => {
  let document = addGeneNode(createDiagramDocument(), {
    symbol: "PIK3CA",
    asset: asset("PIK3CA"),
  }).document
  const added = addMoleculeNode(document, { label: "PIP₃ : PIP₂", x: 400, y: 200 })
  document = connectGeneNodes(added.document, {
    from: document.nodes[0].id,
    to: added.node.id,
    kind: "activation",
  }).document
  assert.equal(added.node.type, "molecule")
  assert.equal(document.edges.length, 1)
  assert.deepEqual(
    diagramAssetManifest(document).map((entry) => entry.symbol),
    ["PIK3CA"],
  )
  assert.equal(
    updateDiagramItem(document, document.edges[0].id, { end: "square" }).edges[0].end,
    "square",
  )
  assert.equal(
    updateDiagramItem(document, document.edges[0].id, { end: "sideways" }).edges[0].end,
    "",
  )
})

test("a page takes any colour; anything else falls back to paper", () => {
  assert.equal(createDiagramDocument({ background: "#2B211B" }).background, "#2b211b")
  assert.equal(pageBackgroundColour(createDiagramDocument({ background: "#2b211b" })), "#2b211b")
  assert.equal(createDiagramDocument({ background: "white" }).background, "white")
  assert.equal(
    createDiagramDocument({ background: "url(javascript:alert(1))" }).background,
    "paper",
  )
  assert.equal(isDarkColour("#2b211b"), true)
  assert.equal(isDarkColour("#f7f1e8"), false)
})

// Golden: a page the version 3 studio saved opens unchanged in version 5.
test("a version 3 page opens unchanged", () => {
  const saved = {
    schema_version: 3,
    id: "page-1",
    title: "EGFR–MAPK signaling",
    width: 1400,
    height: 900,
    background: "paper",
    nodes: [
      {
        id: "gene-egfr",
        type: "gene",
        symbol: "EGFR",
        x: 100,
        y: 130,
        width: 104,
        asset: asset("EGFR"),
      },
      {
        id: "gene-grb2",
        type: "gene",
        symbol: "GRB2",
        x: 180,
        y: 360,
        width: 104,
        asset: asset("GRB2"),
      },
    ],
    edges: [
      {
        id: "edge-1",
        type: "relationship",
        from: "gene-egfr",
        to: "gene-grb2",
        kind: "association",
      },
    ],
  }
  const page = createDiagramDocument(saved)
  assert.equal(page.schema_version, 5)
  assert.equal(page.background, "paper")
  assert.deepEqual(
    page.nodes.map(({ id, x, y }) => [id, x, y]),
    [
      ["gene-egfr", 100, 130],
      ["gene-grb2", 180, 360],
    ],
  )
  assert.equal(page.edges[0].kind, "association")
  assert.equal(page.edges[0].end, "")
})

// Golden (B-1051): a version 4 page stored "straight" on every relationship,
// the only default there was. It opens with Free lines, its straight lines
// follow the page and still draw straight, and a hand-set curve stays a curve.
test("a version 4 page opens with Free lines and draws the same", () => {
  const page = createDiagramDocument({
    schema_version: 4,
    nodes: [
      { id: "a", type: "gene", symbol: "TP53", asset: asset("TP53"), x: 0, y: 0, width: 120 },
      { id: "b", type: "gene", symbol: "MDM2", asset: asset("MDM2"), x: 300, y: 400, width: 120 },
    ],
    edges: [
      { id: "e1", from: "a", to: "b", routing: "straight" },
      { id: "e2", from: "b", to: "a", routing: "curved", kind: "inhibition" },
    ],
  })
  assert.equal(linesPreset(page.lines), "free")
  assert.deepEqual(
    page.edges.map((edge) => [edge.routing, effectiveLine(edge, page.lines).routing]),
    [
      ["", "straight"],
      ["curved", "curved"],
    ],
  )
  assert.equal(effectiveLine(page.edges[1], page.lines).end, "square", "a T-bar meets square")
  assert.deepEqual(lineEnds(page).get("e1"), { source: null, target: null }, "Free: any side")
})

// B-1051: "Top to bottom" puts each source end on its bottom and each target
// end on its top, spread at k/(N+1) along the side in the order of the other
// end, and on a molecule moved onto the ellipse (70% of its width is used).
test("top to bottom spreads ends along a side and onto a molecule's curve", () => {
  let document = createDiagramDocument({ lines: "top-to-bottom" })
  document = addGeneNode(document, { symbol: "PTEN", asset: asset("PTEN"), x: 100, y: 40 }).document
  document = addGeneNode(document, {
    symbol: "PIK3CA",
    asset: asset("PIK3CA"),
    x: 700,
    y: 40,
  }).document
  document = addMoleculeNode(document, {
    id: "m",
    label: "PIP3",
    x: 300,
    y: 400,
    width: 280,
    height: 90,
  }).document
  const [pten, pik3ca] = document.nodes.filter((node) => node.type === "gene").map((n) => n.id)
  document = connectGeneNodes(document, { from: pik3ca, to: "m", kind: "activation" }).document
  document = connectGeneNodes(document, { from: pten, to: "m", kind: "inhibition" }).document
  const ends = lineEnds(document)
  const [toFromPik3ca, toFromPten] = document.edges.map((edge) => ends.get(edge.id))
  // Every end stops 3 units out from its side, as an unsided end does.
  assert.deepEqual(toFromPten.source, { side: "bottom", dx: 0, dy: 3 })
  // 196 usable units, two ends: at -33 and +33 (whole units), PTEN (left)
  // first, 1 unit down onto the curve and 3 out: -2.
  assert.deepEqual(toFromPten.target, { side: "top", dx: -33, dy: -2 })
  assert.deepEqual(toFromPik3ca.target, { side: "top", dx: 33, dy: -2 })
  // A side set by hand on one relationship wins over the page's.
  const edited = updateDiagramItem(document, document.edges[1].id, { source_side: "right" })
  assert.deepEqual(lineEnds(edited).get(document.edges[1].id).source, {
    side: "right",
    dx: 3,
    dy: 0,
  })
  assert.equal(linesPreset({ ...document.lines, spread: false }), "custom")
})

// B-1051: a gauge is an actor like a molecule, with the user's words for its
// name and both ends. Its box is a rectangle, so ends on a side spread over
// the whole side, with no step in onto a curve.
test("a gauge keeps its words and spreads ends over its whole top", () => {
  let document = createDiagramDocument({ lines: "top-to-bottom" })
  document = addGeneNode(document, { symbol: "PTEN", asset: asset("PTEN"), x: 100, y: 40 }).document
  document = addGeneNode(document, {
    symbol: "PIK3CA",
    asset: asset("PIK3CA"),
    x: 700,
    y: 40,
  }).document
  const added = addGaugeNode(document, { label: "PIP₃ : PIP₂", x: 300, y: 400 })
  assert.deepEqual(
    [added.node.type, added.node.width, added.node.height, added.node.needle],
    ["gauge", 300, 190, "middle"],
  )
  assert.deepEqual([added.node.low_label, added.node.high_label], ["LOW", "HIGH"])
  document = added.document
  const [pten, pik3ca] = document.nodes.filter((node) => node.type === "gene").map((n) => n.id)
  const gauge = added.node.id
  document = connectGeneNodes(document, { from: pik3ca, to: gauge, kind: "activation" }).document
  document = connectGeneNodes(document, { from: pten, to: gauge, kind: "inhibition" }).document
  const ends = lineEnds(document)
  const [fromPik3ca, fromPten] = document.edges.map((edge) => ends.get(edge.id).target)
  // 300 units, two ends: at -50 and +50, 3 out from the top.
  assert.deepEqual(fromPten, { side: "top", dx: -50, dy: -3 })
  assert.deepEqual(fromPik3ca, { side: "top", dx: 50, dy: -3 })
  // The words are the user's: an end may be emptied, a needle must be one of three.
  const edited = updateDiagramItem(document, gauge, {
    low_label: "",
    high_label: "AKT on",
    needle: "sideways",
  })
  const node = edited.nodes.find((item) => item.id === gauge)
  assert.deepEqual([node.low_label, node.high_label, node.needle], ["", "AKT on", "middle"])
  assert.equal(updateDiagramItem(edited, gauge, { needle: "high" }).nodes.at(-1).needle, "high")
})

test("the simple notation is the main four arrows", () => {
  assert.deepEqual(
    [...RELATIONSHIP_NOTATIONS.simple],
    ["activation", "inhibition", "association", "indirect_effect"],
  )
})
