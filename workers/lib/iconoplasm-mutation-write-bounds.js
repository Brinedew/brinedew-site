// ARCHITECTURE FENCE [IPD-004]
// One concern, one owner: how many D1 rows one admitted operation may write.
//
// A reservation's unit is a D1 row written, the provider's own meter, which
// counts every index entry and trigger write behind a statement. It is not a
// statement and not a D1 call. Every number below is the worst case measured
// from provider receipts on the complete migrated schema by
// workers/iconoplasm/finalization-reservation-receipts.test.js, which drives
// the real operation at its worst input and fails when a migration, index,
// trigger or statement changes the number. Change a constant only together with
// that measurement.
//
// 50 is the floor of every reservation: a smaller measured worst case still
// reserves 50, which absorbs one more index or trigger before a test must be
// re-pinned. An operation whose size is above the floor carries its size in
// its identity (reservationIdentity), so a receipt held under an earlier
// sizing can never be replayed at a different size.

import { FINALIZATION_COMPLETION_PAGE_SIZE } from "../iconoplasm/sync-finalization-publication.js"

export const MUTATION_WRITE_FLOOR_UNITS = 50

// One version-fenced UPDATE of one icono_sync_finalization_jobs row: the row,
// the index entries that move and the summary counter trigger, seven rows
// written in all.
export const FINALIZATION_JOB_TRANSITION_ROWS = 7

// One job completed by the page statement (COMPLETE_READY_FINALIZATION_SQL).
export const FINALIZATION_COMPLETION_ROW_ROWS = 4

// One vote-summary row and the three index entries behind it, per asset the
// rebuild has to create or change.
export const VOTE_SUMMARY_ROWS_PER_ASSET = 4

export const GENE_ROLLUP_ROWS = 8

// One vision rebuild (the vision row and its option rollups): nine rows and
// three more for every distinct emulsion code the vision carries, sized here
// for nine codes. Nothing in code bounds the codes of one vision (B-946).
export const VISION_ROLLUP_ROWS = 36

// A reconcile writes the emulsion option rollups of every asset its gene holds,
// republishes the gene, and restores or marks assets one statement group at a
// time. Our 50-statement invocation budget (workers/lib/d1-invocation-budget.js)
// stops the restoring after RECONCILE_RESTORES_PER_INVOCATION assets, and no
// invocation writes more for a restore than the extra rows below.
export const RECONCILE_FIXED_ROWS = 19
export const EMULSION_ROLLUP_ROWS_PER_ASSET = 4
export const RECONCILE_RESTORE_EXTRA_ROWS_PER_ASSET = 17
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
    EMULSION_ROLLUP_ROWS_PER_ASSET * assets +
    RECONCILE_RESTORE_EXTRA_ROWS_PER_ASSET * Math.min(assets, RECONCILE_RESTORES_PER_INVOCATION)
  )
}

// One job phase is its claim, its body and its advance. keepCount and
// legacyCount are the job's own lists for this one gene.
export function finalizationPhaseWriteUnits({ phase, keepCount = 0, legacyCount = 0 } = {}) {
  const transitions = 2 * FINALIZATION_JOB_TRANSITION_ROWS
  let body = 0
  if (phase === "reconcile") body = reconcileBodyRows(count(keepCount) + count(legacyCount))
  else if (phase === "vote_summaries") body = VOTE_SUMMARY_ROWS_PER_ASSET * count(keepCount)
  else if (phase === "gene_rollups") body = GENE_ROLLUP_ROWS
  else if (phase === "vision_rollups") body = VISION_ROLLUP_ROWS
  return atLeastFloor(transitions + body)
}
