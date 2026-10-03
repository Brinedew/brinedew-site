// B-859 step 5: end-to-end test of the operator script that reaps the authoring
// D1's one-time residue (orphan command receipts and the abandoned cutover
// backup index).
//
// The script deletes production rows. Every way it could go wrong, written
// down BEFORE the script existed:
//
//   F1  It deletes a receipt that a live event still references. The event is
//       immutable and its foreign key points at the receipt, so the run would
//       fail mid-way (or, with foreign keys off, orphan the event).
//   F2  It deletes a receipt that is younger than the TTL, so a client's
//       legitimate retry would run as a brand-new command.
//   F3  A mistyped TTL (0, negative, NaN, 6) widens the delete to everything.
//   F4  A "dry run" that writes. Dry run must send SELECT statements only.
//   F5  An unbounded run spends the day's D1 write allowance. A run must stop
//       at its row-written cap, using the writes D1 reports, and say where to
//       resume.
//   F6  A run that cannot be resumed or repeated. Running it again must delete
//       nothing new, and cap-limited runs must add up to one full run.
//   F7  A D1 error mid-run is retried blindly or swallowed. It must stop,
//       report, and leave a re-runnable state.
//   F8  It runs right after the 00:00 UTC reset and spends the whole day's
//       allowance up front (AGENTS.md "spend the allowance at the end of the
//       day"). Execute mode must refuse before 20:00 UTC unless the operator
//       names an incident reason.
//   F9  A receipt held by a storage mutation guard (foreign key child) makes the
//       delete statement fail instead of being skipped.
//  F10  The backup target deletes the index of a backup that is finished or
//       still being built, when only an abandoned, quiet one is residue.
//  F11  Windows overlap or skip rows, so a receipt is missed or counted twice.
//
// The fixture uses the real migrations and the real command path, and removes
// events through the production archive-cut trigger, exactly how production
// came to hold 38,338 orphan receipts.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import test from "node:test"

import {
  TestD1,
  command,
  row,
  rows,
  sha,
  storage,
} from "../workers/iconoplasm/caretaker/manifestation-authority-test-support.js"
import {
  offerCaretakerAssignment,
  registerAuthorityAccount,
  registerGeneIdentity,
  seedSystemManifestation,
} from "../workers/iconoplasm/caretaker/manifestation-authority.js"
import { parseReaperArgs, reapAuthoringResidue } from "./reap-authoring-residue.mjs"

const EVENING = new Date("2026-10-03T21:00:00.000Z")
const EARLY = new Date("2026-10-03T05:00:00.000Z")
const OLD = "2026-08-31 08:00:00"
const YOUNG = "2026-10-02 12:00:00"
const ADMIN = "account_admin_0001"
const STAMP = "2026-08-30T00:00:00.000Z"

// Emulates D1's reported meter: one write for the row plus one for its index.
function sqliteExecutor(db, sent = [], { failOnDeleteNumber = 0, writesPerRow = 2 } = {}) {
  let deletes = 0
  return async (sql) => {
    sent.push(sql)
    const statement = db.raw.prepare(sql)
    if (/^\s*select/i.test(sql)) {
      return { rows: statement.all(), meta: { rows_read: 0, rows_written: 0, changes: 0 } }
    }
    deletes += 1
    if (failOnDeleteNumber && deletes === failOnDeleteNumber) throw new Error("D1_DOWN")
    const result = statement.run()
    const changes = Number(result.changes)
    return { rows: [], meta: { rows_read: 0, rows_written: changes * writesPerRow, changes } }
  }
}

