// Iconoplasm content script -- scans page text for gene symbols, wraps them,
// and shows horizontal hover infoboxes with portrait + gene color border.
// Canonical extension root now lives in D:\Coding\Website\iconoplasm-extension.

;(function () {
  "use strict"

  const IconoCardShared = globalThis.IconoplasmCardShared
  const IconoContentMatcher = globalThis.IconoplasmContentMatcher
  const IconoHighlightRuntime = globalThis.IconoplasmHighlightRuntime
  const IconoVisibilityScheduler = globalThis.IconoplasmVisibilityScheduler
  if (!IconoCardShared) {
    console.error(
      "[Iconoplasm] shared card runtime missing: load generated/shared-card-runtime.js first",
    )
    return
  }
  if (!IconoContentMatcher) {
    console.error("[Iconoplasm] content matcher missing: load content-matcher.js first")
    return
  }
  if (!IconoHighlightRuntime || typeof IconoHighlightRuntime.createHighlightRuntime !== "function") {
    console.error("[Iconoplasm] highlight runtime missing: load highlight-runtime.js first")
    return
  }

  // -- Placeholder color for genes without color data ----------------
  const PLACEHOLDER_COLOR = "#6B6B78"
  const HIGHLIGHT_MODE_KEY = "iconoplasm_highlight_mode"
  const TOOLTIP_THEME_KEY = "iconoplasm_tooltip_theme"
  const CARD_VARIANT_KEY = "iconoplasm_card_variant"
  const GUEST_DISCOVERIES_STORAGE_KEY = "iconoplasm_guest_discoveries_v1"
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
  const LIT_ARCHIVAL_OPEN_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_OPEN"
  const LIT_ARCHIVAL_AUTH_REQUIRED_MESSAGE = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"
  const DEFAULT_PORTRAIT_DIMENSIONS = Object.freeze({ width: 768, height: 1024 })
  const DISCOVERY_HOVER_DWELL_MS = 900
  const DISCOVERY_SYMBOL_COOLDOWN_MS = 30 * 1000
  const DISCOVERY_AUTH_CACHE_TTL_MS = 5 * 60 * 1000
  const GUEST_DISCOVERY_SYMBOL_MAX = 2000
  const GENE_DETAIL_VISIBLE_LIMIT = 16
  const PORTRAIT_VISIBLE_LIMIT = 8
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
    "portrait",
  ])
  const escapeHtml = IconoCardShared.escapeHtml

  function extensionApiFetch(input, init = {}) {
    const url = typeof input === "string" ? input : String((input && input.url) || "")
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "ICONOPLASM_API_FETCH",
            url,
            method: String(init.method || "GET").toUpperCase(),
            headers: init.headers && typeof init.headers === "object" ? init.headers : {},
            body: typeof init.body === "string" ? init.body : undefined,
            credentials: init.credentials === "include" ? "include" : "same-origin",
          },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message || "Extension API fetch failed"))
              return
            }
            if (!result || typeof result !== "object") {
              reject(new Error("Extension API fetch returned no response"))
              return
            }
            const payload = result && typeof result === "object" ? result : {}
            const rawText = String(payload.text || "")
            resolve({
              ok: Boolean(payload.ok),
              status: Number(payload.status || 0),
              text: () => Promise.resolve(rawText),
              json: () => Promise.resolve(rawText ? JSON.parse(rawText) : null),
            })
          },
        )
      } catch (err) {
        reject(err)
      }
    })
  }

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
    return relativeLuminance + Math.pow(APCA_BLACK_THRESHOLD - relativeLuminance, APCA_BLACK_CLAMP_EXP)
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

  function normalizeTooltipTheme(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase() === "dark"
      ? "dark"
      : "light"
  }

  function normalizeCardVariant(raw) {
    return IconoCardShared.normalizeCardVariant(raw)
  }

  async function loadHighlightMode() {
    try {
      const result = await chrome.storage.local.get([HIGHLIGHT_MODE_KEY])
      highlightMode = highlightRuntime.setMode(result[HIGHLIGHT_MODE_KEY])
    } catch (_) {
      highlightMode = highlightRuntime.setMode("underline")
    }
  }

  async function loadTooltipTheme() {
    try {
      const result = await chrome.storage.local.get([TOOLTIP_THEME_KEY])
      tooltipTheme = normalizeTooltipTheme(result[TOOLTIP_THEME_KEY])
    } catch (_) {
      tooltipTheme = "light"
    }
  }

  async function loadCardVariant() {
    try {
      const result = await chrome.storage.local.get([CARD_VARIANT_KEY])
      cardVariant = normalizeCardVariant(result[CARD_VARIANT_KEY])
    } catch (_) {
      cardVariant = "simple"
    }
  }

  function isArchivalCardVariant() {
    return cardVariant === "lit-archival"
  }

  function isImageOnlyCardVariant() {
    return cardVariant === "image-only"
  }

  function isFirefoxExtensionRuntime() {
    return /Firefox\//i.test(String((navigator && navigator.userAgent) || ""))
  }

  // Fence: only Lit-owned variants go through the iframe. The simple tooltip stays native DOM so
  // fast hover metadata does not pay an iframe/runtime tax, while the printed layouts remain
  // isolated from arbitrary page CSS.
  function usesTooltipFrameRenderer() {
    if (isFirefoxExtensionRuntime()) return false
    return cardVariant === "lit-archival" || cardVariant === "image-only"
  }

  function applyTooltipTheme() {
    if (!tooltip) return
    tooltip.classList.toggle("iconoplasm-tooltip--dark", tooltipTheme === "dark")
    tooltip.classList.toggle("iconoplasm-tooltip--light", tooltipTheme !== "dark")
    tooltip.classList.toggle("iconoplasm-tooltip--variant-lab-label", isArchivalCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--variant-image-only", isImageOnlyCardVariant())
    tooltip.classList.toggle("iconoplasm-tooltip--frame-card", usesTooltipFrameRenderer())
  }

  function buildVoteIconSvg(kind) {
    const svgNs = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(svgNs, "svg")
    svg.setAttribute("viewBox", "0 0 20 20")
    svg.setAttribute("fill", "none")
    svg.setAttribute("aria-hidden", "true")

    const path = document.createElementNS(svgNs, "path")
    if (kind === "approve") {
      path.setAttribute("d", "M5 10.5 8.25 13.75 15 7")
      path.setAttribute("stroke-linejoin", "round")
    } else {
      path.setAttribute("d", "M6 6 14 14M14 6 6 14")
    }
    path.setAttribute("stroke", "currentColor")
    path.setAttribute("stroke-width", "2")
    path.setAttribute("stroke-linecap", "round")
    svg.appendChild(path)
    return svg
  }

  function createVoteBoxNode() {
    const box = document.createElement("div")
    box.className = "icono-vote-box icono-vote-box--brick"
    box.setAttribute("data-icono-vote-box", "")

    const approve = document.createElement("button")
    approve.type = "button"
    approve.className = "icono-vote-btn icono-vote-btn--approve"
    approve.setAttribute("data-icono-vote-up", "")
    approve.setAttribute("aria-label", "Approve portrait")
    approve.title = "Approve portrait"
    approve.appendChild(buildVoteIconSvg("approve"))

    const reject = document.createElement("button")
    reject.type = "button"
    reject.className = "icono-vote-btn icono-vote-btn--reject"
    reject.setAttribute("data-icono-vote-down", "")
    reject.setAttribute("aria-label", "Reject portrait")
    reject.title = "Reject portrait"
    reject.appendChild(buildVoteIconSvg("reject"))

    box.append(approve, reject)
    return box
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
      voteSlot.appendChild(createVoteBoxNode())
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
    return { portraitImg, portraitFallback, portraitStatus, portraitSymbol, fade }
  }

  // -- Disambiguation blocklist --------------------------------------
  // Defaults live in blocklist-defaults.js (shared with popup.js).
  // Users can remove defaults via the popup; those removals are stored
  // in chrome.storage under REMOVED_DEFAULTS_KEY. Extra user-added
  // entries live under USER_BLOCKLIST_KEY. The effective blocklist at
  // runtime = (defaults - removed) + user-added.
  const REMOVED_DEFAULTS_KEY = "iconoplasm_removed_defaults"

  // prettier-ignore
  const SKIP_TAGS = new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","SELECT","CODE","PRE","NOSCRIPT","IFRAME","SVG","MATH","HEAD","TITLE","META","LINK"])

  // -- State ---------------------------------------------------------
  let geneMap = null // { SYMBOL: { c?, n?, u?, a?, pt?, ph? } }
  let geneMatcher = null
  let tooltip = null
  let authToast = null
  let portraitBaseUrl = ""
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
  const portraitDataUrlCache = new Map()
  const portraitDataUrlPromiseCache = new Map()
  const portraitWarmQueue = []
  const queuedPortraitSrcs = new Set()
  let portraitWarmScheduled = false
  let portraitWarmDraining = false
  const geneDetailCache = new Map() // symbol -> gene payload or null
  const geneDetailPromiseCache = new Map() // symbol -> Promise<payload|null>
  const geneDetailWarmQueue = []
  const queuedGeneDetailSymbols = new Set()
  let geneDetailWarmScheduled = false
  let geneDetailWarmDraining = false
  let viewportWarmFrame = 0
  let visibilityScheduler = null
  const mutationScanRoots = new Set()
  let mutationScanScheduled = false
  let highlightMode = highlightRuntime.getMode()
  let tooltipTheme = "light"
  let cardVariant = "simple"
  let activeGeneSummary = null
  let litArchivalFrameRequestSerial = 0
  const warnedMissingTraitOrigins = new Set()
  // Fence: keep background detail batches small. Large batches made the hovered gene wait behind
  // bulk prewarm work, which is why "simple text loads seconds later" showed up in practice.
  const GENE_DETAIL_WARM_BATCH_SIZE = 8
  const PORTRAIT_WARM_BATCH_SIZE = 6
  const GENE_DETAIL_VIEWPORT_ABOVE_PX = 160
  const GENE_DETAIL_VIEWPORT_BELOW_PX = 960

  function buildGenePageUrl(symbol) {
    return "https://iconoplasm.brinedew.bio/gene/" + encodeURIComponent(symbol)
  }

  function openGenePage(symbol) {
    if (!symbol || !geneMap || !geneMap[symbol]) return
    window.open(buildGenePageUrl(symbol), "_blank", "noopener")
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
      const mergedSymbols = normalizeDiscoverySymbolList((payload && payload.discovered_symbols) || pendingSymbols)
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

  function resolvePortraitUrl(gene) {
    const key = gene.pt || gene.ph
    if (!key) return ""
    if (/^https?:\/\//i.test(key)) return key
    const normalizedKey = key.replace(/^\/+/, "")
    if (key.startsWith("/") || normalizedKey.startsWith("portraits/")) {
      return "https://iconoplasm.brinedew.bio/" + normalizedKey
    }
    if (portraitBaseUrl) {
      return portraitBaseUrl.replace(/\/+$/, "") + "/" + normalizedKey
    }
    return "https://iconoplasm.brinedew.bio/" + normalizedKey
  }

  function deferPortraitWarm(task) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => task(), { timeout: 800 })
      return
    }
    window.setTimeout(task, 80)
  }

  function deferGeneDetailWarm(task) {
    window.setTimeout(task, 0)
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
  }

  function shouldIgnoreMutationNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return true
    const el = /** @type {Element} */ (node)
    if (el.classList && el.classList.contains("iconoplasm-tooltip")) return true
    if (el.closest && el.closest(".iconoplasm-tooltip")) return true
    if (el.classList && el.classList.contains("iconoplasm-gene")) return true
    if (el.closest && el.closest(".iconoplasm-gene")) return true
    if (SKIP_TAGS.has(el.tagName)) return true
    return false
  }

  function scheduleMutationScan() {
    if (mutationScanScheduled) return
    mutationScanScheduled = true
    window.setTimeout(() => {
      mutationScanScheduled = false
      if (!mutationScanRoots.size) return

      const roots = Array.from(mutationScanRoots)
      mutationScanRoots.clear()
      let didWrapGenes = false
      for (const root of roots) {
        if (scanPage(root) > 0) {
          didWrapGenes = true
        }
      }
      if (didWrapGenes) {
        scheduleHighlightGeometryRefresh()
        scheduleWarmVisiblePortraits()
        scheduleWarmVisibleGeneDetails()
      }
    }, 0)
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
    const seen = new Set()
    let added = false
    for (const rawUrl of Array.isArray(urls) ? urls : []) {
      const url = String(rawUrl || "").trim()
      if (!url || seen.has(url)) continue
      if (
        portraitDataUrlCache.has(url) ||
        portraitDataUrlPromiseCache.has(url) ||
        queuedPortraitSrcs.has(url)
      )
        continue
      seen.add(url)
      queuedPortraitSrcs.add(url)
      portraitWarmQueue.push(url)
      added = true
    }
    if (added) {
      drainPortraitWarmQueue().catch(() => null)
    }
  }

  async function drainPortraitWarmQueue() {
    if (portraitWarmDraining) return
    portraitWarmDraining = true
    try {
      while (portraitWarmQueue.length) {
        const batch = portraitWarmQueue.splice(0, PORTRAIT_WARM_BATCH_SIZE)
        for (const url of batch) queuedPortraitSrcs.delete(url)
        const usableSources = await Promise.all(
          batch.map((url) => getUsablePortraitSrc(url).catch(() => "")),
        )
        prewarmLitArchivalFramePortraitSrcs(usableSources)
        if (portraitWarmQueue.length) {
          await delay(20)
        }
      }
    } finally {
      portraitWarmDraining = false
    }
  }

  function scheduleWarmVisiblePortraits(limit = PORTRAIT_VISIBLE_LIMIT) {
    if (portraitWarmScheduled) return
    portraitWarmScheduled = true
    deferPortraitWarm(() => {
      portraitWarmScheduled = false
      if (!geneMap) return
      const urls = []
      const seenSymbols = new Set()
      const sourceSymbols =
        visibilityScheduler && visibilityScheduler.hasVisibleSymbols()
          ? collectObservedVisibleGeneSymbols(limit)
          : collectVisibleGeneSymbols(limit)
      for (const symbol of sourceSymbols) {
        if (!symbol || seenSymbols.has(symbol)) continue
        seenSymbols.add(symbol)
        const gene = geneMap[symbol]
        const portraitSrc = resolvePortraitUrl(gene)
        if (!portraitSrc) continue
        urls.push(portraitSrc)
        if (urls.length >= limit) break
      }
      warmPortraitUrls(urls)
    })
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
        scheduleWarmVisiblePortraits()
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
    if (targetIndex === -1) {
      const targetSymbol = targetEl.dataset ? targetEl.dataset.gene : ""
      return targetSymbol ? [targetSymbol] : []
    }

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

    pushSymbol(targetEl.dataset ? targetEl.dataset.gene : "")

    let left = targetIndex - 1
    let right = targetIndex + 1
    while (symbols.length < limit && (left >= 0 || right < genes.length)) {
      if (right < genes.length) {
        pushSymbol(genes[right].dataset ? genes[right].dataset.gene : "")
        right += 1
        if (symbols.length >= limit) break
      }
      if (left >= 0) {
        pushSymbol(genes[left].dataset ? genes[left].dataset.gene : "")
        left -= 1
      }
    }
    return symbols
  }

  function collectNeighborPortraitUrls(targetEl, limit = GENE_DETAIL_WARM_BATCH_SIZE) {
    if (!geneMap) return []
    const symbols = collectNeighborGeneSymbols(targetEl, limit)
    const urls = []
    const seenUrls = new Set()
    for (const symbol of symbols) {
      const gene = geneMap[symbol]
      const portraitSrc = resolvePortraitUrl(gene)
      if (!portraitSrc || seenUrls.has(portraitSrc)) continue
      seenUrls.add(portraitSrc)
      urls.push(portraitSrc)
    }
    return urls
  }

  async function fetchGeneDetailsBatch(symbols) {
    const uniqueSymbols = []
    const seenSymbols = new Set()
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seenSymbols.has(symbol)) continue
      seenSymbols.add(symbol)
      uniqueSymbols.push(symbol)
    }

    const unresolvedSymbols = uniqueSymbols.filter(
      (symbol) => !geneDetailCache.has(symbol) && !geneDetailPromiseCache.has(symbol),
    )

    if (unresolvedSymbols.length) {
      const batchRequest = (async () => {
        try {
          const resp = await extensionApiFetch(ICONOPLASM_GENE_BATCH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbols: unresolvedSymbols,
              fields: GENE_DETAIL_BATCH_FIELDS,
            }),
          })
          if (!resp.ok) {
            throw new Error("HTTP " + String(resp.status || 0))
          }
          const payload = (await resp.json()) || {}
          const genes = Array.isArray(payload.genes) ? payload.genes : []
          const resolvedMap = new Map()
          for (const record of genes) {
            const symbol = String((record && record.symbol) || "")
              .trim()
              .toUpperCase()
            if (!symbol) continue
            const safeRecord = record && typeof record === "object" ? record : null
            geneDetailCache.set(symbol, safeRecord)
            resolvedMap.set(symbol, safeRecord)
          }
          const missingSymbols = Array.isArray(payload.missing) ? payload.missing : []
          for (const rawMissing of missingSymbols) {
            const symbol = String(rawMissing || "")
              .trim()
              .toUpperCase()
            if (!symbol) continue
            geneDetailCache.set(symbol, null)
            resolvedMap.set(symbol, null)
          }
          for (const symbol of unresolvedSymbols) {
            if (!resolvedMap.has(symbol)) {
              geneDetailCache.set(symbol, null)
            }
          }
        } catch (err) {
          console.error("[Iconoplasm] extension gene detail batch fetch error:", err)
          for (const symbol of unresolvedSymbols) {
            geneDetailCache.set(symbol, null)
          }
        } finally {
          for (const symbol of unresolvedSymbols) {
            geneDetailPromiseCache.delete(symbol)
          }
        }
      })()

      for (const symbol of unresolvedSymbols) {
        geneDetailPromiseCache.set(
          symbol,
          batchRequest.then(() => geneDetailCache.get(symbol) || null),
        )
      }
    }

    const entries = await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        if (geneDetailCache.has(symbol)) return [symbol, geneDetailCache.get(symbol) || null]
        if (geneDetailPromiseCache.has(symbol)) {
          return [symbol, await geneDetailPromiseCache.get(symbol)]
        }
        return [symbol, null]
      }),
    )
    return new Map(entries)
  }

  async function drainGeneDetailWarmQueue() {
    if (geneDetailWarmDraining) return
    geneDetailWarmDraining = true
    try {
      while (geneDetailWarmQueue.length) {
        const batch = geneDetailWarmQueue.splice(0, GENE_DETAIL_WARM_BATCH_SIZE)
        for (const symbol of batch) queuedGeneDetailSymbols.delete(symbol)
        await fetchGeneDetailsBatch(batch)
        if (geneDetailWarmQueue.length) {
          await delay(20)
        }
      }
    } finally {
      geneDetailWarmDraining = false
      if (geneDetailWarmQueue.length) {
        scheduleWarmVisibleGeneDetails()
      }
    }
  }

  function warmGeneDetails(symbols, limit = GENE_DETAIL_VISIBLE_LIMIT) {
    const uniqueSymbols = []
    const seen = new Set()
    for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      if (
        geneDetailCache.has(symbol) ||
        geneDetailPromiseCache.has(symbol) ||
        queuedGeneDetailSymbols.has(symbol)
      )
        continue
      seen.add(symbol)
      uniqueSymbols.push(symbol)
      if (uniqueSymbols.length >= limit) break
    }
    for (const symbol of uniqueSymbols) {
      queuedGeneDetailSymbols.add(symbol)
      geneDetailWarmQueue.push(symbol)
    }
    if (uniqueSymbols.length) {
      drainGeneDetailWarmQueue().catch(() => null)
    }
  }

  function scheduleWarmVisibleGeneDetails(limit = GENE_DETAIL_VISIBLE_LIMIT) {
    if (geneDetailWarmScheduled) return
    geneDetailWarmScheduled = true
    deferGeneDetailWarm(() => {
      geneDetailWarmScheduled = false
      const sourceSymbols =
        visibilityScheduler && visibilityScheduler.hasVisibleSymbols()
          ? collectObservedVisibleGeneSymbols(limit)
          : collectVisibleGeneSymbols(limit)
      warmGeneDetails(sourceSymbols, limit)
    })
  }

  function scheduleViewportWarm() {
    if (viewportWarmFrame) return
    viewportWarmFrame = window.requestAnimationFrame(() => {
      viewportWarmFrame = 0
      scheduleWarmVisiblePortraits()
      scheduleWarmVisibleGeneDetails()
    })
  }

  async function getUsablePortraitSrc(portraitSrc) {
    if (!portraitSrc) return ""
    if (portraitDataUrlCache.has(portraitSrc)) {
      return portraitDataUrlCache.get(portraitSrc)
    }
    if (portraitDataUrlPromiseCache.has(portraitSrc)) {
      return portraitDataUrlPromiseCache.get(portraitSrc)
    }

    const request = (async () => {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "GET_PORTRAIT_DATA_URL", url: portraitSrc },
            (result) => {
              if (chrome.runtime.lastError) {
                resolve(null)
                return
              }
              resolve(result)
            },
          )
        })

        const dataUrl = response && response.ok && response.dataUrl ? response.dataUrl : ""
        if (dataUrl) {
          portraitDataUrlCache.set(portraitSrc, dataUrl)
          return dataUrl
        }
      } catch (_) {
        // Fall back to the direct site URL below.
      } finally {
        portraitDataUrlPromiseCache.delete(portraitSrc)
      }

      return portraitSrc
    })()
    portraitDataUrlPromiseCache.set(portraitSrc, request)
    return request
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
    if (usableSrc.startsWith("data:")) {
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        usableSrc,
        symbol + " portrait",
      )
      return
    }

    const img = new Image()
    img.onload = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      applyPortraitImage(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        usableSrc,
        symbol + " portrait",
      )
    }
    img.onerror = () => {
      if (loadToken !== portraitLoadToken || activeSymbol !== symbol) return
      setPortraitFallback(
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        "Portrait unavailable",
      )
    }
    img.src = usableSrc
  }

  // -- Font injection ------------------------------------------------
  // Content scripts can't use relative URLs in CSS @font-face, so we
  // inject a <style> element with chrome.runtime.getURL paths.
  // The Paper-derived Iconoplasm label fonts are now self-hosted directly by
  // generated/shared-card-label.css using shared relative paths; keep this
  // injector limited to the extension's non-label baseline fonts so we don't
  // reintroduce per-surface font drift.
  function injectFonts() {
    const crimsonUrl = chrome.runtime.getURL("fonts/CrimsonPro-Variable.woff2")
    const xenonUrl = chrome.runtime.getURL("fonts/MonaspaceXenon-Var.woff2")
    const style = document.createElement("style")
    style.textContent = `
      @font-face {
        font-family: 'Crimson Pro';
        src: url('${crimsonUrl}') format('woff2');
        font-weight: 300 900;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: 'Monaspace Xenon Web';
        src: url('${xenonUrl}') format('woff2');
        font-weight: 200 800;
        font-style: normal;
        font-display: swap;
      }
    `
    document.head.appendChild(style)
  }

  // -- Init ----------------------------------------------------------
  async function init() {
    // Don't run on the Iconoplasm site itself -- it already shows gene
    // colors natively, and the extension just adds redundant underlines.
    if (window.location.hostname === "iconoplasm.brinedew.bio") return

    await Promise.all([
      loadHighlightMode(),
      loadTooltipTheme(),
      loadCardVariant(),
      loadGuestDiscoverySymbols(),
    ])

    // Effective blocklist = (defaults - user-removed) + user-added extras.
    // Both lists live in chrome.storage; defaults come from blocklist-defaults.js.
    const blocklistStorage = await new Promise((resolve) => {
      chrome.storage.local.get(["iconoplasm_user_blocklist", REMOVED_DEFAULTS_KEY], (result) => {
        resolve(result)
      })
    })
    const userBlocklistRaw = Array.isArray(blocklistStorage.iconoplasm_user_blocklist)
      ? blocklistStorage.iconoplasm_user_blocklist : []
    const removedDefaults = new Set(
      Array.isArray(blocklistStorage[REMOVED_DEFAULTS_KEY])
        ? blocklistStorage[REMOVED_DEFAULTS_KEY] : []
    )
    const effectiveBlocklist = new Set()
    for (const sym of ICONOPLASM_DEFAULT_BLOCKLIST) {
      if (!removedDefaults.has(sym)) effectiveBlocklist.add(sym)
    }
    for (const sym of userBlocklistRaw) {
      effectiveBlocklist.add(String(sym).toUpperCase())
    }

    const payload = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_GENE_DATA" }, resolve)
    })

    // Backward compatibility:
    // - old worker returned raw map
    // - new worker returns { genes, portraitBaseUrl }
    if (payload && payload.genes && typeof payload.genes === "object") {
      geneMap = payload.genes
      portraitBaseUrl = payload.portraitBaseUrl || ""
    } else {
      geneMap = payload
      portraitBaseUrl = ""
    }
    // Fence: candidate generation now lives in a dedicated matcher module. Keep content.js acting
    // as the page adapter that applies matches, not the place where lexical rules accrete forever.
    geneMatcher = IconoContentMatcher.createGeneMatcher(geneMap, { blocklist: effectiveBlocklist })

    if (!geneMap || Object.keys(geneMap).length === 0) {
      console.log("[Iconoplasm] No gene data yet. Retrying in 5s.")
      setTimeout(init, 5000)
      return
    }

    console.log("[Iconoplasm] Loaded", Object.keys(geneMap).length, "genes. Scanning...")
    injectFonts()
    createTooltip()
    createAuthToast()
    scanPage(document.body)
    refreshHighlightStyles()
    scheduleDiscoveryBufferFlush()
    scheduleWarmVisibleGeneDetails()
    scheduleWarmVisiblePortraits()
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
  }

  // -- DOM scanning --------------------------------------------------
  function scanPage(root) {
    if (!root || typeof root.nodeType !== "number") return 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        if (parent.closest && parent.closest(".iconoplasm-tooltip")) return NodeFilter.FILTER_REJECT
        if (parent.classList && parent.classList.contains("iconoplasm-gene"))
          return NodeFilter.FILTER_REJECT
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })

    const textNodes = []
    while (walker.nextNode()) textNodes.push(walker.currentNode)
    let wrappedCount = 0
    for (const textNode of textNodes) {
      wrappedCount += processTextNode(textNode)
    }
    return wrappedCount
  }

  function processTextNode(textNode) {
    const text = textNode.textContent
    if (!text || !geneMatcher) return 0

    const matches = geneMatcher.findMatches(text)

    if (matches.length === 0) return 0

    const frag = document.createDocumentFragment()
    let cursor = 0

    for (const m of matches) {
      if (m.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, m.index)))
      }
      const span = document.createElement("span")
      span.className = "iconoplasm-gene"
      span.dataset.geneLabel = text.slice(m.index, m.index + m.length)
      const copy = document.createElement("span")
      copy.className = "iconoplasm-gene-copy"
      copy.setAttribute("data-icono-rough-copy", "true")
      copy.textContent = span.dataset.geneLabel
      span.appendChild(copy)

      const gene = geneMap[m.symbol]
      const color = gene.c || PLACEHOLDER_COLOR
      applyHighlightStyle(span, m.symbol, color)
      observeGeneElement(span)
      frag.appendChild(span)
      cursor = m.index + m.length
    }

    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)))
    }

    textNode.parentNode.replaceChild(frag, textNode)
    return matches.length
  }

  // -- Mutation observer ---------------------------------------------
  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (shouldIgnoreMutationNode(node)) continue
          mutationScanRoots.add(node)
        }
      }
      scheduleMutationScan()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  // -- Tooltip -------------------------------------------------------
  function createTooltip() {
    tooltip = document.createElement("div")
    tooltip.className = "iconoplasm-tooltip"
    tooltip.setAttribute("role", "tooltip")
    const portrait = document.createElement("div")
    portrait.className = "iconoplasm-tooltip-portrait"
    const body = document.createElement("div")
    body.className = "iconoplasm-tooltip-body"
    tooltip.append(portrait, body)
    document.body.appendChild(tooltip)
    applyTooltipTheme()

    document.addEventListener("mouseover", onMouseOver)
    document.addEventListener("mouseout", onMouseOut)
    window.addEventListener("message", onLitArchivalFrameMessage)
    tooltip.addEventListener("click", onTooltipClick)
    tooltip.addEventListener("keydown", onTooltipKeyDown)
    tooltip.addEventListener("mouseenter", cancelHideTimer)
    tooltip.addEventListener("mouseleave", onTooltipMouseLeave)
    tooltip.tabIndex = 0
  }

  function createAuthToast() {
    authToast = document.createElement("div")
    authToast.className = "iconoplasm-auth-toast"
    authToast.setAttribute("role", "status")
    authToast.setAttribute("aria-live", "polite")
    document.body.appendChild(authToast)
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return
    if (changes[HIGHLIGHT_MODE_KEY]) {
      highlightMode = highlightRuntime.setMode(changes[HIGHLIGHT_MODE_KEY].newValue)
      refreshHighlightStyles()
    }
    if (changes[TOOLTIP_THEME_KEY]) {
      tooltipTheme = normalizeTooltipTheme(changes[TOOLTIP_THEME_KEY].newValue)
      applyTooltipTheme()
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
  })

  function archivalTooltipGeneModel(summaryGene, geneDetail) {
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    return detail || {
      symbol: summary.symbol || activeSymbol || "",
      full_name: summary.n || summary.symbol || activeSymbol || "",
      color: summary.c || PLACEHOLDER_COLOR,
      essence: {},
    }
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
      String(portraitSrcOverride || "").trim() || buildTooltipFramePortraitSrc(summaryGene, geneDetail)
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

  function buildTooltipFramePortraitSrc(summaryGene, geneDetail) {
    const detailPortrait = geneDetail && geneDetail.portrait ? geneDetail.portrait : null
    const detailUrl = String(
      (detailPortrait && (detailPortrait.medium_url || detailPortrait.hero_url || detailPortrait.thumb_url)) ||
        "",
    ).trim()
    if (detailUrl) return detailUrl
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    return resolvePortraitUrl(summary)
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
    if (isImageOnlyCardVariant()) return null
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || activeSymbol || "")
      .trim()
      .toUpperCase()
    const portrait = (detail || {}).portrait || {}
    const assetSha = String(portrait.asset_sha256 || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return null
    return {
      symbol,
      assetSha,
      visionId: String(portrait.vision_id || "").trim(),
      candidateImageId: Number(portrait.candidate_image_id || 0),
      apiBaseUrl: ICONOPLASM_API_BASE,
    }
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
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") {
      iframe.__iconoPendingPayload = payload
      return
    }
    try {
      iframe.contentWindow.postMessage(payload, LIT_ARCHIVAL_FRAME_ORIGIN)
    } catch (err) {
      console.error("[Iconoplasm] failed to post archival frame payload:", err)
    }
  }

  function prewarmLitArchivalFramePortraitSrcs(sources) {
    if (!tooltip || !usesTooltipFrameRenderer()) return
    const iframe = tooltip.querySelector(".iconoplasm-tooltip-lit-frame")
    if (!iframe || !iframe.isConnected || !iframe.contentWindow) return
    if (!iframe.dataset || iframe.dataset.iconoFrameReady !== "true") return
    const usableSources = Array.from(
      new Set(
        (Array.isArray(sources) ? sources : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    )
    if (!usableSources.length) return
    try {
      iframe.contentWindow.postMessage(
        {
          type: LIT_ARCHIVAL_PREWARM_MESSAGE,
          sources: usableSources,
        },
        LIT_ARCHIVAL_FRAME_ORIGIN,
      )
    } catch (err) {
      console.error("[Iconoplasm] failed to prewarm archival frame portraits:", err)
    }
  }

  function mountLitArchivalTooltipFrame(body, summaryGene, geneDetail) {
    const iframe = body.querySelector(".iconoplasm-tooltip-lit-frame")
    if (!iframe) return
    const summary = summaryGene && typeof summaryGene === "object" ? summaryGene : {}
    const detail = geneDetail && typeof geneDetail === "object" ? geneDetail : null
    const symbol = String((detail && detail.symbol) || summary.symbol || activeSymbol || "")
      .trim()
      .toUpperCase()
    const directPortraitSrc = buildTooltipFramePortraitSrc(summaryGene, geneDetail)
    const warmedPortraitSrc = directPortraitSrc ? portraitDataUrlCache.get(directPortraitSrc) || "" : ""
    const payload = {
      type: LIT_ARCHIVAL_RENDER_MESSAGE,
      requestId: String(++litArchivalFrameRequestSerial),
      theme: tooltipTheme,
      cardVariant,
      symbol,
      pageUrl: symbol ? buildGenePageUrl(symbol) : "",
      loading: !detail,
      gene: detail || archivalTooltipGeneModel(summaryGene, null),
      portraitSrc: warmedPortraitSrc || directPortraitSrc,
      portraitDimensions: buildTooltipFramePortraitDimensions(summaryGene, geneDetail),
      model: buildLitTooltipCardModel(summaryGene, geneDetail, warmedPortraitSrc || directPortraitSrc),
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
    if (!tooltip || !geneDetail) return
    const box = tooltip.querySelector("[data-icono-vote-box]")
    if (!box) return
    const symbol = String((geneDetail && geneDetail.symbol) || activeSymbol || "")
      .trim()
      .toUpperCase()
    const portrait = (geneDetail || {}).portrait || {}
    const assetSha = String(portrait.asset_sha256 || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return
    IconoCardShared.wireVoteBox(box, {
      symbol,
      assetSha,
      visionId: String(portrait.vision_id || "").trim(),
      candidateImageId: Number(portrait.candidate_image_id || 0),
      apiBaseUrl: ICONOPLASM_API_BASE,
      fetchImpl: extensionApiFetch,
      deferSnapshot: true,
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
    if (geneDetailPromiseCache.has(normalizedSymbol)) return geneDetailPromiseCache.get(normalizedSymbol)
    const responses = await fetchGeneDetailsBatch([normalizedSymbol])
    return responses.get(normalizedSymbol) || null
  }

  function onTooltipClick(e) {
    if (e && e.target && e.target.closest("[data-icono-vote-box]")) return
    openGenePage(activeSymbol)
  }

  function onTooltipKeyDown(e) {
    if (e.target && e.target.closest("[data-icono-vote-box]")) return
    if (e.key !== "Enter" && e.key !== " ") return
    e.preventDefault()
    openGenePage(activeSymbol)
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
    // Fence: fetch the hovered gene before warming neighbors. Reversing this puts the hovered
    // symbol into the warm queue first, so the visible card waits on background work.
    const hoverGeneDetailPromise = geneDetailCache.has(symbol)
      ? Promise.resolve(geneDetailCache.get(symbol) || null)
      : fetchGeneDetailForTooltip(symbol)
    const neighborSymbols = collectNeighborGeneSymbols(target, GENE_DETAIL_WARM_BATCH_SIZE).filter(
      (neighborSymbol) => neighborSymbol !== symbol,
    )
    warmGeneDetails(neighborSymbols, GENE_DETAIL_WARM_BATCH_SIZE - 1)
    warmPortraitUrls(collectNeighborPortraitUrls(target, GENE_DETAIL_WARM_BATCH_SIZE))

    const color = gene.c || PLACEHOLDER_COLOR
    const usesFrameRenderer = usesTooltipFrameRenderer()

    // Fill tooltip content
    const portrait = tooltip.querySelector(".iconoplasm-tooltip-portrait")
    const portraitRefs = usesFrameRenderer ? null : resetSimpleTooltipPortrait(portrait)
    const portraitImg = portraitRefs ? portraitRefs.portraitImg : null
    const fade = portraitRefs ? portraitRefs.fade : null
    const portraitFallback = portraitRefs ? portraitRefs.portraitFallback : null
    const portraitStatus = portraitRefs ? portraitRefs.portraitStatus : null
    const portraitSymbol = portraitRefs ? portraitRefs.portraitSymbol : null
    if (!usesFrameRenderer) {
      const portraitSrc = resolvePortraitUrl(gene)
      loadTooltipPortrait({
        symbol,
        portrait,
        portraitImg,
        portraitFallback,
        portraitStatus,
        portraitSrc,
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

    let left = rect.left + rect.width / 2 - tooltipWidth / 2
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8))

    const showBelow = rect.top < tooltipHeight + 16

    tooltip.style.left = left + window.scrollX + "px"
    if (showBelow) {
      tooltip.style.top = rect.bottom + window.scrollY + 8 + "px"
    } else {
      tooltip.style.top = rect.top + window.scrollY - tooltipHeight - 8 + "px"
    }

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
    const iframe = tooltip ? tooltip.querySelector(".iconoplasm-tooltip-lit-frame") : null
    if (!iframe || event.source !== iframe.contentWindow) return
    if (data.type === LIT_ARCHIVAL_READY_MESSAGE) {
      iframe.dataset.iconoFrameReady = "true"
      if (iframe.__iconoPendingPayload) {
        const pendingPayload = iframe.__iconoPendingPayload
        iframe.__iconoPendingPayload = null
        postLitArchivalFramePayload(iframe, pendingPayload)
      }
      return
    }
    if (data.type === LIT_ARCHIVAL_OPEN_MESSAGE) {
      openGenePage(String(data.symbol || activeSymbol || "").trim().toUpperCase())
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
    portraitLoadToken += 1
    tooltip.classList.remove("iconoplasm-tooltip-visible")
  }

  // -- Go ------------------------------------------------------------
  init()
})()
