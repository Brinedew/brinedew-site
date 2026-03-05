;(function () {
  "use strict"

  /* ─── Constants ─── */
  var ROOT_ID = "iconoplasm-root"
  var DEBOUNCE_MS = 200
  var GRID_COUNT = 60

  /* ─── API helpers ─── */

  function apiBase() {
    var host = String(window.location.hostname || "").toLowerCase()
    if (host === "iconoplasm.brinedew.bio") return window.location.origin
    if (host === "staging.brinedew.bio") return window.location.origin
    if (host === "brinedew.bio" || host === "www.brinedew.bio") return "https://iconoplasm.brinedew.bio"
    return "https://iconoplasm.brinedew.bio"
  }

  var API = apiBase()

  function fetchJSON(path) {
    return fetch(API + path).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status)
      return r.json()
    })
  }

  /* ─── Utility ─── */

  function esc(s) {
    var d = document.createElement("div")
    d.textContent = s
    return d.innerHTML
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
      '<div class="icono-search">' +
        '<div class="icono-search-wrapper">' +
          '<input type="text" id="icono-q" placeholder="Search by gene symbol or name..." autocomplete="off" />' +
          '<div class="icono-search-results" id="icono-results"></div>' +
        '</div>' +
      '</div>' +
      '<div class="icono-loading" id="icono-loading">Loading genes...</div>' +
      '<div class="icono-grid" id="icono-grid"></div>'

    var grid = document.getElementById("icono-grid")
    var loading = document.getElementById("icono-loading")
    var countEl = document.getElementById("icono-gene-count")
    var input = document.getElementById("icono-q")
    var resultsEl = document.getElementById("icono-results")

    // Load random genes for the grid
    fetchJSON("/api/genes/random?count=" + GRID_COUNT)
      .then(function (data) {
        loading.style.display = "none"
        if (countEl) countEl.textContent = data.total.toLocaleString() + " genes"
        renderGrid(grid, data.genes)
      })
      .catch(function (err) {
        loading.textContent = "Failed to load genes."
        console.error("[Iconoplasm] grid load error:", err)
      })

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

  function renderGrid(container, genes) {
    var html = ""
    for (var i = 0; i < genes.length; i++) {
      var g = genes[i]
      var tc = textColorFor(g.color)
      html +=
        '<a class="icono-card" href="/gene/' + esc(encodeURIComponent(g.symbol)) + '" data-icono-nav>' +
          '<div class="icono-card-swatch" style="background:' + esc(g.color) + ';color:' + tc + '">' + esc(g.symbol) + '</div>' +
          '<div class="icono-card-info">' +
            '<div class="icono-card-symbol">' + esc(g.symbol) + '</div>' +
            '<div class="icono-card-name">' + esc(g.full_name) + '</div>' +
          '</div>' +
        '</a>'
    }
    container.innerHTML = html
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
    var hasPortrait = g.portrait && g.portrait.status === "published" && g.portrait.hero_url
    var tc = textColorFor(g.color || "#888")

    var swatchInner = hasPortrait
      ? '<img src="' + esc(g.portrait.hero_url) + '" alt="' + esc(g.symbol) + ' portrait" loading="lazy">'
      : esc(g.symbol)

    var portraitNote = hasPortrait
      ? ""
      : '<p class="icono-portrait-status">Portrait not yet published</p>'

    var links = []
    if (g.source_links) {
      if (g.source_links.uniprot) links.push('<a href="' + esc(g.source_links.uniprot) + '">UniProt</a>')
      if (g.source_links.ncbi) links.push('<a href="' + esc(g.source_links.ncbi) + '">NCBI</a>')
      if (g.source_links.ensembl) links.push('<a href="' + esc(g.source_links.ensembl) + '">Ensembl</a>')
    }
    links.push('<a href="/api/gene/' + esc(encodeURIComponent(g.symbol)) + '">API</a>')

    var html =
      '<div class="icono-gene-header">' +
        '<div class="icono-gene-swatch" style="background:' + esc(g.color || "#888") + ';color:' + tc + '">' +
          swatchInner +
        '</div>' +
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

    container.innerHTML = html
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
    } else if (route.page === "gene") {
      renderGene(root, route.symbol)
    } else {
      render404(root)
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
