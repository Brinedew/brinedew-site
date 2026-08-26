// ARCHITECTURE FENCE [IPD-003]: Studio documents reference the canonical
// published gene blot. They never select or mint a parallel image identity.
export const ICONOPLASM_DIAGRAM_SCHEMA_VERSION = 1
export const ICONOPLASM_DIAGRAM_LIMITS = Object.freeze({
  nodes: 50,
  edges: 100,
  titleLength: 160,
  labelLength: 120,
})

const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800
const DEFAULT_NODE_WIDTH = 132
const DEFAULT_NODE_HEIGHT = 176
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

function normalizeNode(rawNode, index, width, height) {
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
  const rawEdges = Array.isArray(rawDocument.edges) ? rawDocument.edges : []
  const edges = []
  const edgeIds = new Set()
  for (
    let index = 0;
    index < rawEdges.length && edges.length < ICONOPLASM_DIAGRAM_LIMITS.edges;
    index++
  ) {
    const edge = normalizeEdge(rawEdges[index], index, nodeIds)
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
    throw new RangeError(`A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.nodes} genes.`)
  }
  const symbol = normalizeGeneSymbol(rawNode && rawNode.symbol)
  if (!symbol) throw new TypeError("A valid gene symbol is required.")
  const existing = next.nodes.find((node) => node.symbol === symbol)
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

export function connectGeneNodes(document, rawEdge) {
  const next = cloneDiagramDocument(document)
  if (next.edges.length >= ICONOPLASM_DIAGRAM_LIMITS.edges) {
    throw new RangeError(
      `A diagram can contain at most ${ICONOPLASM_DIAGRAM_LIMITS.edges} relationships.`,
    )
  }
  const nodeIds = new Set(next.nodes.map((node) => node.id))
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
    if (patch.label !== undefined) {
      node.label = boundedText(patch.label, ICONOPLASM_DIAGRAM_LIMITS.labelLength) || node.symbol
    }
    if (patch.x !== undefined)
      node.x = Math.min(next.width - node.width, Math.max(0, finiteNumber(patch.x, node.x)))
    if (patch.y !== undefined)
      node.y = Math.min(next.height - node.height, Math.max(0, finiteNumber(patch.y, node.y)))
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

function layerDiagram(document) {
  const nodeIds = document.nodes.map((node) => node.id)
  const incoming = new Map(nodeIds.map((id) => [id, 0]))
  const outgoing = new Map(nodeIds.map((id) => [id, []]))
  for (const edge of document.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1)
    outgoing.get(edge.from).push(edge.to)
  }
  const layerById = new Map()
  const queue = nodeIds.filter((id) => incoming.get(id) === 0)
  for (const id of queue) layerById.set(id, 0)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]
    for (const target of outgoing.get(id)) {
      layerById.set(target, Math.max(layerById.get(target) || 0, (layerById.get(id) || 0) + 1))
      incoming.set(target, incoming.get(target) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }
  let fallbackLayer = Math.max(0, ...layerById.values())
  for (const id of nodeIds) {
    if (!layerById.has(id)) layerById.set(id, fallbackLayer++)
  }
  return layerById
}

export function autoLayoutDiagram(document, direction = "horizontal") {
  const next = cloneDiagramDocument(document)
  if (!next.nodes.length) return next
  const layerById = next.edges.length
    ? layerDiagram(next)
    : new Map(next.nodes.map((node, index) => [node.id, direction === "vertical" ? index : 0]))
  const layers = new Map()
  for (const node of next.nodes) {
    const layer = layerById.get(node.id) || 0
    if (!layers.has(layer)) layers.set(layer, [])
    layers.get(layer).push(node)
  }
  const orderedLayers = [...layers.entries()].sort((left, right) => left[0] - right[0])
  const marginX = 72
  const marginY = 62
  if (!next.edges.length && direction !== "vertical") {
    const columns = Math.min(next.nodes.length, 6)
    const rows = Math.ceil(next.nodes.length / columns)
    const xGap = columns === 1 ? 0 : (next.width - marginX * 2 - DEFAULT_NODE_WIDTH) / (columns - 1)
    const yGap = rows === 1 ? 0 : (next.height - marginY * 2 - DEFAULT_NODE_HEIGHT) / (rows - 1)
    next.nodes.forEach((node, index) => {
      const row = Math.floor(index / columns)
      const rowCount = Math.min(columns, next.nodes.length - row * columns)
      const rowWidth = (rowCount - 1) * xGap + node.width
      const rowStart = (next.width - rowWidth) / 2
      node.x = rowStart + (index % columns) * xGap
      node.y = rows === 1 ? (next.height - node.height) / 2 : marginY + row * yGap
    })
    return next
  }
  const primaryLength = direction === "vertical" ? next.height : next.width
  const secondaryLength = direction === "vertical" ? next.width : next.height
  const primaryMargin = direction === "vertical" ? marginY : marginX
  const secondaryMargin = direction === "vertical" ? marginX : marginY
  const primaryNodeSize = direction === "vertical" ? DEFAULT_NODE_HEIGHT : DEFAULT_NODE_WIDTH
  const layerGap =
    orderedLayers.length === 1
      ? 0
      : (primaryLength - primaryMargin * 2 - primaryNodeSize) / (orderedLayers.length - 1)
  orderedLayers.forEach(([_, nodes], layerIndex) => {
    const available = secondaryLength - secondaryMargin * 2
    const step = available / Math.max(1, nodes.length)
    nodes.forEach((node, nodeIndex) => {
      const secondary =
        secondaryMargin +
        step * nodeIndex +
        (step - (direction === "vertical" ? node.width : node.height)) / 2
      const primary = primaryMargin + layerIndex * layerGap
      if (direction === "vertical") {
        node.x = secondary
        node.y = primary
      } else {
        node.x = primary
        node.y = secondary
      }
    })
  })
  return next
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function edgeGeometry(edge, nodesById) {
  const from = nodesById.get(edge.from)
  const to = nodesById.get(edge.to)
  if (!from || !to) return null
  const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y)
  const start = horizontal
    ? {
        x: fromCenter.x + (Math.sign(toCenter.x - fromCenter.x || 1) * from.width) / 2,
        y: fromCenter.y,
      }
    : {
        x: fromCenter.x,
        y: fromCenter.y + (Math.sign(toCenter.y - fromCenter.y || 1) * from.height) / 2,
      }
  const end = horizontal
    ? { x: toCenter.x - (Math.sign(toCenter.x - fromCenter.x || 1) * to.width) / 2, y: toCenter.y }
    : { x: toCenter.x, y: toCenter.y - (Math.sign(toCenter.y - fromCenter.y || 1) * to.height) / 2 }
  if (horizontal) {
    const controlX = (start.x + end.x) / 2
    return {
      start,
      end,
      path: `M ${start.x} ${start.y} C ${controlX} ${start.y}, ${controlX} ${end.y}, ${end.x} ${end.y}`,
    }
  }
  const controlY = (start.y + end.y) / 2
  return {
    start,
    end,
    path: `M ${start.x} ${start.y} C ${start.x} ${controlY}, ${end.x} ${controlY}, ${end.x} ${end.y}`,
  }
}

export function renderDiagramSvg(document, options = {}) {
  const normalized = cloneDiagramDocument(document)
  const includeMetadata = options.includeMetadata !== false
  const interactive = options.interactive === true
  const selectedId = String(options.selectedId || "")
  const nodesById = new Map(normalized.nodes.map((node) => [node.id, node]))
  const metadata = includeMetadata
    ? `<metadata>${escapeXml(JSON.stringify({ schema_version: normalized.schema_version, title: normalized.title, assets: diagramAssetManifest(normalized) }))}</metadata>`
    : ""
  const defs = `<defs><filter id="icono-card-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#281b12" flood-opacity="0.18"/></filter><marker id="icono-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6d3729"/></marker><marker id="icono-inhibit" viewBox="0 0 10 12" refX="8" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path d="M 8 0 L 8 12" stroke="#6d3729" stroke-width="2.4"/></marker></defs>`
  const title = `<text x="54" y="54" fill="#2f241d" font-family="League Spartan, sans-serif" font-size="28" font-weight="800">${escapeXml(normalized.title)}</text>`
  const edges = normalized.edges
    .map((edge) => {
      const geometry = edgeGeometry(edge, nodesById)
      if (!geometry) return ""
      const marker =
        edge.kind === "inhibition"
          ? "url(#icono-inhibit)"
          : edge.kind === "association"
            ? ""
            : "url(#icono-arrow)"
      const dash = edge.kind === "association" ? ' stroke-dasharray="8 7"' : ""
      const selected = edge.id === selectedId
      const labelX = (geometry.start.x + geometry.end.x) / 2
      const labelY = (geometry.start.y + geometry.end.y) / 2 - 9
      return `<g data-diagram-edge="${escapeXml(edge.id)}"${interactive ? ' role="button" tabindex="0"' : ""} aria-label="${escapeXml(`${edge.kind} relationship${edge.label ? `: ${edge.label}` : ""}`)}">${interactive ? `<path class="icono-diagram-edge-hit" d="${geometry.path}" fill="none" stroke="transparent" stroke-width="24" vector-effect="non-scaling-stroke" pointer-events="stroke"/>` : ""}<path class="icono-diagram-edge-line" d="${geometry.path}" fill="none" stroke="${selected ? "#b94b34" : "#6d3729"}" stroke-width="${selected ? 5 : 3}" stroke-linecap="round" pointer-events="none"${dash}${marker ? ` marker-end="${marker}"` : ""}/>${edge.label ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#4b3b30" font-family="IBM Plex Mono, monospace" font-size="15" paint-order="stroke" stroke="${normalized.background}" stroke-width="7" stroke-linejoin="round">${escapeXml(edge.label)}</text>` : ""}</g>`
    })
    .join("")
  const nodes = normalized.nodes
    .map((node) => {
      const imageUrl = node.asset.immutable_url || node.asset.canonical_url
      const selected = node.id === selectedId
      const ports = interactive
        ? `<g class="icono-diagram-ports" aria-hidden="true">${[
            ["north", node.width / 2, 0],
            ["east", node.width, node.height / 2],
            ["south", node.width / 2, node.height],
            ["west", 0, node.height / 2],
          ]
            .map(
              ([side, x, y]) =>
                `<g data-diagram-port="${side}" data-diagram-connect-from="${escapeXml(node.id)}" transform="translate(${x} ${y})"><circle class="icono-diagram-port-hit" r="22"/><circle class="icono-diagram-port-dot" r="8"/></g>`,
            )
            .join("")}</g>`
        : ""
      return `<g data-diagram-node="${escapeXml(node.id)}" transform="translate(${node.x} ${node.y})"${interactive ? ' role="button" tabindex="0"' : ""} aria-label="${escapeXml(`${node.symbol} gene character`)}"><rect class="icono-diagram-node-frame" x="${selected ? -5 : 0}" y="${selected ? -5 : 0}" width="${node.width + (selected ? 10 : 0)}" height="${node.height + (selected ? 10 : 0)}" rx="8" fill="#eadfcd" stroke="${selected ? "#b94b34" : "#6d5140"}" stroke-width="${selected ? 4 : 1.5}" filter="url(#icono-card-shadow)"/>${imageUrl ? `<image href="${escapeXml(imageUrl)}" x="0" y="0" width="${node.width}" height="${node.height}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="0" y="0" width="${node.width}" height="${node.height}" rx="7" fill="#ded2bd"/><text x="${node.width / 2}" y="${node.height / 2}" text-anchor="middle" fill="#59483b" font-family="IBM Plex Mono, monospace" font-size="18">${escapeXml(node.symbol)}</text>`}${ports}</g>`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${normalized.width} ${normalized.height}" width="${normalized.width}" height="${normalized.height}" role="img" aria-labelledby="icono-diagram-title"><title id="icono-diagram-title">${escapeXml(normalized.title)}</title>${metadata}${defs}<rect width="100%" height="100%" fill="${escapeXml(normalized.background)}"/>${title}<g data-diagram-edges>${edges}</g><g data-diagram-nodes>${nodes}</g><text x="${normalized.width - 30}" y="${normalized.height - 24}" text-anchor="end" fill="#725e4e" font-family="IBM Plex Mono, monospace" font-size="12">ICONOPLASM · CC0 GENE CHARACTERS</text></svg>`
}

export function diagramAssetManifest(document) {
  const normalized = cloneDiagramDocument(document)
  return normalized.nodes.map((node) => ({
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
