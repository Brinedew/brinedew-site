;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: detail remains a bounded, revision-keyed
  // projection of the published card artifact; persistence never blocks paint.

  function normalizeSymbol(rawSymbol) {
    return String(rawSymbol || "")
      .trim()
      .toUpperCase()
  }

  function createGeneDetailStore(options = {}) {
    const windowRef = options.windowRef || root
    const cache = new Map()
    const promiseCache = new Map()
    const requestStateBySymbol = new Map()
    const warmQueue = []
    const queuedSymbols = new Set()
    const warmBatchSize = Math.max(1, Number(options.warmBatchSize || 8))
    const visibleLimit = Math.max(1, Number(options.visibleLimit || 16))
    const delayMs = Math.max(0, Number(options.delayMs || 20))
    const fetchImpl = options.fetchImpl
    const batchUrl = String(options.batchUrl || "")
    const detailUrlForSymbol =
      typeof options.detailUrlForSymbol === "function" ? options.detailUrlForSymbol : null
    const fields = Array.isArray(options.fields) ? options.fields : []
    const requestTimeoutMs = Math.max(250, Number(options.requestTimeoutMs || 4000))
    const onResolvedBatch =
      typeof options.onResolvedBatch === "function" ? options.onResolvedBatch : () => {}
    const onError = typeof options.onError === "function" ? options.onError : () => {}
    const storageApi = options.storageApi || null
    const storageKey = String(options.storageKey || "iconoplasm_published_gene_detail_cache_v1")
    const persistentLimit = Math.max(1, Number(options.persistentLimit || 512))
    const persistentByteLimit = Math.max(
      1024,
      Number(options.persistentByteLimit || 4 * 1024 * 1024),
    )
    const getRevision =
      typeof options.getRevision === "function" ? options.getRevision : async () => ""
    const deferTask =
      typeof options.deferTask === "function"
        ? options.deferTask
        : (task) => windowRef.setTimeout(task, 0)
    const deferPersistenceTask =
      typeof options.deferPersistenceTask === "function"
        ? options.deferPersistenceTask
        : (task) => windowRef.setTimeout(task, 0)
    let warmScheduled = false
    let draining = false
    let persistentHydrationPromise = null
    let activeRevision = ""
    let persistenceDirty = false
    let persistenceRevisionHint = ""
    let persistencePromise = null
    let nextRequestSerial = 0
    let latestAdoptedResponseSerial = 0

    function setRevision(rawRevision) {
      const revision = normalizeRevision(rawRevision)
      if (!revision || revision === activeRevision) return activeRevision
      cache.clear()
      activeRevision = revision
      return activeRevision
    }

    function utf8ByteLength(value) {
      let bytes = 0
      for (const character of String(value || "")) {
        const codePoint = character.codePointAt(0)
        if (codePoint <= 0x7f) bytes += 1
        else if (codePoint <= 0x7ff) bytes += 2
        else if (codePoint <= 0xffff) bytes += 3
        else bytes += 4
      }
      return bytes
    }

    function boundedPersistentEntries(rawEntries, revision) {
      const normalized = []
      for (const entry of Array.isArray(rawEntries) ? rawEntries : []) {
        const symbol = normalizeSymbol(entry && entry[0])
        const record = entry && entry[1]
        if (!symbol || !record || typeof record !== "object") continue
        normalized.push([symbol, record])
      }
      const limited = normalized.slice(-persistentLimit)
      const baseBytes = utf8ByteLength(
        JSON.stringify({
          schema_version: 1,
          revision,
          entries: [],
        }),
      )
      let payloadBytes = baseBytes
      const selectedNewestFirst = []
      for (let index = limited.length - 1; index >= 0; index -= 1) {
        const entry = limited[index]
        const entryBytes = utf8ByteLength(JSON.stringify(entry))
        const separatorBytes = selectedNewestFirst.length ? 1 : 0
        if (payloadBytes + entryBytes + separatorBytes > persistentByteLimit) continue
        payloadBytes += entryBytes + separatorBytes
        selectedNewestFirst.push(entry)
      }
      return selectedNewestFirst.reverse()
    }

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
        if (activeRevision && revision !== activeRevision) {
          cache.clear()
        }
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
        const boundedEntries = boundedPersistentEntries(payload.entries, revision)
        for (const entry of boundedEntries) {
          const symbol = normalizeSymbol(entry && entry[0])
          const record = entry && entry[1]
          if (!symbol || !record || typeof record !== "object") continue
          rememberRecord(symbol, record)
        }
        if (boundedEntries.length !== payload.entries.length && storageApi.set) {
          await storageApi.set({
            [storageKey]: {
              schema_version: 1,
              revision,
              entries: boundedEntries,
            },
          })
        }
      })().catch(() => null)
      return persistentHydrationPromise
    }

    async function persistResolvedRecords(revisionHint = "") {
      if (!storageApi?.get || !storageApi?.set) return
      const revision =
        normalizeRevision(revisionHint) || activeRevision || (await resolveRevision())
      if (!revision) return
      // Persistence follows the network revision; it never elects one. A delayed
      // v1 write must not roll in-memory v2 state backward while storage IPC is slow.
      if (activeRevision && revision !== activeRevision) return
      if (!activeRevision) activeRevision = revision
      const stored = await storageApi.get([storageKey])
      if (activeRevision !== revision) return
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
      const entries = boundedPersistentEntries(Array.from(merged.entries()), revision)
      if (activeRevision !== revision) return
      await storageApi.set({
        [storageKey]: {
          schema_version: 1,
          revision,
          entries,
        },
      })
    }

    function schedulePersistentWrite(revisionHint = "") {
      if (!storageApi?.get || !storageApi?.set) return null
      persistenceDirty = true
      persistenceRevisionHint = normalizeRevision(revisionHint) || persistenceRevisionHint
      if (persistencePromise) return persistencePromise

      // Persistence protects the next navigation; it must never hold the current
      // hover open. Serialize and coalesce writes in the background so a burst of
      // warm batches does not repeatedly rewrite the bounded 4 MiB cache.
      persistencePromise = new Promise((resolve) => deferPersistenceTask(resolve))
        .then(async () => {
          while (persistenceDirty) {
            persistenceDirty = false
            const revision = persistenceRevisionHint
            persistenceRevisionHint = ""
            await persistResolvedRecords(revision)
          }
        })
        .catch((err) => onError(err))
        .finally(() => {
          persistencePromise = null
          if (persistenceDirty) schedulePersistentWrite(persistenceRevisionHint)
        })
      return persistencePromise
    }

    async function flushPersistence() {
      while (persistencePromise) await persistencePromise
    }

    function linkedAbortController(externalSignal) {
      const controller = typeof AbortController === "function" ? new AbortController() : null
      if (!controller || !externalSignal) return { controller, unlink: () => {} }
      const abort = () => controller.abort()
      if (externalSignal.aborted) abort()
      else externalSignal.addEventListener("abort", abort, { once: true })
      return {
        controller,
        unlink: () => externalSignal.removeEventListener?.("abort", abort),
      }
    }

    async function fetchImmutableDetail(symbol, revision, options = {}) {
      const requestSerial = ++nextRequestSerial
      const linked = linkedAbortController(options.signal)
      const timer = windowRef.setTimeout(() => linked.controller?.abort(), requestTimeoutMs)
      try {
        const url = detailUrlForSymbol ? detailUrlForSymbol(symbol, revision) : ""
        if (!fetchImpl || !url) throw new Error("Immutable gene detail fetch is not configured")
        const resp = await fetchImpl(url, {
          method: "GET",
          ...(linked.controller ? { signal: linked.controller.signal } : {}),
        })
        if (!resp.ok && Number(resp.status || 0) !== 404) {
          throw new Error("HTTP " + String(resp.status || 0))
        }
        const payload = (await resp.json()) || {}
        const responseRevision = normalizeRevision(payload.snapshot_version)
        if (responseRevision && responseRevision !== revision) {
          throw new Error("Published detail revision mismatch")
        }
        if (requestSerial < latestAdoptedResponseSerial && activeRevision !== revision) return null
        latestAdoptedResponseSerial = Math.max(latestAdoptedResponseSerial, requestSerial)
        const record = payload.gene && typeof payload.gene === "object" ? payload.gene : null
        if (record) {
          rememberRecord(symbol, record)
          onResolvedBatch([record], options.priority || "foreground")
        } else if (Array.isArray(payload.missing) && payload.missing.includes(symbol)) {
          cache.set(symbol, null)
        }
        schedulePersistentWrite(revision)
        return record
      } finally {
        windowRef.clearTimeout(timer)
        linked.unlink()
      }
    }

    async function fetchLegacyBatch(unresolvedSymbols, options = {}) {
      const requestSerial = ++nextRequestSerial
      const linked = linkedAbortController(options.signal)
      const timer = windowRef.setTimeout(() => linked.controller?.abort(), requestTimeoutMs)
      try {
        if (!fetchImpl || !batchUrl) throw new Error("Gene detail fetch is not configured")
        const resp = await fetchImpl(batchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: unresolvedSymbols, fields }),
          ...(linked.controller ? { signal: linked.controller.signal } : {}),
        })
        if (!resp.ok) throw new Error("HTTP " + String(resp.status || 0))
        const payload = (await resp.json()) || {}
        const responseRevision = normalizeRevision(payload.snapshot_version)
        const changesRevision =
          responseRevision && activeRevision && responseRevision !== activeRevision
        if (changesRevision && requestSerial < latestAdoptedResponseSerial) return
        if (responseRevision) {
          if (changesRevision) cache.clear()
          activeRevision = responseRevision
          latestAdoptedResponseSerial = Math.max(latestAdoptedResponseSerial, requestSerial)
        }
        const genes = Array.isArray(payload.genes) ? payload.genes : []
        for (const record of genes) {
          const symbol = normalizeSymbol(record && record.symbol)
          if (symbol && record && typeof record === "object") rememberRecord(symbol, record)
        }
        if (genes.length) onResolvedBatch(genes, options.priority || "foreground")
        for (const rawMissing of Array.isArray(payload.missing) ? payload.missing : []) {
          const symbol = normalizeSymbol(rawMissing)
          if (symbol) cache.set(symbol, null)
        }
        schedulePersistentWrite(responseRevision)
      } finally {
        windowRef.clearTimeout(timer)
        linked.unlink()
      }
    }

    async function fetchBatch(symbols, options = {}) {
      const priority = options.priority === "foreground" ? "foreground" : "background"
      if (priority === "background") await hydratePersistentCache()
      const uniqueSymbols = []
      const seenSymbols = new Set()
      for (const rawSymbol of Array.isArray(symbols) ? symbols : []) {
        const symbol = normalizeSymbol(rawSymbol)
        if (!symbol || seenSymbols.has(symbol)) continue
        seenSymbols.add(symbol)
        uniqueSymbols.push(symbol)
      }

      const unresolvedSymbols = uniqueSymbols.filter((symbol) => !cache.has(symbol))

      if (unresolvedSymbols.length) {
        const revision = activeRevision || (await resolveRevision())
        if (revision && !activeRevision) activeRevision = revision
        if (detailUrlForSymbol && revision) {
          for (const symbol of unresolvedSymbols) {
            const existing = requestStateBySymbol.get(symbol)
            if (existing && (priority === "background" || existing.priority === "foreground")) {
              continue
            }
            if (existing) existing.controller?.abort()
            const controller = typeof AbortController === "function" ? new AbortController() : null
            const forwardAbort = () => controller?.abort()
            if (options.signal?.aborted) forwardAbort()
            else options.signal?.addEventListener?.("abort", forwardAbort, { once: true })
            const request = fetchImmutableDetail(symbol, revision, {
              priority,
              ...(controller ? { signal: controller.signal } : {}),
            })
              .catch((err) => {
                if (err?.name !== "AbortError") onError(err)
                return null
              })
              .finally(() => {
                if (promiseCache.get(symbol) === request) promiseCache.delete(symbol)
                if (requestStateBySymbol.get(symbol)?.promise === request) {
                  requestStateBySymbol.delete(symbol)
                }
                options.signal?.removeEventListener?.("abort", forwardAbort)
              })
            promiseCache.set(symbol, request)
            requestStateBySymbol.set(symbol, { controller, priority, promise: request })
          }
        } else {
          const batchRequest = fetchLegacyBatch(unresolvedSymbols, { ...options, priority }).catch(
            (err) => {
              if (err?.name !== "AbortError") onError(err)
            },
          )
          for (const symbol of unresolvedSymbols) {
            const symbolRequest = batchRequest
              .then(() => cache.get(symbol) || null)
              .finally(() => {
                if (promiseCache.get(symbol) === symbolRequest) promiseCache.delete(symbol)
              })
            promiseCache.set(symbol, symbolRequest)
          }
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
          await fetchBatch(batch, { priority: "background" })
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
        if (seen.size >= max) break
        seen.add(symbol)
        if (cache.has(symbol)) continue
        if (promiseCache.has(symbol) || queuedSymbols.has(symbol)) continue
        uniqueSymbols.push(symbol)
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
      requestStateBySymbol,
      fetchBatch,
      warm,
      scheduleWarm,
      has: (symbol) => cache.has(normalizeSymbol(symbol)),
      get: (symbol) => cache.get(normalizeSymbol(symbol)) || null,
      hydratePersistentCache,
      persistResolvedRecords,
      flushPersistence,
      setRevision,
      persistentByteLimit,
      persistentPayloadBytes: () =>
        utf8ByteLength(
          JSON.stringify({
            schema_version: 1,
            revision: activeRevision,
            entries: boundedPersistentEntries(Array.from(cache.entries()), activeRevision),
          }),
        ),
    }
  }

  root.IconoplasmContentDetailCache = {
    createGeneDetailStore,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
