import {
  ICONOPLASM_DIAGRAM_LIMITS,
  addGeneNode,
  addTextNode,
  cloneDiagramDocument,
  connectGeneNodes,
  createDiagramDocument,
  diagramAssetManifest,
  normalizeGeneSymbol,
  removeDiagramItem,
  updateDiagramItem,
} from "./diagram-document.js?v=20260826-x6-318-3"
import {
  createDiagramEditor,
  exportDiagramWithX6,
} from "./diagram-x6-editor.js?v=20260826-x6-318-3"

// ARCHITECTURE FENCE [IPD-003]: humans and WebMCP agents edit the same visible
// document, and both obtain characters through the bounded canonical resolver.

const STORAGE_KEY = "iconoplasm.diagramStudio.document.v2"
const LEGACY_STORAGE_KEY = "iconoplasm.diagramStudio.document.v1"
const EXAMPLE_GENES = ["EGFR", "KRAS", "BRAF", "MAP2K1", "MAPK1"]

let currentDocument = readStoredDocument()
let selectedId = ""
let mountedRoot = null
let editor = null
let editorReady = null
let statusText = ""
let statusTone = ""
let webMcpController = null
let openStudioRoute = null
let activeRelationshipKind = "activation"

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function readStoredDocument() {
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (raw) return createDiagramDocument(JSON.parse(raw))
  } catch (_error) {
    // Storage is a convenience. The visible studio remains usable without it.
  }
  return createDiagramDocument({ title: "Untitled pathway" })
}

function storeDocument() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentDocument))
  } catch (_error) {
    // Private browsing and storage-disabled contexts retain the in-memory document.
  }
}

function setStatus(message, tone = "") {
  statusText = String(message || "")
  statusTone = tone
  const status = mountedRoot && mountedRoot.querySelector("[data-icono-studio-status]")
  if (status) {
    status.textContent = statusText
    status.setAttribute("data-tone", statusTone)
  }
}

function selectedItem() {
  return (
    currentDocument.nodes.find((item) => item.id === selectedId) ||
    currentDocument.edges.find((item) => item.id === selectedId) ||
    null
  )
}

async function commitDocument(nextDocument, options = {}) {
  const normalized = createDiagramDocument(nextDocument)
  currentDocument = normalized
  if (selectedId && !selectedItem()) selectedId = ""
  storeDocument()
  renderWorkspace()
  const instance = await editorReady
  if (instance && options.sync !== false) {
    await instance.setDocument(currentDocument, {
      fit: options.fit === true,
      cleanHistory: options.cleanHistory === true,
    })
  }
  if (options.message) setStatus(options.message, options.tone || "success")
  return cloneDiagramDocument(currentDocument)
}

function undo() {
  editor?.undo()
}

function redo() {
  editor?.redo()
}

function parseSymbols(value) {
  const symbols = []
  const seen = new Set()
  for (const token of String(value || "").split(/[\s,;]+/)) {
    const symbol = normalizeGeneSymbol(token)
    if (!symbol || seen.has(symbol)) continue
    seen.add(symbol)
    symbols.push(symbol)
  }
  return symbols.slice(0, ICONOPLASM_DIAGRAM_LIMITS.nodes)
}

