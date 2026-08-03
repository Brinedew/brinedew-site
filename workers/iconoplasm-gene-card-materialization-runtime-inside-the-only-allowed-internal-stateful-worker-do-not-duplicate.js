// Durable requested-card materialization inside the one Iconoplasm state owner.
//
// ARCHITECTURE FENCE [IPD-004]: Queue messages are due-time wakeups. D1 owns
// existence, leases, retries, and recovery; duplicates are harmless.
// ARCHITECTURE FENCE [IPD-005]: this is bounded operational state: one row per
// canonical gene plus seven UTC budget rows. PNG bytes live in Bunny Storage.
// ARCHITECTURE FENCE [IPD-011]: the fingerprint is derived from the exact
// published card payload. This module never reconstructs a winner from votes.

export const ICONOPLASM_GENE_CARD_QUEUE_BINDING = "ICONOPLASM_GENE_CARD_MATERIALIZATION_QUEUE"
export const ICONOPLASM_GENE_CARD_QUEUE_KIND = "materialize_requested_gene_card"
export const ICONOPLASM_GENE_CARD_RENDERER_REVISION = "gene-card-v2-2026-08-03-print-resolution"
export const ICONOPLASM_GENE_CARD_WIDTH = 1536
export const ICONOPLASM_GENE_CARD_HEIGHT = 2048

const MAX_DAILY_BROWSER_SECONDS = 480
const MAX_DAILY_BROWSER_LAUNCHES = 8
const RESERVED_SECONDS_PER_LAUNCH = 60
const MIN_LAUNCH_INTERVAL_SECONDS = 25
const LEASE_SECONDS = 180
const MAX_ATTEMPTS = 5

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return /^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol) ? symbol : ""
}

function normalizeSha256(value) {
  const sha = String(value || "")
    .trim()
    .toLowerCase()
  return /^[a-f0-9]{64}$/.test(sha) ? sha : ""
}

