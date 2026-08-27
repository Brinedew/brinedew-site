import {
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  OPS,
  getDocument,
} from "./generated/pdfjs/pdf.mjs"
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "./generated/pdfjs/pdf_viewer.mjs"
import { createPdfReaderControls } from "./pdf-reader-controls.mjs"
import {
  buildTextVisibilityIndex,
  clipTextMatch,
  intersectConvexPolygons,
  pointInConvexPolygon,
} from "./pdf-text-visibility.mjs"

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("generated/pdfjs/pdf.worker.mjs")

const core = globalThis.IconoplasmPdfReaderCore
const settings = globalThis.IconoplasmContentSettings
const highlightRuntime = globalThis.IconoplasmHighlightRuntime.createHighlightRuntime()
const container = document.getElementById("viewerContainer")
const viewerElement = document.getElementById("viewer")
const statusElement = document.getElementById("reader-status")
const statusMessageElement = document.getElementById("reader-status-message")
const statusActionsElement = document.getElementById("reader-status-actions")
const progressElement = document.getElementById("reader-progress")
const progressBarElement = document.getElementById("reader-progress-bar")
const retryButton = document.getElementById("reader-retry")
const nativeFallbackButton = document.getElementById("reader-native-fallback")
const fileInput = document.getElementById("pdf-file")
const passwordForm = document.getElementById("password-form")
const passwordInput = document.getElementById("pdf-password")
const passwordMessageElement = document.getElementById("password-message")
const downloadButton = document.getElementById("download")
const nativeViewerButton = document.getElementById("native-viewer")
const openFileActionButton = document.getElementById("reader-open-file-action")
const zoomValue = document.getElementById("zoom-value")
const filenameElement = document.getElementById("reader-filename")
const pageNumberElement = document.getElementById("page-number")
const pageCountElement = document.getElementById("page-count")
const findForm = document.getElementById("find-form")
const findInput = document.getElementById("find-query")
const findCount = document.getElementById("find-count")
const findPreviousButton = document.getElementById("find-previous")
const findNextButton = document.getElementById("find-next")

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
let activeLoadId = 0
let waitingForFirstPage = false
const textMetricsContext = document.createElement("canvas").getContext("2d")

function isFirefoxLocalFileOwnership(ownership = activeOwnership) {
  return ownership?.ownership === "firefox-local-file-picker"
}

function localFileName(ownership = activeOwnership) {
  if (!isFirefoxLocalFileOwnership(ownership)) return ""
  try {
    const pathname = new URL(ownership.streamInfo.originalUrl).pathname
    return decodeURIComponent(pathname.split("/").pop() || "document.pdf")
  } catch (_error) {
    return "document.pdf"
  }
}

function requestedLocalFilePath(ownership = activeOwnership) {
  if (!isFirefoxLocalFileOwnership(ownership)) return ""
  return core.localFileSystemPath(ownership.streamInfo.originalUrl, navigator.platform)
}

function preserveLocalFileOwnership() {
  const localOwnership = isFirefoxLocalFileOwnership()
  ownedPdfSource = localOwnership
  if (!localOwnership) activeOwnership = null
  nativeViewerButton.hidden = true
}

function handLocalBytesToNativeViewer() {
  if (!isFirefoxLocalFileOwnership() || !sourceBytes) return false
  const blobUrl = URL.createObjectURL(new Blob([sourceBytes], { type: "application/pdf" }))
  location.replace(blobUrl)
  return true
}

const readerControls = createPdfReaderControls({
  container,
  eventBus,
  linkService,
  pdfViewer,
  getSourceBytes: () => sourceBytes,
  getSourceName: () => sourceName,
})

const documentControls = [
  document.getElementById("zoom-out"),
  document.getElementById("zoom-in"),
  document.getElementById("fit-page"),
  document.getElementById("rotate"),
  document.getElementById("find-toggle"),
]

function setProgress(loaded = 0, total = 0) {
  progressElement.hidden = false
  const hasTotal = Number.isFinite(total) && total > 0
  progressElement.classList.toggle("is-indeterminate", !hasTotal)
  if (!hasTotal) {
    progressElement.removeAttribute("aria-valuenow")
    progressBarElement.style.width = ""
    return
  }
  const percent = Math.max(0, Math.min(100, (loaded / total) * 100))
  progressElement.setAttribute("aria-valuenow", String(Math.round(percent)))
  progressBarElement.style.width = `${percent}%`
}

