;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: portrait intent is bounded, deduplicated,
  // active-first, and separate from the portrait-free scanner projection.

  function createPortraitCache(options = {}) {
    const windowRef = options.windowRef || root
    const chromeApi = options.chromeApi || root.chrome
    const runtime = chromeApi && chromeApi.runtime
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

    function runtimeMessage(message) {
      return new Promise((resolve) => {
        runtime.sendMessage(message, (result) => {
          if (runtime.lastError) {
            resolve(null)
            return
          }
          resolve(result)
        })
      })
    }

    function loadBrowserImage(url, timeoutMs, signal) {
      return new Promise((resolve, reject) => {
        if (!url) {
          reject(new Error("Missing portrait source"))
          return
        }
        const ImageCtor = options.ImageCtor || windowRef.Image
        if (typeof ImageCtor !== "function") {
          resolve(url)
          return
        }
        const image = new ImageCtor()
        let settled = false
        const onAbort = () => {
          try {
            if (typeof image.removeAttribute === "function") image.removeAttribute("src")
            else image.src = ""
          } catch (_error) {}
          const error = new Error("Portrait source aborted")
          error.name = "AbortError"
          finish(reject, error)
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
        const timer = windowRef.setTimeout(
          () => finish(reject, new Error("Portrait source timed out")),
          Math.max(250, Number(timeoutMs || 2500)),
        )
        image.onload = () => {
          const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve()
          Promise.resolve(decoded)
            .catch(() => null)
            .then(() => finish(resolve, url))
        }
        image.onerror = () => finish(reject, new Error("Portrait source failed"))
        if (signal?.aborted) {
          onAbort()
          return
        }
        signal?.addEventListener?.("abort", onAbort, { once: true })
        image.decoding = "async"
        image.src = url
      })
    }

    async function loadPlannedSource(plan) {
      const primaryUrl = String(plan?.primaryUrl || "").trim()
      const fallbackUrl = String(plan?.fallbackUrl || "").trim()
      const timeoutMs = Number(plan?.timeoutMs || 2500)
      const hedgeDelayMs = Math.max(0, Number(plan?.hedgeDelayMs || 0))
      if (!fallbackUrl || fallbackUrl === primaryUrl) return loadBrowserImage(primaryUrl, timeoutMs)

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
          loadBrowserImage(fallbackUrl, timeoutMs, fallbackController?.signal).then(
            (url) => resolve({ url, lane: "fallback" }),
            reject,
          )
        }
        hedgeTimer = windowRef.setTimeout(startFallback, hedgeDelayMs)
      })
      const primaryPromise = loadBrowserImage(primaryUrl, timeoutMs, primaryController?.signal)
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
      const url = String(portraitSrc || "").trim()
      if (!url) return ""
      const cachedSrc = getCachedSrc(url)
      if (cachedSrc) return cachedSrc
      if (promiseCache.has(url)) return promiseCache.get(url)

      const request = (async () => {
        try {
          if (!runtime || typeof runtime.sendMessage !== "function") return url
          const plan = await runtimeMessage({ type: "GET_PORTRAIT_SOURCE_PLAN", url })
          if (plan?.ok && plan.primaryUrl) {
            try {
              const sourceUrl = await loadPlannedSource(plan)
              await runtimeMessage({
                type: "REPORT_PORTRAIT_SOURCE_RESULT",
                url: sourceUrl,
                succeeded: true,
              })
              rememberDataUrl(url, sourceUrl)
              return sourceUrl
            } catch (_sourceError) {
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
        } catch (_) {
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
        while (warmQueue.length) {
          const batch = warmQueue.splice(0, batchSize)
          for (const url of batch) queuedUrls.delete(url)
          const usableSources = await Promise.all(
            batch.map(async (url) => {
              const source = await getUsableSrc(url).catch(() => "")
              // Decode each neighbor as soon as its bytes arrive. Waiting for
              // the slowest member of a six-image batch made every faster
              // portrait inherit that tail latency.
              if (source) onWarmSource(source, url)
              return source
            }),
          )
          onWarmBatch(usableSources)
          if (warmQueue.length) await delay(delayMs)
        }
      } finally {
        draining = false
      }
    }

    function warmUrls(urls) {
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
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
