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
  navigate,
}) {
  var state = {
    loaded: false,
    loading: false,
    request_error: false,
    unread_count: 0,
    ready_count: 0,
    unread_group_count: 0,
    ready_group_count: 0,
    open_count: 0,
    cancelled_count: 0,
    ready_requests: [],
    open_requests: [],
    invitations_loaded: false,
    invitations_loading: false,
    invitations_error: false,
    invitation_pending_count: 0,
    invitation_unread_count: 0,
    invitations: [],
    last_seen_notification_id: 0,
    active_group: "",
    active_group_touched: false,
    active_account_key: "",
  }
  var refreshTimer = 0
  var lifecycleWired = false
  var requestRefreshVersion = 0
  var invitationRefreshVersion = 0

  function currentAccountKey() {
    var user = getCurrentUser()
    if (!user) return ""
    return String(user.account_id || user.id || user.user_id || "").trim()
  }

  function invalidateInflight() {
    requestRefreshVersion += 1
    invitationRefreshVersion += 1
    state.loading = false
    state.invitations_loading = false
  }

  function ensureAccountContext() {
    var key = currentAccountKey()
    if (!key) return ""
    if (state.active_account_key && state.active_account_key !== key) reset()
    state.active_account_key = key
    return key
  }

  function chooseActiveGroup() {
    if (state.active_group_touched && state.active_group) return
    if (state.ready_requests.length) state.active_group = "ready"
    else if (state.open_requests.length) state.active_group = "waiting"
    else state.active_group = "ready"
  }

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
    invalidateInflight()
    state.loaded = false
    state.loading = false
    state.request_error = false
    state.unread_count = 0
    state.ready_count = 0
    state.unread_group_count = 0
    state.ready_group_count = 0
    state.open_count = 0
    state.cancelled_count = 0
    state.ready_requests = []
    state.open_requests = []
    state.invitations_loaded = false
    state.invitations_loading = false
    state.invitations_error = false
    state.invitation_pending_count = 0
    state.invitation_unread_count = 0
    state.invitations = []
    state.last_seen_notification_id = 0
    state.active_group = ""
    state.active_group_touched = false
    state.active_account_key = ""
  }

  function refreshRequests(options, accountKey) {
    var opts = options || {}
    if (!accountKey || state.loading) return Promise.resolve(null)
    state.loading = true
    state.request_error = false
    var version = ++requestRefreshVersion
    return fetchJSON("/api/iconoplasm/notifications?limit=50&fresh=" + Date.now(), {
      credentials: "include",
      cache: "no-store",
    })
      .then(async function (payload) {
        if (version !== requestRefreshVersion || currentAccountKey() !== accountKey) return null
        if (!payload || !payload.ok || !payload.authenticated) return null
        var readyRequests = Array.isArray(payload.ready_requests) ? payload.ready_requests : []
        var firstImage = readyRequests.find(function (item) {
          return item && item.image_url
        })
        if (firstImage && typeof ensurePortraitSource === "function") {
          await ensurePortraitSource(firstImage.image_url)
        }
        if (version !== requestRefreshVersion || currentAccountKey() !== accountKey) return null
        var previousHighWater = state.last_seen_notification_id
        var newestUnread = readyRequests.find(function (item) {
          return item && item.unread && Number(item.notification_id || 0) > previousHighWater
        })
        state.loaded = true
        state.unread_count = Math.max(0, Number(payload.unread_count || 0) || 0)
        state.ready_count = Math.max(0, Number(payload.ready_count || 0) || 0)
        var loadedReadyGroups = groupReadyRequests(readyRequests)
        state.unread_group_count = Math.max(
          0,
          Number(payload.unread_group_count || 0) ||
            loadedReadyGroups.filter(function (group) {
              return group.unread
            }).length,
        )
        state.ready_group_count = Math.max(
          Number(payload.ready_group_count || 0) || 0,
          loadedReadyGroups.length,
        )
        state.open_count = Math.max(0, Number(payload.open_count || 0) || 0)
        state.cancelled_count = Math.max(0, Number(payload.cancelled_count || 0) || 0)
        state.ready_requests = readyRequests
        state.open_requests = Array.isArray(payload.open_requests) ? payload.open_requests : []
        chooseActiveGroup()
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
        if (version === requestRefreshVersion && currentAccountKey() === accountKey) {
          state.loaded = true
          state.request_error = true
          renderSidebar()
        }
        return null
      })
      .finally(function () {
        if (version === requestRefreshVersion && currentAccountKey() === accountKey) {
          state.loading = false
        }
      })
  }

  function refreshInvitations(accountKey) {
    if (!accountKey || state.invitations_loading) return Promise.resolve(null)
    state.invitations_loading = true
    state.invitations_error = false
    var version = ++invitationRefreshVersion
    return fetchJSON("/api/iconoplasm/caretaker/invitations?limit=20&fresh=" + Date.now(), {
      credentials: "include",
      cache: "no-store",
    })
      .then(function (payload) {
        if (version !== invitationRefreshVersion || currentAccountKey() !== accountKey) return null
        if (!payload || !payload.ok) return null
        state.invitations_loaded = true
        state.invitation_pending_count = Math.max(0, Number(payload.pending_count || 0) || 0)
        state.invitation_unread_count = Math.max(0, Number(payload.unread_count || 0) || 0)
        state.invitations = Array.isArray(payload.invitations) ? payload.invitations : []
        chooseActiveGroup()
        renderSidebar()
        return payload
      })
      .catch(function () {
        if (version === invitationRefreshVersion && currentAccountKey() === accountKey) {
          state.invitations_loaded = true
          state.invitations_error = true
          renderSidebar()
        }
        return null
      })
      .finally(function () {
        if (version === invitationRefreshVersion && currentAccountKey() === accountKey) {
          state.invitations_loading = false
        }
      })
  }

  function refresh(options) {
    var accountKey = ensureAccountContext()
    if (!accountKey) return Promise.resolve(null)
    if (
      (!state.loaded && !state.loading) ||
      (!state.invitations_loaded && !state.invitations_loading)
    ) {
      renderSidebar()
    }
    return Promise.allSettled([
      refreshRequests(options, accountKey),
      refreshInvitations(accountKey),
    ])
  }

  function markRead(notificationIds, markAll, receipt) {
    var group = receipt || {}
    return fetchJSON("/api/iconoplasm/notifications/read", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        notification_ids: Array.isArray(notificationIds) ? notificationIds : [],
        fulfillment_publication_id: group.fulfillment_publication_id || "",
        gene_symbol: group.gene_symbol || "",
        all: markAll === true,
      }),
    }).then(function () {
      return refresh()
    })
  }

  function markCaretakerRead(assignmentId) {
    return fetchJSON("/api/iconoplasm/caretaker/invitations/read", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ caretaker_assignment_id: assignmentId }),
    }).then(function () {
      return refresh()
    })
  }

  function stop() {
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = 0
    invalidateInflight()
  }

  function scheduleOpenRequestRefresh() {
    stop()
    if (
      !getCurrentUser() ||
      (state.open_count <= 0 && state.invitation_pending_count <= 0) ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible"
    ) {
      return
    }
    refreshTimer = window.setTimeout(function () {
      refreshTimer = 0
      void refresh({ announce: true }).finally(scheduleOpenRequestRefresh)
    }, 60000)
  }

  function refreshForLifecycle(options) {
    stop()
    return refresh(options).finally(scheduleOpenRequestRefresh)
  }

  function start() {
    stop()
    if (!ensureAccountContext()) return
    void refreshForLifecycle()
    if (lifecycleWired) return
    lifecycleWired = true
    window.addEventListener("focus", function () {
      if (getCurrentUser()) void refreshForLifecycle({ announce: true })
    })
    document.addEventListener("visibilitychange", function () {
      if (getCurrentUser() && document.visibilityState === "visible") {
        void refreshForLifecycle({ announce: true })
      } else {
        stop()
      }
    })
  }

  function requestGroupSummaryMarkup(label, count, unread, groupName) {
    var safeCount = Math.max(0, Number(count || 0) || 0)
    var unreadNoun = " generation"
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
          (unread === 1 ? " unread" + unreadNoun : " unread" + unreadNoun + "s") +
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
      requestGroupSummaryMarkup(label, count, unread, name) +
      '<div class="icono-request-inbox__group-body">' +
      content +
      "</div></sl-details>"
    )
  }

  // ARCHITECTURE FENCE [IPD-006] — mirror Discord's durable receipt boundary.
  // A repeated gene is grouped only inside the same workstation publication;
  // adjacent rows and timestamps are never treated as generation identity.
  function groupReadyRequests(items) {
    var groups = []
    var byKey = Object.create(null)
    var requests = Array.isArray(items) ? items : []
    for (var index = 0; index < requests.length; index++) {
      var item = requests[index] || {}
      var publicationId = String(item.fulfillment_publication_id || "").trim()
      var symbol = String(item.gene_symbol || "")
        .trim()
        .toUpperCase()
      var notificationId = Number(item.notification_id || 0) || 0
      var requestId = Number(item.request_id || item.id || 0) || 0
      var key =
        publicationId && symbol
          ? publicationId + "\u001f" + symbol
          : "ungrouped:" + (notificationId || requestId || index)
      var group = byKey[key]
      if (!group) {
        group = {
          key: key,
          fulfillment_publication_id: publicationId,
          gene_symbol: symbol,
          gene_url: item.gene_url || "/",
          expected_size: 0,
          unread: false,
          items: [],
        }
        byKey[key] = group
        groups.push(group)
      }
      group.items.push(item)
      group.expected_size = Math.max(
        group.expected_size,
        Number(item.fulfillment_group_size || 0) || 0,
        group.items.length,
      )
      group.unread = group.unread || item.unread === true
    }
    return groups
  }

  function fulfilledReceiptMarkup(group) {
    var items = Array.isArray(group.items) ? group.items : []
    var previews = items.slice(0, 4)
    var total = Math.max(1, Number(group.expected_size || 0) || items.length)
    var notificationIds = items
      .map(function (item) {
        return Number(item.notification_id || 0) || 0
      })
      .filter(Boolean)
    var previewMarkup = ""
    for (var previewIndex = 0; previewIndex < previews.length; previewIndex++) {
      var item = previews[previewIndex] || {}
      var imageUrl =
        item.image_url && typeof resolvePortraitUrl === "function"
          ? resolvePortraitUrl(item.image_url)
          : item.image_url
      var hiddenCount = previewIndex === previews.length - 1 ? total - previews.length : 0
      previewMarkup +=
        '<span class="icono-request-inbox__preview" data-icono-request-id="' +
        escapeHtml(String(item.request_id || item.id || "")) +
        '" data-icono-request-notification-id="' +
        escapeHtml(String(item.notification_id || "")) +
        '" data-icono-asset-sha="' +
        escapeHtml(String(item.fulfilled_asset_sha256 || "")) +
        '" data-icono-candidate-image-id="' +
        escapeHtml(String(item.candidate_image_id || "")) +
        '">' +
        (imageUrl
          ? '<img class="icono-thumbnail-viewport-image" src="' +
            escapeHtml(imageUrl) +
            '" alt="" loading="lazy" decoding="async" width="72" height="96">'
          : '<span class="icono-request-inbox__photo-placeholder" aria-hidden="true"></span>') +
        (hiddenCount > 0
          ? '<span class="icono-request-inbox__preview-more" aria-hidden="true">+' +
            escapeHtml(String(hiddenCount)) +
            "</span>"
          : "") +
        "</span>"
    }
    return (
      '<a class="icono-request-inbox__item icono-request-inbox__receipt' +
      (group.unread ? " icono-request-inbox__item--unread" : "") +
      '" href="' +
      escapeHtml(group.gene_url || "/") +
      '" data-icono-request-receipt data-icono-request-publication-id="' +
      escapeHtml(group.fulfillment_publication_id || "") +
      '" data-icono-request-gene-symbol="' +
      escapeHtml(group.gene_symbol || "") +
      '" data-icono-request-notification-ids="' +
      escapeHtml(notificationIds.join(",")) +
      '"><span class="icono-request-inbox__receipt-head"><strong>' +
      escapeHtml(group.gene_symbol || "Gene") +
      '</strong><span class="icono-request-inbox__receipt-count" aria-label="' +
      escapeHtml(String(total)) +
      (total === 1 ? " image" : " images") +
      '">' +
      escapeHtml(String(total)) +
      "</span></span>" +
      '<span class="icono-request-inbox__previews icono-request-inbox__previews--' +
      escapeHtml(String(Math.max(1, previews.length))) +
      '" aria-hidden="true">' +
      previewMarkup +
      "</span></a>"
    )
  }

  function waitingRequestMarkup(item) {
    return (
      '<a class="icono-request-inbox__item icono-request-inbox__item--queued" href="' +
      escapeHtml(item.gene_url || "/") +
      '" data-icono-nav><span class="icono-request-inbox__queue-mark" aria-hidden="true"></span>' +
      '<span class="icono-request-inbox__copy"><strong>' +
      escapeHtml(item.gene_symbol || "Gene") +
      "</strong><small>" +
      escapeHtml(ageLabel(item.created_at)) +
      "</small></span></a>"
    )
  }

  function caretakerInvitationStatus(item) {
    if (item.notification_state === "pending") return "Invitation awaiting your response"
    if (item.assignment_status === "active") return "Caretaking active"
    if (item.assignment_status === "suspended") return "Caretaking suspended"
    return "Invitation resolved"
  }

  function caretakerInvitationMarkup(item) {
    var assignmentId = String(item.caretaker_assignment_id || "")
    var symbol = String(item.canonical_symbol || "Gene")
    var href = String(item.href || "/gene/" + encodeURIComponent(symbol))
    var unread = !item.read_at
    return (
      '<div class="icono-request-inbox__caretaker-item' +
      (unread ? " icono-request-inbox__item--unread" : "") +
      '"><a class="icono-request-inbox__item icono-request-inbox__item--caretaker" href="' +
      escapeHtml(href) +
      '" data-icono-caretaker-invitation data-icono-caretaker-assignment-id="' +
      escapeHtml(assignmentId) +
      '" data-icono-caretaker-gene-id="' +
      escapeHtml(String(item.gene_id || "")) +
      '"><span class="icono-request-inbox__caretaker-mark" aria-hidden="true">C</span>' +
      '<span class="icono-request-inbox__copy"><strong>' +
      escapeHtml(symbol) +
      "</strong><small>" +
      escapeHtml(caretakerInvitationStatus(item)) +
      "</small></span></a>" +
      (unread
        ? '<button type="button" class="icono-request-inbox__caretaker-read" data-icono-caretaker-mark-read="' +
          escapeHtml(assignmentId) +
          '">Mark read</button>'
        : "") +
      "</div>"
    )
  }

  function panelMarkup() {
    if (!getCurrentUser()) return ""
    if (!state.loaded && state.loading) {
      return (
        '<div class="icono-request-inbox" aria-busy="true">' +
        '<div class="icono-request-inbox__head"><span>Inbox</span>' +
        '<span class="icono-request-inbox__loading">Checking…</span></div></div>'
      )
    }
    var readyRequests = Array.isArray(state.ready_requests) ? state.ready_requests : []
    var readyGroups = groupReadyRequests(readyRequests)
    var openRequests = Array.isArray(state.open_requests) ? state.open_requests : []
    var unread = Math.max(0, Number(state.unread_count || 0) || 0)
    var unreadGroupCount = Math.max(0, Number(state.unread_group_count || 0) || 0)
    var readyGroupCount = Math.max(readyGroups.length, Number(state.ready_group_count || 0) || 0)
    var openCount = Math.max(0, Number(state.open_count || 0) || 0)
    var cancelledCount = Math.max(0, Number(state.cancelled_count || 0) || 0)
    var html =
      '<div class="icono-request-inbox">' +
      '<div class="icono-request-inbox__head"><span>Inbox</span></div>' +
      '<div class="icono-request-inbox__groups">'

    var readyContent = unread
      ? '<div class="icono-request-inbox__group-actions"><button type="button" data-icono-request-inbox-read-all>Mark all read</button></div>'
      : ""
    for (var i = 0; i < readyGroups.length; i++) {
      readyContent += fulfilledReceiptMarkup(readyGroups[i] || {})
    }
    if (state.request_error && !readyRequests.length) {
      readyContent +=
        '<div class="icono-request-inbox__empty"><strong>Requests unavailable.</strong>' +
        "Try again when this panel refreshes.</div>"
    } else if (state.loading && !state.loaded) {
      readyContent += '<div class="icono-request-inbox__empty">Checking requests.</div>'
    } else if (!readyRequests.length) {
      readyContent +=
        '<div class="icono-request-inbox__empty"><strong>Nothing ready yet.</strong>' +
        "Finished requests will stay here.</div>"
    } else if (readyGroupCount > readyGroups.length) {
      readyContent +=
        '<div class="icono-request-inbox__limit-note">' +
        escapeHtml(String(readyGroups.length)) +
        " of " +
        escapeHtml(String(readyGroupCount)) +
        " shown.</div>"
    }

    var waitingContent = ""
    for (var j = 0; j < openRequests.length; j++) {
      waitingContent += waitingRequestMarkup(openRequests[j] || {})
    }
    if (state.request_error && !openRequests.length) {
      waitingContent +=
        '<div class="icono-request-inbox__empty"><strong>Requests unavailable.</strong>' +
        "Try again when this panel refreshes.</div>"
    } else if (state.loading && !state.loaded) {
      waitingContent += '<div class="icono-request-inbox__empty">Checking requests.</div>'
    } else if (!openRequests.length) {
      waitingContent +=
        '<div class="icono-request-inbox__empty"><strong>Nothing waiting.</strong>' +
        "New requests appear here until they are ready.</div>"
    } else if (openCount > openRequests.length) {
      waitingContent +=
        '<div class="icono-request-inbox__limit-note">' +
        escapeHtml(String(openRequests.length)) +
        " of " +
        escapeHtml(String(openCount)) +
        " shown.</div>"
    }
    html += requestGroupMarkup("ready", "Ready", readyGroupCount, unreadGroupCount, readyContent)
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

  function caretakerPanelMarkup() {
    if (!getCurrentUser()) return ""
    var invitations = Array.isArray(state.invitations) ? state.invitations : []
    var pending = Math.max(0, Number(state.invitation_pending_count || 0) || 0)
    var unread = Math.max(0, Number(state.invitation_unread_count || 0) || 0)
    var content =
      '<div class="icono-request-inbox__caretaker-summary"><strong>' +
      escapeHtml(String(pending)) +
      " pending</strong><span>" +
      escapeHtml(String(unread)) +
      " unread</span></div>"
    for (var index = 0; index < invitations.length; index++) {
      content += caretakerInvitationMarkup(invitations[index] || {})
    }
    if (state.invitations_error && !invitations.length) {
      content +=
        '<div class="icono-request-inbox__empty"><strong>Invitations unavailable.</strong>' +
        "Try again when this panel refreshes.</div>"
    } else if (state.invitations_loading && !state.invitations_loaded) {
      content += '<div class="icono-request-inbox__empty">Checking invitations.</div>'
    } else if (!invitations.length) {
      content +=
        '<div class="icono-request-inbox__empty"><strong>No caretaker invitations.</strong>' +
        "You can claim an available gene from its toolbar.</div>"
    }
    return (
      '<div class="brd-sidebar-section icono-caretaker-launcher">' +
      '<div class="brd-sidebar-panel-title">Caretaking</div>' +
      '<div class="icono-request-inbox__caretaker-panel">' +
      content +
      "</div></div>"
    )
  }

  function wire(stack) {
    if (!stack) return
    var readAll = stack.querySelector("[data-icono-request-inbox-read-all]")
    if (readAll && !readAll._iconoRequestInboxWired) {
      readAll._iconoRequestInboxWired = true
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
        if (group._iconoRequestInboxWired) return
        group._iconoRequestInboxWired = true
        var groupName = group.getAttribute("data-icono-request-group") || ""
        group.addEventListener("sl-show", function () {
          state.active_group = groupName
          state.active_group_touched = true
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
    var links = stack.querySelectorAll("[data-icono-request-receipt]")
    for (var i = 0; i < links.length; i++) {
      ;(function (link) {
        if (link._iconoRequestInboxWired) return
        link._iconoRequestInboxWired = true
        link.addEventListener("click", function (event) {
          var ids = String(link.getAttribute("data-icono-request-notification-ids") || "")
            .split(",")
            .map(function (value) {
              return Number.parseInt(value, 10) || 0
            })
            .filter(Boolean)
          var publicationId = link.getAttribute("data-icono-request-publication-id") || ""
          var symbol = link.getAttribute("data-icono-request-gene-symbol") || ""
          if (!ids.length && !(publicationId && symbol)) return
          event.preventDefault()
          var href = link.getAttribute("href") || "/"
          if (typeof navigate === "function") {
            navigate(href, link)
          } else {
            window.location.assign(href)
          }
          void markRead(ids, false, {
            fulfillment_publication_id: publicationId,
            gene_symbol: symbol,
          }).catch(function () {})
        })
      })(links[i])
    }
    var caretakerLinks = stack.querySelectorAll("[data-icono-caretaker-invitation]")
    for (var caretakerIndex = 0; caretakerIndex < caretakerLinks.length; caretakerIndex++) {
      ;(function (link) {
        if (link._iconoCaretakerInvitationWired) return
        link._iconoCaretakerInvitationWired = true
        link.addEventListener("click", function (event) {
          var assignmentId = link.getAttribute("data-icono-caretaker-assignment-id") || ""
          if (!assignmentId) return
          event.preventDefault()
          var href = link.getAttribute("href") || "/"
          if (typeof navigate === "function") navigate(href, link)
          else window.location.assign(href)
          void markCaretakerRead(assignmentId).catch(function () {})
        })
      })(caretakerLinks[caretakerIndex])
    }
    var caretakerReadButtons = stack.querySelectorAll("[data-icono-caretaker-mark-read]")
    for (var readIndex = 0; readIndex < caretakerReadButtons.length; readIndex++) {
      ;(function (button) {
        if (button._iconoCaretakerReadWired) return
        button._iconoCaretakerReadWired = true
        button.addEventListener("click", function () {
          var assignmentId = button.getAttribute("data-icono-caretaker-mark-read") || ""
          if (!assignmentId) return
          button.disabled = true
          void markCaretakerRead(assignmentId).finally(function () {
            button.disabled = false
          })
        })
      })(caretakerReadButtons[readIndex])
    }
  }

  return {
    caretakerPanelMarkup,
    panelMarkup,
    refresh: refreshForLifecycle,
    reset,
    start,
    stop,
    wire,
  }
}
