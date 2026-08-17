import {
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
} from "./generated/pdfjs/pdf.mjs"
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "./generated/pdfjs/pdf_viewer.mjs"

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("generated/pdfjs/pdf.worker.mjs")

const core = globalThis.IconoplasmPdfReaderCore
const settings = globalThis.IconoplasmContentSettings
const highlightRuntime = globalThis.IconoplasmHighlightRuntime.createHighlightRuntime()
const container = document.getElementById("viewerContainer")
const viewerElement = document.getElementById("viewer")
const statusElement = document.getElementById("reader-status")
const fileInput = document.getElementById("pdf-file")
const passwordForm = document.getElementById("password-form")
const passwordInput = document.getElementById("pdf-password")
const downloadButton = document.getElementById("download")
const nativeViewerButton = document.getElementById("native-viewer")
const zoomValue = document.getElementById("zoom-value")
const filenameElement = document.getElementById("reader-filename")
const pageNumberElement = document.getElementById("page-number")
const pageCountElement = document.getElementById("page-count")
const findForm = document.getElementById("find-form")
const findInput = document.getElementById("find-query")

const eventBus = new EventBus()
const linkService = new PDFLinkService({ eventBus })
const findController = new PDFFindController({ eventBus, linkService })
const pdfViewer = new PDFViewer({
  container,
  viewer: viewerElement,
  eventBus,
  linkService,
  findController,
  annotationMode: AnnotationMode.ENABLE_FORMS,
  textLayerMode: 1,
  removePageBorders: false,
  // A second, unadapted detail canvas would cover exact gene pixels at high zoom.
  // Keep one authoritative page canvas so survey, paint, hover, and display agree.
  enableDetailCanvas: false,
})
linkService.setViewer(pdfViewer)

const pageState = new Map()
let bridge = globalThis.IconoplasmReaderBridge || null
let pdfDocument = null
let loadingTask = null
let sourceBytes = null
let sourceName = "document.pdf"
let ownedPdfSource = false
let activeOwnership = null
let highlightingEnabled = true
let activeAnchor = null
let pendingPasswordUpdate = null

function setStatus(message, kind = "info") {
  statusElement.textContent = String(message || "")
  statusElement.dataset.kind = kind
  statusElement.hidden = !message
}

function waitForBridge(timeoutMs = 10_000) {
  if (globalThis.IconoplasmReaderBridge) {
    bridge = globalThis.IconoplasmReaderBridge
    return Promise.resolve(bridge)
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("iconoplasm-reader-bridge-ready", onReady)
      reject(new Error("Iconoplasm gene catalog did not become ready in time"))
    }, timeoutMs)
    const onReady = () => {
      window.clearTimeout(timer)
      bridge = globalThis.IconoplasmReaderBridge
      resolve(bridge)
    }
    window.addEventListener("iconoplasm-reader-bridge-ready", onReady, { once: true })
  })
}

function pageNumberForElement(pageElement) {
  return Number(pageElement?.dataset?.pageNumber || 0)
}

function closeActiveCard() {
  const previousAnchor = activeAnchor
  if (previousAnchor) bridge?.leaveAnchor?.(previousAnchor)
  activeAnchor = null
  if (previousAnchor?._iconoplasmPageState) {
    applyHighlightVisibilityToState(previousAnchor._iconoplasmPageState)
  }
  bridge?.closeCard?.()
}

function removePageAnchors(pageNumber) {
  const state = pageState.get(pageNumber)
  if (!state) return
  if (activeAnchor && state.anchors.includes(activeAnchor)) closeActiveCard()
  bridge?.replaceAnchorGroup?.(`pdf:${pageNumber}`, [])
  for (const anchor of state.anchors) anchor.remove()
  for (const decoration of state.decorations || []) decoration.remove()
  state.anchors = []
  state.decorations = []
}

function copyCanvasPixels(target, source) {
  const context = target.getContext("2d")
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = "copy"
  context.drawImage(source, 0, 0)
  context.restore()
}

function cloneCanvasPixels(source) {
  const clone = document.createElement("canvas")
  clone.width = source.width
  clone.height = source.height
  copyCanvasPixels(clone, source)
  return clone
}