function setControlsEnabled(enabled) {
  for (const control of documentControls) control.disabled = !enabled
  downloadButton.disabled = !enabled || !sourceBytes
  readerControls.setEnabled(enabled)
}

function setStatus(message, kind = "info", { actions = false } = {}) {
  statusMessageElement.textContent = String(message || "")
  statusElement.dataset.kind = kind
  statusElement.hidden = !message
  statusActionsElement.hidden = !actions
}

function setReaderLoading(message = "Loading PDF…", loaded = 0, total = 0) {
  document.body.dataset.readerState = "loading"
  container.setAttribute("aria-busy", "true")
  setControlsEnabled(false)
  setProgress(loaded, total)
  setStatus(message, "loading")
  passwordForm.hidden = true
}

function setReaderReady() {
  document.body.dataset.readerState = "ready"
  container.setAttribute("aria-busy", "false")
  progressElement.hidden = true
  setControlsEnabled(true)
  nativeViewerButton.hidden = !ownedPdfSource
  setStatus("")
}

function setReaderEmpty() {
  document.body.dataset.readerState = "empty"
  container.setAttribute("aria-busy", "false")
  progressElement.hidden = true
  setControlsEnabled(false)
  retryButton.hidden = true
  const requestedFileName = localFileName()
  nativeFallbackButton.hidden = true
  nativeViewerButton.hidden = true
  if (requestedFileName) {
    filenameElement.textContent = requestedFileName
    openFileActionButton.textContent = "Choose this PDF"
    setStatus(
      `Firefox protects local files. Choose ${requestedFileName} once. Its exact path will be copied; in the picker press Ctrl+V, then Open.`,
      "empty",
      { actions: true },
    )
  } else {
    openFileActionButton.textContent = "Open another PDF"
    setStatus("Open or drop a PDF", "empty", { actions: true })
  }
}

function setReaderError(error) {
  document.body.dataset.readerState = "error"
  container.setAttribute("aria-busy", "false")
  progressElement.hidden = true
  setControlsEnabled(false)
  retryButton.hidden = !sourceBytes
  nativeFallbackButton.hidden = !ownedPdfSource || !sourceBytes
  setStatus(`Could not open this PDF: ${error.message}`, "error", { actions: true })
}

globalThis.addEventListener("iconoplasm-pdf-stream-progress", ({ detail }) => {
  if (document.body.dataset.readerState !== "loading") return
  setReaderLoading("Loading PDF…", detail?.loaded, detail?.total)
})

const bootstrapProgress = globalThis.IconoplasmPdfStreamProgress
setReaderLoading("Loading PDF…", bootstrapProgress?.loaded, bootstrapProgress?.total)

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

