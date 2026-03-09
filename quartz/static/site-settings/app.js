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
} from "../site-preferences.js"

;(function () {
  "use strict"

  var ROOT_ID = "site-settings-root"
  var THEME_OPTIONS = [
    { value: "system", label: "System", hint: "Follow the OS preference by default." },
    { value: "light", label: "Light", hint: "Always use the light paper palette." },
    { value: "dark", label: "Dark", hint: "Always use the dark academia palette." },
  ]
  var READER_OPTIONS = [
    { value: "off", label: "Off", hint: "Keep the normal multi-column site layout." },
    { value: "on", label: "On", hint: "Use the calmer reading-focused layout." },
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

  function currentSettingsSnapshot() {
    var themePreference = readThemePreference()
    var readerModePreference = readReaderModePreference()
    var iconoplasm = readIconoplasmSettings()
    return {
      themePreference: themePreference,
      effectiveTheme: readEffectiveTheme(),
      readerModePreference: readerModePreference,
      iconoplasm: iconoplasm,
    }
  }

  function render() {
    var root = document.getElementById(ROOT_ID)
    if (!root) return
    var snapshot = currentSettingsSnapshot()
    root.innerHTML =
      '<div class="site-settings-shell">' +
      '<header class="site-settings-header">' +
      '<p class="site-settings-kicker">Brinedew.bio</p>' +
      '<p class="site-settings-title">Shared preferences</p>' +
      "<p>Shared preferences for the whole site. Appearance applies everywhere; app-specific sections extend that baseline instead of inventing their own mini settings pages.</p>" +
      "</header>" +
      '<div class="site-settings-layout">' +
      '<aside class="site-settings-sidebar">' +
      '<nav class="site-settings-nav" aria-label="Settings sections">' +
      '<a href="#appearance">Appearance</a>' +
      '<a href="#reading">Reading</a>' +
      '<a href="#iconoplasm">Iconoplasm</a>' +
      '<a href="#storage">Storage</a>' +
      "</nav>" +
      '<div class="site-settings-sidebar-note">' +
      "<strong>Local-only for now.</strong> These preferences stay in this browser until account sync exists." +
      "</div>" +
      "</aside>" +
      '<main class="site-settings-main">' +
      '<section class="site-settings-section" id="appearance">' +
      '<div class="site-settings-section-head">' +
      "<h2>Appearance</h2>" +
      "<p>Global look-and-feel choices for Brinedew.bio.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Theme</h3>" +
      "<p>Choose whether the whole site follows your OS, stays light, or stays dark.</p>" +
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
      "<p>Controls that change how content pages behave.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Reader mode</h3>" +
      "<p>Persist the simpler reading layout instead of toggling it only for the current page view.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      segmentedControlMarkup("readerModePreference", snapshot.readerModePreference, READER_OPTIONS) +
      '<p class="site-settings-help">This mirrors the reader-mode button in the site header.</p>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</section>" +
      '<section class="site-settings-section" id="iconoplasm">' +
      '<div class="site-settings-section-head">' +
      "<h2>Iconoplasm</h2>" +
      "<p>Preferences for the gene persona catalog and its future image-generation tools.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Homepage layout</h3>" +
      "<p>Pick the frontpage layout for Iconoplasm. Bricks is the new default. Masonry is still available as the alternate view.</p>" +
      "</div>" +
      '<div class="site-settings-control">' +
      '<select class="site-settings-select" id="site-settings-iconoplasm-layout">' +
      selectOptionsMarkup(snapshot.iconoplasm.homeLayout, HOME_LAYOUT_OPTIONS) +
      "</select>" +
      "</div>" +
      "</div>" +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Image generation provider</h3>" +
      "<p>These values are the foundation for future actions like new candidate and edit image.</p>" +
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
      "<p>How these preferences are saved today.</p>" +
      "</div>" +
      '<div class="site-settings-card">' +
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy">' +
      "<h3>Where settings live</h3>" +
      "<p>Preferences are stored in your browser, not on the server. Using a different browser, profile, or device starts with defaults.</p>" +
      "</div>" +
      '<div class="site-settings-control site-settings-control--stack">' +
      '<p class="site-settings-help site-settings-help--strong">That means you can test safely without affecting anyone else.</p>' +
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

    function setStatus(message, tone) {
      if (!statusEl) return
      statusEl.textContent = message || ""
      statusEl.className =
        "site-settings-status" +
        (tone === "success"
          ? " site-settings-status--success"
          : tone === "error"
            ? " site-settings-status--error"
            : "")
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

    if (toggleBtn && apiKeyEl) {
      toggleBtn.addEventListener("click", function () {
        var isVisible = apiKeyEl.getAttribute("type") === "text"
        apiKeyEl.setAttribute("type", isVisible ? "password" : "text")
        toggleBtn.textContent = isVisible ? "Show" : "Hide"
        toggleBtn.setAttribute("aria-pressed", isVisible ? "false" : "true")
      })
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var draft = currentDraft()
        var themeOk = applyThemePreference(draft.themePreference)
        var readerOk = applyReaderModePreference(draft.readerModePreference)
        var iconoplasmOk = writeIconoplasmSettings(draft.iconoplasm)
        if (!themeOk || !readerOk || !iconoplasmOk) {
          setStatus("This browser blocked saving one or more settings.", "error")
          return
        }
        if (effectiveThemeEl) effectiveThemeEl.textContent = readEffectiveTheme()
        setStatus("Settings saved for this browser.", "success")
      })
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        var iconoplasmDefaults = iconoplasmSettingsDefaults()
        var themeOk = applyThemePreference("system")
        var readerOk = applyReaderModePreference("off")
        var iconoplasmOk = resetIconoplasmSettings()
        if (!iconoplasmOk) {
          iconoplasmOk = writeIconoplasmSettings(iconoplasmDefaults)
        }
        if (!themeOk || !readerOk || !iconoplasmOk) {
          setStatus("This browser blocked resetting one or more settings.", "error")
          return
        }
        render()
        var rerenderedStatus = document.getElementById("site-settings-status")
        if (rerenderedStatus) {
          rerenderedStatus.textContent = "Settings reset to defaults."
          rerenderedStatus.className = "site-settings-status site-settings-status--success"
        }
      })
    }
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
