;(function (root) {
  "use strict"

  function createPortraitCache(options = {}) {
    const windowRef = options.windowRef || root
    const chromeApi = options.chromeApi || root.chrome
    const runtime = chromeApi && chromeApi.runtime
    const batchSize = Math.max(1, Number(options.batchSize || 6))
    const delayMs = Math.max(0, Number(options.delayMs || 20))
    const onWarmBatch = typeof options.onWarmBatch === "function" ? options.onWarmBatch : () => {}
    const dataUrlCache = new Map()
    const promiseCache = new Map()
    const warmQueue = []
    const queuedUrls = new Set()
    let draining = false

    function delay(ms) {
      return new Promise((resolve) => windowRef.setTimeout(resolve, ms))
    }

    async function getUsableSrc(portraitSrc) {
      const url = String(portraitSrc || "").trim()
      if (!url) return ""
      if (dataUrlCache.has(url)) return dataUrlCache.get(url)
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
            dataUrlCache.set(url, dataUrl)
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
            batch.map((url) => getUsableSrc(url).catch(() => "")),
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
        if (dataUrlCache.has(url) || promiseCache.has(url) || queuedUrls.has(url)) continue
        seen.add(url)
        queuedUrls.add(url)
        warmQueue.push(url)
        added = true
      }
      if (added) drainWarmQueue().catch(() => null)
    }

    return {
      dataUrlCache,
      getUsableSrc,
      warmUrls,
      drainWarmQueue,
    }
  }

  root.IconoplasmContentPortraitCache = {
    createPortraitCache,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
