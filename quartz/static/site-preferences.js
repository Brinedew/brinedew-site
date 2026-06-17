var ICONOPLASM_SETTINGS_STORAGE_KEY = "brinedew.iconoplasm.settings.v1"
var THEME_STORAGE_KEY = "theme"
var READER_MODE_STORAGE_KEY = "readerMode"
var THEME_COOKIE_KEY = "brinedew_theme"
var READER_MODE_COOKIE_KEY = "brinedew_reader_mode"
var ICONOPLASM_LAYOUT_COOKIE_KEY = "brinedew_icono_layout"
var ICONOPLASM_CARD_VARIANT_COOKIE_KEY = "brinedew_icono_card_variant"
var ICONOPLASM_SHOW_ALL_GENES_COOKIE_KEY = "brinedew_icono_show_all_genes"
var ICONOPLASM_SHARED_BRIDGE_CHANNEL = "brinedew-site-preferences-bridge"
var ICONOPLASM_SHARED_BRIDGE_PATH = "/static/site-preferences/bridge.html?v=20260509a"
var ICONOPLASM_SHARED_REQUEST_TIMEOUT_MS = 4000
var ICONOPLASM_SETTINGS_CHANGE_EVENT = "iconoplasmsettingschange"
var ICONOPLASM_DEFAULT_SETTINGS = {
  homeLayout: "bricks",
  cardVariant: "image-only",
  showAllGenes: false,
}
var sharedIconoplasmSettingsCache = null
var sharedBridgePromise = null
var sharedBridgeIframe = null
var sharedBridgeRequestId = 0
var sharedBridgePending = Object.create(null)
var sharedIconoplasmSettingsSyncStarted = false
var queuedSharedIconoplasmSettingsRefresh = null

function normalizeHomeLayout(layout) {
  var value = String(layout || "")
    .trim()
    .toLowerCase()
  if (value === "masonry") return "masonry"
  return ICONOPLASM_DEFAULT_SETTINGS.homeLayout
}

function normalizeCardVariant(variant) {
  var value = String(variant || "")
    .trim()
    .toLowerCase()
  if (value === "image-only") return "image-only"
  if (value === "neo-drab") return "lit-archival"
  if (value === "lab-label" || value === "lit-archival") return "lit-archival"
  if (value === "classic" || value === "simple") return "simple"
  return ICONOPLASM_DEFAULT_SETTINGS.cardVariant
}

function normalizeBooleanSetting(value) {
  if (value === true) return true
  var normalized = String(value || "")
    .trim()
    .toLowerCase()
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage
  } catch (_err) {
    return false
  }
}

function canUseDocument() {
  try {
    return typeof document !== "undefined" && !!document.createElement
  } catch (_err) {
    return false
  }
}

function readJsonStorage(key) {
  if (!canUseLocalStorage()) return null
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null")
  } catch (_err) {
    return null
  }
}

function writeJsonStorage(key, value) {
  if (!canUseLocalStorage()) return false
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (_err) {
    return false
  }
}

function removeStorageKey(key) {
  if (!canUseLocalStorage()) return false
  try {
    window.localStorage.removeItem(key)
    return true
  } catch (_err) {
    return false
  }
}

function readStringStorage(key) {
  if (!canUseLocalStorage()) return ""
  try {
    return String(window.localStorage.getItem(key) || "")
  } catch (_err) {
    return ""
  }
}

function currentHost() {
  return String((typeof window !== "undefined" && window.location.hostname) || "").toLowerCase()
}

function currentOrigin() {
  return String((typeof window !== "undefined" && window.location.origin) || "")
}

function isCanonicalSettingsHost(host) {
  var value = String(host || "").toLowerCase()
  if (!value) return false
  return (
    value === "brinedew.bio" ||
    value === "www.brinedew.bio" ||
    value === "localhost" ||
    value === "127.0.0.1"
  )
}

