;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: portrait intent is bounded, deduplicated,
  // active-first, and separate from the portrait-free scanner projection.

  function loadBrowserImage(url, timeoutMs, signal, options = {}) {
    const windowRef = options.windowRef || root
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error("Missing portrait source"))
      const ImageCtor = options.ImageCtor || windowRef.Image
      if (typeof ImageCtor !== "function") return resolve(url)
      const image = new ImageCtor()
      let settled = false
      const stopImage = () => {
        if (typeof image.removeAttribute === "function") image.removeAttribute("src")
        else image.src = ""
      }
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        windowRef.clearTimeout(timer)
        image.onload = null
        image.onerror = null
        signal?.removeEventListener?.("abort", onAbort)
        callback(value)
      }
      const onAbort = () => {
        const error = new Error("Portrait source aborted")
        error.name = "AbortError"
        finish(reject, error)
        stopImage()
      }
      const timer = windowRef.setTimeout(
        () => {
          finish(reject, new Error("Portrait source timed out"))
          stopImage()
        },
        Math.max(250, Number(timeoutMs || 2500)),
      )
      image.onload = () => {
        const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve()
        Promise.resolve(decoded)
          .catch(() => null)
          .then(() => finish(resolve, url))
      }
      image.onerror = () => finish(reject, new Error("Portrait source failed"))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener?.("abort", onAbort, { once: true })
      image.decoding = "async"
      image.src = url
    })
  }

  function createPortraitCache(options = {}) {
    const windowRef = options.windowRef || root
    const runtimeMessage = options.sendMessage
    const loadImage =
      typeof options.loadImage === "function"
        ? options.loadImage
        : (url, timeoutMs, signal) => loadBrowserImage(url, timeoutMs, signal, options)
    if (typeof runtimeMessage !== "function")
      throw new Error("Portrait cache requires a runtime client")
    const batchSize = Math.max(1, Number(options.batchSize || 6))
    const delayMs = Math.max(0, Number(options.delayMs || 20))
    const onWarmSource =
      typeof options.onWarmSource === "function" ? options.onWarmSource : () => {}
    const onWarmBatch = typeof options.onWarmBatch === "function" ? options.onWarmBatch : () => {}
    const dataUrlCache = new Map()
    const dataUrlCacheLimit = Math.max(1, Number(options.dataUrlCacheLimit || 48))
    const promiseCache = new Map()
    const warmQueue = []
    const queuedUrls = new Set()
    let draining = false
    let disposed = false

    function delay(ms) {
      return new Promise((resolve) => windowRef.setTimeout(resolve, ms))
    }

    function rememberDataUrl(url, dataUrl) {
      if (!url || !dataUrl) return
      dataUrlCache.delete(url)
      dataUrlCache.set(url, dataUrl)
      while (dataUrlCache.size > dataUrlCacheLimit) {
        const oldest = dataUrlCache.keys().next().value
        dataUrlCache.delete(oldest)
      }
    }

    function getCachedSrc(portraitSrc) {
      const url = String(portraitSrc || "").trim()
      if (!url || !dataUrlCache.has(url)) return ""
      const dataUrl = dataUrlCache.get(url)
      rememberDataUrl(url, dataUrl)
      return dataUrl
    }

    async function loadPlannedSource(plan) {
      const primaryUrl = String(plan?.primaryUrl || "").trim()
      const fallbackUrl = String(plan?.fallbackUrl || "").trim()
      const timeoutMs = Number(plan?.timeoutMs || 2500)
      const hedgeDelayMs =
        plan?.hedgeDelayMs == null ? null : Math.max(0, Number(plan.hedgeDelayMs))
      if (!fallbackUrl || fallbackUrl === primaryUrl) return loadImage(primaryUrl, timeoutMs)

      const primaryController = typeof AbortController === "function" ? new AbortController() : null
      const fallbackController =
        typeof AbortController === "function" ? new AbortController() : null
      let startFallback
      let fallbackStarted = false
      let hedgeTimer = null
      const fallbackPromise = new Promise((resolve, reject) => {
        startFallback = () => {
          if (fallbackStarted) return
          fallbackStarted = true
          loadImage(fallbackUrl, timeoutMs, fallbackController?.signal).then(
            (url) => resolve({ url, lane: "fallback" }),
            reject,
          )
        }
        if (hedgeDelayMs !== null) hedgeTimer = windowRef.setTimeout(startFallback, hedgeDelayMs)
      })
      const primaryPromise = loadImage(primaryUrl, timeoutMs, primaryController?.signal)
        .then((url) => ({ url, lane: "primary" }))
        .catch((error) => {
          startFallback()
          throw error
        })
      try {
        const winner = await Promise.any([primaryPromise, fallbackPromise])
        if (winner.lane === "primary") fallbackController?.abort()
        else primaryController?.abort()
        return winner.url
      } finally {
        if (hedgeTimer) windowRef.clearTimeout(hedgeTimer)
      }
    }

    async function getUsableSrc(portraitSrc) {
      if (disposed) return ""
      const url = String(portraitSrc || "").trim()
      if (!url) return ""
      const cachedSrc = getCachedSrc(url)
      if (cachedSrc) return cachedSrc
      if (promiseCache.has(url)) return promiseCache.get(url)

      const request = (async () => {
        try {
          const plan = await runtimeMessage({ type: "GET_PORTRAIT_SOURCE_PLAN", url })
          if (disposed) return ""
          if (plan?.ok && plan.primaryUrl) {
            try {
              const sourceUrl = await loadPlannedSource(plan)
              await runtimeMessage({
                type: "REPORT_PORTRAIT_SOURCE_RESULT",
                url: sourceUrl,
                succeeded: true,
                decisionId: plan.decisionId,
              })
              rememberDataUrl(url, sourceUrl)
              return sourceUrl
            } catch (sourceError) {
              if (disposed || sourceError?.code === "ICONOPLASM_CONTEXT_INVALIDATED") return ""
              // A host-page CSP failure is indistinguishable from a network
              // failure here. Let the privileged worker fallback perform the
              // authoritative source transition instead of poisoning tab state.
            }
          }
          // Compatibility/correctness fallback for host pages whose CSP blocks
          // extension-owned HTTPS images. It is no longer the normal hot path.
          const response = await runtimeMessage({ type: "GET_PORTRAIT_DATA_URL", url })
          const dataUrl = response?.ok && response.dataUrl ? response.dataUrl : ""
          if (dataUrl) {
            rememberDataUrl(url, dataUrl)
            return dataUrl
          }
          const sourceUrl = response?.ok && response.sourceUrl ? response.sourceUrl : ""
          if (sourceUrl) return sourceUrl
        } catch (error) {
          if (disposed || error?.code === "ICONOPLASM_CONTEXT_INVALIDATED") return ""
          // Fall back to the direct site URL below.
        } finally {
          promiseCache.delete(url)
        }
        return url
      })()

      promiseCache.set(url, request)
      return request
    }

    async function drainWarmQueue() {
      if (draining) return
      draining = true
      try {
        while (!disposed && warmQueue.length) {
          const batch = warmQueue.splice(0, batchSize)
          for (const url of batch) queuedUrls.delete(url)
          const usableSources = await Promise.all(
            batch.map(async (url) => {
              const source = await getUsableSrc(url).catch(() => "")
              // Decode each neighbor as soon as its bytes arrive. Waiting for
              // the slowest member of a six-image batch made every faster
              // portrait inherit that tail latency.
              if (!disposed && source) onWarmSource(source, url)
              return source
            }),
          )
          if (!disposed) onWarmBatch(usableSources)
          if (warmQueue.length) await delay(delayMs)
        }
      } finally {
        draining = false
      }
    }

    function warmUrls(urls) {
      if (disposed) return
      const seen = new Set()
      let added = false
      for (const rawUrl of Array.isArray(urls) ? urls : []) {
        const url = String(rawUrl || "").trim()
        if (!url || seen.has(url)) continue
        const cachedSrc = getCachedSrc(url)
        if (cachedSrc) {
          onWarmSource(cachedSrc, url)
          continue
        }
        if (promiseCache.has(url) || queuedUrls.has(url)) continue
        seen.add(url)
        queuedUrls.add(url)
        warmQueue.push(url)
        added = true
      }
      if (added) drainWarmQueue().catch(() => null)
    }

    function replaceWarmUrls(urls) {
      for (const url of warmQueue.splice(0)) queuedUrls.delete(url)
      warmUrls(urls)
    }

    return {
      dispose() {
        disposed = true
        warmQueue.length = 0
        queuedUrls.clear()
        dataUrlCache.clear()
      },
      dataUrlCache,
      getCachedSrc,
      getUsableSrc,
      warmUrls,
      replaceWarmUrls,
      drainWarmQueue,
    }
  }

  root.IconoplasmContentPortraitCache = {
    createPortraitCache,
    loadBrowserImage,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
