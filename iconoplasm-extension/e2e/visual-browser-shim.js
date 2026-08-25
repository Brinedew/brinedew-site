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

  const fixture = new URL(location.href).searchParams.get("fixture")
  const fixtureOutcome =
    fixture === "empty"
      ? Promise.resolve({ kind: "manual" })
      : fixture === "error"
        ? Promise.resolve({ kind: "aborted" })
        : null

  globalThis.IconoplasmPdfStreamBootstrap = Object.freeze({
    outcome:
      fixtureOutcome ||
      new Promise((resolve, reject) => {
        const fixtureDelay = Number(new URL(location.href).searchParams.get("loadDelay") || 0)
        fetch("/paper.pdf")
          .then((response) => response.arrayBuffer())
          .then((buffer) => {
            const finish = () =>
              resolve({
                kind: "stream",
                bytes: new Uint8Array(buffer),
                streamInfo: {
                  originalUrl: "https://example.test/PLOS_BRCA1_BRCA2_TP53.pdf",
                },
                async handBack() {},
              })
            if (fixtureDelay > 0) window.setTimeout(finish, fixtureDelay)
            else finish()
          }, reject)
      }),
  })
})()
