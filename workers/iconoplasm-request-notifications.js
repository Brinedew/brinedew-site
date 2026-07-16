// Durable request-fulfillment inbox and best-effort Discord delivery.
//
// The D1 trigger owns notification creation. This module owns only reads,
// acknowledgement, and delivery so the already-large Iconoplasm runtime does
// not absorb another state machine.

// B-640 rollout fence: only Vladimir's immutable Discord user ID may receive
// fulfillment DMs during the test period. Never replace this with a username.
export const ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID = "1289482311557058641"

const DISCORD_API_BASE = "https://discord.com/api/v10"
const DISCORD_MAX_ATTEMPTS = 4
// Discord's default per-file upload limit is 10 MiB. Portrait full renditions
// are capped far below that in normal operation, but reject oversized or bogus
// CDN responses before buffering them into a multipart request.
const DISCORD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

function boundedText(value, maxLength) {
  const text = String(value || "").trim()
  return text ? text.slice(0, maxLength) : ""
}

function positiveInteger(value) {
  return Math.max(0, Number.parseInt(String(value || "0"), 10) || 0)
}

function userId(value) {
  return boundedText(value, 255)
}

function geneSymbol(value) {
  const symbol = boundedText(value, 64).toUpperCase()
  return /^[A-Z0-9][A-Z0-9-]{0,63}$/.test(symbol) ? symbol : ""
}

function assetSha(value) {
  const sha = boundedText(value, 64).toLowerCase()
  return /^[a-f0-9]{64}$/.test(sha) ? sha : ""
}

function requestKind(value) {
  return boundedText(value, 64) === "edit_image" ? "edit_image" : "new_candidate"
}

function mapNotification(row, portraitUrlForAsset) {
  const id = positiveInteger(row?.id)
  const requestId = positiveInteger(row?.request_id)
  const symbol = geneSymbol(row?.gene_symbol)
  const sha = assetSha(row?.fulfilled_asset_sha256)
  const readAt = boundedText(row?.read_at, 64)
  return {
    id,
    notification_key: boundedText(row?.notification_key, 255),
    request_id: requestId,
    kind: "request_fulfilled",
    request_kind: requestKind(row?.request_kind),
    gene_symbol: symbol,
    requested_emulsion_label:
      boundedText(row?.requested_emulsion_label, 255) ||
      (row?.request_mode === "specific" ? "Specific emulsion" : "Random default"),
    fulfilled_asset_sha256: sha,
    fulfilled_vision_id: boundedText(row?.fulfilled_vision_id, 255),
    created_at: boundedText(row?.created_at, 64),
    read_at: readAt,
    unread: !readAt,
    gene_url: symbol ? `/gene/${encodeURIComponent(symbol)}` : "/",
    image_url: sha && portraitUrlForAsset ? portraitUrlForAsset(sha) : "",
    discord_status: boundedText(row?.discord_status, 64) || "pending",
  }
}

