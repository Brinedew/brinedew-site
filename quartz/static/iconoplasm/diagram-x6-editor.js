import {
  COMPARTMENT_SHAPES,
  diagramReferences,
  isDarkColour,
  pageBackgroundColour,
  relationshipKind,
} from "./diagram-document.js?v=189a4fd320f16b65"

const X6_RUNTIME_URL = "./generated/x6-runtime.js?v=c9928004bc8e7440"
const GENE_SHAPE = "iconoplasm-gene"
const TEXT_SHAPE = "iconoplasm-text"
const MOLECULE_SHAPE = "iconoplasm-molecule"
const SQUARE_END_CONNECTOR = "iconoplasm-square-end"
const PAGE_SHAPE = "iconoplasm-page"
const PAGE_ID = "iconoplasm-page"
const PORT_IDS = ["top", "right", "bottom", "left"]
const INK = "#20120b"
// Default ink on a dark sheet (B-1050: the page takes any colour).
const LIGHT_INK = "#f1e9de"
const MIN_SCALE = 0.1
const MAX_SCALE = 4
const TEAL = "#1b7269"
const RUST = "#a24834"
const NOTE_FILL = "#f3e3b5"
const PAPER_FILL = "#fbf7f1"
const GRAIN_URL = new URL("./studio/paper-grain.jpg", import.meta.url).href
const FONT_URLS = {
  "IBM Plex Sans": [
    [400, new URL("./studio/IBMPlexSans-400.woff2", import.meta.url).href],
    [600, new URL("./studio/IBMPlexSans-600.woff2", import.meta.url).href],
  ],
}
const UI_FONT = '"IBM Plex Sans", "Segoe UI", sans-serif'
const SYMBOL_FONT = '"League Spartan", "Bahnschrift", sans-serif'

// Quartz's base stylesheet sets `fill` on every SVG <text> element, and any
// stylesheet beats an SVG fill attribute, so on the real site every label
// took the page's body colour. Text paint therefore goes in an inline style.
function textFill(colour) {
  return { fill: colour, style: { fill: colour } }
}

function inkFor(document) {
  return isDarkColour(pageBackgroundColour(document)) ? LIGHT_INK : INK
}

function tint(hex, alpha) {
  const value = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : TEAL
  const channel = (offset) => parseInt(value.slice(offset, offset + 2), 16)
  return `rgba(${channel(1)},${channel(3)},${channel(5)},${alpha})`
}

// B-1050: the snap step follows the zoom, so a dragged portrait lands on the
// lines the reader actually sees (10 units at 49% zoom is five screen pixels,
// which looked like no snapping at all).
function gridStepFor(scale) {
  if (scale >= 0.75) return 10
  if (scale >= 0.4) return 20
  return 40
}

// The side of a box a boundary point lies on, as the outward unit normal. An
// ellipse (a molecule) uses the normal of the ellipse at that point.
function endNormal(box, point, round) {
  if (round) {
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const rx = Math.max(1, box.width / 2)
    const ry = Math.max(1, box.height / 2)
    const nx = (point.x - cx) / (rx * rx)
    const ny = (point.y - cy) / (ry * ry)
    const length = Math.hypot(nx, ny) || 1
    return { x: nx / length, y: ny / length }
  }
  const sides = [
    [Math.abs(point.y - box.y), { x: 0, y: -1 }],
    [Math.abs(point.y - (box.y + box.height)), { x: 0, y: 1 }],
    [Math.abs(point.x - box.x), { x: -1, y: 0 }],
    [Math.abs(point.x - (box.x + box.width)), { x: 1, y: 0 }],
  ]
  sides.sort((left, right) => left[0] - right[0])
  return sides[0][1]
}

// B-1050: a line drawn "square" bends its last stretch so it meets the target
// perpendicular to the side it hits. KEGG's T-bar then lies flat against the
// portrait instead of tilting with the stem (the owner's "parallel to portrait
// edge, curving at the end"). Waypoints are kept; only the arrival bends.
function squareEndConnector(sourcePoint, targetPoint, routePoints = []) {
  const cell = this?.targetView?.cell
  const box = cell?.getBBox?.()
  let d = `M ${sourcePoint.x} ${sourcePoint.y}`
  for (const point of routePoints) d += ` L ${point.x} ${point.y}`
  const previous = routePoints.length ? routePoints[routePoints.length - 1] : sourcePoint
  const distance = Math.hypot(targetPoint.x - previous.x, targetPoint.y - previous.y)
  if (!box || distance < 2) return `${d} L ${targetPoint.x} ${targetPoint.y}`
  const normal = endNormal(box, targetPoint, cell.getData?.()?.itemType === "molecule")
  const reach = Math.min(40, distance / 2)
  const control = { x: targetPoint.x + normal.x * reach, y: targetPoint.y + normal.y * reach }
  return `${d} Q ${control.x} ${control.y} ${targetPoint.x} ${targetPoint.y}`
}

let runtimePromise = null
let shapesRegistered = false
let edgeCounter = 0
let instanceCounter = 0

function loadRuntime() {
  runtimePromise ||= import(X6_RUNTIME_URL)
  return runtimePromise
}

function edgeId() {
  edgeCounter += 1
  return `edge-${Date.now().toString(36)}-${edgeCounter}`
}

function compartmentShape(id) {
  return `iconoplasm-compartment-${id}`
}

