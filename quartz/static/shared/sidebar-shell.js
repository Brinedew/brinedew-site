import { siteSettingsUrl } from "../site-preferences.js?v=20260520stylecookie"

export var COMMUNITY_URL = "https://discord.com/invite/kx8FVzUrpf"
var SHARED_SESSION_PRESENCE_COOKIE = "brinedew_session_present"
var sharedAuthStatus = hasSharedSessionPresenceHint() ? "checking" : "guest"
var SETTINGS_GEAR_ICON =
  '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
  '<path d="M10 2.5v2.2M10 15.3v2.2M17.5 10h-2.2M4.7 10H2.5M15.3 4.7l-1.55 1.55M6.25 13.75 4.7 15.3M15.3 15.3l-1.55-1.55M6.25 6.25 4.7 4.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  '<circle cx="10" cy="10" r="4.15" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="10" cy="10" r="1.65" fill="currentColor"/>' +
  "</svg>"

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

export function hasSharedSessionPresenceHint() {
  try {
    return String(document.cookie || "")
      .split(/;\s*/)
      .some(function (segment) {
        return segment === SHARED_SESSION_PRESENCE_COOKIE + "=1"
      })
  } catch (_err) {
    return false
  }
}

function clearSharedSessionPresenceHint() {
  try {
    document.cookie = SHARED_SESSION_PRESENCE_COOKIE + "=; Path=/; Secure; SameSite=Lax; Max-Age=0"
    var host = currentHost()
    if (host === "brinedew.bio" || host.endsWith(".brinedew.bio")) {
      document.cookie =
        SHARED_SESSION_PRESENCE_COOKIE +
        "=; Path=/; Secure; SameSite=Lax; Max-Age=0; Domain=.brinedew.bio"
    }
  } catch (_err) {
    // A stale hint only causes one failed auth probe; it never grants access.
  }
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
  var host = currentHost()
  return !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "brinedew.bio" ||
    host.endsWith(".brinedew.bio")
    ? currentOrigin()
    : "https://brinedew.bio"
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
  sharedAuthStatus = "checking"
  try {
    var payload
    if (source.payloadPromise) {
      payload = await source.payloadPromise
    } else {
      var response = await fetch(resolveAuthBase(source.authBase) + "/api/auth/me", {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 401) payload = null
      else {
        if (!response.ok)
          throw new Error("Session verification unavailable (" + response.status + ")")
        payload = await response.json()
      }
    }
    if (payload === null || payload?.authenticated === false) {
      clearSharedSessionPresenceHint()
      sharedAuthStatus = "guest"
      return null
    }
    if (!payload?.authenticated || !payload.user) throw new Error("Invalid session response")
    sharedAuthStatus = "signed_in"
    return payload.user
  } catch (error) {
    sharedAuthStatus = "unavailable"
    throw error
  }
}

export async function logoutAuthenticatedUser(options) {
  var response = await fetch(resolveAuthBase(options?.authBase) + "/api/auth/logout", {
    method: "POST",
    credentials: "include",
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error("Logout failed (" + response.status + ")")
  clearSharedSessionPresenceHint()
  sharedAuthStatus = "guest"
  return true
}

export function buildSharedUserPanelMarkup(options) {
  var source = options || {}
  var user = source.user || null
  var pending = sharedAuthStatus === "checking" || sharedAuthStatus === "unavailable"
  var username = user ? String(user.username || "").trim() : pending ? "Checking account" : "Guest"
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
  var communityAction =
    user && communityHref
      ? '<a class="brd-sidebar-btn brd-sidebar-btn--community" href="' +
        escapeHtml(communityHref) +
        '" target="_blank" rel="noopener noreferrer">Discord</a>'
      : ""
  var primaryAction = pending
    ? '<button type="button" class="brd-sidebar-btn" data-brd-user-retry>Retry connection</button>'
    : user
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
    (sharedAuthStatus === "unavailable"
      ? '<p role="status">Account connection interrupted. Your session has not been cleared.</p>'
      : "") +
    primaryAction +
    "</div>" +
    "</div>"
  )
}

export function mountSidebarStack(options) {
  var source = options || {}
  var sidebar =
    source.sidebar ||
    (typeof document !== "undefined"
      ? document.querySelector(source.sidebarSelector || ".right.sidebar")
      : null)
  if (!sidebar) return null

  var stackId = String(source.stackId || "brd-sidebar-stack").trim() || "brd-sidebar-stack"
  var existing = document.getElementById(stackId)
  var preserveExisting = source.preserveExisting === true
  if (existing && !preserveExisting && existing.parentNode)
    existing.parentNode.removeChild(existing)

  var stack = preserveExisting && existing ? existing : document.createElement("div")
  stack.id = stackId
  stack.className = "brd-sidebar-stack"

  var panels = Array.isArray(source.panels) ? source.panels : []
  var retainedPanels = []
  for (var i = 0; i < panels.length; i++) {
    var panel = panels[i] || {}
    var panelId = String(panel.id || "").trim()
    var section = panelId ? document.getElementById(panelId) : null
    if (!section || section.parentNode !== stack) {
      section = document.createElement("section")
      if (panelId) section.id = panelId
    }
    retainedPanels.push(section)
    section.className = "brd-sidebar-panel" + (panel.className ? " " + panel.className : "")

    var markup = String(panel.markup || "")
    if (!preserveExisting || section._brdSidebarMarkup !== markup) {
      var scrollPositions = []
      var preserveScrollSelector = String(panel.preserveScrollSelector || "").trim()
      if (preserveExisting && preserveScrollSelector) {
        var scrollElements = section.querySelectorAll(preserveScrollSelector)
        for (var scrollIndex = 0; scrollIndex < scrollElements.length; scrollIndex++) {
          var scrollElement = scrollElements[scrollIndex]
          var scrollGroup = scrollElement.closest("[data-icono-request-group]")
          scrollPositions.push({
            key: scrollGroup
              ? String(scrollGroup.getAttribute("data-icono-request-group") || scrollIndex)
              : String(scrollIndex),
            top: Number(scrollElement.scrollTop || 0),
          })
        }
      }
      section.innerHTML = markup
      section._brdSidebarMarkup = markup
      if (scrollPositions.length && preserveScrollSelector) {
        var nextScrollElements = section.querySelectorAll(preserveScrollSelector)
        for (var nextIndex = 0; nextIndex < nextScrollElements.length; nextIndex++) {
          var nextScrollElement = nextScrollElements[nextIndex]
          var nextScrollGroup = nextScrollElement.closest("[data-icono-request-group]")
          var nextKey = nextScrollGroup
            ? String(nextScrollGroup.getAttribute("data-icono-request-group") || nextIndex)
            : String(nextIndex)
          var saved = scrollPositions.find(function (position) {
            return position.key === nextKey
          })
          if (saved) nextScrollElement.scrollTop = saved.top
        }
      }
    }

    var expectedAtIndex = stack.children[i] || null
    if (expectedAtIndex !== section) stack.insertBefore(section, expectedAtIndex)
  }

  if (preserveExisting) {
    var mountedPanels = Array.prototype.slice.call(stack.children)
    for (var mountedIndex = 0; mountedIndex < mountedPanels.length; mountedIndex++) {
      var mountedPanel = mountedPanels[mountedIndex]
      if (retainedPanels.indexOf(mountedPanel) === -1) mountedPanel.remove()
    }
  }

  var insertBefore = null
  if (source.insertBeforeSelector) {
    insertBefore = sidebar.querySelector(source.insertBeforeSelector)
  } else {
    insertBefore = sidebar.querySelector(".page-tags-section")
  }
  if (!stack.parentNode) {
    if (insertBefore) {
      sidebar.insertBefore(stack, insertBefore)
    } else {
      sidebar.appendChild(stack)
    }
  }
  return stack
}

export function wireSharedUserPanel(root, options) {
  var retry = root?.querySelector("[data-brd-user-retry]")
  if (retry)
    retry.onclick = function () {
      if (options?.onAuthRetry) void options.onAuthRetry()
      else window.location.reload()
    }

  if (!root) return
  var source = options || {}
  var logoutButtons = root.querySelectorAll("[data-brd-user-logout]")
  for (var i = 0; i < logoutButtons.length; i++) {
    if (logoutButtons[i].getAttribute("data-brd-user-logout-wired") === "true") continue
    logoutButtons[i].setAttribute("data-brd-user-logout-wired", "true")
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
