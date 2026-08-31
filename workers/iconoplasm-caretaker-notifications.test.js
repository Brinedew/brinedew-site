import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  markCaretakerAssignmentNotificationRead,
  projectCaretakerAssignmentNotification,
  readCaretakerAssignmentNotifications,
} from "./iconoplasm-caretaker-notifications.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

const MIGRATION = readFileSync(
  new URL("../migrations-iconoplasm/0086_caretaker_assignment_notifications.sql", import.meta.url),
  "utf8",
)
const ACCOUNT = "account_notification_0001"
const OTHER = "account_notification_0002"
const ASSIGNMENT = "assignment_notification_0001"
const GENE = "gene_notification_0001"

function event(sequence, status, version = sequence) {
  return {
    event_id: `event_notification_${String(sequence).padStart(4, "0")}`,
    event_sequence: sequence,
    gene_id: GENE,
    gene: { gene_id: GENE, canonical_symbol: "TP53" },
    assignment: {
      caretaker_assignment_id: ASSIGNMENT,
      account_id: ACCOUNT,
      status,
      assignment_version: version,
    },
  }
}

function setup(t) {
  const db = new TestD1()
  db.raw.exec(MIGRATION)
  t.after(() => db.close())
  return db
}

test("offered assignment creates one stable-account inbox item and replay is idempotent", async (t) => {
  const db = setup(t)
  const offered = await projectCaretakerAssignmentNotification(db, event(1, "pending_acceptance"))
  assert.equal(offered.replayed, false)
  assert.equal(offered.notification_state, "pending")

  const replay = await projectCaretakerAssignmentNotification(db, event(1, "pending_acceptance"))
  assert.equal(replay.replayed, true)
  assert.equal(
    db.raw.prepare("SELECT count(*) AS total FROM icono_caretaker_assignment_notifications").get()
      .total,
    1,
  )

  const inbox = await readCaretakerAssignmentNotifications(db, { accountId: ACCOUNT })
  assert.equal(inbox.pending_count, 1)
  assert.equal(inbox.unread_count, 1)
  assert.deepEqual(
    inbox.invitations.map((item) => ({
      caretaker_assignment_id: item.caretaker_assignment_id,
      gene_id: item.gene_id,
      canonical_symbol: item.canonical_symbol,
      href: item.href,
    })),
    [
      {
        caretaker_assignment_id: ASSIGNMENT,
        gene_id: GENE,
        canonical_symbol: "TP53",
        href: "/gene/TP53",
      },
    ],
  )
})

test("accept, decline, cancel, or end event resolves rather than deletes invitation", async (t) => {
  const db = setup(t)
  await projectCaretakerAssignmentNotification(db, event(1, "pending_acceptance", 1))
  const accepted = await projectCaretakerAssignmentNotification(db, event(2, "active", 2))
  assert.equal(accepted.notification_state, "resolved")

  const staleOffer = await projectCaretakerAssignmentNotification(
    db,
    event(1, "pending_acceptance", 1),
  )
  assert.equal(staleOffer.replayed, true)
  const row = db.raw
    .prepare(
      `SELECT notification_state, assignment_status, authority_event_sequence, resolved_at
         FROM icono_caretaker_assignment_notifications WHERE caretaker_assignment_id = ?`,
    )
    .get(ASSIGNMENT)
  assert.equal(row.notification_state, "resolved")
  assert.equal(row.assignment_status, "active")
  assert.equal(row.authority_event_sequence, 2)
  assert.ok(row.resolved_at)
})

test("read marker is account-scoped and idempotent without resolving a pending invitation", async (t) => {
  const db = setup(t)
  await projectCaretakerAssignmentNotification(db, event(1, "pending_acceptance", 1))
  const first = await markCaretakerAssignmentNotificationRead(db, {
    accountId: ACCOUNT,
    assignmentId: ASSIGNMENT,
  })
  const replay = await markCaretakerAssignmentNotificationRead(db, {
    accountId: ACCOUNT,
    assignmentId: ASSIGNMENT,
  })
  assert.equal(replay.read_at, first.read_at)
  assert.equal(
    db.raw
      .prepare(
        "SELECT notification_state FROM icono_caretaker_assignment_notifications WHERE caretaker_assignment_id = ?",
      )
      .get(ASSIGNMENT).notification_state,
    "pending",
  )
  await assert.rejects(
    markCaretakerAssignmentNotificationRead(db, {
      accountId: OTHER,
      assignmentId: ASSIGNMENT,
    }),
    (error) => error?.code === "CARETAKER_NOTIFICATION_NOT_FOUND",
  )
})

test("events without an assignment are not invitation events", async (t) => {
  const db = setup(t)
  assert.deepEqual(
    await projectCaretakerAssignmentNotification(db, {
      event_id: "event_notification_none",
      event_sequence: 1,
      gene_id: GENE,
    }),
    { ok: true, skipped: true },
  )
})
