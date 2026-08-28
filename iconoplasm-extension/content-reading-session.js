;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: hover is a selector, not a loader. A reading
  // session prepares immutable cards from the recognized document inventory and
  // deterministic visible windows before pointer intent exists, but only after
  // the host page has loaded and yielded an idle turn.

  const PRIORITY = Object.freeze({ active: 0, visible: 1, document: 2 })

  function finiteNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function workingSetPolicy(connection = {}, deviceMemory = 0) {
    const effectiveType = String(connection?.effectiveType || "").toLowerCase()
    const saveData = Boolean(connection?.saveData)
    const memory = Math.max(0, finiteNumber(deviceMemory))
    if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
      return Object.freeze({
        speculative: false,
        concurrency: 1,
        documentLimit: 0,
        visibleLimit: 0,
      })
    }
    // RTT and Chrome's broad effective-type estimate are not a byte budget.
    // Serializing an entire locator -> image -> detail pipeline on a high-RTT
    // connection made every next gene cold. Overlap a bounded working window;
    // explicit Data Saver/2G still disables speculation above.
    if (memory > 0 && memory <= 2) {
      return Object.freeze({
        speculative: true,
        concurrency: 2,
        documentLimit: 10,
        visibleLimit: 10,
      })
    }
    return Object.freeze({
      speculative: true,
      concurrency: 10,
      documentLimit: 10,
      visibleLimit: 10,
    })
  }

  function normalizeSymbol(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
  }

  function createReadingSession(options = {}) {
    const windowRef = options.windowRef || root
    const documentRef = options.documentRef || windowRef.document || root.document
    const prepareSymbol =
      typeof options.prepareSymbol === "function" ? options.prepareSymbol : async () => null
    const onError = typeof options.onError === "function" ? options.onError : () => {}
    const isPrepared = typeof options.isPrepared === "function" ? options.isPrepared : () => true
    const viewportHeight =
      typeof options.viewportHeight === "function"
        ? options.viewportHeight
        : () => finiteNumber(windowRef.innerHeight)
    const now = typeof options.now === "function" ? options.now : () => Date.now()
    const retryAfter = new Map()
    const rootMarginPx = Math.max(0, finiteNumber(options.rootMarginPx, 960))
    const documentSymbols = new Set()
    const visibleAnchors = new Set()
    const anchorGroups = new Map()
    const anchorSymbols = new WeakMap()
    const queuedBySymbol = new Map()
    const inFlightSymbols = new Set()
    const readySymbols = new Set()
    let queueSerial = 0
    let activeWorkers = 0
    let documentFlushScheduled = false
    let speculationStarted = false
    let disposed = false
    let viewportFrame = 0
    let viewportRefreshEvicted = false
    let policy = workingSetPolicy(options.connection, options.deviceMemory)

    const observer =
      typeof windowRef.IntersectionObserver === "function"
        ? new windowRef.IntersectionObserver(
            (entries) => {
              if (disposed) return
              let changed = false
              for (const entry of entries || []) {
                const anchor = entry?.target
                if (!anchorSymbols.has(anchor)) continue
                if (entry.isIntersecting) {
                  visibleAnchors.add(anchor)
                  changed = true
                } else {
                  visibleAnchors.delete(anchor)
                  changed = true
                }
              }
              if (changed) prepareVisibleWindow()
            },
            { root: null, rootMargin: `${rootMarginPx}px 0px ${rootMarginPx}px 0px` },
          )
        : null

    function queueSymbols(rawSymbols, tier = "document") {
      if (disposed) return
      if (tier !== "active" && (!policy.speculative || !speculationStarted)) return
      const priority = PRIORITY[tier] ?? PRIORITY.document
      for (const rawSymbol of Array.isArray(rawSymbols) ? rawSymbols : []) {
        const symbol = normalizeSymbol(rawSymbol)
        if (!symbol || inFlightSymbols.has(symbol)) continue
        if (tier !== "active" && (retryAfter.get(symbol)?.at || 0) > now()) continue
        // A completed attempt is not permanent readiness. The bounded portrait
        // LRU can evict it, and a partial/failed image load is not a warm card.
        // Recheck only on real inventory/viewport/active events: never retry in
        // a timer loop or expand the working set to hide a benchmark failure.
        if (readySymbols.has(symbol) && isPrepared(symbol)) continue
        readySymbols.delete(symbol)
        const queued = queuedBySymbol.get(symbol)
        if (queued) {
          if (priority < queued.priority) {
            queued.priority = priority
            queued.tier = tier
          }
          if (tier === "visible" && queued.tier === "visible") queued.serial = queueSerial++
          continue
        }
        queuedBySymbol.set(symbol, { symbol, priority, tier, serial: queueSerial++ })
      }
      drain()
    }

    function nextQueued() {
      let selected = null
      for (const queued of queuedBySymbol.values()) {
        if (
          !selected ||
          queued.priority < selected.priority ||
          (queued.priority === selected.priority && queued.serial < selected.serial)
        ) {
          selected = queued
        }
      }
      if (selected) queuedBySymbol.delete(selected.symbol)
      return selected
    }

    function drain() {
      while (!disposed && activeWorkers < policy.concurrency && queuedBySymbol.size) {
        const queued = nextQueued()
        if (!queued) return
        activeWorkers += 1
        inFlightSymbols.add(queued.symbol)
        Promise.resolve(prepareSymbol(queued.symbol, { tier: queued.tier }))
          .then((result) => {
            if (disposed) return
            if (result && isPrepared(queued.symbol)) {
              readySymbols.add(queued.symbol)
              retryAfter.delete(queued.symbol)
            } else recordPreparationFailure(queued.symbol)
          })
          .catch((error) => {
            if (!disposed) recordPreparationFailure(queued.symbol)
            onError(error, queued.symbol)
          })
          .finally(() => {
            activeWorkers -= 1
            inFlightSymbols.delete(queued.symbol)
            drain()
            // Completing a window must expose the next visible cold symbols,
            // even when the reader has not scrolled. This is progress-driven,
            // not a timer: automatic refills never retry an attempted symbol.
            scheduleVisibleWindow(false)
          })
      }
    }

    function recordPreparationFailure(symbol) {
      const failures = Math.min(5, (retryAfter.get(symbol)?.failures || 0) + 1)
      // Scroll events are frequent. A failed source may retry on a later real
      // event, never every animation frame and never on a polling timer.
      retryAfter.set(symbol, { failures, at: now() + Math.min(60000, 5000 * 2 ** (failures - 1)) })
    }

    function prepareDocumentInventory() {
      documentFlushScheduled = false
      if (!speculationStarted || !policy.speculative || documentRef?.visibilityState === "hidden") {
        return
      }
      queueSymbols(Array.from(documentSymbols).slice(0, policy.documentLimit), "document")
    }

    function scheduleDocumentInventory() {
      if (documentFlushScheduled) return
      documentFlushScheduled = true
      Promise.resolve().then(prepareDocumentInventory)
    }

    function prepareVisibleWindow(refreshEvicted = true) {
      if (!speculationStarted || !policy.speculative || documentRef?.visibilityState === "hidden") {
        return
      }
      const candidates = new Map()
      const height = viewportHeight()
      for (const anchor of visibleAnchors) {
        const symbol = anchorSymbols.get(anchor)
        // Ready sticky headers/sidebar aliases used to occupy all ten slots
        // forever, starving actual article text with an entirely empty queue.
        if (!symbol || (readySymbols.has(symbol) && (!refreshEvicted || isPrepared(symbol))))
          continue
        if (!refreshEvicted && retryAfter.has(symbol)) continue
        if ((retryAfter.get(symbol)?.at || 0) > now()) continue
        const rect = anchor.getBoundingClientRect?.()
        if (rect && (!rect.width || !rect.height)) continue
        const distance = rect && height ? Math.max(0, -rect.bottom, rect.top - height) : 0
        const centerDistance = rect && height ? Math.abs((rect.top + rect.bottom - height) / 2) : 0
        const rank = { symbol, distance, centerDistance }
        const previous = candidates.get(symbol)
        if (
          !previous ||
          distance < previous.distance ||
          (distance === previous.distance && centerDistance < previous.centerDistance)
        )
          candidates.set(symbol, rank)
      }
      const symbols = [...candidates.values()]
        .sort((a, b) => a.distance - b.distance || a.centerDistance - b.centerDistance)
        .slice(0, policy.visibleLimit)
        .map((candidate) => candidate.symbol)
      const selected = new Set(symbols)
      for (const [symbol, queued] of queuedBySymbol) {
        if (queued.tier === "visible" && !selected.has(symbol)) queuedBySymbol.delete(symbol)
      }
      queueSymbols(symbols, "visible")
    }

    function scheduleVisibleWindow(refreshEvicted = true) {
      if (disposed || !speculationStarted || !policy.speculative) return
      // DOM events pass an Event object; only an explicit false denotes a
      // completion refill. A real viewport event wins when callbacks coalesce.
      viewportRefreshEvicted ||= refreshEvicted !== false
      if (viewportFrame) return
      if (typeof windowRef.requestAnimationFrame !== "function") {
        const refresh = viewportRefreshEvicted
        viewportRefreshEvicted = false
        prepareVisibleWindow(refresh)
        return
      }
      // IO observes a wide prefetch margin; scrolling within it may cross no IO
      // threshold. Re-rank once per scroll frame, never by pointer trajectory or
      // scroll direction. Geometry reads are batched before starting any work.
      viewportFrame = windowRef.requestAnimationFrame(() => {
        viewportFrame = 0
        const refresh = viewportRefreshEvicted
        viewportRefreshEvicted = false
        if (!disposed) prepareVisibleWindow(refresh)
      })
    }

    function onVisibilityChange() {
      if (documentRef?.visibilityState !== "visible" || disposed) return
      scheduleDocumentInventory()
      scheduleVisibleWindow()
    }

    documentRef?.addEventListener?.("scroll", scheduleVisibleWindow, {
      capture: true,
      passive: true,
    })
    documentRef?.addEventListener?.("visibilitychange", onVisibilityChange)

    function registerAnchor(anchor) {
      if (disposed) return false
      const symbol = normalizeSymbol(anchor?.dataset?.gene)
      if (!anchor || !symbol) return false
      if (anchorSymbols.has(anchor)) return true
      anchorSymbols.set(anchor, symbol)
      documentSymbols.add(symbol)
      observer?.observe(anchor)
      scheduleDocumentInventory()
      return true
    }

    function unregisterAnchor(anchor) {
      if (!anchor || !anchorSymbols.has(anchor)) return
      visibleAnchors.delete(anchor)
      anchorSymbols.delete(anchor)
      observer?.unobserve(anchor)
    }

    function replaceAnchorGroup(groupId, anchors) {
      const key = String(groupId || "")
      const previous = anchorGroups.get(key) || []
      for (const anchor of previous) unregisterAnchor(anchor)
      const next = Array.isArray(anchors) ? anchors.filter(registerAnchor) : []
      if (next.length) anchorGroups.set(key, next)
      else anchorGroups.delete(key)
      prepareVisibleWindow()
    }

    function updateConnection(connection, deviceMemory) {
      if (disposed) return
      policy = workingSetPolicy(connection, deviceMemory)
      if (!policy.speculative) {
        for (const [symbol, queued] of queuedBySymbol) {
          if (queued.priority !== PRIORITY.active) queuedBySymbol.delete(symbol)
        }
        return
      }
      scheduleDocumentInventory()
      prepareVisibleWindow()
      drain()
    }

    return Object.freeze({
      dispose() {
        disposed = true
        documentRef?.removeEventListener?.("scroll", scheduleVisibleWindow, { capture: true })
        documentRef?.removeEventListener?.("visibilitychange", onVisibilityChange)
        if (viewportFrame) windowRef.cancelAnimationFrame?.(viewportFrame)
        observer?.disconnect()
        queuedBySymbol.clear()
        visibleAnchors.clear()
        documentSymbols.clear()
        anchorGroups.clear()
        readySymbols.clear()
        retryAfter.clear()
      },
      registerAnchor,
      unregisterAnchor,
      replaceAnchorGroup,
      prioritize(symbol) {
        queueSymbols([symbol], "active")
      },
      updateConnection,
      startSpeculation() {
        if (disposed || speculationStarted) return
        speculationStarted = true
        scheduleDocumentInventory()
        prepareVisibleWindow()
      },
      isReady(symbol) {
        const normalized = normalizeSymbol(symbol)
        return readySymbols.has(normalized) && isPrepared(normalized)
      },
      inspectSymbol(rawSymbol) {
        // Read-only diagnostics: do not call queueSymbols, touch cache recency,
        // or wake preparation merely because a benchmark is observing it.
        const symbol = normalizeSymbol(rawSymbol)
        return Object.freeze({
          speculationStarted,
          policy,
          inventoried: documentSymbols.has(symbol),
          queued: queuedBySymbol.has(symbol),
          inFlight: inFlightSymbols.has(symbol),
          prepared: readySymbols.has(symbol) && isPrepared(symbol),
          queueSize: queuedBySymbol.size,
          activeWorkers,
          retryAfterMs: Math.max(0, (retryAfter.get(symbol)?.at || 0) - now()),
        })
      },
      snapshot() {
        return Object.freeze({
          policy,
          speculationStarted,
          documentSymbols: Array.from(documentSymbols),
          readySymbols: Array.from(readySymbols).filter(isPrepared),
          queuedSymbols: Array.from(queuedBySymbol.keys()),
          inFlightSymbols: Array.from(inFlightSymbols),
        })
      },
    })
  }

  root.IconoplasmReadingSession = Object.freeze({ createReadingSession, workingSetPolicy })
})(typeof globalThis !== "undefined" ? globalThis : this)
