import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import {
  assessReaderSamples,
  distribution,
  locateReaderPointerTarget,
  measuredResponseBodyBytes,
  runReaderJourney,
} from "./lib/iconoplasm-reader-benchmark.mjs"

test("invalid cached response byte measurements stay unknown, not negative or free traffic", () => {
  for (const value of [-2074, undefined, null, NaN, Infinity]) {
    assert.equal(measuredResponseBodyBytes(value), null)
  }
  assert.equal(measuredResponseBodyBytes(0), 0)
  assert.equal(measuredResponseBodyBytes(1769), 1769)
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