function stableMaterial(value) {
  if (Array.isArray(value)) return value.map(stableMaterial)
  if (!value || typeof value !== "object") return value === undefined ? null : value
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (
      key === "snapshot_version" ||
      key === "artifact_version" ||
      key === "artifact_validated_at" ||
      key === "data_source" ||
      key === "print_copy"
    ) {
      continue
    }
    out[key] = stableMaterial(value[key])
  }
  return out
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (!value || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value)
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`
}

// Two independent 64-bit FNV-1a streams make a compact deterministic freshness
// fingerprint. This is a change detector, not a security boundary or object
// checksum; storage bytes are still verified by the provider adapter.
function fnv1a64(text, seed) {
  let hash = BigInt(seed)
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, "0")
}

export function iconoplasmGeneCardFingerprint(cardPayload) {
  const material = stableJson({
    renderer: ICONOPLASM_GENE_CARD_RENDERER_REVISION,
    card: stableMaterial(cardPayload),
  })
  return `${fnv1a64(material, 0xcbf29ce484222325n)}${fnv1a64(material, 0x84222325cbf29ce4n)}`
}

export function iconoplasmGeneCardObjectKey(symbolValue, fingerprintValue) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(fingerprintValue || "")
    .trim()
    .toLowerCase()
  if (!symbol || !/^[a-f0-9]{32}$/.test(fingerprint)) return ""
  return `gene-cards/v1/${symbol.slice(0, 1)}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-card.png`
}

export function iconoplasmGeneCardCdnUrl(env, objectKey) {
  const base = String(
    env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || "https://iconoplasmportraits.b-cdn.net",
  )
    .trim()
    .replace(/\/+$/, "")
  const key = String(objectKey || "").replace(/^\/+/, "")
  return base && key ? `${base}/${key}` : ""
}

export function iconoplasmGeneCardDownloadFilename(symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  return symbol ? `${symbol}-iconoplasm-gene-card.png` : "iconoplasm-gene-card.png"
}

export function iconoplasmGeneCardPngDimensions(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  if (
    source.byteLength < 24 ||
    source[0] !== 0x89 ||
    source[1] !== 0x50 ||
    source[2] !== 0x4e ||
    source[3] !== 0x47 ||
    source[12] !== 0x49 ||
    source[13] !== 0x48 ||
    source[14] !== 0x44 ||
    source[15] !== 0x52
  ) {
    return null
  }
  const dimensionAt = (offset) =>
    source[offset] * 0x1000000 +
    source[offset + 1] * 0x10000 +
    source[offset + 2] * 0x100 +
    source[offset + 3]
  const width = dimensionAt(16)
  const height = dimensionAt(20)
  return width > 0 && height > 0 ? { width, height } : null
}

function rowResult(result) {
  return Array.isArray(result?.results) ? result.results[0] || null : null
}

export async function readIconoplasmGeneCardMaterialization(env, symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  if (!symbol || !env?.ICONOPLASM_DB) return null
  return rowResult(
    await env.ICONOPLASM_DB.prepare(
      `SELECT * FROM icono_gene_card_materializations WHERE gene_symbol = ? LIMIT 1`,
    )
      .bind(symbol)
      .all(),
  )
}

async function claimWakeupGeneration(env, symbol, { force = false } = {}) {
  if (force) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_gene_card_materializations
          SET wakeup_generation = wakeup_generation + 1,
              updated_at = CURRENT_TIMESTAMP
        WHERE gene_symbol = ? AND state = 'queued'`,
    )
      .bind(symbol)
      .run()
  }
  const result = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET enqueued_generation = wakeup_generation,
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ?
        AND state = 'queued'
        AND enqueued_generation < wakeup_generation`,
  )
    .bind(symbol)
    .run()
  return Number(result?.meta?.changes || 0) > 0
}

export async function enqueueIconoplasmGeneCardWakeup(
  env,
  symbolValue,
  { delaySeconds = 0, force = false } = {},
) {
  const symbol = normalizeSymbol(symbolValue)
  const queue = env?.[ICONOPLASM_GENE_CARD_QUEUE_BINDING]
  if (!symbol || !queue?.send) return false
  const claimed = await claimWakeupGeneration(env, symbol, { force })
  if (!claimed) return false
  try {
    await queue.send(
      { kind: ICONOPLASM_GENE_CARD_QUEUE_KIND, symbol },
      delaySeconds > 0 ? { delaySeconds: Math.min(86400, Math.ceil(delaySeconds)) } : undefined,
    )
    return true
  } catch (error) {
    await env.ICONOPLASM_DB.prepare(
      `UPDATE icono_gene_card_materializations
          SET enqueued_generation = enqueued_generation - 1,
              last_error = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE gene_symbol = ? AND enqueued_generation = wakeup_generation`,
    )
      .bind(String(error?.message || error || "queue_send_failed").slice(0, 500), symbol)
      .run()
    throw error
  }
}

export async function enrollIconoplasmGeneCardMaterialization(
  env,
  { symbol: symbolValue, cardFingerprint, assetSha256 = "" },
) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(cardFingerprint || "")
    .trim()
    .toLowerCase()
  const assetSha = normalizeSha256(assetSha256) || null
  if (!symbol || !/^[a-f0-9]{32}$/.test(fingerprint)) {
    throw new TypeError("Invalid gene-card materialization identity")
  }
  await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_gene_card_materializations (
       gene_symbol, desired_card_fingerprint, desired_asset_sha256,
       state, attempts, request_count, wakeup_generation,
       enqueued_generation, next_attempt_at, requested_at, updated_at
     ) VALUES (?, ?, ?, 'queued', 0, 1, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(gene_symbol) DO UPDATE SET
       request_count = icono_gene_card_materializations.request_count + 1,
       desired_card_fingerprint = excluded.desired_card_fingerprint,
       desired_asset_sha256 = excluded.desired_asset_sha256,
        state = CASE
          WHEN icono_gene_card_materializations.ready_card_fingerprint = excluded.desired_card_fingerprint
            THEN 'ready'
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.state
          ELSE 'queued'
        END,
        attempts = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.attempts
          ELSE 0
        END,
        wakeup_generation = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.wakeup_generation
          ELSE icono_gene_card_materializations.wakeup_generation + 1
        END,
        next_attempt_at = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.next_attempt_at
          ELSE CURRENT_TIMESTAMP
        END,
        lease_token = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.lease_token
          ELSE NULL
        END,
        lease_expires_at = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.lease_expires_at
          ELSE NULL
        END,
        last_error = CASE
          WHEN icono_gene_card_materializations.desired_card_fingerprint = excluded.desired_card_fingerprint
            AND icono_gene_card_materializations.state <> 'failed'
            THEN icono_gene_card_materializations.last_error
          ELSE NULL
       END,
       requested_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(symbol, fingerprint, assetSha)
    .run()
  const row = await readIconoplasmGeneCardMaterialization(env, symbol)
  if (row?.state === "queued") await enqueueIconoplasmGeneCardWakeup(env, symbol)
  return readIconoplasmGeneCardMaterialization(env, symbol)
}

export async function advanceEnrolledIconoplasmGeneCardMaterialization(
  env,
  { symbol: symbolValue, cardFingerprint, assetSha256 = "" },
) {
  const symbol = normalizeSymbol(symbolValue)
  const fingerprint = String(cardFingerprint || "")
    .trim()
    .toLowerCase()
  if (!symbol || !/^[a-f0-9]{32}$/.test(fingerprint)) return false
  const result = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET desired_card_fingerprint = ?,
            desired_asset_sha256 = ?,
            state = 'queued',
            attempts = 0,
            wakeup_generation = wakeup_generation + 1,
            next_attempt_at = CURRENT_TIMESTAMP,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ? AND desired_card_fingerprint <> ?`,
  )
    .bind(fingerprint, normalizeSha256(assetSha256) || null, symbol, fingerprint)
    .run()
  if (Number(result?.meta?.changes || 0) < 1) return false
  await enqueueIconoplasmGeneCardWakeup(env, symbol)
  return true
}

