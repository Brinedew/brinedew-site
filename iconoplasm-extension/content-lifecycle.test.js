import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

await import("./content-scanner.js")
await import("./content-lifecycle.js")

const nodeFilter = {
  SHOW_TEXT: 4,
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
}

function exactGeneMatcher(symbols) {
  return {
    findMatches(text) {
      const matches = []
      for (const symbol of symbols) {
        let index = String(text).indexOf(symbol)
        while (index >= 0) {
          matches.push({ symbol, index, length: symbol.length })
          index = String(text).indexOf(symbol, index + symbol.length)
        }
      }
      return matches.sort((left, right) => left.index - right.index)
    },
  }
}

function createRuntime(html, options = {}) {
  const { document, window } = parseHTML(html)
  const geneMap = {
    TP53: { c: "#123456" },
    BRCA1: { c: "#654321" },
    EGFR: { c: "#abcdef" },
  }
  const scanner = globalThis.IconoplasmContentScanner.createPageScanner({
    documentRef: document,
    windowRef: options.windowRef || window,
    nodeFilter,
    getGeneMap: () => geneMap,
    getMatcher: () => exactGeneMatcher(Object.keys(geneMap)),
  })
  const controller = globalThis.IconoplasmContentLifecycle.createMutationScanController({
    documentRef: document,
    windowRef: window,
    MutationObserverCtor: options.MutationObserverCtor || window.MutationObserver,
    scanPage: options.scanPage || scanner.scanPage,
    shouldIgnoreNode(node) {
      const element = node?.nodeType === 3 ? node.parentElement : node
      return !element || Boolean(element.closest?.(".iconoplasm-gene"))
    },
  })
  return { document, window, scanner, controller }
}

function settleMutations(window) {
  return new Promise((resolve) => window.setTimeout(resolve, 20))
}

test("scanner accepts a text node as a dirty root", () => {
  const { document, scanner } = createRuntime("<html><body><div id='row'>TP53</div></body></html>")
  const textNode = document.querySelector("#row").firstChild

  assert.equal(scanner.scanPage(textNode), 1)
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "TP53")
})

test("pagination-style textContent replacement is re-highlighted", async () => {
  const { document, window, scanner, controller } = createRuntime(
    "<html><body><div id='row'>TP53</div></body></html>",
  )
  controller.start()
  scanner.scanPage(document.body)
  await settleMutations(window)

  document.querySelector("#row").textContent = "BRCA1"
  await settleMutations(window)

  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "BRCA1")
  controller.stop()
})

test("virtualized-row character data changes are re-highlighted", async () => {
  let mutationCallback
  let observedOptions
  class CapturingMutationObserver {
    constructor(callback) {
      mutationCallback = callback
    }
    observe(_root, options) {
      observedOptions = options
    }
    disconnect() {}
  }
  const { document, window, controller } = createRuntime(
    "<html><body><div id='row'>ordinary text</div></body></html>",
    { MutationObserverCtor: CapturingMutationObserver },
  )
  controller.start()
  const textNode = document.querySelector("#row").firstChild
  textNode.data = "EGFR"
  mutationCallback([{ type: "characterData", target: textNode }])
  await settleMutations(window)

  assert.equal(observedOptions.characterData, true)
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 1)
  assert.equal(document.querySelector(".iconoplasm-gene").dataset.geneLabel, "EGFR")
  controller.stop()
})

test("mutations arriving during a cooperative scan cannot strand later chat messages", async () => {
  const { document } = parseHTML("<html><body><p>first</p><p>second</p><p>third</p></body></html>")
  const timers = []
  const scanned = []
  let finishFirst
  const [first, second, third] = document.querySelectorAll("p")
  // A mutation delivery starts a second flush while the first is yielding.
  // Use the actual observer callback to exercise scheduling, not just flush().
  let deliver
  const live = globalThis.IconoplasmContentLifecycle.createMutationScanController({
    documentRef: document,
    windowRef: { setTimeout: (callback) => timers.push(callback) },
    MutationObserverCtor: class {
      constructor(callback) {
        deliver = callback
      }
      observe() {}
      disconnect() {}
    },
    scanPage: async (node) => {
      scanned.push(node.textContent)
      if (node === first)
        await new Promise((resolve) => {
          finishFirst = resolve
        })
      return 0
    },
  })
  live.start()
  deliver([{ addedNodes: [first] }])
  const livePending = timers.shift()()
  deliver([{ type: "characterData", target: second.firstChild }])
  while (timers.length) await timers.shift()()
  finishFirst()
  await livePending
  while (timers.length) await timers.shift()()
  deliver([{ addedNodes: [third] }])
  while (timers.length) await timers.shift()()
  assert.deepEqual(scanned, ["first", "second", "third"])
  live.stop()
})