// Each compartment is its own registered shape because the SVG elements
// differ (a band, an ellipse, stacked membranes). Paths use refD, which X6
// scales to the node box, so resizing never distorts the line weight.
const COMPARTMENT_MARKUP = {
  membrane: {
    markup: ["body", "top", "bottom", "label"],
    attrs: {
      body: { refWidth: "100%", refHeight: "100%", fill: "#ece3d3", stroke: "none" },
      top: { refWidth: "100%", height: 3, fill: "#c9b99d", stroke: "none" },
      bottom: { refWidth: "100%", height: 3, refY: "100%", y: -3, fill: "#c9b99d", stroke: "none" },
      // Receptors sit on the left of a membrane band, so its name goes right.
      label: {
        textAnchor: "end",
        refX: "100%",
        refX2: -14,
        refY: "50%",
        textVerticalAnchor: "middle",
        fill: "#7a5a3e",
      },
    },
  },
  cytoplasm: {
    markup: ["body", "label"],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        rx: 22,
        ry: 22,
        fill: "rgba(32,18,11,0.025)",
        stroke: "rgba(32,18,11,0.45)",
        strokeWidth: 1.5,
      },
      label: {
        textAnchor: "start",
        refX: 18,
        refY: 14,
        textVerticalAnchor: "top",
        fill: "#7a5a3e",
      },
    },
  },
  nucleus: {
    markup: [["ellipse", "body"], "label"],
    attrs: {
      body: {
        refCx: "50%",
        refCy: "50%",
        refRx: "50%",
        refRy: "50%",
        fill: "rgba(27,114,105,0.07)",
        stroke: "rgba(27,114,105,0.55)",
        strokeWidth: 1.5,
      },
      // Relationships usually enter a nucleus from above, so its name sits at
      // the lower edge, clear of incoming lines and their KEGG tags.
      label: {
        refX: "50%",
        refY: "100%",
        refY2: -14,
        textAnchor: "middle",
        textVerticalAnchor: "bottom",
        fill: TEAL,
      },
    },
  },
  mitochondrion: {
    markup: [["ellipse", "body"], ["path", "detail"], "label"],
    attrs: {
      body: {
        refCx: "50%",
        refCy: "50%",
        refRx: "50%",
        refRy: "50%",
        fill: "#fbebe2",
        stroke: "#cf9b7f",
        strokeWidth: 1.5,
      },
      detail: {
        refD: "M 10 50 C 18 20 24 80 32 50 S 46 20 54 50 S 68 80 76 50 S 86 22 92 50",
        fill: "none",
        stroke: "#cf9b7f",
        strokeWidth: 1.4,
        vectorEffect: "non-scaling-stroke",
      },
      label: {
        refX: "50%",
        refY: "100%",
        refY2: 8,
        textAnchor: "middle",
        textVerticalAnchor: "top",
        fill: "#9a6248",
      },
    },
  },
  er: {
    markup: [["path", "body"], "label"],
    attrs: {
      body: {
        refD: "M 0 12 C 25 2 75 22 100 12 M 0 37 C 25 27 75 47 100 37 M 0 62 C 25 52 75 72 100 62 M 0 87 C 25 77 75 97 100 87",
        fill: "none",
        stroke: "#9fb096",
        strokeWidth: 2.5,
        vectorEffect: "non-scaling-stroke",
      },
      label: {
        refX: "50%",
        refY: "100%",
        refY2: 8,
        textAnchor: "middle",
        textVerticalAnchor: "top",
        fill: "#5f7356",
      },
    },
  },
  faction: {
    markup: ["body", "label"],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        rx: 16,
        ry: 16,
        fill: tint(TEAL, 0.07),
        stroke: tint(TEAL, 0.85),
        strokeWidth: 2.5,
      },
      label: {
        textAnchor: "middle",
        refX: "50%",
        refY: 16,
        textVerticalAnchor: "top",
        fontSize: 15,
        fill: TEAL,
      },
    },
  },
  complex: {
    markup: ["body", "label"],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        rx: 4,
        ry: 4,
        fill: "none",
        stroke: "rgba(32,18,11,0.55)",
        strokeWidth: 1.2,
        strokeDasharray: "5 3",
      },
      label: {
        textAnchor: "start",
        refX: 10,
        refY: 8,
        textVerticalAnchor: "top",
        fill: "#5a4636",
      },
    },
  },
}

function markupItem(item) {
  const [tagName, selector] = Array.isArray(item)
    ? item
    : [item === "label" ? "text" : "rect", item]
  return { tagName, selector }
}

function portGroups() {
  return Object.fromEntries(
    PORT_IDS.map((position) => [
      position,
      {
        position,
        attrs: {
          circle: {
            class: "icono-x6-port-body",
            r: 5,
            magnet: true,
            stroke: "#fbf7f1",
            strokeWidth: 2,
            fill: TEAL,
          },
        },
      },
    ]),
  )
}

function registerShapes(Graph) {
  if (shapesRegistered) return
  Graph.registerNode(
    PAGE_SHAPE,
    {
      inherit: "rect",
      markup: [
        { tagName: "rect", selector: "sheet" },
        { tagName: "rect", selector: "grain" },
        { tagName: "rect", selector: "grid" },
      ],
      attrs: {
        sheet: { refWidth: "100%", refHeight: "100%", fill: PAPER_FILL, stroke: "none" },
        grain: { refWidth: "100%", refHeight: "100%", opacity: 0.45, stroke: "none" },
        grid: { refWidth: "100%", refHeight: "100%", stroke: "none" },
      },
    },
    true,
  )
  Graph.registerNode(
    GENE_SHAPE,
    {
      inherit: "rect",
      width: 132,
      height: 176,
      markup: [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "fallback" },
        { tagName: "image", selector: "portrait" },
        { tagName: "rect", selector: "frame" },
      ],
      attrs: {
        body: { refWidth: "100%", refHeight: "100%", fill: "#2a1d15", stroke: "none" },
        // B-1045: the symbol sits under the portrait, so a node that is still
        // loading (or whose image failed) reads as the gene, never as a blank box.
        fallback: {
          refX: "50%",
          refY: "50%",
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          fontFamily: SYMBOL_FONT,
          fontWeight: 800,
          fontSize: 20,
          ...textFill("#efe6d9"),
        },
        portrait: {
          refWidth: "100%",
          refHeight: "100%",
          preserveAspectRatio: "xMidYMid slice",
        },
        frame: {
          refWidth: "100%",
          refHeight: "100%",
          fill: "none",
          stroke: "rgba(32,18,11,0.35)",
          strokeWidth: 1,
        },
      },
      ports: { groups: portGroups(), items: PORT_IDS.map((group) => ({ id: group, group })) },
    },
    true,
  )
  Graph.registerNode(
    TEXT_SHAPE,
    {
      inherit: "rect",
      width: 260,
      height: 88,
      attrs: {
        body: { fill: "transparent", stroke: "transparent", rx: 2, ry: 2 },
        label: {
          fontFamily: UI_FONT,
          fontSize: 18,
          ...textFill(INK),
          textWrap: { width: -16, height: -12, ellipsis: true },
          textAnchor: "start",
          refX: 8,
          refY: 6,
          textVerticalAnchor: "top",
        },
      },
    },
    true,
  )
  Graph.registerNode(
    MOLECULE_SHAPE,
    {
      inherit: "rect",
      width: 150,
      height: 72,
      markup: [
        { tagName: "ellipse", selector: "body" },
        { tagName: "text", selector: "label" },
      ],
      attrs: {
        body: {
          refCx: "50%",
          refCy: "50%",
          refRx: "50%",
          refRy: "50%",
          fill: "#fbf7f1",
          stroke: INK,
          strokeWidth: 1.5,
        },
        label: {
          refX: "50%",
          refY: "50%",
          textAnchor: "middle",
          textVerticalAnchor: "middle",
          fontFamily: UI_FONT,
          fontWeight: 600,
          fontSize: 16,
          textWrap: { width: -18, height: -8, ellipsis: true },
          ...textFill(INK),
        },
      },
      ports: { groups: portGroups(), items: PORT_IDS.map((group) => ({ id: group, group })) },
    },
    true,
  )
  Graph.registerConnector(SQUARE_END_CONNECTOR, squareEndConnector, true)
  for (const shape of COMPARTMENT_SHAPES) {
    const spec = COMPARTMENT_MARKUP[shape.id]
    Graph.registerNode(
      compartmentShape(shape.id),
      {
        inherit: "rect",
        width: shape.width,
        height: shape.height,
        markup: spec.markup.map(markupItem),
        attrs: {
          ...spec.attrs,
          label: {
            fontFamily: UI_FONT,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1.3,
            ...spec.attrs.label,
            ...textFill(spec.attrs.label.fill),
          },
        },
      },
      true,
    )
  }
  shapesRegistered = true
}

