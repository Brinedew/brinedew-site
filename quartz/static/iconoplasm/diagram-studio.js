import { applyThemePreference, readEffectiveTheme } from "../site-preferences.js?v=2624be2e2b452a30"
import {
  COMPARTMENT_SHAPES,
  ICONOPLASM_DIAGRAM_LIMITS,
  LINE_PRESETS,
  LINE_PRESET_NAMES,
  PAGE_BACKGROUND_SWATCHES,
  RELATIONSHIP_KINDS,
  RELATIONSHIP_KIND_IDS,
  RELATIONSHIP_NOTATIONS,
  addCompartmentNode,
  addGaugeNode,
  addGeneNode,
  addMoleculeNode,
  addTextNode,
  addWorkspacePage,
  cloneDiagramDocument,
  connectGeneNodes,
  createDiagramDocument,
  createDiagramWorkspace,
  diagramAssetManifest,
  diagramReferences,
  effectiveLine,
  linesPreset,
  normalizeGeneSymbol,
  pageBackgroundColour,
  referenceUrl,
  relationshipKind,
  removeDiagramItem,
  updateDiagramItem,
} from "./diagram-document.js?v=ae8ed02849975cc2"
import { STUDIO_ICONS } from "./diagram-studio-icons.js?v=f4f5c3cf1effb8eb"
import { createDiagramEditor, exportDiagramWithX6 } from "./diagram-x6-editor.js?v=86aca2cd81e8a3c5"
import {
  DIAGRAM_TEMPLATES,
  buildTemplateDocument,
  diagramTemplate,
  templateSymbols,
  templateThumbnail,
} from "./diagram-templates.js?v=04923f4d2ca1ba10"
import { iconoplasmPublicationReader } from "./publication-reader.js?v=d43e030ec3f6f3b3"

// ARCHITECTURE FENCE [IPD-003]: humans and WebMCP agents edit the same visible
// document, and both obtain characters through the bounded canonical resolver.
//
// B-1045: the studio is a full diagram editor in the draw.io and BioRender
// anatomy (menus, toolbar, shape library, Format panel, page tabs, status
// bar), skinned as Iconoplasm's printed lab. Menu and panel words are
// draw.io's and BioRender's; relationship names are KEGG's.

const STYLESHEET_URL = new URL("./diagram-studio.css?v=5879935fb3a50b66", import.meta.url).href
const LOGO_URL = new URL("./studio/iconoplasm-48.png", import.meta.url).href
const WORKSPACE_KEY = "iconoplasm.diagramStudio.workspace.v3"
const LEGACY_KEYS = ["iconoplasm.diagramStudio.document.v2", "iconoplasm.diagramStudio.document.v1"]
const VIEW_KEY = "iconoplasm.diagramStudio.view.v1"
// B-1050: the first-run tour runs once per browser; Help replays it.
const TOUR_KEY = "iconoplasm.diagramStudio.tour.v1"
const TOUR_RUNTIME_URL = "./generated/tour-runtime.js?v=58faf9183c19c4ff"
const TOUR_STYLESHEET_URL = new URL("./generated/driver.css?v=d095d440021fcf13", import.meta.url)
  .href
const SEARCH_DEBOUNCE_MS = 180
const PHONE_QUERY = "(max-width: 760px)"
const UNDO_LIMIT = 100
const KEGG_QUICK_KINDS = ["activation", "inhibition", "association", "phosphorylation"]
const LINE_COLOURS = [
  ["#20120b", "Ink"],
  ["#1b7269", "Teal"],
  ["#a24834", "Rust"],
  ["#b07a2a", "Ochre"],
  ["#41566b", "Slate"],
  ["#8a7d70", "Grey"],
]
const PAGE_PRESETS = [
  ["1200x800", "Figure 3:2 (1200 × 800)"],
  ["1600x900", "Slide 16:9 (1600 × 900)"],
  ["1123x794", "A4 landscape (1123 × 794)"],
  ["794x1123", "A4 portrait (794 × 1123)"],
  ["1000x1000", "Square (1000 × 1000)"],
]
// State is read from storage when the studio mounts (or a WebMCP tool first
// asks), never at import: the module also loads in Node for its tests.
let workspace = null
let currentDocument = null
let selectedIds = []
let mountedRoot = null
let editor = null
let editorReady = null
let statusText = ""
let statusTone = ""
let saveState = "saved"
let saveTimer = 0
let webMcpController = null
let openStudioRoute = null
let activeRelationshipKind = "activation"
let studioSearchTimer = 0
let studioSearchRequest = 0
let studioSearchResults = []
let activeStudioSearchIndex = -1
let view = null
let pointer = { x: 0, y: 0 }
let openMenu = null
let styleClipboard = null
let itemClipboard = null
let undoStack = []
let redoStack = []
let lastSnapshot = ""
let snapshotTimer = 0
let hoverTimer = 0
let viewFrame = 0
let castKey = ""
let pagesKey = ""
let renamingPageId = ""
const geneNames = new Map()

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function icon(name) {
  return `<svg class="ics-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${STUDIO_ICONS[name] || ""}</svg>`
}

function isPhone() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY).matches
    : false
}

function ensureState() {
  if (workspace) return
  workspace = readStoredWorkspace()
  currentDocument = activePage()
  view = readViewPreferences()
  lastSnapshot = JSON.stringify(currentDocument)
}

function publicApiOrigin() {
  const host = String(window.location.hostname || "").toLowerCase()
  return host === "iconoplasm.brinedew.bio" || host === "staging.brinedew.bio"
    ? window.location.origin
    : "https://iconoplasm.brinedew.bio"
}

// B-855: people type the name they know ("p53", "E-cadherin"). The static
// index has symbols and names only, so the curated literature aliases come from
// the public metadata: one small, browser-cached request per studio session,
// never one per keystroke. Ranking matches the server search: match strength
// (exact, prefix, substring) first, then symbol before alias before name.
const READER_RANK_SCORE = { 1: 0, 2: 10, 3: 12, 4: 20, 5: 22 }
let publicationAliasesPromise = null

function publicationAliases() {
  publicationAliasesPromise ||= fetch(`${publicApiOrigin()}/api/public/v1/metadata`)
    .then((response) => (response.ok ? response.json() : null))
    .then((metadata) => metadata?.publication_aliases?.by_symbol || {})
    .catch(() => {
      publicationAliasesPromise = null
      return {}
    })
  return publicationAliasesPromise
}

function aliasScore(aliases, needle) {
  let best = null
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const value = String(alias || "").toLowerCase()
    const score =
      value === needle ? 1 : value.startsWith(needle) ? 11 : value.includes(needle) ? 21 : null
    if (score !== null && (best === null || score < best)) best = score
  }
  return best
}

function readerScore(gene, needle) {
  const symbol = String(gene?.symbol || "").toLowerCase()
  const name = String(gene?.full_name || gene?.name || "").toLowerCase()
  if (symbol === needle) return READER_RANK_SCORE[1]
  if (symbol.startsWith(needle)) return READER_RANK_SCORE[2]
  if (name.startsWith(needle)) return READER_RANK_SCORE[3]
  if (symbol.includes(needle)) return READER_RANK_SCORE[4]
  return READER_RANK_SCORE[5]
}

function publicationReader() {
  return globalThis.IconoplasmPublicationReader || iconoplasmPublicationReader
}

export async function searchPublishedGenes(query, { limit = 8 } = {}) {
  const reader = publicationReader()
  const text = String(query || "")
  const needle = text.trim().toLowerCase()
  const [direct, aliases] = await Promise.all([
    reader.search(text, { limit }),
    needle.length >= 2 ? publicationAliases() : {},
  ])
  const scored = new Map()
  for (const gene of direct?.genes || []) {
    scored.set(gene.symbol, { gene, score: readerScore(gene, needle) })
  }
  const aliasHits = Object.entries(aliases)
    .map(([symbol, list]) => [symbol, aliasScore(list, needle)])
    .filter(([symbol, score]) => score !== null && !(scored.get(symbol)?.score < score))
    .sort((left, right) => left[1] - right[1])
    .slice(0, limit)
  for (const [symbol, score] of aliasHits) {
    const exact = await reader.search(symbol, { limit: 1, symbols: [symbol] })
    const gene = exact?.genes?.find((item) => item.symbol === symbol)
    if (gene) scored.set(symbol, { gene, score })
  }
  const genes = [...scored.values()]
    .sort(
      (left, right) =>
        left.score - right.score || left.gene.symbol.localeCompare(right.gene.symbol),
    )
    .slice(0, limit)
    .map((item) => item.gene)
  return { ...direct, genes }
}

/* ───────── storage ───────── */

function readStoredWorkspace() {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY)
    if (raw) return createDiagramWorkspace(JSON.parse(raw))
    for (const key of LEGACY_KEYS) {
      const legacy = window.localStorage.getItem(key)
      if (legacy) {
        const page = createDiagramDocument(JSON.parse(legacy))
        return createDiagramWorkspace({ title: page.title, pages: [{ ...page, id: "page-1" }] })
      }
    }
  } catch (_error) {
    // Storage is a convenience. The visible studio remains usable without it.
  }
  return createDiagramWorkspace({ title: "Untitled diagram" })
}

function activePage() {
  return workspace.pages.find((page) => page.id === workspace.active) || workspace.pages[0]
}

// What the mouse wheel does over the canvas, named as in Lucidchart's
// View > Navigation mode: Mouse zooms, Trackpad pans, Auto tells them apart.
const NAVIGATION_MODES = ["auto", "mouse", "trackpad"]

function readViewPreferences() {
  const phone = isPhone()
  const defaults = {
    library: !phone,
    format: !phone,
    rulers: !phone,
    grid: true,
    snap: true,
    tool: "select",
    formatTab: "style",
    notation: "simple",
    navigation: "auto",
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(VIEW_KEY) || "null")
    if (stored && typeof stored === "object") {
      for (const key of ["rulers", "grid", "snap"]) {
        if (typeof stored[key] === "boolean") defaults[key] = stored[key]
      }
      if (stored.notation === "kegg") defaults.notation = "kegg"
      if (NAVIGATION_MODES.includes(stored.navigation)) defaults.navigation = stored.navigation
      if (!phone) {
        for (const key of ["library", "format"]) {
          if (typeof stored[key] === "boolean") defaults[key] = stored[key]
        }
      }
    }
  } catch (_error) {
    // A view preference is a convenience; the defaults are complete.
  }
  return defaults
}

function storeViewPreferences() {
  try {
    const { library, format, rulers, grid, snap, notation, navigation } = view
    window.localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ library, format, rulers, grid, snap, notation, navigation }),
    )
  } catch (_error) {
    // Private browsing keeps the in-memory view.
  }
}

function storeWorkspace() {
  saveState = "saving"
  renderSaveState()
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace))
      saveState = "saved"
    } catch (_error) {
      // Private browsing and storage-disabled contexts retain the in-memory workspace.
      saveState = "unsaved"
    }
    renderSaveState()
  }, 250)
}

function syncWorkspacePage() {
  workspace.pages = workspace.pages.map((page) =>
    page.id === currentDocument.id ? currentDocument : page,
  )
}

/* ───────── undo history ───────── */

// One history for every kind of change (canvas drags, panel edits, genes the
// resolver added), kept as document snapshots. A burst of edits within 350 ms,
// such as a slider drag, is one undo step.
function recordChange({ immediate = false } = {}) {
  window.clearTimeout(snapshotTimer)
  if (immediate) pushSnapshot()
  else snapshotTimer = window.setTimeout(pushSnapshot, 350)
}

function pushSnapshot() {
  window.clearTimeout(snapshotTimer)
  const now = JSON.stringify(currentDocument)
  if (now === lastSnapshot) return
  undoStack.push(lastSnapshot)
  if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  redoStack = []
  lastSnapshot = now
  renderChrome()
}

function resetHistory() {
  window.clearTimeout(snapshotTimer)
  undoStack = []
  redoStack = []
  lastSnapshot = JSON.stringify(currentDocument)
}

async function restoreSnapshot(snapshot) {
  lastSnapshot = snapshot
  currentDocument = createDiagramDocument(JSON.parse(snapshot))
  syncWorkspacePage()
  storeWorkspace()
  const instance = await editorReady
  await instance?.setDocument(currentDocument)
  selectedIds = selectedIds.filter((id) => findItem(id))
  renderChrome()
  renderFormat()
}

async function undo() {
  pushSnapshot()
  if (!undoStack.length) return
  redoStack.push(lastSnapshot)
  await restoreSnapshot(undoStack.pop())
}

async function redo() {
  pushSnapshot()
  if (!redoStack.length) return
  undoStack.push(lastSnapshot)
  await restoreSnapshot(redoStack.pop())
}

/* ───────── document plumbing ───────── */

function setStatus(message, tone = "") {
  statusText = String(message || "")
  statusTone = tone
  const status = mountedRoot && mountedRoot.querySelector("[data-icono-studio-status]")
  if (status) {
    status.textContent = statusText
    status.setAttribute("data-tone", statusTone)
  }
}

function findItem(id) {
  return (
    currentDocument.nodes.find((item) => item.id === id) ||
    currentDocument.edges.find((item) => item.id === id) ||
    null
  )
}

function selectedItems() {
  return selectedIds.map(findItem).filter(Boolean)
}

function selectedItem() {
  const items = selectedItems()
  return items.length === 1 ? items[0] : null
}

async function commitDocument(nextDocument, options = {}) {
  currentDocument = createDiagramDocument(nextDocument)
  syncWorkspacePage()
  selectedIds = selectedIds.filter((id) => findItem(id))
  storeWorkspace()
  recordChange({ immediate: true })
  const instance = await editorReady
  if (instance && options.sync !== false) {
    await instance.setDocument(currentDocument, { fit: options.fit === true, select: selectedIds })
  }
  renderChrome()
  if (options.format !== false) renderFormat()
  if (options.message) setStatus(options.message, options.tone || "success")
  return cloneDiagramDocument(currentDocument)
}