export async function claimDueIconoplasmGeneCardMaterialization(env, symbolValue) {
  const symbol = normalizeSymbol(symbolValue)
  if (!symbol) return { kind: "missing", row: null }
  const current = await readIconoplasmGeneCardMaterialization(env, symbol)
  if (!current || current.state !== "queued") return { kind: "not_due", row: current }
  const dueMs = Date.parse(String(current.next_attempt_at || ""))
  if (Number.isFinite(dueMs) && dueMs > Date.now()) {
    return { kind: "future", row: current, delaySeconds: Math.max(1, (dueMs - Date.now()) / 1000) }
  }
  const leaseToken = crypto.randomUUID()
  const result = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET state = 'rendering',
            attempts = attempts + 1,
            lease_token = ?,
            lease_expires_at = datetime('now', ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ?
        AND state = 'queued'
        AND next_attempt_at <= CURRENT_TIMESTAMP
        AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)`,
  )
    .bind(leaseToken, `+${LEASE_SECONDS} seconds`, symbol)
    .run()
  if (Number(result?.meta?.changes || 0) < 1) return { kind: "not_due", row: null }
  const row = await readIconoplasmGeneCardMaterialization(env, symbol)
  return row?.lease_token === leaseToken
    ? { kind: "claimed", row, leaseToken }
    : { kind: "not_due", row }
}

function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

function secondsUntilNextUtcDay() {
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000))
}

export async function reserveIconoplasmGeneCardBrowserLaunch(env) {
  const day = utcDay()
  const result = await env.ICONOPLASM_DB.prepare(
    `INSERT INTO icono_gene_card_render_budget (
       day_utc, launches, reserved_seconds, used_seconds, last_launch_at, updated_at
     ) VALUES (?, 1, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(day_utc) DO UPDATE SET
       launches = icono_gene_card_render_budget.launches + 1,
       reserved_seconds = icono_gene_card_render_budget.reserved_seconds + excluded.reserved_seconds,
       last_launch_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE icono_gene_card_render_budget.launches < ?
       AND MAX(icono_gene_card_render_budget.reserved_seconds,
               icono_gene_card_render_budget.used_seconds) + excluded.reserved_seconds <= ?
       AND (icono_gene_card_render_budget.last_launch_at IS NULL OR
            icono_gene_card_render_budget.last_launch_at <= datetime('now', ?))`,
  )
    .bind(
      day,
      RESERVED_SECONDS_PER_LAUNCH,
      MAX_DAILY_BROWSER_LAUNCHES,
      MAX_DAILY_BROWSER_SECONDS,
      `-${MIN_LAUNCH_INTERVAL_SECONDS} seconds`,
    )
    .run()
  if (Number(result?.meta?.changes || 0) > 0) return { ok: true, day }
  const budget = rowResult(
    await env.ICONOPLASM_DB.prepare(
      `SELECT * FROM icono_gene_card_render_budget WHERE day_utc = ? LIMIT 1`,
    )
      .bind(day)
      .all(),
  )
  const lastLaunchMs = Date.parse(String(budget?.last_launch_at || ""))
  const gapDelay = Number.isFinite(lastLaunchMs)
    ? Math.max(0, MIN_LAUNCH_INTERVAL_SECONDS - (Date.now() - lastLaunchMs) / 1000)
    : 0
  const exhausted =
    Number(budget?.launches || 0) >= MAX_DAILY_BROWSER_LAUNCHES ||
    Math.max(Number(budget?.reserved_seconds || 0), Number(budget?.used_seconds || 0)) +
      RESERVED_SECONDS_PER_LAUNCH >
      MAX_DAILY_BROWSER_SECONDS
  return {
    ok: false,
    reason: exhausted ? "daily_budget" : "launch_interval",
    delaySeconds: exhausted ? secondsUntilNextUtcDay() : Math.max(1, Math.ceil(gapDelay)),
  }
}

export async function recordIconoplasmGeneCardBrowserSeconds(env, day, durationSeconds) {
  const seconds = Math.max(1, Math.ceil(Number(durationSeconds) || 0))
  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_render_budget
        SET used_seconds = used_seconds + ?,
            reserved_seconds = MAX(reserved_seconds, used_seconds + ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE day_utc = ?`,
  )
    .bind(seconds, seconds, day)
    .run()
  await env.ICONOPLASM_DB.prepare(
    `DELETE FROM icono_gene_card_render_budget WHERE day_utc < date('now', '-7 days')`,
  ).run()
}