function copyCanvasRegion(target, source, bounds) {
  if (!target || !source || !bounds) return
  const left = Math.max(0, Math.floor(bounds.left))
  const top = Math.max(0, Math.floor(bounds.top))
  const right = Math.min(target.width, source.width, Math.ceil(bounds.right))
  const bottom = Math.min(target.height, source.height, Math.ceil(bounds.bottom))
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return
  const context = target.getContext("2d")
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalCompositeOperation = "source-over"
  context.drawImage(source, left, top, width, height, left, top, width, height)
  context.restore()
}

function getHighlightVisibility() {
  return settings.normalizeHighlightVisibility(bridge?.getHighlightVisibility?.())
}

function applyHighlightVisibilityToState(state) {
  if (
    !state?.exactPaintApplied ||
    !state.sourceCanvas?.isConnected ||
    !state.canonicalCanvas ||
    !state.highlightedCanvas
  ) {
    return
  }
  const hoverOnly = getHighlightVisibility() === "hover"
  const hoveredAnchor = activeAnchor?._iconoplasmPageState === state ? activeAnchor : null
  copyCanvasPixels(state.sourceCanvas, hoverOnly ? state.canonicalCanvas : state.highlightedCanvas)
  if (hoverOnly && hoveredAnchor) {
    copyCanvasRegion(
      state.sourceCanvas,
      state.highlightedCanvas,
      hoveredAnchor._iconoplasmPaintBounds,
    )
  }
  for (const decoration of state.decorations || []) {
    decoration.hidden =
      hoverOnly && decoration._iconoplasmMatchOrdinal !== hoveredAnchor?._iconoplasmMatchOrdinal
  }
}

function applyHighlightVisibilityToAllPages() {
  for (const state of pageState.values()) applyHighlightVisibilityToState(state)
}

async function renderOffscreen(pdfPage, viewport, sourceCanvas, textRenderAdapter = null) {
  const canvas = document.createElement("canvas")
  canvas.width = sourceCanvas.width
  canvas.height = sourceCanvas.height
  const canvasContext = canvas.getContext("2d")
  const transform = [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0]
  await pdfPage.render({
    canvasContext,
    viewport,
    transform,
    annotationMode: AnnotationMode.ENABLE_FORMS,
    textRenderAdapter,
  }).promise
  return canvas
}

function roughSeedForMatchOrdinal(matchOrdinal) {
  // Match the HTML renderer's deterministic document-order seed sequence.
  return 9001 + (Math.max(0, Number(matchOrdinal) || 0) + 1) * 97
}

function positionEllipseDecoration(state, layer) {
  const sourceCanvas = state.sourceCanvas
  const wrapper = sourceCanvas?.parentElement
  const deviceBounds = layer?._iconoplasmDeviceBounds
  if (!wrapper || !deviceBounds) return null
  const sourceRect = sourceCanvas.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()
  const scaleX = sourceCanvas.width > 0 ? sourceRect.width / sourceCanvas.width : 1
  const scaleY = sourceCanvas.height > 0 ? sourceRect.height / sourceCanvas.height : 1
  const rect = {
    left: sourceRect.left - wrapperRect.left + deviceBounds.left * scaleX,
    top: sourceRect.top - wrapperRect.top + deviceBounds.top * scaleY,
    width: (deviceBounds.right - deviceBounds.left) * scaleX,
    height: (deviceBounds.bottom - deviceBounds.top) * scaleY,
  }
  layer.style.left = `${rect.left}px`
  layer.style.top = `${rect.top}px`
  layer.style.width = `${rect.width}px`
  layer.style.height = `${rect.height}px`
  return rect
}

function refreshEllipseDecorationGeometry(state) {
  for (const layer of state.decorations || []) positionEllipseDecoration(state, layer)
}

function createSharedRoughEllipseDecorations(state, matches) {
  const sourceCanvas = state.sourceCanvas
  const wrapper = sourceCanvas?.parentElement
  if (!wrapper) return []
  const rendered = []
  for (const [matchOrdinal, match] of matches.entries()) {
    const decoration = match?.decoration
    const deviceBounds = decoration?.bounds
    if (decoration?.kind !== "ellipse" || !deviceBounds) continue
    const layer = document.createElement("span")
    layer.className = "iconoplasm-pdf-ellipse-decoration iconoplasm-gene--ellipse"
    layer._iconoplasmDeviceBounds = deviceBounds
    layer._iconoplasmMatchOrdinal = matchOrdinal
    const rect = positionEllipseDecoration(state, layer)
    if (!rect || rect.width <= 2 || rect.height <= 2) continue
    layer.style.setProperty("--iconoplasm-gene-color", decoration.color)
    layer.appendChild(
      highlightRuntime.createRoughEllipseNode(rect.width, rect.height, {
        seed: roughSeedForMatchOrdinal(matchOrdinal),
      }),
    )
    wrapper.appendChild(layer)
    rendered.push(layer)
  }
  return rendered
}