async function resolveGeneAssets(symbols) {
  const identifiers = parseSymbols(Array.isArray(symbols) ? symbols.join(",") : symbols)
  if (!identifiers.length) throw new TypeError("Enter at least one valid gene symbol.")
  const host = String(window.location.hostname || "").toLowerCase()
  const apiOrigin =
    host === "iconoplasm.brinedew.bio" || host === "staging.brinedew.bio"
      ? window.location.origin
      : "https://iconoplasm.brinedew.bio"
  const response = await fetch(`${apiOrigin}/api/public/v1/images/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) {
    throw new Error(
      (payload && payload.error) || `Image resolver returned HTTP ${response.status}.`,
    )
  }
  return payload
}

function resolvedAssetMap(payload) {
  const assets = new Map()
  for (const result of (payload && payload.results) || []) {
    const symbol = normalizeGeneSymbol(result && result.canonical_symbol)
    const blot = result && result.images && result.images.gene_blot
    if (symbol && result.found && blot) assets.set(symbol, blot)
  }
  return assets
}

async function addResolvedGenes(symbols, options = {}) {
  const requested = parseSymbols(Array.isArray(symbols) ? symbols.join(",") : symbols)
  if (!requested.length) throw new TypeError("Enter at least one valid gene symbol.")
  setStatus(`Finding ${requested.length} canonical character${requested.length === 1 ? "" : "s"}…`)
  const payload = await resolveGeneAssets(requested)
  const assets = resolvedAssetMap(payload)
  let next = cloneDiagramDocument(currentDocument)
  let added = 0
  for (const requestedSymbol of requested) {
    const result = (payload.results || []).find(
      (item) => normalizeGeneSymbol(item && item.requested) === requestedSymbol,
    )
    const symbol = normalizeGeneSymbol(result && result.canonical_symbol) || requestedSymbol
    const asset = assets.get(symbol)
    if (!asset) continue
    const outcome = addGeneNode(next, { symbol, label: symbol, asset })
    next = outcome.document
    if (outcome.added) added += 1
  }
  if (!added) throw new Error("None of those genes has a ready canonical character.")
  await commitDocument(next, {
    message: `Added ${added} canonical gene character${added === 1 ? "" : "s"}.`,
  })
  if (options.layout !== false)
    await (await editorReady)?.arrange(options.direction || "horizontal")
  return cloneDiagramDocument(currentDocument)
}

function studioMarkup() {
  return `
    <main class="icono-studio" id="icono-main" aria-labelledby="icono-studio-title">
      <header class="icono-studio-masthead">
        <div>
          <p class="icono-studio-kicker">Iconoplasm studio</p>
          <h1 id="icono-studio-title">Give the pathway a cast.</h1>
        </div>
        <div class="icono-studio-history" aria-label="Document history">
          <button type="button" data-studio-action="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" data-studio-action="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
      </header>
      <div class="icono-studio-shell">
        <aside class="icono-studio-assets" aria-labelledby="icono-studio-assets-title">
          <div class="icono-studio-panel-heading">
            <span>01</span><h2 id="icono-studio-assets-title">Character atlas</h2>
          </div>
          <form class="icono-studio-gene-form" data-studio-gene-form>
            <label for="icono-studio-gene-input">Add gene characters</label>
            <div class="icono-studio-gene-entry">
              <input id="icono-studio-gene-input" name="symbols" autocomplete="off" spellcheck="false" placeholder="TP53, MDM2, CDKN1A" />
              <button type="submit">Add</button>
            </div>
            <p>Paste one symbol or a whole pathway.</p>
          </form>
          <div class="icono-studio-starters" aria-label="Example genes">
            ${EXAMPLE_GENES.map((symbol) => `<button type="button" data-studio-add-symbol="${symbol}">${symbol}</button>`).join("")}
          </div>
          <div class="icono-studio-cast-list" data-studio-cast-list></div>
        </aside>
        <section class="icono-studio-stage" aria-labelledby="icono-studio-canvas-title">
          <div class="icono-studio-stagebar">
            <div>
              <span class="icono-studio-stage-index">02</span>
              <h2 id="icono-studio-canvas-title">Figure</h2>
              <span data-studio-count></span>
            </div>
            <div class="icono-studio-stage-actions">
              <button type="button" data-studio-action="text">Text</button>
              <button type="button" data-studio-action="layout">Arrange</button>
              <button type="button" data-studio-action="fit">Fit</button>
              <button type="button" data-studio-action="zoom-out" aria-label="Zoom out">−</button>
              <button type="button" data-studio-action="zoom-in" aria-label="Zoom in">+</button>
              <button type="button" data-studio-action="example">Example</button>
              <button type="button" class="is-primary" data-studio-action="download">Download SVG</button>
            </div>
          </div>
          <div class="icono-studio-relationship-bar" role="toolbar" aria-label="New relationship type">
            <span>New connection</span>
            <button type="button" data-studio-relationship-tool="activation" aria-pressed="true">Activation <b aria-hidden="true">→</b></button>
            <button type="button" data-studio-relationship-tool="inhibition" aria-pressed="false">Inhibition <b aria-hidden="true">⊣</b></button>
            <button type="button" data-studio-relationship-tool="association" aria-pressed="false">Association <b aria-hidden="true">—</b></button>
          </div>
          <div class="icono-studio-canvas-wrap is-x6" data-studio-canvas-wrap><div class="icono-studio-x6-canvas" data-studio-x6-canvas aria-label="Editable pathway diagram"></div></div>
          <div class="icono-studio-status" data-icono-studio-status role="status" aria-live="polite"></div>
        </section>
        <section class="icono-studio-inspector" aria-labelledby="icono-studio-inspector-title">
          <div class="icono-studio-panel-heading">
            <span>03</span><h2 id="icono-studio-inspector-title">Inspector</h2>
          </div>
          <div data-studio-inspector></div>
        </section>
      </div>
    </main>`
}

function castListMarkup() {
  const cast = currentDocument.nodes.filter((node) => node.type === "gene")
  if (!cast.length) {
    return '<p class="icono-studio-empty-list">Characters you add will appear here.</p>'
  }
  return cast
    .map(
      (node) =>
        `<button type="button" class="icono-studio-cast-item${selectedId === node.id ? " is-selected" : ""}" data-studio-select="${escapeHtml(node.id)}"><img src="${escapeHtml(node.asset.canonical_url || node.asset.immutable_url)}" alt="" loading="lazy"/><span><strong>${escapeHtml(node.symbol)}</strong><small>${escapeHtml(node.label)}</small></span></button>`,
    )
    .join("")
}

function inspectorMarkup() {
  const item = selectedItem()
  if (!item) {
    return `<div class="icono-studio-inspector-summary"><label class="icono-studio-field">Diagram title<input type="text" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.titleLength}" value="${escapeHtml(currentDocument.title)}" data-studio-title /></label></div><div class="icono-studio-inspector-note"><strong>Draw directly on the figure.</strong><p>Move portraits by dragging them. Hover a portrait, then drag one of its four handles onto another portrait to connect them.</p></div>`
  }
  if (item.type === "gene") {
    const targets = currentDocument.nodes.filter(
      (node) => node.type === "gene" && node.id !== item.id,
    )
    return `<div class="icono-studio-inspector-summary"><div class="icono-studio-selection"><span>Selected gene</span><strong>${escapeHtml(item.symbol)}</strong></div><label class="icono-studio-field">Caption<input type="text" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.labelLength}" value="${escapeHtml(item.label)}" data-studio-node-label="${escapeHtml(item.id)}" /></label><button type="button" class="icono-studio-danger" data-studio-remove="${escapeHtml(item.id)}">Remove</button></div><div class="icono-studio-inspector-controls">${targets.length ? `<div class="icono-studio-inspector-note"><strong>Drag a handle to connect.</strong><p>The four red handles snap to another portrait. The new connection starts as activation; choose →, ⊣, or — on the canvas after drawing it.</p></div><details class="icono-studio-keyboard-connect"><summary>Keyboard connection controls</summary><form data-studio-connect-form><input type="hidden" name="from" value="${escapeHtml(item.id)}"/><label class="icono-studio-field">Connect to<select name="to">${targets.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.symbol)}</option>`).join("")}</select></label><label class="icono-studio-field">Relationship<select name="kind"><option value="activation">Activates</option><option value="inhibition">Inhibits</option><option value="association">Associated with</option></select></label><label class="icono-studio-field">Label<input name="label" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.labelLength}" placeholder="optional"/></label><button type="submit" class="icono-studio-wide-action">Connect genes</button></form></details>` : '<p class="icono-studio-inspector-note">Add another gene to draw a relationship.</p>'}</div>`
  }
  if (item.type === "text") {
    return `<div class="icono-studio-inspector-summary"><div class="icono-studio-selection"><span>Text box</span><strong>Annotation</strong></div><label class="icono-studio-field">Text<textarea rows="5" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.textLength}" data-studio-text-content="${escapeHtml(item.id)}">${escapeHtml(item.text)}</textarea></label><label class="icono-studio-field">Size<input type="number" min="12" max="56" step="1" value="${item.font_size}" data-studio-text-size="${escapeHtml(item.id)}" /></label><label class="icono-studio-field">Align<select data-studio-text-align="${escapeHtml(item.id)}"><option value="left"${item.align === "left" ? " selected" : ""}>Left</option><option value="center"${item.align === "center" ? " selected" : ""}>Center</option><option value="right"${item.align === "right" ? " selected" : ""}>Right</option></select></label><button type="button" class="icono-studio-danger" data-studio-remove="${escapeHtml(item.id)}">Remove</button></div><div class="icono-studio-inspector-note"><strong>Resize on the figure.</strong><p>Drag the X6 handles around the selected text box.</p></div>`
  }
  return `<div class="icono-studio-inspector-summary"><div class="icono-studio-selection"><span>Selected relationship</span><strong>${escapeHtml(item.kind)}</strong></div><label class="icono-studio-field">Label<input type="text" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.labelLength}" value="${escapeHtml(item.label)}" data-studio-edge-label="${escapeHtml(item.id)}" /></label><button type="button" class="icono-studio-danger" data-studio-remove="${escapeHtml(item.id)}">Remove</button></div><div class="icono-studio-inspector-note"><strong>Relationship style is on the canvas.</strong><p>Use the nearby →, ⊣, and — controls so the visual result never leaves your attention.</p></div>`
}

