import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { createCollectionFeedController } from "./collection-feed.js"

class FakeIntersectionObserver {
  static instances = []

  constructor(callback, options) {
    this.callback = callback
    this.options = options
    this.targets = new Set()
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target) {
    this.targets.add(target)
  }

  unobserve(target) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  intersect(target) {
    this.callback([{ target, isIntersecting: true }])
  }

  leave(target) {
    this.callback([{ target, isIntersecting: false }])
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fixture(overrides = {}) {
  FakeIntersectionObserver.instances = []
  const { document, window } = parseHTML(
    '<div id="feed"></div><span id="status"></span><button id="retry" hidden>Retry</button>',
  )
  window.innerHeight = 600
  window.scrollBy = () => {}
  window.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  window.cancelAnimationFrame = () => {}
  const feed = document.getElementById("feed")
  feed.setAttribute("role", "feed")
  const status = document.getElementById("status")
  const retryButton = document.getElementById("retry")
  let batch = 0
  const controller = createCollectionFeedController({
    feed,
    status,
    retryButton,
    window,
    document,
    IntersectionObserver: FakeIntersectionObserver,
    ResizeObserver: FakeResizeObserver,
    initialPageSize: 4,
    pageSize: () => 12,
    mountedCardLimit: () => 48,
    requestPage: async ({ offset, limit }) => {
      batch += 1
      return {
        startIndex: offset,
        total: 1500,
        items: Array.from({ length: limit }, (_, index) => ({ symbol: `G${offset + index}` })),
        hasMore: batch < 110,
        nextCursor: `cursor-${batch}`,
        snapshotVersion: "v1",
      }
    },
    renderSegment(element, items, startIndex) {
      element.getBoundingClientRect = () => ({
        top: startIndex * 100,
        bottom: startIndex * 100 + items.length * 80,
        height: items.length * 80,
      })
      for (const [offset, item] of items.entries()) {
        const card = document.createElement("article")
        card.className = "icono-card"
        card.setAttribute("data-icono-symbol", item.symbol)
        card.getBoundingClientRect = () => ({
          top: (startIndex + offset) * 100,
          bottom: (startIndex + offset) * 100 + 80,
          height: 80,
        })
        element.appendChild(card)
      }
    },
    ...overrides,
  })
  return { controller, document, window, feed, status, retryButton }
}

function prefetchObserver() {
  return FakeIntersectionObserver.instances.find(
    (observer) => observer.options.rootMargin === "200% 0px",
  )
}

test("automatically loads at the two-viewport boundary and joins duplicate requests", async () => {
  let resolveRequest
  let requestCount = 0
  const setup = fixture({
    requestPage: () => {
      requestCount += 1
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    },
  })
  const first = setup.controller.reset()
  const sentinel = setup.feed.querySelector('[data-icono-feed-sentinel="forward"]')
  prefetchObserver().intersect(sentinel)
  assert.equal(requestCount, 1)
  resolveRequest({ items: [], total: 0, hasMore: false })
  await first
  assert.equal(setup.feed.getAttribute("role"), "feed")
  assert.equal(setup.feed.getAttribute("aria-busy"), "false")
  setup.controller.dispose()
})

test("decorates cards as WAI feed articles and supports Page Down traversal", async () => {
  const setup = fixture()
  setup.feed.setAttribute("role", "feed")
  await setup.controller.reset()
  const cards = setup.feed.querySelectorAll(".icono-card")
  assert.equal(cards.length, 4)
  assert.equal(cards[0].getAttribute("role"), "article")
  assert.equal(cards[0].getAttribute("aria-posinset"), "1")
  assert.equal(cards[0].getAttribute("aria-setsize"), "1500")
  assert.match(setup.status.textContent, /Loaded 4 genes/)
  cards[0].focus()
  let focusedPosition = ""
  cards[3].focus = () => {
    focusedPosition = cards[3].getAttribute("aria-posinset")
  }
  const pageDown = new setup.window.Event("keydown", { cancelable: true })
  Object.defineProperty(pageDown, "key", { value: "PageDown" })
  setup.feed.dispatchEvent(pageDown)
  assert.equal(focusedPosition, "4")
  setup.controller.dispose()
})

test("keeps mounted cards and payloads bounded after more than 100 batches", async () => {
  const setup = fixture()
  await setup.controller.reset()
  const observer = prefetchObserver()
  const sentinel = setup.feed.querySelector('[data-icono-feed-sentinel="forward"]')
  for (let index = 0; index < 104; index += 1) {
    observer.intersect(sentinel)
    await nextTask()
    const spacers = Array.from(setup.feed.querySelectorAll(".icono-feed-spacer"))
    const newestSpacer = spacers[spacers.length - 1]
    if (newestSpacer) {
      const mountObserver = FakeIntersectionObserver.instances.find(
        (candidate) => candidate.options.rootMargin === "100% 0px",
      )
      mountObserver.intersect(newestSpacer)
      await nextTask()
    }
  }
  const state = setup.controller.debugState()
  assert.ok(state.segmentCount >= 100)
  assert.ok(state.mountedCards <= 48)
  assert.ok(state.mountedCards >= 28)
  assert.ok(state.cachedPayloads <= 8)
  setup.controller.dispose()
})

test("loads backward from a restored cursor when the top boundary approaches", async () => {
  const requests = []
  const setup = fixture({
    requestPage: async (request) => {
      requests.push(request)
      return {
        items: Array.from({ length: 4 }, (_, index) => ({ symbol: `G${request.offset + index}` })),
        startIndex: request.offset,
        total: 20,
        hasPrevious: request.direction === "forward",
        previousCursor: "previous-page",
        hasMore: request.direction === "backward",
        nextCursor: "next-page",
      }
    },
  })
  await setup.controller.reset({ offset: 8, cursor: "restored-page", page: 3 })
  assert.equal(requests[0].limit, 12)
  const topSentinel = setup.feed.querySelector('[data-icono-feed-sentinel="backward"]')
  prefetchObserver().intersect(topSentinel)
  await nextTask()
  assert.equal(requests.length, 1)
  prefetchObserver().leave(topSentinel)
  prefetchObserver().intersect(topSentinel)
  await nextTask()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].direction, "backward")
  assert.equal(requests[1].cursor, "previous-page")
  assert.equal(requests[1].offset, 0)
  setup.controller.dispose()
})