function edgeColour(edge, ink = INK) {
  return edge.color || (relationshipKind(edge.kind).head === "bar" ? RUST : ink)
}

// Empty follows the kind: a T-bar meets the portrait square, an arrow keeps
// its angle.
function squareEnd(edge) {
  if (edge.end === "square") return true
  if (edge.end === "free") return false
  return relationshipKind(edge.kind).head === "bar"
}

function dashFor(edge) {
  const pattern = edge.pattern || (relationshipKind(edge.kind).dashed ? "dashed" : "solid")
  const width = edge.width || 1.5
  if (pattern === "dashed") return `${Math.max(4, width * 4)} ${Math.max(3, width * 2.5)}`
  if (pattern === "dotted") return `0.1 ${Math.max(3, width * 2.4)}`
  return ""
}

function markerFor(edge, ink) {
  const kind = relationshipKind(edge.kind)
  const colour = edgeColour(edge, ink)
  const size = edge.head_size || 8
  if (kind.head === "bar") {
    return {
      tagName: "path",
      d: `M 0 ${-size} L 0 ${size}`,
      fill: "none",
      stroke: colour,
      strokeWidth: Math.max(2, (edge.width || 1.5) * 1.4),
      strokeOpacity: edge.opacity,
    }
  }
  if (kind.head === "arrow") {
    return {
      name: "block",
      width: size * 1.25,
      height: size,
      fill: colour,
      stroke: colour,
      strokeWidth: 1,
      fillOpacity: edge.opacity,
      strokeOpacity: edge.opacity,
    }
  }
  return null
}

// Edits write these with `overwrite: true` so stale keys (a dash, a marker)
// go away, which also replaces X6's own `lines` group. Without its
// `connection` flag X6 stops writing the path, and the line freezes where it
// is while its portraits move on.
function edgeAttrs(edge, selected = false, ink = INK) {
  const width = edge.width || 1.5
  return {
    lines: { connection: true, strokeLinejoin: "round" },
    wrap: {
      stroke: selected ? "rgba(27,114,105,0.24)" : "transparent",
      strokeWidth: Math.max(10, width + 9),
      strokeLinecap: "round",
    },
    line: {
      stroke: edgeColour(edge, ink),
      strokeWidth: width,
      strokeOpacity: edge.opacity ?? 1,
      strokeLinecap: dashFor(edge).startsWith("0.1") ? "round" : "butt",
      strokeLinejoin: "round",
      strokeDasharray: dashFor(edge),
      targetMarker: markerFor(edge, ink),
    },
  }
}

function labelOffset(edge, hasTag) {
  const lift = edge.label_size * 0.7 + 7 + (hasTag ? 14 : 0)
  if (edge.label_position === "on") return 0
  return edge.label_position === "below" ? lift : -lift
}

function textLabel(text, attrs, position) {
  return {
    markup: [{ tagName: "text", selector: "label" }],
    attrs: {
      label: {
        text,
        textAnchor: "middle",
        textVerticalAnchor: "middle",
        fontFamily: UI_FONT,
        paintOrder: "stroke",
        strokeLinejoin: "round",
        pointerEvents: "none",
        ...attrs,
        ...textFill(attrs.fill),
      },
    },
    position,
  }
}

function glyphLabel(d, colour, distance, width) {
  return {
    markup: [{ tagName: "path", selector: "glyph" }],
    attrs: {
      glyph: {
        d,
        fill: "none",
        stroke: colour,
        strokeWidth: Math.max(1.5, width),
        pointerEvents: "none",
      },
    },
    position: { distance, options: { keepGradient: true } },
  }
}

// KEGG prints modification tags (+p, -u, e) above the middle of the line,
// a tick across a dissociation and a slash across a missing interaction.
function edgeLabels(edge, background, ink = INK) {
  const kind = relationshipKind(edge.kind)
  const colour = edgeColour(edge, ink)
  const labels = []
  if (kind.tag) {
    labels.push(
      textLabel(
        kind.tag,
        {
          fill: colour,
          fontSize: 12,
          fontWeight: 600,
          stroke: background,
          strokeWidth: 4,
          fillOpacity: edge.opacity,
        },
        { distance: 0.5, offset: -10 },
      ),
    )
  }
  if (kind.tick) labels.push(glyphLabel("M 0 -7 L 0 7", colour, 0.5, edge.width))
  if (kind.slash) labels.push(glyphLabel("M -5 8 L 5 -8", colour, 0.62, edge.width))
  if (edge.label) {
    labels.push(
      textLabel(
        edge.label,
        {
          fill: edge.color || ink,
          fontSize: edge.label_size,
          fontWeight: 500,
          stroke: edge.label_background ? background : "none",
          strokeWidth: edge.label_background ? 6 : 0,
          fillOpacity: edge.opacity,
        },
        { distance: 0.5, offset: labelOffset(edge, Boolean(kind.tag)) },
      ),
    )
  }
  return labels
}

function routerFor(edge) {
  return edge.routing === "orthogonal"
    ? { name: "orth", args: { padding: 14 } }
    : { name: "normal" }
}

function connectorFor(edge) {
  if (edge.routing === "curved") return { name: "smooth" }
  if (edge.jumps && edge.jumps !== "none")
    return { name: "jumpover", args: { type: edge.jumps, size: 5 } }
  if (edge.routing === "orthogonal") return { name: "rounded", args: { radius: 8 } }
  return squareEnd(edge) ? { name: SQUARE_END_CONNECTOR } : { name: "normal" }
}

function moleculeAttrs(node, ink = INK) {
  const colour = node.color || ink
  return {
    body: {
      stroke: colour,
      fill: node.color
        ? tint(node.color, 0.12)
        : ink === INK
          ? "#fbf7f1"
          : "rgba(241,233,222,0.08)",
    },
    label: { text: node.label, fontSize: node.font_size || 16, ...textFill(colour) },
  }
}

