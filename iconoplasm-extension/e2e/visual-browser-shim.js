;(function () {
  "use strict"

  const runtimeBase = new URL("/", location.href)
  const chromeShim = globalThis.chrome || {}
  Object.defineProperty(chromeShim, "runtime", {
    configurable: true,
    value: {
      getURL(path) {
        return new URL(String(path || ""), runtimeBase).href
      },
    },
  })
  Object.defineProperty(chromeShim, "storage", {
    configurable: true,
    value: {
      local: {
        async get() {
          return { iconoplasm_pdf_highlighting_enabled: true }
        },
      },
      onChanged: { addListener() {} },
    },
  })
  document.documentElement.dataset.visualShim = "ready"

  globalThis.IconoplasmPdfStreamBootstrap = Object.freeze({
    outcome: fetch("/paper.pdf")
      .then((response) => response.arrayBuffer())
      .then((buffer) => ({
        kind: "stream",
        bytes: new Uint8Array(buffer),
        streamInfo: { originalUrl: "https://example.test/PLOS_BRCA1_BRCA2_TP53.pdf" },
        async handBack() {},
      })),
  })
})()
