const X6_RUNTIME_URL = "./generated/x6-runtime.js?v=20260826-x6-318"
const GENE_SHAPE = "iconoplasm-gene"
const TEXT_SHAPE = "iconoplasm-text"
const PORT_IDS = ["top", "right", "bottom", "left"]

let runtimePromise = null
let shapesRegistered = false
let edgeCounter = 0

function loadRuntime() {
  runtimePromise ||= import(X6_RUNTIME_URL)
  return runtimePromise
}

function edgeId() {
  edgeCounter += 1
  return `edge-${Date.now().toString(36)}-${edgeCounter}`
}

function registerShapes(Graph) {
  if (shapesRegistered) return
  Graph.registerNode(
    GENE_SHAPE,
    {
      inherit: "rect",
      width: 132,
      height: 176,
      markup: [
        { tagName: "rect", selector: "body" },
        { tagName: "image", selector: "portrait" },
        { tagName: "rect", selector: "captionPlate" },
        { tagName: "text", selector: "caption" },
      ],
      attrs: {
        body: {
          rx: 10,
          ry: 10,
          fill: "#eadfcd",
          stroke: "#6d5140",
          strokeWidth: 1.5,
        },
        portrait: {
          x: 0,
          y: 0,
          refWidth: "100%",
          refHeight: "100%",
          preserveAspectRatio: "xMidYMid meet",
        },
        captionPlate: {
          x: 0,
          refY: "100%",
          refY2: -30,
          refWidth: "100%",
          height: 30,
          fill: "#eadfcd",
          fillOpacity: 0.94,
          stroke: "none",
        },
        caption: {
          refX: "50%",
          refY: "100%",
          refY2: -10,
          textAnchor: "middle",
          fontFamily: "League Spartan, sans-serif",
          fontWeight: 800,
          fontSize: 15,
          fill: "#2f241d",
          pointerEvents: "none",
        },
      },
      ports: {
        groups: Object.fromEntries(
          PORT_IDS.map((position) => [
            position,
            {
              position,
              attrs: {
                circle: {
                  class: "icono-x6-port-body",
                  r: 7,
                  magnet: true,
                  stroke: "#f4efe4",
                  strokeWidth: 3,
                  fill: "#b94b34",
                },
              },
            },
          ]),
        ),
        items: PORT_IDS.map((group) => ({ id: group, group })),
      },
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
        body: {
          rx: 5,
          ry: 5,
          fill: "#fffaf0",
          fillOpacity: 0.86,
          stroke: "#9b7d65",
          strokeWidth: 1.5,
          strokeDasharray: "5 4",
        },
        label: {
          fontFamily: "Newsreader, serif",
          fontSize: 24,
          fill: "#2f241d",
          textWrap: { width: -24, height: -18, ellipsis: true },
          textAnchor: "start",
          refX: 12,
          refY: 12,
          yAlignment: "top",
        },
      },
    },
    true,
  )
  shapesRegistered = true
}

function markerFor(kind) {
  if (kind === "inhibition") {
    return { tagName: "path", d: "M 10 -8 L 10 8", stroke: "#6d3729", strokeWidth: 3 }
  }
  if (kind === "association") return null
  return { name: "block", width: 12, height: 9 }
}

function edgeAttrs(kind, selected = false) {
  return {
    line: {
      stroke: selected ? "#b94b34" : "#6d3729",
      strokeWidth: selected ? 4 : 3,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeDasharray: kind === "association" ? "8 7" : "",
      targetMarker: markerFor(kind),
    },
  }
}

function edgeLabels(label, background) {
  if (!label) return []
  return [
    {
      attrs: {
        label: {
          text: label,
          fill: "#4b3b30",
          fontFamily: "IBM Plex Mono, monospace",
          fontSize: 14,
          paintOrder: "stroke",
          stroke: background,
          strokeWidth: 7,
          strokeLinejoin: "round",
        },
      },
      position: { distance: 0.5, offset: -12 },
    },
  ]
}

