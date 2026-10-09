import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { after, before } from "node:test"

import {
  processPendingSyncFinalizationJobs,
  rebuildDirtyVisionRollups,
} from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createD1InvocationBudget } from "../lib/d1-invocation-budget.js"
import {
  FINALIZATION_COMPLETION_PAGE_SIZE,
  FINALIZATION_COMPLETION_ROW_ROWS,
  FINALIZATION_JOB_TRANSITION_ROWS,
  GENE_REPUBLISH_ROWS,
  GENE_ROLLUP_ROWS,
  MAX_EMULSION_CODES_PER_VISION,
  MUTATION_WRITE_FLOOR_UNITS,
  VISION_ROLLUP_DIRTY_MARK_ROWS,
  VISION_ROLLUP_ROWS,
  finalizationCompletionPageWriteUnits,
  finalizationPhaseWriteUnits,
  finalizationRecoveryWriteUnits,
} from "../lib/iconoplasm-mutation-write-bounds.js"
import { ICONOPLASM_FACTORY_CATALOG } from "../generated/iconoplasm-factory-catalog.js"
import { advanceEnrolledIconoplasmGeneCardMaterialization } from "../iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"
import {
  liveD1Meter,
  openMigratedD1,
  realBudgetLedger,
  recordingMutationLedger,
} from "../test-helpers/reservation-receipts-harness.js"

// B-933. The four reservations that used to read "units: 50, an invocation is
// capped at 50 D1 statements" are sized from the rows their operation writes.
// A statement is not a row: one UPDATE of a job row writes seven rows once its
// index entries and summary trigger are counted, a vote summary costs four rows
// per asset, and one completion statement can address 32 jobs.
//
// How a reservation could under-count (written before the tests, B-933):
// 1. Index and trigger fanout ignored: one row counted where D1 bills seven.
// 2. A page statement addresses up to 32 jobs and multiplies that fanout.
// 3. A set-based statement scales with the job's own asset list.
// 4. "50 statements" read as "50 rows".
// 5. Claim, phase body and advance are three writes under one reservation.
// 6. A later migration adds an index or trigger and the worst case drifts.
// 7. Re-sizing an operation whose identity already holds a smaller receipt
//    wedges its retry (MUTATION_RESERVATION_IDENTITY_MISMATCH).
// 8. At the ceiling the work must refuse before any D1 mutation, stay
//    durable, and run once pressure falls.
// Each test below drives the real function against real D1 receipts.

let database
before(async () => {
  database = await openMigratedD1()
})
after(async () => {
  await database?.dispose()
})

const NOW = "2026-01-01T00:00:00.000Z"
let counter = 0
const fresh = (prefix) => `${prefix}${++counter}`
const sha = (symbolIndex, assetIndex) =>
  symbolIndex.toString(16).padStart(32, "0") + assetIndex.toString(16).padStart(32, "0")

async function seedGene(
  symbol,
  assets,
  { status = "draft", stale = 0, visions = 5, visionId = null } = {},
) {
  const symbolIndex = ++counter
  await database.db
    .prepare("INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES(?,?)")
    .bind(symbol, `gene ${symbol}`)
    .run()
  if (assets) {
    await database.db
      .prepare(
        `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${assets})
         INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id,created_at,is_stale,is_legacy)
         SELECT ?,printf('%032x%032x',?,n),'full','thumb',?,COALESCE(?,'anima-v1-'||(1+n%CAST(? AS INTEGER))),'A1-'||n,CURRENT_TIMESTAMP,?,? FROM ids`,
      )
      .bind(symbol, symbolIndex, status, visionId, visions, stale, stale)
      .run()
  }
  return Array.from({ length: assets }, (_, index) => ({
    symbol,
    asset_sha256: sha(symbolIndex, index + 1),
  }))
}

async function seedJob(
  symbol,
  phase,
  { status = "queued", keep = [], legacy = [], visionIds = [], lastAttemptAt = null } = {},
) {
  await database.db
    .prepare(
      `INSERT INTO icono_sync_finalization_jobs(gene_symbol,actor_id,reason,status,phase,keep_assets_json,legacy_assets_json,vision_ids_json,requested_at,next_attempt_at,last_attempt_at,job_version)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`,
    )
    .bind(
      symbol,
      "workstation_sync",
      "generation_session_publish",
      status,
      phase,
      JSON.stringify(keep),
      JSON.stringify(legacy),
      JSON.stringify(visionIds),
      NOW,
      NOW,
      lastAttemptAt,
    )
    .run()
}