function acceptEditorDocument(nextDocument) {
  currentDocument = createDiagramDocument(nextDocument)
  syncWorkspacePage()
  selectedIds = selectedIds.filter((id) => findItem(id))
  storeWorkspace()
  recordChange()
  renderChrome()
  syncFormatValues()
  scheduleViewUpdate()
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
  const apiOrigin = publicApiOrigin()
  const batches = []
  for (let index = 0; index < identifiers.length; index += 50)
    batches.push(identifiers.slice(index, index + 50))
  const payloads = await Promise.all(
    batches.map(async (batch) => {
      const response = await fetch(`${apiOrigin}/api/public/v1/images/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload) {
        throw new Error(
          (payload && payload.error) || `Image resolver returned HTTP ${response.status}.`,
        )
      }
      return payload
    }),
  )
  return {
    ...(payloads[0] || {}),
    requested: identifiers,
    results: payloads.flatMap((payload) => payload.results || []),
  }
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

async function visibleCentre() {
  const instance = await editorReady
  const point = instance?.visibleCentre?.()
  return point || { x: currentDocument.width / 2, y: currentDocument.height / 2 }
}

// New characters land in rows around the middle of the visible sheet; the
// rest of the diagram stays where the author put it.
async function addResolvedGenes(symbols, options = {}) {
  const requested = parseSymbols(Array.isArray(symbols) ? symbols.join(",") : symbols)
  if (!requested.length) throw new TypeError("Enter at least one valid gene symbol.")
  setStatus(`Loading ${requested.length} gene${requested.length === 1 ? "" : "s"}…`)
  const payload = await resolveGeneAssets(requested)
  const assets = resolvedAssetMap(payload)
  let next = cloneDiagramDocument(currentDocument)
  const added = []
  const aliases = []
  const missing = []
  const width = 104
  const height = Math.round(width * (4 / 3))
  const columns = Math.min(6, Math.max(1, requested.length))
  const centre = options.at || (await visibleCentre())
  const originX = centre.x - (columns * (width + 28)) / 2
  const originY = centre.y - height / 2
  for (const requestedSymbol of requested) {
    const result = (payload.results || []).find(
      (item) => normalizeGeneSymbol(item && item.requested) === requestedSymbol,
    )
    const symbol = normalizeGeneSymbol(result && result.canonical_symbol) || requestedSymbol
    const asset = assets.get(symbol)
    if (!asset) {
      missing.push(requestedSymbol)
      continue
    }
    if (symbol !== requestedSymbol) aliases.push(`${requestedSymbol} → ${symbol}`)
    const slot = added.length
    const outcome = addGeneNode(next, {
      symbol,
      label: symbol,
      asset,
      width,
      x: originX + (slot % columns) * (width + 28),
      y: originY + Math.floor(slot / columns) * (height + 36),
    })
    next = outcome.document
    if (outcome.added) added.push(outcome.node.id)
  }
  if (!added.length && missing.length) throw new Error(`Not found: ${missing.join(", ")}.`)
  const parts = [`Added ${added.length}`]
  if (aliases.length) parts.push(`${aliases.length} alias resolved (${aliases.join(", ")})`)
  if (missing.length) parts.push(`not found: ${missing.join(", ")}`)
  selectedIds = added
  await commitDocument(next, { message: `${parts.join(" · ")}.` })
  if (options.layout) await (await editorReady)?.arrange(options.direction || "horizontal")
  return cloneDiagramDocument(currentDocument)
}

/* ───────── markup ───────── */

function relationshipGlyph(kindId) {
  const kind = relationshipKind(kindId)
  const stroke = kind.head === "bar" ? "var(--ics-stamp)" : "currentColor"
  const end = kind.head === "arrow" ? 31 : kind.head === "bar" ? 35 : 38
  const dash = kind.dashed ? ' stroke-dasharray="3 2"' : ""
  let parts = `<path d="M2 10H${end}" stroke="${stroke}" stroke-width="1.4"${dash}/>`
  if (kind.head === "arrow") parts += `<path d="M31 6.5l7 3.5-7 3.5z" fill="${stroke}"/>`
  if (kind.head === "bar") parts += `<path d="M35.5 4v12" stroke="${stroke}" stroke-width="2"/>`
  if (kind.tick) parts += `<path d="M20 5.5v9" stroke="${stroke}" stroke-width="1.4"/>`
  if (kind.slash) parts += `<path d="M20 14.5l4.5-9" stroke="${stroke}" stroke-width="1.4"/>`
  if (kind.tag)
    parts += `<text x="17" y="6.4" font-size="7" font-weight="600" text-anchor="middle" style="fill:${stroke}">${escapeHtml(kind.tag)}</text>`
  return `<svg class="ics-glyph" viewBox="0 0 40 16" aria-hidden="true">${parts}</svg>`
}

const COMPARTMENT_PREVIEWS = {
  membrane:
    '<rect x="1" y="11" width="54" height="12" fill="#ece3d3"/><path d="M1 11.5h54M1 22.5h54" stroke="#c9b99d" stroke-width="1.5"/>',
  cytoplasm:
    '<rect x="2" y="2" width="52" height="30" rx="7" fill="none" stroke="currentColor" stroke-opacity=".5"/>',
  nucleus:
    '<ellipse cx="28" cy="17" rx="25" ry="14" fill="rgba(27,114,105,.08)" stroke="rgba(27,114,105,.6)" stroke-width="1.5"/>',
  mitochondrion:
    '<ellipse cx="28" cy="17" rx="25" ry="13" fill="#fbebe2" stroke="#cf9b7f" stroke-width="1.5"/><path d="M8 17c4-7 7 7 11 0s7 7 11 0 7 7 11 0 6 6 8 0" fill="none" stroke="#cf9b7f"/>',
  er: '<path d="M4 9c12-5 36 5 48 0M4 15c12-5 36 5 48 0M4 21c12-5 36 5 48 0M4 27c12-5 36 5 48 0" fill="none" stroke="#9fb096" stroke-width="2"/>',
  complex:
    '<rect x="2" y="2" width="52" height="30" rx="2" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-dasharray="3 2"/>',
  faction:
    '<rect x="2" y="2" width="52" height="30" rx="5" fill="rgba(27,114,105,.08)" stroke="rgba(27,114,105,.85)" stroke-width="1.5"/>',
}

function compartmentPreview(id) {
  return `<svg class="ics-comp-svg" viewBox="0 0 56 34" aria-hidden="true">${COMPARTMENT_PREVIEWS[id]}</svg>`
}

// B-1050: which relationship kinds the pickers offer. The kind of whatever is
// selected is always listed, so a KEGG kind never vanishes from its own panel.
function notationKinds(include = "") {
  const ids = RELATIONSHIP_NOTATIONS[view?.notation === "kegg" ? "kegg" : "simple"]
  return RELATIONSHIP_KINDS.filter((kind) => ids.includes(kind.id) || kind.id === include)
}

function quickKinds() {
  return view?.notation === "kegg" ? KEGG_QUICK_KINDS : [...RELATIONSHIP_NOTATIONS.simple]
}

function relationshipButtons() {
  return notationKinds()
    .map(
      (kind) =>
        `<button type="button" class="ics-rel" data-studio-action="kind:${kind.id}" aria-pressed="false">${relationshipGlyph(kind.id)}<span>${escapeHtml(kind.label)}</span>${kind.key ? `<kbd class="ics-kbd">${kind.key.toUpperCase()}</kbd>` : ""}</button>`,
    )
    .join("")
}

function minibarMarkup() {
  const edge = selectedItem()
  const undirected = edge?.type === "relationship" && relationshipKind(edge.kind).head === "none"
  return `${quickKinds()
    .map(
      (kind) =>
        `<button type="button" class="ics-tb" data-studio-action="kind:${kind}" aria-label="${escapeHtml(relationshipKind(kind).label)}" title="${escapeHtml(relationshipKind(kind).label)}" aria-pressed="false">${relationshipGlyph(kind)}</button>`,
    )
    .join(
      "",
    )}<span class="ics-tsep" aria-hidden="true"></span><button type="button" class="ics-tb" data-studio-action="reverse" aria-label="Reverse direction" title="${undirected ? "Binding has no direction" : "Reverse direction"}"${undirected ? " disabled" : ""}>${icon("arrow-left-right")}</button><button type="button" class="ics-tb" data-studio-action="show-format" aria-label="Format" title="Format">${icon("ellipsis")}</button>`
}

const MOLECULE_PREVIEW =
  '<svg viewBox="0 0 48 26" aria-hidden="true"><ellipse cx="24" cy="13" rx="21" ry="10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'

// The Gauge tile: the tick ring at tile size, 13 ticks growing toward HIGH.
const GAUGE_PREVIEW = (() => {
  let ticks = ""
  for (let index = 0; index < 13; index += 1) {
    const t = index / 12
    const angle = ((210 - 240 * t) * Math.PI) / 180
    const [x, y] = [Math.cos(angle), -Math.sin(angle)]
    const inner = 11 - (2 + 4.5 * t)
    ticks += `<line x1="${(24 + 11 * x).toFixed(2)}" y1="${(14 + 11 * y).toFixed(2)}" x2="${(24 + inner * x).toFixed(2)}" y2="${(14 + inner * y).toFixed(2)}" stroke-width="${(0.8 + t).toFixed(2)}"/>`
  }
  return `<svg viewBox="0 0 48 26" aria-hidden="true"><g stroke="currentColor" stroke-linecap="round" fill="none">${ticks}<line x1="24" y1="14" x2="24" y2="7" stroke-width="1.5"/></g></svg>`
})()

function toolButton(action, iconName, label, extra = "") {
  return `<button type="button" class="ics-tb" data-studio-action="${action}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${extra}>${icon(iconName)}</button>`
}

function toolMenu(menu, content, label, extra = "") {
  return `<button type="button" class="ics-tdd" data-studio-menu="${menu}" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${extra}>${content}${icon("chevron-down")}</button>`
}

const MENUS = [
  ["file", "File"],
  ["edit", "Edit"],
  ["view", "View"],
  ["insert", "Insert"],
  ["arrange", "Arrange"],
  ["help", "Help"],
]

function studioMarkup() {
  const sep = '<span class="ics-tsep" aria-hidden="true"></span>'
  return `
    <main class="icono-studio" id="icono-main" aria-labelledby="icono-studio-title" data-studio-root>
      <h1 class="icono-studio-sr-only" id="icono-studio-title">Pathway diagram editor</h1>
      <header class="ics-titlebar">
        <a class="ics-home" href="/" data-icono-nav title="Iconoplasm" aria-label="Iconoplasm home"><img src="${LOGO_URL}" width="20" height="20" alt=""></a>
        <label class="ics-file-title"><span class="icono-studio-sr-only">Diagram name</span><input type="text" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.titleLength}" data-studio-workspace-title value="${escapeHtml(workspace.title)}"></label>
        <span class="ics-saved" data-studio-saved></span>
        <span class="ics-titlebar-actions">
          <button type="button" class="ics-btn ics-btn-pri" data-studio-menu="export" aria-haspopup="menu" aria-expanded="false">${icon("download")}<span>Export</span></button>
        </span>
      </header>
      <nav class="ics-menubar" role="menubar" aria-label="Diagram menus">
        ${MENUS.map(([id, label]) => `<button type="button" role="menuitem" class="ics-menu-trigger" data-studio-menu="${id}" aria-haspopup="menu" aria-expanded="false">${label}</button>`).join("")}
      </nav>
      <div class="ics-toolbar" role="toolbar" aria-label="Diagram tools">
        ${toolButton("toggle-library", "panel-left", "Shapes", ' data-studio-pressed="library"')}${sep}
        ${toolMenu("zoom", '<span class="ics-zoom-value" data-studio-zoom>100%</span>', "Zoom")}
        ${toolButton("zoom-out", "zoom-out", "Zoom out (Ctrl+−)")}${toolButton("zoom-in", "zoom-in", "Zoom in (Ctrl+=)")}${sep}
        ${toolButton("undo", "undo-2", "Undo (Ctrl+Z)")}${toolButton("redo", "redo-2", "Redo (Ctrl+Shift+Z)")}${sep}
        ${toolButton("tool:select", "mouse-pointer-2", "Select", ' data-studio-pressed="tool:select"')}${toolButton("tool:pan", "hand", "Pan (drag the sheet)", ' data-studio-pressed="tool:pan"')}${sep}
        ${toolButton("delete", "trash-2", "Delete (Delete)", ' data-studio-needs="selection"')}${toolButton("to-front", "bring-to-front", "To front (Ctrl+Shift+F)", ' data-studio-needs="selection"')}${toolButton("to-back", "send-to-back", "To back (Ctrl+Shift+B)", ' data-studio-needs="selection"')}${sep}
        ${toolMenu("fill", icon("paint-bucket"), "Fill", ' data-studio-needs="text"')}
        ${toolMenu("line-colour", icon("pen-line"), "Line colour", ' data-studio-needs="colourable"')}
        ${toolMenu("line-width", '<span class="ics-width-sample" aria-hidden="true"></span><span data-studio-width-value>1.5</span>', "Line width", ' data-studio-needs="relationship"')}
        ${toolMenu("routing", icon("spline"), "Waypoints", ' data-studio-needs="relationship"')}
        ${toolMenu("kind", relationshipGlyph("activation"), "Relationship type", " data-studio-kind-preview")}${sep}
        ${toolMenu("align", icon("align-center-vertical"), "Align", ' data-studio-needs="two"')}
        ${toolMenu("distribute", icon("align-horizontal-space-around"), "Distribute", ' data-studio-needs="three"')}
        ${toolMenu("layout", `${icon("network")}<span class="ics-tdd-text">Layout</span>`, "Layout")}${sep}
        ${toolButton("insert-gene", "user-round-plus", "Gene (/)")}${toolButton("insert-text", "type", "Text")}${toolButton("insert-note", "sticky-note", "Note")}${toolButton("templates", "layout-template", "Template…")}
        ${toolMenu("compartment", icon("square-dashed"), "Compartment")}${sep}
        ${toolButton("toggle-grid", "grid-3x3", "Grid (Ctrl+Shift+G)", ' data-studio-pressed="grid"')}${toolButton("toggle-snap", "magnet", "Snap to grid", ' data-studio-pressed="snap"')}${toolButton("toggle-rulers", "ruler", "Ruler", ' data-studio-pressed="rulers"')}
        <span class="ics-toolbar-end">${toolButton("fullscreen", "maximize", "Fullscreen")}${toolButton("toggle-format", "panel-right", "Format (Ctrl+Shift+P)", ' data-studio-pressed="format"')}</span>
      </div>
      <div class="ics-body" data-studio-body>
        <aside class="ics-panel ics-library" aria-label="Shapes" data-studio-library>
          <div class="ics-sheet-head"><span>Shapes</span><button type="button" class="ics-tb" data-studio-action="toggle-library" aria-label="Close shapes">${icon("x")}</button></div>
          <div class="ics-library-search">
            <div class="icono-search-wrapper icono-studio-search">
              <span class="ics-field ics-search-field">${icon("search")}<input class="icono-search-input" id="icono-studio-gene-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search genes" role="combobox" aria-label="Search genes" aria-autocomplete="list" aria-controls="icono-studio-gene-results" aria-expanded="false" /><kbd class="ics-kbd">/</kbd></span>
              <div class="icono-search-results ics-search-results" id="icono-studio-gene-results" role="listbox" aria-label="Gene search results" data-studio-gene-results></div>
            </div>
          </div>
          <div class="ics-library-scroll">
            <details class="ics-sec" open><summary class="ics-sech">In this diagram<span class="ics-sech-count" data-studio-cast-count>0</span></summary><div class="ics-cast" data-studio-cast-list></div></details>
            <details class="ics-sec" open><summary class="ics-sech">Add genes</summary>
              <form class="ics-paste" data-studio-gene-form>
                <label class="icono-studio-sr-only" for="icono-studio-gene-list">Gene list</label>
                <textarea class="ics-field ics-textarea" id="icono-studio-gene-list" name="symbols" rows="3" spellcheck="false" placeholder="Paste a list: EGFR, GRB2, SOS1"></textarea>
                <div class="ics-row ics-row-end"><span class="ics-muted ics-small">Symbols or aliases</span><button type="submit" class="ics-btn">Add</button></div>
              </form>
            </details>
            <details class="ics-sec" open><summary class="ics-sech">Compartments</summary><div class="ics-tiles">
              ${COMPARTMENT_SHAPES.map((shape) => `<button type="button" class="ics-tile" draggable="true" data-studio-action="insert-compartment:${shape.id}" data-studio-drag="compartment:${shape.id}" title="${escapeHtml(shape.label)}">${compartmentPreview(shape.id)}<span>${escapeHtml(shape.id === "er" ? "ER" : shape.label.replace("Plasma membrane", "Membrane"))}</span></button>`).join("")}
            </div></details>
            <details class="ics-sec" open data-studio-rels-section><summary class="ics-sech">Relationships</summary>
              <div class="ics-row ics-notation"><label class="ics-lbl" for="icono-studio-notation">Notation</label><span class="ics-select"><select id="icono-studio-notation" data-studio-notation><option value="simple"${view.notation === "kegg" ? "" : " selected"}>Simple</option><option value="kegg"${view.notation === "kegg" ? " selected" : ""}>KEGG</option></select>${icon("chevron-down")}</span></div>
              <div class="ics-rels" role="group" aria-label="Relationship type for new connections" data-studio-rels>${relationshipButtons()}</div>
            </details>
            <details class="ics-sec" open><summary class="ics-sech">Annotations</summary><div class="ics-tiles">
              <button type="button" class="ics-tile" draggable="true" data-studio-action="insert-text" data-studio-drag="text">${icon("type")}<span>Text</span></button>
              <button type="button" class="ics-tile" draggable="true" data-studio-action="insert-note" data-studio-drag="note">${icon("sticky-note")}<span>Note</span></button>
              <button type="button" class="ics-tile" draggable="true" data-studio-action="insert-molecule" data-studio-drag="molecule" title="A small molecule, an ion or a control variable">${MOLECULE_PREVIEW}<span>Molecule</span></button>
              <button type="button" class="ics-tile" draggable="true" data-studio-action="insert-gauge" data-studio-drag="gauge" title="A control variable with a low and a high end">${GAUGE_PREVIEW}<span>Gauge</span></button>
            </div></details>
          </div>
        </aside>
        <section class="ics-canvas-area" aria-label="Diagram canvas" data-studio-canvas-area>
          <canvas class="ics-ruler ics-ruler-top" data-studio-ruler="top" aria-hidden="true"></canvas>
          <canvas class="ics-ruler ics-ruler-left" data-studio-ruler="left" aria-hidden="true"></canvas>
          <span class="ics-ruler-corner" aria-hidden="true"></span>
          <div class="ics-canvas icono-studio-x6-canvas" data-studio-x6-canvas aria-label="Editable pathway diagram"></div>
          <div class="ics-empty" data-studio-empty hidden>
            <button type="button" class="ics-btn" data-studio-action="insert-gene">${icon("user-round-plus")}<span>Add genes</span></button>
            <button type="button" class="ics-btn" data-studio-action="templates">${icon("layout-template")}<span>Open template</span></button>
          </div>
          <div class="ics-minibar" role="toolbar" aria-label="Relationship" data-studio-minibar hidden>${minibarMarkup()}</div>
          <div class="ics-tooltip" role="tooltip" data-studio-tooltip hidden></div>
        </section>
        <aside class="ics-panel ics-format" aria-label="Format" data-studio-format>
          <div class="ics-sheet-head"><span>Format</span><button type="button" class="ics-tb" data-studio-action="toggle-format" aria-label="Close format">${icon("x")}</button></div>
          <div class="ics-format-body" data-studio-format-body></div>
        </aside>
      </div>
      <div class="ics-pagetabs" data-studio-pagetabs>
        <button type="button" class="ics-tb" data-studio-action="new-page" aria-label="New page" title="New page">${icon("plus")}</button>
        <div class="ics-pagetab-list" role="tablist" aria-label="Pages" data-studio-pagetab-list></div>
      </div>
      <footer class="ics-status">
        <span data-studio-selection-status>No selection</span>
        <span class="ics-status-coords" data-studio-coords>x 0  y 0</span>
        <span class="ics-status-grid" data-studio-grid-status></span>
        <span class="ics-status-message" data-icono-studio-status role="status" aria-live="polite"></span>
        <span class="ics-status-counts" data-studio-count></span>
        <span class="ics-status-zoom"><button type="button" class="ics-tb ics-tb-small" data-studio-action="zoom-out" aria-label="Zoom out">${icon("minus")}</button><input type="range" min="10" max="400" step="5" value="100" aria-label="Zoom" data-studio-zoom-slider><button type="button" class="ics-tb ics-tb-small" data-studio-action="zoom-in" aria-label="Zoom in">${icon("plus")}</button><span data-studio-zoom-label>100%</span></span>
      </footer>
      <div class="ics-popover-layer" data-studio-popover></div>
      <div class="ics-modal-layer" data-studio-modal></div>
      <input type="file" accept="application/json,.json" hidden data-studio-open-file>
    </main>`
}

/* ───────── chrome rendering ───────── */

function castMarkup() {
  const cast = currentDocument.nodes.filter((node) => node.type === "gene")
  if (!cast.length) return '<p class="ics-muted ics-small ics-empty-note">No genes yet.</p>'
  return cast
    .map(
      (node) =>
        `<button type="button" class="ics-cast-item${selectedIds.includes(node.id) ? " is-selected" : ""}" data-studio-select="${escapeHtml(node.id)}" aria-label="Select ${escapeHtml(node.symbol)}" title="${escapeHtml(node.symbol)}"><span class="ics-cast-portrait"><img src="${escapeHtml(node.asset.cdn_url || node.asset.immutable_url || node.asset.canonical_url)}" alt="" loading="lazy" decoding="async"/></span><span class="ics-cast-symbol">${escapeHtml(node.symbol)}</span></button>`,
    )
    .join("")
}

function pageTabsMarkup() {
  return workspace.pages
    .map((page) => {
      const active = page.id === workspace.active
      if (page.id === renamingPageId) {
        return `<input class="ics-pagetab-input" type="text" maxlength="${ICONOPLASM_DIAGRAM_LIMITS.titleLength}" value="${escapeHtml(page.title)}" aria-label="Page name" data-studio-page-rename="${escapeHtml(page.id)}">`
      }
      return `<span class="ics-pagetab-wrap${active ? " is-active" : ""}"><button type="button" role="tab" class="ics-pagetab" aria-selected="${active}" data-studio-page="${escapeHtml(page.id)}" title="Double-click to rename">${escapeHtml(page.title)}</button>${active ? `<button type="button" class="ics-tb ics-tb-small" data-studio-menu="page" aria-haspopup="menu" aria-expanded="false" aria-label="Page options">${icon("chevron-down")}</button>` : ""}</span>`
    })
    .join("")
}

function selectionDescription() {
  const items = selectedItems()
  if (!items.length) return "No selection"
  if (items.length > 1) return `${items.length} items`
  const item = items[0]
  if (item.type === "gene") return `Gene · ${item.symbol}`
  if (item.type === "text") return item.fill === "note" ? "Note" : "Text"
  if (item.type === "compartment") return `Compartment · ${item.label || item.shape}`
  if (item.type === "molecule") return `Molecule · ${item.label}`
  if (item.type === "gauge") return `Gauge · ${item.label}`
  return `${relationshipKind(item.kind).label} · ${edgeEndpoints(item)}`
}

function edgeEndpoints(edge) {
  const from = currentDocument.nodes.find((node) => node.id === edge.from)
  const to = currentDocument.nodes.find((node) => node.id === edge.to)
  return `${from?.symbol || from?.label || "?"} → ${to?.symbol || to?.label || "?"}`
}

function selectionTypes() {
  return new Set(selectedItems().map((item) => item.type))
}

function renderSaveState() {
  const saved = mountedRoot?.querySelector("[data-studio-saved]")
  if (!saved) return
  saved.textContent =
    saveState === "saving"
      ? "Saving…"
      : saveState === "unsaved"
        ? "Not saved: this browser blocks storage"
        : "All changes saved in this browser"
  saved.setAttribute("data-tone", saveState)
}

function renderChrome() {
  if (!mountedRoot) return
  const root = mountedRoot
  const nextCastKey = currentDocument.nodes
    .filter((node) => node.type === "gene")
    .map((node) => node.id + (selectedIds.includes(node.id) ? "*" : ""))
    .join(",")
  if (nextCastKey !== castKey) {
    castKey = nextCastKey
    const list = root.querySelector("[data-studio-cast-list]")
    if (list) list.innerHTML = castMarkup()
  }
  const cast = currentDocument.nodes.filter((node) => node.type === "gene").length
  const castCount = root.querySelector("[data-studio-cast-count]")
  if (castCount) castCount.textContent = String(cast)
  const nextPagesKey = JSON.stringify([
    workspace.active,
    renamingPageId,
    workspace.pages.map((page) => [page.id, page.title]),
  ])
  if (nextPagesKey !== pagesKey) {
    pagesKey = nextPagesKey
    const tabs = root.querySelector("[data-studio-pagetab-list]")
    if (tabs) tabs.innerHTML = pageTabsMarkup()
    const rename = root.querySelector("[data-studio-page-rename]")
    if (rename) {
      rename.focus()
      rename.select()
    }
  }
  const compartments = currentDocument.nodes.filter((node) => node.type === "compartment").length
  const count = root.querySelector("[data-studio-count]")
  if (count) {
    count.textContent = `${cast} gene${cast === 1 ? "" : "s"} · ${currentDocument.edges.length} relationship${currentDocument.edges.length === 1 ? "" : "s"}${compartments ? ` · ${compartments} compartment${compartments === 1 ? "" : "s"}` : ""}`
  }
  const empty = root.querySelector("[data-studio-empty]")
  if (empty) empty.hidden = currentDocument.nodes.length > 0
  const selectionStatus = root.querySelector("[data-studio-selection-status]")
  if (selectionStatus) selectionStatus.textContent = selectionDescription()
  const gridStatus = root.querySelector("[data-studio-grid-status]")
  if (gridStatus)
    gridStatus.textContent = `Grid ${editor?.gridStep?.() || 10} · Snap ${view.snap ? "on" : "off"}`
  const types = selectionTypes()
  const items = selectedItems()
  const nodeCount = items.filter((item) => item.type !== "relationship").length
  const needs = {
    selection: items.length > 0,
    text: types.has("text"),
    relationship: types.has("relationship"),
    colourable: types.has("relationship") || types.has("text") || types.has("compartment"),
    two: nodeCount >= 2,
    three: nodeCount >= 3,
  }
  for (const element of root.querySelectorAll("[data-studio-needs]")) {
    element.disabled = !needs[element.getAttribute("data-studio-needs")]
  }
  const undoButton = root.querySelector('.ics-toolbar [data-studio-action="undo"]')
  const redoButton = root.querySelector('.ics-toolbar [data-studio-action="redo"]')
  if (undoButton)
    undoButton.disabled = !undoStack.length && JSON.stringify(currentDocument) === lastSnapshot
  if (redoButton) redoButton.disabled = !redoStack.length
  const pressed = {
    library: view.library,
    format: view.format,
    rulers: view.rulers,
    grid: view.grid,
    snap: view.snap,
    "tool:select": view.tool === "select",
    "tool:pan": view.tool === "pan",
  }
  for (const element of root.querySelectorAll("[data-studio-pressed]")) {
    const value = Boolean(pressed[element.getAttribute("data-studio-pressed")])
    element.setAttribute("aria-pressed", String(value))
  }
  const edgeKinds = new Set(
    items.filter((item) => item.type === "relationship").map((item) => item.kind),
  )
  const shownKind = edgeKinds.size === 1 ? [...edgeKinds][0] : activeRelationshipKind
  for (const element of root.querySelectorAll('[data-studio-action^="kind:"]')) {
    const kind = element.getAttribute("data-studio-action").slice(5)
    element.setAttribute("aria-pressed", String(kind === shownKind))
  }
  const preview = root.querySelector("[data-studio-kind-preview]")
  if (preview && preview.getAttribute("data-kind") !== shownKind) {
    preview.setAttribute("data-kind", shownKind)
    preview.innerHTML = relationshipGlyph(shownKind) + icon("chevron-down")
  }
  const widths = items.filter((item) => item.type === "relationship").map((item) => item.width)
  const widthValue = root.querySelector("[data-studio-width-value]")
  if (widthValue)
    widthValue.textContent = String(widths.length === 1 ? widths[0] : widths[0] || 1.5)
  const shell = root.querySelector("[data-studio-root]")
  shell?.classList.toggle("has-library", view.library)
  shell?.classList.toggle("has-format", view.format)
  shell?.classList.toggle("has-rulers", view.rulers)
  const fullscreen = root.querySelector('[data-studio-action="fullscreen"]')
  if (fullscreen) {
    const active = window.document.fullscreenElement === root
    fullscreen.innerHTML = icon(active ? "minimize" : "maximize")
    fullscreen.setAttribute("aria-label", active ? "Exit fullscreen" : "Fullscreen")
  }
  renderSaveState()
  renderZoom()
}

function renderZoom() {
  const scale = editor?.view().scale || 1
  const percent = `${Math.round(scale * 100)}%`
  const label = mountedRoot?.querySelector("[data-studio-zoom-label]")
  if (label) label.textContent = percent
  const value = mountedRoot?.querySelector("[data-studio-zoom]")
  if (value) value.textContent = percent
  const slider = mountedRoot?.querySelector("[data-studio-zoom-slider]")
  if (slider && window.document.activeElement !== slider)
    slider.value = String(Math.round(scale * 100))
}

/* ───────── Format panel ───────── */

let fieldCounter = 0

function fieldId(field) {
  fieldCounter += 1
  return `ics-f-${field.replace(/[^a-z0-9]/gi, "-")}-${fieldCounter}`
}

// B-1051: the routing choices the arrow tab and the page's lines share, and
// the sides (yEd's "side at source / side at target").
const ROUTING_OPTIONS = [
  ["straight", icon("move-right"), "Straight"],
  ["orthogonal", icon("corner-down-right"), "Orthogonal"],
  ["curved", icon("spline"), "Curved"],
]
const SIDE_OPTIONS = [
  ["any", "Any"],
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["right", "Right"],
]

function fieldAttrs(field, target) {
  return `data-field="${escapeHtml(field)}" data-target="${escapeHtml(target)}"`
}

function row(label, control, id = "") {
  return `<div class="ics-row">${label ? `<label class="ics-lbl"${id ? ` for="${id}"` : ""}>${escapeHtml(label)}</label>` : ""}${control}</div>`
}

function section(title, body, extra = "") {
  return `<section class="ics-fsec">${title ? `<h3 class="ics-sech">${escapeHtml(title)}${extra}</h3>` : ""}${body}</section>`
}

function stepper({ field, target, value, min, max, step = 1, unit = "", label }) {
  const id = fieldId(field)
  return row(
    label,
    `<span class="ics-step"><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" ${fieldAttrs(field, target)}>${unit ? `<span class="ics-unit">${escapeHtml(unit)}</span>` : ""}<span class="ics-step-buttons"><button type="button" tabindex="-1" data-studio-step="1" aria-label="Increase">▲</button><button type="button" tabindex="-1" data-studio-step="-1" aria-label="Decrease">▼</button></span></span>`,
    id,
  )
}

function selectControl({ field, target, value, options, label, before = "" }) {
  const id = fieldId(field)
  return row(
    label,
    `<span class="ics-select">${before}<select id="${id}" ${fieldAttrs(field, target)}>${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}"${String(optionValue) === String(value) ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select>${icon("chevron-down")}</span>`,
    id,
  )
}

function segmented({ field, target, value, options, label }) {
  return row(
    label,
    `<span class="ics-seg" role="group" aria-label="${escapeHtml(label)}">${options.map(([optionValue, content, aria]) => `<button type="button" aria-pressed="${String(optionValue) === String(value)}" data-value="${escapeHtml(optionValue)}" ${fieldAttrs(field, target)}${aria ? ` aria-label="${escapeHtml(aria)}" title="${escapeHtml(aria)}"` : ""}>${content}</button>`).join("")}</span>`,
  )
}

function swatches({ field, target, value, label, defaultLabel = "Default" }) {
  const id = fieldId(field)
  return row(
    label,
    `<span class="ics-swatches" role="group" aria-label="${escapeHtml(label)}"><button type="button" class="ics-sw ics-sw-default" aria-pressed="${!value}" data-value="" ${fieldAttrs(field, target)} aria-label="${escapeHtml(defaultLabel)}" title="${escapeHtml(defaultLabel)}"></button>${LINE_COLOURS.map(([hex, name]) => `<button type="button" class="ics-sw" style="--sw:${hex}" aria-pressed="${value === hex}" data-value="${hex}" ${fieldAttrs(field, target)} aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"></button>`).join("")}<input id="${id}" class="ics-field ics-hex" type="text" maxlength="7" spellcheck="false" placeholder="#RRGGBB" value="${escapeHtml(value || "")}" aria-label="${escapeHtml(label)} hex" ${fieldAttrs(field, target)}></span>`,
  )
}

function checkbox({ field, target, checked, label }) {
  const id = fieldId(field)
  return `<div class="ics-row"><label class="ics-check" for="${id}"><input id="${id}" type="checkbox"${checked ? " checked" : ""} ${fieldAttrs(field, target)}><span>${escapeHtml(label)}</span></label></div>`
}

function rangeControl({ field, target, value, min, max, step, label, unit = "%", scale = 100 }) {
  const id = fieldId(field)
  return row(
    label,
    `<span class="ics-range"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}" ${fieldAttrs(field, target)}><output data-range-output="${escapeHtml(field)}">${Math.round(value * scale)} ${unit}</output></span>`,
    id,
  )
}

function textInput({ field, target, value, label, placeholder = "", maxlength, mono = false }) {
  const id = fieldId(field)
  return row(
    label,
    `<input id="${id}" class="ics-field${mono ? " ics-mono" : ""}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${maxlength ? ` maxlength="${maxlength}"` : ""} ${fieldAttrs(field, target)}>`,
    id,
  )
}

function textArea({ field, target, value, label, maxlength, rows = 3 }) {
  const id = fieldId(field)
  return `<div class="ics-row ics-row-stack"><label class="ics-lbl" for="${id}">${escapeHtml(label)}</label><textarea id="${id}" class="ics-field ics-textarea" rows="${rows}" maxlength="${maxlength}" ${fieldAttrs(field, target)}>${escapeHtml(value)}</textarea></div>`
}

function buttonRow(buttons) {
  return `<div class="ics-row ics-button-row">${buttons.map(([action, label, iconName, disabled]) => `<button type="button" class="ics-btn" data-studio-action="${action}"${disabled ? " disabled" : ""}>${iconName ? icon(iconName) : ""}<span>${escapeHtml(label)}</span></button>`).join("")}</div>`
}

function selectionKind() {
  const items = selectedItems()
  if (!items.length) return "diagram"
  if (items.length === 1) return items[0].type
  return items.every((item) => item.type === "relationship") ? "relationships" : "mixed"
}

const TABS = {
  diagram: [
    ["style", "Diagram"],
    ["arrange", "Arrange"],
    ["evidence", "Evidence"],
  ],
  gene: [
    ["style", "Style"],
    ["arrange", "Arrange"],
    ["evidence", "Evidence"],
  ],
  relationship: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
    ["evidence", "Evidence"],
  ],
  relationships: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
  ],
  text: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
  ],
  compartment: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
  ],
  molecule: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
  ],
  gauge: [
    ["style", "Style"],
    ["text", "Text"],
    ["arrange", "Arrange"],
  ],
  mixed: [["arrange", "Arrange"]],
}

