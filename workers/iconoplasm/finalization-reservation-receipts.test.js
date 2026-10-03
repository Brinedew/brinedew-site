import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { after, before } from "node:test"

import { processPendingSyncFinalizationJobs } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createD1InvocationBudget } from "../lib/d1-invocation-budget.js"
import {
  FINALIZATION_COMPLETION_PAGE_SIZE,
  FINALIZATION_COMPLETION_ROW_ROWS,
  FINALIZATION_JOB_TRANSITION_ROWS,
  GENE_REPUBLISH_ROWS,
  GENE_ROLLUP_ROWS,
  MUTATION_WRITE_FLOOR_UNITS,
  VISION_ROLLUP_ROWS,
  finalizationCompletionPageWriteUnits,
  finalizationPhaseWriteUnits,
  finalizationRecoveryWriteUnits,
  reservationIdentity,
} from "../lib/iconoplasm-mutation-write-bounds.js"
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

test("vision rollups reserve the worst rewrite of one vision with many genes", async (t) => {
  quiet(t)
  // A vision of its own: assets other tests seeded must not share it.
  const visionId = "anima-v1-77"
  for (let gene = 0; gene < 30; gene += 1) await seedGene(fresh("VIS"), 3, { visionId })
  // A vision is sized for nine emulsion codes of its own: its body writes nine
  // rows and three more for each code, which with the claim and the advance is
  // exactly the 50-unit floor (B-946 tracks the real count).
  await database.db
    .prepare(
      "UPDATE icono_portrait_assets SET emulsion_id = 'Z9-' || (rowid % 9) WHERE gene_symbol LIKE 'VIS%'",
    )
    .run()
  const first = await phaseRun("vision_rollups", { visionIds: [visionId] }, fresh("VISJOB"))
  assertCovered("vision_rollups first build", first, { tightness: 100 })
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
  const second = await phaseRun("vision_rollups", { visionIds: [visionId] }, fresh("VISJOB"))
  assertCovered("vision_rollups rewrite", second, { tightness: 100 })
  for (const run of [first, second])
    assert.ok(run.entry.wrote <= 2 * FINALIZATION_JOB_TRANSITION_ROWS + VISION_ROLLUP_ROWS)
  t.diagnostic(
    JSON.stringify({
      site: "phase",
      phase: "vision_rollups",
      first: first.entry,
      second: second.entry,
    }),
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

test("an identity above the floor carries its size, and one at the floor is unchanged", () => {
  assert.equal(
    reservationIdentity("finalization:TP53:7:reconcile", MUTATION_WRITE_FLOOR_UNITS),
    "finalization:TP53:7:reconcile",
  )
  assert.equal(
    reservationIdentity("finalization:TP53:7:reconcile", 214),
    "finalization:TP53:7:reconcile:u214",
  )
  assert.match(
    reservationIdentity(`finalization-complete-page:${"a".repeat(64)}`, 128),
    /^[a-zA-Z0-9_.:@-]{1,255}$/,
  )
})