// One queue invocation as handleIconoplasmSyncFinalizationQueue builds it: the
// D1 binding sits behind the 50-statement invocation budget.
async function invoke({ symbols, finalizeIfDrained = false }) {
  const meter = liveD1Meter(database.db)
  const ledger = recordingMutationLedger(meter)
  const env = {
    ICONOPLASM_DB: createD1InvocationBudget().binding(meter.db),
    ICONOPLASM_ADMIN_TOKEN: "receipts-test-token",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: ledger.namespace,
  }
  const background = []
  let error = null
  try {
    await processPendingSyncFinalizationJobs(
      env,
      { waitUntil: (promise) => background.push(promise.catch(() => {})) },
      { symbols, limit: 1, recoveryLimit: 1, finalizeIfDrained },
    )
  } catch (caught) {
    error = caught
  }
  await Promise.all(background)
  return { meter, error, settled: ledger.settle(meter.totals.rows_written) }
}

const quiet = (t) => {
  const original = [console.log, console.warn, console.error]
  console.log = console.warn = console.error = () => {}
  t.after(() => {
    ;[console.log, console.warn, console.error] = original
  })
}

function operation(result, prefix) {
  const found = result.settled.filter((entry) => entry.operation_id.startsWith(prefix))
  assert.equal(found.length, 1, JSON.stringify(result.settled))
  return found[0]
}

// Failure modes 1 and 4.
test("a recovery reserves the one job-row UPDATE it writes, and that UPDATE is seven rows", async (t) => {
  quiet(t)
  const symbol = fresh("REC")
  await seedJob(symbol, "reconcile", { status: "running", lastAttemptAt: NOW })
  const result = await invoke({ symbols: [symbol] })
  const recovery = operation(result, "finalization-recovery:")
  assert.equal(recovery.wrote, FINALIZATION_JOB_TRANSITION_ROWS)
  assert.equal(recovery.units, finalizationRecoveryWriteUnits())
  assert.ok(recovery.units >= recovery.wrote)
  assert.equal(recovery.units, MUTATION_WRITE_FLOOR_UNITS)
  t.diagnostic(JSON.stringify({ site: "recovery", wrote: recovery.wrote, units: recovery.units }))
})

// Failure modes 1, 2 and 6: the completion statement is the page statement.
async function completionPage(rows, { status, phase }) {
  const symbols = Array.from({ length: rows }, () => fresh("CP"))
  for (const symbol of symbols) await seedJob(symbol, phase, { status })
  const result = await invoke({ symbols, finalizeIfDrained: true })
  return { symbols, entry: operation(result, "finalization-complete-page:"), result }
}

test("a completion page reserves what its rows write, whatever state they start in", async (t) => {
  quiet(t)
  let worstPerRow = 0
  for (const status of ["queued", "running", "retrying"]) {
    for (const phase of ["completed_pending_finalize", "completed"]) {
      const { entry } = await completionPage(FINALIZATION_COMPLETION_PAGE_SIZE, { status, phase })
      assert.equal(entry.wrote % FINALIZATION_COMPLETION_PAGE_SIZE, 0, JSON.stringify(entry))
      worstPerRow = Math.max(worstPerRow, entry.wrote / FINALIZATION_COMPLETION_PAGE_SIZE)
      assert.ok(entry.units >= entry.wrote, JSON.stringify({ status, phase, ...entry }))
      t.diagnostic(JSON.stringify({ site: "completion-page", status, phase, ...entry }))
    }
  }
  assert.equal(
    FINALIZATION_COMPLETION_ROW_ROWS,
    worstPerRow,
    "the per-row constant is the measured worst case, not an estimate",
  )
})

test("every completion page size up to the page limit is covered", async (t) => {
  quiet(t)
  for (const rows of [1, 2, 12, 13, 31, FINALIZATION_COMPLETION_PAGE_SIZE]) {
    const { entry } = await completionPage(rows, {
      status: "queued",
      phase: "completed_pending_finalize",
    })
    assert.equal(entry.units, finalizationCompletionPageWriteUnits(rows))
    assert.ok(entry.units >= entry.wrote, JSON.stringify({ rows, ...entry }))
  }
  assert.equal(
    finalizationCompletionPageWriteUnits(FINALIZATION_COMPLETION_PAGE_SIZE),
    FINALIZATION_COMPLETION_PAGE_SIZE * FINALIZATION_COMPLETION_ROW_ROWS,
  )
  assert.ok(finalizationCompletionPageWriteUnits(FINALIZATION_COMPLETION_PAGE_SIZE) > 50)
})

