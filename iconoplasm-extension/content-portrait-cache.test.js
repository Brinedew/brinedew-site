import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: bounded neighbor warming is useful only when
// each successful portrait becomes paint-ready without waiting for its batch.

const source = await readFile(new URL("./content-portrait-cache.js", import.meta.url), "utf8")

function loadFactory() {
  const sandbox = { AbortController, console, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentPortraitCache.createPortraitCache
}

test("a fast neighbor starts decoding before the slowest portrait in its batch", async () => {
  const createPortraitCache = loadFactory()
  let releaseSlow
  let resolveFastWarm
  let resolveSlowWarm
  const fastWarm = new Promise((resolve) => {
    resolveFastWarm = resolve
  })
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve
  })
  const slowWarm = new Promise((resolve) => {
    resolveSlowWarm = resolve
  })
  const warmed = []
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      const url = String(message.url || "")
      if (url.endsWith("slow.webp")) {
        void slowGate.then(() => callback({ ok: true, dataUrl: "data:image/webp;base64,slow" }))
        return
      }
      queueMicrotask(() => callback({ ok: true, dataUrl: "data:image/webp;base64,fast" }))
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
    batchSize: 2,
    onWarmSource(source, originalUrl) {
      warmed.push([source, originalUrl])
      if (originalUrl.endsWith("fast.webp")) resolveFastWarm()
      if (originalUrl.endsWith("slow.webp")) resolveSlowWarm()
    },
  })

  cache.warmUrls(["https://example.test/fast.webp", "https://example.test/slow.webp"])
  await fastWarm

  assert.equal(
    JSON.stringify(warmed),
    JSON.stringify([["data:image/webp;base64,fast", "https://example.test/fast.webp"]]),
  )

  releaseSlow()
  await slowWarm
  assert.equal(
    JSON.stringify(warmed),
    JSON.stringify([
      ["data:image/webp;base64,fast", "https://example.test/fast.webp"],
      ["data:image/webp;base64,slow", "https://example.test/slow.webp"],
    ]),
  )
})

test("concurrent hover and prewarm requests share one portrait transfer", async () => {
  const createPortraitCache = loadFactory()
  let sendCount = 0
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN") {
        queueMicrotask(() => callback({ ok: false }))
        return
      }
      sendCount += 1
      queueMicrotask(() => callback({ ok: true, dataUrl: "data:image/webp;base64,shared" }))
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
  })

  const [left, right] = await Promise.all([
    cache.getUsableSrc("https://example.test/shared.webp"),
    cache.getUsableSrc("https://example.test/shared.webp"),
  ])

  assert.equal(left, "data:image/webp;base64,shared")
  assert.equal(right, left)
  assert.equal(sendCount, 1)
})

test("portrait data URLs use a bounded LRU and cached neighbors are announced for decode", async () => {
  const createPortraitCache = loadFactory()
  let sendCount = 0
  const warmed = []
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN") {
        callback({ ok: false })
        return
      }
      sendCount += 1
      callback({ ok: true, dataUrl: `data:image/webp;base64,${message.url.at(-1)}` })
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
    dataUrlCacheLimit: 2,
    onWarmSource(source, url) {
      warmed.push([source, url])
    },
  })
  const a = "https://example.test/a"
  const b = "https://example.test/b"
  const c = "https://example.test/c"

  await cache.getUsableSrc(a)
  await cache.getUsableSrc(b)
  await cache.getUsableSrc(a)
  await cache.getUsableSrc(c)

  assert.deepEqual(Array.from(cache.dataUrlCache.keys()), [a, c])
  cache.warmUrls([a])
  assert.deepEqual(warmed, [["data:image/webp;base64,a", a]])
  assert.equal(sendCount, 3)
})

