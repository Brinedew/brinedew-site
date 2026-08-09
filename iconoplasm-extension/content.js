// Iconoplasm content script -- scans page text for gene symbols, wraps them,
// and shows horizontal hover infoboxes with portrait + gene color border.
// Canonical extension root now lives in D:\Coding\Website\iconoplasm-extension.

;(function () {
  "use strict"

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
  const IconoVisibilityScheduler = globalThis.IconoplasmVisibilityScheduler
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
    typeof IconoContentLifecycle.createMutationScanController !== "function"
  ) {
    console.error("[Iconoplasm] content lifecycle missing: load content-lifecycle.js first")
    return
  }
  if (!IconoContentTooltip || typeof IconoContentTooltip.createTooltipShell !== "function") {
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
  const ICONOPLASM_DISCOVERY_ENCOUNTER_URL =
    ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/encounter"
  const ICONOPLASM_DISCOVERY_STATE_URL = ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/me"
  const ICONOPLASM_DISCOVERY_MERGE_URL = ICONOPLASM_API_BASE + "/api/iconoplasm/discoveries/merge"
  const LIT_ARCHIVAL_FRAME_URL = chrome.runtime.getURL("lit-archival-frame.html")
  const LIT_ARCHIVAL_FRAME_ORIGIN = new URL(LIT_ARCHIVAL_FRAME_URL).origin
  const LIT_ARCHIVAL_FRAME_SOURCE = "iconoplasm-lit-archival-frame"
  const LIT_ARCHIVAL_RENDER_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_RENDER"
  const LIT_ARCHIVAL_PREWARM_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_PREWARM"
  const LIT_ARCHIVAL_READY_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_READY"
  const LIT_ARCHIVAL_RENDERED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_RENDERED"
  const LIT_ARCHIVAL_OPEN_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_OPEN"
  const LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"
  const DEFAULT_PORTRAIT_DIMENSIONS = Object.freeze({ width: 768, height: 1024 })
  const DISCOVERY_HOVER_DWELL_MS = 900
  const DISCOVERY_SYMBOL_COOLDOWN_MS = 30 * 1000
  const DISCOVERY_AUTH_CACHE_TTL_MS = 5 * 60 * 1000
  const GUEST_DISCOVERY_SYMBOL_MAX = 2000
  const GENE_DETAIL_VISIBLE_LIMIT = 16
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
  const ensureHighlightTextWrapper = highlightRuntime.ensureHighlightTextWrapper
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

  function normalizeHighlightVisibility(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase() === "hover"
      ? "hover"
      : "always"
  }

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

  function renderSimpleTooltipBody(body, summaryGene, geneDetail, loading) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const fullName = String((detail && detail.full_name) || summary.n || symbol).trim()
    const assetSha = String(((detail || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()

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
  let viewportWarmFrame = 0
  let visibilityScheduler = null
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
  let litArchivalPrewarmFrame = null
  const pendingLitArchivalPrewarmSources = new Set()
  const warnedMissingTraitOrigins = new Set()
  // Fence: keep background detail batches small. Large batches made the hovered gene wait behind
  // bulk prewarm work, which is why "simple text loads seconds later" showed up in practice.
  const GENE_DETAIL_WARM_BATCH_SIZE = 8
  const PORTRAIT_WARM_BATCH_SIZE = 6
  const GENE_DETAIL_VIEWPORT_ABOVE_PX = 160
  const GENE_DETAIL_VIEWPORT_BELOW_PX = 960
  const TOOLTIP_VIEWPORT_MARGIN_PX = 8
  const TOOLTIP_TARGET_GAP_PX = 8
  const TOOLTIP_NAVIGATION_DELAY_MS = 500
  const decodedPortraitSrcCache = new Set()
  const decodedPortraitSrcPromises = new Map()
  const DECODED_PORTRAIT_CACHE_LIMIT = 96

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

  function onPortraitWarmBatch(usableSources) {
    prewarmLitArchivalFramePortraitSrcs(usableSources)
    warmDecodedPortraitSources(usableSources)
  }

  function portraitUrlFromGeneDetail(detail) {
    const portrait =
      detail && detail.portrait && typeof detail.portrait === "object" ? detail.portrait : null
    return String(
      (portrait && (portrait.medium_url || portrait.hero_url || portrait.thumb_url)) || "",
    ).trim()
  }

  function onGeneDetailWarmBatch(records) {
    const urls = []
    const seenUrls = new Set()
    for (const record of Array.isArray(records) ? records : []) {
      const portraitSrc = portraitUrlFromGeneDetail(record)
      if (!portraitSrc || seenUrls.has(portraitSrc)) continue
      seenUrls.add(portraitSrc)
      urls.push(portraitSrc)
    }
    if (urls.length) warmPortraitUrls(urls)
  }

  const portraitCache = IconoContentPortraitCache.createPortraitCache({
    windowRef: window,
    chromeApi: chrome,
    batchSize: PORTRAIT_WARM_BATCH_SIZE,
    delayMs: 20,
    onWarmBatch: onPortraitWarmBatch,
  })
  const portraitDataUrlCache = portraitCache.dataUrlCache
  const geneDetailStore = IconoContentDetailCache.createGeneDetailStore({
    windowRef: window,
    fetchImpl: extensionApiFetch,
    batchUrl: ICONOPLASM_GENE_BATCH_URL,
    fields: GENE_DETAIL_BATCH_FIELDS,
    warmBatchSize: GENE_DETAIL_WARM_BATCH_SIZE,
    visibleLimit: GENE_DETAIL_VISIBLE_LIMIT,
    delayMs: 20,
    deferTask: deferGeneDetailWarm,
    // ARCHITECTURE FENCE [IPD-008]: public detail is immutable inside the
    // published card snapshot. Reuse it across pages instead of paying the
    // Worker and KV read plane again for the same gene.
    storageApi: chrome.storage.local,
    persistentLimit: 512,
    persistentByteLimit: GENE_DETAIL_PERSISTENT_MAX_BYTES,
    getRevision: async () => {
      const stored = await chrome.storage.local.get([
        "iconoplasm_card_snapshot_version",
        "iconoplasm_hash",
      ])
      return stored.iconoplasm_card_snapshot_version || stored.iconoplasm_hash || ""
    },
    onResolvedBatch: onGeneDetailWarmBatch,
    onError: (err) => {
      console.error("[Iconoplasm] extension gene detail batch fetch error:", err)
    },
  })
  const geneDetailCache = geneDetailStore.cache // symbol -> gene payload or null

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
    let removed = 0
    for (const el of genes) {
      const symbol = String((el.dataset && el.dataset.gene) || "")
        .trim()
        .toUpperCase()
      const label = String((el.dataset && el.dataset.geneLabel) || el.textContent || "")
        .trim()
        .toUpperCase()
      if (!symbol && !label) continue
      if (!blocklist.has(symbol) && !blocklist.has(label)) continue
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
    unwrapBlockedGeneHighlights(nextBlocklist)
    if (rescan) {
      scanPage(document.body)
      refreshHighlightStyles()
      scheduleWarmVisibleGeneDetails()
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
    window.setTimeout(task, 0)
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

  function warmPortraitUrls(urls) {
    portraitCache.warmUrls(urls)
  }

  function collectVisibleGeneSymbols(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (!geneMap) return []
    const symbols = []
    const seenSymbols = new Set()
    const genes = document.querySelectorAll(".iconoplasm-gene")
    for (const geneEl of genes) {
      const rect = geneEl.getBoundingClientRect()
      if (rect.bottom < -GENE_DETAIL_VIEWPORT_ABOVE_PX) continue
      if (rect.top > window.innerHeight + GENE_DETAIL_VIEWPORT_BELOW_PX) continue
      const symbol = geneEl.dataset ? geneEl.dataset.gene : ""
      if (!symbol || seenSymbols.has(symbol)) continue
      seenSymbols.add(symbol)
      symbols.push(symbol)
      if (symbols.length >= limit) break
    }
    return symbols
  }

  function collectObservedVisibleGeneSymbols(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (!visibilityScheduler) return []
    return visibilityScheduler
      .getVisibleSymbols(limit)
      .filter((symbol) => geneMap && geneMap[symbol])
  }

  function ensureVisibilityObserver() {
    if (visibilityScheduler) return visibilityScheduler
    if (!IconoVisibilityScheduler) return null
    // Fence: warming should follow observer-driven visibility rather than repeated layout reads on
    // scroll/resize. The old getBoundingClientRect loop worked, but it turned visibility into a
    // hand-rolled scheduler with more main-thread tax than necessary.
    visibilityScheduler = IconoVisibilityScheduler.createVisibilityScheduler({
      abovePx: GENE_DETAIL_VIEWPORT_ABOVE_PX,
      belowPx: GENE_DETAIL_VIEWPORT_BELOW_PX,
      onVisibleChange: () => {
        scheduleWarmVisibleGeneDetails()
      },
    })
    return visibilityScheduler
  }

  function observeGeneElement(el) {
    if (!el || !el.dataset || !el.dataset.gene) return
    const scheduler = ensureVisibilityObserver()
    if (scheduler) scheduler.observe(el)
  }

  function collectNeighborGeneSymbols(targetEl, limit = GENE_DETAIL_WARM_BATCH_SIZE) {
    if (!targetEl) return []
    const genes = Array.from(document.querySelectorAll(".iconoplasm-gene"))
    const targetIndex = genes.indexOf(targetEl)
    if (targetIndex === -1) return []

    const symbols = []
    const seenSymbols = new Set()
    const pushSymbol = (symbol) => {
      const normalized = String(symbol || "")
        .trim()
        .toUpperCase()
      if (!normalized || seenSymbols.has(normalized)) return
      seenSymbols.add(normalized)
      symbols.push(normalized)
    }

    const max = Math.max(0, Number(limit || GENE_DETAIL_WARM_BATCH_SIZE))
    for (let distance = 1; symbols.length < max; distance += 1) {
      const left = targetIndex - distance
      const right = targetIndex + distance
      if (left < 0 && right >= genes.length) break
      if (left >= 0) {
        pushSymbol(genes[left].dataset ? genes[left].dataset.gene : "")
        if (symbols.length >= max) break
      }
      if (right < genes.length) {
        pushSymbol(genes[right].dataset ? genes[right].dataset.gene : "")
      }
    }
    return symbols
  }

  async function fetchGeneDetailsBatch(symbols) {
    return geneDetailStore.fetchBatch(symbols)
  }

  function warmGeneDetails(symbols, limit = GENE_DETAIL_VISIBLE_LIMIT) {
    geneDetailStore.warm(symbols, limit)
  }

  function scheduleWarmVisibleGeneDetails(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    geneDetailStore.scheduleWarm(
      () =>
        visibilityScheduler && visibilityScheduler.hasVisibleSymbols()
          ? collectObservedVisibleGeneSymbols(limit)
          : collectVisibleGeneSymbols(limit),
      limit,
    )
  }

  function scheduleViewportWarm() {
    if (viewportWarmFrame) return
    viewportWarmFrame = window.requestAnimationFrame(() => {
      viewportWarmFrame = 0
      scheduleWarmVisibleGeneDetails()
    })
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
    const cachedSrc = portraitDataUrlCache.get(portraitSrc)
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

  function loadSimpleTooltipPortrait({ symbol, summaryGene, geneDetail, portraitRefs }) {
    if (!portraitRefs || !portraitRefs.portraitImg) return Promise.resolve()
    // The scanner index deliberately has no portrait metadata. Both tooltip renderers wait for
    // the same bounded published-detail cache instead of copying cold portrait references into
    // every tab.
    return loadTooltipPortrait({
      symbol,
      portrait: portraitRefs.portrait,
      portraitImg: portraitRefs.portraitImg,
      portraitFallback: portraitRefs.portraitFallback,
      portraitStatus: portraitRefs.portraitStatus,
      portraitSrc: buildTooltipFramePortraitSrc(geneDetail),
    })
  }

  // -- Font ownership ------------------------------------------------
  // generated/shared-card-label.css owns the extension font faces. Keep this
  // helper as a no-op compatibility hook so content init stays simple without
  // reintroducing ad hoc legacy font injection.
  function injectFonts() {
    return undefined
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
    } else {
      geneMap = payload
    }
    if (!geneMap || Object.keys(geneMap).length === 0) {
      console.log("[Iconoplasm] Gene data unavailable. Retrying shortly.")
      scheduleInitializationRetry()
      return
    }

    // Fence: candidate generation now lives in a dedicated matcher module. Keep content.js acting
    // as the page adapter that applies matches, not the place where lexical rules accrete forever.
    rebuildGeneMatcher(effectiveBlocklist)
    pageScanner = IconoContentScanner.createPageScanner({
      documentRef: document,
      nodeFilter: NodeFilter,
      skipTags: SKIP_TAGS,
      placeholderColor: PLACEHOLDER_COLOR,
      getGeneMap: () => geneMap,
      getMatcher: () => geneMatcher,
      applyHighlightStyle,
      observeGeneElement,
    })

    console.log("[Iconoplasm] Loaded", Object.keys(geneMap).length, "genes. Scanning...")
    injectFonts()
    createTooltip()
    createAuthToast()
    scanPage(document.body)
    refreshHighlightStyles()
    scheduleDiscoveryBufferFlush()
    scheduleWarmVisibleGeneDetails()
    if (!ensureVisibilityObserver()) {
      window.addEventListener("scroll", scheduleViewportWarm, { passive: true })
      window.addEventListener("resize", scheduleViewportWarm, { passive: true })
    }
    window.addEventListener("resize", scheduleHighlightGeometryRefresh, { passive: true })
    window.addEventListener("focus", scheduleDiscoveryBufferFlush)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleDiscoveryBufferFlush()
      }
    })
    observeMutations()
    initialized = true
  }

  // -- DOM scanning --------------------------------------------------
  function scanPage(root) {
    return pageScanner ? pageScanner.scanPage(root) : 0
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
        scheduleWarmVisibleGeneDetails()
      },
    })
    mutationScanController.start()
  }

  // -- Tooltip -------------------------------------------------------
  function createTooltip() {
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
  }

  function createAuthToast() {
    authToast = IconoContentTooltip.createAuthToast(document)
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    if (changes[HIGHLIGHT_MODE_KEY]) {
      highlightMode = highlightRuntime.setMode(changes[HIGHLIGHT_MODE_KEY].newValue)
      refreshHighlightStyles()
    }
    if (changes[HIGHLIGHT_VISIBILITY_KEY]) {
      highlightVisibility = normalizeHighlightVisibility(changes[HIGHLIGHT_VISIBILITY_KEY].newValue)
      applyHighlightVisibility()
    }
    if (changes[CARD_VARIANT_KEY]) {
      cardVariant = normalizeCardVariant(changes[CARD_VARIANT_KEY].newValue)
      applyTooltipTheme()
      renderTooltipBody(
        activeGeneSummary,
        geneDetailCache.get(activeSymbol) || null,
        Boolean(activeSymbol),
      )
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

  function archivalTooltipGeneModel(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    return (
      detail || {
        symbol: summary.symbol || activeSymbol || "",
        full_name: summary.n || summary.symbol || activeSymbol || "",
        color: summary.c || PLACEHOLDER_COLOR,
        essence: {},
      }
    )
  }

  function buildLitTooltipCardModel(summaryGene, geneDetail, portraitSrcOverride) {
    const geneModel = archivalTooltipGeneModel(summaryGene, geneDetail)
    const symbol = String(geneModel.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const assetSha = String(((geneDetail || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
    const portraitSrc =
      String(portraitSrcOverride || "").trim() || buildTooltipFramePortraitSrc(geneDetail)
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

  function buildTooltipFramePortraitSrc(geneDetail) {
    const detailPortrait = geneDetail && geneDetail.portrait ? geneDetail.portrait : null
    return portraitUrlFromGeneDetail({ portrait: detailPortrait })
  }

  function buildTooltipFramePortraitDimensions(summaryGene, geneDetail) {
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    if (detail && IconoCardShared && typeof IconoCardShared.portraitDimensions === "function") {
      const dims = IconoCardShared.portraitDimensions(detail)
      if (dims && Number(dims.width) > 1 && Number(dims.height) > 1) return dims
    }
    // Fence: image-only and Lit archival cards need a stable first-paint aspect ratio. Falling
    // back to 1:1 during cold hover makes some genes look square until detail hydration lands,
    // which users perceive as a random crop/zoom jump rather than ordinary loading.
    return DEFAULT_PORTRAIT_DIMENSIONS
  }

  function buildLitArchivalTooltipVoteConfig(geneDetail) {
    return IconoContentVoteBridge.buildTooltipVoteConfig({
      geneDetail,
      activeSymbol,
      apiBaseUrl: ICONOPLASM_API_BASE,
      imageOnly: isImageOnlyCardVariant(),
    })
  }

  function buildLitArchivalTooltipFrameHtml(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    return (
      '<div class="iconoplasm-tooltip-lit-frame-shell">' +
      '<iframe class="iconoplasm-tooltip-lit-frame" data-icono-frame-ready="false" src="' +
      escapeHtml(LIT_ARCHIVAL_FRAME_URL) +
      '" title="' +
      escapeHtml((symbol || "Gene") + " archival card") +
      '" scrolling="no" tabindex="-1"></iframe>' +
      "</div>"
    )
  }

  function createLitArchivalTooltipFrameShell(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const shell = document.createElement("div")
    shell.className = "iconoplasm-tooltip-lit-frame-shell"
    const iframe = document.createElement("iframe")
    iframe.className = "iconoplasm-tooltip-lit-frame"
    iframe.dataset.iconoFrameReady = "false"
    iframe.src = LIT_ARCHIVAL_FRAME_URL
    iframe.title = (symbol || "Gene") + " archival card"
    iframe.scrolling = "no"
    iframe.tabIndex = -1
    shell.appendChild(iframe)
    return shell
  }

  function postLitArchivalFramePayload(iframe, payload) {
    if (!iframe || !iframe.isConnected || !iframe.contentWindow) return
    const requestId = String((payload && payload.requestId) || "")
    const symbol = String((payload && payload.symbol) || "")
      .trim()
      .toUpperCase()
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") {
      iframe.__iconoPendingPayload = payload
      return
    }
    if (iframe.dataset) {
      const previousSymbol = String(iframe.dataset.iconoFrameSymbol || "")
        .trim()
        .toUpperCase()
      iframe.dataset.iconoFrameActiveRequest = requestId
      if (previousSymbol && symbol && previousSymbol !== symbol) {
        iframe.dataset.iconoFrameRenderState = "pending"
      }
    }
    try {
      iframe.contentWindow.postMessage(payload, LIT_ARCHIVAL_FRAME_ORIGIN)
    } catch (err) {
      console.error("[Iconoplasm] failed to post archival frame payload:", err)
    }
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

  function ensureLitArchivalPrewarmFrame() {
    if (!usesTooltipFrameRenderer()) return null
    if (litArchivalPrewarmFrame && litArchivalPrewarmFrame.isConnected) {
      return litArchivalPrewarmFrame
    }
    const iframe = document.createElement("iframe")
    iframe.className = "iconoplasm-tooltip-lit-frame iconoplasm-tooltip-lit-frame--prewarm"
    iframe.dataset.iconoFrameReady = "false"
    iframe.src = LIT_ARCHIVAL_FRAME_URL
    iframe.title = "Iconoplasm hover card preloader"
    iframe.scrolling = "no"
    iframe.tabIndex = -1
    iframe.setAttribute("aria-hidden", "true")
    document.body.appendChild(iframe)
    litArchivalPrewarmFrame = iframe
    return iframe
  }

  function flushLitArchivalPrewarmSources() {
    if (!pendingLitArchivalPrewarmSources.size) return
    const sources = Array.from(pendingLitArchivalPrewarmSources)
    const prewarmFrame = ensureLitArchivalPrewarmFrame()
    const sentToPrewarm = postLitArchivalFramePrewarm(prewarmFrame, sources)
    const visibleFrame = tooltip ? tooltip.querySelector(".iconoplasm-tooltip-lit-frame") : null
    const sentToVisible =
      visibleFrame && visibleFrame !== prewarmFrame
        ? postLitArchivalFramePrewarm(visibleFrame, sources)
        : false
    if (sentToPrewarm || sentToVisible) pendingLitArchivalPrewarmSources.clear()
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
    for (const source of usableSources) pendingLitArchivalPrewarmSources.add(source)
    ensureLitArchivalPrewarmFrame()
    flushLitArchivalPrewarmSources()
  }

  function mountLitArchivalTooltipFrame(body, summaryGene, geneDetail) {
    const iframe = body.querySelector(".iconoplasm-tooltip-lit-frame")
    if (!iframe) return
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const directPortraitSrc = buildTooltipFramePortraitSrc(geneDetail)
    const warmedPortraitSrc = directPortraitSrc
      ? portraitDataUrlCache.get(directPortraitSrc) || ""
      : ""
    const payload = {
      type: LIT_ARCHIVAL_RENDER_MESSAGE,
      requestId: String(++litArchivalFrameRequestSerial),
      theme: "light",
      cardVariant,
      symbol,
      pageUrl: symbol ? buildGenePageUrl(symbol) : "",
      navigationArmedAt: tooltipNavigationArmedAt,
      loading: !detail,
      gene: detail || archivalTooltipGeneModel(summaryGene, null),
      portraitSrc: warmedPortraitSrc || directPortraitSrc,
      portraitDimensions: buildTooltipFramePortraitDimensions(summaryGene, geneDetail),
      model: buildLitTooltipCardModel(
        summaryGene,
        geneDetail,
        warmedPortraitSrc || directPortraitSrc,
      ),
      vote: buildLitArchivalTooltipVoteConfig(geneDetail),
    }
    if (warmedPortraitSrc) {
      // Fence: neighboring hovers only feel instant if the rendering iframe has already decoded
      // the warmed source. Caching bytes in the content script alone still leaves a paint-time
      // decode gap that users perceive as a blink.
      prewarmLitArchivalFramePortraitSrcs([warmedPortraitSrc])
    }
    postLitArchivalFramePayload(iframe, payload)
    if (!directPortraitSrc || warmedPortraitSrc) return
    getUsablePortraitSrc(directPortraitSrc)
      .then((usablePortraitSrc) => {
        if (!usablePortraitSrc) return
        if (!iframe.isConnected) return
        if (activeSymbol !== symbol) return
        const hydratedPayload = Object.assign({}, payload, {
          portraitSrc: usablePortraitSrc,
          model: buildLitTooltipCardModel(summaryGene, geneDetail, usablePortraitSrc),
        })
        prewarmLitArchivalFramePortraitSrcs([usablePortraitSrc])
        postLitArchivalFramePayload(iframe, hydratedPayload)
      })
      .catch(() => null)
  }

  function renderTooltipBody(summaryGene, geneDetail, loading) {
    if (!tooltip) return
    const body = tooltip.querySelector(".iconoplasm-tooltip-body")
    if (!body) return
    if (usesTooltipFrameRenderer()) {
      // Fence: all maintained rich layouts are Lit-owned now. The removed legacy non-Lit vintage
      // card must not come back as a third tooltip branch or we will reintroduce spec drift.
      if (!body.querySelector(".iconoplasm-tooltip-lit-frame")) {
        body.replaceChildren(createLitArchivalTooltipFrameShell(summaryGene, geneDetail))
      }
      mountLitArchivalTooltipFrame(body, summaryGene, geneDetail)
      return
    }
    renderSimpleTooltipBody(body, summaryGene, geneDetail, loading)
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

  async function fetchGeneDetailForTooltip(symbol) {
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
    if (!normalizedSymbol) return null
    if (geneDetailCache.has(normalizedSymbol)) return geneDetailCache.get(normalizedSymbol)
    if (geneDetailStore.promiseCache.has(normalizedSymbol)) {
      return geneDetailStore.promiseCache.get(normalizedSymbol)
    }
    const responses = await fetchGeneDetailsBatch([normalizedSymbol])
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

  function onMouseOver(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (!target) return
    cancelHideTimer()

    const symbol = target.dataset.gene
    const gene = geneMap[symbol]
    if (!gene) return
    if (activeSymbol && activeSymbol !== symbol) {
      clearPendingDiscovery(activeSymbol)
    }
    activeSymbol = symbol
    activeGeneSummary = Object.assign({ symbol }, gene)
    tooltipNavigationArmedAt = Date.now() + TOOLTIP_NAVIGATION_DELAY_MS
    // Fence: fetch the hovered gene before warming neighbors. Reversing this puts the hovered
    // symbol into the warm queue first, so the visible card waits on background work.
    const hoverGeneDetailPromise = geneDetailCache.has(symbol)
      ? Promise.resolve(geneDetailCache.get(symbol) || null)
      : fetchGeneDetailForTooltip(symbol)
    const neighborSymbols = collectNeighborGeneSymbols(target, GENE_DETAIL_WARM_BATCH_SIZE)
    warmGeneDetails(neighborSymbols, GENE_DETAIL_WARM_BATCH_SIZE)

    const color = gene.c || PLACEHOLDER_COLOR
    const usesFrameRenderer = usesTooltipFrameRenderer()

    // Fill tooltip content
    const portrait = tooltip.querySelector(".iconoplasm-tooltip-portrait")
    const portraitRefs = usesFrameRenderer ? null : resetSimpleTooltipPortrait(portrait)
    const fade = portraitRefs ? portraitRefs.fade : null
    const portraitSymbol = portraitRefs ? portraitRefs.portraitSymbol : null
    if (!usesFrameRenderer) {
      void loadSimpleTooltipPortrait({
        symbol,
        summaryGene: gene,
        geneDetail: geneDetailCache.has(symbol) ? geneDetailCache.get(symbol) : null,
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
      renderTooltipBody(activeGeneSummary, geneDetail, false)
      wireRenderedTooltipVoteBox(geneDetail)
    } else {
      // Reserve the metadata area immediately so the title block never jumps.
      renderTooltipBody(activeGeneSummary, null, true)
      hoverGeneDetailPromise.then((geneDetail) => {
        if (activeSymbol === hoverSymbol && geneDetail) {
          if (portraitRefs) {
            void loadSimpleTooltipPortrait({
              symbol: hoverSymbol,
              summaryGene: activeGeneSummary,
              geneDetail,
              portraitRefs,
            })
          }
          renderTooltipBody(activeGeneSummary, geneDetail, false)
          wireRenderedTooltipVoteBox(geneDetail)
        } else if (activeSymbol === hoverSymbol) {
          renderTooltipBody(activeGeneSummary, null, false)
        }
      })
    }

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

  function onMouseOut(e) {
    const target = e.target.closest(".iconoplasm-gene")
    if (!target) return
    const related = e.relatedTarget
    if (related && (related.closest(".iconoplasm-tooltip") || related.closest(".iconoplasm-gene")))
      return
    clearPendingDiscovery(activeSymbol)
    scheduleHideTooltip()
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
    if (
      litArchivalPrewarmFrame &&
      litArchivalPrewarmFrame.contentWindow &&
      event.source === litArchivalPrewarmFrame.contentWindow
    ) {
      if (data.type === LIT_ARCHIVAL_READY_MESSAGE) {
        litArchivalPrewarmFrame.dataset.iconoFrameReady = "true"
        flushLitArchivalPrewarmSources()
      }
      return
    }
    const iframe = tooltip ? tooltip.querySelector(".iconoplasm-tooltip-lit-frame") : null
    if (!iframe || event.source !== iframe.contentWindow) return
    if (data.type === LIT_ARCHIVAL_READY_MESSAGE) {
      iframe.dataset.iconoFrameReady = "true"
      if (iframe.__iconoPendingPayload) {
        const pendingPayload = iframe.__iconoPendingPayload
        iframe.__iconoPendingPayload = null
        postLitArchivalFramePayload(iframe, pendingPayload)
      }
      if (iframe.__iconoPendingPrewarmSources && iframe.__iconoPendingPrewarmSources.size) {
        const pendingSources = Array.from(iframe.__iconoPendingPrewarmSources)
        iframe.__iconoPendingPrewarmSources.clear()
        prewarmLitArchivalFramePortraitSrcs(pendingSources)
      }
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
    activeSymbol = null
    activeGeneSummary = null
    tooltipNavigationArmedAt = 0
    portraitLoadToken += 1
    tooltip.classList.remove("iconoplasm-tooltip-visible")
  }

  // -- Go ------------------------------------------------------------
  init()
})()