// geneCount genes, each with a seed command (event 1) and an offer command
// (event 2). The offer's event is the head's last event, so the seed's event
// may be removed by the archive cut; its receipt then has no event.
async function fixture(t, { oldOrphans = 4, youngOrphans = 1, guardedOrphans = 1 } = {}) {
  const db = new TestD1()
  t.after(() => db.close())
  await registerAuthorityAccount(db, { accountId: ADMIN, now: STAMP })
  const total = oldOrphans + youngOrphans + guardedOrphans
  const seeds = []
  for (let index = 0; index < total; index += 1) {
    const suffix = String(index + 1).padStart(4, "0")
    const accountId = `account_user_${suffix}`
    const geneId = `gene_identity_${suffix}`
    await registerAuthorityAccount(db, { accountId, now: STAMP })
    await registerGeneIdentity(db, { geneId, canonicalSymbol: `RG${suffix}`, now: STAMP })
    await seedSystemManifestation(db, {
      geneId,
      storage: storage(index + 1),
      expectedHeadVersion: 0,
      expectedCanonicalRevisionId: null,
      manifestationId: `manifestation_seed_${suffix}`,
      revisionId: `revision_seed_${suffix}`,
      selectionId: `selection_seed_${suffix}`,
      eventUuid: `event_seed_${suffix}`,
      now: STAMP,
      ...command(`command_seed_${suffix}`, "1", null, "migration"),
    })
    await offerCaretakerAssignment(db, {
      geneId,
      accountId,
      invitedByAccountId: ADMIN,
      entitlementPolicyVersion: "entitlement-v1",
      expectedGeneRevision: 1,
      assignmentId: `assignment_${suffix}`,
      eventUuid: `event_offer_${suffix}`,
      now: STAMP,
      ...command(`command_offer_${suffix}`, "2", ADMIN, "administrator"),
    })
    seeds.push({ suffix, commandId: `command_seed_${suffix}`, index })
  }

  // Ages: offers and the old seeds are old; the young orphan is inside the TTL.
  db.raw.exec(`UPDATE icono_authoring_command_receipts SET created_at = '${OLD}'`)
  const youngSeeds = seeds.slice(oldOrphans, oldOrphans + youngOrphans)
  for (const seed of youngSeeds) {
    db.raw
      .prepare("UPDATE icono_authoring_command_receipts SET created_at = ? WHERE command_id = ?")
      .run(YOUNG, seed.commandId)
  }

  // The archive cut: seal the seed events, then delete them through the
  // production trigger (which refuses unless the cut covers the event).
  const seedEvents = rows(
    db,
    "SELECT event_sequence FROM icono_manifestation_events WHERE event_type IS NOT NULL AND event_uuid LIKE 'event_seed_%' ORDER BY event_sequence",
  )
  const through = Math.max(...seedEvents.map((event) => event.event_sequence))
  db.raw
    .prepare(
      "UPDATE icono_authority_state SET event_archive_through = ?, event_archive_sha256 = ? WHERE singleton = 1",
    )
    .run(through, sha("a"))
  db.raw.exec("UPDATE icono_manifestation_events SET projection_status = 'published'")
  db.raw.exec("DELETE FROM icono_manifestation_events WHERE event_uuid LIKE 'event_seed_%'")

  // One old orphan is held by a storage mutation guard (an FK child).
  const guarded = seeds[oldOrphans + youngOrphans]
  db.raw
    .prepare(
      "INSERT INTO icono_manifestation_storage_mutation_guards (command_id, entity_kind, entity_id, operation) VALUES (?, 'revision', 'revision_guarded', 'restore')",
    )
    .run(guarded.commandId)

  return {
    db,
    oldOrphanIds: seeds.slice(0, oldOrphans).map((seed) => seed.commandId),
    youngOrphanId: youngSeeds[0].commandId,
    guardedOrphanId: guarded.commandId,
  }
}

function receiptIds(db) {
  return rows(db, "SELECT command_id FROM icono_authoring_command_receipts ORDER BY rowid").map(
    (receipt) => receipt.command_id,
  )
}

const reapReceipts = (db, overrides = {}, sent = []) =>
  reapAuthoringResidue({
    target: "receipts",
    run: sqliteExecutor(db, sent),
    now: EVENING,
    log: () => {},
    ...overrides,
  })

test("dry run counts the eligible orphans, sends only SELECTs and changes nothing", async (t) => {
  const { db, oldOrphanIds } = await fixture(t)
  const before = receiptIds(db)
  const sent = []
  const report = await reapReceipts(db, { execute: false }, sent)

  assert.equal(report.mode, "dry-run")
  assert.equal(report.eligible, oldOrphanIds.length, "only old orphans without a guard count")
  assert.equal(report.deleted, 0)
  assert.equal(report.rows_written, 0)
  assert.equal(report.done, true)
  assert.ok(sent.length > 0 && sent.every((sql) => /^\s*select/i.test(sql)), "F4: SELECT only")
  assert.deepEqual(receiptIds(db), before, "F4: dry run left every receipt in place")
})