export async function deferIconoplasmGeneCardMaterialization(
  env,
  { symbol: symbolValue, leaseToken, delaySeconds, error = "", enqueue = true },
) {
  const symbol = normalizeSymbol(symbolValue)
  const delay = Math.max(1, Math.min(86400, Math.ceil(Number(delaySeconds) || 1)))
  const result = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET state = 'queued',
            attempts = MAX(0, attempts - 1),
            wakeup_generation = wakeup_generation + 1,
            next_attempt_at = datetime('now', ?),
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ? AND state = 'rendering' AND lease_token = ?`,
  )
    .bind(`+${delay} seconds`, String(error || "").slice(0, 500) || null, symbol, leaseToken)
    .run()
  if (enqueue && Number(result?.meta?.changes || 0) > 0) {
    await enqueueIconoplasmGeneCardWakeup(env, symbol, { delaySeconds: delay })
  }
}

export async function failIconoplasmGeneCardMaterialization(
  env,
  { symbol: symbolValue, leaseToken, error },
) {
  const symbol = normalizeSymbol(symbolValue)
  const row = await readIconoplasmGeneCardMaterialization(env, symbol)
  const attempts = Number(row?.attempts || 0)
  const terminal = attempts >= MAX_ATTEMPTS
  const delay = Math.min(86400, 300 * 2 ** Math.max(0, attempts - 1))
  const result = await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET state = ?,
            wakeup_generation = CASE WHEN ? THEN wakeup_generation ELSE wakeup_generation + 1 END,
            next_attempt_at = datetime('now', ?),
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ? AND state = 'rendering' AND lease_token = ?`,
  )
    .bind(
      terminal ? "failed" : "queued",
      terminal ? 1 : 0,
      `+${delay} seconds`,
      String(error?.message || error || "render_failed").slice(0, 500),
      symbol,
      leaseToken,
    )
    .run()
  if (!terminal && Number(result?.meta?.changes || 0) > 0) {
    await enqueueIconoplasmGeneCardWakeup(env, symbol, { delaySeconds: delay })
  }
}

