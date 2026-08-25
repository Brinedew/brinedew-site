;(() => {
  const mimeHandler = chrome.mimeHandler
  const geckoSourceId = new URLSearchParams(location.search).get("geckoSource")
  const CHUNK_BYTES = 512 * 1024

  function reportProgress(loaded, total, stage = "loading") {
    const detail = Object.freeze({ loaded, total, stage })
    globalThis.IconoplasmPdfStreamProgress = detail
    if (typeof globalThis.CustomEvent === "function" && globalThis.dispatchEvent) {
      globalThis.dispatchEvent(new CustomEvent("iconoplasm-pdf-stream-progress", { detail }))
    }
  }

  async function readResponseBytes(response) {
    const total = Number(response.headers?.get?.("content-length")) || 0
    if (!response.body?.getReader) {
      const buffer = await response.arrayBuffer()
      reportProgress(buffer.byteLength, total || buffer.byteLength)
      return new Uint8Array(buffer)
    }
    const reader = response.body.getReader()
    const chunks = []
    let loaded = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.byteLength
      reportProgress(loaded, total)
    }
    const bytes = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    reportProgress(loaded, total || loaded)
    return bytes
  }

  async function fallBackToNativeHandler(reason) {
    console.error("Iconoplasm could not acquire the PDF stream", reason)
    try {
      await mimeHandler?.abortAndFallbackToNativeHandler?.()
    } catch (_error) {
      // An ordinary, manually opened reader page has no MIME stream to abort.
    }
    return Object.freeze({ kind: "aborted" })
  }

  async function consumeStream() {
    if (geckoSourceId) {
      let description
      try {
        description = await chrome.runtime.sendMessage({
          type: "PDF_BYTE_STORE_DESCRIBE",
          sourceId: geckoSourceId,
        })
        if (!description?.ok) throw new Error("Captured PDF bytes are unavailable")
        const bytes = new Uint8Array(description.size)
        for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
          const response = await chrome.runtime.sendMessage({
            type: "PDF_BYTE_STORE_READ",
            sourceId: geckoSourceId,
            offset,
            length: Math.min(CHUNK_BYTES, bytes.byteLength - offset),
          })
          if (!response?.ok || !(response.bytes instanceof ArrayBuffer)) {
            throw new Error("Captured PDF bytes are incomplete")
          }
          bytes.set(new Uint8Array(response.bytes), offset)
          reportProgress(
            Math.min(offset + response.bytes.byteLength, bytes.byteLength),
            bytes.byteLength,
          )
        }
        const released = await chrome.runtime.sendMessage({
          type: "PDF_RELEASE_OWNED_SOURCE",
          sourceId: geckoSourceId,
        })
        if (!released?.ok) throw new Error("Captured PDF bytes could not be released")
        return Object.freeze({
          kind: "stream",
          ownership: "firefox-response-filter",
          streamInfo: {
            originalUrl: description.metadata?.url,
            tabId: description.metadata?.tabId,
          },
          bytes,
          handBack() {
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
            location.replace(blobUrl)
          },
        })
      } catch (error) {
        try {
          await chrome.runtime.sendMessage({
            type: "PDF_RELEASE_OWNED_SOURCE",
            sourceId: geckoSourceId,
          })
        } catch (_releaseError) {}
        console.error("Iconoplasm could not acquire the captured Firefox PDF", error)
        return Object.freeze({ kind: "aborted" })
      }
    }
    if (!mimeHandler?.getStreamInfo) return Object.freeze({ kind: "manual" })

    let streamInfo
    try {
      streamInfo = await mimeHandler.getStreamInfo()
    } catch (error) {
      return fallBackToNativeHandler(error)
    }
    if (!streamInfo?.streamUrl) {
      return fallBackToNativeHandler(new Error("Chrome returned no PDF stream URL"))
    }

    try {
      const response = await fetch(streamInfo.streamUrl)
      if (!response.ok) {
        return fallBackToNativeHandler(
          new Error(`Chrome PDF stream failed with HTTP ${response.status}`),
        )
      }
      const bytes = await readResponseBytes(response)
      return Object.freeze({
        kind: "stream",
        ownership: "chromium-mime-handler",
        streamInfo,
        bytes,
        handBack: () => mimeHandler.abortAndFallbackToNativeHandler(),
      })
    } catch (error) {
      return fallBackToNativeHandler(error)
    }
  }

  // Start consuming Chrome's one-shot stream before loading PDF.js, the gene
  // catalog, or the card runtime. Chrome can then fall back from buffered bytes
  // if either initialization or rendering fails.
  globalThis.IconoplasmPdfStreamBootstrap = Object.freeze({
    outcome: consumeStream(),
  })
})()
