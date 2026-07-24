import { fileURLToPath } from "node:url"

const ZERO_COST = Object.freeze({
  workerRequests: 0,
  kvReads: 0,
  kvWrites: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  durableObjectRequests: 0,
  durableObjectRowsWritten: 0,
  queueOperations: 0,
})

export const FREE_DAILY_LIMITS = Object.freeze({
  workerRequests: 100_000,
  kvReads: 100_000,
  kvWrites: 1_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  durableObjectRequests: 100_000,
  durableObjectRowsWritten: 100_000,
  queueOperations: 10_000,
})

export const SHIPPED_SHAPE = Object.freeze({
  publishedGenes: 19_023,
  cardArtifactShards: 26,
  cardBatchSize: 8,
  extensionDetailCacheEntries: 512,
  fiveMinuteIntervalsInEightHours: 96,
  fiveMinuteIntervalsInDay: 288,
  homepageStarterShards: 3,
  candidatesPerGene: Object.freeze({
    average: 2.958,
    p50: 2,
    p95: 5,
    p99: 12,
    maximum: 44,
  }),
})

function cost(overrides = {}) {
  return Object.freeze({ ...ZERO_COST, ...overrides })
}

export function addCosts(...costs) {
  const total = { ...ZERO_COST }
  for (const item of costs) {
    for (const resource of Object.keys(total)) {
      total[resource] += Number(item?.[resource] || 0)
    }
  }
  return total
}

export function scaleCost(item, multiplier) {
  const total = { ...ZERO_COST }
  for (const resource of Object.keys(total)) {
    total[resource] = Number(item?.[resource] || 0) * multiplier
  }
  return total
}

export function quotaReserve(ratio, limits = FREE_DAILY_LIMITS) {
  const reserve = { ...ZERO_COST }
  for (const resource of Object.keys(reserve)) {
    reserve[resource] = Number(limits?.[resource] || 0) * ratio
  }
  return reserve
}

export function firstUserOverLimit(perUser, base = ZERO_COST, limits = FREE_DAILY_LIMITS) {
  const candidates = []
  for (const [resource, limit] of Object.entries(limits)) {
    const increment = Number(perUser?.[resource] || 0)
    const alreadyUsed = Number(base?.[resource] || 0)
    if (increment <= 0) continue
    const remaining = limit - alreadyUsed
    candidates.push({
      resource,
      firstUserOver: remaining < 0 ? 0 : Math.floor(remaining / increment) + 1,
    })
  }
  candidates.sort(
    (left, right) =>
      left.firstUserOver - right.firstUserOver || left.resource.localeCompare(right.resource),
  )
  return candidates
}

export const JOURNEY_COSTS = Object.freeze({
  fixedScheduledControlPlane: cost({
    // 96 quarter-hour + 3 daily Worker Cron Trigger activations.
    workerRequests: 99,
    // Hourly observability snapshot publication from GitHub Actions.
    kvWrites: 24,
  }),

  anonymousHomepageCold: cost({
    workerRequests: 1,
    kvReads: 1 + 1 + SHIPPED_SHAPE.homepageStarterShards,
  }),

  anonymousSearchCold: cost({
    workerRequests: 1,
    kvReads: 3,
  }),

  signedOutGenePageAverage: cost({
    workerRequests: 4,
    kvReads: 4,
    d1RowsRead: 4 + SHIPPED_SHAPE.candidatesPerGene.average,
    durableObjectRequests: 1,
    durableObjectRowsWritten: SHIPPED_SHAPE.candidatesPerGene.average,
  }),

  signedOutGenePageMaximum: cost({
    workerRequests: 4,
    kvReads: 4,
    d1RowsRead: 4 + SHIPPED_SHAPE.candidatesPerGene.maximum,
    durableObjectRequests: 1,
    durableObjectRowsWritten: SHIPPED_SHAPE.candidatesPerGene.maximum,
  }),

  signedOutExtensionEightHoursMaximum: cost({
    // 96 manifest refreshes + 96 guest discovery/auth checks + 64 detail batches.
    workerRequests: 96 + 96 + 64,
    // Each manifest can cost 3 reads. Each maximally scattered batch can cost 10.
    kvReads: 96 * 3 + 64 * 10,
  }),

  signedInExtensionEightHoursMaximum: cost({
    // 96 manifest refreshes + 64 detail batches + 1 state read + 512 encounters.
    workerRequests: 96 + 64 + 1 + SHIPPED_SHAPE.extensionDetailCacheEntries,
    kvReads: 96 * 3 + 64 * 10,
    // One discovery row and one shared rollup row per unique encounter.
    d1RowsWritten: SHIPPED_SHAPE.extensionDetailCacheEntries * 2,
    durableObjectRequests: SHIPPED_SHAPE.extensionDetailCacheEntries,
  }),

  signedInSiteVisibleEightHours: cost({
    workerRequests: 8 * 60,
  }),

  coldDisjointSharedDiscoveries: cost({
    // This cost applies only while each symbol is absent from shared discovery state.
    kvWrites: SHIPPED_SHAPE.extensionDetailCacheEntries,
  }),

  bunnyFailureExtensionPortraitFallback: cost({
    // One first-party fallback request for every unique portrait.
    workerRequests: SHIPPED_SHAPE.extensionDetailCacheEntries,
  }),
})

