import {
  applyReaderModePreference,
  applyThemePreference,
  buildIconoplasmSettings,
  iconoplasmSettingsDefaults,
  normalizeReaderModePreference,
  normalizeThemePreference,
  readEffectiveTheme,
  readIconoplasmSettings,
  readReaderModePreference,
  readThemePreference,
  resetIconoplasmSettings,
  writeIconoplasmSettings,
} from "../site-preferences.js?v=20260309c"

;(function () {
  "use strict"

  var ROOT_ID = "site-settings-root"
  var SIDEBAR_ID = "site-settings-sidebar"
  var SECTION_LINKS = [
    { id: "appearance", label: "Appearance" },
    { id: "reading", label: "Reading" },
    { id: "iconoplasm", label: "Iconoplasm" },
    { id: "storage", label: "Storage" },
  ]
  var THEME_OPTIONS = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ]
  var READER_OPTIONS = [
    { value: "off", label: "Off" },
    { value: "on", label: "On" },
  ]
  var HOME_LAYOUT_OPTIONS = [
    { value: "bricks", label: "Bricks" },
    { value: "masonry", label: "Masonry" },
  ]
  var GENERATION_PROVIDERS = [
    { value: "openai-compatible", label: "OpenAI-compatible" },
    { value: "replicate", label: "Replicate" },
    { value: "gemini", label: "Gemini" },
    { value: "custom", label: "Custom endpoint" },
  ]

  function esc(value) {
    var node = document.createElement("div")
    node.textContent = String(value || "")
    return node.innerHTML
  }

  function segmentedControlMarkup(name, selectedValue, options) {
    var html = '<div class="site-settings-segmented" role="radiogroup" aria-label="' + esc(name) + '">'
    for (var i = 0; i < options.length; i++) {
      var option = options[i]
      var inputId = name + "-" + option.value
      html +=
        '<label class="site-settings-segment">' +
        '<input class="site-settings-radio" type="radio" name="' +
        esc(name) +
        '" id="' +
        esc(inputId) +
        '" value="' +
        esc(option.value) +
        '"' +
        (option.value === selectedValue ? " checked" : "") +
        ">" +
        '<span class="site-settings-segment-label">' +
        esc(option.label) +
        "</span>" +
        "</label>"
    }
    html += "</div>"
    return html
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
    var source = snapshot || {}
    return {
      themePreference: normalizeThemePreference(source.themePreference),
      readerModePreference: normalizeReaderModePreference(source.readerModePreference),
      iconoplasm: buildIconoplasmSettings(source.iconoplasm),
    }
  }

  function currentSettingsSnapshot() {
    return {
      themePreference: readThemePreference(),
      effectiveTheme: readEffectiveTheme(),
      readerModePreference: readReaderModePreference(),
      iconoplasm: readIconoplasmSettings(),
    }
  }

  function removeSidebar() {
    var existing = document.getElementById(SIDEBAR_ID)
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
  }

  function sidebarMarkup() {
    var html =
      '<div class="site-settings-sidebar-rail">' +
      '<div class="site-settings-sidebar-section">' +
      '<div class="site-settings-sidebar-label">Settings</div>' +
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
      '<div class="site-settings-sidebar-section">' +
      '<div class="site-settings-sidebar-label">Notes</div>' +
      '<p class="site-settings-sidebar-note">Theme, reader mode, and Iconoplasm settings are shared across Brinedew-controlled pages in this browser. Nothing is account-backed yet.</p>' +
      "</div>" +
      "</div>"
    return html
  }

  function mountSidebar() {
    removeSidebar()
    var sidebar = document.querySelector(".right.sidebar")
    if (!sidebar) return null
    var mount = document.createElement("div")
    mount.id = SIDEBAR_ID
    mount.innerHTML = sidebarMarkup()
    var tagsSection = sidebar.querySelector(".page-tags-section")
    if (tagsSection) {
      sidebar.insertBefore(mount, tagsSection)
    } else {
      sidebar.appendChild(mount)
    }
    return mount
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

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return

    var snapshot = currentSettingsSnapshot()
    root.innerHTML =
      '<div class="site-settings-shell">' +
      '<header class="site-settings-header">' +
      '<p class="site-settings-kicker">Brinedew.bio</p>' +
      '<h1 class="site-settings-title">Settings</h1>' +
      '<p class="site-settings-lede">Site-wide preferences for this browser. Shared shell behavior belongs here, and app-specific settings can extend it without inventing their own separate settings pages.</p>' +
      "</header>" +
      '<section class="site-settings-section" id="appearance">' +
      '<div class="site-settings-section-head">' +
      "<h2>Appearance</h2>" +
      "<p>Theme settings for the whole Brinedew shell.</p>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Theme</h3>" +
      "<p>Let the site follow your system preference, or force a fixed theme.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      segmentedControlMarkup("themePreference", snapshot.themePreference, THEME_OPTIONS) +
      '<p class="site-settings-help">Current effective theme: <span id="site-settings-effective-theme">' +
      esc(snapshot.effectiveTheme) +
      "</span></p>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="reading">' +
      '<div class="site-settings-section-head">' +
      "<h2>Reading</h2>" +
      "<p>Controls for content pages and article viewing.</p>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Reader mode</h3>" +
      "<p>Persist the simplified reading layout instead of toggling it one page at a time.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      segmentedControlMarkup("readerModePreference", snapshot.readerModePreference, READER_OPTIONS) +
      '<p class="site-settings-help">This mirrors the reader-mode toggle in the header.</p>' +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="iconoplasm">' +
      '<div class="site-settings-section-head">' +
      "<h2>Iconoplasm</h2>" +
      "<p>Preferences that belong to Iconoplasm but live inside your shared site settings.</p>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Front page layout</h3>" +
      "<p>Choose how the main Iconoplasm catalog is presented.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      '<select class="site-settings-select" id="site-settings-iconoplasm-layout">' +
      selectOptionsMarkup(snapshot.iconoplasm.homeLayout, HOME_LAYOUT_OPTIONS) +
      "</select>" +
      '<p class="site-settings-help">Bricks is the default. Masonry stays available as the alternate browse view.</p>' +
      "</div>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Image generation</h3>" +
      "<p>Provider and defaults for future actions like new candidate and edit image.</p>" +
      "</div>" +
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
      '" placeholder="Paste your API key">' +
      '<button class="site-settings-inline-btn" id="site-settings-api-key-toggle" type="button" aria-pressed="false">Show</button>' +
      "</div>" +
      '<p class="site-settings-help">Stored locally in this browser and shared across Brinedew-controlled pages.</p>' +
      "</label>" +
      '<label class="site-settings-field" for="site-settings-model">' +
      "<span>Model</span>" +
      '<input class="site-settings-input" id="site-settings-model" type="text" autocomplete="off" spellcheck="false" value="' +
      esc(snapshot.iconoplasm.generationModel) +
      '" placeholder="gpt-image-1, imagen-4, flux, or your own preset">' +
      "</label>" +
      '<label class="site-settings-field" for="site-settings-endpoint">' +
      "<span>Endpoint</span>" +
      '<input class="site-settings-input" id="site-settings-endpoint" type="url" autocomplete="off" spellcheck="false" value="' +
      esc(snapshot.iconoplasm.generationEndpoint) +
      '" placeholder="Optional override, for example https://api.openai.com/v1/images">' +
      "</label>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="storage">' +
      '<div class="site-settings-section-head">' +
      "<h2>Storage</h2>" +
      "<p>How these settings behave before account sync exists.</p>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Browser-local</h3>" +
      "<p>These settings stay with this browser profile. Another browser or device starts from defaults.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      '<p class="site-settings-help site-settings-help--strong">That makes testing safe without affecting other users.</p>' +
      '<p class="site-settings-help">The canonical settings page lives on Brinedew.bio so apps can read the same preferences instead of shipping their own separate settings surfaces.</p>' +
      "</div>" +
      "</div>" +
      "</section>" +
      "</div>"

    mountSidebar()
    wireSectionTracking(root)

    var themeInputs = root.querySelectorAll('input[name="themePreference"]')
    var readerInputs = root.querySelectorAll('input[name="readerModePreference"]')
    var effectiveThemeEl = document.getElementById("site-settings-effective-theme")
    var layoutEl = document.getElementById("site-settings-iconoplasm-layout")
    var providerEl = document.getElementById("site-settings-provider")
    var apiKeyEl = document.getElementById("site-settings-api-key")
    var modelEl = document.getElementById("site-settings-model")
    var endpointEl = document.getElementById("site-settings-endpoint")
    var statusEl = document.getElementById("site-settings-status")
    var saveBtn = document.getElementById("site-settings-save")
    var resetBtn = document.getElementById("site-settings-reset")
    var toggleBtn = document.getElementById("site-settings-api-key-toggle")
    var savedComparableSnapshot = comparableSnapshot(currentSettingsSnapshot())
    var defaultComparableSnapshot = comparableSnapshot({
      themePreference: "system",
      readerModePreference: "off",
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

    function selectedRadioValue(nodeList, fallback) {
      for (var i = 0; i < nodeList.length; i++) {
        if (nodeList[i].checked) return nodeList[i].value
      }
      return fallback
    }

    function currentDraft() {
      return {
        themePreference: normalizeThemePreference(selectedRadioValue(themeInputs, "system")),
        readerModePreference: normalizeReaderModePreference(selectedRadioValue(readerInputs, "off")),
        iconoplasm: buildIconoplasmSettings({
          homeLayout: layoutEl && layoutEl.value,
          generationProvider: providerEl && providerEl.value,
          generationApiKey: apiKeyEl && apiKeyEl.value,
          generationModel: modelEl && modelEl.value,
          generationEndpoint: endpointEl && endpointEl.value,
        }),
      }
    }

    function updateEffectiveThemeLabel() {
      if (!effectiveThemeEl) return
      var preference = normalizeThemePreference(selectedRadioValue(themeInputs, "system"))
      effectiveThemeEl.textContent =
        preference === "system" ? String(readEffectiveTheme() || "system") : preference
    }

    function refreshDirtyState() {
      var draftComparable = comparableSnapshot(currentDraft())
      var dirty = snapshotSignature(draftComparable) !== snapshotSignature(savedComparableSnapshot)
      var canReset =
        snapshotSignature(draftComparable) !== snapshotSignature(defaultComparableSnapshot)
      if (saveBtn) saveBtn.disabled = !dirty
      if (resetBtn) resetBtn.disabled = !canReset
      updateEffectiveThemeLabel()
      if (statusEl && statusEl.getAttribute("data-sticky") === "true") return
      setStatus(dirty ? "Unsaved changes." : "", dirty ? "dirty" : "", false)
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

    for (var i = 0; i < themeInputs.length; i++) bindDirtyTracking(themeInputs[i])
    for (var j = 0; j < readerInputs.length; j++) bindDirtyTracking(readerInputs[j])
    bindDirtyTracking(layoutEl)
    bindDirtyTracking(providerEl)
    bindDirtyTracking(apiKeyEl)
    bindDirtyTracking(modelEl)
    bindDirtyTracking(endpointEl)

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var draft = currentDraft()
        var themeOk = applyThemePreference(draft.themePreference)
        var readerOk = applyReaderModePreference(draft.readerModePreference)
        var iconoplasmOk = writeIconoplasmSettings(draft.iconoplasm)
        if (!themeOk || !readerOk || !iconoplasmOk) {
          setStatus("This browser blocked saving one or more settings.", "error", true)
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
        var themeOk = applyThemePreference("system")
        var readerOk = applyReaderModePreference("off")
        var iconoplasmOk = resetIconoplasmSettings()
        if (!iconoplasmOk) iconoplasmOk = writeIconoplasmSettings(iconoplasmDefaults)
        if (!themeOk || !readerOk || !iconoplasmOk) {
          setStatus("This browser blocked resetting one or more settings.", "error", true)
          return
        }
        render()
        var rerenderedStatus = document.getElementById("site-settings-status")
        if (rerenderedStatus) {
          rerenderedStatus.textContent = "Settings reset to defaults."
          rerenderedStatus.className =
            "site-settings-sidebar-status site-settings-sidebar-status--success"
          rerenderedStatus.setAttribute("data-sticky", "true")
          window.setTimeout(function () {
            if (
              rerenderedStatus.textContent === "Settings reset to defaults." &&
              rerenderedStatus.getAttribute("data-sticky") === "true"
            ) {
              rerenderedStatus.textContent = ""
              rerenderedStatus.className = "site-settings-sidebar-status"
              rerenderedStatus.setAttribute("data-sticky", "false")
            }
          }, 1600)
        }
      })
    }

    refreshDirtyState()
  }

  function init() {
    var root = document.getElementById(ROOT_ID)
    if (!root) {
      removeSidebar()
      return
    }
    render()
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