test("gene-data messaging times out and ignores a late callback", async () => {
  let callback
  const chromeApi = {
    runtime: {
      lastError: null,
      sendMessage(_message, responseCallback) {
        callback = responseCallback
      },
    },
  }

  const result = await globalThis.IconoplasmContentLifecycle.requestGeneData(chromeApi, {
    timeoutMs: 10,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  })
  callback({ genes: { TP53: {} } })

  assert.equal(result, null)
})

test("cooperative scanner yields between bounded text-node slices", async () => {
  const { document, scanner } = createRuntime(
    `<html><body>${Array.from({ length: 12 }, (_, index) => `<p>${index} TP53</p>`).join("")}</body></html>`,
  )
  const slices = []
  const callbacks = []
  const resultPromise = scanner.scanPageCooperatively(document.body, {
    maxNodesPerSlice: 3,
    requestIdleCallback(callback) {
      callbacks.push(callback)
    },
  })
  while (callbacks.length) {
    const callback = callbacks.shift()
    callback({ timeRemaining: () => 50 })
    slices.push(document.querySelectorAll(".iconoplasm-gene").length)
    await Promise.resolve()
  }

  assert.equal(await resultPromise, 12)
  assert.equal(slices.at(-1), 12)
  assert.ok(slices.length >= 4)
  let previous = 0
  for (const current of slices) {
    assert.ok(current > previous)
    assert.ok(current - previous <= 3)
    previous = current
  }
})

test("host-first background work waits for load, quiet delay, and an idle turn", () => {
  const listeners = new Map()
  const timers = []
  const idleCallbacks = []
  const calls = []
  const windowRef = {
    addEventListener(type, callback) {
      listeners.set(type, callback)
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay })
      return timers.length
    },
    clearTimeout() {},
    requestIdleCallback(callback) {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    },
    cancelIdleCallback() {},
  }
  globalThis.IconoplasmContentLifecycle.scheduleHostFirstBackgroundWork({
    documentRef: { readyState: "interactive" },
    windowRef,
    quietDelayMs: 1000,
    task: () => calls.push("started"),
  })

  assert.deepEqual(calls, [])
  listeners.get("load")()
  assert.equal(timers[0].delay, 1000)
  timers.shift().callback()
  assert.deepEqual(calls, [])
  idleCallbacks.shift()()
  assert.deepEqual(calls, ["started"])
})

test("content runtime initialization cannot start before host load", () => {
  let loadListener
  const calls = []
  globalThis.IconoplasmContentLifecycle.runAfterHostLoad({
    documentRef: { readyState: "interactive" },
    windowRef: {
      addEventListener(type, callback, options) {
        assert.equal(type, "load")
        assert.deepEqual(options, { once: true })
        loadListener = callback
      },
    },
    task: () => calls.push("started"),
  })

  assert.deepEqual(calls, [])
  loadListener()
  loadListener()
  assert.deepEqual(calls, ["started"])
})

test("canceled background work cannot restart from a late load or idle callback", () => {
  let onLoad
  let calls = 0
  const task = globalThis.IconoplasmContentLifecycle.scheduleHostFirstBackgroundWork({
    documentRef: { readyState: "interactive" },
    windowRef: {
      addEventListener(_type, callback) {
        onLoad = callback
      },
      removeEventListener() {},
      setTimeout() {
        throw new Error("canceled work scheduled a timer")
      },
    },
    task: () => calls++,
  })
  task.cancel()
  onLoad()
  task.runNow()
  assert.equal(calls, 0)
})

