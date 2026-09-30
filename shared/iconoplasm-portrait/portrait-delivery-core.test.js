import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_PORTRAIT_DELIVERY_POLICY,
  createPortraitDeliverySession,
  expirePortraitDeliveryRetry,
  normalizePortraitDeliveryPolicy,
  transitionPortraitDelivery,
} from "./portrait-delivery-core.js"

// Failure modes written before the code (Stage 0 of the 2026-10-01 diagnosis):
// 1. A definitive probe failure still selects canonical for the whole tab.
// 2. A probe timeout selects canonical now, but the next ensure() after the
//    retry window re-probes once; success returns the tab to the CDN.
// 3. Inside the window nothing re-probes and there is no hedge timer.
// 4. Persisted state with an expired retry re-probes on the first ensure().
// 5. Concurrent ensures during a re-probe share one probe.
// 6. Canonical failing while the accelerator is only timed out switches back
//    to the accelerator instead of going terminal.
// 7. Accelerator success clears the retry.
// 8. A definitive failure after a transient one makes the block permanent.
// 9. Garbage retry values in storage are ignored.

const CANONICAL = "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp"
const BUNNY = "https://iconoplasmportraits.b-cdn.net/portraits/v1/aa/asset/medium.webp"

function clock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

test("1. a definitive probe failure keeps canonical for the tab with no retry", async () => {
  const c = clock()
  let probes = 0
  const session = createPortraitDeliverySession({
    now: c.now,
    probe: async () => {
      probes += 1
      return false
    },
  })
  assert.equal(await session.ensure(CANONICAL), CANONICAL)
  assert.deepEqual(session.state(), { state: "canonical", failed: ["accelerator"] })
  c.advance(10 * 60_000)
  assert.equal(await session.ensure(CANONICAL), CANONICAL)
  assert.equal(probes, 1)
  assert.equal(session.plan(CANONICAL).hedgeDelayMs, null)
})

test("2/3. a probe timeout is transient: canonical now, one re-probe after the window", async () => {
  const c = clock()
  const results = ["timeout", true]
  let probes = 0
  const persisted = []
  const session = createPortraitDeliverySession({
    now: c.now,
    persist: (state) => persisted.push(state),
    probe: async () => {
      probes += 1
      return results.shift()
    },
  })
  assert.equal(await session.ensure(CANONICAL), CANONICAL)
  assert.deepEqual(session.state(), {
    state: "canonical",
    failed: ["accelerator"],
    accelerator_retry_at: c.now() + DEFAULT_PORTRAIT_DELIVERY_POLICY.accelerator_retry_after_ms,
  })
  assert.equal(session.plan(CANONICAL).hedgeDelayMs, null, "no hedge inside the window")

  c.advance(30_000)
  assert.equal(await session.ensure(CANONICAL), CANONICAL)
  assert.equal(session.resolve(CANONICAL), CANONICAL)
  assert.equal(probes, 1, "nothing re-probes inside the window")

  c.advance(31_000)
  assert.equal(await session.ensure(CANONICAL), BUNNY)
  assert.equal(probes, 2)
  assert.deepEqual(session.state(), { state: "accelerator", failed: [] })
  assert.equal(session.plan(CANONICAL).hedgeDelayMs, 350)
  assert.ok(persisted.some((state) => state.accelerator_retry_at))
  assert.deepEqual(persisted.at(-1), { state: "accelerator", failed: [] })
})

test("4. persisted state with an expired retry re-probes on the first ensure", async () => {
  const c = clock()
  let probes = 0
  const session = createPortraitDeliverySession({
    now: c.now,
    initialState: {
      state: "canonical",
      failed: ["accelerator"],
      accelerator_retry_at: c.now() - 1,
    },
    probe: async () => {
      probes += 1
      return true
    },
  })
  assert.equal(await session.ensure(CANONICAL), BUNNY)
  assert.equal(probes, 1)
})

test("5. concurrent ensures after expiry share one re-probe", async () => {
  const c = clock()
  let probes = 0
  let release
  const session = createPortraitDeliverySession({
    now: c.now,
    initialState: {
      state: "canonical",
      failed: ["accelerator"],
      accelerator_retry_at: c.now() - 1,
    },
    probe: () =>
      new Promise((resolve) => {
        probes += 1
        release = resolve
      }),
  })
  const pending = [session.ensure(CANONICAL), session.ensure(CANONICAL), session.ensure(CANONICAL)]
  await Promise.resolve()
  release(true)
  assert.deepEqual(await Promise.all(pending), [BUNNY, BUNNY, BUNNY])
  assert.equal(probes, 1)
})

test("6. canonical failing while the accelerator only timed out goes back to the accelerator", () => {
  const timedOut = transitionPortraitDelivery(
    { state: "undecided", failed: [] },
    { type: "source_failed", source: "accelerator", transient: true },
    DEFAULT_PORTRAIT_DELIVERY_POLICY,
    5_000,
  )
  assert.equal(timedOut.accelerator_retry_at, 65_000)
  const next = transitionPortraitDelivery(timedOut, { type: "source_failed", source: "canonical" })
  assert.deepEqual(next, { state: "accelerator", failed: ["canonical"] })

  const definitive = transitionPortraitDelivery(
    { state: "undecided", failed: [] },
    { type: "source_failed", source: "accelerator" },
  )
  assert.deepEqual(
    transitionPortraitDelivery(definitive, { type: "source_failed", source: "canonical" }),
    { state: "terminal_failure", failed: ["accelerator", "canonical"] },
  )
})

test("7. accelerator success clears the retry", () => {
  const timedOut = transitionPortraitDelivery(
    { state: "undecided", failed: [] },
    { type: "source_failed", source: "accelerator", transient: true },
  )
  assert.deepEqual(
    transitionPortraitDelivery(timedOut, { type: "source_succeeded", source: "accelerator" }),
    { state: "accelerator", failed: [] },
  )
})

test("8. a definitive failure after a transient one makes the block permanent", () => {
  const timedOut = transitionPortraitDelivery(
    { state: "undecided", failed: [] },
    { type: "source_failed", source: "accelerator", transient: true },
  )
  const permanent = transitionPortraitDelivery(timedOut, {
    type: "source_failed",
    source: "accelerator",
  })
  assert.deepEqual(permanent, { state: "canonical", failed: ["accelerator"] })
  assert.deepEqual(expirePortraitDeliveryRetry(permanent, Number.MAX_SAFE_INTEGER), permanent)
})

test("9. garbage retry values are ignored and the policy clamps the window", () => {
  const state = expirePortraitDeliveryRetry(
    { state: "canonical", failed: ["accelerator"], accelerator_retry_at: "soon" },
    Number.MAX_SAFE_INTEGER,
  )
  assert.deepEqual(state, { state: "canonical", failed: ["accelerator"] })
  assert.equal(
    normalizePortraitDeliveryPolicy({ accelerator_retry_after_ms: 1 }).accelerator_retry_after_ms,
    5_000,
  )
  assert.equal(
    normalizePortraitDeliveryPolicy({ accelerator_retry_after_ms: 1e9 }).accelerator_retry_after_ms,
    600_000,
  )
  assert.equal(
    normalizePortraitDeliveryPolicy({}).accelerator_retry_after_ms,
    60_000,
    "a server policy without the field keeps the default window",
  )
})
