const PRINT_SCALE = 150 / 72
const THUMBNAIL_WIDTH = 180

function element(id) {
  return document.getElementById(id)
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (!value) return "Unknown"
  const units = ["bytes", "KB", "MB", "GB"]
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** exponent
  return `${amount.toFixed(exponent === 0 || amount >= 10 ? 0 : 1)} ${units[exponent]}`
}

function formatPdfDate(value) {
  if (!value) return "Unknown"
  const match = String(value).match(/^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/u)
  if (!match) return String(value)
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  )
  return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString()
}

function isEditingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, button, [contenteditable='true']"))
}

export function createPdfReaderControls({
  container,
  eventBus,
  linkService,
  pdfViewer,
  getSourceBytes,
  getSourceName,
}) {
  const sidebarToggle = element("sidebar-toggle")
  const sidebar = element("reader-sidebar")
  const thumbnailTab = element("thumbnail-tab")
  const outlineTab = element("outline-tab")
  const thumbnailView = element("thumbnail-view")
  const outlineView = element("outline-view")
  const previousButton = element("previous-page")
  const nextButton = element("next-page")
  const pageInput = element("page-number")
  const pageCount = element("page-count")
  const fitWidthButton = element("fit-width")
  const printButton = element("print")
  const presentationButton = element("presentation-mode")
  const propertiesButton = element("document-properties")
  const propertiesDialog = element("document-properties-dialog")
  const propertiesList = element("document-properties-list")
  const printDialog = element("print-dialog")
  const printProgress = element("print-progress")
  const printProgressLabel = element("print-progress-label")
  const printCancel = element("print-cancel")
  const printContainer = element("print-container")
  const managedControls = [
    sidebarToggle,
    previousButton,
    nextButton,
    pageInput,
    fitWidthButton,
    printButton,
    presentationButton,
    propertiesButton,
  ]

  let pdfDocument = null
  let enabled = false
  let restoringView = false
  let printCancelled = false
  let activePrintTask = null
  let thumbnailObserver = null
  let documentGeneration = 0

  function updateNavigation(pageNumber = pdfViewer.currentPageNumber || 1) {
    const page = Math.max(1, Math.min(pdfDocument?.numPages || 1, Number(pageNumber) || 1))
    pageInput.value = String(page)
    previousButton.disabled = !enabled || page <= 1
    nextButton.disabled = !enabled || page >= (pdfDocument?.numPages || 1)
    for (const button of thumbnailView.querySelectorAll(".reader-thumbnail")) {
      if (Number(button.dataset.pageNumber) === page) button.setAttribute("aria-current", "page")
      else button.removeAttribute("aria-current")
    }
  }

  function serializeCurrentView() {
    if (!pdfDocument || restoringView) return
    const page = pdfViewer.currentPageNumber || 1
    const zoom = Math.round((Number(pdfViewer.currentScale) || 1) * 100)
    const rotation = pdfViewer.pagesRotation || 0
    history.replaceState(history.state, "", `#page=${page}&zoom=${zoom}&rotation=${rotation}`)
  }

  function restoreCurrentView() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""))
    const page = Math.max(1, Math.min(pdfDocument?.numPages || 1, Number(params.get("page")) || 1))
    const zoom = Number(params.get("zoom"))
    const rotation = Number(params.get("rotation"))
    if (Number.isFinite(rotation) && rotation % 90 === 0) pdfViewer.pagesRotation = rotation % 360
    if (Number.isFinite(zoom) && zoom >= 10 && zoom <= 1000)
      pdfViewer.currentScaleValue = zoom / 100
    pdfViewer.currentPageNumber = page
    updateNavigation(page)
    restoringView = false
    serializeCurrentView()
  }

  async function renderThumbnail(button) {
    if (!pdfDocument || button.dataset.rendered === "true") return
    button.dataset.rendered = "pending"
    try {
      const page = await pdfDocument.getPage(Number(button.dataset.pageNumber))
      const unscaled = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / unscaled.width })
      const canvas = button.querySelector("canvas")
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise
      button.dataset.rendered = "true"
    } catch (error) {
      button.dataset.rendered = "error"
      console.warn("Iconoplasm Reader could not render a thumbnail", error)
    }
  }

  function buildThumbnails() {
    thumbnailObserver?.disconnect()
    thumbnailView.replaceChildren()
    if (!pdfDocument) return
    thumbnailObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) void renderThumbnail(entry.target)
      },
      { root: thumbnailView, rootMargin: "200px 0px" },
    )
    const fragment = document.createDocumentFragment()
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "reader-thumbnail"
      button.dataset.pageNumber = String(pageNumber)
      button.setAttribute("aria-label", `Go to page ${pageNumber}`)
      const canvas = document.createElement("canvas")
      canvas.width = THUMBNAIL_WIDTH
      canvas.height = Math.round(THUMBNAIL_WIDTH * 1.3)
      const label = document.createElement("span")
      label.textContent = String(pageNumber)
      button.append(canvas, label)
      button.addEventListener("click", () => {
        pdfViewer.currentPageNumber = pageNumber
        sidebarToggle.focus()
      })
      fragment.append(button)
      thumbnailObserver.observe(button)
    }
    thumbnailView.append(fragment)
    updateNavigation()
  }

  function createOutlineList(items) {
    const list = document.createElement("ol")
    list.className = "reader-outline-list"
    for (const item of items) {
      const row = document.createElement("li")
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = item.title || "Untitled section"
      button.title = button.textContent
      button.addEventListener("click", () => {
        if (item.dest) void linkService.goToDestination(item.dest)
        else if (item.url) window.open(item.url, "_blank", "noopener,noreferrer")
      })
      row.append(button)
      if (item.items?.length) row.append(createOutlineList(item.items))
      list.append(row)
    }
    return list
  }

  async function buildOutline(generation) {
    outlineView.replaceChildren()
    const outline = await pdfDocument?.getOutline()
    if (generation !== documentGeneration) return
    if (!outline?.length) {
      const empty = document.createElement("p")
      empty.className = "reader-sidebar-empty"
      empty.textContent = "This PDF has no document outline."
      outlineView.append(empty)
      return
    }
    outlineView.append(createOutlineList(outline))
  }

  function showSidebarView(view) {
    const showOutline = view === "outline"
    thumbnailTab.setAttribute("aria-selected", String(!showOutline))
    outlineTab.setAttribute("aria-selected", String(showOutline))
    thumbnailView.hidden = showOutline
    outlineView.hidden = !showOutline
  }

  async function showDocumentProperties() {
    if (!pdfDocument) return
    const { info = {}, metadata, contentLength } = await pdfDocument.getMetadata()
    const metadataTitle = metadata?.get?.("dc:title")
    const rows = [
      ["File name", getSourceName()],
      ["File size", formatBytes(contentLength || getSourceBytes()?.byteLength)],
      ["Title", info.Title || metadataTitle || "Unknown"],
      ["Author", info.Author || metadata?.get?.("dc:creator") || "Unknown"],
      ["Pages", String(pdfDocument.numPages)],
      ["PDF version", info.PDFFormatVersion || "Unknown"],
      ["Created", formatPdfDate(info.CreationDate)],
      ["Modified", formatPdfDate(info.ModDate)],
      ["Producer", info.Producer || "Unknown"],
    ]
    const fragment = document.createDocumentFragment()
    for (const [term, description] of rows) {
      const dt = document.createElement("dt")
      dt.textContent = term
      const dd = document.createElement("dd")
      dd.textContent = String(description)
      fragment.append(dt, dd)
    }
    propertiesList.replaceChildren(fragment)
    propertiesDialog.showModal()
  }

  function cleanupPrint() {
    activePrintTask = null
    printContainer.replaceChildren()
    printCancelled = false
  }

  async function printDocument() {
    if (!pdfDocument || printDialog.open) return
    printCancelled = false
    printProgress.value = 0
    printProgressLabel.value = "0%"
    printContainer.replaceChildren()
    printDialog.showModal()
    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        if (printCancelled) return
        const page = await pdfDocument.getPage(pageNumber)
        const viewport = page.getViewport({ scale: PRINT_SCALE, rotation: pdfViewer.pagesRotation })
        const canvas = document.createElement("canvas")
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        printContainer.append(canvas)
        activePrintTask = page.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
          intent: "print",
        })
        await activePrintTask.promise
        const percent = Math.round((pageNumber / pdfDocument.numPages) * 100)
        printProgress.value = percent
        printProgressLabel.value = `${percent}%`
      }
      printDialog.close()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.addEventListener("afterprint", cleanupPrint, { once: true })
      window.print()
      window.setTimeout(() => {
        if (printContainer.childElementCount) cleanupPrint()
      }, 60_000)
    } catch (error) {
      if (!printCancelled) console.error("Iconoplasm Reader could not prepare printing", error)
      printDialog.close()
      cleanupPrint()
    }
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled && pdfDocument)
    for (const control of managedControls) control.disabled = !enabled
    updateNavigation()
  }

  function setDocument(document) {
    documentGeneration += 1
    const generation = documentGeneration
    pdfDocument = document
    pageCount.textContent = String(document?.numPages || "-")
    restoringView = Boolean(location.hash)
    buildThumbnails()
    void buildOutline(generation)
    setEnabled(false)
  }

  sidebarToggle.addEventListener("click", () => {
    const open = sidebar.hidden
    sidebar.hidden = !open
    document.body.dataset.sidebarOpen = String(open)
    sidebarToggle.setAttribute("aria-expanded", String(open))
    sidebarToggle.title = open ? "Hide document sidebar" : "Show document sidebar"
    sidebarToggle.setAttribute("aria-label", sidebarToggle.title)
  })
  thumbnailTab.addEventListener("click", () => showSidebarView("thumbnails"))
  outlineTab.addEventListener("click", () => showSidebarView("outline"))
  previousButton.addEventListener("click", () => {
    pdfViewer.currentPageNumber = Math.max(1, pdfViewer.currentPageNumber - 1)
  })
  nextButton.addEventListener("click", () => {
    pdfViewer.currentPageNumber = Math.min(pdfDocument.numPages, pdfViewer.currentPageNumber + 1)
  })
  pageInput.addEventListener("change", () => {
    pdfViewer.currentPageNumber = Math.max(
      1,
      Math.min(pdfDocument?.numPages || 1, Number(pageInput.value) || 1),
    )
    updateNavigation()
  })
  fitWidthButton.addEventListener("click", () => {
    pdfViewer.currentScaleValue = "page-width"
  })
  printButton.addEventListener("click", () => void printDocument())
  presentationButton.addEventListener("click", () => void container.requestFullscreen())
  propertiesButton.addEventListener("click", () => void showDocumentProperties())
  printCancel.addEventListener("click", () => {
    printCancelled = true
    activePrintTask?.cancel()
    cleanupPrint()
  })

  eventBus.on("pagesinit", () => {
    if (restoringView) restoreCurrentView()
  })
  eventBus.on("pagechanging", ({ pageNumber }) => {
    updateNavigation(pageNumber)
    serializeCurrentView()
  })
  eventBus.on("scalechanging", serializeCurrentView)
  eventBus.on("rotationchanging", serializeCurrentView)

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === "p") {
      if (!enabled) return
      event.preventDefault()
      void printDocument()
      return
    }
    if (isEditingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
    if (["pagedown", "arrowdown", "arrowright"].includes(key)) {
      event.preventDefault()
      nextButton.click()
    } else if (["pageup", "arrowup", "arrowleft"].includes(key)) {
      event.preventDefault()
      previousButton.click()
    } else if (key === "home") {
      event.preventDefault()
      pdfViewer.currentPageNumber = 1
    } else if (key === "end") {
      event.preventDefault()
      pdfViewer.currentPageNumber = pdfDocument?.numPages || 1
    } else if (key === "+" || key === "=") {
      event.preventDefault()
      element("zoom-in").click()
    } else if (key === "-") {
      event.preventDefault()
      element("zoom-out").click()
    }
  })

  return Object.freeze({ setDocument, setEnabled })
}
