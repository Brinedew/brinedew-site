import { siteSettingsUrl } from "../site-preferences.js?v=20260309e"

var COMMUNITY_URL = "https://discord.com/invite/kx8FVzUrpf"
var AUTH_BRIDGE_CHANNEL = "brinedew-shared-auth-bridge"
var AUTH_BRIDGE_PATH = "/static/site-preferences/bridge.html?v=20260309e"
var AUTH_BRIDGE_TIMEOUT_MS = 4000
var authBridgePromise = null
var authBridgeIframe = null
var authBridgeRequestId = 0
var authBridgePending = Object.create(null)
var SETTINGS_GEAR_ICON =
  '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M10 2.75 11.2 3.2 12.48 2.85 13.83 3.63 14.05 4.94 15.06 5.95 16.37 6.17 17.15 7.52 16.8 8.8 17.25 10 16.8 11.2 17.15 12.48 16.37 13.83 15.06 14.05 14.05 15.06 13.83 16.37 12.48 17.15 11.2 16.8 10 17.25 8.8 16.8 7.52 17.15 6.17 16.37 5.95 15.06 4.94 14.05 3.63 13.83 2.85 12.48 3.2 11.2 2.75 10 3.2 8.8 2.85 7.52 3.63 6.17 4.94 5.95 5.95 4.94 6.17 3.63 7.52 2.85 8.8 3.2 10 2.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>' +
  '<circle cx="10" cy="10" r="2.6" stroke="currentColor" stroke-width="1.25"/>' +
  "</svg>"

function wait(ms) {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, ms)
  })
}

export function escapeHtml(value) {
  var node = document.createElement("div")
  node.textContent = String(value || "")
  return node.innerHTML
}

function currentOrigin() {
  return String((typeof window !== "undefined" && window.location.origin) || "").trim()
}

function currentHost() {
  return String((typeof window !== "undefined" && window.location.hostname) || "").toLowerCase()
}

function isCanonicalAuthHost(host) {
  var value = String(host || "").toLowerCase()
  if (!value) return false
  return value === "brinedew.bio" || value === "www.brinedew.bio" || value === "localhost" || value === "127.0.0.1"
}

function canonicalAuthOrigin() {
  var host = currentHost()
  if (!host || host === "localhost" || host === "127.0.0.1") return currentOrigin()
  return "https://brinedew.bio"
}

function shouldUseSharedAuthBridge() {
  var host = currentHost()
  if (!host) return false
  return !isCanonicalAuthHost(host)
}

function currentReturnTo() {
  if (typeof window === "undefined" || !window.location) return ""
  return (
    String(window.location.origin || "") +
    String(window.location.pathname || "") +
    String(window.location.search || "") +
    String(window.location.hash || "")
  )
}

function resolveAuthBase(authBase) {
  var value = String(authBase || "").trim()
  if (value) return value.replace(/\/+$/, "")
  return shouldUseSharedAuthBridge() ? canonicalAuthOrigin() : currentOrigin()
}

export function formatTierLabel(tier) {
  if (!tier) return ""
  var normalized = String(tier || "")
    .trim()
    .toLowerCase()
  if (!normalized || normalized === "registered") return ""
  return normalized
    .split(/[\s_]+/)
    .map(function (word) {
      return word ? word.charAt(0).toUpperCase() + word.slice(1) : ""
    })
    .join(" ")
}

export function getUserInitial(username) {
  var normalized = String(username || "").trim()
  if (!normalized) return "?"
  var first = normalized.charAt(0).toUpperCase()
  return /[A-Z0-9]/.test(first) ? first : "?"
}

export function buildLoginUrl(options) {
  var source = options || {}
  var authBase = resolveAuthBase(source.authBase)
  var params = new URLSearchParams()
  if (typeof source.leaderboardOptIn === "boolean") {
    params.set("leaderboard_opt_in", source.leaderboardOptIn ? "1" : "0")
  }
  var returnTo = String(source.returnTo || currentReturnTo()).trim()
  if (returnTo) params.set("return_to", returnTo)
  var query = params.toString()
  return authBase + "/api/auth/login" + (query ? "?" + query : "")
}

export async function fetchAuthenticatedUser(options) {
  var source = options || {}
  if (!source.authBase && shouldUseSharedAuthBridge()) {
    for (var attempt = 0; attempt < 6; attempt++) {
      var bridgedUser = await requestSharedAuth("fetchAuthenticatedUser").catch(function () {
        return null
      })
      if (bridgedUser) return bridgedUser
      if (attempt < 5) await wait(400)
    }
    return null
  }
  var authBase = resolveAuthBase(source.authBase)
  try {
    var response = await fetch(authBase + "/api/auth/me", {
      credentials: "include",
    })
    if (!response.ok) return null
    var payload = await response.json().catch(function () {
      return null
    })
    if (!payload || !payload.authenticated || !payload.user) return null
    return payload.user
  } catch (_err) {
    return null
  }
}