function getTextLayerGeometry(textElement, label, bounds) {
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
    selectionBounds: bounds,
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
  if (geometry.visibilityClips?.length) {
    const b = decorationGeometry.bounds
    let polygon = [
      [b.left, b.top],
      [b.right, b.top],
      [b.right, b.bottom],
      [b.left, b.bottom],
    ]
    for (const clip of geometry.visibilityClips) polygon = intersectConvexPolygons(polygon, clip)
    if (polygon.length < 3) return null
    layer.style.clipPath = `polygon(${polygon.map(([x, y]) => `${x - b.left}px ${y - b.top}px`).join(",")})`
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
  return anchor._iconoplasmBounds?.some(
    (bounds) =>
      core.containsPointInBounds(bounds, pageX, pageY) &&
      (!bounds.polygon || pointInConvexPolygon(bounds.polygon, [pageX, pageY])),
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

function rangeForTextOffsets(element, start, end) {
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0,
    started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = offset + node.nodeValue.length
    if (!started && start < next) {
      range.setStart(node, start - offset)
      started = true
    }
    if (started && end <= next) {
      range.setEnd(node, end - offset)
      return range
    }
    offset = next
  }
  return null
}

async function scanPage(pageNumber) {
  const state = pageState.get(pageNumber)
  if (!highlightingEnabled || !bridge || !state?.visible || !state.rendered) return
  const textLayer = state.pageElement?.querySelector(".textLayer")
  if (!textLayer || !pdfDocument) return

  state.renderRevision += 1
  const revision = state.renderRevision
  removePageAnchors(pageNumber)
  const pageView = pdfViewer.getPageView(pageNumber - 1)
  const mapping = pageView?.textLayer?.highlighter
  if (!mapping?.textDivs?.length) return
  // Form clipping belongs to the PDF graphics state, not the transparent text
  // layer. Never deduplicate nearby labels or move guessed outlines onto pixels.
  state.visibilityIndexPromise ||= Promise.all([
    pageView.pdfPage.getOperatorList(),
    pageView.pdfPage.getTextContent({ includeMarkedContent: true, disableNormalization: true }),
    pdfViewer.optionalContentConfigPromise,
  ]).then(([operators, content, optional]) =>
    buildTextVisibilityIndex(operators, content, OPS, optional),
  )
  let visibility
  try {
    visibility = await state.visibilityIndexPromise
  } catch (error) {
    state.pageElement.dataset.iconoplasmVisibility = "unavailable"
    console.warn("[Iconoplasm] PDF text visibility unavailable:", error.message)
    return
  }
  if (
    pageState.get(pageNumber) !== state ||
    state.renderRevision !== revision ||
    !state.visible ||
    !highlightingEnabled
  )
    return
  if (
    mapping.textDivs.length !== visibility.items.length ||
    mapping.textContentItemsStr.some((text, i) => text !== visibility.items[i]?.text)
  ) {
    state.pageElement.dataset.iconoplasmVisibility = "text-mapping-mismatch"
    return
  }
  state.pageElement.dataset.iconoplasmVisibility = visibility.unmatchedFonts.length
    ? "partial"
    : "verified"
  const pageOrigin = getPageContentOrigin(state.pageElement)
  if (!pageOrigin) return
  let matchOrdinal = 0
  for (let itemIndex = 0; itemIndex < mapping.textDivs.length; itemIndex++) {
    const textElement = mapping.textDivs[itemIndex]
    const item = visibility.items[itemIndex]
    if (!textElement.isConnected || textElement.textContent !== item.text) continue
    if (state.renderRevision !== revision) return
    const plan = core.normalizeTextRunMatches(
      item.text,
      (text) => bridge.findMatches(text),
      (symbol) => bridge.getPdfHighlightPresentation?.(symbol),
    )
    for (const match of plan.accepted) {
      const range = rangeForTextOffsets(textElement, match.start, match.end)
      if (!range) continue
      const boundsList = Array.from(range.getClientRects(), (rect) =>
        core.boundsFromClientRect(rect, pageOrigin),
      )
        .filter(Boolean)
        .map((bounds) => getTextLayerGeometry(textElement, match.label, bounds))
        .map((geometry) => {
          const clipped = clipTextMatch(
            item,
            match.start,
            match.end,
            geometry.bounds,
            pageView.viewport.transform,
          )
          return clipped
            ? {
                ...geometry,
                bounds: { ...clipped.bounds, polygon: clipped.polygon },
                visibilityClips: clipped.clips,
              }
            : null
        })
        .filter(Boolean)
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
  // Only the viewport working set retains per-character visibility rules.
  // Scrolling through a long PDF must not grow an all-document second text cache.
  state.visibilityIndexPromise = null
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
  if (waitingForFirstPage) setReaderLoading("Rendering first page…")
})

eventBus.on("pagechanging", ({ pageNumber }) => {
  pageNumberElement.value = String(pageNumber || 1)
})

eventBus.on("pagerendered", ({ pageNumber }) => {
  const state = pageState.get(Number(pageNumber))
  if (!state) return
  state.rendered = true
  state.visible = pageIsInWorkingSet(state.pageElement)
  if (state.visible) void scanPage(Number(pageNumber))
  if (waitingForFirstPage && Number(pageNumber) === 1) {
    waitingForFirstPage = false
    setReaderReady()
  }
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

eventBus.on("optionalcontentconfigchanged", () => {
  closeActiveCard()
  for (const [pageNumber, state] of pageState) {
    state.renderRevision += 1
    state.visibilityIndexPromise = null
    removePageAnchors(pageNumber)
  }
  // The ensuing official text-layer/render events rebuild against the new config.
})

eventBus.on("rotationchanging", () => {
  closeActiveCard()
  for (const state of pageState.values()) state.renderRevision += 1
})

function transitionActiveAnchor(next, relatedTarget = null) {
  const previous = activeAnchor
  // Visibility reads activeAnchor, so publish the new selection before refresh.
  activeAnchor = next
  core.transitionReaderAnchor({
    previous,
    next,
    bridge,
    relatedTarget,
    refresh: applyHighlightVisibilityToState,
  })
}

container.addEventListener("pointermove", (event) => {
  if (!highlightingEnabled || !bridge) return
  if (event.target?.closest?.(".iconoplasm-tooltip")) return
  const anchor = findAnchorAtPoint(event.clientX, event.clientY)
  if (anchor === activeAnchor) return
  transitionActiveAnchor(anchor, event.target)
})

// The selectable PDF text owns pointer hit testing. Leaving its scroll container
// produces no further pointermove here; without this transition the old card
// stays open over the next gene even when that gene's image is already prepared.
// Forward the destination so entering the interactive card retains shared grace.
container.addEventListener("pointerleave", (event) => {
  transitionActiveAnchor(null, event.relatedTarget)
})
window.addEventListener("blur", () => {
  // Focusing the card's child iframe also blurs this window, but the document
  // still has focus. Closing then would swallow the reader's card interaction.
  if (!document.hasFocus()) closeActiveCard()
})

async function loadPdf(bytes, name = "document.pdf") {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
    throw new Error("The PDF source was empty")
  }
  clearAllHighlights()
  sourceBytes = bytes
  sourceName = name || "document.pdf"
  filenameElement.textContent = sourceName
  const loadId = ++activeLoadId
  waitingForFirstPage = false
  readerControls.setDocument(null)
  setReaderLoading(`Opening ${sourceName}…`)
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
    if (loadId !== activeLoadId) return
    pendingPasswordUpdate = updatePassword
    progressElement.hidden = true
    passwordForm.hidden = false
    passwordInput.value = ""
    passwordInput.focus()
    passwordMessageElement.textContent =
      reason === PasswordResponses.INCORRECT_PASSWORD
        ? "That password was incorrect. Try again."
        : "Enter the PDF password to continue."
    setStatus("")
  }
  loadingTask.onProgress = ({ loaded, total }) => {
    if (loadId !== activeLoadId || passwordForm.hidden === false) return
    setReaderLoading(`Opening ${sourceName}…`, loaded, total)
  }
  pdfDocument = await loadingTask.promise
  if (loadId !== activeLoadId) return
  pageCountElement.textContent = String(pdfDocument.numPages)
  pageNumberElement.value = "1"
  passwordForm.hidden = true
  pendingPasswordUpdate = null
  document.title = `${sourceName} — Iconoplasm Reader`
  waitingForFirstPage = true
  setReaderLoading("Rendering first page…")
  pdfViewer.setDocument(pdfDocument)
  linkService.setDocument(pdfDocument, null)
  readerControls.setDocument(pdfDocument)
}

passwordForm.addEventListener("submit", (event) => {
  event.preventDefault()
  pendingPasswordUpdate?.(passwordInput.value)
})

openFileActionButton.addEventListener("click", () => {
  const localPath = requestedLocalFilePath()
  if (localPath) {
    let copyAttempt
    try {
      copyAttempt = navigator.clipboard.writeText(localPath)
    } catch (error) {
      copyAttempt = Promise.reject(error)
    }
    setStatus("Exact path copied. In Firefox's picker, press Ctrl+V, then Open.", "empty", {
      actions: true,
    })
    void copyAttempt.catch(() => {
      setStatus(`Copy this path into Firefox's picker, then choose Open: ${localPath}`, "warning", {
        actions: true,
      })
    })
  }
  fileInput.click()
})

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  preserveLocalFileOwnership()
  try {
    setReaderLoading(`Loading ${file.name}…`, 0, file.size)
    const bytes = new Uint8Array(file.size)
    const reader = file.stream().getReader()
    let offset = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes.set(value, offset)
      offset += value.byteLength
      setReaderLoading(`Loading ${file.name}…`, offset, file.size)
    }
    await loadPdf(bytes, file.name)
  } catch (error) {
    setReaderError(error)
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
  preserveLocalFileOwnership()
  try {
    setReaderLoading(`Loading ${file.name}…`, 0, file.size)
    const bytes = new Uint8Array(await file.arrayBuffer())
    setReaderLoading(`Loading ${file.name}…`, bytes.byteLength, file.size)
    await loadPdf(bytes, file.name)
  } catch (error) {
    setReaderError(error)
  }
})

retryButton.addEventListener("click", () => {
  if (!sourceBytes) return
  void loadPdf(sourceBytes, sourceName).catch(setReaderError)
})

nativeFallbackButton.addEventListener("click", () => {
  if (ownedPdfSource && !handLocalBytesToNativeViewer()) void activeOwnership?.handBack?.()
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
function dispatchFind(findPrevious = false) {
  const query = findInput.value
  if (!query) {
    findCount.value = ""
    return
  }
  eventBus.dispatch("find", {
    source: window,
    type: "",
    query,
    phraseSearch: true,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious,
  })
}

findForm.addEventListener("submit", (event) => {
  event.preventDefault()
  dispatchFind(false)
})
findInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return
  event.preventDefault()
  dispatchFind(event.shiftKey)
})
findInput.addEventListener("input", () => dispatchFind(false))
findPreviousButton.addEventListener("click", () => dispatchFind(true))
findNextButton.addEventListener("click", () => dispatchFind(false))
eventBus.on("updatefindmatchescount", ({ matchesCount }) => {
  const { current = 0, total = 0 } = matchesCount || {}
  findCount.value = total ? `${current} / ${total}` : "0 / 0"
})
eventBus.on("updatefindcontrolstate", ({ matchesCount }) => {
  const { current = 0, total = 0 } = matchesCount || {}
  findCount.value = total ? `${current} / ${total}` : "0 / 0"
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
  if (ownedPdfSource && !handLocalBytesToNativeViewer()) void activeOwnership?.handBack?.()
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
    if (!handLocalBytesToNativeViewer()) void activeOwnership?.handBack?.()
    return
  }
  if (highlightingEnabled) refreshVisiblePages()
  else clearAllHighlights()
})

