import { discordSwitchIsOn } from "./discord-integration-switches.js"

const DELIVERY_STATUSES = Object.freeze(["pending", "retry"])
// One selector plus two/three D1 queries per successful message. Each delivery
// also uses two Discord requests. The scheduler gives these separate invocations.
// While the admin panel's "Caretaker messages" switch is off, messages wait in
// their outbox and go out once it is back on.
export const CARETAKER_COMMENT_DELIVERY_LIMIT = 20
export const CARETAKER_SUPERVOTE_DELIVERY_LIMIT = 16
export const CARETAKER_GENE_REQUEST_DELIVERY_LIMIT = 16

function bounded(value, limit = 2000) {
  return String(value || "")
    .trim()
    .slice(0, limit)
}

function boundedCodePoints(value, limit = 2000) {
  return Array.from(String(value || ""))
    .slice(0, limit)
    .join("")
}

function retryAt(attempt) {
  const seconds = Math.min(6 * 60 * 60, 30 * 2 ** Math.min(9, Math.max(0, attempt - 1)))
  return new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19).replace("T", " ")
}

// The existing (status, next_attempt_at, created_at) indexes protect each range.
// Sort only bounded candidates, never the whole pending backlog. Keep the legacy
// ISO timestamps readable without applying a function to the indexed column.
function dueNotificationsStatement(db, table, limit) {
  const ranges = [
    "discord_next_attempt_at IS NULL",
    "discord_next_attempt_at < date('now')",
    "discord_next_attempt_at >= date('now') || ' ' AND discord_next_attempt_at <= CURRENT_TIMESTAMP",
    "discord_next_attempt_at >= date('now') || 'T' AND discord_next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  ]
  const candidates = DELIVERY_STATUSES.flatMap((status) =>
    ranges.map(
      (range) =>
        `SELECT * FROM ${table} WHERE discord_status = '${status}' AND ${range}
       ORDER BY discord_next_attempt_at, created_at LIMIT ?1`,
    ),
  )
  return db
    .prepare(
      `WITH ${candidates.map((sql, index) => `due_${index} AS MATERIALIZED (${sql})`).join(",\n")},
    pending AS MATERIALIZED (SELECT * FROM due_0 UNION ALL SELECT * FROM due_1 UNION ALL SELECT * FROM due_2 UNION ALL SELECT * FROM due_3),
    retries AS MATERIALIZED (SELECT * FROM due_4 UNION ALL SELECT * FROM due_5 UNION ALL SELECT * FROM due_6 UNION ALL SELECT * FROM due_7)
    SELECT * FROM (SELECT * FROM pending UNION ALL SELECT * FROM retries)
    ORDER BY COALESCE(datetime(discord_next_attempt_at), created_at), notification_key LIMIT ?1`,
    )
    .bind(limit)
}

export async function resolveCaretakerCommentRecipient(env, { symbol, authorAccountId }) {
  const gene = bounded(symbol, 64).toUpperCase()
  const author = bounded(authorAccountId, 192)
  if (!gene || !author || !env?.ICONOPLASM_DB?.prepare || !env?.DB?.prepare) return null
  const assignment = await env.ICONOPLASM_DB.prepare(
    `SELECT caretaker_assignment_id, account_id, status
       FROM icono_caretaker_assignments
      WHERE gene_symbol = ? AND status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
  )
    .bind(gene)
    .first()
  if (assignment?.status !== "active" || assignment.account_id === author) return null
  const identity = await env.DB.prepare(
    `SELECT provider_subject
       FROM brinedew_account_identities
      WHERE account_id = ? AND provider = 'discord' AND unlinked_at IS NULL
      ORDER BY link_version DESC LIMIT 1`,
  )
    .bind(assignment.account_id)
    .first()
  const discordUserId = bounded(identity?.provider_subject, 64)
  if (!discordUserId) return null
  return Object.freeze({
    caretaker_assignment_id: assignment.caretaker_assignment_id,
    caretaker_account_id: assignment.account_id,
    caretaker_discord_user_id: discordUserId,
  })
}

export function caretakerCommentOutboxStatement(db, notification) {
  if (!notification || !db?.prepare) return null
  return db
    .prepare(
      `INSERT INTO icono_caretaker_comment_notifications (
         notification_key, caretaker_assignment_id, caretaker_account_id,
         caretaker_discord_user_id, gene_symbol, comment_author_account_id,
         comment_author_name, comment_body
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      notification.notification_key,
      notification.caretaker_assignment_id,
      notification.caretaker_account_id,
      notification.caretaker_discord_user_id,
      notification.gene_symbol,
      notification.comment_author_account_id,
      notification.comment_author_name,
      notification.comment_body,
    )
}

// Records one delivery attempt on any of the caretaker outboxes; they share
// their delivery columns.
async function finishDelivery(db, table, key, status, fields = {}) {
  await db
    .prepare(
      `UPDATE ${table}
          SET discord_status = ?, discord_channel_id = ?, discord_message_id = ?,
              discord_error = ?, discord_next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP,
              sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
        WHERE notification_key = ?`,
    )
    .bind(
      status,
      bounded(fields.channelId, 64) || null,
      bounded(fields.messageId, 64) || null,
      bounded(fields.error, 500),
      fields.nextAttemptAt || null,
      status,
      key,
    )
    .run()
}

function deliveryError(response, body) {
  return `discord_${response.status}:${bounded(body, 300)}`
}

// Opens the bot's DM channel with one person and posts one message. Answers
// "sent", "retry" (worth trying again later), "failed", or "unknown" when the
// message POST may have reached Discord: retrying that could send it twice.
async function sendDiscordDirectMessage(token, recipientId, content) {
  let channelResponse
  try {
    channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: recipientId }),
    })
  } catch (error) {
    return { status: "retry", error: bounded(error?.message || "network_error", 300) }
  }
  const channelBody = await channelResponse.text()
  if (!channelResponse.ok) {
    const retryable = channelResponse.status === 429 || channelResponse.status >= 500
    return {
      status: retryable ? "retry" : "failed",
      error: deliveryError(channelResponse, channelBody),
    }
  }
  let channel
  try {
    channel = JSON.parse(channelBody)
  } catch {
    channel = null
  }
  if (!channel?.id) return { status: "failed", error: "discord_dm_channel_missing" }
  let messageResponse
  try {
    messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: boundedCodePoints(content, 2000),
        allowed_mentions: { parse: [] },
      }),
    })
  } catch (error) {
    return {
      status: "unknown",
      channelId: channel.id,
      error: bounded(error?.message || "ambiguous_message_post", 300),
    }
  }
  const messageBody = await messageResponse.text()
  if (!messageResponse.ok) {
    const retryable = messageResponse.status === 429 || messageResponse.status >= 500
    return {
      status: retryable ? "retry" : "failed",
      channelId: channel.id,
      error: deliveryError(messageResponse, messageBody),
    }
  }
  let message
  try {
    message = JSON.parse(messageBody)
  } catch {
    message = null
  }
  return { status: "sent", channelId: channel.id, messageId: message?.id || "" }
}

