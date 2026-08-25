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
const textMetricsContext = document.createElement("canvas").getContext("2d")

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

function getHighlightVisibility() {
  return settings.normalizeHighlightVisibility(bridge?.getHighlightVisibility?.())
}

function applyHighlightVisibilityToState(state) {
  if (!state) return
  const hoverOnly = getHighlightVisibility() === "hover"
  const hoveredAnchor = activeAnchor?._iconoplasmPageState === state ? activeAnchor : null
  for (const decoration of state.decorations || []) {
    decoration.hidden =
      hoverOnly && decoration._iconoplasmMatchOrdinal !== hoveredAnchor?._iconoplasmMatchOrdinal
  }
}

function applyHighlightVisibilityToAllPages() {
  for (const state of pageState.values()) applyHighlightVisibilityToState(state)
}

function roughSeedForMatchOrdinal(matchOrdinal) {
  // Match the HTML renderer's deterministic document-order seed sequence.
  return 9001 + (Math.max(0, Number(matchOrdinal) || 0) + 1) * 97
}

function setLayerBounds(layer, bounds) {
  layer.style.left = `${bounds.left}px`
  layer.style.top = `${bounds.top}px`
  layer.style.width = `${bounds.right - bounds.left}px`
  layer.style.height = `${bounds.bottom - bounds.top}px`
}

