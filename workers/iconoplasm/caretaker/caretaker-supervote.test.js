import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  CARETAKER_SUPERVOTE_WEIGHT,
  caretakerSupervoteRequestSha256,
  compareCaretakerWeightedCandidates,
} from "./caretaker-supervote.js"

// The D1 supervote commands (set, assignment projection, invalidation) are
// exercised against the full migrated schema in workers/iconoplasm.d1-votes.test.js.

const CANDIDATE_ELIGIBILITY_MIGRATION = readFileSync(
  new URL(
    "../../../migrations-iconoplasm/0088_caretaker_candidate_eligibility.sql",
    import.meta.url,
  ),
  "utf8",
)

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

test("signed weighting adds or subtracts 10 and only a positive preference wins its weighted tie", async () => {
  const ordinaryLeader = { asset_sha256: "a".repeat(64), score: 10, upvotes: 10 }
  const caretakerPick = {
    asset_sha256: "b".repeat(64),
    score: 0,
    upvotes: 0,
    caretaker_supervote: true,
    caretaker_supervote_direction: 1,
  }
  const ranked = [ordinaryLeader, caretakerPick].sort((left, right) =>
    compareCaretakerWeightedCandidates(left, right, (a, b) => b.upvotes - a.upvotes),
  )
  assert.equal(CARETAKER_SUPERVOTE_WEIGHT, 10)
  assert.equal(ranked[0].asset_sha256, caretakerPick.asset_sha256)

  const rejectedByCaretaker = {
    asset_sha256: "c".repeat(64),
    score: 15,
    upvotes: 15,
    caretaker_supervote: true,
    caretaker_supervote_direction: -1,
  }
  const negativeRanked = [ordinaryLeader, rejectedByCaretaker].sort((left, right) =>
    compareCaretakerWeightedCandidates(left, right, (a, b) => b.upvotes - a.upvotes),
  )
  assert.equal(negativeRanked[0].asset_sha256, ordinaryLeader.asset_sha256)
})

test("server-derived idempotency hash binds selection and both CAS tokens", async () => {
  const base = {
    command_id: "cmd_supervote_hash",
    gene_symbol: "TP53",
    caretaker_account_id: "acct_11111111111111111111111111111111",
    asset_sha256: "a".repeat(64),
    direction: 1,
    expected_assignment_version: 3,
    expected_supervote_version: 8,
  }
  const first = await caretakerSupervoteRequestSha256(base)
  const exactReplay = await caretakerSupervoteRequestSha256({ ...base })
  const moved = await caretakerSupervoteRequestSha256({ ...base, asset_sha256: "b".repeat(64) })
  const reversed = await caretakerSupervoteRequestSha256({ ...base, direction: -1 })
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, exactReplay)
  assert.notEqual(first, moved)
  assert.notEqual(first, reversed)
})
