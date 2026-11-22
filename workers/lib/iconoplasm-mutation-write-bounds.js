// ARCHITECTURE FENCE [IPD-004]
// The bounds on how much one operation may touch, and the rows it writes where
// a price is measured rather than estimated. Every number is the worst case on
// the complete migrated schema; change one only together with a new measurement.

// One vision rebuild (icono_admin_vision_rollup +
// icono_generation_request_vision_option_rollup, with its secondary indexes).
// Measured in Miniflare on the complete migrated schema (B-1283,
// workers/iconoplasm/sync-rollup-read-cost.test.js) after retiring the
// duplicate factory-option rollup and its emulsion-code bound: insert writes 9
// rows, updating every indexed column writes 6, repeat writes 0. 12 leaves
// headroom over the worst case (down from 194 before B-1283).
export const VISION_ROLLUP_ROWS = 12

// B-1057: a gene object build marks the visions a gene touched instead of
// rebuilding each one, and the request-picker job rebuilds every marked vision
// once, in one batch. A mark is one row of icono_vision_rollup_dirty and its
// primary-key index entry.
export const VISION_ROLLUP_DIRTY_MARK_ROWS = 2

// One run of the request-picker job's vision rebuild: every vision's rebuild
// plus removing its dirty mark. It is the run's rows-written price (B-1067,
// batch-admission.js).
export function visionRollupBatchWriteUnits(visionCount) {
  const visions = Number.isSafeInteger(visionCount) && visionCount > 0 ? visionCount : 0
  if (!visions) throw new RangeError("A vision rollup batch rebuilds at least one vision")
  return visions * (VISION_ROLLUP_ROWS + VISION_ROLLUP_DIRTY_MARK_ROWS)
}

// A claim reads up to scanLimit open requests, quarantines every one whose exact
// source is permanently gone and leases up to claimLimit of the rest. The two
// clamps below are the ones generationRequestLeaseClaim applies.
export const GENERATION_CLAIM_DEFAULT_LIMIT = 10
export const GENERATION_CLAIM_LIMIT_CEILING = 50
export const GENERATION_CLAIM_SCAN_PER_LEASE = 4
export const GENERATION_CLAIM_SCAN_FLOOR = 20
export const GENERATION_CLAIM_SCAN_CEILING = 200

export function generationClaimBounds(rawLimit, excludedCount = 0) {
  const claimLimit = Math.max(
    1,
    Math.min(
      GENERATION_CLAIM_LIMIT_CEILING,
      Math.trunc(Number(rawLimit) || GENERATION_CLAIM_DEFAULT_LIMIT),
    ),
  )
  const skipped = Math.max(
    0,
    Math.min(GENERATION_CLAIM_SCAN_CEILING, Math.trunc(Number(excludedCount) || 0)),
  )
  const scanLimit = Math.min(
    GENERATION_CLAIM_SCAN_CEILING,
    Math.max(GENERATION_CLAIM_SCAN_FLOOR, claimLimit * GENERATION_CLAIM_SCAN_PER_LEASE + skipped),
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