function renderWorkspace() {
  if (!mountedRoot) return
  const list = mountedRoot.querySelector("[data-studio-cast-list]")
  const inspector = mountedRoot.querySelector("[data-studio-inspector]")
  const count = mountedRoot.querySelector("[data-studio-count]")
  if (list) list.innerHTML = castListMarkup()
  if (inspector) inspector.innerHTML = inspectorMarkup()
  if (count)
    count.textContent = `${currentDocument.nodes.filter((node) => node.type === "gene").length} genes · ${currentDocument.edges.length} relationships · ${currentDocument.nodes.filter((node) => node.type === "text").length} text boxes`
  const undoButton = mountedRoot.querySelector('[data-studio-action="undo"]')
  const redoButton = mountedRoot.querySelector('[data-studio-action="redo"]')
  if (undoButton) undoButton.disabled = !editor?.canUndo()
  if (redoButton) redoButton.disabled = !editor?.canRedo()
  for (const button of mountedRoot.querySelectorAll("[data-studio-relationship-tool]")) {
    const pressed = button.getAttribute("data-studio-relationship-tool") === activeRelationshipKind
    button.setAttribute("aria-pressed", String(pressed))
    button.classList.toggle("is-selected", pressed)
  }
  setStatus(statusText, statusTone)
}