test("execute deletes exactly the old, event-less, unguarded receipts", async (t) => {
  const { db, oldOrphanIds, youngOrphanId, guardedOrphanId } = await fixture(t)
  const report = await reapReceipts(db, { execute: true })

  assert.equal(report.mode, "execute")
  assert.equal(report.deleted, oldOrphanIds.length)
  assert.equal(report.rows_written, oldOrphanIds.length * 2)
  assert.equal(report.done, true)
  const remaining = receiptIds(db)
  for (const id of oldOrphanIds) assert.ok(!remaining.includes(id), `${id} reaped`)
  assert.ok(remaining.includes(youngOrphanId), "F2: a receipt inside the TTL stays")
  assert.ok(remaining.includes(guardedOrphanId), "F9: a guarded receipt is skipped, not fatal")
  const withEvents = rows(
    db,
    "SELECT COUNT(*) AS n FROM icono_manifestation_events event JOIN icono_authoring_command_receipts receipt ON receipt.command_id = event.command_id",
  )[0].n
  assert.equal(withEvents, 6, "F1: every receipt that has an event survived")
  assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), [], "no event lost its receipt")
})

test("a second run deletes nothing new (idempotent)", async (t) => {
  const { db, oldOrphanIds } = await fixture(t)
  const first = await reapReceipts(db, { execute: true })
  const afterFirst = receiptIds(db)
  const second = await reapReceipts(db, { execute: true })
  assert.equal(first.deleted, oldOrphanIds.length)
  assert.equal(second.deleted, 0, "F6")
  assert.deepEqual(receiptIds(db), afterFirst)
})

test("a write cap stops the run, names the resume point, and capped runs add up to a full run", async (t) => {
  const { db, oldOrphanIds } = await fixture(t, { oldOrphans: 5 })
  const reference = await fixture(t, { oldOrphans: 5 })
  await reapReceipts(reference.db, { execute: true })

  let from = 0
  let runs = 0
  let deleted = 0
  for (;;) {
    const report = await reapReceipts(db, {
      execute: true,
      windowSize: 2,
      maxWrites: 4,
      fromRowid: from,
    })
    runs += 1
    deleted += report.deleted
    assert.ok(report.rows_written <= 4, "F5: never past the cap")
    if (report.done) break
    assert.ok(report.next_from_rowid > from, "F6: the resume point moves forward")
    from = report.next_from_rowid
    assert.ok(runs < 50, "terminates")
  }
  assert.ok(runs > 1, "the cap actually split the work")
  assert.equal(deleted, oldOrphanIds.length)
  assert.deepEqual(receiptIds(db), receiptIds(reference.db), "F6/F11: same end state as one run")
})

test("a D1 failure mid-run stops the run and a rerun finishes", async (t) => {
  const { db, oldOrphanIds } = await fixture(t, { oldOrphans: 4 })
  await assert.rejects(
    reapAuthoringResidue({
      target: "receipts",
      run: sqliteExecutor(db, [], { failOnDeleteNumber: 2 }),
      now: EVENING,
      execute: true,
      windowSize: 2,
      log: () => {},
    }),
    (error) => error.code === "D1_STATEMENT_FAILED" && error.partial?.deleted >= 0,
  )
  const partial = receiptIds(db)
  assert.ok(partial.length > 0)
  const rerun = await reapReceipts(db, { execute: true, windowSize: 2 })
  assert.equal(rerun.done, true)
  for (const id of oldOrphanIds) assert.ok(!receiptIds(db).includes(id), "F7")
})

test("a TTL below the floor or not an integer is refused before any statement", async (t) => {
  const { db } = await fixture(t)
  for (const ttlDays of [0, -1, 6, 7.5, Number.NaN, "30"]) {
    const sent = []
    await assert.rejects(
      reapReceipts(db, { execute: true, ttlDays }, sent),
      (error) => error.code === "TTL_INVALID",
      `F3: ttlDays=${String(ttlDays)}`,
    )
    assert.equal(sent.length, 0, "refused before touching D1")
  }
})