// Failure modes 3 and 5. A phase is claim, body and advance. The reserved size
// comes from the job's own lists; no gene is rewritten beyond them.
async function phaseRun(phase, { keep = [], legacy = [], visionIds = [] } = {}, symbol) {
  await seedJob(symbol, phase, { keep, legacy, visionIds })
  const result = await invoke({ symbols: [symbol] })
  return { result, entry: operation(result, `finalization:${symbol}:`) }
}

const countRows = async (sql, ...args) =>
  database.db
    .prepare(sql)
    .bind(...args)
    .first("n")

// B-1057: finalization marks visions and the request-picker job rebuilds every
// marked vision once, in one batch. This runs that job against the same meter
// and ledger; only the given visions are marked.
async function rollupRun(visionIds, { failOn = null } = {}) {
  await database.db.prepare("DELETE FROM icono_vision_rollup_dirty").run()
  await database.db
    .prepare(
      "INSERT INTO icono_vision_rollup_dirty(vision_id, marked_at) SELECT value, ? FROM json_each(?)",
    )
    .bind(NOW, JSON.stringify(visionIds))
    .run()
  const meter = liveD1Meter(database.db)
  const ledger = recordingMutationLedger(meter)
  // failOn: a statement that fails the way a provider error would, mid-run.
  const db = failOn
    ? {
        prepare(sql) {
          if (sql.includes(failOn)) throw new Error(`injected failure at ${failOn}`)
          return meter.db.prepare(sql)
        },
        batch: (statements) => meter.db.batch(statements),
      }
    : meter.db
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: ledger.namespace,
  }
  let result = null
  let error = null
  try {
    result = await rebuildDirtyVisionRollups(env)
  } catch (caught) {
    error = caught
  }
  const settled = ledger.settle(meter.totals.rows_written)
  return { meter, result, error, settled, entry: operation({ settled }, "vision-rollups:") }
}

function assertCovered(label, { entry }, { tightness = 1.3 } = {}) {
  assert.ok(entry.units >= entry.wrote, `${label} under-reserved: ${JSON.stringify(entry)}`)
  if (entry.units > MUTATION_WRITE_FLOOR_UNITS)
    assert.ok(
      entry.units <= Math.ceil(entry.wrote * tightness),
      `${label} over-reserved (units must follow what is written): ${JSON.stringify(entry)}`,
    )
}

test("vote summaries reserve four rows for each new asset in the job's keep list", async (t) => {
  quiet(t)
  for (const assets of [1, 12, 13, 50, 200]) {
    const symbol = fresh("VOTE")
    const keep = await seedGene(symbol, assets)
    const run = await phaseRun("vote_summaries", { keep }, symbol)
    assertCovered(`vote_summaries ${assets}`, run)
    assert.equal(run.result.error, null)
    t.diagnostic(JSON.stringify({ site: "phase", phase: "vote_summaries", assets, ...run.entry }))
  }
})

test("gene rollups reserve the marks of the gene's visions on top of their own rows", async (t) => {
  quiet(t)
  await database.db.prepare("DELETE FROM icono_vision_rollup_dirty").run()
  for (const visions of [1, 5, 40]) {
    const symbol = fresh("MARK")
    await seedGene(symbol, 3)
    const base = 55000 + counter * 50
    const visionIds = Array.from({ length: visions }, (_, index) => `anima-v1-${base + index}`)
    const run = await phaseRun("gene_rollups", { visionIds }, symbol)
    assertCovered(`gene_rollups marking ${visions} visions`, run, { tightness: 4 })
    assert.ok(
      run.entry.wrote <=
        2 * FINALIZATION_JOB_TRANSITION_ROWS +
          GENE_ROLLUP_ROWS +
          VISION_ROLLUP_DIRTY_MARK_ROWS * visions,
    )
    assert.equal(
      await countRows(
        "SELECT COUNT(*) AS n FROM icono_vision_rollup_dirty WHERE vision_id IN (SELECT value FROM json_each(?))",
        JSON.stringify(visionIds),
      ),
      visions,
      "every vision of the gene waits for the request-picker job",
    )
    t.diagnostic(JSON.stringify({ site: "phase", phase: "gene_rollups", visions, ...run.entry }))
  }
})

test("gene rollups reserve a fixed handful of rows however many assets the gene has", async (t) => {
  quiet(t)
  for (const assets of [1, 50, 200]) {
    const symbol = fresh("GENE")
    await seedGene(symbol, assets)
    const run = await phaseRun("gene_rollups", {}, symbol)
    assertCovered(`gene_rollups ${assets}`, run, { tightness: 4 })
    assert.ok(run.entry.wrote <= 2 * FINALIZATION_JOB_TRANSITION_ROWS + GENE_ROLLUP_ROWS)
    t.diagnostic(JSON.stringify({ site: "phase", phase: "gene_rollups", assets, ...run.entry }))
  }
})