async function restoreCanonicalPage(state, revision) {
  if (!state?.exactPaintApplied || !state.sourceCanvas?.isConnected) return
  const canonical =
    state.canonicalCanvas ||
    (await renderOffscreen(state.pdfPage, state.viewport, state.sourceCanvas))
  if (state.renderRevision !== revision || !state.sourceCanvas?.isConnected) return
  copyCanvasPixels(state.sourceCanvas, canonical)
  state.exactPaintApplied = false
  state.canonicalCanvas = null
  state.highlightedCanvas = null
}

function deviceBoundsToPageRect(bounds, sourceCanvas, pageElement) {
  if (!bounds) return null
  const sourceRect = sourceCanvas.getBoundingClientRect()
  const pageRect = pageElement.getBoundingClientRect()
  if (!sourceRect.width || !sourceRect.height || !sourceCanvas.width || !sourceCanvas.height) {
    return null
  }
  const scaleX = sourceRect.width / sourceCanvas.width
  const scaleY = sourceRect.height / sourceCanvas.height
  return {
    left: sourceRect.left - pageRect.left + bounds.left * scaleX,
    top: sourceRect.top - pageRect.top + bounds.top * scaleY,
    width: (bounds.right - bounds.left) * scaleX,
    height: (bounds.bottom - bounds.top) * scaleY,
  }
}

function positionHitAnchor(state, anchor) {
  const rect = deviceBoundsToPageRect(
    anchor._iconoplasmDeviceBounds,
    state.sourceCanvas,
    state.pageElement,
  )
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  anchor.style.left = `${rect.left}px`
  anchor.style.top = `${rect.top}px`
  anchor.style.width = `${rect.width}px`
  anchor.style.height = `${rect.height}px`
  return rect
}

function refreshHitAnchorGeometry(state) {
  for (const anchor of state.anchors) positionHitAnchor(state, anchor)
}

function createHitAnchors(state, matches) {
  const anchors = []
  for (const [matchOrdinal, match] of matches.entries()) {
    const anchor = document.createElement("span")
    anchor.className = "iconoplasm-pdf-hit-anchor"
    anchor.dataset.gene = match.symbol
    anchor.dataset.geneLabel = match.label
    anchor.setAttribute("aria-hidden", "true")
    anchor._iconoplasmDeviceBounds = match.bounds
    anchor._iconoplasmDevicePolygons = match.polygons
    anchor._iconoplasmSourceCanvas = state.sourceCanvas
    anchor._iconoplasmPageState = state
    anchor._iconoplasmMatchOrdinal = matchOrdinal
    anchor._iconoplasmPaintBounds = core.paintBoundsForMatch(match)
    const rect = positionHitAnchor(state, anchor)
    if (!rect) continue
    state.pageElement.appendChild(anchor)
    anchors.push(anchor)
  }
  return anchors
}

function anchorContainsClientPoint(anchor, clientX, clientY) {
  const sourceCanvas = anchor?._iconoplasmSourceCanvas
  if (!sourceCanvas?.isConnected) return false
  const sourceRect = sourceCanvas.getBoundingClientRect()
  if (!sourceRect.width || !sourceRect.height) return false
  const deviceX = ((clientX - sourceRect.left) * sourceCanvas.width) / sourceRect.width
  const deviceY = ((clientY - sourceRect.top) * sourceCanvas.height) / sourceRect.height
  return anchor._iconoplasmDevicePolygons?.some((polygon) =>
    core.containsPointInPolygon(polygon, deviceX, deviceY),
  )
}

function findAnchorAtPoint(clientX, clientY) {
  for (const state of pageState.values()) {
    if (!state.visible) continue
    const anchor = state.anchors.find((candidate) =>
      anchorContainsClientPoint(candidate, clientX, clientY),
    )
    if (anchor) return anchor
  }
  return null
}

function pageIsInWorkingSet(pageElement) {
  if (!pageElement?.isConnected) return false
  const pageRect = pageElement.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const verticalMargin = containerRect.height
  return (
    pageRect.bottom >= containerRect.top - verticalMargin &&
    pageRect.top <= containerRect.bottom + verticalMargin &&
    pageRect.right >= containerRect.left &&
    pageRect.left <= containerRect.right
  )
}