test("execute refuses early in the UTC day unless an incident reason is given", async (t) => {
  const { db } = await fixture(t)
  const before = receiptIds(db)
  await assert.rejects(
    reapReceipts(db, { execute: true, now: EARLY }),
    (error) => error.code === "RUN_LATE_IN_THE_UTC_DAY",
  )
  assert.deepEqual(receiptIds(db), before, "F8: nothing deleted early in the UTC day")
  const dry = await reapReceipts(db, { execute: false, now: EARLY })
  assert.equal(dry.mode, "dry-run", "dry run is allowed at any hour")
  const incident = await reapReceipts(db, {
    execute: true,
    now: EARLY,
    allowEarlyReason: "B-859 test: pretend incident",
  })
  assert.equal(incident.deleted, 4)
  assert.equal(incident.early_reason, "B-859 test: pretend incident")
})

test("the write cap must fit at least one window", async (t) => {
  const { db } = await fixture(t)
  await assert.rejects(
    reapReceipts(db, { execute: true, windowSize: 1000, maxWrites: 100 }),
    (error) => error.code === "CAP_BELOW_WINDOW",
  )
})

function seedBackup(db, { status, updatedAt, entries = 5 }) {
  db.raw.exec("PRAGMA foreign_keys = OFF")
  db.raw
    .prepare(
      `INSERT INTO icono_manifestation_cutover_backup_artifacts (
         backup_artifact_id, cutover_run_id, source_snapshot_sha256, status,
         expected_entries, verified_entries, created_at, updated_at,
         inventory_chain_sha256, root_object_key, root_sha256, root_bytes, verified_at
       ) VALUES ('artifact_1', 'run_1', ?, ?, ?, ?, '2026-08-31 21:20:26', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha("a"),
      status,
      status === "verified" ? entries : 100,
      status === "verified" ? entries : 3,
      updatedAt,
      status === "verified" ? sha("b") : null,
      status === "verified" ? "backups/root.bin" : null,
      status === "verified" ? sha("c") : null,
      status === "verified" ? 100 : null,
      status === "verified" ? updatedAt : null,
    )
  for (let index = 1; index <= entries; index += 1) {
    db.raw
      .prepare(
        `INSERT INTO icono_manifestation_cutover_backup_entries (
           backup_artifact_id, entity_kind, entity_id, status, package_object_key,
           package_sha256, package_bytes, body_sha256, body_bytes, ciphertext_sha256,
           ciphertext_bytes, created_at, verified_at
         ) VALUES ('artifact_1', 'revision', ?, 'verified', ?, ?, 100, ?, 50, ?, 66, '2026-09-01 00:00:00', '2026-09-01 00:00:01')`,
      )
      .run(`entity_${index}`, `backup/package_${index}.bin`, sha("d"), sha("e"), sha("f"))
  }
  db.raw.exec("PRAGMA foreign_keys = ON")
}

const reapBackup = (db, overrides = {}, sent = []) =>
  reapAuthoringResidue({
    target: "backup-entries",
    run: sqliteExecutor(db, sent, { writesPerRow: 3 }),
    now: EVENING,
    log: () => {},
    ...overrides,
  })

test("the backup target reaps only an abandoned, quiet backup's entries", async (t) => {
  const { db } = await fixture(t)
  seedBackup(db, { status: "building", updatedAt: "2026-09-24 07:25:32", entries: 5 })
  const dry = await reapBackup(db, { execute: false })
  assert.equal(dry.eligible, 5)
  assert.equal(dry.artifact_status, "building")
  assert.equal(
    rows(db, "SELECT COUNT(*) AS n FROM icono_manifestation_cutover_backup_entries")[0].n,
    5,
  )

  const first = await reapBackup(db, { execute: true, windowSize: 2, maxWrites: 6 })
  assert.equal(first.done, false, "the cap split the backup reap too")
  assert.ok(first.rows_written <= 6)
  let from = first.next_from_rowid
  let finished = first.done
  let guard = 0
  while (!finished) {
    const next = await reapBackup(db, {
      execute: true,
      windowSize: 2,
      maxWrites: 6,
      fromRowid: from,
    })
    from = next.next_from_rowid
    finished = next.done
    assert.ok((guard += 1) < 20)
  }
  assert.equal(
    rows(db, "SELECT COUNT(*) AS n FROM icono_manifestation_cutover_backup_entries")[0].n,
    0,
  )
  assert.equal(
    row(db, "SELECT status FROM icono_manifestation_cutover_backup_artifacts").status,
    "building",
    "the artifact row itself is left alone",
  )
})

test("the backup target refuses a finished backup and one touched in the last 7 days", async (t) => {
  const finished = await fixture(t)
  seedBackup(finished.db, { status: "verified", updatedAt: "2026-09-01 00:00:00", entries: 3 })
  await assert.rejects(
    reapBackup(finished.db, { execute: true }),
    (error) => error.code === "BACKUP_NOT_ABANDONED",
    "F10: a verified backup is not residue",
  )
  assert.equal(
    rows(finished.db, "SELECT COUNT(*) AS n FROM icono_manifestation_cutover_backup_entries")[0].n,
    3,
  )

  const active = await fixture(t)
  seedBackup(active.db, { status: "building", updatedAt: "2026-10-02 07:25:32", entries: 3 })
  await assert.rejects(
    reapBackup(active.db, { execute: true }),
    (error) => error.code === "BACKUP_STILL_ACTIVE",
    "F10: still being written",
  )
})

test("argument parsing is strict and dry-run is the default", () => {
  assert.deepEqual(parseReaperArgs(["--target", "receipts"]), {
    target: "receipts",
    execute: false,
    ttlDays: 30,
    windowSize: 1000,
    maxWrites: 15000,
    fromRowid: 0,
    allowEarlyReason: null,
    reportFile: null,
  })
  assert.equal(parseReaperArgs(["--target", "receipts", "--execute"]).execute, true)
  assert.throws(() => parseReaperArgs([]), /--target/)
  assert.throws(() => parseReaperArgs(["--target", "everything"]), /--target/)
  assert.throws(() => parseReaperArgs(["--target", "receipts", "--bogus"]), /unknown/i)
  assert.throws(() => parseReaperArgs(["--target", "receipts", "--ttl-days", "abc"]), /ttl/i)
})

test("E2E artifact: a full capped, resumed and repeated run, verifiable by hash", async (t) => {
  const { db, oldOrphanIds } = await fixture(t, { oldOrphans: 6, youngOrphans: 2 })
  const before = receiptIds(db)
  const reports = []
  let from = 0
  for (let guard = 0; guard < 50; guard += 1) {
    const report = await reapReceipts(db, {
      execute: true,
      windowSize: 3,
      maxWrites: 6,
      fromRowid: from,
    })
    reports.push(report)
    if (report.done) break
    from = report.next_from_rowid
  }
  const repeat = await reapReceipts(db, { execute: true })
  const after = receiptIds(db)
  const survivorHash = createHash("sha256").update(after.join("\n")).digest("hex")
  const artifact = {
    task: "B-859 step 5: orphan command receipt reaper",
    ttl_days: 30,
    receipts_before: before.length,
    receipts_after: after.length,
    deleted_ids: oldOrphanIds,
    runs: reports.map((report) => ({
      deleted: report.deleted,
      rows_written: report.rows_written,
      next_from_rowid: report.next_from_rowid,
      done: report.done,
    })),
    repeat_run_deleted: repeat.deleted,
    survivors_sha256: survivorHash,
  }
  mkdirSync(new URL("../artifacts/b-859-receipt-reaper/", import.meta.url), { recursive: true })
  writeFileSync(
    new URL("../artifacts/b-859-receipt-reaper/e2e-report.json", import.meta.url),
    `${JSON.stringify(artifact, null, 2)}\n`,
  )
  assert.equal(artifact.receipts_after, before.length - oldOrphanIds.length)
  assert.equal(artifact.repeat_run_deleted, 0)
  assert.ok(reports.length > 1, "the cap split the run")
  assert.match(survivorHash, /^[0-9a-f]{64}$/)
})
