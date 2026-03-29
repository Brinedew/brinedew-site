import {
  readIconoplasmSettings,
  syncSharedIconoplasmSettings,
} from "../site-preferences.js?v=20260309e"
import {
  buildLoginUrl,
  buildSharedUserPanelMarkup,
  fetchAuthenticatedUser,
  mountSidebarStack,
  wireSharedUserPanel,
} from "../shared/sidebar-shell.js?v=20260310d"
import "./generated/lit-archival-card.js?v=20260329a"

void syncSharedIconoplasmSettings().catch(function () {
  return null
})
;(function () {
  "use strict"

  var IconoCardShared = globalThis.IconoplasmCardShared
  if (!IconoCardShared) {
    throw new Error("[Iconoplasm] shared card runtime missing: load shared-card-runtime.js first")
  }

  /* ─── Constants ─── */
  var ROOT_ID = "iconoplasm-root"
  var DEBOUNCE_MS = 200
  var GALLERY_PAGE_SIZE = 30
  var GALLERY_INITIAL_PAGE_SIZE = 4
  var GALLERY_DEFAULT_ORDER = "votes"
  var HOME_LAYOUT_DEFAULT = "bricks"
  var CARD_VARIANT_DEFAULT = "classic"
  var HOME_SKELETON_CARD_COUNT = 4
  var GALLERY_ORDERS = [
    { value: "votes", label: "Votes" },
    { value: "uniqueness", label: "Uniqueness" },
    { value: "popularity", label: "Popularity" },
    { value: "heaviest", label: "Heaviest first" },
    { value: "lightest", label: "Lightest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "youngest", label: "Youngest first" },
    { value: "newest", label: "Newest" },
    { value: "random", label: "Random" },
  ]
  var PREFETCH_BATCH_SIZE = 20
  var PREFETCH_TRIGGER_OFFSET = 10
  var PREFETCH_DETAIL_CONCURRENCY = 4
  var ICONO_ARROW_LEFT =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style="width:14px;height:14px;vertical-align:-2px;margin-right:3px"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var portraitDetailCache = Object.create(null)
  var portraitDetailPromiseCache = Object.create(null)
  var portraitImageCache = Object.create(null)
  var portraitImagePromiseCache = Object.create(null)
  var homeMasonry = null
  var candidateMasonry = null
  var portraitLightboxCleanup = null
  var currentUser = null
  var masonryLibsPromise = null
  var photoSwipeModulePromise = null
  var hasResolvedAuthState = false
  var voteLoginRedirectPending = false
  var iconoSidebarState = {
    page: "home",
    homeLayout: HOME_LAYOUT_DEFAULT,
    total: 0,
    publishedTotal: 0,
    gene: null,
  }

  /* ─── API helpers ─── */

  function apiBase() {
    var host = String(window.location.hostname || "").toLowerCase()
    if (host === "iconoplasm.brinedew.bio") return window.location.origin
    if (host === "staging.brinedew.bio") return window.location.origin
    if (host === "brinedew.bio" || host === "www.brinedew.bio")
      return "https://iconoplasm.brinedew.bio"
    return "https://iconoplasm.brinedew.bio"
  }

  var API = apiBase()

  function fetchJSON(path, init) {
    var requestInit = init || {}
    return fetch(API + path, requestInit).then(function (r) {
      return r.text().then(function (raw) {
        var payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch (_err) {
            payload = null
          }
        }
        if (!r.ok) {
          var err = new Error((payload && payload.error) || "HTTP " + r.status)
          err.status = r.status
          err.payload = payload
          throw err
        }
        return payload
      })
    })
  }

  /* ─── Utility ─── */

  function esc(s) {
    var d = document.createElement("div")
    d.textContent = s
    return d.innerHTML
  }

  function normalizedSymbol(symbol) {
    return String(symbol || "")
      .trim()
      .toUpperCase()
  }

  function publishedPortraitUrl(genePayload, preferredSize) {
    var portrait = genePayload && genePayload.portrait
    var flatHeroUrl = String((genePayload && genePayload.ph) || "").trim()
    var flatMediumUrl = String((genePayload && genePayload.pt) || "").trim()
    var isPublished =
      (portrait && portrait.status === "published") || Boolean(flatHeroUrl || flatMediumUrl)
    if (!isPublished) return ""
    var heroUrl = String((portrait && portrait.hero_url) || flatHeroUrl).trim()
    var mediumUrl = String((portrait && portrait.medium_url) || flatMediumUrl).trim()
    var thumbUrl = String((portrait && portrait.thumb_url) || "").trim()
    if (preferredSize === "medium") return mediumUrl || thumbUrl || heroUrl
    if (preferredSize === "thumb") return thumbUrl || mediumUrl || heroUrl
    return heroUrl || mediumUrl || thumbUrl
  }

  function candidatePortraitUrl(candidate, preferredSize) {
    var item = candidate || {}
    var fullUrl = String(item.full_url || "").trim()
    var mediumUrl = String(item.medium_url || "").trim()
    var thumbUrl = String(item.thumb_url || "").trim()
    if (preferredSize === "medium") return mediumUrl || thumbUrl || fullUrl
    if (preferredSize === "thumb") return thumbUrl || mediumUrl || fullUrl
    return fullUrl || mediumUrl || thumbUrl
  }

  function portraitDimensions(genePayload) {
    var portrait = genePayload && genePayload.portrait
    var assetSha = String((portrait && portrait.asset_sha256) || "")
      .trim()
      .toLowerCase()
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var matchedCandidate = null
    if (assetSha) {
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i]
        var candidateSha = String((candidate && candidate.asset_sha256) || "")
          .trim()
          .toLowerCase()
        if (candidateSha && candidateSha === assetSha) {
          matchedCandidate = candidate
          break
        }
      }
    }
    var width = Number(
      (portrait && (portrait.width || portrait.image_width)) ||
        (matchedCandidate && (matchedCandidate.width || matchedCandidate.image_width)) ||
        (genePayload && genePayload.width) ||
        0,
    )
    var height = Number(
      (portrait && (portrait.height || portrait.image_height)) ||
        (matchedCandidate && (matchedCandidate.height || matchedCandidate.image_height)) ||
        (genePayload && genePayload.height) ||
        0,
    )
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { width: 1, height: 1 }
    }
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
  }

  function deferWork(task) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(
        function () {
          task()
        },
        { timeout: 1200 },
      )
      return
    }
    window.setTimeout(task, 120)
  }

  function ensureStylesheetOnce(href, marker) {
    if (!href) return
    var existingSelector = marker
      ? 'link[data-icono-style="' + marker + '"]'
      : 'link[href="' + href.replace(/"/g, '\\"') + '"]'
    if (document.querySelector(existingSelector)) return
    var link = document.createElement("link")
    link.rel = "stylesheet"
    link.href = href
    if (marker) link.setAttribute("data-icono-style", marker)
    document.head.appendChild(link)
  }

  function loadScriptOnce(src, test) {
    if (typeof test === "function" && test()) return Promise.resolve()
    var existing = document.querySelector('script[data-icono-script="' + src + '"]')
    if (existing) {
      return new Promise(function (resolve, reject) {
        existing.addEventListener("load", resolve, { once: true })
        existing.addEventListener("error", reject, { once: true })
      })
    }
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script")
      script.src = src
      script.defer = true
      script.async = false
      script.setAttribute("data-icono-script", src)
      script.addEventListener(
        "load",
        function () {
          resolve()
        },
        { once: true },
      )
      script.addEventListener(
        "error",
        function () {
          reject(new Error("Failed to load " + src))
        },
        { once: true },
      )
      document.head.appendChild(script)
    })
  }

  function ensureMasonryLibs() {
    if (window.Masonry && window.imagesLoaded) return Promise.resolve()
    if (masonryLibsPromise) return masonryLibsPromise
    var masonryUrl = new URL("./vendor/masonry.pkgd.min.js?v=20260311a", import.meta.url).href
    var imagesLoadedUrl = new URL("./vendor/imagesloaded.pkgd.min.js?v=20260311a", import.meta.url)
      .href
    masonryLibsPromise = loadScriptOnce(masonryUrl, function () {
      return !!window.Masonry
    })
      .then(function () {
        return loadScriptOnce(imagesLoadedUrl, function () {
          return !!window.imagesLoaded
        })
      })
      .catch(function (error) {
        masonryLibsPromise = null
        throw error
      })
    return masonryLibsPromise
  }

  function ensurePhotoSwipe() {
    ensureStylesheetOnce(
      new URL("./vendor/photoswipe.css?v=20260311a", import.meta.url).href,
      "photoswipe",
    )
    if (photoSwipeModulePromise) return photoSwipeModulePromise
    photoSwipeModulePromise = import("./vendor/photoswipe.esm.js?v=20260306d")
      .then(function (module) {
        return module && module.default ? module.default : module
      })
      .catch(function (error) {
        photoSwipeModulePromise = null
        throw error
      })
    return photoSwipeModulePromise
  }

  function preloadImage(url) {
    var resolvedUrl = String(url || "").trim()
    if (!resolvedUrl) return Promise.resolve("")
    if (portraitImageCache[resolvedUrl]) return Promise.resolve(resolvedUrl)
    if (portraitImagePromiseCache[resolvedUrl]) return portraitImagePromiseCache[resolvedUrl]

    portraitImagePromiseCache[resolvedUrl] = new Promise(function (resolve) {
      var img = new Image()
      function finish(value) {
        if (value) portraitImageCache[resolvedUrl] = true
        delete portraitImagePromiseCache[resolvedUrl]
        resolve(value)
      }
      img.addEventListener(
        "load",
        function () {
          finish(resolvedUrl)
        },
        { once: true },
      )
      img.addEventListener(
        "error",
        function () {
          finish("")
        },
        { once: true },
      )
      img.src = resolvedUrl
    })

    return portraitImagePromiseCache[resolvedUrl]
  }

  function refreshPortraitLightbox() {
    if (typeof portraitLightboxCleanup === "function") {
      portraitLightboxCleanup()
      portraitLightboxCleanup = null
    }
    if (!document.querySelector("[data-icono-lightbox] [data-icono-pswp]")) return
    var cleanups = []
    var galleries = document.querySelectorAll("[data-icono-lightbox]")
    for (var i = 0; i < galleries.length; i++) {
      ;(function (gallery) {
        var handler = function (event) {
          var trigger =
            event.target && event.target.closest ? event.target.closest("[data-icono-pswp]") : null
          if (!trigger || !gallery.contains(trigger)) return
          event.preventDefault()
          var links = gallery.querySelectorAll("[data-icono-pswp]")
          var items = []
          var index = 0
          for (var j = 0; j < links.length; j++) {
            var link = links[j]
            var width = Number(link.getAttribute("data-pswp-width") || 0) || 1
            var height = Number(link.getAttribute("data-pswp-height") || 0) || 1
            items.push({
              src: link.getAttribute("data-icono-pswp-src"),
              width: width,
              height: height,
              alt:
                link.getAttribute("data-icono-pswp-alt") || link.getAttribute("aria-label") || "",
            })
            if (link === trigger) index = j
          }
          void ensurePhotoSwipe()
            .then(function (PhotoSwipe) {
              var pswp = new PhotoSwipe({
                dataSource: items,
                index: index,
                bgOpacity: 0.92,
                spacing: 0.12,
                wheelToZoom: true,
                mouseMovePan: true,
                loop: false,
                imageClickAction: "zoom",
                tapAction: "toggle-controls",
                bgClickAction: "close",
                showHideAnimationType: "fade",
                paddingFn: function () {
                  return { top: 28, bottom: 28, left: 28, right: 28 }
                },
              })
              pswp.init()
            })
            .catch(function (error) {
              console.error("[Iconoplasm] failed to load PhotoSwipe:", error)
            })
        }
        gallery.addEventListener("click", handler)
        cleanups.push(function () {
          gallery.removeEventListener("click", handler)
        })
      })(galleries[i])
    }
    portraitLightboxCleanup = function () {
      for (var i = 0; i < cleanups.length; i++) cleanups[i]()
    }
  }

  function fetchGeneDetail(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return Promise.resolve(null)
    if (portraitDetailCache[key]) return Promise.resolve(portraitDetailCache[key])
    if (portraitDetailPromiseCache[key]) return portraitDetailPromiseCache[key]

    portraitDetailPromiseCache[key] = fetchJSON(
      "/api/public/v1/genes/" + encodeURIComponent(key),
    )
      .then(function (data) {
        portraitDetailCache[key] = data
        return data
      })
      .catch(function () {
        return null
      })
      .finally(function () {
        delete portraitDetailPromiseCache[key]
      })

    return portraitDetailPromiseCache[key]
  }

  function hydrateGridPortrait(container, symbol, genePayload) {
    if (!container) return
    var key = normalizedSymbol(symbol)
    if (!key) return
    var card = container.querySelector('[data-icono-symbol="' + key + '"]')
    if (!card) return
    var media = card.querySelector(".icono-card-media")
    if (!media) return
    var portraitUrl = publishedPortraitUrl(genePayload, "medium")
    if (!portraitUrl) return
    var dims = portraitDimensions(genePayload)
    card.style.setProperty("--width", String(dims.width))
    card.style.setProperty("--height", String(dims.height))
    var existing = media.querySelector("img")
    if (existing) {
      existing.setAttribute("src", portraitUrl)
      // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Loading Performance, Smooth 60fps)
      // + C:\Users\Admin\.codex\skills\polish\SKILL.md (Performance / No layout shift).
      // When Masonry cards hydrate after initial shell render, keep the portrait fetch eager but
      // low priority so fast mobile scrolling does not flash blank media while preserving order.
      existing.setAttribute("loading", "eager")
      existing.setAttribute("fetchpriority", "low")
      existing.setAttribute("width", String(dims.width))
      existing.setAttribute("height", String(dims.height))
      media.classList.remove("icono-card-media--fallback")
      return
    }
    media.classList.remove("icono-card-media--fallback")
    media.innerHTML =
      '<img src="' +
      esc(portraitUrl) +
      '" alt="' +
      esc(key) +
      ' portrait" loading="eager" decoding="async" fetchpriority="low" width="' +
      dims.width +
      '" height="' +
      dims.height +
      '">'
  }

  function prefetchPortraitBatch(entries, container) {
    var queue = []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      var key = normalizedSymbol(entry && entry.symbol ? entry.symbol : entry)
      if (!key) continue
      queue.push({
        symbol: key,
        data: entry && typeof entry === "object" ? entry : null,
      })
    }
    if (!queue.length) return Promise.resolve(null)

    var workerCount = Math.min(PREFETCH_DETAIL_CONCURRENCY, queue.length)
    var workers = []

    function next() {
      var entry = queue.shift()
      if (!entry) return Promise.resolve(null)
      var initialData = entry.data
      var initialUrl = publishedPortraitUrl(initialData, "medium")
      if (initialUrl) {
        hydrateGridPortrait(container, entry.symbol, initialData)
        return preloadImage(initialUrl).then(next)
      }
      return Promise.resolve(null).then(next)
    }

    for (var j = 0; j < workerCount; j++) {
      workers.push(next())
    }

    return Promise.all(workers).then(function () {
      return null
    })
  }

  function setupOrderedPortraitPrefetch(container, genes) {
    if (!container || !Array.isArray(genes) || !genes.length) return
    if (typeof container._iconoPrefetchCleanup === "function") {
      container._iconoPrefetchCleanup()
    }

    var orderedEntries = []
    for (var i = 0; i < genes.length; i++) {
      var entry = genes[i]
      var key = normalizedSymbol(entry && entry.symbol)
      if (!key) continue
      orderedEntries.push(entry)
    }
    if (!orderedEntries.length) return

    var nextBatchStart = 0

    function scheduleNextBatch() {
      if (nextBatchStart >= orderedEntries.length) return
      var batch = orderedEntries.slice(nextBatchStart, nextBatchStart + PREFETCH_BATCH_SIZE)
      nextBatchStart += PREFETCH_BATCH_SIZE
      deferWork(function () {
        void prefetchPortraitBatch(batch, container)
      })
    }

    function maybeAdvance(index) {
      if (!Number.isFinite(index)) return
      if (index >= nextBatchStart - PREFETCH_TRIGGER_OFFSET) {
        scheduleNextBatch()
      }
    }

    function handleIntent(event) {
      var card = event.target.closest(".icono-card[data-icono-index]")
      if (!card || !container.contains(card)) return
      var index = Number(card.getAttribute("data-icono-index"))
      maybeAdvance(index)
    }

    scheduleNextBatch()
    container.addEventListener("mouseover", handleIntent)
    container.addEventListener("focusin", handleIntent)
    container._iconoPrefetchCleanup = function () {
      container.removeEventListener("mouseover", handleIntent)
      container.removeEventListener("focusin", handleIntent)
      container._iconoPrefetchCleanup = null
    }
  }

  function scheduleHomeMasonry() {
    // no-op; layout is handled by Masonry instance
  }

  function destroyHomeMasonry() {
    if (!homeMasonry) return
    if (homeMasonry.instance) {
      homeMasonry.instance.destroy()
    }
    homeMasonry = null
  }

  function destroyCandidateMasonry() {
    if (!candidateMasonry) return
    if (candidateMasonry.instance) {
      candidateMasonry.instance.destroy()
    }
    candidateMasonry = null
  }

  function applyHomeMasonryNow(container, newElements) {
    if (!container) return
    var Masonry = window.Masonry
    if (!Masonry) {
      console.warn("[Iconoplasm] Masonry library not loaded")
      return
    }
    if (homeMasonry && homeMasonry.container === container && homeMasonry.instance) {
      // Masonry already running — append new items if provided, then relayout
      var instance = homeMasonry.instance
      if (newElements && newElements.length) {
        instance.appended(newElements)
      }
      if (window.imagesLoaded) {
        window.imagesLoaded(container, function () {
          instance.layout()
        })
      } else {
        instance.layout()
      }
      return
    }
    destroyHomeMasonry()
    // Insert sizer elements if not already present
    if (!container.querySelector(".icono-grid-sizer")) {
      var sizer = document.createElement("div")
      sizer.className = "icono-grid-sizer"
      container.insertBefore(sizer, container.firstChild)
    }
    if (!container.querySelector(".icono-gutter-sizer")) {
      var gutter = document.createElement("div")
      gutter.className = "icono-gutter-sizer"
      container.insertBefore(gutter, container.children[1] || null)
    }
    var msnry = new Masonry(container, {
      itemSelector: ".icono-card",
      columnWidth: ".icono-grid-sizer",
      gutter: ".icono-gutter-sizer",
      percentPosition: true,
      transitionDuration: 0,
      initLayout: false,
    })
    homeMasonry = {
      container: container,
      instance: msnry,
    }
    if (window.imagesLoaded) {
      window.imagesLoaded(container, function () {
        msnry.layout()
      })
      // also do an eager layout so things aren't invisible while images load
      msnry.layout()
    } else {
      msnry.layout()
    }
  }

  function applyHomeMasonry(container, newElements) {
    if (!container) return
    void ensureMasonryLibs()
      .then(function () {
        if (!container.isConnected) return
        applyHomeMasonryNow(container, newElements)
      })
      .catch(function (error) {
        console.error("[Iconoplasm] failed to load Masonry:", error)
      })
  }

  function applyCandidateMasonryNow(container) {
    if (!container) return
    var Masonry = window.Masonry
    if (!Masonry) {
      console.warn("[Iconoplasm] Masonry library not loaded")
      return
    }
    if (candidateMasonry && candidateMasonry.container === container && candidateMasonry.instance) {
      if (window.imagesLoaded) {
        window.imagesLoaded(container, function () {
          candidateMasonry.instance.layout()
        })
      } else {
        candidateMasonry.instance.layout()
      }
      return
    }
    destroyCandidateMasonry()
    if (!container.querySelector(".icono-candidate-grid-sizer")) {
      var sizer = document.createElement("div")
      sizer.className = "icono-candidate-grid-sizer"
      container.insertBefore(sizer, container.firstChild)
    }
    if (!container.querySelector(".icono-candidate-gutter-sizer")) {
      var gutter = document.createElement("div")
      gutter.className = "icono-candidate-gutter-sizer"
      container.insertBefore(gutter, container.children[1] || null)
    }
    var msnry = new Masonry(container, {
      itemSelector: ".icono-candidate-card",
      columnWidth: ".icono-candidate-grid-sizer",
      gutter: ".icono-candidate-gutter-sizer",
      percentPosition: true,
      transitionDuration: 0,
      initLayout: false,
    })
    candidateMasonry = {
      container: container,
      instance: msnry,
    }
    if (window.imagesLoaded) {
      window.imagesLoaded(container, function () {
        msnry.layout()
      })
      msnry.layout()
    } else {
      msnry.layout()
    }
  }

  function applyCandidateMasonry(container) {
    if (!container) return
    void ensureMasonryLibs()
      .then(function () {
        if (!container.isConnected) return
        applyCandidateMasonryNow(container)
      })
      .catch(function (error) {
        console.error("[Iconoplasm] failed to load Masonry:", error)
      })
  }

  function consumeBootstrapGallery(order, limit, offset) {
    var bootstrap = window.__iconoplasmBootstrap
    if (!bootstrap || bootstrap.homeGalleryUsed) return null
    if (offset !== 0 || order !== GALLERY_DEFAULT_ORDER || limit !== GALLERY_INITIAL_PAGE_SIZE) {
      return null
    }
    bootstrap.homeGalleryUsed = true
    if (bootstrap.homeGalleryData) return Promise.resolve(bootstrap.homeGalleryData)
    if (bootstrap.homeGalleryPromise) return bootstrap.homeGalleryPromise
    return null
  }

  function galleryOptionsMarkup() {
    var html = ""
    for (var i = 0; i < GALLERY_ORDERS.length; i++) {
      var option = GALLERY_ORDERS[i]
      html +=
        '<option value="' +
        esc(option.value) +
        '"' +
        (option.value === GALLERY_DEFAULT_ORDER ? " selected" : "") +
        ">" +
        esc(option.label) +
        "</option>"
    }
    return html
  }

  function buildBrickSkeletonCardMarkup() {
    return (
      '<article class="icono-card icono-card--brick icono-card--skeleton" aria-hidden="true">' +
      '<div class="iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--skeleton">' +
      '<div class="icono-card-skeleton-portrait-wash"></div>' +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-body iconoplasm-tooltip-body--skeleton">' +
      '<div class="iconoplasm-tooltip-header iconoplasm-tooltip-header--skeleton">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--symbol"></span>' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--name"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">' +
      renderTooltipMetaSkeletonHtml() +
      "</div>" +
      "</div>" +
      "</article>"
    )
  }

  function buildMasonrySkeletonCardMarkup(index) {
    var aspectRatio = index % 3 === 0 ? "4 / 5" : index % 3 === 1 ? "1 / 1" : "3 / 4"
    return (
      '<article class="icono-card icono-card--masonry icono-card--skeleton" aria-hidden="true" style="--icono-skeleton-aspect:' +
      aspectRatio +
      ';">' +
      '<div class="icono-card-media icono-card-skeleton-media"></div>' +
      '<div class="icono-card-info icono-card-skeleton-body">' +
      '<span class="icono-card-skeleton-line icono-card-skeleton-line--short"></span>' +
      '<span class="icono-card-skeleton-line icono-card-skeleton-line--medium"></span>' +
      "</div>" +
      "</article>"
    )
  }

  function buildHomeSkeletonGridMarkup(layout) {
    var resolvedLayout = layout === "masonry" ? "masonry" : "bricks"
    var html = ""
    if (resolvedLayout === "masonry") {
      html += '<div class="icono-grid-sizer"></div><div class="icono-gutter-sizer"></div>'
    }
    for (var i = 0; i < HOME_SKELETON_CARD_COUNT; i++) {
      html +=
        resolvedLayout === "masonry"
          ? buildMasonrySkeletonCardMarkup(i)
          : buildBrickSkeletonCardMarkup()
    }
    return html
  }

  function buildHomeShellMarkup(layout) {
    var resolvedLayout = layout === "masonry" ? "masonry" : HOME_LAYOUT_DEFAULT
    // Single source of truth: content/apps/iconoplasm/index.md intentionally ships an empty
    // mount root now. Keep the entire home shell here so the page cannot drift into a second
    // markdown-owned fallback renderer with stale dropdowns, copy, or skeleton markup.
    return (
      '<div class="icono-hero">' +
      '<div class="icono-hero-title">Iconoplasm</div>' +
      '<p class="tagline">Mnemonics for genes - <a class="internal" href="https://brinedew.bio/posts/Iconoplasm-FAQ.html">read FAQ</a></p>' +
      '<span class="stat" id="icono-gene-count">...</span>' +
      "</div>" +
      '<div class="icono-home-auth" id="icono-home-auth" hidden></div>' +
      '<div class="icono-gallery-toolbar">' +
      '<div class="icono-search icono-search--toolbar">' +
      '<div class="icono-search-wrapper">' +
      '<input type="text" id="icono-q" placeholder="Search by gene symbol or name..." autocomplete="off" />' +
      '<div class="icono-search-results" id="icono-results"></div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-gallery-actions">' +
      '<label class="icono-gallery-order" for="icono-order">' +
      "<span>Order by</span>" +
      '<select id="icono-order">' +
      galleryOptionsMarkup() +
      "</select>" +
      "</label>" +
      "</div>" +
      "</div>" +
      '<div class="icono-loading" id="icono-loading" hidden aria-live="polite"></div>' +
      '<div class="icono-grid" id="icono-grid" data-layout="' +
      esc(resolvedLayout) +
      '" aria-busy="true">' +
      buildHomeSkeletonGridMarkup(resolvedLayout) +
      "</div>" +
      '<div class="icono-load-sentinel" id="icono-load-sentinel" aria-hidden="true"></div>'
    )
  }

  function isLightColor(hex) {
    if (!hex || hex.length < 7) return false
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    return r * 0.299 + g * 0.587 + b * 0.114 > 160
  }

  function textColorFor(hex) {
    return isLightColor(hex) ? "rgba(0,0,0,0.7)" : "#fff"
  }

  function uniqueDisplayValues(values, limit) {
    return IconoCardShared.uniqueDisplayValues(values, limit)
  }

  var missingTooltipOriginWarnings = Object.create(null)

  function resolveHomeLayout() {
    var settings = readIconoplasmSettings()
    return (
      String((settings && settings.homeLayout) || HOME_LAYOUT_DEFAULT).trim() || HOME_LAYOUT_DEFAULT
    )
  }

  function resolveCardVariant() {
    var settings = readIconoplasmSettings()
    return IconoCardShared.normalizeCardVariant(
      (settings && settings.cardVariant) || CARD_VARIANT_DEFAULT,
    )
  }

  function isArchivalCardVariant(cardVariant) {
    return cardVariant === "lab-label" || cardVariant === "lit-archival"
  }

  function archivalVariantClass(cardVariant) {
    if (cardVariant === "lit-archival") {
      return " icono-card--variant-lab-label icono-card--variant-lit-archival"
    }
    if (cardVariant === "lab-label") return " icono-card--variant-lab-label"
    return ""
  }

  function jsonScriptSafeString(value) {
    return JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  }

  function litArchivalGeneSnapshot(genePayload) {
    var safeGenePayload = genePayload && typeof genePayload === "object" ? genePayload : {}
    var safeEssence =
      safeGenePayload.essence && typeof safeGenePayload.essence === "object"
        ? safeGenePayload.essence
        : {}
    var safePortrait =
      safeGenePayload.portrait && typeof safeGenePayload.portrait === "object"
        ? safeGenePayload.portrait
        : {}
    return {
      symbol: safeGenePayload.symbol || "",
      canonical_symbol: safeGenePayload.canonical_symbol || "",
      full_name: safeGenePayload.full_name || "",
      color: safeGenePayload.color || "",
      first_publication_year: safeGenePayload.first_publication_year || "",
      sex_origin: safeGenePayload.sex_origin || "",
      gender_origin: safeGenePayload.gender_origin || "",
      portrait: {
        artist_id: safePortrait.artist_id || "",
        candidate_image_id: safePortrait.candidate_image_id || 0,
        emulsion_id: safePortrait.emulsion_id || "",
        vision_id: safePortrait.vision_id || "",
      },
      essence: {
        age: safeEssence.age || "",
        age_years: safeEssence.age_years || "",
        aesthetics: safeEssence.aesthetics || [],
        aesthetics_origin: safeEssence.aesthetics_origin || [],
        family_feature: safeEssence.family_feature || "",
        family_members: safeEssence.family_members || "",
        family_surname: safeEssence.family_surname || "",
        faction: safeEssence.faction || "",
        gender_origin: safeEssence.gender_origin || "",
        name: safeEssence.name || "",
        politics: safeEssence.politics || "",
        politics_origin: safeEssence.politics_origin || [],
        sex: safeEssence.sex || "",
        sex_origin: safeEssence.sex_origin || "",
        weight_kg: safeEssence.weight_kg || "",
      },
    }
  }

  function buildLitArchivalBodyMarkup(genePayload, options) {
    var opts = options || {}
    var payload = {
      gene: litArchivalGeneSnapshot(genePayload),
      options: {
        mode: opts.mode === "brick" ? "brick" : "sheet",
        mobileReview: !!opts.mobileReview,
        titleHref: String(opts.titleHref || "").trim(),
        voteHtml: String(opts.voteHtml || ""),
      },
    }
    return (
      '<icono-lit-archival class="icono-lit-archival-host" data-icono-lit-archival>' +
      '<script type="application/json" data-icono-lit-archival-model>' +
      jsonScriptSafeString(payload) +
      "</script>" +
      "</icono-lit-archival>"
    )
  }

  function iconoRowMarkup(label, value) {
    return (
      '<div class="brd-sidebar-row">' +
      '<span class="brd-sidebar-row-label">' +
      esc(label) +
      "</span>" +
      '<span class="brd-sidebar-row-value">' +
      esc(value) +
      "</span>" +
      "</div>"
    )
  }

  function iconoSidebarPanelMarkup() {
    var page = String((iconoSidebarState && iconoSidebarState.page) || "home")
    var html =
      '<div class="brd-sidebar-section">' +
      '<div class="brd-sidebar-panel-title">Iconoplasm</div>' +
      '<div class="brd-sidebar-rowlist">'
    if (page === "gene") {
      var gene = (iconoSidebarState && iconoSidebarState.gene) || null
      if (!gene) {
        html += iconoRowMarkup("Gene", "Loading")
      } else if (gene.error) {
        html += iconoRowMarkup("Gene", gene.symbol || "Unknown")
        html += iconoRowMarkup("Status", "Not found")
      } else {
        html += iconoRowMarkup("Gene", gene.symbol || "Unknown")
        html += iconoRowMarkup("Portrait", gene.hasPortrait ? "Published" : "Pending")
        html += iconoRowMarkup("Candidates", String(gene.candidateCount || 0))
        html += iconoRowMarkup("Aliases", String(gene.aliasCount || 0))
      }
      html +=
        "</div>" +
        '<div class="brd-user-links"><a href="/" data-icono-nav>All genes</a></div>' +
        "</div>"
      return html
    }
    if (page === "404") {
      html += iconoRowMarkup("Page", "Not found")
      html += "</div></div>"
      return html
    }
    html += iconoRowMarkup("Layout", iconoSidebarState.homeLayout || HOME_LAYOUT_DEFAULT)
    html += iconoRowMarkup("Portraits", String(iconoSidebarState.publishedTotal || 0))
    html += iconoRowMarkup("Genes", String(iconoSidebarState.total || 0))
    html += "</div></div>"
    return html
  }

  function renderIconoplasmSidebar() {
    var stack = mountSidebarStack({
      stackId: "brd-sidebar-stack",
      panels: [
        {
          id: "brd-shared-user-panel",
          className: "brd-sidebar-panel--user",
          markup: buildSharedUserPanelMarkup({
            user: currentUser,
            loginLabel: "Discord Login",
          }),
        },
        {
          id: "icono-sidebar-panel",
          className: "brd-sidebar-panel--iconoplasm",
          markup: iconoSidebarPanelMarkup(),
        },
      ],
    })
    wireSharedUserPanel(stack, {
      onAuthChanged: function (user) {
        hasResolvedAuthState = true
        currentUser = user
        renderIconoplasmSidebar()
      },
    })
    renderHomeAuthRail()
  }

  function refreshSharedUserState() {
    return fetchAuthenticatedUser()
      .then(function (user) {
        hasResolvedAuthState = true
        currentUser = user
        renderIconoplasmSidebar()
        return user
      })
      .catch(function () {
        hasResolvedAuthState = true
        currentUser = null
        renderIconoplasmSidebar()
        return null
      })
  }

  function voteLoginUrl() {
    return buildLoginUrl({
      authBase: API,
    })
  }

  function buildHomeAuthRailMarkup() {
    if (!hasResolvedAuthState || currentUser) return ""
    return (
      '<div class="icono-home-auth-card">' +
      '<div class="icono-home-auth-copy">' +
      '<div class="icono-home-auth-kicker">review access</div>' +
      '<div class="icono-home-auth-title">Sign in to rate gene bricks</div>' +
      '<div class="icono-home-auth-note">Swipe right for fit, left for misfit. Login is now reachable here instead of only at the bottom of the infinite gallery.</div>' +
      "</div>" +
      '<a class="icono-home-auth-link" href="' +
      esc(voteLoginUrl()) +
      '">Discord Login</a>' +
      "</div>"
    )
  }

  function renderHomeAuthRail() {
    var slot = document.getElementById("icono-home-auth")
    if (!slot) return
    var markup = buildHomeAuthRailMarkup()
    slot.hidden = !markup
    slot.innerHTML = markup
  }

  function renderTooltipMetaSkeletonHtml() {
    // Shared source of truth: shared/iconoplasm-card/shared-card-runtime.js
    // This keeps tooltip/card skeleton behavior identical across the site and extension.
    return IconoCardShared.renderTooltipMetaSkeletonHtml()
  }

  function buildTooltipTraitOriginRows(essence) {
    return IconoCardShared.buildTooltipTraitOriginRows(essence)
  }

  function collectTooltipMetaRows(geneDetail) {
    return IconoCardShared.collectTooltipMetaRows(geneDetail, {
      onMissingOrigins: function (warnKey, detail) {
        if (missingTooltipOriginWarnings[warnKey]) return
        missingTooltipOriginWarnings[warnKey] = true
        console.error(
          "[Iconoplasm] Missing aesthetics/politics origin metadata for tooltip:",
          warnKey,
          detail,
        )
      },
    })
  }

  function renderTooltipMetaRowsHtml(rows) {
    return IconoCardShared.renderTooltipMetaRowsHtml(rows)
  }

  function renderTooltipMetaHtml(geneDetail) {
    return renderTooltipMetaRowsHtml(collectTooltipMetaRows(geneDetail))
  }

  function renderTooltipMobileRowGridHtml(rows, extraAttrs) {
    return IconoCardShared.renderTooltipMobileRowGridHtml(rows, extraAttrs)
  }

  function renderTooltipMobileSkeletonHtml(extraAttrs) {
    return IconoCardShared.renderTooltipMobileSkeletonHtml(extraAttrs)
  }

  function warmBrickCardImages(entries) {
    var source = Array.isArray(entries) ? entries : []
    // Mobile users scroll through the brick gallery faster than the detail hydrator can react.
    // Prewarm published portraits as soon as a page of cards lands so top/bottom viewport cards
    // do not briefly flash placeholder art during fast flicks.
    for (var i = 0; i < source.length; i++) {
      var portraitUrl = publishedPortraitUrl(source[i], "medium")
      if (!portraitUrl) continue
      void preloadImage(portraitUrl)
    }
  }

  function brickVoteAssetSha(genePayload) {
    return String(((genePayload || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
  }

  function brickVoteCandidateImageId(genePayload) {
    var candidateImageId = Number(((genePayload || {}).portrait || {}).candidate_image_id || 0)
    if (!Number.isFinite(candidateImageId) || candidateImageId <= 0) return ""
    return String(Math.round(candidateImageId))
  }

  function brickVoteVisionId(genePayload) {
    return String(((genePayload || {}).portrait || {}).vision_id || "").trim()
  }

  function brickVoteBoxMarkup(genePayload) {
    var assetSha = brickVoteAssetSha(genePayload)
    if (!assetSha) return ""
    var candidateImageId = brickVoteCandidateImageId(genePayload)
    var visionId = brickVoteVisionId(genePayload)
    var extraAttrs = 'data-icono-brick-vote-box="' + esc(assetSha) + '"'
    if (candidateImageId)
      extraAttrs += ' data-icono-candidate-image-id="' + esc(candidateImageId) + '"'
    if (visionId) extraAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
    return voteBoxMarkup(extraAttrs, {
      variant: "brick",
      showScore: false,
    })
  }

  function labelVoteBoxMarkup(genePayload, attrName) {
    var assetSha = brickVoteAssetSha(genePayload)
    if (!assetSha) return ""
    var candidateImageId = brickVoteCandidateImageId(genePayload)
    var visionId = brickVoteVisionId(genePayload)
    var extraAttrs = (attrName || "data-icono-brick-vote-box") + '="' + esc(assetSha) + '"'
    if (candidateImageId)
      extraAttrs += ' data-icono-candidate-image-id="' + esc(candidateImageId) + '"'
    if (visionId) extraAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
    return voteBoxMarkup(extraAttrs, {
      variant: "label",
      showScore: false,
    })
  }

  function labLabelDisplayNameForBrick(genePayload) {
    var safeGenePayload = genePayload && typeof genePayload === "object" ? genePayload : {}
    var essence =
      safeGenePayload.essence && typeof safeGenePayload.essence === "object"
        ? safeGenePayload.essence
        : {}
    return (
      String(
        safeGenePayload.full_name ||
          essence.name ||
          safeGenePayload.symbol ||
          safeGenePayload.canonical_symbol ||
          "",
      ).trim() || normalizedSymbol(safeGenePayload.symbol)
    )
  }

  function buildLabLabelPortraitMediaMarkup(
    symbol,
    portraitUrl,
    portraitFullUrl,
    dims,
    fetchPriority,
  ) {
    var resolvedSymbol = normalizedSymbol(symbol)
    if (!portraitUrl) {
      return (
        '<div class="iconoplasm-tooltip-portrait-fallback">' +
        '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
        '<div class="iconoplasm-tooltip-portrait-symbol">' +
        esc(resolvedSymbol) +
        "</div>" +
        "</div>"
      )
    }
    return (
      '<button type="button" class="iconoplasm-tooltip-portrait-media icono-brick-media-link" data-icono-pswp data-icono-pswp-src="' +
      esc(portraitFullUrl) +
      '" data-icono-pswp-alt="' +
      esc(resolvedSymbol) +
      ' portrait" data-pswp-width="' +
      dims.width +
      '" data-pswp-height="' +
      dims.height +
      '" aria-label="Open full-size portrait for ' +
      esc(resolvedSymbol) +
      ' portrait">' +
      '<img class="iconoplasm-tooltip-portrait-img" src="' +
      esc(portraitUrl) +
      '" alt="' +
      esc(resolvedSymbol) +
      ' portrait" loading="eager" decoding="async" fetchpriority="' +
      esc(fetchPriority || "low") +
      '" width="' +
      dims.width +
      '" height="' +
      dims.height +
      '">' +
      "</button>"
    )
  }

  function buildLabLabelMobileDrawerMarkup(genePayload, voteHtml, href) {
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    var fullName = labLabelDisplayNameForBrick(genePayload)
    // Mobile must stay a UX wrapper around the canonical archival card. Do not add a second
    // phone-only dossier renderer here. The only valid source for sheet fields is
    // IconoCardShared.renderLabLabelCardHtml(...), with mobile changing presentation only.
    // Mobile review constraints captured from production feedback:
    // - the tab owns the gene symbol, so expanded dossier must not introduce a second mobile-only symbol treatment
    // - the tab must stay visually attached to the dossier seam and inherit the desktop symbol voice
    // - the tab must not drift into angular, asymmetric, improvised office-tab geometry
    // - the mobile swipe surface owns voting; the expanded archival sheet must not render a second QC vote shell
    // - collapsed copy should stay centered within the sheet width instead of reserving a giant dead strip
    // - expanded sizing must be solved by measured layout changes, not by shrinking type until collisions are hidden
    // - the mobile tab is a real archival object with soft rounded shoulders; no CSS polygon shortcuts
    // - the tab has to remain fully inside the viewport after expansion so collapse stays reachable
    // - never ask the canonical archival renderer for a phone-only variant; desktop must stay insulated
    //   and mobile must adapt the same archival DOM instead of forking content selection
    // - never nest vote buttons inside the peek toggle button; invalid button-in-button HTML causes
    //   browser reparsing, which leaked the dossier open in collapsed state on production
    return (
      '<div class="icono-label-mobile-peek">' +
      '<button type="button" class="icono-label-mobile-peek-toggle" data-icono-label-mobile-toggle aria-expanded="false">' +
      '<span class="icono-label-mobile-peek-tab" aria-hidden="true">' +
      '<svg class="icono-label-mobile-peek-tab-art" viewBox="0 0 188 72" preserveAspectRatio="none" focusable="false" aria-hidden="true">' +
      '<path class="icono-label-mobile-peek-tab-fill" d="M6 72V44C6 39.6 9.6 36 14 36H51.4C58.6 36 64.7 31.3 69.1 22.1C73.1 13.8 79.6 8 94 8C108.4 8 114.9 13.8 118.9 22.1C123.3 31.3 129.4 36 136.6 36H174C178.4 36 182 39.6 182 44V72H6Z"></path>' +
      '<path class="icono-label-mobile-peek-tab-highlight" d="M17 42.6H50.2C61.5 42.6 70.8 34.9 76.5 22.8C80.1 15.1 84.8 11.8 94 11.8C103.2 11.8 107.9 15.1 111.5 22.8C117.2 34.9 126.5 42.6 137.8 42.6H171"></path>' +
      "</svg>" +
      '<span class="icono-label-mobile-peek-tab-symbol">' +
      esc(symbol) +
      "</span>" +
      "</span>" +
      '<span class="icono-label-mobile-peek-topline">' +
      '<span class="icono-label-mobile-peek-kicker">full name</span>' +
      '<span class="icono-label-mobile-peek-instruction icono-label-mobile-peek-instruction--closed">tap to open</span>' +
      '<span class="icono-label-mobile-peek-instruction icono-label-mobile-peek-instruction--open">tap to close</span>' +
      "</span>" +
      '<span class="icono-label-mobile-peek-summary">' +
      '<span class="icono-label-mobile-peek-name">' +
      esc(fullName) +
      "</span>" +
      "</span>" +
      "</button>" +
      '<div class="icono-label-mobile-peek-swipe">' +
      voteHtml +
      "</div>" +
      "</div>" +
      '<div class="icono-label-dossier-shell" data-icono-label-dossier-shell>' +
      '<div class="icono-label-dossier-sheet">' +
      IconoCardShared.renderLabLabelCardHtml(genePayload, {
        voteHtml: "",
        titleHref: href,
        titleLinkAttrs: "data-icono-nav",
      }) +
      "</div>" +
      "</div>"
    )
  }

  function buildLabLabelDesktopBodyMarkup(genePayload, voteHtml, href) {
    // Desktop must render the canonical archival sheet directly.
    // Do not wrap desktop cards in the mobile dossier shell. That was the regression:
    // mobile UX chrome leaked into desktop geometry and collapsed the live archival layout.
    return IconoCardShared.renderLabLabelCardHtml(genePayload, {
      voteHtml: voteHtml,
      titleHref: href,
      titleLinkAttrs: "data-icono-nav",
    })
  }

  function buildLabLabelBrickBodyMarkup(genePayload, voteHtml, href) {
    // One canonical archival renderer, two shells:
    // - desktop: render the archival sheet directly
    // - mobile: wrap that same sheet in touch ergonomics
    // Never send desktop through the mobile shell again.
    return isMobileLabelReviewEnabled()
      ? buildLabLabelMobileDrawerMarkup(genePayload, voteHtml, href)
      : buildLabLabelDesktopBodyMarkup(genePayload, voteHtml, href)
  }

  function buildBrickCardMarkup(g, cardIndex) {
    var dims = portraitDimensions(g)
    var key = normalizedSymbol(g.symbol)
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitUrl
    var detail = portraitDetailCache[key] || null
    var cardVariant = resolveCardVariant()
    var isArchivalVariant = isArchivalCardVariant(cardVariant)
    var isLitArchivalVariant = cardVariant === "lit-archival"
    var href = "/gene/" + esc(encodeURIComponent(g.symbol))
    var metaRows = detail ? collectTooltipMetaRows(detail) : []
    var metaHtml = detail ? renderTooltipMetaRowsHtml(metaRows) : renderTooltipMetaSkeletonHtml()
    var mobileRowsHtml = detail
      ? renderTooltipMobileRowGridHtml(metaRows, "data-icono-card-mobile-meta")
      : renderTooltipMobileSkeletonHtml("data-icono-card-mobile-meta")
    var voteHtml = brickVoteBoxMarkup(detail || g)
    var labelVoteHtml = labelVoteBoxMarkup(detail || g, "data-icono-brick-vote-box")
    var portraitStateClass = portraitUrl
      ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready"
      : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing"
    var labelPortraitHtml = buildLabLabelPortraitMediaMarkup(
      g.symbol,
      portraitUrl,
      portraitFullUrl,
      dims,
      cardIndex < 6 ? "high" : "low",
    )
    var bodyHtml = isArchivalVariant
      ? isLitArchivalVariant
        ? buildLitArchivalBodyMarkup(detail || g, {
            mode: "brick",
            mobileReview: isMobileLabelReviewEnabled(),
            titleHref: href,
            voteHtml: labelVoteHtml,
          })
        : buildLabLabelBrickBodyMarkup(detail || g, labelVoteHtml, href)
      : '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-brick-header-row icono-shared-card-header-row">' +
        '<a class="icono-brick-header-link" href="' +
        href +
        '" data-icono-nav>' +
        '<div class="iconoplasm-tooltip-symbol">' +
        esc(g.symbol) +
        "</div>" +
        '<div class="iconoplasm-tooltip-name">' +
        esc(g.full_name || g.symbol) +
        "</div>" +
        "</a>" +
        voteHtml +
        "</div>" +
        "</div>" +
        '<a class="icono-brick-meta-link" href="' +
        href +
        '" data-icono-nav>' +
        '<div class="iconoplasm-tooltip-meta' +
        (detail ? "" : " iconoplasm-tooltip-meta--loading") +
        '" data-icono-card-meta>' +
        metaHtml +
        "</div>" +
        "</a>"
    return (
      // Source: C:\Users\Admin\.codex\skills\frontend-design\SKILL.md (Interaction, Layout &
      // Space) + C:\Users\Admin\.codex\skills\polish\SKILL.md (Interaction States). Brick cards
      // are no longer one giant anchor because the compact vote control needs to be a real,
      // keyboard-focusable control instead of an invalid nested button inside a link.
      '<article class="icono-card icono-card--brick' +
      archivalVariantClass(cardVariant) +
      '" data-icono-index="' +
      cardIndex +
      '" data-icono-symbol="' +
      esc(g.symbol) +
      '" data-icono-card-variant="' +
      esc(cardVariant) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(g.color || "#888") +
      ';">' +
      (isArchivalVariant
        ? '<div class="' +
          portraitStateClass +
          (portraitUrl ? '" data-icono-lightbox>' : '">') +
          IconoCardShared.renderLabLabelSpecimenRailHtml(labelPortraitHtml, detail || g) +
          "</div>"
        : '<div class="' +
          portraitStateClass +
          ' icono-brick-media-link"' +
          (portraitUrl ? " data-icono-lightbox>" : ">") +
          (portraitUrl
            ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
              esc(portraitFullUrl) +
              '" data-icono-pswp-alt="' +
              esc(g.symbol) +
              ' portrait" data-pswp-width="' +
              dims.width +
              '" data-pswp-height="' +
              dims.height +
              '" aria-label="Open full-size portrait for ' +
              esc(g.symbol) +
              ' portrait">' +
              '<img class="iconoplasm-tooltip-portrait-img" src="' +
              esc(portraitUrl) +
              '" alt="' +
              esc(g.symbol) +
              // Keep brick portraits eager once a card is rendered. Lazy here made fast mobile
              // scroll show empty portrait boxes for a beat before the browser picked them up.
              ' portrait" loading="eager" decoding="async" fetchpriority="' +
              (cardIndex < 6 ? "high" : "low") +
              '" width="' +
              dims.width +
              '" height="' +
              dims.height +
              '">' +
              "</button>"
            : '<img class="iconoplasm-tooltip-portrait-img" alt="">') +
          '<div class="iconoplasm-tooltip-portrait-fallback">' +
          '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
          '<div class="iconoplasm-tooltip-portrait-symbol">' +
          esc(g.symbol) +
          "</div>" +
          "</div>" +
          '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
          "</div>") +
      '<div class="iconoplasm-tooltip-body">' +
      bodyHtml +
      "</div>" +
      (isArchivalVariant
        ? ""
        : '<a class="icono-brick-mobile-link" href="' +
          href +
          '" data-icono-nav>' +
          mobileRowsHtml +
          "</a>") +
      "</article>"
    )
  }

  function buildGeneLeadCardMarkup(g) {
    var dims = portraitDimensions(g)
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitUrl
    var portraitAssetSha = String(((g || {}).portrait || {}).asset_sha256 || "")
      .trim()
      .toLowerCase()
    var detail = g || null
    var cardVariant = resolveCardVariant()
    var isArchivalVariant = isArchivalCardVariant(cardVariant)
    var isLitArchivalVariant = cardVariant === "lit-archival"
    var metaRows = detail ? collectTooltipMetaRows(detail) : []
    var metaHtml = detail ? renderTooltipMetaRowsHtml(metaRows) : renderTooltipMetaSkeletonHtml()
    // The lead card intentionally consumes the same mobile row-grid renderer as home bricks.
    // Keep mobile structure changes centralized so the gene page and gallery do not diverge again.
    var mobileRowsHtml = renderTooltipMobileRowGridHtml(
      detail ? metaRows : [],
      "data-icono-card-mobile-meta",
    )
    var portraitStateClass = portraitUrl
      ? "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait--ready"
      : "iconoplasm-tooltip-portrait iconoplasm-tooltip-portrait-missing"
    var portraitMarkup =
      '<div class="' +
      portraitStateClass +
      '"' +
      (portraitUrl ? " data-icono-lightbox" : "") +
      ">" +
      (isArchivalVariant
        ? IconoCardShared.renderLabLabelSpecimenRailHtml(
            portraitUrl
              ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
                  esc(portraitFullUrl) +
                  '" data-icono-pswp-alt="' +
                  esc(g.symbol) +
                  ' portrait" data-pswp-width="' +
                  dims.width +
                  '" data-pswp-height="' +
                  dims.height +
                  '" aria-label="Open full-size portrait for ' +
                  esc(g.symbol) +
                  ' portrait">' +
                  '<img class="iconoplasm-tooltip-portrait-img" src="' +
                  esc(portraitUrl) +
                  '" alt="' +
                  esc(g.symbol) +
                  ' portrait" loading="eager" decoding="async" width="' +
                  dims.width +
                  '" height="' +
                  dims.height +
                  '">' +
                  "</button>"
              : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
                  '<div class="iconoplasm-tooltip-portrait-fallback">' +
                  '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
                  '<div class="iconoplasm-tooltip-portrait-symbol">' +
                  esc(g.symbol) +
                  "</div>" +
                  "</div>",
            g,
          )
        : portraitUrl
          ? '<button type="button" class="iconoplasm-tooltip-portrait-media" data-icono-pswp data-icono-pswp-src="' +
            esc(portraitFullUrl) +
            '" data-icono-pswp-alt="' +
            esc(g.symbol) +
            ' portrait" data-pswp-width="' +
            dims.width +
            '" data-pswp-height="' +
            dims.height +
            '" aria-label="Open full-size portrait for ' +
            esc(g.symbol) +
            ' portrait">' +
            '<img class="iconoplasm-tooltip-portrait-img" src="' +
            esc(portraitUrl) +
            '" alt="' +
            esc(g.symbol) +
            ' portrait" loading="eager" decoding="async" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '">' +
            '<span class="icono-card-badge">' +
            esc(g.symbol) +
            "</span>" +
            "</button>"
          : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
            '<div class="iconoplasm-tooltip-portrait-fallback">' +
            '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
            '<div class="iconoplasm-tooltip-portrait-symbol">' +
            esc(g.symbol) +
            "</div>" +
            "</div>" +
            '<div class="iconoplasm-tooltip-portrait-fade"></div>') +
      "</div>"
    // Source: C:\Users\Admin\.codex\skills\normalize\SKILL.md (Components) +
    // C:\Users\Admin\.codex\skills\extract\SKILL.md (single source of truth).
    // Gene detail must consume the same in-card action pattern as the shared card surfaces.
    // Keeping a second action bar under the card is what caused vote drift, redundant links,
    // and the off-spec color chip panel the user asked to remove.
    var voteSlotMarkup = portraitAssetSha
      ? '<div class="iconoplasm-tooltip-vote-slot" data-icono-gene-vote-slot>' +
        voteBoxMarkup("", { variant: isArchivalVariant ? "label" : "" }) +
        "</div>"
      : ""
    var bodyHtml = isArchivalVariant
      ? isLitArchivalVariant
        ? buildLitArchivalBodyMarkup(detail || g, {
            mode: "sheet",
            mobileReview: false,
            voteHtml: portraitAssetSha ? labelVoteBoxMarkup(g, "data-icono-gene-vote-box") : "",
          })
        : IconoCardShared.renderLabLabelCardHtml(detail || g, {
            voteHtml: portraitAssetSha ? labelVoteBoxMarkup(g, "data-icono-gene-vote-box") : "",
          })
      : '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-shared-card-header-row">' +
        '<div class="icono-shared-card-header-copy">' +
        '<div class="iconoplasm-tooltip-symbol">' +
        esc(g.symbol) +
        "</div>" +
        '<div class="iconoplasm-tooltip-name">' +
        esc(g.full_name || g.symbol) +
        "</div>" +
        "</div>" +
        voteSlotMarkup +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta" data-icono-card-meta>' +
        metaHtml +
        "</div>" +
        "</div>" +
        mobileRowsHtml

    return (
      '<article class="icono-card icono-card--brick icono-card--brick-static icono-gene-lead-card' +
      archivalVariantClass(cardVariant) +
      '" style="--width:' +
      dims.width +
      ";--height:" +
      dims.height +
      ";--icono-card-accent:" +
      esc(g.color || "#888") +
      '" data-icono-card-variant="' +
      esc(cardVariant) +
      '">' +
      portraitMarkup +
      '<div class="iconoplasm-tooltip-body">' +
      bodyHtml +
      "</div>" +
      "</article>"
    )
  }

  function hydrateBrickPortrait(card, genePayload) {
    if (!card) return
    var portrait = card.querySelector(".iconoplasm-tooltip-portrait")
    var portraitImg = card.querySelector(".iconoplasm-tooltip-portrait-img")
    if (!portrait || !portraitImg) return
    var portraitUrl = publishedPortraitUrl(genePayload, "medium")
    if (!portraitUrl) {
      portrait.classList.remove("iconoplasm-tooltip-portrait--ready")
      portrait.classList.add("iconoplasm-tooltip-portrait-missing")
      portraitImg.removeAttribute("src")
      return
    }
    var dims = portraitDimensions(genePayload)
    portrait.classList.remove("iconoplasm-tooltip-portrait-missing")
    portrait.classList.add("iconoplasm-tooltip-portrait--ready")
    portraitImg.setAttribute("src", portraitUrl)
    // Hydration should keep the same loading strategy as initial brick markup so a returned card
    // does not downgrade to a slower image fetch after click-through/back navigation.
    portraitImg.setAttribute("loading", "eager")
    portraitImg.setAttribute("fetchpriority", "low")
    portraitImg.setAttribute("width", String(dims.width))
    portraitImg.setAttribute("height", String(dims.height))
    portraitImg.setAttribute("alt", normalizedSymbol(genePayload.symbol) + " portrait")
    card.style.setProperty("--width", String(dims.width))
    card.style.setProperty("--height", String(dims.height))
  }

  function ensureBrickVoteBox(card, genePayload) {
    if (!card) return
    if (isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) return
    var headerRow = card.querySelector(".icono-brick-header-row")
    if (!headerRow) return
    var assetSha = brickVoteAssetSha(genePayload)
    var existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    if (!assetSha) {
      if (existing) existing.remove()
      return
    }
    if (!existing) {
      headerRow.insertAdjacentHTML("beforeend", brickVoteBoxMarkup(genePayload))
      existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    } else if (existing.getAttribute("data-icono-brick-vote-box") !== assetSha) {
      existing.outerHTML = brickVoteBoxMarkup(genePayload)
      existing = headerRow.querySelector("[data-icono-brick-vote-box]")
    }
    if (!existing) return
    // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Optimistic UI) +
    // C:\Users\Admin\.codex\skills\polish\SKILL.md (Interaction states).
    // Brick votes must show the user's prior choice before hover. Deferring these snapshots
    // until pointer intent is what made the gallery look unresponsive and inconsistent.
    wireVoteBox(existing, card.getAttribute("data-icono-symbol"), assetSha, {
      deferSnapshot: false,
    })
  }

  function hydrateBrickCard(card, genePayload) {
    if (!card) return
    if (genePayload) hydrateBrickPortrait(card, genePayload)
    if (isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) {
      var body = card.querySelector(".iconoplasm-tooltip-body")
      var portraitShell = card.querySelector(".iconoplasm-tooltip-portrait")
      var cardVariant = card.getAttribute("data-icono-card-variant")
      if (body) {
        body.innerHTML =
          cardVariant === "lit-archival"
            ? buildLitArchivalBodyMarkup(genePayload, {
                mode: "brick",
                mobileReview: isMobileLabelReviewEnabled(),
                titleHref: "/gene/" + esc(encodeURIComponent(genePayload.symbol || "")),
                voteHtml: labelVoteBoxMarkup(genePayload, "data-icono-brick-vote-box"),
              })
            : buildLabLabelBrickBodyMarkup(
                genePayload,
                labelVoteBoxMarkup(genePayload, "data-icono-brick-vote-box"),
                "/gene/" + esc(encodeURIComponent(genePayload.symbol || "")),
              )
      }
      if (portraitShell) {
        var dims = portraitDimensions(genePayload)
        var portraitUrl = publishedPortraitUrl(genePayload, "medium")
        var portraitFullUrl = publishedPortraitUrl(genePayload, "full") || portraitUrl
        var labelPortraitHtml = buildLabLabelPortraitMediaMarkup(
          genePayload.symbol,
          portraitUrl,
          portraitFullUrl,
          dims,
          "low",
        )
        if (portraitUrl) portraitShell.setAttribute("data-icono-lightbox", "")
        else portraitShell.removeAttribute("data-icono-lightbox")
        portraitShell.innerHTML = IconoCardShared.renderLabLabelSpecimenRailHtml(
          labelPortraitHtml,
          genePayload,
        )
      }
      if (isMobileLabelReviewEnabled()) {
        wireMobileLabelCard(card)
        setMobileLabelExpanded(card, false)
      } else {
        resetMobileLabelCardState(card)
      }
      refreshPortraitLightbox()
      return
    }
    var meta = card.querySelector("[data-icono-card-meta]")
    var mobileMeta = card.querySelector("[data-icono-card-mobile-meta]")
    var metaRows = collectTooltipMetaRows(genePayload)
    if (meta) {
      meta.classList.remove("iconoplasm-tooltip-meta--loading")
      meta.innerHTML = renderTooltipMetaRowsHtml(metaRows)
    }
    if (mobileMeta) {
      mobileMeta.outerHTML = renderTooltipMobileRowGridHtml(metaRows, "data-icono-card-mobile-meta")
    }
    ensureBrickVoteBox(card, genePayload)
    refreshPortraitLightbox()
  }

  function hydrateBrickCards(cards) {
    var queue = []
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      var card = items[i]
      if (!card || !card.classList || !card.classList.contains("icono-card--brick")) continue
      var symbol = normalizedSymbol(card.getAttribute("data-icono-symbol"))
      if (!symbol) continue
      if (portraitDetailCache[symbol]) {
        hydrateBrickCard(card, portraitDetailCache[symbol])
        continue
      }
      queue.push({ card: card, symbol: symbol })
    }
    if (!queue.length) return Promise.resolve(null)

    var workerCount = Math.min(PREFETCH_DETAIL_CONCURRENCY, queue.length)
    var workers = []

    function next() {
      var entry = queue.shift()
      if (!entry) return Promise.resolve(null)
      return fetchGeneDetail(entry.symbol)
        .then(function (genePayload) {
          if (!entry.card.isConnected) return null
          hydrateBrickCard(entry.card, genePayload)
          return null
        })
        .then(next)
    }

    for (var j = 0; j < workerCount; j++) {
      workers.push(next())
    }
    return Promise.all(workers).then(function () {
      return null
    })
  }

  function showVoteLoginPopup() {
    if (voteLoginRedirectPending) return
    voteLoginRedirectPending = true
    window.location.assign(voteLoginUrl())
  }

  function voteBoxMarkup(extraAttrs, options) {
    return IconoCardShared.voteBoxMarkup(extraAttrs, options)
  }

  function wireVoteBox(box, symbolValue, assetShaValue, options) {
    var opts = options || {}
    return IconoCardShared.wireVoteBox(box, {
      symbol: symbolValue,
      assetSha: assetShaValue,
      visionId: opts.visionId || "",
      candidateImageId: opts.candidateImageId || 0,
      deferSnapshot: !!opts.deferSnapshot,
      apiBaseUrl: API,
      onAuthRequired: showVoteLoginPopup,
      onError: function (phase, err) {
        console.error("[Iconoplasm] vote " + phase + " error:", err)
      },
    })
  }

  function wireBrickVoteBoxes(cards) {
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      var card = items[i]
      if (!card || !card.classList || !card.classList.contains("icono-card--brick")) continue
      var box = card.querySelector("[data-icono-brick-vote-box]")
      if (!box) continue
      wireVoteBox(
        box,
        card.getAttribute("data-icono-symbol"),
        box.getAttribute("data-icono-brick-vote-box"),
        {
          deferSnapshot: false,
          visionId: box.getAttribute("data-icono-vision-id") || "",
          candidateImageId: box.getAttribute("data-icono-candidate-image-id") || 0,
        },
      )
    }
  }

  function isMobileLabelReviewEnabled() {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches
  }

  function resetMobileLabelCardState(card) {
    if (!card) return
    card.removeAttribute("data-icono-mobile-label-wired")
    card.removeAttribute("data-icono-mobile-review-active")
    card.removeAttribute("data-icono-mobile-expanded")
    card.removeAttribute("data-icono-mobile-swiping")
    card.removeAttribute("data-icono-mobile-swipe-pending")
    card.removeAttribute("data-icono-mobile-swipe-dir")
    card.style.removeProperty("--icono-label-mobile-swipe-offset")
    card.style.removeProperty("--icono-label-mobile-swipe-rotate")
    card.style.removeProperty("--icono-label-mobile-dossier-top")
  }

  function alignExpandedMobileLabelCard(card) {
    if (!card || typeof window === "undefined" || !isMobileLabelReviewEnabled()) return
    // The mobile archival sheet is now positioned entirely by CSS. Do not re-introduce
    // measurement-driven inline offsets here; they break the one-physical-card illusion and
    // produce false positives in DOM-only validation.
    card.style.removeProperty("--icono-label-mobile-dossier-top")
  }

  function syncMobileLabelDossierContent(card) {
    if (!card) return
    var isMobileReview = isMobileLabelReviewEnabled()
    if (isMobileReview) card.setAttribute("data-icono-mobile-review-active", "true")
    else card.removeAttribute("data-icono-mobile-review-active")

    var portrait = card.querySelector(".iconoplasm-tooltip-portrait")
    var footer = card.querySelector(".icono-label-specimen-footer")
    var alignmentBody = card.querySelector(".icono-label-dossier-shell .icono-label-alignment-body")
    if (!footer || !portrait) return

    var footerAnchor = portrait.querySelector("[data-icono-specimen-footer-anchor]")
    if (!footerAnchor && typeof document !== "undefined") {
      footerAnchor = document.createElement("span")
      footerAnchor.setAttribute("data-icono-specimen-footer-anchor", "")
      footerAnchor.hidden = true
      portrait.insertBefore(footerAnchor, footer)
    }

    if (isMobileReview && alignmentBody) {
      // Mobile keeps one canonical footer node, but relocates it below Alignment so all
      // color/decomposition material lives in the dossier tail instead of the portrait rail.
      if (footer.parentElement !== alignmentBody) alignmentBody.appendChild(footer)
      footer.setAttribute("data-icono-mobile-footer-relocated", "true")
      return
    }

    if (footerAnchor && footer.parentElement !== portrait) {
      portrait.insertBefore(footer, footerAnchor.nextSibling)
    }
    footer.removeAttribute("data-icono-mobile-footer-relocated")
  }

  function setMobileLabelExpanded(card, expanded) {
    if (!card) return
    syncMobileLabelDossierContent(card)
    var resolved = !!expanded
    card.setAttribute("data-icono-mobile-expanded", resolved ? "true" : "false")
    var toggle = card.querySelector("[data-icono-label-mobile-toggle]")
    if (toggle) toggle.setAttribute("aria-expanded", resolved ? "true" : "false")
    alignExpandedMobileLabelCard(card)
  }

  function setMobileLabelQcCopy(card, copy) {
    if (!card) return
    var note = card.querySelector("[data-icono-qc-note], [data-icono-mobile-qc-note]")
    if (!note) return
    note.textContent = String(copy || "").trim() || "pending review"
  }

  function nextBrickCard(card) {
    var node = card && card.nextElementSibling
    while (node) {
      if (node.classList && node.classList.contains("icono-card--brick")) return node
      node = node.nextElementSibling
    }
    return null
  }

  function advanceToNextBrick(card) {
    var nextCard = nextBrickCard(card)
    if (!nextCard || typeof nextCard.scrollIntoView !== "function") return
    window.setTimeout(function () {
      nextCard.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }, 140)
  }

  function clearMobileLabelSwipeState(card) {
    if (!card) return
    card.removeAttribute("data-icono-mobile-swiping")
    card.removeAttribute("data-icono-mobile-swipe-pending")
    card.removeAttribute("data-icono-mobile-swipe-dir")
    card.style.removeProperty("--icono-label-mobile-swipe-offset")
    card.style.removeProperty("--icono-label-mobile-swipe-rotate")
    card.style.removeProperty("--icono-label-mobile-reject-circle-opacity")
    card.style.removeProperty("--icono-label-mobile-approve-circle-opacity")
  }

  function updateMobileLabelSwipeDirection(card, dx) {
    if (!card) return
    if (!Number.isFinite(dx) || Math.abs(dx) < 1) {
      if (card.getAttribute("data-icono-mobile-swipe-pending") !== "true") {
        card.removeAttribute("data-icono-mobile-swipe-dir")
      }
      card.style.setProperty("--icono-label-mobile-reject-circle-opacity", "0")
      card.style.setProperty("--icono-label-mobile-approve-circle-opacity", "0")
      return
    }
    var direction = dx > 0 ? "right" : "left"
    card.setAttribute("data-icono-mobile-swipe-dir", direction)
    card.style.setProperty(
      "--icono-label-mobile-reject-circle-opacity",
      direction === "left" ? "0.42" : "0",
    )
    card.style.setProperty(
      "--icono-label-mobile-approve-circle-opacity",
      direction === "right" ? "0.42" : "0",
    )
  }

  function commitMobileLabelSwipe(card, direction) {
    if (!card) return
    if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
    var box = card.querySelector("[data-icono-brick-vote-box]")
    var button = box
      ? box.querySelector(direction > 0 ? "[data-icono-vote-up]" : "[data-icono-vote-down]")
      : null
    if (!button) {
      clearMobileLabelSwipeState(card)
      return
    }
    card.setAttribute("data-icono-mobile-swipe-pending", "true")
    card.setAttribute("data-icono-mobile-swipe-dir", direction > 0 ? "right" : "left")
    card.style.setProperty(
      "--icono-label-mobile-swipe-offset",
      (direction > 0 ? 1 : -1) * Math.min(window.innerWidth * 0.48, 280) + "px",
    )
    card.style.setProperty("--icono-label-mobile-swipe-rotate", (direction > 0 ? 7 : -7) + "deg")
    card.style.setProperty(
      "--icono-label-mobile-reject-circle-opacity",
      direction > 0 ? "0" : "0.56",
    )
    card.style.setProperty(
      "--icono-label-mobile-approve-circle-opacity",
      direction > 0 ? "0.56" : "0",
    )
    button.click()
    if (currentUser) {
      setMobileLabelQcCopy(card, direction > 0 ? "looks viable" : "flagged misfit")
      advanceToNextBrick(card)
    } else {
      setMobileLabelQcCopy(card, "pending review")
    }
    window.setTimeout(function () {
      clearMobileLabelSwipeState(card)
    }, 320)
  }

  function wireMobileLabelCard(card) {
    if (!card || !card.classList || !card.classList.contains("icono-card--variant-lab-label"))
      return
    if (card.classList.contains("icono-card--brick-static")) return
    if (!isMobileLabelReviewEnabled()) {
      resetMobileLabelCardState(card)
      return
    }
    if (card.getAttribute("data-icono-mobile-label-wired") === "true") return
    card.setAttribute("data-icono-mobile-label-wired", "true")
    syncMobileLabelDossierContent(card)
    setMobileLabelExpanded(card, false)

    var gesture = {
      pointerId: null,
      startX: 0,
      startY: 0,
      dx: 0,
      dragging: false,
      locked: false,
    }

    function resetGesture() {
      gesture.pointerId = null
      gesture.startX = 0
      gesture.startY = 0
      gesture.dx = 0
      gesture.dragging = false
      gesture.locked = false
      if (card.getAttribute("data-icono-mobile-swipe-pending") !== "true") {
        clearMobileLabelSwipeState(card)
      }
    }

    card.addEventListener(
      "click",
      function (event) {
        if (!isMobileLabelReviewEnabled()) return
        var portraitHotzone =
          event.target && event.target.closest
            ? event.target.closest(
                ".icono-label-specimen-viewport, .iconoplasm-tooltip-portrait-media, .iconoplasm-tooltip-portrait-fallback",
              )
            : null
        if (portraitHotzone && card.contains(portraitHotzone)) {
          event.preventDefault()
          event.stopPropagation()
          if (card.getAttribute("data-icono-mobile-expanded") !== "true") {
            setMobileLabelExpanded(card, true)
          }
          return
        }
      },
      true,
    )

    card.addEventListener("click", function (event) {
      var toggle =
        event.target && event.target.closest
          ? event.target.closest("[data-icono-label-mobile-toggle]")
          : null
      if (!toggle) return
      event.preventDefault()
      if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
      setMobileLabelExpanded(card, card.getAttribute("data-icono-mobile-expanded") !== "true")
    })

    card.addEventListener("pointerdown", function (event) {
      if (!isMobileLabelReviewEnabled()) return
      if (card.getAttribute("data-icono-mobile-swipe-pending") === "true") return
      if (card.getAttribute("data-icono-mobile-expanded") === "true") return
      if (event.pointerType === "mouse") return
      if (event.button != null && event.button !== 0) return
      var target = event.target
      if (
        target &&
        target.closest &&
        target.closest(
          "[data-icono-label-mobile-toggle], [data-icono-vote-box], [data-icono-nav], a",
        )
      ) {
        return
      }
      if (typeof card.setPointerCapture === "function") card.setPointerCapture(event.pointerId)
      gesture.pointerId = event.pointerId
      gesture.startX = event.clientX
      gesture.startY = event.clientY
      gesture.dx = 0
      gesture.dragging = false
      gesture.locked = false
      card.removeAttribute("data-icono-mobile-swipe-dir")
    })

    card.addEventListener("pointermove", function (event) {
      if (gesture.pointerId !== event.pointerId) return
      var dx = event.clientX - gesture.startX
      var dy = event.clientY - gesture.startY
      updateMobileLabelSwipeDirection(card, dx)
      if (!gesture.dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
        if (Math.abs(dy) > Math.abs(dx) * 1.15) {
          gesture.locked = true
          resetGesture()
          return
        }
        gesture.dragging = true
      }
      if (gesture.locked) return
      gesture.dx = dx
      card.setAttribute("data-icono-mobile-swiping", "true")
      card.style.setProperty("--icono-label-mobile-swipe-offset", dx + "px")
      card.style.setProperty("--icono-label-mobile-swipe-rotate", dx / 22 + "deg")
    })

    function finishPointer(event) {
      if (gesture.pointerId !== event.pointerId) return
      if (
        typeof card.releasePointerCapture === "function" &&
        card.hasPointerCapture(event.pointerId)
      ) {
        card.releasePointerCapture(event.pointerId)
      }
      if (!gesture.dragging) {
        resetGesture()
        return
      }
      var threshold = Math.max(72, Math.min(116, Math.round(card.clientWidth * 0.22)))
      var direction = gesture.dx > 0 ? 1 : -1
      if (Math.abs(gesture.dx) >= threshold) commitMobileLabelSwipe(card, direction)
      else clearMobileLabelSwipeState(card)
      resetGesture()
    }

    card.addEventListener("pointerup", finishPointer)
    card.addEventListener("pointercancel", finishPointer)
  }

  function wireMobileLabelCards(cards) {
    var items = Array.isArray(cards) ? cards : []
    for (var i = 0; i < items.length; i++) {
      wireMobileLabelCard(items[i])
    }
  }

  function wireGeneVoteBox(container, genePayload) {
    var box = container.querySelector("[data-icono-vote-box]")
    if (!box) return
    var symbol = String((genePayload && genePayload.symbol) || "")
      .trim()
      .toUpperCase()
    var portrait = (genePayload && genePayload.portrait) || {}
    wireVoteBox(box, symbol, portrait.asset_sha256, {
      visionId: portrait.vision_id || "",
      candidateImageId: portrait.candidate_image_id || 0,
    })
  }

  function wireCandidateVoteBoxes(container, genePayload) {
    if (!container || !genePayload) return
    var symbol = String(genePayload.symbol || "")
      .trim()
      .toUpperCase()
    var boxes = container.querySelectorAll("[data-icono-candidate-vote-box]")
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i]
      wireVoteBox(box, symbol, box.getAttribute("data-icono-candidate-vote-box"), {
        visionId: box.getAttribute("data-icono-vision-id") || "",
        candidateImageId: box.getAttribute("data-icono-candidate-image-id") || 0,
      })
    }
  }

  /* ─── Client-side router ─── */

  function getRoute() {
    var path = window.location.pathname
    if (path === "/" || path === "") return { page: "home" }
    var m = path.match(/^\/gene\/(.+)$/)
    if (m) return { page: "gene", symbol: decodeURIComponent(m[1]) }
    return { page: "404" }
  }

  /* ─── Rendering: Home page ─── */

  function renderHome(root, restoreState) {
    var homeLayout = resolveHomeLayout()
    var pendingRestoreState = restoreState || null
    var activeRestoreState = pendingRestoreState
    iconoSidebarState.page = "home"
    iconoSidebarState.homeLayout = homeLayout
    iconoSidebarState.total = 0
    iconoSidebarState.publishedTotal = 0
    iconoSidebarState.gene = null
    renderIconoplasmSidebar()
    var hasExistingShell =
      root.querySelector("#icono-grid") &&
      root.querySelector("#icono-q") &&
      root.querySelector("#icono-order")
    if (!hasExistingShell) {
      root.innerHTML = buildHomeShellMarkup(homeLayout)
    }

    var grid = document.getElementById("icono-grid")
    var loading = document.getElementById("icono-loading")
    var countEl = document.getElementById("icono-gene-count")
    var sentinelEl = document.getElementById("icono-load-sentinel")
    var input = document.getElementById("icono-q")
    var resultsEl = document.getElementById("icono-results")
    var orderEl = document.getElementById("icono-order")
    var activeGalleryRequest = 0
    var galleryState = {
      order: GALLERY_DEFAULT_ORDER,
      offset: 0,
      total: 0,
      publishedTotal: 0,
      loading: false,
      hasMore: true,
      seed: "",
      items: [],
      prefillTarget: GALLERY_PAGE_SIZE,
    }
    var sentinelObserver = null
    var backgroundPrefillTimer = null
    var scrollRestored = !activeRestoreState

    function newRandomSeed() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    }

    function clearBackgroundPrefill() {
      if (backgroundPrefillTimer) {
        window.clearTimeout(backgroundPrefillTimer)
        backgroundPrefillTimer = null
      }
    }

    function currentGalleryLimit() {
      if (galleryState.offset === 0) return GALLERY_INITIAL_PAGE_SIZE
      if (galleryState.offset < galleryState.prefillTarget) {
        return Math.max(1, galleryState.prefillTarget - galleryState.offset)
      }
      return GALLERY_PAGE_SIZE
    }

    function setLoadingState(message, show) {
      var text = String(message || "").trim()
      loading.textContent = text
      loading.hidden = !(show && text)
    }

    function syncHeroCount() {
      if (!countEl) return
      var publishedCount = Number(galleryState.publishedTotal || 0)
      var totalCount = Number(galleryState.total || 0)
      iconoSidebarState.total = totalCount
      iconoSidebarState.publishedTotal = publishedCount
      renderIconoplasmSidebar()
      countEl.textContent =
        totalCount.toLocaleString() +
        " human genes, " +
        publishedCount.toLocaleString() +
        " AI images"
    }

    function updateSentinelObserver() {
      if (sentinelObserver) {
        sentinelObserver.disconnect()
        sentinelObserver = null
      }
      if (!sentinelEl || !galleryState.hasMore) return
      sentinelObserver = new IntersectionObserver(
        function (entries) {
          var entry = entries && entries[0]
          if (!entry || !entry.isIntersecting) return
          loadNextGalleryPage()
        },
        {
          rootMargin: "900px 0px 1200px 0px",
        },
      )
      sentinelObserver.observe(sentinelEl)
    }

    function maybeRestoreHomeScroll() {
      if (!activeRestoreState || scrollRestored) return
      if (galleryState.offset < activeRestoreState.loadedCount && galleryState.hasMore) return
      scrollRestored = true
      var targetY = Math.max(0, Number(activeRestoreState.scrollY || 0) || 0)
      window.requestAnimationFrame(function () {
        window.scrollTo(0, targetY)
        if (activeRestoreState.focusSymbol) {
          window.requestAnimationFrame(function () {
            var cards = grid.querySelectorAll(".icono-card[data-icono-symbol]")
            for (var i = 0; i < cards.length; i++) {
              var card = cards[i]
              if (
                String(card.getAttribute("data-icono-symbol") || "")
                  .trim()
                  .toUpperCase() !== activeRestoreState.focusSymbol
              ) {
                continue
              }
              var rect = card.getBoundingClientRect()
              window.scrollBy(0, Math.round(rect.top - Number(activeRestoreState.focusTop || 0)))
              break
            }
          })
        }
      })
    }

    function snapshotHomeState() {
      return {
        order: galleryState.order,
        seed: galleryState.seed,
        loadedCount: galleryState.offset,
        scrollY: Math.max(0, Math.round(window.scrollY || window.pageYOffset || 0)),
        focusSymbol: pendingHomeAnchor ? pendingHomeAnchor.focusSymbol : "",
        focusTop: pendingHomeAnchor ? pendingHomeAnchor.focusTop : 0,
      }
    }

    function resetGallery(order) {
      var resolvedOrder = order || GALLERY_DEFAULT_ORDER
      var restoreConfig =
        pendingRestoreState && pendingRestoreState.order === resolvedOrder
          ? pendingRestoreState
          : null
      pendingRestoreState = null
      activeRestoreState = restoreConfig
      scrollRestored = !restoreConfig
      galleryState.order = resolvedOrder
      galleryState.offset = 0
      galleryState.total = 0
      galleryState.publishedTotal = 0
      galleryState.loading = false
      galleryState.hasMore = true
      galleryState.seed =
        restoreConfig && restoreConfig.seed
          ? restoreConfig.seed
          : galleryState.order === "random"
            ? newRandomSeed()
            : ""
      galleryState.items = []
      galleryState.prefillTarget = Math.max(
        GALLERY_PAGE_SIZE,
        Number((restoreConfig && restoreConfig.loadedCount) || 0) || 0,
      )
      clearBackgroundPrefill()
      grid.setAttribute("data-layout", homeLayout)
      grid.setAttribute("aria-busy", "true")
      grid.innerHTML = buildHomeSkeletonGridMarkup(homeLayout)
      destroyHomeMasonry()
      if (typeof grid._iconoPrefetchCleanup === "function") {
        grid._iconoPrefetchCleanup()
      }
      setLoadingState("", false)
      updateSentinelObserver()
      if (!restoreConfig) {
        window.scrollTo(0, 0)
      }
      syncHomeHistoryState(false)
      loadNextGalleryPage()
    }

    function loadNextGalleryPage() {
      if (galleryState.loading || !galleryState.hasMore) return
      galleryState.loading = true
      setLoadingState("", false)
      var pageLimit = currentGalleryLimit()

      var requestId = ++activeGalleryRequest
      var path =
        "/api/public/v1/gallery?order=" +
        encodeURIComponent(galleryState.order) +
        "&limit=" +
        encodeURIComponent(String(pageLimit)) +
        "&offset=" +
        encodeURIComponent(String(galleryState.offset))
      if (galleryState.seed) {
        path += "&seed=" + encodeURIComponent(galleryState.seed)
      }

      var requestPromise = consumeBootstrapGallery(
        galleryState.order,
        pageLimit,
        galleryState.offset,
      )
      if (!requestPromise) {
        requestPromise = fetchJSON(path)
      }

      requestPromise
        .then(function (data) {
          if (requestId !== activeGalleryRequest) return
          var items = Array.isArray(data && data.items) ? data.items : []
          var isFirstPage = galleryState.offset === 0
          galleryState.order = String((data && data.order) || galleryState.order)
          galleryState.seed = String((data && data.seed) || galleryState.seed || "")
          galleryState.total = Number((data && data.total) || galleryState.total || 0)
          galleryState.publishedTotal = Number(
            (data && data.published_total) || galleryState.publishedTotal || 0,
          )
          galleryState.hasMore = Boolean(data && data.has_more)
          if (isFirstPage) {
            grid.innerHTML = ""
            grid.setAttribute("data-layout", homeLayout)
            grid.setAttribute("aria-busy", "false")
          }
          if (items.length) {
            var newCards = appendGrid(grid, items, galleryState.items.length, homeLayout)
            galleryState.items = galleryState.items.concat(items)
            galleryState.offset += items.length
            if (homeLayout === "masonry") {
              applyHomeMasonry(grid, newCards)
              setupOrderedPortraitPrefetch(grid, galleryState.items)
            } else {
              destroyHomeMasonry()
              warmBrickCardImages(items)
              wireBrickVoteBoxes(newCards)
              wireMobileLabelCards(newCards)
              refreshPortraitLightbox()
              void hydrateBrickCards(newCards)
            }
            if (
              isFirstPage &&
              galleryState.offset < galleryState.prefillTarget &&
              galleryState.hasMore
            ) {
              clearBackgroundPrefill()
              backgroundPrefillTimer = window.setTimeout(function () {
                backgroundPrefillTimer = null
                loadNextGalleryPage()
              }, 140)
            }
          }
          syncHeroCount()
          updateSentinelObserver()
          setLoadingState("", false)
          syncHomeHistoryState(false)
          maybeRestoreHomeScroll()
          if (orderEl && orderEl.value !== galleryState.order) {
            orderEl.value = galleryState.order
          }
        })
        .catch(function (err) {
          if (requestId !== activeGalleryRequest) return
          grid.setAttribute("aria-busy", "false")
          setLoadingState("Failed to load portraits.", true)
          console.error("[Iconoplasm] gallery load error:", err)
        })
        .finally(function () {
          if (requestId === activeGalleryRequest) {
            galleryState.loading = false
          }
        })
    }

    if (orderEl) {
      orderEl.addEventListener("change", function () {
        resetGallery(orderEl.value || GALLERY_DEFAULT_ORDER)
      })
    }

    activeHomeHistorySnapshot = snapshotHomeState
    var handleHomeScroll = function () {
      syncHomeHistoryState(false)
    }
    window.addEventListener("scroll", handleHomeScroll, { passive: true })
    activeHomeRenderCleanup = function () {
      if (sentinelObserver) {
        sentinelObserver.disconnect()
        sentinelObserver = null
      }
      clearBackgroundPrefill()
      window.removeEventListener("scroll", handleHomeScroll)
    }

    resetGallery(pendingRestoreState ? pendingRestoreState.order : GALLERY_DEFAULT_ORDER)

    // Search with debounce
    var timer = null
    var activeIndex = -1
    var currentResults = []

    input.addEventListener("input", function () {
      var q = input.value.trim()
      clearTimeout(timer)
      activeIndex = -1
      if (!q) {
        resultsEl.innerHTML = ""
        return
      }
      timer = setTimeout(function () {
        fetchJSON("/api/public/v1/genes/search?q=" + encodeURIComponent(q) + "&limit=12")
          .then(function (data) {
            currentResults = data.genes || []
            renderSearchResults(resultsEl, currentResults)
          })
          .catch(function () {
            resultsEl.innerHTML = ""
          })
      }, DEBOUNCE_MS)
    })

    // Keyboard navigation in search dropdown
    input.addEventListener("keydown", function (e) {
      var items = resultsEl.querySelectorAll(".icono-search-result")
      if (!items.length) {
        if (e.key === "Enter") {
          var v = input.value.trim().toUpperCase()
          if (v) navigateTo("/gene/" + encodeURIComponent(v))
        }
        return
      }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        activeIndex = Math.min(activeIndex + 1, items.length - 1)
        highlightResult(items, activeIndex)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        activeIndex = Math.max(activeIndex - 1, -1)
        highlightResult(items, activeIndex)
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (activeIndex >= 0 && currentResults[activeIndex]) {
          navigateTo("/gene/" + encodeURIComponent(currentResults[activeIndex].symbol))
        } else {
          var v2 = input.value.trim().toUpperCase()
          if (v2) navigateTo("/gene/" + encodeURIComponent(v2))
        }
      } else if (e.key === "Escape") {
        resultsEl.innerHTML = ""
        activeIndex = -1
      }
    })

    // Close search results when clicking outside
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".icono-search-wrapper")) {
        resultsEl.innerHTML = ""
      }
    })
  }

  function highlightResult(items, idx) {
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === idx)
    }
  }

  function renderSearchResults(container, genes) {
    if (!genes.length) {
      container.innerHTML =
        '<div class="icono-search-result" style="pointer-events:none;opacity:0.5;">No results</div>'
      return
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      html +=
        '<a class="icono-search-result" href="/gene/' +
        esc(encodeURIComponent(g.symbol)) +
        '" data-icono-nav>' +
        '<span class="icono-search-result-swatch" style="background:' +
        esc(g.color) +
        '"></span>' +
        '<span class="icono-search-result-symbol">' +
        esc(g.symbol) +
        "</span>" +
        '<span class="icono-search-result-name">' +
        esc(g.full_name) +
        "</span>" +
        "</a>"
    }
    container.innerHTML = html
  }

  function buildMasonryGridMarkup(genes, startIndex) {
    if (!genes.length) {
      return ""
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      var cardIndex = startIndex + i
      var dims = portraitDimensions(g)
      var tc = textColorFor(g.color)
      var portraitUrl = publishedPortraitUrl(g, "medium")
      var mediaClass = portraitUrl
        ? "icono-card-media"
        : "icono-card-media icono-card-media--fallback"
      html +=
        '<a class="icono-card icono-card--masonry" href="/gene/' +
        esc(encodeURIComponent(g.symbol)) +
        '" data-icono-nav data-icono-index="' +
        cardIndex +
        '" data-icono-symbol="' +
        esc(g.symbol) +
        '" style="--width:' +
        dims.width +
        ";--height:" +
        dims.height +
        ";--icono-card-accent:" +
        esc(g.color || "#888") +
        ';">' +
        '<div class="' +
        mediaClass +
        '" style="background:' +
        esc(g.color) +
        ";color:" +
        tc +
        '">' +
        (portraitUrl
          ? // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Loading Performance) +
            // C:\Users\Admin\.codex\skills\frontend-design\SKILL.md (Motion / keep exits and
            // reveals lightweight). The first visible home cards stay eager so the public gallery
            // feels present immediately, then later cards fall back to lazy loading.
            '<img src="' +
            esc(portraitUrl) +
            '" alt="' +
            esc(g.symbol) +
            ' portrait" loading="' +
            (cardIndex < 12 ? "eager" : "lazy") +
            '" decoding="async" width="' +
            dims.width +
            '" height="' +
            dims.height +
            '" fetchpriority="' +
            (cardIndex < 8 ? "high" : "low") +
            '">'
          : '<span class="icono-card-fallback-symbol">' + esc(g.symbol) + "</span>") +
        '<span class="icono-card-badge">' +
        esc(g.symbol) +
        "</span>" +
        "</div>" +
        '<div class="icono-card-info">' +
        '<div class="icono-card-name">' +
        esc(g.full_name) +
        "</div>" +
        "</div>" +
        "</a>"
    }
    return html
  }

  function buildBrickGridMarkup(genes, startIndex) {
    if (!genes.length) {
      return ""
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      html += buildBrickCardMarkup(genes[i], startIndex + i)
    }
    return html
  }

  function renderGrid(container, genes, layout) {
    var resolvedLayout = layout || resolveHomeLayout()
    container.innerHTML =
      resolvedLayout === "masonry"
        ? buildMasonryGridMarkup(genes, 0)
        : buildBrickGridMarkup(genes, 0)
  }

  function appendGrid(container, genes, startIndex, layout) {
    var resolvedLayout = layout || resolveHomeLayout()
    var html =
      resolvedLayout === "masonry"
        ? buildMasonryGridMarkup(genes, startIndex)
        : buildBrickGridMarkup(genes, startIndex)
    if (!html) return []
    var wrapper = document.createElement("div")
    wrapper.innerHTML = html
    var newElements = Array.prototype.slice.call(wrapper.children)
    for (var i = 0; i < newElements.length; i++) {
      container.appendChild(newElements[i])
    }
    return newElements
  }

  function renderCandidateGallery(genePayload) {
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var visibleCandidates = []
    for (var i = 0; i < candidates.length; i++) {
      var item = candidates[i]
      if (!item || item.is_current) continue
      if (!candidatePortraitUrl(item, "medium")) continue
      visibleCandidates.push(item)
    }
    if (!visibleCandidates.length) return ""
    var gridClass =
      visibleCandidates.length === 1
        ? "icono-candidate-grid icono-candidate-grid--single"
        : "icono-candidate-grid"
    var html =
      '<section class="icono-candidate-gallery">' +
      '<div class="icono-candidate-gallery-heading">' +
      "<h2>Candidate portraits</h2>" +
      "</div>" +
      '<div class="' +
      gridClass +
      '" data-icono-lightbox>'
    for (var i = 0; i < visibleCandidates.length; i++) {
      var candidate = visibleCandidates[i]
      var mediumUrl = candidatePortraitUrl(candidate, "medium")
      var fullUrl = candidatePortraitUrl(candidate, "full") || mediumUrl
      var width = Number((candidate && candidate.width) || 4) || 4
      var height = Number((candidate && candidate.height) || 5) || 5
      var assetSha = String((candidate && candidate.asset_sha256) || "")
        .trim()
        .toLowerCase()
      var candidateImageId = Number((candidate && candidate.candidate_image_id) || 0)
      var visionId = String((candidate && candidate.vision_id) || "").trim()
      var voteAttrs = 'data-icono-candidate-vote-box="' + esc(assetSha) + '"'
      if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
        voteAttrs +=
          ' data-icono-candidate-image-id="' + esc(String(Math.round(candidateImageId))) + '"'
      }
      if (visionId) {
        voteAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
      }
      html +=
        '<article class="icono-candidate-card" style="--width:' +
        width +
        ";--height:" +
        height +
        ';">' +
        '<button type="button" class="icono-candidate-media-button" data-icono-pswp data-icono-pswp-src="' +
        esc(fullUrl) +
        '" data-icono-pswp-alt="' +
        esc(genePayload.symbol) +
        ' portrait candidate" data-pswp-width="' +
        width +
        '" data-pswp-height="' +
        height +
        '" aria-label="Open candidate portrait for ' +
        esc(genePayload.symbol) +
        '">' +
        '<span class="icono-candidate-media">' +
        // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Loading Performance) +
        // C:\Users\Admin\.codex\skills\polish\SKILL.md (Loading states / no layout shift).
        // The first visible candidate portraits stay eager so the gene page does not show large
        // empty media wells before the gallery settles; later candidates can stay lazy.
        '<img src="' +
        esc(mediumUrl) +
        '" alt="' +
        esc(genePayload.symbol) +
        ' portrait candidate" loading="' +
        (i < 2 ? "eager" : "lazy") +
        '" decoding="async" fetchpriority="' +
        (i < 2 ? "high" : "low") +
        '" width="' +
        width +
        '" height="' +
        height +
        '">' +
        "</span>" +
        "</button>" +
        '<div class="icono-candidate-footer">' +
        voteBoxMarkup(voteAttrs) +
        "</div>" +
        "</article>"
    }
    html += "</div>" + "</section>"
    return html
  }

  /* ─── Rendering: Gene detail page ─── */

  function renderGene(root, symbol) {
    iconoSidebarState.page = "gene"
    iconoSidebarState.homeLayout = resolveHomeLayout()
    iconoSidebarState.gene = {
      symbol: normalizedSymbol(symbol),
      error: false,
      hasPortrait: false,
      candidateCount: 0,
      aliasCount: 0,
    }
    renderIconoplasmSidebar()
    root.innerHTML =
      '<div class="icono-nav">' +
      '<a href="/" data-icono-nav>' +
      ICONO_ARROW_LEFT +
      "All genes</a>" +
      "</div>" +
      '<div class="icono-gene-skeleton" id="icono-gene-loading">' +
      buildBrickSkeletonCardMarkup() +
      "</div>" +
      '<div id="icono-gene-content"></div>'

    var contentEl = document.getElementById("icono-gene-content")
    var loadingEl = document.getElementById("icono-gene-loading")

    fetchJSON("/api/public/v1/genes/" + encodeURIComponent(symbol))
      .then(function (g) {
        loadingEl.style.display = "none"
        iconoSidebarState.gene = {
          symbol: normalizedSymbol(g && g.symbol ? g.symbol : symbol),
          error: false,
          hasPortrait: !!publishedPortraitUrl(g, "medium"),
          candidateCount: Array.isArray(g && g.portrait_candidates)
            ? g.portrait_candidates.length
            : 0,
          aliasCount: Array.isArray(g && g.aliases) ? g.aliases.length : 0,
        }
        renderIconoplasmSidebar()
        renderGeneContent(contentEl, g)
      })
      .catch(function (err) {
        loadingEl.style.display = "none"
        iconoSidebarState.gene = {
          symbol: normalizedSymbol(symbol),
          error: true,
          hasPortrait: false,
          candidateCount: 0,
          aliasCount: 0,
        }
        renderIconoplasmSidebar()
        contentEl.innerHTML =
          '<div class="icono-empty">' +
          "<h2>Gene not found</h2>" +
          '<p>"' +
          esc(symbol) +
          "\" doesn't match any gene in our catalog.</p>" +
          '<p><a href="/" data-icono-nav>Browse all genes</a></p>' +
          "</div>"
        console.error("[Iconoplasm] gene load error:", err)
      })
  }

  function renderGeneContent(container, g) {
    var html = '<section class="icono-gene-lead">' + buildGeneLeadCardMarkup(g)

    // Manifestation / character description
    var manifestation = g.manifestation || g.description || ""
    if (manifestation) {
      html += '<p class="icono-gene-manifestation">' + esc(manifestation) + "</p>"
    }
    html += "</section>"

    html += renderCandidateGallery(g)

    container.innerHTML = html
    wireGeneVoteBox(container, g)
    wireCandidateVoteBoxes(container, g)
    applyCandidateMasonry(container.querySelector(".icono-candidate-grid"))
    refreshPortraitLightbox()
  }

  /* ─── Rendering: 404 ─── */

  function render404(root) {
    iconoSidebarState.page = "404"
    iconoSidebarState.gene = null
    renderIconoplasmSidebar()
    root.innerHTML =
      '<div class="icono-empty">' +
      "<h2>Page not found</h2>" +
      '<p><a href="/" data-icono-nav>Back to Iconoplasm</a></p>' +
      "</div>"
  }

  /* ─── Client-side navigation ─── */

  var lastRenderedPath = null
  var activeHomeHistorySnapshot = null
  var activeHomeRenderCleanup = null
  var queuedHomeHistorySync = null
  var pendingHomeAnchor = null

  function readHistoryState() {
    var state = window.history.state
    return state && typeof state === "object" ? state : {}
  }

  function replaceHistoryStatePatch(patch) {
    var prev = readHistoryState()
    var next = {}
    var key = ""
    for (key in prev) {
      if (Object.prototype.hasOwnProperty.call(prev, key)) {
        next[key] = prev[key]
      }
    }
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        next[key] = patch[key]
      }
    }
    next.iconoplasm = true
    window.history.replaceState(next, "", window.location.href)
  }

  function syncHomeHistoryState(immediate) {
    if (!activeHomeHistorySnapshot) return
    var commit = function () {
      queuedHomeHistorySync = null
      if (!activeHomeHistorySnapshot) return
      replaceHistoryStatePatch({
        iconoplasmPage: "home",
        iconoplasmHome: activeHomeHistorySnapshot(),
      })
    }
    // The home gallery is infinite and masonry-like, so we persist loaded count + scroll instead
    // of resetting to gene 1 on every render. This state must be kept current for both browser
    // Back and the in-page "All genes" backlink to feel native.
    if (immediate) {
      if (queuedHomeHistorySync) {
        window.clearTimeout(queuedHomeHistorySync)
        queuedHomeHistorySync = null
      }
      commit()
      return
    }
    if (queuedHomeHistorySync) return
    queuedHomeHistorySync = window.setTimeout(commit, 120)
  }

  function clearActiveHomeRenderState() {
    activeHomeHistorySnapshot = null
    if (queuedHomeHistorySync) {
      window.clearTimeout(queuedHomeHistorySync)
      queuedHomeHistorySync = null
    }
    if (typeof activeHomeRenderCleanup === "function") {
      var cleanup = activeHomeRenderCleanup
      activeHomeRenderCleanup = null
      cleanup()
    }
  }

  function readHomeRestoreState() {
    var state = readHistoryState()
    if (!state || state.iconoplasmPage !== "home") return null
    var home = state.iconoplasmHome
    if (!home || typeof home !== "object") return null
    var order = String(home.order || GALLERY_DEFAULT_ORDER).trim() || GALLERY_DEFAULT_ORDER
    var loadedCount = Number(home.loadedCount || 0)
    var scrollY = Number(home.scrollY || 0)
    if (!(loadedCount > 0 || scrollY > 0)) return null
    return {
      order: order,
      seed: String(home.seed || ""),
      loadedCount: Number.isFinite(loadedCount) ? Math.max(0, Math.round(loadedCount)) : 0,
      scrollY: Number.isFinite(scrollY) ? Math.max(0, Math.round(scrollY)) : 0,
      focusSymbol: String(home.focusSymbol || ""),
      focusTop: Number.isFinite(Number(home.focusTop || 0))
        ? Math.round(Number(home.focusTop || 0))
        : 0,
    }
  }

  function captureHomeAnchor(link) {
    pendingHomeAnchor = null
    if (!link) return
    if (getRoute().page !== "home") return
    var card = link.closest(".icono-card[data-icono-symbol]")
    if (!card) return
    var symbol = String(card.getAttribute("data-icono-symbol") || "")
      .trim()
      .toUpperCase()
    if (!symbol) return
    var rect = card.getBoundingClientRect()
    pendingHomeAnchor = {
      focusSymbol: symbol,
      focusTop: Math.round(rect.top),
    }
  }

  function buildNavigationState(path) {
    var nextState = { iconoplasm: true }
    var currentState = readHistoryState()
    var carriedHomeState =
      currentState && currentState.iconoplasmHome && typeof currentState.iconoplasmHome === "object"
        ? currentState.iconoplasmHome
        : null
    if (path === "/" || path === "") {
      if (carriedHomeState) {
        nextState.iconoplasmPage = "home"
        nextState.iconoplasmHome = carriedHomeState
      }
      return nextState
    }
    // Carry the current home snapshot into gene routes so returning through "All genes" restores
    // the deep gallery position instead of constructing a fresh blank home history entry.
    if (carriedHomeState) {
      nextState.iconoplasmHome = carriedHomeState
    }
    return nextState
  }

  function navigateTo(path, link) {
    captureHomeAnchor(link)
    syncHomeHistoryState(true)
    window.history.pushState(buildNavigationState(path), "", path)
    pendingHomeAnchor = null
    render()
  }

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    clearActiveHomeRenderState()
    lastRenderedPath = window.location.pathname + window.location.search
    destroyHomeMasonry()
    destroyCandidateMasonry()
    var route = getRoute()
    var homeRestoreState = route.page === "home" ? readHomeRestoreState() : null
    // Update page title
    if (route.page === "home") {
      document.title = "Iconoplasm - Mnemonics for genes"
    } else if (route.page === "gene") {
      document.title = route.symbol + " - Iconoplasm"
    } else {
      document.title = "Not found - Iconoplasm"
    }
    // Render the appropriate page
    if (route.page === "home") {
      renderHome(root, homeRestoreState)
      refreshPortraitLightbox()
    } else if (route.page === "gene") {
      window.scrollTo(0, 0)
      renderGene(root, route.symbol)
    } else {
      window.scrollTo(0, 0)
      render404(root)
      refreshPortraitLightbox()
    }
  }

  /* ─── Event delegation for internal links ─── */

  document.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-icono-nav]")
    if (!link) return
    var href = link.getAttribute("href")
    if (!href || href.startsWith("http")) return
    e.preventDefault()
    navigateTo(href, link)
  })

  window.addEventListener("popstate", function () {
    render()
  })

  /* ─── Init ─── */

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    replaceHistoryStatePatch({})
    render()
    void refreshSharedUserState()
  }

  // Quartz uses SPA navigation, so the root might already be in the DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  // Also handle Quartz's SPA navigation events
  document.addEventListener("nav", function () {
    // Skip if navigateTo already rendered for this path
    var current = window.location.pathname + window.location.search
    if (lastRenderedPath === current) return
    // Re-init when Quartz navigates to this page
    setTimeout(init, 0)
  })
})()