async function selectItem(itemId, options = {}) {
  selectedId = String(itemId || "")
  renderWorkspace()
  if (options.canvas !== false) (await editorReady)?.select(selectedId)
  if (options.edit) {
    requestAnimationFrame(() => {
      const field = mountedRoot?.querySelector("[data-studio-text-content]")
      field?.focus()
      field?.select()
    })
  }
  const inspector = mountedRoot && mountedRoot.querySelector("[data-studio-inspector]")
  if (inspector && window.matchMedia("(max-width: 760px)").matches)
    inspector.scrollIntoView({ block: "nearest" })
}

async function downloadSvg() {
  if (!currentDocument.nodes.length) {
    setStatus("Add at least one gene before exporting.", "error")
    return
  }
  const fileName = `${
    currentDocument.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "iconoplasm-diagram"
  }.svg`
  const instance = await editorReady
  if (!instance) throw new Error("The X6 diagram engine is not ready.")
  await instance.downloadSvg(fileName)
  setStatus("SVG downloaded from the X6 diagram.", "success")
}

async function loadExample() {
  const payload = await resolveGeneAssets(EXAMPLE_GENES)
  const assets = resolvedAssetMap(payload)
  let example = createDiagramDocument({ title: "EGFR–MAPK signaling" })
  for (const symbol of EXAMPLE_GENES) {
    const outcome = addGeneNode(example, {
      id: `gene-${symbol.toLowerCase()}`,
      symbol,
      asset: assets.get(symbol),
    })
    example = outcome.document
  }
  const pairs = [
    ["EGFR", "KRAS", "activates"],
    ["KRAS", "BRAF", "activates"],
    ["BRAF", "MAP2K1", "phosphorylates"],
    ["MAP2K1", "MAPK1", "phosphorylates"],
  ]
  for (const [fromSymbol, toSymbol, label] of pairs) {
    const from = example.nodes.find((node) => node.symbol === fromSymbol)
    const to = example.nodes.find((node) => node.symbol === toSymbol)
    example = connectGeneNodes(example, {
      from: from.id,
      to: to.id,
      label,
      kind: "activation",
    }).document
  }
  await commitDocument(example, {
    message: "Loaded an editable EGFR–MAPK example.",
    cleanHistory: true,
  })
  await (await editorReady)?.arrange("horizontal")
}

