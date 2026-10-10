// ARCHITECTURE FENCE [IPD-004]
// One concern, one owner: how many D1 rows one admitted operation may write.
//
// A reservation's unit is a D1 row written, the provider's own meter, which
// counts every index entry and trigger write behind a statement. It is not a
// statement and not a D1 call. Every number below is the worst case measured
// from provider receipts on the complete migrated schema by
// workers/iconoplasm/finalization-reservation-receipts.test.js (finalization and
// the vision rebuild), generation-executor-reservation-receipts.test.js (the
// generation executor routes) and tags-derivative-reservation-receipts.test.js
// (the tags submission). Each drives the real operation at its worst input and
// fails when a migration, index, trigger or statement changes the number. Change
// a constant only together with that measurement.
//
// 50 is the floor of every reservation: a smaller measured worst case still
// reserves 50, which absorbs one more index or trigger before a test must be
// re-pinned. An operation whose size is above the floor carries its size in
// its identity (reservationIdentity), so a receipt held under an earlier
// sizing can never be replayed at a different size. An operation that writes
// no row (reading a lease's material) reserves nothing.

import { FINALIZATION_COMPLETION_PAGE_SIZE } from "../iconoplasm/sync-finalization-publication.js"

export const MUTATION_WRITE_FLOOR_UNITS = 50

// One version-fenced UPDATE of one icono_sync_finalization_jobs row: the row,
// the index entries that move and the summary counter trigger, seven rows
// written in all.
export const FINALIZATION_JOB_TRANSITION_ROWS = 7

// One job completed by the page statement (COMPLETE_READY_FINALIZATION_SQL).
export const FINALIZATION_COMPLETION_ROW_ROWS = 4

// One vote-summary row and its primary key, per asset the rebuild has to
// create or change (migration 0119 dropped its two unread indexes, B-1065).
export const VOTE_SUMMARY_ROWS_PER_ASSET = 2

export const GENE_ROLLUP_ROWS = 8

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
// A typical vision (one or two codes) writes about 17 rows beyond its claim and
// advance, so a bulk finalization reserves several times what it writes; the
// reservation cannot know a vision's code count without scanning its assets.
export const VISION_ROLLUP_ROWS = 194

// B-1057: sync finalization marks the visions a gene touched instead of
// rebuilding each one, and the request-picker job rebuilds every marked vision
// once, in one batch. A mark is one row of icono_vision_rollup_dirty and its
// primary-key index entry.
export const VISION_ROLLUP_DIRTY_MARK_ROWS = 2

// A reconcile republishes the gene and restores or marks assets one statement
// group at a time. Our 50-statement invocation budget
// (workers/lib/d1-invocation-budget.js) stops the restoring after
// RECONCILE_RESTORES_PER_INVOCATION assets. Measured on 2026-10-09 (CI receipts,
// finalization-reservation-receipts.test.js) once reconcile stopped writing the
// unread emulsion option rollup and elections stopped marking winners
// "approved", and remeasured on 2026-10-10 after migration 0120 dropped the
// portrait indexes nothing read (status, legacy, artist tag, source revision;
// B-1072): 21 rows with nothing to restore, about 13 more per restore, and at
// most 306 at the 17-restore cap with the marking of stale assets. A fixed row
// and 18 per restore fits all 22 measured runs within the guard's 35%.
export const RECONCILE_FIXED_ROWS = 1
export const RECONCILE_RESTORE_EXTRA_ROWS_PER_ASSET = 18
export const RECONCILE_RESTORES_PER_INVOCATION = 17
// The after-response republish of a touched gene (route row and card
// materialization wake-up).
export const GENE_REPUBLISH_ROWS = 4

export { FINALIZATION_COMPLETION_PAGE_SIZE }

export function reservationIdentity(baseIdentity, units) {
  return units === MUTATION_WRITE_FLOOR_UNITS ? baseIdentity : `${baseIdentity}:u${units}`
}

function atLeastFloor(rows) {
  return Math.max(MUTATION_WRITE_FLOOR_UNITS, rows)
}

