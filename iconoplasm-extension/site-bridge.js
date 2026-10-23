;(function () {
  "use strict"

  var PRESENCE_EVENT = "iconoplasm-extension-presence"
  var PRESENCE_PING_EVENT = "iconoplasm-extension-presence-ping"
  var root = document.documentElement
  var version = ""

  try {
    version = String(
      (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "",
    ).trim()
  } catch (_error) {
    version = ""
  }

  function markInstalled() {
    if (!root) return
    root.setAttribute("data-iconoplasm-extension-installed", "true")
    if (version) {
      root.setAttribute("data-iconoplasm-extension-version", version)
    }
  }

  function announcePresence() {
    markInstalled()
    window.dispatchEvent(
      new CustomEvent(PRESENCE_EVENT, {
        detail: {
          version: version,
        },
      }),
    )
  }

  window.addEventListener(PRESENCE_PING_EVENT, function () {
    announcePresence()
  })

  // Genes a signed-out reader hovered on other websites. The Archive counts
  // them on its guest card and, once the reader logs in, merges them itself, so
  // they fill the Archive before the add-on next runs on another page. Details
  // cross the page boundary as JSON strings: Firefox hides a content script's
  // objects from page scripts.
  var GUEST_DISCOVERIES_KEY = "iconoplasm_guest_discoveries_v1" // content-settings.js storageKeys.guestDiscoveries
  var GUEST_DISCOVERIES_EVENT = "iconoplasm-extension-guest-discoveries"
  var GUEST_DISCOVERIES_REQUEST_EVENT = "iconoplasm-extension-guest-discoveries-request"
  var GUEST_DISCOVERIES_MERGED_EVENT = "iconoplasm-extension-guest-discoveries-merged"

  function storedGuestDiscoveries(callback) {
    try {
      chrome.storage.local.get([GUEST_DISCOVERIES_KEY], function (result) {
        var symbols = result && result[GUEST_DISCOVERIES_KEY]
        callback(Array.isArray(symbols) ? symbols : [])
      })
    } catch (_error) {
      callback([])
    }
  }

  window.addEventListener(GUEST_DISCOVERIES_REQUEST_EVENT, function () {
    storedGuestDiscoveries(function (symbols) {
      window.dispatchEvent(
        new CustomEvent(GUEST_DISCOVERIES_EVENT, { detail: JSON.stringify(symbols) }),
      )
    })
  })

  window.addEventListener(GUEST_DISCOVERIES_MERGED_EVENT, function (event) {
    var merged
    try {
      merged = JSON.parse(String((event && event.detail) || "[]"))
    } catch (_error) {
      return
    }
    if (!Array.isArray(merged) || !merged.length) return
    var removals = new Set(merged)
    storedGuestDiscoveries(function (symbols) {
      var kept = symbols.filter(function (symbol) {
        return !removals.has(symbol)
      })
      if (kept.length === symbols.length) return
      var update = {}
      update[GUEST_DISCOVERIES_KEY] = kept
      try {
        chrome.storage.local.set(update)
      } catch (_error) {
        // The add-on's own merge on the next page converges whatever stays.
      }
    })
  })

  announcePresence()
})()
