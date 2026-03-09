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

  function formatThemeName(value) {
    var theme = String(value || "").trim().toLowerCase()
    if (theme === "light") return "light"
    if (theme === "dark") return "dark"
    return "system"
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

  function sectionNavMarkup() {
    var html = '<nav class="site-settings-nav" aria-label="Settings sections">'
    for (var i = 0; i < SECTION_LINKS.length; i++) {
      html +=
        '<a href="#' +
        esc(SECTION_LINKS[i].id) +
        '" data-section-link="' +
        esc(SECTION_LINKS[i].id) +
        '">' +
        esc(SECTION_LINKS[i].label) +
        "</a>"
    }
    html += "</nav>"
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

  function predictedEffectiveTheme(themePreference) {
    var normalized = normalizeThemePreference(themePreference)
    if (normalized === "light" || normalized === "dark") return normalized
    return formatThemeName(readEffectiveTheme())
  }

  function setActiveNav(root, sectionId) {
    if (!root) return
    var links = root.querySelectorAll("[data-section-link]")
    for (var i = 0; i < links.length; i++) {
      var link = links[i]
      var isActive = link.getAttribute("data-section-link") === sectionId
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
    setActiveNav(root, sections[0].id)
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
          setActiveNav(root, topEntry.target.id)
        }
      },
      {
        rootMargin: "-15% 0px -65% 0px",
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
      '<p class="site-settings-kicker">User settings</p>' +
      '<h1 class="site-settings-title">Settings</h1>' +
      '<p class="site-settings-lede">These are your browser-level settings for Brinedew.bio. They shape the site chrome, travel across Brinedew subdomains, and give Iconoplasm one shared place to read its user preferences.</p>' +
      '<div class="site-settings-meta">' +
      '<span class="site-settings-meta-item">Shared across Brinedew.bio and Iconoplasm</span>' +
      '<span class="site-settings-meta-item">Saved to this browser, not to an account</span>' +
      "</div>" +
      "</header>" +
      '<div class="site-settings-layout">' +
      '<aside class="site-settings-sidebar">' +
      '<div class="site-settings-sidebar-block">' +
      '<p class="site-settings-sidebar-label">Sections</p>' +
      sectionNavMarkup() +
      "</div>" +
      '<div class="site-settings-sidebar-note">' +
      "<strong>What syncs today:</strong> theme, reader mode, and Iconoplasm preferences are shared across Brinedew-controlled pages in this browser. Nothing is attached to a login yet." +
      "</div>" +
      "</aside>" +
      '<main class="site-settings-main">' +
      '<section class="site-settings-section" id="appearance">' +
      '<div class="site-settings-section-head">' +
      "<h2>Appearance</h2>" +
      "<p>Core presentation settings for the entire site shell.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Theme</h3>" +
      "<p>Choose whether Brinedew follows your system preference or stays pinned to a single theme.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      segmentedControlMarkup("themePreference", snapshot.themePreference, THEME_OPTIONS) +
      '<p class="site-settings-help">Current effective theme: <span id="site-settings-effective-theme">' +
      esc(snapshot.effectiveTheme) +
      "</span></p>" +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="reading">' +
      '<div class="site-settings-section-head">' +
      "<h2>Reading</h2>" +
      "<p>Settings that affect article and page layout behavior.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Reader mode</h3>" +
      "<p>Persist the simplified reading layout instead of toggling it only for the page you are on.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      segmentedControlMarkup("readerModePreference", snapshot.readerModePreference, READER_OPTIONS) +
      '<p class="site-settings-help">This matches the reader-mode button in the site header.</p>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="iconoplasm">' +
      '<div class="site-settings-section-head">' +
      "<h2>Iconoplasm</h2>" +
      "<p>App-specific preferences that still live inside your shared site settings.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Front page layout</h3>" +
      "<p>Choose the catalog presentation you want on the Iconoplasm homepage.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      '<select class="site-settings-select" id="site-settings-iconoplasm-layout">' +
      selectOptionsMarkup(snapshot.iconoplasm.homeLayout, HOME_LAYOUT_OPTIONS) +
      "</select>" +
      '<p class="site-settings-help">Bricks is the current default. Masonry remains available as the alternate browse view.</p>' +
      "</div>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Image generation</h3>" +
      "<p>These values power future actions like new candidate, edit image, and related generation tools.</p>" +
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
      '<p class="site-settings-help">Stored locally in this browser and used by Brinedew-controlled apps. It is not attached to an account.</p>' +
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
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="storage">' +
      '<div class="site-settings-section-head">' +
      "<h2>Storage</h2>" +
      "<p>How this page behaves today, before account sync exists.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Browser-local state</h3>" +
      "<p>These settings belong to this browser profile. A different browser or device starts from defaults until account-backed sync exists.</p>" +
      "</div>" +
      '<div class="site-settings-control site-settings-control--stack">' +
      '<p class="site-settings-help site-settings-help--strong">That makes testing safe: you can change layout, theme, or generation defaults without affecting anyone else.</p>' +
      '<p class="site-settings-help">The page itself lives on Brinedew.bio so apps can read the same preferences instead of maintaining their own mini settings screens.</p>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      "</main>" +
      "</div>" +
      '<div class="site-settings-savebar">' +
      '<p class="site-settings-status" id="site-settings-status" aria-live="polite"></p>' +
      '<div class="site-settings-actions">' +
      '<button class="site-settings-btn site-settings-btn--secondary" id="site-settings-reset" type="button">Reset defaults</button>' +
      '<button class="site-settings-btn site-settings-btn--primary" id="site-settings-save" type="button">Save changes</button>' +
      "</div>" +
      "</div>" +
      "</div>"

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
        "site-settings-status" +
        (tone === "success"
          ? " site-settings-status--success"
          : tone === "error"
            ? " site-settings-status--error"
            : tone === "dirty"
              ? " site-settings-status--dirty"
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
        effectiveTheme: predictedEffectiveTheme(selectedRadioValue(themeInputs, "system")),
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

    function currentComparableDraft() {
      return comparableSnapshot(currentDraft())
    }

    function updateEffectiveThemeLabel() {
      if (!effectiveThemeEl) return
      effectiveThemeEl.textContent = currentDraft().effectiveTheme
    }

    function refreshDirtyState() {
      var draftComparable = currentComparableDraft()
      var dirty = snapshotSignature(draftComparable) !== snapshotSignature(savedComparableSnapshot)
      var canReset =
        snapshotSignature(draftComparable) !== snapshotSignature(defaultComparableSnapshot)
      if (saveBtn) saveBtn.disabled = !dirty
      if (resetBtn) resetBtn.disabled = !canReset
      updateEffectiveThemeLabel()
      if (statusEl && statusEl.getAttribute("data-sticky") === "true") return
      if (dirty) {
        setStatus("Unsaved changes.", "dirty", false)
      } else {
        setStatus("", "", false)
      }
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
        setStatus("Settings saved for this browser.", "success", true)
        window.setTimeout(function () {
          if (!statusEl || statusEl.textContent !== "Settings saved for this browser.") return
          statusEl.setAttribute("data-sticky", "false")
          refreshDirtyState()
        }, 1800)
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
          rerenderedStatus.className = "site-settings-status site-settings-status--success"
          rerenderedStatus.setAttribute("data-sticky", "true")
          window.setTimeout(function () {
            if (
              rerenderedStatus.textContent === "Settings reset to defaults." &&
              rerenderedStatus.getAttribute("data-sticky") === "true"
            ) {
              rerenderedStatus.textContent = ""
              rerenderedStatus.className = "site-settings-status"
              rerenderedStatus.setAttribute("data-sticky", "false")
            }
          }, 1800)
        }
      })
    }

    refreshDirtyState()
  }

  function init() {
    if (!document.getElementById(ROOT_ID)) return
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
