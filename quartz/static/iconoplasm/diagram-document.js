// ARCHITECTURE FENCE [IPD-003]: Studio documents reference the canonical
// published gene blot. They never select or mint a parallel image identity.
export const ICONOPLASM_DIAGRAM_SCHEMA_VERSION = 4
export const ICONOPLASM_DIAGRAM_LIMITS = Object.freeze({
  nodes: 150,
  edges: 300,
  titleLength: 160,
  labelLength: 120,
  textLength: 600,
  referenceLength: 200,
  noteLength: 600,
  vertices: 20,
  pages: 12,
})

// B-1045: relationship names and glyphs are KEGG's pathway notation
// (kegg.jp/kegg/document/help_pathway.html and its symbols.png legend, read
// 2026-10-07). `tag` is the small letter KEGG prints on the line; `head` is
// the end glyph. Version 2 documents only used activation, inhibition and
// association, which keep their ids.
export const RELATIONSHIP_KINDS = Object.freeze([
  { id: "activation", label: "Activation", head: "arrow", key: "a" },
  { id: "inhibition", label: "Inhibition", head: "bar", key: "i" },
  { id: "expression", label: "Expression", head: "arrow", tag: "e", key: "e" },
  { id: "repression", label: "Repression", head: "bar", tag: "e", key: "r" },
  { id: "indirect_effect", label: "Indirect effect", head: "arrow", dashed: true, key: "d" },
  { id: "association", label: "Binding / association", head: "none", key: "b" },
  { id: "dissociation", label: "Dissociation", head: "none", tick: true, key: "x" },
  { id: "missing_interaction", label: "Missing interaction", head: "arrow", slash: true },
  { id: "phosphorylation", label: "Phosphorylation", head: "arrow", tag: "+p", key: "p" },
  { id: "dephosphorylation", label: "Dephosphorylation", head: "arrow", tag: "-p" },
  { id: "ubiquitination", label: "Ubiquitination", head: "arrow", tag: "+u", key: "u" },
  { id: "deubiquitination", label: "Deubiquitination", head: "arrow", tag: "-u" },
  { id: "glycosylation", label: "Glycosylation", head: "arrow", tag: "+g", key: "g" },
  { id: "methylation", label: "Methylation", head: "arrow", tag: "+m", key: "m" },
])
export const RELATIONSHIP_KIND_IDS = Object.freeze(RELATIONSHIP_KINDS.map((kind) => kind.id))
// B-1050: the owner's "simple" notation is the main two to four arrows; KEGG
// is the full legend above. The choice only filters the pickers: a document
// keeps whatever kinds it already uses.
export const RELATIONSHIP_NOTATIONS = Object.freeze({
  simple: Object.freeze(["activation", "inhibition", "association", "indirect_effect"]),
  kegg: RELATIONSHIP_KIND_IDS,
})

export function relationshipKind(id) {
  return RELATIONSHIP_KINDS.find((kind) => kind.id === id) || RELATIONSHIP_KINDS[0]
}

// Compartment shapes follow BioRender's and draw.io's biology libraries:
// a membrane band, the cytoplasm, a nucleus, a mitochondrion, the ER and a
// dashed complex outline. Sizes are the default drop size in page units.
export const COMPARTMENT_SHAPES = Object.freeze([
  { id: "membrane", label: "Plasma membrane", width: 1000, height: 64 },
  { id: "cytoplasm", label: "Cytoplasm", width: 900, height: 520 },
  { id: "nucleus", label: "Nucleus", width: 420, height: 220 },
  { id: "mitochondrion", label: "Mitochondrion", width: 260, height: 130 },
  { id: "er", label: "Endoplasmic reticulum", width: 260, height: 150 },
  { id: "complex", label: "Complex", width: 320, height: 220 },
  // B-1050: a faction bin of a faction chart, an opaque outline over a pale
  // tint of the same colour.
  { id: "faction", label: "Faction", width: 520, height: 640 },
])
const COMPARTMENT_IDS = new Set(COMPARTMENT_SHAPES.map((shape) => shape.id))