// Sends one claimed outbox row and records the outcome. Returns 1 when sent.
async function deliverClaimedRow(db, table, token, row, recipientId, content) {
  const outcome = await sendDiscordDirectMessage(token, recipientId, content)
  await finishDelivery(db, table, row.notification_key, outcome.status, {
    ...outcome,
    nextAttemptAt:
      outcome.status === "retry" ? retryAt(Number(row.discord_attempt_count || 0) + 1) : null,
  })
  return outcome.status === "sent" ? 1 : 0
}

// The recipient's linked Discord id, read when the message is sent.
async function discordIdOfAccount(accounts, accountId) {
  const identity = await accounts
    .prepare(
      `SELECT provider_subject
         FROM brinedew_account_identities
        WHERE account_id = ? AND provider = 'discord' AND unlinked_at IS NULL
        ORDER BY link_version DESC LIMIT 1`,
    )
    .bind(accountId)
    .first()
  return bounded(identity?.provider_subject, 64)
}

export async function deliverPendingCaretakerCommentNotifications(env, { limit = 20 } = {}) {
  if (!(await discordSwitchIsOn(env, "caretaker_dms"))) {
    return { ok: true, delivered: 0, skipped: "switched_off" }
  }
  const db = env?.ICONOPLASM_DB
  const token = bounded(env?.DISCORD_BOT_TOKEN, 512)
  if (!db?.prepare || !token) return { ok: false, delivered: 0, skipped: "unavailable" }
  const safeLimit = Math.max(
    1,
    Math.min(
      CARETAKER_COMMENT_DELIVERY_LIMIT,
      Math.trunc(Number(limit) || CARETAKER_COMMENT_DELIVERY_LIMIT),
    ),
  )
  const due = await dueNotificationsStatement(
    db,
    "icono_caretaker_comment_notifications",
    safeLimit,
  ).all()
  let delivered = 0
  for (const row of due?.results || []) {
    const claim = await db
      .prepare(
        `WITH eligible AS MATERIALIZED (
           SELECT 1 FROM icono_caretaker_assignments
            WHERE caretaker_assignment_id = ? AND account_id = ? AND status = 'active'
         )
         UPDATE icono_caretaker_comment_notifications
            SET discord_status = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN 'sending' ELSE 'suppressed' END,
                discord_attempt_count = discord_attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP,
                discord_error = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN '' ELSE 'assignment_not_active' END
          WHERE notification_key = ? AND discord_status IN ('pending', 'retry')
            AND discord_attempt_count = ?
          RETURNING discord_status`,
      )
      .bind(
        row.caretaker_assignment_id,
        row.caretaker_account_id,
        row.notification_key,
        row.discord_attempt_count,
      )
      .first()
    if (claim?.discord_status !== "sending") continue
    const geneUrl = `https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(row.gene_symbol)}#gene-comments`
    delivered += await deliverClaimedRow(
      db,
      "icono_caretaker_comment_notifications",
      token,
      row,
      row.caretaker_discord_user_id,
      `New comment on **${row.gene_symbol}**
${geneUrl}

**${row.comment_author_name}:** ${row.comment_body}`,
    )
  }
  return { ok: true, delivered }
}

