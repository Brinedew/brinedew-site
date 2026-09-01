import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  caretakerCommentOutboxStatement,
  deliverPendingCaretakerCommentNotifications,
  deliverPendingCaretakerSupervoteNotifications,
  resolveCaretakerCommentRecipient,
} from "./iconoplasm-caretaker-comment-notifications.js"
import { TestD1 } from "./iconoplasm/caretaker/manifestation-authority-test-support.js"

const ACCOUNT = "account_caretaker_comment_0001"
const AUTHOR = "account_caretaker_comment_0002"
const ASSIGNMENT = "assignment_caretaker_comment_0001"

function setup(t) {
  const primary = new TestD1()
  const accounts = new TestD1()
  primary.raw.exec(`
    CREATE TABLE icono_gene_comments (id INTEGER PRIMARY KEY, gene_symbol TEXT, status TEXT);
    CREATE TABLE icono_publish_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene_symbol TEXT NOT NULL,
      from_asset_sha256 TEXT,
      to_asset_sha256 TEXT,
      action TEXT NOT NULL
    );
    CREATE TABLE icono_publish_state (
      gene_symbol TEXT PRIMARY KEY,
      current_asset_sha256 TEXT
    );
    INSERT INTO icono_publish_state VALUES ('TP53', '${"b".repeat(64)}');
    ${readFileSync(new URL("../migrations-iconoplasm/0085_caretaker_supervotes.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0086_caretaker_assignment_notifications.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0090_caretaker_coordination.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0092_signed_caretaker_supervote.sql", import.meta.url), "utf8")}
    INSERT INTO icono_caretaker_assignment_notifications (
      caretaker_assignment_id, account_id, gene_id, canonical_symbol,
      assignment_status, assignment_version, notification_state,
      authority_event_id, authority_event_sequence, resolved_at
    ) VALUES (
      '${ASSIGNMENT}', '${ACCOUNT}', 'gene_caretaker_comment_0001', 'TP53',
      'active', 1, 'resolved', 'event_caretaker_comment_0001', 1, CURRENT_TIMESTAMP
    );
    INSERT INTO icono_caretaker_vote_assignment_projection (
      gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
      status, assignment_version, authority_event_id, authority_event_sequence
    ) VALUES ('TP53', 'gene_caretaker_comment_0001', '${ASSIGNMENT}', '${ACCOUNT}',
              'active', 1, 'event_caretaker_comment_0001', 1);
    INSERT INTO icono_caretaker_supervote_projection (
      gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
      asset_sha256, direction, active, weight, supervote_version, last_mutation_id
    ) VALUES ('TP53', 'gene_caretaker_comment_0001', '${ASSIGNMENT}', '${ACCOUNT}',
              '${"a".repeat(64)}', 1, 1, 10, 3, 'mutation_supervote_0001');
  `)
  accounts.raw.exec(`
    CREATE TABLE brinedew_account_identities (
      provider TEXT, provider_subject TEXT, account_id TEXT,
      link_version INTEGER, unlinked_at INTEGER
    );
    INSERT INTO brinedew_account_identities VALUES ('discord', '123456789', '${ACCOUNT}', 1, NULL);
  `)
  t.after(() => {
    primary.close()
    accounts.close()
  })
  return { primary, accounts, env: { ICONOPLASM_DB: primary, DB: accounts } }
}

test("recipient resolution uses the active assignment and suppresses self-notification", async (t) => {
  const { env } = setup(t)
  const recipient = await resolveCaretakerCommentRecipient(env, {
    symbol: "tp53",
    authorAccountId: AUTHOR,
  })
  assert.equal(recipient.caretaker_account_id, ACCOUNT)
  assert.equal(recipient.caretaker_discord_user_id, "123456789")
  assert.equal(
    await resolveCaretakerCommentRecipient(env, { symbol: "TP53", authorAccountId: ACCOUNT }),
    null,
  )
})