export const LINE_PATTERNS = Object.freeze(["solid", "dashed", "dotted"])
export const EDGE_ROUTINGS = Object.freeze(["straight", "orthogonal", "curved"])
export const LINE_JUMPS = Object.freeze(["none", "arc", "gap", "cubic"])
export const LABEL_POSITIONS = Object.freeze(["above", "on", "below"])
export const TEXT_FILLS = Object.freeze(["none", "paper", "note"])
export const PAGE_BACKGROUNDS = Object.freeze({ paper: "#f7f1e8", white: "#ffffff" })
// B-1050: a page can take any colour. These are the named sheets the picker
// offers first; "paper" and "white" keep their version 3 names.
export const PAGE_BACKGROUND_SWATCHES = Object.freeze([
  ["paper", "#f7f1e8", "Paper"],
  ["white", "#ffffff", "White"],
  ["#efe6d6", "#efe6d6", "Manila"],
  ["#e8eee9", "#e8eee9", "Sage"],
  ["#e6edf2", "#e6edf2", "Blueprint"],
  ["#f3e6e1", "#f3e6e1", "Blush"],
  ["#e9e7e4", "#e9e7e4", "Fog"],
  ["#2b211b", "#2b211b", "Dark roast"],
])
// A molecule is any actor that is not a gene's own portrait: a small molecule
// (PIP3, cAMP), an ion or an abstract control variable such as a ratio.
export const MOLECULE_DEFAULT = Object.freeze({ width: 150, height: 72 })
// Which way a line meets the portrait: "square" bends its last stretch so it
// arrives perpendicular to the side it hits (a T-bar lies flat against that
// side); "free" keeps the angle of the line. Empty follows the kind.
export const LINE_END_MODES = Object.freeze(["square", "free"])

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800
const DEFAULT_NODE_WIDTH = 132
const DEFAULT_TEXT_WIDTH = 260
const DEFAULT_TEXT_HEIGHT = 88
const GENE_ASPECT = 4 / 3

function finiteNumber(value, fallback) {
  const numeric = Number(value)
  return value !== null && value !== "" && Number.isFinite(numeric) ? numeric : fallback
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function boundedText(value, maximum) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum)
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

// An empty colour means "the kind's default ink"; anything else must be a
// six-digit hex so exported SVG never carries arbitrary CSS.
function hexColour(value) {
  const colour = String(value ?? "")
    .trim()
    .toLowerCase()
  return /^#[0-9a-f]{6}$/.test(colour) ? colour : ""
}

export function normalizeGeneSymbol(value) {
  const symbol = String(value ?? "")
    .trim()
    .toUpperCase()
  return /^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(symbol) ? symbol : ""
}

function safeId(value, fallback) {
  const id = String(value ?? "").trim()
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id) ? id : fallback
}

function cloneAsset(rawAsset, symbol) {
  const asset = rawAsset && typeof rawAsset === "object" ? rawAsset : {}
  const canonicalUrl = String(asset.canonical_url || asset.canonicalUrl || "").trim()
  const immutableUrl = String(asset.immutable_url || asset.immutableUrl || "").trim()
  const cdnUrl = String(asset.cdn_url || asset.cdnUrl || "").trim()
  return {
    type: "gene_blot",
    symbol,
    canonical_url: canonicalUrl,
    immutable_url: immutableUrl,
    cdn_url: cdnUrl,
    width: Math.max(1, Math.round(finiteNumber(asset.width, 768))),
    height: Math.max(1, Math.round(finiteNumber(asset.height, 1024))),
    blot_fingerprint: boundedText(asset.blot_fingerprint || asset.fingerprint, 128),
    license_url: String(asset.license_url || "").trim(),
    usage_url: String(asset.usage_url || "").trim(),
  }
}

function placed(node, raw, width, height, fallbackX, fallbackY) {
  node.x = clamp(finiteNumber(raw.x, fallbackX), 0, Math.max(0, width - node.width))
  node.y = clamp(finiteNumber(raw.y, fallbackY), 0, Math.max(0, height - node.height))
  return node
}

function normalizeGeneNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  const symbol = normalizeGeneSymbol(node.symbol)
  if (!symbol) return null
  // Portraits are 3:4 blots, so the height always follows the width.
  const nodeWidth = Math.round(clamp(finiteNumber(node.width, DEFAULT_NODE_WIDTH), 72, 240))
  return placed(
    {
      id: safeId(node.id, `gene-${symbol.toLowerCase()}-${index + 1}`),
      type: "gene",
      symbol,
      label: boundedText(node.label || symbol, ICONOPLASM_DIAGRAM_LIMITS.labelLength) || symbol,
      x: 0,
      y: 0,
      width: nodeWidth,
      height: Math.round(nodeWidth * GENE_ASPECT),
      asset: cloneAsset(node.asset, symbol),
    },
    node,
    width,
    height,
    80 + (index % 6) * 170,
    90 + Math.floor(index / 6) * 220,
  )
}

function normalizeTextNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  return placed(
    {
      id: safeId(node.id, `text-${index + 1}`),
      type: "text",
      text: boundedText(node.text || node.label || "Text", ICONOPLASM_DIAGRAM_LIMITS.textLength),
      x: 0,
      y: 0,
      width: clamp(finiteNumber(node.width, DEFAULT_TEXT_WIDTH), 60, 900),
      height: clamp(finiteNumber(node.height, DEFAULT_TEXT_HEIGHT), 28, 500),
      font_size: clamp(finiteNumber(node.font_size, 18), 8, 56),
      align: oneOf(node.align, ["left", "center", "right"], "left"),
      color: hexColour(node.color),
      bold: node.bold === true,
      italic: node.italic === true,
      fill: oneOf(node.fill, TEXT_FILLS, "none"),
    },
    node,
    width,
    height,
    90 + (index % 4) * 260,
    92 + Math.floor(index / 4) * 130,
  )
}

function normalizeCompartmentNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  const shapeId = COMPARTMENT_IDS.has(node.shape) ? node.shape : "cytoplasm"
  const shape = COMPARTMENT_SHAPES.find((item) => item.id === shapeId)
  return placed(
    {
      id: safeId(node.id, `compartment-${index + 1}`),
      type: "compartment",
      shape: shapeId,
      label: boundedText(node.label ?? shape.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength),
      x: 0,
      y: 0,
      width: clamp(finiteNumber(node.width, shape.width), 40, 4000),
      height: clamp(finiteNumber(node.height, shape.height), 24, 4000),
      color: hexColour(node.color),
    },
    node,
    width,
    height,
    40,
    40,
  )
}

function normalizeMoleculeNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  return placed(
    {
      id: safeId(node.id, `molecule-${index + 1}`),
      type: "molecule",
      label:
        boundedText(node.label || node.text || "Molecule", ICONOPLASM_DIAGRAM_LIMITS.labelLength) ||
        "Molecule",
      x: 0,
      y: 0,
      width: clamp(finiteNumber(node.width, MOLECULE_DEFAULT.width), 48, 600),
      height: clamp(finiteNumber(node.height, MOLECULE_DEFAULT.height), 28, 400),
      font_size: clamp(finiteNumber(node.font_size, 16), 8, 40),
      color: hexColour(node.color),
    },
    node,
    width,
    height,
    120 + (index % 5) * 200,
    120 + Math.floor(index / 5) * 140,
  )
}

function normalizeNode(rawNode, index, width, height) {
  if (rawNode && rawNode.type === "text") return normalizeTextNode(rawNode, index, width, height)
  if (rawNode && rawNode.type === "molecule")
    return normalizeMoleculeNode(rawNode, index, width, height)
  if (rawNode && rawNode.type === "compartment")
    return normalizeCompartmentNode(rawNode, index, width, height)
  return normalizeGeneNode(rawNode, index, width, height)
}