function canonicalSettingsOrigin() {
  var host = currentHost()
  if (!host || host === "localhost" || host === "127.0.0.1") return currentOrigin()
  return "https://brinedew.bio"
}

function shouldUseSharedSettingsBridge() {
  var host = currentHost()
  if (!host) return false
  return !isCanonicalSettingsHost(host)
}

function sharedCookieDomain() {
  var host = currentHost()
  if (!host) return ""
  if (host === "brinedew.bio" || host.endsWith(".brinedew.bio")) return ".brinedew.bio"
  return ""
}

function readCookieValue(name) {
  try {
    var source = String((typeof document !== "undefined" && document.cookie) || "")
    if (!source) return ""
    var parts = source.split(/;\s*/)
    var result = ""
    for (var i = 0; i < parts.length; i++) {
      var segment = parts[i]
      var eqIndex = segment.indexOf("=")
      if (eqIndex < 0) continue
      var key = segment.slice(0, eqIndex)
      if (key !== name) continue
      result = decodeURIComponent(segment.slice(eqIndex + 1))
    }
    return result
  } catch (_err) {
    return ""
  }
  return ""
}

function cookieAssignment(name, value, domain) {
  var parts = [name + "=" + encodeURIComponent(String(value || "")), "Path=/", "SameSite=Lax"]
  if (value) {
    parts.push("Max-Age=31536000")
  } else {
    parts.push("Max-Age=0")
  }
  if (domain) parts.push("Domain=" + domain)
  return parts.join("; ")
}

function writeCookieValue(name, value) {
  try {
    var domain = sharedCookieDomain()
    document.cookie = cookieAssignment(name, value, "")
    if (domain) document.cookie = cookieAssignment(name, value, domain)
    return true
  } catch (_err) {
    return false
  }
}

function writeStringStorage(key, value) {
  if (!canUseLocalStorage()) return false
  try {
    if (value === null || value === undefined || value === "") {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, String(value))
    }
    return true
  } catch (_err) {
    return false
  }
}

function sharedBridgeUrl() {
  return canonicalSettingsOrigin() + ICONOPLASM_SHARED_BRIDGE_PATH
}

function sharedBridgeFrameLoaded(iframe) {
  if (!iframe || iframe.getAttribute("src") !== sharedBridgeUrl()) return false
  if (!iframe.contentWindow) return false
  try {
    var loadedOrigin = String(
      (iframe.contentWindow.location && iframe.contentWindow.location.origin) || "",
    )
    if (!loadedOrigin || loadedOrigin !== canonicalSettingsOrigin()) return false
  } catch (_err) {
    return true
  }
  return true
}

function sharedBridgeWindowReady(iframe) {
  if (iframe.getAttribute("data-ready") !== "true") return false
  return sharedBridgeFrameLoaded(iframe)
}

function markBridgeReady() {
  if (sharedBridgeIframe) sharedBridgeIframe.setAttribute("data-ready", "true")
}

function ensureSharedBridgeIframe() {
  if (!canUseDocument()) return null
  if (sharedBridgeIframe && sharedBridgeIframe.isConnected) return sharedBridgeIframe
  sharedBridgeIframe = document.getElementById("brinedew-site-preferences-bridge")
  if (sharedBridgeIframe) return sharedBridgeIframe
  var iframe = document.createElement("iframe")
  iframe.id = "brinedew-site-preferences-bridge"
  iframe.setAttribute("title", "Brinedew settings bridge")
  iframe.setAttribute("aria-hidden", "true")
  iframe.tabIndex = -1
  iframe.style.display = "none"
  sharedBridgeIframe = iframe
  return iframe
}

function navigateSharedBridgeIframe(iframe) {
  if (!iframe) return
  iframe.removeAttribute("data-ready")
  iframe.setAttribute("src", sharedBridgeUrl())
}