async function scanPage(pageNumber) {
  const state = pageState.get(pageNumber)
  if (!highlightingEnabled || !bridge || !state?.visible || !state.rendered) return
  const pageView = pdfViewer.getPageView(pageNumber - 1)
  const sourceCanvas = state.pageElement?.querySelector(".canvasWrapper canvas")
  if (!pageView?.viewport || !sourceCanvas || !pdfDocument) return

  state.renderRevision += 1
  const revision = state.renderRevision
  removePageAnchors(pageNumber)
  state.sourceCanvas = sourceCanvas
  state.viewport = pageView.viewport
  state.pdfPage ||= await pdfDocument.getPage(pageNumber)

  try {
    const canonical =
      state.exactPaintApplied && state.canonicalCanvas
        ? state.canonicalCanvas
        : cloneCanvasPixels(sourceCanvas)
    const surveyAdapter = { mode: "survey", records: [] }
    await renderOffscreen(state.pdfPage, state.viewport, sourceCanvas, surveyAdapter)
    if (state.renderRevision !== revision || !state.visible || !highlightingEnabled) return

    const plan = core.buildExactPaintPlan(
      surveyAdapter.records,
      (text) => bridge.findMatches(text),
      (symbol) => bridge.getHighlightPresentation?.(symbol),
    )
    if (!plan.accepted.length) {
      await restoreCanonicalPage(state, revision)
      return
    }

    const paintAdapter = {
      mode: "paint",
      records: [],
      foregroundByGlyphOrdinal: plan.foregroundByGlyphOrdinal,
      decorationsByOperationOrdinal: plan.decorationsByOperationOrdinal,
    }
    const candidate = await renderOffscreen(
      state.pdfPage,
      state.viewport,
      sourceCanvas,
      paintAdapter,
    )
    if (state.renderRevision !== revision || !state.visible || !highlightingEnabled) return
    if (
      core.renderFingerprint(surveyAdapter.records) !== core.renderFingerprint(paintAdapter.records)
    ) {
      throw new Error("PDF glyph survey and paint render diverged")
    }
    state.canonicalCanvas = canonical
    state.highlightedCanvas = candidate
    state.exactPaintApplied = true
    state.decorations = createSharedRoughEllipseDecorations(state, plan.accepted)
    state.anchors = createHitAnchors(state, plan.accepted)
    bridge.replaceAnchorGroup?.(`pdf:${pageNumber}`, state.anchors)
    applyHighlightVisibilityToState(state)
  } catch (error) {
    if (state.renderRevision !== revision) return
    removePageAnchors(pageNumber)
    await restoreCanonicalPage(state, revision).catch(() => null)
    console.error(`Iconoplasm declined exact PDF highlights on page ${pageNumber}`, error)
  }
}

async function clearPageHighlights(pageNumber, { restorePixels = true } = {}) {
  const state = pageState.get(pageNumber)
  if (!state) return
  state.renderRevision += 1
  const revision = state.renderRevision
  removePageAnchors(pageNumber)
  if (restorePixels) await restoreCanonicalPage(state, revision).catch(() => null)
}

function clearAllHighlights({ restorePixels = true } = {}) {
  for (const pageNumber of pageState.keys()) {
    void clearPageHighlights(pageNumber, { restorePixels })
  }
  closeActiveCard()
}

function refreshVisiblePages() {
  for (const [pageNumber, state] of pageState) {
    if (state.visible) void scanPage(pageNumber)
    else void clearPageHighlights(pageNumber)
  }
}

const pageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const pageNumber = pageNumberForElement(entry.target)
      const state = pageState.get(pageNumber)
      if (!state) continue
      state.visible = entry.isIntersecting || pageIsInWorkingSet(entry.target)
      if (state.visible) void scanPage(pageNumber)
      else void clearPageHighlights(pageNumber)
    }
  },
  { root: container, rootMargin: "100% 0px", threshold: 0 },
)

function observePages() {
  pageObserver.disconnect()
  pageState.clear()
  for (const pageElement of viewerElement.querySelectorAll(".page")) {
    const pageNumber = pageNumberForElement(pageElement)
    if (!pageNumber) continue
    pageState.set(pageNumber, {
      pageElement,
      visible: false,
      rendered: false,
      anchors: [],
      decorations: [],
      renderRevision: 0,
      exactPaintApplied: false,
      canonicalCanvas: null,
      highlightedCanvas: null,
      sourceCanvas: null,
      viewport: null,
      pdfPage: null,
    })
    pageObserver.observe(pageElement)
  }
}

