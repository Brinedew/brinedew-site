import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  CARETAKER_SUPERVOTE_HISTORY_LIMIT,
  CARETAKER_SUPERVOTE_WEIGHT,
  CaretakerSupervoteLedger,
  caretakerSupervoteRequestSha256,
  compareCaretakerWeightedCandidates,
} from "./caretaker-supervote.js"

const CANDIDATE_ELIGIBILITY_MIGRATION = readFileSync(
  new URL(
    "../../../migrations-iconoplasm/0088_caretaker_candidate_eligibility.sql",
    import.meta.url,
  ),
  "utf8",
)

class DurableObjectSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }

  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) rows = this.db.prepare(source).all(...bindings)
    else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";")) {
      rows = this.db.prepare(source).all()
    } else this.db.exec(source)
    return { toArray: () => rows }
  }
}

function testLedger() {
  const sql = new DurableObjectSqlForTest()
  const alarms = []
  const storage = {
    sql,
    transactionSync(callback) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
  }
  const ledger = new CaretakerSupervoteLedger({
    storage,
    getSymbol: () => "TP53",
    armAlarm: async (delay) => alarms.push(delay),
  })
  ledger.install()
  ledger.projectAssetEligibilityBatch({
    projections: ["a", "b", "c"].map((character, index) => ({
      event_id: `candidate_seed_${character}`,
      source_event_sequence: index + 1,
      gene_symbol: "TP53",
      asset_sha256: character.repeat(64),
      eligibility_version: 1,
      eligible: 1,
      source_status: "draft",
    })),
  })
  return { ledger, db: sql.db, alarms }
}

function assignmentEvent(overrides = {}) {
  return {
    event_id: "event_assignment_1",
    event_sequence: 100,
    gene: { gene_id: "gene_tp53", canonical_symbol: "TP53" },
    assignment: {
      caretaker_assignment_id: "assignment_tp53",
      account_id: "acct_11111111111111111111111111111111",
      status: "active",
      assignment_version: 1,
    },
    ...overrides,
  }
}

function command(overrides = {}) {
  return {
    accountId: "acct_11111111111111111111111111111111",
    assetSha256: "a".repeat(64),
    commandId: "cmd_supervote_1",
    requestSha256: "1".repeat(64),
    expectedAssignmentVersion: 1,
    expectedSupervoteVersion: 0,
    ...overrides,
  }
}

