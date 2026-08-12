;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: foreground hover cancellation must reach the real worker fetch.

  function createExtensionApiFetch(chromeApi) {
    const runtime = chromeApi && chromeApi.runtime
    if (!runtime || typeof runtime.sendMessage !== "function") {
      throw new Error("Iconoplasm content API bridge requires chrome.runtime.sendMessage")
    }

    let nextRequestId = 0

    return function extensionApiFetch(input, init = {}) {
      const url = typeof input === "string" ? input : String((input && input.url) || "")
      return new Promise((resolve, reject) => {
        const requestId = `api-${Date.now().toString(36)}-${++nextRequestId}`
        const signal = init && init.signal
        let settled = false
        const abortError = () => {
          const error = new Error("The Iconoplasm API request was aborted")
          error.name = "AbortError"
          return error
        }
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          if (signal && typeof signal.removeEventListener === "function") {
            signal.removeEventListener("abort", onAbort)
          }
          callback(value)
        }
        const onAbort = () => {
          try {
            runtime.sendMessage({ type: "CANCEL_ICONOPLASM_API_FETCH", requestId }, () => {
              void runtime.lastError
            })
          } catch (_error) {}
          finish(reject, abortError())
        }
        if (signal?.aborted) {
          finish(reject, abortError())
          return
        }
        if (signal && typeof signal.addEventListener === "function") {
          signal.addEventListener("abort", onAbort, { once: true })
        }
        try {
          runtime.sendMessage(
            {
              type: "ICONOPLASM_API_FETCH",
              requestId,
              url,
              method: String(init.method || "GET").toUpperCase(),
              headers: init.headers && typeof init.headers === "object" ? init.headers : {},
              body: typeof init.body === "string" ? init.body : undefined,
              credentials: init.credentials === "include" ? "include" : "same-origin",
            },
            (result) => {
              if (settled) return
              if (runtime.lastError) {
                finish(reject, new Error(runtime.lastError.message || "Extension API fetch failed"))
                return
              }
              if (!result || typeof result !== "object") {
                finish(reject, new Error("Extension API fetch returned no response"))
                return
              }
              if (result.aborted) {
                finish(reject, abortError())
                return
              }
              const rawText = String(result.text || "")
              finish(resolve, {
                ok: Boolean(result.ok),
                status: Number(result.status || 0),
                text: () => Promise.resolve(rawText),
                json: () => Promise.resolve(rawText ? JSON.parse(rawText) : null),
              })
            },
          )
        } catch (err) {
          finish(reject, err)
        }
      })
    }
  }

  root.IconoplasmContentApi = {
    createExtensionApiFetch,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
