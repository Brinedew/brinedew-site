;(function (root) {
  "use strict"

  const api = root.browser || root.chrome
  const store = root.IconoplasmPdfByteStore
  const PDF_SETTING = "iconoplasm_pdf_highlighting_enabled"
  const requests = new Map()
  let enabled = false

  function localPdfUrl(value) {
    try {
      const url = new URL(String(value || ""))
      return url.protocol === "file:" && /\.pdf$/i.test(url.pathname) ? url.href : ""
    } catch (_error) {
      return ""
    }
  }

  function localReaderUrl(sourceUrl) {
    return `${api.runtime.getURL("pdf-reader.html")}?geckoLocalFile=${encodeURIComponent(sourceUrl)}`
  }

  function onBeforeNavigate(details) {
    if (
      !enabled ||
      details.frameId !== 0 ||
      !Number.isInteger(details.tabId) ||
      details.tabId < 0
    ) {
      return
    }
    const sourceUrl = localPdfUrl(details.url)
    if (!sourceUrl) return
    void api.tabs.update(details.tabId, { url: localReaderUrl(sourceUrl) }).catch((error) => {
      console.error("Iconoplasm could not open the local Firefox PDF reader", error)
    })
  }

  function headerValue(headers, name) {
    const header = (headers || []).find(
      (candidate) => String(candidate.name || "").toLowerCase() === name,
    )
    return String(header?.value || "")
  }

  function isPdfResponse(details) {
    if (details.statusCode !== 200) return false
    if (
      !/^application\/pdf(?:\s*;|$)/i.test(headerValue(details.responseHeaders, "content-type"))
    ) {
      return false
    }
    return !/\battachment\b/i.test(headerValue(details.responseHeaders, "content-disposition"))
  }

  function htmlHeaders(headers) {
    const removed = new Set([
      "content-type",
      "content-length",
      "content-encoding",
      "content-security-policy",
      "content-security-policy-report-only",
      "x-content-type-options",
    ])
    return [
      ...(headers || []).filter((header) => !removed.has(String(header.name || "").toLowerCase())),
      { name: "Content-Type", value: "text/html; charset=utf-8" },
      { name: "Cache-Control", value: "no-store" },
    ]
  }

  function redirectShell(sourceId) {
    return new TextEncoder().encode(
      `<!doctype html><html lang="en" data-iconoplasm-gecko-pdf-source="${sourceId}"><head><meta charset="utf-8"><title>Opening PDF</title></head><body></body></html>`,
    )
  }

  function onBeforeRequest(details) {
    if (!enabled) return undefined
    if (!/^https?:/i.test(String(details.url || ""))) return undefined

    // Firefox may redirect a PDF navigation into its built-in viewer as soon as
    // headers arrive. Creating the StreamFilter here is therefore essential;
    // creating it from onHeadersReceived can yield an invalid request ID.
    const filter = api.webRequest.filterResponseData(details.requestId)
    const request = {
      filter,
      mode: "pending",
      sourceId: null,
      tabId: details.tabId,
    }
    requests.set(details.requestId, request)

    filter.ondata = (event) => {
      if (request.mode === "capture") store.append(request.sourceId, event.data)
      else filter.write(event.data)
    }
    filter.onerror = () => {
      requests.delete(details.requestId)
      if (request.sourceId) store.dispose(request.sourceId)
      try {
        filter.disconnect()
      } catch (_error) {}
    }
    filter.onstop = () => {
      requests.delete(details.requestId)
      if (request.mode !== "capture") {
        try {
          filter.close()
        } catch (_error) {}
        return
      }
      try {
        store.seal(request.sourceId)
        filter.write(redirectShell(request.sourceId))
        filter.close()
      } catch (error) {
        console.error("Iconoplasm could not acquire the Firefox PDF response", error)
        store.dispose(request.sourceId)
        try {
          filter.disconnect()
        } catch (_error) {}
      }
    }
    return {}
  }

  function onHeadersReceived(details) {
    const request = requests.get(details.requestId)
    if (!request) return undefined
    if (!enabled || !isPdfResponse(details)) {
      request.mode = "passthrough"
      try {
        request.filter.disconnect()
      } finally {
        requests.delete(details.requestId)
      }
      return undefined
    }

    const sourceId = store.create({
      url: details.url,
      tabId: details.tabId,
      filename: decodeURIComponent(
        details.url.split(/[?#]/, 1)[0].split("/").pop() || "document.pdf",
      ),
    })
    request.mode = "capture"
    request.sourceId = sourceId
    return { responseHeaders: htmlHeaders(details.responseHeaders) }
  }

  function setEnabled(value) {
    enabled = Boolean(value)
  }

  api.webRequest.onBeforeRequest.addListener(
    onBeforeRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"],
  )
  api.webRequest.onHeadersReceived.addListener(
    onHeadersReceived,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking", "responseHeaders"],
  )
  api.webNavigation?.onBeforeNavigate?.addListener(onBeforeNavigate)
  const ready = api.storage.local
    .get([PDF_SETTING])
    .then((stored) => setEnabled(stored[PDF_SETTING]))
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[PDF_SETTING]) {
      setEnabled(changes[PDF_SETTING].newValue)
    }
  })

  root.IconoplasmPdfGeckoOwnership = Object.freeze({
    isSupported: () => true,
    ready: () => ready,
    isEnabled: () => enabled,
    setEnabled,
  })
})(globalThis)
