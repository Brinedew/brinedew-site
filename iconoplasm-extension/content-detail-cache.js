;(function (root) {
  "use strict"

  function normalizeSymbol(rawSymbol) {
    return String(rawSymbol || "")
      .trim()
      .toUpperCase()
  }

  function createGeneDetailStore(options = {}) {
    const windowRef = options.windowRef || root
    const cache = new Map()
    const promiseCache = new Map()
    const warmQueue = []
    const queuedSymbols = new Set()
    const warmBatchSize = Math.max(1, Number(options.warmBatchSize || 8))
    const visibleLimit = Math.max(1, Number(options.visibleLimit || 16))
    const delayMs = Math.max(0, Number(options.delayMs || 20))
    const fetchImpl = options.fetchImpl
    const batchUrl = String(options.batchUrl || "")
    const fields = Array.isArray(options.fields) ? options.fields : []
    const onError = typeof options.onError === "function" ? options.onError : () => {}
    const deferTask =
      typeof options.deferTask === "function"
        ? options.deferTask
        : (task) => windowRef.setTimeout(task, 0)
    let warmScheduled = false
    let draining = false

    function delay(ms) {
      return new Promise((resolve) => windowRef.setTimeout(resolve, ms))
    }

    async function fetchBatch(symbols) {
      const uniqueSymbols = []
      const seenSymbols = new Set()
      for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
        const symbol = normalizeSymbol(rawSymbol)
        if (!symbol || seenSymbols.has(symbol)) continue
        seenSymbols.add(symbol)
        uniqueSymbols.push(symbol)
      }

      const unresolvedSymbols = uniqueSymbols.filter(
        (symbol) => !cache.has(symbol) && !promiseCache.has(symbol),
      )

      if (unresolvedSymbols.length) {
        const batchRequest = (async () => {
          try {
            if (!fetchImpl || !batchUrl) throw new Error("Gene detail fetch is not configured")
            const resp = await fetchImpl(batchUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbols: unresolvedSymbols,
                fields,
              }),
            })
            if (!resp.ok) throw new Error("HTTP " + String(resp.status || 0))

            const payload = (await resp.json()) || {}
            const genes = Array.isArray(payload.genes) ? payload.genes : []
            const resolvedMap = new Map()
            for (const record of genes) {
              const symbol = normalizeSymbol(record && record.symbol)
              if (!symbol) continue
              const safeRecord = record && typeof record === "object" ? record : null
              cache.set(symbol, safeRecord)
              resolvedMap.set(symbol, safeRecord)
            }
            const missingSymbols = Array.isArray(payload.missing) ? payload.missing : []
            for (const rawMissing of missingSymbols) {
              const symbol = normalizeSymbol(rawMissing)
              if (!symbol) continue
              cache.set(symbol, null)
              resolvedMap.set(symbol, null)
            }
            for (const symbol of unresolvedSymbols) {
              if (!resolvedMap.has(symbol)) cache.set(symbol, null)
            }
          } catch (err) {
            onError(err)
            for (const symbol of unresolvedSymbols) cache.set(symbol, null)
          } finally {
            for (const symbol of unresolvedSymbols) promiseCache.delete(symbol)
          }
        })()

        for (const symbol of unresolvedSymbols) {
          promiseCache.set(
            symbol,
            batchRequest.then(() => cache.get(symbol) || null),
          )
        }
      }

      const entries = await Promise.all(
        uniqueSymbols.map(async (symbol) => {
          if (cache.has(symbol)) return [symbol, cache.get(symbol) || null]
          if (promiseCache.has(symbol)) return [symbol, await promiseCache.get(symbol)]
          return [symbol, null]
        }),
      )
      return new Map(entries)
    }

    async function drainWarmQueue() {
      if (draining) return
      draining = true
      try {
        while (warmQueue.length) {
          const batch = warmQueue.splice(0, warmBatchSize)
          for (const symbol of batch) queuedSymbols.delete(symbol)
          await fetchBatch(batch)
          if (warmQueue.length) await delay(delayMs)
        }
      } finally {
        draining = false
        if (warmQueue.length) drainWarmQueue().catch(() => null)
      }
    }

    function warm(symbols, limit = visibleLimit) {
      const uniqueSymbols = []
      const seen = new Set()
      const max = Math.max(1, Number(limit || visibleLimit))
      for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
        const symbol = normalizeSymbol(rawSymbol)
        if (!symbol || seen.has(symbol)) continue
        if (cache.has(symbol) || promiseCache.has(symbol) || queuedSymbols.has(symbol)) continue
        seen.add(symbol)
        uniqueSymbols.push(symbol)
        if (uniqueSymbols.length >= max) break
      }
      for (const symbol of uniqueSymbols) {
        queuedSymbols.add(symbol)
        warmQueue.push(symbol)
      }
      if (uniqueSymbols.length) drainWarmQueue().catch(() => null)
    }

    function scheduleWarm(collectSymbols, limit = visibleLimit) {
      if (warmScheduled) return
      warmScheduled = true
      deferTask(() => {
        warmScheduled = false
        const symbols =
          typeof collectSymbols === "function" ? collectSymbols(limit) : collectSymbols
        warm(symbols, limit)
      })
    }

    return {
      cache,
      promiseCache,
      fetchBatch,
      warm,
      scheduleWarm,
      has: (symbol) => cache.has(normalizeSymbol(symbol)),
      get: (symbol) => cache.get(normalizeSymbol(symbol)) || null,
    }
  }

  root.IconoplasmContentDetailCache = {
    createGeneDetailStore,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
