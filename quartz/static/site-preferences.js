var ICONOPLASM_SETTINGS_STORAGE_KEY = "brinedew.iconoplasm.settings.v1"
var THEME_STORAGE_KEY = "theme"
var READER_MODE_STORAGE_KEY = "readerMode"
var THEME_COOKIE_KEY = "brinedew_theme"
var READER_MODE_COOKIE_KEY = "brinedew_reader_mode"
var ICONOPLASM_LAYOUT_COOKIE_KEY = "brinedew_icono_layout"
var GENERATION_PROVIDER_DEFAULT = "openai-compatible"
var ICONOPLASM_DEFAULT_SETTINGS = {
  homeLayout: "bricks",
  generationProvider: GENERATION_PROVIDER_DEFAULT,
  generationApiKey: "",
  generationModel: "",
  generationEndpoint: "",
}

function normalizeHomeLayout(layout) {
  var value = String(layout || "")
    .trim()
    .toLowerCase()
  if (value === "masonry") return "masonry"
  return ICONOPLASM_DEFAULT_SETTINGS.homeLayout
}

function normalizeGenerationProvider(provider) {
  var value = String(provider || "")
    .trim()
    .toLowerCase()
  if (["openai-compatible", "replicate", "gemini", "custom"].indexOf(value) >= 0) return value
  return GENERATION_PROVIDER_DEFAULT
}

function trimStoredValue(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength)
}

function canUseLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage
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

function sharedCookieDomain() {
  var host = String((typeof window !== "undefined" && window.location.hostname) || "").toLowerCase()
  if (!host) return ""
  if (host === "brinedew.bio" || host.endsWith(".brinedew.bio")) return ".brinedew.bio"
  return ""
}

function readCookieValue(name) {
  try {
    var source = String((typeof document !== "undefined" && document.cookie) || "")
    if (!source) return ""
    var parts = source.split(/;\s*/)
    for (var i = 0; i < parts.length; i++) {
      var segment = parts[i]
      var eqIndex = segment.indexOf("=")
      if (eqIndex < 0) continue
      var key = segment.slice(0, eqIndex)
      if (key !== name) continue
      return decodeURIComponent(segment.slice(eqIndex + 1))
    }
  } catch (_err) {
    return ""
  }
  return ""
}

function writeCookieValue(name, value) {
  try {
    var parts = [name + "=" + encodeURIComponent(String(value || "")), "Path=/", "SameSite=Lax"]
    if (value) {
      parts.push("Max-Age=31536000")
    } else {
      parts.push("Max-Age=0")
    }
    var domain = sharedCookieDomain()
    if (domain) parts.push("Domain=" + domain)
    document.cookie = parts.join("; ")
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
  if (!writeStringStorage(THEME_STORAGE_KEY, preference === "system" ? "" : preference)) return false
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
  return String(mode || "").trim().toLowerCase() === "on" ? "on" : "off"
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
    generationProvider: normalizeGenerationProvider(source.generationProvider),
    generationApiKey: trimStoredValue(source.generationApiKey, 800),
    generationModel: trimStoredValue(source.generationModel, 200),
    generationEndpoint: trimStoredValue(source.generationEndpoint, 500),
  }
}

export function readIconoplasmSettings() {
  var settings = buildIconoplasmSettings(readJsonStorage(ICONOPLASM_SETTINGS_STORAGE_KEY) || {})
  var sharedLayout = normalizeHomeLayout(readCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY))
  if (sharedLayout) settings.homeLayout = sharedLayout
  return settings
}

export function writeIconoplasmSettings(settings) {
  var nextSettings = buildIconoplasmSettings(settings || ICONOPLASM_DEFAULT_SETTINGS)
  if (
    !writeJsonStorage(
    ICONOPLASM_SETTINGS_STORAGE_KEY,
      nextSettings,
    )
  ) {
    return false
  }
  return writeCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY, nextSettings.homeLayout)
}

export function resetIconoplasmSettings() {
  if (!removeStorageKey(ICONOPLASM_SETTINGS_STORAGE_KEY)) return false
  return writeCookieValue(ICONOPLASM_LAYOUT_COOKIE_KEY, "")
}

export function iconoplasmSettingsDefaults() {
  return buildIconoplasmSettings(ICONOPLASM_DEFAULT_SETTINGS)
}

export function siteSettingsUrl() {
  var host = String((typeof window !== "undefined" && window.location.hostname) || "").toLowerCase()
  if (!host || host === "localhost" || host === "127.0.0.1") return "/settings"
  if (host === "brinedew.bio" || host === "www.brinedew.bio") return "/settings"
  return "https://brinedew.bio/settings"
}
