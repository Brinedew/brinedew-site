// Server-backed request inbox for Iconoplasm.
//
// This component owns its refresh lifecycle, durable read acknowledgements,
// rendering, and interaction wiring. app.js supplies only the shared API,
// current-user, sidebar-render, and escaping boundaries.

export function createRequestInbox({ fetchJSON, getCurrentUser, renderSidebar, escapeHtml }) {
  var state = {
    loaded: false,
    loading: false,
    unread_count: 0,
    open_count: 0,
    open_requests: [],
    notifications: [],
    last_seen_notification_id: 0,
  }
  var refreshTimer = 0
  var lifecycleWired = false

  function ageLabel(createdAt) {
    if (!createdAt) return "recently"
    var timestamp = String(createdAt).trim().replace(" ", "T")
    if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(timestamp)) timestamp += "Z"
    var parsed = new Date(timestamp).getTime()
    if (!Number.isFinite(parsed)) return "recently"
    var seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
    if (seconds < 60) return "just now"
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago"
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago"
    if (seconds < 86400 * 30) return Math.floor(seconds / 86400) + "d ago"
    return Math.floor(seconds / (86400 * 30)) + "mo ago"
  }

  function showFulfilledNotice(notification) {
    if (!notification || !notification.gene_symbol) return
    var existing = document.getElementById("icono-request-ready-notice")
    if (existing) existing.remove()
    var notice = document.createElement("a")
    notice.id = "icono-request-ready-notice"
    notice.className = "icono-request-ready-notice"
    notice.href = notification.gene_url || "/"
    notice.setAttribute("role", "status")
    notice.setAttribute("aria-live", "polite")
    notice.innerHTML =
      '<span class="icono-request-ready-notice__stamp">Ready</span>' +
      "<span><strong>" +
      escapeHtml(notification.gene_symbol) +
      "</strong><small>" +
      escapeHtml(notification.requested_emulsion_label || "Your requested blot") +
      "</small></span>"
    document.body.appendChild(notice)
    window.setTimeout(function () {
      notice.classList.add("icono-request-ready-notice--visible")
    }, 20)
    window.setTimeout(function () {
      notice.classList.remove("icono-request-ready-notice--visible")
      window.setTimeout(function () {
        if (notice.parentNode) notice.remove()
      }, 220)
    }, 9000)
  }

  function reset() {
    state.loaded = false
    state.loading = false
    state.unread_count = 0
    state.open_count = 0
    state.open_requests = []
    state.notifications = []
    state.last_seen_notification_id = 0
  }

  function refresh(options) {
    var opts = options || {}
    if (!getCurrentUser() || state.loading) return Promise.resolve(null)
    state.loading = true
    if (!state.loaded) renderSidebar()
    return fetchJSON("/api/iconoplasm/notifications?limit=25&fresh=" + Date.now(), {
      credentials: "include",
      cache: "no-store",
    })
      .then(function (payload) {
        if (!payload || !payload.ok || !payload.authenticated) return null
        var notifications = Array.isArray(payload.notifications) ? payload.notifications : []
        var previousHighWater = state.last_seen_notification_id
        var newestUnread = notifications.find(function (item) {
          return item && item.unread && Number(item.id || 0) > previousHighWater
        })
        state.loaded = true
        state.unread_count = Math.max(0, Number(payload.unread_count || 0) || 0)
        state.open_count = Math.max(0, Number(payload.open_count || 0) || 0)
        state.open_requests = Array.isArray(payload.open_requests) ? payload.open_requests : []
        state.notifications = notifications
        state.last_seen_notification_id = notifications.reduce(function (highest, item) {
          return Math.max(highest, Number((item && item.id) || 0) || 0)
        }, previousHighWater)
        renderSidebar()
        if (opts.announce && previousHighWater > 0 && newestUnread) {
          showFulfilledNotice(newestUnread)
        }
        return payload
      })
      .catch(function () {
        return null
      })
      .finally(function () {
        state.loading = false
      })
  }

  function markRead(notificationIds, markAll) {
    return fetchJSON("/api/iconoplasm/notifications/read", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        notification_ids: Array.isArray(notificationIds) ? notificationIds : [],
        all: markAll === true,
      }),
    }).then(function () {
      return refresh()
    })
  }

  function stop() {
    if (refreshTimer) window.clearInterval(refreshTimer)
    refreshTimer = 0
  }

  function start() {
    stop()
    if (!getCurrentUser()) return
    void refresh()
    refreshTimer = window.setInterval(function () {
      if (document.visibilityState === "visible") void refresh({ announce: true })
    }, 60000)
    if (lifecycleWired) return
    lifecycleWired = true
    window.addEventListener("focus", function () {
      if (getCurrentUser()) void refresh({ announce: true })
    })
    document.addEventListener("visibilitychange", function () {
      if (getCurrentUser() && document.visibilityState === "visible") {
        void refresh({ announce: true })
      }
    })
  }

  function panelMarkup() {
    if (!getCurrentUser()) return ""
    if (state.loading && !state.loaded) {
      return (
        '<div class="icono-request-inbox" aria-busy="true">' +
        '<div class="icono-request-inbox__head"><span>Request inbox</span>' +
        '<span class="icono-request-inbox__loading">Checking…</span></div></div>'
      )
    }
    var notifications = Array.isArray(state.notifications) ? state.notifications.slice(0, 8) : []
    var openRequests = Array.isArray(state.open_requests) ? state.open_requests.slice(0, 4) : []
    var unread = Math.max(0, Number(state.unread_count || 0) || 0)
    var openCount = Math.max(0, Number(state.open_count || 0) || 0)
    var html =
      '<div class="icono-request-inbox">' +
      '<div class="icono-request-inbox__head"><span>Request inbox</span>' +
      (unread
        ? '<span class="icono-request-inbox__unread" aria-label="' +
          escapeHtml(String(unread)) +
          ' unread">' +
          escapeHtml(String(unread)) +
          " new</span>"
        : '<span class="icono-request-inbox__quiet">Up to date</span>') +
      "</div>" +
      '<div class="icono-request-inbox__summary">' +
      escapeHtml(
        openCount
          ? openCount + (openCount === 1 ? " request waiting" : " requests waiting")
          : "Nothing waiting",
      ) +
      (unread
        ? '<button type="button" data-icono-request-inbox-read-all>Mark all read</button>'
        : "") +
      "</div>"

    if (!notifications.length && !openRequests.length) {
      html +=
        '<div class="icono-request-inbox__empty"><strong>No requests yet.</strong>' +
        "Ask for a new blot on any gene page; its result will appear here.</div>"
    }

    for (var i = 0; i < notifications.length; i++) {
      var item = notifications[i] || {}
      html +=
        '<a class="icono-request-inbox__item' +
        (item.unread ? " icono-request-inbox__item--unread" : "") +
        '" href="' +
        escapeHtml(item.gene_url || "/") +
        '" data-icono-request-notification-id="' +
        escapeHtml(String(item.id || "")) +
        '">' +
        (item.image_url
          ? '<img src="' +
            escapeHtml(item.image_url) +
            '" alt="" loading="lazy" decoding="async" width="44" height="56">'
          : '<span class="icono-request-inbox__photo-placeholder" aria-hidden="true"></span>') +
        '<span class="icono-request-inbox__copy"><span class="icono-request-inbox__line"><strong>' +
        escapeHtml(item.gene_symbol || "Gene") +
        "</strong><em>ready</em></span>" +
        '<span class="icono-request-inbox__emulsion">' +
        escapeHtml(item.requested_emulsion_label || "Requested blot") +
        "</span><small>Fulfilled " +
        escapeHtml(ageLabel(item.created_at)) +
        "</small></span></a>"
    }

    for (var j = 0; j < openRequests.length; j++) {
      var queued = openRequests[j] || {}
      html +=
        '<a class="icono-request-inbox__item icono-request-inbox__item--queued" href="' +
        escapeHtml(queued.gene_url || "/") +
        '" data-icono-nav><span class="icono-request-inbox__queue-mark" aria-hidden="true"></span>' +
        '<span class="icono-request-inbox__copy"><span class="icono-request-inbox__line"><strong>' +
        escapeHtml(queued.gene_symbol || "Gene") +
        "</strong><em>queued</em></span>" +
        '<span class="icono-request-inbox__emulsion">' +
        escapeHtml(queued.requested_emulsion_label || "Random default") +
        "</span><small>Requested " +
        escapeHtml(ageLabel(queued.created_at)) +
        "</small></span></a>"
    }
    return html + "</div>"
  }

  function wire(stack) {
    if (!stack) return
    var readAll = stack.querySelector("[data-icono-request-inbox-read-all]")
    if (readAll) {
      readAll.addEventListener("click", function () {
        readAll.disabled = true
        void markRead([], true).finally(function () {
          readAll.disabled = false
        })
      })
    }
    var links = stack.querySelectorAll("[data-icono-request-notification-id]")
    for (var i = 0; i < links.length; i++) {
      ;(function (link) {
        link.addEventListener("click", function (event) {
          var id = Number.parseInt(
            link.getAttribute("data-icono-request-notification-id") || "0",
            10,
          )
          if (!id) return
          event.preventDefault()
          var href = link.getAttribute("href") || "/"
          void markRead([id], false)
            .catch(function () {})
            .finally(function () {
              window.location.assign(href)
            })
        })
      })(links[i])
    }
  }

  return { panelMarkup, refresh, reset, start, stop, wire }
}