export async function deliverPendingCaretakerSupervoteNotifications(
  env,
  { limit = CARETAKER_SUPERVOTE_DELIVERY_LIMIT } = {},
) {
  if (!(await discordSwitchIsOn(env, "caretaker_dms"))) {
    return { ok: true, delivered: 0, skipped: "switched_off" }
  }
  const db = env?.ICONOPLASM_DB
  const accounts = env?.DB
  const token = bounded(env?.DISCORD_BOT_TOKEN, 512)
  if (!db?.prepare || !accounts?.prepare || !token) {
    return { ok: false, delivered: 0, skipped: "unavailable" }
  }
  const safeLimit = Math.max(
    1,
    Math.min(
      CARETAKER_SUPERVOTE_DELIVERY_LIMIT,
      Math.trunc(Number(limit) || CARETAKER_SUPERVOTE_DELIVERY_LIMIT),
    ),
  )
  const due = await dueNotificationsStatement(
    db,
    "icono_caretaker_supervote_notifications",
    safeLimit,
  ).all()
  let delivered = 0
  for (const row of due?.results || []) {
    const claim = await db
      .prepare(
        `WITH eligible AS MATERIALIZED (
         SELECT 1
           FROM icono_caretaker_assignments role
          WHERE role.caretaker_assignment_id = ?
            AND role.account_id = ?
            AND role.gene_symbol = ?
            AND role.status IN ('active', 'suspended')
            AND role.supervote_direction = 1
            AND role.supervote_asset_sha256 = ?
            AND role.supervote_version = ?
            AND EXISTS (
              SELECT 1 FROM icono_publish_state publish
               WHERE publish.gene_symbol = role.gene_symbol
                 AND publish.current_asset_sha256 IS NOT role.supervote_asset_sha256
            )
         )
         UPDATE icono_caretaker_supervote_notifications
            SET discord_status = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN 'sending' ELSE 'suppressed' END,
                discord_attempt_count = discord_attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP,
                discord_error = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN '' ELSE 'preference_no_longer_current' END
          WHERE notification_key = ? AND discord_status IN ('pending', 'retry')
            AND discord_attempt_count = ?
          RETURNING discord_status`,
      )
      .bind(
        row.caretaker_assignment_id,
        row.caretaker_account_id,
        row.gene_symbol,
        row.preferred_asset_sha256,
        Number(row.supervote_version),
        row.notification_key,
        row.discord_attempt_count,
      )
      .first()
    if (claim?.discord_status !== "sending") continue
    let discordUserId
    try {
      discordUserId = await discordIdOfAccount(accounts, row.caretaker_account_id)
    } catch (error) {
      await finishDelivery(
        db,
        "icono_caretaker_supervote_notifications",
        row.notification_key,
        "retry",
        {
          error: bounded(error?.message || "account_identity_read_failed", 300),
          nextAttemptAt: retryAt(Number(row.discord_attempt_count || 0) + 1),
        },
      )
      continue
    }
    if (!discordUserId) {
      await finishDelivery(
        db,
        "icono_caretaker_supervote_notifications",
        row.notification_key,
        "suppressed",
        {
          error: "discord_identity_missing",
        },
      )
      continue
    }
    const geneUrl = `https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(row.gene_symbol)}`
    delivered += await deliverClaimedRow(
      db,
      "icono_caretaker_supervote_notifications",
      token,
      row,
      discordUserId,
      `Your 10x preferred portrait for **${row.gene_symbol}** is no longer current.
${geneUrl}`,
    )
  }
  return { ok: true, delivered }
}

