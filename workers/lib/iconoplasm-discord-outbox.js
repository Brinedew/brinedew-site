export const DISCORD_API_BASE = "https://discord.com/api/v10"

export const DISCORD_OUTBOX_TABLES = Object.freeze({
  REQUEST_FULFILLMENT: "icono_request_notifications",
  CARETAKER_COMMENT: "icono_caretaker_comment_notifications",
  CARETAKER_SUPERVOTE: "icono_caretaker_supervote_notifications",
  CARETAKER_GENE_REQUEST: "icono_caretaker_gene_request_notifications",
})

// Unified 7-state outbox vocabulary across every Discord DM notification table.
export const DISCORD_OUTBOX_STATUSES = Object.freeze([
  "pending",
  "sending",
  "retry",
  "sent",
  "failed",
  "unknown",
  "suppressed",
])

export const DISCORD_OUTBOX_DELIVERABLE_STATUSES = Object.freeze(["pending", "retry"])
export const DISCORD_OUTBOX_TERMINAL_STATUSES = Object.freeze(["sent", "unknown"])

// Explicit allowed state transitions. `sent` and `unknown` never transition again.
// `failed` may move back to `retry` only when an explicit resend re-queues it
// (such as B-962's workstation completion resend on `icono_request_notifications`).
export const DISCORD_OUTBOX_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["sending", "suppressed"]),
  retry: Object.freeze(["sending", "suppressed"]),
  suppressed: Object.freeze(["sending"]),
  sending: Object.freeze(["sent", "retry", "failed", "unknown", "suppressed"]),
  failed: Object.freeze(["retry"]),
  sent: Object.freeze([]),
  unknown: Object.freeze([]),
})

const DISCORD_OUTBOX_TABLE_SPECS = Object.freeze({
  [DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT]: Object.freeze({
    table: DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT,
    keyColumn: "id",
    sentAtColumn: "discord_sent_at",
    hasUpdatedAt: false,
    suppressedStorageStatus: "suppressed_not_test_recipient",
    retryBaseSeconds: 15 * 60,
    retryMaxSeconds: 24 * 60 * 60,
    retryMaxExponent: 20,
  }),
  [DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT]: Object.freeze({
    table: DISCORD_OUTBOX_TABLES.CARETAKER_COMMENT,
    keyColumn: "notification_key",
    sentAtColumn: "sent_at",
    hasUpdatedAt: true,
    suppressedStorageStatus: "suppressed",
    retryBaseSeconds: 30,
    retryMaxSeconds: 6 * 60 * 60,
    retryMaxExponent: 9,
  }),
  [DISCORD_OUTBOX_TABLES.CARETAKER_SUPERVOTE]: Object.freeze({
    table: DISCORD_OUTBOX_TABLES.CARETAKER_SUPERVOTE,
    keyColumn: "notification_key",
    sentAtColumn: "sent_at",
    hasUpdatedAt: true,
    suppressedStorageStatus: "suppressed",
    retryBaseSeconds: 30,
    retryMaxSeconds: 6 * 60 * 60,
    retryMaxExponent: 9,
  }),
  [DISCORD_OUTBOX_TABLES.CARETAKER_GENE_REQUEST]: Object.freeze({
    table: DISCORD_OUTBOX_TABLES.CARETAKER_GENE_REQUEST,
    keyColumn: "notification_key",
    sentAtColumn: "sent_at",
    hasUpdatedAt: true,
    suppressedStorageStatus: "suppressed",
    retryBaseSeconds: 30,
    retryMaxSeconds: 6 * 60 * 60,
    retryMaxExponent: 9,
  }),
})

export function assertDiscordOutboxTable(table) {
  const name = String(table || "").trim()
  if (!Object.prototype.hasOwnProperty.call(DISCORD_OUTBOX_TABLE_SPECS, name)) {
    throw new TypeError(`Unknown Discord outbox table: ${table}`)
  }
  return DISCORD_OUTBOX_TABLE_SPECS[name]
}

export function normalizeDiscordOutboxStatus(status) {
  const raw = String(status || "")
    .trim()
    .toLowerCase()
  const canonical = raw === "suppressed_not_test_recipient" ? "suppressed" : raw
  if (!DISCORD_OUTBOX_STATUSES.includes(canonical)) {
    throw new TypeError(`Unknown Discord outbox status: ${status}`)
  }
  return canonical
}

