import {
  addCompartmentNode,
  addGeneNode,
  addMoleculeNode,
  addTextNode,
  connectGeneNodes,
  createDiagramDocument,
} from "./diagram-document.js?v=7bf71c5dd15e3e7f"

// B-1050: the canvas templates. Each one is a kind of chart from the owner's
// own writing, so the names are the owner's:
//
// - Faction chart: genes as agents in factions, one bin per pathway state
//   (left "off", right "on"), compartments mirrored top to bottom, inputs near
//   the top and outputs near the bottom, two arrow kinds only. The cast is the
//   owner's "oncogene-induced apoptosis" from "Mnemonic portraits for 19,023
//   human genes" (What next?).
// - Control variable chart: one abstract variable in the middle and four
//   quadrants around it: upstream that lowers it, upstream that raises it,
//   downstream that runs when it is low, and when it is high. PIP3 : PIP2 is the
//   owner's own example (2026-10-08).
// - Mechanism chart: parts and activities joined into one causal chain from
//   input to output ("Types of explanations in biology"), on EGFR-MAPK.
//
// Every layout is placed by hand and checked by diagram-templates.test.js: no
// two shapes overlap, no arrow runs along another, and no arrow crosses a
// portrait it does not join.

const GENE_WIDTH = 128
const ON = "#1b7269"
const OFF = "#a24834"
const ENVELOPE = "#1b7269"

const MIRRORED_BANDS = [
  // [shape, label, y, height, colour]
  ["membrane", "Plasma membrane", 80, 60, ""],
  ["membrane", "Nuclear envelope", 380, 40, ENVELOPE],
  ["membrane", "Nuclear envelope", 840, 40, ENVELOPE],
  ["membrane", "Plasma membrane", 1140, 60, ""],
]

const REGION_LABELS = [
  // [text, y]
  ["EXTRACELLULAR", 14],
  ["CYTOPLASM", 152],
  ["NUCLEUS", 432],
  ["CYTOPLASM", 892],
  ["EXTRACELLULAR", 1212],
]

export const DIAGRAM_TEMPLATES = Object.freeze([
  Object.freeze({
    id: "faction",
    name: "Faction chart",
    category: "Faction charts",
    subject: "Oncogene-induced apoptosis",
    page: { width: 1600, height: 1280 },
    bins: [
      ["Restart the cycle", 50, 30, 740, 1220, OFF],
      ["Collapse the world", 810, 30, 740, 1220, ON],
    ],
    bands: MIRRORED_BANDS,
    regions: REGION_LABELS,
    genes: [
      ["HRAS", 560, 30],
      ["MYC", 200, 480],
      ["MDM2", 520, 650],
      ["BCL2", 520, 920],
      ["TP53", 1000, 540],
      ["BBC3", 940, 920],
      ["BAX", 1240, 920],
    ],
    molecules: [],
    edges: [
      ["HRAS", "MYC", "activation", ""],
      ["MYC", "TP53", "activation", "oncogenic stress"],
      ["MDM2", "TP53", "inhibition", ""],
      [
        "TP53",
        "MDM2",
        "activation",
        "",
        [
          { x: 1064, y: 830 },
          { x: 616, y: 830 },
        ],
      ],
      ["TP53", "BBC3", "activation", ""],
      ["TP53", "BAX", "activation", ""],
      ["BBC3", "BCL2", "inhibition", ""],
      [
        "BCL2",
        "BAX",
        "inhibition",
        "",
        [
          { x: 584, y: 1112 },
          { x: 1304, y: 1112 },
        ],
      ],
    ],
  }),
  Object.freeze({
    id: "control-variable",
    name: "Control variable chart",
    category: "Control variable charts",
    subject: "PIP₃ : PIP₂",
    page: { width: 1400, height: 1000 },
    // B-1051: upstream arrows come in at the variable's top and downstream
    // ones leave from its bottom, each at its own point (the owner's example).
    lines: "top-to-bottom",
    bins: [
      ["Upstream: lowers PIP₃", 40, 40, 640, 390, OFF],
      ["Upstream: raises PIP₃", 720, 40, 640, 390, ON],
      ["Downstream: runs when PIP₃ is low", 40, 570, 640, 390, OFF],
      ["Downstream: runs when PIP₃ is high", 720, 570, 640, 390, ON],
    ],
    bands: [],
    regions: [],
    genes: [
      ["PTEN", 170, 180],
      ["INPP5D", 420, 180],
      ["PIK3CA", 850, 180],
      ["PIK3R1", 1100, 180],
      ["FOXO3", 170, 690],
      ["GSK3B", 420, 690],
      ["PDPK1", 850, 690],
      ["AKT1", 1100, 690],
    ],
    molecules: [["variable", "PIP₃ : PIP₂", 560, 455, 280, 90]],
    edges: [
      ["PTEN", "variable", "inhibition", ""],
      ["INPP5D", "variable", "inhibition", ""],
      ["PIK3CA", "variable", "activation", ""],
      ["PIK3R1", "variable", "activation", ""],
      ["variable", "FOXO3", "inhibition", ""],
      ["variable", "GSK3B", "inhibition", ""],
      ["variable", "PDPK1", "activation", ""],
      ["variable", "AKT1", "activation", ""],
    ],
  }),
  Object.freeze({
    id: "mechanism",
    name: "Mechanism chart",
    category: "Mechanism charts",
    subject: "EGFR–MAPK signaling",
    page: { width: 1400, height: 900 },
    bins: [],
    bands: [["membrane", "Plasma membrane", 170, 60, ""]],
    nucleus: [640, 600, 700, 270],
    regions: [],
    genes: [
      ["EGFR", 100, 130],
      ["KRAS", 520, 130],
      ["GRB2", 180, 360],
      ["SOS1", 350, 360],
      ["BRAF", 680, 360],
      ["MAP2K1", 860, 360],
      ["MAPK1", 1040, 360],
      ["DUSP6", 1220, 360],
      ["ELK1", 820, 690],
      ["FOS", 1040, 690],
    ],
    geneWidth: 104,
    molecules: [],
    edges: [
      ["EGFR", "GRB2", "association", ""],
      ["GRB2", "SOS1", "association", ""],
      ["SOS1", "KRAS", "activation", "GEF"],
      ["KRAS", "BRAF", "activation", ""],
      ["BRAF", "MAP2K1", "phosphorylation", ""],
      ["MAP2K1", "MAPK1", "phosphorylation", ""],
      ["MAPK1", "ELK1", "phosphorylation", ""],
      ["ELK1", "FOS", "expression", ""],
      ["DUSP6", "MAPK1", "dephosphorylation", ""],
      [
        "MAPK1",
        "SOS1",
        "inhibition",
        "negative feedback",
        [
          { x: 1092, y: 560 },
          { x: 402, y: 560 },
        ],
      ],
    ],
  }),
])

