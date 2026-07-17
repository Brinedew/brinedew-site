// Server-backed request inbox for Iconoplasm.
//
// This component owns its refresh lifecycle, durable read acknowledgements,
// rendering, and interaction wiring. app.js supplies only the shared API,
// current-user, sidebar-render, and escaping boundaries.

export function createRequestInbox({
  fetchJSON,
  getCurrentUser,
  renderSidebar,
  escapeHtml,
  ensurePortraitSource,
  resolvePortraitUrl,
}) {
  var state = {
    loaded: false,
    loading: false,
    unread_count: 0,
    ready_count: 0,
    open_count: 0,
    cancelled_count: 0,
    ready_requests: [],
    open_requests: [],
    last_seen_notification_id: 0,
    active_group: "ready",
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
    state.ready_count = 0
    state.open_count = 0
    state.cancelled_count = 0
    state.ready_requests = []
    state.open_requests = []
    state.last_seen_notification_id = 0
    state.active_group = "ready"
  }

  function refresh(options) {
    var opts = options || {}
    if (!getCurrentUser() || state.loading) return Promise.resolve(null)
    state.loading = true
    if (!state.loaded) renderSidebar()
    return fetchJSON("/api/iconoplasm/notifications?limit=50&fresh=" + Date.now(), {
      credentials: "include",
      cache: "no-store",
    })
      .then(async function (payload) {
        if (!payload || !payload.ok || !payload.authenticated) return null
        var readyRequests = Array.isArray(payload.ready_requests) ? payload.ready_requests : []
        var firstImage = readyRequests.find(function (item) {
          return item && item.image_url
        })
        if (firstImage && typeof ensurePortraitSource === "function") {
          await ensurePortraitSource(firstImage.image_url)
        }
        var firstLoad = !state.loaded
        var previousHighWater = state.last_seen_notification_id
        var newestUnread = readyRequests.find(function (item) {
          return item && item.unread && Number(item.notification_id || 0) > previousHighWater
        })
        state.loaded = true
        state.unread_count = Math.max(0, Number(payload.unread_count || 0) || 0)
        state.ready_count = Math.max(0, Number(payload.ready_count || 0) || 0)
        state.open_count = Math.max(0, Number(payload.open_count || 0) || 0)
        state.cancelled_count = Math.max(0, Number(payload.cancelled_count || 0) || 0)
        state.ready_requests = readyRequests
        state.open_requests = Array.isArray(payload.open_requests) ? payload.open_requests : []
        if (firstLoad) {
          state.active_group = readyRequests.length
            ? "ready"
            : state.open_requests.length
              ? "waiting"
              : "ready"
        }
        state.last_seen_notification_id = readyRequests.reduce(function (highest, item) {
          return Math.max(highest, Number((item && item.notification_id) || 0) || 0)
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

  function requestGroupSummaryMarkup(label, count, unread) {
    var safeCount = Math.max(0, Number(count || 0) || 0)
    return (
      '<span slot="summary" class="icono-request-inbox__group-summary">' +
      '<span class="icono-request-inbox__group-label">' +
      escapeHtml(label) +
      "</span>" +
      '<span class="icono-request-inbox__group-meta">' +
      (unread
        ? '<sl-badge class="icono-request-inbox__unread-dot" variant="danger" pill aria-hidden="true"></sl-badge>' +
          '<span class="sr-only">' +
          escapeHtml(String(unread)) +
          (unread === 1 ? " unread notification" : " unread notifications") +
          "</span>"
        : "") +
      '<span class="icono-request-inbox__group-count">' +
      escapeHtml(String(safeCount)) +
      "</span></span></span>"
    )
  }

  function requestGroupMarkup(name, label, count, unread, content) {
    return (
      '<sl-details class="icono-request-inbox__group" data-icono-request-group="' +
      escapeHtml(name) +
      '"' +
      (state.active_group === name ? " open" : "") +
      ">" +
      requestGroupSummaryMarkup(label, count, unread) +
      '<div class="icono-request-inbox__group-body">' +
      content +
      "</div></sl-details>"
    )
  }

  function fulfilledRequestMarkup(item) {
    var imageUrl =
      item.image_url && typeof resolvePortraitUrl === "function"
        ? resolvePortraitUrl(item.image_url)
        : item.image_url
    return (
      '<a class="icono-request-inbox__item' +
      (item.unread ? " icono-request-inbox__item--unread" : "") +
      '" href="' +
      escapeHtml(item.gene_url || "/") +
      '" data-icono-request-id="' +
      escapeHtml(String(item.request_id || item.id || "")) +
      '"' +
      (item.notification_id
        ? ' data-icono-request-notification-id="' + escapeHtml(String(item.notification_id)) + '"'
        : "") +
      '">' +
      (imageUrl
        ? '<img src="' +
          escapeHtml(imageUrl) +
          '" alt="" loading="lazy" decoding="async" width="44" height="56">'
        : '<span class="icono-request-inbox__photo-placeholder" aria-hidden="true"></span>') +
      '<span class="icono-request-inbox__copy"><span class="icono-request-inbox__line"><strong>' +
      escapeHtml(item.gene_symbol || "Gene") +
      "</strong><em>ready</em></span>" +
      '<span class="icono-request-inbox__emulsion">' +
      escapeHtml(item.requested_emulsion_label || "Requested blot") +
      "</span><small>Ready " +
      escapeHtml(ageLabel(item.fulfilled_at || item.created_at)) +
      "</small></span></a>"
    )
  }

  function waitingRequestMarkup(item) {
    return (
      '<a class="icono-request-inbox__item icono-request-inbox__item--queued" href="' +
      escapeHtml(item.gene_url || "/") +
      '" data-icono-nav><span class="icono-request-inbox__queue-mark" aria-hidden="true"></span>' +
      '<span class="icono-request-inbox__copy"><span class="icono-request-inbox__line"><strong>' +
      escapeHtml(item.gene_symbol || "Gene") +
      "</strong><em>queued</em></span>" +
      '<span class="icono-request-inbox__emulsion">' +
      escapeHtml(item.requested_emulsion_label || "Random default") +
      "</span><small>Requested " +
      escapeHtml(ageLabel(item.created_at)) +
      "</small></span></a>"
    )
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
    var readyRequests = Array.isArray(state.ready_requests) ? state.ready_requests : []
    var openRequests = Array.isArray(state.open_requests) ? state.open_requests : []
    var unread = Math.max(0, Number(state.unread_count || 0) || 0)
    var readyCount = Math.max(0, Number(state.ready_count || 0) || 0)
    var openCount = Math.max(0, Number(state.open_count || 0) || 0)
    var cancelledCount = Math.max(0, Number(state.cancelled_count || 0) || 0)
    var html =
      '<div class="icono-request-inbox">' +
      '<div class="icono-request-inbox__head"><span>Request inbox</span></div>' +
      '<div class="icono-request-inbox__groups">'

    var readyContent = unread
      ? '<div class="icono-request-inbox__group-actions"><button type="button" data-icono-request-inbox-read-all>Mark all read</button></div>'
      : ""
    for (var i = 0; i < readyRequests.length; i++) {
      readyContent += fulfilledRequestMarkup(readyRequests[i] || {})
    }
    if (!readyRequests.length) {
      readyContent +=
        '<div class="icono-request-inbox__empty"><strong>Nothing ready yet.</strong>' +
        "Finished requests will stay here.</div>"
    } else if (readyCount > readyRequests.length) {
      readyContent +=
        '<div class="icono-request-inbox__limit-note">Showing the newest ' +
        escapeHtml(String(readyRequests.length)) +
        " of " +
        escapeHtml(String(readyCount)) +
        " ready requests.</div>"
    }

    var waitingContent = ""
    for (var j = 0; j < openRequests.length; j++) {
      waitingContent += waitingRequestMarkup(openRequests[j] || {})
    }
    if (!openRequests.length) {
      waitingContent +=
        '<div class="icono-request-inbox__empty"><strong>Nothing waiting.</strong>' +
        "New requests appear here until they are ready.</div>"
    } else if (openCount > openRequests.length) {
      waitingContent +=
        '<div class="icono-request-inbox__limit-note">Showing the oldest ' +
        escapeHtml(String(openRequests.length)) +
        " of " +
        escapeHtml(String(openCount)) +
        " waiting requests.</div>"
    }
    html += requestGroupMarkup("ready", "Ready", readyCount, unread, readyContent)
    html += requestGroupMarkup("waiting", "Waiting", openCount, 0, waitingContent)
    html += "</div>"
    if (cancelledCount) {
      html +=
        '<div class="icono-request-inbox__cancelled-count">Cancelled <span>' +
        escapeHtml(String(cancelledCount)) +
        "</span></div>"
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
    var groups = stack.querySelectorAll("[data-icono-request-group]")
    for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      ;(function (group) {
        var groupName = group.getAttribute("data-icono-request-group") || ""
        group.addEventListener("sl-show", function () {
          state.active_group = groupName
          for (var otherIndex = 0; otherIndex < groups.length; otherIndex++) {
            var other = groups[otherIndex]
            if (other === group) continue
            if (typeof other.hide === "function") {
              void other.hide()
            } else {
              other.removeAttribute("open")
            }
          }
        })
        group.addEventListener("sl-hide", function () {
          if (state.active_group === groupName) state.active_group = ""
        })
      })(groups[groupIndex])
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