async function handleStudioClick(event) {
  const relationshipTool = event.target.closest("[data-studio-relationship-tool]")
  if (relationshipTool) {
    activeRelationshipKind = relationshipTool.getAttribute("data-studio-relationship-tool")
    const instance = await editorReady
    instance?.setRelationshipKind(activeRelationshipKind)
    const edge = currentDocument.edges.find((item) => item.id === selectedId)
    if (edge) {
      instance?.updateEdge(edge.id, { kind: activeRelationshipKind })
      setStatus("Updated the selected relationship.")
    } else {
      setStatus("New connections will use " + activeRelationshipKind + ".")
    }
    renderWorkspace()
    return
  }

  const addSymbol = event.target.closest("[data-studio-add-symbol]")
  if (addSymbol) {
    try {
      await addResolvedGenes(addSymbol.getAttribute("data-studio-add-symbol"))
    } catch (error) {
      setStatus(error.message, "error")
    }
    return
  }

  const selection = event.target.closest("[data-studio-select]")
  if (selection) {
    await selectItem(selection.getAttribute("data-studio-select"))
    return
  }

  const remove = event.target.closest("[data-studio-remove]")
  if (remove) {
    selectedId = ""
    await commitDocument(
      removeDiagramItem(currentDocument, remove.getAttribute("data-studio-remove")),
      {
        message: "Removed from the diagram.",
      },
    )
    return
  }

  const action = event.target.closest("[data-studio-action]")
  if (!action) return
  const name = action.getAttribute("data-studio-action")
  try {
    const instance = await editorReady
    if (name === "undo") instance?.undo()
    if (name === "redo") instance?.redo()
    if (name === "layout") await instance?.arrange("horizontal")
    if (name === "fit") instance?.zoomToFit()
    if (name === "zoom-in") instance?.zoomIn()
    if (name === "zoom-out") instance?.zoomOut()
    if (name === "download") await downloadSvg()
    if (name === "example") await loadExample()
    if (name === "text") {
      const outcome = addTextNode(currentDocument, {
        text: "Double-click to edit",
        x: currentDocument.width / 2 - 130,
        y: currentDocument.height / 2 - 44,
      })
      selectedId = outcome.node.id
      await commitDocument(outcome.document, { message: "Added a movable, resizable text box." })
      await selectItem(outcome.node.id, { edit: true })
    }
  } catch (error) {
    setStatus(error.message, "error")
  }
}

async function handleStudioSubmit(event) {
  if (event.target.matches("[data-studio-gene-form]")) {
    event.preventDefault()
    const input = event.target.elements.symbols
    try {
      await addResolvedGenes(input.value)
      input.value = ""
      input.focus()
    } catch (error) {
      setStatus(error.message, "error")
    }
    return
  }
  if (event.target.matches("[data-studio-connect-form]")) {
    event.preventDefault()
    const form = new FormData(event.target)
    try {
      const outcome = connectGeneNodes(currentDocument, {
        from: form.get("from"),
        to: form.get("to"),
        kind: form.get("kind"),
        label: form.get("label"),
      })
      selectedId = outcome.edge.id
      await commitDocument(outcome.document, { message: "Connected the gene characters." })
      await selectItem(outcome.edge.id)
    } catch (error) {
      setStatus(error.message, "error")
    }
  }
}

async function handleStudioChange(event) {
  if (event.target.matches("[data-studio-title]")) {
    const next = cloneDiagramDocument(currentDocument)
    next.title = event.target.value
    await commitDocument(next, { message: "Updated the diagram title." })
    return
  }
  const instance = await editorReady
  const nodeLabel = event.target.getAttribute("data-studio-node-label")
  if (nodeLabel) {
    instance?.updateNode(nodeLabel, { label: event.target.value })
    setStatus("Updated the caption.")
    return
  }
  const textContent = event.target.getAttribute("data-studio-text-content")
  if (textContent) {
    instance?.updateNode(textContent, { text: event.target.value })
    setStatus("Updated the text box.")
    return
  }
  const textSize = event.target.getAttribute("data-studio-text-size")
  if (textSize) {
    await commitDocument(
      updateDiagramItem(currentDocument, textSize, { font_size: event.target.value }),
      { message: "Updated the text size." },
    )
    return
  }
  const textAlign = event.target.getAttribute("data-studio-text-align")
  if (textAlign) {
    await commitDocument(
      updateDiagramItem(currentDocument, textAlign, { align: event.target.value }),
      { message: "Updated the text alignment." },
    )
    return
  }
  const edgeLabel = event.target.getAttribute("data-studio-edge-label")
  if (edgeLabel) {
    instance?.updateEdge(edgeLabel, { label: event.target.value })
    setStatus("Updated the relationship label.")
    return
  }
  const edgeKind = event.target.getAttribute("data-studio-edge-kind")
  if (edgeKind) {
    instance?.updateEdge(edgeKind, { kind: event.target.value })
    setStatus("Updated the relationship.")
  }
}

