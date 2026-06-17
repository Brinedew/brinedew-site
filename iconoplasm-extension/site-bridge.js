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

  announcePresence()
})()