function normalizeVertices(rawVertices) {
  if (!Array.isArray(rawVertices)) return []
  return rawVertices
    .slice(0, ICONOPLASM_DIAGRAM_LIMITS.vertices)
    .map((point) => ({
      x: Math.round(finiteNumber(point && point.x, NaN)),
      y: Math.round(finiteNumber(point && point.y, NaN)),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
}

function normalizeEvidence(rawEvidence) {
  const evidence = rawEvidence && typeof rawEvidence === "object" ? rawEvidence : {}
  return {
    reference: boundedText(evidence.reference, ICONOPLASM_DIAGRAM_LIMITS.referenceLength),
    note: boundedText(evidence.note, ICONOPLASM_DIAGRAM_LIMITS.noteLength),
  }
}

function normalizeEdge(rawEdge, index, nodeIds) {
  const edge = rawEdge && typeof rawEdge === "object" ? rawEdge : {}
  const from = safeId(edge.from, "")
  const to = safeId(edge.to, "")
  if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return null
  return {
    id: safeId(edge.id, `edge-${index + 1}`),
    type: "relationship",
    from,
    to,
    kind: RELATIONSHIP_KIND_IDS.includes(edge.kind) ? edge.kind : "activation",
    label: boundedText(edge.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength),
    color: hexColour(edge.color),
    width: clamp(finiteNumber(edge.width, 1.5), 0.5, 8),
    // An empty pattern follows the kind: KEGG draws an indirect effect dashed.
    pattern: oneOf(edge.pattern, LINE_PATTERNS, ""),
    routing: oneOf(edge.routing, EDGE_ROUTINGS, "straight"),
    jumps: oneOf(edge.jumps, LINE_JUMPS, "none"),
    head_size: clamp(finiteNumber(edge.head_size, 8), 4, 20),
    opacity: clamp(finiteNumber(edge.opacity, 1), 0.1, 1),
    label_position: oneOf(edge.label_position, LABEL_POSITIONS, "above"),
    label_size: clamp(finiteNumber(edge.label_size, 14), 8, 28),
    label_background: edge.label_background !== false,
    end: oneOf(edge.end, LINE_END_MODES, ""),
    vertices: normalizeVertices(edge.vertices),
    evidence: normalizeEvidence(edge.evidence),
  }
}

export function createDiagramDocument(rawDocument = {}) {
  const width = clamp(finiteNumber(rawDocument.width, DEFAULT_WIDTH), 640, 12000)
  const height = clamp(finiteNumber(rawDocument.height, DEFAULT_HEIGHT), 360, 12000)
  const rawNodes = Array.isArray(rawDocument.nodes) ? rawDocument.nodes : []
  const nodes = []
  const nodeIds = new Set()
  for (
    let index = 0;
    index < rawNodes.length && nodes.length < ICONOPLASM_DIAGRAM_LIMITS.nodes;
    index++
  ) {
    const node = normalizeNode(rawNodes[index], index, width, height)
    if (!node || nodeIds.has(node.id)) continue
    nodeIds.add(node.id)
    nodes.push(node)
  }
  const geneIds = actorIds(nodes)
  const rawEdges = Array.isArray(rawDocument.edges) ? rawDocument.edges : []
  const edges = []
  const edgeIds = new Set()
  for (
    let index = 0;
    index < rawEdges.length && edges.length < ICONOPLASM_DIAGRAM_LIMITS.edges;
    index++
  ) {
    const edge = normalizeEdge(rawEdges[index], index, geneIds)
    if (!edge || edgeIds.has(edge.id)) continue
    edgeIds.add(edge.id)
    edges.push(edge)
  }
  const background = normalizeBackground(rawDocument.background)
  return {
    schema_version: ICONOPLASM_DIAGRAM_SCHEMA_VERSION,
    id: safeId(rawDocument.id, "iconoplasm-diagram"),
    title:
      boundedText(rawDocument.title, ICONOPLASM_DIAGRAM_LIMITS.titleLength) || "Untitled pathway",
    width,
    height,
    background,
    nodes,
    edges,
  }
}

// Genes and molecules are the actors a relationship can join.
function actorIds(nodes) {
  return new Set(
    nodes.filter((node) => node.type === "gene" || node.type === "molecule").map((node) => node.id),
  )
}

// Version 2 stored the colour itself and version 3 named the sheet ("paper"
// or "white"); version 4 also takes any six-digit colour.
function normalizeBackground(value) {
  if (value === "white" || value === "#ffffff") return "white"
  if (value === "paper" || value === undefined || value === null || value === "") return "paper"
  const colour = hexColour(value)
  if (!colour || colour === PAGE_BACKGROUNDS.paper) return "paper"
  return colour
}

// Relative luminance (WCAG): below this the default ink turns light.
export function isDarkColour(hex) {
  const value = hexColour(hex)
  if (!value) return false
  const channel = (offset) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5) < 0.18
}

export function cloneDiagramDocument(document) {
  return createDiagramDocument(JSON.parse(JSON.stringify(document || {})))
}

export function pageBackgroundColour(document) {
  const background = document && document.background
  return PAGE_BACKGROUNDS[background] || hexColour(background) || PAGE_BACKGROUNDS.paper
}

function nextId(items, prefix) {
  const used = new Set(items.map((item) => item.id))
  let index = items.length + 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function assertRoom(document) {
  if (document.nodes.length >= ICONOPLASM_DIAGRAM_LIMITS.nodes) {
    throw new RangeError(`A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.nodes} items.`)
  }
}

export function addGeneNode(document, rawNode) {
  const next = cloneDiagramDocument(document)
  assertRoom(next)
  const symbol = normalizeGeneSymbol(rawNode && rawNode.symbol)
  if (!symbol) throw new TypeError("A valid gene symbol is required.")
  const existing = next.nodes.find((node) => node.type === "gene" && node.symbol === symbol)
  if (existing) return { document: next, node: existing, added: false }
  const node = normalizeNode(
    { ...rawNode, id: rawNode && rawNode.id ? rawNode.id : nextId(next.nodes, "gene") },
    next.nodes.length,
    next.width,
    next.height,
  )
  next.nodes.push(node)
  return { document: next, node, added: true }
}

export function addTextNode(document, rawNode = {}) {
  const next = cloneDiagramDocument(document)
  assertRoom(next)
  const node = normalizeTextNode(
    { ...rawNode, id: rawNode.id || nextId(next.nodes, "text") },
    next.nodes.length,
    next.width,
    next.height,
  )
  next.nodes.push(node)
  return { document: next, node }
}

export function addMoleculeNode(document, rawNode = {}) {
  const next = cloneDiagramDocument(document)
  assertRoom(next)
  const node = normalizeMoleculeNode(
    { ...rawNode, id: rawNode.id || nextId(next.nodes, "molecule") },
    next.nodes.length,
    next.width,
    next.height,
  )
  next.nodes.push(node)
  return { document: next, node }
}

// Compartments go to the back of the stack so they never cover a character.
export function addCompartmentNode(document, rawNode = {}) {
  const next = cloneDiagramDocument(document)
  assertRoom(next)
  const node = normalizeCompartmentNode(
    { ...rawNode, id: rawNode.id || nextId(next.nodes, "compartment") },
    next.nodes.length,
    next.width,
    next.height,
  )
  const firstNonCompartment = next.nodes.findIndex((item) => item.type !== "compartment")
  next.nodes.splice(firstNonCompartment < 0 ? next.nodes.length : firstNonCompartment, 0, node)
  return { document: next, node }
}

export function connectGeneNodes(document, rawEdge) {
  const next = cloneDiagramDocument(document)
  if (next.edges.length >= ICONOPLASM_DIAGRAM_LIMITS.edges) {
    throw new RangeError(
      `A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.edges} relationships.`,
    )
  }
  const edge = normalizeEdge(
    { ...rawEdge, id: rawEdge && rawEdge.id ? rawEdge.id : nextId(next.edges, "edge") },
    next.edges.length,
    actorIds(next.nodes),
  )
  if (!edge)
    throw new TypeError("A relationship requires two different genes or molecules in the diagram.")
  next.edges.push(edge)
  return { document: next, edge }
}

const NODE_PATCH_FIELDS = {
  gene: ["label", "x", "y", "width"],
  text: [
    "text",
    "label",
    "x",
    "y",
    "width",
    "height",
    "font_size",
    "align",
    "color",
    "bold",
    "italic",
    "fill",
  ],
  compartment: ["label", "x", "y", "width", "height", "color", "shape"],
  molecule: ["label", "x", "y", "width", "height", "color", "font_size"],
}
const EDGE_PATCH_FIELDS = [
  "kind",
  "label",
  "color",
  "width",
  "pattern",
  "routing",
  "jumps",
  "head_size",
  "opacity",
  "label_position",
  "label_size",
  "label_background",
  "end",
  "vertices",
  "evidence",
  "from",
  "to",
]

// Every patch goes back through the normalizers, so a hand-edited value can
// never escape the bounds a fresh document would get.
export function updateDiagramItem(document, itemId, patch = {}) {
  const next = cloneDiagramDocument(document)
  const nodeIndex = next.nodes.findIndex((item) => item.id === itemId)
  if (nodeIndex >= 0) {
    const node = next.nodes[nodeIndex]
    const merged = { ...node }
    for (const field of NODE_PATCH_FIELDS[node.type]) {
      if (patch[field] !== undefined) merged[field] = patch[field]
    }
    if (node.type === "text" && patch.text === undefined && patch.label !== undefined)
      merged.text = patch.label
    if (node.type === "gene" && patch.label !== undefined && !boundedText(patch.label, 1))
      merged.label = node.symbol
    next.nodes[nodeIndex] = normalizeNode(merged, nodeIndex, next.width, next.height)
    return next
  }
  const edgeIndex = next.edges.findIndex((item) => item.id === itemId)
  if (edgeIndex >= 0) {
    const merged = { ...next.edges[edgeIndex] }
    for (const field of EDGE_PATCH_FIELDS) {
      if (patch[field] === undefined) continue
      merged[field] =
        field === "evidence" ? { ...merged.evidence, ...(patch.evidence || {}) } : patch[field]
    }
    const edge = normalizeEdge(merged, edgeIndex, actorIds(next.nodes))
    if (!edge)
      throw new TypeError(
        "A relationship requires two different genes or molecules in the diagram.",
      )
    next.edges[edgeIndex] = edge
    return next
  }
  throw new RangeError(`Unknown diagram item: ${itemId}`)
}

export function removeDiagramItem(document, itemId) {
  const next = cloneDiagramDocument(document)
  const nodeIndex = next.nodes.findIndex((item) => item.id === itemId)
  if (nodeIndex >= 0) {
    next.nodes.splice(nodeIndex, 1)
    next.edges = next.edges.filter((edge) => edge.from !== itemId && edge.to !== itemId)
    return next
  }
  const edgeIndex = next.edges.findIndex((item) => item.id === itemId)
  if (edgeIndex >= 0) {
    next.edges.splice(edgeIndex, 1)
    return next
  }
  return next
}

export function diagramAssetManifest(document) {
  const normalized = cloneDiagramDocument(document)
  return normalized.nodes
    .filter((node) => node.type === "gene")
    .map((node) => ({
      node_id: node.id,
      symbol: node.symbol,
      type: node.asset.type,
      canonical_url: node.asset.canonical_url,
      immutable_url: node.asset.immutable_url,
      cdn_url: node.asset.cdn_url,
      blot_fingerprint: node.asset.blot_fingerprint,
      license_url: node.asset.license_url,
      usage_url: node.asset.usage_url,
    }))
}

// Evidence references are typed by hand, so only the three identifier shapes
// biologists cite in pathway figures become links: PubMed IDs, DOIs and
// Reactome stable IDs. Anything else stays plain text.
export function referenceUrl(reference) {
  const text = String(reference ?? "").trim()
  const pmid = /^(?:PMID:?\s*)?(\d{4,9})$/i.exec(text)
  if (pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pmid[1]}/`
  const doi = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i.exec(text)
  if (doi) return `https://doi.org/${doi[1]}`
  const reactome = /^(R-[A-Z]{3}-\d+)$/.exec(text)
  if (reactome) return `https://reactome.org/content/detail/${reactome[1]}`
  return ""
}

export function diagramReferences(document) {
  const normalized = cloneDiagramDocument(document)
  const symbols = new Map(normalized.nodes.map((node) => [node.id, node.symbol || node.label]))
  return normalized.edges
    .filter((edge) => edge.evidence.reference || edge.evidence.note)
    .map((edge) => ({
      edge_id: edge.id,
      from: symbols.get(edge.from),
      to: symbols.get(edge.to),
      kind: edge.kind,
      reference: edge.evidence.reference,
      note: edge.evidence.note,
      url: referenceUrl(edge.evidence.reference),
    }))
}

// A workspace is the browser's file: a title and up to twelve pages, each a
// complete diagram document. Version 2 kept one document; it becomes page one.
export function createDiagramWorkspace(rawWorkspace = {}) {
  const raw = rawWorkspace && typeof rawWorkspace === "object" ? rawWorkspace : {}
  const rawPages = Array.isArray(raw.pages) ? raw.pages : raw.nodes ? [raw] : []
  const pages = []
  const pageIds = new Set()
  for (const rawPage of rawPages.slice(0, ICONOPLASM_DIAGRAM_LIMITS.pages)) {
    const page = createDiagramDocument(rawPage)
    if (pageIds.has(page.id)) page.id = nextId(pages, "page")
    pageIds.add(page.id)
    pages.push(page)
  }
  if (!pages.length) pages.push(createDiagramDocument({ id: "page-1", title: "Page 1" }))
  const active = pages.some((page) => page.id === raw.active) ? raw.active : pages[0].id
  return {
    schema_version: ICONOPLASM_DIAGRAM_SCHEMA_VERSION,
    title:
      boundedText(raw.workspace_title ?? raw.title, ICONOPLASM_DIAGRAM_LIMITS.titleLength) ||
      "Untitled diagram",
    active,
    pages,
  }
}

export function addWorkspacePage(workspace, rawPage = {}) {
  const next = createDiagramWorkspace(JSON.parse(JSON.stringify(workspace)))
  if (next.pages.length >= ICONOPLASM_DIAGRAM_LIMITS.pages) {
    throw new RangeError(`A diagram can have at most ${ICONOPLASM_DIAGRAM_LIMITS.pages} pages.`)
  }
  const page = createDiagramDocument({
    title: `Page ${next.pages.length + 1}`,
    ...rawPage,
    id: nextId(next.pages, "page"),
  })
  next.pages.push(page)
  next.active = page.id
  return { workspace: next, page }
}
