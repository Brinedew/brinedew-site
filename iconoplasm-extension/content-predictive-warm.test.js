import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: prediction stays bounded, local, and connection-aware.

const source = await readFile(new URL("./content-predictive-warm.js", import.meta.url), "utf8")

function loadApi() {
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmPredictiveWarm
}

function candidate(symbol, left, top, width = 20, height = 20) {
  return { symbol, rect: { left, top, width, height, right: left + width, bottom: top + height } }
}

test("adaptive prediction disables speculation on Data Saver and 2G", () => {
  const api = loadApi()
  assert.equal(api.predictionPolicy({ saveData: true }).enabled, false)
  assert.equal(api.predictionPolicy({ effectiveType: "2g" }).approachLimit, 0)
})

test("adaptive prediction expands only on measured fast connections", () => {
  const api = loadApi()
  const constrained = api.predictionPolicy({ effectiveType: "3g", rtt: 350, downlink: 1 }, 2)
  const ordinary = api.predictionPolicy({}, 0)
  const generous = api.predictionPolicy({ effectiveType: "4g", rtt: 60, downlink: 12 }, 8)
  assert.deepEqual(
    [constrained.neighborLimit, ordinary.neighborLimit, generous.neighborLimit],
    [2, 4, 6],
  )
  assert.deepEqual(
    [constrained.scrollPortraitLimit, ordinary.scrollPortraitLimit, generous.scrollPortraitLimit],
    [2, 4, 6],
  )
})

test("spatial prediction prefers nearby candidates in the pointer trajectory", () => {
  const api = loadApi()
  const ranked = api.rankSpatialCandidates(
    [candidate("LEFT", 50, 90), candidate("RIGHT", 130, 90), candidate("FAR", 210, 90)],
    { x: 100, y: 100 },
    { x: 20, y: 0 },
    { radius: 160, limit: 2 },
  )
  assert.deepEqual(Array.from(ranked), ["RIGHT", "FAR"])
})

test("scroll prediction ranks only the approaching edge in travel direction", () => {
  const api = loadApi()
  const candidates = [
    candidate("ABOVE", 20, -80),
    candidate("VISIBLE", 20, 300),
    candidate("NEXT", 20, 650),
    candidate("LATER", 20, 900),
  ]
  assert.deepEqual(Array.from(api.rankScrollCandidates(candidates, 1, 600, 2)), ["NEXT", "LATER"])
  assert.deepEqual(Array.from(api.rankScrollCandidates(candidates, -1, 600, 1)), ["ABOVE"])
})