function relationshipStyleTab(edge, target) {
  const kind = relationshipKind(edge.kind)
  const pattern = edge.pattern || (kind.dashed ? "dashed" : "solid")
  const single = target !== "selection"
  return [
    section(
      single ? "Relationship" : `${selectedIds.length} relationships`,
      [
        single ? `<p class="ics-muted ics-endpoints">${escapeHtml(edgeEndpoints(edge))}</p>` : "",
        selectControl({
          field: "kind",
          target,
          value: edge.kind,
          label: "Type",
          options: notationKinds(edge.kind).map((item) => [item.id, item.label]),
          before: `<span class="ics-select-glyph" data-studio-kind-glyph>${relationshipGlyph(edge.kind)}</span>`,
        }),
        single
          ? buttonRow([["reverse", "Reverse direction", "arrow-left-right", kind.head === "none"]])
          : "",
      ].join(""),
    ),
    section(
      "Line",
      [
        swatches({
          field: "color",
          target,
          value: edge.color,
          label: "Colour",
          defaultLabel: "Notation colour",
        }),
        segmented({
          field: "pattern",
          target,
          value: pattern,
          label: "Pattern",
          options: [
            ["solid", '<span class="ics-dash ics-dash-solid"></span>', "Solid"],
            ["dashed", '<span class="ics-dash ics-dash-dashed"></span>', "Dashed"],
            ["dotted", '<span class="ics-dash ics-dash-dotted"></span>', "Dotted"],
          ],
        }),
        stepper({
          field: "width",
          target,
          value: edge.width,
          min: 0.5,
          max: 8,
          step: 0.5,
          unit: "pt",
          label: "Width",
        }),
      ].join(""),
    ),
    section(
      "Waypoints",
      [
        // "Auto" follows the page's lines (Format → Diagram → Lines).
        segmented({
          field: "routing",
          target,
          value: edge.routing || "",
          label: "Routing",
          options: [["", "Auto", "Auto: the page's lines"], ...ROUTING_OPTIONS],
        }),
        `<div class="ics-pair">${selectControl({
          field: "source_side",
          target,
          value: edge.source_side || "",
          label: "Source side",
          options: [["", "Auto"], ...SIDE_OPTIONS],
        })}${selectControl({
          field: "target_side",
          target,
          value: edge.target_side || "",
          label: "Target side",
          options: [["", "Auto"], ...SIDE_OPTIONS],
        })}</div>`,
        selectControl({
          field: "jumps",
          target,
          value: edge.jumps,
          label: "Line jumps",
          options: [
            ["none", "None"],
            ["arc", "Arc"],
            ["gap", "Gap"],
            ["cubic", "Cubic"],
          ],
        }),
        single && edge.vertices.length
          ? buttonRow([["clear-waypoints", `Clear waypoints (${edge.vertices.length})`, ""]])
          : "",
        // draw.io's "Set as Default Style": this line's routing, sides and
        // T-bar become the page's lines, which every Auto line follows.
        single ? buttonRow([["set-default-lines", "Set as Default Style", ""]]) : "",
      ].join(""),
    ),
    section(
      "Line end",
      stepper({
        field: "head_size",
        target,
        value: edge.head_size,
        min: 4,
        max: 20,
        step: 1,
        unit: "pt",
        label: "Size",
      }) +
        // B-1050: "square" bends the last stretch so the line meets the
        // portrait perpendicular to its side; a T-bar then lies flat on it.
        segmented({
          field: "end",
          target,
          value: edge.end || "",
          label: "Meets portrait",
          options: [
            [
              "",
              "Auto",
              kind.head === "bar" ? "Auto: square, as for a T-bar" : "Auto: at the line's angle",
            ],
            ["square", "Square", "Square to the portrait's side"],
            ["free", "Angled", "At the line's own angle"],
          ],
        }),
    ),
    section(
      "",
      rangeControl({
        field: "opacity",
        target,
        value: edge.opacity,
        min: 0.1,
        max: 1,
        step: 0.05,
        label: "Opacity",
      }) +
        buttonRow([
          ["copy-style", "Copy style", "copy"],
          ["paste-style", "Paste style", "clipboard-paste", !styleClipboard],
        ]),
    ),
  ].join("")
}

function relationshipTextTab(edge, target) {
  return section(
    "Label",
    [
      target === "selection"
        ? ""
        : textInput({
            field: "label",
            target,
            value: edge.label,
            label: "Text",
            placeholder: "phosphorylates",
            maxlength: ICONOPLASM_DIAGRAM_LIMITS.labelLength,
          }),
      segmented({
        field: "label_position",
        target,
        value: edge.label_position,
        label: "Position",
        options: [
          ["above", "Above"],
          ["on", "On line"],
          ["below", "Below"],
        ],
      }),
      stepper({
        field: "label_size",
        target,
        value: edge.label_size,
        min: 8,
        max: 28,
        step: 1,
        unit: "pt",
        label: "Font size",
      }),
      checkbox({
        field: "label_background",
        target,
        checked: edge.label_background,
        label: "Label background",
      }),
    ].join(""),
  )
}

function arrangeTab(items, target) {
  const nodes = items.filter((item) => item.type !== "relationship")
  const single = nodes.length === 1 && items.length === 1 ? nodes[0] : null
  const parts = []
  if (single) {
    parts.push(
      section(
        "Position",
        `<div class="ics-pair">${stepper({ field: "x", target, value: single.x, min: 0, max: currentDocument.width, label: "Left" })}${stepper({ field: "y", target, value: single.y, min: 0, max: currentDocument.height, label: "Top" })}</div>`,
      ),
      section(
        "Size",
        single.type === "gene"
          ? `<div class="ics-pair">${stepper({ field: "width", target, value: single.width, min: 72, max: 240, label: "Width" })}<div class="ics-row"><span class="ics-lbl">Height</span><span class="ics-readout" data-readout="height">${single.height}</span></div></div>`
          : `<div class="ics-pair">${stepper({ field: "width", target, value: single.width, min: single.type === "text" ? 60 : 40, max: single.type === "text" ? 900 : 4000, label: "Width" })}${stepper({ field: "height", target, value: single.height, min: single.type === "text" ? 28 : 24, max: single.type === "text" ? 500 : 4000, label: "Height" })}</div>`,
      ),
    )
  }
  if (nodes.length >= 2) {
    parts.push(
      section(
        "Align",
        `<div class="ics-icon-grid">${[
          ["align:left", "align-start-vertical", "Align left"],
          ["align:center", "align-center-vertical", "Align center"],
          ["align:right", "align-end-vertical", "Align right"],
          ["align:top", "align-start-horizontal", "Align top"],
          ["align:middle", "align-center-horizontal", "Align middle"],
          ["align:bottom", "align-end-horizontal", "Align bottom"],
        ]
          .map(([action, iconName, label]) => toolButton(action, iconName, label))
          .join("")}</div>`,
      ),
      section(
        "Distribute",
        buttonRow([
          [
            "distribute:horizontal",
            "Horizontally",
            "align-horizontal-space-around",
            nodes.length < 3,
          ],
          ["distribute:vertical", "Vertically", "align-vertical-space-around", nodes.length < 3],
        ]),
      ),
    )
  }
  parts.push(
    section(
      "Order",
      buttonRow([
        ["to-front", "To front", "bring-to-front"],
        ["to-back", "To back", "send-to-back"],
      ]) +
        buttonRow([
          ["duplicate", "Duplicate", "copy-plus"],
          ["delete", "Delete", "trash-2"],
        ]),
    ),
  )
  return parts.join("")
}

