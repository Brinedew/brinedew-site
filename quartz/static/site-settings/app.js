import {
  buildIconoplasmSettings,
  iconoplasmSettingsDefaults,
  readIconoplasmSettings,
  resetIconoplasmSettings,
  writeIconoplasmSettings,
} from "../site-preferences.js?v=20260309e"
import {
  buildSharedUserPanelMarkup,
  fetchAuthenticatedUser,
  mountSidebarStack,
  wireSharedUserPanel,
} from "../shared/sidebar-shell.js?v=20260310d"
;(function () {
  "use strict"

  var ROOT_ID = "site-settings-root"
  var SECTION_LINKS = [
    { id: "iconoplasm", label: "Iconoplasm" },
    { id: "browser", label: "Browser" },
  ]
  var HOME_LAYOUT_OPTIONS = [
    { value: "bricks", label: "Bricks" },
    { value: "masonry", label: "Masonry" },
  ]
  var CARD_VARIANT_OPTIONS = [
    { value: "simple", label: "Simple shared card" },
    { value: "lit-archival", label: "Vintage lab label" },
    { value: "image-only", label: "Image only" },
  ]
  var GENERATION_PROVIDERS = [
    { value: "openai-compatible", label: "OpenAI-compatible" },
    { value: "replicate", label: "Replicate" },
    { value: "gemini", label: "Gemini" },
    { value: "custom", label: "Custom endpoint" },
  ]
  var currentUser = null
  var currentUserIsIconoAdmin = false

  function fetchIconoplasmAdminState() {
    return fetch("/api/iconoplasm/admin/me", {
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

  function esc(value) {
    var node = document.createElement("div")
    node.textContent = String(value || "")
    return node.innerHTML
  }

  function selectOptionsMarkup(selectedValue, options) {
    var html = ""
    for (var i = 0; i < options.length; i++) {
      var option = options[i]
      html +=
        '<option value="' +
        esc(option.value) +
        '"' +
        (option.value === selectedValue ? " selected" : "") +
        ">" +
        esc(option.label) +
        "</option>"
    }
    return html
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify(snapshot || {})
  }

  function comparableSnapshot(snapshot) {
    return {
      iconoplasm: buildIconoplasmSettings((snapshot && snapshot.iconoplasm) || null),
    }
  }

  function currentSettingsSnapshot() {
    return {
      iconoplasm: readIconoplasmSettings(),
    }
  }

  function setActiveNav(sectionId) {
    var links = document.querySelectorAll("[data-settings-nav]")
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var isActive = link.getAttribute("data-settings-nav") === sectionId
      link.setAttribute("data-active", isActive ? "true" : "false")
      if (isActive) {
        link.setAttribute("aria-current", "location")
      } else {
        link.removeAttribute("aria-current")
      }
    }
  }

  function wireSectionTracking(root) {
    if (!root) return
    var sections = root.querySelectorAll(".site-settings-section[id]")
    if (!sections.length) return
    setActiveNav(sections[0].id)
    if (typeof window.IntersectionObserver !== "function") return
    var observer = new window.IntersectionObserver(
      function (entries) {
        var topEntry = null
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (!entry.isIntersecting) continue
          if (!topEntry || entry.intersectionRatio > topEntry.intersectionRatio) {
            topEntry = entry
          }
        }
        if (topEntry && topEntry.target && topEntry.target.id) {
          setActiveNav(topEntry.target.id)
        }
      },
      {
        rootMargin: "-12% 0px -72% 0px",
        threshold: [0.2, 0.55, 0.85],
      },
    )
    for (var j = 0; j < sections.length; j++) observer.observe(sections[j])
  }

  function settingsSidebarMarkup() {
    var html =
      '<div class="site-settings-sidebar-rail">' +
      '<div class="site-settings-sidebar-section">' +
      '<div class="site-settings-sidebar-label">Sections</div>' +
      '<nav class="site-settings-sidebar-nav" aria-label="Settings sections">'
    for (var i = 0; i < SECTION_LINKS.length; i++) {
      html +=
        '<a href="#' +
        esc(SECTION_LINKS[i].id) +
        '" data-settings-nav="' +
        esc(SECTION_LINKS[i].id) +
        '">' +
        esc(SECTION_LINKS[i].label) +
        "</a>"
    }
    html +=
      "</nav>" +
      "</div>" +
      '<div class="site-settings-sidebar-section">' +
      '<div class="site-settings-sidebar-label">Actions</div>' +
      '<div class="site-settings-sidebar-actions">' +
      '<button class="site-settings-sidebar-btn" id="site-settings-save" type="button">Save changes</button>' +
      '<button class="site-settings-sidebar-btn site-settings-sidebar-btn--quiet" id="site-settings-reset" type="button">Reset defaults</button>' +
      '<p class="site-settings-sidebar-status" id="site-settings-status" aria-live="polite"></p>' +
      "</div>" +
      "</div>" +
      "</div>"
    return html
  }

  function mountSidebar() {
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
          id: "site-settings-sidebar",
          className: "brd-sidebar-panel--settings",
          markup: settingsSidebarMarkup(),
        },
      ],
    })
    wireSharedUserPanel(stack, {
      onAuthChanged: function (user) {
        currentUser = user
        void fetchIconoplasmAdminState()
          .then(function (state) {
            currentUserIsIconoAdmin = !!(state && state.is_admin)
            render()
          })
          .catch(function () {
            currentUserIsIconoAdmin = false
            render()
          })
      },
    })
    return stack
  }

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return

    var snapshot = currentSettingsSnapshot()
    root.innerHTML =
      '<div class="site-settings-shell">' +
      '<header class="site-settings-header">' +
      '<h1 class="site-settings-title">Settings</h1>' +
      "</header>" +
      '<section class="site-settings-section" id="iconoplasm">' +
      '<div class="site-settings-section-head">' +
      "<h2>Iconoplasm</h2>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Home layout</h3></div>' +
      '<div class="site-settings-control">' +
      '<select class="site-settings-select" id="site-settings-iconoplasm-layout">' +
      selectOptionsMarkup(snapshot.iconoplasm.homeLayout, HOME_LAYOUT_OPTIONS) +
      "</select>" +
      "</div>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Card style</h3></div>' +
      '<div class="site-settings-control">' +
      '<select class="site-settings-select" id="site-settings-iconoplasm-card-variant">' +
      selectOptionsMarkup(snapshot.iconoplasm.cardVariant, CARD_VARIANT_OPTIONS) +
      "</select>" +
      "</div>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Image generation</h3></div>' +
      '<div class="site-settings-control site-settings-control--stack">' +
      '<label class="site-settings-field" for="site-settings-provider">' +
      "<span>Provider</span>" +
      '<select class="site-settings-select" id="site-settings-provider">' +
      selectOptionsMarkup(snapshot.iconoplasm.generationProvider, GENERATION_PROVIDERS) +
      "</select>" +
      "</label>" +
      '<label class="site-settings-field" for="site-settings-api-key">' +
      "<span>API key</span>" +
      '<div class="site-settings-secret">' +
      '<input class="site-settings-input" id="site-settings-api-key" type="password" autocomplete="off" spellcheck="false" value="' +
      esc(snapshot.iconoplasm.generationApiKey) +
      '">' +
      '<button class="site-settings-inline-btn" id="site-settings-api-key-toggle" type="button" aria-pressed="false">Show</button>' +
      "</div>" +
      "</label>" +
      '<label class="site-settings-field" for="site-settings-model">' +
      "<span>Model</span>" +
      '<input class="site-settings-input" id="site-settings-model" type="text" autocomplete="off" spellcheck="false" value="' +
      esc(snapshot.iconoplasm.generationModel) +
      '" placeholder="gpt-image-1">' +
      "</label>" +
      '<label class="site-settings-field" for="site-settings-endpoint">' +
      "<span>Endpoint</span>" +
      '<input class="site-settings-input" id="site-settings-endpoint" type="url" autocomplete="off" spellcheck="false" value="' +
      esc(snapshot.iconoplasm.generationEndpoint) +
      '" placeholder="Optional override">' +
      "</label>" +
      (currentUserIsIconoAdmin
        ? '<label class="site-settings-toggle" for="site-settings-show-all-genes">' +
          '<input id="site-settings-show-all-genes" type="checkbox"' +
          (snapshot.iconoplasm.showAllGenes ? " checked" : "") +
          ">" +
          '<span><span class="site-settings-toggle-title">Show all genes</span>' +
          '<span class="site-settings-toggle-note">Override your personal discovery shelf in this browser and treat the whole catalog as unlocked until you turn this back off.</span></span>' +
          "</label>"
        : "") +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="browser">' +
      '<div class="site-settings-section-head">' +
      "<h2>Browser</h2>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Storage</h3></div>' +
      '<div class="site-settings-control">' +
      '<div class="site-settings-plain-value">Local to this browser.</div>' +
      "</div>" +
      "</div>" +
      "</section>" +
      "</div>"

    mountSidebar()
    wireSectionTracking(root)

    var layoutEl = document.getElementById("site-settings-iconoplasm-layout")
    var cardVariantEl = document.getElementById("site-settings-iconoplasm-card-variant")
    var providerEl = document.getElementById("site-settings-provider")
    var apiKeyEl = document.getElementById("site-settings-api-key")
    var modelEl = document.getElementById("site-settings-model")
    var endpointEl = document.getElementById("site-settings-endpoint")
    var showAllGenesEl = document.getElementById("site-settings-show-all-genes")
    var toggleBtn = document.getElementById("site-settings-api-key-toggle")
    var saveBtn = document.getElementById("site-settings-save")
    var resetBtn = document.getElementById("site-settings-reset")
    var statusEl = document.getElementById("site-settings-status")
    var savedComparableSnapshot = comparableSnapshot(currentSettingsSnapshot())
    var defaultComparableSnapshot = comparableSnapshot({
      iconoplasm: iconoplasmSettingsDefaults(),
    })

    function setStatus(message, tone, sticky) {
      if (!statusEl) return
      statusEl.textContent = message || ""
      statusEl.className =
        "site-settings-sidebar-status" +
        (tone === "success"
          ? " site-settings-sidebar-status--success"
          : tone === "error"
            ? " site-settings-sidebar-status--error"
            : tone === "dirty"
              ? " site-settings-sidebar-status--dirty"
              : "")
      statusEl.setAttribute("data-sticky", sticky ? "true" : "false")
    }

    function currentDraft() {
      return {
        iconoplasm: buildIconoplasmSettings({
          homeLayout: layoutEl && layoutEl.value,
          cardVariant: cardVariantEl && cardVariantEl.value,
          showAllGenes: showAllGenesEl ? showAllGenesEl.checked : snapshot.iconoplasm.showAllGenes,
          generationProvider: providerEl && providerEl.value,
          generationApiKey: apiKeyEl && apiKeyEl.value,
          generationModel: modelEl && modelEl.value,
          generationEndpoint: endpointEl && endpointEl.value,
        }),
      }
    }

    function refreshDirtyState() {
      var draftComparable = comparableSnapshot(currentDraft())
      var dirty = snapshotSignature(draftComparable) !== snapshotSignature(savedComparableSnapshot)
      var canReset =
        snapshotSignature(draftComparable) !== snapshotSignature(defaultComparableSnapshot)
      if (saveBtn) saveBtn.disabled = !dirty
      if (resetBtn) resetBtn.disabled = !canReset
      if (statusEl && statusEl.getAttribute("data-sticky") === "true") return
      setStatus(dirty ? "Unsaved." : "", dirty ? "dirty" : "", false)
    }

    function bindDirtyTracking(node) {
      if (!node || !node.addEventListener) return
      node.addEventListener("input", refreshDirtyState)
      node.addEventListener("change", refreshDirtyState)
    }

    if (toggleBtn && apiKeyEl) {
      toggleBtn.addEventListener("click", function () {
        var isVisible = apiKeyEl.getAttribute("type") === "text"
        apiKeyEl.setAttribute("type", isVisible ? "password" : "text")
        toggleBtn.textContent = isVisible ? "Show" : "Hide"
        toggleBtn.setAttribute("aria-pressed", isVisible ? "false" : "true")
      })
    }

    bindDirtyTracking(layoutEl)
    bindDirtyTracking(cardVariantEl)
    bindDirtyTracking(providerEl)
    bindDirtyTracking(apiKeyEl)
    bindDirtyTracking(modelEl)
    bindDirtyTracking(endpointEl)
    bindDirtyTracking(showAllGenesEl)

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var draft = currentDraft()
        var iconoplasmOk = writeIconoplasmSettings(draft.iconoplasm)
        if (!iconoplasmOk) {
          setStatus("Could not save in this browser.", "error", true)
          return
        }
        savedComparableSnapshot = comparableSnapshot(currentSettingsSnapshot())
        setStatus("Saved.", "success", true)
        window.setTimeout(function () {
          if (!statusEl || statusEl.textContent !== "Saved.") return
          statusEl.setAttribute("data-sticky", "false")
          refreshDirtyState()
        }, 1600)
        refreshDirtyState()
      })
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        var iconoplasmDefaults = iconoplasmSettingsDefaults()
        var iconoplasmOk = resetIconoplasmSettings()
        if (!iconoplasmOk) iconoplasmOk = writeIconoplasmSettings(iconoplasmDefaults)
        if (!iconoplasmOk) {
          setStatus("Could not reset in this browser.", "error", true)
          return
        }
        render()
        var rerenderedStatus = document.getElementById("site-settings-status")
        if (rerenderedStatus) {
          rerenderedStatus.textContent = "Settings reset to defaults."
          rerenderedStatus.className =
            "site-settings-sidebar-status site-settings-sidebar-status--success"
          rerenderedStatus.setAttribute("data-sticky", "true")
        }
      })
    }

    refreshDirtyState()
  }

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    render()
    void Promise.all([
      fetchAuthenticatedUser().catch(function () {
        return null
      }),
      fetchIconoplasmAdminState(),
    ])
      .then(function (results) {
        currentUser = results[0] || null
        currentUserIsIconoAdmin = !!(results[1] && results[1].is_admin)
        render()
      })
      .catch(function () {
        currentUser = null
        currentUserIsIconoAdmin = false
      })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  document.addEventListener("nav", function () {
    window.setTimeout(init, 0)
  })
})()
