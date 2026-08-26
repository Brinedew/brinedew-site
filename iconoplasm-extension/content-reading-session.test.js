import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]
const source = await readFile(new URL("./content-reading-session.js", import.meta.url), "utf8")

function loadApi() {
  let intersectionCallback
  class IntersectionObserverStub {
    constructor(callback) {
      intersectionCallback = callback
    }
    observe() {}
    unobserve() {}
  }
  const sandbox = {
    document: { visibilityState: "visible" },
    IntersectionObserver: IntersectionObserverStub,
    Promise,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return {
    api: sandbox.IconoplasmReadingSession,
    intersect: (entries) => intersectionCallback(entries),
  }
}

function anchor(symbol) {
  return { dataset: { gene: symbol } }
}

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
  const anchors = ["A", "B", "C", "D", "E"].map(anchor)
  anchors.forEach(session.registerAnchor)
  session.startSpeculation()
  await Promise.resolve()
  assert.deepEqual(starts, ["A"])
  intersect([{ target: anchors[4], isIntersecting: true }])
  releases.get("A")({ symbol: "A" })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(starts[1], "E")
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

test("ordinary preparation is capped at the first ten symbols and two workers", async () => {
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

  assert.deepEqual(starts, ["GENE0", "GENE1"])
  assert.equal(session.snapshot().queuedSymbols.length, 8)
})