// A vision's emulsion codes as production holds them: the legacy 0-<slot> code,
// then one code per factory pipeline letter for the same variant slot, then the
// same letters at an earlier vision revision.
const PIPELINE_LETTERS = ICONOPLASM_FACTORY_CATALOG.pipelines.map((pipeline) => pipeline.code)
function emulsionCodes(count, slot, { revisions = [9, 8, 7, 6, 5, 4, 3, 2, 1] } = {}) {
  const codes = [`0-${slot}`]
  for (const revision of revisions)
    for (const letter of PIPELINE_LETTERS) {
      if (codes.length >= count) return codes
      codes.push(`${letter}${revision}-${slot}`)
    }
  return codes.slice(0, count)
}

test("vision rollups reserve the worst rewrite of one vision with many genes", async (t) => {
  quiet(t)
  // A vision of its own: assets other tests seeded must not share it.
  const visionId = "anima-v1-77"
  for (let gene = 0; gene < 30; gene += 1) await seedGene(fresh("VIS"), 3, { visionId })
  // The vision carries as many emulsion codes as a vision may (B-946), every one
  // a real factory recipe code, so each code also owns an option rollup row.
  await database.db
    .prepare(
      "UPDATE icono_portrait_assets SET emulsion_id = (SELECT value FROM json_each(?) WHERE key = icono_portrait_assets.rowid % ?) WHERE gene_symbol LIKE 'VIS%'",
    )
    .bind(
      JSON.stringify(emulsionCodes(MAX_EMULSION_CODES_PER_VISION, 30001)),
      MAX_EMULSION_CODES_PER_VISION,
    )
    .run()
  const first = await rollupRun([visionId])
  assert.equal(first.error, null)
  assertCovered("vision rebuild first build", first, { tightness: 100 })
  // Every aggregate the vision row and its option rollups hold moves: the
  // image count, votes, live count, rejected count and the previews.
  await database.db
    .prepare(
      `INSERT INTO icono_portrait_assets(gene_symbol,asset_sha256,r2_key_full,r2_key_thumb,status,vision_id,emulsion_id,created_at)
       SELECT gene_symbol, printf('%064x', 900000 + rowid), 'full','thumb','approved', vision_id, emulsion_id, '2026-02-01 00:00:00'
       FROM icono_portrait_assets WHERE gene_symbol LIKE 'VIS%' AND vision_id = ?`,
    )
    .bind(visionId)
    .run()
  await database.db
    .prepare(
      `INSERT OR REPLACE INTO icono_vote_asset_summary(gene_symbol,asset_sha256,candidate_ref,vision_id,upvotes,downvotes,score,vote_count)
       SELECT gene_symbol, asset_sha256, 'a:'||gene_symbol||'|'||asset_sha256, vision_id, 5, 1, 4, 6
       FROM icono_portrait_assets WHERE gene_symbol LIKE 'VIS%' AND vision_id = ?`,
    )
    .bind(visionId)
    .run()
  await database.db
    .prepare(
      `INSERT OR REPLACE INTO icono_publish_state(gene_symbol,current_asset_sha256)
       SELECT gene_symbol, MIN(asset_sha256) FROM icono_portrait_assets WHERE gene_symbol LIKE 'VIS%' GROUP BY gene_symbol`,
    )
    .run()
  await database.db
    .prepare(
      "UPDATE icono_portrait_assets SET status='rejected' WHERE gene_symbol LIKE 'VIS%' AND rowid % 3 = 0",
    )
    .run()
  const second = await rollupRun([visionId])
  assertCovered("vision rebuild rewrite", second, { tightness: 100 })
  for (const run of [first, second])
    assert.ok(run.entry.wrote <= VISION_ROLLUP_DIRTY_MARK_ROWS + VISION_ROLLUP_ROWS)
  t.diagnostic(
    JSON.stringify({
      site: "phase",
      phase: "vision_rollups",
      first: first.entry,
      second: second.entry,
    }),
  )
})

// B-946. How a vision could outgrow its reservation (written before the code):
// 1. A vision carries more emulsion codes than the nine it was sized for: in
//    production four visions carry 17, two 14, one 10.
// 2. Every code is a real factory recipe, so each also owns an option rollup row
//    the nine-code measurement (codes the factory ignores) never wrote.
// 3. A vision's codes are all replaced at once: its stale pairs are removed and
//    as many new ones inserted in the same rebuild.
// 4. A code is shared by other visions and the rebuild rewrites for each of them.
// 5. A vision above the bound reaches the rebuild: the refusal must come before
//    any write of the vision, leave the job retryable and repair itself.
async function seedVisionWithCodes(visionId, codes, { genes = 30 } = {}) {
  const prefix = fresh("VC")
  for (let gene = 0; gene < genes; gene += 1) await seedGene(`${prefix}G${gene}`, 3, { visionId })
  await recodeVision(prefix, visionId, codes)
  return prefix
}

