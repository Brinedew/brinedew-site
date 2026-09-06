const DELIVERY_STATUSES = Object.freeze(["pending", "retry"])
// One selector plus two/three D1 queries per successful message. Each delivery
// also uses two Discord requests. The scheduler gives these separate invocations.
export const CARETAKER_COMMENT_DELIVERY_LIMIT = 20
export const CARETAKER_SUPERVOTE_DELIVERY_LIMIT = 16

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
           SELECT 1 FROM icono_caretaker_assignment_notifications
            WHERE caretaker_assignment_id = ? AND account_id = ? AND assignment_status = 'active'
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

async function finishSupervote(db, key, status, fields = {}) {
  await db
    .prepare(
      `UPDATE icono_caretaker_supervote_notifications
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

export async function deliverPendingCaretakerSupervoteNotifications(
  env,
  { limit = CARETAKER_SUPERVOTE_DELIVERY_LIMIT } = {},
) {
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
           FROM icono_caretaker_supervote_projection supervote
           JOIN icono_caretaker_assignment_notifications assignment
             ON assignment.caretaker_assignment_id = supervote.caretaker_assignment_id
            AND assignment.account_id = supervote.caretaker_account_id
          WHERE supervote.caretaker_assignment_id = ?
            AND supervote.caretaker_account_id = ?
            AND supervote.gene_symbol = ?
            AND supervote.active = 1 AND supervote.direction = 1
            AND supervote.asset_sha256 = ?
            AND supervote.supervote_version = ?
            AND assignment.assignment_status IN ('active', 'suspended')
            AND EXISTS (
              SELECT 1 FROM icono_publish_state publish
               WHERE publish.gene_symbol = supervote.gene_symbol
                 AND publish.current_asset_sha256 IS NOT supervote.asset_sha256
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
    let identity
    try {
      identity = await accounts
        .prepare(
          `SELECT provider_subject
             FROM brinedew_account_identities
            WHERE account_id = ? AND provider = 'discord' AND unlinked_at IS NULL
            ORDER BY link_version DESC LIMIT 1`,
        )
        .bind(row.caretaker_account_id)
        .first()
    } catch (error) {
      await finishSupervote(db, row.notification_key, "retry", {
        error: bounded(error?.message || "account_identity_read_failed", 300),
        nextAttemptAt: retryAt(Number(row.discord_attempt_count || 0) + 1),
      })
      continue
    }
    const discordUserId = bounded(identity?.provider_subject, 64)
    if (!discordUserId) {
      await finishSupervote(db, row.notification_key, "suppressed", {
        error: "discord_identity_missing",
      })
      continue
    }
    let channelResponse
    try {
      channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: discordUserId }),
      })
    } catch (error) {
      await finishSupervote(db, row.notification_key, "retry", {
        error: bounded(error?.message || "network_error", 300),
        nextAttemptAt: retryAt(Number(row.discord_attempt_count || 0) + 1),
      })
      continue
    }
    const channelBody = await channelResponse.text()
    if (!channelResponse.ok) {
      const retryable = channelResponse.status === 429 || channelResponse.status >= 500
      await finishSupervote(db, row.notification_key, retryable ? "retry" : "failed", {
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
      await finishSupervote(db, row.notification_key, "failed", {
        error: "discord_dm_channel_missing",
      })
      continue
    }
    const geneUrl = `https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(row.gene_symbol)}`
    let messageResponse
    try {
      messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: boundedCodePoints(
            `Your 10x preferred blot for **${row.gene_symbol}** is no longer canonical.\n${geneUrl}`,
            2000,
          ),
          allowed_mentions: { parse: [] },
        }),
      })
    } catch (error) {
      await finishSupervote(db, row.notification_key, "unknown", {
        channelId: channel.id,
        error: bounded(error?.message || "ambiguous_message_post", 300),
      })
      continue
    }
    const messageBody = await messageResponse.text()
    if (!messageResponse.ok) {
      const retryable = messageResponse.status === 429 || messageResponse.status >= 500
      await finishSupervote(db, row.notification_key, retryable ? "retry" : "failed", {
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
    await finishSupervote(db, row.notification_key, "sent", {
      channelId: channel.id,
      messageId: message?.id || "",
    })
    delivered += 1
  }
  return { ok: true, delivered }
}