test("caretaker supervote migration keeps assignment, selection, audit, and receipts separate from FIT votes", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(
    readFileSync(
      new URL("../../../migrations-iconoplasm/0085_caretaker_supervotes.sql", import.meta.url),
      "utf8",
    ),
  )
  const tableNames = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'icono_caretaker_%'
        ORDER BY name`,
    )
    .all()
    .map((row) => row.name)
  assert.deepEqual(tableNames, [
    "icono_caretaker_supervote_command_receipts",
    "icono_caretaker_supervote_events",
    "icono_caretaker_supervote_projection",
    "icono_caretaker_vote_assignment_projection",
  ])
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'icono_image_votes'").get()
      .count,
    0,
  )
})

test("candidate eligibility migration versions seed, reject, restore, delete, and reinsert transitions", () => {
  const db = new DatabaseSync(":memory:")
  db.exec(`
    CREATE TABLE icono_portrait_assets (
      gene_symbol TEXT NOT NULL,
      asset_sha256 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      autopick_eligible INTEGER NOT NULL DEFAULT 1,
      is_stale INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (gene_symbol, asset_sha256)
    );
    INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256)
    VALUES ('TP53', '${"a".repeat(64)}');
  `)
  db.exec(CANDIDATE_ELIGIBILITY_MIGRATION)
  const readProjection = () =>
    db
      .prepare(
        `SELECT eligibility_version, eligible, source_status, source_event_sequence
           FROM icono_caretaker_candidate_eligibility_projection
          WHERE gene_symbol = 'TP53' AND asset_sha256 = ?`,
      )
      .get("a".repeat(64))

  assert.deepEqual(
    {
      eligibility_version: readProjection().eligibility_version,
      eligible: readProjection().eligible,
      source_status: readProjection().source_status,
    },
    { eligibility_version: 1, eligible: 1, source_status: "draft" },
  )
  db.prepare(
    `UPDATE icono_portrait_assets SET status = 'rejected'
      WHERE gene_symbol = 'TP53' AND asset_sha256 = ?`,
  ).run("a".repeat(64))
  assert.deepEqual(
    {
      eligibility_version: readProjection().eligibility_version,
      eligible: readProjection().eligible,
      source_status: readProjection().source_status,
    },
    { eligibility_version: 2, eligible: 0, source_status: "rejected" },
  )
  db.prepare(
    `UPDATE icono_portrait_assets SET status = 'draft'
      WHERE gene_symbol = 'TP53' AND asset_sha256 = ?`,
  ).run("a".repeat(64))
  assert.equal(readProjection().eligibility_version, 3)
  assert.equal(readProjection().eligible, 1)

  db.prepare(
    `DELETE FROM icono_portrait_assets
      WHERE gene_symbol = 'TP53' AND asset_sha256 = ?`,
  ).run("a".repeat(64))
  assert.deepEqual(
    {
      eligibility_version: readProjection().eligibility_version,
      eligible: readProjection().eligible,
      source_status: readProjection().source_status,
    },
    { eligibility_version: 4, eligible: 0, source_status: "deleted" },
  )
  db.prepare(
    `INSERT INTO icono_portrait_assets (gene_symbol, asset_sha256)
     VALUES ('TP53', ?)`,
  ).run("a".repeat(64))
  assert.equal(readProjection().eligibility_version, 5)
  assert.equal(readProjection().eligible, 1)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM icono_caretaker_candidate_eligibility_events").get()
      .count,
    5,
  )
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE icono_portrait_assets SET gene_symbol = 'BRCA1'
            WHERE gene_symbol = 'TP53' AND asset_sha256 = ?`,
        )
        .run("a".repeat(64)),
    /portrait_asset_identity_is_immutable/,
  )
})

test("unknown and stale candidate eligibility cannot authorize a supervote", async () => {
  const { ledger } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  await assert.rejects(
    ledger.setSelection(
      command({
        assetSha256: "d".repeat(64),
        commandId: "cmd_unknown_candidate",
        requestSha256: "9".repeat(64),
      }),
    ),
    (error) => error.code === "SUPERVOTE_TARGET_INELIGIBLE",
  )
  ledger.projectAssetEligibility({
    event_id: "candidate_a_v2",
    source_event_sequence: 4,
    gene_symbol: "TP53",
    asset_sha256: "a".repeat(64),
    eligibility_version: 2,
    eligible: 0,
    source_status: "deleted",
  })
  assert.throws(
    () =>
      ledger.projectAssetEligibility({
        event_id: "candidate_a_v1_stale",
        source_event_sequence: 5,
        gene_symbol: "TP53",
        asset_sha256: "a".repeat(64),
        eligibility_version: 1,
        eligible: 1,
        source_status: "draft",
      }),
    (error) => error.code === "STALE_CANDIDATE_ELIGIBILITY",
  )
})

test("one caretaker supervote moves atomically and exact command replay is idempotent", async () => {
  const { ledger, db } = testLedger()
  await ledger.projectAssignment(assignmentEvent())

  const first = await ledger.setSelection(command())
  const moved = await ledger.setSelection(
    command({
      assetSha256: "b".repeat(64),
      commandId: "cmd_supervote_2",
      requestSha256: "2".repeat(64),
      expectedSupervoteVersion: 1,
    }),
  )
  const replay = await ledger.setSelection(
    command({
      assetSha256: "b".repeat(64),
      commandId: "cmd_supervote_2",
      requestSha256: "2".repeat(64),
      expectedSupervoteVersion: 1,
    }),
  )

  assert.equal(first.supervote.asset_sha256, "a".repeat(64))
  assert.equal(first.supervote.supervote_version, 1)
  assert.equal(moved.supervote.asset_sha256, "b".repeat(64))
  assert.equal(moved.supervote.supervote_version, 2)
  assert.equal(replay.replayed, true)
  assert.equal(ledger.snapshot().asset_sha256, "b".repeat(64))
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM caretaker_supervote_head").get().count, 1)
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM caretaker_supervote_audit WHERE event_type = 'supervote_moved'",
      )
      .get().count,
    1,
  )
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM caretaker_supervote_command_receipts").get().count,
    2,
  )
})