window.addEventListener("iconoplasm-reader-matcher-changed", refreshVisiblePages)
window.addEventListener(
  "iconoplasm-reader-bridge-ready",
  () => {
    bridge = globalThis.IconoplasmReaderBridge || null
    refreshVisiblePages()
  },
  { once: true },
)
window.addEventListener("iconoplasm-reader-highlight-mode-changed", refreshVisiblePages)
window.addEventListener("iconoplasm-reader-highlight-visibility-changed", () => {
  closeActiveCard()
  applyHighlightVisibilityToAllPages()
})

async function openOwnedStream(outcome) {
  if (!outcome || outcome.kind === "manual") {
    setReaderEmpty()
    return false
  }
  if (outcome.kind !== "stream") {
    setReaderError(new Error("The browser did not provide PDF data"))
    return true
  }
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
    setReaderError(error)
  }
  return true
}

let streamOutcome
try {
  streamOutcome = await globalThis.IconoplasmPdfStreamBootstrap?.outcome
} catch (error) {
  console.error("Iconoplasm Reader could not acquire the PDF", error)
  setReaderError(error)
}
await loadHighlightingPreference()
if (document.body.dataset.readerState === "error") {
  // The acquisition error is already visible and recoverable.
} else if (streamOutcome?.kind === "stream" && !highlightingEnabled) {
  await streamOutcome.handBack?.()
} else if (!streamOutcome || streamOutcome.kind === "manual") {
  activeOwnership = streamOutcome || null
  ownedPdfSource = isFirefoxLocalFileOwnership(streamOutcome)
  setReaderEmpty()
} else if (streamOutcome.kind !== "stream") {
  setReaderError(new Error("The browser did not provide PDF data"))
} else {
  setReaderLoading("Preparing PDF reader…")
  try {
    await waitForBridge()
    await openOwnedStream(streamOutcome)
  } catch (error) {
    console.error("Iconoplasm Reader could not initialize", error)
    ownedPdfSource = true
    activeOwnership = streamOutcome
    sourceBytes = streamOutcome.bytes
    setReaderError(error)
  }
}