function refreshZoomOutput() {
  zoomValue.textContent = `${Math.round(Number(pdfViewer.currentScale || 1) * 100)}%`
}

eventBus.on("pagesinit", () => {
  pdfViewer.currentScaleValue = "page-fit"
  observePages()
  refreshZoomOutput()
})

eventBus.on("pagechanging", ({ pageNumber }) => {
  pageNumberElement.textContent = String(pageNumber || "–")
})

eventBus.on("pagerendered", ({ pageNumber, cssTransform }) => {
  const state = pageState.get(Number(pageNumber))
  if (!state) return
  state.rendered = true
  state.visible = pageIsInWorkingSet(state.pageElement)
  if (cssTransform && state.exactPaintApplied && state.sourceCanvas?.isConnected) {
    state.viewport = pdfViewer.getPageView(Number(pageNumber) - 1)?.viewport || state.viewport
    refreshHitAnchorGeometry(state)
    refreshEllipseDecorationGeometry(state)
    return
  }
  state.exactPaintApplied = false
  state.canonicalCanvas = null
  state.highlightedCanvas = null
  if (state.visible) void scanPage(Number(pageNumber))
})

eventBus.on("scalechanging", () => {
  closeActiveCard()
  for (const state of pageState.values()) state.renderRevision += 1
  window.requestAnimationFrame(refreshZoomOutput)
})

eventBus.on("rotationchanging", () => {
  closeActiveCard()
  for (const state of pageState.values()) state.renderRevision += 1
})

container.addEventListener("pointermove", (event) => {
  if (!highlightingEnabled || !bridge) return
  if (event.target?.closest?.(".iconoplasm-tooltip")) return
  const anchor = findAnchorAtPoint(event.clientX, event.clientY)
  if (anchor === activeAnchor) return
  const previousAnchor = activeAnchor
  if (previousAnchor) bridge.leaveAnchor?.(previousAnchor, event.target)
  activeAnchor = anchor
  const previousState = previousAnchor?._iconoplasmPageState
  const activeState = activeAnchor?._iconoplasmPageState
  if (previousState) applyHighlightVisibilityToState(previousState)
  if (activeState && activeState !== previousState) applyHighlightVisibilityToState(activeState)
  if (activeAnchor) bridge.activateAnchor?.(activeAnchor)
})

async function loadPdf(bytes, name = "document.pdf") {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
    throw new Error("The PDF source was empty")
  }
  clearAllHighlights({ restorePixels: false })
  sourceBytes = bytes
  sourceName = name || "document.pdf"
  filenameElement.textContent = sourceName
  downloadButton.disabled = false
  setStatus(`Opening ${sourceName}…`)
  if (loadingTask) await loadingTask.destroy().catch(() => null)
  if (pdfDocument) await pdfDocument.destroy().catch(() => null)
  loadingTask = getDocument({
    data: bytes.slice(),
    cMapUrl: chrome.runtime.getURL("generated/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("generated/pdfjs/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("generated/pdfjs/wasm/"),
    isEvalSupported: false,
  })
  loadingTask.onPassword = (updatePassword, reason) => {
    pendingPasswordUpdate = updatePassword
    passwordForm.hidden = false
    passwordInput.value = ""
    passwordInput.focus()
    setStatus(
      reason === PasswordResponses.INCORRECT_PASSWORD
        ? "That password was incorrect. Try again."
        : "Enter the PDF password to continue.",
      "warning",
    )
  }
  pdfDocument = await loadingTask.promise
  pageCountElement.textContent = String(pdfDocument.numPages)
  pageNumberElement.textContent = "1"
  passwordForm.hidden = true
  pendingPasswordUpdate = null
  document.title = `${sourceName} — Iconoplasm Reader`
  pdfViewer.setDocument(pdfDocument)
  linkService.setDocument(pdfDocument, null)
  setStatus("")
}

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault()
  pendingPasswordUpdate?.(passwordInput.value)
})

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  ownedPdfSource = false
  activeOwnership = null
  nativeViewerButton.hidden = true
  try {
    await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name)
  } catch (error) {
    setStatus(`Could not open this PDF: ${error.message}`, "error")
  }
})

