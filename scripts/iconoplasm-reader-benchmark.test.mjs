import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import {
  assessReaderSamples,
  distribution,
  locateReaderPointerTarget,
  measuredResponseBodyBytes,
  measureHover,
  installReaderProbe,
  runReaderJourney,
} from "./lib/iconoplasm-reader-benchmark.mjs"

test("invalid cached response byte measurements stay unknown, not negative or free traffic", () => {
  for (const value of [-2074, undefined, null, NaN, Infinity]) {
    assert.equal(measuredResponseBodyBytes(value), null)
  }
  assert.equal(measuredResponseBodyBytes(0), 0)
  assert.equal(measuredResponseBodyBytes(1769), 1769)
})

test("a lingering same-gene card is measured only after the new pointer entry", () => {
  let clock = 100
  let frame
  const listeners = new Map()
  const image = {
    alt: "BRCA1",
    src: "data:image/webp;base64,bytes",
    complete: true,
    naturalWidth: 384,
    naturalHeight: 512,
    getClientRects: () => [{}],
  }
  const shell = {
    getClientRects: () => [{}],
    querySelectorAll: (selector) => (selector === "img" ? [image] : [{ textContent: "BRCA1" }]),
    querySelector: () => ({}),
  }
  class Observer {
    observe() {}
    disconnect() {}
  }
  const sandbox = {
    MutationObserver: Observer,
    PerformanceObserver: Observer,
    performance: {
      timeOrigin: 1000,
      now: () => clock,
      getEntriesByType: () => [],
      getEntriesByName: () => [],
    },
    requestAnimationFrame: (callback) => {
      frame = callback
      return 1
    },
    cancelAnimationFrame() {},
    document: {
      visibilityState: "visible",
      documentElement: null,
      querySelector: () => shell,
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name) => listeners.delete(name),
    },
  }
  vm.runInNewContext(`(${installReaderProbe.toString()})()`, sandbox)
  const probe = sandbox.__iconoplasmReaderProbe
  probe.arm({ symbol: "BRCA1", deadline: 2000 })
  frame(clock)
  assert.equal(probe.snapshot().result.imageAt, null)
  clock = 120
  listeners.get("pointerover")()
  clock = 130
  frame(clock)
  const measured = probe.snapshot()
  assert.equal(measured.pointerAt, 1120)
  assert.equal(measured.result.imageAt, 1130)
  probe.stop()
})

// ARCHITECTURE FENCE [IPD-008]: do not average away first-hover failures or
// erase timeouts. A fixed-deadline readiness miss is distinct from slow paint.
const sample = (extra = {}) => ({
  surface: "html",
  cacheState: "warm",
  kind: "repeat",
  imageMs: 20,
  before: { portraitReady: true },
  ...extra,
})

test("wrapped aliases use a real line fragment, never the empty center of their union", () => {
  const rects = [
    { x: 900, y: 20, width: 10, height: 15 },
    { x: 100, y: 40, width: 25, height: 15 },
  ]
  const element = {
    classList: { contains: () => false },
    getClientRects: () => rects,
    contains: (hit) => hit === element,
    ownerDocument: {
      defaultView: { innerWidth: 1200, innerHeight: 800 },
      elementFromPoint: () => element,
    },
  }
  assert.deepEqual(locateReaderPointerTarget(element), { x: 112.5, y: 47.5 })
  element.ownerDocument.elementFromPoint = () => ({ tagName: "ASIDE" })
  assert.equal(locateReaderPointerTarget(element).error, "target-obscured-or-outside-viewport")
})

test("recurring first-hover delays cannot hide behind many fast repeats", () => {
  const samples = Array.from({ length: 40 }, () => sample())
  samples.push(
    ...Array.from({ length: 5 }, () => sample({ kind: "first-immediate", imageMs: 1300 })),
  )
  const report = assessReaderSamples(samples)
  assert.equal(report["html/warm/repeat"].verdict, "pass")
  assert.equal(report["html/warm/first-immediate"].verdict, "fail")
  assert.equal(report["html/warm/first-immediate"].preparedSlow, 5)
})

test("a saved-image hover at 200 ms is a failure, not an instantaneous pass", () => {
  const report = assessReaderSamples([sample({ imageMs: 200 })])
  assert.equal(report["html/warm/repeat"].preparedSlow, 1)
  assert.equal(report["html/warm/repeat"].verdict, "fail")
})

test("a recurring cold first-hover delay fails even when no image was prepared", () => {
  const report = assessReaderSamples([
    sample({ kind: "first-immediate", imageMs: 1900, before: { portraitReady: false } }),
  ])
  assert.equal(report["html/warm/first-immediate"].slowHovers, 1)
  assert.equal(report["html/warm/first-immediate"].verdict, "fail")
})