async function recodeVision(prefix, visionId, codes) {
  await database.db
    .prepare(
      "UPDATE icono_portrait_assets SET emulsion_id = (SELECT value FROM json_each(?) WHERE key = icono_portrait_assets.rowid % ?) WHERE gene_symbol LIKE ? AND vision_id = ?",
    )
    .bind(JSON.stringify(codes), codes.length, `${prefix}G%`, visionId)
    .run()
}

test("a vision at the code bound reserves what its first build, a full replacement of its codes and a restore write", async (t) => {
  quiet(t)
  // One code per factory pipeline plus the legacy code: a new pipeline fails
  // here until the bound and the rows behind it are measured again.
  assert.ok(MAX_EMULSION_CODES_PER_VISION >= PIPELINE_LETTERS.length + 1)
  const visionId = "anima-v1-29101"
  const prefix = await seedVisionWithCodes(
    visionId,
    emulsionCodes(MAX_EMULSION_CODES_PER_VISION, 29101),
  )
  const first = await rollupRun([visionId])
  assert.equal(first.error, null)

  // Every code replaced at once: the registered pairs go, the new ones come, and
  // the option rollup of each old and each new code is rewritten or removed.
  await recodeVision(
    prefix,
    visionId,
    emulsionCodes(MAX_EMULSION_CODES_PER_VISION, 29102, { revisions: [8, 7, 6, 5, 4, 3, 2, 1] }),
  )
  const replaced = await rollupRun([visionId])
  assert.equal(replaced.error, null)
  // And back again.
  await recodeVision(prefix, visionId, emulsionCodes(MAX_EMULSION_CODES_PER_VISION, 29101))
  const restored = await rollupRun([visionId])
  const worst = Math.max(first.entry.wrote, replaced.entry.wrote, restored.entry.wrote)
  t.diagnostic(
    JSON.stringify({
      site: "vision-at-bound",
      codes: MAX_EMULSION_CODES_PER_VISION,
      first: first.entry.wrote,
      replaced: replaced.entry.wrote,
      restored: restored.entry.wrote,
      units: first.entry.units,
    }),
  )
  assertCovered("vision at bound, first build", first, { tightness: 100 })
  assertCovered("vision at bound, full replacement", replaced, { tightness: 100 })
  assertCovered("vision at bound, restored", restored, { tightness: 100 })
  assert.equal(
    worst - VISION_ROLLUP_DIRTY_MARK_ROWS,
    VISION_ROLLUP_ROWS,
    "the vision constant is the worst body measured at the bound, not an estimate",
  )
})

test("codes shared with other visions add no rows to a rebuild beyond its own codes", async (t) => {
  quiet(t)
  // Eight codes, first on their own, then shared with five other visions whose
  // option rollups are already settled.
  const alone = "anima-v1-29104"
  await seedVisionWithCodes(alone, emulsionCodes(8, 29104))
  const aloneRun = await rollupRun([alone])
  const sharedCodes = emulsionCodes(8, 29105)
  for (let other = 0; other < 5; other += 1) {
    const otherVision = `anima-v1-291${10 + other}`
    await seedVisionWithCodes(otherVision, sharedCodes, { genes: 4 })
    await rollupRun([otherVision])
  }
  const sharer = "anima-v1-29106"
  await seedVisionWithCodes(sharer, sharedCodes)
  const sharedRun = await rollupRun([sharer])
  assertCovered("vision sharing its codes", sharedRun, { tightness: 100 })
  t.diagnostic(
    JSON.stringify({
      site: "vision-shared-codes",
      alone: aloneRun.entry.wrote,
      shared: sharedRun.entry.wrote,
    }),
  )
  // Sharing moves rollup rows the vision's own assets already move; it adds none
  // for each other vision.
  assert.ok(
    sharedRun.entry.wrote <= aloneRun.entry.wrote + 3 * sharedCodes.length,
    JSON.stringify({ alone: aloneRun.entry.wrote, shared: sharedRun.entry.wrote }),
  )
})

