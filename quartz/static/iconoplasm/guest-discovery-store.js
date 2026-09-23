import {
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-contract.js?v=2bf13ee5e7e6c96d"

export {
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-contract.js?v=2bf13ee5e7e6c96d"

export const WEBSITE_GUEST_DISCOVERY_STORAGE_KEY = "iconoplasm.website-guest-discoveries.v1"

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,63}$/

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return SYMBOL_PATTERN.test(symbol) ? symbol : ""
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = new Date(value)
    if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString()
  }
  const parsed = Date.parse(String(value || ""))
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  return fallback
}

function normalizeEncounterCount(value) {
  const count = Number.parseInt(String(value || "1"), 10)
  return Number.isFinite(count) ? Math.max(1, count) : 1
}

export function normalizeWebsiteGuestDiscoveries(value, maxEntries) {
  const resolvedMax = Math.max(
    1,
    Number.parseInt(String(maxEntries || WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES), 10) ||
      WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  )
  const source = Array.isArray(value)
    ? value
    : value && Array.isArray(value.discoveries)
      ? value.discoveries
      : []
  const bySymbol = new Map()
  const order = []

  for (const raw of source) {
    const compact = Array.isArray(raw)
    const symbol = normalizeSymbol(compact ? raw[0] : raw && (raw.gene_symbol || raw.symbol || raw))
    if (!symbol) continue
    const fallbackTimestamp = new Date(0).toISOString()
    const firstDiscoveredAt = normalizeTimestamp(
      compact ? raw[1] : raw && raw.first_discovered_at,
      fallbackTimestamp,
    )
    const lastEncounteredAt = normalizeTimestamp(
      compact ? raw[2] : raw && raw.last_encountered_at,
      firstDiscoveredAt,
    )
    const encounterCount = normalizeEncounterCount(compact ? raw[3] : raw && raw.encounter_count)
    const existing = bySymbol.get(symbol)
    if (!existing) {
      order.push(symbol)
      bySymbol.set(symbol, {
        gene_symbol: symbol,
        first_discovered_at: firstDiscoveredAt,
        last_encountered_at: lastEncounteredAt,
        encounter_count: encounterCount,
      })
      continue
    }
    if (Date.parse(firstDiscoveredAt) < Date.parse(existing.first_discovered_at)) {
      existing.first_discovered_at = firstDiscoveredAt
    }
    if (Date.parse(lastEncounteredAt) > Date.parse(existing.last_encountered_at)) {
      existing.last_encountered_at = lastEncounteredAt
    }
    existing.encounter_count += encounterCount
  }

  return order
    .slice(-resolvedMax)
    .map((symbol) => bySymbol.get(symbol))
    .filter(Boolean)
}

export const WEBSITE_DISCOVERY_QUEUE_STORAGE_KEY = "iconoplasm.website-discovery-queue.v1"

const QUEUE_DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/

function createQueueDeviceId() {
  let id = ""
  for (let index = 0; index < 24; index++) id += Math.floor(Math.random() * 16).toString(16)
  return id
}

