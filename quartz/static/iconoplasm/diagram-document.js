// ARCHITECTURE FENCE [IPD-003]: Studio documents reference the canonical
// published gene blot. They never select or mint a parallel image identity.
export const ICONOPLASM_DIAGRAM_SCHEMA_VERSION = 2
export const ICONOPLASM_DIAGRAM_LIMITS = Object.freeze({
  nodes: 50,
  edges: 100,
  titleLength: 160,
  labelLength: 120,
  textLength: 600,
})

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800
const DEFAULT_NODE_WIDTH = 132
const DEFAULT_NODE_HEIGHT = 176
const DEFAULT_TEXT_WIDTH = 260
const DEFAULT_TEXT_HEIGHT = 88
const EDGE_KINDS = new Set(["activation", "inhibition", "association"])

function finiteNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function boundedText(value, maximum) {
  return String(value ?? "")
    .trim()
    .slice(0, maximum)
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
  return {
    type: "gene_blot",
    symbol,
    canonical_url: canonicalUrl,
    immutable_url: immutableUrl,
    width: Math.max(1, Math.round(finiteNumber(asset.width, 768))),
    height: Math.max(1, Math.round(finiteNumber(asset.height, 1024))),
    blot_fingerprint: boundedText(asset.blot_fingerprint || asset.fingerprint, 128),
    license_url: String(asset.license_url || "").trim(),
    usage_url: String(asset.usage_url || "").trim(),
  }
}

function normalizeGeneNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  const symbol = normalizeGeneSymbol(node.symbol)
  if (!symbol) return null
  const nodeWidth = Math.min(240, Math.max(88, finiteNumber(node.width, DEFAULT_NODE_WIDTH)))
  const nodeHeight = Math.min(320, Math.max(118, finiteNumber(node.height, DEFAULT_NODE_HEIGHT)))
  const fallbackX = 80 + (index % 6) * 170
  const fallbackY = 90 + Math.floor(index / 6) * 220
  return {
    id: safeId(node.id, `gene-${symbol.toLowerCase()}-${index + 1}`),
    type: "gene",
    symbol,
    label: boundedText(node.label || symbol, ICONOPLASM_DIAGRAM_LIMITS.labelLength) || symbol,
    x: Math.min(width - nodeWidth, Math.max(0, finiteNumber(node.x, fallbackX))),
    y: Math.min(height - nodeHeight, Math.max(0, finiteNumber(node.y, fallbackY))),
    width: nodeWidth,
    height: nodeHeight,
    asset: cloneAsset(node.asset, symbol),
  }
}

function normalizeTextNode(rawNode, index, width, height) {
  const node = rawNode && typeof rawNode === "object" ? rawNode : {}
  const nodeWidth = Math.min(900, Math.max(120, finiteNumber(node.width, DEFAULT_TEXT_WIDTH)))
  const nodeHeight = Math.min(500, Math.max(48, finiteNumber(node.height, DEFAULT_TEXT_HEIGHT)))
  const fallbackX = 90 + (index % 4) * 260
  const fallbackY = 92 + Math.floor(index / 4) * 130
  return {
    id: safeId(node.id, `text-${index + 1}`),
    type: "text",
    text: boundedText(node.text || node.label || "Text", ICONOPLASM_DIAGRAM_LIMITS.textLength),
    x: Math.min(width - nodeWidth, Math.max(0, finiteNumber(node.x, fallbackX))),
    y: Math.min(height - nodeHeight, Math.max(0, finiteNumber(node.y, fallbackY))),
    width: nodeWidth,
    height: nodeHeight,
    font_size: Math.min(56, Math.max(12, finiteNumber(node.font_size, 24))),
    align: ["left", "center", "right"].includes(node.align) ? node.align : "left",
  }
}

function normalizeNode(rawNode, index, width, height) {
  return rawNode && rawNode.type === "text"
    ? normalizeTextNode(rawNode, index, width, height)
    : normalizeGeneNode(rawNode, index, width, height)
}

function normalizeEdge(rawEdge, index, nodeIds) {
  const edge = rawEdge && typeof rawEdge === "object" ? rawEdge : {}
  const from = safeId(edge.from, "")
  const to = safeId(edge.to, "")
  if (!from || !to || from === to || !nodeIds.has(from) || !nodeIds.has(to)) return null
  const kind = EDGE_KINDS.has(edge.kind) ? edge.kind : "activation"
  return {
    id: safeId(edge.id, `edge-${index + 1}`),
    type: "relationship",
    from,
    to,
    kind,
    label: boundedText(edge.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength),
  }
}