function textAttrs(node, ink = INK) {
  const fill = node.fill === "note" ? NOTE_FILL : node.fill === "paper" ? PAPER_FILL : "transparent"
  return {
    body: {
      fill,
      stroke: node.fill === "none" ? "transparent" : "rgba(32,18,11,0.18)",
      filter: node.fill === "note" ? "drop-shadow(0 2px 3px rgba(53,38,27,0.18))" : "none",
    },
    label: {
      text: node.text,
      fontSize: node.font_size,
      fontWeight: node.bold ? 600 : 400,
      fontStyle: node.italic ? "italic" : "normal",
      ...textFill(node.color || ink),
      textAnchor: node.align === "center" ? "middle" : node.align === "right" ? "end" : "start",
      refX: node.align === "center" ? "50%" : node.align === "right" ? "100%" : 8,
      refX2: node.align === "right" ? -8 : 0,
    },
  }
}

function compartmentAttrs(node) {
  const attrs = { label: { text: String(node.label || "").toUpperCase() } }
  if (node.shape === "faction") {
    const colour = node.color || TEAL
    attrs.body = { stroke: tint(colour, 0.85), fill: tint(colour, 0.07) }
    Object.assign(attrs.label, textFill(colour))
    return attrs
  }
  if (node.color) {
    attrs.body = { stroke: node.color }
    if (node.shape === "membrane") {
      attrs.top = { fill: node.color }
      attrs.bottom = { fill: node.color }
    }
    if (node.shape === "mitochondrion") attrs.detail = { stroke: node.color }
    Object.assign(attrs.label, textFill(node.color))
  }
  return attrs
}

function graphNodes(document, gridVisible, defsIds) {
  const ink = inkFor(document)
  const page = {
    id: PAGE_ID,
    shape: PAGE_SHAPE,
    x: 0,
    y: 0,
    width: document.width,
    height: document.height,
    zIndex: -1000,
    attrs: {
      sheet: { fill: pageBackgroundColour(document) },
      grain: { fill: `url(#${defsIds.grain})` },
      grid: { fill: `url(#${defsIds.grid})`, visibility: gridVisible ? "visible" : "hidden" },
    },
    data: { itemType: "page" },
  }
  const nodes = document.nodes.map((node, index) => {
    const base = {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      zIndex: node.type === "compartment" ? index + 1 : 2000 + index,
      data: { ...node, itemType: node.type },
    }
    if (node.type === "text") return { ...base, shape: TEXT_SHAPE, attrs: textAttrs(node, ink) }
    if (node.type === "molecule")
      return { ...base, shape: MOLECULE_SHAPE, attrs: moleculeAttrs(node, ink) }
    if (node.type === "compartment")
      return { ...base, shape: compartmentShape(node.shape), attrs: compartmentAttrs(node) }
    // B-846: cdn_url serves the same immutable bytes without a Worker request,
    // so a shared or embedded diagram costs Iconoplasm nothing per view.
    const imageUrl = node.asset.cdn_url || node.asset.immutable_url || node.asset.canonical_url
    return {
      ...base,
      shape: GENE_SHAPE,
      attrs: {
        fallback: { text: node.symbol, fontSize: Math.max(12, Math.round(node.width / 6.5)) },
        portrait: { xlinkHref: imageUrl, href: imageUrl },
      },
    }
  })
  return [page, ...nodes]
}

function graphEdge(edge, background, ink = INK) {
  return {
    id: edge.id,
    shape: "edge",
    source: { cell: edge.from },
    target: { cell: edge.to },
    vertices: edge.vertices || [],
    router: routerFor(edge),
    connector: connectorFor(edge),
    attrs: edgeAttrs(edge, false, ink),
    labels: edgeLabels(edge, background, ink),
    zIndex: 1000,
    data: { ...edge, itemType: "relationship" },
  }
}

function documentFromGraph(graph, baseDocument) {
  const nodes = graph
    .getNodes()
    .filter((cell) => cell.getData()?.itemType !== "page")
    .sort((left, right) => (left.getZIndex() || 0) - (right.getZIndex() || 0))
    .map((cell) => {
      const { itemType, ...data } = cell.getData() || {}
      const position = cell.getPosition()
      const size = cell.getSize()
      return {
        ...data,
        id: cell.id,
        type: itemType,
        x: Math.round(position.x),
        y: Math.round(position.y),
        width: Math.round(size.width),
        height: Math.round(size.height),
      }
    })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph
    .getEdges()
    .map((cell) => {
      const source = cell.getSourceCellId()
      const target = cell.getTargetCellId()
      const { itemType, ...data } = cell.getData() || {}
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null
      return {
        ...data,
        id: cell.id,
        type: "relationship",
        from: source,
        to: target,
        vertices: cell.getVertices().map((point) => ({ x: point.x, y: point.y })),
      }
    })
    .filter(Boolean)
  return { ...baseDocument, nodes, edges }
}

function svgElement(tagName, attributes, parent) {
  const element = window.document.createElementNS("http://www.w3.org/2000/svg", tagName)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  parent?.append(element)
  return element
}

function installPatterns(graph, ids, gridSize, ink = INK) {
  const line = ink === INK ? "27,114,105" : "241,233,222"
  const defs = graph.view.defs
  defs.querySelector(`#${ids.grid}`)?.remove()
  defs.querySelector(`#${ids.grain}`)?.remove()
  const grid = svgElement(
    "pattern",
    { id: ids.grid, width: gridSize * 5, height: gridSize * 5, patternUnits: "userSpaceOnUse" },
    defs,
  )
  const minor = Array.from({ length: 5 }, (_, step) => step * gridSize)
  svgElement(
    "path",
    {
      d: minor.map((at) => `M ${at} 0 V ${gridSize * 5} M 0 ${at} H ${gridSize * 5}`).join(" "),
      fill: "none",
      stroke: `rgba(${line},0.11)`,
      "stroke-width": 1,
    },
    grid,
  )
  svgElement(
    "path",
    {
      d: `M 0 0 V ${gridSize * 5} M 0 0 H ${gridSize * 5}`,
      fill: "none",
      stroke: `rgba(${line},0.22)`,
      "stroke-width": 1,
    },
    grid,
  )
  const grain = svgElement(
    "pattern",
    { id: ids.grain, width: 512, height: 512, patternUnits: "userSpaceOnUse" },
    defs,
  )
  const image = svgElement(
    "image",
    { width: 512, height: 512, preserveAspectRatio: "none", style: "mix-blend-mode:multiply" },
    grain,
  )
  image.setAttribute("href", GRAIN_URL)
}

let embeddedFontsPromise = null

