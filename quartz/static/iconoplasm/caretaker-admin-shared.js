;(function caretakerAdminSharedModule(global) {
  "use strict"

  var API_ROOT = "/api/iconoplasm/admin/caretakers"
  var REQUEST_TIMEOUT_MS = 12_000
  var SEARCH_DELAY_MS = 220

  function createState() {
    return {
      registry: [],
      nextCursor: "",
      selectedAssignmentId: "",
      registryRequestSequence: 0,
    }
  }

  function createContext() {
    return {
      mounted: false,
      root: null,
      refs: {},
      eventController: null,
      requestControllers: new Set(),
      timers: new Set(),
      state: createState(),
    }
  }

  function query(context, selector) {
    return context.root ? context.root.querySelector(selector) : null
  }

  function collectRefs(context) {
    context.refs = {
      status: query(context, "[data-caretaker-status]"),
      refresh: query(context, "[data-caretaker-refresh]"),
      registryQuery: query(context, "[data-caretaker-registry-query]"),
      registryStatus: query(context, "[data-caretaker-registry-status]"),
      registryBody: query(context, "[data-caretaker-registry-body]"),
      registryMore: query(context, "[data-caretaker-registry-more]"),
      detail: query(context, "[data-caretaker-detail]"),
    }
  }

  function element(tag, className, text) {
    var value = document.createElement(tag)
    if (className) value.className = className
    if (text !== undefined && text !== null) value.textContent = String(text)
    return value
  }

  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      var child = arguments[index]
      if (child) parent.appendChild(child)
    }
    return parent
  }

  function replace(parent) {
    if (!parent) return
    var children = Array.prototype.slice.call(arguments, 1)
    parent.replaceChildren.apply(parent, children)
  }

  function setStatus(context, message, tone) {
    if (!context.refs.status) return
    context.refs.status.textContent = String(message || "")
    if (tone) context.refs.status.dataset.tone = tone
    else delete context.refs.status.dataset.tone
  }

  function readableError(error) {
    if (!error) return "The caretaker authority did not respond."
    return String(error.message || error)
  }

  function AuthorityHttpError(message, status, payload) {
    this.name = "AuthorityHttpError"
    this.message = message
    this.status = status
    this.payload = payload
  }
  AuthorityHttpError.prototype = Object.create(Error.prototype)

  async function request(context, path, options) {
    var settings = options || {}
    var controller = new AbortController()
    var timedOut = false
    context.requestControllers.add(controller)
    var timeout = global.setTimeout(function abortTimedOutRequest() {
      timedOut = true
      controller.abort()
    }, settings.timeoutMs || REQUEST_TIMEOUT_MS)
    try {
      var headers = { Accept: "application/json" }
      var init = {
        method: settings.method || "GET",
        credentials: "include",
        headers: headers,
        signal: controller.signal,
      }
      if (settings.body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(settings.body)
      }
      var response = await global.fetch(API_ROOT + path, init)
      var payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok) {
        var detail =
          payload &&
          (payload.message ||
            payload.error_description ||
            (typeof payload.error === "object"
              ? payload.error.message || payload.error.code
              : payload.error))
        throw new AuthorityHttpError(
          typeof detail === "string" && detail.trim()
            ? detail.trim()
            : "Caretaker authority request failed (" + response.status + ").",
          response.status,
          payload,
        )
      }
      if (!payload || typeof payload !== "object") {
        throw new AuthorityHttpError("Caretaker authority returned an invalid response.", 502, null)
      }
      return payload
    } catch (error) {
      if (timedOut) throw new Error("Caretaker authority request timed out.")
      if (error && error.name === "AbortError" && !context.mounted) {
        throw new Error("Caretaker authority request was cancelled.")
      }
      throw error
    } finally {
      global.clearTimeout(timeout)
      context.requestControllers.delete(controller)
    }
  }

  function later(context, callback, delay) {
    var timer = global.setTimeout(function runScheduledCallback() {
      context.timers.delete(timer)
      if (context.mounted) callback()
    }, delay)
    context.timers.add(timer)
    return timer
  }

  function cancelTimer(context, timer) {
    if (!timer) return
    global.clearTimeout(timer)
    context.timers.delete(timer)
  }

  function formatDay(value) {
    if (!value) return ""
    var date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date)
  }

  function statusLabel(raw) {
    var labels = {
      pending_acceptance: "Pending acceptance",
      active: "Active",
      suspended: "Suspended",
      ended: "Ended",
      cancelled: "Cancelled",
      declined: "Declined",
      expired: "Expired",
    }
    return labels[String(raw || "")] || String(raw || "Unknown").replaceAll("_", " ")
  }

  var modules = global.IconoplasmCaretakerAdminModules || Object.create(null)
  modules.shared = Object.freeze({
    SEARCH_DELAY_MS: SEARCH_DELAY_MS,
    AuthorityHttpError: AuthorityHttpError,
    append: append,
    cancelTimer: cancelTimer,
    collectRefs: collectRefs,
    createContext: createContext,
    createState: createState,
    element: element,
    formatDay: formatDay,
    later: later,
    readableError: readableError,
    replace: replace,
    request: request,
    setStatus: setStatus,
    statusLabel: statusLabel,
  })
  global.IconoplasmCaretakerAdminModules = modules
})(window)
