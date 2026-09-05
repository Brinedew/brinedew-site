import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]
const source = await readFile(new URL("./content-reading-session.js", import.meta.url), "utf8")

function loadApi() {
  let intersectionCallback
  const listeners = new Map()
  const frames = new Map()
  const observed = new Set()
  let serial = 0
  class IntersectionObserverStub {
    constructor(callback) {
      intersectionCallback = callback
    }
    observe(element) {
      observed.add(element)
    }
    unobserve(element) {
      observed.delete(element)
    }
    disconnect() {
      observed.clear()
    }
  }
  const sandbox = {
    document: {
      visibilityState: "visible",
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
    requestAnimationFrame: (callback) => {
      const id = ++serial
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    IntersectionObserver: IntersectionObserverStub,
    Promise,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return {
    api: sandbox.IconoplasmReadingSession,
    observed,
    intersect: (entries) => intersectionCallback(entries),
    document: sandbox.document,
    emit: (name) => listeners.get(name)?.(),
    pendingFrames: () => frames.size,
    flushFrames: () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback())
    },
  }
}

function anchor(symbol) {
  return { dataset: { gene: symbol } }
}

test("native ranges share their source observer without losing remaining anchors on removal", async () => {
  const { api, intersect, observed } = loadApi()
  const parent = {}
  const session = api.createReadingSession({ prepareSymbol: async (symbol) => ({ symbol }) })
  const first = { ...anchor("TP53"), observationElement: parent }
  const second = { ...anchor("BRCA1"), observationElement: parent }
  session.registerAnchor(first)
  session.registerAnchor(second)
  assert.deepEqual([...observed], [parent])
  intersect([{ target: parent, isIntersecting: true }])
  session.unregisterAnchor(first)
  assert.deepEqual([...observed], [parent])
  session.unregisterAnchor(second)
  assert.equal(observed.size, 0)
  session.registerAnchor(first)
  session.dispose()
  assert.equal(observed.size, 0)
})

test("diagnostic inspection neither warms a symbol nor changes queue order", async () => {
  const { api } = loadApi()
  const starts = []
  const session = api.createReadingSession({
    prepareSymbol: async (symbol) => {
      starts.push(symbol)
      return { symbol }
    },
  })
  session.registerAnchor(anchor("EZH2"))
  const before = JSON.stringify(session.snapshot())
  assert.equal(session.inspectSymbol("EZH2").inventoried, true)
  assert.equal(session.inspectSymbol("EZH2").prepared, false)
  assert.equal(session.inspectSymbol("DNMT3A").inventoried, false)
  assert.equal(JSON.stringify(session.snapshot()), before)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(starts, [])
  session.startSpeculation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(session.inspectSymbol("EZH2").prepared, true)
  assert.deepEqual(starts, ["EZH2"])
})

test("disposal stops queued work and late completions cannot restart it", async () => {
  const { api, intersect } = loadApi()
  const starts = []
  let release
  const session = api.createReadingSession({
    connection: { effectiveType: "3g" },
    prepareSymbol: (symbol) =>
      new Promise((resolve) => {
        starts.push(symbol)
        release = resolve
      }),
  })
  const symbols = ["EZH2", "DNMT3A", "TP53", "BRCA2", "BRCA1", "A", "B", "C", "D", "E", "F"]
  const anchors = symbols.map(anchor)
  anchors.forEach(session.registerAnchor)
  session.startSpeculation()
  await Promise.resolve()
  assert.deepEqual(starts, symbols.slice(0, 10))
  session.dispose()
  release({ symbol: "EZH2" })
  session.prioritize("DNMT3A")
  session.updateConnection({ effectiveType: "4g" }, 8)
  intersect([{ target: anchors[2], isIntersecting: true }])
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(starts, symbols.slice(0, 10))
  assert.equal(session.registerAnchor(anchor("BRCA1")), false)
  assert.deepEqual(Array.from(session.snapshot().queuedSymbols), [])
})

test("ordinary documents do not prepare speculative cards before the host-page gate opens", async () => {
  const { api } = loadApi()
  const prepared = []
  const session = api.createReadingSession({
    prepareSymbol: async (symbol) => {
      prepared.push(symbol)
      return { symbol }
    },
  })
  session.registerAnchor(anchor("TP53"))
  session.registerAnchor(anchor("BRCA1"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(prepared, [])
  session.startSpeculation()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(prepared.sort(), ["BRCA1", "TP53"])
})

test("returning to a previously prepared gene after cache eviction prepares it again before hover", async () => {
  const { api, intersect } = loadApi()
  const decoded = new Set()
  const prepared = []
  const session = api.createReadingSession({
    isPrepared: (symbol) => decoded.has(symbol),
    prepareSymbol: async (symbol) => {
      prepared.push(symbol)
      decoded.add(symbol)
      return { symbol }
    },
  })
  const first = anchor("EZH2")
  session.registerAnchor(first)
  session.startSpeculation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(prepared, ["EZH2"])
  decoded.delete("EZH2") // Models the bounded portrait LRU evicting this source.
  assert.equal(session.inspectSymbol("EZH2").prepared, false)
  intersect([{ target: first, isIntersecting: true }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(prepared, ["EZH2", "EZH2"])
  assert.equal(session.inspectSymbol("EZH2").prepared, true)
})

test("a partial preparation is retried on a later visible window without a tight retry loop", async () => {
  const { api, intersect } = loadApi()
  let complete = false
  let starts = 0
  let now = 0
  const session = api.createReadingSession({
    now: () => now,
    isPrepared: () => complete,
    prepareSymbol: async () => {
      starts++
      return { detail: {}, portraitSrc: "" }
    },
  })
  const first = anchor("EZH2")
  session.registerAnchor(first)
  session.startSpeculation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(starts, 1)
  assert.equal(session.inspectSymbol("EZH2").prepared, false)
  for (let i = 0; i < 100; i++) intersect([{ target: first, isIntersecting: true }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(starts, 1)
  now = 5000
  complete = true
  intersect([{ target: first, isIntersecting: true }])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(starts, 2)
})

test("already-ready sticky/sidebar symbols do not consume the next visible preparation window", async () => {
  const { api, intersect } = loadApi()
  const prepared = []
  const decoded = new Set()
  const session = api.createReadingSession({
    isPrepared: (symbol) => decoded.has(symbol),
    prepareSymbol: async (symbol) => {
      prepared.push(symbol)
      decoded.add(symbol)
      return { symbol }
    },
  })
  const anchors = Array.from({ length: 11 }, (_, i) => anchor(`GENE${i}`))
  anchors.forEach(session.registerAnchor)
  session.startSpeculation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(prepared.length, 10)
  intersect(anchors.map((target) => ({ target, isIntersecting: true })))
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(prepared.includes("GENE10"))
})

test("completion refills visible cold genes without scrolling or looping over evicted images", async () => {
  const harness = loadApi()
  const starts = []
  const decoded = new Set()
  const session = harness.api.createReadingSession({
    isPrepared: (symbol) => decoded.has(symbol),
    prepareSymbol: async (symbol) => {
      starts.push(symbol)
      if (symbol === "GENE5") return null
      decoded.add(symbol)
      // Deliberately smaller than the visible inventory: automatic refills
      // must finish, not rotate evicted images through memory forever.
      while (decoded.size > 4) decoded.delete(decoded.values().next().value)
      return { symbol }
    },
  })
  const anchors = Array.from({ length: 30 }, (_, index) => anchor(`GENE${index}`))
  anchors.forEach(session.registerAnchor)
  harness.intersect(anchors.slice(0, 20).map((target) => ({ target, isIntersecting: true })))
  session.startSpeculation()
  for (let frame = 0; frame < 12; frame++) {
    await new Promise((resolve) => setImmediate(resolve))
    harness.flushFrames()
  }
  assert.equal(starts.length, 20, "one attempt per visible gene, including the failed image")
  assert.equal(new Set(starts).size, 20)
  assert.ok(starts.includes("GENE19"), "work continues beyond the first ten without a scroll")
  assert.ok(!starts.includes("GENE20"), "completion does not crawl the offscreen document")
  assert.equal(harness.pendingFrames(), 0, "no polling or cache-eviction loop remains")
  harness.emit("scroll")
  harness.flushFrames()
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(starts.length > 20, "a real viewport event may restore evicted images")
  session.dispose()
})

test("actual viewport work outranks old anchors in the wide prefetch margin", async () => {
  const { api, intersect } = loadApi()
  let release
  const starts = []
  const actual = api.createReadingSession({
    connection: { effectiveType: "3g" },
    viewportHeight: () => 1000,
    prepareSymbol: (symbol) => {
      starts.push(symbol)
      return new Promise((resolve) => {
        release = resolve
      })
    },
  })
  const far = Object.assign(anchor("FAR"), {
    getBoundingClientRect: () => ({ top: -800, bottom: -780, width: 30, height: 20 }),
  })
  const near = Object.assign(anchor("NEAR"), {
    getBoundingClientRect: () => ({ top: 450, bottom: 470, width: 30, height: 20 }),
  })
  for (let index = 0; index < 10; index++) actual.registerAnchor(anchor(`ACTIVE${index}`))
  actual.registerAnchor(far)
  actual.registerAnchor(near)
  actual.startSpeculation()
  await Promise.resolve()
  intersect([
    { target: far, isIntersecting: true },
    { target: near, isIntersecting: true },
  ])
  release({ symbol: "ACTIVE" })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(starts[10], "NEAR")
  actual.dispose()
})

test("scroll inside the IO margin reranks once per frame and disposal cancels it", async () => {
  const harness = loadApi()
  const starts = []
  let release
  let nearTop = 1500
  const session = harness.api.createReadingSession({
    viewportHeight: () => 1000,
    connection: { effectiveType: "3g" },
    prepareSymbol: (symbol) => {
      starts.push(symbol)
      return new Promise((resolve) => {
        release = resolve
      })
    },
  })
  const active = anchor("ACTIVE")
  const far = Object.assign(anchor("FAR"), {
    getBoundingClientRect: () => ({ top: -800, bottom: -780, width: 20, height: 20 }),
  })
  const near = Object.assign(anchor("NEAR"), {
    getBoundingClientRect: () => ({ top: nearTop, bottom: nearTop + 20, width: 20, height: 20 }),
  })
  ;[active, ...Array.from({ length: 9 }, (_, i) => anchor(`BUSY${i}`)), far, near].forEach(
    session.registerAnchor,
  )
  session.startSpeculation()
  await Promise.resolve()
  harness.intersect([
    { target: far, isIntersecting: true },
    { target: near, isIntersecting: true },
  ])
  nearTop = 450
  for (let i = 0; i < 100; i++) harness.emit("scroll")
  assert.equal(harness.pendingFrames(), 1)
  harness.flushFrames()
  release({ symbol: "ACTIVE" })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(starts[10], "NEAR")
  harness.emit("scroll")
  session.dispose()
  assert.equal(harness.pendingFrames(), 0)
})

test("an HTML or PDF session opened in the background resumes preparation on visibility", async () => {
  const harness = loadApi()
  harness.document.visibilityState = "hidden"
  const starts = []
  const session = harness.api.createReadingSession({
    prepareSymbol: async (symbol) => {
      starts.push(symbol)
      return { symbol }
    },
  })
  session.registerAnchor(anchor("EZH2"))
  session.startSpeculation()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(starts, [])
  harness.document.visibilityState = "visible"
  harness.emit("visibilitychange")
  harness.flushFrames()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(starts, ["EZH2"])
  session.dispose()
})

test("visible symbols outrank the remaining document queue", async () => {
  const { api, intersect } = loadApi()
  const starts = []
  const releases = new Map()
  const session = api.createReadingSession({
    connection: { effectiveType: "3g" },
    prepareSymbol: (symbol) =>
      new Promise((resolve) => {
        starts.push(symbol)
        releases.set(symbol, resolve)
      }),
  })
  const symbols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]
  const anchors = symbols.map(anchor)
  anchors.forEach(session.registerAnchor)
  session.startSpeculation()
  await Promise.resolve()
  assert.deepEqual(starts, symbols.slice(0, 10))
  intersect([{ target: anchors[10], isIntersecting: true }])
  releases.get("A")({ symbol: "A" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(starts[10], "K")
})

test("Data Saver disables preparation while active intent still works", async () => {
  const { api, intersect } = loadApi()
  const prepared = []
  const session = api.createReadingSession({
    connection: { saveData: true },
    prepareSymbol: async (symbol) => {
      prepared.push(symbol)
      return { symbol }
    },
  })
  const tp53 = anchor("TP53")
  session.registerAnchor(tp53)
  intersect([{ target: tp53, isIntersecting: true }])
  session.startSpeculation()
  await Promise.resolve()
  assert.deepEqual(prepared, [])
  session.prioritize("TP53")
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(prepared, ["TP53"])
})

test("PDF page replacement removes old anchors from the visible working set", async () => {
  const { api, intersect } = loadApi()
  const prepared = []
  const session = api.createReadingSession({
    prepareSymbol: async (symbol) => {
      prepared.push(symbol)
      return { symbol }
    },
  })
  const oldAnchor = anchor("OLD")
  const nextAnchor = anchor("NEXT")
  session.replaceAnchorGroup("pdf:1", [oldAnchor])
  session.replaceAnchorGroup("pdf:1", [nextAnchor])
  session.startSpeculation()
  intersect([
    { target: oldAnchor, isIntersecting: true },
    { target: nextAnchor, isIntersecting: true },
  ])
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(session.snapshot().documentSymbols.includes("NEXT"), true)
  assert.equal(session.snapshot().queuedSymbols.includes("OLD"), false)
})

test("ordinary preparation starts the first ten independently without expanding the document", async () => {
  const { api } = loadApi()
  const starts = []
  const session = api.createReadingSession({
    prepareSymbol: (symbol) =>
      new Promise(() => {
        starts.push(symbol)
      }),
  })
  Array.from({ length: 30 }, (_, index) => anchor(`GENE${index}`)).forEach(session.registerAnchor)
  session.startSpeculation()
  await Promise.resolve()

  assert.deepEqual(
    starts,
    Array.from({ length: 10 }, (_, i) => `GENE${i}`),
  )
  assert.equal(session.snapshot().queuedSymbols.length, 0)
})

test("high latency overlaps bounded preparation instead of serializing every next gene", async () => {
  const { api } = loadApi()
  assert.equal(
    api.workingSetPolicy({ effectiveType: "3g", rtt: 450, downlink: 0.4 }, 8).concurrency,
    10,
  )
  assert.equal(api.workingSetPolicy({ effectiveType: "4g" }, 2).concurrency, 2)
  for (const connection of [{ saveData: true }, { effectiveType: "2g" }]) {
    assert.equal(api.workingSetPolicy(connection, 8).speculative, false)
  }
  const ready = new Set()
  const releases = new Map()
  const session = api.createReadingSession({
    connection: { effectiveType: "3g", rtt: 450 },
    isPrepared: (symbol) => ready.has(symbol),
    prepareSymbol: (symbol) =>
      new Promise((resolve) =>
        releases.set(symbol, () => {
          ready.add(symbol)
          resolve({ symbol })
        }),
      ),
  })
  const symbols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]
  symbols.map(anchor).forEach(session.registerAnchor)
  session.startSpeculation()
  await Promise.resolve()
  assert.deepEqual([...releases.keys()], symbols.slice(0, 10))
  session.prioritize("K")
  releases.get("B")()
  releases.get("C")()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(session.isReady("B"), true)
  assert.equal(session.isReady("C"), true)
  assert.equal(session.isReady("A"), false, "a slow first card cannot hold all later cards")
  assert.equal(releases.has("K"), true)
  session.dispose()
})