for (const eventName of ["dragenter", "dragover"]) {
  document.addEventListener(eventName, (event) => {
    event.preventDefault()
    document.body.classList.add("is-dragging")
  })
}
for (const eventName of ["dragleave", "drop"]) {
  document.addEventListener(eventName, (event) => {
    event.preventDefault()
    document.body.classList.remove("is-dragging")
  })
}
document.addEventListener("drop", async (event) => {
  const file = Array.from(event.dataTransfer?.files || []).find(
    (candidate) =>
      candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf"),
  )
  if (!file) {
    setStatus("Drop a PDF file to open it.", "warning")
    return
  }
  ownedPdfSource = false
  activeOwnership = null
  nativeViewerButton.hidden = true
  try {
    await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name)
  } catch (error) {
    setStatus(`Could not open this PDF: ${error.message}`, "error")
  }
})

document.getElementById("zoom-in").addEventListener("click", () => {
  pdfViewer.increaseScale({ drawingDelay: 150 })
})
document.getElementById("zoom-out").addEventListener("click", () => {
  pdfViewer.decreaseScale({ drawingDelay: 150 })
})
document.getElementById("rotate").addEventListener("click", () => {
  pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360
})
document.getElementById("fit-page").addEventListener("click", () => {
  pdfViewer.currentScaleValue = "page-fit"
})
findForm.addEventListener("submit", (event) => {
  event.preventDefault()
  const query = findInput.value
  if (!query) return
  eventBus.dispatch("find", {
    source: window,
    type: "",
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
  })
})

function toggleFind(forceOpen) {
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : findForm.hidden
  findForm.hidden = !nextOpen
  if (nextOpen) {
    findInput.focus()
    findInput.select()
  }
}

document.getElementById("find-toggle").addEventListener("click", () => toggleFind())
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault()
    toggleFind(true)
  }
  if (event.key === "Escape" && !findForm.hidden) toggleFind(false)
})

downloadButton.addEventListener("click", () => {
  if (!sourceBytes) return
  const url = URL.createObjectURL(new Blob([sourceBytes], { type: "application/pdf" }))
  const link = document.createElement("a")
  link.href = url
  link.download = sourceName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
})

nativeViewerButton.addEventListener("click", () => {
  if (ownedPdfSource) void activeOwnership?.handBack?.()
})

async function loadHighlightingPreference() {
  const key = settings.storageKeys.pdfHighlightingEnabled
  const stored = await chrome.storage.local.get([key])
  highlightingEnabled = settings.normalizeBooleanSetting(stored[key], false)
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return
  const change = changes[settings.storageKeys.pdfHighlightingEnabled]
  if (!change) return
  highlightingEnabled = settings.normalizeBooleanSetting(change.newValue, false)
  if (!highlightingEnabled && ownedPdfSource) {
    void activeOwnership?.handBack?.()
    return
  }
  if (highlightingEnabled) refreshVisiblePages()
  else clearAllHighlights()
})

window.addEventListener("iconoplasm-reader-matcher-changed", refreshVisiblePages)
window.addEventListener("iconoplasm-reader-highlight-mode-changed", refreshVisiblePages)
window.addEventListener("iconoplasm-reader-highlight-visibility-changed", () => {
  closeActiveCard()
  applyHighlightVisibilityToAllPages()
})

async function openOwnedStream(outcome) {
  if (!outcome || outcome.kind === "manual") return false
  if (outcome.kind !== "stream") return true
  const { bytes, streamInfo } = outcome
  if (!highlightingEnabled) {
    await outcome.handBack?.()
    return true
  }
  ownedPdfSource = true
  activeOwnership = outcome
  nativeViewerButton.hidden = false
  const originalUrl = String(streamInfo.originalUrl || "")
  const fallbackName = originalUrl.split(/[?#]/, 1)[0].split("/").pop() || "document.pdf"
  try {
    await loadPdf(bytes, decodeURIComponent(fallbackName))
  } catch (error) {
    console.error("Iconoplasm Reader could not open this PDF", error)
    await outcome.handBack?.()
  }
  return true
}

const streamOutcome = await globalThis.IconoplasmPdfStreamBootstrap?.outcome
await loadHighlightingPreference()
if (streamOutcome?.kind === "stream" && !highlightingEnabled) {
  await streamOutcome.handBack?.()
} else {
  await waitForBridge()
  await openOwnedStream(streamOutcome)
}
