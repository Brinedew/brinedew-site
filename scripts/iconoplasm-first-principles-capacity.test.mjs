import assert from "node:assert/strict"
import test from "node:test"

import {
  ATOMIC_COSTS,
  SCENARIOS,
  coldGeneCoordinatorCost,
  extensionReaderCost,
  firstUserOverLimit,
  notificationInboxCost,
  votingCost,
  websiteGuestDiscoveryMergeCost,
  websiteExplorerCost,
} from "./iconoplasm-first-principles-capacity.mjs"

function first(perUser, base) {
  return firstUserOverLimit(perUser, base)[0]
}

test("anonymous homepage cost is derived from the published starter-card path", () => {
  assert.equal(ATOMIC_COSTS.anonymousHomepageCold.workerRequests, 1)
  assert.equal(ATOMIC_COSTS.anonymousHomepageCold.kvReads, 5)
  assert.deepEqual(first(ATOMIC_COSTS.anonymousHomepageCold), {
    resource: "kvReads",
    firstUserOver: 20_001,
  })
})

test("website exploration no longer assigns writes to vote snapshot reads", () => {
  const maximum = websiteExplorerCost({ candidatesPerGene: 44 })
  assert.equal(maximum.workerRequests, 15)
  assert.equal(maximum.durableObjectRequests, 3)
  assert.equal(maximum.durableObjectRowsWritten, 0)
  assert.deepEqual(first(maximum), {
    resource: "kvReads",
    firstUserOver: 3_126,
  })
})

test("website guest shelf retains the catalog but each page session has a bounded merge envelope", () => {
  const maximum = websiteGuestDiscoveryMergeCost()
  assert.equal(maximum.workerRequests, 1)
  assert.equal(maximum.d1RowsWritten, 1_600)
  assert.deepEqual(first(maximum), {
    resource: "d1RowsWritten",
    firstUserOver: 63,
  })
  assert.equal(websiteGuestDiscoveryMergeCost({ discoveries: 20_000 }).d1RowsWritten, 1_600)
})

test("cold coordinator writes are one-time per gene and separate from page views", () => {
  assert.equal(coldGeneCoordinatorCost().durableObjectRowsWritten, 7.916)
  assert.deepEqual(first(coldGeneCoordinatorCost()), {
    resource: "durableObjectRowsWritten",
    firstUserOver: 12_633,
  })
  assert.ok(SCENARIOS.coldCatalogCoordinatorBootstrap.durableObjectRowsWritten > 100_000)
})

test("extension refreshes are caused by pages and qualified hovers, not an idle timer", () => {
  const oneLongPage = extensionReaderCost({
    activeMinutes: 480,
    pageLoads: 1,
    qualifiedHovers: 1,
    uniqueGeneDetails: 8,
    detailBatchFill: 8,
  })
  assert.equal(oneLongPage.workerRequests, 3)
  assert.equal(oneLongPage.kvReads, 13)
})

test("dense-paper and scattered extension behavior expose different ceilings", () => {
  assert.deepEqual(first(SCENARIOS.extensionDensePaper), {
    resource: "kvReads",
    firstUserOver: 136,
  })
  assert.deepEqual(first(SCENARIOS.extensionScatteredMaximum), {
    resource: "kvReads",
    firstUserOver: 19,
  })
  assert.deepEqual(first(SCENARIOS.extensionDensePaper, SCENARIOS.tenThousandOneVisitLurkers), {
    resource: "kvReads",
    firstUserOver: 68,
  })
})

test("signed-in discovery strain is D1 write units, not Durable Object requests", () => {
  assert.equal(SCENARIOS.signedInDensePaper.durableObjectRequests, 0)
  assert.equal(SCENARIOS.signedInDensePaper.d1RowsWritten, 4_096)
  assert.deepEqual(first(SCENARIOS.signedInDensePaper), {
    resource: "d1RowsWritten",
    firstUserOver: 25,
  })
})

test("idle inboxes perform one read while active jobs retain minute freshness", () => {
  assert.equal(notificationInboxCost().workerRequests, 1)
  assert.equal(notificationInboxCost({ openMinutes: 480 }).workerRequests, 481)
})

test("Queue operations are the first conservative ceiling for heavy voters", () => {
  assert.deepEqual(first(votingCost({ votes: 100 })), {
    resource: "queueOperations",
    firstUserOver: 34,
  })
})