function graphNodes(document) {
  return document.nodes.map((node) => {
    if (node.type === "text") {
      return {
        id: node.id,
        shape: TEXT_SHAPE,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        label: node.text,
        attrs: {
          label: {
            text: node.text,
            fontSize: node.font_size,
            textAnchor:
              node.align === "center" ? "middle" : node.align === "right" ? "end" : "start",
            refX: node.align === "center" ? "50%" : node.align === "right" ? "100%" : 12,
            refX2: node.align === "right" ? -12 : 0,
          },
        },
        data: { ...node, itemType: "text" },
      }
    }
    const imageUrl = node.asset.immutable_url || node.asset.canonical_url
    return {
      id: node.id,
      shape: GENE_SHAPE,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      attrs: {
        portrait: { xlinkHref: imageUrl, href: imageUrl },
        caption: { text: node.label || node.symbol },
      },
      data: { ...node, itemType: "gene" },
    }
  })
}

function graphEdges(document) {
  return document.edges.map((edge) => ({
    id: edge.id,
    shape: "edge",
    source: { cell: edge.from },
    target: { cell: edge.to },
    router: { name: "orth", args: { padding: 24 } },
    connector: { name: "rounded", args: { radius: 12 } },
    attrs: edgeAttrs(edge.kind),
    labels: edgeLabels(edge.label, document.background),
    data: { ...edge, itemType: "relationship" },
  }))
}

function documentFromGraph(graph, baseDocument) {
  const nodes = graph.getNodes().map((cell) => {
    const data = cell.getData() || {}
    const position = cell.getPosition()
    const size = cell.getSize()
    if (data.itemType === "text") {
      return {
        ...data,
        id: cell.id,
        type: "text",
        text: String(cell.attr("label/text") || data.text || ""),
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      }
    }
    return {
      ...data,
      id: cell.id,
      type: "gene",
      label: String(cell.attr("caption/text") || data.label || data.symbol || ""),
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
    }
  })
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = graph
    .getEdges()
    .map((cell) => {
      const source = cell.getSourceCellId()
      const target = cell.getTargetCellId()
      const data = cell.getData() || {}
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return null
      return {
        id: cell.id,
        type: "relationship",
        from: source,
        to: target,
        kind: data.kind || "activation",
        label: data.label || "",
      }
    })
    .filter(Boolean)
  return { ...baseDocument, nodes, edges }
}

function decorateSelection(graph, selectedCells) {
  for (const edge of graph.getEdges()) {
    edge.attr(edgeAttrs(edge.getData()?.kind || "activation", selectedCells.includes(edge)), {
      overwrite: true,
    })
    edge.removeTools()
  }
  const selectedEdge = selectedCells.find((cell) => cell.isEdge())
  if (selectedEdge) {
    selectedEdge.addTools([
      { name: "vertices", args: { snapRadius: 20 } },
      { name: "segments" },
      { name: "source-arrowhead" },
      { name: "target-arrowhead" },
      { name: "button-remove", args: { distance: -28 } },
    ])
  }
}