function attachSharedBridgeIframe(iframe) {
  if (!iframe || iframe.isConnected || !canUseDocument()) return
  var parent = document.body || document.documentElement
  if (parent) {
    parent.appendChild(iframe)
    return
  }
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      var nextParent = document.body || document.documentElement
      if (nextParent && !iframe.isConnected) nextParent.appendChild(iframe)
    },
    { once: true },
  )
}

function clearSharedBridgePending(id, error, payload) {
  var pending = sharedBridgePending[id]
  if (!pending) return
  delete sharedBridgePending[id]
  if (pending.timeoutId) window.clearTimeout(pending.timeoutId)
  if (error) {
    pending.reject(error)
    return
  }
  pending.resolve(payload)
}

function ensureSharedBridgeMessageListener() {
  if (
    typeof window === "undefined" ||
    !window.addEventListener ||
    window.__brinedewSitePreferencesBridgeListener
  ) {
    return
  }
  window.__brinedewSitePreferencesBridgeListener = true
  window.addEventListener("message", function (event) {
    var data = event && event.data ? event.data : null
    if (!data || data.channel !== ICONOPLASM_SHARED_BRIDGE_CHANNEL) return
    if (event.origin !== canonicalSettingsOrigin()) return
    if (typeof data.id !== "string" || !sharedBridgePending[data.id]) return
    if (data.ok === false) {
      clearSharedBridgePending(
        data.id,
        new Error((data.payload && data.payload.error) || "Settings bridge failed"),
      )
      return
    }
    clearSharedBridgePending(data.id, null, data.payload || null)
  })
}

function sharedBridgeReady() {
  if (!shouldUseSharedSettingsBridge()) return Promise.resolve(null)
  if (!canUseDocument() || typeof window === "undefined") {
    return Promise.reject(new Error("Settings bridge unavailable"))
  }
  ensureSharedBridgeMessageListener()
  if (sharedBridgeIframe && sharedBridgeWindowReady(sharedBridgeIframe)) {
    return Promise.resolve(sharedBridgeIframe.contentWindow || null)
  }
  if (sharedBridgePromise) return sharedBridgePromise

  sharedBridgePromise = new Promise(function (resolve, reject) {
    var iframe = ensureSharedBridgeIframe()
    if (!iframe) {
      reject(new Error("Settings bridge unavailable"))
      return
    }
    var url = sharedBridgeUrl()

    function cleanup() {
      iframe.removeEventListener("load", handleLoad)
      iframe.removeEventListener("error", handleError)
    }

    function handleLoad() {
      // Do not gate the initial load event on data-ready. This handler is what
      // flips the bridge into the ready state, so requiring the flag first
      // wedges the promise forever and the homepage never requests discoveries.
      if (!sharedBridgeFrameLoaded(iframe)) {
        if (iframe.getAttribute("src") !== url) {
          navigateSharedBridgeIframe(iframe)
        }
        return
      }
      cleanup()
      markBridgeReady()
      sharedBridgePromise = null
      resolve(iframe.contentWindow || null)
    }

    function handleError() {
      cleanup()
      sharedBridgePromise = null
      reject(new Error("Failed to load shared settings bridge"))
    }

    iframe.addEventListener("load", handleLoad)
    iframe.addEventListener("error", handleError)
    if (iframe.getAttribute("src") !== url) {
      navigateSharedBridgeIframe(iframe)
    }
    attachSharedBridgeIframe(iframe)

    if (sharedBridgeFrameLoaded(iframe)) {
      cleanup()
      markBridgeReady()
      sharedBridgePromise = null
      resolve(iframe.contentWindow)
    }
  }).catch(function (error) {
    sharedBridgePromise = null
    throw error
  })

  return sharedBridgePromise
}