// Durable signing-in encounter queue for the website's own gene-page visits.
// One batch identity is persisted before its network call, so a reload or
// offline retry replays the exact same batch instead of a duplicate.
export function createWebsiteDiscoveryBatchQueue(options) {
  const opts = options || {}
  const storage = opts.storage || null
  const key = String(opts.storageKey || WEBSITE_DISCOVERY_QUEUE_STORAGE_KEY)
  const sendBatch = opts.sendBatch
  if (typeof sendBatch !== "function") throw new TypeError("sendBatch is required")
  const maxBatchSize = Math.max(1, Math.min(64, Number(opts.maxBatchSize) || 64))
  const maxPending = Math.max(maxBatchSize, Math.min(4096, Number(opts.maxPending) || 4096))

  function normalizeEncounter(raw) {
    const symbol = normalizeSymbol(raw && raw.symbol)
    if (!symbol) return null
    const at = Math.floor(Number(raw && raw.at))
    return {
      symbol,
      at: Number.isFinite(at) && at >= 0 && at <= 0xffffffff ? at : Math.floor(Date.now() / 1000),
      source: String((raw && raw.source) || "gene_page_visit").slice(0, 80),
      trigger: String((raw && raw.trigger) || "gene_page_visit").slice(0, 80),
      dwell_ms: null,
    }
  }

  function load() {
    let parsed = null
    try {
      const raw = storage && storage.getItem ? storage.getItem(key) : null
      parsed = raw ? JSON.parse(raw) : null
    } catch (_error) {
      parsed = null
    }
    const value = parsed && typeof parsed === "object" ? parsed : {}
    const deviceId = QUEUE_DEVICE_ID.test(String(value.device_id || ""))
      ? String(value.device_id)
      : createQueueDeviceId()
    const nextSequence = Number(value.next_sequence || 1)
    const pending = Array.isArray(value.pending)
      ? value.pending.map(normalizeEncounter).filter(Boolean)
      : []
    let inflight = null
    if (value.inflight && typeof value.inflight === "object") {
      const sequence = Number(value.inflight.sequence)
      const batchId = String(value.inflight.batch_id || "")
      const encounters = Array.isArray(value.inflight.encounters)
        ? value.inflight.encounters.map(normalizeEncounter).filter(Boolean)
        : []
      if (
        Number.isSafeInteger(sequence) &&
        sequence >= 1 &&
        batchId === `${deviceId}:${sequence}` &&
        encounters.length
      ) {
        inflight = { sequence, batch_id: batchId, encounters }
      }
    }
    return {
      device_id: deviceId,
      next_sequence: Number.isSafeInteger(nextSequence) && nextSequence >= 1 ? nextSequence : 1,
      pending,
      inflight,
    }
  }

  let state = load()
  const persist = () => {
    try {
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(key, JSON.stringify(state))
      }
    } catch (_error) {
      // The in-memory queue still drains this page; the next page reload may
      // lose an unpersisted encounter, never a persisted inflight batch.
    }
  }

  let serial = Promise.resolve()
  const exclusive = (task) => {
    const run = serial.then(task, task)
    serial = run.catch(() => {})
    return run
  }

  function enqueue(raw) {
    const encounter = normalizeEncounter(raw)
    if (!encounter) return Promise.resolve({ queued: false })
    return exclusive(() => {
      if (state.pending.length >= maxPending)
        return { queued: false, error: "DISCOVERY_QUEUE_FULL" }
      state.pending.push(encounter)
      persist()
      return { queued: true, pending: state.pending.length }
    })
  }

  function flush(batchBound) {
    const maxBatches = Math.max(1, Math.min(8, Number(batchBound) || 2))
    return exclusive(async () => {
      let sent = 0
      let acknowledged = 0
      for (let index = 0; index < maxBatches; index++) {
        if (!state.inflight) {
          if (!state.pending.length) break
          const sequence = state.next_sequence
          const encounters = state.pending.splice(0, maxBatchSize)
          state.inflight = { sequence, batch_id: `${state.device_id}:${sequence}`, encounters }
          state.next_sequence += 1
          persist()
        }
        const batch = state.inflight
        let receipt
        try {
          sent += 1
          receipt = await sendBatch(batch)
        } catch (error) {
          return { ok: false, error, sent, acknowledged, batch_id: batch.batch_id }
        }
        if (!receipt || receipt.ok !== true || String(receipt.batch_id || "") !== batch.batch_id) {
          return { ok: false, error: new Error("receipt mismatch"), sent, acknowledged }
        }
        state = load()
        if (!state.inflight || state.inflight.batch_id !== batch.batch_id)
          return { ok: false, error: new Error("inflight identity changed"), sent, acknowledged }
        state.inflight = null
        acknowledged += 1
        persist()
      }
      return { ok: true, sent, acknowledged, pending: state.pending.length }
    })
  }

  function status() {
    return {
      device_id: state.device_id,
      pending: state.pending.length,
      inflight_batch_id: state.inflight ? state.inflight.batch_id : null,
    }
  }

  return { enqueue, flush, status }
}

export function createWebsiteGuestDiscoveryStore(options) {
  const opts = options || {}
  const storage = opts.storage || null
  const key = String(opts.key || WEBSITE_GUEST_DISCOVERY_STORAGE_KEY)
  const maxEntries = Math.max(
    1,
    Number.parseInt(String(opts.maxEntries || WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES), 10) ||
      WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  )
  const now = typeof opts.now === "function" ? opts.now : () => new Date()
  let entries = []

  try {
    const raw = storage && storage.getItem ? storage.getItem(key) : null
    entries = normalizeWebsiteGuestDiscoveries(raw ? JSON.parse(raw) : [], maxEntries)
  } catch (_error) {
    entries = []
  }

  function persist() {
    if (!storage || typeof storage.setItem !== "function") return
    try {
      storage.setItem(
        key,
        JSON.stringify({
          version: 2,
          discoveries: entries.map((entry) => [
            entry.gene_symbol,
            Date.parse(entry.first_discovered_at),
            Date.parse(entry.last_encountered_at),
            entry.encounter_count,
          ]),
        }),
      )
    } catch (_error) {
      // The in-memory shelf remains useful for the current tab when browser
      // storage is unavailable or full. A failed write must not break the page.
    }
  }

  function listEntries() {
    return entries.map((entry) => ({ ...entry }))
  }

  function pendingSymbols(limit) {
    const resolvedLimit =
      limit === undefined ? entries.length : Math.max(0, Math.floor(Number(limit) || 0))
    return entries.slice(0, resolvedLimit).map((entry) => entry.gene_symbol)
  }

  function remember(symbol) {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) return null
    const timestampValue = now()
    const timestamp = normalizeTimestamp(
      timestampValue instanceof Date ? timestampValue.toISOString() : timestampValue,
      new Date().toISOString(),
    )
    const existing = entries.find((entry) => entry.gene_symbol === normalized)
    if (existing) {
      existing.last_encountered_at = timestamp
      existing.encounter_count += 1
      persist()
      return { ...existing }
    }
    const entry = {
      gene_symbol: normalized,
      first_discovered_at: timestamp,
      last_encountered_at: timestamp,
      encounter_count: 1,
    }
    entries.push(entry)
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries)
    }
    persist()
    return { ...entry }
  }

  function remove(symbols) {
    const removals = new Set((Array.isArray(symbols) ? symbols : []).map(normalizeSymbol))
    removals.delete("")
    if (!removals.size) return
    const next = entries.filter((entry) => !removals.has(entry.gene_symbol))
    if (next.length === entries.length) return
    entries = next
    persist()
  }

  return {
    listEntries,
    pendingSymbols,
    remember,
    remove,
  }
}