export async function readRequestNotificationInbox(
  env,
  { requesterUserId, limit = 25, openRequests = [], portraitUrlForAsset } = {},
) {
  if (!env?.ICONOPLASM_DB) {
    return { ok: false, status: 500, error: "ICONOPLASM_DB binding missing" }
  }
  const requesterId = userId(requesterUserId)
  if (!requesterId) return { ok: false, status: 401, error: "Authentication required" }
  const safeLimit = Math.max(1, Math.min(50, positiveInteger(limit) || 25))
  const [unreadRow, rowsResponse] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT COUNT(*) AS unread_count
       FROM icono_request_notifications
       WHERE requester_user_id = ?
         AND read_at IS NULL`,
    )
      .bind(requesterId)
      .first(),
    env.ICONOPLASM_DB.prepare(
      `SELECT n.*
       FROM icono_request_notifications n
       WHERE n.requester_user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`,
    )
      .bind(requesterId, safeLimit)
      .all(),
  ])
  const pending = Array.isArray(openRequests) ? openRequests : []
  return {
    ok: true,
    authenticated: true,
    unread_count: positiveInteger(unreadRow?.unread_count),
    open_count: pending.length,
    open_requests: pending.map((row) => {
      const symbol = geneSymbol(row?.gene_symbol)
      return {
        request_id: positiveInteger(row?.id),
        gene_symbol: symbol,
        requested_emulsion_label:
          boundedText(row?.requested_emulsion_label, 255) || "Random default",
        created_at: boundedText(row?.created_at, 64),
        gene_url: symbol ? `/gene/${encodeURIComponent(symbol)}` : "/",
      }
    }),
    notifications: (Array.isArray(rowsResponse?.results) ? rowsResponse.results : []).map((row) =>
      mapNotification(row, portraitUrlForAsset),
    ),
  }
}

export async function markRequestNotificationsRead(
  env,
  { requesterUserId, notificationIds = [], markAll = false } = {},
) {
  if (!env?.ICONOPLASM_DB) {
    return { ok: false, status: 500, error: "ICONOPLASM_DB binding missing" }
  }
  const requesterId = userId(requesterUserId)
  if (!requesterId) return { ok: false, status: 401, error: "Authentication required" }
  let response
  if (markAll) {
    response = await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_request_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE requester_user_id = ?
         AND read_at IS NULL`,
    )
      .bind(requesterId)
      .run()
  } else {
    const ids = Array.from(
      new Set(
        (Array.isArray(notificationIds) ? notificationIds : [])
          .map(positiveInteger)
          .filter(Boolean),
      ),
    ).slice(0, 50)
    if (!ids.length) return { ok: false, status: 400, error: "No notification IDs supplied" }
    const placeholders = ids.map(() => "?").join(",")
    response = await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_request_notifications
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE requester_user_id = ?
         AND id IN (${placeholders})`,
    )
      .bind(requesterId, ...ids)
      .run()
  }
  return { ok: true, marked_read: positiveInteger(response?.meta?.changes) }
}

function publicEmulsionIdFromFulfilledVisionId(value) {
  // Fulfillment notifications persist the resolved vision ID, not an emulsion
  // snapshot. Derive the same stable public code the site uses (for example,
  // anima-v1-4527 becomes A1-4527), and omit it rather than exposing an
  // internal ID when a future vision naming scheme is not yet understood.
  const match = boundedText(value, 255).match(/^([a-z0-9]+)-v(\d+)-(\d+)$/i)
  if (!match) return ""
  const [, workflow, promptVersion, variantSlot] = match
  const normalizedPromptVersion = String(Number.parseInt(promptVersion, 10) || "")
  const normalizedVariantSlot = String(Number.parseInt(variantSlot, 10) || "")
  if (!workflow || !normalizedPromptVersion || !normalizedVariantSlot) return ""
  return `${workflow.slice(0, 1).toUpperCase()}${normalizedPromptVersion}-${normalizedVariantSlot}`
}

function discordEmulsionLine(row) {
  if (row?.request_mode === "specific") {
    const selected = boundedText(row?.requested_emulsion_label, 255) || "Your selected emulsion"
    return `Emulsion: **${selected}**`
  }
  const resolved = publicEmulsionIdFromFulfilledVisionId(row?.fulfilled_vision_id)
  return resolved ? `Emulsion: **Random** (resolved to ${resolved})` : "Emulsion: **Random**"
}

function discordMessage(row) {
  const symbol = geneSymbol(row?.gene_symbol) || "your gene"
  const isEdit = requestKind(row?.request_kind) === "edit_image"
  return [
    isEdit ? "Your free queue edit request is ready." : "Your free queue request is ready.",
    `Gene: **${symbol}**`,
    discordEmulsionLine(row),
    `Review it here: <https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(symbol)}>`,
  ].join("\n")
}

function portraitCdnBase(env) {
  return boundedText(
    env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || env?.ICONOPLASM_PORTRAIT_BASE_URL || "",
    2000,
  ).replace(/\/+$/, "")
}

function fulfilledPortraitUrl(env, row) {
  const sha = assetSha(row?.fulfilled_asset_sha256)
  const base = portraitCdnBase(env)
  if (!sha || !base) return ""
  return `${base}/portraits/v1/${sha.slice(0, 2)}/${sha}/full.webp`
}

function fulfilledPortraitRequest(env, row) {
  const sha = assetSha(row?.fulfilled_asset_sha256)
  if (!sha) return null
  const key = `portraits/v1/${sha.slice(0, 2)}/${sha}/full.webp`
  const storageZone = boundedText(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE, 255)
  const storagePassword = boundedText(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD, 2000)
  if (storageZone && storagePassword) {
    const storageHost =
      boundedText(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST, 255) || "storage.bunnycdn.com"
    return {
      url: `https://${storageHost}/${encodeURIComponent(storageZone)}/${key}`,
      headers: { AccessKey: storagePassword, Accept: "image/webp" },
    }
  }
  const publicUrl = fulfilledPortraitUrl(env, row)
  return publicUrl ? { url: publicUrl, headers: { Accept: "image/webp" } } : null
}

