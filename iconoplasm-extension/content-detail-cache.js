;(function (root) {
  "use strict"

  // B-898 stage 1: hover detail is one stable, mutable object per gene served
  // from the free CDN (genes/v3/<SYMBOL>.json). The service worker fetches and
  // validates it; this page-level store is only a small bounded in-memory
  // cache with a short TTL so a dense article does not re-ask the worker for
  // the same gene on every hover. There is no revision, no persistence and no
  // second portrait lane: the object already carries the portrait.

  function normalizeSymbol(rawSymbol) {
    return String(rawSymbol || "")
      .trim()
      .toUpperCase()
  }

  function createGeneDetailStore(options = {}) {
    const fetchGene = typeof options.fetchGene === "function" ? options.fetchGene : null
    const ttlMs = Math.max(1000, Number(options.ttlMs || 5 * 60 * 1000))
    const maxEntries = Math.max(1, Number(options.maxEntries || 512))
    const now = typeof options.now === "function" ? options.now : () => Date.now()
    const onError = typeof options.onError === "function" ? options.onError : () => {}
    const cache = new Map() // symbol -> { record: object|null, expiresAt }
    const promiseCache = new Map() // symbol -> Promise<object|null>

    function fresh(symbol) {
      const entry = cache.get(symbol)
      if (!entry) return null
      if (entry.expiresAt <= now()) {
        cache.delete(symbol)
        return null
      }
      return entry
    }

    function remember(symbol, record) {
      cache.delete(symbol)
      cache.set(symbol, { record, expiresAt: now() + ttlMs })
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
    }

    function recordFromResult(symbol, result) {
      if (!result || typeof result !== "object") throw new Error("Stable gene fetch failed")
      if (result.status === "error")
        throw new Error(String(result.error || "Stable gene fetch failed"))
      const gene = result.status === "found" ? result.gene : null
      if (!gene || typeof gene !== "object" || normalizeSymbol(gene.symbol) !== symbol) return null
      return gene
    }

    function request(symbol) {
      if (promiseCache.has(symbol)) return promiseCache.get(symbol)
      const pending = (async () => {
        if (!fetchGene) throw new Error("Stable gene fetch is not configured")
        const record = recordFromResult(symbol, await fetchGene(symbol))
        remember(symbol, record)
        return record
      })()
        .catch((error) => {
          onError(error)
          return null
        })
        .finally(() => {
          if (promiseCache.get(symbol) === pending) promiseCache.delete(symbol)
        })
      promiseCache.set(symbol, pending)
      return pending
    }

    function untilAborted(promise, signal) {
      if (!signal) return promise
      if (signal.aborted) return Promise.resolve(null)
      return new Promise((resolve) => {
        const onAbort = () => resolve(null)
        signal.addEventListener("abort", onAbort, { once: true })
        promise.then(
          (value) => {
            signal.removeEventListener("abort", onAbort)
            resolve(value)
          },
          () => {
            signal.removeEventListener("abort", onAbort)
            resolve(null)
          },
        )
      })
    }

    async function fetchBatch(symbols, options = {}) {
      const uniqueSymbols = []
      const seen = new Set()
      for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
        const symbol = normalizeSymbol(rawSymbol)
        if (!symbol || seen.has(symbol)) continue
        seen.add(symbol)
        uniqueSymbols.push(symbol)
      }
      const entries = await Promise.all(
        uniqueSymbols.map(async (symbol) => {
          const entry = fresh(symbol)
          if (entry) return [symbol, entry.record]
          return [symbol, await untilAborted(request(symbol), options.signal)]
        }),
      )
      return new Map(entries)
    }

    return {
      cache,
      promiseCache,
      fetchBatch,
      has: (symbol) => Boolean(fresh(normalizeSymbol(symbol))),
      get: (symbol) => fresh(normalizeSymbol(symbol))?.record || null,
    }
  }

  root.IconoplasmContentDetailCache = {
    createGeneDetailStore,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
