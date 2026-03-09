import { siteSettingsUrl } from "../site-preferences.js?v=20260309c"

var COMMUNITY_URL = "https://discord.com/invite/kx8FVzUrpf"

export function escapeHtml(value) {
  var node = document.createElement("div")
  node.textContent = String(value || "")
  return node.innerHTML
}

function currentOrigin() {
  return String((typeof window !== "undefined" && window.location.origin) || "").trim()
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
  return currentOrigin()
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
  var actions = user
    ? '<button type="button" class="brd-sidebar-btn brd-sidebar-btn--quiet" data-brd-user-logout>Sign Out</button>'
    : '<a class="brd-sidebar-btn" href="' +
      escapeHtml(loginHref) +
      '">' +
      escapeHtml(loginLabel) +
      "</a>"
  var links =
    '<div class="brd-user-links">' +
    '<a href="' +
    escapeHtml(settingsHref) +
    '">Settings</a>' +
    (communityHref
      ? '<a href="' +
        escapeHtml(communityHref) +
        '" target="_blank" rel="noopener noreferrer">Discord</a>'
      : "") +
    "</div>"
  return (
    '<div class="brd-sidebar-section">' +
    '<div class="brd-sidebar-panel-title">' +
    escapeHtml(panelTitle) +
    "</div>" +
    '<div class="brd-user-summary">' +
    avatarMarkup +
    '<div class="brd-user-identity">' +
    '<div class="brd-user-name">' +
    escapeHtml(username || "Guest") +
    "</div>" +
    (tierLabel ? '<div class="brd-user-tier">' + escapeHtml(tierLabel) + "</div>" : "") +
    "</div>" +
    "</div>" +
    links +
    '<div class="brd-user-actions">' +
    actions +
    "</div>" +
    "</div>"
  )
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