export function toDiscordOutboxStorageStatus(table, status) {
  const spec = assertDiscordOutboxTable(table)
  const canonical = normalizeDiscordOutboxStatus(status)
  return canonical === "suppressed" ? spec.suppressedStorageStatus : canonical
}

export function deliverableDiscordOutboxStorageStatuses(table, { includeSuppressed = false } = {}) {
  const statuses = includeSuppressed
    ? [...DISCORD_OUTBOX_DELIVERABLE_STATUSES, "suppressed"]
    : [...DISCORD_OUTBOX_DELIVERABLE_STATUSES]
  return Object.freeze(statuses.map((status) => toDiscordOutboxStorageStatus(table, status)))
}

export function openDiscordOutboxStorageStatuses(table) {
  return Object.freeze(
    ["pending", "sending", "retry", "unknown", "suppressed"].map((status) =>
      toDiscordOutboxStorageStatus(table, status),
    ),
  )
}

export function canTransitionDiscordOutboxStatus(fromStatus, toStatus) {
  const from = normalizeDiscordOutboxStatus(fromStatus)
  const to = normalizeDiscordOutboxStatus(toStatus)
  return DISCORD_OUTBOX_TRANSITIONS[from].includes(to)
}

export function assertDiscordOutboxTransition(fromStatus, toStatus) {
  const from = normalizeDiscordOutboxStatus(fromStatus)
  const to = normalizeDiscordOutboxStatus(toStatus)
  if (!DISCORD_OUTBOX_TRANSITIONS[from].includes(to)) {
    throw new Error(`Illegal Discord outbox status transition: ${from} -> ${to}`)
  }
  return to
}

export function allowedSourceDiscordOutboxStorageStatuses(table, targetStatus) {
  const target = normalizeDiscordOutboxStatus(targetStatus)
  const sources = []
  for (const from of DISCORD_OUTBOX_STATUSES) {
    if (DISCORD_OUTBOX_TRANSITIONS[from].includes(target)) {
      sources.push(toDiscordOutboxStorageStatus(table, from))
    }
  }
  return Object.freeze(sources)
}

export function nextDiscordOutboxRetryAt(
  attemptCount,
  {
    table = null,
    baseSeconds = null,
    maxSeconds = null,
    maxExponent = null,
    nowMs = Date.now(),
  } = {},
) {
  const spec = table ? assertDiscordOutboxTable(table) : null
  const base = Number.isFinite(baseSeconds) ? baseSeconds : (spec?.retryBaseSeconds ?? 30)
  const cap = Number.isFinite(maxSeconds) ? maxSeconds : (spec?.retryMaxSeconds ?? 6 * 60 * 60)
  const expCap = Number.isFinite(maxExponent) ? maxExponent : (spec?.retryMaxExponent ?? 9)
  const attempt = Math.max(1, Number.parseInt(String(attemptCount || "1"), 10) || 1)
  const seconds = Math.min(cap, base * 2 ** Math.min(expCap, Math.max(0, attempt - 1)))
  return new Date(nowMs + seconds * 1000).toISOString().slice(0, 19).replace("T", " ")
}

function boundedText(value, limit = 2000) {
  return String(value || "")
    .trim()
    .slice(0, limit)
}