export async function logoutAuthenticatedUser(options) {
  var source = options || {}
  if (!source.authBase && shouldUseSharedAuthBridge()) {
    return requestSharedAuth("logoutAuthenticatedUser")
  }
  var authBase = resolveAuthBase(source.authBase)
  var response = await fetch(authBase + "/api/auth/logout", {
    method: "POST",
    credentials: "include",
  })
  if (!response.ok && response.status !== 204) {
    throw new Error("Logout failed (" + response.status + ")")
  }
  return true
}

export function buildSharedUserPanelMarkup(options) {
  var source = options || {}
  var user = source.user || null
  var username = user ? String(user.username || "").trim() : "Guest"
  var tierLabel = user ? formatTierLabel(user.tier) : ""
  var avatarUrl = user ? String(user.avatar_url || "").trim() : ""
  var avatarMarkup = avatarUrl
    ? '<img class="brd-user-avatar" src="' +
      escapeHtml(avatarUrl) +
      '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '<span class="brd-user-avatar brd-user-avatar--fallback" aria-hidden="true">' +
      escapeHtml(getUserInitial(username)) +
      "</span>"
  var settingsHref = String(source.settingsHref || siteSettingsUrl() || "/settings").trim()
  var loginHref = buildLoginUrl(source)
  var loginLabel = String(source.loginLabel || "Discord Login").trim() || "Discord Login"
  var panelTitle = String(source.panelTitle || "Account").trim() || "Account"
  var communityHref = String(source.communityHref || COMMUNITY_URL).trim()
  var settingsAction =
    '<a class="brd-icon-btn brd-icon-btn--settings" href="' +
    escapeHtml(settingsHref) +
    '" aria-label="Settings" title="Settings">' +
    SETTINGS_GEAR_ICON +
    "</a>"
  var communityAction = user && communityHref
    ? '<a class="brd-sidebar-btn brd-sidebar-btn--community" href="' +
      escapeHtml(communityHref) +
      '" target="_blank" rel="noopener noreferrer">Discord</a>'
    : ""
  var primaryAction = user
    ? '<button type="button" class="brd-sidebar-btn brd-sidebar-btn--quiet" data-brd-user-logout>Sign Out</button>'
    : '<a class="brd-sidebar-btn" href="' +
      escapeHtml(loginHref) +
      '">' +
      escapeHtml(loginLabel) +
      "</a>"
  return (
    '<div class="brd-sidebar-section">' +
    '<div class="brd-sidebar-panel-title">' +
    escapeHtml(panelTitle) +
    "</div>" +
    '<div class="brd-user-header">' +
    '<div class="brd-user-summary">' +
    avatarMarkup +
    '<div class="brd-user-identity">' +
    '<div class="brd-user-name">' +
    escapeHtml(username || "Guest") +
    "</div>" +
    (tierLabel ? '<div class="brd-user-tier">' + escapeHtml(tierLabel) + "</div>" : "") +
    "</div>" +
    "</div>" +
    settingsAction +
    "</div>" +
    '<div class="brd-user-actions">' +
    communityAction +
    primaryAction +
    "</div>" +
    "</div>"
  )
}

function canUseDocument() {
  try {
    return typeof document !== "undefined" && !!document.createElement
  } catch (_err) {
    return false
  }
}

function sharedAuthBridgeUrl() {
  return canonicalAuthOrigin() + AUTH_BRIDGE_PATH
}

function authBridgeWindowReady(iframe) {
  if (!iframe || iframe.getAttribute("src") !== sharedAuthBridgeUrl()) return false
  if (iframe.getAttribute("data-ready") !== "true" || !iframe.contentWindow) return false
  try {
    var loadedOrigin = String((iframe.contentWindow.location && iframe.contentWindow.location.origin) || "")
    if (!loadedOrigin || loadedOrigin !== canonicalAuthOrigin()) return false
  } catch (_err) {
    return true
  }
  return true
}

function ensureAuthBridgeIframe() {
  if (!canUseDocument()) return null
  if (authBridgeIframe && authBridgeIframe.isConnected) return authBridgeIframe
  authBridgeIframe = document.getElementById("brinedew-auth-bridge")
  if (authBridgeIframe) return authBridgeIframe
  var iframe = document.createElement("iframe")
  iframe.id = "brinedew-auth-bridge"
  iframe.setAttribute("title", "Brinedew auth bridge")
  iframe.setAttribute("aria-hidden", "true")
  iframe.tabIndex = -1
  iframe.style.display = "none"
  iframe.setAttribute("data-ready", "false")
  authBridgeIframe = iframe
  return iframe
}

function navigateAuthBridgeIframe(iframe) {
  if (!iframe) return
  iframe.setAttribute("data-ready", "false")
  iframe.setAttribute("src", sharedAuthBridgeUrl())
}