function evidenceList(references) {
  if (!references.length)
    return '<p class="ics-muted ics-small">No references yet. Select a relationship and add a PMID, DOI or Reactome ID under Evidence.</p>'
  return `<ol class="ics-refs">${references
    .map(
      (reference) =>
        `<li><button type="button" class="ics-ref-edge" data-studio-select="${escapeHtml(reference.edge_id)}">${escapeHtml(reference.from)} ${relationshipGlyph(reference.kind)} ${escapeHtml(reference.to)}</button>${reference.reference ? `<span class="ics-ref-id">${reference.url ? `<a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.reference)}${icon("external-link")}</a>` : escapeHtml(reference.reference)}</span>` : ""}${reference.note ? `<span class="ics-ref-note">${escapeHtml(reference.note)}</span>` : ""}</li>`,
    )
    .join("")}</ol>`
}

function diagramTabs(tab) {
  if (tab === "arrange") {
    return section(
      "Layout",
      buttonRow([
        ["layout:horizontal", "Horizontal flow", "move-right"],
        ["layout:vertical", "Vertical flow", "corner-down-right"],
      ]) + buttonRow([["layout:grid", "Grid", "layout-grid"]]),
    )
  }
  if (tab === "evidence") {
    const references = diagramReferences(currentDocument)
    return (
      section(
        "References",
        evidenceList(references),
        `<span class="ics-sech-count">${references.length}</span>`,
      ) + (references.length ? buttonRow([["copy-references", "Copy references", "copy"]]) : "")
    )
  }
  const size = `${currentDocument.width}x${currentDocument.height}`
  return [
    section(
      "Page",
      [
        textInput({
          field: "title",
          target: "page",
          value: currentDocument.title,
          label: "Name",
          maxlength: ICONOPLASM_DIAGRAM_LIMITS.titleLength,
        }),
        selectControl({
          field: "preset",
          target: "page",
          value: PAGE_PRESETS.some(([value]) => value === size) ? size : "custom",
          label: "Paper size",
          options: [...PAGE_PRESETS, ["custom", "Custom"]],
        }),
        `<div class="ics-pair">${stepper({ field: "width", target: "page", value: currentDocument.width, min: 640, max: 12000, step: 10, unit: "px", label: "Width" })}${stepper({ field: "height", target: "page", value: currentDocument.height, min: 360, max: 12000, step: 10, unit: "px", label: "Height" })}</div>`,
        backgroundPicker(),
      ].join(""),
    ),
    section(
      "View",
      checkbox({ field: "view.grid", target: "view", checked: view.grid, label: "Grid" }) +
        checkbox({
          field: "view.snap",
          target: "view",
          checked: view.snap,
          label: "Snap to grid",
        }) +
        checkbox({ field: "view.rulers", target: "view", checked: view.rulers, label: "Ruler" }),
    ),
    section(
      "Notation",
      selectControl({
        field: "view.notation",
        target: "view",
        value: view.notation,
        label: "Relationships",
        options: [
          ["simple", "Simple"],
          ["kegg", "KEGG"],
        ],
      }) +
        `<p class="ics-muted ics-small">Glyphs follow KEGG pathway notation; Simple shows the main four.</p>`,
    ),
    linesSection(),
  ].join("")
}

// B-1051: the page's line style. A preset sets every field below it; changing
// one turns the preset to Custom, as Paper size does when a width is typed.
// Relationships follow these unless one is set by hand on the arrow tab.
function linesSection() {
  const lines = currentDocument.lines
  return section(
    "Lines",
    [
      selectControl({
        field: "lines.preset",
        target: "page",
        value: linesPreset(lines),
        label: "Preset",
        options: [...LINE_PRESET_NAMES, ["custom", "Custom"]],
      }),
      segmented({
        field: "lines.routing",
        target: "page",
        value: lines.routing,
        label: "Routing",
        options: ROUTING_OPTIONS,
      }),
      `<div class="ics-pair">${selectControl({
        field: "lines.source_side",
        target: "page",
        value: lines.source_side,
        label: "Source side",
        options: SIDE_OPTIONS,
      })}${selectControl({
        field: "lines.target_side",
        target: "page",
        value: lines.target_side,
        label: "Target side",
        options: SIDE_OPTIONS,
      })}</div>`,
      checkbox({
        field: "lines.spread",
        target: "page",
        checked: lines.spread,
        label: "Space ends evenly",
      }),
      segmented({
        field: "lines.tbar",
        target: "page",
        value: lines.tbar,
        label: "T-bars",
        options: [
          ["square", "Square", "Square to the portrait's side"],
          ["free", "Angled", "At the line's own angle"],
        ],
      }),
    ].join(""),
  )
}

// B-1050: named sheets first, then any colour from the system picker or a
// typed hex. A dark sheet turns the default ink light.
function backgroundPicker() {
  const value = currentDocument.background
  const hex = pageBackgroundColour(currentDocument)
  const id = fieldId("background")
  return row(
    "Background",
    `<span class="ics-swatches ics-bg-swatches" role="group" aria-label="Background">${PAGE_BACKGROUND_SWATCHES.map(([key, colour, name]) => `<button type="button" class="ics-sw" style="--sw:${colour}" aria-pressed="${value === key}" data-value="${key}" ${fieldAttrs("background", "page")} aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"></button>`).join("")}<input type="color" class="ics-colour-well" value="${hex}" title="Any colour" aria-label="Any background colour" ${fieldAttrs("background", "page")}><input id="${id}" class="ics-field ics-hex" type="text" maxlength="7" spellcheck="false" placeholder="#RRGGBB" value="${escapeHtml(hex)}" aria-label="Background hex" ${fieldAttrs("background", "page")}></span>`,
    id,
  )
}

