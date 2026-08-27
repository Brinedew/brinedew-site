import assert from "node:assert/strict"
import test from "node:test"

import {
  ATOMIC_COSTS,
  SCENARIOS,
  coldGeneCoordinatorCost,
  extensionReaderCost,
  hoverMetadataDeliveryCost,
  firstPersonaOverLimit,
  notificationInboxCost,
  votingCost,
  websiteGuestDiscoveryMergeCost,
  websiteExplorerCost,
} from "./iconoplasm-first-principles-capacity.mjs"

function first(perUser, base) {
  return firstPersonaOverLimit(perUser, base)[0]
}

test("metadata CDN model counts installations, cold fills, blocked networks and recovery separately", () => {
  const warm = hoverMetadataDeliveryCost({ indexRequests: 100 })
  const cold = hoverMetadataDeliveryCost({ indexRequests: 100, cdnOriginMisses: 20 })
  const blocked = hoverMetadataDeliveryCost({ indexRequests: 100, canonicalRequests: 2000 })
  assert.equal(warm.workerRequests, 100)
  assert.equal(cold.workerRequests, 120)
  assert.equal(cold.kvReads, 280)
  assert.equal(blocked.workerRequests, 2100)
  assert.equal(blocked.kvWrites, 0)
  assert.equal(blocked.d1RowsRead, 0)
  assert.equal(
    hoverMetadataDeliveryCost({ indexRequests: 1, canonicalRequests: 2, legacyFallbackRequests: 2 })
      .workerRequests,
    5,
  )
})

test("anonymous homepage cost is derived from the published starter-card path", () => {
  assert.equal(ATOMIC_COSTS.anonymousHomepageCold.workerRequests, 1)
  assert.equal(ATOMIC_COSTS.anonymousHomepageCold.kvReads, 5)
  assert.deepEqual(first(ATOMIC_COSTS.anonymousHomepageCold), {
    resource: "kvReads",
    firstPersonaOver: 20_001,
  })
})

test("website exploration no longer assigns writes to vote snapshot reads", () => {
  const maximum = websiteExplorerCost({ candidatesPerGene: 44 })
  assert.equal(maximum.workerRequests, 15)
  assert.equal(maximum.durableObjectRequests, 3)
  assert.equal(maximum.durableObjectRowsWritten, 0)
  assert.deepEqual(first(maximum), {
    resource: "kvReads",
    firstPersonaOver: 3_126,
  })
})

test("website guest shelf retains the catalog but each page session has a bounded merge envelope", () => {
  const maximum = websiteGuestDiscoveryMergeCost()
  assert.equal(maximum.workerRequests, 1)
  assert.equal(maximum.d1RowsWritten, 1_600)
  assert.deepEqual(first(maximum), {
    resource: "d1RowsWritten",
    firstPersonaOver: 63,
  })
  assert.equal(websiteGuestDiscoveryMergeCost({ discoveries: 20_000 }).d1RowsWritten, 1_600)
})

test("cold coordinator writes are one-time per gene and separate from page views", () => {
  assert.equal(coldGeneCoordinatorCost().durableObjectRowsWritten, 7.916)
  assert.deepEqual(first(coldGeneCoordinatorCost()), {
    resource: "durableObjectRowsWritten",
    firstPersonaOver: 12_633,
  })
  assert.ok(SCENARIOS.coldCatalogCoordinatorBootstrap.durableObjectRowsWritten > 100_000)
})

test("extension refreshes are caused by pages and qualified hovers, not an idle timer", () => {
  const oneLongPage = extensionReaderCost({
    activeMinutes: 480,
    pageLoads: 1,
    qualifiedHovers: 1,
    uniquePreparedGenes: 8,
  })
  assert.equal(oneLongPage.workerRequests, 18)
  assert.equal(oneLongPage.kvReads, 51)
  assert.equal(oneLongPage.kvLists, 0)
})

test("current per-symbol projections expose conservative cold-isolate ceilings", () => {
  assert.deepEqual(first(SCENARIOS.extensionDensePaper), {
    resource: "kvReads",
    firstPersonaOver: 32,
  })
  assert.deepEqual(first(SCENARIOS.extensionScatteredMaximum), {
    resource: "kvReads",
    firstPersonaOver: 30,
  })
  assert.deepEqual(first(SCENARIOS.extensionDensePaper, SCENARIOS.tenThousandOneVisitLurkers), {
    resource: "kvReads",
    firstPersonaOver: 16,
  })
})

test("ten simultaneous cold tabs stay below both per-IP projection lanes", () => {
  const users = 10
  const symbolsPerTab = 10
  const requestsPerLane = users * symbolsPerTab
  assert.equal(requestsPerLane, 100)
  assert.ok(requestsPerLane < 120)

  const worstColdTab = extensionReaderCost({
    activeMinutes: 5,
    pageLoads: 1,
    qualifiedHovers: 0,
    uniquePreparedGenes: symbolsPerTab,
    portraitFallbacks: symbolsPerTab,
  })
  assert.equal(worstColdTab.workerRequests, 31)
  assert.equal(worstColdTab.kvReads, 63)
  assert.equal(worstColdTab.kvLists, 0)
  assert.deepEqual(first(SCENARIOS.extensionColdTenGenePageWorst), {
    resource: "kvReads",
    firstPersonaOver: 1_588,
  })
  assert.deepEqual(
    first(SCENARIOS.extensionColdTenGenePageWorst, SCENARIOS.tenThousandOneVisitLurkers),
    {
      resource: "kvReads",
      firstPersonaOver: 794,
    },
  )
})

test("signed-in discovery strain is D1 write units, not Durable Object requests", () => {
  assert.equal(SCENARIOS.signedInDensePaper.durableObjectRequests, 0)
  assert.equal(SCENARIOS.signedInDensePaper.d1RowsWritten, 4_096)
  assert.deepEqual(first(SCENARIOS.signedInDensePaper), {
    resource: "d1RowsWritten",
    firstPersonaOver: 25,
  })
})

test("idle inboxes perform one read while active jobs retain minute freshness", () => {
  assert.equal(notificationInboxCost().workerRequests, 1)
  assert.equal(notificationInboxCost({ openMinutes: 480 }).workerRequests, 481)
})

test("Queue operations are the first conservative ceiling for heavy voters", () => {
  assert.deepEqual(first(votingCost({ votes: 100 })), {
    resource: "queueOperations",
    firstPersonaOver: 34,
  })
})
