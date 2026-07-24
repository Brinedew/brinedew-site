import assert from "node:assert/strict"
import test from "node:test"

import {
  FREE_DAILY_LIMITS,
  JOURNEY_COSTS,
  SCENARIOS,
  addCosts,
  fingerprintRefreshCost,
  firstUserOverLimit,
  quotaReserve,
} from "./iconoplasm-first-principles-capacity.mjs"

function first(perUser, base) {
  return firstUserOverLimit(perUser, base)[0]
}

test("anonymous homepage capacity is derived from one Worker and five KV reads", () => {
  assert.equal(JOURNEY_COSTS.anonymousHomepageCold.workerRequests, 1)
  assert.equal(JOURNEY_COSTS.anonymousHomepageCold.kvReads, 5)
  assert.deepEqual(first(JOURNEY_COSTS.anonymousHomepageCold), {
    resource: "kvReads",
    firstUserOver: 20_001,
  })
})

test("10,000 lurkers leave KV capacity for 53 maximum signed-out extension users", () => {
  assert.equal(SCENARIOS.tenThousandOneVisitLurkers.workerRequests, 10_000)
  assert.equal(SCENARIOS.tenThousandOneVisitLurkers.kvReads, 50_000)
  assert.deepEqual(
    first(JOURNEY_COSTS.signedOutExtensionEightHoursMaximum, SCENARIOS.tenThousandOneVisitLurkers),
    {
      resource: "kvReads",
      firstUserOver: 54,
    },
  )
})

test("other account traffic is an explicit reserve assumption, never a historical baseline", () => {
  assert.deepEqual(
    first(
      JOURNEY_COSTS.signedOutExtensionEightHoursMaximum,
      addCosts(SCENARIOS.tenThousandOneVisitLurkers, quotaReserve(0.2)),
    ),
    {
      resource: "kvReads",
      firstUserOver: 33,
    },
  )
})

test("fixed scheduled work is derived from configured triggers", () => {
  assert.equal(JOURNEY_COSTS.fixedScheduledControlPlane.workerRequests, 99)
  assert.equal(JOURNEY_COSTS.fixedScheduledControlPlane.kvWrites, 24)
})

test("maximum-candidate website exploration first exceeds DO writes at user 758", () => {
  assert.deepEqual(first(SCENARIOS.signedOutExplorerMaximumCandidates), {
    resource: "durableObjectRowsWritten",
    firstUserOver: 758,
  })
})

test("signed-in extension discovery exceeds D1 writes at user 98", () => {
  assert.deepEqual(first(JOURNEY_COSTS.signedInExtensionEightHoursMaximum), {
    resource: "d1RowsWritten",
    firstUserOver: 98,
  })
})

test("three concurrent fingerprint refresh racers exceed D1 reads in eight hours", () => {
  const twoRacers = fingerprintRefreshCost({ activeHours: 8, concurrentColdIsolates: 2 })
  const threeRacers = fingerprintRefreshCost({
    activeHours: 8,
    concurrentColdIsolates: 3,
  })
  const oneRacerAllDay = fingerprintRefreshCost({
    activeHours: 24,
    concurrentColdIsolates: 1,
  })

  assert.ok(twoRacers.d1RowsRead < FREE_DAILY_LIMITS.d1RowsRead)
  assert.ok(threeRacers.d1RowsRead > FREE_DAILY_LIMITS.d1RowsRead)
  assert.ok(oneRacerAllDay.d1RowsRead > FREE_DAILY_LIMITS.d1RowsRead)
  assert.equal(threeRacers.d1RowsRead, 5_478_624)
  assert.equal(oneRacerAllDay.d1RowsRead, 5_478_624)
})

test("a cold disjoint shared-discovery set exceeds KV writes at user two", () => {
  assert.deepEqual(first(JOURNEY_COSTS.coldDisjointSharedDiscoveries), {
    resource: "kvWrites",
    firstUserOver: 2,
  })
})