test("timeouts count as failures even if the surviving sample is fast", () => {
  const report = assessReaderSamples([sample(), sample({ imageMs: null, error: "timeout" })])
  assert.equal(report["html/warm/repeat"].attempts, 2)
  assert.equal(report["html/warm/repeat"].failures, 1)
  assert.equal(report["html/warm/repeat"].verdict, "fail")
  assert.equal(report["html/warm/repeat"].imageMs.n, 1)
})

test("a fast foreground recovery does not excuse failed advance preparation", () => {
  const report = assessReaderSamples([
    sample({ predictionEligible: true, before: { portraitReady: false } }),
  ])
  assert.equal(report["html/warm/repeat"].predictionMisses, 1)
  assert.equal(report["html/warm/repeat"].verdict, "fail")
})

test("Data Saver and immediate jumps are not mislabeled as prediction misses", () => {
  const report = assessReaderSamples([
    sample({ predictionEligible: false, before: { portraitReady: false } }),
  ])
  assert.equal(report["html/warm/repeat"].predictionMisses, 0)
  assert.equal(report["html/warm/repeat"].verdict, "insufficient-samples")
})

test("late highlighting fails even when the eventual hover is instant", () => {
  const report = assessReaderSamples([sample({ highlightAfterLoadMs: 5000 })])
  assert.equal(report["html/warm/repeat"].lateHighlights, 1)
  assert.equal(report["html/warm/repeat"].verdict, "fail")
})

test("cold, warm, HTML and PDF populations stay separate", () => {
  assert.equal(
    Object.keys(
      assessReaderSamples([sample(), sample({ cacheState: "cold" }), sample({ surface: "pdf" })]),
    ).length,
    3,
  )
  assert.deepEqual(distribution([]), { n: 0, p50: null, p95: null, max: null })
})

test("runner retains browser failures and never launches a private replacement browser", async () => {
  const source = await readFile(
    new URL("./benchmark-iconoplasm-extension.mjs", import.meta.url),
    "utf8",
  )
  assert.doesNotMatch(source, /launchPersistentContext|skippedReason|chromiumExecutable/)
  assert.match(source, /--lexical-only/)
})

test("failed navigation removes future-page probes and all network observers", async () => {
  const commands = []
  const events = new Set()
  const session = {
    on() {},
    async send(method) {
      commands.push(method)
      return { identifier: "owned-probe" }
    },
    async detach() {
      commands.push("detach")
    },
  }
  const context = {
    newCDPSession: async () => session,
    on: (name) => events.add(name),
    off: (name) => events.delete(name),
  }
  const page = {
    context: () => context,
    bringToFront: async () => {},
    frames: () => [],
    waitForTimeout: async () => {},
  }
  await assert.rejects(
    runReaderJourney(page, {
      rounds: 1,
      navigate: async () => {
        throw new Error("navigation failed")
      },
    }),
    /navigation failed/,
  )
  assert.equal(events.size, 0)
  assert.ok(commands.includes("Page.enable"))
  assert.ok(commands.includes("Page.removeScriptToEvaluateOnNewDocument"))
  assert.equal(commands.at(-1), "detach")
})

test("cold hover observes a newly created frame and validates the newly selected snapshot", async () => {
  const pointerAt = Date.now()
  let entered = false
  const arms = []
  const before = { revision: "", portraitReady: false, at: pointerAt, session: { policy: {} } }
  const snapshot = {
    pointerAt,
    result: { shellAt: pointerAt + 5 },
    highlights: {},
  }
  const frame = (url, result) => ({
    url: () => url,
    evaluate: async (_fn, argument) => {
      if (argument?.symbol) arms.push({ url, ...argument })
      return result
    },
  })
  const main = frame("https://example.test/article", snapshot)
  const child = frame("chrome-extension://test/lit-archival-frame.html", {
    result: {
      imageAt: pointerAt + 25,
      image: { src: "data:image/webp;base64,test", width: 384, height: 512 },
    },
  })
  const target = {
    waitFor: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    evaluate: async () => ({ x: 100, y: 100 }),
  }
  const page = {
    locator: () => ({ nth: () => target }),
    waitForTimeout: async () => {},
    evaluate: async () => snapshot,
    mainFrame: () => main,
    frames: () => (entered ? [main, child] : [main]),
    mouse: {
      move: async (x) => {
        if (x === 100) entered = true
      },
    },
  }
  const validations = []
  const diagnostics = {
    inspect: async () => (entered ? { ...before, revision: "selected-epoch" } : before),
    matchesPortraitSource: async (symbol, source, revision) => {
      validations.push({ symbol, source, revision })
      return revision === "selected-epoch"
    },
  }
  const result = await measureHover(page, diagnostics, { symbol: "RAD51", leadMs: 0 })
  assert.equal(result.error, undefined)
  assert.equal(result.imageMs, 25)
  assert.equal(result.before.revision, "")
  assert.equal(result.selectedRevision, "selected-epoch")
  assert.equal(arms.length, 2)
  assert.equal(arms[0].deadline, arms[1].deadline)
  assert.equal(validations[0].revision, "selected-epoch")
})
