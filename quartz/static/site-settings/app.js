import {
  buildIconoplasmSettings,
  iconoplasmSettingsDefaults,
  readIconoplasmSettings,
  resetIconoplasmSettings,
  writeIconoplasmSettings,
} from "../site-preferences.js?v=20260520stylecookie"
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
    { value: "simple", label: "Simple" },
    { value: "lit-archival", label: "Vintage lab label" },
    { value: "image-only", label: "Blot only" },
  ]
  var currentUser = null
  var currentUserIsIconoAdmin = false
  var imageProviderState = {
    loaded: false,
    loading: false,
    error: "",
    encryptionConfigured: false,
    supportedProviders: [],
    savedProviders: [],
  }
  var userEmulsionState = {
    loaded: false,
    loading: false,
    error: "",
    emulsion: null,
    history: [],
  }

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

  function fetchJson(path, options) {
    return fetch(path, {
      credentials: "include",
      ...(options || {}),
      headers: {
        Accept: "application/json",
        ...((options && options.headers) || {}),
      },
    }).then(function (response) {
      return response.text().then(function (text) {
        var payload = null
        try {
          payload = text ? JSON.parse(text) : null
        } catch (_err) {
          payload = null
        }
        if (!response.ok) {
          var message =
            (payload && (payload.error || payload.message)) ||
            response.statusText ||
            "Request failed"
          throw new Error(message)
        }
        return payload || {}
      })
    })
  }

  function loadImageProviders() {
    if (!currentUser || imageProviderState.loading) return Promise.resolve(imageProviderState)
    imageProviderState.loading = true
    imageProviderState.error = ""
    return fetchJson("/api/iconoplasm/image-edit/providers", { cache: "no-store" })
      .then(function (payload) {
        imageProviderState.loaded = true
        imageProviderState.encryptionConfigured = Boolean(payload && payload.encryption_configured)
        imageProviderState.supportedProviders = Array.isArray(
          payload && payload.supported_providers,
        )
          ? payload.supported_providers
          : []
        imageProviderState.savedProviders = Array.isArray(payload && payload.providers)
          ? payload.providers
          : []
        return imageProviderState
      })
      .catch(function (error) {
        imageProviderState.loaded = true
        imageProviderState.error = String((error && error.message) || "Could not load image APIs.")
        imageProviderState.supportedProviders = []
        imageProviderState.savedProviders = []
        return imageProviderState
      })
      .finally(function () {
        imageProviderState.loading = false
      })
  }

  function loadUserEmulsion() {
    if (!currentUser || userEmulsionState.loading) return Promise.resolve(userEmulsionState)
    userEmulsionState.loading = true
    userEmulsionState.error = ""
    return fetchJson("/api/iconoplasm/user-emulsion", { cache: "no-store" })
      .then(function (payload) {
        userEmulsionState.loaded = true
        userEmulsionState.emulsion = payload && payload.emulsion ? payload.emulsion : null
        userEmulsionState.history = Array.isArray(payload && payload.history) ? payload.history : []
        return userEmulsionState
      })
      .catch(function (error) {
        userEmulsionState.loaded = true
        userEmulsionState.error = String((error && error.message) || "Could not load emulsion.")
        userEmulsionState.emulsion = null
        userEmulsionState.history = []
        return userEmulsionState
      })
      .finally(function () {
        userEmulsionState.loading = false
      })
  }

  function imageProviderById(providerId) {
    var id = String(providerId || "").trim()
    for (var i = 0; i < imageProviderState.supportedProviders.length; i++) {
      if (imageProviderState.supportedProviders[i].provider_id === id) {
        return imageProviderState.supportedProviders[i]
      }
    }
    return imageProviderState.supportedProviders[0] || null
  }

  function savedImageProviderById(providerId) {
    var id = String(providerId || "").trim()
    for (var i = 0; i < imageProviderState.savedProviders.length; i++) {
      if (imageProviderState.savedProviders[i].provider_id === id)
        return imageProviderState.savedProviders[i]
    }
    return null
  }

  function imageProviderModelOptions(provider) {
    return Array.isArray(provider && provider.model_options) ? provider.model_options : []
  }

  function imageProviderModelOption(provider, model) {
    var options = imageProviderModelOptions(provider)
    for (var i = 0; i < options.length; i++) {
      if (options[i].model === model) return options[i]
    }
    return options[0] || null
  }

  function imageProviderOptionsMarkup(selectedProviderId) {
    if (!imageProviderState.supportedProviders.length) {
      return '<option value="">No providers available</option>'
    }
    var html = ""
    for (var i = 0; i < imageProviderState.supportedProviders.length; i++) {
      var provider = imageProviderState.supportedProviders[i]
      html +=
        '<option value="' +
        esc(provider.provider_id) +
        '"' +
        (provider.provider_id === selectedProviderId ? " selected" : "") +
        ">" +
        esc(provider.label || provider.provider_id) +
        "</option>"
    }
    return html
  }

  function imageProviderModelOptionsMarkup(provider, selectedModel) {
    var options = imageProviderModelOptions(provider)
    if (!options.length) {
      return (
        '<option value="' +
        esc((provider && provider.default_model) || "") +
        '">Default model</option>'
      )
    }
    var html = ""
    for (var i = 0; i < options.length; i++) {
      var option = options[i]
      html +=
        '<option value="' +
        esc(option.model) +
        '"' +
        (option.model === selectedModel ? " selected" : "") +
        ">" +
        esc(
          (option.label || option.model) +
            (option.pricing_label ? " - " + option.pricing_label : ""),
        ) +
        "</option>"
    }
    return html
  }

  function renderImageApiSettingsMarkup() {
    if (!currentUser) {
      return (
        '<div class="site-settings-row">' +
        '<div class="site-settings-copy"><h3>Image APIs</h3></div>' +
        '<div class="site-settings-control"><div class="site-settings-plain-value">Log in to save BYOK image providers.</div></div>' +
        "</div>"
      )
    }
    if (!imageProviderState.loaded) {
      return (
        '<div class="site-settings-row">' +
        '<div class="site-settings-copy"><h3>Image APIs</h3></div>' +
        '<div class="site-settings-control"><div class="site-settings-plain-value">Loading saved providers.</div></div>' +
        "</div>"
      )
    }
    if (imageProviderState.error) {
      return (
        '<div class="site-settings-row">' +
        '<div class="site-settings-copy"><h3>Image APIs</h3></div>' +
        '<div class="site-settings-control site-settings-control--stack">' +
        '<div class="site-settings-plain-value">' +
        esc(imageProviderState.error) +
        "</div>" +
        '<button class="site-settings-inline-btn" id="site-settings-image-api-retry" type="button">Retry</button>' +
        "</div>" +
        "</div>"
      )
    }
    var initialProvider =
      imageProviderState.savedProviders[0] || imageProviderState.supportedProviders[0] || null
    var selectedProviderId = initialProvider ? initialProvider.provider_id : ""
    var supportedProvider = imageProviderById(selectedProviderId)
    var savedProvider = savedImageProviderById(selectedProviderId)
    var selectedModel =
      (savedProvider && savedProvider.model) ||
      (supportedProvider && supportedProvider.default_model) ||
      ""
    var selectedModelOption = imageProviderModelOption(supportedProvider, selectedModel)
    return (
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Image APIs</h3></div>' +
      '<div class="site-settings-control site-settings-control--stack" data-site-settings-image-api-panel>' +
      (imageProviderState.encryptionConfigured
        ? ""
        : '<div class="site-settings-plain-value">Server-side key encryption is not configured yet.</div>') +
      '<p class="site-settings-plain-value">Save an API key per provider.</p>' +
      '<label class="site-settings-field"><span>Provider</span><select class="site-settings-select" id="site-settings-image-api-provider">' +
      imageProviderOptionsMarkup(selectedProviderId) +
      "</select></label>" +
      '<label class="site-settings-field"><span>API key</span><div class="site-settings-secret"><input class="site-settings-input" id="site-settings-image-api-key" type="password" autocomplete="off" placeholder="' +
      esc(savedProvider && savedProvider.configured ? "Saved key is configured" : "Paste API key") +
      '"><button class="site-settings-inline-btn" id="site-settings-image-api-save" type="button">Save API</button></div></label>' +
      '<div class="site-settings-plain-value" id="site-settings-image-api-status">' +
      esc(
        savedProvider && savedProvider.configured ? "Saved." : "No key saved for this provider.",
      ) +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function renderUserEmulsionSettingsMarkup() {
    if (!currentUser) {
      return (
        '<div class="site-settings-row">' +
        '<div class="site-settings-copy"><h3>Emulsion</h3></div>' +
        '<div class="site-settings-control"><div class="site-settings-plain-value">Log in to save your generation emulsion.</div></div>' +
        "</div>"
      )
    }
    if (!userEmulsionState.loaded) {
      return (
        '<div class="site-settings-row">' +
        '<div class="site-settings-copy"><h3>Emulsion</h3></div>' +
        '<div class="site-settings-control"><div class="site-settings-plain-value">Loading saved emulsion.</div></div>' +
        "</div>"
      )
    }
    var emulsion = userEmulsionState.emulsion || {}
    var text = String(emulsion.text || "")
    var maxLength = Number(emulsion.max_length || 140) || 140
    var emulsionId = String(emulsion.id || "")
    var history = Array.isArray(userEmulsionState.history) ? userEmulsionState.history : []
    var historyOptions = '<option value="">Current draft</option>'
    for (var i = 0; i < history.length; i++) {
      var version = history[i] || {}
      var versionId = String(version.id || "")
      if (!versionId) continue
      historyOptions +=
        '<option value="' +
        esc(versionId) +
        '"' +
        (versionId === emulsionId ? " selected" : "") +
        ">" +
        esc(versionId) +
        "</option>"
    }
    return (
      '<div class="site-settings-row">' +
      '<div class="site-settings-copy"><h3>Emulsion</h3></div>' +
      '<div class="site-settings-control site-settings-control--stack">' +
      (userEmulsionState.error
        ? '<div class="site-settings-plain-value">' + esc(userEmulsionState.error) + "</div>"
        : "") +
      '<label class="site-settings-field"><span>Current</span><div class="site-settings-plain-value" id="site-settings-user-emulsion-id">' +
      esc(emulsionId) +
      "</div></label>" +
      '<label class="site-settings-field"><span>Load version</span><select class="site-settings-select" id="site-settings-user-emulsion-version">' +
      historyOptions +
      "</select></label>" +
      '<label class="site-settings-field"><span>Text</span><textarea class="site-settings-input site-settings-textarea" id="site-settings-user-emulsion" maxlength="140" rows="3">' +
      esc(text) +
      "</textarea></label>" +
      '<div class="site-settings-emulsion-footer">' +
      '<span class="site-settings-emulsion-meter" id="site-settings-user-emulsion-meter">' +
      esc(String(text.length) + "/" + String(maxLength)) +
      "</span>" +
      '<button class="site-settings-inline-btn" id="site-settings-user-emulsion-save" type="button">Save emulsion</button>' +
      "</div>" +
      '<div class="site-settings-plain-value" id="site-settings-user-emulsion-status"></div>' +
      "</div>" +
      "</div>"
    )
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
        imageProviderState.loaded = false
        userEmulsionState.loaded = false
        void fetchIconoplasmAdminState()
          .then(function (state) {
            currentUserIsIconoAdmin = !!(state && state.is_admin)
            return Promise.all([loadImageProviders(), loadUserEmulsion()])
          })
          .then(function () {
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
      renderUserEmulsionSettingsMarkup() +
      renderImageApiSettingsMarkup() +
      (currentUserIsIconoAdmin
        ? '<div class="site-settings-row">' +
          '<div class="site-settings-copy"><h3>Admin gallery</h3></div>' +
          '<div class="site-settings-control site-settings-control--stack">' +
          '<label class="site-settings-toggle" for="site-settings-show-all-genes">' +
          '<input id="site-settings-show-all-genes" type="checkbox"' +
          (snapshot.iconoplasm.showAllGenes ? " checked" : "") +
          ">" +
          '<span><span class="site-settings-toggle-title">Use classic full gallery</span>' +
          '<span class="site-settings-toggle-note">Admins can switch this browser between the personal Pokedex shelf and the old full-catalog gallery.</span></span>' +
          "</label>" +
          "</div>" +
          "</div>"
        : "") +
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
    var showAllGenesEl = document.getElementById("site-settings-show-all-genes")
    var imageApiProviderEl = document.getElementById("site-settings-image-api-provider")
    var imageApiKeyEl = document.getElementById("site-settings-image-api-key")
    var imageApiSaveBtn = document.getElementById("site-settings-image-api-save")
    var imageApiStatusEl = document.getElementById("site-settings-image-api-status")
    var imageApiRetryBtn = document.getElementById("site-settings-image-api-retry")
    var userEmulsionEl = document.getElementById("site-settings-user-emulsion")
    var userEmulsionVersionEl = document.getElementById("site-settings-user-emulsion-version")
    var userEmulsionMeterEl = document.getElementById("site-settings-user-emulsion-meter")
    var userEmulsionSaveBtn = document.getElementById("site-settings-user-emulsion-save")
    var userEmulsionStatusEl = document.getElementById("site-settings-user-emulsion-status")
    var saveBtn = document.getElementById("site-settings-save")
    var resetBtn = document.getElementById("site-settings-reset")
    var statusEl = document.getElementById("site-settings-status")
    var savedComparableSnapshot = comparableSnapshot(currentSettingsSnapshot())
    var defaultComparableSnapshot = comparableSnapshot({
      iconoplasm: iconoplasmSettingsDefaults(),
    })
    var autosaveTimer = null

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

    function saveIconoplasmDraft(options) {
      var opts = options || {}
      var draft = currentDraft()
      var iconoplasmOk = writeIconoplasmSettings(draft.iconoplasm)
      if (!iconoplasmOk) {
        setStatus("Could not save in this browser.", "error", true)
        return false
      }
      savedComparableSnapshot = comparableSnapshot(currentSettingsSnapshot())
      setStatus(opts.auto ? "Autosaved." : "Saved.", "success", !opts.auto)
      window.setTimeout(
        function () {
          if (!statusEl) return
          if (statusEl.textContent !== "Saved." && statusEl.textContent !== "Autosaved.") return
          statusEl.setAttribute("data-sticky", "false")
          refreshDirtyState()
        },
        opts.auto ? 950 : 1600,
      )
      refreshDirtyState()
      return true
    }

    function scheduleIconoplasmAutosave() {
      if (autosaveTimer) window.clearTimeout(autosaveTimer)
      setStatus("Saving...", "dirty", false)
      autosaveTimer = window.setTimeout(function () {
        autosaveTimer = null
        saveIconoplasmDraft({ auto: true })
      }, 420)
    }

    function bindDirtyTracking(node) {
      if (!node || !node.addEventListener) return
      node.addEventListener("input", function () {
        refreshDirtyState()
        scheduleIconoplasmAutosave()
      })
      node.addEventListener("change", function () {
        refreshDirtyState()
        scheduleIconoplasmAutosave()
      })
    }

    bindDirtyTracking(layoutEl)
    bindDirtyTracking(cardVariantEl)
    bindDirtyTracking(showAllGenesEl)

    function syncImageApiControls() {
      if (!imageApiProviderEl) return
      var provider = imageProviderById(imageApiProviderEl.value)
      var saved = savedImageProviderById(imageApiProviderEl.value)
      if (imageApiKeyEl) {
        imageApiKeyEl.value = ""
        imageApiKeyEl.placeholder =
          saved && saved.configured ? "Saved key is configured" : "Paste API key"
      }
      if (imageApiStatusEl) {
        imageApiStatusEl.textContent =
          saved && saved.configured ? "Saved." : "No key saved for this provider."
      }
    }

    if (imageApiProviderEl) imageApiProviderEl.addEventListener("change", syncImageApiControls)
    if (imageApiRetryBtn) {
      imageApiRetryBtn.addEventListener("click", function () {
        void loadImageProviders().then(render)
      })
    }
    if (imageApiSaveBtn) {
      imageApiSaveBtn.addEventListener("click", function () {
        if (!imageApiProviderEl || !imageApiKeyEl) return
        var apiKey = String(imageApiKeyEl.value || "").trim()
        if (!apiKey) {
          if (imageApiStatusEl) imageApiStatusEl.textContent = "Paste an API key before saving."
          return
        }
        imageApiSaveBtn.disabled = true
        if (imageApiStatusEl) imageApiStatusEl.textContent = "Saving API key."
        var provider = imageProviderById(imageApiProviderEl.value)
        var endpointUrl = (provider && provider.default_endpoint_url) || ""
        if (!endpointUrl) {
          if (imageApiStatusEl) imageApiStatusEl.textContent = "Unknown provider."
          imageApiSaveBtn.disabled = false
          return
        }
        fetchJson("/api/iconoplasm/image-edit/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            provider_id: imageApiProviderEl.value,
            endpoint_url: endpointUrl,
            api_key: apiKey,
          }),
        })
          .then(function () {
            return loadImageProviders()
          })
          .then(function () {
            render()
          })
          .catch(function (error) {
            imageApiSaveBtn.disabled = false
            if (imageApiStatusEl) {
              imageApiStatusEl.textContent = String(
                (error && error.message) || "Could not save API key.",
              )
            }
          })
      })
    }

    function syncUserEmulsionMeter() {
      if (!userEmulsionEl || !userEmulsionMeterEl) return
      userEmulsionMeterEl.textContent = String(userEmulsionEl.value.length) + "/140"
    }

    function selectedUserEmulsionVersion() {
      if (!userEmulsionVersionEl) return null
      var selectedId = String(userEmulsionVersionEl.value || "")
      if (!selectedId) return null
      var history = Array.isArray(userEmulsionState.history) ? userEmulsionState.history : []
      for (var i = 0; i < history.length; i++) {
        if (String((history[i] && history[i].id) || "") === selectedId) return history[i]
      }
      return null
    }

    function saveUserEmulsion() {
      if (!userEmulsionEl || !userEmulsionSaveBtn) return
      userEmulsionSaveBtn.disabled = true
      if (userEmulsionStatusEl) {
        userEmulsionStatusEl.textContent = "Saving emulsion."
      }
      fetchJson("/api/iconoplasm/user-emulsion", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ emulsion: userEmulsionEl.value }),
      })
        .then(function (payload) {
          userEmulsionState.loaded = true
          userEmulsionState.error = ""
          userEmulsionState.emulsion = payload && payload.emulsion ? payload.emulsion : null
          userEmulsionState.history = Array.isArray(payload && payload.history)
            ? payload.history
            : []
          render()
        })
        .catch(function (error) {
          userEmulsionSaveBtn.disabled = false
          if (userEmulsionStatusEl) {
            userEmulsionStatusEl.textContent = String(
              (error && error.message) || "Could not save emulsion.",
            )
          }
        })
    }

    if (userEmulsionEl) {
      userEmulsionEl.addEventListener("input", function () {
        syncUserEmulsionMeter()
        if (userEmulsionStatusEl) userEmulsionStatusEl.textContent = "Unsaved emulsion draft."
      })
    }
    if (userEmulsionVersionEl) {
      userEmulsionVersionEl.addEventListener("change", function () {
        var version = selectedUserEmulsionVersion()
        if (!version || !userEmulsionEl) return
        userEmulsionEl.value = String(version.text || "")
        syncUserEmulsionMeter()
        var idEl = document.getElementById("site-settings-user-emulsion-id")
        if (idEl) idEl.textContent = String(version.id || "")
        if (userEmulsionStatusEl) {
          var currentId = String(
            (userEmulsionState.emulsion && userEmulsionState.emulsion.id) || "",
          )
          userEmulsionStatusEl.textContent =
            String(version.id || "") === currentId
              ? "Current emulsion loaded."
              : "Loaded previous version. Save to make a new current version."
        }
      })
    }
    if (userEmulsionSaveBtn) {
      userEmulsionSaveBtn.addEventListener("click", function () {
        if (!userEmulsionEl) return
        saveUserEmulsion()
      })
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (autosaveTimer) window.clearTimeout(autosaveTimer)
        autosaveTimer = null
        saveIconoplasmDraft({ auto: false })
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
        return Promise.all([loadImageProviders(), loadUserEmulsion()]).then(render)
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
