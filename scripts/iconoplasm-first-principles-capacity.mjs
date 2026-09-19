import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY } from "../workers/iconoplasm-background-schedule.js"

const ZERO_COST = Object.freeze({
  workerRequests: 0,
  kvReads: 0,
  kvLists: 0,
  kvWrites: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  durableObjectRequests: 0,
  durableObjectRowsRead: 0,
  durableObjectRowsWritten: 0,
  queueOperations: 0,
})

export const FREE_DAILY_LIMITS = Object.freeze({
  workerRequests: 100_000,
  kvReads: 100_000,
  kvLists: 1_000,
  kvWrites: 1_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  durableObjectRequests: 100_000,
  durableObjectRowsRead: 5_000_000,
  durableObjectRowsWritten: 100_000,
  queueOperations: 10_000,
})

export const PROVIDER_RESOURCE_KEYS = Object.freeze([
  "workerRequests",
  "kvReads",
  "kvWrites",
  "kvLists",
  "d1RowsRead",
  "d1RowsWritten",
  "durableObjectRequests",
  "durableObjectRowsRead",
  "durableObjectRowsWritten",
  "queueOperations",
  "externalRequests",
  "transferBytes",
])

const TASK3_MEASUREMENT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../evidence/iconoplasm/task3-mutation-measurement-v1.json",
)

export function loadTask3MutationMeasurement({ measurementPath = TASK3_MEASUREMENT_PATH } = {}) {
  const artifact = JSON.parse(readFileSync(measurementPath, "utf8"))
  const { digest, digestAlgorithm, ...receipt } = artifact
  const computed = createHash("sha256").update(JSON.stringify(receipt)).digest("hex")
  if (
    artifact.schemaVersion !== 1 ||
    artifact.kind !== "iconoplasm_task3_mutation_measurement" ||
    digestAlgorithm !== "sha256" ||
    digest !== computed ||
    !Number.isFinite(Date.parse(artifact.generatedAt || "")) ||
    artifact.provenance?.productionBaseCommit !== "02a3990870b0a4169e1c2aa4a46778fc46636dac" ||
    artifact.provenance?.measurementCommit !== "0474463e09d4569fbac8984f1184f08067c747bb" ||
    artifact.provenance?.runtime !== "miniflare_d1" ||
    artifact.provenance?.harness !== "workers/iconoplasm/discovery-workload.workerd.test.js" ||
    artifact.workload?.savers !== 2_000 ||
    artifact.workload?.encounters !== 20_000 ||
    artifact.workload?.personalBatches !== 2_000 ||
    artifact.workload?.drainBatches !== 16
  ) {
    throw new Error("TASK3_MUTATION_MEASUREMENT_INVALID")
  }
  for (const [relativePath, expectedSha256] of Object.entries(
    artifact.provenance.fileSha256 || {},
  )) {
    const absolutePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      relativePath,
    )
    const actual = createHash("sha256").update(readFileSync(absolutePath)).digest("hex")
    if (actual !== expectedSha256) throw new Error("TASK3_MUTATION_MEASUREMENT_FILE_MISMATCH")
  }
  for (const value of [
    artifact.meters?.d1RowsRead,
    artifact.meters?.d1RowsWritten,
    artifact.components?.personalReads,
    artifact.components?.personalWrites,
    artifact.components?.drainWrites,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("TASK3_MUTATION_MEASUREMENT_NON_INTEGER")
  }
  if (
    artifact.components.personalReads !== artifact.meters.d1RowsRead ||
    artifact.components.personalWrites + artifact.components.drainWrites !==
      artifact.meters.d1RowsWritten
  ) {
    throw new Error("TASK3_MUTATION_MEASUREMENT_DENOMINATOR_MISMATCH")
  }
  return artifact
}

