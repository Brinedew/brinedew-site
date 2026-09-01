import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  caretakerCommentOutboxStatement,
  deliverPendingCaretakerCommentNotifications,
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
    ${readFileSync(new URL("../migrations-iconoplasm/0086_caretaker_assignment_notifications.sql", import.meta.url), "utf8")}
    ${readFileSync(new URL("../migrations-iconoplasm/0090_caretaker_coordination.sql", import.meta.url), "utf8")}
    INSERT INTO icono_caretaker_assignment_notifications (
      caretaker_assignment_id, account_id, gene_id, canonical_symbol,
      assignment_status, assignment_version, notification_state,
      authority_event_id, authority_event_sequence, resolved_at
    ) VALUES (
      '${ASSIGNMENT}', '${ACCOUNT}', 'gene_caretaker_comment_0001', 'TP53',
      'active', 1, 'resolved', 'event_caretaker_comment_0001', 1, CURRENT_TIMESTAMP
    );
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
    comment_body: "The lysosome motif needs clarification.",
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
    const result = await deliverPendingCaretakerCommentNotifications(
      { ...env, DISCORD_BOT_TOKEN: "test-token" },
      { limit: 1 },
    )
    assert.equal(result.delivered, 1)
    assert.equal(requests.length, 2)
    assert.match(requests[1].body.content, /TP53[\s\S]*#gene-comments[\s\S]*Reader/)
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