function requestSharedIconoplasmSettings(type, payload) {
  if (!shouldUseSharedSettingsBridge()) {
    return Promise.resolve(null)
  }
  return sharedBridgeReady().then(function (bridgeWindow) {
    if (!bridgeWindow || !bridgeWindow.postMessage) {
      throw new Error("Settings bridge unavailable")
    }
    return new Promise(function (resolve, reject) {
      sharedBridgeRequestId += 1
      var requestId = "settings-" + sharedBridgeRequestId
      sharedBridgePending[requestId] = {
        resolve: resolve,
        reject: reject,
        timeoutId: window.setTimeout(function () {
          clearSharedBridgePending(requestId, new Error("Shared settings bridge timed out"))
        }, ICONOPLASM_SHARED_REQUEST_TIMEOUT_MS),
      }
      bridgeWindow.postMessage(
        {
          channel: ICONOPLASM_SHARED_BRIDGE_CHANNEL,
          id: requestId,
          type: type,
          payload: payload || null,
        },
        canonicalSettingsOrigin(),
      )
    })
  })
}

function effectiveSystemTheme() {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
  } catch (_err) {
    return "dark"
  }
}

export function normalizeThemePreference(theme) {
  var value = String(theme || "")
    .trim()
    .toLowerCase()
  if (value === "light" || value === "dark") return value
  return "system"
}

export function readThemePreference() {
  var shared = normalizeThemePreference(readCookieValue(THEME_COOKIE_KEY))
  if (shared !== "system") return shared
  return normalizeThemePreference(readStringStorage(THEME_STORAGE_KEY))
}

export function readEffectiveTheme() {
  var stored = readThemePreference()
  return stored === "system" ? effectiveSystemTheme() : stored
}

export function applyThemePreference(themePreference) {
  var preference = normalizeThemePreference(themePreference)
  var effectiveTheme = preference === "system" ? effectiveSystemTheme() : preference
  if (!writeStringStorage(THEME_STORAGE_KEY, preference === "system" ? "" : preference))
    return false
  if (!writeCookieValue(THEME_COOKIE_KEY, preference === "system" ? "" : preference)) return false
  document.documentElement.setAttribute("data-theme", effectiveTheme)
  document.documentElement.setAttribute("saved-theme", effectiveTheme)
  document.dispatchEvent(
    new CustomEvent("themechange", {
      detail: { theme: effectiveTheme },
    }),
  )
  return true
}

export function normalizeReaderModePreference(mode) {
  return String(mode || "")
    .trim()
    .toLowerCase() === "on"
    ? "on"
    : "off"
}

export function readReaderModePreference() {
  var shared = normalizeReaderModePreference(readCookieValue(READER_MODE_COOKIE_KEY))
  if (shared === "on") return shared
  return normalizeReaderModePreference(readStringStorage(READER_MODE_STORAGE_KEY))
}

export function applyReaderModePreference(modePreference) {
  var preference = normalizeReaderModePreference(modePreference)
  if (!writeStringStorage(READER_MODE_STORAGE_KEY, preference === "off" ? "" : preference))
    return false
  if (!writeCookieValue(READER_MODE_COOKIE_KEY, preference === "off" ? "" : preference))
    return false
  document.documentElement.setAttribute("reader-mode", preference)
  document.dispatchEvent(
    new CustomEvent("readermodechange", {
      detail: { mode: preference },
    }),
  )
  return true
}

export function buildIconoplasmSettings(raw) {
  var source = raw && typeof raw === "object" ? raw : {}
  return {
    homeLayout: normalizeHomeLayout(source.homeLayout),
    cardVariant: normalizeCardVariant(source.cardVariant),
    showAllGenes: normalizeBooleanSetting(source.showAllGenes),
  }
}

function hasLegacyIconoplasmProviderSettings(raw) {
  if (!raw || typeof raw !== "object") return false
  return (
    Object.prototype.hasOwnProperty.call(raw, "generationApiKey") ||
    Object.prototype.hasOwnProperty.call(raw, "generationProvider") ||
    Object.prototype.hasOwnProperty.call(raw, "generationModel") ||
    Object.prototype.hasOwnProperty.call(raw, "generationEndpoint")
  )
}