test("a reused command ID with different content is rejected", async () => {
  const { ledger } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  await ledger.setSelection(command())
  await assert.rejects(
    ledger.setSelection(command({ assetSha256: "b".repeat(64), requestSha256: "2".repeat(64) })),
    (error) => error.code === "COMMAND_ID_CONFLICT" && error.status === 409,
  )
})

test("suspension preserves the +10 selection but blocks mutation; ending deactivates it", async () => {
  const { ledger } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  await ledger.setSelection(command())

  await ledger.projectAssignment(
    assignmentEvent({
      event_id: "event_assignment_2",
      event_sequence: 101,
      assignment: {
        caretaker_assignment_id: "assignment_tp53",
        account_id: "acct_11111111111111111111111111111111",
        status: "suspended",
        assignment_version: 2,
      },
    }),
  )
  const suspended = ledger.snapshot("acct_11111111111111111111111111111111")
  assert.equal(suspended.asset_sha256, "a".repeat(64))
  assert.equal(suspended.active, true)
  assert.equal(suspended.suspended, true)
  assert.equal(suspended.can_mutate, false)
  await assert.rejects(
    ledger.setSelection(
      command({
        assetSha256: "b".repeat(64),
        commandId: "cmd_supervote_suspended",
        requestSha256: "3".repeat(64),
        expectedAssignmentVersion: 2,
        expectedSupervoteVersion: 1,
      }),
    ),
    (error) => error.code === "CARETAKER_ASSIGNMENT_SUSPENDED",
  )

  await ledger.projectAssignment(
    assignmentEvent({
      event_id: "event_assignment_3",
      event_sequence: 102,
      assignment: {
        caretaker_assignment_id: "assignment_tp53",
        account_id: "acct_11111111111111111111111111111111",
        status: "ended",
        assignment_version: 3,
      },
    }),
  )
  const ended = ledger.snapshot("acct_11111111111111111111111111111111")
  assert.equal(ended.asset_sha256, null)
  assert.equal(ended.active, false)
  assert.equal(ended.supervote_version, 2)
})

test("weighted ranking is ordinary score plus 10 and caretaker wins an exact weighted tie", async () => {
  const ordinaryLeader = { asset_sha256: "a".repeat(64), score: 10, upvotes: 10 }
  const caretakerPick = {
    asset_sha256: "b".repeat(64),
    score: 0,
    upvotes: 0,
    caretaker_supervote: true,
  }
  const ranked = [ordinaryLeader, caretakerPick].sort((left, right) =>
    compareCaretakerWeightedCandidates(left, right, (a, b) => b.upvotes - a.upvotes),
  )
  assert.equal(CARETAKER_SUPERVOTE_WEIGHT, 10)
  assert.equal(ranked[0].asset_sha256, caretakerPick.asset_sha256)

  const { ledger } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  await ledger.setSelection(command({ assetSha256: caretakerPick.asset_sha256 }))
  const ordinarySnapshot = {
    asset_sha256: caretakerPick.asset_sha256,
    image_upvotes: 8,
    image_downvotes: 3,
    image_score: 5,
  }
  const decorated = ledger.decorateSnapshot(ordinarySnapshot)
  assert.equal(decorated.image_upvotes, 8)
  assert.equal(decorated.image_downvotes, 3)
  assert.equal(decorated.image_score, 5)
})