function formatBody(kind, tab) {
  const items = selectedItems()
  const item = items[0]
  if (kind === "diagram") return diagramTabs(tab)
  if (tab === "arrange") return arrangeTab(items, items.length === 1 ? item.id : "selection")
  if (kind === "relationship" || kind === "relationships") {
    const target = kind === "relationship" ? item.id : "selection"
    if (tab === "text") return relationshipTextTab(item, target)
    if (tab === "evidence") {
      const url = referenceUrl(item.evidence.reference)
      return section(
        "Evidence",
        [
          textInput({
            field: "evidence.reference",
            target,
            value: item.evidence.reference,
            label: "Source",
            placeholder: "PMID, DOI or Reactome ID",
            maxlength: ICONOPLASM_DIAGRAM_LIMITS.referenceLength,
            mono: true,
          }),
          `<p class="ics-small ics-ref-link" data-studio-reference-link>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open source${icon("external-link")}</a>` : ""}</p>`,
          textArea({
            field: "evidence.note",
            target,
            value: item.evidence.note,
            label: "Note",
            maxlength: ICONOPLASM_DIAGRAM_LIMITS.noteLength,
          }),
        ].join(""),
      )
    }
    return relationshipStyleTab(item, target)
  }
  if (kind === "gene") {
    if (tab === "evidence") {
      const references = diagramReferences(currentDocument).filter(
        (reference) => reference.from === item.symbol || reference.to === item.symbol,
      )
      return (
        section(
          item.symbol,
          `<p class="ics-small" data-studio-gene-name>${escapeHtml(geneNames.get(item.symbol) || "")}</p>${buttonRow([["open-card", "Open card", "external-link"]])}`,
        ) + section("References", evidenceList(references))
      )
    }
    const incoming = currentDocument.edges.filter((edge) => edge.to === item.id).length
    const outgoing = currentDocument.edges.filter((edge) => edge.from === item.id).length
    return [
      section(
        "Gene",
        `<p class="ics-gene-head"><strong>${escapeHtml(item.symbol)}</strong><span class="ics-muted">${incoming} in · ${outgoing} out</span></p><p class="ics-small" data-studio-gene-name>${escapeHtml(geneNames.get(item.symbol) || "")}</p>`,
      ),
      section(
        "Size",
        segmented({
          field: "width",
          target: item.id,
          value: [88, 104, 132, 180].includes(item.width) ? item.width : "",
          label: "Preset",
          options: [
            [88, "S"],
            [104, "M"],
            [132, "L"],
            [180, "XL"],
          ],
        }) +
          stepper({
            field: "width",
            target: item.id,
            value: item.width,
            min: 72,
            max: 240,
            unit: "px",
            label: "Width",
          }),
      ),
    ].join("")
  }
  if (kind === "text") {
    if (tab === "text") {
      return section(
        "Text",
        [
          textArea({
            field: "text",
            target: item.id,
            value: item.text,
            label: "Content",
            maxlength: ICONOPLASM_DIAGRAM_LIMITS.textLength,
            rows: 4,
          }),
          stepper({
            field: "font_size",
            target: item.id,
            value: item.font_size,
            min: 8,
            max: 56,
            unit: "pt",
            label: "Font size",
          }),
          segmented({
            field: "align",
            target: item.id,
            value: item.align,
            label: "Align",
            options: [
              ["left", icon("align-start-vertical"), "Left"],
              ["center", icon("align-center-vertical"), "Center"],
              ["right", icon("align-end-vertical"), "Right"],
            ],
          }),
          checkbox({ field: "bold", target: item.id, checked: item.bold, label: "Bold" }),
          checkbox({ field: "italic", target: item.id, checked: item.italic, label: "Italic" }),
        ].join(""),
      )
    }
    return section(
      "Style",
      segmented({
        field: "fill",
        target: item.id,
        value: item.fill,
        label: "Fill",
        options: [
          ["none", "None"],
          ["paper", "Paper"],
          ["note", "Note"],
        ],
      }) +
        swatches({
          field: "color",
          target: item.id,
          value: item.color,
          label: "Font colour",
          defaultLabel: "Ink",
        }),
    )
  }
  if (kind === "molecule") {
    if (tab === "text") {
      return section(
        "Label",
        textInput({
          field: "label",
          target: item.id,
          value: item.label,
          label: "Text",
          placeholder: "PIP₃",
          maxlength: ICONOPLASM_DIAGRAM_LIMITS.labelLength,
        }) +
          stepper({
            field: "font_size",
            target: item.id,
            value: item.font_size,
            min: 8,
            max: 40,
            unit: "pt",
            label: "Font size",
          }),
      )
    }
    return section(
      "Molecule",
      swatches({
        field: "color",
        target: item.id,
        value: item.color,
        label: "Colour",
        defaultLabel: "Ink",
      }),
    )
  }
  if (kind === "gauge") {
    if (tab === "text") {
      return section(
        "Name",
        stepper({
          field: "font_size",
          target: item.id,
          value: item.font_size,
          min: 8,
          max: 40,
          unit: "pt",
          label: "Font size",
        }),
      )
    }
    const words = (field, label, placeholder) =>
      textInput({
        field,
        target: item.id,
        value: item[field],
        label,
        placeholder,
        maxlength: ICONOPLASM_DIAGRAM_LIMITS.labelLength,
      })
    return section(
      "Gauge",
      words("label", "Name", "PIP₃ : PIP₂") +
        words("low_label", "Low end", "LOW") +
        words("high_label", "High end", "HIGH") +
        selectControl({
          field: "needle",
          target: item.id,
          value: item.needle,
          label: "Needle",
          options: [
            ["low", "Low"],
            ["middle", "At threshold"],
            ["high", "High"],
          ],
        }) +
        swatches({
          field: "color",
          target: item.id,
          value: item.color,
          label: "Colour",
          defaultLabel: "Ink",
        }),
    )
  }
  if (kind === "compartment") {
    if (tab === "text") {
      return section(
        "Label",
        textInput({
          field: "label",
          target: item.id,
          value: item.label,
          label: "Text",
          maxlength: ICONOPLASM_DIAGRAM_LIMITS.labelLength,
        }),
      )
    }
    return section(
      "Compartment",
      selectControl({
        field: "shape",
        target: item.id,
        value: item.shape,
        label: "Shape",
        options: COMPARTMENT_SHAPES.map((shape) => [shape.id, shape.label]),
      }) +
        swatches({
          field: "color",
          target: item.id,
          value: item.color,
          label: "Line colour",
          defaultLabel: "Shape colour",
        }),
    )
  }
  return arrangeTab(items, "selection")
}

function renderFormat() {
  const body = mountedRoot?.querySelector("[data-studio-format-body]")
  if (!body) return
  const kind = selectionKind()
  const tabs = TABS[kind]
  const tab = tabs.some(([id]) => id === view.formatTab) ? view.formatTab : tabs[0][0]
  const focused = window.document.activeElement
  const focusField = body.contains(focused) ? focused.getAttribute("data-field") : ""
  body.innerHTML = `<div class="ics-ptabs" role="tablist" aria-label="Format">${tabs
    .map(
      ([id, label]) =>
        `<button type="button" role="tab" class="ics-ptab" aria-selected="${id === tab}" data-studio-format-tab="${id}">${escapeHtml(label)}</button>`,
    )
    .join("")}</div><div class="ics-pbody" role="tabpanel">${formatBody(kind, tab)}</div>`
  if (focusField) body.querySelector(`[data-field="${CSS.escape(focusField)}"]`)?.focus()
  const gene = selectedItem()
  if (gene?.type === "gene" && !geneNames.has(gene.symbol)) loadGeneName(gene.symbol)
}

function fieldValue(item, field) {
  if (field.startsWith("evidence.")) return item.evidence?.[field.slice(9)] ?? ""
  if (field === "lines.preset") return linesPreset(item.lines)
  if (field.startsWith("lines.")) return item.lines?.[field.slice(6)]
  // The page's paper size follows its width and height (auto layout widens it).
  if (field === "preset") {
    const size = `${item.width}x${item.height}`
    return PAGE_PRESETS.some(([value]) => value === size) ? size : "custom"
  }
  return item[field]
}

// Canvas edits (a drag, an undo) update the open panel in place. A control the
// person is using keeps its value.
function syncFormatValues() {
  const body = mountedRoot?.querySelector("[data-studio-format-body]")
  if (!body) return
  const active = window.document.activeElement
  for (const control of body.querySelectorAll("[data-field]")) {
    if (control === active) continue
    const target = control.getAttribute("data-target")
    const field = control.getAttribute("data-field")
    const item =
      target === "page"
        ? currentDocument
        : target === "view" || target === "selection"
          ? null
          : findItem(target)
    if (!item) continue
    const value = fieldValue(item, field)
    if (value === undefined) continue
    if (control.matches("input[type=number], input[type=text], textarea, select")) {
      if (String(control.value) !== String(value ?? "")) control.value = value ?? ""
    }
  }
  const height = body.querySelector('[data-readout="height"]')
  const item = selectedItem()
  if (height && item) height.textContent = String(item.height)
}

async function loadGeneName(symbol) {
  try {
    const payload = await publicationReader().search(symbol, { limit: 1, symbols: [symbol] })
    const gene = payload?.genes?.find((entry) => entry.symbol === symbol)
    geneNames.set(symbol, gene?.full_name || gene?.name || "")
  } catch (_error) {
    geneNames.set(symbol, "")
  }
  for (const element of mountedRoot?.querySelectorAll("[data-studio-gene-name]") || []) {
    if (selectedItem()?.symbol === symbol) element.textContent = geneNames.get(symbol)
  }
}

/* ───────── popover menus ───────── */

function check(value) {
  return value ? "true" : "false"
}

function menuItems(name) {
  const items = selectedItems()
  const types = selectionTypes()
  const nodes = items.filter((item) => item.type !== "relationship")
  const none = !items.length
  switch (name) {
    case "file":
      return [
        { action: "new-page", label: "New page" },
        { action: "duplicate-page", label: "Duplicate page" },
        { action: "rename-page", label: "Rename page…" },
        { action: "delete-page", label: "Delete page", disabled: workspace.pages.length < 2 },
        "-",
        { action: "templates", label: "New from template…" },
        { action: "open-json", label: "Import from device…" },
        { action: "save-json", label: "Save as JSON", shortcut: "Ctrl+S" },
        "-",
        { action: "export-png", label: "Export as PNG" },
        { action: "export-svg", label: "Export as SVG" },
        "-",
        { action: "page-setup", label: "Page setup…" },
      ]
    case "export":
      return [
        { action: "export-png", label: "PNG image (2×)" },
        { action: "export-svg", label: "SVG vector" },
        { action: "save-json", label: "JSON diagram file" },
      ]
    case "edit":
      return [
        {
          action: "undo",
          label: "Undo",
          shortcut: "Ctrl+Z",
          disabled: !undoStack.length && JSON.stringify(currentDocument) === lastSnapshot,
        },
        { action: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z", disabled: !redoStack.length },
        "-",
        { action: "cut", label: "Cut", shortcut: "Ctrl+X", disabled: none },
        { action: "copy", label: "Copy", shortcut: "Ctrl+C", disabled: none },
        { action: "paste", label: "Paste", shortcut: "Ctrl+V", disabled: !itemClipboard },
        { action: "duplicate", label: "Duplicate", shortcut: "Ctrl+D", disabled: !nodes.length },
        { action: "delete", label: "Delete", shortcut: "Delete", disabled: none },
        "-",
        { action: "select-genes", label: "Select genes", shortcut: "Ctrl+Shift+I" },
        { action: "select-relationships", label: "Select relationships", shortcut: "Ctrl+Shift+E" },
        { action: "select-all", label: "Select all", shortcut: "Ctrl+A" },
        { action: "select-none", label: "Select none", shortcut: "Ctrl+Shift+A", disabled: none },
        "-",
        { action: "copy-style", label: "Copy style", disabled: !types.has("relationship") },
        {
          action: "paste-style",
          label: "Paste style",
          disabled: !styleClipboard || !types.has("relationship"),
        },
      ]
    case "view":
      return [
        {
          action: "toggle-library",
          label: "Shapes",
          checked: view.library,
          shortcut: "Ctrl+Shift+K",
        },
        {
          action: "toggle-format",
          label: "Format",
          checked: view.format,
          shortcut: "Ctrl+Shift+P",
        },
        { action: "toggle-rulers", label: "Ruler", checked: view.rulers },
        { action: "toggle-grid", label: "Grid", checked: view.grid, shortcut: "Ctrl+Shift+G" },
        { action: "toggle-snap", label: "Snap to grid", checked: view.snap },
        "-",
        { heading: "Navigation mode" },
        {
          action: "navigation:auto",
          label: "Auto",
          radio: true,
          checked: view.navigation === "auto",
        },
        {
          action: "navigation:mouse",
          label: "Mouse",
          radio: true,
          checked: view.navigation === "mouse",
        },
        {
          action: "navigation:trackpad",
          label: "Trackpad",
          radio: true,
          checked: view.navigation === "trackpad",
        },
        "-",
        { action: "fit", label: "Reset view", shortcut: "Ctrl+Shift+H" },
        { action: "fit-selection", label: "Fit selection", disabled: none },
        { action: "zoom-in", label: "Zoom in", shortcut: "Ctrl+=" },
        { action: "zoom-out", label: "Zoom out", shortcut: "Ctrl+−" },
        { action: "zoom:1", label: "Actual size", shortcut: "Ctrl+0" },
        "-",
        { action: "toggle-dark", label: "Dark mode", checked: readEffectiveTheme() === "dark" },
        {
          action: "fullscreen",
          label: "Fullscreen",
          checked: window.document.fullscreenElement === mountedRoot,
        },
      ]
    case "insert":
      return [
        { action: "insert-gene", label: "Gene…", shortcut: "/" },
        { action: "insert-text", label: "Text" },
        { action: "insert-note", label: "Note" },
        { action: "insert-molecule", label: "Molecule" },
        { action: "insert-gauge", label: "Gauge" },
        "-",
        { heading: "Compartment" },
        ...COMPARTMENT_SHAPES.map((shape) => ({
          action: `insert-compartment:${shape.id}`,
          label: shape.label,
        })),
        "-",
        { action: "templates", label: "Template…" },
      ]
    case "compartment":
      return COMPARTMENT_SHAPES.map((shape) => ({
        action: `insert-compartment:${shape.id}`,
        label: shape.label,
        html: compartmentPreview(shape.id),
      }))
    case "arrange":
      return [
        { action: "to-front", label: "To front", shortcut: "Ctrl+Shift+F", disabled: none },
        { action: "to-back", label: "To back", shortcut: "Ctrl+Shift+B", disabled: none },
        {
          action: "reverse",
          label: "Reverse direction",
          disabled:
            items.length !== 1 ||
            items[0].type !== "relationship" ||
            relationshipKind(items[0].kind).head === "none",
        },
        "-",
        ...alignItems(nodes.length < 2),
        "-",
        {
          action: "distribute:horizontal",
          label: "Distribute horizontally",
          disabled: nodes.length < 3,
        },
        {
          action: "distribute:vertical",
          label: "Distribute vertically",
          disabled: nodes.length < 3,
        },
        "-",
        { heading: "Layout" },
        { action: "layout:horizontal", label: "Horizontal flow" },
        { action: "layout:vertical", label: "Vertical flow" },
        { action: "layout:grid", label: "Grid" },
      ]
    case "align":
      return alignItems(nodes.length < 2)
    case "distribute":
      return [
        {
          action: "distribute:horizontal",
          label: "Horizontally",
          icon: "align-horizontal-space-around",
        },
        { action: "distribute:vertical", label: "Vertically", icon: "align-vertical-space-around" },
      ]
    case "layout":
      return [
        { action: "layout:horizontal", label: "Horizontal flow", icon: "move-right" },
        { action: "layout:vertical", label: "Vertical flow", icon: "corner-down-right" },
        { action: "layout:grid", label: "Grid", icon: "layout-grid" },
      ]
    case "zoom":
      return [
        ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((scale) => ({
          action: `zoom:${scale}`,
          label: `${Math.round(scale * 100)}%`,
        })),
        "-",
        { action: "fit", label: "Fit page" },
        { action: "fit-selection", label: "Fit selection", disabled: none },
      ]
    case "fill":
      return [
        { action: "fill:none", label: "No fill" },
        { action: "fill:paper", label: "Paper" },
        { action: "fill:note", label: "Note" },
      ]
    case "line-colour":
      return [
        { action: "line-colour:", label: "Notation colour" },
        ...LINE_COLOURS.map(([hex, label]) => ({
          action: `line-colour:${hex}`,
          label,
          html: `<span class="ics-sw" style="--sw:${hex}" aria-hidden="true"></span>`,
        })),
      ]
    case "line-width":
      return [0.5, 1, 1.5, 2, 3, 4, 6].map((width) => ({
        action: `line-width:${width}`,
        label: `${width} pt`,
        html: `<span class="ics-width-line" style="--w:${width}px" aria-hidden="true"></span>`,
      }))
    case "routing":
      return [
        { action: "routing:", label: "Auto (page's lines)", icon: "spline" },
        { action: "routing:straight", label: "Straight", icon: "move-right" },
        { action: "routing:orthogonal", label: "Orthogonal", icon: "corner-down-right" },
        { action: "routing:curved", label: "Curved", icon: "spline" },
      ]
    case "kind":
      return notationKinds(selectedItem()?.kind).map((kind) => ({
        action: `kind:${kind.id}`,
        label: kind.label,
        html: relationshipGlyph(kind.id),
        shortcut: kind.key ? kind.key.toUpperCase() : "",
      }))
    case "page":
      return [
        { action: "rename-page", label: "Rename…" },
        { action: "duplicate-page", label: "Duplicate" },
        { action: "delete-page", label: "Delete", disabled: workspace.pages.length < 2 },
      ]
    case "help":
      return [
        { action: "tour", label: "Take the tour" },
        { action: "shortcuts", label: "Keyboard shortcuts" },
        {
          href: "https://www.kegg.jp/kegg/document/help_pathway.html",
          label: "KEGG pathway notation",
        },
        { href: "/license", label: "Using Iconoplasm characters" },
        { href: "/", label: "Iconoplasm home" },
      ]
    default:
      return []
  }
}

function alignItems(disabled) {
  return [
    ["left", "Align left", "align-start-vertical"],
    ["center", "Align center", "align-center-vertical"],
    ["right", "Align right", "align-end-vertical"],
    ["top", "Align top", "align-start-horizontal"],
    ["middle", "Align middle", "align-center-horizontal"],
    ["bottom", "Align bottom", "align-end-horizontal"],
  ].map(([mode, label, iconName]) => ({ action: `align:${mode}`, label, icon: iconName, disabled }))
}

function menuMarkup(name, items) {
  return `<div class="ics-menu" role="menu" aria-label="${escapeHtml(name)}" data-studio-menu-popup="${escapeHtml(name)}">${items
    .map((item) => {
      if (item === "-") return '<div class="ics-menu-sep" role="separator"></div>'
      if (item.heading)
        return `<div class="ics-menu-heading" role="presentation">${escapeHtml(item.heading)}</div>`
      const lead = item.html || (item.icon ? icon(item.icon) : "")
      const checked = item.checked === undefined ? "" : ` aria-checked="${check(item.checked)}"`
      const role =
        item.checked === undefined ? "menuitem" : item.radio ? "menuitemradio" : "menuitemcheckbox"
      const content = `<span class="ics-menu-lead">${item.checked ? "✓" : lead}</span><span class="ics-menu-label">${escapeHtml(item.label)}</span>${item.shortcut ? `<span class="ics-menu-key">${escapeHtml(item.shortcut)}</span>` : ""}`
      if (item.href) {
        const external = /^https?:/.test(item.href)
        return `<a role="menuitem" class="ics-menu-item" href="${escapeHtml(item.href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : " data-icono-nav"} tabindex="-1">${content}</a>`
      }
      return `<button type="button" role="${role}" class="ics-menu-item" data-studio-action="${escapeHtml(item.action)}"${checked}${item.disabled ? ' aria-disabled="true" disabled' : ""} tabindex="-1">${content}</button>`
    })
    .join("")}</div>`
}

function openPopover(trigger, name, { focusFirst = true } = {}) {
  closePopover({ restoreFocus: false })
  const layer = mountedRoot?.querySelector("[data-studio-popover]")
  if (!layer) return
  layer.innerHTML = menuMarkup(name, menuItems(name))
  const menu = layer.firstElementChild
  const anchor = trigger.getBoundingClientRect()
  const host = mountedRoot.getBoundingClientRect()
  menu.style.left = `${Math.max(4, anchor.left - host.left)}px`
  menu.style.top = `${anchor.bottom - host.top + 2}px`
  trigger.setAttribute("aria-expanded", "true")
  openMenu = { name, trigger }
  // Measuring forces layout synchronously, so the menu is placed (and flipped
  // to stay on screen) before the next paint.
  const box = menu.getBoundingClientRect()
  if (box.right > window.innerWidth - 4)
    menu.style.left = `${Math.max(4, window.innerWidth - box.width - 4 - host.left)}px`
  if (box.bottom > window.innerHeight - 4)
    menu.style.top = `${Math.max(4, anchor.top - host.top - box.height - 2)}px`
  if (focusFirst) menuFocusable(menu)[0]?.focus()
}

function menuFocusable(menu) {
  return [...menu.querySelectorAll(".ics-menu-item")].filter((item) => !item.disabled)
}

function closePopover({ restoreFocus = true } = {}) {
  if (!openMenu) return
  const { trigger } = openMenu
  trigger.setAttribute("aria-expanded", "false")
  const layer = mountedRoot?.querySelector("[data-studio-popover]")
  if (layer) layer.innerHTML = ""
  openMenu = null
  if (restoreFocus) trigger.focus()
}

function handleMenuKeydown(event) {
  if (!openMenu) return false
  const menu = mountedRoot.querySelector(".ics-menu")
  if (!menu) return false
  const items = menuFocusable(menu)
  const index = items.indexOf(window.document.activeElement)
  if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus()
  else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length]?.focus()
  else if (event.key === "Home") items[0]?.focus()
  else if (event.key === "End") items[items.length - 1]?.focus()
  else if (event.key === "Escape") closePopover()
  else if (event.key === "Tab") closePopover({ restoreFocus: false })
  else if (
    (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
    openMenu.trigger.matches(".ics-menu-trigger")
  ) {
    const triggers = [...mountedRoot.querySelectorAll(".ics-menu-trigger")]
    const at = triggers.indexOf(openMenu.trigger)
    const next =
      triggers[(at + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length]
    openPopover(next, next.getAttribute("data-studio-menu"))
  } else return false
  if (event.key !== "Tab") event.preventDefault()
  return true
}

function showShortcuts() {
  const rows = [
    ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
    ["Ctrl+C / Ctrl+X / Ctrl+V", "Copy / cut / paste"],
    ["Ctrl+D", "Duplicate"],
    ["Delete", "Delete selection"],
    ["Arrow keys", "Move 1 px (Shift: 10 px)"],
    ["Ctrl+A", "Select all"],
    ["/", "Search genes"],
    ["Ctrl+wheel", "Zoom"],
    ["Wheel / right-drag", "Pan"],
    ["Ctrl+Shift+H", "Reset view"],
    ["Ctrl+S", "Save as JSON"],
    ...RELATIONSHIP_KINDS.filter((kind) => kind.key).map((kind) => [
      kind.key.toUpperCase(),
      kind.label,
    ]),
  ]
  const layer = mountedRoot?.querySelector("[data-studio-popover]")
  if (!layer) return
  closePopover({ restoreFocus: false })
  layer.innerHTML = `<div class="ics-dialog" role="dialog" aria-modal="false" aria-labelledby="ics-shortcuts-title"><div class="ics-dialog-head"><h2 id="ics-shortcuts-title">Keyboard shortcuts</h2><button type="button" class="ics-tb" data-studio-action="close-dialog" aria-label="Close">${icon("x")}</button></div><dl class="ics-shortcuts">${rows.map(([keys, label]) => `<dt><kbd class="ics-kbd">${escapeHtml(keys)}</kbd></dt><dd>${escapeHtml(label)}</dd>`).join("")}</dl></div>`
  layer.querySelector('[data-studio-action="close-dialog"]')?.focus()
}

/* ───────── actions ───────── */

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function exportName(extension) {
  const parts = [
    slug(workspace.title),
    workspace.pages.length > 1 ? slug(currentDocument.title) : "",
  ]
  return `${parts.filter(Boolean).join("-") || "iconoplasm-diagram"}.${extension}`
}

function download(text, fileName, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = window.document.createElement("a")
  link.href = url
  link.download = fileName
  link.hidden = true
  window.document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function switchPage(pageId) {
  if (pageId === workspace.active) return
  pushSnapshot()
  syncWorkspacePage()
  workspace.active = pageId
  currentDocument = activePage()
  selectedIds = []
  resetHistory()
  storeWorkspace()
  await (await editorReady)?.setDocument(currentDocument, { fit: true })
  renderChrome()
  renderFormat()
}

async function replaceWorkspace(nextWorkspace, message) {
  pushSnapshot()
  workspace = createDiagramWorkspace(nextWorkspace)
  currentDocument = activePage()
  selectedIds = []
  resetHistory()
  storeWorkspace()
  await (await editorReady)?.setDocument(currentDocument, { fit: true })
  const title = mountedRoot?.querySelector("[data-studio-workspace-title]")
  if (title) title.value = workspace.title
  renderChrome()
  renderFormat()
  if (message) setStatus(message, "success")
}

async function insertNode(kind, at) {
  const centre = at || (await visibleCentre())
  let outcome
  if (kind === "gauge") {
    outcome = addGaugeNode(currentDocument, {
      label: "Variable",
      x: centre.x - 150,
      y: centre.y - 95,
    })
  } else if (kind === "molecule") {
    outcome = addMoleculeNode(currentDocument, {
      label: "Molecule",
      x: centre.x - 75,
      y: centre.y - 36,
    })
  } else if (kind === "text" || kind === "note") {
    outcome = addTextNode(currentDocument, {
      text: kind === "note" ? "Note" : "Text",
      fill: kind === "note" ? "note" : "none",
      width: kind === "note" ? 180 : 200,
      height: kind === "note" ? 110 : 44,
      font_size: kind === "note" ? 14 : 18,
      x: centre.x - 100,
      y: centre.y - 30,
    })
  } else {
    const shape = COMPARTMENT_SHAPES.find((item) => item.id === kind) || COMPARTMENT_SHAPES[1]
    outcome = addCompartmentNode(currentDocument, {
      shape: shape.id,
      x: centre.x - shape.width / 2,
      y: centre.y - shape.height / 2,
    })
  }
  selectedIds = [outcome.node.id]
  await commitDocument(outcome.document, { message: "Added." })
  if (kind === "text" || kind === "note") focusFormatField("text", "text")
  if (kind === "molecule") focusFormatField("text", "label")
  if (kind === "gauge") focusFormatField("style", "label")
}

// After a panel opens or closes the canvas changes size; on a phone, bring
// the selection back into the strip that is still visible.
function keepSelectionInView() {
  window.setTimeout(async () => {
    const instance = await editorReady
    instance?.refreshSize()
    // On a phone the canvas strip shrinks: keep the selection, or else the
    // whole sheet, in view.
    if (isPhone()) {
      if (selectedIds.length) instance?.zoomToSelection()
      else instance?.zoomToFit()
    }
    scheduleViewUpdate()
  }, 60)
}

function focusFormatField(tab, field) {
  view.formatTab = tab
  if (!view.format) {
    void setView("format", true)
    keepSelectionInView()
  }
  renderFormat()
  window.setTimeout(() => {
    const control = mountedRoot?.querySelector(`[data-studio-format-body] [data-field="${field}"]`)
    control?.focus()
    control?.select?.()
  }, 0)
}

async function openTemplate(id = "mechanism") {
  const template = diagramTemplate(id)
  if (!template) return
  setStatus(`Loading the ${template.name.toLowerCase()}…`)
  const payload = await resolveGeneAssets(templateSymbols(id))
  const page = buildTemplateDocument(id, resolvedAssetMap(payload), {
    documentId: currentDocument.id,
  })
  const message = `Opened the ${template.name.toLowerCase()}: ${template.subject}.`
  if (currentDocument.nodes.length) {
    syncWorkspacePage()
    const { workspace: next } = addWorkspacePage(workspace, page)
    await replaceWorkspace(next, `${message} It is on a new page.`)
    return
  }
  selectedIds = []
  await commitDocument(page, { fit: true, message })
}

function copySelection() {
  const items = selectedItems()
  if (!items.length) return false
  const nodeIds = new Set(
    items.filter((item) => item.type !== "relationship").map((item) => item.id),
  )
  const edges = currentDocument.edges.filter(
    (edge) => selectedIds.includes(edge.id) || (nodeIds.has(edge.from) && nodeIds.has(edge.to)),
  )
  itemClipboard = JSON.parse(
    JSON.stringify({
      nodes: currentDocument.nodes.filter((node) => nodeIds.has(node.id)),
      edges,
      allNodes: currentDocument.nodes.filter((node) =>
        edges.some((edge) => edge.from === node.id || edge.to === node.id),
      ),
    }),
  )
  return true
}

// Pasting onto another page brings the genes and their relationships along;
// on the same page a gene already present is reused, so only annotations and
// compartments are duplicated (a symbol appears once per page).
async function pasteClipboard(offset = 24) {
  if (!itemClipboard) return
  let next = cloneDiagramDocument(currentDocument)
  const idMap = new Map()
  const pasted = []
  for (const node of itemClipboard.nodes) {
    if (node.type === "gene") {
      const outcome = addGeneNode(next, {
        ...node,
        id: undefined,
        x: node.x + offset,
        y: node.y + offset,
      })
      next = outcome.document
      idMap.set(node.id, outcome.node.id)
      if (outcome.added) pasted.push(outcome.node.id)
    } else {
      const copy = { ...node, id: undefined, x: node.x + offset, y: node.y + offset }
      const outcome =
        node.type === "text" ? addTextNode(next, copy) : addCompartmentNode(next, copy)
      next = outcome.document
      idMap.set(node.id, outcome.node.id)
      pasted.push(outcome.node.id)
    }
  }
  for (const node of itemClipboard.allNodes) {
    if (idMap.has(node.id) || node.type !== "gene") continue
    const existing = next.nodes.find((item) => item.type === "gene" && item.symbol === node.symbol)
    if (existing) idMap.set(node.id, existing.id)
  }
  for (const edge of itemClipboard.edges) {
    const from = idMap.get(edge.from)
    const to = idMap.get(edge.to)
    if (!from || !to) continue
    if (next.edges.some((item) => item.from === from && item.to === to && item.kind === edge.kind))
      continue
    const outcome = connectGeneNodes(next, {
      ...edge,
      id: undefined,
      from,
      to,
      vertices: edge.vertices.map((point) => ({ x: point.x + offset, y: point.y + offset })),
    })
    next = outcome.document
    pasted.push(outcome.edge.id)
  }
  if (!pasted.length) {
    setStatus("Nothing new to paste: those genes are already on this page.")
    return
  }
  selectedIds = pasted
  await commitDocument(next, {
    message: `Pasted ${pasted.length} item${pasted.length === 1 ? "" : "s"}.`,
  })
}

async function deleteSelection() {
  if (!selectedIds.length) return
  let next = currentDocument
  for (const id of selectedIds) next = removeDiagramItem(next, id)
  selectedIds = []
  await commitDocument(next, { message: "Deleted." })
}

async function applyToSelection(patch, types = ["relationship"]) {
  const instance = await editorReady
  const targets = selectedItems().filter((item) => types.includes(item.type))
  if (!targets.length) {
    if (patch.kind) {
      activeRelationshipKind = patch.kind
      instance?.setRelationshipKind(patch.kind)
      renderChrome()
      setStatus(`New connections: ${relationshipKind(patch.kind).label}.`)
    }
    return
  }
  for (const item of targets) applyItemPatch(instance, item.id, patch)
  if (patch.kind) {
    activeRelationshipKind = patch.kind
    instance?.setRelationshipKind(patch.kind)
  }
  renderFormat()
}

function applyItemPatch(instance, id, patch) {
  const item = findItem(id)
  if (!item) return
  // The model normalizes first, so the canvas never receives an out-of-range value.
  const normalized = findIn(updateDiagramItem(currentDocument, id, patch), id)
  const changed = {}
  for (const key of Object.keys(patch)) changed[key] = normalized[key]
  if (patch.evidence) changed.evidence = normalized.evidence
  if (item.type === "gene" && patch.width !== undefined) changed.height = normalized.height
  if (instance?.updateItem(id, changed) === "replace") {
    commitDocument(updateDiagramItem(currentDocument, id, patch))
  }
}

function findIn(document, id) {
  return (
    document.nodes.find((item) => item.id === id) || document.edges.find((item) => item.id === id)
  )
}

async function setView(key, value) {
  view[key] = value
  // A phone has room for one sheet at a time.
  if (isPhone() && value && (key === "library" || key === "format"))
    view[key === "library" ? "format" : "library"] = false
  storeViewPreferences()
  const instance = await editorReady
  if (key === "grid") instance?.setGridVisible(value)
  if (key === "snap") instance?.setSnap(value)
  if (key === "navigation") instance?.setNavigation(value)
  if (key === "tool") instance?.setTool(value)
  if (key === "notation") {
    view.notation = value === "kegg" ? "kegg" : "simple"
    storeViewPreferences()
    const list = mountedRoot?.querySelector("[data-studio-rels]")
    if (list) list.innerHTML = relationshipButtons()
    const select = mountedRoot?.querySelector("[data-studio-notation]")
    if (select) select.value = view.notation
    renderFormat()
    scheduleViewUpdate()
  }
  renderChrome()
  if (key === "rulers") {
    instance?.refreshSize()
    scheduleViewUpdate()
  }
}

async function runAction(action) {
  const [name, argument = ""] = action.split(/:(.*)/s)
  const instance = await editorReady
  switch (name) {
    case "undo":
      return undo()
    case "redo":
      return redo()
    case "new-page": {
      pushSnapshot()
      syncWorkspacePage()
      const { workspace: next } = addWorkspacePage(workspace)
      return replaceWorkspace(next)
    }
    case "duplicate-page": {
      syncWorkspacePage()
      const { workspace: next } = addWorkspacePage(workspace, {
        ...cloneDiagramDocument(currentDocument),
        title: `${currentDocument.title} copy`,
      })
      return replaceWorkspace(next, "Duplicated the page.")
    }
    case "rename-page":
      renamingPageId = workspace.active
      return renderChrome()
    case "delete-page": {
      if (workspace.pages.length < 2) return
      const index = workspace.pages.findIndex((page) => page.id === workspace.active)
      const pages = workspace.pages.filter((page) => page.id !== workspace.active)
      return replaceWorkspace(
        { ...workspace, pages, active: pages[Math.max(0, index - 1)].id },
        `Deleted ${currentDocument.title}.`,
      )
    }
    case "open-json":
      return mountedRoot?.querySelector("[data-studio-open-file]")?.click()
    case "save-json":
      syncWorkspacePage()
      download(
        JSON.stringify({ ...workspace, notation: "KEGG pathway notation" }, null, 2),
        exportName("json"),
        "application/json",
      )
      return setStatus("Saved the diagram as JSON.", "success")
    case "export-svg":
      if (!currentDocument.nodes.length)
        return setStatus("Add at least one gene before exporting.", "error")
      await instance?.downloadSvg(exportName("svg"))
      return setStatus("Exported SVG.", "success")
    case "export-png":
      if (!currentDocument.nodes.length)
        return setStatus("Add at least one gene before exporting.", "error")
      setStatus("Drawing the PNG…")
      await instance?.downloadPng(exportName("png"))
      return setStatus("Exported PNG.", "success")
    case "page-setup":
      selectedIds = []
      instance?.select([])
      view.formatTab = "style"
      return focusFormatField("style", "preset")
    case "cut":
      if (copySelection()) await deleteSelection()
      return
    case "copy":
      if (copySelection()) setStatus("Copied.")
      return
    case "paste":
      return pasteClipboard()
    case "duplicate":
      if (copySelection()) await pasteClipboard()
      return
    case "delete":
      return deleteSelection()
    case "select-genes":
      return instance?.select(
        currentDocument.nodes.filter((node) => node.type === "gene").map((node) => node.id),
      )
    case "select-relationships":
      return instance?.select(currentDocument.edges.map((edge) => edge.id))
    case "select-all":
      return instance?.selectAll()
    case "select-none":
      return instance?.select([])
    case "copy-style": {
      const edge = selectedItems().find((item) => item.type === "relationship")
      if (!edge) return
      const {
        color,
        width,
        pattern,
        routing,
        source_side,
        target_side,
        end,
        jumps,
        head_size,
        opacity,
        label_position,
        label_size,
        label_background,
      } = edge
      styleClipboard = {
        color,
        width,
        pattern,
        routing,
        source_side,
        target_side,
        end,
        jumps,
        head_size,
        opacity,
        label_position,
        label_size,
        label_background,
      }
      renderFormat()
      return setStatus("Copied the style.")
    }
    case "paste-style":
      if (styleClipboard) await applyToSelection(styleClipboard)
      return
    case "navigation":
      if (NAVIGATION_MODES.includes(argument)) await setView("navigation", argument)
      return
    case "toggle-library":
    case "toggle-format":
    case "toggle-rulers":
    case "toggle-grid":
    case "toggle-snap": {
      const key = name.slice(7)
      await setView(key, !view[key])
      if (key === "library" || key === "format") keepSelectionInView()
      return
    }
    case "show-format":
      view.formatTab = "style"
      if (!view.format) await setView("format", true)
      renderFormat()
      return keepSelectionInView()
    case "tool":
      return setView("tool", argument === "pan" ? "pan" : "select")
    case "fit":
      return instance?.zoomToFit()
    case "fit-selection":
      return instance?.zoomToSelection()
    case "zoom-in":
      return instance?.zoomIn()
    case "zoom-out":
      return instance?.zoomOut()
    case "zoom":
      return instance?.zoomTo(Number(argument) || 1)
    case "fullscreen":
      if (window.document.fullscreenElement) await window.document.exitFullscreen?.()
      else await mountedRoot?.requestFullscreen?.()
      return
    case "toggle-dark":
      applyThemePreference(readEffectiveTheme() === "dark" ? "light" : "dark")
      return scheduleViewUpdate()
    case "insert-gene": {
      if (!view.library) await setView("library", true)
      const input = mountedRoot?.querySelector("#icono-studio-gene-input")
      input?.focus()
      return
    }
    case "insert-text":
      return insertNode("text")
    case "insert-note":
      return insertNode("note")
    case "insert-compartment":
      return insertNode(argument)
    case "insert-molecule":
      return insertNode("molecule")
    case "insert-gauge":
      return insertNode("gauge")
    case "template":
      return openTemplate(argument)
    case "templates":
      return openTemplateLibrary()
    case "close-templates":
      return closeTemplateLibrary()
    case "template-category":
      templateLibrary.category = argument
      templateLibrary.selected = visibleTemplates()[0]?.id || ""
      return renderTemplateLibrary()
    case "preview-template":
      templateLibrary.preview = argument
      templateLibrary.selected = argument
      return renderTemplateLibrary()
    case "close-template-preview":
      templateLibrary.preview = ""
      return renderTemplateLibrary()
    case "insert-template": {
      const id = templateLibrary.selected
      if (!id) return
      closeTemplateLibrary()
      return openTemplate(id)
    }
    case "template-egfr":
      return openTemplate("mechanism")
    case "tour":
      return startTour({ force: true })
    case "to-front":
      return instance?.order("front")
    case "to-back":
      return instance?.order("back")
    case "align":
      return instance?.align(argument)
    case "distribute":
      return instance?.distribute(argument)
    case "layout":
      return instance?.arrange(argument)
    case "kind":
      if (RELATIONSHIP_KIND_IDS.includes(argument)) await applyToSelection({ kind: argument })
      return
    case "line-colour":
      return applyToSelection({ color: argument }, ["relationship", "text", "compartment"])
    case "line-width":
      return applyToSelection({ width: Number(argument) })
    case "routing":
      return applyToSelection({ routing: argument })
    case "fill":
      return applyToSelection({ fill: argument }, ["text"])
    case "reverse": {
      const edge = selectedItem()
      if (edge?.type !== "relationship") return
      // B-1050: binding has no head, so reversing it changed nothing you could
      // see and read as a broken button.
      if (relationshipKind(edge.kind).head === "none")
        return setStatus(`${relationshipKind(edge.kind).label} has no direction to reverse.`)
      instance?.reverseEdge(edge.id)
      renderFormat()
      return setStatus(`Reversed: ${edgeEndpoints(findItem(edge.id) || edge)}.`, "success")
    }
    case "set-default-lines": {
      const edge = selectedItem()
      if (edge?.type !== "relationship") return
      const line = effectiveLine(edge, currentDocument.lines)
      const next = cloneDiagramDocument(currentDocument)
      next.lines = {
        ...next.lines,
        routing: line.routing,
        source_side: line.source_side,
        target_side: line.target_side,
        ...(relationshipKind(edge.kind).head === "bar" && line.end ? { tbar: line.end } : {}),
      }
      const index = next.edges.findIndex((item) => item.id === edge.id)
      next.edges[index] = {
        ...next.edges[index],
        routing: "",
        source_side: "",
        target_side: "",
        end: "",
      }
      await commitDocument(next)
      return setStatus("The page's lines now follow this relationship.", "success")
    }
    case "clear-waypoints": {
      const edge = selectedItem()
      if (edge?.type === "relationship") instance?.updateItem(edge.id, { vertices: [] })
      return renderFormat()
    }
    case "open-card": {
      const gene = selectedItem()
      if (gene?.type === "gene")
        window.open(`/gene/${encodeURIComponent(gene.symbol)}`, "_blank", "noopener")
      return
    }
    case "copy-references": {
      const text = diagramReferences(currentDocument)
        .map(
          (reference) =>
            `${reference.from} → ${reference.to} (${relationshipKind(reference.kind).label}): ${[reference.reference, reference.note].filter(Boolean).join(". ")}`,
        )
        .join("\n")
      await navigator.clipboard?.writeText(text)
      return setStatus("Copied the references.", "success")
    }
    case "shortcuts":
      return showShortcuts()
    case "close-dialog": {
      const layer = mountedRoot?.querySelector("[data-studio-popover]")
      if (layer) layer.innerHTML = ""
      return
    }
    default:
      return undefined
  }
}

/* ───────── selection ───────── */

async function selectItems(ids, options = {}) {
  const next = (Array.isArray(ids) ? ids : [ids]).filter((id) => id && findItem(id))
  const same =
    next.length === selectedIds.length && next.every((id, index) => id === selectedIds[index])
  selectedIds = next
  const only = selectedItem()
  if (only?.type === "relationship") {
    activeRelationshipKind = only.kind
    editor?.setRelationshipKind(only.kind)
  }
  if (options.canvas !== false) (await editorReady)?.select(selectedIds)
  if (!same) {
    renderChrome()
    renderFormat()
  }
  if (options.edit) {
    const item = selectedItem()
    if (item?.type === "text") focusFormatField("text", "text")
    if (item?.type === "relationship") focusFormatField("text", "label")
  }
  scheduleViewUpdate()
}

/* ───────── canvas overlays: rulers, mini toolbar, tooltip ───────── */

function scheduleViewUpdate() {
  if (viewFrame) return
  viewFrame = requestAnimationFrame(() => {
    viewFrame = 0
    // The snap step follows the zoom (B-1050), so the status bar does too.
    const gridStatus = mountedRoot?.querySelector("[data-studio-grid-status]")
    if (gridStatus)
      gridStatus.textContent = `Grid ${editor?.gridStep?.() || 10} · Snap ${view.snap ? "on" : "off"}`
    renderZoom()
    drawRulers()
    placeMinibar()
  })
}

function rulerStep(scale) {
  for (const step of [5, 10, 20, 50, 100, 200, 500, 1000, 2000]) if (step * scale >= 56) return step
  return 5000
}

function drawRulers() {
  if (!mountedRoot || !editor || !view.rulers) return
  const area = mountedRoot.querySelector("[data-studio-canvas-area]")
  const canvasHost = mountedRoot.querySelector("[data-studio-x6-canvas]")
  if (!area || !canvasHost) return
  const styles = window.getComputedStyle(area)
  const ink = styles.getPropertyValue("--ics-muted").trim() || "#7a6e64"
  const { scale, tx, ty } = editor.view()
  const ratio = window.devicePixelRatio || 1
  const major = rulerStep(scale)
  const minor = major / ((major * scale) / 10 >= 6 ? 10 : 5)
  for (const ruler of mountedRoot.querySelectorAll("[data-studio-ruler]")) {
    const horizontal = ruler.getAttribute("data-studio-ruler") === "top"
    const length = horizontal ? canvasHost.clientWidth : canvasHost.clientHeight
    const thickness = 18
    ruler.width = Math.max(1, Math.round((horizontal ? length : thickness) * ratio))
    ruler.height = Math.max(1, Math.round((horizontal ? thickness : length) * ratio))
    const context = ruler.getContext("2d")
    if (!context) continue
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, horizontal ? length : thickness, horizontal ? thickness : length)
    context.strokeStyle = ink
    context.fillStyle = ink
    context.lineWidth = 1
    context.font = '9px "IBM Plex Sans", sans-serif'
    const offset = horizontal ? tx : ty
    const start = Math.floor(-offset / scale / minor) * minor
    const end = (length - offset) / scale
    context.beginPath()
    for (let value = start; value <= end; value += minor) {
      const at = Math.round(offset + value * scale) + 0.5
      const isMajor = Math.abs(value / major - Math.round(value / major)) < 1e-6
      const tick = isMajor ? 8 : Math.abs((value / (major / 2)) % 1) < 1e-6 ? 5 : 3
      if (horizontal) {
        context.moveTo(at, thickness)
        context.lineTo(at, thickness - tick)
        if (isMajor) context.fillText(String(Math.round(value)), at + 2, 9)
      } else {
        context.moveTo(thickness, at)
        context.lineTo(thickness - tick, at)
        if (isMajor) {
          context.save()
          context.translate(9, at + 2)
          context.rotate(-Math.PI / 2)
          context.fillText(String(Math.round(value)), 0, 0)
          context.restore()
        }
      }
    }
    context.stroke()
  }
}

function placeMinibar() {
  const bar = mountedRoot?.querySelector("[data-studio-minibar]")
  if (!bar || !editor) return
  const item = selectedItem()
  const anchor = item?.type === "relationship" ? editor.edgeAnchor(item.id) : null
  if (!anchor) {
    bar.hidden = true
    return
  }
  const canvas = mountedRoot.querySelector("[data-studio-x6-canvas]")
  const area = mountedRoot.querySelector("[data-studio-canvas-area]")
  bar.hidden = false
  const offsetX = canvas.offsetLeft
  const offsetY = canvas.offsetTop
  const nextMarkup = minibarMarkup()
  if (bar.getAttribute("data-markup") !== nextMarkup) {
    bar.innerHTML = nextMarkup
    bar.setAttribute("data-markup", nextMarkup)
  }
  const width = bar.offsetWidth
  const height = bar.offsetHeight || 36
  const left = Math.min(area.clientWidth - width - 6, Math.max(6, offsetX + anchor.x - width / 2))
  // B-1050: the bar used to sit over the two genes a short relationship joins.
  // Try above the line, then below, and keep the first spot clear of both.
  const ends = [item.from, item.to].map((id) => editor.nodeRect(id)).filter(Boolean)
  const clear = (candidate) =>
    !ends.some(
      (rect) =>
        offsetX + rect.x < left + width &&
        left < offsetX + rect.x + rect.width &&
        offsetY + rect.y < candidate + height &&
        candidate < offsetY + rect.y + rect.height,
    )
  const above = offsetY + anchor.y - height - 16
  const below = offsetY + anchor.y + 16
  const top = Math.max(offsetY + 6, [above, below].find(clear) ?? above)
  bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
}

function showTooltip(nodeId) {
  window.clearTimeout(hoverTimer)
  const tooltip = mountedRoot?.querySelector("[data-studio-tooltip]")
  if (!tooltip) return
  if (!nodeId) {
    tooltip.hidden = true
    return
  }
  hoverTimer = window.setTimeout(async () => {
    const node = findItem(nodeId)
    const rect = editor?.nodeRect(nodeId)
    if (!node || !rect || !mountedRoot) return
    if (!geneNames.has(node.symbol)) await loadGeneName(node.symbol)
    const incoming = currentDocument.edges.filter((edge) => edge.to === nodeId).length
    const outgoing = currentDocument.edges.filter((edge) => edge.from === nodeId).length
    tooltip.innerHTML = `<strong>${escapeHtml(node.symbol)}</strong><span>${escapeHtml(geneNames.get(node.symbol) || "")}</span><span class="ics-tooltip-meta">${incoming} in · ${outgoing} out</span>`
    const canvas = mountedRoot.querySelector("[data-studio-x6-canvas]")
    const area = mountedRoot.querySelector("[data-studio-canvas-area]")
    tooltip.hidden = false
    const width = tooltip.offsetWidth
    let left = canvas.offsetLeft + rect.x + rect.width + 10
    if (left + width > area.clientWidth - 6) left = canvas.offsetLeft + rect.x - width - 10
    const top = Math.min(
      area.clientHeight - tooltip.offsetHeight - 6,
      Math.max(6, canvas.offsetTop + rect.y),
    )
    tooltip.style.transform = `translate(${Math.round(Math.max(6, left))}px, ${Math.round(top)}px)`
  }, 320)
}

/* ───────── search ───────── */

function closeStudioSearch() {
  studioSearchResults = []
  activeStudioSearchIndex = -1
  const input = mountedRoot?.querySelector("#icono-studio-gene-input")
  const results = mountedRoot?.querySelector("[data-studio-gene-results]")
  if (input) {
    input.setAttribute("aria-expanded", "false")
    input.removeAttribute("aria-activedescendant")
  }
  if (results) results.innerHTML = ""
}

function highlightStudioSearch() {
  const input = mountedRoot?.querySelector("#icono-studio-gene-input")
  const items = [...(mountedRoot?.querySelectorAll("[data-studio-search-result]") || [])]
  items.forEach((item, index) => {
    const active = index === activeStudioSearchIndex
    item.classList.toggle("active", active)
    item.setAttribute("aria-selected", String(active))
  })
  if (input && activeStudioSearchIndex >= 0 && items[activeStudioSearchIndex])
    input.setAttribute("aria-activedescendant", items[activeStudioSearchIndex].id)
  else input?.removeAttribute("aria-activedescendant")
}

function renderStudioSearchResults(genes) {
  const input = mountedRoot?.querySelector("#icono-studio-gene-input")
  const results = mountedRoot?.querySelector("[data-studio-gene-results]")
  if (!input || !results) return
  studioSearchResults = genes
  activeStudioSearchIndex = -1
  input.setAttribute("aria-expanded", String(genes.length > 0))
  input.removeAttribute("aria-activedescendant")
  results.innerHTML = genes
    .map(
      (gene, index) =>
        `<button type="button" class="icono-search-result" id="icono-studio-search-result-${index}" role="option" aria-selected="false" draggable="true" data-studio-drag="gene:${escapeHtml(gene.symbol)}" data-studio-search-result data-studio-add-symbol="${escapeHtml(gene.symbol)}"><span class="icono-search-result-media icono-search-result-media--portrait"><img class="icono-search-result-portrait icono-thumbnail-viewport-image" src="${escapeHtml(gene.pt || gene.ph || "")}" alt="" loading="eager" decoding="async"></span><span class="icono-search-result-copy"><span class="icono-search-result-symbol">${escapeHtml(gene.symbol)}</span><span class="icono-search-result-name">${escapeHtml(gene.full_name || "")}</span></span></button>`,
    )
    .join("")
  for (const gene of genes) if (gene.full_name) geneNames.set(gene.symbol, gene.full_name)
}

async function refreshStudioSearch(query) {
  const requestId = ++studioSearchRequest
  if (!query || /[\s,;]/.test(query)) {
    closeStudioSearch()
    return
  }
  const payload = await searchPublishedGenes(query, { limit: 8 }).catch(() => null)
  if (requestId !== studioSearchRequest) return
  if (!payload) {
    closeStudioSearch()
    return
  }
  renderStudioSearchResults(payload.genes || [])
}

/* ───────── event handlers ───────── */

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"))
}

function handleStudioInput(event) {
  if (event.target.matches("#icono-studio-gene-input")) {
    window.clearTimeout(studioSearchTimer)
    studioSearchTimer = window.setTimeout(
      () => refreshStudioSearch(event.target.value.trim()),
      SEARCH_DEBOUNCE_MS,
    )
    return
  }
  if (event.target.matches("[data-studio-template-search]") && templateLibrary) {
    templateLibrary.query = event.target.value
    const visible = visibleTemplates()
    if (!visible.some((template) => template.id === templateLibrary.selected))
      templateLibrary.selected = visible[0]?.id || ""
    const grid = mountedRoot.querySelector("[data-studio-template-grid]")
    if (grid) grid.innerHTML = templateTilesMarkup()
    const insert = mountedRoot.querySelector(
      '[data-studio-template-library] .ics-library-dialog-actions [data-studio-action="insert-template"]',
    )
    if (insert) insert.disabled = !templateLibrary.selected
    return
  }
  if (event.target.matches("[data-studio-zoom-slider]")) {
    editor?.zoomTo(Number(event.target.value) / 100)
    return
  }
  // Live controls (sliders, colour hex, text) preview on input; numbers and
  // selects commit on change.
  if (
    event.target.matches(
      'input[type="range"][data-field], input[type="text"][data-field], textarea[data-field]',
    )
  ) {
    void handleField(event.target)
  }
}

function handleStudioKeydown(event) {
  if (event.target.matches(".ics-menu-trigger") && !openMenu) {
    const triggers = [...mountedRoot.querySelectorAll(".ics-menu-trigger")]
    const at = triggers.indexOf(event.target)
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault()
      triggers[
        (at + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length
      ].focus()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      openPopover(event.target, event.target.getAttribute("data-studio-menu"))
    }
    return
  }
  if (event.target.matches("#icono-studio-gene-input")) {
    if (event.key === "ArrowDown" && studioSearchResults.length) {
      event.preventDefault()
      activeStudioSearchIndex = Math.min(
        activeStudioSearchIndex + 1,
        studioSearchResults.length - 1,
      )
      highlightStudioSearch()
    } else if (event.key === "ArrowUp" && studioSearchResults.length) {
      event.preventDefault()
      activeStudioSearchIndex = Math.max(activeStudioSearchIndex - 1, 0)
      highlightStudioSearch()
    } else if (event.key === "Enter") {
      event.preventDefault()
      const value = event.target.value.trim()
      if (studioSearchResults.length && !/[\s,;]/.test(value)) {
        const selected = studioSearchResults[Math.max(0, activeStudioSearchIndex)]
        mountedRoot
          ?.querySelector(`[data-studio-add-symbol="${CSS.escape(selected.symbol)}"]`)
          ?.click()
      } else if (value) {
        addResolvedGenes(value)
          .then(() => {
            event.target.value = ""
            closeStudioSearch()
          })
          .catch((error) => setStatus(error.message, "error"))
      }
    } else if (event.key === "Escape") {
      closeStudioSearch()
    }
    return
  }
  if (event.target.matches("[data-studio-page-rename]")) {
    if (event.key === "Enter") event.target.blur()
    if (event.key === "Escape") {
      renamingPageId = ""
      renderChrome()
    }
  }
}

// The studio owns the whole window while it is open, so its shortcuts listen
// on the document. Typing in a field never triggers one.
function handleShortcut(event) {
  if (!mountedRoot) return
  if (handleTemplateLibraryKeydown(event)) return
  if (templateLibrary) return
  if (handleMenuKeydown(event)) return
  const dialog = mountedRoot.querySelector(".ics-dialog")
  if (dialog && event.key === "Escape") {
    event.preventDefault()
    mountedRoot.querySelector("[data-studio-popover]").innerHTML = ""
    return
  }
  if (isTypingTarget(event.target)) return
  if (event.target.closest?.("dialog")) return
  const key = event.key
  const mod = event.ctrlKey || event.metaKey
  const lower = key.length === 1 ? key.toLowerCase() : key
  const bindings = [
    [mod && !event.shiftKey && lower === "z", "undo"],
    [mod && ((event.shiftKey && lower === "z") || lower === "y"), "redo"],
    [mod && lower === "c", "copy"],
    [mod && lower === "x", "cut"],
    [mod && lower === "v", "paste"],
    [mod && lower === "d", "duplicate"],
    [mod && lower === "s", "save-json"],
    [mod && !event.shiftKey && lower === "a", "select-all"],
    [mod && event.shiftKey && lower === "a", "select-none"],
    [mod && event.shiftKey && lower === "i", "select-genes"],
    [mod && event.shiftKey && lower === "e", "select-relationships"],
    [mod && event.shiftKey && lower === "f", "to-front"],
    [mod && event.shiftKey && lower === "b", "to-back"],
    [mod && event.shiftKey && lower === "g", "toggle-grid"],
    [mod && event.shiftKey && lower === "h", "fit"],
    [mod && event.shiftKey && lower === "k", "toggle-library"],
    [mod && event.shiftKey && lower === "p", "toggle-format"],
    [mod && (key === "=" || key === "+"), "zoom-in"],
    [mod && key === "-", "zoom-out"],
    [mod && key === "0", "zoom:1"],
    [!mod && (key === "Delete" || key === "Backspace"), "delete"],
    [!mod && key === "/", "insert-gene"],
    [!mod && key === "Escape", "select-none"],
  ]
  let action = bindings.find(([matches]) => matches)?.[1]
  if (!action && !mod && !event.altKey && /^Arrow/.test(key) && selectedIds.length) {
    const step = event.shiftKey ? 10 : 1
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0
    event.preventDefault()
    editor?.nudge(dx, dy)
    return
  }
  if (!action && !mod && !event.altKey && key.length === 1) {
    const kind = RELATIONSHIP_KINDS.find((item) => item.key === lower)
    if (kind) action = `kind:${kind.id}`
  }
  if (!action) return
  event.preventDefault()
  void runAction(action)
}

function handleOutsidePointer(event) {
  if (!mountedRoot) return
  if (!event.target.closest(".icono-studio-search")) closeStudioSearch()
  if (openMenu && !event.target.closest(".ics-menu") && !event.target.closest("[data-studio-menu]"))
    closePopover({ restoreFocus: false })
  const dialog = mountedRoot.querySelector(".ics-dialog")
  if (
    dialog &&
    !event.target.closest(".ics-dialog") &&
    !event.target.closest("[data-studio-action='shortcuts']")
  )
    mountedRoot.querySelector("[data-studio-popover]").innerHTML = ""
}

async function handleStudioClick(event) {
  const menuTrigger = event.target.closest("[data-studio-menu]")
  if (menuTrigger) {
    const name = menuTrigger.getAttribute("data-studio-menu")
    if (openMenu?.trigger === menuTrigger) closePopover()
    else openPopover(menuTrigger, name, { focusFirst: event.detail === 0 })
    return
  }
  const formatTab = event.target.closest("[data-studio-format-tab]")
  if (formatTab) {
    view.formatTab = formatTab.getAttribute("data-studio-format-tab")
    renderFormat()
    mountedRoot.querySelector(`[data-studio-format-tab="${view.formatTab}"]`)?.focus()
    return
  }
  const stepButton = event.target.closest("[data-studio-step]")
  if (stepButton) {
    const input = stepButton.closest(".ics-step")?.querySelector("input")
    if (input) {
      if (stepButton.getAttribute("data-studio-step") === "1") input.stepUp()
      else input.stepDown()
      await handleField(input)
    }
    return
  }
  const segmentButton = event.target.closest(
    ".ics-seg [data-field], .ics-swatches button[data-field]",
  )
  if (segmentButton) {
    await handleField(segmentButton)
    return
  }
  const page = event.target.closest("[data-studio-page]")
  if (page) {
    if (event.detail >= 2) {
      renamingPageId = page.getAttribute("data-studio-page")
      renderChrome()
    } else {
      await switchPage(page.getAttribute("data-studio-page"))
    }
    return
  }
  const addSymbol = event.target.closest("[data-studio-add-symbol]")
  if (addSymbol) {
    try {
      await addResolvedGenes(addSymbol.getAttribute("data-studio-add-symbol"))
      closeStudioSearch()
      const input = mountedRoot?.querySelector("#icono-studio-gene-input")
      if (input) input.value = ""
    } catch (error) {
      setStatus(error.message, "error")
    }
    return
  }
  const tile = event.target.closest("[data-studio-template]")
  if (tile && !event.target.closest("[data-studio-action]")) {
    templateLibrary.selected = tile.getAttribute("data-studio-template")
    if (event.detail >= 2) return runAction("insert-template")
    renderTemplateLibrary({ focus: "tile" })
    return
  }
  const selection = event.target.closest("[data-studio-select]")
  if (selection) {
    await selectItems([selection.getAttribute("data-studio-select")])
    if (event.detail >= 2) (await editorReady)?.zoomToSelection()
    return
  }
  const action = event.target.closest("[data-studio-action]")
  if (!action || action.disabled) return
  const name = action.getAttribute("data-studio-action")
  if (openMenu && action.closest(".ics-menu"))
    closePopover({ restoreFocus: !name.startsWith("insert-gene") })
  try {
    await runAction(name)
  } catch (error) {
    setStatus(error.message, "error")
  }
}

function parseFieldValue(control) {
  const field = control.getAttribute("data-field")
  if (control.matches("button")) {
    const value = control.getAttribute("data-value")
    return ["width"].includes(field) && value !== "" ? Number(value) : value
  }
  if (control.type === "checkbox") return control.checked
  if (control.type === "number" || control.type === "range") return Number(control.value)
  return control.value
}

async function handleField(control) {
  const field = control.getAttribute("data-field")
  const target = control.getAttribute("data-target")
  let value = parseFieldValue(control)
  if (target === "view") return setView(field.slice(5), value)
  if (target === "page") return applyPageField(field, value)
  if (field === "color" && control.matches("input") && value && !/^#[0-9a-f]{6}$/i.test(value))
    return
  if (field === "color" && control.matches("button")) {
    for (const sibling of control.parentElement.querySelectorAll("button"))
      sibling.setAttribute("aria-pressed", String(sibling === control))
    const hex = control.parentElement.querySelector(".ics-hex")
    if (hex) hex.value = value
  }
  if (control.matches(".ics-seg button")) {
    if (field === "width" && value === "") return
    for (const sibling of control.parentElement.querySelectorAll("button"))
      sibling.setAttribute("aria-pressed", String(sibling === control))
  }
  if (control.type === "range") {
    const output = control.parentElement.querySelector("output")
    if (output) output.textContent = `${Math.round(value * 100)} %`
  }
  const patch = field.startsWith("evidence.")
    ? { evidence: { [field.slice(9)]: value } }
    : { [field]: value }
  const instance = await editorReady
  const ids = target === "selection" ? selectedIds : [target]
  for (const id of ids) {
    const item = findItem(id)
    if (!item) continue
    if (field === "shape") {
      await commitDocument(updateDiagramItem(currentDocument, id, patch))
      continue
    }
    applyItemPatch(instance, id, patch)
  }
  if (field === "kind") {
    activeRelationshipKind = value
    instance?.setRelationshipKind(value)
    const glyph = mountedRoot.querySelector("[data-studio-kind-glyph]")
    if (glyph) glyph.innerHTML = relationshipGlyph(value)
  }
  if (["routing", "kind"].includes(field)) renderFormat()
  // A committed control (stepper, select, toggle) is one undo step on its
  // own; sliders and typing coalesce into one step per burst.
  if (!control.matches('input[type="range"], input[type="text"], textarea')) {
    recordChange({ immediate: true })
  }
  if (field === "evidence.reference") {
    const link = mountedRoot.querySelector("[data-studio-reference-link]")
    const url = referenceUrl(value)
    if (link)
      link.innerHTML = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open source${icon("external-link")}</a>`
        : ""
  }
}

async function applyPageField(field, value) {
  if (field === "title") {
    const next = cloneDiagramDocument(currentDocument)
    next.title = value
    currentDocument = createDiagramDocument(next)
    syncWorkspacePage()
    storeWorkspace()
    recordChange()
    pagesKey = ""
    renderChrome()
    return
  }
  const next = cloneDiagramDocument(currentDocument)
  if (field === "preset") {
    if (value === "custom") return
    const [width, height] = value.split("x").map(Number)
    next.width = width
    next.height = height
  } else if (field === "width" || field === "height") {
    next[field] = value
  } else if (field === "background") {
    const named = PAGE_BACKGROUND_SWATCHES.some(([key]) => key === value)
    if (!named && !/^#[0-9a-f]{6}$/i.test(String(value))) return
    next.background = String(value).toLowerCase()
  } else if (field === "lines.preset") {
    if (!LINE_PRESETS[value]) return
    next.lines = { ...LINE_PRESETS[value] }
  } else if (field.startsWith("lines.")) {
    next.lines = { ...next.lines, [field.slice(6)]: value }
  }
  await commitDocument(next, { fit: field !== "background" && !field.startsWith("lines.") })
}

async function handleStudioChange(event) {
  const target = event.target
  if (target.matches("[data-studio-workspace-title]")) {
    workspace.title = target.value.trim() || "Untitled diagram"
    storeWorkspace()
    return
  }
  if (target.matches("[data-studio-open-file]")) {
    const file = target.files?.[0]
    target.value = ""
    if (!file) return
    try {
      const raw = JSON.parse(await file.text())
      const imported = createDiagramWorkspace(raw)
      syncWorkspacePage()
      let next = workspace
      let added = 0
      for (const page of imported.pages) {
        if (next.pages.length >= ICONOPLASM_DIAGRAM_LIMITS.pages) break
        next = addWorkspacePage(next, { ...page }).workspace
        added += 1
      }
      await replaceWorkspace(
        next,
        `Imported ${added} page${added === 1 ? "" : "s"} from ${file.name}.`,
      )
    } catch (error) {
      setStatus(`Could not import ${file.name}: ${error.message}`, "error")
    }
    return
  }
  if (target.matches("[data-studio-page-rename]")) return
  if (target.matches("[data-studio-notation]")) return setView("notation", target.value)
  if (target.matches('[data-field]:not([type="range"]):not([type="text"]):not(textarea)')) {
    await handleField(target)
  }
}

async function handleStudioFocusOut(event) {
  const target = event.target
  if (target.matches("[data-studio-page-rename]")) {
    const id = target.getAttribute("data-studio-page-rename")
    const title = target.value.trim()
    renamingPageId = ""
    if (title) {
      syncWorkspacePage()
      workspace.pages = workspace.pages.map((page) => (page.id === id ? { ...page, title } : page))
      if (id === currentDocument.id) currentDocument = activePage()
      storeWorkspace()
    }
    renderChrome()
    if (id === currentDocument.id) syncFormatValues()
  }
  if (target.matches('input[type="text"][data-field], textarea[data-field]'))
    recordChange({ immediate: true })
}

async function handleStudioSubmit(event) {
  if (!event.target.matches("[data-studio-gene-form]")) return
  event.preventDefault()
  const input = event.target.elements.symbols
  try {
    await addResolvedGenes(input.value)
    input.value = ""
  } catch (error) {
    setStatus(error.message, "error")
  }
}

function handleDragStart(event) {
  const source = event.target.closest?.("[data-studio-drag]")
  if (!source || !event.dataTransfer) return
  event.dataTransfer.setData(
    "application/x-iconoplasm-studio",
    source.getAttribute("data-studio-drag"),
  )
  event.dataTransfer.effectAllowed = "copy"
}

function handleDragOver(event) {
  if (!event.target.closest?.("[data-studio-canvas-area]")) return
  if ([...(event.dataTransfer?.types || [])].includes("application/x-iconoplasm-studio")) {
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }
}

async function handleDrop(event) {
  if (!event.target.closest?.("[data-studio-canvas-area]")) return
  const payload = event.dataTransfer?.getData("application/x-iconoplasm-studio")
  if (!payload) return
  event.preventDefault()
  const instance = await editorReady
  const at = instance?.clientToLocal(event.clientX, event.clientY)
  const [kind, value] = payload.split(":")
  try {
    if (kind === "gene") await addResolvedGenes(value, { at })
    else if (kind === "compartment") await insertNode(value, at)
    else await insertNode(kind, at)
  } catch (error) {
    setStatus(error.message, "error")
  }
}

function handleFullscreenChange() {
  renderChrome()
  window.dispatchEvent(new Event("resize"))
}

function handleThemeChange() {
  scheduleViewUpdate()
}

/* ───────── template library ───────── */

// B-1050: templates open in a library dialog, as in draw.io (Arrange > Insert >
// Template), BioRender and Lucidchart: categories with counts on the left
// under a search box, a grid of pictures of each template with a magnifier for
// a larger look, Cancel and Insert at the bottom. A click selects, a
// double-click or Enter inserts. Words are draw.io's.
let templateLibrary = null

function templateCategories() {
  const categories = []
  for (const template of DIAGRAM_TEMPLATES) {
    const known = categories.find((entry) => entry.name === template.category)
    if (known) known.count += 1
    else categories.push({ name: template.category, count: 1 })
  }
  return [{ name: "All", count: DIAGRAM_TEMPLATES.length }, ...categories]
}

function visibleTemplates() {
  if (!templateLibrary) return []
  const query = templateLibrary.query.trim().toLowerCase()
  return DIAGRAM_TEMPLATES.filter(
    (template) =>
      (templateLibrary.category === "All" || template.category === templateLibrary.category) &&
      (!query || `${template.name} ${template.subject}`.toLowerCase().includes(query)),
  )
}

function templateTilesMarkup() {
  const templates = visibleTemplates()
  if (!templates.length)
    return '<p class="ics-muted ics-small ics-template-none">No templates found.</p>'
  return templates
    .map((template) => {
      const selected = template.id === templateLibrary.selected
      return `<div class="ics-template-tile" role="option" tabindex="${selected ? 0 : -1}" aria-selected="${selected}" data-studio-template="${template.id}" title="${escapeHtml(`${template.name}: ${template.subject}`)}"><img src="${escapeHtml(templateThumbnail(template.id))}" alt="" loading="lazy" decoding="async" draggable="false"><span class="ics-template-title"><span>${escapeHtml(template.name)}</span><small>${escapeHtml(template.subject)}</small></span><button type="button" class="ics-template-zoom" data-studio-action="preview-template:${template.id}" aria-label="Preview ${escapeHtml(template.name)}" title="Preview">${icon("search")}</button></div>`
    })
    .join("")
}

function renderTemplateLibrary({ focus = "" } = {}) {
  const layer = mountedRoot?.querySelector("[data-studio-modal]")
  if (!layer) return
  if (!templateLibrary) {
    layer.innerHTML = ""
    return
  }
  const preview = templateLibrary.preview ? diagramTemplate(templateLibrary.preview) : null
  layer.innerHTML = `<div class="ics-modal-backdrop" data-studio-action="close-templates"></div><div class="ics-library-dialog" role="dialog" aria-modal="true" aria-label="Templates" data-studio-template-library><button type="button" class="ics-tb ics-library-close" data-studio-action="close-templates" aria-label="Close" title="Close">${icon("x")}</button><div class="ics-library-dialog-body"><nav class="ics-library-dialog-nav" aria-label="Template categories"><span class="ics-field ics-search-field">${icon("search")}<input type="search" placeholder="Search" aria-label="Search templates" value="${escapeHtml(templateLibrary.query)}" data-studio-template-search></span><div class="ics-library-dialog-categories">${templateCategories()
    .map(
      (category) =>
        `<button type="button" class="ics-library-category" aria-pressed="${category.name === templateLibrary.category}" data-studio-action="template-category:${escapeHtml(category.name)}">${escapeHtml(category.name)} (${category.count})</button>`,
    )
    .join(
      "",
    )}</div></nav><div class="ics-library-dialog-grid" role="listbox" aria-label="Templates" data-studio-template-grid>${templateTilesMarkup()}</div></div><div class="ics-library-dialog-actions"><button type="button" class="ics-btn" data-studio-action="close-templates">Cancel</button><button type="button" class="ics-btn ics-btn-pri" data-studio-action="insert-template"${templateLibrary.selected ? "" : " disabled"}>Insert</button></div>${
    preview
      ? `<div class="ics-template-preview" role="dialog" aria-label="${escapeHtml(preview.name)} preview"><img src="${escapeHtml(templateThumbnail(preview.id))}" alt="${escapeHtml(`${preview.name}: ${preview.subject}`)}"><div class="ics-template-preview-bar"><span><strong>${escapeHtml(preview.name)}</strong> ${escapeHtml(preview.subject)}</span><button type="button" class="ics-btn" data-studio-action="close-template-preview">Close</button><button type="button" class="ics-btn ics-btn-pri" data-studio-action="insert-template">Insert</button></div></div>`
      : ""
  }</div>`
  if (focus === "search") {
    const search = layer.querySelector("[data-studio-template-search]")
    search?.focus()
    search?.setSelectionRange(search.value.length, search.value.length)
  } else if (focus === "tile") {
    layer.querySelector('.ics-template-tile[aria-selected="true"]')?.focus()
  }
}

function openTemplateLibrary() {
  closePopover({ restoreFocus: false })
  templateLibrary = { category: "All", query: "", selected: DIAGRAM_TEMPLATES[0].id, preview: "" }
  renderTemplateLibrary({ focus: "search" })
}

function closeTemplateLibrary() {
  templateLibrary = null
  renderTemplateLibrary()
  mountedRoot?.querySelector('.ics-toolbar [data-studio-action="templates"]')?.focus()
}

function handleTemplateLibraryKeydown(event) {
  if (!templateLibrary) return false
  if (event.key === "Escape") {
    event.preventDefault()
    if (templateLibrary.preview) {
      templateLibrary.preview = ""
      renderTemplateLibrary({ focus: "tile" })
    } else closeTemplateLibrary()
    return true
  }
  if (event.key === "Enter" && !event.target.closest?.("button")) {
    event.preventDefault()
    void runAction("insert-template")
    return true
  }
  const moves = { ArrowRight: 1, ArrowDown: 3, ArrowLeft: -1, ArrowUp: -3 }
  if (moves[event.key] && !event.target.matches?.("[data-studio-template-search]")) {
    const templates = visibleTemplates()
    const at = templates.findIndex((template) => template.id === templateLibrary.selected)
    const next = templates[Math.min(templates.length - 1, Math.max(0, at + moves[event.key]))]
    if (next) {
      event.preventDefault()
      templateLibrary.selected = next.id
      renderTemplateLibrary({ focus: "tile" })
    }
    return true
  }
  // Everything else stays inside the dialog: no canvas shortcuts behind it.
  return !isTypingTarget(event.target) && event.key.length === 1
}

/* ───────── first-run tour ───────── */

// B-1050: a short spotlight tour, one lit element at a time on a dimmed
// screen, each step something to do. It runs once per browser, can be closed
// at any step, and Help replays it. Steps whose element is hidden (a closed
// panel, a phone sheet) are left out rather than lighting an empty corner.
const TOUR_STEPS = [
  [
    '.ics-toolbar [data-studio-action="templates"]',
    "Start from a template",
    "Open the template library: a faction chart, a control variable chart or a mechanism chart, ready for your own genes.",
    "bottom",
  ],
  [
    ".ics-library-search",
    "Add genes",
    "Type a symbol or alias. Click a result to place it, or drag it onto the sheet.",
    "right",
  ],
  [
    "[data-studio-x6-canvas]",
    "Draw relationships",
    "Hover a portrait, then drag from one of its dots to another portrait. Scroll to pan; Ctrl+scroll zooms.",
    "left",
  ],
  [
    "[data-studio-rels-section]",
    "Pick the arrow",
    "New relationships use the arrow picked here. Simple keeps the main four; KEGG lists all fourteen.",
    "right",
  ],
  [
    "[data-studio-format]",
    "Style the selection",
    "Colour, line ends, labels and evidence for whatever you select. With nothing selected, the page itself.",
    "left",
  ],
  [
    '[data-studio-menu="export"]',
    "Export",
    "Save the page as a PNG or SVG figure, or as JSON to keep editing it later.",
    "bottom",
  ],
]

function tourSeen() {
  try {
    return window.localStorage.getItem(TOUR_KEY) === "done"
  } catch (_error) {
    return true
  }
}

function markTourSeen() {
  try {
    window.localStorage.setItem(TOUR_KEY, "done")
  } catch (_error) {
    // Without storage the tour may show again next visit; it can be closed.
  }
}

function ensureTourStylesheet() {
  if (window.document.querySelector("link[data-studio-tour-stylesheet]")) return
  const link = window.document.createElement("link")
  link.rel = "stylesheet"
  link.href = TOUR_STYLESHEET_URL
  link.setAttribute("data-studio-tour-stylesheet", "")
  window.document.head.append(link)
}

async function startTour({ force = false } = {}) {
  if (!mountedRoot || (!force && (tourSeen() || isPhone()))) return
  const steps = TOUR_STEPS.map(([selector, title, description, side]) => ({
    element: mountedRoot.querySelector(selector),
    popover: { title, description, side, align: "start" },
  })).filter(({ element }) => element && element.getClientRects().length > 0)
  if (!steps.length) return
  closePopover({ restoreFocus: false })
  ensureTourStylesheet()
  const { driver } = await import(TOUR_RUNTIME_URL)
  const tour = driver({
    steps,
    showProgress: true,
    progressText: "{{current}} of {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    overlayColor: "#20120b",
    overlayOpacity: 0.72,
    stagePadding: 6,
    stageRadius: 6,
    allowClose: true,
    smoothScroll: true,
    popoverClass: "ics-tour",
    // driver.js 1.8 calls onDestroyed only while a step is active, so a tour
    // closed during a step change (Escape right after Next) came back on the next
    // visit. onDestroyStarted runs on every close (Escape, the overlay, ×, Done);
    // it has to finish the close itself, and destroy() doesn't call it again.
    onDestroyStarted: () => {
      markTourSeen()
      tour.destroy()
    },
  })
  tour.drive()
}

/* ───────── mount ───────── */

function ensureStylesheet() {
  if (window.document.querySelector(`link[data-studio-stylesheet]`)?.href === STYLESHEET_URL) return
  window.document.querySelector("link[data-studio-stylesheet]")?.remove()
  const link = window.document.createElement("link")
  link.rel = "stylesheet"
  link.href = STYLESHEET_URL
  link.setAttribute("data-studio-stylesheet", "")
  window.document.head.append(link)
}

export function renderDiagramStudio(root) {
  ensureStylesheet()
  workspace = null
  ensureState()
  selectedIds = []
  castKey = ""
  pagesKey = ""
  resetHistory()
  mountedRoot = root
  mountedRoot.innerHTML = studioMarkup()
  mountedRoot.addEventListener("click", handleStudioClick)
  mountedRoot.addEventListener("submit", handleStudioSubmit)
  mountedRoot.addEventListener("change", handleStudioChange)
  mountedRoot.addEventListener("input", handleStudioInput)
  mountedRoot.addEventListener("keydown", handleStudioKeydown)
  mountedRoot.addEventListener("focusout", handleStudioFocusOut)
  mountedRoot.addEventListener("dragstart", handleDragStart)
  mountedRoot.addEventListener("dragover", handleDragOver)
  mountedRoot.addEventListener("drop", handleDrop)
  window.document.addEventListener("keydown", handleShortcut)
  window.document.addEventListener("pointerdown", handleOutsidePointer)
  window.document.addEventListener("fullscreenchange", handleFullscreenChange)
  window.document.addEventListener("themechange", handleThemeChange)
  renderChrome()
  renderFormat()

  const container = mountedRoot.querySelector("[data-studio-x6-canvas]")
  const studioRoot = mountedRoot.querySelector("[data-studio-root]")
  editorReady = createDiagramEditor({
    container,
    sizeHost: mountedRoot.querySelector("[data-studio-canvas-area]"),
    document: currentDocument,
    gridVisible: view.grid,
    snap: view.snap,
    navigationMode: view.navigation,
    onChange: acceptEditorDocument,
    onSelect(ids, options) {
      selectItems(ids, { canvas: false, edit: options?.edit })
    },
    onView: scheduleViewUpdate,
    onPointer(point) {
      pointer = point
      const coords = mountedRoot?.querySelector("[data-studio-coords]")
      if (coords) coords.textContent = `x ${pointer.x}  y ${pointer.y}`
    },
    onHover: showTooltip,
  })
    .then((instance) => {
      editor = instance
      instance.setRelationshipKind(activeRelationshipKind)
      instance.setTool(view.tool)
      renderChrome()
      scheduleViewUpdate()
      studioRoot?.setAttribute("data-ready", "true")
      if (!tourSeen()) window.setTimeout(() => void startTour(), 700)
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
  mountedRoot.removeEventListener("input", handleStudioInput)
  mountedRoot.removeEventListener("keydown", handleStudioKeydown)
  mountedRoot.removeEventListener("focusout", handleStudioFocusOut)
  mountedRoot.removeEventListener("dragstart", handleDragStart)
  mountedRoot.removeEventListener("dragover", handleDragOver)
  mountedRoot.removeEventListener("drop", handleDrop)
  window.document.removeEventListener("keydown", handleShortcut)
  window.document.removeEventListener("pointerdown", handleOutsidePointer)
  window.document.removeEventListener("fullscreenchange", handleFullscreenChange)
  window.document.removeEventListener("themechange", handleThemeChange)
  window.clearTimeout(studioSearchTimer)
  window.clearTimeout(hoverTimer)
  pushSnapshot()
  if (window.document.fullscreenElement) void window.document.exitFullscreen?.()
  editor?.dispose()
  editor = null
  editorReady = null
  openMenu = null
  templateLibrary = null
  mountedRoot = null
}

/* ───────── WebMCP ───────── */

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
  ensureState()
  const genes = Array.isArray(input.genes)
    ? input.genes.slice(0, ICONOPLASM_DIAGRAM_LIMITS.nodes)
    : []
  const symbols = genes.map((gene) => normalizeGeneSymbol(gene && gene.symbol)).filter(Boolean)
  if (!symbols.length) throw new TypeError("genes must contain at least one valid symbol.")
  ensureStudioOpen()
  setStatus(`The agent is assembling ${symbols.length} gene characters…`)
  const payload = await resolveGeneAssets(symbols)
  const assets = resolvedAssetMap(payload)
  let next = createDiagramDocument({
    id: currentDocument.id,
    title: input.title || "Untitled pathway",
  })
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
  for (const compartment of Array.isArray(input.compartments) ? input.compartments : []) {
    next = addCompartmentNode(next, compartment).document
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
      evidence: { reference: relationship.reference, note: relationship.note },
    }).document
  }
  selectedIds = []
  await commitDocument(next, {
    fit: true,
    message: `The agent created an editable diagram with ${next.nodes.length} items.`,
  })
  if (input.layout !== "manual") {
    await (await editorReady)?.arrange(input.layout === "vertical" ? "vertical" : "horizontal")
  }
  return cloneDiagramDocument(currentDocument)
}

async function editFromTool(input) {
  ensureState()
  const operations = Array.isArray(input.operations)
    ? input.operations.slice(0, ICONOPLASM_DIAGRAM_LIMITS.nodes)
    : []
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
  const geneBy = (value) =>
    next.nodes.find(
      (item) =>
        item.type === "gene" && (item.id === value || item.symbol === normalizeGeneSymbol(value)),
    )
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
          x: operation.x,
          y: operation.y,
        }).document
    } else if (operation.type === "add_text") {
      next = addTextNode(next, operation).document
    } else if (operation.type === "add_compartment") {
      next = addCompartmentNode(next, operation).document
    } else if (operation.type === "update_text") {
      next = updateDiagramItem(next, operation.item_id, {
        text: operation.text,
        font_size: operation.font_size,
        align: operation.align,
      })
    } else if (operation.type === "remove_gene") {
      const node = geneBy(operation.gene)
      if (node) next = removeDiagramItem(next, node.id)
    } else if (operation.type === "move_gene" || operation.type === "move_item") {
      const node =
        next.nodes.find((item) => item.id === (operation.item_id || operation.gene)) ||
        geneBy(operation.gene)
      if (node) next = updateDiagramItem(next, node.id, { x: operation.x, y: operation.y })
    } else if (operation.type === "connect") {
      const from = geneBy(operation.from)
      const to = geneBy(operation.to)
      if (from && to && from.id !== to.id)
        next = connectGeneNodes(next, {
          from: from.id,
          to: to.id,
          label: operation.label,
          kind: operation.kind,
          evidence: { reference: operation.reference, note: operation.note },
        }).document
    } else if (operation.type === "update_relationship") {
      if (next.edges.some((edge) => edge.id === operation.item_id)) {
        next = updateDiagramItem(next, operation.item_id, {
          kind: operation.kind,
          label: operation.label,
          evidence:
            operation.reference !== undefined || operation.note !== undefined
              ? { reference: operation.reference, note: operation.note }
              : undefined,
        })
      }
    } else if (operation.type === "remove_item") {
      next = removeDiagramItem(next, operation.item_id)
    } else if (operation.type === "auto_layout") {
      layoutDirection = operation.direction === "vertical" ? "vertical" : "horizontal"
    }
  }
  selectedIds = []
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
      x: {
        type: "number",
        description: "Optional manual x-coordinate on the page (1200 by 800 by default).",
      },
      y: { type: "number", description: "Optional manual y-coordinate on the page." },
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
      font_size: { type: "number", minimum: 8, maximum: 56 },
      align: { type: "string", enum: ["left", "center", "right"] },
      fill: { type: "string", enum: ["none", "paper", "note"] },
    },
    required: ["text"],
  }
  const compartmentSchema = {
    type: "object",
    properties: {
      shape: { type: "string", enum: COMPARTMENT_SHAPES.map((shape) => shape.id) },
      label: { type: "string" },
      x: { type: "number" },
      y: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["shape"],
  }
  const relationshipSchema = {
    type: "object",
    properties: {
      from: { type: "string", description: "Source gene symbol." },
      to: { type: "string", description: "Target gene symbol." },
      kind: {
        type: "string",
        enum: RELATIONSHIP_KIND_IDS,
        description: "KEGG pathway relation subtype.",
      },
      label: { type: "string", description: "Optional biological relationship label." },
      reference: {
        type: "string",
        description: "Optional evidence: a PMID, DOI or Reactome stable ID.",
      },
      note: { type: "string", description: "Optional evidence note." },
    },
    required: ["from", "to"],
  }
  return [
    {
      name: "resolve_gene_assets",
      description:
        "Return canonical Iconoplasm gene-character bitmap URLs and provenance for up to 150 gene identifiers. Use this when you need to inspect the character images multimodally or reuse them outside the visible Iconoplasm diagram.",
      inputSchema: {
        type: "object",
        properties: {
          symbols: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: ICONOPLASM_DIAGRAM_LIMITS.nodes,
          },
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
        "Create or replace the visible page of the human-editable Iconoplasm pathway diagram using canonical gene characters, KEGG-notation relationships, compartments and optional text boxes.",
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
          compartments: {
            type: "array",
            items: compartmentSchema,
            maxItems: 20,
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
          `Created an editable Iconoplasm diagram with ${document.nodes.length} items and ${document.edges.length} relationships.`,
        )
      },
    },
    {
      name: "edit_gene_diagram",
      description:
        "Apply structured edits to the diagram page currently visible in Iconoplasm. Edits use the same document model and controls as the human Diagram Studio.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            minItems: 1,
            maxItems: ICONOPLASM_DIAGRAM_LIMITS.nodes,
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "set_title",
                    "add_gene",
                    "add_text",
                    "add_compartment",
                    "update_text",
                    "remove_gene",
                    "move_gene",
                    "move_item",
                    "connect",
                    "update_relationship",
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
                kind: { type: "string", enum: RELATIONSHIP_KIND_IDS },
                reference: { type: "string" },
                note: { type: "string" },
                shape: { type: "string", enum: COMPARTMENT_SHAPES.map((shape) => shape.id) },
                item_id: { type: "string" },
                direction: { type: "string", enum: ["horizontal", "vertical"] },
                align: { type: "string", enum: ["left", "center", "right"] },
                fill: { type: "string", enum: ["none", "paper", "note"] },
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
        "Read the current human-visible Iconoplasm diagram page, its canonical gene-character asset manifest and its evidence references.",
      inputSchema: { type: "object", properties: {} },
      execute() {
        ensureState()
        const document = cloneDiagramDocument(currentDocument)
        return toolResult(
          {
            document,
            assets: diagramAssetManifest(document),
            references: diagramReferences(document),
          },
          `The visible diagram page contains ${document.nodes.length} items and ${document.edges.length} relationships.`,
        )
      },
    },
    {
      name: "export_gene_diagram",
      description:
        "Return the current X6-backed Iconoplasm diagram page as SVG markup plus canonical bitmap provenance.",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        ensureState()
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
  ensureState()
  return cloneDiagramDocument(currentDocument)
}

export const __testing = {
  composeFromTool,
  editFromTool,
  parseSymbols,
  resolvedAssetMap,
  toolSchemas,
  runAction,
  selectItems,
  editor: () => editorReady,
}