export const SCENARIOS = Object.freeze({
  tenThousandOneVisitLurkers: scaleCost(JOURNEY_COSTS.anonymousHomepageCold, 10_000),

  signedOutExplorerAverage: addCosts(
    JOURNEY_COSTS.anonymousHomepageCold,
    scaleCost(JOURNEY_COSTS.anonymousSearchCold, 5),
    scaleCost(JOURNEY_COSTS.signedOutGenePageAverage, 3),
  ),

  signedOutExplorerMaximumCandidates: addCosts(
    JOURNEY_COSTS.anonymousHomepageCold,
    scaleCost(JOURNEY_COSTS.anonymousSearchCold, 5),
    scaleCost(JOURNEY_COSTS.signedOutGenePageMaximum, 3),
  ),
})

export function fingerprintRefreshCost({ activeHours = 8, concurrentColdIsolates = 1 } = {}) {
  const boundaries = (activeHours * 60) / 5
  return cost({
    kvReads: boundaries * concurrentColdIsolates,
    kvWrites: boundaries * concurrentColdIsolates,
    d1RowsRead: boundaries * concurrentColdIsolates * SHIPPED_SHAPE.publishedGenes,
  })
}

function formatNumber(value) {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 3 })
}

function printCapacity(label, perUser, base = ZERO_COST) {
  const first = firstUserOverLimit(perUser, base)[0]
  console.log(
    `${label}: ${first.resource} first exceeds its free daily limit at user ${formatNumber(first.firstUserOver)}.`,
  )
}

export function printReport() {
  console.log("Iconoplasm first-principles capacity model")
  console.log("No observed request counters are inputs.\n")

  printCapacity("Anonymous cold homepage sessions", JOURNEY_COSTS.anonymousHomepageCold)
  printCapacity(
    "Signed-out explorers (average candidate shape)",
    SCENARIOS.signedOutExplorerAverage,
  )
  printCapacity(
    "Signed-out explorers (maximum candidate shape)",
    SCENARIOS.signedOutExplorerMaximumCandidates,
  )
  printCapacity(
    "Signed-out eight-hour extension users",
    JOURNEY_COSTS.signedOutExtensionEightHoursMaximum,
  )
  printCapacity(
    "Signed-out eight-hour extension users after 10,000 one-visit lurkers",
    JOURNEY_COSTS.signedOutExtensionEightHoursMaximum,
    SCENARIOS.tenThousandOneVisitLurkers,
  )
  printCapacity(
    "Signed-in eight-hour extension users",
    JOURNEY_COSTS.signedInExtensionEightHoursMaximum,
  )
  printCapacity(
    "Signed-out eight-hour extension users after lurkers plus 20% other-account reserve",
    JOURNEY_COSTS.signedOutExtensionEightHoursMaximum,
    addCosts(SCENARIOS.tenThousandOneVisitLurkers, quotaReserve(0.2)),
  )

  const threeRacerRefresh = fingerprintRefreshCost({
    activeHours: 8,
    concurrentColdIsolates: 3,
  })
  console.log(
    `Three cold fingerprint refresh racers over eight active hours read ${formatNumber(threeRacerRefresh.d1RowsRead)} D1 rows (${formatNumber(FREE_DAILY_LIMITS.d1RowsRead)} limit).`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport()
}