test("invalidating a selected candidate clears it atomically and closes both race orderings", async () => {
  const { ledger, db } = testLedger()
  const firstAsset = "a".repeat(64)
  const secondAsset = "b".repeat(64)
  const thirdAsset = "c".repeat(64)
  await ledger.projectAssignment(assignmentEvent())
  await ledger.setSelection(command({ assetSha256: firstAsset }))

  const invalidated = ledger.projectAssetEligibility({
    event_id: "delete_first_asset",
    source_event_sequence: 4,
    gene_symbol: "TP53",
    asset_sha256: firstAsset,
    eligibility_version: 2,
    eligible: 0,
    source_status: "deleted",
  })
  assert.equal(invalidated.changed, true)
  assert.equal(invalidated.selection_cleared, true)
  assert.equal(invalidated.supervote.asset_sha256, null)
  assert.equal(invalidated.supervote.supervote_version, 2)
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM caretaker_supervote_audit WHERE event_type = 'supervote_asset_invalidated'",
      )
      .get().count,
    1,
  )
  await assert.rejects(
    ledger.setSelection(
      command({
        assetSha256: firstAsset,
        commandId: "cmd_blocked_after_delete",
        requestSha256: "2".repeat(64),
        expectedSupervoteVersion: 2,
      }),
    ),
    (error) => error.code === "SUPERVOTE_TARGET_INELIGIBLE",
  )

  const invalidationReplay = ledger.projectAssetEligibility({
    event_id: "delete_first_asset",
    source_event_sequence: 4,
    gene_symbol: "TP53",
    asset_sha256: firstAsset,
    eligibility_version: 2,
    eligible: 0,
    source_status: "deleted",
  })
  assert.equal(invalidationReplay.replayed, true)
  const restored = ledger.projectAssetEligibility({
    event_id: "restore_first_asset",
    source_event_sequence: 5,
    gene_symbol: "TP53",
    asset_sha256: firstAsset,
    eligibility_version: 3,
    eligible: 1,
    source_status: "draft",
  })
  assert.equal(restored.changed, true)
  await assert.rejects(
    Promise.resolve().then(() =>
      ledger.projectAssetEligibility({
        event_id: "delete_first_asset",
        source_event_sequence: 4,
        gene_symbol: "TP53",
        asset_sha256: firstAsset,
        eligibility_version: 2,
        eligible: 0,
        source_status: "deleted",
      }),
    ),
    (error) => error.code === "STALE_CANDIDATE_ELIGIBILITY",
  )

  await ledger.setSelection(
    command({
      assetSha256: secondAsset,
      commandId: "cmd_move_wins_first",
      requestSha256: "3".repeat(64),
      expectedSupervoteVersion: 2,
    }),
  )
  const deleteAfterMove = ledger.projectAssetEligibility({
    event_id: "delete_after_move",
    source_event_sequence: 6,
    gene_symbol: "TP53",
    asset_sha256: secondAsset,
    eligibility_version: 2,
    eligible: 0,
    source_status: "deleted",
  })
  assert.equal(deleteAfterMove.changed, true)
  assert.equal(deleteAfterMove.supervote.asset_sha256, null)

  ledger.projectAssetEligibility({
    event_id: "delete_before_move",
    source_event_sequence: 7,
    gene_symbol: "TP53",
    asset_sha256: thirdAsset,
    eligibility_version: 2,
    eligible: 0,
    source_status: "deleted",
  })
  await assert.rejects(
    ledger.setSelection(
      command({
        assetSha256: thirdAsset,
        commandId: "cmd_delete_wins_first",
        requestSha256: "4".repeat(64),
        expectedSupervoteVersion: 4,
      }),
    ),
    (error) => error.code === "SUPERVOTE_TARGET_INELIGIBLE",
  )
  const batchRestore = ledger.projectAssetEligibilityBatch({
    projections: [
      {
        event_id: "restore_third_asset",
        source_event_sequence: 8,
        gene_symbol: "TP53",
        asset_sha256: thirdAsset,
        eligibility_version: 3,
        eligible: 1,
        source_status: "draft",
      },
    ],
  })
  assert.equal(batchRestore.changed, 1)
  const selectedAfterBatchRestore = await ledger.setSelection(
    command({
      assetSha256: thirdAsset,
      commandId: "cmd_after_batch_restore",
      requestSha256: "5".repeat(64),
      expectedSupervoteVersion: 4,
    }),
  )
  assert.equal(selectedAfterBatchRestore.supervote.asset_sha256, thirdAsset)
})

