import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  markCaretakerCommentsRead,
  projectCaretakerAssignmentNotification,
  readCaretakerCoordination,
} from "./iconoplasm-caretaker-notifications.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

const MIGRATIONS = [
  "0085_caretaker_supervotes.sql",
  "0086_caretaker_assignment_notifications.sql",
  "0090_caretaker_coordination.sql",
  "0092_signed_caretaker_supervote.sql",
]
  .map((name) => readFileSync(new URL(`../migrations-iconoplasm/${name}`, import.meta.url), "utf8"))
  .join("\n")
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
  db.raw.exec(`
    CREATE TABLE icono_gene_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'visible'
    );
    CREATE TABLE icono_publish_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      from_asset_sha256 TEXT,
      to_asset_sha256 TEXT,
      action TEXT NOT NULL
    );
    ${MIGRATIONS}
  `)
  t.after(() => db.close())
  return db
}

test("only a current active or suspended assignment appears in caretaker coordination", async (t) => {
  const db = setup(t)
  assert.equal((await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker, null)
  await projectCaretakerAssignmentNotification(db, event(1, "active"))
  const active = (await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker
  assert.equal(active.canonical_symbol, "TP53")
  assert.equal(active.assignment_status, "active")
  assert.equal(active.unread_comment_count, 0)
  await projectCaretakerAssignmentNotification(db, event(2, "ended"))
  assert.equal((await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker, null)
})

test("comment high-water is account scoped, monotonic, and does not swallow a later comment", async (t) => {
  const db = setup(t)
  await projectCaretakerAssignmentNotification(db, event(1, "active"))
  db.raw.prepare("INSERT INTO icono_gene_comments (gene_symbol) VALUES ('TP53'), ('TP53')").run()
  assert.equal(
    (await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker.unread_comment_count,
    2,
  )
  db.raw.prepare("INSERT INTO icono_gene_comments (gene_symbol) VALUES ('TP53')").run()
  await markCaretakerCommentsRead(db, {
    accountId: ACCOUNT,
    assignmentId: ASSIGNMENT,
    throughCommentId: 2,
  })
  const after = (await readCaretakerCoordination(db, { accountId: ACCOUNT })).caretaker
  assert.equal(after.unread_comment_count, 1)
  await assert.rejects(
    markCaretakerCommentsRead(db, {
      accountId: OTHER,
      assignmentId: ASSIGNMENT,
      throughCommentId: 3,
    }),
    (error) => error?.code === "CARETAKER_ASSIGNMENT_NOT_FOUND",
  )
})

test("projection replay remains idempotent", async (t) => {
  const db = setup(t)
  const first = await projectCaretakerAssignmentNotification(db, event(1, "active"))
  const replay = await projectCaretakerAssignmentNotification(db, event(1, "active"))
  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.equal(
    db.raw.prepare("SELECT count(*) AS total FROM icono_caretaker_assignment_notifications").get()
      .total,
    1,
  )
})
