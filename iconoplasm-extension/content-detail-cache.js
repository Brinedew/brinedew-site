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
    const onResolvedBatch =
      typeof options.onResolvedBatch === "function" ? options.onResolvedBatch : () => {}
    const storageApi = options.storageApi || null
    const storageKey = String(options.storageKey || "iconoplasm_published_gene_detail_cache_v1")
    const persistentLimit = Math.max(1, Number(options.persistentLimit || 512))
    const getRevision =
      typeof options.getRevision === "function" ? options.getRevision : async () => ""
    const deferTask =
      typeof options.deferTask === "function"
        ? options.deferTask
        : (task) => windowRef.setTimeout(task, 0)
    let warmScheduled = false
    let draining = false
    let persistentHydrationPromise = null
    let activeRevision = ""

    function delay(ms) {
      return new Promise((resolve) => windowRef.setTimeout(resolve, ms))
    }

    function rememberRecord(symbol, record) {
      cache.delete(symbol)
      cache.set(symbol, record)
      while (cache.size > persistentLimit) {
        const oldest = cache.keys().next().value
        cache.delete(oldest)
      }
    }

    function normalizeRevision(value) {
      return String(value || "")
        .trim()
        .replace(/[^A-Za-z0-9._:-]/g, "")
    }

    async function resolveRevision() {
      try {
        return normalizeRevision(await getRevision())
      } catch (_err) {
        return ""
      }
    }

    async function hydratePersistentCache() {
      if (!storageApi?.get) return
      if (persistentHydrationPromise) return persistentHydrationPromise
      persistentHydrationPromise = (async () => {
        const revision = await resolveRevision()
        if (!revision) return
        activeRevision = revision
        const stored = await storageApi.get([storageKey])
        const payload = stored && stored[storageKey]
        if (
          !payload ||
          Number(payload.schema_version || 0) !== 1 ||
          String(payload.revision || "") !== revision ||
          !Array.isArray(payload.entries)
        ) {
          if (payload && storageApi.remove) await storageApi.remove([storageKey])
          return
        }
        for (const entry of payload.entries.slice(-persistentLimit)) {
          const symbol = normalizeSymbol(entry && entry[0])
          const record = entry && entry[1]
          if (!symbol || !record || typeof record !== "object") continue
          rememberRecord(symbol, record)
        }
      })().catch(() => null)
      return persistentHydrationPromise
    }

    async function persistResolvedRecords(revisionHint = "") {
      if (!storageApi?.get || !storageApi?.set) return
      const revision =
        normalizeRevision(revisionHint) || activeRevision || (await resolveRevision())
      if (!revision) return
      if (activeRevision && revision !== activeRevision) cache.clear()
      activeRevision = revision
      const stored = await storageApi.get([storageKey])
      const previous = stored && stored[storageKey]
      const merged = new Map()
      if (
        previous &&
        Number(previous.schema_version || 0) === 1 &&
        String(previous.revision || "") === revision &&
        Array.isArray(previous.entries)
      ) {
        for (const entry of previous.entries.slice(-persistentLimit)) {
          const symbol = normalizeSymbol(entry && entry[0])
          const record = entry && entry[1]
          if (symbol && record && typeof record === "object") merged.set(symbol, record)
        }
      }
      for (const [symbol, record] of cache) {
        if (!record || typeof record !== "object") continue
        merged.delete(symbol)
        merged.set(symbol, record)
      }
      const entries = Array.from(merged.entries()).slice(-persistentLimit)
      await storageApi.set({
        [storageKey]: {
          schema_version: 1,
          revision,
          entries,
        },
      })
    }

    async function fetchBatch(symbols) {
      await hydratePersistentCache()
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
            const responseRevision = normalizeRevision(payload.snapshot_version)
            if (responseRevision && activeRevision && responseRevision !== activeRevision) {
              cache.clear()
            }
            if (responseRevision) activeRevision = responseRevision
            const genes = Array.isArray(payload.genes) ? payload.genes : []
            const resolvedMap = new Map()
            for (const record of genes) {
              const symbol = normalizeSymbol(record && record.symbol)
              if (!symbol) continue
              const safeRecord = record && typeof record === "object" ? record : null
              if (safeRecord) rememberRecord(symbol, safeRecord)
              resolvedMap.set(symbol, safeRecord)
            }
            if (genes.length) onResolvedBatch(genes)
            const missingSymbols = Array.isArray(payload.missing) ? payload.missing : []
            for (const rawMissing of missingSymbols) {
              const symbol = normalizeSymbol(rawMissing)
              if (!symbol) continue
              cache.set(symbol, null)
              resolvedMap.set(symbol, null)
            }
            await persistResolvedRecords(responseRevision)
          } catch (err) {
            onError(err)
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
      hydratePersistentCache,
      persistResolvedRecords,
    }
  }

  root.IconoplasmContentDetailCache = {
    createGeneDetailStore,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
