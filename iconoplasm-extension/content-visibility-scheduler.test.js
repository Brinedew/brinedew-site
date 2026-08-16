import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

const source = await readFile(new URL("./content-visibility-scheduler.js", import.meta.url), "utf8")

test("visibility scheduler exposes the real visible elements used for spatial prediction", () => {
  let callback
  const observed = []
  class IntersectionObserverStub {
    constructor(nextCallback) {
      callback = nextCallback
    }
    observe(element) {
      observed.push(element)
    }
    disconnect() {}
  }
  const sandbox = { IntersectionObserver: IntersectionObserverStub }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  const scheduler = sandbox.IconoplasmVisibilityScheduler.createVisibilityScheduler({})
  const first = { dataset: { gene: "TP53" } }
  const second = { dataset: { gene: "BRCA1" } }
  scheduler.observe(first)
  scheduler.observe(second)
  assert.deepEqual(observed, [first, second])

  callback([
    { target: first, isIntersecting: true },
    { target: second, isIntersecting: true },
  ])
  assert.deepEqual(Array.from(scheduler.getVisibleElements(2)), [first, second])
  callback([{ target: first, isIntersecting: false }])
  assert.deepEqual(Array.from(scheduler.getVisibleElements(2)), [second])
})
