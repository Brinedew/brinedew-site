// Durable request-fulfillment inbox and confirmed Discord delivery.
//
// The D1 trigger owns notification creation. This module owns only reads,
// acknowledgement, and delivery so the already-large Iconoplasm runtime does
// not absorb another state machine.

// During the live acceptance period, only Vladimir's immutable Discord user ID
// may receive a DM. Production delivery is enabled only by the exact explicit
// mode below; a missing or misspelled value stays in this safe test mode.
export const ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID = "1289482311557058641"
const ICONOPLASM_FULFILLMENT_DM_ALL_REQUESTERS_MODE = "all_requesters"

const DISCORD_API_BASE = "https://discord.com/api/v10"
const DISCORD_RETRY_BASE_SECONDS = 15 * 60
const DISCORD_RETRY_MAX_SECONDS = 24 * 60 * 60
// ARCHITECTURE FENCE [IPD-006]: Discord accepts at most ten attachments on a
// message. A fulfillment DM is a batch receipt with a bounded preview mosaic,
// not a lossless transport for every generated portrait.
export const DISCORD_MAX_ATTACHMENTS_PER_MESSAGE = 10
// Discord's default per-file upload limit is 10 MiB. Reject oversized or bogus
// preview responses before buffering them into a multipart request.
const DISCORD_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
// Keep one Worker invocation well below its memory ceiling even if a malformed
// rendition is individually under Discord's per-file limit.
const DISCORD_ATTACHMENT_BATCH_MAX_BYTES = 24 * 1024 * 1024

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

function nextDiscordRetryAt(attemptCount) {
  const attempt = Math.max(1, positiveInteger(attemptCount) || 1)
  const seconds = Math.min(
    DISCORD_RETRY_MAX_SECONDS,
    DISCORD_RETRY_BASE_SECONDS * 2 ** Math.max(0, attempt - 1),
  )
  return new Date(Date.now() + seconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "")
}

export function resolveIconoplasmFulfillmentDeliveryPolicy(env) {
  const allRequesters =
    boundedText(env?.ICONOPLASM_FULFILLMENT_DM_DELIVERY_MODE, 64) ===
    ICONOPLASM_FULFILLMENT_DM_ALL_REQUESTERS_MODE
  return {
    mode: allRequesters ? ICONOPLASM_FULFILLMENT_DM_ALL_REQUESTERS_MODE : "brinedew_test",
    all_requesters: allRequesters,
    test_recipient_id: ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID,
  }
}

function allRequestersDiscordDeliveryEnabled(env) {
  return resolveIconoplasmFulfillmentDeliveryPolicy(env).all_requesters
}

function mapReadyNotification(row, portraitUrlForAsset) {
  const requestId = positiveInteger(row?.request_id)
  const notificationId = positiveInteger(row?.id)
  const symbol = geneSymbol(row?.gene_symbol)
  const sha = assetSha(row?.fulfilled_asset_sha256)
  const readAt = boundedText(row?.read_at, 64)
  return {
    id: requestId,
    request_id: requestId,
    notification_id: notificationId,
    kind: "request_fulfilled",
    request_kind: requestKind(row?.request_kind),
    gene_symbol: symbol,
    requested_emulsion_label:
      boundedText(row?.requested_emulsion_label, 255) ||
      (row?.request_mode === "specific" ? "Specific emulsion" : "Random default"),
    fulfilled_asset_sha256: sha,
    fulfilled_vision_id: boundedText(row?.fulfilled_vision_id, 255),
    candidate_image_id: positiveInteger(row?.candidate_image_id),
    asset_created_at: boundedText(row?.asset_created_at, 64),
    created_at: boundedText(row?.request_created_at, 64),
    fulfilled_at: boundedText(row?.created_at, 64),
    read_at: readAt,
    unread: !readAt,
    gene_url: symbol ? `/gene/${encodeURIComponent(symbol)}` : "/",
    image_url: sha && portraitUrlForAsset ? portraitUrlForAsset(sha) : "",
    discord_status: "sent",
  }
}