function count(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export function finalizationRecoveryWriteUnits() {
  return atLeastFloor(FINALIZATION_JOB_TRANSITION_ROWS)
}

export function finalizationCompletionPageWriteUnits(rowCount) {
  const rows = count(rowCount)
  if (rows > FINALIZATION_COMPLETION_PAGE_SIZE)
    throw new RangeError("A completion page holds at most one page of jobs")
  return atLeastFloor(rows * FINALIZATION_COMPLETION_ROW_ROWS)
}

function reconcileBodyRows(assetCount) {
  const assets = count(assetCount)
  if (!assets) return 0
  return (
    RECONCILE_FIXED_ROWS +
    GENE_REPUBLISH_ROWS +
    RECONCILE_RESTORE_EXTRA_ROWS_PER_ASSET * Math.min(assets, RECONCILE_RESTORES_PER_INVOCATION)
  )
}

// One job phase is its claim, its body and its advance. keepCount,
// legacyCount and visionCount are the job's own lists for this one gene.
export function finalizationPhaseWriteUnits({
  phase,
  keepCount = 0,
  legacyCount = 0,
  visionCount = 0,
} = {}) {
  const transitions = 2 * FINALIZATION_JOB_TRANSITION_ROWS
  const marks = VISION_ROLLUP_DIRTY_MARK_ROWS * count(visionCount)
  let body = 0
  if (phase === "reconcile") body = reconcileBodyRows(count(keepCount) + count(legacyCount))
  else if (phase === "vote_summaries") body = VOTE_SUMMARY_ROWS_PER_ASSET * count(keepCount)
  else if (phase === "gene_rollups") body = GENE_ROLLUP_ROWS + marks
  // A job that reached the old vision phase only marks its remaining visions.
  else if (phase === "vision_rollups") body = marks
  return atLeastFloor(transitions + body)
}

// One run of the request-picker job's vision rebuild: every vision's rebuild,
// its claim (the mark removed) and at worst its re-mark, when a vision above its
// emulsion-code bound is set aside or the run stops early.
export function visionRollupBatchWriteUnits(visionCount) {
  const visions = count(visionCount)
  if (!visions) throw new RangeError("A vision rollup batch rebuilds at least one vision")
  return atLeastFloor(visions * (VISION_ROLLUP_ROWS + 2 * VISION_ROLLUP_DIRTY_MARK_ROWS))
}

// ---- The laptop routes (the laptop_delivery lane) ---------------------------
//
// Six routes reach the lane: the five generation executor routes and the
// tags-derivative submission. Each is sized here from its own body, and
// workers/iconoplasm/generation-executor-reservation-receipts.test.js fails when
// a route classed workstation_sync_write has no entry, or a number drifts from
// what the real function writes.

// A claim reads up to scanLimit open requests, quarantines every one whose exact
// source is permanently gone and leases up to claimLimit of the rest. The two
// clamps below are the ones generationRequestLeaseClaim applies; the reservation
// is sized from the same function so they cannot drift apart.
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

// One quarantined request: the quarantine row with its two indexes, and the
// request row cancelled with the six indexes that carry its status.
export const GENERATION_QUARANTINE_ROWS = 10
// One lease newly inserted, or a failed or lapsed lease taken over.
export const GENERATION_LEASE_NEW_ROWS = 6
export const GENERATION_LEASE_RENEW_ROWS = 2
export const GENERATION_LEASE_FAIL_ROWS = 2

// A quarantined row writes more than a lease, so the worst scan is one in which
// every scanned row is quarantined.
export function generationClaimWriteUnits(rawLimit) {
  const { scanLimit } = generationClaimBounds(rawLimit)
  return atLeastFloor(GENERATION_QUARANTINE_ROWS * scanLimit)
}

// A completion carries the requests of one generation session. One claim leases
// at most GENERATION_CLAIM_LIMIT_CEILING, every downstream slice (delivery,
// settlement) already takes 50 request ids, and production's largest publication
// holds exactly 50 (read-only count, 2026-10-03). A body above the bound is
// refused before any write.
export const GENERATION_COMPLETION_MAX_REQUESTS = GENERATION_CLAIM_LIMIT_CEILING

// What the whole settle series of one body writes, not what one call writes. One
// call delivers one Discord group, so the workstation sends the identical body
// until every group is delivered, and a replay is admitted without a new
// reservation: the reservation taken by the first call has to cover every call.
// Since B-962 a call writes only what moves (a request already on this
// publication is not rewritten), so the series costs, measured on the complete
// migrated schema:
//   3 rows once, 41 rows for each request (its start, its notification, its
//   entry in the unread inbox index of migration 0116, and the delivery and
//   settlement of its group), 3 rows more for each group after the
//   first, and four fewer rows for a request that is a group of one.
// A group of one saves four rows and adds three, so it is never the worst case;
// the worst grouping is the one with the most groups that each hold at least two
// requests: floor(n / 2) groups.
export const GENERATION_COMPLETION_REQUEST_ROWS = 41
export const GENERATION_COMPLETION_FIXED_ROWS = 3
export const GENERATION_COMPLETION_GROUP_ROWS = 3

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

// What a completion body asks for: how many items, and how many distinct
// request ids across them. The handler refuses on either, and the reservation
// is sized from the second.
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

export function generationCompletionWriteUnits(requestCount) {
  const requests = count(requestCount)
  if (requests > GENERATION_COMPLETION_MAX_REQUESTS)
    throw new RangeError("A completion carries at most one claim's worth of requests")
  if (!requests) return 0
  const furtherGroups = Math.max(0, Math.floor(requests / 2) - 1)
  return atLeastFloor(
    GENERATION_COMPLETION_FIXED_ROWS +
      GENERATION_COMPLETION_REQUEST_ROWS * requests +
      GENERATION_COMPLETION_GROUP_ROWS * furtherGroups,
  )
}

// The tags-derivative submission (B-945): one command per caretaker revision, a
// batch in the authoring D1 (derivative, event, outbox, storage secret, head) and then the in-process projection of the accepted event into the
// primary D1. Measured on both complete production schemas: a complete
// submission writes 29 rows in the authoring D1 and 15 in the primary D1 (38 + 15
// until B-859 retired the upload reservation, 2026-10-08). The
// head selection is not here: the gateway hands it to the operation-cost
// authority (isReplicaCostRoute), which admits it against its own declared bound.
export const TAGS_DERIVATIVE_SUBMIT_ROWS = 44

// A workstation regeneration (B-1011): one system revision with its Tags, the
// Tags head and, while the system text is canonical, the selection, as one
// command. Measured on this route on workerd (caretaker-save-cost.workerd.test.js,
// 2026-10-08): 42 authoring + 14 primary rows for a gene with a system text, and
// 56 + 15 for a gene new to the catalogue (B-1031), which the route also
// registers and seeds; the constant is that worst case. It was 96 until then,
// derived from the caretaker save and never measured here.
export const SYSTEM_REVISION_APPEND_ROWS = 71

// Per route: the rows one admitted request may write, from its parsed body.
//   units 0     no reservation: the route writes no row (material is reads only)
//   perCall     every request is a new operation (a claim takes new leases, so
//               an identical body is not a replay); otherwise the operation is
//               its body, because the body names the exact thing it changes
//               (a lease token and version, a command id) and a retry is the
//               same operation.
// A body the handler cannot read is refused by the handler before any write, so
// it reserves nothing.
const LAPTOP_ROUTE_SIZING = Object.freeze({
  authority_generation_lease_claim: Object.freeze({
    perCall: true,
    units: (body) => generationClaimWriteUnits(body.limit),
  }),
  authority_generation_lease_material: Object.freeze({ perCall: false, units: () => 0 }),
  authority_generation_lease_renew: Object.freeze({
    perCall: false,
    units: () => atLeastFloor(GENERATION_LEASE_RENEW_ROWS),
  }),
  authority_generation_lease_fail: Object.freeze({
    perCall: false,
    units: () => atLeastFloor(GENERATION_LEASE_FAIL_ROWS),
  }),
  authority_generation_lease_complete: Object.freeze({
    perCall: false,
    units: (body) => {
      const size = generationCompletionSize(body)
      if (size.items > GENERATION_COMPLETION_MAX_REQUESTS) return 0
      if (size.requestIds > GENERATION_COMPLETION_MAX_REQUESTS) return 0
      return generationCompletionWriteUnits(size.requestIds)
    },
  }),
  authority_tags_derivative_submit: Object.freeze({
    perCall: false,
    units: () => atLeastFloor(TAGS_DERIVATIVE_SUBMIT_ROWS),
  }),
  authority_system_revision_append: Object.freeze({
    perCall: false,
    units: () => atLeastFloor(SYSTEM_REVISION_APPEND_ROWS),
  }),
})

export const LAPTOP_RESERVATION_ROUTE_IDS = Object.freeze(Object.keys(LAPTOP_ROUTE_SIZING))

export function laptopReservation(routeId, body) {
  const sizing = LAPTOP_ROUTE_SIZING[routeId]
  if (!sizing) throw new RangeError(`No laptop reservation sizing for route ${String(routeId)}`)
  if (!plainObject(body)) return Object.freeze({ units: 0, perCall: sizing.perCall })
  return Object.freeze({ units: sizing.units(body), perCall: sizing.perCall })
}