// The existing (discord_status, discord_next_attempt_at, created_at) indexes
// protect each range so selectors sort only bounded candidates rather than
// scanning the entire backlog.
export function dueCaretakerOutboxNotificationsStatement(db, table, limit) {
  const spec = assertDiscordOutboxTable(table)
  if (spec.table === DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT) {
    throw new TypeError(`${table} uses grouped delivery selection`)
  }
  const ranges = [
    "discord_next_attempt_at IS NULL",
    "discord_next_attempt_at < date('now')",
    "discord_next_attempt_at >= date('now') || ' ' AND discord_next_attempt_at <= CURRENT_TIMESTAMP",
    "discord_next_attempt_at >= date('now') || 'T' AND discord_next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
  ]
  const candidates = DISCORD_OUTBOX_DELIVERABLE_STATUSES.flatMap((status) =>
    ranges.map(
      (range) =>
        `SELECT * FROM ${spec.table} WHERE discord_status = '${status}' AND ${range}
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

// Records one claimed delivery outcome on any caretaker outbox table and refuses
// illegal transitions at both the application and SQL layers.
export async function finishCaretakerOutboxDelivery(db, table, key, status, fields = {}) {
  const spec = assertDiscordOutboxTable(table)
  if (spec.table === DISCORD_OUTBOX_TABLES.REQUEST_FULFILLMENT) {
    throw new TypeError(`${table} uses grouped delivery updates`)
  }
  const target = assertDiscordOutboxTransition("sending", status)
  const storageStatus = toDiscordOutboxStorageStatus(spec.table, target)
  const result = await db
    .prepare(
      `UPDATE ${spec.table}
          SET discord_status = ?, discord_channel_id = ?, discord_message_id = ?,
              discord_error = ?, discord_next_attempt_at = ?, updated_at = CURRENT_TIMESTAMP,
              sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
        WHERE notification_key = ?
          AND discord_status = 'sending'`,
    )
    .bind(
      storageStatus,
      boundedText(fields.channelId, 64) || null,
      boundedText(fields.messageId, 64) || null,
      boundedText(fields.error, 500),
      fields.nextAttemptAt || null,
      storageStatus,
      key,
    )
    .run()
  return Number(result?.meta?.changes || 0)
}

export function classifyDiscordHttpFailure(httpStatus, { serverErrorStatus = "retry" } = {}) {
  if (httpStatus === 429) return "retry"
  if (httpStatus >= 500) return normalizeDiscordOutboxStatus(serverErrorStatus)
  return "failed"
}

export async function sendDiscordOutboxDirectMessage({
  token,
  recipientId,
  buildMessageRequest,
  serverErrorStatus = "retry",
  missingChannelStatus = "failed",
  missingChannelError = "discord_dm_channel_missing",
  formatHttpError = (response, bodyText) =>
    `discord_${response.status}:${boundedText(bodyText, 300)}`,
  formatChannelNetworkError = (error) => boundedText(error?.message || "network_error", 300),
  classifyMessageNetworkError = () => "retry",
  formatMessageNetworkError = (error) =>
    boundedText(error?.message || "ambiguous_message_post", 300),
} = {}) {
  let channelResponse
  try {
    channelResponse = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: recipientId }),
    })
  } catch (error) {
    return {
      status: "retry",
      channelId: "",
      messageId: "",
      error: formatChannelNetworkError(error),
    }
  }
  const channelBody = await channelResponse.text().catch(() => "")
  let channel = null
  try {
    channel = channelBody ? JSON.parse(channelBody) : null
  } catch {
    channel = null
  }
  const channelId = boundedText(channel?.id, 255)
  if (!channelResponse.ok || !channelId) {
    if (!channelResponse.ok) {
      return {
        status: classifyDiscordHttpFailure(channelResponse.status, { serverErrorStatus: "retry" }),
        channelId: "",
        messageId: "",
        error: formatHttpError(channelResponse, channelBody, channel, "channel"),
      }
    }
    return {
      status: normalizeDiscordOutboxStatus(missingChannelStatus),
      channelId: "",
      messageId: "",
      error: missingChannelError,
    }
  }

  let messageResponse
  try {
    const requestInit = buildMessageRequest(channelId)
    messageResponse = await fetch(
      `${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages`,
      requestInit,
    )
  } catch (error) {
    return {
      status: normalizeDiscordOutboxStatus(classifyMessageNetworkError(error)),
      channelId,
      messageId: "",
      error: formatMessageNetworkError(error),
    }
  }
  const messageBody = await messageResponse.text().catch(() => "")
  let message = null
  try {
    message = messageBody ? JSON.parse(messageBody) : null
  } catch {
    message = null
  }
  if (!messageResponse.ok) {
    return {
      status: classifyDiscordHttpFailure(messageResponse.status, { serverErrorStatus }),
      channelId,
      messageId: "",
      error: formatHttpError(messageResponse, messageBody, message, "message"),
    }
  }
  return {
    status: "sent",
    channelId,
    messageId: boundedText(message?.id, 255),
    error: "",
  }
}
