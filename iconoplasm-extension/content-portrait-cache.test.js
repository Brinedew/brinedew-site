import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { createPortraitDeliverySession } from "../shared/iconoplasm-portrait/portrait-delivery-core.js"

// ARCHITECTURE FENCE [IPD-008]: bounded reading-session preparation is useful only when
// each successful portrait becomes paint-ready without waiting for its batch.

const source = await readFile(new URL("./content-portrait-cache.js", import.meta.url), "utf8")
const runtimeSource = await readFile(new URL("./content-api.js", import.meta.url), "utf8")

function loadFactory() {
  const sandbox = { AbortController, console, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtimeSource, sandbox)
  vm.runInNewContext(source, sandbox)
  return (options) =>
    sandbox.IconoplasmContentPortraitCache.createPortraitCache({
      ...options,
      sendMessage: sandbox.IconoplasmContentApi.createExtensionRuntimeClient(
        options.chromeApi,
        options,
      ).sendMessage,
    })
}

function deliveryRuntime() {
  const sandbox = { AbortController, console, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentPortraitCache
}

for (const blocked of [false, true]) {
  test(`source-plan loading remembers the working route without duplicate races (blocked=${blocked})`, async () => {
    const session = createPortraitDeliverySession()
    const starts = []
    const { loadPlannedSource } = deliveryRuntime()
    const load = async (url) => {
      starts.push(url)
      if (blocked && url.includes("b-cdn.net")) throw new Error("DNS unavailable")
      return url
    }
    for (let index = 0; index < 10; index++) {
      const url = `https://iconoplasm.brinedew.bio/portraits/v1/${index}/medium.webp`
      const plan = session.plan(url)
      const winner = await loadPlannedSource(plan, load)
      session.reportSuccess(winner, plan.decisionId)
    }
    assert.equal(starts.filter((url) => url.includes("b-cdn.net")).length, blocked ? 1 : 10)
    assert.equal(starts.filter((url) => url.includes("brinedew.bio")).length, blocked ? 10 : 0)
  })
}

test("invalidation stops portrait warm queues without substituting unverified direct images", async () => {
  let calls = 0
  let notices = 0
  const warmed = []
  const cache = loadFactory()({
    windowRef: globalThis,
    batchSize: 1,
    chromeApi: {
      runtime: {
        sendMessage() {
          calls++
          throw new Error("Extension context invalidated.")
        },
      },
    },
    onContextInvalidated() {
      notices++
      cache.dispose()
    },
    onWarmSource(source) {
      warmed.push(source)
    },
  })
  cache.warmUrls(["https://example.test/a", "https://example.test/b"])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await cache.getUsableSrc("https://example.test/c"), "")
  assert.equal(calls, 1)
  assert.equal(notices, 1)
  assert.deepEqual(warmed, [])
})

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

test("unresolved primary is hedged on deadline and its losing transfer is canceled", async () => {
  const starts = []
  const cancelled = []
  const { loadPlannedSource } = deliveryRuntime()
  const result = await loadPlannedSource(
    {
      primaryUrl: "https://cdn.example/image",
      fallbackUrl: "https://origin.example/image",
      hedgeDelayMs: 5,
      timeoutMs: 2500,
    },
    (url, timeoutMs, signal) => {
      starts.push(url)
      assert.equal(timeoutMs, 2500)
      if (url.includes("origin.example")) return Promise.resolve(url)
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled.push(url)
            reject(new Error("aborted"))
          },
          { once: true },
        ),
      )
    },
  )
  assert.equal(result, "https://origin.example/image")
  assert.deepEqual(starts, ["https://cdn.example/image", "https://origin.example/image"])
  assert.deepEqual(cancelled, ["https://cdn.example/image"])
})

test("content decodes shared bytes in its renderer without downloading an HTTPS image", async () => {
  const messages = []
  const decoded = []
  const cache = loadFactory()({
    windowRef: globalThis,
    chromeApi: {
      runtime: {
        sendMessage(message, callback) {
          messages.push(message.type)
          callback({ ok: true, dataUrl: "data:image/webp;base64,aW1hZ2U=" })
        },
      },
    },
    loadImage: async (url) => {
      decoded.push(url)
      return url
    },
  })
  const url = "https://iconoplasm.brinedew.bio/portraits/v1/test/medium.webp"
  assert.equal(await cache.getUsableSrc(url), "data:image/webp;base64,aW1hZ2U=")
  await cache.getUsableSrc(url)
  assert.deepEqual(messages, ["GET_PORTRAIT_DATA_URL"])
  assert.deepEqual(decoded, ["data:image/webp;base64,aW1hZ2U="])
})
