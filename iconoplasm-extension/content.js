// Iconoplasm content script -- scans page text for gene symbols, wraps them,
// and shows horizontal hover infoboxes with portrait + gene color border.
// Canonical extension root now lives in D:\Coding\Website\iconoplasm-extension.

;(function () {
  "use strict"

  const isPdfReaderDocument = document.documentElement?.dataset?.iconoplasmPdfReader === "true"
  const isOuterRawFilePdfDocument =
    !isPdfReaderDocument &&
    window.location.protocol === "file:" &&
    /(?:\.pdf|%2epdf)$/iu.test(window.location.pathname)
  // Chrome keeps the raw file URL as an outer document around the registered
  // MIME handler. The extension reader inside that document owns all PDF UI.
  // Initializing a second scanner here creates duplicate hidden tooltips and
  // makes the off state observably different from the native PDF path.
  if (isOuterRawFilePdfDocument) return

  const IconoCardShared = globalThis.IconoplasmCardShared
  const IconoContentApi = globalThis.IconoplasmContentApi
  const IconoContentSettings = globalThis.IconoplasmContentSettings
  const IconoContentMatcher = globalThis.IconoplasmContentMatcher
  const IconoContentScanner = globalThis.IconoplasmContentScanner
  const IconoContentLifecycle = globalThis.IconoplasmContentLifecycle
  const IconoContentTooltip = globalThis.IconoplasmContentTooltip
  const IconoContentPortraitCache = globalThis.IconoplasmContentPortraitCache
  const IconoContentDetailCache = globalThis.IconoplasmContentDetailCache
  const IconoContentVoteBridge = globalThis.IconoplasmContentVoteBridge
  const IconoHighlightRuntime = globalThis.IconoplasmHighlightRuntime
  const IconoReadingSession = globalThis.IconoplasmReadingSession
  if (!IconoCardShared) {
    console.error(
      "[Iconoplasm] shared card runtime missing: load generated/shared-card-runtime.js first",
    )
    return
  }
  if (!IconoContentApi || typeof IconoContentApi.createExtensionApiFetch !== "function") {
    console.error("[Iconoplasm] content API bridge missing: load content-api.js first")
    return
  }
  if (!IconoContentSettings) {
    console.error("[Iconoplasm] content settings missing: load content-settings.js first")
    return
  }
  if (!IconoContentMatcher) {
    console.error("[Iconoplasm] content matcher missing: load content-matcher.js first")
    return
  }
  if (!IconoContentScanner || typeof IconoContentScanner.createPageScanner !== "function") {
    console.error("[Iconoplasm] content scanner missing: load content-scanner.js first")
    return
  }
  if (
    !IconoContentLifecycle ||
    typeof IconoContentLifecycle.requestGeneData !== "function" ||
    typeof IconoContentLifecycle.createMutationScanController !== "function" ||
    typeof IconoContentLifecycle.scheduleHostFirstBackgroundWork !== "function" ||
    typeof IconoContentLifecycle.runAfterHostLoad !== "function"
  ) {
    console.error("[Iconoplasm] content lifecycle missing: load content-lifecycle.js first")
    return
  }
  if (
    !IconoContentTooltip ||
    typeof IconoContentTooltip.createTooltipShell !== "function" ||
    typeof IconoContentTooltip.postBackgroundTask !== "function" ||
    typeof IconoContentTooltip.createAdapterOwnedPortraitState !== "function" ||
    typeof IconoContentTooltip.createPersistentFrameController !== "function"
  ) {
    console.error("[Iconoplasm] content tooltip shell missing: load content-tooltip.js first")
    return
  }
  if (
    !IconoContentPortraitCache ||
    typeof IconoContentPortraitCache.createPortraitCache !== "function"
  ) {
    console.error(
      "[Iconoplasm] content portrait cache missing: load content-portrait-cache.js first",
    )
    return
  }
  if (
    !IconoContentDetailCache ||
    typeof IconoContentDetailCache.createGeneDetailStore !== "function"
  ) {
    console.error("[Iconoplasm] content detail cache missing: load content-detail-cache.js first")
    return
  }
  if (!IconoContentVoteBridge || typeof IconoContentVoteBridge.createVoteBoxNode !== "function") {
    console.error("[Iconoplasm] content vote bridge missing: load content-vote-bridge.js first")
    return
  }
  if (
    !IconoHighlightRuntime ||
    typeof IconoHighlightRuntime.createHighlightRuntime !== "function"
  ) {
    console.error("[Iconoplasm] highlight runtime missing: load highlight-runtime.js first")
    return
  }
  if (!IconoReadingSession || typeof IconoReadingSession.createReadingSession !== "function") {
    console.error("[Iconoplasm] reading session missing: load content-reading-session.js first")
    return
  }

  // -- Placeholder color for genes without color data ----------------
  const PLACEHOLDER_COLOR = "#6B6B78"
  const CONTENT_STORAGE_KEYS = IconoContentSettings.storageKeys
  const HIGHLIGHT_MODE_KEY = CONTENT_STORAGE_KEYS.highlightMode
  const HIGHLIGHT_VISIBILITY_KEY = CONTENT_STORAGE_KEYS.highlightVisibility
  const CARD_VARIANT_KEY = CONTENT_STORAGE_KEYS.cardVariant
  const GUEST_DISCOVERIES_STORAGE_KEY = CONTENT_STORAGE_KEYS.guestDiscoveries
  const REMOVED_DEFAULTS_KEY = CONTENT_STORAGE_KEYS.removedDefaults
  const SHARED_BLOCKLIST_KEY = CONTENT_STORAGE_KEYS.sharedBlocklist
  const USER_BLOCKLIST_KEY = CONTENT_STORAGE_KEYS.userBlocklist
  const ICONOPLASM_API_BASE = IconoCardShared.resolveApiBase("https://iconoplasm.brinedew.bio")
  const ICONOPLASM_GENE_BATCH_URL = ICONOPLASM_API_BASE + "/api/public/v1/genes/batch"
  const ICONOPLASM_GENE_DETAIL_PREFIX = ICONOPLASM_API_BASE + "/api/public/v1/card-snapshots/"
  const ICONOPLASM_PORTRAIT_LOCATOR_PREFIX = ICONOPLASM_API_BASE + "/api/public/v1/card-snapshots/"
  const ICONOPLASM_DISCOVERY_ENCOUNTER_URL =
    ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/encounter"
  const ICONOPLASM_DISCOVERY_STATE_URL = ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/me"
  const ICONOPLASM_DISCOVERY_MERGE_URL = ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/merge"
  const LIT_ARCHIVAL_FRAME_URL = chrome.runtime.getURL("lit-archival-frame.html")
  const LIT_ARCHIVAL_FRAME_ORIGIN = new URL(LIT_ARCHIVAL_FRAME_URL).origin
  const LIT_ARCHIVAL_FRAME_SOURCE = "iconoplasm-lit-archival-frame"
  const LIT_ARCHIVAL_RENDER_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_RENDER"
  const LIT_ARCHIVAL_PREWARM_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_PREWARM"
  const LIT_ARCHIVAL_PREWARMED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_PREWARMED"
  const LIT_ARCHIVAL_READY_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_READY"
  const LIT_ARCHIVAL_RENDERED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_RENDERED"
  const LIT_ARCHIVAL_OPEN_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_OPEN"
  const LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"
  const DEFAULT_PORTRAIT_DIMENSIONS = Object.freeze({ width: 768, height: 1024 })
  const DISCOVERY_HOVER_DWELL_MS = 900
  const DISCOVERY_SYMBOL_COOLDOWN_MS = 30 * 1000
  const DISCOVERY_AUTH_CACHE_TTL_MS = 5 * 60 * 1000
  const GUEST_DISCOVERY_SYMBOL_MAX = 2000
  const GENE_DETAIL_PERSISTENT_MAX_BYTES = 4 * 1024 * 1024
  const GENE_DATA_REQUEST_TIMEOUT_MS = 5000
  const GENE_DATA_RETRY_DELAY_MS = 750
  // Fence: the hover card needs identity, accent color, synced essence, and the
  // published portrait metadata that powers both rendering and the vote box.
  // Do not ask the batch API for the full deluxe gene payload here unless the
  // tooltip/UI really starts consuming more fields, because that hot path is
  // shared across repeated extension hovers on arbitrary pages.
  const GENE_DETAIL_BATCH_FIELDS = Object.freeze([
    "symbol",
    "full_name",
    "color",
    "essence",
    "first_publication_year",
    "molecular_weight_kda",
    "primary_tissue",
    "portrait",
  ])
  const escapeHtml = IconoCardShared.escapeHtml
  const extensionApiFetch = IconoContentApi.createExtensionApiFetch(chrome)

  const DARK_TEXT_RGB = Object.freeze([24, 22, 20])
  const LIGHT_TEXT_RGB = Object.freeze([249, 247, 242])
  const APCA_DELTA_Y_MIN = 0.0005
  const APCA_MIN_CONTRAST = 0.1
  const APCA_CONTRAST_OFFSET = 0.027
  const APCA_SCALE = 1.14
  const APCA_BLACK_THRESHOLD = 0.022
  const APCA_BLACK_CLAMP_EXP = 1.414
  const WHITE_TEXT_WIN_MARGIN_APCA = 15

  // -- Perceptual text color helpers ---------------------------------
  function parseHexRgb(hex) {
    const raw = String(hex || "")
      .trim()
      .replace(/^#/, "")
    if (!raw) return null
    const normalized = raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16),
    ]
  }

  function apcaRelativeLuminance(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return 0
    return (
      0.2126729 * Math.pow(rgb[0] / 255, 2.4) +
      0.7151522 * Math.pow(rgb[1] / 255, 2.4) +
      0.072175 * Math.pow(rgb[2] / 255, 2.4)
    )
  }

  function apcaClampBlack(relativeLuminance) {
    if (relativeLuminance >= APCA_BLACK_THRESHOLD) return relativeLuminance
    return (
      relativeLuminance + Math.pow(APCA_BLACK_THRESHOLD - relativeLuminance, APCA_BLACK_CLAMP_EXP)
    )
  }

  function apcaContrast(textRgb, backgroundRgb) {
    const textY = apcaClampBlack(apcaRelativeLuminance(textRgb))
    const backgroundY = apcaClampBlack(apcaRelativeLuminance(backgroundRgb))
    if (Math.abs(backgroundY - textY) < APCA_DELTA_Y_MIN) return 0

    const sapc =
      backgroundY > textY
        ? (Math.pow(backgroundY, 0.56) - Math.pow(textY, 0.57)) * APCA_SCALE
        : (Math.pow(backgroundY, 0.65) - Math.pow(textY, 0.62)) * APCA_SCALE

    if (Math.abs(sapc) < APCA_MIN_CONTRAST) return 0
    return 100 * (sapc > 0 ? sapc - APCA_CONTRAST_OFFSET : sapc + APCA_CONTRAST_OFFSET)
  }

  // Returns { primary, muted } text colors for a given hex background.
  // This stays APCA-style on purpose: simple luminance ratios are fine for coarse audits,
  // but they regularly pick the wrong ink on saturated fills that human vision reads differently.
  function textColors(hex) {
    const backgroundRgb = parseHexRgb(hex) || parseHexRgb(PLACEHOLDER_COLOR) || [107, 107, 120]
    const darkContrast = Math.abs(apcaContrast(DARK_TEXT_RGB, backgroundRgb))
    const lightContrast = Math.abs(apcaContrast(LIGHT_TEXT_RGB, backgroundRgb))
    // Keep the APCA math, but do not let white ink win every near-tie. It has to beat
    // dark ink by a noticeable margin before we trust it on a filled pill.
    const whiteWins = lightContrast >= darkContrast + WHITE_TEXT_WIN_MARGIN_APCA

    if (!whiteWins) {
      return {
        primary: "rgb(24, 22, 20)",
        muted: "rgba(24, 22, 20, 0.82)",
        separator: "rgba(24, 22, 20, 0.16)",
      }
    }
    return {
      primary: "rgb(249, 247, 242)",
      muted: "rgba(249, 247, 242, 0.86)",
      separator: "rgba(249, 247, 242, 0.16)",
    }
  }

  const highlightRuntime = IconoHighlightRuntime.createHighlightRuntime({
    cardShared: IconoCardShared,
    placeholderColor: PLACEHOLDER_COLOR,
    textColors,
    resolveColor(symbol) {
      const gene = symbol ? geneMap && geneMap[symbol] : null
      return gene && gene.c ? gene.c : PLACEHOLDER_COLOR
    },
  })
  const HIGHLIGHT_RENDER_CONTRACT = IconoHighlightRuntime.HIGHLIGHT_RENDER_CONTRACT
  const HIGHLIGHT_RENDERERS = highlightRuntime.renderers
  const normalizeHighlightMode = highlightRuntime.normalizeHighlightMode
  const applyHighlightStyle = highlightRuntime.applyHighlightStyle
  const refreshHighlightStyles = highlightRuntime.refreshHighlightStyles
  const scheduleHighlightGeometryRefresh = highlightRuntime.scheduleHighlightGeometryRefresh

  const normalizeCardVariant = (raw) =>
    IconoContentSettings.normalizeCardVariant(raw, IconoCardShared)

  async function loadHighlightMode() {
    try {
      const result = await chrome.storage.local.get([HIGHLIGHT_MODE_KEY])
      const storedMode = String(result[HIGHLIGHT_MODE_KEY] || "").trim()
      highlightMode = highlightRuntime.setMode(storedMode || "pill")
    } catch (_) {
      highlightMode = highlightRuntime.setMode("pill")
    }
  }

  const normalizeHighlightVisibility = IconoContentSettings.normalizeHighlightVisibility

  function applyHighlightVisibility() {
    document.body.classList.toggle("iconoplasm-highlight-on-hover", highlightVisibility === "hover")
  }

  async function loadHighlightVisibility() {
    try {
      const result = await chrome.storage.local.get([HIGHLIGHT_VISIBILITY_KEY])
      highlightVisibility = normalizeHighlightVisibility(result[HIGHLIGHT_VISIBILITY_KEY])
    } catch (_) {
      highlightVisibility = "always"
    }
    applyHighlightVisibility()
  }

  async function loadCardVariant() {
    try {
      const result = await chrome.storage.local.get([CARD_VARIANT_KEY])
      cardVariant = normalizeCardVariant(result[CARD_VARIANT_KEY])
    } catch (_) {
      cardVariant = "image-only"
    }
  }

  function isArchivalCardVariant() {
    return cardVariant === "lit-archival"
  }

  function isImageOnlyCardVariant() {
    return cardVariant === "image-only"
  }

  // Fence: only Lit-owned variants go through the iframe. The simple tooltip stays native DOM so
  // fast hover metadata does not pay an iframe/runtime tax, while the printed layouts remain
  // isolated from arbitrary page CSS.
  function usesTooltipFrameRenderer() {
    return cardVariant === "lit-archival" || cardVariant === "image-only"
  }

  function applyTooltipTheme() {
    if (!tooltip) return
    tooltip.classList.remove("iconoplasm-tooltip--dark")
    tooltip.classList.add("iconoplasm-tooltip--light")
    tooltip.classList.toggle("iconoplasm-tooltip--variant-lab-label", isArchivalCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--variant-image-only", isImageOnlyCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--frame-card", usesTooltipFrameRenderer())
  }

  function applySupportedTooltipInlineMarkup(container, markup) {
    const text = String(markup || "")
    const skinDotMatch = text.match(
      /^<span class="iconoplasm-tooltip-skin-dot" style="background:([^"]+)"><\/span>(.*)$/,
    )
    if (skinDotMatch) {
      const dot = document.createElement("span")
      dot.className = "iconoplasm-tooltip-skin-dot"
      dot.style.background = skinDotMatch[1]
      container.appendChild(dot)
      if (skinDotMatch[2]) {
        container.appendChild(document.createTextNode(skinDotMatch[2]))
      }
      return
    }
    container.textContent = text.replace(/<[^>]+>/g, "")
  }

  function createTooltipMetaValueNode(value, isHtml = false) {
    const node = document.createElement("span")
    node.className = "iconoplasm-tooltip-meta-value"
    if (isHtml) {
      applySupportedTooltipInlineMarkup(node, value)
    } else {
      node.textContent = String(value || "")
    }
    return node
  }

  function createTooltipMetaRowNode(character, molecular, options = {}) {
    const row = document.createElement("div")
    row.className = "iconoplasm-tooltip-meta-row"

    const characterCell = document.createElement("div")
    characterCell.className = "iconoplasm-tooltip-meta-cell"
    characterCell.appendChild(
      createTooltipMetaValueNode(character, Boolean(options.characterIsHtml)),
    )

    const molecularCell = document.createElement("div")
    molecularCell.className = "iconoplasm-tooltip-meta-cell iconoplasm-tooltip-meta-cell--origin"
    molecularCell.appendChild(
      createTooltipMetaValueNode(molecular, Boolean(options.molecularIsHtml)),
    )

    row.append(characterCell, molecularCell)
    return row
  }

  function renderTooltipMetaContent(metaEl, detail, loading) {
    if (!metaEl) return
    metaEl.replaceChildren()
    metaEl.classList.toggle("iconoplasm-tooltip-meta--loading", Boolean(loading))
    if (detail) {
      const rows = IconoCardShared.collectTooltipMetaRows(detail, {
        onMissingOrigins: (warnKey, payload) => {
          if (warnedMissingTraitOrigins.has(warnKey)) return
          warnedMissingTraitOrigins.add(warnKey)
          console.error(
            "[Iconoplasm] Missing aesthetics/politics origin metadata for tooltip:",
            warnKey,
            payload,
          )
        },
      })
      for (const row of rows) {
        if (Array.isArray(row && row.pairs) && row.pairs.length) {
          for (const pair of row.pairs) {
            metaEl.appendChild(createTooltipMetaRowNode(pair.character, pair.molecular))
          }
          continue
        }
        metaEl.appendChild(
          createTooltipMetaRowNode(row && row.character, row && row.molecular, {
            characterIsHtml: row && row.characterIsHtml,
            molecularIsHtml: row && row.molecularIsHtml,
          }),
        )
      }
      return
    }
    if (!loading) return
    for (let index = 0; index < 4; index += 1) {
      const row = document.createElement("div")
      row.className = "iconoplasm-tooltip-meta-skeleton-row"
      const primaryCell = document.createElement("div")
      primaryCell.className = "iconoplasm-tooltip-meta-skeleton-cell"
      const primaryLine = document.createElement("span")
      primaryLine.className =
        "iconoplasm-tooltip-skeleton-line" +
        (index % 2 === 1 ? " iconoplasm-tooltip-skeleton-line--short" : "")
      primaryCell.appendChild(primaryLine)

      const secondaryCell = document.createElement("div")
      secondaryCell.className =
        "iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin"
      const secondaryLine = document.createElement("span")
      secondaryLine.className =
        "iconoplasm-tooltip-skeleton-line" +
        (index % 2 === 0 ? " iconoplasm-tooltip-skeleton-line--short" : "")
      secondaryCell.appendChild(secondaryLine)

      row.append(primaryCell, secondaryCell)
      metaEl.appendChild(row)
    }
  }

  function renderSimpleTooltipBody(body, summaryGene, geneDetail, loading, portraitLocator = null) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const fullName = String((detail && detail.full_name) || summary.n || symbol).trim()
    const assetSha = portraitAssetShaFromRecord(coherentPortraitRecord(detail, portraitLocator))

    body.replaceChildren()

    const header = document.createElement("div")
    header.className = "iconoplasm-tooltip-header"
    const headerRow = document.createElement("div")
    headerRow.className = "icono-shared-card-header-row"
    const headerCopy = document.createElement("div")
    headerCopy.className = "icono-shared-card-header-copy"

    const symbolEl = document.createElement("div")
    symbolEl.className = "iconoplasm-tooltip-symbol"
    symbolEl.textContent = symbol
    const nameEl = document.createElement("div")
    nameEl.className = "iconoplasm-tooltip-name"
    nameEl.textContent = fullName || symbol
    headerCopy.append(symbolEl, nameEl)

    const voteSlot = document.createElement("div")
    voteSlot.className = "iconoplasm-tooltip-vote-slot"
    voteSlot.setAttribute("data-icono-tooltip-vote-slot", "")
    if (assetSha) {
      voteSlot.appendChild(IconoContentVoteBridge.createVoteBoxNode(document))
    }

    headerRow.append(headerCopy, voteSlot)
    header.appendChild(headerRow)

    const meta = document.createElement("div")
    meta.className = "iconoplasm-tooltip-meta"
    renderTooltipMetaContent(meta, detail, loading)

    body.append(header, meta)
  }

  function resetSimpleTooltipPortrait(portrait) {
    if (!portrait) {
      return {
        portrait: null,
        portraitImg: null,
        portraitFallback: null,
        portraitStatus: null,
        portraitSymbol: null,
        fade: null,
      }
    }

    portrait.replaceChildren()

    const portraitImg = document.createElement("img")
    portraitImg.className = "iconoplasm-tooltip-portrait-img"
    portraitImg.alt = ""

    const portraitFallback = document.createElement("div")
    portraitFallback.className = "iconoplasm-tooltip-portrait-fallback"
    const portraitStatus = document.createElement("div")
    portraitStatus.className = "iconoplasm-tooltip-portrait-status"
    portraitStatus.textContent = "Portrait pending"
    const portraitSymbol = document.createElement("div")
    portraitSymbol.className = "iconoplasm-tooltip-portrait-symbol"
    portraitFallback.append(portraitStatus, portraitSymbol)

    const fade = document.createElement("div")
    fade.className = "iconoplasm-tooltip-portrait-fade"

    portrait.append(portraitImg, portraitFallback, fade)
    return { portrait, portraitImg, portraitFallback, portraitStatus, portraitSymbol, fade }
  }

  // -- Disambiguation blocklist --------------------------------------
  // ARCHITECTURE FENCE [IPD-008]: the last valid admin-published shared policy
  // is authoritative. blocklist-defaults.js is only the first-run/offline fallback.
  // Users can remove defaults via the popup; those removals are stored
  // in chrome.storage under REMOVED_DEFAULTS_KEY. Extra user-added
  // entries live under USER_BLOCKLIST_KEY. The effective blocklist at
  // runtime = (defaults - removed) + user-added.
  // prettier-ignore
  const SKIP_TAGS = new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","SELECT","CODE","PRE","NOSCRIPT","IFRAME","SVG","MATH","HEAD","TITLE","META","LINK"])

  // -- State ---------------------------------------------------------
  let geneMap = null // { SYMBOL: { c?, n?, u?, a?, p? } }
  let geneMatcher = null
  let tooltip = null
  let authToast = null
  let activeSymbol = null
  let activeTooltipAnchor = null
  let activeDetailAbortController = null
  let activeCardSnapshotRevision = ""
  let cardSnapshotRefreshPromise = null
  let hideTimer = null
  const discoveryTimerBySymbol = new Map()
  const discoveryCooldownUntilBySymbol = new Map()
  const discoveryInFlightSymbols = new Set()
  const discoveredPageSymbols = new Set()
  const guestDiscoverySymbols = new Set()
  let guestDiscoveryMergePromise = null
  let discoveryBufferFlushScheduled = false
  let discoveryAuthState = {
    checkedAt: 0,
    authenticated: null,
    discoveredSymbols: [],
  }
  let portraitLoadToken = 0
  let mutationScanController = null
  let pageScanner = null
  let initializationPromise = null
  let initializationRetryTimer = 0
  let initialized = false
  let effectiveBlocklist = new Set()
  let highlightMode = highlightRuntime.setMode("pill")
  let highlightVisibility = "always"
  let cardVariant = "image-only"
  let activeGeneSummary = null
  let tooltipNavigationArmedAt = 0
  let litArchivalFrameRequestSerial = 0
  let litArchivalFrameShell = null
  let simpleTooltipSurface = null
  const litArchivalFrameController = IconoContentTooltip.createPersistentFrameController({
    documentRef: document,
    getHost: () => {
      const surfaces = ensureTooltipSurfaces()
      return surfaces ? surfaces.frameShell : null
    },
    frameUrl: LIT_ARCHIVAL_FRAME_URL,
    frameOrigin: LIT_ARCHIVAL_FRAME_ORIGIN,
    onPostError: (error) => {
      console.error("[Iconoplasm] failed to post archival frame payload:", error)
    },
  })
  const pendingLitArchivalPrewarmSources = new Set()
  const inFlightLitArchivalPrewarmSources = new Set()
  const readyLitArchivalPrewarmSources = new Set()
  const warnedMissingTraitOrigins = new Set()
  const warnedPortraitProjectionMismatches = new Set()
  // Fence: keep background detail batches small. Large batches made the hovered gene wait behind
  // bulk prewarm work, which is why "simple text loads seconds later" showed up in practice.
  const TOOLTIP_VIEWPORT_MARGIN_PX = 8
  const TOOLTIP_TARGET_GAP_PX = 8
  const TOOLTIP_NAVIGATION_DELAY_MS = 500
  const decodedPortraitSrcCache = new Set()
  const decodedPortraitSrcPromises = new Map()
  const DECODED_PORTRAIT_CACHE_LIMIT = 96
  const LIT_ARCHIVAL_PREWARM_CACHE_LIMIT = 48

  function rememberReadyLitArchivalPrewarmSource(src) {
    readyLitArchivalPrewarmSources.delete(src)
    readyLitArchivalPrewarmSources.add(src)
    while (readyLitArchivalPrewarmSources.size > LIT_ARCHIVAL_PREWARM_CACHE_LIMIT) {
      const oldest = readyLitArchivalPrewarmSources.values().next().value
      readyLitArchivalPrewarmSources.delete(oldest)
    }
  }

  function rememberDecodedPortraitSrc(src) {
    decodedPortraitSrcCache.delete(src)
    decodedPortraitSrcCache.add(src)
    while (decodedPortraitSrcCache.size > DECODED_PORTRAIT_CACHE_LIMIT) {
      const oldest = decodedPortraitSrcCache.values().next().value
      decodedPortraitSrcCache.delete(oldest)
    }
  }

  async function decodePortraitSrc(src) {
    const usableSrc = String(src || "").trim()
    if (!usableSrc) return ""
    if (decodedPortraitSrcCache.has(usableSrc)) return usableSrc
    if (decodedPortraitSrcPromises.has(usableSrc)) return decodedPortraitSrcPromises.get(usableSrc)

    const decodePromise = new Promise((resolve, reject) => {
      const img = new Image()
      img.decoding = "async"
      img.onload = async () => {
        try {
          if (typeof img.decode === "function") await img.decode()
        } catch (_) {
          // onload means the browser accepted the image; decode() may reject for SVG/data URL edge cases.
        }
        rememberDecodedPortraitSrc(usableSrc)
        resolve(usableSrc)
      }
      img.onerror = () => reject(new Error("Portrait image failed to load"))
      img.src = usableSrc
    }).finally(() => {
      decodedPortraitSrcPromises.delete(usableSrc)
    })

    decodedPortraitSrcPromises.set(usableSrc, decodePromise)
    return decodePromise
  }

  function warmDecodedPortraitSources(usableSources) {
    for (const src of Array.isArray(usableSources) ? usableSources : []) {
      if (!src) continue
      decodePortraitSrc(src).catch(() => null)
    }
  }

  function onPortraitWarmSource(usableSource) {
    if (usesTooltipFrameRenderer()) {
      prewarmLitArchivalFramePortraitSrcs([usableSource])
      return
    }
    warmDecodedPortraitSources([usableSource])
  }

  function portraitUrlFromGeneDetail(detail) {
    const portrait =
      detail && detail.portrait && typeof detail.portrait === "object" ? detail.portrait : null
    return String(
      (portrait && (portrait.medium_url || portrait.hero_url || portrait.thumb_url)) || "",
    ).trim()
  }

  function portraitAssetShaFromRecord(record) {
    return String(((record || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
  }

  function coherentPortraitRecord(geneDetail, portraitLocator) {
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const locator = portraitLocator && typeof portraitLocator === "object" ? portraitLocator : null
    const detailSha = portraitAssetShaFromRecord(detail)
    const locatorSha = portraitAssetShaFromRecord(locator)
    if (detailSha && locatorSha && detailSha !== locatorSha) {
      const symbol = String(detail?.symbol || locator?.symbol || activeSymbol || "")
        .trim()
        .toUpperCase()
      const mismatchKey = `${symbol}:${detailSha}:${locatorSha}`
      if (!warnedPortraitProjectionMismatches.has(mismatchKey)) {
        warnedPortraitProjectionMismatches.add(mismatchKey)
        console.error(
          "[Iconoplasm] published portrait locator/detail mismatch; portrait suppressed",
          {
            symbol,
            detailAssetSha256: detailSha,
            locatorAssetSha256: locatorSha,
          },
        )
      }
      return null
    }
    if (detailSha) return detail
    if (locatorSha) return locator
    return null
  }

  const portraitCache = IconoContentPortraitCache.createPortraitCache({
    windowRef: window,
    chromeApi: chrome,
    batchSize: 6,
    delayMs: 20,
    onWarmSource: onPortraitWarmSource,
  })
  const geneDetailStore = IconoContentDetailCache.createGeneDetailStore({
    windowRef: window,
    fetchImpl: extensionApiFetch,
    batchUrl: ICONOPLASM_GENE_BATCH_URL,
    detailUrlForSymbol: (symbol, revision) =>
      `${ICONOPLASM_GENE_DETAIL_PREFIX}${encodeURIComponent(revision)}/genes/${encodeURIComponent(symbol)}`,
    fields: GENE_DETAIL_BATCH_FIELDS,
    warmBatchSize: 6,
    visibleLimit: 64,
    delayMs: 20,
    deferTask: deferGeneDetailWarm,
    deferPersistenceTask: deferGeneDetailPersistence,
    // ARCHITECTURE FENCE [IPD-008]: public detail is immutable inside the
    // published card snapshot. Reuse it across pages instead of paying the
    // Worker and KV read plane again for the same gene.
    storageApi: chrome.storage.local,
    persistentLimit: 512,
    persistentByteLimit: GENE_DETAIL_PERSISTENT_MAX_BYTES,
    requestTimeoutMs: 4000,
    getRevision: async () => {
      const stored = await chrome.storage.local.get([
        "iconoplasm_card_snapshot_version",
        "iconoplasm_hash",
      ])
      return stored.iconoplasm_card_snapshot_version || stored.iconoplasm_hash || ""
    },
    onError: (err) => {
      console.error("[Iconoplasm] extension gene detail batch fetch error:", err)
    },
    onRevisionUnavailable: ({ revision }) => refreshRetiredCardSnapshot(revision),
  })
  const geneDetailCache = geneDetailStore.cache // symbol -> gene payload or null
  const portraitLocatorStore = IconoContentDetailCache.createGeneDetailStore({
    windowRef: window,
    fetchImpl: extensionApiFetch,
    detailUrlForSymbol: (symbol, revision) =>
      `${ICONOPLASM_PORTRAIT_LOCATOR_PREFIX}${encodeURIComponent(revision)}/portraits/${encodeURIComponent(symbol)}`,
    recordFromPayload: (payload) =>
      payload?.portrait_locator && typeof payload.portrait_locator === "object"
        ? payload.portrait_locator
        : null,
    validateRecord: (record, symbol, revision) =>
      String(record?.symbol || "").toUpperCase() === symbol &&
      String(record?.snapshot_version || "") === revision &&
      /^[a-f0-9]{64}$/.test(portraitAssetShaFromRecord(record)) &&
      Boolean(portraitUrlFromGeneDetail(record)),
    warmBatchSize: 6,
    visibleLimit: 64,
    delayMs: 20,
    deferTask: deferGeneDetailWarm,
    deferPersistenceTask: deferGeneDetailPersistence,
    // ARCHITECTURE FENCE [IPD-008] + [IPD-011]: this tiny cache is keyed by the
    // exact card snapshot and stores only a projection of that card. It is not a
    // browser-owned portrait pointer or an independently versioned canon.
    storageApi: chrome.storage.local,
    storageKey: "iconoplasm_published_portrait_locator_cache_v1",
    persistentLimit: 1024,
    persistentByteLimit: 768 * 1024,
    requestTimeoutMs: 4000,
    getRevision: async () => {
      const stored = await chrome.storage.local.get([
        "iconoplasm_card_snapshot_version",
        "iconoplasm_hash",
      ])
      return stored.iconoplasm_card_snapshot_version || stored.iconoplasm_hash || ""
    },
    onError: (err) => {
      console.error("[Iconoplasm] extension portrait locator fetch error:", err)
    },
    onRevisionUnavailable: ({ revision }) => refreshRetiredCardSnapshot(revision),
  })
  const portraitLocatorCache = portraitLocatorStore.cache

  function adoptCardSnapshotRevision(rawRevision, { retryVisible = false } = {}) {
    const revision = String(rawRevision || "").trim()
    if (!revision || revision === activeCardSnapshotRevision) return false
    activeCardSnapshotRevision = revision
    geneDetailStore.setRevision(revision)
    portraitLocatorStore.setRevision(revision)
    if (retryVisible && activeTooltipAnchor?.isConnected && activeSymbol) {
      activateTooltipForAnchor(activeTooltipAnchor)
    }
    return true
  }

  function refreshRetiredCardSnapshot(rawRevision) {
    const retiredRevision = String(rawRevision || "").trim()
    if (!retiredRevision) return Promise.resolve(null)
    if (cardSnapshotRefreshPromise) return cardSnapshotRefreshPromise
    cardSnapshotRefreshPromise = chrome.runtime
      .sendMessage({ type: "REFRESH_CARD_SNAPSHOT", retiredRevision })
      .then((result) => {
        adoptCardSnapshotRevision(result?.cardSnapshotVersion, { retryVisible: true })
        return result
      })
      .catch((err) => {
        console.error("[Iconoplasm] card snapshot refresh failed:", err)
        return null
      })
      .finally(() => {
        cardSnapshotRefreshPromise = null
      })
    return cardSnapshotRefreshPromise
  }

  function buildGenePageUrl(symbol) {
    return "https://iconoplasm.brinedew.bio/gene/" + encodeURIComponent(symbol)
  }

  function openGenePage(symbol) {
    if (!symbol || !geneMap || !geneMap[symbol]) return
    window.open(buildGenePageUrl(symbol), "_blank", "noopener")
  }

  function unwrapGeneElement(el) {
    if (!el || !el.parentNode) return false
    const label = String((el.dataset && el.dataset.geneLabel) || el.textContent || "")
    const textNode = document.createTextNode(label)
    const parent = el.parentNode
    parent.replaceChild(textNode, el)
    parent.normalize()
    return true
  }

  function unwrapBlockedGeneHighlights(blocklist) {
    if (!(blocklist instanceof Set) || blocklist.size === 0) return 0
    const genes = Array.from(document.querySelectorAll(".iconoplasm-gene"))
    const acceptedMatchesByParent = new Map()
    let removed = 0
    for (const el of genes) {
      const symbol = String((el.dataset && el.dataset.gene) || "")
        .trim()
        .toUpperCase()
      const label = String((el.dataset && el.dataset.geneLabel) || el.textContent || "")
        .trim()
        .toUpperCase()
      if (!symbol && !label) continue
      let remainsAccepted = !blocklist.has(symbol) && !blocklist.has(label)
      const parent = el.parentNode
      if (remainsAccepted && parent && geneMatcher) {
        if (!acceptedMatchesByParent.has(parent)) {
          acceptedMatchesByParent.set(parent, geneMatcher.findMatches(parent.textContent || ""))
        }
        const range = document.createRange()
        range.setStart(parent, 0)
        range.setEndBefore(el)
        const start = range.toString().length
        range.detach()
        remainsAccepted = acceptedMatchesByParent.get(parent).some((match) => {
          return (
            match.symbol === symbol &&
            match.index === start &&
            match.length === String(el.textContent || "").length
          )
        })
      }
      if (remainsAccepted) continue
      if (activeSymbol === symbol) hideTooltip()
      if (unwrapGeneElement(el)) removed += 1
    }
    if (removed > 0) scheduleHighlightGeometryRefresh()
    return removed
  }

  async function loadEffectiveBlocklist() {
    const blocklistStorage = await new Promise((resolve) => {
      chrome.storage.local.get(
        [USER_BLOCKLIST_KEY, REMOVED_DEFAULTS_KEY, SHARED_BLOCKLIST_KEY],
        (result) => {
          resolve(result || {})
        },
      )
    })
    const sharedDefaults = IconoContentSettings.resolveSharedBlocklistDefaults(
      blocklistStorage[SHARED_BLOCKLIST_KEY],
      ICONOPLASM_DEFAULT_BLOCKLIST,
    )
    return IconoContentSettings.buildEffectiveBlocklist(
      sharedDefaults,
      blocklistStorage[USER_BLOCKLIST_KEY],
      blocklistStorage[REMOVED_DEFAULTS_KEY],
    )
  }

  function rebuildGeneMatcher(blocklist) {
    effectiveBlocklist = blocklist instanceof Set ? blocklist : new Set()
    geneMatcher = IconoContentMatcher.createGeneMatcher(geneMap, { blocklist: effectiveBlocklist })
  }

  async function refreshBlocklistFromStorage({ rescan = true } = {}) {
    const nextBlocklist = await loadEffectiveBlocklist()
    rebuildGeneMatcher(nextBlocklist)
    if (isPdfReaderDocument) {
      window.dispatchEvent(new CustomEvent("iconoplasm-reader-matcher-changed"))
      return
    }
    unwrapBlockedGeneHighlights(nextBlocklist)
    if (rescan) {
      void scanPage(document.body).then(() => refreshHighlightStyles())
    }
  }

  function showVoteLoginPopup() {
    if (!authToast) return
    authToast.textContent = "Log in on Iconoplasm to vote on portraits."
    authToast.classList.add("iconoplasm-auth-toast-visible")
    window.clearTimeout(Number(authToast.dataset.hideTimer || 0))
    const hideTimerId = window.setTimeout(() => {
      authToast.classList.remove("iconoplasm-auth-toast-visible")
      authToast.dataset.hideTimer = ""
    }, 2600)
    authToast.dataset.hideTimer = String(hideTimerId)
  }

  function cancelHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function scheduleHideTooltip(delayMs = 220) {
    cancelHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      hideTooltip()
    }, delayMs)
  }

  function normalizeDiscoverySymbolList(rawSymbols) {
    const out = []
    const seen = new Set()
    const values = Array.isArray(rawSymbols) ? rawSymbols : []
    for (const rawSymbol of values) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      if (!/^[A-Z0-9][A-Z0-9-]{0,63}$/.test(symbol)) continue
      seen.add(symbol)
      out.push(symbol)
      if (out.length >= GUEST_DISCOVERY_SYMBOL_MAX) break
    }
    return out
  }

  async function persistGuestDiscoverySymbols() {
    try {
      await chrome.storage.local.set({
        [GUEST_DISCOVERIES_STORAGE_KEY]: Array.from(guestDiscoverySymbols),
      })
    } catch (err) {
      console.error("[Iconoplasm] guest discovery storage write failed:", err)
    }
  }

  async function loadGuestDiscoverySymbols() {
    try {
      const result = await chrome.storage.local.get([GUEST_DISCOVERIES_STORAGE_KEY])
      const symbols = normalizeDiscoverySymbolList(result[GUEST_DISCOVERIES_STORAGE_KEY])
      guestDiscoverySymbols.clear()
      for (const symbol of symbols) {
        guestDiscoverySymbols.add(symbol)
        discoveredPageSymbols.add(symbol)
      }
    } catch (err) {
      console.error("[Iconoplasm] guest discovery storage read failed:", err)
    }
  }

  async function rememberGuestDiscovery(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    if (guestDiscoverySymbols.has(normalizedSymbol)) {
      discoveredPageSymbols.add(normalizedSymbol)
      return
    }
    guestDiscoverySymbols.add(normalizedSymbol)
    while (guestDiscoverySymbols.size > GUEST_DISCOVERY_SYMBOL_MAX) {
      const oldest = guestDiscoverySymbols.values().next().value
      if (!oldest) break
      guestDiscoverySymbols.delete(oldest)
    }
    discoveredPageSymbols.add(normalizedSymbol)
    await persistGuestDiscoverySymbols()
  }

  async function removeMergedGuestDiscoveries(symbols) {
    let changed = false
    for (const symbol of normalizeDiscoverySymbolList(symbols)) {
      if (!guestDiscoverySymbols.has(symbol)) continue
      guestDiscoverySymbols.delete(symbol)
      changed = true
    }
    if (!changed) return
    await persistGuestDiscoverySymbols()
  }

  function rememberDiscoveryAuthState(payload) {
    const authenticated = !!(payload && payload.authenticated)
    discoveryAuthState = {
      checkedAt: Date.now(),
      authenticated,
      discoveredSymbols: authenticated
        ? normalizeDiscoverySymbolList(payload && payload.discovered_symbols)
        : [],
    }
    if (authenticated) {
      for (const symbol of discoveryAuthState.discoveredSymbols) {
        discoveredPageSymbols.add(symbol)
      }
    }
    return discoveryAuthState
  }

  function hasFreshDiscoveryAuthState() {
    return (
      Number(discoveryAuthState.checkedAt || 0) > 0 &&
      Date.now() - Number(discoveryAuthState.checkedAt || 0) < DISCOVERY_AUTH_CACHE_TTL_MS
    )
  }

  function resetDiscoveryAuthState() {
    discoveryAuthState = {
      checkedAt: 0,
      authenticated: null,
      discoveredSymbols: [],
    }
  }

  async function fetchDiscoveryState() {
    try {
      const response = await extensionApiFetch(ICONOPLASM_DISCOVERY_STATE_URL, {
        method: "GET",
        credentials: "include",
      })
      if (!response.ok) {
        resetDiscoveryAuthState()
        return null
      }
      const payload = await response.json().catch(() => null)
      if (payload && typeof payload === "object") {
        rememberDiscoveryAuthState(payload)
      } else {
        resetDiscoveryAuthState()
      }
      return payload
    } catch (err) {
      resetDiscoveryAuthState()
      console.error("[Iconoplasm] discovery state fetch error:", err)
      return null
    }
  }

  async function ensureDiscoveryStateFresh() {
    if (hasFreshDiscoveryAuthState()) {
      return {
        authenticated: Boolean(discoveryAuthState.authenticated),
        discovered_symbols: discoveryAuthState.discoveredSymbols.slice(),
      }
    }
    return fetchDiscoveryState()
  }

  async function mergeGuestDiscoveriesIfSignedIn() {
    if (guestDiscoveryMergePromise) return guestDiscoveryMergePromise
    const pendingSymbols = Array.from(guestDiscoverySymbols)
    if (!pendingSymbols.length) return null
    guestDiscoveryMergePromise = (async () => {
      const state = await ensureDiscoveryStateFresh()
      if (!state || !state.authenticated) return null
      const knownSymbols = normalizeDiscoverySymbolList(state.discovered_symbols)
      for (const symbol of knownSymbols) discoveredPageSymbols.add(symbol)
      const mergeResponse = await extensionApiFetch(ICONOPLASM_DISCOVERY_MERGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: pendingSymbols }),
        credentials: "include",
      })
      if (!mergeResponse.ok) {
        console.warn("[Iconoplasm] guest discovery merge failed with HTTP", mergeResponse.status)
        return null
      }
      const payload = await mergeResponse.json().catch(() => null)
      if (payload && typeof payload === "object") {
        rememberDiscoveryAuthState({
          authenticated: true,
          discovered_symbols: payload.discovered_symbols,
        })
      }
      const mergedSymbols = normalizeDiscoverySymbolList(
        (payload && payload.discovered_symbols) || pendingSymbols,
      )
      for (const symbol of mergedSymbols) discoveredPageSymbols.add(symbol)
      await removeMergedGuestDiscoveries(pendingSymbols)
      return payload
    })()
      .catch((err) => {
        console.error("[Iconoplasm] guest discovery merge error:", err)
        return null
      })
      .finally(() => {
        guestDiscoveryMergePromise = null
      })
    return guestDiscoveryMergePromise
  }

  function scheduleDiscoveryBufferFlush() {
    if (discoveryBufferFlushScheduled) return
    discoveryBufferFlushScheduled = true
    window.setTimeout(() => {
      discoveryBufferFlushScheduled = false
      mergeGuestDiscoveriesIfSignedIn().catch(() => null)
    }, 0)
  }

  function clearPendingDiscovery(symbol = activeSymbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    const timerId = discoveryTimerBySymbol.get(normalizedSymbol)
    if (!timerId) return
    window.clearTimeout(timerId)
    discoveryTimerBySymbol.delete(normalizedSymbol)
  }

  function isDiscoveryCoolingDown(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return false
    const cooldownUntil = Number(discoveryCooldownUntilBySymbol.get(normalizedSymbol) || 0)
    if (cooldownUntil > Date.now()) return true
    discoveryCooldownUntilBySymbol.delete(normalizedSymbol)
    return false
  }

  function markDiscoveryCooldown(symbol, cooldownMs = DISCOVERY_SYMBOL_COOLDOWN_MS) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    discoveryCooldownUntilBySymbol.set(normalizedSymbol, Date.now() + cooldownMs)
  }

  async function postDiscoveryEncounter(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    if (discoveredPageSymbols.has(normalizedSymbol)) return
    if (discoveryInFlightSymbols.has(normalizedSymbol)) return
    if (isDiscoveryCoolingDown(normalizedSymbol)) return

    discoveryInFlightSymbols.add(normalizedSymbol)
    markDiscoveryCooldown(normalizedSymbol)
    try {
      const authState = await ensureDiscoveryStateFresh()
      // The awaited membership load can discover that this gene was already
      // saved. Recheck after it completes: the pre-await check alone records
      // one redundant encounter per article and amplifies database writes.
      if (discoveredPageSymbols.has(normalizedSymbol)) return
      if (authState && authState.authenticated === false) {
        await rememberGuestDiscovery(normalizedSymbol)
        return
      }
      const response = await extensionApiFetch(ICONOPLASM_DISCOVERY_ENCOUNTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: normalizedSymbol,
          source: "extension_hover",
          trigger: "hover_dwell",
          dwell_ms: DISCOVERY_HOVER_DWELL_MS,
        }),
        credentials: "include",
      })
      if (!response.ok) {
        console.warn(
          "[Iconoplasm] discovery encounter write failed for",
          normalizedSymbol,
          "with HTTP",
          response.status,
        )
        await rememberGuestDiscovery(normalizedSymbol)
        return
      }
      const payload = await response.json().catch(() => null)
      if (payload && payload.authenticated && payload.recorded) {
        rememberDiscoveryAuthState(payload)
        discoveredPageSymbols.add(normalizedSymbol)
        if (guestDiscoverySymbols.size > 0) {
          scheduleDiscoveryBufferFlush()
        }
      } else if (payload && payload.authenticated === false) {
        rememberDiscoveryAuthState(payload)
        await rememberGuestDiscovery(normalizedSymbol)
      }
    } catch (err) {
      console.error("[Iconoplasm] discovery encounter write error:", err)
      await rememberGuestDiscovery(normalizedSymbol)
    } finally {
      discoveryInFlightSymbols.delete(normalizedSymbol)
    }
  }

  function scheduleDiscoveryEncounter(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return
    if (discoveredPageSymbols.has(normalizedSymbol)) return
    if (discoveryInFlightSymbols.has(normalizedSymbol)) return
    if (isDiscoveryCoolingDown(normalizedSymbol)) return

    clearPendingDiscovery(normalizedSymbol)
    const timerId = window.setTimeout(() => {
      discoveryTimerBySymbol.delete(normalizedSymbol)
      if (activeSymbol !== normalizedSymbol) return
      if (!tooltip || !tooltip.classList.contains("iconoplasm-tooltip-visible")) return
      if (document.visibilityState === "hidden") return
      postDiscoveryEncounter(normalizedSymbol).catch(() => null)
    }, DISCOVERY_HOVER_DWELL_MS)
    discoveryTimerBySymbol.set(normalizedSymbol, timerId)
  }

  function deferGeneDetailWarm(task) {
    return IconoContentTooltip.postBackgroundTask(
      () => {
        if (activeSymbol) {
          deferGeneDetailWarm(task).catch(() => null)
          return
        }
        task()
      },
      { windowRef: window, delay: 150, timeout: 1000 },
    )
  }

  function deferGeneDetailPersistence(task) {
    return IconoContentTooltip.postBackgroundTask(task, {
      windowRef: window,
      delay: 50,
      timeout: 500,
    })
  }

  function shouldIgnoreMutationNode(node) {
    if (!node) return true
    const el =
      node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : node.nodeType === Node.ELEMENT_NODE
          ? /** @type {Element} */ (node)
          : null
    if (!el) return true
    if (isEditableTextSurface(el)) return true
    if (el.classList && el.classList.contains("iconoplasm-tooltip")) return true
    if (el.closest && el.closest(".iconoplasm-tooltip")) return true
    if (el.classList && el.classList.contains("iconoplasm-gene")) return true
    if (el.closest && el.closest(".iconoplasm-gene")) return true
    if (SKIP_TAGS.has(el.tagName)) return true
    return false
  }

  function isEditableTextSurface(el) {
    if (!el || typeof el.closest !== "function") return false
    return !!el.closest(
      "[contenteditable], textarea, input, select, [role='textbox'], [role=\"textbox\"]",
    )
  }

  function setPortraitFallback(
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    statusText,
  ) {
    portraitImg.removeAttribute("src")
    portraitImg.style.display = "none"
    portrait.classList.add("iconoplasm-tooltip-portrait-missing")
    portraitFallback.style.display = "flex"
    portraitStatus.textContent = statusText
  }

  function applyPortraitImage(
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    usableSrc,
    altText,
  ) {
    portraitImg.src = usableSrc
    portraitImg.alt = altText || ""
    portraitImg.style.display = "block"
    portrait.classList.remove("iconoplasm-tooltip-portrait-missing")
    portraitFallback.style.display = "none"
    portraitStatus.textContent = ""
  }

  async function fetchGeneDetailsBatch(symbols, options = {}) {
    return geneDetailStore.fetchBatch(symbols, options)
  }

  async function fetchPortraitLocatorsBatch(symbols, options = {}) {
    return portraitLocatorStore.fetchBatch(symbols, options)
  }

  async function prepareReadingSessionSymbol(symbol) {
    const locatorPromise = fetchPortraitLocatorsBatch([symbol], {
      priority: "background",
      awaitPersistentCache: false,
    }).then(async (locators) => {
      const locator = locators.get(symbol) || null
      const portraitUrl = portraitUrlFromGeneDetail(locator)
      if (!portraitUrl) return { locator, portraitSrc: "" }
      const portraitSrc = await getUsablePortraitSrc(portraitUrl)
      if (portraitSrc) onPortraitWarmSource(portraitSrc)
      return { locator, portraitSrc }
    })
    const detailPromise = fetchGeneDetailsBatch([symbol], {
      priority: "background",
      awaitPersistentCache: false,
    }).then((details) => details.get(symbol) || null)
    const [locatorResult, detail] = await Promise.all([locatorPromise, detailPromise])
    if (!detail && !locatorResult.locator) return null
    if (!coherentPortraitRecord(detail, locatorResult.locator) && detail && locatorResult.locator) {
      return { detail, locator: locatorResult.locator, portraitSrc: "" }
    }
    const portraitUrl = portraitUrlFromGeneDetail(detail || locatorResult.locator)
    if (!portraitUrl) return { detail, locator: locatorResult.locator, portraitSrc: "" }
    const portraitSrc =
      locatorResult.portraitSrc || (await getUsablePortraitSrc(portraitUrl).catch(() => ""))
    if (portraitSrc) onPortraitWarmSource(portraitSrc)
    return { detail, locator: locatorResult.locator, portraitSrc }
  }

  const readingSession = IconoReadingSession.createReadingSession({
    windowRef: window,
    connection: window.navigator?.connection,
    deviceMemory: window.navigator?.deviceMemory,
    rootMarginPx: 960,
    prepareSymbol: prepareReadingSessionSymbol,
    onError: (error, symbol) => {
      console.error(`[Iconoplasm] failed to prepare ${symbol} for this reading session:`, error)
    },
  })
  IconoContentLifecycle.scheduleHostFirstBackgroundWork({
    documentRef: document,
    windowRef: window,
    quietDelayMs: 1000,
    task: () => readingSession.startSpeculation(),
  })

  function registerGeneAnchor(anchor) {
    readingSession.registerAnchor(anchor)
  }

  async function getUsablePortraitSrc(portraitSrc) {
    return portraitCache.getUsableSrc(portraitSrc)
  }

  async function loadTooltipPortrait({
    symbol,
    portrait,
    portraitImg,
    portraitFallback,
    portraitStatus,
    portraitSrc,
  }) {
    if (!portraitSrc) {
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait pending",
      )
      return
    }

    const loadToken = ++portraitLoadToken
    const cachedSrc = portraitCache.getCachedSrc(portraitSrc)
    if (cachedSrc) {
      await decodePortraitSrc(cachedSrc).catch(() => cachedSrc)
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        cachedSrc,
        symbol + " portrait",
      )
      return
    }
    setPortraitFallback(portrait, portraitImg, portraitFallback, portraitStatus, "Loading portrait")

    const usableSrc = await getUsablePortraitSrc(portraitSrc)
    if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
    if (!usableSrc) {
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait unavailable",
      )
      return
    }
    try {
      await decodePortraitSrc(usableSrc)
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        usableSrc,
        symbol + " portrait",
      )
    } catch (_) {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait unavailable",
      )
    }
  }

  function loadSimpleTooltipPortrait({
    symbol,
    summaryGene,
    geneDetail,
    portraitLocator,
    portraitRefs,
  }) {
    if (!portraitRefs || !portraitRefs.portraitImg) return Promise.resolve()
    // The scanner stays portrait-free. The locator is an independently fetched
    // projection of the same exact card snapshot, so rich-detail stalls cannot
    // suppress an otherwise available portrait.
    return loadTooltipPortrait({
      symbol,
      portrait: portraitRefs.portrait,
      portraitImg: portraitRefs.portraitImg,
      portraitFallback: portraitRefs.portraitFallback,
      portraitStatus: portraitRefs.portraitStatus,
      portraitSrc: buildTooltipFramePortraitSrc(geneDetail, portraitLocator),
    })
  }

  // -- Font ownership ------------------------------------------------
  // The generated font runtime owns registration and resolves every packaged
  // asset through runtime.getURL, which works in both Chromium and Firefox and
  // cannot accidentally turn into a request against the host page.
  function injectFonts() {
    globalThis.IconoplasmExtensionFonts?.install?.()
    if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve([])
    const probes = [
      ['400 16px "IBM Plex Mono"', "molecular character"],
      ['500 15px "IBM Plex Mono"', "origin expression"],
      ['800 38px "League Spartan"', "ICONOPLASM"],
      ['400 16px "Special Elite"', "gene identity"],
      ['400 18px "Caveat"', "character"],
    ]
    return Promise.allSettled(probes.map(([font, text]) => document.fonts.load(font, text)))
  }

  // -- Init ----------------------------------------------------------
  function scheduleInitializationRetry() {
    if (initialized || initializationRetryTimer) return
    initializationRetryTimer = window.setTimeout(() => {
      initializationRetryTimer = 0
      void init()
    }, GENE_DATA_RETRY_DELAY_MS)
  }

  function init() {
    // Don't run on the Iconoplasm site itself -- it already shows gene
    // colors natively, and the extension just adds redundant underlines.
    if (window.location.hostname === "iconoplasm.brinedew.bio" || initialized) {
      return Promise.resolve()
    }
    if (initializationPromise) return initializationPromise
    initializationPromise = initialize().finally(() => {
      initializationPromise = null
    })
    return initializationPromise
  }

  async function initialize() {
    await Promise.all([
      loadHighlightMode(),
      loadHighlightVisibility(),
      loadCardVariant(),
      loadGuestDiscoverySymbols(),
    ])

    // The rich renderer is a persistent process-local surface. Boot it in its final
    // tooltip-owned parent while the scanner payload is loading. Moving an iframe
    // after it has loaded reloads its browsing context and discards decoded portraits.
    if (!tooltip) createTooltip()
    if (!authToast) createAuthToast()
    if (usesTooltipFrameRenderer()) ensureLitArchivalFrame()

    // Effective blocklist = (chosen shared defaults - user-removed) + user extras.
    // The packaged defaults are used only until a valid shared projection exists.
    effectiveBlocklist = await loadEffectiveBlocklist()

    const payload = await IconoContentLifecycle.requestGeneData(chrome, {
      timeoutMs: GENE_DATA_REQUEST_TIMEOUT_MS,
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    })

    // Backward compatibility:
    // - old worker returned raw map
    // The worker returns the schema-5 catalog projection and contract state.
    if (payload && payload.genes && typeof payload.genes === "object") {
      geneMap = payload.genes
      adoptCardSnapshotRevision(payload.cardSnapshotVersion)
    } else {
      geneMap = payload
    }
    if (!geneMap || Object.keys(geneMap).length === 0) {
      console.log("[Iconoplasm] Gene data unavailable. Retrying shortly.")
      scheduleInitializationRetry()
      return
    }
    // Hydration starts only after the worker returns the exact snapshot version.
    // Foreground GETs do not await this multi-megabyte read; background warming
    // and persistence may reuse it when it arrives.
    void geneDetailStore.hydratePersistentCache()
    void portraitLocatorStore.hydratePersistentCache()

    // Fence: candidate generation now lives in a dedicated matcher module. Keep content.js acting
    // as the page adapter that applies matches, not the place where lexical rules accrete forever.
    rebuildGeneMatcher(effectiveBlocklist)
    if (isPdfReaderDocument) {
      globalThis.IconoplasmReaderBridge = Object.freeze({
        findMatches(text) {
          return geneMatcher.findMatches(String(text || ""))
        },
        getGene(rawSymbol) {
          const symbol = String(rawSymbol || "")
            .trim()
            .toUpperCase()
          return geneMap[symbol] || null
        },
        getHighlightMode() {
          return highlightMode
        },
        getHighlightVisibility() {
          return highlightVisibility
        },
        getHighlightPresentation(rawSymbol) {
          const symbol = String(rawSymbol || "")
            .trim()
            .toUpperCase()
          const gene = geneMap[symbol]
          if (!gene) return null
          const color = gene.c || PLACEHOLDER_COLOR
          return Object.freeze({
            color,
            foreground: textColors(color).primary,
            mode: highlightMode,
            shape: highlightRuntime.getCanvasShape(highlightMode),
          })
        },
        getPdfHighlightPresentation(rawSymbol) {
          const symbol = String(rawSymbol || "")
            .trim()
            .toUpperCase()
          const gene = geneMap[symbol]
          if (!gene) return null
          const color = gene.c || PLACEHOLDER_COLOR
          const pdfMode = highlightMode === "pill" ? "pill-outline" : highlightMode
          return Object.freeze({
            color,
            foreground: textColors(color).primary,
            mode: pdfMode,
            requestedMode: highlightMode,
            shape: highlightRuntime.getCanvasShape(pdfMode),
          })
        },
        decorateAnchor(anchor, rawSymbol) {
          const symbol = String(rawSymbol || "")
            .trim()
            .toUpperCase()
          const gene = geneMap[symbol]
          if (!anchor || !gene) return false
          applyHighlightStyle(anchor, symbol, gene.c || PLACEHOLDER_COLOR)
          return true
        },
        replaceAnchorGroup(groupId, anchors) {
          readingSession.replaceAnchorGroup(groupId, anchors)
        },
        activateAnchor(anchor) {
          if (!anchor || !anchor.dataset?.gene) return false
          activateTooltipForAnchor(anchor)
          return activeSymbol === anchor.dataset.gene
        },
        leaveAnchor(anchor, relatedTarget = null) {
          if (!anchor) return
          leaveTooltipAnchor(relatedTarget)
        },
        closeCard() {
          hideTooltip()
        },
      })
      void injectFonts()
      initialized = true
      window.dispatchEvent(new CustomEvent("iconoplasm-reader-bridge-ready"))
      return
    }
    pageScanner = IconoContentScanner.createPageScanner({
      documentRef: document,
      nodeFilter: NodeFilter,
      skipTags: SKIP_TAGS,
      placeholderColor: PLACEHOLDER_COLOR,
      getGeneMap: () => geneMap,
      getMatcher: () => geneMatcher,
      applyHighlightStyle,
      registerGeneAnchor,
    })

    console.log("[Iconoplasm] Loaded", Object.keys(geneMap).length, "genes. Scanning...")
    void injectFonts()
    observeMutations()
    void pageScanner.scanPageCooperatively(document.body).then(() => refreshHighlightStyles())
    scheduleDiscoveryBufferFlush()
    window.navigator?.connection?.addEventListener?.("change", () => {
      readingSession.updateConnection(window.navigator?.connection, window.navigator?.deviceMemory)
    })
    window.addEventListener("resize", scheduleHighlightGeometryRefresh, { passive: true })
    window.addEventListener("focus", scheduleDiscoveryBufferFlush)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        readingSession.updateConnection(
          window.navigator?.connection,
          window.navigator?.deviceMemory,
        )
        scheduleDiscoveryBufferFlush()
      }
    })
    initialized = true
  }

  // -- DOM scanning --------------------------------------------------
  function scanPage(root) {
    return pageScanner ? pageScanner.scanPageCooperatively(root) : 0
  }

  // -- Mutation observer ---------------------------------------------
  function observeMutations() {
    if (mutationScanController) return
    mutationScanController = IconoContentLifecycle.createMutationScanController({
      documentRef: document,
      windowRef: window,
      MutationObserverCtor: MutationObserver,
      shouldIgnoreNode: shouldIgnoreMutationNode,
      scanPage,
      onScanComplete() {
        scheduleHighlightGeometryRefresh()
      },
    })
    mutationScanController.start()
  }

  // -- Tooltip -------------------------------------------------------
  function createTooltip() {
    if (tooltip && tooltip.isConnected) return tooltip
    tooltip = IconoContentTooltip.createTooltipShell({
      documentRef: document,
      windowRef: window,
      applyTooltipTheme,
      onMouseOver,
      onMouseOut,
      onFrameMessage: onLitArchivalFrameMessage,
      onTooltipClick,
      onTooltipKeyDown,
      cancelHideTimer,
      onTooltipMouseLeave,
    })
    // createTooltipShell invokes the callback before this module's tooltip variable is assigned.
    // Reapply after assignment so the first hover gets the same frame-card classes as later
    // layout switches.
    applyTooltipTheme()
    ensureTooltipSurfaces()
    return tooltip
  }

  function createAuthToast() {
    if (authToast && authToast.isConnected) return authToast
    authToast = IconoContentTooltip.createAuthToast(document)
    return authToast
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    // ARCHITECTURE FENCE [IPD-008]: another tab's scanner refresh must not
    // switch this article's card epoch or refetch a visible hover. This page
    // adopts its head at initialization/reload, or explicit retired recovery.
    if (changes[HIGHLIGHT_MODE_KEY]) {
      highlightMode = highlightRuntime.setMode(changes[HIGHLIGHT_MODE_KEY].newValue)
      refreshHighlightStyles()
      if (isPdfReaderDocument) {
        window.dispatchEvent(new CustomEvent("iconoplasm-reader-highlight-mode-changed"))
      }
    }
    if (changes[HIGHLIGHT_VISIBILITY_KEY]) {
      highlightVisibility = normalizeHighlightVisibility(changes[HIGHLIGHT_VISIBILITY_KEY].newValue)
      applyHighlightVisibility()
      if (isPdfReaderDocument) {
        window.dispatchEvent(new CustomEvent("iconoplasm-reader-highlight-visibility-changed"))
      }
    }
    if (changes[CARD_VARIANT_KEY]) {
      cardVariant = normalizeCardVariant(changes[CARD_VARIANT_KEY].newValue)
      applyTooltipTheme()
      if (usesTooltipFrameRenderer()) ensureLitArchivalFrame()
      else parkLitArchivalFrame()
      if (activeSymbol) {
        renderTooltipBody(
          activeGeneSummary,
          geneDetailCache.get(activeSymbol) || null,
          true,
          portraitLocatorCache.get(activeSymbol) || null,
        )
      }
    }
    if (
      changes[USER_BLOCKLIST_KEY] ||
      changes[REMOVED_DEFAULTS_KEY] ||
      changes[SHARED_BLOCKLIST_KEY]
    ) {
      refreshBlocklistFromStorage().catch((err) => {
        console.error("[Iconoplasm] blocklist refresh failed:", err)
      })
    }
  })

  function archivalTooltipGeneModel(summaryGene, geneDetail, portraitLocator = null) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const geneModel = Object.assign(
      {},
      detail || {
        symbol: summary.symbol || activeSymbol || "",
        full_name: summary.n || summary.symbol || activeSymbol || "",
        color: summary.c || PLACEHOLDER_COLOR,
        essence: {},
      },
    )
    const portraitRecord = coherentPortraitRecord(detail, portraitLocator)
    if (portraitRecord?.portrait) geneModel.portrait = portraitRecord.portrait
    else delete geneModel.portrait
    return geneModel
  }

  function buildLitTooltipCardModel(
    summaryGene,
    geneDetail,
    portraitSrcOverride,
    portraitLocator = null,
  ) {
    const geneModel = archivalTooltipGeneModel(summaryGene, geneDetail, portraitLocator)
    const symbol = String(geneModel.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const assetSha = portraitAssetShaFromRecord(geneModel)
    // The raw canonical URL is an adapter input, never a renderer source. Passing it through
    // the model lets the frame start a second successful image pipeline while the adapter is
    // already fetching the same portrait.
    const portraitSrc = String(portraitSrcOverride || "").trim()
    return IconoCardShared.resolveArchivalCardModel(geneModel, {
      mode: "brick",
      layoutVariant: isImageOnlyCardVariant() ? "image-only" : "lit-archival",
      mobileReview: false,
      portraitAlt: symbol ? symbol + " portrait" : "Gene portrait",
      portraitSrc,
      titleHref: symbol ? buildGenePageUrl(symbol) : "",
      voteHtml: assetSha
        ? !isImageOnlyCardVariant() &&
          IconoCardShared.voteBoxMarkup("", {
            variant: "label",
            showScore: false,
            showArrows: false,
          })
        : "",
    })
  }

  function buildTooltipFramePortraitSrc(geneDetail, portraitLocator = null) {
    return portraitUrlFromGeneDetail(coherentPortraitRecord(geneDetail, portraitLocator))
  }

  function buildTooltipFramePortraitDimensions(summaryGene, geneDetail, portraitLocator = null) {
    const portraitRecord = coherentPortraitRecord(geneDetail, portraitLocator)
    if (
      portraitRecord &&
      IconoCardShared &&
      typeof IconoCardShared.portraitDimensions === "function"
    ) {
      const dims = IconoCardShared.portraitDimensions(portraitRecord)
      if (dims && Number(dims.width) > 1 && Number(dims.height) > 1) return dims
    }
    // Fence: image-only and Lit archival cards need a stable first-paint aspect ratio. Falling
    // back to 1:1 during cold hover makes some genes look square until detail hydration lands,
    // which users perceive as a random crop/zoom jump rather than ordinary loading.
    return DEFAULT_PORTRAIT_DIMENSIONS
  }

  function buildLitArchivalTooltipVoteConfig(geneDetail, portraitLocator = null) {
    return IconoContentVoteBridge.buildTooltipVoteConfig({
      geneDetail: coherentPortraitRecord(geneDetail, portraitLocator) ? geneDetail : null,
      activeSymbol,
      apiBaseUrl: ICONOPLASM_API_BASE,
      imageOnly: isImageOnlyCardVariant(),
    })
  }

  function ensureTooltipSurfaces() {
    if (!tooltip) return null
    const body = tooltip.querySelector(".iconoplasm-tooltip-body")
    if (!body) return null

    if (!simpleTooltipSurface || !simpleTooltipSurface.isConnected) {
      simpleTooltipSurface = document.createElement("div")
      simpleTooltipSurface.className = "iconoplasm-tooltip-simple-content"
      body.appendChild(simpleTooltipSurface)
    }
    if (!litArchivalFrameShell || !litArchivalFrameShell.isConnected) {
      litArchivalFrameShell = document.createElement("div")
      litArchivalFrameShell.className = "iconoplasm-tooltip-lit-frame-shell"
      body.appendChild(litArchivalFrameShell)
    }
    return { body, simpleSurface: simpleTooltipSurface, frameShell: litArchivalFrameShell }
  }

  function postLitArchivalFramePayload(iframe, payload) {
    if (!iframe || iframe !== litArchivalFrameController.getFrame()) return false
    return litArchivalFrameController.post(payload)
  }

  function postLitArchivalFramePrewarm(iframe, sources) {
    if (!iframe || !iframe.isConnected || !iframe.contentWindow) return false
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") return false
    try {
      iframe.contentWindow.postMessage(
        {
          type: LIT_ARCHIVAL_PREWARM_MESSAGE,
          sources,
        },
        LIT_ARCHIVAL_FRAME_ORIGIN,
      )
      return true
    } catch (err) {
      console.error("[Iconoplasm] failed to prewarm archival frame portraits:", err)
      return false
    }
  }

  function ensureLitArchivalFrame() {
    if (!usesTooltipFrameRenderer()) return null
    return litArchivalFrameController.ensure()
  }

  function parkLitArchivalFrame() {
    litArchivalFrameController.park()
  }

  function flushLitArchivalPrewarmSources() {
    if (!pendingLitArchivalPrewarmSources.size) return
    const sources = Array.from(pendingLitArchivalPrewarmSources).filter(
      (source) => !inFlightLitArchivalPrewarmSources.has(source),
    )
    if (!sources.length) return
    const frame = ensureLitArchivalFrame()
    if (postLitArchivalFramePrewarm(frame, sources)) {
      for (const source of sources) inFlightLitArchivalPrewarmSources.add(source)
    }
  }

  function prewarmLitArchivalFramePortraitSrcs(sources) {
    const usableSources = Array.from(
      new Set(
        (Array.isArray(sources) ? sources : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    )
    if (!usableSources.length) return
    for (const source of usableSources) {
      if (readyLitArchivalPrewarmSources.has(source)) {
        rememberReadyLitArchivalPrewarmSource(source)
        continue
      }
      pendingLitArchivalPrewarmSources.add(source)
    }
    ensureLitArchivalFrame()
    flushLitArchivalPrewarmSources()
  }

  function mountLitArchivalTooltipFrame(body, summaryGene, geneDetail, portraitLocator = null) {
    const iframe = ensureLitArchivalFrame()
    if (!iframe) return
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const directPortraitSrc = buildTooltipFramePortraitSrc(geneDetail, portraitLocator)
    const warmedPortraitSrc = directPortraitSrc ? portraitCache.getCachedSrc(directPortraitSrc) : ""
    const portraitState = IconoContentTooltip.createAdapterOwnedPortraitState(
      directPortraitSrc,
      warmedPortraitSrc,
    )
    const payload = {
      type: LIT_ARCHIVAL_RENDER_MESSAGE,
      requestId: String(++litArchivalFrameRequestSerial),
      theme: "light",
      cardVariant,
      symbol,
      pageUrl: symbol ? buildGenePageUrl(symbol) : "",
      navigationArmedAt: tooltipNavigationArmedAt,
      loading: !detail,
      gene: archivalTooltipGeneModel(summaryGene, detail, portraitLocator),
      portraitSrc: portraitState.frameSrc,
      portraitDimensions: buildTooltipFramePortraitDimensions(
        summaryGene,
        geneDetail,
        portraitLocator,
      ),
      model: buildLitTooltipCardModel(
        summaryGene,
        geneDetail,
        portraitState.frameSrc,
        portraitLocator,
      ),
      vote: buildLitArchivalTooltipVoteConfig(geneDetail, portraitLocator),
    }
    if (portraitState.frameSrc) {
      // Fence: neighboring hovers only feel instant if the rendering iframe has already decoded
      // the warmed source. Caching bytes in the content script alone still leaves a paint-time
      // decode gap that users perceive as a blink.
      prewarmLitArchivalFramePortraitSrcs([portraitState.frameSrc])
    }
    postLitArchivalFramePayload(iframe, payload)
    if (!portraitState.requestSrc || portraitState.frameSrc) return
    litArchivalFrameController
      .postHydrated(
        payload.requestId,
        getUsablePortraitSrc(portraitState.requestSrc),
        (usablePortraitSrc) => {
          const hydratedPayload = Object.assign({}, payload, {
            portraitSrc: usablePortraitSrc,
            model: buildLitTooltipCardModel(
              summaryGene,
              geneDetail,
              usablePortraitSrc,
              portraitLocator,
            ),
          })
          prewarmLitArchivalFramePortraitSrcs([usablePortraitSrc])
          return hydratedPayload
        },
      )
      .catch(() => null)
  }

  function renderTooltipBody(summaryGene, geneDetail, loading, portraitLocator = null) {
    if (!tooltip) return
    const body = tooltip.querySelector(".iconoplasm-tooltip-body")
    if (!body) return
    if (usesTooltipFrameRenderer()) {
      // Fence: all maintained rich layouts are Lit-owned now. The removed legacy non-Lit vintage
      // card must not come back as a third tooltip branch or we will reintroduce spec drift.
      const iframe = litArchivalFrameController.show(
        String(
          (geneDetail && geneDetail.symbol) || (summaryGene && summaryGene.symbol) || "Gene",
        ).toUpperCase() + " hover card",
      )
      if (!iframe) return
      mountLitArchivalTooltipFrame(body, summaryGene, geneDetail, portraitLocator)
      return
    }
    parkLitArchivalFrame()
    const surfaces = ensureTooltipSurfaces()
    if (!surfaces) return
    renderSimpleTooltipBody(
      surfaces.simpleSurface,
      summaryGene,
      geneDetail,
      loading,
      portraitLocator,
    )
  }

  function wireRenderedTooltipVoteBox(geneDetail) {
    if (usesTooltipFrameRenderer()) return
    IconoContentVoteBridge.wireRenderedTooltipVoteBox({
      tooltip,
      geneDetail,
      activeSymbol,
      cardShared: IconoCardShared,
      apiBaseUrl: ICONOPLASM_API_BASE,
      fetchImpl: extensionApiFetch,
      onAuthRequired: showVoteLoginPopup,
      onError: (phase, err) => {
        console.error("[Iconoplasm] extension vote " + phase + " error:", err)
      },
    })
  }

  async function fetchGeneDetailForTooltip(symbol, signal) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return null
    if (geneDetailCache.has(normalizedSymbol)) return geneDetailCache.get(normalizedSymbol)
    const responses = await fetchGeneDetailsBatch([normalizedSymbol], {
      priority: "foreground",
      signal,
    })
    return responses.get(normalizedSymbol) || null
  }

  async function fetchPortraitLocatorForTooltip(symbol, signal) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return null
    if (portraitLocatorCache.has(normalizedSymbol)) {
      return portraitLocatorCache.get(normalizedSymbol)
    }
    const responses = await fetchPortraitLocatorsBatch([normalizedSymbol], {
      priority: "foreground",
      signal,
    })
    return responses.get(normalizedSymbol) || null
  }

  function onTooltipClick(e) {
    if (e && e.target && e.target.closest("[data-icono-vote-box]")) return
    if (Date.now() < tooltipNavigationArmedAt) {
      e.preventDefault()
      return
    }
    openGenePage(activeSymbol)
  }

  function onTooltipKeyDown(e) {
    if (e.target && e.target.closest("[data-icono-vote-box]")) return
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    openGenePage(activeSymbol)
  }

  function chooseTooltipViewportPosition(rect, tooltipWidth, tooltipHeight) {
    const maxLeft = Math.max(
      TOOLTIP_VIEWPORT_MARGIN_PX,
      window.innerWidth - tooltipWidth - TOOLTIP_VIEWPORT_MARGIN_PX,
    )
    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    left = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, Math.min(left, maxLeft))

    const availableAbove = Math.max(0, rect.top - TOOLTIP_VIEWPORT_MARGIN_PX)
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - TOOLTIP_VIEWPORT_MARGIN_PX,
    )
    const belowFits = availableBelow >= tooltipHeight + TOOLTIP_TARGET_GAP_PX
    const aboveFits = availableAbove >= tooltipHeight + TOOLTIP_TARGET_GAP_PX
    const showBelow = belowFits || (!aboveFits && availableBelow >= availableAbove)
    const rawTop = showBelow
      ? rect.bottom + TOOLTIP_TARGET_GAP_PX
      : rect.top - tooltipHeight - TOOLTIP_TARGET_GAP_PX
    const maxTop = Math.max(
      TOOLTIP_VIEWPORT_MARGIN_PX,
      window.innerHeight - tooltipHeight - TOOLTIP_VIEWPORT_MARGIN_PX,
    )
    const top = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, Math.min(rawTop, maxTop))

    return { left, top, showBelow }
  }

  function activateTooltipForAnchor(target, relatedTarget = null) {
    const relatedGene =
      relatedTarget && typeof relatedTarget.closest === "function"
        ? relatedTarget.closest(".iconoplasm-gene")
        : null
    if (relatedGene === target) return
    cancelHideTimer()

    const symbol = target.dataset.gene
    const gene = geneMap[symbol]
    if (!gene) return
    if (activeSymbol && activeSymbol !== symbol) {
      clearPendingDiscovery(activeSymbol)
    }
    activeSymbol = symbol
    activeTooltipAnchor = target
    readingSession.prioritize(symbol)
    if (activeDetailAbortController) activeDetailAbortController.abort()
    activeDetailAbortController =
      typeof AbortController === "function" ? new AbortController() : null
    activeGeneSummary = Object.assign({ symbol }, gene)
    tooltipNavigationArmedAt = Date.now() + TOOLTIP_NAVIGATION_DELAY_MS
    // Hover is a selector over the reading session's ready-card set. The
    // foreground request below is only the recovery path for Data Saver, a
    // transient preparation failure, or an immediate hover during startup.
    const hoverGeneDetailPromise = geneDetailCache.has(symbol)
      ? Promise.resolve(geneDetailCache.get(symbol) || null)
      : fetchGeneDetailForTooltip(symbol, activeDetailAbortController?.signal)
    const hoverPortraitLocatorPromise = portraitLocatorCache.has(symbol)
      ? Promise.resolve(portraitLocatorCache.get(symbol) || null)
      : fetchPortraitLocatorForTooltip(symbol, activeDetailAbortController?.signal)
    void hoverPortraitLocatorPromise.then((locator) => {
      const portraitSrc = portraitUrlFromGeneDetail(locator)
      return portraitSrc ? getUsablePortraitSrc(portraitSrc).catch(() => "") : ""
    })
    const color = gene.c || PLACEHOLDER_COLOR
    const usesFrameRenderer = usesTooltipFrameRenderer()

    // Fill tooltip content
    const portrait = tooltip.querySelector(".iconoplasm-tooltip-portrait")
    const portraitRefs = usesFrameRenderer ? null : resetSimpleTooltipPortrait(portrait)
    const initialPortraitLocator = portraitLocatorCache.has(symbol)
      ? portraitLocatorCache.get(symbol)
      : null
    const fade = portraitRefs ? portraitRefs.fade : null
    const portraitSymbol = portraitRefs ? portraitRefs.portraitSymbol : null
    if (!usesFrameRenderer) {
      void loadSimpleTooltipPortrait({
        symbol,
        summaryGene: gene,
        geneDetail: geneDetailCache.has(symbol) ? geneDetailCache.get(symbol) : null,
        portraitLocator: initialPortraitLocator,
        portraitRefs,
      })
      if (portraitSymbol) portraitSymbol.textContent = symbol
    }

    // Keep the reading surface neutral; gene color is an accent only.
    tooltip.style.backgroundColor = ""
    tooltip.style.setProperty("--iconoplasm-gene-color", color)
    if (fade) fade.style.background = ""
    if (portraitSymbol) portraitSymbol.style.color = ""

    const hoverSymbol = symbol
    if (geneDetailCache.has(symbol)) {
      const geneDetail = geneDetailCache.get(symbol)
      renderTooltipBody(activeGeneSummary, geneDetail, false, initialPortraitLocator)
      wireRenderedTooltipVoteBox(geneDetail)
    } else {
      // Reserve the metadata area immediately so the title block never jumps.
      renderTooltipBody(activeGeneSummary, null, true, initialPortraitLocator)
      hoverGeneDetailPromise.then((geneDetail) => {
        if (activeSymbol === hoverSymbol && geneDetail) {
          const portraitLocator = portraitLocatorCache.get(hoverSymbol) || null
          if (portraitRefs) {
            void loadSimpleTooltipPortrait({
              symbol: hoverSymbol,
              summaryGene: activeGeneSummary,
              geneDetail,
              portraitLocator,
              portraitRefs,
            })
          }
          renderTooltipBody(activeGeneSummary, geneDetail, false, portraitLocator)
          wireRenderedTooltipVoteBox(geneDetail)
        } else if (activeSymbol === hoverSymbol) {
          renderTooltipBody(
            activeGeneSummary,
            null,
            false,
            portraitLocatorCache.get(hoverSymbol) || null,
          )
        }
      })
    }
    hoverPortraitLocatorPromise.then((portraitLocator) => {
      if (activeSymbol !== hoverSymbol || !portraitLocator) return
      const geneDetail = geneDetailCache.get(hoverSymbol) || null
      if (portraitRefs) {
        void loadSimpleTooltipPortrait({
          symbol: hoverSymbol,
          summaryGene: activeGeneSummary,
          geneDetail,
          portraitLocator,
          portraitRefs,
        })
      }
      renderTooltipBody(activeGeneSummary, geneDetail, !geneDetail, portraitLocator)
      if (geneDetail) wireRenderedTooltipVoteBox(geneDetail)
    })

    // Position tooltip
    const rect = target.getBoundingClientRect()
    const tooltipWidth = tooltip.offsetWidth || 500
    const tooltipHeight = tooltip.offsetHeight || 248

    const tooltipPosition = chooseTooltipViewportPosition(rect, tooltipWidth, tooltipHeight)

    tooltip.style.left = tooltipPosition.left + window.scrollX + "px"
    tooltip.style.top = tooltipPosition.top + window.scrollY + "px"
    tooltip.dataset.placement = tooltipPosition.showBelow ? "below" : "above"

    tooltip.classList.add("iconoplasm-tooltip-visible")
    scheduleDiscoveryEncounter(symbol)
  }

  function onMouseOver(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (target) activateTooltipForAnchor(target, e.relatedTarget)
  }

  function leaveTooltipAnchor(relatedTarget = null) {
    if (
      relatedTarget &&
      typeof relatedTarget.closest === "function" &&
      (relatedTarget.closest(".iconoplasm-tooltip") || relatedTarget.closest(".iconoplasm-gene"))
    ) {
      return
    }
    clearPendingDiscovery(activeSymbol)
    scheduleHideTooltip()
  }

  function onMouseOut(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (!target) return
    leaveTooltipAnchor(e.relatedTarget)
  }

  function onTooltipMouseLeave(e) {
    const related = e.relatedTarget
    if (related && (related.closest(".iconoplasm-tooltip") || related.closest(".iconoplasm-gene")))
      return
    clearPendingDiscovery(activeSymbol)
    scheduleHideTooltip()
  }

  function onLitArchivalFrameMessage(event) {
    const data = event && event.data && typeof event.data === "object" ? event.data : null
    if (!data || data.source !== LIT_ARCHIVAL_FRAME_SOURCE) return
    const iframe = litArchivalFrameController.getFrame()
    if (!iframe || event.source !== iframe.contentWindow) return
    if (data.type === LIT_ARCHIVAL_READY_MESSAGE) {
      litArchivalFrameController.markReady(event.source)
      flushLitArchivalPrewarmSources()
      return
    }
    if (data.type === LIT_ARCHIVAL_RENDERED_MESSAGE) {
      const requestId = String(data.requestId || "")
      if (requestId && requestId === iframe.dataset.iconoFrameActiveRequest) {
        iframe.dataset.iconoFrameRenderState = "current"
        iframe.dataset.iconoFrameSymbol = String(data.symbol || "")
          .trim()
          .toUpperCase()
      }
      return
    }
    if (data.type === LIT_ARCHIVAL_PREWARMED_MESSAGE) {
      const completedSources = [
        ...(Array.isArray(data.sources) ? data.sources : []),
        ...(Array.isArray(data.failedSources) ? data.failedSources : []),
      ]
      for (const rawSource of completedSources) {
        const source = String(rawSource || "").trim()
        if (!source) continue
        pendingLitArchivalPrewarmSources.delete(source)
        inFlightLitArchivalPrewarmSources.delete(source)
      }
      for (const rawSource of Array.isArray(data.sources) ? data.sources : []) {
        const source = String(rawSource || "").trim()
        if (source) rememberReadyLitArchivalPrewarmSource(source)
      }
      flushLitArchivalPrewarmSources()
      return
    }
    if (data.type === LIT_ARCHIVAL_OPEN_MESSAGE) {
      openGenePage(
        String(data.symbol || activeSymbol || "")
          .trim()
          .toUpperCase(),
      )
      return
    }
    if (data.type === LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE) {
      showVoteLoginPopup()
    }
  }

  function hideTooltip() {
    cancelHideTimer()
    clearPendingDiscovery(activeSymbol)
    if (activeDetailAbortController) activeDetailAbortController.abort()
    activeDetailAbortController = null
    // Recently hovered neighbors remain useful during the short gap after the
    // tooltip closes. The next hover selectively promotes its symbol, then
    // cancels only the remaining obsolete detail requests.
    activeSymbol = null
    activeTooltipAnchor = null
    activeGeneSummary = null
    tooltipNavigationArmedAt = 0
    portraitLoadToken += 1
    tooltip.classList.remove("iconoplasm-tooltip-visible")
  }

  // -- Go ------------------------------------------------------------
  function launchContentRuntime() {
    init()
    window.dispatchEvent(new CustomEvent("iconoplasm-content-runtime-loaded"))
  }

  if (
    document.documentElement.dataset.iconoplasmGeckoPdfSource &&
    !document.documentElement.dataset.iconoplasmPdfReader
  ) {
    window.addEventListener(
      "iconoplasm-gecko-reader-mounted",
      () =>
        IconoContentLifecycle.runAfterHostLoad({
          documentRef: document,
          windowRef: window,
          task: launchContentRuntime,
        }),
      { once: true },
    )
  } else {
    IconoContentLifecycle.runAfterHostLoad({
      documentRef: document,
      windowRef: window,
      task: launchContentRuntime,
    })
  }
})()