test("server-derived idempotency hash binds selection and both CAS tokens", async () => {
  const base = {
    command_id: "cmd_supervote_hash",
    gene_symbol: "TP53",
    caretaker_account_id: "acct_11111111111111111111111111111111",
    asset_sha256: "a".repeat(64),
    expected_assignment_version: 3,
    expected_supervote_version: 8,
  }
  const first = await caretakerSupervoteRequestSha256(base)
  const exactReplay = await caretakerSupervoteRequestSha256({ ...base })
  const moved = await caretakerSupervoteRequestSha256({ ...base, asset_sha256: "b".repeat(64) })
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, exactReplay)
  assert.notEqual(first, moved)
})

test("outbox delivery is durable and does not duplicate after completion", async () => {
  const { ledger } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  await ledger.setSelection(command())
  const mutations = []
  const firstDrain = await ledger.drainOutbox(async (payload) =>
    mutations.push(payload.mutation_id),
  )
  const retryDrain = await ledger.drainOutbox(async (payload) =>
    mutations.push(payload.mutation_id),
  )
  assert.equal(firstDrain.ok, true)
  assert.equal(firstDrain.delivered, 2)
  assert.equal(retryDrain.delivered, 0)
  assert.deepEqual(mutations, [
    "caretaker-assignment:event_assignment_1",
    "caretaker-supervote:cmd_supervote_1",
  ])
})

test("history retention bounds replay receipts and delivered rows without pruning pending outbox", async () => {
  const { ledger, db } = testLedger()
  await ledger.projectAssignment(assignmentEvent())
  const acceptedCommands = CARETAKER_SUPERVOTE_HISTORY_LIMIT + 5
  for (let index = 0; index < acceptedCommands; index += 1) {
    await ledger.setSelection(
      command({
        commandId: `cmd_retention_${index}`,
        requestSha256: (index + 1).toString(16).padStart(64, "0"),
        expectedSupervoteVersion: index,
      }),
    )
  }

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM caretaker_supervote_audit").get().count,
    CARETAKER_SUPERVOTE_HISTORY_LIMIT,
  )
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM caretaker_supervote_command_receipts").get().count,
    CARETAKER_SUPERVOTE_HISTORY_LIMIT,
  )
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM caretaker_supervote_outbox WHERE delivered_at IS NULL",
      )
      .get().count,
    acceptedCommands + 1,
  )

  const newestIndex = acceptedCommands - 1
  const newestReplay = await ledger.setSelection(
    command({
      commandId: `cmd_retention_${newestIndex}`,
      requestSha256: (newestIndex + 1).toString(16).padStart(64, "0"),
      expectedSupervoteVersion: newestIndex,
    }),
  )
  assert.equal(newestReplay.replayed, true)
  await assert.rejects(
    ledger.setSelection(
      command({
        commandId: "cmd_retention_0",
        requestSha256: "1".padStart(64, "0"),
        expectedSupervoteVersion: 0,
      }),
    ),
    (error) => error.code === "STALE_SUPERVOTE_STATE",
  )

  let pending = true
  while (pending) {
    const drained = await ledger.drainOutbox(async () => {})
    pending = Boolean(drained.pending)
  }
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM caretaker_supervote_outbox WHERE delivered_at IS NULL",
      )
      .get().count,
    0,
  )
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM caretaker_supervote_outbox WHERE delivered_at IS NOT NULL",
      )
      .get().count,
    CARETAKER_SUPERVOTE_HISTORY_LIMIT,
  )
})
