;(function (root) {
  "use strict"

  const api = root.browser || root.chrome

  function redirectOwnedPdf() {
    const sourceId = document.documentElement?.dataset.iconoplasmGeckoPdfSource
    if (!sourceId) return
    void api.runtime.sendMessage({ type: "PDF_OPEN_OWNED_READER", sourceId })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", redirectOwnedPdf, { once: true })
  } else {
    redirectOwnedPdf()
  }
})(globalThis)
