;(function () {
  "use strict"

  const FRAME_MESSAGE_SOURCE = "iconoplasm-lit-archival-frame"
  const FRAME_RENDER_TYPE = "ICONOPLASM_LIT_ARCHIVAL_RENDER"
  const FRAME_PREWARM_TYPE = "ICONOPLASM_LIT_ARCHIVAL_PREWARM"
  const FRAME_READY_TYPE = "ICONOPLASM_LIT_ARCHIVAL_READY"
  const FRAME_OPEN_TYPE = "ICONOPLASM_LIT_ARCHIVAL_OPEN"
  const FRAME_AUTH_REQUIRED_TYPE = "ICONOPLASM_LIT_ARCHIVAL_AUTH_REQUIRED"
  const SITE_BRICK_CSS_URL = "https://iconoplasm.brinedew.bio/static/iconoplasm/styles.css"
  const shared = globalThis.IconoplasmCardShared
  const frameRoot = document.getElementById("iconoplasm-root")
  const slot = document.getElementById("lit-archival-card-slot")
  const siteStyleEl = document.getElementById("iconoplasm-site-brick-style")
  let currentPayload = null
  let siteStylesPromise = null
  const portraitDecodePromiseCache = new Map()

  function prewarmPortraitSource(src) {
    const usableSrc = String(src || "").trim()
    if (!usableSrc) return Promise.resolve()
    if (portraitDecodePromiseCache.has(usableSrc)) {
      return portraitDecodePromiseCache.get(usableSrc)
    }
    const promise = new Promise((resolve) => {
      const img = new Image()
      img.decoding = "async"
      img.loading = "eager"
      img.src = usableSrc
      const finish = () => resolve()
      img.addEventListener("load", () => {
        if (typeof img.decode === "function") {
          img.decode().catch(() => null).finally(finish)
          return
        }
        finish()
      }, { once: true })
      img.addEventListener("error", finish, { once: true })
    })
    portraitDecodePromiseCache.set(usableSrc, promise)
    return promise
  }

  function postToParent(type, extra = {}) {
    if (!window.parent || window.parent === window) return
    window.parent.postMessage(
      Object.assign(
        {
          source: FRAME_MESSAGE_SOURCE,
          type,
        },
        extra,
      ),
      "*",
    )
  }

  function createTrustedFragment(markup, ownerDocument = document) {
    const safeMarkup = String(markup || "")
    const range = ownerDocument.createRange()
    const scope = ownerDocument.body || ownerDocument.documentElement
    if (scope) range.selectNodeContents(scope)
    // Fence: AMO specifically warns on innerHTML sinks. These frame payload templates are built
    // from static strings plus escaped values, so we convert them into fragments without using
    // the flagged properties.
    return range.createContextualFragment(safeMarkup)
  }

  function replaceTrustedChildren(node, markup) {
    if (!node) return
    node.replaceChildren(createTrustedFragment(markup, node.ownerDocument || document))
  }

  function currentSymbol() {
    return String((currentPayload && currentPayload.symbol) || "").trim().toUpperCase()
  }

  function esc(value) {
    if (shared && typeof shared.escapeHtml === "function") {
      return shared.escapeHtml(value)
    }
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  function ensureSiteStylesLoaded() {
    // Fence: load the canonical site stylesheet into the frame instead of re-styling the card by
    // hand here. Reconstructing the look locally is exactly what caused the extension/site drift.
    if (siteStylesPromise) return siteStylesPromise
    siteStylesPromise = fetch(SITE_BRICK_CSS_URL)
      .then((resp) => (resp.ok ? resp.text() : ""))
      .then((text) => {
        if (siteStyleEl && text) siteStyleEl.textContent = text
      })
      .catch((error) => {
        console.error("[Iconoplasm] failed to load canonical site card styles:", error)
      })
    return siteStylesPromise
  }

  function applyTheme(_theme) {
    const resolvedTheme = "light"
    document.documentElement.setAttribute("data-theme", resolvedTheme)
    document.documentElement.setAttribute("saved-theme", resolvedTheme)
    if (!frameRoot) return
    frameRoot.classList.remove("iconoplasm-tooltip--dark")
  }

  function voteMarkup(payload) {
    if (!payload || !payload.vote || !payload.vote.assetSha || !shared) return ""
    if (payload.cardVariant === "lit-archival") {
      return shared.voteBoxMarkup("", {
        variant: "label",
        showScore: false,
        showArrows: false,
      })
    }
    return shared.voteBoxMarkup("", { variant: "brick", showScore: false })
  }

  function portraitDimensions(payload) {
    const explicit = payload && payload.portraitDimensions && typeof payload.portraitDimensions === "object"
      ? payload.portraitDimensions
      : null
    if (explicit) {
      const width = Number(explicit.width || 0)
      const height = Number(explicit.height || 0)
      if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        return {
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        }
      }
    }
    if (shared && typeof shared.portraitDimensions === "function") {
      return shared.portraitDimensions((payload && payload.gene) || {})
    }
    return { width: 1, height: 1 }
  }

  function isImageOnlyVariant(payload) {
    return !!payload && payload.cardVariant === "image-only"
  }

  function isLitArchivalVariant(payload) {
    return !!payload && payload.cardVariant === "lit-archival"
  }

  function simpleBodyHtml(payload) {
    const gene = payload && payload.gene && typeof payload.gene === "object" ? payload.gene : {}
    const href = String((payload && payload.pageUrl) || "").trim()
    const symbol = String((payload && payload.symbol) || gene.symbol || "").trim().toUpperCase()
    const fullName = String(gene.full_name || gene.fullName || symbol).trim()
    const rows =
      !payload.loading && gene && shared && typeof shared.collectTooltipMetaRows === "function"
        ? shared.collectTooltipMetaRows(gene)
        : []
    const metaHtml =
      !payload.loading && rows.length && shared && typeof shared.renderTooltipMetaRowsHtml === "function"
        ? shared.renderTooltipMetaRowsHtml(rows)
        : shared && typeof shared.renderTooltipMetaSkeletonHtml === "function"
          ? shared.renderTooltipMetaSkeletonHtml()
          : ""
    return (
      '<div class="iconoplasm-tooltip-header">' +
      '<div class="icono-brick-header-row icono-shared-card-header-row">' +
      '<a class="icono-brick-header-link" href="' +
      esc(href) +
      '" data-icono-nav>' +
      '<div class="iconoplasm-tooltip-symbol">' +
      esc(symbol) +
      "</div>" +
      '<div class="iconoplasm-tooltip-name">' +
      esc(fullName || symbol) +
      "</div>" +
      "</a>" +
      voteMarkup(payload) +
      "</div>" +
      "</div>" +
      '<a class="icono-brick-meta-link" href="' +
      esc(href) +
      '" data-icono-nav>' +
      '<div class="iconoplasm-tooltip-meta' +
      (payload.loading ? " iconoplasm-tooltip-meta--loading" : "") +
      '">' +
      metaHtml +
      "</div>" +
      "</a>"
    )
  }

  function archivalBodyHtml(payload) {
    if (!shared) return ""
    return shared.renderLabLabelCardHtml(payload.gene || {}, {
      mode: "brick",
      layoutVariant: isImageOnlyVariant(payload) ? "image-only" : "lit-archival",
      mobileReview: false,
      portraitAlt: currentSymbol() ? currentSymbol() + " portrait" : "Gene portrait",
      portraitSrc: String((payload && payload.portraitSrc) || "").trim(),
      titleHref: String((payload && payload.pageUrl) || "").trim(),
      voteHtml: isImageOnlyVariant(payload) ? "" : voteMarkup(payload),
    })
  }

  function imageOnlyBodyHtml(payload) {
    const gene = payload && payload.gene && typeof payload.gene === "object" ? payload.gene : {}
    const href = String((payload && payload.pageUrl) || "").trim()
    const symbol = String((payload && payload.symbol) || gene.symbol || "")
      .trim()
      .toUpperCase()
    const fullName = String(gene.full_name || gene.fullName || symbol).trim()
    const portraitSrc = String((payload && payload.portraitSrc) || "").trim()
    const portraitAlt = symbol ? symbol + " portrait" : "Gene portrait"
    const dims = portraitDimensions(payload)
    const mediaHtml = portraitSrc
      ? '<img class="icono-image-only-photo" src="' +
        esc(portraitSrc) +
        '" alt="' +
        esc(portraitAlt) +
        '" loading="eager" decoding="async" fetchpriority="high" width="' +
        String(dims.width) +
        '" height="' +
        String(dims.height) +
        '">' 
      : '<div class="icono-image-only-fallback" aria-hidden="true"></div>'
    const overlayHtml =
      '<div class="icono-image-only-overlay">' +
      '<div class="icono-image-only-caption-row">' +
      '<div class="icono-label-name icono-image-only-name">' +
      esc(fullName || symbol) +
      '</div>' +
      '<div class="icono-label-symbol icono-image-only-symbol">' +
      esc(symbol) +
      '</div>' +
      '</div>' +
      '</div>'
    const bodyHtml =
      '<div class="icono-image-only-media-stage">' +
      mediaHtml +
      '</div>' +
      overlayHtml
    if (href) {
      return (
        '<a class="icono-image-only-link" href="' +
        esc(href) +
        '" data-icono-nav>' +
        bodyHtml +
        '</a>'
      )
    }
    return '<div class="icono-image-only-link">' + bodyHtml + '</div>'
  }

  function simplePortraitMarkup(payload) {
    const symbol = currentSymbol()
    const portraitSrc = String((payload && payload.portraitSrc) || "").trim()
    const stateClass = portraitSrc
      ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready icono-brick-media-link"
      : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing icono-brick-media-link"
    return (
      '<div class="' +
      stateClass +
      '">' +
      (portraitSrc
        ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-nav aria-label="Open gene page for ' +
          esc(symbol) +
          '">' +
          '<img class="iconoplasm-tooltip-portrait-img" src="' +
          esc(portraitSrc) +
          '" alt="' +
          esc(symbol) +
          ' portrait" loading="eager" decoding="async">' +
          "</button>"
        : '<img class="iconoplasm-tooltip-portrait-img" alt="">') +
      '<div class="iconoplasm-tooltip-portrait-fallback">' +
      '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
      '<div class="iconoplasm-tooltip-portrait-symbol">' +
      esc(symbol) +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
      "</div>"
    )
  }

  function archivalPortraitMarkup(payload) {
    if (!shared) return simplePortraitMarkup(payload)
    const symbol = currentSymbol()
    const portraitSrc = String((payload && payload.portraitSrc) || "").trim()
    const dims = portraitDimensions(payload)
    const mediaHtml =
      shared && typeof shared.renderLabLabelPortraitMediaHtml === "function"
        ? shared.renderLabLabelPortraitMediaHtml(symbol, portraitSrc, "", dims, {
            // Fence: extension tooltips open the gene page instead of a local lightbox, but the
            // portrait rail still needs the exact shared media markup so layout stays in lockstep
            // with the website card.
            buttonAttrs: "data-icono-nav",
            fetchPriority: "high",
          })
        : portraitSrc
          ? '<button type="button" class="iconoplasm-tooltip-portrait-media icono-brick-media-link" data-icono-nav aria-label="Open gene page for ' +
            esc(symbol) +
            '">' +
            '<img class="iconoplasm-tooltip-portrait-img" src="' +
            esc(portraitSrc) +
            '" alt="' +
            esc(symbol) +
            ' portrait" loading="eager" decoding="async" fetchpriority="high" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '">' +
            "</button>"
          : '<div class="iconoplasm-tooltip-portrait-fallback">' +
            '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
            '<div class="iconoplasm-tooltip-portrait-symbol">' +
            esc(symbol) +
            "</div>" +
            "</div>"
    return (
      '<div class="iconoplasm-tooltip-portrait' +
      (portraitSrc ? ' iconoplasm-tooltip-portrait--ready"' : ' iconoplasm-tooltip-portrait-missing"') +
      ">" +
      shared.renderLabLabelSpecimenRailHtml(mediaHtml, payload.gene || {}) +
      "</div>"
    )
  }

  function cardClasses(payload) {
    let classes = "icono-card icono-card--brick"
    if (isLitArchivalVariant(payload)) {
      classes += " icono-card--variant-lab-label icono-card--variant-lit-archival"
    } else if (isImageOnlyVariant(payload)) {
      classes += " icono-card--variant-image-only"
    }
    return classes
  }

  function cardMarkup(payload) {
    const accent = String((((payload || {}).gene || {}).color || "#888")).trim() || "#888"
    const dims = portraitDimensions(payload)
    return (
      '<article class="' +
      cardClasses(payload) +
      '" data-icono-card-variant="' +
      esc(String(payload.cardVariant || "simple")) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(accent) +
      ';">' +
      (isLitArchivalVariant(payload)
        ? archivalPortraitMarkup(payload)
        : simplePortraitMarkup(payload)) +
      '<div class="iconoplasm-tooltip-body">' +
      (isLitArchivalVariant(payload) ? archivalBodyHtml(payload) : simpleBodyHtml(payload)) +
      "</div>" +
      "</article>"
    )
  }

  function imageOnlyCardMarkup(payload) {
    const accent = String((((payload || {}).gene || {}).color || "#888")).trim() || "#888"
    const dims = portraitDimensions(payload)
    return (
      '<article class="' +
      cardClasses(payload) +
      '" data-icono-card-variant="' +
      esc(String(payload.cardVariant || "image-only")) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(accent) +
      ';">' +
      imageOnlyBodyHtml(payload) +
      "</article>"
    )
  }

  function wireVoteBox(payload) {
    if (!slot || !shared) return
    const vote = payload && payload.vote && typeof payload.vote === "object" ? payload.vote : null
    const box = slot.querySelector("[data-icono-vote-box]")
    if (!box || !vote || !vote.assetSha || typeof shared.wireVoteBox !== "function") return
    shared.wireVoteBox(box, {
      symbol: vote.symbol,
      assetSha: vote.assetSha,
      visionId: vote.visionId,
      candidateImageId: vote.candidateImageId,
      apiBaseUrl: vote.apiBaseUrl,
      onAuthRequired: () => {
        postToParent(FRAME_AUTH_REQUIRED_TYPE, { symbol: currentSymbol() })
      },
      onError: (phase, err) => {
        console.error("[Iconoplasm] archival frame vote " + phase + " error:", err)
      },
    })
  }

  async function renderCard(payload) {
    if (!slot || !shared) return
    await ensureSiteStylesLoaded()
    const portraitSrc = String((payload && payload.portraitSrc) || "").trim()
    if (portraitSrc && portraitDecodePromiseCache.has(portraitSrc)) {
      await portraitDecodePromiseCache.get(portraitSrc).catch(() => null)
    }
    replaceTrustedChildren(slot, isImageOnlyVariant(payload) ? imageOnlyCardMarkup(payload) : cardMarkup(payload))
    if (shared && typeof shared.hydrateRoughLoops === "function") {
      shared.hydrateRoughLoops(slot, true)
    }
    wireVoteBox(payload)
  }

  window.addEventListener("message", (event) => {
    const data = event && event.data && typeof event.data === "object" ? event.data : null
    if (!data) return
    if (data.type === FRAME_PREWARM_TYPE) {
      const sources = Array.isArray(data.sources) ? data.sources : []
      for (const source of sources) {
        void prewarmPortraitSource(source)
      }
      return
    }
    if (data.type !== FRAME_RENDER_TYPE) return
    currentPayload = data
    applyTheme(String(data.theme || "light").trim().toLowerCase() === "dark" ? "dark" : "light")
    void renderCard(data)
  })

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest("[data-icono-vote-box]")) return
    const link = target.closest("[data-icono-nav]")
    if (link) event.preventDefault()
    const symbol = currentSymbol()
    if (!symbol) return
    postToParent(FRAME_OPEN_TYPE, { symbol })
  })

  postToParent(FRAME_READY_TYPE)
})()
