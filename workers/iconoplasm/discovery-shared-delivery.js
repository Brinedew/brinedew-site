import { applySharedDiscoveryDeltas } from "./discovery-compact-state.js"

const DELIVERY_SCHEMA = "iconoplasm.discoverySharedDelivery.v1"
const BATCH_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256 = /^[a-f0-9]{64}$/
const SHARED_SELECT_SQL = `SELECT
  dictionary_version, state_version, discoverer_counts_b64, encounter_counts_b64,
  first_at_b64, latest_at_b64
FROM icono_discovery_shared_state_v2 WHERE singleton = 1`
const RECEIPTS_SELECT_SQL = `SELECT delivery_id, payload_sha256
FROM icono_discovery_shared_delivery_receipts_v2
WHERE delivery_id IN (SELECT value FROM json_each(?))`
const SHARED_CAS_GUARD_SQL = `INSERT INTO icono_discovery_cas_guard(ok)
SELECT 0 WHERE (SELECT state_version FROM icono_discovery_shared_state_v2 WHERE singleton = 1) <> ?`
const SHARED_UPDATE_SQL = `UPDATE icono_discovery_shared_state_v2 SET
  dictionary_version = ?, state_version = ?, discoverer_counts_b64 = ?, encounter_counts_b64 = ?,
  first_at_b64 = ?, latest_at_b64 = ?, updated_at = CURRENT_TIMESTAMP
WHERE singleton = 1 AND state_version = ?
RETURNING state_version`
const RECEIPTS_INSERT_SQL = `INSERT INTO icono_discovery_shared_delivery_receipts_v2 (
  delivery_id, user_id, batch_id, user_state_version, dictionary_version, payload_sha256, applied_at
)
SELECT
  json_extract(value, '$.delivery_id'),
  json_extract(value, '$.user_id'),
  json_extract(value, '$.batch_id'),
  CAST(json_extract(value, '$.user_state_version') AS INTEGER),
  CAST(json_extract(value, '$.dictionary_version') AS INTEGER),
  json_extract(value, '$.payload_sha256'),
  CURRENT_TIMESTAMP
FROM json_each(?)`
const OUTBOX_SELECT_SQL = `SELECT payload_json
FROM icono_discovery_shared_delivery_outbox_v2
ORDER BY created_at ASC, delivery_id ASC
LIMIT ?`
const OUTBOX_DELETE_SQL = `DELETE FROM icono_discovery_shared_delivery_outbox_v2
WHERE delivery_id IN (SELECT value FROM json_each(?))`

function rows(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function integer(value, label, { min = 0, max = 0xffffffff } = {}) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw new TypeError(`Invalid ${label}`)
  return number
}

function normalizeDelivery(raw) {
  if (!raw || raw.schema !== DELIVERY_SCHEMA)
    throw new TypeError("Invalid discovery delivery schema")
  const userId = String(raw.user_id || "")
  const batchId = String(raw.batch_id || "")
  const deliveryId = String(raw.delivery_id || "")
  if (!userId || userId.length > 160) throw new TypeError("Invalid discovery delivery user")
  if (!BATCH_ID.test(batchId)) throw new TypeError("Invalid discovery delivery batch id")
  if (deliveryId !== `${userId}:${batchId}` || deliveryId.length > 320)
    throw new TypeError("Invalid discovery delivery id")
  const userStateVersion = integer(raw.user_state_version, "discovery user state version", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  })
  const dictionaryVersion = integer(raw.dictionary_version, "discovery dictionary version", {
    min: 1,
    max: 1_000_000,
  })
  if (!Array.isArray(raw.deltas) || !raw.deltas.length || raw.deltas.length > 256)
    throw new TypeError("Invalid discovery delivery deltas")
  const deltas = raw.deltas.map((delta) => {
    if (!Array.isArray(delta) || delta.length !== 5)
      throw new TypeError("Invalid compact discovery delta")
    const ordinal = integer(delta[0], "discovery ordinal", { max: 1_000_000 })
    const newMember = integer(delta[1], "discovery new-member flag", { max: 1 })
    const encounters = integer(delta[2], "discovery encounter count", { min: 1 })
    const firstAt = integer(delta[3], "discovery first timestamp")
    const latestAt = integer(delta[4], "discovery latest timestamp")
    if (latestAt < firstAt) throw new TypeError("Discovery delivery timestamps are reversed")
    return [ordinal, newMember, encounters, firstAt, latestAt]
  })
  return {
    schema: DELIVERY_SCHEMA,
    delivery_id: deliveryId,
    user_id: userId,
    batch_id: batchId,
    user_state_version: userStateVersion,
    dictionary_version: dictionaryVersion,
    deltas,
  }
}