// The template library shows a picture of each template, as draw.io's does:
// the PNG export of the built page, scaled to 960 px wide (sharp in the magnifier)
// (studio/templates/<id>.webp). Regenerate it when a template's layout moves.
export function templateThumbnail(id) {
  return new URL(`./studio/templates/${id}.webp`, import.meta.url).href
}

export function diagramTemplate(id) {
  return DIAGRAM_TEMPLATES.find((template) => template.id === id) || null
}

export function templateSymbols(id) {
  return (diagramTemplate(id)?.genes || []).map(([symbol]) => symbol)
}

// Builds the page. `assets` maps a symbol to its resolved blot; a gene the
// resolver could not find is left out together with its relationships.
export function buildTemplateDocument(id, assets, { documentId } = {}) {
  const template = diagramTemplate(id)
  if (!template) throw new RangeError(`Unknown template: ${id}`)
  const width = template.geneWidth || GENE_WIDTH
  let document = createDiagramDocument({
    id: documentId,
    title: template.subject,
    width: template.page.width,
    height: template.page.height,
    lines: template.lines || "free",
  })
  // Background to foreground: compartment bands, then the faction bins over
  // them, then region names, molecules and portraits; arrows draw last.
  for (const [shape, label, y, height, color] of template.bands) {
    document = addCompartmentNode(document, {
      shape,
      label,
      x: 0,
      y,
      width: template.page.width,
      height,
      color,
    }).document
  }
  if (template.nucleus) {
    const [x, y, nucleusWidth, nucleusHeight] = template.nucleus
    document = addCompartmentNode(document, {
      id: "compartment-nucleus",
      shape: "nucleus",
      x,
      y,
      width: nucleusWidth,
      height: nucleusHeight,
    }).document
  }
  for (const [label, x, y, binWidth, binHeight, color] of template.bins) {
    document = addCompartmentNode(document, {
      shape: "faction",
      label,
      x,
      y,
      width: binWidth,
      height: binHeight,
      color,
    }).document
  }
  for (const [text, y] of template.regions) {
    document = addTextNode(document, {
      text,
      x: 66,
      y,
      width: 150,
      height: 28,
      font_size: 11,
      bold: true,
      color: "#7a5a3e",
    }).document
  }
  const ids = new Map()
  for (const [key, label, x, y, moleculeWidth, moleculeHeight] of template.molecules) {
    const added = addMoleculeNode(document, {
      id: `molecule-${key}`,
      label,
      x,
      y,
      width: moleculeWidth,
      height: moleculeHeight,
      font_size: 22,
    })
    document = added.document
    ids.set(key, added.node.id)
  }
  for (const [symbol, x, y] of template.genes) {
    const asset = assets.get(symbol)
    if (!asset) continue
    const added = addGeneNode(document, {
      id: `gene-${symbol.toLowerCase()}`,
      symbol,
      asset,
      x,
      y,
      width,
    })
    document = added.document
    ids.set(symbol, added.node.id)
  }
  for (const [from, to, kind, label, vertices = []] of template.edges) {
    if (!ids.has(from) || !ids.has(to)) continue
    document = connectGeneNodes(document, {
      from: ids.get(from),
      to: ids.get(to),
      kind,
      label,
      label_position: vertices.length ? "below" : "above",
      vertices,
    }).document
  }
  return document
}
