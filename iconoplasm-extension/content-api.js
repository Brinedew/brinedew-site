;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: foreground hover cancellation must reach the real worker fetch.

  function createExtensionRuntimeClient(chromeApi, options = {}) {
    const runtime = chromeApi && chromeApi.runtime
    if (!runtime || typeof runtime.sendMessage !== "function") {
      throw new Error("Iconoplasm content API bridge requires chrome.runtime.sendMessage")
    }

    let nextRequestId = 0
    let disconnectedError = null
    const pending = new Set()
    const initialRuntimeId = runtime.id
    function classifyError(error) {
      if (!/extension context invalidated/i.test(String(error?.message || error))) return error
      if (!disconnectedError) {
        disconnectedError = new Error("Iconoplasm disconnected. Reload this page.")
        disconnectedError.name = "ExtensionContextInvalidatedError"
        disconnectedError.code = "ICONOPLASM_CONTEXT_INVALIDATED"
        // An update invalidates the old isolated world permanently. Retrying
        // cannot reconnect it and can flood a dense article with failed work.
        for (const reject of pending) reject(disconnectedError)
        options.onContextInvalidated?.(disconnectedError)
      }
      return disconnectedError
    }

    function checkConnected() {
      if (!disconnectedError && initialRuntimeId && !runtime.id) {
        classifyError(new Error("Extension context invalidated."))
      }
      return !disconnectedError
    }

    function sendMessage(message) {
      if (!checkConnected()) return Promise.reject(disconnectedError)
      return new Promise((resolve, reject) => {
        const fail = (error) => {
          pending.delete(fail)
          reject(error)
        }
        pending.add(fail)
        try {
          runtime.sendMessage(message, (result) => {
            if (runtime.lastError) {
              fail(
                classifyError(new Error(runtime.lastError.message || "Extension request failed")),
              )
              return
            }
            pending.delete(fail)
            resolve(result)
          })
        } catch (error) {
          fail(classifyError(error))
        }
      })
    }

    function extensionApiFetch(input, init = {}) {
      if (disconnectedError) return Promise.reject(disconnectedError)
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
          void sendMessage({ type: "CANCEL_ICONOPLASM_API_FETCH", requestId }).catch(() => null)
          finish(reject, abortError())
        }
        if (signal?.aborted) {
          finish(reject, abortError())
          return
        }
        if (signal && typeof signal.addEventListener === "function") {
          signal.addEventListener("abort", onAbort, { once: true })
        }
        sendMessage({
          type: "ICONOPLASM_API_FETCH",
          requestId,
          url,
          method: String(init.method || "GET").toUpperCase(),
          headers: init.headers && typeof init.headers === "object" ? init.headers : {},
          body: typeof init.body === "string" ? init.body : undefined,
          credentials: init.credentials === "include" ? "include" : "same-origin",
        })
          .then((result) => {
            if (settled) return
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
          })
          .catch((error) => finish(reject, error))
      })
    }
    return Object.freeze({ sendMessage, fetch: extensionApiFetch, checkConnected })
  }

  root.IconoplasmContentApi = {
    createExtensionRuntimeClient,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
