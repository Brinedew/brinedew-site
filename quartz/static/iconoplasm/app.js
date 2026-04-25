import {
  readIconoplasmSettings,
  startSharedIconoplasmSettingsAutoSync,
  syncSharedIconoplasmSettings,
} from "../site-preferences.js?v=20260425a"
import {
  HOME_COLLECTION_ORDERS,
  normalizeDiscoveryEntries,
  normalizeHomeCollectionOrder,
} from "./discovery-collection.js"
import {
  ICONOPLASM_DISCOVERY_DEFAULT_ORDER,
  ICONOPLASM_GALLERY_DEFAULT_ORDER,
} from "./home-orders.js"
import {
  buildLoginUrl,
  buildSharedUserPanelMarkup,
  fetchAuthenticatedUser,
  mountSidebarStack,
  wireSharedUserPanel,
} from "../shared/sidebar-shell.js?v=20260310d"
import "./generated/lit-archival-card.js?v=20260402a"

var initialSharedSettingsPromise = syncSharedIconoplasmSettings().catch(function () {
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
  var GALLERY_DEFAULT_ORDER = ICONOPLASM_GALLERY_DEFAULT_ORDER
  var HOME_COLLECTION_PAGE_SIZE = 24
  var HOME_COLLECTION_INITIAL_PAGE_SIZE = 12
  var HOME_COLLECTION_DEFAULT_ORDER = ICONOPLASM_DISCOVERY_DEFAULT_ORDER
  var GUEST_STARTER_GENES = [
    {
      gene_symbol: "INS",
      first_discovered_at: "2026-01-03T00:00:00.000Z",
      last_encountered_at: "2026-01-03T00:00:00.000Z",
    },
    {
      gene_symbol: "RHO",
      first_discovered_at: "2026-01-02T00:00:00.000Z",
      last_encountered_at: "2026-01-02T00:00:00.000Z",
    },
    {
      gene_symbol: "PRL",
      first_discovered_at: "2026-01-01T00:00:00.000Z",
      last_encountered_at: "2026-01-01T00:00:00.000Z",
    },
  ]
  var HOME_LAYOUT_DEFAULT = "bricks"
  var CARD_VARIANT_DEFAULT = "simple"
  var HOME_SKELETON_CARD_COUNT = 4
  var ICONO_EXTENSION_PRESENCE_EVENT = "iconoplasm-extension-presence"
  var ICONO_EXTENSION_PRESENCE_PING_EVENT = "iconoplasm-extension-presence-ping"
  var ICONO_EXTENSION_SOURCE_URL =
    "https://github.com/Brinedew/brinedew-site/tree/main/iconoplasm-extension"
  var PREFETCH_BATCH_SIZE = 20
  var PREFETCH_TRIGGER_OFFSET = 10
  var PREFETCH_DETAIL_CONCURRENCY = 4
  var ICONO_ARROW_LEFT =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style="width:14px;height:14px;vertical-align:-2px;margin-right:3px"><path d="M12.5 4 6.5 10l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var portraitDetailCache = Object.create(null)
  var portraitDetailPromiseCache = Object.create(null)
  var portraitImageCache = Object.create(null)
  var portraitImagePromiseCache = Object.create(null)
  var portraitRetainedImageCache = Object.create(null)
  var portraitRetainedImageOrder = []
  var homeMasonry = null
  var candidateMasonry = null
  var portraitLightboxCleanup = null
  var currentUser = null
  var currentUserIsIconoAdmin = false
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
  var iconoInstallState = {
    panelOpen: false,
    installed: false,
    version: "",
    installTab: "",
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

  function fetchAuthedJSON(path, init) {
    var requestInit = Object.assign({}, init || {}, {
      credentials: "include",
    })
    return fetchJSON(path, requestInit)
  }

  function fetchIconoplasmAdminState() {
    return fetch(API + "/api/iconoplasm/admin/me", {
      credentials: "include",
    })
      .then(function (response) {
        if (!response.ok) return { authenticated: false, is_admin: false, user: null }
        return response.json().catch(function () {
          return { authenticated: false, is_admin: false, user: null }
        })
      })
      .catch(function () {
        return { authenticated: false, is_admin: false, user: null }
      })
  }

  function fetchDiscoveryState(order, seed) {
    var resolvedOrder = normalizeHomeCollectionOrder(order || HOME_COLLECTION_DEFAULT_ORDER)
    var path = "/api/iconoplasm/discoveries/me?order=" + encodeURIComponent(resolvedOrder)
    if (resolvedOrder === "random" && seed) {
      path += "&seed=" + encodeURIComponent(String(seed))
    }
    return fetchAuthedJSON(path)
  }

  function fetchHomeCollectionCounts() {
    var bootstrapPromise = consumeBootstrapGallery(
      GALLERY_DEFAULT_ORDER,
      GALLERY_INITIAL_PAGE_SIZE,
      0,
    )
    if (bootstrapPromise) {
      return bootstrapPromise
        .then(function (data) {
          return {
            total: Number((data && data.total) || 0),
            publishedTotal: Number((data && data.published_total) || 0),
          }
        })
        .catch(function () {
          return { total: 0, publishedTotal: 0 }
        })
    }
    return fetchJSON(
      "/api/public/v1/gallery?order=" +
        encodeURIComponent(GALLERY_DEFAULT_ORDER) +
        "&limit=1&offset=0",
    )
      .then(function (data) {
        return {
          total: Number((data && data.total) || 0),
          publishedTotal: Number((data && data.published_total) || 0),
        }
      })
      .catch(function () {
        return { total: 0, publishedTotal: 0 }
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

  function emulsionDisplayInfo(item) {
    var source = item || {}
    var emulsionId = String(source.emulsion_id || "").trim()
    var artistId = String(source.artist_id || "").trim()
    var label = String(source.emulsion_label || "").trim()
    var primary = emulsionId || label || (artistId ? "Emulsion " + artistId : "")
    return {
      emulsionId: emulsionId,
      artistId: artistId,
      label: label,
      primary: primary,
    }
  }

  function renderEmulsionMetaMarkup(item, options) {
    var info = emulsionDisplayInfo(item)
    if (!info.primary) return ""
    var opts = options || {}
    var className = "icono-emulsion-meta"
    if (opts.className) className += " " + opts.className
    var kicker = String(opts.kicker || "").trim()
    return (
      '<div class="' +
      className +
      '">' +
      (kicker ? '<div class="icono-emulsion-meta-kicker">' + esc(kicker) + "</div>" : "") +
      '<div class="icono-emulsion-meta-primary">' +
      esc(info.primary) +
      "</div>" +
      "</div>"
    )
  }

  function renderPublishedEmulsionNotice(genePayload) {
    var portrait = (genePayload && genePayload.portrait) || null
    var metaMarkup = renderEmulsionMetaMarkup(portrait, {
      kicker: "current published blot",
      className: "icono-gene-emulsion-meta",
    })
    if (!metaMarkup) return ""
    return '<div class="icono-gene-emulsion-callout">' + metaMarkup + "</div>"
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

  function rememberRetainedPortraitImage(url, img) {
    var resolvedUrl = String(url || "").trim()
    if (!resolvedUrl || !img) return
    if (!portraitRetainedImageCache[resolvedUrl]) {
      portraitRetainedImageOrder.push(resolvedUrl)
    }
    portraitRetainedImageCache[resolvedUrl] = img
    while (portraitRetainedImageOrder.length > 12) {
      var evictedUrl = portraitRetainedImageOrder.shift()
      if (!evictedUrl) continue
      delete portraitRetainedImageCache[evictedUrl]
    }
  }

  function preloadImage(url, options) {
    var resolvedUrl = String(url || "").trim()
    var opts = options || {}
    if (!resolvedUrl) return Promise.resolve("")
    if (portraitImageCache[resolvedUrl]) return Promise.resolve(resolvedUrl)
    if (portraitImagePromiseCache[resolvedUrl]) return portraitImagePromiseCache[resolvedUrl]

    portraitImagePromiseCache[resolvedUrl] = new Promise(function (resolve) {
      var img = new Image()
      var finished = false
      img.decoding = "async"
      function finish(value) {
        if (finished) return
        finished = true
        if (value) portraitImageCache[resolvedUrl] = true
        if (value && opts.retain) rememberRetainedPortraitImage(resolvedUrl, img)
        delete portraitImagePromiseCache[resolvedUrl]
        resolve(value)
      }
      img.addEventListener(
        "load",
        function () {
          if (typeof img.decode === "function") {
            img
              .decode()
              .catch(function () {
                return null
              })
              .finally(function () {
                finish(resolvedUrl)
              })
            return
          }
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
    var options = arguments.length > 1 && arguments[1] ? arguments[1] : {}
    if (options.forceFresh) {
      // When a vote auto-promotes a new canonical portrait, the Worker still marks
      // public gene JSON cacheable. Bust both our in-memory cache and the request URL
      // so the current page reflects the new canonical immediately instead of after a
      // browser cache grace period or a couple of annoyed reloads.
      delete portraitDetailCache[key]
      delete portraitDetailPromiseCache[key]
    }
    if (!options.forceFresh && portraitDetailCache[key])
      return Promise.resolve(portraitDetailCache[key])
    if (!options.forceFresh && portraitDetailPromiseCache[key])
      return portraitDetailPromiseCache[key]

    // Rich per-gene detail is intentionally first-party only now. Bulk consumers
    // should sync from catalog snapshots + changes instead of crawling one gene at a time.
    var detailPath = "/api/iconoplasm/site/genes/" + encodeURIComponent(key)
    var requestInit = undefined
    if (options.forceFresh) {
      detailPath += "?fresh=" + encodeURIComponent(String(Date.now()))
      requestInit = { cache: "no-store" }
    }

    portraitDetailPromiseCache[key] = fetchJSON(detailPath, requestInit)
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

  function invalidateGeneDetail(symbol) {
    var key = normalizedSymbol(symbol)
    if (!key) return
    delete portraitDetailCache[key]
    delete portraitDetailPromiseCache[key]
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
      ' blot" loading="eager" decoding="async" fetchpriority="low" width="' +
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

  function sharedOrderOptionsMarkup(defaultValue) {
    var html = ""
    for (var i = 0; i < HOME_COLLECTION_ORDERS.length; i++) {
      var option = HOME_COLLECTION_ORDERS[i]
      html +=
        '<option value="' +
        esc(option.value) +
        '"' +
        (option.value === defaultValue ? " selected" : "") +
        ">" +
        esc(option.label) +
        "</option>"
    }
    return html
  }

  function galleryOptionsMarkup() {
    return sharedOrderOptionsMarkup(GALLERY_DEFAULT_ORDER)
  }

  function homeCollectionOptionsMarkup() {
    return sharedOrderOptionsMarkup(HOME_COLLECTION_DEFAULT_ORDER)
  }

  function guestStarterDiscoveryEntries() {
    // Guests need a starter trio so the collection mechanic begins with a recognizable shape
    // instead of a blank wall. Keep these concrete and culturally familiar rather than only
    // biomed-famous.
    return normalizeDiscoveryEntries(
      GUEST_STARTER_GENES.map(function (entry) {
        return Object.assign({ encounter_count: 1 }, entry)
      }),
    )
  }

  function fallbackDiscoveredGene(entry) {
    var symbol = normalizedSymbol(entry && entry.gene_symbol)
    return {
      symbol: symbol,
      full_name: symbol || "Unknown gene",
      color: "#857565",
      portrait: { status: "pending" },
      portrait_candidates: [],
    }
  }

  function loadDiscoveredGeneCardData(entry) {
    var symbol = normalizedSymbol(entry && entry.gene_symbol)
    if (!symbol) return Promise.resolve(null)
    return fetchGeneDetail(symbol).then(function (detail) {
      return detail || fallbackDiscoveredGene(entry)
    })
  }

  function buildCollectionSummaryMarkup(collectionState) {
    var discoveredCount = Number(collectionState && collectionState.discoveryEntries.length) || 0
    var totalCount = Math.max(0, Number((collectionState && collectionState.total) || 0) || 0)
    var progressPct =
      totalCount > 0 ? Math.max(0, Math.min(100, (discoveredCount / totalCount) * 100)) : 0
    var progressWidth = progressPct
    var totalCopy = totalCount > 0 ? totalCount.toLocaleString() : "the catalog"
    return (
      '<section class="icono-collection-summary icono-collection-summary--single" aria-label="Collection progress">' +
      '<article class="icono-collection-card icono-collection-card--archive">' +
      '<div class="icono-collection-label icono-collection-label--archive">Archive</div>' +
      '<div class="icono-collection-value">' +
      esc(discoveredCount.toLocaleString()) +
      "</div>" +
      '<div class="icono-collection-copy">recorded out of ' +
      esc(totalCopy) +
      "</div>" +
      '<div class="icono-collection-progress-inline">' +
      '<div class="icono-collection-progress-track" aria-hidden="true">' +
      '<span class="icono-collection-progress-fill" style="width:' +
      esc(progressWidth.toFixed(1)) +
      '%"></span>' +
      "</div>" +
      "</div>" +
      "</article>" +
      "</section>"
    )
  }

  function buildCollectionEmptyMarkup(collectionState) {
    var isAuthenticated = !!(collectionState && collectionState.authenticated)
    var title = isAuthenticated ? "No genes discovered yet" : "Your collection starts after login"
    var body = isAuthenticated
      ? "Hover a gene in the extension for about a second, then come back here. Your shelf will fill itself in."
      : "Signed-out browsing can search the starter trio, but portable discoveries only sync once you sign in."
    var support = isAuthenticated
      ? "You can still search any symbol above while the first discoveries come in."
      : "That keeps guest browsing light, and it prevents your unlocks from evaporating the moment a tab disappears."
    var actions =
      '<div class="icono-empty-actions">' +
      (isAuthenticated
        ? ""
        : '<a class="icono-home-auth-link icono-empty-link" href="' +
          esc(voteLoginUrl()) +
          '">Discord Login</a>') +
      '<a class="icono-empty-link icono-empty-link--subtle" href="https://brinedew.bio/posts/Iconoplasm-FAQ.html">Read FAQ</a>' +
      "</div>"
    return (
      '<section class="icono-empty icono-empty--collection">' +
      '<div class="icono-empty-kicker">collection pending</div>' +
      "<h2>" +
      esc(title) +
      "</h2>" +
      "<p>" +
      esc(body) +
      "</p>" +
      '<p class="icono-empty-support">' +
      esc(support) +
      "</p>" +
      actions +
      "</section>"
    )
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
      '<div class="icono-gallery-toolbar">' +
      '<div class="icono-search icono-search--toolbar">' +
      '<div class="icono-search-wrapper">' +
      '<input type="text" id="icono-q" class="icono-search-input" placeholder="Search by gene symbol or name..." autocomplete="off" />' +
      '<div class="icono-search-results" id="icono-results"></div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-gallery-actions">' +
      '<label class="icono-gallery-order" for="icono-order">' +
      '<span id="icono-order-label">Sort</span>' +
      '<select id="icono-order">' +
      homeCollectionOptionsMarkup() +
      "</select>" +
      "</label>" +
      '<div class="icono-gallery-auth" id="icono-gallery-auth" hidden></div>' +
      '<div class="icono-gallery-install" id="icono-gallery-install"></div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-install-panel-host" id="icono-install-panel-host" hidden></div>' +
      '<div class="icono-collection-shell" id="icono-collection-shell">' +
      '<div class="icono-collection-summary-host" id="icono-collection-summary" hidden></div>' +
      '<div class="icono-empty" id="icono-empty" hidden></div>' +
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
    return cardVariant === "lit-archival" || cardVariant === "neo-drab"
  }

  function isImageOnlyCardVariant(cardVariant) {
    return cardVariant === "image-only"
  }

  function isLitCardVariant(cardVariant) {
    return isArchivalCardVariant(cardVariant) || isImageOnlyCardVariant(cardVariant)
  }

  function litLayoutVariantForCard(cardVariant) {
    if (isImageOnlyCardVariant(cardVariant)) return "image-only"
    if (cardVariant === "neo-drab") return "neo-drab"
    return "lit-archival"
  }

  function archivalVariantClass(cardVariant) {
    if (cardVariant === "neo-drab") {
      return " icono-card--variant-lab-label icono-card--variant-lit-archival icono-card--variant-neo-drab"
    }
    if (cardVariant === "lit-archival") {
      return " icono-card--variant-lab-label icono-card--variant-lit-archival"
    }
    if (cardVariant === "image-only") return " icono-card--variant-image-only"
    return ""
  }

  function buildArchivalBodyMarkup(genePayload, options) {
    return IconoCardShared.renderLitArchivalCardHtml(genePayload, options || {})
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
    if (page === "home") return ""
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
        html += iconoRowMarkup("Blot", gene.hasPortrait ? "Published" : "Pending")
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
    return ""
  }

  function renderIconoplasmSidebar() {
    var iconoSidebarMarkup = iconoSidebarPanelMarkup()
    var panels = [
      {
        id: "brd-shared-user-panel",
        className: "brd-sidebar-panel--user",
        markup: buildSharedUserPanelMarkup({
          user: currentUser,
          loginLabel: "Discord Login",
        }),
      },
    ]
    if (iconoSidebarMarkup) {
      panels.push({
        id: "icono-sidebar-panel",
        className: "brd-sidebar-panel--iconoplasm",
        markup: iconoSidebarMarkup,
      })
    }
    var stack = mountSidebarStack({
      stackId: "brd-sidebar-stack",
      panels: panels,
    })
    wireSharedUserPanel(stack, {
      onAuthChanged: function (user) {
        void updateSharedUserState(user)
      },
    })
    renderHomeToolbarAuth()
    renderHomeInstallCta()
  }

  function rerenderCurrentGeneRoute(options) {
    var opts = options || {}
    var route = getRoute()
    if (route.page !== "gene") return
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    if (opts.forceFresh) invalidateGeneDetail(route.symbol)
    destroyHomeMasonry()
    destroyCandidateMasonry()
    renderGene(root, route.symbol, opts)
    refreshPortraitLightbox()
  }

  function updateSharedUserState(user) {
    var previousHadUser = !!currentUser
    var previousAdmin = !!currentUserIsIconoAdmin
    currentUser = user || null
    hasResolvedAuthState = true
    return fetchIconoplasmAdminState()
      .then(function (sessionState) {
        currentUserIsIconoAdmin = !!(sessionState && sessionState.is_admin)
        renderIconoplasmSidebar()
        if (getRoute().page === "home") {
          render()
        }
        if (
          getRoute().page === "gene" &&
          (previousHadUser !== !!currentUser || previousAdmin !== !!currentUserIsIconoAdmin)
        ) {
          rerenderCurrentGeneRoute()
        }
        return currentUser
      })
      .catch(function () {
        currentUserIsIconoAdmin = false
        renderIconoplasmSidebar()
        if (getRoute().page === "home") {
          render()
        }
        if (getRoute().page === "gene" && (previousHadUser !== !!currentUser || previousAdmin)) {
          rerenderCurrentGeneRoute()
        }
        return currentUser
      })
  }

  function refreshSharedUserState() {
    return fetchAuthenticatedUser()
      .then(function (user) {
        return updateSharedUserState(user)
      })
      .catch(function () {
        return updateSharedUserState(null)
      })
  }

  function voteLoginUrl() {
    return buildLoginUrl({
      authBase: API,
    })
  }

  function detectInstallBrowser() {
    var ua = String((window.navigator && window.navigator.userAgent) || "").toLowerCase()
    var isMobile = /android|iphone|ipad|ipod|mobile/.test(ua)
    if (ua.indexOf("firefox") !== -1) {
      return {
        family: "firefox",
        label: isMobile ? "Firefox mobile" : "Firefox",
        managerUrl: "about:addons",
        isMobile: isMobile,
      }
    }
    if (ua.indexOf("edg/") !== -1) {
      return {
        family: "chromium",
        label: "Edge",
        managerUrl: "edge://extensions",
        isMobile: isMobile,
      }
    }
    if (
      ua.indexOf("chrome") !== -1 ||
      ua.indexOf("chromium") !== -1 ||
      ua.indexOf("brave") !== -1 ||
      ua.indexOf("opr/") !== -1 ||
      ua.indexOf("opera") !== -1
    ) {
      return {
        family: "chromium",
        label: isMobile ? "Chromium mobile" : "Chrome",
        managerUrl: "chrome://extensions",
        isMobile: isMobile,
      }
    }
    if (ua.indexOf("safari") !== -1) {
      return {
        family: "unsupported",
        label: isMobile ? "Safari mobile" : "Safari",
        managerUrl: "",
        isMobile: isMobile,
      }
    }
    return {
      family: "unknown",
      label: isMobile ? "this mobile browser" : "this browser",
      managerUrl: "",
      isMobile: isMobile,
    }
  }

  function syncInstallStateFromDomMarker() {
    var root = document.documentElement
    if (!root) return
    if (String(root.getAttribute("data-iconoplasm-extension-installed") || "") !== "true") return
    iconoInstallState.installed = true
    iconoInstallState.version = String(
      root.getAttribute("data-iconoplasm-extension-version") || "",
    ).trim()
  }

  function handleIconoplasmExtensionPresence(event) {
    var detail = (event && event.detail) || {}
    iconoInstallState.installed = true
    iconoInstallState.version = String(detail.version || iconoInstallState.version || "").trim()
    syncInstallStateFromDomMarker()
    renderHomeInstallCta()
  }

  function probeForIconoplasmExtensionPresence() {
    syncInstallStateFromDomMarker()
    if (iconoInstallState.installed) {
      renderHomeInstallCta()
      return
    }
    window.dispatchEvent(new CustomEvent(ICONO_EXTENSION_PRESENCE_PING_EVENT))
    window.setTimeout(function () {
      syncInstallStateFromDomMarker()
      renderHomeInstallCta()
    }, 120)
  }

  function resolveInstallTab(browser) {
    var requested = String(iconoInstallState.installTab || "")
      .trim()
      .toLowerCase()
    if (requested === "chrome" || requested === "firefox") return requested
    return browser && browser.family === "firefox" ? "firefox" : "chrome"
  }

  function buildInstallBrowserPanels(browser, faqUrl) {
    var chromeManagerUrl =
      browser && browser.family === "chromium" && browser.managerUrl
        ? browser.managerUrl
        : "chrome://extensions"
    var chromeNote =
      browser && browser.label === "Edge"
        ? "Works in Edge right now. Chrome uses the same path."
        : "Works in Chrome and Edge right now."
    return {
      chrome: {
        id: "chrome",
        label: "Chrome",
        tone: "manual",
        title: "Chrome and Edge",
        note: chromeNote,
        managerUrl: chromeManagerUrl,
        steps: [
          "Open " + chromeManagerUrl + ".",
          "Turn on Developer mode.",
          "Choose Load unpacked, then select the iconoplasm-extension folder.",
        ],
        actions: [
          {
            href: ICONO_EXTENSION_SOURCE_URL,
            label: "Source folder",
            subtle: false,
          },
          {
            href: faqUrl,
            label: "Read FAQ",
            subtle: true,
          },
        ],
      },
      firefox: {
        id: "firefox",
        label: "Firefox",
        tone: "pending",
        title: "Firefox",
        note: "Store listing is not live yet.",
        managerUrl: "",
        steps: [
          "Firefox needs the signed AMO release before the install link can go live.",
          "Use Chrome or Edge for now.",
        ],
        actions: [
          {
            href: faqUrl,
            label: "Read FAQ",
            subtle: false,
          },
          {
            href: ICONO_EXTENSION_SOURCE_URL,
            label: "Track source",
            subtle: true,
          },
        ],
      },
    }
  }

  function currentInstallExperience() {
    syncInstallStateFromDomMarker()
    var browser = detectInstallBrowser()
    var faqUrl = "https://brinedew.bio/posts/Iconoplasm-FAQ.html"
    if (iconoInstallState.installed) {
      return {
        tone: "installed",
        toggleLabel: "Installed",
        toggleMeta: iconoInstallState.version ? "v" + iconoInstallState.version : "Ready",
        title: "Already installed",
        note: "The homepage stays quiet on purpose. The extension activates on other pages with gene symbols.",
        steps: [
          "Hover a gene symbol on another site to open the blot card.",
          "Use the popup if you want pills, underlines, or the archival card style.",
        ],
        actions: [
          {
            href: faqUrl,
            label: "Read FAQ",
            subtle: false,
          },
        ],
      }
    }
    var panels = buildInstallBrowserPanels(browser, faqUrl)
    var activeTab = resolveInstallTab(browser)
    var activePanel = panels[activeTab] || panels.chrome
    return {
      tone: activePanel.tone || "manual",
      toggleLabel: "Install",
      toggleMeta: activePanel.label || "Chrome",
      activeTab: activeTab,
      tabs: [
        {
          id: "chrome",
          label: "Chrome",
          selected: activeTab === "chrome",
        },
        {
          id: "firefox",
          label: "Firefox",
          selected: activeTab === "firefox",
        },
      ],
      title: activePanel.title,
      note: activePanel.note,
      managerUrl: activePanel.managerUrl,
      steps: activePanel.steps,
      actions: activePanel.actions,
    }
  }

  function buildInstallToggleMarkup(model) {
    var meta = String(model.toggleMeta || "").trim()
    return (
      '<button type="button" class="icono-install-toggle icono-install-toggle--' +
      esc(model.tone || "info") +
      '" data-icono-install-toggle aria-expanded="' +
      (iconoInstallState.panelOpen ? "true" : "false") +
      '" aria-controls="icono-install-panel">' +
      '<span class="icono-install-toggle-label">' +
      esc(model.toggleLabel) +
      "</span>" +
      (meta ? '<span class="icono-install-toggle-meta">' + esc(meta) + "</span>" : "") +
      '<span class="icono-install-toggle-caret" aria-hidden="true">' +
      (iconoInstallState.panelOpen ? "▴" : "▾") +
      "</span>" +
      "</button>"
    )
  }

  function buildInstallTabsMarkup(model) {
    var tabs = Array.isArray(model.tabs) ? model.tabs : []
    if (!tabs.length) return ""
    var html =
      '<div class="icono-install-tablist" role="tablist" aria-label="Browser install instructions">'
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i]
      if (!tab || !tab.id) continue
      var tabId = String(tab.id || "").trim()
      html +=
        '<button type="button" class="icono-install-tab" id="icono-install-tab-' +
        esc(tabId) +
        '" role="tab" aria-selected="' +
        (tab.selected ? "true" : "false") +
        '" tabindex="' +
        (tab.selected ? "0" : "-1") +
        '" aria-controls="icono-install-tabpanel-' +
        esc(tabId) +
        '" data-icono-install-tab="' +
        esc(tabId) +
        '">' +
        esc(tab.label || tabId) +
        "</button>"
    }
    return html + "</div>"
  }

  function buildInstallPanelMarkup(model) {
    var steps = Array.isArray(model.steps) ? model.steps : []
    var actions = Array.isArray(model.actions) ? model.actions : []
    var managerUrl = String(model.managerUrl || "").trim()
    var activeTab = String(model.activeTab || "").trim()
    var stepsHtml = ""
    for (var i = 0; i < steps.length; i++) {
      var step = String(steps[i] || "").trim()
      if (!step) continue
      if (managerUrl && step.indexOf(managerUrl) !== -1) {
        var escapedUrl = esc(managerUrl)
        var escapedStep = esc(step)
        stepsHtml +=
          "<li>" +
          escapedStep.replace(
            escapedUrl,
            '<code class="icono-install-code">' + escapedUrl + "</code>",
          ) +
          "</li>"
        continue
      }
      stepsHtml += "<li>" + esc(step) + "</li>"
    }
    var actionsHtml = ""
    for (var j = 0; j < actions.length; j++) {
      var action = actions[j]
      if (!action || !action.href) continue
      actionsHtml +=
        '<a class="' +
        (action.subtle
          ? "icono-toolbar-link icono-install-link icono-install-link--subtle"
          : "icono-home-auth-link icono-install-link") +
        '" href="' +
        esc(action.href) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(action.label || "Open") +
        "</a>"
    }
    var panelBodyAttrs = activeTab
      ? ' class="icono-install-panel-body" id="icono-install-tabpanel-' +
        esc(activeTab) +
        '" role="tabpanel" aria-labelledby="icono-install-tab-' +
        esc(activeTab) +
        '"'
      : ' class="icono-install-panel-body"'
    return (
      '<section class="icono-install-panel icono-install-panel--' +
      esc(model.tone || "info") +
      '" id="icono-install-panel" aria-live="polite">' +
      buildInstallTabsMarkup(model) +
      "<div" +
      panelBodyAttrs +
      ">" +
      '<div class="icono-install-header">' +
      "<h2>" +
      esc(model.title || "Install Iconoplasm") +
      "</h2>" +
      (model.note ? '<p class="icono-install-note">' + esc(model.note) + "</p>" : "") +
      "</div>" +
      (stepsHtml ? '<ul class="icono-install-steps">' + stepsHtml + "</ul>" : "") +
      (actionsHtml ? '<div class="icono-install-actions">' + actionsHtml + "</div>" : "") +
      (model.footnote ? '<p class="icono-install-footnote">' + esc(model.footnote) + "</p>" : "") +
      "</div>" +
      "</section>"
    )
  }

  function renderHomeInstallCta() {
    var toggleHost = document.getElementById("icono-gallery-install")
    var panelHost = document.getElementById("icono-install-panel-host")
    if (!toggleHost || !panelHost) return
    var model = currentInstallExperience()
    var showInstallCard = !iconoInstallState.installed
    toggleHost.hidden = showInstallCard
    toggleHost.innerHTML = showInstallCard ? "" : buildInstallToggleMarkup(model)
    panelHost.hidden = showInstallCard ? false : !iconoInstallState.panelOpen
    panelHost.innerHTML =
      showInstallCard || iconoInstallState.panelOpen ? buildInstallPanelMarkup(model) : ""
    if (!showInstallCard) {
      var toggle = toggleHost.querySelector("[data-icono-install-toggle]")
      if (toggle) {
        toggle.addEventListener("click", function () {
          iconoInstallState.panelOpen = !iconoInstallState.panelOpen
          renderHomeInstallCta()
        })
      }
    }
    var tabButtons = panelHost.querySelectorAll("[data-icono-install-tab]")
    for (var i = 0; i < tabButtons.length; i++) {
      ;(function (button) {
        button.addEventListener("click", function () {
          var nextTab = String(button.getAttribute("data-icono-install-tab") || "")
            .trim()
            .toLowerCase()
          if (!nextTab) return
          iconoInstallState.installTab = nextTab
          renderHomeInstallCta()
        })
      })(tabButtons[i])
    }
  }

  function buildHomeToolbarAuthMarkup() {
    if (!hasResolvedAuthState || currentUser) return ""
    return (
      '<a class="icono-home-auth-link icono-toolbar-login" href="' +
      esc(voteLoginUrl()) +
      '" aria-label="Discord login to rate gene bricks">Discord Login</a>'
    )
  }

  function renderHomeToolbarAuth() {
    var slot = document.getElementById("icono-gallery-auth")
    if (!slot) return
    var markup = buildHomeToolbarAuthMarkup()
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

  function labelVoteBoxMarkup(genePayload, attrName, options) {
    var opts = options || {}
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
      showArrows: !!opts.showArrows,
    })
  }

  function buildLabLabelPortraitMediaMarkup(
    symbol,
    portraitUrl,
    portraitFullUrl,
    dims,
    fetchPriority,
  ) {
    return IconoCardShared.renderLabLabelPortraitMediaHtml(
      symbol,
      portraitUrl,
      portraitFullUrl,
      dims,
      {
        buttonAttrs:
          'data-icono-pswp data-icono-pswp-src="' +
          esc(portraitFullUrl) +
          '" data-icono-pswp-alt="' +
          esc(normalizedSymbol(symbol)) +
          ' blot" data-pswp-width="' +
          dims.width +
          '" data-pswp-height="' +
          dims.height +
          '"',
        fetchPriority: fetchPriority || "low",
      },
    )
  }

  function buildBrickCardMarkup(g, cardIndex) {
    var dims = portraitDimensions(g)
    var key = normalizedSymbol(g.symbol)
    var portraitUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitUrl
    var detail = portraitDetailCache[key] || null
    var cardVariant = resolveCardVariant()
    var isArchivalVariant = isArchivalCardVariant(cardVariant)
    var isImageOnlyVariant = isImageOnlyCardVariant(cardVariant)
    var href = "/gene/" + esc(encodeURIComponent(g.symbol))
    var geneLinkAttrs = 'target="_blank" rel="noopener noreferrer"'
    var metaRows = detail ? collectTooltipMetaRows(detail) : []
    var metaHtml = detail ? renderTooltipMetaRowsHtml(metaRows) : renderTooltipMetaSkeletonHtml()
    var mobileRowsHtml = detail
      ? renderTooltipMobileRowGridHtml(metaRows, "data-icono-card-mobile-meta")
      : renderTooltipMobileSkeletonHtml("data-icono-card-mobile-meta")
    var voteHtml = brickVoteBoxMarkup(detail || g)
    var labelVoteHtml = labelVoteBoxMarkup(detail || g, "data-icono-brick-vote-box", {
      showArrows: isMobileLabelReviewEnabled(),
    })
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
    var bodyHtml = isLitCardVariant(cardVariant)
      ? buildArchivalBodyMarkup(detail || g, {
          mode: "brick",
          layoutVariant: litLayoutVariantForCard(cardVariant),
          mobileReview: isMobileLabelReviewEnabled(),
          portraitAlt: g.symbol + " blot",
          portraitSrc: portraitUrl,
          titleHref: href,
          titleLinkAttrs: geneLinkAttrs,
          voteHtml: isImageOnlyVariant ? "" : labelVoteHtml,
        })
      : '<div class="iconoplasm-tooltip-header">' +
        '<div class="icono-brick-header-row icono-shared-card-header-row">' +
        '<a class="icono-brick-header-link" href="' +
        href +
        '" ' +
        geneLinkAttrs +
        ">" +
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
        '" ' +
        geneLinkAttrs +
        ">" +
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
      (isImageOnlyVariant
        ? bodyHtml
        : isArchivalVariant
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
                ' blot" data-pswp-width="' +
                dims.width +
                '" data-pswp-height="' +
                dims.height +
                '" aria-label="Open full-size blot for ' +
                esc(g.symbol) +
                '">' +
                '<img class="iconoplasm-tooltip-portrait-img" src="' +
                esc(portraitUrl) +
                '" alt="' +
                esc(g.symbol) +
                // Keep brick portraits eager once a card is rendered. Lazy here made fast mobile
                // scroll show empty portrait boxes for a beat before the browser picked them up.
                ' blot" loading="eager" decoding="async" fetchpriority="' +
                (cardIndex < 6 ? "high" : "low") +
                '" width="' +
                dims.width +
                '" height="' +
                dims.height +
                '">' +
                "</button>"
              : '<img class="iconoplasm-tooltip-portrait-img" alt="">') +
            '<div class="iconoplasm-tooltip-portrait-fallback">' +
            '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
            '<div class="iconoplasm-tooltip-portrait-symbol">' +
            esc(g.symbol) +
            "</div>" +
            "</div>" +
            '<div class="iconoplasm-tooltip-portrait-fade"></div>' +
            "</div>") +
      (isImageOnlyVariant ? "" : '<div class="iconoplasm-tooltip-body">' + bodyHtml + "</div>") +
      (isLitCardVariant(cardVariant)
        ? ""
        : '<a class="icono-brick-mobile-link" href="' +
          href +
          '" ' +
          geneLinkAttrs +
          ">" +
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
    var isImageOnlyVariant = isImageOnlyCardVariant(cardVariant)
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
                  ' blot" data-pswp-width="' +
                  dims.width +
                  '" data-pswp-height="' +
                  dims.height +
                  '" aria-label="Open full-size blot for ' +
                  esc(g.symbol) +
                  '">' +
                  '<img class="iconoplasm-tooltip-portrait-img" src="' +
                  esc(portraitUrl) +
                  '" alt="' +
                  esc(g.symbol) +
                  ' blot" loading="eager" decoding="async" width="' +
                  dims.width +
                  '" height="' +
                  dims.height +
                  '">' +
                  "</button>"
              : '<img class="iconoplasm-tooltip-portrait-img" alt="">' +
                  '<div class="iconoplasm-tooltip-portrait-fallback">' +
                  '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
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
            ' blot" data-pswp-width="' +
            dims.width +
            '" data-pswp-height="' +
            dims.height +
            '" aria-label="Open full-size blot for ' +
            esc(g.symbol) +
            '">' +
            '<img class="iconoplasm-tooltip-portrait-img" src="' +
            esc(portraitUrl) +
            '" alt="' +
            esc(g.symbol) +
            ' blot" loading="eager" decoding="async" width="' +
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
            '<div class="iconoplasm-tooltip-portrait-status">Blot pending</div>' +
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
    var bodyHtml = isLitCardVariant(cardVariant)
      ? buildArchivalBodyMarkup(detail || g, {
          mode: "sheet",
          layoutVariant: litLayoutVariantForCard(cardVariant),
          mobileReview: false,
          portraitAlt: g.symbol + " blot",
          portraitSrc: portraitUrl,
          voteHtml:
            !isImageOnlyVariant && portraitAssetSha
              ? labelVoteBoxMarkup(g, "data-icono-gene-vote-box", { showArrows: false })
              : "",
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
      (isImageOnlyVariant
        ? bodyHtml
        : portraitMarkup + '<div class="iconoplasm-tooltip-body">' + bodyHtml + "</div>") +
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
    portraitImg.setAttribute("alt", normalizedSymbol(genePayload.symbol) + " blot")
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
    wireVoteBox(existing, card.getAttribute("data-icono-symbol"), assetSha, {
      // Cost fence: gallery cards can appear by the dozen on first paint and on lazy-load.
      // Personalized vote state is useful, but not worth a per-card snapshot storm before
      // the visitor actually tries to vote. The shared runtime fetches the snapshot before
      // submitting a click, so correctness is preserved while idle page load stays quiet.
      deferSnapshot: true,
    })
  }

  function ensureArchivalBrickVoteBox(card, genePayload) {
    if (!card) return
    if (!isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) return
    var assetSha = brickVoteAssetSha(genePayload)
    var box = card.querySelector("[data-icono-brick-vote-box]")
    if (!box || !assetSha) return
    // Archival brick hydration replaces `.iconoplasm-tooltip-body` wholesale after detail fetch.
    // That DOM swap discards the initial vote listeners that were attached when the card first
    // entered the gallery. Rewire the replacement box immediately so swipe-review still submits
    // after the card has hydrated, after returning to the gallery, and after any later body swap.
    wireVoteBox(box, card.getAttribute("data-icono-symbol"), assetSha, {
      deferSnapshot: true,
      visionId: box.getAttribute("data-icono-vision-id") || brickVoteVisionId(genePayload) || "",
      candidateImageId:
        box.getAttribute("data-icono-candidate-image-id") ||
        brickVoteCandidateImageId(genePayload) ||
        0,
    })
  }

  function hydrateBrickCard(card, genePayload) {
    if (!card) return
    if (genePayload) hydrateBrickPortrait(card, genePayload)
    if (isArchivalCardVariant(card.getAttribute("data-icono-card-variant"))) {
      var body = card.querySelector(".iconoplasm-tooltip-body")
      var portraitShell = card.querySelector(".iconoplasm-tooltip-portrait")
      if (body) {
        body.innerHTML = buildArchivalBodyMarkup(genePayload, {
          mode: "brick",
          mobileReview: isMobileLabelReviewEnabled(),
          titleHref: "/gene/" + esc(encodeURIComponent(genePayload.symbol || "")),
          voteHtml: labelVoteBoxMarkup(genePayload, "data-icono-brick-vote-box", {
            showArrows: isMobileLabelReviewEnabled(),
          }),
        })
      }
      ensureArchivalBrickVoteBox(card, genePayload)
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
      onVoteCommitted: function (data, state) {
        if (typeof opts.onVoteCommitted === "function") {
          opts.onVoteCommitted(data, state)
        }
      },
      onError: function (phase, err) {
        console.error("[Iconoplasm] vote " + phase + " error:", err)
      },
    })
  }

  function refreshGeneAfterVoteAutoPromote(symbol, voteResponse) {
    var autoPromote = voteResponse && voteResponse.auto_promote
    if (!autoPromote || !autoPromote.changed) return
    var route = getRoute()
    if (route.page !== "gene") return
    if (normalizedSymbol(route.symbol) !== normalizedSymbol(symbol)) return
    rerenderCurrentGeneRoute({ forceFresh: true })
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
          deferSnapshot: true,
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
      deferSnapshot: true,
      visionId: portrait.vision_id || "",
      candidateImageId: portrait.candidate_image_id || 0,
      onVoteCommitted: function (data) {
        refreshGeneAfterVoteAutoPromote(symbol, data)
      },
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
        deferSnapshot: true,
        visionId: box.getAttribute("data-icono-vision-id") || "",
        candidateImageId: box.getAttribute("data-icono-candidate-image-id") || 0,
        onVoteCommitted: function (data) {
          refreshGeneAfterVoteAutoPromote(symbol, data)
        },
      })
    }
  }

  function wireCandidateRemoveButtons(container, genePayload) {
    if (!container || !genePayload || !currentUserIsIconoAdmin) return
    var buttons = container.querySelectorAll("[data-icono-candidate-remove]")
    for (var i = 0; i < buttons.length; i++) {
      ;(function (button) {
        if (!button || button.getAttribute("data-icono-remove-wired") === "true") return
        button.setAttribute("data-icono-remove-wired", "true")
        button.addEventListener("click", function () {
          var symbol = String(button.getAttribute("data-icono-symbol") || "")
            .trim()
            .toUpperCase()
          var assetSha = String(button.getAttribute("data-icono-asset-sha256") || "")
            .trim()
            .toLowerCase()
          var candidateImageId =
            Number(button.getAttribute("data-icono-candidate-image-id") || 0) || 0
          if (!symbol || !assetSha) return
          if (
            !window.confirm(
              "Remove this candidate from the website and queue local deletion so it will not sync back?",
            )
          ) {
            return
          }
          var priorLabel = button.textContent || "Remove"
          button.disabled = true
          button.textContent = "Removing..."
          fetchJSON("/api/iconoplasm/admin/remove-candidate", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              symbol: symbol,
              asset_sha256: assetSha,
              candidate_image_id: candidateImageId > 0 ? candidateImageId : null,
            }),
          })
            .then(function () {
              rerenderCurrentGeneRoute({ forceFresh: true })
            })
            .catch(function (error) {
              button.disabled = false
              button.textContent = priorLabel
              window.alert(String((error && error.message) || "Failed to remove candidate blot."))
            })
        })
      })(buttons[i])
    }
  }

  function wireCandidateCopyForms(container, genePayload) {
    if (!container || !genePayload) return
    var forms = container.querySelectorAll("[data-icono-candidate-copy-form]")
    for (var i = 0; i < forms.length; i++) {
      ;(function (form) {
        if (!form || form.getAttribute("data-icono-copy-wired") === "true") return
        form.setAttribute("data-icono-copy-wired", "true")
        var sourceSymbol = normalizedSymbol(form.getAttribute("data-icono-source-symbol") || genePayload.symbol)
        var assetSha = String(form.getAttribute("data-icono-asset-sha256") || "")
          .trim()
          .toLowerCase()
        var input = form.querySelector("[data-icono-candidate-copy-query]")
        var hidden = form.querySelector("[data-icono-candidate-copy-target]")
        var results = form.querySelector("[data-icono-candidate-copy-results]")
        var note = form.querySelector("[data-icono-candidate-copy-note]")
        var searchTimer = null
        if (!sourceSymbol || !assetSha || !input || !hidden || !results) return

        function setCopyStatus(message, tone) {
          if (!note) return
          note.textContent = String(message || "").trim()
          note.hidden = !note.textContent
          note.style.color = tone === "error" ? "#b42318" : tone === "success" ? "#0f766e" : "inherit"
        }

        function renderCopyResults(genes) {
          var rows = Array.isArray(genes) ? genes : []
          if (!rows.length) {
            results.innerHTML = '<div class="icono-request-results-empty">No genes found.</div>'
            results.hidden = false
            return
          }
          var html = ""
          for (var j = 0; j < rows.length; j++) {
            var gene = rows[j] || {}
            var symbol = normalizedSymbol(gene.symbol || "")
            if (!symbol || symbol === sourceSymbol) continue
            html +=
              '<button type="button" class="icono-request-option" data-icono-candidate-copy-option="' +
              esc(symbol) +
              '">' +
              '<span class="icono-request-option-copy">' +
              '<span class="icono-request-option-title">' +
              esc(symbol) +
              "</span>" +
              "<span>" +
              esc(String(gene.full_name || symbol)) +
              "</span>" +
              "</span>" +
              "</button>"
          }
          results.innerHTML = html || '<div class="icono-request-results-empty">Only the source gene matched.</div>'
          results.hidden = false
        }

        function runCopySearch() {
          var query = String(input.value || "").trim()
          hidden.value = ""
          if (query.length < 2) {
            results.hidden = true
            results.innerHTML = ""
            return
          }
          fetchJSON(
            "/api/public/v1/genes/search?scope=catalog&limit=8&q=" +
              encodeURIComponent(query),
            { credentials: "include" },
          )
            .then(function (payload) {
              renderCopyResults(Array.isArray(payload && payload.genes) ? payload.genes : [])
            })
            .catch(function (error) {
              results.hidden = false
              results.innerHTML =
                '<div class="icono-request-results-empty">' +
                esc(String((error && error.message) || "Search failed")) +
                "</div>"
            })
        }

        input.addEventListener("input", function () {
          if (searchTimer) window.clearTimeout(searchTimer)
          searchTimer = window.setTimeout(runCopySearch, 180)
        })
        results.addEventListener("click", function (event) {
          var button = event.target.closest("[data-icono-candidate-copy-option]")
          if (!button) return
          var target = normalizedSymbol(button.getAttribute("data-icono-candidate-copy-option") || "")
          if (!target) return
          hidden.value = target
          input.value = target
          results.hidden = true
          results.innerHTML = ""
        })
        form.addEventListener("submit", function (event) {
          event.preventDefault()
          var targetSymbol = normalizedSymbol(hidden.value || input.value || "")
          if (!targetSymbol) {
            setCopyStatus("Pick a target gene first.", "error")
            input.focus()
            return
          }
          var submit = form.querySelector('button[type="submit"]')
          if (submit) {
            submit.disabled = true
            submit.textContent = "Copying..."
          }
          setCopyStatus("", "")
          fetchJSON("/api/iconoplasm/candidates/copy", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              source_gene_symbol: sourceSymbol,
              target_gene_symbol: targetSymbol,
              asset_sha256: assetSha,
            }),
          })
            .then(function (payload) {
              var targetUrl = String((payload && payload.target_url) || "")
              var target = normalizedSymbol((payload && payload.target_gene_symbol) || targetSymbol)
              setCopyStatus("Copied to " + target + " and checkmarked.", "success")
              if (targetUrl && note) {
                note.innerHTML =
                  'Copied to <a href="' +
                  esc(targetUrl) +
                  '" data-icono-nav>' +
                  esc(target) +
                  "</a> and checkmarked."
              }
            })
            .catch(function (error) {
              var message = String((error && error.message) || "Could not copy candidate image.")
              if (/log in|auth/i.test(message)) message += " Use Discord Login first, then try again."
              setCopyStatus(message, "error")
            })
            .finally(function () {
              if (submit) {
                submit.disabled = false
                submit.textContent = "copy this image to another gene"
              }
            })
        })
      })(forms[i])
    }
  }

  function geneRequestLaneLabel(item) {
    if (
      !item ||
      String(item.request_mode || "")
        .trim()
        .toLowerCase() !== "specific"
    ) {
      return "Random default"
    }
    return (
      String(item.requested_emulsion_label || "").trim() ||
      String(item.requested_vision_id || "").trim() ||
      "Specific emulsion"
    )
  }

  function renderGeneRequestSummaryMarkup(title, rows, countField) {
    var safeRows = Array.isArray(rows) ? rows : []
    if (!safeRows.length) return ""
    var html =
      '<div class="icono-gene-request-summary">' +
      '<div class="icono-home-auth-kicker">' +
      esc(title) +
      "</div>" +
      '<ul style="margin:8px 0 0;padding-left:18px;display:grid;gap:6px;">'
    for (var i = 0; i < safeRows.length; i++) {
      var item = safeRows[i] || {}
      var count = Number(item[countField] || 0) || 0
      html +=
        "<li>" +
        esc(geneRequestLaneLabel(item)) +
        " - " +
        esc(String(count)) +
        " request" +
        (count === 1 ? "" : "s") +
        "</li>"
    }
    html += "</ul></div>"
    return html
  }

  function requestOptionPrimaryLabel(option) {
    var item = option || {}
    return (
      String(item.primary_label || "").trim() ||
      String(item.label || "").trim() ||
      String(item.emulsion_id || "").trim() ||
      String(item.artist_tag || "").trim() ||
      String(item.artist_name || "").trim() ||
      String(item.vision_id || "").trim() ||
      "Specific emulsion"
    )
  }

  function requestOptionSecondaryLabel(option) {
    var item = option || {}
    return (
      String(item.secondary_label || "").trim() ||
      [item.artist_tag, item.artist_name, item.vision_id]
        .map(function (value) {
          return String(value || "").trim()
        })
        .filter(Boolean)
        .join(" · ")
    )
  }

  function requestOptionPreviewUrl(asset) {
    var item = asset || {}
    return String(item.medium_url || item.thumb_url || "").trim()
  }

  function renderRequestOptionPreviewStripMarkup(option) {
    var previews = Array.isArray(option && option.preview_assets) ? option.preview_assets : []
    if (!previews.length) {
      return '<span class="icono-request-option-strip icono-request-option-strip--empty"><span class="icono-request-option-empty">No examples yet</span></span>'
    }
    var html = '<span class="icono-request-option-strip">'
    for (var i = 0; i < previews.length && i < 5; i++) {
      var asset = previews[i] || {}
      var url = requestOptionPreviewUrl(asset)
      if (!url) continue
      html +=
        '<span class="icono-request-option-thumb' +
        (asset.is_current ? " is-current" : "") +
        '">' +
        '<img class="icono-thumbnail-viewport-image" src="' +
        esc(url) +
        '" alt="' +
        esc(String(asset.gene_symbol || "Example") + " example blot") +
        '" loading="lazy" decoding="async">' +
        "</span>"
    }
    html += "</span>"
    return html
  }

  function renderRequestOptionButtonMarkup(option, selectedVisionId, isRandom) {
    var item = option || {}
    var optionVisionId = isRandom ? "" : String(item.vision_id || "").trim()
    var isSelected = String(selectedVisionId || "").trim() === optionVisionId
    var primary = isRandom ? "Random emulsion" : requestOptionPrimaryLabel(item)
    var optionId =
      "icono-request-option-" +
      String(optionVisionId || "random")
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
    return (
      '<button type="button" class="icono-request-option' +
      (isSelected ? " is-selected" : "") +
      (isRandom ? " is-random" : "") +
      '" id="' +
      optionId +
      '" role="option" aria-selected="' +
      (isSelected ? "true" : "false") +
      '" data-icono-request-option="' +
      esc(optionVisionId) +
      '">' +
      '<span class="icono-request-option-copy">' +
      '<span class="icono-request-option-title-row">' +
      '<span class="icono-request-option-title">' +
      esc(primary) +
      "</span>" +
      "</span>" +
      "</span>" +
      renderRequestOptionPreviewStripMarkup(item) +
      "</button>"
    )
  }

  function renderRequestDiagnosticsMarkup(diagnostics) {
    var payload = diagnostics || {}
    var requestOptions = payload.request_options || {}
    var sample = Array.isArray(requestOptions.sample) ? requestOptions.sample : []
    var html =
      '<details class="icono-request-diagnostics">' +
      "<summary>Admin diagnostics</summary>" +
      '<div class="icono-request-diagnostics-body">' +
      '<div class="icono-request-diagnostics-grid">' +
      '<div><span class="icono-request-diagnostics-label">Gene</span><strong>' +
      esc(String(payload.gene_symbol || "").trim() || "Unknown") +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Open requests</span><strong>' +
      esc(String(Number(payload.open_request_count || 0) || 0)) +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Request lanes</span><strong>' +
      esc(String(Number(payload.lane_count || 0) || 0)) +
      "</strong></div>" +
      '<div><span class="icono-request-diagnostics-label">Option hydration</span><strong>' +
      esc(requestOptions.ok ? "OK" : String(requestOptions.error || "Failed")) +
      "</strong></div>" +
      "</div>"
    if (sample.length) {
      html +=
        '<div class="icono-request-diagnostics-sample"><div class="icono-request-diagnostics-label">Sample options</div><ul>'
      for (var i = 0; i < sample.length; i++) {
        var row = sample[i] || {}
        html +=
          "<li><strong>" +
          esc(String(row.label || row.vision_id || "Unknown")) +
          "</strong>" +
          (row.secondary_label
            ? "<span> · " + esc(String(row.secondary_label || "")) + "</span>"
            : "") +
          "<span> · " +
          esc(String(Number(row.preview_count || 0) || 0)) +
          " previews</span></li>"
      }
      html += "</ul></div>"
    }
    html += "</div></details>"
    return html
  }

  function loadGeneRequestDiagnostics(symbol) {
    return fetchJSON(
      "/api/iconoplasm/admin/requests/gene/" + encodeURIComponent(symbol) + "/diagnostics",
      {
        credentials: "include",
      },
    )
  }

  function renderRequestFormMarkup(symbol, options) {
    var config = options || {}
    var disabledAttr = config.disabled ? ' disabled aria-disabled="true"' : ""
    var submitLabel = String(config.submitLabel || "new candidate").trim() || "new candidate"
    var placeholder = String(config.placeholder || "random or pick emulsion").trim() || "random or pick emulsion"
    return (
      '<form data-icono-request-form class="icono-request-form">' +
      '<div class="icono-search icono-search--toolbar icono-request-search">' +
      '<div class="icono-search-wrapper icono-request-picker-search" data-icono-request-picker>' +
      '<input id="icono-request-query-' +
      esc(symbol) +
      '" data-icono-request-query class="icono-search-input icono-request-picker-input" type="text" autocomplete="off" placeholder="' +
      esc(placeholder) +
      '" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="icono-request-results-' +
      esc(symbol) +
      '" aria-label="Search emulsion lane"' +
      disabledAttr +
      ">" +
      '<input type="hidden" data-icono-request-vision value="">' +
      '<button type="submit" class="icono-request-inline-submit" data-default-label="' +
      esc(submitLabel) +
      '"' +
      disabledAttr +
      ">" +
      esc(submitLabel) +
      "</button>" +
      '<div class="icono-search-results icono-request-results" id="icono-request-results-' +
      esc(symbol) +
      '" role="listbox" data-icono-request-results hidden></div>' +
      "</div>" +
      "</div>" +
      "</form>"
    )
  }

  function renderRequestShellMarkup(symbol) {
    return (
      '<div class="icono-request-shell">' +
      '<div class="icono-request-actions">' +
      renderRequestFormMarkup(symbol) +
      "<div data-icono-request-my-summary hidden></div>" +
      "<div data-icono-request-gene-summary hidden></div>" +
      '<div data-icono-request-note hidden style="font-size:0.92rem;"></div>' +
      "</div>" +
      "</div>"
    )
  }

  function renderEditImageShellMarkup(genePayload) {
    var symbol = normalizedSymbol(genePayload && genePayload.symbol)
    var portrait = (genePayload && genePayload.portrait) || null
    var assetSha = String((portrait && portrait.asset_sha256) || "")
      .trim()
      .toLowerCase()
    if (!symbol || !assetSha) return ""
    return (
      '<section class="icono-gene-request-surface icono-gene-edit-panel" data-icono-edit-image-panel="' +
      esc(symbol) +
      '" data-icono-source-asset-sha256="' +
      esc(assetSha) +
      '">' +
      '<div class="icono-request-shell">' +
      '<div class="icono-request-actions">' +
      '<button type="button" class="icono-request-inline-submit" data-icono-edit-image-toggle>edit image</button>' +
      '<form class="icono-request-form" data-icono-edit-image-form hidden>' +
      '<label class="icono-request-option-copy" for="icono-edit-image-prompt-' +
      esc(symbol) +
      '">' +
      '<span class="icono-request-option-title">Small correction prompt</span>' +
      '<span>Describe the fix: anatomy, anchor traits, background, or style drift.</span>' +
      "</label>" +
      '<textarea id="icono-edit-image-prompt-' +
      esc(symbol) +
      '" data-icono-edit-image-prompt class="icono-search-input icono-request-picker-input" rows="3" maxlength="2000" placeholder="Fix the hands, keep the same character concept, add a fitting background..." required></textarea>' +
      '<button type="submit" class="icono-request-inline-submit" data-default-label="submit edit">submit edit</button>' +
      "</form>" +
      '<div data-icono-edit-image-note hidden style="font-size:0.92rem;"></div>' +
      "</div>" +
      "</div>" +
      "</section>"
    )
  }

  function wireGeneEditImagePanel(container, genePayload) {
    if (!container || !genePayload) return
    var panel = container.querySelector("[data-icono-edit-image-panel]")
    if (!panel) return
    var form = panel.querySelector("[data-icono-edit-image-form]")
    var toggle = panel.querySelector("[data-icono-edit-image-toggle]")
    var promptInput = panel.querySelector("[data-icono-edit-image-prompt]")
    var note = panel.querySelector("[data-icono-edit-image-note]")
    var symbol = normalizedSymbol(genePayload.symbol)
    var sourceAssetSha = String(panel.getAttribute("data-icono-source-asset-sha256") || "")
      .trim()
      .toLowerCase()
    if (!form || !toggle || !promptInput || !symbol || !sourceAssetSha) return

    function setEditStatus(message, tone) {
      if (!note) return
      note.textContent = String(message || "").trim()
      note.hidden = !note.textContent
      note.style.color = tone === "error" ? "#b42318" : tone === "success" ? "#0f766e" : "inherit"
    }

    toggle.addEventListener("click", function () {
      form.hidden = !form.hidden
      toggle.setAttribute("aria-expanded", form.hidden ? "false" : "true")
      if (!form.hidden) promptInput.focus()
    })

    form.addEventListener("submit", function (event) {
      event.preventDefault()
      var prompt = String(promptInput.value || "").trim()
      if (!prompt) {
        setEditStatus("Describe the correction before submitting.", "error")
        promptInput.focus()
        return
      }
      var button = form.querySelector('button[type="submit"]')
      if (button) {
        button.disabled = true
        button.textContent = "Submitting..."
      }
      setEditStatus("", "")
      fetchJSON("/api/iconoplasm/requests", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          symbol: symbol,
          request_kind: "edit_image",
          request_prompt: prompt,
          source_gene_symbol: symbol,
          source_asset_sha256: sourceAssetSha,
          request_mode: "random",
        }),
      })
        .then(function () {
          promptInput.value = ""
          form.hidden = true
          toggle.setAttribute("aria-expanded", "false")
          setEditStatus("Edit queued. The corrected image will land in the candidate pool after workstation review.", "success")
        })
        .catch(function (error) {
          var message = String((error && error.message) || "Could not queue edit.")
          if (/log in|auth/i.test(message)) message += " Use Discord Login first, then try again."
          setEditStatus(message, "error")
        })
        .finally(function () {
          if (button) {
            button.disabled = false
            button.textContent = String(button.getAttribute("data-default-label") || "submit edit")
          }
        })
    })
  }

  function wireGeneRequestPanel(container, genePayload) {
    if (!container || !genePayload) return
    var panel = container.querySelector("[data-icono-request-panel]")
    if (!panel) return
    var body = panel.querySelector("[data-icono-request-body]")
    if (!body) return
    var symbol = normalizedSymbol(genePayload.symbol)
    if (!symbol) return

    function setStatus(message, tone) {
      var note = body.querySelector("[data-icono-request-note]")
      if (!note) return
      note.textContent = String(message || "").trim()
      note.hidden = !note.textContent
      note.style.color = tone === "error" ? "#b42318" : tone === "success" ? "#0f766e" : "inherit"
    }

    function updateSummaryHosts(myLaneSummary, geneLaneSummary) {
      var mySummaryHost = body.querySelector("[data-icono-request-my-summary]")
      var geneSummaryHost = body.querySelector("[data-icono-request-gene-summary]")
      if (mySummaryHost) {
        var myHtml = renderGeneRequestSummaryMarkup(
          "Your open requests",
          myLaneSummary,
          "my_request_count",
        )
        mySummaryHost.innerHTML = myHtml
        mySummaryHost.hidden = !String(myHtml || "").trim()
      }
      if (geneSummaryHost) {
        var geneHtml = renderGeneRequestSummaryMarkup(
          "Open requests on this gene",
          geneLaneSummary,
          "request_count",
        )
        geneSummaryHost.innerHTML = geneHtml
        geneSummaryHost.hidden = !String(geneHtml || "").trim()
      }
    }

    function wireAuthenticatedRequestForm(summaryState) {
      var safeState = summaryState || {}
      var myLaneSummary = Array.isArray(safeState.my_lane_summary) ? safeState.my_lane_summary : []
      var geneLaneSummary = Array.isArray(safeState.gene_lane_summary)
        ? safeState.gene_lane_summary
        : []
      updateSummaryHosts(myLaneSummary, geneLaneSummary)

      var form = body.querySelector("[data-icono-request-form]")
      var hiddenInput = body.querySelector("[data-icono-request-vision]")
      var queryInput = body.querySelector("[data-icono-request-query]")
      var results = body.querySelector("[data-icono-request-results]")
      var picker = body.querySelector("[data-icono-request-picker]")
      if (!form || !hiddenInput || !queryInput || !results || !picker) return
      var requestOptions = []
      var optionsLoaded = false
      var optionsLoadingPromise = null
      var activeIndex = -1
      var filteredOptions = []
      var pickerOpen = false

      function closeResults() {
        pickerOpen = false
        activeIndex = -1
        results.hidden = true
        queryInput.setAttribute("aria-expanded", "false")
        queryInput.removeAttribute("aria-activedescendant")
      }

      function openResults() {
        pickerOpen = true
        results.hidden = false
        queryInput.setAttribute("aria-expanded", "true")
      }

      function ensureRequestOptionsLoaded() {
        if (optionsLoaded) return Promise.resolve(requestOptions)
        if (optionsLoadingPromise) return optionsLoadingPromise
        optionsLoadingPromise = fetchJSON("/api/iconoplasm/requests/options", {
          credentials: "include",
        })
          .then(function (payload) {
            requestOptions = Array.isArray(payload && payload.request_options)
              ? payload.request_options
              : []
            optionsLoaded = true
            optionsLoadingPromise = null
            return requestOptions
          })
          .catch(function (error) {
            optionsLoadingPromise = null
            closeResults()
            setStatus(String((error && error.message) || "Could not load emulsion lanes."), "error")
            throw error
          })
        return optionsLoadingPromise
      }

      function scoreRequestOption(option, query) {
        var cleanedQuery = String(query || "")
          .trim()
          .toLowerCase()
        if (!cleanedQuery) return 0
        var primary = requestOptionPrimaryLabel(option).toLowerCase()
        var secondary = requestOptionSecondaryLabel(option).toLowerCase()
        var searchText = String((option && option.search_text) || "").toLowerCase()
        if (primary === cleanedQuery) return 0
        if (primary.indexOf(cleanedQuery) === 0) return 1
        if (searchText.indexOf(cleanedQuery) === 0) return 2
        if (secondary.indexOf(cleanedQuery) === 0) return 3
        if (primary.indexOf(cleanedQuery) >= 0) return 4
        if (searchText.indexOf(cleanedQuery) >= 0) return 5
        if (secondary.indexOf(cleanedQuery) >= 0) return 6
        return 99
      }

      function compareRequestOptionStrength(left, right) {
        var hIndexDiff =
          Number((right && right.vote_h_index) || 0) - Number((left && left.vote_h_index) || 0)
        if (hIndexDiff) return hIndexDiff
        var liveDiff =
          Number((right && right.live_count) || 0) - Number((left && left.live_count) || 0)
        if (liveDiff) return liveDiff
        var scoreDiff = Number((right && right.score) || 0) - Number((left && left.score) || 0)
        if (scoreDiff) return scoreDiff
        var imageDiff =
          Number((right && right.image_count) || 0) - Number((left && left.image_count) || 0)
        if (imageDiff) return imageDiff
        return String((left && left.vision_id) || "").localeCompare(
          String((right && right.vision_id) || ""),
        )
      }

      function filterRequestOptions(query) {
        var cleanedQuery = String(query || "")
          .trim()
          .toLowerCase()
        var terms = cleanedQuery ? cleanedQuery.split(/\s+/g).filter(Boolean) : []
        var matched = requestOptions.filter(function (option) {
          if (!terms.length) return true
          var haystack = [
            requestOptionPrimaryLabel(option),
            requestOptionSecondaryLabel(option),
            String((option && option.search_text) || ""),
          ]
            .join(" ")
            .toLowerCase()
          for (var i = 0; i < terms.length; i++) {
            if (haystack.indexOf(terms[i]) < 0) return false
          }
          return true
        })
        matched.sort(function (a, b) {
          var scoreDiff = scoreRequestOption(a, cleanedQuery) - scoreRequestOption(b, cleanedQuery)
          if (scoreDiff) return scoreDiff
          return compareRequestOptionStrength(a, b)
        })
        return matched.slice(0, cleanedQuery ? 10 : 6)
      }

      function paintActiveOption() {
        var items = results.querySelectorAll(".icono-request-option")
        for (var i = 0; i < items.length; i++) {
          items[i].classList.toggle("active", i === activeIndex)
        }
        var activeItem = items[activeIndex] || null
        if (activeItem && activeItem.id) {
          queryInput.setAttribute("aria-activedescendant", activeItem.id)
        } else {
          queryInput.removeAttribute("aria-activedescendant")
        }
      }

      async function renderResultsList() {
        await ensureRequestOptionsLoaded()
        filteredOptions = filterRequestOptions(queryInput.value)
        var html = renderRequestOptionButtonMarkup(null, hiddenInput.value, true)
        if (filteredOptions.length) {
          html += filteredOptions
            .map(function (option) {
              return renderRequestOptionButtonMarkup(option, hiddenInput.value, false)
            })
            .join("")
        } else {
          html +=
            '<div class="icono-request-results-empty">No emulsions match that search. Try a workflow code, artist tag, or full vision ID.</div>'
        }
        results.innerHTML = html
        paintActiveOption()
        if (!pickerOpen) openResults()
      }

      function setSelection(option) {
        hiddenInput.value = option && option.vision_id ? String(option.vision_id) : ""
        queryInput.value = option ? requestOptionPrimaryLabel(option) : ""
        closeResults()
      }

      queryInput.addEventListener("focus", function () {
        void renderResultsList()
      })
      queryInput.addEventListener("click", function () {
        void renderResultsList()
      })
      queryInput.addEventListener("input", function () {
        hiddenInput.value = ""
        activeIndex = -1
        void renderResultsList()
      })
      queryInput.addEventListener("keydown", function (event) {
        var items = results.querySelectorAll(".icono-request-option")
        if (event.key === "ArrowDown") {
          event.preventDefault()
          if (!pickerOpen) {
            void renderResultsList()
            return
          }
          activeIndex = Math.min(activeIndex + 1, items.length - 1)
          paintActiveOption()
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          if (!pickerOpen) {
            void renderResultsList()
            return
          }
          activeIndex = Math.max(activeIndex - 1, 0)
          paintActiveOption()
          return
        }
        if (event.key === "Enter" && pickerOpen) {
          event.preventDefault()
          var activeItem = items[activeIndex >= 0 ? activeIndex : 0]
          if (activeItem) activeItem.click()
          return
        }
        if (event.key === "Escape") {
          closeResults()
        }
      })
      results.addEventListener("click", function (event) {
        var button = event.target.closest("[data-icono-request-option]")
        if (!button) return
        var visionId = String(button.getAttribute("data-icono-request-option") || "").trim()
        if (!visionId) {
          setSelection(null)
          return
        }
        for (var i = 0; i < requestOptions.length; i++) {
          if (
            String((requestOptions[i] && requestOptions[i].vision_id) || "").trim() === visionId
          ) {
            setSelection(requestOptions[i])
            return
          }
        }
      })
      if (panel._iconoRequestOutsideClickHandler) {
        document.removeEventListener("click", panel._iconoRequestOutsideClickHandler)
      }
      panel._iconoRequestOutsideClickHandler = function (event) {
        if (!picker.contains(event.target)) closeResults()
      }
      document.addEventListener("click", panel._iconoRequestOutsideClickHandler)
      queryInput.value = ""
      closeResults()
      form.addEventListener("submit", function (event) {
        event.preventDefault()
        var requestedVisionId = String(hiddenInput.value || "").trim()
        var payload = {
          symbol: symbol,
          request_kind: "new_candidate",
          request_mode: requestedVisionId ? "specific" : "random",
          requested_vision_id: requestedVisionId || null,
        }
        var button = form.querySelector('button[type="submit"]')
        if (button) {
          button.disabled = true
          button.textContent = "Submitting..."
        }
        setStatus("", "")
        fetchJSON("/api/iconoplasm/requests", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify(payload),
        })
          .then(function () {
            setStatus("Request queued. The workstation will pick it up on refresh.", "success")
            return loadSummary()
          })
          .catch(function (error) {
            setStatus(String((error && error.message) || "Could not queue request."), "error")
          })
          .finally(function () {
            if (button) {
              button.disabled = false
              button.textContent = String(
                button.getAttribute("data-default-label") || "submit (free)",
              )
            }
          })
      })
    }

    function loadSummary() {
      // Chesterton fence: summary is intentionally its own request. Do not fold
      // this back into a one-shot endpoint that also hydrates picker options.
      return fetchJSON("/api/iconoplasm/requests/gene/" + encodeURIComponent(symbol) + "/summary", {
        credentials: "include",
      }).then(function (state) {
        if (!state || !state.authenticated) {
          body.innerHTML =
            '<div class="icono-home-auth-copy">' +
            '<div class="icono-home-auth-kicker">request access</div>' +
            '<div class="icono-home-auth-title">Log in to request new candidates</div>' +
            '<div class="icono-home-auth-note">Requests feed the workstation queue. You can choose a specific emulsion ID after login.</div>' +
            "</div>" +
            '<div style="display:grid;gap:12px;">' +
            '<a class="icono-home-auth-link" href="' +
            esc(voteLoginUrl()) +
            '">Discord Login</a>' +
            renderGeneRequestSummaryMarkup(
              "Open requests on this gene",
              Array.isArray(state && state.gene_lane_summary) ? state.gene_lane_summary : [],
              "request_count",
            ) +
            '<div data-icono-request-note hidden style="font-size:0.92rem;"></div>' +
            "</div>"
          return state
        }
        wireAuthenticatedRequestForm(state)
        return state
      })
    }

    body.innerHTML = renderRequestShellMarkup(symbol)
    void loadSummary().catch(function (error) {
      setStatus(
        "Request tools unavailable: " + String((error && error.message) || "Unknown error"),
        "error",
      )
      if (!currentUserIsIconoAdmin) return
      loadGeneRequestDiagnostics(symbol)
        .then(function (diagnostics) {
          body.innerHTML += renderRequestDiagnosticsMarkup(diagnostics)
        })
        .catch(function (diagnosticError) {
          body.innerHTML +=
            '<details class="icono-request-diagnostics">' +
            "<summary>Admin diagnostics</summary>" +
            '<div class="icono-request-diagnostics-body">' +
            esc(String((diagnosticError && diagnosticError.message) || "Diagnostics unavailable")) +
            "</div></details>"
        })
    })
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
    var settings = readIconoplasmSettings()
    var useClassicGallery = !!(currentUserIsIconoAdmin && settings && settings.showAllGenes)
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
    renderHomeToolbarAuth()
    renderHomeInstallCta()
    probeForIconoplasmExtensionPresence()

    var grid = document.getElementById("icono-grid")
    var loading = document.getElementById("icono-loading")
    var countEl = document.getElementById("icono-gene-count")
    var orderLabelEl = document.getElementById("icono-order-label")
    var summaryEl = document.getElementById("icono-collection-summary")
    var emptyEl = document.getElementById("icono-empty")
    var sentinelEl = document.getElementById("icono-load-sentinel")
    var input = document.getElementById("icono-q")
    var resultsEl = document.getElementById("icono-results")
    var orderEl = document.getElementById("icono-order")
    var activeGalleryRequest = 0
    var renderDisposed = false
    var galleryState = {
      order: useClassicGallery ? GALLERY_DEFAULT_ORDER : HOME_COLLECTION_DEFAULT_ORDER,
      offset: 0,
      total: 0,
      publishedTotal: 0,
      loading: false,
      hasMore: false,
      seed: "",
      items: [],
      prefillTarget: HOME_COLLECTION_PAGE_SIZE,
      ready: false,
      readyPromise: null,
      authenticated: false,
      showAllGenes: useClassicGallery,
      discoveryEntries: [],
      sortedDiscoveries: [],
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

    function activeDefaultOrder() {
      return useClassicGallery ? GALLERY_DEFAULT_ORDER : HOME_COLLECTION_DEFAULT_ORDER
    }

    function activeOrderMarkup() {
      return useClassicGallery ? galleryOptionsMarkup() : homeCollectionOptionsMarkup()
    }

    function syncHomeModeChrome() {
      if (orderLabelEl) orderLabelEl.textContent = "Sort"
      if (!orderEl) return
      var previousValue = String(orderEl.value || "").trim()
      orderEl.innerHTML = activeOrderMarkup()
      var nextValue = useClassicGallery
        ? normalizeHomeCollectionOrder(
            previousValue || GALLERY_DEFAULT_ORDER,
            GALLERY_DEFAULT_ORDER,
          )
        : normalizeHomeCollectionOrder(previousValue || HOME_COLLECTION_DEFAULT_ORDER)
      var hasValue = false
      for (var i = 0; i < orderEl.options.length; i++) {
        if (orderEl.options[i].value === nextValue) {
          hasValue = true
          break
        }
      }
      orderEl.value = hasValue ? nextValue : activeDefaultOrder()
    }

    syncHomeModeChrome()

    function currentGalleryLimit() {
      if (useClassicGallery) {
        if (galleryState.offset === 0) return GALLERY_INITIAL_PAGE_SIZE
        if (galleryState.offset < galleryState.prefillTarget) {
          return Math.max(1, galleryState.prefillTarget - galleryState.offset)
        }
        return GALLERY_PAGE_SIZE
      }
      if (galleryState.offset === 0) return HOME_COLLECTION_INITIAL_PAGE_SIZE
      if (galleryState.offset < galleryState.prefillTarget) {
        return Math.max(1, galleryState.prefillTarget - galleryState.offset)
      }
      return HOME_COLLECTION_PAGE_SIZE
    }

    function setLoadingState(message, show) {
      var text = String(message || "").trim()
      loading.textContent = text
      loading.hidden = !(show && text)
    }

    function syncHeroCount() {
      if (!countEl) return
      if (useClassicGallery) {
        var galleryPublishedCount = Number(galleryState.publishedTotal || 0)
        var galleryTotalCount = Number(galleryState.total || 0)
        iconoSidebarState.total = galleryTotalCount
        iconoSidebarState.publishedTotal = galleryPublishedCount
        renderIconoplasmSidebar()
        if (!galleryTotalCount && !galleryPublishedCount) {
          countEl.textContent = "Loading gallery..."
          return
        }
        countEl.textContent =
          galleryTotalCount.toLocaleString() +
          " human genes, " +
          galleryPublishedCount.toLocaleString() +
          " AI images"
        return
      }
      if (!galleryState.ready) {
        countEl.textContent = "Loading your collection..."
        return
      }
      var discoveredCount = Number(galleryState.discoveryEntries.length || 0)
      var publishedCount = Number(galleryState.publishedTotal || 0)
      var totalCount = Number(galleryState.total || 0)
      iconoSidebarState.total = discoveredCount
      iconoSidebarState.publishedTotal = totalCount
      renderIconoplasmSidebar()
      if (totalCount > 0) {
        countEl.textContent =
          discoveredCount.toLocaleString() +
          " discovered of " +
          totalCount.toLocaleString() +
          " human genes"
        return
      }
      if (discoveredCount > 0) {
        countEl.textContent = discoveredCount.toLocaleString() + " discovered genes"
        return
      }
      countEl.textContent = galleryState.authenticated
        ? "No discovered genes yet"
        : "Sign in to keep a synced collection"
    }

    function renderCollectionChrome() {
      if (useClassicGallery) {
        if (summaryEl) {
          summaryEl.hidden = true
          summaryEl.innerHTML = ""
        }
        if (emptyEl) {
          emptyEl.hidden = true
          emptyEl.innerHTML = ""
        }
        if (grid) grid.hidden = false
        if (sentinelEl) sentinelEl.hidden = !galleryState.hasMore
        if (orderEl) orderEl.disabled = false
        return
      }
      if (summaryEl) {
        if (!galleryState.ready) {
          summaryEl.hidden = true
          summaryEl.innerHTML = ""
        } else {
          summaryEl.hidden = false
          summaryEl.innerHTML = buildCollectionSummaryMarkup(galleryState)
        }
      }
      var hasItems = !!galleryState.sortedDiscoveries.length
      if (emptyEl) {
        if (!galleryState.ready || hasItems) {
          emptyEl.hidden = true
          emptyEl.innerHTML = ""
        } else {
          emptyEl.hidden = false
          emptyEl.innerHTML = buildCollectionEmptyMarkup(galleryState)
        }
      }
      if (grid) grid.hidden = galleryState.ready && !hasItems
      if (sentinelEl) sentinelEl.hidden = !galleryState.hasMore
      if (orderEl)
        orderEl.disabled = !galleryState.ready || galleryState.sortedDiscoveries.length < 2
    }

    function ensureCollectionReady() {
      if (renderDisposed) return Promise.resolve()
      if (useClassicGallery) {
        galleryState.ready = true
        galleryState.authenticated = !!currentUser
        renderCollectionChrome()
        return Promise.resolve()
      }
      if (galleryState.ready) return Promise.resolve()
      if (galleryState.readyPromise) return galleryState.readyPromise
      // The shared settings bridge populates iconoplasm.brinedew.bio from the canonical
      // settings host on brinedew.bio. Wait for that first sync before the initial
      // discoveries request, otherwise a fresh load can race ahead with stale defaults
      // and silently drop admin-only flags like show_all=1.
      galleryState.readyPromise = Promise.all([
        initialSharedSettingsPromise,
        fetchHomeCollectionCounts(),
      ])
        .then(function (results) {
          if (renderDisposed) return { discoveryData: {}, countData: {} }
          var countData = results[1] || {}
          return fetchDiscoveryState(galleryState.order, galleryState.seed).then(
            function (discoveryData) {
              return {
                discoveryData: discoveryData || {},
                countData: countData,
              }
            },
          )
        })
        .then(function (results) {
          if (renderDisposed) return
          var discoveryData = results.discoveryData || {}
          var countData = results.countData || {}
          galleryState.authenticated = !!discoveryData.authenticated
          galleryState.showAllGenes = !!discoveryData.show_all_applied
          galleryState.order = normalizeHomeCollectionOrder(
            discoveryData.order || galleryState.order,
            galleryState.order,
          )
          galleryState.seed =
            galleryState.order === "random"
              ? String(discoveryData.seed || galleryState.seed || "").trim()
              : ""
          galleryState.discoveryEntries = normalizeDiscoveryEntries(
            galleryState.authenticated ? discoveryData.discoveries : guestStarterDiscoveryEntries(),
          )
          galleryState.total = Math.max(0, Number(countData.total || 0) || 0)
          galleryState.publishedTotal = Math.max(0, Number(countData.publishedTotal || 0) || 0)
          galleryState.sortedDiscoveries = galleryState.discoveryEntries.slice()
          galleryState.hasMore = galleryState.sortedDiscoveries.length > 0
          galleryState.ready = true
          syncHeroCount()
          renderCollectionChrome()
          updateSentinelObserver()
        })
        .finally(function () {
          galleryState.readyPromise = null
        })
      return galleryState.readyPromise
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
      var resolvedOrder = useClassicGallery
        ? String(order || GALLERY_DEFAULT_ORDER).trim() || GALLERY_DEFAULT_ORDER
        : normalizeHomeCollectionOrder(order || HOME_COLLECTION_DEFAULT_ORDER)
      var restoreConfig =
        pendingRestoreState && pendingRestoreState.order === resolvedOrder
          ? pendingRestoreState
          : null
      pendingRestoreState = null
      activeRestoreState = restoreConfig
      scrollRestored = !restoreConfig
      galleryState.order = resolvedOrder
      galleryState.offset = 0
      galleryState.loading = false
      galleryState.total = 0
      galleryState.publishedTotal = 0
      galleryState.ready = useClassicGallery ? true : false
      galleryState.readyPromise = null
      galleryState.authenticated = !!currentUser
      galleryState.showAllGenes = useClassicGallery
      galleryState.discoveryEntries = []
      galleryState.sortedDiscoveries = []
      galleryState.hasMore = useClassicGallery
        ? true
        : galleryState.ready
          ? galleryState.discoveryEntries.length > 0
          : false
      galleryState.seed = useClassicGallery
        ? restoreConfig && restoreConfig.seed
          ? restoreConfig.seed
          : galleryState.order === "random"
            ? newRandomSeed()
            : ""
        : galleryState.order === "random"
          ? restoreConfig && restoreConfig.seed
            ? restoreConfig.seed
            : newRandomSeed()
          : ""
      galleryState.items = []
      galleryState.prefillTarget = Math.max(
        useClassicGallery ? GALLERY_PAGE_SIZE : HOME_COLLECTION_PAGE_SIZE,
        Number((restoreConfig && restoreConfig.loadedCount) || 0) || 0,
      )
      clearBackgroundPrefill()
      grid.setAttribute("data-layout", homeLayout)
      grid.setAttribute("aria-busy", "true")
      grid.hidden = false
      grid.innerHTML = buildHomeSkeletonGridMarkup(homeLayout)
      destroyHomeMasonry()
      if (typeof grid._iconoPrefetchCleanup === "function") {
        grid._iconoPrefetchCleanup()
      }
      if (summaryEl) {
        summaryEl.hidden = true
        summaryEl.innerHTML = ""
      }
      if (emptyEl) {
        emptyEl.hidden = true
        emptyEl.innerHTML = ""
      }
      if (orderEl) orderEl.value = resolvedOrder
      setLoadingState("", false)
      syncHeroCount()
      renderCollectionChrome()
      updateSentinelObserver()
      if (!restoreConfig) {
        window.scrollTo(0, 0)
      }
      syncHomeHistoryState(false)
      loadNextGalleryPage()
    }

    function loadNextGalleryPage() {
      if (renderDisposed) return
      if (galleryState.loading || (galleryState.ready && !galleryState.hasMore)) return
      galleryState.loading = true
      setLoadingState("", false)
      var pageLimit = currentGalleryLimit()

      var requestId = ++activeGalleryRequest
      if (useClassicGallery) {
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
            if (renderDisposed || requestId !== activeGalleryRequest) return
            var items = Array.isArray(data && data.items) ? data.items : []
            var isFirstPage = galleryState.offset === 0
            galleryState.order = String((data && data.order) || galleryState.order)
            galleryState.seed = String((data && data.seed) || galleryState.seed || "")
            galleryState.total = Number((data && data.total) || galleryState.total || 0)
            galleryState.publishedTotal = Number(
              (data && data.published_total) || galleryState.publishedTotal || 0,
            )
            galleryState.hasMore = Boolean(data && data.has_more)
            galleryState.ready = true
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
            renderCollectionChrome()
            updateSentinelObserver()
            setLoadingState("", false)
            syncHomeHistoryState(false)
            maybeRestoreHomeScroll()
            if (orderEl && orderEl.value !== galleryState.order) {
              orderEl.value = galleryState.order
            }
          })
          .catch(function (err) {
            if (renderDisposed || requestId !== activeGalleryRequest) return
            grid.setAttribute("aria-busy", "false")
            setLoadingState("Failed to load portraits.", true)
            console.error("[Iconoplasm] gallery load error:", err)
          })
          .finally(function () {
            if (!renderDisposed && requestId === activeGalleryRequest) {
              galleryState.loading = false
            }
          })
        return
      }
      ensureCollectionReady()
        .then(function () {
          if (renderDisposed || requestId !== activeGalleryRequest) return
          var pageEntries = galleryState.sortedDiscoveries.slice(
            galleryState.offset,
            galleryState.offset + pageLimit,
          )
          var isFirstPage = galleryState.offset === 0
          galleryState.hasMore =
            galleryState.offset + pageEntries.length < galleryState.sortedDiscoveries.length
          if (!pageEntries.length) {
            if (isFirstPage) {
              grid.innerHTML = ""
              grid.setAttribute("aria-busy", "false")
            }
            renderCollectionChrome()
            syncHeroCount()
            updateSentinelObserver()
            setLoadingState("", false)
            syncHomeHistoryState(false)
            maybeRestoreHomeScroll()
            return
          }
          return Promise.all(
            pageEntries.map(function (entry) {
              return loadDiscoveredGeneCardData(entry)
            }),
          ).then(function (items) {
            if (renderDisposed || requestId !== activeGalleryRequest) return
            var resolvedItems = (Array.isArray(items) ? items : []).filter(Boolean)
            if (isFirstPage) {
              grid.innerHTML = ""
              grid.setAttribute("data-layout", homeLayout)
              grid.setAttribute("aria-busy", "false")
            }
            if (resolvedItems.length) {
              var newCards = appendGrid(grid, resolvedItems, galleryState.items.length, homeLayout)
              galleryState.items = galleryState.items.concat(resolvedItems)
              galleryState.offset += pageEntries.length
              if (homeLayout === "masonry") {
                applyHomeMasonry(grid, newCards)
                setupOrderedPortraitPrefetch(grid, galleryState.items)
              } else {
                destroyHomeMasonry()
                warmBrickCardImages(resolvedItems)
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
            } else {
              galleryState.offset += pageEntries.length
            }
            renderCollectionChrome()
            syncHeroCount()
            updateSentinelObserver()
            setLoadingState("", false)
            syncHomeHistoryState(false)
            maybeRestoreHomeScroll()
            if (orderEl && orderEl.value !== galleryState.order) {
              orderEl.value = galleryState.order
            }
          })
        })
        .catch(function (err) {
          if (renderDisposed || requestId !== activeGalleryRequest) return
          grid.setAttribute("aria-busy", "false")
          setLoadingState("Failed to load your collection.", true)
          console.error("[Iconoplasm] collection load error:", err)
        })
        .finally(function () {
          if (!renderDisposed && requestId === activeGalleryRequest) {
            galleryState.loading = false
          }
        })
    }

    if (orderEl) {
      orderEl.addEventListener("change", function () {
        resetGallery(orderEl.value || activeDefaultOrder())
      })
    }

    activeHomeHistorySnapshot = snapshotHomeState
    var handleHomeScroll = function () {
      syncHomeHistoryState(false)
    }
    window.addEventListener("scroll", handleHomeScroll, { passive: true })
    activeHomeRenderCleanup = function () {
      renderDisposed = true
      activeGalleryRequest += 1
      galleryState.loading = false
      galleryState.readyPromise = null
      if (sentinelObserver) {
        sentinelObserver.disconnect()
        sentinelObserver = null
      }
      clearBackgroundPrefill()
      window.removeEventListener("scroll", handleHomeScroll)
    }

    resetGallery(pendingRestoreState ? pendingRestoreState.order : activeDefaultOrder())

    function activeSearchScope() {
      return useClassicGallery ? "catalog" : "discoveries"
    }

    function fetchScopedSearchResults(query) {
      var path =
        "/api/public/v1/genes/search?q=" +
        encodeURIComponent(query) +
        "&limit=12&scope=" +
        encodeURIComponent(activeSearchScope())
      return fetchAuthedJSON(path)
    }

    // Search with debounce
    var timer = null
    var activeIndex = -1
    var currentResults = []

    input.addEventListener("input", function () {
      var q = input.value.trim()
      clearTimeout(timer)
      activeIndex = -1
      if (!q) {
        currentResults = []
        resultsEl.innerHTML = ""
        return
      }
      timer = setTimeout(function () {
        fetchScopedSearchResults(q)
          .then(function (data) {
            currentResults = data.genes || []
            renderSearchResults(resultsEl, currentResults)
          })
          .catch(function () {
            currentResults = []
            resultsEl.innerHTML = ""
          })
      }, DEBOUNCE_MS)
    })

    // Keyboard navigation in search dropdown
    input.addEventListener("keydown", function (e) {
      var items = resultsEl.querySelectorAll(".icono-search-result")
      if (!items.length) {
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
        } else if (currentResults[0]) {
          navigateTo("/gene/" + encodeURIComponent(currentResults[0].symbol))
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
      var portraitUrl = publishedPortraitUrl(g, "thumb") || publishedPortraitUrl(g, "medium")
      var mediaHtml = portraitUrl
        ? '<span class="icono-search-result-media icono-search-result-media--portrait">' +
          '<img class="icono-search-result-portrait icono-thumbnail-viewport-image" src="' +
          esc(portraitUrl) +
          '" alt="' +
          esc(g.symbol) +
          ' blot" loading="eager" decoding="async">' +
          "</span>"
        : '<span class="icono-search-result-media icono-search-result-media--fallback" style="background:' +
          esc(g.color) +
          '"></span>'
      html +=
        '<a class="icono-search-result" href="/gene/' +
        esc(encodeURIComponent(g.symbol)) +
        '" target="_blank" rel="noopener noreferrer">' +
        mediaHtml +
        '<span class="icono-search-result-copy">' +
        '<span class="icono-search-result-symbol">' +
        esc(g.symbol) +
        "</span>" +
        '<span class="icono-search-result-name">' +
        esc(g.full_name) +
        "</span>" +
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
        '" target="_blank" rel="noopener noreferrer" data-icono-index="' +
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
            ' blot" loading="' +
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
      "<h2>Candidate blots</h2>" +
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
      var candidateMetaMarkup = renderEmulsionMetaMarkup(candidate, {
        kicker: "candidate emulsion",
        className: "icono-candidate-emulsion-meta",
      })
      var voteAttrs = 'data-icono-candidate-vote-box="' + esc(assetSha) + '"'
      if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
        voteAttrs +=
          ' data-icono-candidate-image-id="' + esc(String(Math.round(candidateImageId))) + '"'
      }
      if (visionId) {
        voteAttrs += ' data-icono-vision-id="' + esc(visionId) + '"'
      }
      var removeMarkup = ""
      if (currentUserIsIconoAdmin && assetSha) {
        removeMarkup =
          '<div class="icono-candidate-admin-actions">' +
          '<button type="button" class="icono-candidate-remove-button" data-icono-candidate-remove="true" data-icono-symbol="' +
          esc(genePayload.symbol) +
          '" data-icono-asset-sha256="' +
          esc(assetSha) +
          '" data-icono-candidate-image-id="' +
          esc(candidateImageId > 0 ? String(Math.round(candidateImageId)) : "") +
          '" aria-label="Remove candidate blot for ' +
          esc(genePayload.symbol) +
          '">Remove</button>' +
          "</div>"
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
        ' candidate blot" data-pswp-width="' +
        width +
        '" data-pswp-height="' +
        height +
        '" aria-label="Open candidate blot for ' +
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
        ' candidate blot" loading="' +
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
        (candidateMetaMarkup
          ? '<div class="icono-candidate-meta">' + candidateMetaMarkup + "</div>"
          : "") +
        '<div class="icono-candidate-footer">' +
        voteBoxMarkup(voteAttrs) +
        removeMarkup +
        "</div>" +
        '<details class="icono-candidate-copy-panel">' +
        '<summary>copy this image to another gene</summary>' +
        '<form class="icono-request-form" data-icono-candidate-copy-form data-icono-source-symbol="' +
        esc(genePayload.symbol) +
        '" data-icono-asset-sha256="' +
        esc(assetSha) +
        '">' +
        '<input class="icono-search-input icono-request-picker-input" data-icono-candidate-copy-query type="text" autocomplete="off" placeholder="target gene symbol" aria-label="Target gene">' +
        '<input type="hidden" data-icono-candidate-copy-target value="">' +
        '<button type="submit" class="icono-request-inline-submit">copy this image to another gene</button>' +
        '<div class="icono-search-results icono-request-results" data-icono-candidate-copy-results hidden></div>' +
        '<div data-icono-candidate-copy-note hidden style="font-size:0.92rem;"></div>' +
        "</form>" +
        "</details>" +
        "</article>"
    }
    html += "</div>" + "</section>"
    return html
  }

  /* ─── Rendering: Gene detail page ─── */

  function renderGene(root, symbol, options) {
    var opts = options || {}
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

    var detailPath = "/api/iconoplasm/site/genes/" + encodeURIComponent(symbol)
    var detailRequestInit = undefined
    if (opts.forceFresh) {
      detailPath += "?fresh=" + encodeURIComponent(String(Date.now()))
      detailRequestInit = { cache: "no-store" }
      invalidateGeneDetail(symbol)
    }

    fetchJSON(detailPath, detailRequestInit)
      .then(function (g) {
        portraitDetailCache[normalizedSymbol(g && g.symbol ? g.symbol : symbol)] = g
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

    // Sample / character description
    var manifestation = g.manifestation || g.description || ""
    if (manifestation) {
      html += '<p class="icono-gene-manifestation">' + esc(manifestation) + "</p>"
    }
    html += renderPublishedEmulsionNotice(g)
    html += renderEditImageShellMarkup(g)
    // Chesterton fence: this shell must exist before any network round-trip.
    // The old blocking placeholder trained the codebase back toward a monolithic
    // request-state bootstrap. Keep the shell static and let summary/options
    // load through their own endpoints.
    html +=
      '<section class="icono-gene-request-surface icono-gene-request-panel" data-icono-request-panel="' +
      esc(g.symbol) +
      '">' +
      "<div data-icono-request-body>" +
      renderRequestShellMarkup(g.symbol) +
      "</div>" +
      "</section>"
    html += "</section>"

    html += renderCandidateGallery(g)

    container.innerHTML = html
    wireGeneVoteBox(container, g)
    wireGeneEditImagePanel(container, g)
    wireGeneRequestPanel(container, g)
    wireCandidateVoteBoxes(container, g)
    wireCandidateRemoveButtons(container, g)
    wireCandidateCopyForms(container, g)
    applyCandidateMasonry(container.querySelector(".icono-candidate-grid"))
    refreshPortraitLightbox()
    var fullPortraitUrl = publishedPortraitUrl(g, "full")
    if (fullPortraitUrl) {
      // The gene page already knows which full-size portrait the lightbox will open. Warm it
      // after the main view settles so the first zoom avoids an on-demand fetch, and keep a small
      // retained image cache so reopening the same portrait is less likely to flash a loader just
      // to rebuild and decode a fresh <img> element.
      deferWork(function () {
        void preloadImage(fullPortraitUrl, { retain: true })
      })
    }
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
  var mobileLabelReviewMode = false
  var mobileLabelBreakpointObserverStarted = false
  var queuedMobileLabelBreakpointRefresh = false

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

  function reconcileMobileLabelBreakpoint() {
    if (typeof window === "undefined") return
    var nextMode = isMobileLabelReviewEnabled()
    if (nextMode === mobileLabelReviewMode) return
    mobileLabelReviewMode = nextMode
    var route = getRoute()
    if (route.page === "home") {
      // Card markup chooses between desktop and mobile review modes during render.
      // If the viewport crosses the breakpoint after first paint, we need a real rerender,
      // not just CSS, or desktop-built cards stay stuck without mobile review affordances.
      syncHomeHistoryState(true)
      render()
      return
    }
    if (route.page === "gene") {
      rerenderCurrentGeneRoute()
    }
  }

  function queueMobileLabelBreakpointRefresh() {
    if (queuedMobileLabelBreakpointRefresh) return
    queuedMobileLabelBreakpointRefresh = true
    var flush = function () {
      queuedMobileLabelBreakpointRefresh = false
      reconcileMobileLabelBreakpoint()
    }
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(flush)
      return
    }
    window.setTimeout(flush, 0)
  }

  function startMobileLabelBreakpointObserver() {
    if (mobileLabelBreakpointObserverStarted || typeof window === "undefined") return
    mobileLabelBreakpointObserverStarted = true
    mobileLabelReviewMode = isMobileLabelReviewEnabled()
    var mq = window.matchMedia("(max-width: 720px)")
    var handleBreakpointChange = function () {
      queueMobileLabelBreakpointRefresh()
    }
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handleBreakpointChange)
    } else if (typeof mq.addListener === "function") {
      mq.addListener(handleBreakpointChange)
    }
    window.addEventListener("resize", handleBreakpointChange, { passive: true })
  }

  function readHomeRestoreState() {
    var state = readHistoryState()
    if (!state || state.iconoplasmPage !== "home") return null
    var home = state.iconoplasmHome
    if (!home || typeof home !== "object") return null
    var order = normalizeHomeCollectionOrder(home.order || HOME_COLLECTION_DEFAULT_ORDER)
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
    mobileLabelReviewMode = isMobileLabelReviewEnabled()
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

  window.addEventListener(ICONO_EXTENSION_PRESENCE_EVENT, handleIconoplasmExtensionPresence)

  document.addEventListener("iconoplasmsettingschange", function () {
    var route = getRoute()
    if (route.page === "home") {
      syncHomeHistoryState(true)
      render()
      return
    }
    if (route.page === "gene") {
      render()
    }
  })

  /* ─── Init ─── */

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    startMobileLabelBreakpointObserver()
    startSharedIconoplasmSettingsAutoSync()
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
