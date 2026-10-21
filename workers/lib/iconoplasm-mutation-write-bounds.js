// ARCHITECTURE FENCE [IPD-004]
// The bounds on how much one operation may touch, and the rows it writes where
// a price is measured rather than estimated. Every number is the worst case on
// the complete migrated schema; change one only together with a new measurement.

// A vision carries at most this many distinct emulsion codes, enforced where the
// rebuild reads them (workers/iconoplasm/vision-emulsion-code-bound.js) before it
// writes anything. Production, read-only, 2026-10-03: 1,860 visions, 2,245
// vision-code pairs; 1,605 visions carry one code, 234 carry two, the most any
// carries is 17 (four visions: the legacy code and one per pipeline letter A to
// P). 24 leaves seven codes of room and still covers one code per factory
// pipeline plus the legacy code if the catalog grows; a vision above it is
// refused with a named error, and the bound is raised only together with a new
// measurement of VISION_ROLLUP_ROWS.
export const MAX_EMULSION_CODES_PER_VISION = 24

// One vision rebuild (the vision row and its option rollups, and the registered
// pair and option rollup of every code it carries or just stopped carrying),
// measured at MAX_EMULSION_CODES_PER_VISION codes in the worst of three runs: a
// first build writes about six rows per code, and replacing every code writes
// about eight (the stale pair and rollup go, the new pair and rollup come).
// A typical vision (one or two codes) writes about 17 rows, so the price is
// several times what a run writes: it can't know a vision's code count without
// scanning its assets.
export const VISION_ROLLUP_ROWS = 194

// B-1057: a gene object build marks the visions a gene touched instead of
// rebuilding each one, and the request-picker job rebuilds every marked vision
// once, in one batch. A mark is one row of icono_vision_rollup_dirty and its
// primary-key index entry.
export const VISION_ROLLUP_DIRTY_MARK_ROWS = 2

// One run of the request-picker job's vision rebuild: every vision's rebuild,
// its claim (the mark removed) and at worst its re-mark, when a vision above its
// emulsion-code bound is set aside or the run stops early. It is the run's
// rows-written price (B-1067, batch-admission.js).
export function visionRollupBatchWriteUnits(visionCount) {
  const visions = Number.isSafeInteger(visionCount) && visionCount > 0 ? visionCount : 0
  if (!visions) throw new RangeError("A vision rollup batch rebuilds at least one vision")
  return visions * (VISION_ROLLUP_ROWS + 2 * VISION_ROLLUP_DIRTY_MARK_ROWS)
}

// A claim reads up to scanLimit open requests, quarantines every one whose exact
// source is permanently gone and leases up to claimLimit of the rest. The two
// clamps below are the ones generationRequestLeaseClaim applies.
export const GENERATION_CLAIM_DEFAULT_LIMIT = 10
export const GENERATION_CLAIM_LIMIT_CEILING = 50
export const GENERATION_CLAIM_SCAN_PER_LEASE = 4
export const GENERATION_CLAIM_SCAN_FLOOR = 20
export const GENERATION_CLAIM_SCAN_CEILING = 200

export function generationClaimBounds(rawLimit) {
  const claimLimit = Math.max(
    1,
    Math.min(
      GENERATION_CLAIM_LIMIT_CEILING,
      Math.trunc(Number(rawLimit) || GENERATION_CLAIM_DEFAULT_LIMIT),
    ),
  )
  const scanLimit = Math.min(
    GENERATION_CLAIM_SCAN_CEILING,
    Math.max(GENERATION_CLAIM_SCAN_FLOOR, claimLimit * GENERATION_CLAIM_SCAN_PER_LEASE),
  )
  return { claimLimit, scanLimit }
}

// A completion carries the requests of one generation session, which one claim
// leased. These are batch sizes for the workstation's own work, not limits a
// reader meets: an order may be drawn across several sessions, and its receipt
// is grouped by the order (migrations-iconoplasm/0134_delivery_groups_by_order.sql).
// A body above the bound is refused before any write.
export const GENERATION_COMPLETION_MAX_REQUESTS = GENERATION_CLAIM_LIMIT_CEILING

// What a completion body asks for: how many items, and how many distinct
// request ids across them. The handler refuses a body over the bound on either.
export function generationCompletionSize(body) {
  const items = Array.isArray(body?.items) ? body.items : []
  const requestIds = new Set()
  for (const item of items) {
    for (const value of Array.isArray(item?.request_ids) ? item.request_ids : []) {
      const id = Number(value || 0)
      if (id > 0) requestIds.add(id)
    }
  }
  return { items: items.length, requestIds: requestIds.size }
}