function canonicalDelivery(delivery) {
  return JSON.stringify({
    schema: delivery.schema,
    delivery_id: delivery.delivery_id,
    user_id: delivery.user_id,
    batch_id: delivery.batch_id,
    user_state_version: delivery.user_state_version,
    dictionary_version: delivery.dictionary_version,
    deltas: delivery.deltas,
  })
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function normalizeDeliveries(rawDeliveries) {
  if (!Array.isArray(rawDeliveries) || !rawDeliveries.length || rawDeliveries.length > 128)
    throw new TypeError("Discovery shared delivery batch must contain 1-128 items")
  const unique = new Map()
  for (const raw of rawDeliveries) {
    const delivery = normalizeDelivery(raw)
    const payloadSha256 = await sha256(canonicalDelivery(delivery))
    const prior = unique.get(delivery.delivery_id)
    if (prior && prior.payload_sha256 !== payloadSha256)
      throw new Error("Discovery delivery id collision within one consumer batch")
    unique.set(delivery.delivery_id, { ...delivery, payload_sha256: payloadSha256 })
  }
  return [...unique.values()]
}

function sharedState(row) {
  if (!row) throw new Error("Compact discovery shared state is not initialized")
  return {
    dictionary_version: Number(row.dictionary_version || 0),
    state_version: Number(row.state_version || 0),
    discoverer_counts_b64: String(row.discoverer_counts_b64 || ""),
    encounter_counts_b64: String(row.encounter_counts_b64 || ""),
    first_at_b64: String(row.first_at_b64 || ""),
    latest_at_b64: String(row.latest_at_b64 || ""),
  }
}

function objectDeltas(delivery) {
  return delivery.deltas.map(([ordinal, newMember, encounters, firstAt, latestAt]) => ({
    ordinal,
    new_member: Boolean(newMember),
    encounters,
    first_at: firstAt,
    latest_at: latestAt,
  }))
}

export async function consumeSharedDiscoveryDeliveries(
  db,
  rawDeliveries,
  { maxAttempts = 8, onAttempt = null } = {},
) {
  const deliveries = await normalizeDeliveries(rawDeliveries)
  const attemptsLimit = integer(maxAttempts, "shared delivery attempt bound", { min: 1, max: 64 })
  const idsJson = JSON.stringify(deliveries.map((delivery) => delivery.delivery_id))
  for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
    const read = await db.batch([
      db.prepare(SHARED_SELECT_SQL),
      db.prepare(RECEIPTS_SELECT_SQL).bind(idsJson),
    ])
    const current = sharedState(rows(read[0])[0])
    const existing = new Map(
      rows(read[1]).map((row) => [String(row.delivery_id), String(row.payload_sha256 || "")]),
    )
    for (const delivery of deliveries) {
      const fingerprint = existing.get(delivery.delivery_id)
      if (fingerprint && (!SHA256.test(fingerprint) || fingerprint !== delivery.payload_sha256))
        throw new Error(`Discovery delivery id collision: ${delivery.delivery_id}`)
    }
    const pending = deliveries
      .filter((delivery) => !existing.has(delivery.delivery_id))
      .sort(
        (left, right) =>
          left.dictionary_version - right.dictionary_version ||
          left.delivery_id.localeCompare(right.delivery_id),
      )
    if (!pending.length) {
      onAttempt?.({ attempt, conflict: false, applied: 0, duplicates: deliveries.length })
      return {
        ok: true,
        attempts: attempt,
        applied: 0,
        duplicates: deliveries.length,
        state_version: current.state_version,
      }
    }

    let next = current
    for (const delivery of pending) {
      next = applySharedDiscoveryDeltas(next, {
        dictionaryVersion: delivery.dictionary_version,
        deltas: objectDeltas(delivery),
      })
    }
    const receiptRows = pending.map((delivery) => ({
      delivery_id: delivery.delivery_id,
      user_id: delivery.user_id,
      batch_id: delivery.batch_id,
      user_state_version: delivery.user_state_version,
      dictionary_version: delivery.dictionary_version,
      payload_sha256: delivery.payload_sha256,
    }))
    try {
      const write = await db.batch([
        db.prepare(SHARED_CAS_GUARD_SQL).bind(current.state_version),
        db
          .prepare(SHARED_UPDATE_SQL)
          .bind(
            next.dictionary_version,
            next.state_version,
            next.discoverer_counts_b64,
            next.encounter_counts_b64,
            next.first_at_b64,
            next.latest_at_b64,
            current.state_version,
          ),
        db.prepare(RECEIPTS_INSERT_SQL).bind(JSON.stringify(receiptRows)),
      ])
      const updated = rows(write[1])[0]
      if (!updated || Number(updated.state_version) !== Number(next.state_version)) {
        onAttempt?.({ attempt, conflict: true, applied: 0, duplicates: existing.size })
        continue
      }
      onAttempt?.({
        attempt,
        conflict: false,
        applied: pending.length,
        duplicates: deliveries.length - pending.length,
      })
      return {
        ok: true,
        attempts: attempt,
        applied: pending.length,
        duplicates: deliveries.length - pending.length,
        state_version: next.state_version,
      }
    } catch (error) {
      if (String(error?.message || error).includes("DISCOVERY_COMPACT_CAS_CONFLICT")) {
        onAttempt?.({ attempt, conflict: true, applied: 0, duplicates: existing.size })
        continue
      }
      throw error
    }
  }
  throw new Error(`Shared discovery delivery remained contended after ${attemptsLimit} attempts`)
}

// Bounded drain of the durable outbox written beside each compact personal
// batch. Replay after a crash between apply and cleanup is safe because the
// consumer deduplicates by delivery_id; an unapplied batch stays in the outbox
// until a later drain succeeds.
export async function drainSharedDiscoveryDeliveries(
  db,
  { limit = 128, maxAttempts = 8, onAttempt = null } = {},
) {
  const bounded = Math.max(1, Math.min(128, Number(limit) || 128))
  const read = await db.prepare(OUTBOX_SELECT_SQL).bind(bounded).all()
  const pending = rows(read)
  if (!pending.length) return { ok: true, drained: 0, applied: 0, duplicates: 0 }
  const deliveries = []
  for (const row of pending) {
    try {
      deliveries.push(JSON.parse(String(row.payload_json || "{}")))
    } catch {
      throw new Error("Discovery shared delivery outbox row is not valid JSON")
    }
  }
  const result = await consumeSharedDiscoveryDeliveries(db, deliveries, { maxAttempts, onAttempt })
  await db
    .prepare(OUTBOX_DELETE_SQL)
    .bind(JSON.stringify(deliveries.map((delivery) => delivery.delivery_id)))
    .run()
  return {
    ok: true,
    drained: deliveries.length,
    applied: Number(result.applied || 0),
    duplicates: Number(result.duplicates || 0),
  }
}