test("durable outbox sends one DM and records Discord receipt", async (t) => {
  const { primary, env } = setup(t)
  const row = {
    notification_key: "caretaker_comment_notification_0001",
    caretaker_assignment_id: ASSIGNMENT,
    caretaker_account_id: ACCOUNT,
    caretaker_discord_user_id: "123456789",
    gene_symbol: "TP53",
    comment_author_account_id: AUTHOR,
    comment_author_name: "Reader",
    comment_body: "🧬".repeat(2000),
  }
  await caretakerCommentOutboxStatement(primary, row).run()
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    if (String(url).endsWith("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "dm-channel" }), { status: 200 })
    }
    return new Response(JSON.stringify({ id: "dm-message" }), { status: 200 })
  }
  try {
    const results = await Promise.all([
      deliverPendingCaretakerCommentNotifications(
        { ...env, DISCORD_BOT_TOKEN: "test-token" },
        { limit: 1 },
      ),
      deliverPendingCaretakerCommentNotifications(
        { ...env, DISCORD_BOT_TOKEN: "test-token" },
        { limit: 1 },
      ),
    ])
    assert.equal(
      results.reduce((total, result) => total + result.delivered, 0),
      1,
    )
    assert.equal(requests.length, 2)
    assert.match(requests[1].body.content, /TP53[\s\S]*#gene-comments[\s\S]*Reader/)
    assert.equal(Array.from(requests[1].body.content).length, 2000)
    assert.doesNotMatch(requests[1].body.content, /\uFFFD/)
    assert.deepEqual(requests[1].body.allowed_mentions, { parse: [] })
    const delivered = primary.raw
      .prepare(
        "SELECT discord_status, discord_channel_id, discord_message_id FROM icono_caretaker_comment_notifications",
      )
      .get()
    assert.equal(delivered.discord_status, "sent")
    assert.equal(delivered.discord_channel_id, "dm-channel")
    assert.equal(delivered.discord_message_id, "dm-message")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("delivery revalidates tenure and suppresses a DM after caretaker departure", async (t) => {
  const { primary, env } = setup(t)
  await caretakerCommentOutboxStatement(primary, {
    notification_key: "caretaker_comment_notification_0002",
    caretaker_assignment_id: ASSIGNMENT,
    caretaker_account_id: ACCOUNT,
    caretaker_discord_user_id: "123456789",
    gene_symbol: "TP53",
    comment_author_account_id: AUTHOR,
    comment_author_name: "Reader",
    comment_body: "A late comment.",
  }).run()
  primary.raw
    .prepare(
      "UPDATE icono_caretaker_assignment_notifications SET assignment_status = 'ended', assignment_version = 2, authority_event_sequence = 2",
    )
    .run()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error("Discord must not be called")
  }
  try {
    const result = await deliverPendingCaretakerCommentNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(result.delivered, 0)
    assert.equal(
      primary.raw.prepare("SELECT discord_status FROM icono_caretaker_comment_notifications").get()
        .discord_status,
      "suppressed",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("a positive preferred canonical loss enqueues and delivers one deduplicated bot DM", async (t) => {
  const { primary, env } = setup(t)
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (42, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  assert.equal(
    primary.raw
      .prepare("SELECT COUNT(*) AS count FROM icono_caretaker_supervote_notifications")
      .get().count,
    1,
  )

  const originalFetch = globalThis.fetch
  const messages = []
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/users/@me/channels")) {
      return new Response(JSON.stringify({ id: "supervote-dm" }), { status: 200 })
    }
    messages.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ id: "supervote-message" }), { status: 200 })
  }
  try {
    const delivered = await deliverPendingCaretakerSupervoteNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(delivered.delivered, 1)
    assert.equal(messages.length, 1)
    assert.match(messages[0].content, /10x preferred blot for \*\*TP53\*\* is no longer canonical/)
    assert.deepEqual(messages[0].allowed_mentions, { parse: [] })
    assert.equal(
      primary.raw
        .prepare("SELECT discord_status FROM icono_caretaker_supervote_notifications")
        .get().discord_status,
      "sent",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("negative, transferred, or ended supervotes cannot send a stale canonical-loss DM", async (t) => {
  const { primary, env } = setup(t)
  primary.raw.prepare("UPDATE icono_caretaker_supervote_projection SET direction = -1").run()
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (43, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  assert.equal(
    primary.raw
      .prepare("SELECT COUNT(*) AS count FROM icono_caretaker_supervote_notifications")
      .get().count,
    0,
  )

  primary.raw.prepare("UPDATE icono_caretaker_supervote_projection SET direction = 1").run()
  primary.raw
    .prepare(
      `INSERT INTO icono_publish_events (
         id, gene_symbol, from_asset_sha256, to_asset_sha256, action
       ) VALUES (44, 'TP53', ?, ?, 'publish')`,
    )
    .run("a".repeat(64), "b".repeat(64))
  primary.raw
    .prepare(
      `UPDATE icono_caretaker_supervote_projection
          SET asset_sha256 = '${"c".repeat(64)}', supervote_version = 4`,
    )
    .run()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error("Discord must not be called for a stale preference")
  }
  try {
    const result = await deliverPendingCaretakerSupervoteNotifications({
      ...env,
      DISCORD_BOT_TOKEN: "test-token",
    })
    assert.equal(result.delivered, 0)
    assert.equal(
      primary.raw
        .prepare("SELECT discord_status FROM icono_caretaker_supervote_notifications")
        .get().discord_status,
      "suppressed",
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