test("cached recognition waits for DOM, a paint boundary, then genuine idle, not window load", () => {
  let domReady
  const frames = [],
    idle = [],
    calls = []
  globalThis.IconoplasmContentLifecycle.runAfterHostPaint({
    documentRef: {
      readyState: "loading",
      addEventListener(type, cb) {
        assert.equal(type, "DOMContentLoaded")
        domReady = cb
      },
    },
    windowRef: {
      requestAnimationFrame(cb) {
        frames.push(cb)
      },
      requestIdleCallback(cb, options) {
        assert.equal(options, undefined)
        idle.push(cb)
      },
      addEventListener() {},
    },
    task: () => calls.push("recognize"),
  })
  assert.equal(frames.length, 0)
  domReady()
  frames.shift()()
  assert.equal(idle.length, 0)
  frames.shift()()
  assert.deepEqual(calls, [])
  idle.shift()()
  assert.deepEqual(calls, ["recognize"])
})

test("pre-load text-node mutations also wait for idle and cannot force a timeout slice", async () => {
  const { document, scanner } = createRuntime("<html><body><p>TP53</p></body></html>")
  const callbacks = []
  const pending = scanner.scanPageCooperatively(document.querySelector("p").firstChild, {
    requestIdleCallback(cb, options) {
      assert.equal(options, undefined)
      callbacks.push(cb)
    },
  })
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 0)
  callbacks.shift()({ timeRemaining: () => 0 })
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 0)
  callbacks.shift()({ timeRemaining: () => 20 })
  assert.equal(await pending, 1)
})

test("pending pre-load recognition becomes a yielding task at load without duplicate execution", () => {
  const documentRef = { readyState: "interactive" }
  const callbacks = []
  const tasks = []
  const canceled = []
  let onLoad
  let calls = 0
  globalThis.IconoplasmContentLifecycle.scheduleRecognitionWork(() => calls++, {
    documentRef,
    windowRef: {
      addEventListener(_event, callback) {
        onLoad = callback
      },
      removeEventListener() {},
      cancelIdleCallback(id) {
        canceled.push(id)
      },
      setTimeout(callback, delay) {
        assert.equal(delay, 0)
        tasks.push(callback)
      },
      requestIdleCallback(callback, options) {
        callbacks.push({ callback, options })
        return callbacks.length
      },
    },
  })
  assert.equal(callbacks[0].options, undefined)
  documentRef.readyState = "complete"
  onLoad()
  assert.deepEqual(canceled, [1])
  assert.equal(callbacks.length, 1)
  assert.equal(tasks.length, 1)
  callbacks[0].callback({ timeRemaining: () => 10 })
  assert.equal(calls, 0)
  tasks.shift()()
  assert.equal(calls, 1)
})

test("busy loaded pages use bounded 4 ms tasks without depending on idle time", async () => {
  let clock = 0
  const { document, scanner } = createRuntime(
    `<html><body>${"<p>TP53</p>".repeat(6)}</body></html>`,
    { windowRef: { performance: { now: () => clock++ } } },
  )
  Object.defineProperty(document, "readyState", { value: "complete" })
  const callbacks = []
  const pending = scanner.scanPageCooperatively(document.body, {
    requestIdleCallback() {
      throw new Error("loaded-page recognition must not wait for idle")
    },
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 0)
      callbacks.push(callback)
    },
  })
  callbacks.shift()()
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 3)
  callbacks.shift()()
  assert.equal(await pending, 6)
})

test("article-first scanning still covers navigation, and rescanning never nests highlights", async () => {
  const { document, scanner } = createRuntime(
    "<html><body><nav>TP53</nav><article><main>BRCA1</main></article><footer>EGFR</footer></body></html>",
  )
  assert.equal(await scanner.scanDocumentCooperatively(), 3)
  assert.equal(document.querySelectorAll(".iconoplasm-gene").length, 3)
  assert.equal(await scanner.scanDocumentCooperatively(), 0)
  assert.equal(document.querySelectorAll(".iconoplasm-gene .iconoplasm-gene").length, 0)
})
