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
    const rtt = Math.max(0, finiteNumber(connection?.rtt))
    const downlink = Math.max(0, finiteNumber(connection?.downlink))
    const memory = Math.max(0, finiteNumber(deviceMemory))
    if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
      return Object.freeze({
        speculative: false,
        concurrency: 1,
        documentLimit: 0,
        visibleLimit: 0,
      })
    }
    const constrained =
      effectiveType === "3g" || (rtt >= 300 && rtt > 0) || (downlink > 0 && downlink < 1.5)
    if (constrained || (memory > 0 && memory <= 2)) {
      return Object.freeze({
        speculative: true,
        concurrency: 1,
        documentLimit: 10,
        visibleLimit: 10,
      })
    }
    const generous =
      effectiveType === "4g" &&
      rtt > 0 &&
      rtt <= 100 &&
      downlink >= 8 &&
      (memory === 0 || memory >= 4)
    if (generous) {
      return Object.freeze({
        speculative: true,
        concurrency: 2,
        documentLimit: 10,
        visibleLimit: 10,
      })
    }
    return Object.freeze({ speculative: true, concurrency: 2, documentLimit: 10, visibleLimit: 10 })
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
        if (!symbol || readySymbols.has(symbol) || inFlightSymbols.has(symbol)) continue
        const queued = queuedBySymbol.get(symbol)
        if (queued) {
          if (priority < queued.priority) {
            queued.priority = priority
            queued.tier = tier
          }
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
            if (!disposed && result) readySymbols.add(queued.symbol)
          })
          .catch((error) => onError(error, queued.symbol))
          .finally(() => {
            activeWorkers -= 1
            inFlightSymbols.delete(queued.symbol)
            drain()
          })
      }
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

    function prepareVisibleWindow() {
      if (!speculationStarted || !policy.speculative || documentRef?.visibilityState === "hidden") {
        return
      }
      const symbols = []
      const seen = new Set()
      for (const anchor of visibleAnchors) {
        const symbol = anchorSymbols.get(anchor)
        if (!symbol || seen.has(symbol)) continue
        seen.add(symbol)
        symbols.push(symbol)
        if (symbols.length >= policy.visibleLimit) break
      }
      queueSymbols(symbols, "visible")
    }

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
        observer?.disconnect()
        queuedBySymbol.clear()
        visibleAnchors.clear()
        documentSymbols.clear()
        anchorGroups.clear()
        readySymbols.clear()
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
        return readySymbols.has(normalizeSymbol(symbol))
      },
      snapshot() {
        return Object.freeze({
          policy,
          speculationStarted,
          documentSymbols: Array.from(documentSymbols),
          readySymbols: Array.from(readySymbols),
          queuedSymbols: Array.from(queuedBySymbol.keys()),
          inFlightSymbols: Array.from(inFlightSymbols),
        })
      },
    })
  }

  root.IconoplasmReadingSession = Object.freeze({ createReadingSession, workingSetPolicy })
})(typeof globalThis !== "undefined" ? globalThis : this)
