import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  ATOMIC_COSTS,
  SCENARIOS,
  coldGeneCoordinatorCost,
  extensionReaderCost,
  hoverMetadataDeliveryCost,
  readerGrowthAssessment,
  firstPersonaOverLimit,
  notificationInboxCost,
  loadTask3MutationMeasurement,
  PROVIDER_RESOURCE_KEYS,
  releaseTierAssessment,
  votingCost,
  websiteGuestDiscoveryMergeCost,
  websiteExplorerCost,
} from "./iconoplasm-first-principles-capacity.mjs"

function first(perUser, base) {
  return firstPersonaOverLimit(perUser, base)[0]
}

test("10,000 readers use measured mutation receipts instead of the obsolete 172,000-write estimate", () => {
  const measurement = loadTask3MutationMeasurement()
  assert.equal(measurement.schemaVersion, 1)
  assert.equal(measurement.workload.savers, 2_000)
  assert.equal(measurement.workload.encounters, 20_000)
  assert.equal(measurement.meters.d1RowsRead, 6_000)
  assert.equal(measurement.meters.d1RowsWritten, 10_016)
  assert.ok(Number.isInteger(measurement.meters.d1RowsWritten))
  assert.match(measurement.digest, /^[a-f0-9]{64}$/)
  const result = readerGrowthAssessment(10_000)
  assert.equal(result.activity.articleLoads, 50_000)
  assert.equal(result.activity.voters, 500)
  assert.equal(result.activity.votes, 1_000)
  assert.equal(result.activity.winningImageChanges, 200)
  assert.equal(result.activity.savedDiscoveries, 20_000)
  assert.equal(result.mutations.lanes.user_action.reserved, 16_000)
  assert.equal(result.mutations.lanes.user_action.measured, 10_016)
  assert.equal(result.mutations.lanes.publication.reserved, 8_800)
  assert.deepEqual(result.mutations.measuredOperations, {
    discoveryD1RowsRead: 6_000,
    discoveryD1RowsWritten: 10_016,
    voteCommandReservedD1RowsWritten: 4_000,
    publicationD1RowsWritten: 8_800,
  })
  assert.equal(result.mutations.provider.reserved, 24_800)
  assert.equal(result.mutations.provider.protectedHeadroom, 30_000)
  assert.equal(result.mutations.provider.unusedOrdinaryCapacity, 45_200)
  assert.equal(result.mutations.provider.ordinaryCeiling, 70_000)
  assert.deepEqual(result.mutations.modeledActions.finalizationRecovery, {
    count: 0,
    reason: "reader workload contains no generation finalization action",
  })
  assert.deepEqual(result.mutations.modeledActions.laptopDelivery, {
    count: 0,
    reason: "reader workload contains no workstation delivery action",
  })
  assert.equal(result.verdict, "fits_measured_isolated_lanes")
  assert.equal(result.evidence.productionWiringCertified, false)
  assert.deepEqual(result.reads.portraitFallbacksByFraction, {
    0.02: 1_000,
    0.1: 5_000,
  })
  assert.deepEqual(Object.keys(result.resources), PROVIDER_RESOURCE_KEYS)
  for (const [name, resource] of Object.entries(result.resources)) {
    assert.ok(Number.isInteger(resource.operations), name)
    assert.ok(
      ["measured", "reviewed_bound", "not_applicable", "pending_external"].includes(
        resource.evidence.status,
      ),
      name,
    )
    assert.notEqual(resource.evidence.status, "assumed", name)
  }
})

test("release tiers separate static read availability from mutation completion", () => {
  const tenThousand = releaseTierAssessment(10_000)
  assert.equal(tenThousand.readAvailability, "pending_topology_proof")
  assert.equal(tenThousand.mutationCompletion, "fits_measured_isolated_lanes")
  assert.equal(tenThousand.verdict, "blocked_pending_topology_proof")

  const million = releaseTierAssessment(1_000_000)
  assert.equal(million.readAvailability, "pending_topology_proof")
  assert.equal(million.mutationCompletion, "pending_or_refused_without_loss")
  assert.ok(million.mutations.pendingOrRefusedUnits > 0)
  assert.equal(million.interactionPlane.lostAcceptedCommands, null)
  assert.equal(million.verdict, "blocked_pending_topology_proof")

  const anonymous = releaseTierAssessment(100_000)
  assert.equal(anonymous.activity.articleLoads, 500_000)
  assert.equal(anonymous.activity.signedInReaders, 20_000)
  assert.equal(anonymous.activity.savedDiscoveries, 200_000)
  assert.equal(anonymous.activity.votes, 10_000)
  assert.equal(anonymous.activity.winningImageChanges, 2_000)
  assert.equal(anonymous.readPlane.verdict, "pending_topology_proof")
  assert.equal(anonymous.interactionPlane.verdict, "bounded_overflow")
  assert.ok(anonymous.interactionPlane.pendingOrRefusedUnits > 0)
})

test("healthy CDN delivery does not erase discovery or vote costs", () => {
  const result = readerGrowthAssessment(10_000, { bunnyBlockedFraction: 0 })
  assert.equal(result.reads.portraitFallbacks, 0)
  assert.equal(result.mutations.lanes.user_action.reserved, 16_000)
  assert.equal(result.verdict, "fits_measured_isolated_lanes")
})

test("regional fallback and voter participation are explicit independent growth axes", () => {
  const baseline = readerGrowthAssessment(10_000)
  const regional = readerGrowthAssessment(10_000, { bunnyBlockedFraction: 0.1 })
  assert.equal(regional.reads.portraitFallbacks, 5_000)
  assert.equal(regional.reads.statefulOperations, null)
  assert.equal(regional.activity.votes, baseline.activity.votes)
  const engaged = readerGrowthAssessment(10_000, { voterFraction: 0.2 })
  assert.equal(engaged.activity.votes, 4_000)
  assert.equal(engaged.mutations.lanes.user_action.reserved, 28_000)
})

test("growth assumptions reject invalid input and preserve fractional expected cohorts", () => {
  assert.throws(() => readerGrowthAssessment(-1), TypeError)
  assert.throws(() => readerGrowthAssessment(1.5), TypeError)
  assert.throws(() => readerGrowthAssessment(10, { signedInFraction: 2 }), TypeError)
  assert.throws(() => readerGrowthAssessment(10, { votesPerVoter: NaN }), TypeError)
  assert.throws(() => readerGrowthAssessment(10, { voterFraction: 0.3 }), TypeError)
  assert.throws(() => readerGrowthAssessment(10, { readerCount: 100 }), TypeError)
  assert.equal(readerGrowthAssessment(10).activity.votes, 1)
})

test("default capacity report leads with reader verdicts and hides isolated persona ceilings", () => {
  const script = fileURLToPath(
    new URL("./iconoplasm-first-principles-capacity.mjs", import.meta.url),
  )
  const options = { encoding: "utf8", timeout: 10_000, maxBuffer: 32_768, windowsHide: true }
  const report = execFileSync(process.execPath, [script], options)
  assert.match(report, /10,000 daily readers/)
  assert.match(report, /100,000 daily readers/)
  assert.match(report, /1,000,000 daily readers/)
  assert.match(report, /measured isolated mutation lanes/)
  assert.doesNotMatch(report, /first exceeds at complete synthetic persona/)
  const engineering = execFileSync(process.execPath, [script, "--components"], options)
  assert.match(engineering, /NOT alternative product user limits/)
  assert.match(engineering, /first exceeds at complete synthetic persona/)
})

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