function hasWebpSignature(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) return false
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
}

async function readBoundedResponseBytes(response, maxBytes) {
  const reader = response.body?.getReader()
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength <= maxBytes ? bytes : null
  }

  const chunks = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel("Discord attachment limit exceeded")
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function loadFulfilledPortraitAttachment(env, row) {
  const symbol = geneSymbol(row?.gene_symbol) || "gene"
  const sha = assetSha(row?.fulfilled_asset_sha256)
  const portraitRequest = fulfilledPortraitRequest(env, row)
  if (!sha || !portraitRequest) {
    return {
      ok: false,
      retryable: false,
      error: "Fulfilled portrait attachment is missing a valid asset SHA or CDN base URL.",
    }
  }

  let response
  try {
    response = await fetch(portraitRequest.url, { headers: portraitRequest.headers })
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      error: `Fulfilled portrait download failed: ${boundedText(error?.message || error || "unknown", 500)}`,
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      retryable: response.status === 429 || response.status >= 500,
      error: `Fulfilled portrait download failed (${response.status}).`,
    }
  }

  const contentType = boundedText(response.headers.get("Content-Type"), 255)
    .split(";", 1)[0]
    .toLowerCase()
  const declaredBytes = Number.parseInt(response.headers.get("Content-Length") || "0", 10) || 0
  if (contentType !== "image/webp" && contentType !== "application/octet-stream") {
    return {
      ok: false,
      retryable: false,
      error: `Fulfilled portrait has unexpected content type: ${contentType || "missing"}.`,
    }
  }
  if (declaredBytes > DISCORD_ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      retryable: false,
      error: `Fulfilled portrait exceeds Discord's ${DISCORD_ATTACHMENT_MAX_BYTES}-byte upload limit.`,
    }
  }

  let bytes
  try {
    bytes = await readBoundedResponseBytes(response, DISCORD_ATTACHMENT_MAX_BYTES)
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      error: `Fulfilled portrait download interrupted: ${boundedText(error?.message || error || "unknown", 500)}`,
    }
  }
  if (!bytes) {
    return {
      ok: false,
      retryable: false,
      error: `Fulfilled portrait exceeds Discord's ${DISCORD_ATTACHMENT_MAX_BYTES}-byte upload limit.`,
    }
  }
  if (!hasWebpSignature(bytes)) {
    return {
      ok: false,
      retryable: false,
      error: "Fulfilled portrait is not a valid WebP image.",
    }
  }
  const filename = `iconoplasm-${symbol.toLowerCase()}-${sha.slice(0, 12)}.webp`
  const requestLabel =
    requestKind(row?.request_kind) === "edit_image" ? "blot edit" : "candidate blot"
  return {
    ok: true,
    filename,
    description: `${symbol} ${requestLabel} from Iconoplasm's free generation queue`,
    blob: new Blob([bytes], { type: "image/webp" }),
  }
}

