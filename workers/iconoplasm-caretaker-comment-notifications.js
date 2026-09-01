const DELIVERY_STATUSES = Object.freeze(["pending", "retry"])

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
  return new Date(Date.now() + seconds * 1000).toISOString()
}

export async function resolveCaretakerCommentRecipient(env, { symbol, authorAccountId }) {
  const gene = bounded(symbol, 64).toUpperCase()
  const author = bounded(authorAccountId, 192)
  if (!gene || !author || !env?.ICONOPLASM_DB?.prepare || !env?.DB?.prepare) return null
  const assignment = await env.ICONOPLASM_DB.prepare(
    `SELECT caretaker_assignment_id, account_id
       FROM icono_caretaker_assignment_notifications
      WHERE canonical_symbol = ? AND assignment_status = 'active'
      ORDER BY authority_event_sequence DESC LIMIT 1`,
  )
    .bind(gene)
    .first()
  if (!assignment || assignment.account_id === author) return null
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

async function finish(db, key, status, fields = {}) {
  await db
    .prepare(
      `UPDATE icono_caretaker_comment_notifications
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

export async function deliverPendingCaretakerCommentNotifications(env, { limit = 20 } = {}) {
  const db = env?.ICONOPLASM_DB
  const token = bounded(env?.DISCORD_BOT_TOKEN, 512)
  if (!db?.prepare || !token) return { ok: false, delivered: 0, skipped: "unavailable" }
  const safeLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)))
  const due = await db
    .prepare(
      `SELECT * FROM icono_caretaker_comment_notifications
        WHERE discord_status IN ('pending', 'retry')
          AND (discord_next_attempt_at IS NULL OR discord_next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY created_at, notification_key LIMIT ?`,
    )
    .bind(safeLimit)
    .all()
  let delivered = 0
  for (const row of due?.results || []) {
    const claim = await db
      .prepare(
        `UPDATE icono_caretaker_comment_notifications
            SET discord_status = 'sending', discord_attempt_count = discord_attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP, discord_error = ''
          WHERE notification_key = ? AND discord_status IN ('pending', 'retry')`,
      )
      .bind(row.notification_key)
      .run()
    if (Number(claim?.meta?.changes || 0) !== 1) continue
    const current = await db
      .prepare(
        `SELECT 1 AS active FROM icono_caretaker_assignment_notifications
          WHERE caretaker_assignment_id = ? AND account_id = ? AND assignment_status = 'active'`,
      )
      .bind(row.caretaker_assignment_id, row.caretaker_account_id)
      .first()
    if (!current) {
      await finish(db, row.notification_key, "suppressed", { error: "assignment_not_active" })
      continue
    }
    let channelResponse
    try {
      channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: row.caretaker_discord_user_id }),
      })
    } catch (error) {
      await finish(db, row.notification_key, "retry", {
        error: bounded(error?.message || "network_error", 300),
        nextAttemptAt: retryAt(Number(row.discord_attempt_count || 0) + 1),
      })
      continue
    }
    const channelBody = await channelResponse.text()
    if (!channelResponse.ok) {
      const retryable = channelResponse.status === 429 || channelResponse.status >= 500
      await finish(db, row.notification_key, retryable ? "retry" : "failed", {
        error: deliveryError(channelResponse, channelBody),
        nextAttemptAt: retryable ? retryAt(Number(row.discord_attempt_count || 0) + 1) : null,
      })
      continue
    }
    let channel
    try {
      channel = JSON.parse(channelBody)
    } catch {
      channel = null
    }
    if (!channel?.id) {
      await finish(db, row.notification_key, "failed", { error: "discord_dm_channel_missing" })
      continue
    }
    const geneUrl = `https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(row.gene_symbol)}#gene-comments`
    let messageResponse
    try {
      messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: boundedCodePoints(
            `New comment on **${row.gene_symbol}**\n${geneUrl}\n\n**${row.comment_author_name}:** ${row.comment_body}`,
            2000,
          ),
          allowed_mentions: { parse: [] },
        }),
      })
    } catch (error) {
      // The POST may have reached Discord. Retrying could duplicate a user-visible DM.
      await finish(db, row.notification_key, "unknown", {
        channelId: channel.id,
        error: bounded(error?.message || "ambiguous_message_post", 300),
      })
      continue
    }
    const messageBody = await messageResponse.text()
    if (!messageResponse.ok) {
      const retryable = messageResponse.status === 429 || messageResponse.status >= 500
      await finish(db, row.notification_key, retryable ? "retry" : "failed", {
        channelId: channel.id,
        error: deliveryError(messageResponse, messageBody),
        nextAttemptAt: retryable ? retryAt(Number(row.discord_attempt_count || 0) + 1) : null,
      })
      continue
    }
    let message
    try {
      message = JSON.parse(messageBody)
    } catch {
      message = null
    }
    await finish(db, row.notification_key, "sent", {
      channelId: channel.id,
      messageId: message?.id || "",
    })
    delivered += 1
  }
  return { ok: true, delivered }
}
