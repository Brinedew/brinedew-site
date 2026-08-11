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

    async function getUsableSrc(portraitSrc) {
      const url = String(portraitSrc || "").trim()
      if (!url) return ""
      const cachedSrc = getCachedSrc(url)
      if (cachedSrc) return cachedSrc
      if (promiseCache.has(url)) return promiseCache.get(url)

      const request = (async () => {
        try {
          if (!runtime || typeof runtime.sendMessage !== "function") return url
          const response = await new Promise((resolve) => {
            runtime.sendMessage({ type: "GET_PORTRAIT_DATA_URL", url }, (result) => {
              if (runtime.lastError) {
                resolve(null)
                return
              }
              resolve(result)
            })
          })
          const dataUrl = response && response.ok && response.dataUrl ? response.dataUrl : ""
          if (dataUrl) {
            rememberDataUrl(url, dataUrl)
            return dataUrl
          }
          const sourceUrl = response && response.ok && response.sourceUrl ? response.sourceUrl : ""
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