export function createDiagramDocument(rawDocument = {}) {
  const width = Math.min(2400, Math.max(640, finiteNumber(rawDocument.width, DEFAULT_WIDTH)))
  const height = Math.min(1600, Math.max(360, finiteNumber(rawDocument.height, DEFAULT_HEIGHT)))
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
  const geneIds = new Set(nodes.filter((node) => node.type === "gene").map((node) => node.id))
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
  return {
    schema_version: ICONOPLASM_DIAGRAM_SCHEMA_VERSION,
    id: safeId(rawDocument.id, "iconoplasm-diagram"),
    title:
      boundedText(rawDocument.title, ICONOPLASM_DIAGRAM_LIMITS.titleLength) || "Untitled pathway",
    width,
    height,
    background: /^#[0-9a-f]{6}$/i.test(String(rawDocument.background || ""))
      ? String(rawDocument.background).toLowerCase()
      : "#f4efe4",
    nodes,
    edges,
  }
}

export function cloneDiagramDocument(document) {
  return createDiagramDocument(JSON.parse(JSON.stringify(document || {})))
}

function nextId(items, prefix) {
  const used = new Set(items.map((item) => item.id))
  let index = items.length + 1
  while (used.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function addGeneNode(document, rawNode) {
  const next = cloneDiagramDocument(document)
  if (next.nodes.length >= ICONOPLASM_DIAGRAM_LIMITS.nodes) {
    throw new RangeError(`A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.nodes} items.`)
  }
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
  if (next.nodes.length >= ICONOPLASM_DIAGRAM_LIMITS.nodes) {
    throw new RangeError(`A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.nodes} items.`)
  }
  const node = normalizeTextNode(
    { ...rawNode, id: rawNode.id || nextId(next.nodes, "text") },
    next.nodes.length,
    next.width,
    next.height,
  )
  next.nodes.push(node)
  return { document: next, node }
}

export function connectGeneNodes(document, rawEdge) {
  const next = cloneDiagramDocument(document)
  if (next.edges.length >= ICONOPLASM_DIAGRAM_LIMITS.edges) {
    throw new RangeError(
      `A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.edges} relationships.`,
    )
  }
  const nodeIds = new Set(next.nodes.filter((node) => node.type === "gene").map((node) => node.id))
  const edge = normalizeEdge(
    { ...rawEdge, id: rawEdge && rawEdge.id ? rawEdge.id : nextId(next.edges, "edge") },
    next.edges.length,
    nodeIds,
  )
  if (!edge) throw new TypeError("A relationship requires two different genes in the diagram.")
  next.edges.push(edge)
  return { document: next, edge }
}

export function updateDiagramItem(document, itemId, patch) {
  const next = cloneDiagramDocument(document)
  const node = next.nodes.find((item) => item.id === itemId)
  if (node) {
    if (node.type === "gene" && patch.label !== undefined) {
      node.label = boundedText(patch.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength) || node.symbol
    }
    if (node.type === "text" && (patch.text !== undefined || patch.label !== undefined)) {
      node.text = boundedText(
        patch.text !== undefined ? patch.text : patch.label,
        ICONOPLASM_DIAGRAM_LIMITS.textLength,
      )
    }
    if (patch.x !== undefined)
      node.x = Math.min(next.width - node.width, Math.max(0, finiteNumber(patch.x, node.x)))
    if (patch.y !== undefined)
      node.y = Math.min(next.height - node.height, Math.max(0, finiteNumber(patch.y, node.y)))
    if (node.type === "text" && patch.width !== undefined)
      node.width = Math.min(900, Math.max(120, finiteNumber(patch.width, node.width)))
    if (node.type === "text" && patch.height !== undefined)
      node.height = Math.min(500, Math.max(48, finiteNumber(patch.height, node.height)))
    if (node.type === "text" && patch.font_size !== undefined)
      node.font_size = Math.min(56, Math.max(12, finiteNumber(patch.font_size, node.font_size)))
    if (node.type === "text" && ["left", "center", "right"].includes(patch.align))
      node.align = patch.align
    return next
  }
  const edge = next.edges.find((item) => item.id === itemId)
  if (edge) {
    if (patch.label !== undefined)
      edge.label = boundedText(patch.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength)
    if (patch.kind !== undefined && EDGE_KINDS.has(patch.kind)) edge.kind = patch.kind
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
      blot_fingerprint: node.asset.blot_fingerprint,
      license_url: node.asset.license_url,
      usage_url: node.asset.usage_url,
    }))
}