function acceptEditorDocument(nextDocument) {
  currentDocument = createDiagramDocument(nextDocument)
  if (selectedId && !selectedItem()) selectedId = ""
  storeDocument()
  renderWorkspace()
}

export function renderDiagramStudio(root) {
  mountedRoot = root
  mountedRoot.innerHTML = studioMarkup()
  mountedRoot.addEventListener("click", handleStudioClick)
  mountedRoot.addEventListener("submit", handleStudioSubmit)
  mountedRoot.addEventListener("change", handleStudioChange)
  renderWorkspace()

  const container = mountedRoot.querySelector("[data-studio-x6-canvas]")
  editorReady = createDiagramEditor({
    container,
    document: currentDocument,
    onChange: acceptEditorDocument,
    onSelect(itemId, options) {
      selectItem(itemId, { canvas: false, edit: options?.edit })
    },
  })
    .then((instance) => {
      editor = instance
      instance.setRelationshipKind(activeRelationshipKind)
      renderWorkspace()
      setStatus("X6 canvas ready. Drag portraits and connect their red ports.")
      return instance
    })
    .catch((error) => {
      setStatus("The diagram engine could not start: " + error.message, "error")
      throw error
    })
}

export function unmountDiagramStudio() {
  if (!mountedRoot) return
  mountedRoot.removeEventListener("click", handleStudioClick)
  mountedRoot.removeEventListener("submit", handleStudioSubmit)
  mountedRoot.removeEventListener("change", handleStudioChange)
  editor?.dispose()
  editor = null
  editorReady = null
  mountedRoot = null
}

function toolResult(payload, message) {
  return {
    ...payload,
    content: [{ type: "text", text: message }],
  }
}

function ensureStudioOpen() {
  if (typeof openStudioRoute === "function") openStudioRoute()
}

async function composeFromTool(input) {
  const genes = Array.isArray(input.genes)
    ? input.genes.slice(0, ICONOPLASM_DIAGRAM_LIMITS.nodes)
    : []
  const symbols = genes.map((gene) => normalizeGeneSymbol(gene && gene.symbol)).filter(Boolean)
  if (!symbols.length) throw new TypeError("genes must contain at least one valid symbol.")
  ensureStudioOpen()
  setStatus(`The agent is assembling ${symbols.length} gene characters…`)
  const payload = await resolveGeneAssets(symbols)
  const assets = resolvedAssetMap(payload)
  let next = createDiagramDocument({ title: input.title || "Untitled pathway" })
  for (const gene of genes) {
    const symbol = normalizeGeneSymbol(gene && gene.symbol)
    const asset = assets.get(symbol)
    if (!symbol || !asset) continue
    next = addGeneNode(next, {
      id: `gene-${symbol.toLowerCase()}`,
      symbol,
      label: gene.label || symbol,
      x: gene.x,
      y: gene.y,
      asset,
    }).document
  }
  for (const annotation of Array.isArray(input.annotations) ? input.annotations : []) {
    next = addTextNode(next, annotation).document
  }
  for (const relationship of Array.isArray(input.relationships)
    ? input.relationships.slice(0, ICONOPLASM_DIAGRAM_LIMITS.edges)
    : []) {
    const fromSymbol = normalizeGeneSymbol(relationship && relationship.from)
    const toSymbol = normalizeGeneSymbol(relationship && relationship.to)
    const from = next.nodes.find((node) => node.type === "gene" && node.symbol === fromSymbol)
    const to = next.nodes.find((node) => node.type === "gene" && node.symbol === toSymbol)
    if (!from || !to || from.id === to.id) continue
    next = connectGeneNodes(next, {
      from: from.id,
      to: to.id,
      label: relationship.label,
      kind: relationship.kind,
    }).document
  }
  selectedId = ""
  await commitDocument(next, {
    message: `The agent created an editable diagram with ${next.nodes.length} gene characters.`,
  })
  if (input.layout !== "manual") {
    await (await editorReady)?.arrange(input.layout === "vertical" ? "vertical" : "horizontal")
  }
  return cloneDiagramDocument(currentDocument)
}