export const SHIPPED_SHAPE = Object.freeze({
  publishedGenes: 19_023,
  cardBatchSize: 8,
  readingSessionSymbolLimit: 10,
  preparedGeneProjectionRequests: 2,
  coldProjectionKvReads: 3,
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

export function firstPersonaOverLimit(perPersona, base = ZERO_COST, limits = FREE_DAILY_LIMITS) {
  return Object.entries(limits)
    .flatMap(([resource, limit]) => {
      const increment = Number(perPersona?.[resource] || 0)
      if (increment <= 0) return []
      const remaining = Number(limit) - Number(base?.[resource] || 0)
      return [
        {
          resource,
          firstPersonaOver: remaining < 0 ? 0 : Math.floor(remaining / increment) + 1,
        },
      ]
    })
    .sort(
      (left, right) =>
        left.firstPersonaOver - right.firstPersonaOver ||
        left.resource.localeCompare(right.resource),
    )
}

export const ATOMIC_COSTS = Object.freeze({
  scheduledMinimum: cost({
    // Independent Iconoplasm jobs plus three daily GeneGuessr activations.
    workerRequests: ICONOPLASM_BACKGROUND_INVOCATIONS_PER_DAY + 3,
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
    // Two bounded JSON-set statements, including exact membership probes.
    // Full-schema workerd: 600 reads for 200 new, 601 for a 200-symbol replay.
    d1RowsRead: safeDiscoveries > 0 ? 1 + safeDiscoveries * 6 : 0,
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
  uniquePreparedGenes = 512,
  signedIn = false,
  newDiscoveries = signedIn ? uniquePreparedGenes : 0,
  repeatedEncounters = 0,
  portraitFallbacks = 0,
} = {}) {
  const safePreparedGenes = Math.max(0, Math.floor(Number(uniquePreparedGenes) || 0))
  const manifestRefreshes = boundedRefreshCount(pageLoads, activeMinutes)
  const authRefreshes = boundedRefreshCount(qualifiedHovers, activeMinutes)
  const projectionRequests = safePreparedGenes * SHIPPED_SHAPE.preparedGeneProjectionRequests
  const safeNewDiscoveries = signedIn ? Math.max(0, Math.floor(Number(newDiscoveries) || 0)) : 0
  const safeRepeatedEncounters = signedIn
    ? Math.max(0, Math.floor(Number(repeatedEncounters) || 0))
    : 0
  const encounters = safeNewDiscoveries + safeRepeatedEncounters

  return cost({
    workerRequests:
      manifestRefreshes +
      authRefreshes +
      projectionRequests +
      encounters +
      Math.max(0, Math.floor(Number(portraitFallbacks) || 0)),
    // Each prepared gene starts rich detail and portrait-locator projections.
    // On a completely cold isolate and Worker Cache API miss, each projection
    // can read the gallery barrier, card manifest, and one exact card shard.
    // Isolate and Cache API reuse normally make this materially cheaper.
    kvReads: manifestRefreshes * 3 + projectionRequests * SHIPPED_SHAPE.coldProjectionKvReads,
    // Public request paths must use exact-key reads. KV list operations are a
    // 1,000/day discovery budget, not a read primitive.
    kvLists: 0,
    // Personal UPSERT and shared increment commit together. Include every
    // indexed probe inside the statements, not only explicit SELECT calls.
    d1RowsRead: encounters * 5,
    // Conservative schema-derived write units. A new personal discovery touches
    // its table plus four indexes; the shared rollup touches its table plus two
    // indexes. Existing encounters do not add the personal primary-key entry.
    d1RowsWritten: safeNewDiscoveries * 8 + safeRepeatedEncounters * 7,
  })
}

// Metadata transport only. Do not replace whole-reader costs with this: auth,
// scanner refresh, image fallback, votes and CDN bandwidth remain separate.
export function hoverMetadataDeliveryCost({
  indexRequests = 0,
  cdnOriginMisses = 0,
  canonicalRequests = 0,
  legacyFallbackRequests = 0,
} = {}) {
  const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
  const indexes = count(indexRequests)
  const content = count(cdnOriginMisses) + count(canonicalRequests)
  const legacy = count(legacyFallbackRequests)
  return cost({
    workerRequests: indexes + content + legacy,
    // Cold worst case: barrier + current manifest + previous manifest + shard.
    // Normal current-shard miss is three reads; cache HIT is zero, still one invocation.
    kvReads: indexes * 2 + content * 4 + legacy * 3,
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

// Working growth assumptions, NOT observed usage or an owner-approved traffic forecast.
// A favorable partial model must never become a capacity certification. In particular,
// warm Bunny delivery cannot erase signed-in discovery writes or ordinary voting.
export const READER_GROWTH_ASSUMPTIONS = Object.freeze({
  articlesPerReader: 5,
  signedInFraction: 0.2,
  discoveriesPerSignedInReader: 10,
  voterFraction: 0.05,
  votesPerVoter: 2,
  winnerChangeFraction: 0.2,
  bunnyBlockedFraction: 0.02,
})

export const MUTATION_LANES = Object.freeze({
  user_action: 40_000,
  publication: 10_000,
  finalization_recovery: 10_000,
  laptop_delivery: 10_000,
})

export const MEASURED_MUTATION_ENVELOPES = Object.freeze({
  discoveryBatch: Object.freeze({
    encounters: 10,
    reservedD1RowsWritten: 6,
    source:
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  }),
  voteCommand: Object.freeze({
    reservedD1RowsWritten: 4,
    durableObjectRequests: 2,
    durableObjectRowsRead: 8,
    durableObjectRowsWritten: 8,
  }),
  winningProjection: Object.freeze({
    maximumAssets: 8,
    reservedD1RowsWritten: 44,
    reviewedD1RowsReadBound: 400,
    source: "workers/iconoplasm/mutation-plane-bounds.test.js",
  }),
})

function laneAssessment(limit, demanded, measured = 0) {
  const reserved = Math.min(limit, demanded)
  return {
    limit,
    demanded,
    reserved,
    measured,
    remaining: limit - reserved,
    pendingOrRefused: Math.max(0, demanded - reserved),
    fits: demanded <= limit,
  }
}

function resource(operations, limit, status, source, detail) {
  const withinLimit = limit == null ? null : operations <= limit
  const marginFraction = limit == null ? null : (limit - operations) / limit
  return {
    operations,
    limit,
    withinLimit,
    marginFraction,
    evidence: { status, source, ...(detail === undefined ? {} : { detail }) },
  }
}

export function readerGrowthAssessment(dailyReaders, overrides = {}) {
  for (const name of Object.keys(overrides)) {
    if (!Object.hasOwn(READER_GROWTH_ASSUMPTIONS, name)) {
      throw new TypeError(`Unknown reader-growth assumption: ${name}`)
    }
  }
  const assumptions = { ...READER_GROWTH_ASSUMPTIONS, ...overrides }
  const measurement = loadTask3MutationMeasurement()
  if (!Number.isSafeInteger(dailyReaders) || dailyReaders < 0) {
    throw new TypeError("dailyReaders must be a nonnegative safe integer")
  }
  for (const [name, value] of Object.entries(assumptions)) {
    if (!Number.isFinite(value) || value < 0 || (name.endsWith("Fraction") && value > 1)) {
      throw new TypeError(`Invalid reader-growth assumption: ${name}`)
    }
  }
  if (assumptions.voterFraction > assumptions.signedInFraction) {
    throw new TypeError("Voting readers must be included in the signed-in cohort")
  }
  const articleLoads = dailyReaders * assumptions.articlesPerReader
  const signedInReaders = dailyReaders * assumptions.signedInFraction
  const voters = dailyReaders * assumptions.voterFraction
  const votes = voters * assumptions.votesPerVoter
  const savedDiscoveries = signedInReaders * assumptions.discoveriesPerSignedInReader
  const portraitFallbacks = articleLoads * assumptions.bunnyBlockedFraction
  const discoveryBatches = signedInReaders
  const winningImageChanges = votes * assumptions.winnerChangeFraction
  const discoveryReserved =
    discoveryBatches * MEASURED_MUTATION_ENVELOPES.discoveryBatch.reservedD1RowsWritten
  const voteReserved = votes * MEASURED_MUTATION_ENVELOPES.voteCommand.reservedD1RowsWritten
  const userActionDemand = discoveryReserved + voteReserved
  const measurementScale = discoveryBatches / measurement.workload.personalBatches
  const measuredDiscoveryReads = measurement.meters.d1RowsRead * measurementScale
  const measuredDiscoveryWrites = measurement.meters.d1RowsWritten * measurementScale
  const publicationDemand =
    winningImageChanges * MEASURED_MUTATION_ENVELOPES.winningProjection.reservedD1RowsWritten
  const lanes = {
    user_action: laneAssessment(
      MUTATION_LANES.user_action,
      userActionDemand,
      measuredDiscoveryWrites,
    ),
    publication: laneAssessment(MUTATION_LANES.publication, publicationDemand, 0),
    finalization_recovery: laneAssessment(MUTATION_LANES.finalization_recovery, 0, 0),
    laptop_delivery: laneAssessment(MUTATION_LANES.laptop_delivery, 0, 0),
  }
  const providerReserved = Object.values(lanes).reduce((sum, lane) => sum + lane.reserved, 0)
  const pendingOrRefusedUnits = Object.values(lanes).reduce(
    (sum, lane) => sum + lane.pendingOrRefused,
    0,
  )
  const fits = Object.values(lanes).every((lane) => lane.fits)
  const acceptedWinnerChanges = Math.min(
    winningImageChanges,
    Math.floor(
      MUTATION_LANES.publication /
        MEASURED_MUTATION_ENVELOPES.winningProjection.reservedD1RowsWritten,
    ),
  )
  const resources = {
    workerRequests: resource(
      discoveryBatches + votes + acceptedWinnerChanges,
      FREE_DAILY_LIMITS.workerRequests,
      "reviewed_bound",
      "request mix plus one accepted projection consumer invocation per changed winner",
    ),
    kvReads: resource(
      0,
      FREE_DAILY_LIMITS.kvReads,
      "reviewed_bound",
      "static read and mutation topology",
      "no modeled mutation uses KV reads",
    ),
    kvWrites: resource(
      0,
      FREE_DAILY_LIMITS.kvWrites,
      "reviewed_bound",
      "static read and mutation topology",
      "no modeled mutation uses KV writes",
    ),
    kvLists: resource(
      0,
      FREE_DAILY_LIMITS.kvLists,
      "reviewed_bound",
      "static read and mutation topology",
      "no modeled mutation uses KV list",
    ),
    d1RowsRead: resource(
      measuredDiscoveryReads +
        acceptedWinnerChanges *
          MEASURED_MUTATION_ENVELOPES.winningProjection.reviewedD1RowsReadBound,
      FREE_DAILY_LIMITS.d1RowsRead,
      "reviewed_bound",
      measurement.digest,
      "full discovery receipt plus 50-statement x 8-asset projection row bound",
    ),
    d1RowsWritten: resource(
      providerReserved,
      FREE_DAILY_LIMITS.d1RowsWritten,
      "reviewed_bound",
      measurement.digest,
      "lane reservations, not application estimates",
    ),
    durableObjectRequests: resource(
      votes * MEASURED_MUTATION_ENVELOPES.voteCommand.durableObjectRequests,
      FREE_DAILY_LIMITS.durableObjectRequests,
      "reviewed_bound",
      "workers/iconoplasm.vote-coordinator-routing.test.js",
    ),
    durableObjectRowsRead: resource(
      votes * MEASURED_MUTATION_ENVELOPES.voteCommand.durableObjectRowsRead,
      FREE_DAILY_LIMITS.durableObjectRowsRead,
      "reviewed_bound",
      "workers/iconoplasm.vote-coordinator-routing.test.js",
    ),
    durableObjectRowsWritten: resource(
      votes * MEASURED_MUTATION_ENVELOPES.voteCommand.durableObjectRowsWritten,
      FREE_DAILY_LIMITS.durableObjectRowsWritten,
      "reviewed_bound",
      "workers/iconoplasm.vote-coordinator-routing.test.js",
    ),
    queueOperations: resource(
      acceptedWinnerChanges * 3,
      FREE_DAILY_LIMITS.queueOperations,
      "reviewed_bound",
      "one coalesced send/read/delete per accepted dirty-gene projection",
    ),
    externalRequests: resource(
      articleLoads * 0.1,
      null,
      "pending_external",
      "Task 5 Bunny and first-party delivery evidence",
      "10 percent hostile portrait fallback profile",
    ),
    transferBytes: resource(
      0,
      null,
      "pending_external",
      "Task 5 measured p50/p95 bytes",
      "unknown until hosted delivery measurement",
    ),
  }
  return {
    dailyReaders,
    assumptions,
    activity: {
      articleLoads,
      signedInReaders,
      savedDiscoveries,
      voters,
      votes,
      winningImageChanges,
      portraitFallbacks,
    },
    reads: {
      articleLoads,
      portraitFallbacks,
      portraitFallbacksByFraction: {
        0.02: articleLoads * 0.02,
        0.1: articleLoads * 0.1,
      },
      statefulRouteEvents: null,
      statefulOperations: null,
    },
    mutations: {
      discoveryBatches,
      lanes,
      modeledActions: {
        discoveryBatches,
        voteCommands: votes,
        winningProjections: winningImageChanges,
        finalizationRecovery: {
          count: 0,
          reason: "reader workload contains no generation finalization action",
        },
        laptopDelivery: {
          count: 0,
          reason: "reader workload contains no workstation delivery action",
        },
      },
      measuredOperations: {
        discoveryD1RowsRead: measuredDiscoveryReads,
        discoveryD1RowsWritten: measuredDiscoveryWrites,
        voteCommandReservedD1RowsWritten: voteReserved,
        publicationD1RowsWritten: publicationDemand,
      },
      provider: {
        limit: FREE_DAILY_LIMITS.d1RowsWritten,
        ordinaryCeiling: Object.values(MUTATION_LANES).reduce((sum, limit) => sum + limit, 0),
        reserved: providerReserved,
        protectedHeadroom: 30_000,
        unusedOrdinaryCapacity: 70_000 - providerReserved,
      },
      pendingOrRefusedUnits,
      lostAcceptedCommands: null,
    },
    resources,
    evidence: {
      model: "task_3_measured_mutation_receipts",
      productionWiringCertified: false,
      hostedExecution: false,
    },
    verdict: fits ? "fits_measured_isolated_lanes" : "bounded_overflow",
  }
}

export function releaseTierAssessment(dailyReaders, overrides = {}) {
  const modeled = readerGrowthAssessment(dailyReaders, overrides)
  const fits = modeled.verdict === "fits_measured_isolated_lanes"
  return {
    ...modeled,
    readPlane: { verdict: "pending_topology_proof", statefulOperations: null },
    interactionPlane: {
      verdict: fits ? "fits_measured_isolated_lanes" : "bounded_overflow",
      pendingOrRefusedUnits: modeled.mutations.pendingOrRefusedUnits,
      lostAcceptedCommands: null,
    },
    readAvailability: "pending_topology_proof",
    mutationCompletion: fits ? "fits_measured_isolated_lanes" : "pending_or_refused_without_loss",
    verdict: "blocked_pending_topology_proof",
  }
}

export const SCENARIOS = Object.freeze({
  tenThousandOneVisitLurkers: scaleCost(ATOMIC_COSTS.anonymousHomepageCold, 10_000),
  websiteExplorerAverage: websiteExplorerCost(),
  websiteExplorerMaximumCandidates: websiteExplorerCost({
    candidatesPerGene: SHIPPED_SHAPE.candidatesPerGene.maximum,
  }),
  websiteGuestShelfMaximumMerge: websiteGuestDiscoveryMergeCost(),
  extensionDensePaper: extensionReaderCost(),
  extensionColdTenGenePageWorst: extensionReaderCost({
    activeMinutes: 5,
    pageLoads: 1,
    qualifiedHovers: 0,
    uniquePreparedGenes: SHIPPED_SHAPE.readingSessionSymbolLimit,
    portraitFallbacks: SHIPPED_SHAPE.readingSessionSymbolLimit,
  }),
  extensionScatteredMaximum: extensionReaderCost({
    pageLoads: 512,
    qualifiedHovers: 512,
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

function printCapacity(label, perPersona, base = ZERO_COST) {
  const first = firstPersonaOverLimit(perPersona, base)[0]
  console.log(
    `${label}: ${first.resource} first exceeds at complete synthetic persona ${formatNumber(
      first.firstPersonaOver,
    )}.`,
  )
}

export function printReport({ includeComponents = false } = {}) {
  console.log("Iconoplasm action-derived capacity model")
  console.log("No historical traffic counters are inputs.\n")
  console.log("Release tiers use Task 3 measured isolated mutation lanes.")
  console.log("Per reader: 5 articles/day; 20% sign in and save 10 new genes; 5% cast 2 votes.")
  console.log("Assumed: 20% of votes change the winner; 2% of readers need Bunny fallback.")
  for (const readers of [10_000, 100_000, 1_000_000]) {
    const result = releaseTierAssessment(readers)
    console.log(
      `${formatNumber(readers)} daily readers: ${formatNumber(result.activity.votes)} votes, ` +
        `${formatNumber(result.activity.savedDiscoveries)} saved discoveries; read ` +
        `${result.readAvailability}, mutations ${result.mutationCompletion}.`,
    )
  }
  console.log("This model does not certify pending production wiring or Task 5 external gates.")
  if (!includeComponents) {
    console.log("Engineering component stress cases: rerun with --components.")
    return
  }
  console.log("Below: component stress cases, NOT alternative product user limits.\n")
  printCapacity("One-visit homepage visitors", ATOMIC_COSTS.anonymousHomepageCold)
  printCapacity("Curious website explorers", SCENARIOS.websiteExplorerAverage)
  printCapacity("Maximum website guest-shelf merges", SCENARIOS.websiteGuestShelfMaximumMerge)
  printCapacity("Dense-paper extension readers", SCENARIOS.extensionDensePaper)
  printCapacity(
    "Cold ten-gene page sessions with every portrait on first-party fallback",
    SCENARIOS.extensionColdTenGenePageWorst,
  )
  printCapacity(
    "Cold ten-gene page sessions after 10,000 homepage visitors",
    SCENARIOS.extensionColdTenGenePageWorst,
    SCENARIOS.tenThousandOneVisitLurkers,
  )
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
  printReport({ includeComponents: process.argv.includes("--components") })
}