// B-1137: the messages a gene request sends (caretaker-gene-requests.js). Each is
// checked again when it is sent, and suppressed once it no longer holds: a
// "requested" message whose request was answered or already seen on the gene
// page, a "freed" message for a gene somebody has taken again.
const GENE_REQUEST_MESSAGES = Object.freeze({
  requested: (symbol) => `New request for **${symbol}**`,
  accepted: (symbol) => `Your request for **${symbol}** was accepted.`,
  rejected: (symbol) => `Your request for **${symbol}** was rejected.`,
  freed: (symbol) => `**${symbol}** has no caretaker now, so you can claim it.`,
})

export async function deliverPendingCaretakerGeneRequestNotifications(
  env,
  { limit = CARETAKER_GENE_REQUEST_DELIVERY_LIMIT } = {},
) {
  if (!(await discordSwitchIsOn(env, "caretaker_dms"))) {
    return { ok: true, delivered: 0, skipped: "switched_off" }
  }
  const db = env?.ICONOPLASM_DB
  const accounts = env?.DB
  const token = bounded(env?.DISCORD_BOT_TOKEN, 512)
  if (!db?.prepare || !accounts?.prepare || !token) {
    return { ok: false, delivered: 0, skipped: "unavailable" }
  }
  const table = "icono_caretaker_gene_request_notifications"
  const safeLimit = Math.max(
    1,
    Math.min(
      CARETAKER_GENE_REQUEST_DELIVERY_LIMIT,
      Math.trunc(Number(limit) || CARETAKER_GENE_REQUEST_DELIVERY_LIMIT),
    ),
  )
  const due = await dueNotificationsStatement(db, table, safeLimit).all()
  let delivered = 0
  for (const row of due?.results || []) {
    const claim = await db
      .prepare(
        `WITH eligible AS MATERIALIZED (
           SELECT 1 FROM icono_caretaker_gene_requests request
            WHERE request.request_id = ?1
              AND CASE ?2
                WHEN 'requested' THEN request.status = 'pending' AND request.seen_at IS NULL
                                      AND request.holder_account_id = ?3
                WHEN 'accepted' THEN request.status = 'accepted' AND request.requester_account_id = ?3
                WHEN 'rejected' THEN request.status = 'rejected' AND request.requester_account_id = ?3
                WHEN 'freed' THEN request.status = 'void' AND request.requester_account_id = ?3
                  AND NOT EXISTS (SELECT 1 FROM icono_caretaker_assignments role
                                   WHERE role.gene_symbol = request.gene_symbol
                                     AND role.status IN ('pending_acceptance', 'active', 'suspended'))
                ELSE 0 END
         )
         UPDATE icono_caretaker_gene_request_notifications
            SET discord_status = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN 'sending' ELSE 'suppressed' END,
                discord_attempt_count = discord_attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP,
                discord_error = CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN '' ELSE 'request_no_longer_current' END
          WHERE notification_key = ?4 AND discord_status IN ('pending', 'retry')
            AND discord_attempt_count = ?5
          RETURNING discord_status`,
      )
      .bind(
        row.request_id,
        row.kind,
        row.recipient_account_id,
        row.notification_key,
        row.discord_attempt_count,
      )
      .first()
    if (claim?.discord_status !== "sending") continue
    let discordUserId
    try {
      discordUserId = await discordIdOfAccount(accounts, row.recipient_account_id)
    } catch (error) {
      await finishDelivery(db, table, row.notification_key, "retry", {
        error: bounded(error?.message || "account_identity_read_failed", 300),
        nextAttemptAt: retryAt(Number(row.discord_attempt_count || 0) + 1),
      })
      continue
    }
    if (!discordUserId) {
      await finishDelivery(db, table, row.notification_key, "suppressed", {
        error: "discord_identity_missing",
      })
      continue
    }
    const message = GENE_REQUEST_MESSAGES[row.kind]
    if (!message) {
      await finishDelivery(db, table, row.notification_key, "failed", { error: "unknown_kind" })
      continue
    }
    const geneUrl = `https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(row.gene_symbol)}`
    delivered += await deliverClaimedRow(
      db,
      table,
      token,
      row,
      discordUserId,
      `${message(row.gene_symbol)}
${geneUrl}`,
    )
  }
  return { ok: true, delivered }
}