export async function createDiagramEditor({ container, document, onChange, onSelect }) {
  const { Export, Graph, History, Keyboard, Selection, Snapline, Transform } = await loadRuntime()
  registerShapes(Graph)

  let baseDocument = document
  let applyingDocument = false
  let activeRelationshipKind = "activation"

  const graph = new Graph({
    container,
    width: Math.max(320, container.clientWidth || 900),
    height: Math.max(420, container.clientHeight || 620),
    background: { color: document.background },
    grid: {
      visible: true,
      size: 12,
      type: "doubleMesh",
      args: [
        { color: "#d9ccba", thickness: 1 },
        { color: "#baa58d", thickness: 1, factor: 5 },
      ],
    },
    panning: { enabled: true, eventTypes: ["rightMouseDown", "mouseWheelDown"] },
    mousewheel: { enabled: true, modifiers: ["ctrl", "meta"], minScale: 0.35, maxScale: 2.5 },
    connecting: {
      allowBlank: false,
      allowEdge: false,
      allowLoop: false,
      allowMulti: true,
      allowNode: false,
      highlight: true,
      snap: { radius: 48 },
      anchor: "center",
      connectionPoint: "boundary",
      router: { name: "orth", args: { padding: 24 } },
      connector: { name: "rounded", args: { radius: 12 } },
      validateConnection({ sourceCell, targetCell, sourcePort, targetPort }) {
        return Boolean(
          sourceCell &&
          targetCell &&
          sourceCell.id !== targetCell.id &&
          sourceCell.getData()?.itemType === "gene" &&
          targetCell.getData()?.itemType === "gene" &&
          sourcePort &&
          targetPort,
        )
      },
      createEdge() {
        const kind = activeRelationshipKind
        return graph.createEdge({
          id: edgeId(),
          shape: "edge",
          router: { name: "orth", args: { padding: 24 } },
          connector: { name: "rounded", args: { radius: 12 } },
          attrs: edgeAttrs(kind),
          data: { itemType: "relationship", kind, label: "" },
        })
      },
    },
    highlighting: {
      magnetAdsorbed: {
        name: "stroke",
        args: { attrs: { fill: "#f4efe4", stroke: "#b94b34", strokeWidth: 4 } },
      },
    },
  })

  const history = new History({ enabled: true, stackSize: 80 })
  graph.use(history)
  graph.use(new Keyboard({ enabled: true, global: false }))
  graph.use(
    new Selection({
      enabled: true,
      rubberband: true,
      multiple: true,
      movable: true,
      pointerEvents: "none",
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true,
    }),
  )
  graph.use(new Snapline({ enabled: true, sharp: true, tolerance: 10 }))
  graph.use(
    new Transform({
      rotating: false,
      resizing: {
        enabled: (node) => node.getData()?.itemType === "text",
        minWidth: 120,
        minHeight: 48,
        maxWidth: 900,
        maxHeight: 500,
        orthogonal: false,
        restrict: false,
      },
    }),
  )
  graph.use(new Export())

  const emitChange = () => {
    if (applyingDocument) return
    const next = documentFromGraph(graph, baseDocument)
    baseDocument = next
    onChange?.(next)
  }

  graph.on("selection:changed", ({ selected }) => {
    decorateSelection(graph, selected)
    graph.clearTransformWidgets()
    const textNode = selected.length === 1 ? selected[0] : null
    if (textNode?.isNode() && textNode.getData()?.itemType === "text") {
      graph.createTransformWidget(textNode)
    }
    onSelect?.(selected.length === 1 ? selected[0].id : "")
  })
  graph.on("node:change:position", emitChange)
  graph.on("node:change:size", emitChange)
  graph.on("node:removed", emitChange)
  graph.on("edge:connected", ({ edge }) => {
    edge.setData({ itemType: "relationship", kind: activeRelationshipKind, label: "" })
    edge.attr(edgeAttrs(activeRelationshipKind), { overwrite: true })
    emitChange()
    graph.select(edge)
  })
  graph.on("edge:removed", emitChange)
  graph.on("edge:change:vertices", emitChange)
  graph.on("edge:change:source", emitChange)
  graph.on("edge:change:target", emitChange)
  graph.on("blank:click", () => graph.cleanSelection())
  graph.on("cell:dblclick", ({ cell }) => {
    if (cell.getData()?.itemType === "text") onSelect?.(cell.id, { edit: true })
  })

  graph.bindKey(["backspace", "delete"], () => {
    const cells = graph.getSelectedCells()
    if (cells.length) graph.removeCells(cells)
    return false
  })
  graph.bindKey(["ctrl+z", "meta+z"], () => {
    graph.undo()
    return false
  })
  graph.bindKey(["ctrl+shift+z", "meta+shift+z", "ctrl+y", "meta+y"], () => {
    graph.redo()
    return false
  })

  async function setDocument(nextDocument, { fit = false, cleanHistory = false } = {}) {
    applyingDocument = true
    baseDocument = nextDocument
    history.disable()
    graph.fromJSON({ nodes: graphNodes(nextDocument), edges: graphEdges(nextDocument) })
    graph.drawBackground({ color: nextDocument.background })
    graph.cleanSelection()
    history.enable()
    if (cleanHistory) history.clean()
    applyingDocument = false
    if (fit && nextDocument.nodes.length) graph.zoomToFit({ padding: 56, maxScale: 1 })
  }

  await setDocument(document, { fit: true, cleanHistory: true })

  const resizeObserver = new ResizeObserver(() => {
    graph.resize(Math.max(320, container.clientWidth), Math.max(420, container.clientHeight))
  })
  resizeObserver.observe(container)

  function x6ExportOptions() {
    const snapshot = documentFromGraph(graph, baseDocument)
    const metadata = JSON.stringify({
      schema_version: snapshot.schema_version,
      title: snapshot.title,
      assets: snapshot.nodes
        .filter((node) => node.type === "gene")
        .map((node) => ({ node_id: node.id, symbol: node.symbol, ...node.asset })),
    })
    return {
      preserveDimensions: { width: snapshot.width, height: snapshot.height },
      viewBox: { x: 0, y: 0, width: snapshot.width, height: snapshot.height },
      copyStyles: true,
      beforeSerialize(svg) {
        const namespace = "http://www.w3.org/2000/svg"
        const background = window.document.createElementNS(namespace, "rect")
        background.setAttribute("width", String(snapshot.width))
        background.setAttribute("height", String(snapshot.height))
        background.setAttribute("fill", snapshot.background)
        svg.insertBefore(background, svg.firstChild)
        const metadataNode = window.document.createElementNS(namespace, "metadata")
        metadataNode.textContent = metadata
        svg.insertBefore(metadataNode, background.nextSibling)
        const title = window.document.createElementNS(namespace, "title")
        title.textContent = snapshot.title
        svg.insertBefore(title, metadataNode.nextSibling)
        return svg
      },
    }
  }

  return {
    graph,
    setDocument,
    select(id) {
      const cell = id ? graph.getCellById(id) : null
      if (cell) graph.select(cell)
      else graph.cleanSelection()
    },
    setRelationshipKind(kind) {
      activeRelationshipKind = kind
    },
    updateEdge(id, patch) {
      const edge = graph.getCellById(id)
      if (!edge?.isEdge()) return
      const data = { ...(edge.getData() || {}), ...patch }
      edge.setData(data)
      edge.attr(edgeAttrs(data.kind || "activation", true), { overwrite: true })
      edge.setLabels(edgeLabels(data.label || "", baseDocument.background))
      emitChange()
    },
    updateNode(id, patch) {
      const node = graph.getCellById(id)
      if (!node?.isNode()) return
      const data = { ...(node.getData() || {}), ...patch }
      node.setData(data)
      if (data.itemType === "text") node.attr("label/text", data.text || "")
      else node.attr("caption/text", data.label || data.symbol || "")
      emitChange()
    },
    canUndo: () => graph.canUndo(),
    canRedo: () => graph.canRedo(),
    undo: () => graph.undo(),
    redo: () => graph.redo(),
    zoomIn: () => graph.zoom(0.15, { maxScale: 2.5 }),
    zoomOut: () => graph.zoom(-0.15, { minScale: 0.35 }),
    zoomToFit: () => graph.zoomToFit({ padding: 56, maxScale: 1 }),
    async arrange(direction = "horizontal") {
      const { DagreLayout } = await loadRuntime()
      const genes = graph.getNodes().filter((node) => node.getData()?.itemType === "gene")
      if (!genes.length) return
      const layout = new DagreLayout({
        rankdir: direction === "vertical" ? "TB" : "LR",
        nodesep: 54,
        ranksep: 90,
        marginx: 50,
        marginy: 70,
        nodeSize: (node) => {
          const cell = graph.getCellById(String(node.id))
          const size = cell?.getSize() || { width: 132, height: 176 }
          return [size.width, size.height]
        },
      })
      const data = {
        nodes: genes.map((node) => ({ id: node.id })),
        edges: graph.getEdges().map((edge) => ({
          id: edge.id,
          source: edge.getSourceCellId(),
          target: edge.getTargetCellId(),
        })),
      }
      await layout.execute(data)
      graph.startBatch("antv-dagre-layout")
      layout.forEachNode((item) => {
        const node = graph.getCellById(String(item.id))
        const size = node?.getSize()
        if (node && size) node.position(item.x - size.width / 2, item.y - size.height / 2)
      })
      graph.stopBatch("antv-dagre-layout")
      layout.destroy()
      graph.zoomToFit({ padding: 56, maxScale: 1 })
      emitChange()
    },
    async exportSvg() {
      return graph.toSVGAsync(x6ExportOptions())
    },
    async downloadSvg(fileName) {
      const svg = await graph.toSVGAsync(x6ExportOptions())
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement("a")
      link.href = url
      link.download = fileName
      link.hidden = true
      window.document.body.append(link)
      link.click()
      link.remove()
      // Keep the object URL alive long enough for Chromium and Firefox to
      // consume it after the synchronous click dispatch.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
  const editor = await createDiagramEditor({ container, document })
  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return await editor.exportSvg()
  } finally {
    editor.dispose()
    container.remove()
  }
}