async function editFromTool(input) {
  const operations = Array.isArray(input.operations) ? input.operations.slice(0, 50) : []
  if (!operations.length) throw new TypeError("operations must contain at least one edit.")
  ensureStudioOpen()
  const symbolsToResolve = operations
    .filter((operation) => operation && operation.type === "add_gene")
    .map((operation) => normalizeGeneSymbol(operation.symbol))
    .filter(Boolean)
  const assets = symbolsToResolve.length
    ? resolvedAssetMap(await resolveGeneAssets(symbolsToResolve))
    : new Map()
  let next = cloneDiagramDocument(currentDocument)
  let layoutDirection = ""
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") continue
    if (operation.type === "set_title") {
      next.title = String(operation.title || "Untitled pathway")
    } else if (operation.type === "add_gene") {
      const symbol = normalizeGeneSymbol(operation.symbol)
      if (symbol && assets.has(symbol))
        next = addGeneNode(next, {
          symbol,
          label: operation.label || symbol,
          asset: assets.get(symbol),
        }).document
    } else if (operation.type === "add_text") {
      next = addTextNode(next, operation).document
    } else if (operation.type === "update_text") {
      next = updateDiagramItem(next, operation.item_id, {
        text: operation.text,
        font_size: operation.font_size,
        align: operation.align,
      })
    } else if (operation.type === "remove_gene") {
      const node = next.nodes.find(
        (item) =>
          item.type === "gene" &&
          (item.id === operation.gene || item.symbol === normalizeGeneSymbol(operation.gene)),
      )
      if (node) next = removeDiagramItem(next, node.id)
    } else if (operation.type === "move_gene" || operation.type === "move_item") {
      const node = next.nodes.find(
        (item) =>
          item.id === (operation.item_id || operation.gene) ||
          (item.type === "gene" && item.symbol === normalizeGeneSymbol(operation.gene)),
      )
      if (node) next = updateDiagramItem(next, node.id, { x: operation.x, y: operation.y })
    } else if (operation.type === "connect") {
      const from = next.nodes.find(
        (item) =>
          item.type === "gene" &&
          (item.id === operation.from || item.symbol === normalizeGeneSymbol(operation.from)),
      )
      const to = next.nodes.find(
        (item) =>
          item.type === "gene" &&
          (item.id === operation.to || item.symbol === normalizeGeneSymbol(operation.to)),
      )
      if (from && to && from.id !== to.id)
        next = connectGeneNodes(next, {
          from: from.id,
          to: to.id,
          label: operation.label,
          kind: operation.kind,
        }).document
    } else if (operation.type === "remove_item") {
      next = removeDiagramItem(next, operation.item_id)
    } else if (operation.type === "auto_layout") {
      layoutDirection = operation.direction === "vertical" ? "vertical" : "horizontal"
    }
  }
  selectedId = ""
  await commitDocument(next, {
    message: `The agent applied ${operations.length} edit${operations.length === 1 ? "" : "s"}.`,
  })
  if (layoutDirection) await (await editorReady)?.arrange(layoutDirection)
  return cloneDiagramDocument(currentDocument)
}