test("new hover intent drops queued stale neighbors while active work starts immediately", async () => {
  const createPortraitCache = loadFactory()
  const requested = []
  const releases = new Map()
  let resolveThirdRequest
  const thirdRequest = new Promise((resolve) => {
    resolveThirdRequest = resolve
  })
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN") {
        queueMicrotask(() => callback({ ok: false }))
        return
      }
      requested.push(message.url)
      if (requested.length === 3) resolveThirdRequest()
      releases.set(message.url, () =>
        callback({ ok: true, dataUrl: `data:image/webp;base64,${message.url}` }),
      )
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
    batchSize: 1,
    delayMs: 0,
  })
  const staleRunning = "https://example.test/a-1.webp"
  const staleQueued = "https://example.test/a-2.webp"
  const active = "https://example.test/d.webp"
  const currentNeighbor = "https://example.test/d-1.webp"

  cache.warmUrls([staleRunning, staleQueued])
  await new Promise((resolve) => setImmediate(resolve))
  const activePromise = cache.getUsableSrc(active)
  cache.replaceWarmUrls([currentNeighbor])
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(requested, [staleRunning, active])
  releases.get(active)()
  await activePromise
  releases.get(staleRunning)()
  await thirdRequest
  assert.deepEqual(requested, [staleRunning, active, currentNeighbor])
  assert.equal(requested.includes(staleQueued), false)
  releases.get(currentNeighbor)()
})

test("regional DNS failure falls through to a native canonical image without base64 transport", async () => {
  const createPortraitCache = loadFactory()
  const messages = []
  const bunny = "https://iconoplasmportraits.b-cdn.net/portraits/v1/a/medium.webp"
  const canonical = "https://iconoplasm.brinedew.bio/portraits/v1/a/medium.webp"
  class FakeImage {
    decode() {
      return Promise.resolve()
    }
    set src(value) {
      this._src = value
      queueMicrotask(() => {
        if (value === bunny) this.onerror?.(new Error("dns"))
        else this.onload?.()
      })
    }
    get src() {
      return this._src
    }
  }
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      messages.push(message)
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN") {
        callback({
          ok: true,
          primaryUrl: bunny,
          fallbackUrl: canonical,
          hedgeDelayMs: 350,
          timeoutMs: 2500,
        })
        return
      }
      if (message.type === "REPORT_PORTRAIT_SOURCE_RESULT") {
        callback({ ok: true })
        return
      }
      callback({ ok: false })
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
    ImageCtor: FakeImage,
  })

  const source = await cache.getUsableSrc(canonical)

  assert.equal(source, canonical)
  assert.deepEqual(
    messages.map((message) => message.type),
    ["GET_PORTRAIT_SOURCE_PLAN", "REPORT_PORTRAIT_SOURCE_RESULT"],
  )
  assert.equal(messages[1].url, canonical)
  assert.equal(messages[1].succeeded, true)
})

test("an unresolved Bunny load starts the canonical hedge before the old 2.5 second timeout", async () => {
  const createPortraitCache = loadFactory()
  const bunny = "https://iconoplasmportraits.b-cdn.net/portraits/v1/b/medium.webp"
  const canonical = "https://iconoplasm.brinedew.bio/portraits/v1/b/medium.webp"
  const started = []
  class FakeImage {
    decode() {
      return Promise.resolve()
    }
    set src(value) {
      started.push(value)
      if (value === canonical) queueMicrotask(() => this.onload?.())
    }
  }
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "GET_PORTRAIT_SOURCE_PLAN") {
        callback({
          ok: true,
          primaryUrl: bunny,
          fallbackUrl: canonical,
          hedgeDelayMs: 5,
          timeoutMs: 2500,
        })
        return
      }
      callback({ ok: true })
    },
  }
  const cache = createPortraitCache({
    windowRef: globalThis,
    chromeApi: { runtime },
    ImageCtor: FakeImage,
  })

  const source = await cache.getUsableSrc(canonical)
  assert.equal(source, canonical)
  assert.deepEqual(started.filter(Boolean), [bunny, canonical])
})