test("a vision above the code bound is refused before any write, stays marked, and is rebuilt once the excess is removed", async (t) => {
  quiet(t)
  const visionId = "anima-v1-29120"
  const codes = emulsionCodes(MAX_EMULSION_CODES_PER_VISION + 1, 29120)
  const prefix = await seedVisionWithCodes(visionId, codes)
  const refused = await rollupRun([visionId])
  assert.equal(refused.error, null)
  // Nothing of the vision was written: no rollup row, no registered pair, no option rollup.
  for (const table of [
    "icono_admin_vision_rollup",
    "icono_generation_request_factory_option_sources",
    "icono_generation_request_vision_option_rollup",
  ])
    assert.equal(
      await countRows(`SELECT COUNT(*) AS n FROM ${table} WHERE vision_id = ?`, visionId),
      0,
      table,
    )
  // The only rows written are the re-mark that keeps it waiting, at the back.
  assert.ok(
    refused.meter.totals.rows_written <= 2 * VISION_ROLLUP_DIRTY_MARK_ROWS,
    `refusal wrote ${refused.meter.totals.rows_written} rows`,
  )
  assertCovered("refused vision", refused, { tightness: 1000 })
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_vision_rollup_dirty WHERE vision_id = ?",
      visionId,
    ),
    1,
  )
  // The run says why in words.
  assert.equal(refused.result.refused.length, 1)
  const message = refused.result.refused[0].error
  assert.match(message, new RegExp(visionId))
  assert.match(message, new RegExp(String(MAX_EMULSION_CODES_PER_VISION + 1)))
  assert.match(message, new RegExp(`limit is ${MAX_EMULSION_CODES_PER_VISION}`))

  // Repair: the vision gives back the code it should not have carried.
  await recodeVision(prefix, visionId, codes.slice(0, MAX_EMULSION_CODES_PER_VISION))
  const repaired = await rollupRun([visionId])
  assert.equal(repaired.error, null)
  assert.deepEqual(repaired.result.refused, [])
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_admin_vision_rollup WHERE vision_id = ?",
      visionId,
    ),
    1,
  )
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_generation_request_factory_option_sources WHERE vision_id = ?",
      visionId,
    ),
    MAX_EMULSION_CODES_PER_VISION,
  )
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_vision_rollup_dirty WHERE vision_id = ?",
      visionId,
    ),
    0,
  )
})

test("a vision rebuild that fails part-way leaves every mark in place", async (t) => {
  quiet(t)
  const visionId = "anima-v1-29140"
  await seedVisionWithCodes(visionId, emulsionCodes(2, 29140), { genes: 2 })
  const run = await rollupRun([visionId], { failOn: "INSERT INTO icono_admin_vision_rollup" })
  assert.match(String(run.error?.message), /injected failure/)
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_vision_rollup_dirty WHERE vision_id = ?",
      visionId,
    ),
    1,
    "the next run rebuilds it",
  )
  const retried = await rollupRun([visionId])
  assert.equal(retried.error, null)
  assert.equal(retried.result.visions, 1)
})

test("a vision above the code bound does not hold back the rest of its batch", async (t) => {
  quiet(t)
  const bad = "anima-v1-29130"
  const good = "anima-v1-29131"
  await seedVisionWithCodes(bad, emulsionCodes(MAX_EMULSION_CODES_PER_VISION + 1, 29130), {
    genes: 4,
  })
  await seedVisionWithCodes(good, emulsionCodes(2, 29131), { genes: 4 })
  const run = await rollupRun([bad, good])
  assert.equal(run.error, null)
  assert.equal(run.result.visions, 1)
  assert.deepEqual(
    run.result.refused.map((row) => row.vision_id),
    [bad],
  )
  assertCovered("batch with a refused vision", run, { tightness: 100 })
  assert.equal(
    await countRows(
      "SELECT COUNT(*) AS n FROM icono_admin_vision_rollup WHERE vision_id = ?",
      good,
    ),
    1,
  )
  assert.equal(
    await countRows("SELECT COUNT(*) AS n FROM icono_admin_vision_rollup WHERE vision_id = ?", bad),
    0,
  )
  const waiting = await database.db.prepare("SELECT vision_id FROM icono_vision_rollup_dirty").all()
  assert.deepEqual(
    waiting.results.map((row) => row.vision_id),
    [bad],
  )
})

