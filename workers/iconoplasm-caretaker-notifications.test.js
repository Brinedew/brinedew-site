import assert from "node:assert/strict"
import test from "node:test"

import {
  markCaretakerCommentsRead,
  readCaretakerCoordination,
} from "./iconoplasm-caretaker-notifications.js"
import { iconoplasmDatabase } from "./test-helpers/account-erasure-fixture.js"

// B-1065 B2b: the caretaker's own role and unread gene comments, read from the
// role row in the real main schema (every migration). Failure modes:
// 1. an offered (not yet accepted) or ended role shows as the person's gene;
// 2. a suspended role disappears, so the caretaker loses their gene's link;
// 3. marking comments read goes backwards, past the newest visible comment, or
//    works on another person's role;
// 4. a hidden comment counts as unread.
const ACCOUNT = "account_notification_0001"
const OTHER = "account_notification_0002"
const ROLE = "assignment_notification_0001"

function setup(t) {
  const db = iconoplasmDatabase()
  t.after(() => db.database.close())
  return db
}

function role(db, status) {
  const started = status === "pending_acceptance" ? null : "2026-10-01"
  db.database
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_symbol, account_id, status, terms_accepted_at,
          relinquish_policy, invited_by_account_id, started_at, suspended_at, ended_at, end_reason)
       VALUES (?, 'TP53', ?, ?, ?, 'retain', ?, ?, ?, ?, ?)`,
    )
    .run(
      ROLE,
      ACCOUNT,
      status,
      started,
      ACCOUNT,
      started,
      status === "suspended" ? "2026-10-02" : null,
      status === "ended" ? "2026-10-03" : null,
      status === "ended" ? "caretaker_resigned" : null,
    )
}

function comment(db, status = "visible") {
  db.database
    .prepare(
      `INSERT INTO icono_gene_comments (gene_symbol, user_id, body, status)
       VALUES ('TP53', 'reader', 'A comment.', ?)`,
    )
    .run(status)
}

test("1, 2: only an accepted, open role shows as the person's gene, suspended included", async (t) => {
  for (const [status, shown] of [
    ["pending_acceptance", false],
    ["active", true],
    ["suspended", true],
    ["ended", false],
  ]) {
    const db = setup(t)
    role(db, status)
    const { caretaker } = await readCaretakerCoordination(db, { accountId: ACCOUNT })
    assert.equal(Boolean(caretaker), shown, status)
    if (shown) {
      assert.equal(caretaker.canonical_symbol, "TP53")
      assert.equal(caretaker.assignment_status, status)
      assert.equal(caretaker.href, "/gene/TP53")
    }
  }
})

test("3, 4: the read mark only moves forward, stops at the newest visible comment, and is the person's own", async (t) => {
  const db = setup(t)
  role(db, "active")
  comment(db)
  comment(db)
  comment(db, "hidden")
  const unread = async () =>
    (await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker.unread_comment_count
  assert.equal(await unread(), 2, "the hidden comment does not count")
  comment(db)
  await markCaretakerCommentsRead(db, { accountId: ACCOUNT, assignmentId: ROLE, throughCommentId: 2 })
  assert.equal(await unread(), 1, "the later comment stays unread")
  await markCaretakerCommentsRead(db, { accountId: ACCOUNT, assignmentId: ROLE, throughCommentId: 1 })
  assert.equal(await unread(), 1, "the mark never goes back")
  await markCaretakerCommentsRead(db, {
    accountId: ACCOUNT,
    assignmentId: ROLE,
    throughCommentId: 999,
  })
  assert.equal(
    db.database
      .prepare(`SELECT comments_read_through_id AS id FROM icono_caretaker_assignments`)
      .get().id,
    4,
    "the mark stops at the newest visible comment",
  )
  await assert.rejects(
    markCaretakerCommentsRead(db, { accountId: OTHER, assignmentId: ROLE, throughCommentId: 4 }),
    (error) => error?.code === "CARETAKER_ASSIGNMENT_NOT_FOUND",
  )
})
