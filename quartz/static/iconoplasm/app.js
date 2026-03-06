import PhotoSwipe from "./vendor/photoswipe.esm.js?v=20260306d"

;(function () {
  "use strict"

  /* ─── Constants ─── */
  var ROOT_ID = "iconoplasm-root"
  var DEBOUNCE_MS = 200
  var GALLERY_PAGE_SIZE = 30
  var GALLERY_DEFAULT_ORDER = "votes"
  var GALLERY_ORDERS = [
    { value: "votes", label: "Votes" },
    { value: "popularity", label: "Popularity" },
    { value: "newest", label: "Newest" },
    { value: "random", label: "Random" },
  ]
  var PREFETCH_BATCH_SIZE = 20
  var PREFETCH_TRIGGER_OFFSET = 10
  var PREFETCH_DETAIL_CONCURRENCY = 4
  var ICONO_CHECK_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10.5 8.25 13.75 15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var ICONO_CROSS_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6 14 14M14 6 6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  var portraitDetailCache = Object.create(null)
  var portraitDetailPromiseCache = Object.create(null)
  var portraitImageCache = Object.create(null)
  var portraitImagePromiseCache = Object.create(null)
  var homeMasonry = null
  var candidateMasonry = null
  var portraitLightboxCleanup = null

  /* ─── API helpers ─── */

  function apiBase() {
    var host = String(window.location.hostname || "").toLowerCase()
    if (host === "iconoplasm.brinedew.bio") return window.location.origin
    if (host === "staging.brinedew.bio") return window.location.origin
    if (host === "brinedew.bio" || host === "www.brinedew.bio") return "https://iconoplasm.brinedew.bio"
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
          var err = new Error((payload && payload.error) || ("HTTP " + r.status))
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
    return String(symbol || "").trim().toUpperCase()
  }

  function publishedPortraitUrl(genePayload, preferredSize) {
    var portrait = genePayload && genePayload.portrait
    var flatHeroUrl = String(genePayload && genePayload.ph || "").trim()
    var flatMediumUrl = String(genePayload && genePayload.pt || "").trim()
    var isPublished =
      (portrait && portrait.status === "published") ||
      Boolean(flatHeroUrl || flatMediumUrl)
    if (!isPublished) return ""
    var heroUrl = String(portrait && portrait.hero_url || flatHeroUrl).trim()
    var mediumUrl = String(portrait && portrait.medium_url || flatMediumUrl).trim()
    var thumbUrl = String(portrait && portrait.thumb_url || "").trim()
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
    var assetSha = String(portrait && portrait.asset_sha256 || "").trim().toLowerCase()
    var candidates = Array.isArray(genePayload && genePayload.portrait_candidates)
      ? genePayload.portrait_candidates
      : []
    var matchedCandidate = null
    if (assetSha) {
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i]
        var candidateSha = String(candidate && candidate.asset_sha256 || "").trim().toLowerCase()
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
      0
    )
    var height = Number(
      (portrait && (portrait.height || portrait.image_height)) ||
      (matchedCandidate && (matchedCandidate.height || matchedCandidate.image_height)) ||
      (genePayload && genePayload.height) ||
      0
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
      window.requestIdleCallback(function () {
        task()
      }, { timeout: 1200 })
      return
    }
    window.setTimeout(task, 120)
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
      img.addEventListener("load", function () {
        finish(resolvedUrl)
      }, { once: true })
      img.addEventListener("error", function () {
        finish("")
      }, { once: true })
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
          var trigger = event.target && event.target.closest
            ? event.target.closest("[data-icono-pswp]")
            : null
          if (!trigger || !gallery.contains(trigger)) return
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
              alt: link.getAttribute("data-icono-pswp-alt") || link.getAttribute("aria-label") || "",
            })
            if (link === trigger) index = j
          }
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

    portraitDetailPromiseCache[key] = fetchJSON("/api/gene/" + encodeURIComponent(key))
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
      existing.setAttribute("width", String(dims.width))
      existing.setAttribute("height", String(dims.height))
      media.classList.remove("icono-card-media--fallback")
      return
    }
    media.classList.remove("icono-card-media--fallback")
    media.innerHTML =
      '<img src="' + esc(portraitUrl) + '" alt="' + esc(key) + ' portrait" loading="lazy" decoding="async" width="' + dims.width + '" height="' + dims.height + '">'
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

  function applyHomeMasonry(container, newElements) {
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

  function applyCandidateMasonry(container) {
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

  function galleryOptionsMarkup() {
    var html = ""
    for (var i = 0; i < GALLERY_ORDERS.length; i++) {
      var option = GALLERY_ORDERS[i]
      html +=
        '<option value="' + esc(option.value) + '"' +
          (option.value === GALLERY_DEFAULT_ORDER ? " selected" : "") +
        ">" + esc(option.label) + "</option>"
    }
    return html
  }

  function isLightColor(hex) {
    if (!hex || hex.length < 7) return false
    var r = parseInt(hex.slice(1, 3), 16)
    var g = parseInt(hex.slice(3, 5), 16)
    var b = parseInt(hex.slice(5, 7), 16)
    return (r * 0.299 + g * 0.587 + b * 0.114) > 160
  }

  function textColorFor(hex) {
    return isLightColor(hex) ? "rgba(0,0,0,0.7)" : "#fff"
  }

  function showVoteLoginPopup() {
    window.alert("Please log-in first to vote.")
  }

  function voteBoxMarkup(extraAttrs) {
    var attrs = extraAttrs ? " " + extraAttrs : ""
    return (
      '<div class="icono-vote-box" data-icono-vote-box' + attrs + '>' +
        '<button type="button" class="icono-vote-btn icono-vote-btn--approve" data-icono-vote-up aria-label="Approve portrait" title="Approve portrait">' + ICONO_CHECK_ICON + '</button>' +
        '<span class="icono-vote-stats" data-icono-vote-stats title="Score +0 (0 approvals / 0 rejections)" aria-live="polite">0</span>' +
        '<button type="button" class="icono-vote-btn icono-vote-btn--reject" data-icono-vote-down aria-label="Reject portrait" title="Reject portrait">' + ICONO_CROSS_ICON + '</button>' +
      '</div>'
    )
  }

  function voteSummaryText(snapshot) {
    return String(Number((snapshot || {}).image_score || 0))
  }

  function voteSummaryDetails(snapshot) {
    var data = snapshot || {}
    var up = Number(data.image_upvotes || 0)
    var down = Number(data.image_downvotes || 0)
    var score = Number(data.image_score || 0)
    var sign = score > 0 ? "+" : ""
    return "Score " + sign + score + " (" + up + " approvals / " + down + " rejections)"
  }

  function scoreLabel(scoreValue) {
    return String(Number(scoreValue || 0))
  }

  function setVoteBoxState(box, opts) {
    if (!box) return
    var statsEl = box.querySelector("[data-icono-vote-stats]")
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")
    var snapshot = (opts && opts.snapshot) || {}
    var pending = !!(opts && opts.pending)
    var userVote = Number(snapshot.user_vote || 0)
    if (statsEl) {
      statsEl.textContent = voteSummaryText(snapshot)
      statsEl.setAttribute("title", voteSummaryDetails(snapshot))
    }
    if (upBtn) {
      upBtn.disabled = pending
      upBtn.classList.toggle("active", userVote === 1)
    }
    if (downBtn) {
      downBtn.disabled = pending
      downBtn.classList.toggle("active", userVote === -1)
    }
  }

  function wireVoteBox(box, symbolValue, assetShaValue) {
    if (!box) return
    var symbol = String(symbolValue || "").trim().toUpperCase()
    var assetSha = String(assetShaValue || "").trim().toLowerCase()
    if (!symbol || !assetSha) return
    var candidateRef = "a:" + symbol + "|" + assetSha
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")
    var state = {
      authenticated: false,
      pending: false,
      snapshot: {
        image_upvotes: 0,
        image_downvotes: 0,
        image_score: 0,
        user_vote: 0,
      },
    }

    function render() {
      setVoteBoxState(box, state)
    }

    function refreshSnapshot() {
      state.pending = true
      render()
      return fetchJSON("/api/iconoplasm/votes/snapshot", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_ref: candidateRef,
          symbol: symbol,
          asset_sha256: assetSha,
          vision_id: "",
        }),
      })
        .then(function (data) {
          state.authenticated = !!(data && data.authenticated)
          state.snapshot = (data && data.snapshot) || state.snapshot
        })
        .catch(function (err) {
          console.error("[Iconoplasm] vote snapshot error:", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    function submitVote(voteValue) {
      state.pending = true
      render()
      fetchJSON("/api/iconoplasm/votes/set", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_ref: candidateRef,
          symbol: symbol,
          asset_sha256: assetSha,
          vision_id: "",
          vote_value: voteValue,
        }),
      })
        .then(function (data) {
          state.authenticated = true
          state.snapshot = (data && data.snapshot) || state.snapshot
        })
        .catch(function (err) {
          if (Number(err && err.status || 0) === 401 || (err && err.payload && err.payload.code === "AUTH_REQUIRED")) {
            state.authenticated = false
            showVoteLoginPopup()
            return
          }
          console.error("[Iconoplasm] vote set error:", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    if (upBtn) {
      upBtn.addEventListener("click", function () {
        submitVote(1)
      })
    }
    if (downBtn) {
      downBtn.addEventListener("click", function () {
        submitVote(-1)
      })
    }
    render()
    refreshSnapshot()
  }

  function wireGeneVoteBox(container, genePayload) {
    var box = container.querySelector("[data-icono-vote-box]")
    if (!box) return
    var symbol = String(genePayload && genePayload.symbol || "").trim().toUpperCase()
    var portrait = (genePayload && genePayload.portrait) || {}
    wireVoteBox(box, symbol, portrait.asset_sha256)
  }

  function wireCandidateVoteBoxes(container, genePayload) {
    if (!container || !genePayload) return
    var symbol = String(genePayload.symbol || "").trim().toUpperCase()
    var boxes = container.querySelectorAll("[data-icono-candidate-vote-box]")
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i]
      wireVoteBox(box, symbol, box.getAttribute("data-icono-candidate-vote-box"))
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

  function renderHome(root) {
    root.innerHTML =
      '<div class="icono-hero">' +
        '<h1>Iconoplasm</h1>' +
        '<p class="tagline">Visual mnemonics for molecular cell biology</p>' +
        '<span class="stat" id="icono-gene-count">...</span>' +
      '</div>' +
      '<div class="icono-gallery-toolbar">' +
        '<div class="icono-search icono-search--toolbar">' +
          '<div class="icono-search-wrapper">' +
            '<input type="text" id="icono-q" placeholder="Search by gene symbol or name..." autocomplete="off" />' +
            '<div class="icono-search-results" id="icono-results"></div>' +
          '</div>' +
        '</div>' +
        '<label class="icono-gallery-order" for="icono-order">' +
          '<span>Order by</span>' +
          '<select id="icono-order">' + galleryOptionsMarkup() + '</select>' +
        '</label>' +
      '</div>' +
      '<div class="icono-loading" id="icono-loading">Loading portraits...</div>' +
      '<div class="icono-grid" id="icono-grid"></div>' +
      '<div class="icono-load-sentinel" id="icono-load-sentinel" aria-hidden="true"></div>'

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
    }
    var sentinelObserver = null

    function newRandomSeed() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    }

    function setLoadingState(message, show) {
      loading.textContent = message
      loading.style.display = show ? "block" : "none"
    }

    function syncHeroCount() {
      if (!countEl) return
      var publishedCount = Number(galleryState.publishedTotal || 0)
      var totalCount = Number(galleryState.total || 0)
      countEl.textContent = publishedCount.toLocaleString() + " portraits, " + totalCount.toLocaleString() + " genes"
    }

    function updateSentinelObserver() {
      if (sentinelObserver) {
        sentinelObserver.disconnect()
        sentinelObserver = null
      }
      if (!sentinelEl || !galleryState.hasMore) return
      sentinelObserver = new IntersectionObserver(function (entries) {
        var entry = entries && entries[0]
        if (!entry || !entry.isIntersecting) return
        loadNextGalleryPage()
      }, {
        rootMargin: "900px 0px 1200px 0px",
      })
      sentinelObserver.observe(sentinelEl)
    }

    function resetGallery(order) {
      galleryState.order = order || GALLERY_DEFAULT_ORDER
      galleryState.offset = 0
      galleryState.total = 0
      galleryState.publishedTotal = 0
      galleryState.loading = false
      galleryState.hasMore = true
      galleryState.seed = galleryState.order === "random" ? newRandomSeed() : ""
      galleryState.items = []
      grid.innerHTML = ""
      destroyHomeMasonry()
      if (typeof grid._iconoPrefetchCleanup === "function") {
        grid._iconoPrefetchCleanup()
      }
      setLoadingState("Loading gallery...", true)
      updateSentinelObserver()
      loadNextGalleryPage()
    }

    function loadNextGalleryPage() {
      if (galleryState.loading || !galleryState.hasMore) return
      galleryState.loading = true
      setLoadingState(galleryState.offset > 0 ? "Loading more..." : "Loading gallery...", true)

      var requestId = ++activeGalleryRequest
      var path =
        "/api/gallery?order=" + encodeURIComponent(galleryState.order) +
        "&limit=" + encodeURIComponent(String(GALLERY_PAGE_SIZE)) +
        "&offset=" + encodeURIComponent(String(galleryState.offset))
      if (galleryState.seed) {
        path += "&seed=" + encodeURIComponent(galleryState.seed)
      }

      fetchJSON(path)
        .then(function (data) {
          if (requestId !== activeGalleryRequest) return
          var items = Array.isArray(data && data.items) ? data.items : []
          galleryState.order = String(data && data.order || galleryState.order)
          galleryState.seed = String(data && data.seed || galleryState.seed || "")
          galleryState.total = Number(data && data.total || galleryState.total || 0)
          galleryState.publishedTotal = Number(data && data.published_total || galleryState.publishedTotal || 0)
          galleryState.hasMore = Boolean(data && data.has_more)
          if (items.length) {
            var newCards = appendGrid(grid, items, galleryState.items.length)
            galleryState.items = galleryState.items.concat(items)
            galleryState.offset += items.length
            applyHomeMasonry(grid, newCards)
            setupOrderedPortraitPrefetch(grid, galleryState.items)
          }
          syncHeroCount()
          updateSentinelObserver()
          setLoadingState(galleryState.hasMore ? "Scroll for more" : "", false)
          if (orderEl && orderEl.value !== galleryState.order) {
            orderEl.value = galleryState.order
          }
        })
        .catch(function (err) {
          if (requestId !== activeGalleryRequest) return
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

    resetGallery(GALLERY_DEFAULT_ORDER)

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
        fetchJSON("/api/genes/search?q=" + encodeURIComponent(q) + "&limit=12")
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
      container.innerHTML = '<div class="icono-search-result" style="pointer-events:none;opacity:0.5;">No results</div>'
      return
    }
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      html +=
        '<a class="icono-search-result" href="/gene/' + esc(encodeURIComponent(g.symbol)) + '" data-icono-nav>' +
          '<span class="icono-search-result-swatch" style="background:' + esc(g.color) + '"></span>' +
          '<span class="icono-search-result-symbol">' + esc(g.symbol) + '</span>' +
          '<span class="icono-search-result-name">' + esc(g.full_name) + '</span>' +
        '</a>'
    }
    container.innerHTML = html
  }

  function buildGridMarkup(genes, startIndex) {
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
        '<a class="icono-card" href="/gene/' + esc(encodeURIComponent(g.symbol)) + '" data-icono-nav data-icono-index="' + cardIndex + '" data-icono-symbol="' + esc(g.symbol) + '" style="--width:' + dims.width + ';--height:' + dims.height + ';--icono-card-accent:' + esc(g.color || "#888") + ';">' +
          '<div class="' + mediaClass + '" style="background:' + esc(g.color) + ';color:' + tc + '">' +
            (portraitUrl
              ? '<img src="' + esc(portraitUrl) + '" alt="' + esc(g.symbol) + ' portrait" loading="' + (cardIndex < 12 ? "eager" : "lazy") + '" decoding="async" width="' + dims.width + '" height="' + dims.height + '" fetchpriority="' + (cardIndex < 8 ? "high" : "low") + '">'
              : '<span class="icono-card-fallback-symbol">' + esc(g.symbol) + '</span>') +
            '<span class="icono-card-badge">' + esc(g.symbol) + '</span>' +
          '</div>' +
          '<div class="icono-card-info">' +
            '<div class="icono-card-name">' + esc(g.full_name) + '</div>' +
          '</div>' +
        '</a>'
    }
    return html
  }

  function renderGrid(container, genes) {
    container.innerHTML = buildGridMarkup(genes, 0)
  }

  function appendGrid(container, genes, startIndex) {
    var html = buildGridMarkup(genes, startIndex)
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
    var gridClass = visibleCandidates.length === 1
      ? "icono-candidate-grid icono-candidate-grid--single"
      : "icono-candidate-grid"
    var html =
      '<section class="icono-candidate-gallery">' +
        '<div class="icono-candidate-gallery-heading">' +
          '<h2>Candidate portraits</h2>' +
        '</div>' +
        '<div class="' + gridClass + '" data-icono-lightbox>'
    for (var i = 0; i < visibleCandidates.length; i++) {
      var candidate = visibleCandidates[i]
      var mediumUrl = candidatePortraitUrl(candidate, "medium")
      var fullUrl = candidatePortraitUrl(candidate, "full") || mediumUrl
      var width = Number(candidate && candidate.width || 4) || 4
      var height = Number(candidate && candidate.height || 5) || 5
      var assetSha = String(candidate && candidate.asset_sha256 || "").trim().toLowerCase()
      html +=
        '<article class="icono-candidate-card" style="--width:' + width + ';--height:' + height + ';">' +
          '<button type="button" class="icono-candidate-media-button" data-icono-pswp data-icono-pswp-src="' + esc(fullUrl) + '" data-icono-pswp-alt="' + esc(genePayload.symbol) + ' portrait candidate" data-pswp-width="' + width + '" data-pswp-height="' + height + '" aria-label="Open candidate portrait for ' + esc(genePayload.symbol) + '">' +
            '<span class="icono-candidate-media">' +
              '<img src="' + esc(mediumUrl) + '" alt="' + esc(genePayload.symbol) + ' portrait candidate" loading="lazy" decoding="async" width="' + width + '" height="' + height + '">' +
            '</span>' +
          '</button>' +
          '<div class="icono-candidate-footer">' +
            voteBoxMarkup('data-icono-candidate-vote-box="' + esc(assetSha) + '"') +
          '</div>' +
        '</article>'
    }
    html +=
        '</div>' +
      '</section>'
    return html
  }

  /* ─── Rendering: Gene detail page ─── */

  function renderGene(root, symbol) {
    root.innerHTML =
      '<div class="icono-nav"><a href="/" data-icono-nav>&larr; All genes</a></div>' +
      '<div class="icono-loading" id="icono-gene-loading">Loading ' + esc(symbol) + '...</div>' +
      '<div id="icono-gene-content"></div>'

    var contentEl = document.getElementById("icono-gene-content")
    var loadingEl = document.getElementById("icono-gene-loading")

    fetchJSON("/api/gene/" + encodeURIComponent(symbol))
      .then(function (g) {
        loadingEl.style.display = "none"
        renderGeneContent(contentEl, g)
      })
      .catch(function (err) {
        loadingEl.style.display = "none"
        contentEl.innerHTML =
          '<div class="icono-empty">' +
            '<h2>Gene not found</h2>' +
            '<p>"' + esc(symbol) + '" doesn\'t match any gene in our catalog.</p>' +
            '<p><a href="/" data-icono-nav>Browse all genes</a></p>' +
          '</div>'
        console.error("[Iconoplasm] gene load error:", err)
      })
  }

  function renderGeneContent(container, g) {
    var portraitDisplayUrl = publishedPortraitUrl(g, "medium")
    var portraitFullUrl = publishedPortraitUrl(g, "full") || portraitDisplayUrl
    var hasPortrait = !!portraitDisplayUrl
    var tc = textColorFor(g.color || "#888")
    var swatchClass = hasPortrait
      ? "icono-gene-swatch icono-gene-swatch--portrait"
      : "icono-gene-swatch"
    var swatchStyle = hasPortrait
      ? ""
      : ' style="background:' + esc(g.color || "#888") + ';color:' + tc + '"'

    var portraitNote = hasPortrait
      ? ""
      : '<p class="icono-portrait-status">Portrait not yet published</p>'

    var voteBox = (hasPortrait && g.portrait && g.portrait.asset_sha256)
      ? (
          '<div class="icono-gene-portrait-footer">' +
            voteBoxMarkup() +
          '</div>'
        )
      : ""

    var portraitDims = portraitDimensions(g)
    var portraitBlock = hasPortrait
      ? (
          '<div class="icono-gene-portrait-shell">' +
            '<div class="icono-gene-media-wrap" data-icono-lightbox>' +
            '<button type="button" class="' + swatchClass + ' icono-gene-media-link" data-icono-pswp data-icono-pswp-src="' + esc(portraitFullUrl) + '" data-icono-pswp-alt="' + esc(g.symbol) + ' portrait" data-pswp-width="' + portraitDims.width + '" data-pswp-height="' + portraitDims.height + '" aria-label="Open full-size portrait for ' + esc(g.symbol) + '">' +
              '<img src="' + esc(portraitDisplayUrl) + '" alt="' + esc(g.symbol) + ' portrait" loading="lazy">' +
              '<span class="icono-gene-symbol-pill">' + esc(g.symbol) + '</span>' +
            '</button>' +
            '</div>' +
            voteBox +
          '</div>'
        )
      : '<div class="' + swatchClass + '"' + swatchStyle + '>' + esc(g.symbol) + '</div>'

    var links = []
    if (g.source_links) {
      if (g.source_links.uniprot) links.push('<a href="' + esc(g.source_links.uniprot) + '">UniProt</a>')
      if (g.source_links.ncbi) links.push('<a href="' + esc(g.source_links.ncbi) + '">NCBI</a>')
      if (g.source_links.ensembl) links.push('<a href="' + esc(g.source_links.ensembl) + '">Ensembl</a>')
    }
    links.push('<a href="/api/gene/' + esc(encodeURIComponent(g.symbol)) + '">API</a>')

    var html =
      '<div class="icono-gene-header">' +
        portraitBlock +
        '<div class="icono-gene-meta">' +
          '<h1>' + esc(g.symbol) + '</h1>' +
          '<p class="full-name">' + esc(g.full_name || "") + '</p>' +
          (g.color
            ? '<div class="icono-color-chip"><span class="icono-color-dot" style="background:' + esc(g.color) + '"></span>' + esc(g.color) + '</div>'
            : "") +
          portraitNote +
          '<div class="icono-links">' + links.join(" ") + '</div>' +
        '</div>' +
      '</div>'

    // Additional metadata sections if available
    var sections = []

    if (g.uniprot_id) {
      sections.push({ label: "UniProt ID", value: g.uniprot_id })
    }
    if (g.gene_names && g.gene_names.length > 1) {
      sections.push({ label: "Aliases", value: g.gene_names.join(", ") })
    }
    if (g.chromosome) {
      sections.push({ label: "Chromosome", value: g.chromosome })
    }
    var essence = g.essence && typeof g.essence === "object" ? g.essence : {}
    var weightKgRaw = null
    if (essence.weight_kg != null) {
      weightKgRaw = Number(essence.weight_kg)
    } else if (g.weight_kg != null) {
      weightKgRaw = Number(g.weight_kg)
    }
    if (Number.isFinite(weightKgRaw) && weightKgRaw > 0) {
      var weightText = (Math.abs(weightKgRaw - Math.round(weightKgRaw)) < 0.05)
        ? String(Math.round(weightKgRaw))
        : weightKgRaw.toFixed(1)
      sections.push({ label: "Weight (kg)", value: weightText + " kg" })
    }

    var heightCmRaw = Number(essence.height_cm)
    if (Number.isFinite(heightCmRaw) && heightCmRaw > 0) {
      sections.push({ label: "Height", value: String(Math.round(heightCmRaw)) + " cm" })
    }
    if (essence.sex) {
      sections.push({ label: "Sex", value: String(essence.sex) })
    }
    var ageText = ""
    if (essence.age) {
      ageText = String(essence.age)
    } else if (essence.age_years != null && Number.isFinite(Number(essence.age_years))) {
      ageText = String(Math.round(Number(essence.age_years)))
    }
    if (ageText) {
      sections.push({ label: "Age", value: ageText })
    }
    if (essence.faction) {
      sections.push({ label: "Faction", value: String(essence.faction) })
    }
    if (essence.skin_hex || essence.skin_name) {
      var skinBits = []
      if (essence.skin_name) skinBits.push(String(essence.skin_name))
      if (essence.skin_hex) skinBits.push("(" + String(essence.skin_hex) + ")")
      sections.push({ label: "Skin", value: skinBits.join(" ") })
    }
    if (Array.isArray(essence.aesthetics) && essence.aesthetics.length) {
      sections.push({ label: "Aesthetics", value: essence.aesthetics.map(String).join(", ") })
    }
    if (essence.family_surname) {
      var familyText = String(essence.family_surname)
      if (Number.isFinite(Number(essence.family_members)) && Number(essence.family_members) > 0) {
        familyText += " (" + String(Math.round(Number(essence.family_members))) + " members)"
      }
      sections.push({ label: "Family", value: familyText })
    }
    if (essence.family_feature) {
      sections.push({ label: "Family Feature", value: String(essence.family_feature) })
    }

    if (sections.length) {
      html += '<div class="icono-gene-sections">'
      for (var i = 0; i < sections.length; i++) {
        html +=
          '<div class="icono-section">' +
            '<div class="icono-section-label">' + esc(sections[i].label) + '</div>' +
            '<div class="icono-section-value">' + esc(sections[i].value) + '</div>' +
          '</div>'
      }
      html += '</div>'
    }

    html += renderCandidateGallery(g)

    container.innerHTML = html
    wireGeneVoteBox(container, g)
    wireCandidateVoteBoxes(container, g)
    applyCandidateMasonry(container.querySelector(".icono-candidate-grid"))
    refreshPortraitLightbox()
  }

  /* ─── Rendering: 404 ─── */

  function render404(root) {
    root.innerHTML =
      '<div class="icono-empty">' +
        '<h2>Page not found</h2>' +
        '<p><a href="/" data-icono-nav>Back to Iconoplasm</a></p>' +
      '</div>'
  }

  /* ─── Client-side navigation ─── */

  function navigateTo(path) {
    window.history.pushState(null, "", path)
    render()
  }

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    destroyHomeMasonry()
    destroyCandidateMasonry()
    var route = getRoute()
    // Update page title
    if (route.page === "home") {
      document.title = "Iconoplasm - Visual Mnemonics for Molecular Cell Biology"
    } else if (route.page === "gene") {
      document.title = route.symbol + " - Iconoplasm"
    }
    // Render the appropriate page
    if (route.page === "home") {
      renderHome(root)
      refreshPortraitLightbox()
    } else if (route.page === "gene") {
      renderGene(root, route.symbol)
    } else {
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
    navigateTo(href)
  })

  window.addEventListener("popstate", function () {
    render()
  })

  /* ─── Init ─── */

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    render()
  }

  // Quartz uses SPA navigation, so the root might already be in the DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  // Also handle Quartz's SPA navigation events
  document.addEventListener("nav", function () {
    // Re-init when Quartz navigates to this page
    setTimeout(init, 0)
  })
})()