export async function readRequestNotificationInbox(
  env,
  {
    requesterUserId,
    limit = 50,
    openRequests = [],
    openCount = 0,
    cancelledCount = 0,
    portraitUrlForAsset,
  } = {},
) {
  if (!env?.ICONOPLASM_DB) {
    return { ok: false, status: 500, error: "ICONOPLASM_DB binding missing" }
  }
  const requesterId = userId(requesterUserId)
  if (!requesterId) return { ok: false, status: 401, error: "Authentication required" }
  const safeLimit = Math.max(1, Math.min(50, positiveInteger(limit) || 50))
  // A Ready card is a delivery receipt, not a dump of every row ever marked
  // fulfilled. Historical workstation runs coalesced multiple request IDs
  // onto one portrait, and manual acceptance tests reused old catalogue
  // assets. Neither is evidence that a requester received an independent
  // result. The durable notification is the current product boundary: it is
  // created for the exact request/asset pair and the request becomes fulfilled
  // only after Discord confirms delivery. Re-check the live request and asset
  // joins here so a stale or mismatched notification cannot render.
  const validDeliveryJoin = `
    FROM icono_request_notifications n
    JOIN icono_generation_requests gr
      ON gr.id = n.request_id
     AND gr.requester_user_id = n.requester_user_id
     AND gr.gene_symbol = n.gene_symbol
     AND gr.fulfilled_asset_sha256 = n.fulfilled_asset_sha256
     AND gr.status = 'fulfilled'
    JOIN icono_portrait_assets pa
      ON pa.gene_symbol = n.gene_symbol
     AND pa.asset_sha256 = n.fulfilled_asset_sha256`
  const [countRow, rowsResponse] = await Promise.all([
    env.ICONOPLASM_DB.prepare(
      `SELECT
         COUNT(*) AS ready_count,
         SUM(CASE WHEN n.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
       ${validDeliveryJoin}
       WHERE n.requester_user_id = ?
         AND n.discord_status = 'sent'`,
    )
      .bind(requesterId)
      .first(),
    env.ICONOPLASM_DB.prepare(
      `SELECT
         n.*,
         gr.created_at AS request_created_at,
         pa.created_at AS asset_created_at,
         pa.candidate_image_id
       ${validDeliveryJoin}
       WHERE n.requester_user_id = ?
         AND n.discord_status = 'sent'
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT ?`,
    )
      .bind(requesterId, safeLimit)
      .all(),
  ])
  const pending = Array.isArray(openRequests) ? openRequests : []
  const ready = Array.isArray(rowsResponse?.results) ? rowsResponse.results : []
  return {
    ok: true,
    authenticated: true,
    unread_count: positiveInteger(countRow?.unread_count),
    ready_count: Math.max(positiveInteger(countRow?.ready_count), ready.length),
    open_count: Math.max(positiveInteger(openCount), pending.length),
    cancelled_count: positiveInteger(cancelledCount),
    ready_requests: ready.map((row) => mapReadyNotification(row, portraitUrlForAsset)),
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
         AND discord_status = 'sent'
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
         AND discord_status = 'sent'
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

function discordMessage(rows, previewCount) {
  const group = Array.isArray(rows) ? rows : []
  const row = group[0] || {}
  const total = group.length
  const symbol = geneSymbol(row.gene_symbol) || "your gene"
  const isEdit = requestKind(row.request_kind) === "edit_image"
  if (total > 1) {
    const noun = isEdit ? "blot edits" : "candidate blots"
    return [
      `Your ${total} free queue ${noun} for **${symbol}** are ready.`,
      `Showing ${previewCount} of ${total} previews.`,
      `Review all ${total} here: <https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(symbol)}>`,
    ].join("\n")
  }
  return [
    isEdit ? "Your free queue edit request is ready." : "Your free queue request is ready.",
    `Gene: **${symbol}**`,
    discordEmulsionLine(row),
    `Review it here: <https://iconoplasm.brinedew.bio/gene/${encodeURIComponent(symbol)}>`,
  ].join("\n")
}

function portraitCdnBase(env) {
  return boundedText(env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || "", 2000).replace(/\/+$/, "")
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
  // Preserve the full rendition users received before batching. The ten-file,
  // per-file, and aggregate byte ceilings bound Worker memory independently.
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
    byte_length: bytes.byteLength,
  }
}

async function setDiscordState(env, notificationIds, status, fields = {}) {
  const ids = Array.from(
    new Set(
      (Array.isArray(notificationIds) ? notificationIds : [notificationIds])
        .map(positiveInteger)
        .filter(Boolean),
    ),
  ).slice(0, 500)
  if (!ids.length) return
  const nextAttemptAt =
    status === "retry"
      ? boundedText(fields.nextAttemptAt, 64) || nextDiscordRetryAt(fields.attemptCount)
      : ""
  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_request_notifications
     SET discord_status = ?,
         discord_sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE discord_sent_at END,
         discord_channel_id = ?,
         discord_message_id = ?,
         discord_error = ?,
         discord_next_attempt_at = ?
     WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(
      status,
      status,
      boundedText(fields.channelId, 255),
      boundedText(fields.messageId, 255),
      boundedText(fields.error, 1000),
      nextAttemptAt,
      ...ids,
    )
    .run()
}

export async function reconcileDeliveredRequestFulfillments(env, { requestIds = [] } = {}) {
  if (!env?.ICONOPLASM_DB) {
    return {
      ok: false,
      finalized: 0,
      pending_request_ids: [],
      error: "ICONOPLASM_DB binding missing",
    }
  }
  const ids = Array.from(
    new Set((Array.isArray(requestIds) ? requestIds : []).map(positiveInteger).filter(Boolean)),
  ).slice(0, 50)
  const scopedWhere = ids.length ? ` AND id IN (${ids.map(() => "?").join(",")})` : ""
  const finalized = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_generation_requests
     SET status = 'fulfilled',
         updated_at = CURRENT_TIMESTAMP,
         fulfilled_at = COALESCE(fulfilled_at, CURRENT_TIMESTAMP)
     WHERE status = 'delivery_pending'
       AND EXISTS (
         SELECT 1
         FROM icono_request_notifications n
         WHERE n.request_id = icono_generation_requests.id
           AND n.discord_status = 'sent'
       )${scopedWhere}`,
  )
    .bind(...ids)
    .run()
  if (!ids.length) {
    return {
      ok: true,
      finalized: positiveInteger(finalized?.meta?.changes),
      pending_request_ids: [],
    }
  }
  const outstanding = await env.ICONOPLASM_DB.prepare(
    `SELECT id
     FROM icono_generation_requests
     WHERE id IN (${ids.map(() => "?").join(",")})
       AND status = 'delivery_pending'
     ORDER BY id ASC`,
  )
    .bind(...ids)
    .all()
  return {
    ok: true,
    finalized: positiveInteger(finalized?.meta?.changes),
    pending_request_ids: (Array.isArray(outstanding?.results) ? outstanding.results : [])
      .map((row) => positiveInteger(row?.id))
      .filter(Boolean),
  }
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
  const allRequesters = allRequestersDiscordDeliveryEnabled(env)
  // Test-only suppressions are delivery debt, not terminal outcomes. Once
  // production delivery is explicitly enabled, retry those rows as well.
  const deliverableStatuses = allRequesters
    ? ["pending", "retry", "suppressed_not_test_recipient"]
    : ["pending", "retry"]
  const statusPlaceholders = deliverableStatuses.map(() => "?").join(",")
  const sameBatch = (left, right) => `
    ${left}.requester_user_id = ${right}.requester_user_id
    AND ${left}.request_batch_id = ${right}.request_batch_id
    AND ${left}.gene_symbol = ${right}.gene_symbol
    AND ${left}.request_kind = ${right}.request_kind`
  const where = [
    `n.discord_status IN (${statusPlaceholders})`,
    "(n.discord_next_attempt_at IS NULL OR n.discord_next_attempt_at <= CURRENT_TIMESTAMP)",
    `n.id = (
      SELECT MIN(leader.id)
      FROM icono_request_notifications leader
      WHERE ${sameBatch("leader", "n")}
    )`,
    `n.request_batch_size = (
      SELECT COUNT(*)
      FROM icono_request_notifications completed
      WHERE ${sameBatch("completed", "n")}
    )`,
  ]
  const params = [...deliverableStatuses]
  if (ids.length) {
    where.push(`EXISTS (
      SELECT 1
      FROM icono_request_notifications scoped
      WHERE ${sameBatch("scoped", "n")}
        AND scoped.request_id IN (${ids.map(() => "?").join(",")})
    )`)
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

  const result = {
    ok: true,
    considered: 0,
    considered_requests: 0,
    delivered: 0,
    delivered_requests: 0,
    suppressed: 0,
    failed: 0,
    unknown: 0,
  }
  for (const leader of Array.isArray(rowsResponse?.results) ? rowsResponse.results : []) {
    const leaderId = positiveInteger(leader?.id)
    const requesterId = userId(leader?.requester_user_id)
    const batchId = boundedText(leader?.request_batch_id, 128)
    const symbol = geneSymbol(leader?.gene_symbol)
    const kind = requestKind(leader?.request_kind)
    const expectedSize = Math.max(
      1,
      Math.min(500, positiveInteger(leader?.request_batch_size) || 1),
    )
    if (!leaderId || !requesterId || !batchId || !symbol) continue

    const groupResponse = await env.ICONOPLASM_DB.prepare(
      `SELECT n.*
       FROM icono_request_notifications n
       WHERE n.requester_user_id = ?
         AND n.request_batch_id = ?
         AND n.gene_symbol = ?
         AND n.request_kind = ?
       ORDER BY n.id ASC
       LIMIT 501`,
    )
      .bind(requesterId, batchId, symbol, kind)
      .all()
    const rows = Array.isArray(groupResponse?.results) ? groupResponse.results : []
    if (
      rows.length !== expectedSize ||
      rows.length > 500 ||
      rows.some((row) => !deliverableStatuses.includes(String(row?.discord_status || "")))
    ) {
      continue
    }
    const notificationIds = rows.map((row) => positiveInteger(row?.id)).filter(Boolean)
    if (notificationIds.length !== rows.length) continue
    result.considered += 1
    result.considered_requests += rows.length

    // The default is deliberately test-only. No non-test requester can reach
    // token lookup or Discord unless production delivery is explicitly enabled.
    if (!allRequesters && requesterId !== ICONOPLASM_FULFILLMENT_DM_TEST_RECIPIENT_ID) {
      await setDiscordState(env, notificationIds, "suppressed_not_test_recipient", {
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
       WHERE id IN (${notificationIds.map(() => "?").join(",")})
         AND discord_status IN (${statusPlaceholders})`,
    )
      .bind(...notificationIds, ...deliverableStatuses)
      .run()
    if (Number(claim?.meta?.changes || 0) !== notificationIds.length) continue

    const botToken = String(env?.DISCORD_BOT_TOKEN || "").trim()
    if (!botToken) {
      await setDiscordState(env, notificationIds, "retry", {
        error: "DISCORD_BOT_TOKEN is not configured.",
        attemptCount: Number(leader?.discord_attempt_count || 0) + 1,
      })
      result.failed += 1
      continue
    }

    const attachments = []
    let attachmentBytes = 0
    let attachmentFailure = null
    for (const row of rows.slice(0, DISCORD_MAX_ATTACHMENTS_PER_MESSAGE)) {
      const attachment = await loadFulfilledPortraitAttachment(env, row)
      if (!attachment.ok) {
        attachmentFailure = attachment
        break
      }
      if (attachmentBytes + attachment.byte_length > DISCORD_ATTACHMENT_BATCH_MAX_BYTES) break
      attachments.push(attachment)
      attachmentBytes += attachment.byte_length
    }
    if (attachmentFailure || !attachments.length) {
      const failure = attachmentFailure || {
        retryable: false,
        error: "Fulfilled portrait previews exceed the bounded Discord batch upload budget.",
      }
      await setDiscordState(env, notificationIds, failure.retryable ? "retry" : "failed", {
        error: failure.error,
        attemptCount: Number(leader?.discord_attempt_count || 0) + 1,
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
        const retryable = response.status === 429 || response.status >= 500
        await setDiscordState(env, notificationIds, retryable ? "retry" : "failed", {
          error: `Discord DM channel failed (${response.status}): ${boundedText(payload?.message, 500)}`,
          attemptCount: Number(leader?.discord_attempt_count || 0) + 1,
        })
        result.failed += 1
        continue
      }
    } catch (error) {
      // Opening a channel has no user-visible side effect, so retry is safe.
      await setDiscordState(env, notificationIds, "retry", {
        error: `Discord DM channel network failure: ${boundedText(error?.message || error || "unknown", 500)}`,
        attemptCount: Number(leader?.discord_attempt_count || 0) + 1,
      })
      result.failed += 1
      continue
    }

    try {
      const messagePayload = {
        content: discordMessage(rows, attachments.length),
        nonce: `icono-batch-${leaderId}`,
        enforce_nonce: true,
        allowed_mentions: { parse: [] },
        attachments: attachments.map((attachment, index) => ({
          id: index,
          filename: attachment.filename,
          description: attachment.description,
        })),
      }
      const form = new FormData()
      form.append("payload_json", JSON.stringify(messagePayload))
      attachments.forEach((attachment, index) => {
        form.append(`files[${index}]`, attachment.blob, attachment.filename)
      })
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
        await setDiscordState(env, notificationIds, status, {
          channelId,
          error: `Discord message failed (${response.status}): ${boundedText(payload?.message, 500)}`,
          attemptCount: Number(leader?.discord_attempt_count || 0) + 1,
        })
        if (status === "unknown") result.unknown += 1
        else result.failed += 1
        continue
      }
      await setDiscordState(env, notificationIds, "sent", {
        channelId,
        messageId: boundedText(payload?.id, 255),
      })
      result.delivered += 1
      result.delivered_requests += rows.length
    } catch (error) {
      // A failed response read after POST is ambiguous. Do not retry and risk
      // a duplicate DM; the durable website inbox remains authoritative.
      await setDiscordState(env, notificationIds, "unknown", {
        channelId,
        error: `Discord message delivery outcome unknown: ${boundedText(error?.message || error || "unknown", 500)}`,
      })
      result.unknown += 1
    }
  }
  return result
}