function readStoredIconoplasmSettings() {
  var raw = readJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY) || {}
  var settings = buildIconoplasmSettings(raw)
  if (hasLegacyIconoplasmProviderSettings(raw)) {
    writeJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY, settings)
  }
  return settings
}

function iconoplasmSettingsSignature(settings) {
  return JSON.stringify(buildIconoplasmSettings(settings || ICONOPLASM_DEFAULT_SETTINGS))
}

function dispatchIconoplasmSettingsChange(settings, source) {
  if (
    typeof document === "undefined" ||
    !document.dispatchEvent ||
    typeof CustomEvent !== "function"
  ) {
    return
  }
  document.dispatchEvent(
    new CustomEvent(ICONOPLASM_SETTINGS_CHANGE_EVENT, {
      detail: {
        settings: buildIconoplasmSettings(settings || ICONOPLASM_DEFAULT_SETTINGS),
        source: String(source || "unknown"),
      },
    }),
  )
}

function rememberIconoplasmSettings(settings, source) {
  var previousSignature = iconoplasmSettingsSignature(sharedIconoplasmSettingsCache)
  sharedIconoplasmSettingsCache = buildIconoplasmSettings(settings || ICONOPLASM_DEFAULT_SETTINGS)
  var nextSignature = iconoplasmSettingsSignature(sharedIconoplasmSettingsCache)
  if (previousSignature !== nextSignature) {
    dispatchIconoplasmSettingsChange(sharedIconoplasmSettingsCache, source)
  }
  return sharedIconoplasmSettingsCache
}

function syncIconoplasmSettingsFromSharedHints(source) {
  var hintedSettings = buildIconoplasmSettings(readIconoplasmSettings())
  if (
    iconoplasmSettingsSignature(sharedIconoplasmSettingsCache) ===
    iconoplasmSettingsSignature(hintedSettings)
  ) {
    return hintedSettings
  }
  rememberIconoplasmSettings(hintedSettings, source || "shared-hint")
  writeJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY, hintedSettings)
  return hintedSettings
}

export function readIconoplasmSettings() {
  var cached =
    sharedIconoplasmSettingsCache && typeof sharedIconoplasmSettingsCache === "object"
      ? sharedIconoplasmSettingsCache
      : readStoredIconoplasmSettings()
  var settings = buildIconoplasmSettings(cached)
  var rawSharedLayout = readCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY)
  if (rawSharedLayout) settings.homeLayout = normalizeHomeLayout(rawSharedLayout)
  var rawSharedCardVariant = readCookieValue(ICONOPLASM_CARD_VARIANT_COOKIE_KEY)
  if (rawSharedCardVariant) settings.cardVariant = normalizeCardVariant(rawSharedCardVariant)
  var rawSharedShowAllGenes = readCookieValue(ICONOPLASM_SHOW_ALL_GENES_COOKIE_KEY)
  if (rawSharedShowAllGenes !== "") {
    settings.showAllGenes = normalizeBooleanSetting(rawSharedShowAllGenes)
  }
  return settings
}

export function writeIconoplasmSettings(settings) {
  var nextSettings = buildIconoplasmSettings(settings || ICONOPLASM_DEFAULT_SETTINGS)
  rememberIconoplasmSettings(nextSettings, "local-write")
  if (!writeJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY, nextSettings)) return false
  if (!writeCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY, nextSettings.homeLayout)) return false
  if (!writeCookieValue(ICONOPLASM_CARD_VARIANT_COOKIE_KEY, nextSettings.cardVariant)) return false
  if (
    !writeCookieValue(ICONOPLASM_SHOW_ALL_GENES_COOKIE_KEY, nextSettings.showAllGenes ? "1" : "0")
  )
    return false
  if (shouldUseSharedSettingsBridge()) {
    void requestSharedIconoplasmSettings("writeIconoplasmSettings", nextSettings)
      .then(function (sharedSettings) {
        if (sharedSettings) rememberIconoplasmSettings(sharedSettings, "bridge-write")
      })
      .catch(function () {
        return null
      })
  }
  return true
}

