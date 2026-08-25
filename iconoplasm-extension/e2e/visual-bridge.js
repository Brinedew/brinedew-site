;(function () {
  "use strict"

  const symbols = ["BRCA1", "BRCA2", "TP53"]
  const runtime = globalThis.IconoplasmHighlightRuntime.createHighlightRuntime()
  const colors = { BRCA1: "#f19a38", BRCA2: "#4f9bd9", TP53: "#d76378" }
  const requestedMode = runtime.setMode(
    new URL(globalThis.location.href).searchParams.get("mode") || "pill-outline",
  )
  const pdfMode = requestedMode === "pill" ? "pill-outline" : requestedMode

  function findMatches(text) {
    const matches = []
    for (const symbol of symbols) {
      let index = String(text || "").indexOf(symbol)
      while (index >= 0) {
        matches.push({ index, length: symbol.length, symbol, text: symbol })
        index = String(text || "").indexOf(symbol, index + symbol.length)
      }
    }
    return matches.sort((left, right) => left.index - right.index)
  }

  globalThis.IconoplasmReaderBridge = Object.freeze({
    findMatches,
    getHighlightVisibility() {
      return "always"
    },
    getPdfHighlightPresentation(symbol) {
      return Object.freeze({
        color: colors[symbol] || "#6B6B78",
        mode: pdfMode,
        requestedMode,
        shape: runtime.getCanvasShape(pdfMode),
      })
    },
    replaceAnchorGroup() {},
    activateAnchor() {},
    leaveAnchor() {},
    closeCard() {},
  })
  document.documentElement.dataset.visualBridge = "ready"
})()
