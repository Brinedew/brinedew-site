import assert from "node:assert/strict"
import test from "node:test"

import { blankDatabase, iconoplasmDatabase } from "../test-helpers/account-erasure-fixture.js"
import {
  DISCORD_OUTBOX_STATUSES,
  DISCORD_OUTBOX_TABLES,
  DISCORD_OUTBOX_TERMINAL_STATUSES,
  DISCORD_OUTBOX_TRANSITIONS,
  allowedSourceDiscordOutboxStorageStatuses,
  assertDiscordOutboxTransition,
  canTransitionDiscordOutboxStatus,
  deliverableDiscordOutboxStorageStatuses,
  finishCaretakerOutboxDelivery,
  nextDiscordOutboxRetryAt,
  normalizeDiscordOutboxStatus,
  openDiscordOutboxStorageStatuses,
  toDiscordOutboxStorageStatus,
} from "./iconoplasm-discord-outbox.js"

test("shared Discord outbox defines closed 7-state vocabulary and storage mapping across all 4 tables", () => {
  assert.deepEqual(DISCORD_OUTBOX_STATUSES, [
    "pending",
    "sending",
    "retry",
    "sent",
    "failed",
    "unknown",
    "suppressed",
  ])
  assert.deepEqual(DISCORD_OUTBOX_TERMINAL_STATUSES, ["sent", "unknown"])
  assert.deepEqual(Object.values(DISCORD_OUTBOX_TABLES), [
    "icono_request_notifications",
    "icono_caretaker_comment_notifications",
    "icono_caretaker_supervote_notifications",
    "icono_caretaker_gene_request_notifications",
  ])

  assert.equal(normalizeDiscordOutboxStatus("suppressed_not_test_recipient"), "suppressed")
  assert.equal(
    toDiscordOutboxStorageStatus(DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT, "suppressed"),
    "suppressed_not_test_recipient",
  )
  assert.equal(
    toDiscordOutboxStorageStatus(DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT, "suppressed"),
    "suppressed",
  )
  assert.deepEqual(
    deliverableDiscordOutboxStorageStatuses(DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT, {
      includeSuppressed: true,
    }),
    ["pending", "retry", "suppressed_not_test_recipient"],
  )
  assert.deepEqual(openDiscordOutboxStorageStatuses(DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT), [
    "pending",
    "sending",
    "retry",
    "unknown",
    "suppressed_not_test_recipient",
  ])
  assert.throws(() => normalizeDiscordOutboxStatus("bogus_status"), /Unknown Discord outbox status/)
})

test("transition validation allows legal moves and refuses illegal moves including sent -> * and pending -> sent", () => {
  assert.equal(canTransitionDiscordOutboxStatus("pending", "sending"), true)
  assert.equal(canTransitionDiscordOutboxStatus("sending", "sent"), true)
  assert.equal(canTransitionDiscordOutboxStatus("sending", "retry"), true)
  assert.equal(canTransitionDiscordOutboxStatus("sending", "failed"), true)
  assert.equal(canTransitionDiscordOutboxStatus("sending", "unknown"), true)
  assert.equal(canTransitionDiscordOutboxStatus("failed", "retry"), true)
  assert.equal(canTransitionDiscordOutboxStatus("suppressed_not_test_recipient", "sending"), true)

  for (const fromStatus of ["sent", "unknown"]) {
    assert.deepEqual(DISCORD_OUTBOX_TRANSITIONS[fromStatus], [])
    for (const toStatus of DISCORD_OUTBOX_STATUSES) {
      assert.equal(canTransitionDiscordOutboxStatus(fromStatus, toStatus), false)
      assert.throws(
        () => assertDiscordOutboxTransition(fromStatus, toStatus),
        /Illegal Discord outbox status transition/,
      )
    }
  }

  for (const [fromStatus, toStatus] of [
    ["pending", "sent"],
    ["pending", "failed"],
    ["retry", "sent"],
    ["sending", "pending"],
    ["suppressed", "sent"],
    ["failed", "sent"],
  ]) {
    assert.equal(canTransitionDiscordOutboxStatus(fromStatus, toStatus), false)
    assert.throws(
      () => assertDiscordOutboxTransition(fromStatus, toStatus),
      /Illegal Discord outbox status transition/,
    )
  }

  assert.deepEqual(
    allowedSourceDiscordOutboxStorageStatuses(DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT, "sent"),
    ["sending"],
  )
})

test("shared retry backoff computes bounded SQLite UTC timestamps per outbox policy", () => {
  const nowMs = Date.UTC(2026, 10, 15, 0, 0, 0)
  assert.equal(
    nextDiscordOutboxRetryAt(1, {
      table: DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
      nowMs,
    }),
    "2026-11-15 00:00:30",
  )
  assert.equal(
    nextDiscordOutboxRetryAt(20, {
      table: DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
      nowMs,
    }),
    "2026-11-15 04:16:00",
  )
  assert.equal(
    nextDiscordOutboxRetryAt(1, {
      table: DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT,
      nowMs,
    }),
    "2026-11-15 00:15:00",
  )
  assert.equal(
    nextDiscordOutboxRetryAt(20, {
      table: DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT,
      nowMs,
    }),
    "2026-11-16 00:00:00",
  )
})

test("SQLite finishCaretakerOutboxDelivery enforces sending precondition and rejects invalid transitions", async (t) => {
  const db = iconoplasmDatabase()
  t.after(() => db.database.close())
  db.database.exec(`
    INSERT INTO icono_caretaker_comment_notifications (
      notification_key, caretaker_assignment_id, caretaker_account_id,
      caretaker_discord_user_id, gene_symbol, comment_author_account_id,
      comment_author_name, comment_body, discord_status
    ) VALUES
      ('n-sending', 'assign-1', 'acc-1', '123456', 'TP53', 'acc-2', 'Reader', 'hi', 'sending'),
      ('n-sent', 'assign-1', 'acc-1', '123456', 'TP53', 'acc-2', 'Reader', 'hi', 'sent'),
      ('n-pending', 'assign-1', 'acc-1', '123456', 'TP53', 'acc-2', 'Reader', 'hi', 'pending');
  `)

  await assert.rejects(
    () =>
      finishCaretakerOutboxDelivery(
        db,
        DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
        "n-sending",
        "pending",
      ),
    /Illegal Discord outbox status transition/,
  )

  const ignoredSent = await finishCaretakerOutboxDelivery(
    db,
    DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
    "n-sent",
    "failed",
    { error: "late_overwrite" },
  )
  assert.equal(ignoredSent, 0)
  assert.equal(
    db.database
      .prepare(
        "SELECT discord_status FROM icono_caretaker_comment_notifications WHERE notification_key = 'n-sent'",
      )
      .get().discord_status,
    "sent",
  )

  const ignoredPending = await finishCaretakerOutboxDelivery(
    db,
    DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
    "n-pending",
    "sent",
    { channelId: "c1", messageId: "m1" },
  )
  assert.equal(ignoredPending, 0)

  const committed = await finishCaretakerOutboxDelivery(
    db,
    DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
    "n-sending",
    "sent",
    { channelId: "c1", messageId: "m1" },
  )
  assert.equal(committed, 1)
  assert.equal(
    db.database
      .prepare(
        "SELECT discord_status FROM icono_caretaker_comment_notifications WHERE notification_key = 'n-sending'",
      )
      .get().discord_status,
    "sent",
  )

  // blankDatabase sanity check ensures no stray dependency on accounts DB.
  const blank = blankDatabase()
  blank.close()
})
