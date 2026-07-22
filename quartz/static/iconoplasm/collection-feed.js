const DEFAULT_PAYLOAD_CACHE_SIZE = 8

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(minimum, Math.min(maximum, parsed))
}

function cardSymbol(card) {
  return String(card?.getAttribute?.("data-icono-symbol") || "")
    .trim()
    .toUpperCase()
}

function cardIndex(card) {
  return Math.max(0, Number.parseInt(card?.getAttribute?.("aria-posinset") || "1", 10) - 1)
}

export function createCollectionFeedController(options) {
  const feed = options.feed
  const status = options.status
  const retryButton = options.retryButton
  const win = options.window || window
  const doc = options.document || document
  const IntersectionObserverImpl = options.IntersectionObserver || win.IntersectionObserver
  const ResizeObserverImpl = options.ResizeObserver || win.ResizeObserver
  const requestPage = options.requestPage
  const renderSegment = options.renderSegment
  const pageSize = options.pageSize
  const mountedCardLimit = options.mountedCardLimit
  const payloadCacheSize = clampInteger(options.payloadCacheSize, 1, 32, DEFAULT_PAYLOAD_CACHE_SIZE)

  if (!feed || !status || !retryButton) throw new Error("Feed controls are required")
  if (typeof requestPage !== "function" || typeof renderSegment !== "function") {
    throw new Error("Feed requestPage and renderSegment callbacks are required")
  }

  let generation = 0
  let disposed = false
  let loading = false
  let stopped = false
  let total = -1
  let discoveredCount = 0
  let nextCursor = ""
  let previousCursor = ""
  let hasMore = true
  let hasPrevious = false
  let snapshotVersion = ""
  let activeRequest = null
  const rehydrationControllers = new Set()
  let segmentSequence = 0
  let segments = []
  let payloadLru = []
  let lastFailure = null
  let prefetchObserver = null
  let mountObserver = null
  let resizeObserver = null
  let scrollFrame = 0

  const forwardSentinel = doc.createElement("div")
  forwardSentinel.className = "icono-feed-sentinel"
  forwardSentinel.setAttribute("data-icono-feed-sentinel", "forward")
  forwardSentinel.setAttribute("aria-hidden", "true")
  const backwardSentinel = doc.createElement("div")
  backwardSentinel.className = "icono-feed-sentinel"
  backwardSentinel.setAttribute("data-icono-feed-sentinel", "backward")
  backwardSentinel.setAttribute("aria-hidden", "true")

  function currentPageSize(initial) {
    if (initial) return clampInteger(options.initialPageSize, 1, 48, 4)
    const value = typeof pageSize === "function" ? pageSize() : pageSize
    return clampInteger(value, 1, 48, 12)
  }

  function currentMountedCardLimit() {
    const value = typeof mountedCardLimit === "function" ? mountedCardLimit() : mountedCardLimit
    return clampInteger(value, 1, 96, 48)
  }

  function setBusy(value) {
    feed.setAttribute("aria-busy", value ? "true" : "false")
    loading = value
  }

  function announce(message, kind) {
    status.textContent = message || ""
    status.setAttribute("data-state", kind || "idle")
  }

  function touchPayload(segment) {
    payloadLru = payloadLru.filter((entry) => entry !== segment)
    payloadLru.push(segment)
    while (segments.filter((entry) => Array.isArray(entry.items)).length > payloadCacheSize) {
      const staleIndex = payloadLru.findIndex(
        (entry) => !entry.mounted && Array.isArray(entry.items),
      )
      if (staleIndex < 0) break
      const stale = payloadLru.splice(staleIndex, 1)[0]
      stale.items = null
    }
  }

  function cardElements(segment) {
    if (!segment?.element) return []
    return Array.from(segment.element.querySelectorAll(".icono-card[data-icono-symbol]"))
  }

  function mountedCards() {
    return segments.reduce((count, segment) => count + (segment.mounted ? segment.count : 0), 0)
  }

  function firstVisibleCard() {
    const cards = Array.from(feed.querySelectorAll(".icono-card[data-icono-symbol]"))
    let fallback = null
    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      if (!fallback && rect.bottom > 0) fallback = card
      if (rect.top >= 0 && rect.top < win.innerHeight) return card
    }
    return fallback
  }

  function captureAnchor() {
    const card = firstVisibleCard()
    if (!card) return null
    return { card, symbol: cardSymbol(card), top: card.getBoundingClientRect().top }
  }

  function restoreAnchor(anchor) {
    if (!anchor?.symbol) return
    const cards = feed.querySelectorAll(".icono-card[data-icono-symbol]")
    for (const card of cards) {
      if (cardSymbol(card) !== anchor.symbol) continue
      const delta = card.getBoundingClientRect().top - anchor.top
      if (Math.abs(delta) > 0.5) win.scrollBy(0, delta)
      return
    }
  }

  function segmentIsProtected(segment) {
    if (!segment.mounted || !segment.element) return true
    if (segment.element.contains(doc.activeElement)) return true
    const anchor = firstVisibleCard()
    return Boolean(anchor && segment.element.contains(anchor))
  }

  function spacerFor(segment) {
    const spacer = doc.createElement("div")
    spacer.className = "icono-feed-spacer"
    spacer.setAttribute("data-icono-feed-segment", segment.id)
    spacer.setAttribute("data-icono-feed-start", String(segment.startIndex))
    spacer.setAttribute("data-icono-feed-count", String(segment.count))
    spacer.setAttribute("aria-hidden", "true")
    spacer.style.height = Math.max(1, Math.round(segment.height || 1)) + "px"
    return spacer
  }

  function evictSegment(segment) {
    if (!segment?.mounted || segmentIsProtected(segment)) return false
    const anchor = captureAnchor()
    const measured = segment.element.getBoundingClientRect().height
    if (measured > 0) segment.height = measured
    const spacer = spacerFor(segment)
    options.onSegmentUnmount?.(segment, segment.element)
    mountObserver?.observe(spacer)
    resizeObserver?.unobserve(segment.element)
    segment.element.replaceWith(spacer)
    segment.element = spacer
    segment.mounted = false
    touchPayload(segment)
    restoreAnchor(anchor)
    return true
  }

  function enforceMountLimit() {
    let excess = mountedCards() - currentMountedCardLimit()
    if (excess <= 0) return
    const viewportCenter = win.innerHeight / 2
    const candidates = segments
      .filter((segment) => segment.mounted && !segmentIsProtected(segment))
      .map((segment) => {
        const rect = segment.element.getBoundingClientRect()
        return { segment, distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter) }
      })
      .sort((left, right) => right.distance - left.distance)
    for (const candidate of candidates) {
      if (excess <= 0) break
      if (evictSegment(candidate.segment)) excess -= candidate.segment.count
    }
  }

  function decorateCards(segment) {
    const cards = cardElements(segment)
    segment.count = cards.length
    cards.forEach((card, offset) => {
      card.setAttribute("role", "article")
      card.setAttribute("aria-posinset", String(segment.startIndex + offset + 1))
      card.setAttribute("aria-setsize", total >= 0 ? String(total) : "-1")
      card.setAttribute("data-icono-feed-card", "")
    })
    return cards
  }

  function createMountedElement(segment) {
    const element = doc.createElement("section")
    element.className = "icono-feed-segment"
    element.setAttribute("data-icono-feed-segment", segment.id)
    element.setAttribute("data-icono-feed-start", String(segment.startIndex))
    element.setAttribute("data-icono-feed-count", String(segment.count))
    element.setAttribute("role", "presentation")
    renderSegment(element, segment.items || [], segment.startIndex, segment)
    segment.element = element
    segment.mounted = true
    decorateCards(segment)
    resizeObserver?.observe(element)
    return element
  }

  function insertSegment(segment, direction) {
    const shouldMount = segments.length === 1
    const element = shouldMount ? createMountedElement(segment) : spacerFor(segment)
    if (!shouldMount) {
      const measuredSegments = segments.filter(
        (entry) => entry !== segment && entry.height > 1 && entry.count > 0,
      )
      const nearest = measuredSegments[measuredSegments.length - 1]
      segment.height = nearest ? nearest.height : Math.max(1, win.innerHeight)
      element.style.height = Math.round(segment.height) + "px"
      segment.element = element
      segment.mounted = false
      mountObserver?.observe(element)
    }
    if (direction === "backward") {
      feed.insertBefore(element, backwardSentinel.nextSibling)
    } else {
      feed.insertBefore(element, forwardSentinel)
    }
    touchPayload(segment)
    if (shouldMount) {
      options.onSegmentMounted?.(segment, cardElements(segment))
      win.requestAnimationFrame(() => {
        if (!segment.mounted) return
        const measured = segment.element.getBoundingClientRect().height
        if (measured > 0) segment.height = measured
        enforceMountLimit()
        emitState()
      })
    }
  }

  async function rehydrateSegment(segment) {
    if (disposed || segment.mounted || segment.rehydrating) return
    segment.rehydrating = true
    const requestGeneration = generation
    const anchor = captureAnchor()
    let controller = null
    try {
      if (!segment.items) {
        controller = new AbortController()
        rehydrationControllers.add(controller)
        const payload = await requestPage({
          direction: segment.direction,
          cursor: segment.requestCursor,
          offset: segment.requestOffset,
          limit: segment.requestLimit,
          signal: controller.signal,
          rehydrate: true,
        })
        if (disposed || requestGeneration !== generation) return
        segment.items = Array.isArray(payload.items) ? payload.items : []
        segment.failures = Array.isArray(payload.failures) ? payload.failures : []
      }
      const old = segment.element
      mountObserver?.unobserve(old)
      const next = createMountedElement(segment)
      old.replaceWith(next)
      touchPayload(segment)
      options.onSegmentMounted?.(segment, cardElements(segment))
      restoreAnchor(anchor)
      enforceMountLimit()
    } catch (error) {
      announce("Could not restore this part of the collection.", "error")
      options.onError?.(error)
    } finally {
      if (controller) rehydrationControllers.delete(controller)
      segment.rehydrating = false
    }
  }

  function emitState() {
    if (typeof options.onStateChange !== "function") return
    const anchor = firstVisibleCard()
    const index = anchor ? cardIndex(anchor) : 0
    const segment = segments.find(
      (entry) => index >= entry.startIndex && index < entry.startIndex + entry.count,
    )
    options.onStateChange({
      page: segment ? segment.page : 1,
      cursor: segment?.requestCursor || "",
      offset: segment?.requestOffset || 0,
      anchorGene: anchor ? cardSymbol(anchor) : "",
      anchorTop: anchor ? anchor.getBoundingClientRect().top : 0,
      loadedCount: segments.reduce((sum, entry) => sum + entry.count, 0),
      total,
      discoveredCount,
      snapshotVersion,
    })
  }

  function applyPayload(payload, request) {
    const incomingSnapshot = String(payload.snapshotVersion || payload.snapshot_version || "")
    if (snapshotVersion && incomingSnapshot && snapshotVersion !== incomingSnapshot) {
      const error = new Error("The catalog changed while you were browsing.")
      error.code = "SNAPSHOT_CHANGED"
      throw error
    }
    if (!snapshotVersion) snapshotVersion = incomingSnapshot
    total = Number.isFinite(Number(payload.total)) ? Math.max(0, Number(payload.total)) : total
    discoveredCount = Number.isFinite(Number(payload.discoveredCount ?? payload.discovered_count))
      ? Math.max(0, Number(payload.discoveredCount ?? payload.discovered_count))
      : discoveredCount
    const items = Array.isArray(payload.items) ? payload.items : []
    const startIndex = Number.isFinite(Number(payload.startIndex))
      ? Math.max(0, Number(payload.startIndex))
      : request.direction === "backward"
        ? Math.max(0, (segments[0]?.startIndex || items.length) - items.length)
        : segments.length
          ? segments[segments.length - 1].startIndex + segments[segments.length - 1].count
          : Math.max(0, Number(request.offset || 0))
    const segment = {
      id: "segment-" + ++segmentSequence,
      page: request.page,
      startIndex,
      count: items.length,
      items,
      failures: Array.isArray(payload.failures) ? payload.failures : [],
      height: 1,
      mounted: false,
      direction: request.direction,
      requestCursor: request.cursor || "",
      requestOffset: Number(request.offset || 0),
      requestLimit: request.limit,
      previousCursor: String(payload.previousCursor ?? payload.previous_cursor ?? ""),
      nextCursor: String(payload.nextCursor ?? payload.next_cursor ?? ""),
    }
    if (request.direction === "backward") segments.unshift(segment)
    else segments.push(segment)
    if (request.direction === "backward") {
      previousCursor = String(payload.previousCursor ?? payload.previous_cursor ?? "")
      hasPrevious = Boolean(payload.hasPrevious ?? payload.has_previous)
    } else {
      if (segments.length === 1) {
        previousCursor = String(payload.previousCursor ?? payload.previous_cursor ?? "")
        hasPrevious = Boolean(payload.hasPrevious ?? payload.has_previous)
      }
      nextCursor = String(payload.nextCursor ?? payload.next_cursor ?? "")
      hasMore = Boolean(payload.hasMore ?? payload.has_more)
    }
    insertSegment(segment, request.direction)
    return segment
  }

  async function load(direction, requestOptions) {
    if (disposed || loading || stopped) return null
    if (direction === "forward" && segments.length && !hasMore) return null
    if (direction === "backward" && segments.length && !hasPrevious) return null
    const requestGeneration = generation
    const initial = segments.length === 0
    const limit = currentPageSize(initial)
    const request = {
      direction,
      cursor:
        requestOptions?.cursor ??
        (direction === "backward" ? previousCursor : initial ? "" : nextCursor),
      offset:
        requestOptions?.offset ??
        (direction === "forward"
          ? segments.length
            ? segments[segments.length - 1].startIndex + segments[segments.length - 1].count
            : 0
          : Math.max(0, (segments[0]?.startIndex || 0) - limit)),
      limit: requestOptions?.limit || limit,
      page:
        requestOptions?.page ||
        (direction === "backward"
          ? Math.max(1, (segments[0]?.page || 2) - 1)
          : segments.length
            ? (segments[segments.length - 1].page || segments.length) + 1
            : 1),
      initial,
    }
    const controller = new AbortController()
    activeRequest = controller
    setBusy(true)
    retryButton.hidden = true
    announce(initial ? "Loading genes…" : "Loading more genes…", "loading")
    lastFailure = null
    try {
      const payload = await requestPage({ ...request, signal: controller.signal })
      if (disposed || requestGeneration !== generation) return null
      const segment = applyPayload(payload || {}, request)
      for (const sentinel of [backwardSentinel, forwardSentinel]) {
        prefetchObserver?.unobserve(sentinel)
        prefetchObserver?.observe(sentinel)
      }
      const count = segment.count
      if (count) {
        const progress =
          total >= 0 ? `${Math.min(total, segment.startIndex + count)} of ${total}.` : ""
        announce(
          `Loaded ${count} ${count === 1 ? "gene" : "genes"}. ${progress}${
            request.direction === "forward" && !hasMore ? " End of collection." : ""
          }`,
          request.direction === "forward" && !hasMore ? "end" : "loaded",
        )
      } else if (!hasMore) {
        announce(total === 0 ? "No genes in this collection." : "End of collection.", "end")
      }
      options.onPage?.(payload, segment)
      emitState()
      return segment
    } catch (error) {
      if (error?.name === "AbortError" || disposed || requestGeneration !== generation) return null
      stopped = true
      lastFailure = { direction, requestOptions }
      retryButton.hidden = false
      if (error?.code === "SNAPSHOT_CHANGED") {
        retryButton.textContent = "Refresh collection"
        announce("The catalog changed. Refresh to continue without mixing versions.", "error")
      } else {
        retryButton.textContent = "Retry"
        announce("Loading stopped. Try again when you’re ready.", "error")
      }
      options.onError?.(error)
      return null
    } finally {
      if (activeRequest === controller) activeRequest = null
      if (!disposed && requestGeneration === generation) setBusy(false)
    }
  }

  function reset(resetOptions) {
    generation += 1
    activeRequest?.abort()
    activeRequest = null
    rehydrationControllers.forEach((controller) => controller.abort())
    rehydrationControllers.clear()
    segments.forEach((segment) => {
      if (segment.mounted) resizeObserver?.unobserve(segment.element)
      else mountObserver?.unobserve(segment.element)
    })
    segments = []
    payloadLru = []
    total = -1
    discoveredCount = 0
    snapshotVersion = ""
    nextCursor = ""
    previousCursor = ""
    hasMore = true
    hasPrevious = false
    stopped = false
    lastFailure = null
    retryButton.hidden = true
    retryButton.textContent = "Retry"
    feed.replaceChildren(backwardSentinel, forwardSentinel)
    setBusy(false)
    loading = false
    return load("forward", resetOptions || {})
  }

  function retry() {
    if (!lastFailure) return null
    if (retryButton.textContent === "Refresh collection") return reset()
    const failure = lastFailure
    stopped = false
    return load(failure.direction, failure.requestOptions)
  }

  function focusRelativePage(direction) {
    const cards = Array.from(feed.querySelectorAll(".icono-card[data-icono-feed-card]"))
    if (!cards.length) return
    const focusedCard = doc.activeElement?.closest?.(".icono-card[data-icono-feed-card]")
    const current = Math.max(
      0,
      focusedCard ? cards.indexOf(focusedCard) : cards.indexOf(firstVisibleCard()),
    )
    const next = Math.max(0, Math.min(cards.length - 1, current + direction))
    const target = cards[next]
    if (!target.hasAttribute("tabindex") && !target.matches("a,button,[tabindex]")) {
      target.setAttribute("tabindex", "-1")
    }
    target.focus({ preventScroll: true })
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: direction > 0 ? "start" : "end" })
    }
  }

  function handleKeydown(event) {
    if (event.key !== "PageDown" && event.key !== "PageUp") return
    event.preventDefault()
    const step = Math.max(1, currentPageSize(false))
    focusRelativePage(event.key === "PageDown" ? step : -step)
  }

  function handleScroll() {
    if (scrollFrame) return
    scrollFrame = win.requestAnimationFrame(() => {
      scrollFrame = 0
      enforceMountLimit()
      emitState()
    })
  }

  if (IntersectionObserverImpl) {
    prefetchObserver = new IntersectionObserverImpl(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          void load(entry.target === backwardSentinel ? "backward" : "forward")
        }
      },
      { root: null, rootMargin: "200% 0px", threshold: 0 },
    )
    mountObserver = new IntersectionObserverImpl(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.getAttribute("data-icono-feed-segment")
          const segment = segments.find((candidate) => candidate.id === id)
          if (segment) void rehydrateSegment(segment)
        }
      },
      { root: null, rootMargin: "100% 0px", threshold: 0 },
    )
    prefetchObserver.observe(backwardSentinel)
    prefetchObserver.observe(forwardSentinel)
  } else {
    throw new Error("IntersectionObserver is required for the gene feed")
  }
  if (ResizeObserverImpl) {
    resizeObserver = new ResizeObserverImpl((entries) => {
      for (const entry of entries) {
        const id = entry.target.getAttribute("data-icono-feed-segment")
        const segment = segments.find((candidate) => candidate.id === id)
        if (segment && entry.contentRect?.height > 0) segment.height = entry.contentRect.height
      }
    })
  }
  retryButton.addEventListener("click", retry)
  feed.addEventListener("keydown", handleKeydown)
  win.addEventListener("scroll", handleScroll, { passive: true })
  feed.replaceChildren(backwardSentinel, forwardSentinel)

  return {
    reset,
    loadNext: () => load("forward"),
    loadPrevious: () => load("backward"),
    retry,
    snapshot: () => {
      let latest = null
      if (typeof options.onStateChange === "function") {
        const anchor = firstVisibleCard()
        latest = {
          page: segments.find((segment) => segment.element?.contains(anchor))?.page || 1,
          cursor:
            segments.find((segment) => segment.element?.contains(anchor))?.requestCursor || "",
          anchorGene: anchor ? cardSymbol(anchor) : "",
          anchorTop: anchor ? anchor.getBoundingClientRect().top : 0,
        }
      }
      return latest || { page: 1, cursor: "", anchorGene: "", anchorTop: 0 }
    },
    debugState: () => ({
      loading,
      stopped,
      total,
      discoveredCount,
      hasMore,
      hasPrevious,
      snapshotVersion,
      segmentCount: segments.length,
      mountedCards: mountedCards(),
      cachedPayloads: segments.filter((segment) => Array.isArray(segment.items)).length,
      segments: segments.map((segment) => ({
        startIndex: segment.startIndex,
        count: segment.count,
        mounted: segment.mounted,
        height: segment.height,
      })),
    }),
    dispose() {
      disposed = true
      generation += 1
      activeRequest?.abort()
      rehydrationControllers.forEach((controller) => controller.abort())
      rehydrationControllers.clear()
      segments.forEach((segment) => {
        if (segment.mounted) options.onSegmentUnmount?.(segment, segment.element)
      })
      prefetchObserver?.disconnect()
      mountObserver?.disconnect()
      resizeObserver?.disconnect()
      retryButton.removeEventListener("click", retry)
      feed.removeEventListener("keydown", handleKeydown)
      win.removeEventListener("scroll", handleScroll)
      if (scrollFrame) win.cancelAnimationFrame(scrollFrame)
    },
  }
}