test("snapshots the exact card chosen for gene navigation", async () => {
  const setup = fixture()
  await setup.controller.reset()
  await setup.controller.loadNext()
  const spacer = setup.feed.querySelector('.icono-feed-spacer[data-icono-feed-start="4"]')
  const mountObserver = FakeIntersectionObserver.instances.find(
    (candidate) => candidate.options.rootMargin === "100% 0px",
  )
  mountObserver.intersect(spacer)
  await nextTask()
  const target = setup.feed.querySelector('[data-icono-symbol="G8"]')
  const snapshot = setup.controller.snapshot(target)

  assert.equal(snapshot.page, 2)
  assert.equal(snapshot.cursor, "cursor-1")
  assert.equal(snapshot.offset, 4)
  assert.equal(snapshot.anchorGene, "G8")
  assert.equal(snapshot.anchorTop, 800)
  setup.controller.dispose()
})

test("aborts obsolete work when the feed resets", async () => {
  const signals = []
  const setup = fixture({
    requestPage: ({ signal }) => {
      signals.push(signal)
      return new Promise(() => {})
    },
  })
  void setup.controller.reset()
  void setup.controller.reset()
  assert.equal(signals[0].aborted, true)
  setup.controller.dispose()
})

test("stops on failure, exposes one retry action, and detects snapshot changes", async () => {
  let attempt = 0
  const setup = fixture({
    requestPage: async ({ offset }) => {
      attempt += 1
      if (attempt === 1) throw new Error("offline")
      return {
        items: [{ symbol: `G${offset}` }],
        startIndex: offset,
        total: 2,
        hasMore: attempt < 3,
        nextCursor: `c${attempt}`,
        snapshotVersion: attempt === 2 ? "v1" : "v2",
      }
    },
  })
  await setup.controller.reset()
  assert.equal(setup.retryButton.hidden, false)
  assert.match(setup.status.textContent, /Loading stopped/)
  await setup.controller.retry()
  assert.equal(setup.retryButton.hidden, true)
  await setup.controller.loadNext()
  assert.equal(setup.retryButton.textContent, "Refresh collection")
  assert.match(setup.status.textContent, /catalog changed/i)
  setup.controller.dispose()
})