// A PNG is drawn from the SVG inside an <img>, which cannot see the page's
// web fonts, so the export embeds the two Plex Sans weights it uses.
function embeddedFontCss() {
  embeddedFontsPromise ||= Promise.all(
    Object.entries(FONT_URLS).flatMap(([family, weights]) =>
      weights.map(async ([weight, url]) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
        let binary = ""
        for (let index = 0; index < bytes.length; index += 0x8000)
          binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
        return `@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${btoa(binary)}) format("woff2")}`
      }),
    ),
  )
    .then((faces) => faces.join(""))
    .catch(() => {
      embeddedFontsPromise = null
      return ""
    })
  return embeddedFontsPromise
}

export async function createDiagramEditor({
  container,
  document,
  onChange,
  onSelect,
  onView,
  onPointer,
  onHover,
  gridVisible = true,
  snap = true,
  sizeHost = null,
}) {
  const runtime = await loadRuntime()
  // The studio keeps the one undo history (document snapshots) and the
  // keyboard shortcuts, so X6's History and Keyboard plugins stay unused.
  const { Export, Graph, Selection, Snapline, Transform } = runtime
  registerShapes(Graph)

  instanceCounter += 1
  const defsIds = { grid: `icono-grid-${instanceCounter}`, grain: `icono-grain-${instanceCounter}` }
  let baseDocument = document
  let applyingDocument = false
  let activeRelationshipKind = "activation"
  let showGrid = gridVisible
  let snapping = snap

  const isPage = (cell) => cell?.getData?.()?.itemType === "page"
  const itemType = (cell) => cell?.getData?.()?.itemType
  // Genes and molecules are what a relationship joins.
  const isActor = (cell) => itemType(cell) === "gene" || itemType(cell) === "molecule"

  const graph = new Graph({
    container,
    width: Math.max(1, container.clientWidth || document.width),
    height: Math.max(1, container.clientHeight || document.height),
    background: false,
    // Synchronous rendering: an export or a test never races a half-drawn page.
    async: false,
    grid: { size: snap ? 10 : 1, visible: false },
    // B-1050: the wheel is handled below (X6's own wheel panning never moved
    // the view, so the page scrolled instead).
    panning: { enabled: true, eventTypes: ["leftMouseDown", "rightMouseDown"] },
    mousewheel: { enabled: false },
    interacting: {
      nodeMovable: (view) => !isPage(view.cell),
      edgeLabelMovable: false,
    },
    connecting: {
      allowBlank: false,
      allowEdge: false,
      allowLoop: false,
      allowMulti: true,
      allowNode: false,
      highlight: true,
      snap: { radius: 40 },
      anchor: "center",
      connectionPoint: { name: "boundary", args: { offset: 3 } },
      router: { name: "normal" },
      connector: { name: "normal" },
      validateConnection({ sourceCell, targetCell, sourcePort, targetPort }) {
        return Boolean(
          sourceCell &&
          targetCell &&
          sourceCell.id !== targetCell.id &&
          isActor(sourceCell) &&
          isActor(targetCell) &&
          sourcePort &&
          targetPort,
        )
      },
      createEdge() {
        return graph.createEdge({ id: edgeId(), shape: "edge", zIndex: 1000 })
      },
    },
    highlighting: {
      magnetAdsorbed: {
        name: "stroke",
        args: { attrs: { fill: "#fbf7f1", stroke: TEAL, strokeWidth: 3 } },
      },
    },
  })

  const selection = new Selection({
    enabled: true,
    rubberband: true,
    multiple: true,
    movable: true,
    pointerEvents: "none",
    showNodeSelectionBox: true,
    showEdgeSelectionBox: false,
    filter: (cell) => !isPage(cell),
  })
  graph.use(selection)
  const snapline = new Snapline({ enabled: snap, sharp: true, tolerance: 8 })
  graph.use(snapline)
  graph.use(
    new Transform({
      rotating: false,
      resizing: {
        enabled: (node) => !isPage(node),
        minWidth: (node) => (itemType(node) === "gene" ? 72 : itemType(node) === "text" ? 60 : 40),
        minHeight: (node) => (itemType(node) === "gene" ? 96 : itemType(node) === "text" ? 28 : 24),
        maxWidth: (node) =>
          itemType(node) === "gene" ? 240 : itemType(node) === "text" ? 900 : 4000,
        maxHeight: (node) =>
          itemType(node) === "gene" ? 320 : itemType(node) === "text" ? 500 : 4000,
        preserveAspectRatio: (node) => itemType(node) === "gene",
        orthogonal: true,
        restrict: false,
      },
    }),
  )
  graph.use(new Export())
  let gridStep = 10
  installPatterns(graph, defsIds, gridStep, inkFor(baseDocument))

  function syncGridStep() {
    const step = gridStepFor(graph.zoom())
    if (step === gridStep) return
    gridStep = step
    if (snapping) graph.setGridSize(step)
    installPatterns(graph, defsIds, step, inkFor(baseDocument))
  }

  // B-1050: wheel pans (Shift+wheel sideways), Ctrl or Cmd+wheel and a
  // trackpad pinch zoom about the pointer, as in draw.io and Figma. The event
  // never reaches the page, so the window no longer scrolls under the canvas.
  container.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault()
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? container.clientHeight || 600 : 1
      const dx = event.deltaX * unit
      const dy = event.deltaY * unit
      const { tx, ty } = graph.translate()
      if (event.ctrlKey || event.metaKey) {
        const scale = graph.zoom()
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * Math.exp(-dy * 0.0015)))
        if (next === scale) return
        const rect = container.getBoundingClientRect()
        const px = event.clientX - rect.left
        const py = event.clientY - rect.top
        const lx = (px - tx) / scale
        const ly = (py - ty) / scale
        graph.scale(next, next)
        graph.translate(px - lx * next, py - ly * next)
        return
      }
      const sideways = event.shiftKey && !dx
      graph.translate(tx - (sideways ? dy : dx), ty - (sideways ? 0 : dy))
    },
    { passive: false },
  )

  const emitChange = () => {
    if (applyingDocument) return
    const next = documentFromGraph(graph, baseDocument)
    baseDocument = next
    onChange?.(next)
  }

  const selectedEdgeIds = new Set()
  function decorateSelection(selectedCells) {
    for (const edge of graph.getEdges()) {
      const selected = selectedCells.includes(edge)
      const wasSelected = selectedEdgeIds.has(edge.id)
      if (selected !== wasSelected)
        edge.attr("wrap", edgeAttrs(edge.getData() || {}, selected).wrap, { silent: true })
      if (!selected) edge.removeTools()
    }
    selectedEdgeIds.clear()
    for (const cell of selectedCells) if (cell.isEdge()) selectedEdgeIds.add(cell.id)
    const selectedEdge = selectedCells.length === 1 ? selectedCells[0] : null
    if (selectedEdge?.isEdge()) {
      const handles = { snapRadius: 12, attrs: { fill: TEAL, stroke: "#fbf7f1" } }
      // B-1050: draw.io's end handles, a small ring at each end you can drag
      // to another gene. X6's stock arrowhead tools drew two triangles that
      // read as extra arrowheads.
      const end = {
        tagName: "circle",
        attrs: { r: 5, fill: "#fbf7f1", stroke: TEAL, "stroke-width": 2, cursor: "move" },
      }
      selectedEdge.addTools([
        selectedEdge.getData()?.routing === "orthogonal"
          ? { name: "segments", args: handles }
          : { name: "vertices", args: handles },
        { name: "source-arrowhead", args: end },
        { name: "target-arrowhead", args: end },
      ])
    }
  }

  graph.on("selection:changed", ({ selected }) => {
    decorateSelection(selected)
    graph.clearTransformWidgets()
    const only = selected.length === 1 ? selected[0] : null
    if (only?.isNode() && !isPage(only)) graph.createTransformWidget(only)
    if (!applyingDocument) onSelect?.(selected.map((cell) => cell.id))
  })
  graph.on("node:moved", emitChange)
  graph.on("node:resized", emitChange)
  graph.on("node:removed", emitChange)
  graph.on("edge:connected", ({ edge, isNew }) => {
    // Dragging an existing arrowhead to another gene keeps the relationship.
    if (!isNew) {
      emitChange()
      return
    }
    const data = {
      itemType: "relationship",
      kind: activeRelationshipKind,
      label: "",
      color: "",
      width: 1.5,
      pattern: "",
      routing: "straight",
      jumps: "none",
      head_size: 8,
      opacity: 1,
      label_position: "above",
      label_size: 14,
      label_background: true,
      vertices: [],
      evidence: { reference: "", note: "" },
    }
    edge.setData(data, { overwrite: true })
    applyEdge(edge, data)
    emitChange()
    graph.cleanSelection()
    graph.select(edge)
  })
  graph.on("edge:removed", emitChange)
  graph.on("edge:change:vertices", () => {
    if (!applyingDocument) emitChange()
  })
  graph.on("blank:click", () => graph.cleanSelection())
  graph.on("cell:dblclick", ({ cell }) => {
    if (itemType(cell) === "text" || itemType(cell) === "relationship")
      onSelect?.([cell.id], { edit: true })
  })
  graph.on("node:mouseenter", ({ node }) => {
    if (itemType(node) === "gene") onHover?.(node.id)
  })
  graph.on("node:mouseleave", () => onHover?.(""))
  graph.on("scale", () => {
    syncGridStep()
    onView?.()
  })
  graph.on("translate", () => onView?.())
  graph.on("resize", () => onView?.())
  graph.on("node:change:position", () => onView?.())
  graph.on("edge:change:vertices", () => onView?.())
  container.addEventListener("pointermove", (event) => {
    const point = graph.clientToLocal(event.clientX, event.clientY)
    onPointer?.({ x: Math.round(point.x), y: Math.round(point.y) })
  })

  function selectedNodes() {
    return graph.getSelectedCells().filter((cell) => cell.isNode() && !isPage(cell))
  }

  function nudge(dx, dy) {
    const nodes = selectedNodes()
    if (!nodes.length) return
    for (const node of nodes) node.translate(dx, dy)
    emitChange()
  }

  function applyEdge(edge, data) {
    const ink = inkFor(baseDocument)
    edge.setRouter(routerFor(data))
    edge.setConnector(connectorFor(data))
    edge.attr(edgeAttrs(data, selectedEdgeIds.has(edge.id), ink), { overwrite: true })
    edge.setLabels(edgeLabels(data, pageBackgroundColour(baseDocument), ink))
  }

  // Only fields in the patch move or resize the cell: the data copy of x and
  // y goes stale as soon as someone drags the node.
  function applyNode(node, data, patch) {
    if (patch.x !== undefined || patch.y !== undefined) {
      const position = node.getPosition()
      node.position(patch.x ?? position.x, patch.y ?? position.y)
    }
    if (data.itemType !== "gene" && (patch.width !== undefined || patch.height !== undefined)) {
      const size = node.getSize()
      node.resize(patch.width ?? size.width, patch.height ?? size.height)
    }
    if (data.itemType === "text") node.setAttrs(textAttrs(data, inkFor(baseDocument)))
    if (data.itemType === "molecule") node.setAttrs(moleculeAttrs(data, inkFor(baseDocument)))
    if (data.itemType === "compartment") {
      node.setAttrs(compartmentAttrs(data))
      // The shape is the registered X6 shape; changing it means a new cell.
      if (node.shape !== compartmentShape(data.shape)) return false
    }
    if (data.itemType === "gene" && patch.width !== undefined) {
      node.attr("fallback/fontSize", Math.max(12, Math.round(patch.width / 6.5)))
      node.resize(patch.width, Math.round(patch.width * (4 / 3)))
    }
    return true
  }

  function fitDiagram() {
    if (!container.clientWidth || !container.clientHeight) return
    graph.zoomToRect(
      { x: -40, y: -40, width: baseDocument.width + 80, height: baseDocument.height + 80 },
      { maxScale: 1.5, minScale: 0.1 },
    )
  }

  function fitSelection() {
    const cells = graph.getSelectedCells()
    if (!cells.length) return fitDiagram()
    const box = graph.getCellsBBox(cells)
    if (box) graph.zoomToRect(box.inflate(60), { maxScale: 2, minScale: 0.1 })
  }

  // Reloading the graph keeps (or sets) the selection quietly and reports it
  // once, so the studio's panels render a single time per document.
  async function setDocument(nextDocument, { fit = false, select } = {}) {
    applyingDocument = true
    const sameSize =
      baseDocument.width === nextDocument.width && baseDocument.height === nextDocument.height
    baseDocument = nextDocument
    const selectedIds = Array.isArray(select)
      ? select
      : graph.getSelectedCells().map((cell) => cell.id)
    graph.cleanSelection()
    graph.clearTransformWidgets()
    selectedEdgeIds.clear()
    graph.clearCells({ silent: true })
    const background = pageBackgroundColour(nextDocument)
    const ink = inkFor(nextDocument)
    installPatterns(graph, defsIds, gridStep, ink)
    graph.fromJSON({
      nodes: graphNodes(nextDocument, showGrid, defsIds),
      edges: nextDocument.edges.map((edge) => graphEdge(edge, background, ink)),
    })
    const keep = selectedIds.map((id) => graph.getCellById(id)).filter(Boolean)
    if (keep.length) graph.select(keep)
    applyingDocument = false
    onSelect?.(keep.map((cell) => cell.id))
    if (fit || !sameSize) fitDiagram()
    onView?.()
  }

  await setDocument(document, { fit: true, select: [] })

  // X6 pins the container to inline pixel sizes, so watching the container
  // itself never sees a panel open or close. The studio passes the canvas
  // area as `sizeHost`; the graph fills it, less the container's ruler offset.
  function syncSize() {
    const host = sizeHost || container
    const width = Math.max(1, host.clientWidth - (sizeHost ? container.offsetLeft : 0))
    const height = Math.max(1, host.clientHeight - (sizeHost ? container.offsetTop : 0))
    if (width !== graph.options.width || height !== graph.options.height) {
      graph.resize(width, height)
      onView?.()
    }
  }
  const resizeObserver = new ResizeObserver(syncSize)
  resizeObserver.observe(sizeHost || container)
  syncSize()

  function exportOptions(stylesheet = "") {
    const snapshot = documentFromGraph(graph, baseDocument)
    const metadata = JSON.stringify({
      schema_version: snapshot.schema_version,
      title: snapshot.title,
      notation: "KEGG pathway notation",
      assets: snapshot.nodes
        .filter((node) => node.type === "gene")
        .map((node) => ({ node_id: node.id, symbol: node.symbol, ...node.asset })),
      references: diagramReferences(snapshot),
    })
    return {
      preserveDimensions: { width: snapshot.width, height: snapshot.height },
      viewBox: { x: 0, y: 0, width: snapshot.width, height: snapshot.height },
      copyStyles: false,
      stylesheet,
      beforeSerialize(svg) {
        // B-1050: X6 clones the live SVG with the viewport's on-screen zoom
        // and pan still on it, so every export came out scaled and shifted by
        // wherever the reader had left the view (a 2x PNG drew the page at
        // 0.89x in its top-left corner). The viewBox alone places the page.
        svg.querySelector(".x6-graph-svg-viewport")?.removeAttribute("transform")
        svg.querySelector(`[data-cell-id="${PAGE_ID}"]`)?.remove()
        svg.querySelector(`#${defsIds.grid}`)?.remove()
        svg.querySelector(`#${defsIds.grain}`)?.remove()
        // X6 inlines every portrait so the file opens offline (Illustrator,
        // Inkscape, a journal's system), but writes each one twice; keep one.
        for (const image of svg.querySelectorAll("image[href]")) {
          if (image.getAttribute("xlink:href")) image.removeAttribute("href")
        }
        for (const element of svg.querySelectorAll(
          ".x6-port, .x6-cell-tools, .x6-widget-transform, .x6-widget-selection",
        ))
          element.remove()
        const background = svgElement("rect", {
          width: snapshot.width,
          height: snapshot.height,
          fill: pageBackgroundColour(snapshot),
        })
        svg.insertBefore(background, svg.firstChild)
        const metadataNode = svgElement("metadata", {})
        metadataNode.textContent = metadata
        svg.insertBefore(metadataNode, background.nextSibling)
        const title = svgElement("title", {})
        title.textContent = snapshot.title
        svg.insertBefore(title, metadataNode.nextSibling)
        return svg
      },
    }
  }

  function downloadUrl(url, fileName) {
    const link = window.document.createElement("a")
    link.href = url
    link.download = fileName
    link.hidden = true
    window.document.body.append(link)
    link.click()
    link.remove()
  }

  function align(mode) {
    const nodes = selectedNodes()
    if (nodes.length < 2) return
    const boxes = nodes.map((node) => node.getBBox())
    const left = Math.min(...boxes.map((box) => box.x))
    const right = Math.max(...boxes.map((box) => box.x + box.width))
    const top = Math.min(...boxes.map((box) => box.y))
    const bottom = Math.max(...boxes.map((box) => box.y + box.height))
    nodes.forEach((node, index) => {
      const box = boxes[index]
      const position = { x: box.x, y: box.y }
      if (mode === "left") position.x = left
      if (mode === "center") position.x = (left + right) / 2 - box.width / 2
      if (mode === "right") position.x = right - box.width
      if (mode === "top") position.y = top
      if (mode === "middle") position.y = (top + bottom) / 2 - box.height / 2
      if (mode === "bottom") position.y = bottom - box.height
      node.position(Math.round(position.x), Math.round(position.y))
    })
    emitChange()
  }

  function distribute(axis) {
    const nodes = selectedNodes()
    if (nodes.length < 3) return
    const key = axis === "vertical" ? "y" : "x"
    const size = axis === "vertical" ? "height" : "width"
    const items = nodes.map((node) => ({ node, box: node.getBBox() }))
    items.sort((left, right) => left.box[key] - right.box[key])
    const first = items[0].box
    const last = items[items.length - 1].box
    const total = items.reduce((sum, item) => sum + item.box[size], 0)
    const gap = (last[key] + last[size] - first[key] - total) / (items.length - 1)
    let cursor = first[key]
    for (const item of items) {
      const position = { x: item.box.x, y: item.box.y }
      position[key] = Math.round(cursor)
      item.node.position(position.x, position.y)
      cursor += item.box[size] + gap
    }
    emitChange()
  }

  function order(direction) {
    const cells = graph.getSelectedCells().filter((cell) => !isPage(cell))
    if (!cells.length) return
    for (const cell of cells) {
      if (direction === "front") cell.toFront()
      else cell.toBack()
      // The sheet always stays at the very back.
      if (direction === "back" && cell.getZIndex() <= -1000) cell.setZIndex(-999)
    }
    graph.getCellById(PAGE_ID)?.setZIndex(-1000)
    emitChange()
  }

  return {
    graph,
    setDocument,
    select(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
      const cells = list.map((id) => graph.getCellById(id)).filter(Boolean)
      graph.cleanSelection()
      if (cells.length) graph.select(cells)
    },
    selectedIds: () => graph.getSelectedCells().map((cell) => cell.id),
    setRelationshipKind(kind) {
      activeRelationshipKind = kind
    },
    // Style patches go straight to the X6 cell so a slider drag is one cheap
    // repaint; the document is rebuilt from the graph afterwards.
    updateItem(id, patch) {
      const cell = graph.getCellById(id)
      if (!cell || isPage(cell)) return
      const data = { ...(cell.getData() || {}), ...patch }
      if (patch.evidence) data.evidence = { ...(cell.getData()?.evidence || {}), ...patch.evidence }
      cell.setData(data, { overwrite: true })
      if (cell.isEdge()) {
        if (patch.vertices) cell.setVertices(patch.vertices)
        applyEdge(cell, data)
      } else if (!applyNode(cell, data, patch)) {
        return "replace"
      }
      emitChange()
    },
    reverseEdge(id) {
      const edge = graph.getCellById(id)
      if (!edge?.isEdge()) return
      const source = edge.getSourceCellId()
      const target = edge.getTargetCellId()
      edge.setSource({ cell: target })
      edge.setTarget({ cell: source })
      edge.setVertices([...edge.getVertices()].reverse())
      // The end handles belong to the old ends; redraw them on the new ones.
      if (selectedEdgeIds.has(edge.id)) {
        edge.removeTools()
        decorateSelection(graph.getSelectedCells())
      }
      emitChange()
    },
    edgeAnchor(id) {
      const edge = graph.getCellById(id)
      const view = edge && graph.findViewByCell(edge)
      if (!view?.getPointAtRatio) return null
      const point = view.getPointAtRatio(0.5)
      return point ? graph.localToGraph(point) : null
    },
    nodeRect(id) {
      const node = graph.getCellById(id)
      return node?.isNode() ? graph.localToGraph(node.getBBox()) : null
    },
    view() {
      const { tx, ty } = graph.translate()
      return { scale: graph.zoom(), tx, ty }
    },
    nudge,
    refreshSize: syncSize,
    clientToLocal(x, y) {
      const point = graph.clientToLocal(x, y)
      return { x: Math.round(point.x), y: Math.round(point.y) }
    },
    visibleCentre() {
      const rect = container.getBoundingClientRect()
      const point = graph.clientToLocal(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return { x: Math.round(point.x), y: Math.round(point.y) }
    },
    zoomIn: () => graph.zoom(0.1, { maxScale: MAX_SCALE }),
    zoomOut: () => graph.zoom(-0.1, { minScale: MIN_SCALE }),
    zoomTo: (scale) => graph.zoomTo(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))),
    gridStep: () => (snapping ? gridStep : 1),
    zoomToFit: fitDiagram,
    zoomToSelection: fitSelection,
    setTool(tool) {
      if (tool === "pan") selection.disableRubberband()
      else selection.enableRubberband()
      container.classList.toggle("is-pan-tool", tool === "pan")
    },
    setGridVisible(visible) {
      showGrid = visible
      graph.getCellById(PAGE_ID)?.attr("grid/visibility", visible ? "visible" : "hidden")
    },
    setSnap(enabled) {
      snapping = enabled
      graph.setGridSize(enabled ? gridStep : 1)
      if (enabled) snapline.enable()
      else snapline.disable()
    },
    snapEnabled: () => snapping,
    align,
    distribute,
    order,
    deleteSelection() {
      const cells = graph.getSelectedCells().filter((cell) => !isPage(cell))
      if (cells.length) graph.removeCells(cells)
    },
    selectAll() {
      graph.select(graph.getCells().filter((cell) => !isPage(cell)))
    },
    async arrange(direction = "horizontal") {
      const { DagreLayout, GridLayout } = runtime
      const genes = graph.getNodes().filter(isActor)
      if (!genes.length) return
      // B-1050: a selected relationship kept its tools and the floating bar
      // where it used to be, so it looked left behind after the layout.
      graph.cleanSelection()
      graph.clearTransformWidgets()
      const useGrid = direction === "grid" || genes.length > 36
      const columns = Math.ceil(Math.sqrt(genes.length * 1.5))
      const gridIndex = new Map(genes.map((node, index) => [node.id, index]))
      const geneSize = genes[0].getSize()
      // B-1045: labels used to collide with portraits because ranks sat 90
      // units apart whatever the label said. The gap now fits the longest label.
      const longestLabel = Math.max(
        0,
        ...graph.getEdges().map((edge) => {
          const data = edge.getData() || {}
          return String(data.label || "").length * (data.label_size || 12) * 0.56
        }),
      )
      const layout = useGrid
        ? new GridLayout({
            begin: [60, 60],
            cols: columns,
            width: columns * (geneSize.width + 70),
            height: Math.ceil(genes.length / columns) * (geneSize.height + 60),
            nodeSize: [geneSize.width, geneSize.height],
            preventOverlap: true,
            condense: true,
            position: (node) => {
              const index = gridIndex.get(String(node.id)) || 0
              const row = Math.floor(index / columns)
              const offset = index % columns
              return { row, col: row % 2 === 0 ? offset : columns - 1 - offset }
            },
          })
        : new DagreLayout({
            rankdir: direction === "vertical" ? "TB" : "LR",
            nodesep: 48,
            ranksep: Math.max(90, Math.ceil(longestLabel) + 56),
            marginx: 60,
            marginy: 60,
            nodeSize: (node) => {
              const cell = graph.getCellById(String(node.id))
              const size = cell?.getSize() || geneSize
              return [size.width, size.height]
            },
          })
      await layout.execute({
        nodes: genes.map((node) => ({ id: node.id })),
        edges: graph.getEdges().map((edge) => ({
          id: edge.id,
          source: edge.getSourceCellId(),
          target: edge.getTargetCellId(),
        })),
      })
      layout.forEachNode((item) => {
        const node = graph.getCellById(String(item.id))
        const size = node?.getSize()
        if (node && size)
          node.position(Math.round(item.x - size.width / 2), Math.round(item.y - size.height / 2))
      })
      for (const edge of graph.getEdges()) {
        edge.removeTools()
        edge.setVertices([])
      }
      layout.destroy()
      const bounds = graph.getCellsBBox(graph.getNodes().filter((node) => !isPage(node)))
      const width = Math.max(baseDocument.width, Math.ceil(bounds.x + bounds.width + 60))
      const height = Math.max(baseDocument.height, Math.ceil(bounds.y + bounds.height + 60))
      if (width !== baseDocument.width || height !== baseDocument.height) {
        baseDocument = { ...baseDocument, width, height }
        graph.getCellById(PAGE_ID)?.resize(width, height)
      }
      emitChange()
      fitDiagram()
    },
    async exportSvg() {
      return graph.toSVGAsync(exportOptions())
    },
    async downloadSvg(fileName) {
      graph.cleanSelection()
      const svg = await graph.toSVGAsync(exportOptions())
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
      downloadUrl(url, fileName)
      // Keep the object URL alive long enough for Chromium and Firefox to
      // consume it after the synchronous click dispatch.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    async exportPng(scale = 2) {
      graph.cleanSelection()
      const fonts = await embeddedFontCss()
      return graph.toPNGAsync({
        ...exportOptions(fonts),
        serializeImages: true,
        width: baseDocument.width * scale,
        height: baseDocument.height * scale,
        backgroundColor: pageBackgroundColour(baseDocument),
        padding: 0,
      })
    },
    async downloadPng(fileName, scale = 2) {
      downloadUrl(await this.exportPng(scale), fileName)
    },
    dispose() {
      resizeObserver.disconnect()
      graph.dispose()
    },
  }
}

export async function exportDiagramWithX6(document) {
  const container = window.document.createElement("div")
  Object.assign(container.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${document.width}px`,
    height: `${document.height}px`,
  })
  window.document.body.append(container)
  const editor = await createDiagramEditor({ container, document, gridVisible: false })
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return await editor.exportSvg()
  } finally {
    editor.dispose()
    container.remove()
  }
}