async function setDiscordState(env, notificationId, status, fields = {}) {
  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_request_notifications
     SET discord_status = ?,
         discord_sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE discord_sent_at END,
         discord_channel_id = ?,
         discord_message_id = ?,
         discord_error = ?
     WHERE id = ?`,
  )
    .bind(
      status,
      status,
      boundedText(fields.channelId, 255),
      boundedText(fields.messageId, 255),
      boundedText(fields.error, 1000),
      notificationId,
    )
    .run()
}

export async function deliverPendingRequestFulfillmentNotifications(
  env,
  { requestIds = [], limit = 20 } = {},
) {
  if (!env?.ICONOPLASM_DB) {
    return { ok: false, delivered: 0, error: "ICONOPLASM_DB binding missing" }
  }
  const safeLimit = Math.max(1, Math.min(50, positiveInteger(limit) || 20))
  const ids = Array.from(
    new Set((Array.isArray(requestIds) ? requestIds : []).map(positiveInteger).filter(Boolean)),
  ).slice(0, 50)
  const where = ["n.discord_status IN ('pending', 'retry')", "n.discord_attempt_count < ?"]
  const params = [DISCORD_MAX_ATTEMPTS]
  if (ids.length) {
    where.push(`n.request_id IN (${ids.map(() => "?").join(",")})`)
    params.push(...ids)
  }
  const rowsResponse = await env.ICONOPLASM_DB.prepare(
    `SELECT n.*
     FROM icono_request_notifications n
     WHERE ${where.join(" AND ")}
     ORDER BY n.created_at ASC, n.id ASC
     LIMIT ?`,
  )
    .bind(...params, safeLimit)
    .all()

  const result = { ok: true, considered: 0, delivered: 0, suppressed: 0, failed: 0, unknown: 0 }
  for (const row of Array.isArray(rowsResponse?.results) ? rowsResponse.results : []) {
    const notificationId = positiveInteger(row?.id)
    const requesterId = userId(row?.requester_user_id)
    if (!notificationId || !requesterId) continue
    result.considered += 1

    // This check must remain before token lookup or fetch. Non-test users have
    // no code path that can touch Discord during the rollout.
    if (requesterId !== ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID) {
      await setDiscordState(env, notificationId, "suppressed_not_test_recipient", {
        error: "Discord test delivery is restricted to the Brinedew account.",
      })
      result.suppressed += 1
      continue
    }

    const claim = await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_request_notifications
       SET discord_status = 'sending',
           discord_attempt_count = discord_attempt_count + 1,
           discord_last_attempt_at = CURRENT_TIMESTAMP,
           discord_error = ''
       WHERE id = ?
         AND discord_status IN ('pending', 'retry')`,
    )
      .bind(notificationId)
      .run()
    if (Number(claim?.meta?.changes || 0) !== 1) continue

    const botToken = String(env?.DISCORD_BOT_TOKEN || "").trim()
    if (!botToken) {
      await setDiscordState(env, notificationId, "retry", {
        error: "DISCORD_BOT_TOKEN is not configured.",
      })
      result.failed += 1
      continue
    }

    const attachment = await loadFulfilledPortraitAttachment(env, row)
    if (!attachment.ok) {
      await setDiscordState(env, notificationId, attachment.retryable ? "retry" : "failed", {
        error: attachment.error,
      })
      result.failed += 1
      continue
    }

    let channelId = ""
    try {
      const response = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
        method: "POST",
        headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: requesterId }),
      })
      const payload = await response.json().catch(() => ({}))
      channelId = boundedText(payload?.id, 255)
      if (!response.ok || !channelId) {
        await setDiscordState(env, notificationId, "retry", {
          error: `Discord DM channel failed (${response.status}): ${boundedText(payload?.message, 500)}`,
        })
        result.failed += 1
        continue
      }
    } catch (error) {
      // Opening a channel has no user-visible side effect, so retry is safe.
      await setDiscordState(env, notificationId, "retry", {
        error: `Discord DM channel network failure: ${boundedText(error?.message || error || "unknown", 500)}`,
      })
      result.failed += 1
      continue
    }

    try {
      const messagePayload = {
        content: discordMessage(row),
        nonce: `icono-fulfillment-${notificationId}`,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
        attachments: [
          {
            id: 0,
            filename: attachment.filename,
            description: attachment.description,
          },
        ],
      }
      const form = new FormData()
      form.append("payload_json", JSON.stringify(messagePayload))
      form.append("files[0]", attachment.blob, attachment.filename)
      const response = await fetch(
        `${DISCORD_API_BASE}/channels/${encodeURIComponent(channelId)}/messages`,
        {
          method: "POST",
          // Do not set Content-Type: fetch must add the multipart boundary.
          headers: { Authorization: `Bot ${botToken}` },
          body: form,
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const status =
          response.status === 429 ? "retry" : response.status >= 500 ? "unknown" : "failed"
        await setDiscordState(env, notificationId, status, {
          channelId,
          error: `Discord message failed (${response.status}): ${boundedText(payload?.message, 500)}`,
        })
        if (status === "unknown") result.unknown += 1
        else result.failed += 1
        continue
      }
      await setDiscordState(env, notificationId, "sent", {
        channelId,
        messageId: boundedText(payload?.id, 255),
      })
      result.delivered += 1
    } catch (error) {
      // A failed response read after POST is ambiguous. Do not retry and risk
      // a duplicate DM; the durable website inbox remains authoritative.
      await setDiscordState(env, notificationId, "unknown", {
        channelId,
        error: `Discord message delivery outcome unknown: ${boundedText(error?.message || error || "unknown", 500)}`,
      })
      result.unknown += 1
    }
  }
  return result
}