export async function completeIconoplasmGeneCardMaterialization(
  env,
  { symbol: symbolValue, leaseToken, cardFingerprint, assetSha256, objectKey },
) {
  const symbol = normalizeSymbol(symbolValue)
  // D1 batch is transactional: the dirty-publication event and the ready row
  // become visible together. An event failure therefore leaves the lease for
  // scheduled recovery instead of stranding an unpublished ready object.
  const results = await env.ICONOPLASM_DB.batch([
    env.ICONOPLASM_DB.prepare(
      `INSERT INTO icono_publish_events (
         gene_symbol, from_asset_sha256, to_asset_sha256, action, actor, reason, created_at
       )
       SELECT gene_symbol, ?, ?, 'gene_card_materialized', 'gene_card_materializer', ?, CURRENT_TIMESTAMP
         FROM icono_gene_card_materializations
        WHERE gene_symbol = ?
          AND state = 'rendering'
          AND lease_token = ?
          AND desired_card_fingerprint = ?`,
    ).bind(
      normalizeSha256(assetSha256) || null,
      normalizeSha256(assetSha256) || null,
      `Ready ${cardFingerprint}`,
      symbol,
      leaseToken,
      cardFingerprint,
    ),
    env.ICONOPLASM_DB.prepare(
      `UPDATE icono_gene_card_materializations
        SET state = 'ready',
            ready_card_fingerprint = ?,
            ready_asset_sha256 = ?,
            object_key = ?,
            width = ?,
            height = ?,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL,
            rendered_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE gene_symbol = ?
        AND state = 'rendering'
        AND lease_token = ?
        AND desired_card_fingerprint = ?`,
    ).bind(
      cardFingerprint,
      normalizeSha256(assetSha256) || null,
      objectKey,
      ICONOPLASM_GENE_CARD_WIDTH,
      ICONOPLASM_GENE_CARD_HEIGHT,
      symbol,
      leaseToken,
      cardFingerprint,
    ),
  ])
  if (Number(results?.[1]?.meta?.changes || 0) < 1) return false
  return true
}

export async function recoverDueIconoplasmGeneCardMaterializations(env, { limit = 8 } = {}) {
  if (!env?.ICONOPLASM_DB || !env?.[ICONOPLASM_GENE_CARD_QUEUE_BINDING]?.send) {
    return { considered: 0, enqueued: 0 }
  }
  await env.ICONOPLASM_DB.prepare(
    `UPDATE icono_gene_card_materializations
        SET state = 'queued',
            wakeup_generation = wakeup_generation + 1,
            lease_token = NULL,
            lease_expires_at = NULL,
            next_attempt_at = CURRENT_TIMESTAMP,
            last_error = 'expired_render_lease',
            updated_at = CURRENT_TIMESTAMP
      WHERE state = 'rendering' AND lease_expires_at <= CURRENT_TIMESTAMP`,
  ).run()
  const result = await env.ICONOPLASM_DB.prepare(
    `SELECT gene_symbol
       FROM icono_gene_card_materializations
      WHERE state = 'queued' AND next_attempt_at <= CURRENT_TIMESTAMP
      ORDER BY next_attempt_at ASC, gene_symbol ASC
      LIMIT ?`,
  )
    .bind(Math.max(1, Math.min(32, Number(limit) || 8)))
    .all()
  const rows = Array.isArray(result?.results) ? result.results : []
  let enqueued = 0
  for (const row of rows) {
    if (await enqueueIconoplasmGeneCardWakeup(env, row.gene_symbol, { force: true })) enqueued += 1
  }
  return { considered: rows.length, enqueued }
}