function attachAuthBridgeIframe(iframe) {
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

function resolveAuthBridge() {
  if (!shouldUseSharedAuthBridge()) return Promise.resolve(null)
  var existing = ensureAuthBridgeIframe()
  if (existing && existing.isConnected && authBridgeWindowReady(existing)) {
    return Promise.resolve(existing)
  }
  if (authBridgePromise) return authBridgePromise
  authBridgePromise = new Promise(function (resolve, reject) {
    var iframe = existing || ensureAuthBridgeIframe()
    if (!iframe) {
      authBridgePromise = null
      reject(new Error("Auth bridge iframe unavailable"))
      return
    }

    function cleanup() {
      iframe.removeEventListener("load", onLoad)
      iframe.removeEventListener("error", onError)
    }

    function onLoad() {
      if (!authBridgeWindowReady(iframe)) {
        if (iframe.getAttribute("src") !== sharedAuthBridgeUrl()) {
          navigateAuthBridgeIframe(iframe)
        }
        return
      }
      cleanup()
      iframe.setAttribute("data-ready", "true")
      authBridgePromise = null
      resolve(iframe)
    }

    function onError() {
      cleanup()
      iframe.setAttribute("data-ready", "false")
      authBridgePromise = null
      reject(new Error("Failed to load auth bridge iframe"))
    }

    iframe.addEventListener("load", onLoad)
    iframe.addEventListener("error", onError)
    if (iframe.getAttribute("src") !== sharedAuthBridgeUrl()) {
      navigateAuthBridgeIframe(iframe)
    }
    attachAuthBridgeIframe(iframe)

    if (authBridgeWindowReady(iframe)) {
      cleanup()
      authBridgePromise = null
      resolve(iframe)
    }
  })
  return authBridgePromise
}

function requestSharedAuth(type) {
  return resolveAuthBridge().then(function (iframe) {
    if (!iframe || !iframe.contentWindow) return null
    return new Promise(function (resolve, reject) {
      var id = "auth-" + String(++authBridgeRequestId)
      var timer = window.setTimeout(function () {
        delete authBridgePending[id]
        reject(new Error("Auth bridge request timed out"))
      }, AUTH_BRIDGE_TIMEOUT_MS)

      authBridgePending[id] = {
        resolve: resolve,
        reject: reject,
        timer: timer,
      }

      iframe.contentWindow.postMessage(
        {
          channel: AUTH_BRIDGE_CHANNEL,
          id: id,
          type: type,
        },
        canonicalAuthOrigin(),
      )
    })
  })
}

if (typeof window !== "undefined") {
  window.addEventListener("message", function (event) {
    var data = event && event.data ? event.data : null
    if (!data || data.channel !== AUTH_BRIDGE_CHANNEL || event.origin !== canonicalAuthOrigin()) return
    var pending = authBridgePending[data.id]
    if (!pending) return
    window.clearTimeout(pending.timer)
    delete authBridgePending[data.id]
    if (data.ok) {
      pending.resolve(data.payload || null)
      return
    }
    pending.reject(new Error((data.payload && data.payload.error) || "Auth bridge request failed"))
  })
}

export function mountSidebarStack(options) {
  var source = options || {}
  var sidebar =
    source.sidebar ||
    (typeof document !== "undefined" ? document.querySelector(source.sidebarSelector || ".right.sidebar") : null)
  if (!sidebar) return null

  var stackId = String(source.stackId || "brd-sidebar-stack").trim() || "brd-sidebar-stack"
  var existing = document.getElementById(stackId)
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing)

  var stack = document.createElement("div")
  stack.id = stackId
  stack.className = "brd-sidebar-stack"

  var panels = Array.isArray(source.panels) ? source.panels : []
  for (var i = 0; i < panels.length; i++) {
    var panel = panels[i] || {}
    var section = document.createElement("section")
    section.className = "brd-sidebar-panel" + (panel.className ? " " + panel.className : "")
    if (panel.id) section.id = panel.id
    section.innerHTML = String(panel.markup || "")
    stack.appendChild(section)
  }

  var insertBefore = null
  if (source.insertBeforeSelector) {
    insertBefore = sidebar.querySelector(source.insertBeforeSelector)
  } else {
    insertBefore = sidebar.querySelector(".page-tags-section")
  }
  if (insertBefore) {
    sidebar.insertBefore(stack, insertBefore)
  } else {
    sidebar.appendChild(stack)
  }
  return stack
}

export function wireSharedUserPanel(root, options) {
  if (!root) return
  var source = options || {}
  var logoutButtons = root.querySelectorAll("[data-brd-user-logout]")
  for (var i = 0; i < logoutButtons.length; i++) {
    logoutButtons[i].addEventListener("click", function () {
      var button = this
      button.disabled = true
      logoutAuthenticatedUser(source)
        .then(function () {
          if (typeof source.onAuthChanged === "function") {
            source.onAuthChanged(null)
            return
          }
          window.location.reload()
        })
        .catch(function (err) {
          button.disabled = false
          console.error("Shared user logout failed:", err)
        })
    })
  }
}