export function resetIconoplasmSettings() {
  sharedIconoplasmSettingsCache = null
  if (!removeStorageKey(ICONOPLASM_SETTINGS_STORAGE_KEY)) return false
  if (!writeCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY, "")) return false
  if (!writeCookieValue(ICONOPLASM_CARD_VARIANT_COOKIE_KEY, "")) return false
  if (!writeCookieValue(ICONOPLASM_SHOW_ALL_GENES_COOKIE_KEY, "0")) return false
  if (shouldUseSharedSettingsBridge()) {
    void requestSharedIconoplasmSettings("resetIconoplasmSettings")
      .then(function (sharedSettings) {
        if (sharedSettings) rememberIconoplasmSettings(sharedSettings, "bridge-reset")
      })
      .catch(function () {
        return null
      })
  }
  return true
}

export function iconoplasmSettingsDefaults() {
  return buildIconoplasmSettings(ICONOPLASM_DEFAULT_SETTINGS)
}

export function syncSharedIconoplasmSettings() {
  if (!shouldUseSharedSettingsBridge()) {
    return Promise.resolve(rememberIconoplasmSettings(readStoredIconoplasmSettings(), "local-read"))
  }
  return requestSharedIconoplasmSettings("readIconoplasmSettings")
    .then(function (sharedSettings) {
      var nextSettings = rememberIconoplasmSettings(
        sharedSettings || ICONOPLASM_DEFAULT_SETTINGS,
        "bridge-read",
      )
      writeJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY, nextSettings)
      return readIconoplasmSettings()
    })
    .catch(function () {
      return readIconoplasmSettings()
    })
}

function queueSharedIconoplasmSettingsRefresh(reason) {
  if (!shouldUseSharedSettingsBridge() || typeof window === "undefined") return
  if (queuedSharedIconoplasmSettingsRefresh) return
  var flush = function () {
    queuedSharedIconoplasmSettingsRefresh = null
    void syncSharedIconoplasmSettings().catch(function () {
      return readIconoplasmSettings()
    })
  }
  if (typeof window.requestAnimationFrame === "function") {
    queuedSharedIconoplasmSettingsRefresh = window.requestAnimationFrame(flush)
    return
  }
  queuedSharedIconoplasmSettingsRefresh = window.setTimeout(flush, 0)
}

export function startSharedIconoplasmSettingsAutoSync() {
  if (
    sharedIconoplasmSettingsSyncStarted ||
    !shouldUseSharedSettingsBridge() ||
    typeof window === "undefined" ||
    !window.addEventListener
  ) {
    return
  }
  sharedIconoplasmSettingsSyncStarted = true
  window.addEventListener("focus", function () {
    syncIconoplasmSettingsFromSharedHints("focus-cookie")
    queueSharedIconoplasmSettingsRefresh("focus")
  })
  window.addEventListener("pageshow", function () {
    syncIconoplasmSettingsFromSharedHints("pageshow-cookie")
    queueSharedIconoplasmSettingsRefresh("pageshow")
  })
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      syncIconoplasmSettingsFromSharedHints("visibility-cookie")
      queueSharedIconoplasmSettingsRefresh("visibility")
    }
  })
  window.setInterval(function () {
    if (document.visibilityState === "visible") {
      syncIconoplasmSettingsFromSharedHints("visible-poll")
    }
  }, 1000)
}

export function siteSettingsUrl() {
  var host = currentHost()
  if (!host || host === "localhost" || host === "127.0.0.1") return "/settings"
  if (host === "brinedew.bio" || host === "www.brinedew.bio") return "/settings"
  return "https://brinedew.bio/settings"
}