// The reconcile phase republishes its touched gene after the response, inside
// the same invocation: one route row on first publication and the card
// materialization wake-up. Both statements are run as production runs them.
test("the republish a reconcile starts writes the rows the reservation counts", async (t) => {
  quiet(t)
  const runtimeSource = readFileSync(
    new URL(
      "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  ).replace(/\s+/g, " ")
  const routeInsert =
    "INSERT OR IGNORE INTO icono_published_gene_routes (gene_symbol) SELECT gene_symbol FROM icono_gene_catalog WHERE gene_symbol = ?"
  assert.ok(runtimeSource.includes(routeInsert), "the measured statement is the production one")
  const symbol = fresh("REPUB")
  await seedGene(symbol, 1)
  await database.db
    .prepare(
      "INSERT INTO icono_gene_card_materializations(gene_symbol,desired_card_fingerprint,state,ready_card_fingerprint,wakeup_generation,enqueued_generation) VALUES(?,?,'ready',?,1,1)",
    )
    .bind(symbol, "a".repeat(32), "a".repeat(32))
    .run()
  const meter = liveD1Meter(database.db)
  await meter.db.prepare(routeInsert).bind(symbol).run()
  const queue = { async send() {} }
  const advanced = await advanceEnrolledIconoplasmGeneCardMaterialization(
    { ICONOPLASM_DB: meter.db, ICONOPLASM_GENE_CARD_MATERIALIZATION_QUEUE: queue },
    { symbol, cardFingerprint: "b".repeat(32), assetSha256: "c".repeat(64) },
  )
  assert.equal(advanced, true)
  assert.equal(GENE_REPUBLISH_ROWS, meter.totals.rows_written)
})

// A reconcile writes for every asset its gene holds (the emulsion option
// rollups) and, for assets that were rejected, stale or legacy, restores or
// marks them one statement group at a time under the 50-statement budget.
async function reconcileRun(label, assets, { stale = 0, legacyCount = 0 }) {
  const symbol = fresh("RC")
  const keep = await seedGene(symbol, assets, {})
  if (stale)
    await database.db
      .prepare(
        "UPDATE icono_portrait_assets SET status='rejected', is_stale=1, is_legacy=1 WHERE gene_symbol=? AND rowid IN (SELECT rowid FROM icono_portrait_assets WHERE gene_symbol=? ORDER BY rowid LIMIT ?)",
      )
      .bind(symbol, symbol, stale)
      .run()
  const run = await phaseRun(
    "reconcile",
    { keep: keep.slice(legacyCount), legacy: keep.slice(0, legacyCount) },
    symbol,
  )
  const restored = await database.db
    .prepare("SELECT COUNT(*) AS n FROM icono_portrait_assets WHERE gene_symbol=? AND is_stale=1")
    .bind(symbol)
    .first("n")
  return { label, assets, stale, legacyCount, restored, ...run }
}

test("a reconcile reserves what its gene's assets cost, including the restores the 50-statement budget allows", async (t) => {
  quiet(t)
  const runs = []
  // Every asset is on its own emulsion, the worst case for the option rollups.
  for (const assets of [1, 12, 40, 200]) runs.push(await reconcileRun("healthy", assets, {}))
  for (const [assets, stale] of [
    [1, 1],
    [5, 5],
    [12, 12],
    [16, 16],
    [40, 14],
    [40, 15],
    [40, 16],
    [40, 17],
    [40, 40],
    [100, 16],
    [200, 16],
    [200, 200],
  ])
    runs.push(await reconcileRun("restore", assets, { stale }))
  for (const [assets, legacyCount] of [
    [1, 1],
    [5, 5],
    [12, 12],
    [40, 10],
    [40, 40],
    [100, 12],
  ])
    runs.push(await reconcileRun("legacy", assets, { legacyCount }))
  for (const run of runs) {
    t.diagnostic(
      JSON.stringify({
        site: "phase",
        phase: "reconcile",
        label: run.label,
        assets: run.assets,
        stale: run.stale,
        legacyCount: run.legacyCount,
        ...run.entry,
      }),
    )
    assertCovered(`reconcile ${run.label} ${run.assets}`, run, { tightness: 100 })
  }
  // The reservation follows the job's asset count: for each count it is no
  // more than a third above the worst run measured at that count.
  const worstByAssets = new Map()
  for (const run of runs)
    worstByAssets.set(run.assets, Math.max(worstByAssets.get(run.assets) || 0, run.entry.wrote))
  for (const [assets, worst] of worstByAssets) {
    const units = finalizationPhaseWriteUnits({ phase: "reconcile", keepCount: assets })
    assert.ok(units >= worst, `reconcile ${assets} assets under-reserved: ${units} < ${worst}`)
    assert.ok(
      units <= Math.ceil(worst * 1.35),
      `reconcile ${assets} assets over-reserved: ${units} vs worst measured ${worst}`,
    )
  }
})

// Failure mode 7 and the repair path. The real ledger, a real saturation.
async function invokeAgainst(ledger, symbols, { finalizeIfDrained = false } = {}) {
  const meter = liveD1Meter(database.db)
  const env = {
    ICONOPLASM_DB: createD1InvocationBudget().binding(meter.db),
    ICONOPLASM_ADMIN_TOKEN: "receipts-test-token",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: ledger.namespace,
  }
  let error = null
  try {
    await processPendingSyncFinalizationJobs(
      env,
      { waitUntil() {} },
      { symbols, limit: 1, recoveryLimit: 1, finalizeIfDrained },
    )
  } catch (caught) {
    error = caught
  }
  return { meter, error }
}

test("at the ceiling a large phase refuses before any D1 write, and runs once pressure falls", async (t) => {
  quiet(t)
  const symbol = fresh("REFUSE")
  const keep = await seedGene(symbol, 50)
  await seedJob(symbol, "vote_summaries", { keep })
  const units = finalizationPhaseWriteUnits({ phase: "vote_summaries", keepCount: keep.length })
  assert.ok(units > MUTATION_WRITE_FLOOR_UNITS)
  // Room for the old 50 but not for what the phase writes.
  const ledger = realBudgetLedger(70_000 - units + 1)
  t.after(() => ledger.close())
  const refused = await invokeAgainst(ledger, [symbol])
  assert.match(String(refused.error?.message), /ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED/)
  assert.equal(refused.meter.totals.rows_written, 0, "nothing is written while the ledger refuses")
  const job = await database.db
    .prepare(
      "SELECT status, phase, job_version FROM icono_sync_finalization_jobs WHERE gene_symbol=?",
    )
    .bind(symbol)
    .first()
  assert.deepEqual({ ...job }, { status: "queued", phase: "vote_summaries", job_version: 1 })

  ledger.observe(0)
  const repaired = await invokeAgainst(ledger, [symbol])
  assert.equal(repaired.error, null)
  assert.equal(
    await database.db
      .prepare("SELECT phase FROM icono_sync_finalization_jobs WHERE gene_symbol=?")
      .bind(symbol)
      .first("phase"),
    "gene_rollups",
  )
  assert.ok(repaired.meter.totals.rows_written <= units, JSON.stringify(repaired.meter.totals))
})

test("at the ceiling a full completion page refuses before its UPDATE, and completes once pressure falls", async (t) => {
  quiet(t)
  const symbols = Array.from({ length: FINALIZATION_COMPLETION_PAGE_SIZE }, () => fresh("CPR"))
  for (const symbol of symbols) await seedJob(symbol, "completed_pending_finalize", {})
  const units = finalizationCompletionPageWriteUnits(FINALIZATION_COMPLETION_PAGE_SIZE)
  assert.ok(units > MUTATION_WRITE_FLOOR_UNITS)
  const ledger = realBudgetLedger(70_000 - units + 1)
  t.after(() => ledger.close())
  const refused = await invokeAgainst(ledger, symbols, { finalizeIfDrained: true })
  assert.match(String(refused.error?.message), /ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED/)
  assert.equal(refused.meter.totals.rows_written, 0)
  const pending = async () =>
    database.db
      .prepare(
        "SELECT COUNT(*) AS n FROM icono_sync_finalization_jobs WHERE gene_symbol LIKE 'CPR%' AND status <> 'completed'",
      )
      .first("n")
  assert.equal(await pending(), FINALIZATION_COMPLETION_PAGE_SIZE)
  ledger.observe(0)
  const repaired = await invokeAgainst(ledger, symbols, { finalizeIfDrained: true })
  assert.equal(repaired.error, null)
  assert.equal(await pending(), 0)
  assert.ok(repaired.meter.totals.rows_written <= units, JSON.stringify(repaired.meter.totals))
})

test("a receipt held at the old size does not wedge a re-sized operation", async (t) => {
  quiet(t)
  const symbol = fresh("OLDID")
  const keep = await seedGene(symbol, 40)
  await seedJob(symbol, "vote_summaries", { keep })
  const ledger = realBudgetLedger(0)
  t.after(() => ledger.close())
  // The earlier sizing reserved this exact job version at 50 and never completed.
  const heldAtOldSize = await ledger.owner.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/reserve-mutation-writes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: new Date().toISOString().slice(0, 10),
        lane: "laptop_delivery",
        operation_id: `finalization:${symbol}:1:vote_summaries`,
        units: 50,
      }),
    }),
  )
  assert.equal(heldAtOldSize.status, 200)
  const run = await invokeAgainst(ledger, [symbol])
  assert.equal(run.error, null)
  assert.equal(
    await database.db
      .prepare("SELECT phase FROM icono_sync_finalization_jobs WHERE gene_symbol=?")
      .bind(symbol)
      .first("phase"),
    "gene_rollups",
  )
})
