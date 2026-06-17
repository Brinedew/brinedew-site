;(function (root) {
  "use strict"

  function createExtensionApiFetch(chromeApi) {
    const runtime = chromeApi && chromeApi.runtime
    if (!runtime || typeof runtime.sendMessage !== "function") {
      throw new Error("Iconoplasm content API bridge requires chrome.runtime.sendMessage")
    }

    return function extensionApiFetch(input, init = {}) {
      const url = typeof input === "string" ? input : String((input && input.url) || "")
      return new Promise((resolve, reject) => {
        try {
          runtime.sendMessage(
            {
              type: "ICONOPLASM_API_FETCH",
              url,
              method: String(init.method || "GET").toUpperCase(),
              headers: init.headers && typeof init.headers === "object" ? init.headers : {},
              body: typeof init.body === "string" ? init.body : undefined,
              credentials: init.credentials === "include" ? "include" : "same-origin",
            },
            (result) => {
              if (runtime.lastError) {
                reject(new Error(runtime.lastError.message || "Extension API fetch failed"))
                return
              }
              if (!result || typeof result !== "object") {
                reject(new Error("Extension API fetch returned no response"))
                return
              }
              const rawText = String(result.text || "")
              resolve({
                ok: Boolean(result.ok),
                status: Number(result.status || 0),
                text: () => Promise.resolve(rawText),
                json: () => Promise.resolve(rawText ? JSON.parse(rawText) : null),
              })
            },
          )
        } catch (err) {
          reject(err)
        }
      })
    }
  }

  root.IconoplasmContentApi = {
    createExtensionApiFetch,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