function toolSchemas() {
  const geneSchema = {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Human gene symbol, for example TP53." },
      label: { type: "string", description: "Optional caption for this gene character." },
      x: { type: "number", description: "Optional manual x-coordinate in the 1200 by 800 canvas." },
      y: { type: "number", description: "Optional manual y-coordinate in the 1200 by 800 canvas." },
    },
    required: ["symbol"],
  }
  const annotationSchema = {
    type: "object",
    properties: {
      text: { type: "string", maxLength: ICONOPLASM_DIAGRAM_LIMITS.textLength },
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
      font_size: { type: "number", minimum: 12, maximum: 56 },
      align: { type: "string", enum: ["left", "center", "right"] },
    },
    required: ["text"],
  }
  const relationshipSchema = {
    type: "object",
    properties: {
      from: { type: "string", description: "Source gene symbol." },
      to: { type: "string", description: "Target gene symbol." },
      kind: { type: "string", enum: ["activation", "inhibition", "association"] },
      label: { type: "string", description: "Optional biological relationship label." },
    },
    required: ["from", "to"],
  }
  return [
    {
      name: "resolve_gene_assets",
      description:
        "Return canonical Iconoplasm gene-character bitmap URLs and provenance for up to 50 gene identifiers. Use this when you need to inspect the character images multimodally or reuse them outside the visible Iconoplasm diagram.",
      inputSchema: {
        type: "object",
        properties: {
          symbols: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
          asset_types: {
            type: "array",
            items: { type: "string", enum: ["gene_blot"] },
            maxItems: 1,
          },
        },
        required: ["symbols"],
      },
      async execute({ symbols }) {
        const payload = await resolveGeneAssets(symbols)
        const found = (payload.results || []).filter((result) => result.found).length
        return toolResult(
          payload,
          `Resolved ${found} canonical Iconoplasm gene-character bitmap${found === 1 ? "" : "s"}.`,
        )
      },
    },
    {
      name: "compose_gene_diagram",
      description:
        "Create or replace the visible, human-editable Iconoplasm pathway diagram using canonical gene characters, X6 connections, and optional text boxes.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", maxLength: ICONOPLASM_DIAGRAM_LIMITS.titleLength },
          genes: {
            type: "array",
            items: geneSchema,
            minItems: 1,
            maxItems: ICONOPLASM_DIAGRAM_LIMITS.nodes,
          },
          relationships: {
            type: "array",
            items: relationshipSchema,
            maxItems: ICONOPLASM_DIAGRAM_LIMITS.edges,
          },
          annotations: {
            type: "array",
            items: annotationSchema,
            maxItems: ICONOPLASM_DIAGRAM_LIMITS.nodes,
          },
          layout: {
            type: "string",
            enum: ["auto", "horizontal", "vertical", "manual"],
            default: "auto",
          },
        },
        required: ["genes"],
      },
      async execute(input) {
        const document = await composeFromTool(input)
        return toolResult(
          { document, assets: diagramAssetManifest(document) },
          `Created an editable Iconoplasm diagram with ${document.nodes.length} gene characters and ${document.edges.length} relationships.`,
        )
      },
    },
    {
      name: "edit_gene_diagram",
      description:
        "Apply structured edits to the diagram currently visible in Iconoplasm. Edits use the same document model and controls as the human Diagram Studio.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "set_title",
                    "add_gene",
                    "add_text",
                    "update_text",
                    "remove_gene",
                    "move_gene",
                    "move_item",
                    "connect",
                    "remove_item",
                    "auto_layout",
                  ],
                },
                title: { type: "string" },
                symbol: { type: "string" },
                text: { type: "string" },
                label: { type: "string" },
                gene: { type: "string" },
                from: { type: "string" },
                to: { type: "string" },
                kind: { type: "string", enum: ["activation", "inhibition", "association"] },
                item_id: { type: "string" },
                direction: { type: "string", enum: ["horizontal", "vertical"] },
                align: { type: "string", enum: ["left", "center", "right"] },
                font_size: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
                width: { type: "number" },
                height: { type: "number" },
              },
              required: ["type"],
            },
          },
        },
        required: ["operations"],
      },
      async execute(input) {
        const document = await editFromTool(input)
        return toolResult(
          { document, assets: diagramAssetManifest(document) },
          `Updated the visible Iconoplasm diagram.`,
        )
      },
    },
    {
      name: "read_gene_diagram",
      description:
        "Read the current human-visible Iconoplasm diagram document and its canonical gene-character asset manifest.",
      inputSchema: { type: "object", properties: {} },
      execute() {
        const document = cloneDiagramDocument(currentDocument)
        return toolResult(
          { document, assets: diagramAssetManifest(document) },
          `The visible diagram contains ${document.nodes.length} gene characters and ${document.edges.length} relationships.`,
        )
      },
    },
    {
      name: "export_gene_diagram",
      description:
        "Return the current X6-backed Iconoplasm diagram as SVG markup plus canonical bitmap provenance.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const document = cloneDiagramDocument(currentDocument)
        const svg = editor ? await editor.exportSvg() : await exportDiagramWithX6(document)
        return toolResult(
          { svg, document, assets: diagramAssetManifest(document), media_type: "image/svg+xml" },
          `Exported the current Iconoplasm diagram as SVG.`,
        )
      },
    },
  ]
}

export async function registerDiagramWebMcp(options = {}) {
  openStudioRoute = typeof options.openStudio === "function" ? options.openStudio : openStudioRoute
  const modelContext = document.modelContext
  if (!modelContext || typeof modelContext.registerTool !== "function")
    return { supported: false, registered: [] }
  if (webMcpController) webMcpController.abort()
  webMcpController = new AbortController()
  const registered = []
  for (const tool of toolSchemas()) {
    await modelContext.registerTool(tool, { signal: webMcpController.signal })
    registered.push(tool.name)
  }
  return { supported: true, registered }
}

export function getCurrentDiagramDocument() {
  return cloneDiagramDocument(currentDocument)
}

export const __testing = {
  composeFromTool,
  editFromTool,
  parseSymbols,
  resolvedAssetMap,
  toolSchemas,
}