function getTextLayerGeometry(textNode, label, bounds) {
  const textElement = textNode?.parentElement
  if (!textElement || !textMetricsContext) {
    return { bounds, crossAxis: "y", crossAxisDirection: 1 }
  }
  const style = getComputedStyle(textElement)
  textMetricsContext.font =
    style.font ||
    `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const metrics = textMetricsContext.measureText(String(label || ""))
  const textTransform = new DOMMatrixReadOnly(
    style.transform === "none" ? undefined : style.transform,
  )
  const textLayer = textElement.closest(".textLayer")
  const textLayerStyle = textLayer ? getComputedStyle(textLayer) : null
  const layerTransform = new DOMMatrixReadOnly(
    !textLayerStyle || textLayerStyle.transform === "none" ? undefined : textLayerStyle.transform,
  )
  const transform = layerTransform.multiply(textTransform)
  const verticalText =
    Math.abs(transform.b) + Math.abs(transform.c) > Math.abs(transform.a) + Math.abs(transform.d)
  const crossAxis = verticalText ? "x" : "y"
  const crossAxisDirection = verticalText ? transform.c || transform.b : transform.d || transform.a
  return {
    bounds: core.tightenBoundsToTextMetrics(bounds, metrics, {
      crossAxis,
      crossAxisDirection,
    }),
    crossAxis,
    crossAxisDirection,
  }
}

function createDecoration(state, match, geometry, matchOrdinal) {
  const shape = match.presentation.shape
  const kind = shape.kind
  const decorationGeometry = core.computeDecorationGeometry(
    geometry.bounds,
    match.label.length,
    shape,
    geometry,
  )
  if (!decorationGeometry) return null
  const layer = document.createElement("span")
  layer.className = `iconoplasm-pdf-decoration iconoplasm-pdf-decoration--${kind}`
  layer._iconoplasmMatchOrdinal = matchOrdinal
  layer.style.setProperty("--iconoplasm-gene-color", match.presentation.color)

  if (kind === "underline") {
    setLayerBounds(layer, decorationGeometry.bounds)
  } else if (kind === "pill-outline") {
    setLayerBounds(layer, decorationGeometry.bounds)
    layer.style.borderWidth = `${decorationGeometry.borderWidth}px`
    layer.style.borderRadius = `${decorationGeometry.borderRadius}px`
    layer.style.setProperty(
      "--iconoplasm-pdf-inner-ring",
      String(shape.innerColor || "rgba(255, 255, 255, 0.3)"),
    )
  } else if (kind === "ellipse") {
    const ellipseBounds = decorationGeometry.bounds
    setLayerBounds(layer, ellipseBounds)
    layer.appendChild(
      highlightRuntime.createRoughEllipseNode(
        ellipseBounds.right - ellipseBounds.left,
        ellipseBounds.bottom - ellipseBounds.top,
        { seed: roughSeedForMatchOrdinal(matchOrdinal) },
      ),
    )
  } else {
    return null
  }
  state.pageElement.appendChild(layer)
  return layer
}

function createHitAnchor(state, match, boundsList, matchOrdinal) {
  const union = {
    left: Math.min(...boundsList.map((bounds) => bounds.left)),
    top: Math.min(...boundsList.map((bounds) => bounds.top)),
    right: Math.max(...boundsList.map((bounds) => bounds.right)),
    bottom: Math.max(...boundsList.map((bounds) => bounds.bottom)),
  }
  const anchor = document.createElement("span")
  anchor.className = "iconoplasm-pdf-hit-anchor"
  anchor.dataset.gene = match.symbol
  anchor.dataset.geneLabel = match.label
  anchor.setAttribute("aria-hidden", "true")
  anchor._iconoplasmBounds = boundsList
  anchor._iconoplasmPageState = state
  anchor._iconoplasmMatchOrdinal = matchOrdinal
  setLayerBounds(anchor, union)
  state.pageElement.appendChild(anchor)
  return anchor
}

function getPageContentOrigin(pageElement) {
  return core.contentOriginFromBorderRect(pageElement?.getBoundingClientRect(), {
    left: pageElement?.clientLeft,
    top: pageElement?.clientTop,
  })
}

function anchorContainsClientPoint(anchor, clientX, clientY) {
  const pageOrigin = getPageContentOrigin(anchor?._iconoplasmPageState?.pageElement)
  if (!pageOrigin) return false
  const pageX = clientX - pageOrigin.left
  const pageY = clientY - pageOrigin.top
  return anchor._iconoplasmBounds?.some((bounds) =>
    core.containsPointInBounds(bounds, pageX, pageY),
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
  const textLayer = state.pageElement?.querySelector(".textLayer")
  if (!textLayer || !pdfDocument) return

  state.renderRevision += 1
  const revision = state.renderRevision
  removePageAnchors(pageNumber)
  const pageOrigin = getPageContentOrigin(state.pageElement)
  if (!pageOrigin) return
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
  let matchOrdinal = 0
  for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
    if (state.renderRevision !== revision) return
    const plan = core.normalizeTextRunMatches(
      textNode.nodeValue,
      (text) => bridge.findMatches(text),
      (symbol) => bridge.getPdfHighlightPresentation?.(symbol),
    )
    for (const match of plan.accepted) {
      const range = document.createRange()
      range.setStart(textNode, match.start)
      range.setEnd(textNode, match.end)
      const boundsList = Array.from(range.getClientRects(), (rect) =>
        core.boundsFromClientRect(rect, pageOrigin),
      )
        .filter(Boolean)
        .map((bounds) => getTextLayerGeometry(textNode, match.label, bounds))
      range.detach()
      if (!boundsList.length) continue
      for (const geometry of boundsList) {
        const decoration = createDecoration(state, match, geometry, matchOrdinal)
        if (decoration) state.decorations.push(decoration)
      }
      state.anchors.push(
        createHitAnchor(
          state,
          match,
          boundsList.map((geometry) => geometry.bounds),
          matchOrdinal,
        ),
      )
      matchOrdinal += 1
    }
  }
  bridge.replaceAnchorGroup?.(`pdf:${pageNumber}`, state.anchors)
  applyHighlightVisibilityToState(state)
}

async function clearPageHighlights(pageNumber) {
  const state = pageState.get(pageNumber)
  if (!state) return
  state.renderRevision += 1
  removePageAnchors(pageNumber)
}

function clearAllHighlights() {
  for (const pageNumber of pageState.keys()) {
    void clearPageHighlights(pageNumber)
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

eventBus.on("pagerendered", ({ pageNumber }) => {
  const state = pageState.get(Number(pageNumber))
  if (!state) return
  state.rendered = true
  state.visible = pageIsInWorkingSet(state.pageElement)
  if (state.visible) void scanPage(Number(pageNumber))
})

eventBus.on("textlayerrendered", ({ pageNumber }) => {
  const state = pageState.get(Number(pageNumber))
  if (!state) return
  state.rendered = true
  state.visible = pageIsInWorkingSet(state.pageElement)
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
  clearAllHighlights()
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
