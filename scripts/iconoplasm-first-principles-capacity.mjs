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
  cardBatchSize: 8,
  extensionDetailCacheEntries: 512,
  fiveMinuteWindowsInEightHours: 96,
  homepageStarterShards: 3,
  websiteGuestDiscoveryMaxEntries: 19_023,
  websiteGuestDiscoveryMergeBatchSize: 200,
  candidatesPerGene: Object.freeze({
    average: 2.958,
    maximum: 44,
  }),
})

function cost(overrides = {}) {
  return Object.freeze({ ...ZERO_COST, ...overrides })
}

export function addCosts(...items) {
  const total = { ...ZERO_COST }
  for (const item of items) {
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

export function firstUserOverLimit(perUser, base = ZERO_COST, limits = FREE_DAILY_LIMITS) {
  return Object.entries(limits)
    .flatMap(([resource, limit]) => {
      const increment = Number(perUser?.[resource] || 0)
      if (increment <= 0) return []
      const remaining = Number(limit) - Number(base?.[resource] || 0)
      return [
        {
          resource,
          firstUserOver: remaining < 0 ? 0 : Math.floor(remaining / increment) + 1,
        },
      ]
    })
    .sort(
      (left, right) =>
        left.firstUserOver - right.firstUserOver || left.resource.localeCompare(right.resource),
    )
}

export const ATOMIC_COSTS = Object.freeze({
  scheduledMinimum: cost({
    // 96 quarter-hour + 3 daily Worker cron activations.
    workerRequests: 99,
    // Hourly observability publication. The hourly shared-discovery publisher
    // adds at most 24 KV reads and only writes when its symbol set changed.
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
})

export function websiteExplorerCost({
  searches = 5,
  genePages = 3,
  candidatesPerGene = SHIPPED_SHAPE.candidatesPerGene.average,
} = {}) {
  const safeSearches = Math.max(0, Number(searches) || 0)
  const safeGenePages = Math.max(0, Number(genePages) || 0)
  const safeCandidates = Math.max(0, Number(candidatesPerGene) || 0)
  return addCosts(
    ATOMIC_COSTS.anonymousHomepageCold,
    scaleCost(ATOMIC_COSTS.anonymousSearchCold, safeSearches),
    cost({
      // Dynamic document + vote snapshot + comments. Anonymous discovery POSTs
      // are suppressed because they cannot create a server-side shelf.
      workerRequests: safeGenePages * 3,
      kvReads: safeGenePages * 4,
      d1RowsRead: safeGenePages * (4 + safeCandidates),
      durableObjectRequests: safeGenePages,
    }),
  )
}

export function websiteGuestDiscoveryMergeCost({
  discoveries = SHIPPED_SHAPE.websiteGuestDiscoveryMergeBatchSize,
} = {}) {
  const safeDiscoveries = Math.max(
    0,
    Math.min(
      SHIPPED_SHAPE.websiteGuestDiscoveryMergeBatchSize,
      Math.floor(Number(discoveries) || 0),
    ),
  )
  return cost({
    workerRequests: safeDiscoveries > 0 ? 1 : 0,
    d1RowsRead: safeDiscoveries * 2,
    // Same conservative schema-derived envelope as a new signed-in discovery:
    // personal row/indexes plus the constant-time shared rollup/indexes.
    d1RowsWritten: safeDiscoveries * 8,
  })
}

export function coldGeneCoordinatorCost({
  genes = 1,
  candidatesPerGene = SHIPPED_SHAPE.candidatesPerGene.average,
} = {}) {
  const safeGenes = Math.max(0, Number(genes) || 0)
  const safeCandidates = Math.max(0, Number(candidatesPerGene) || 0)
  return cost({
    durableObjectRowsWritten: safeGenes * (2 + safeCandidates * 2),
  })
}

function boundedRefreshCount(events, activeMinutes) {
  const safeEvents = Math.max(0, Math.floor(Number(events) || 0))
  if (!safeEvents) return 0
  const windows = Math.max(1, Math.ceil(Math.max(0, Number(activeMinutes) || 0) / 5))
  return Math.min(safeEvents, windows)
}

export function extensionReaderCost({
  activeMinutes = 480,
  pageLoads = 32,
  qualifiedHovers = 32,
  uniqueGeneDetails = 512,
  detailBatchFill = SHIPPED_SHAPE.cardBatchSize,
  signedIn = false,
  newDiscoveries = signedIn ? uniqueGeneDetails : 0,
  repeatedEncounters = 0,
  portraitFallbacks = 0,
} = {}) {
  const safeDetails = Math.max(0, Math.floor(Number(uniqueGeneDetails) || 0))
  const safeFill = Math.max(
    1,
    Math.min(SHIPPED_SHAPE.cardBatchSize, Math.floor(Number(detailBatchFill) || 1)),
  )
  const manifestRefreshes = boundedRefreshCount(pageLoads, activeMinutes)
  const authRefreshes = boundedRefreshCount(qualifiedHovers, activeMinutes)
  const detailBatches = Math.ceil(safeDetails / safeFill)
  const safeNewDiscoveries = signedIn ? Math.max(0, Math.floor(Number(newDiscoveries) || 0)) : 0
  const safeRepeatedEncounters = signedIn
    ? Math.max(0, Math.floor(Number(repeatedEncounters) || 0))
    : 0
  const encounters = safeNewDiscoveries + safeRepeatedEncounters

  return cost({
    workerRequests:
      manifestRefreshes +
      authRefreshes +
      detailBatches +
      encounters +
      Math.max(0, Math.floor(Number(portraitFallbacks) || 0)),
    // Manifest reads include version/delivery metadata; a detail batch may read
    // its manifest plus eight content-addressed card shards.
    kvReads: manifestRefreshes * 3 + detailBatches * 10,
    // Two indexed point reads: existence before mutation and the returned row.
    d1RowsRead: encounters * 2,
    // Conservative schema-derived write units. A new personal discovery touches
    // its table plus four indexes; the shared rollup touches its table plus two
    // indexes. Existing encounters do not add the personal primary-key entry.
    d1RowsWritten: safeNewDiscoveries * 8 + safeRepeatedEncounters * 7,
  })
}

export function notificationInboxCost({ openMinutes = 0, focusReturns = 0 } = {}) {
  const safeOpenMinutes = Math.max(0, Math.floor(Number(openMinutes) || 0))
  const safeFocusReturns = Math.max(0, Math.floor(Number(focusReturns) || 0))
  return cost({
    // One startup/focus read remains useful. Minute polling exists only while a
    // generation request is actually open.
    workerRequests: 1 + safeFocusReturns + safeOpenMinutes,
  })
}

export function votingCost({ votes = 1 } = {}) {
  const safeVotes = Math.max(0, Math.floor(Number(votes) || 0))
  return cost({
    workerRequests: safeVotes,
    durableObjectRequests: safeVotes,
    // Worst case: user vote, image summary, two vision summaries, outbox,
    // mutation sequence/meta, and alarm storage.
    durableObjectRowsWritten: safeVotes * 8,
    // Conservative projection envelope including indexed D1 rows.
    d1RowsWritten: safeVotes * 12,
    // One write, read, and delete for each successfully delivered Queue message.
    queueOperations: safeVotes * 3,
  })
}

export const SCENARIOS = Object.freeze({
  tenThousandOneVisitLurkers: scaleCost(ATOMIC_COSTS.anonymousHomepageCold, 10_000),
  websiteExplorerAverage: websiteExplorerCost(),
  websiteExplorerMaximumCandidates: websiteExplorerCost({
    candidatesPerGene: SHIPPED_SHAPE.candidatesPerGene.maximum,
  }),
  websiteGuestShelfMaximumMerge: websiteGuestDiscoveryMergeCost(),
  extensionDensePaper: extensionReaderCost(),
  extensionScatteredMaximum: extensionReaderCost({
    pageLoads: 512,
    qualifiedHovers: 512,
    detailBatchFill: 1,
  }),
  signedInDensePaper: extensionReaderCost({ signedIn: true }),
  hundredVoteContributor: votingCost({ votes: 100 }),
  coldCatalogCoordinatorBootstrap: coldGeneCoordinatorCost({
    genes: SHIPPED_SHAPE.publishedGenes,
  }),
})

function formatNumber(value) {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 3 })
}

function printCapacity(label, perUser, base = ZERO_COST) {
  const first = firstUserOverLimit(perUser, base)[0]
  console.log(
    `${label}: ${first.resource} first exceeds at user ${formatNumber(first.firstUserOver)}.`,
  )
}

export function printReport() {
  console.log("Iconoplasm action-derived capacity model")
  console.log("No historical traffic counters are inputs.\n")
  printCapacity("One-visit homepage visitors", ATOMIC_COSTS.anonymousHomepageCold)
  printCapacity("Curious website explorers", SCENARIOS.websiteExplorerAverage)
  printCapacity("Maximum website guest-shelf merges", SCENARIOS.websiteGuestShelfMaximumMerge)
  printCapacity("Dense-paper extension readers", SCENARIOS.extensionDensePaper)
  printCapacity(
    "Dense-paper extension readers after 10,000 homepage visitors",
    SCENARIOS.extensionDensePaper,
    SCENARIOS.tenThousandOneVisitLurkers,
  )
  printCapacity("Maximally scattered extension readers", SCENARIOS.extensionScatteredMaximum)
  printCapacity("Signed-in dense-paper readers", SCENARIOS.signedInDensePaper)
  printCapacity("100-vote contributors", SCENARIOS.hundredVoteContributor)
  printCapacity("Cold gene coordinator bootstraps", coldGeneCoordinatorCost())
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printReport()
}
