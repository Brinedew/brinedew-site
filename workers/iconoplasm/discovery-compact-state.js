const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const BATCH_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SEQUENCED_BATCH_ID = /^([A-Za-z0-9_-]{8,64}):([1-9][0-9]{0,15})$/
const MAX_ORDINAL = 1_000_000
export const DISCOVERY_COMPACT_SCHEMA = "iconoplasm.discoveryCompact.v1"
export const DISCOVERY_CHUNK_EVENTS = 64
export const DISCOVERY_RECENT_RECEIPTS = 32
export const DISCOVERY_DEVICE_RECEIPT_LIMIT = 16

function cleanPositiveInt(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > MAX_ORDINAL) throw new TypeError(`Invalid ${label}`)
  return n
}

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(symbol)) throw new TypeError("Invalid discovery symbol")
  return symbol
}

function normalizeEpochSeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff)
    throw new TypeError("Invalid discovery timestamp")
  return Math.floor(n)
}

function bytesToBase64(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || 0)
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64")
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value) {
  const text = String(value || "")
  if (!text) return new Uint8Array(0)
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(text, "base64"))
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function ensureLength(bytes, length) {
  if (bytes.length >= length) return bytes
  const next = new Uint8Array(length)
  next.set(bytes)
  return next
}

function uint32ToBase64(values) {
  const array = values instanceof Uint32Array ? values : new Uint32Array(values || 0)
  const bytes = new Uint8Array(array.length * 4)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < array.length; i++) view.setUint32(i * 4, array[i], true)
  return bytesToBase64(bytes)
}

function base64ToUint32(value) {
  const bytes = base64ToBytes(value)
  if (bytes.byteLength % 4) throw new TypeError("Invalid uint32 discovery payload")
  const values = new Uint32Array(bytes.byteLength / 4)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < values.length; i++) values[i] = view.getUint32(i * 4, true)
  return values
}

function ensureUint32Length(values, length) {
  if (values.length >= length) return values
  const next = new Uint32Array(length)
  next.set(values)
  return next
}

function sequencedBatch(value) {
  const match = String(value || "").match(SEQUENCED_BATCH_ID)
  if (!match) return null
  const sequence = Number(match[2])
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new TypeError("Invalid discovery batch sequence")
  return { device_id: match[1], sequence }
}

export function createDiscoveryOrdinalDictionary(entries, { version = 1 } = {}) {
  const dictionaryVersion = cleanPositiveInt(version, "dictionary version")
  if (dictionaryVersion < 1) throw new TypeError("Invalid dictionary version")
  if (!Array.isArray(entries)) throw new TypeError("Discovery dictionary entries must be an array")
  const bySymbol = new Map()
  const byOrdinal = new Map()
  for (const entry of entries) {
    const symbol = normalizeSymbol(entry?.symbol)
    const ordinal = cleanPositiveInt(entry?.ordinal, "discovery ordinal")
    if (bySymbol.has(symbol) || byOrdinal.has(ordinal))
      throw new TypeError("Duplicate discovery dictionary entry")
    bySymbol.set(symbol, ordinal)
    byOrdinal.set(ordinal, symbol)
  }
  return Object.freeze({
    schema: "iconoplasm.discoveryDictionary.v1",
    version: dictionaryVersion,
    bySymbol,
    byOrdinal,
  })
}

export function discoveryMembershipByteLength(maxOrdinal) {
  const ordinal = cleanPositiveInt(maxOrdinal, "maximum discovery ordinal")
  return Math.ceil((ordinal + 1) / 8)
}

export function hasDiscoveryOrdinal(membershipBase64, ordinal) {
  const cleanOrdinal = cleanPositiveInt(ordinal, "discovery ordinal")
  const bytes = base64ToBytes(membershipBase64)
  const byte = cleanOrdinal >> 3
  return byte < bytes.length && Boolean(bytes[byte] & (1 << (cleanOrdinal & 7)))
}

function normalizeUserState(raw = {}) {
  raw = raw || {}
  const activeEvents = Array.isArray(raw.active_events)
    ? raw.active_events.map((event) => ({ ...event }))
    : []
  const receipts = Array.isArray(raw.recent_receipts)
    ? raw.recent_receipts.map((receipt) => ({ ...receipt }))
    : []
  return {
    schema: DISCOVERY_COMPACT_SCHEMA,
    dictionary_version: Number(raw.dictionary_version || 0),
    state_version: Number(raw.state_version || 0),
    membership_b64: String(raw.membership_b64 || ""),
    member_count: Number(raw.member_count || 0),
    next_event_seq: Number(raw.next_event_seq || 1),
    next_chunk_seq: Number(raw.next_chunk_seq || 1),
    active_events: activeEvents,
    recent_receipts: receipts,
  }
}

function normalizeEncounter(raw, dictionary) {
  const symbol = normalizeSymbol(raw?.symbol)
  const ordinal = dictionary.bySymbol.get(symbol)
  if (!Number.isInteger(ordinal)) throw new TypeError(`Unknown discovery symbol: ${symbol}`)
  const source = String(raw?.source || "").slice(0, 80)
  const trigger = String(raw?.trigger || "").slice(0, 80)
  const dwell =
    raw?.dwell_ms == null
      ? null
      : Math.max(0, Math.min(86_400_000, Math.floor(Number(raw.dwell_ms) || 0)))
  return { symbol, ordinal, at: normalizeEpochSeconds(raw?.at), source, trigger, dwell_ms: dwell }
}

function deviceReceiptState(receipts, batch) {
  if (!batch) return null
  const matches = receipts
    .map((receipt) => ({ receipt, batch: sequencedBatch(receipt.batch_id) }))
    .filter((item) => item.batch?.device_id === batch.device_id)
    .sort((left, right) => right.batch.sequence - left.batch.sequence)
  return matches[0] || null
}

export function applyDiscoveryBatch(rawState, { batchId, dictionary, encounters }) {
  if (!BATCH_ID.test(String(batchId || ""))) throw new TypeError("Invalid discovery batch id")
  if (!dictionary?.bySymbol || !Number.isInteger(dictionary.version))
    throw new TypeError("Discovery dictionary required")
  if (!Array.isArray(encounters) || !encounters.length || encounters.length > 256)
    throw new TypeError("Invalid discovery encounter batch")
  const state = normalizeUserState(rawState)
  if (state.dictionary_version && state.dictionary_version > dictionary.version)
    throw new Error("Discovery dictionary rollback")
  const replay = state.recent_receipts.find((receipt) => receipt.batch_id === batchId)
  if (replay)
    return { replay: true, state, receipt: { ...replay }, sealed_chunks: [], shared_deltas: [] }

  const sequence = sequencedBatch(batchId)
  const priorDevice = deviceReceiptState(state.recent_receipts, sequence)
  if (sequence) {
    if (priorDevice && sequence.sequence < priorDevice.batch.sequence) {
      return {
        replay: true,
        stale: true,
        state,
        receipt: {
          batch_id: String(batchId),
          state_version: priorDevice.receipt.state_version,
          accepted_events: 0,
          member_count: state.member_count,
          dictionary_version: state.dictionary_version || dictionary.version,
          superseded_by: priorDevice.receipt.batch_id,
        },
        sealed_chunks: [],
        shared_deltas: [],
      }
    }
    const expectedSequence = priorDevice ? priorDevice.batch.sequence + 1 : 1
    if (sequence.sequence !== expectedSequence) {
      throw Object.assign(new Error("Discovery batch sequence gap"), {
        code: "DISCOVERY_BATCH_SEQUENCE_GAP",
        expected_sequence: expectedSequence,
      })
    }
    const knownDevices = new Set(
      state.recent_receipts
        .map((receipt) => sequencedBatch(receipt.batch_id)?.device_id)
        .filter(Boolean),
    )
    if (!priorDevice && knownDevices.size >= DISCOVERY_DEVICE_RECEIPT_LIMIT) {
      throw Object.assign(new Error("Discovery device receipt capacity exceeded"), {
        code: "DISCOVERY_DEVICE_LIMIT",
      })
    }
  }

  const normalized = encounters.map((encounter) => normalizeEncounter(encounter, dictionary))
  const maxOrdinal = Math.max(
    ...normalized.map((event) => event.ordinal),
    dictionary.byOrdinal.size ? Math.max(...dictionary.byOrdinal.keys()) : 0,
  )
  const membership = ensureLength(
    base64ToBytes(state.membership_b64),
    discoveryMembershipByteLength(maxOrdinal),
  )
  const shared = new Map()
  const sealedChunks = []
  let memberCount = state.member_count
  let nextEventSeq = Math.max(1, state.next_event_seq)
  let nextChunkSeq = Math.max(1, state.next_chunk_seq)
  let activeEvents = state.active_events

  for (const event of normalized) {
    const byte = event.ordinal >> 3
    const mask = 1 << (event.ordinal & 7)
    const wasMember = Boolean(membership[byte] & mask)
    if (!wasMember) {
      membership[byte] |= mask
      memberCount += 1
    }
    const prior = shared.get(event.ordinal)
    if (prior) {
      prior.encounters += 1
      prior.latest_at = Math.max(prior.latest_at, event.at)
      prior.first_at = Math.min(prior.first_at, event.at)
      prior.new_member = prior.new_member || !wasMember
    } else {
      shared.set(event.ordinal, {
        ordinal: event.ordinal,
        new_member: !wasMember,
        encounters: 1,
        first_at: event.at,
        latest_at: event.at,
      })
    }
    activeEvents.push({
      seq: nextEventSeq++,
      ordinal: event.ordinal,
      symbol: event.symbol,
      at: event.at,
      source: event.source,
      trigger: event.trigger,
      dwell_ms: event.dwell_ms,
    })
    while (activeEvents.length >= DISCOVERY_CHUNK_EVENTS) {
      const events = activeEvents.slice(0, DISCOVERY_CHUNK_EVENTS)
      activeEvents = activeEvents.slice(DISCOVERY_CHUNK_EVENTS)
      sealedChunks.push({
        schema: "iconoplasm.discoveryChronologyChunk.v1",
        chunk_seq: nextChunkSeq++,
        first_event_seq: events[0].seq,
        last_event_seq: events.at(-1).seq,
        events,
      })
    }
  }

  const nextStateVersion = state.state_version + 1
  const receipt = {
    batch_id: String(batchId),
    state_version: nextStateVersion,
    accepted_events: normalized.length,
    member_count: memberCount,
    dictionary_version: dictionary.version,
    ...(sequence ? { device_id: sequence.device_id, sequence: sequence.sequence } : {}),
  }
  let recentReceipts
  if (sequence) {
    recentReceipts = [
      ...state.recent_receipts.filter(
        (item) => sequencedBatch(item.batch_id)?.device_id !== sequence.device_id,
      ),
      receipt,
    ]
  } else {
    const sequenced = state.recent_receipts.filter((item) => sequencedBatch(item.batch_id))
    const generic = state.recent_receipts
      .filter((item) => !sequencedBatch(item.batch_id) && item.batch_id !== batchId)
      .concat(receipt)
      .slice(-DISCOVERY_RECENT_RECEIPTS)
    recentReceipts = [...sequenced, ...generic]
  }
  const nextState = {
    schema: DISCOVERY_COMPACT_SCHEMA,
    dictionary_version: dictionary.version,
    state_version: nextStateVersion,
    membership_b64: bytesToBase64(membership),
    member_count: memberCount,
    next_event_seq: nextEventSeq,
    next_chunk_seq: nextChunkSeq,
    active_events: activeEvents,
    recent_receipts: recentReceipts,
  }
  return {
    replay: false,
    state: nextState,
    receipt,
    sealed_chunks: sealedChunks,
    shared_deltas: [...shared.values()],
  }
}

function normalizeSharedState(raw = {}) {
  raw = raw || {}
  return {
    schema: "iconoplasm.discoverySharedCompact.v1",
    dictionary_version: Number(raw.dictionary_version || 0),
    state_version: Number(raw.state_version || 0),
    discoverer_counts_b64: String(raw.discoverer_counts_b64 || ""),
    encounter_counts_b64: String(raw.encounter_counts_b64 || ""),
    first_at_b64: String(raw.first_at_b64 || ""),
    latest_at_b64: String(raw.latest_at_b64 || ""),
  }
}

function saturatingAdd(value, increment) {
  return Math.min(0xffffffff, Number(value) + Number(increment)) >>> 0
}

export function applySharedDiscoveryDeltas(rawState, { dictionaryVersion, deltas }) {
  const version = cleanPositiveInt(dictionaryVersion, "dictionary version")
  if (version < 1) throw new TypeError("Invalid dictionary version")
  if (!Array.isArray(deltas) || !deltas.length)
    throw new TypeError("Discovery shared deltas required")
  const state = normalizeSharedState(rawState)
  if (state.dictionary_version && state.dictionary_version > version)
    throw new Error("Discovery dictionary rollback")
  const maxOrdinal = Math.max(
    ...deltas.map((delta) => cleanPositiveInt(delta?.ordinal, "discovery ordinal")),
  )
  const length = maxOrdinal + 1
  const discoverers = ensureUint32Length(base64ToUint32(state.discoverer_counts_b64), length)
  const encounters = ensureUint32Length(base64ToUint32(state.encounter_counts_b64), length)
  const firstAt = ensureUint32Length(base64ToUint32(state.first_at_b64), length)
  const latestAt = ensureUint32Length(base64ToUint32(state.latest_at_b64), length)
  for (const delta of deltas) {
    const ordinal = cleanPositiveInt(delta.ordinal, "discovery ordinal")
    const count = cleanPositiveInt(delta.encounters, "discovery encounter count")
    const first = normalizeEpochSeconds(delta.first_at)
    const latest = normalizeEpochSeconds(delta.latest_at)
    if (delta.new_member) discoverers[ordinal] = saturatingAdd(discoverers[ordinal], 1)
    encounters[ordinal] = saturatingAdd(encounters[ordinal], count)
    firstAt[ordinal] = firstAt[ordinal] ? Math.min(firstAt[ordinal], first) : first
    latestAt[ordinal] = Math.max(latestAt[ordinal], latest)
  }
  return {
    schema: "iconoplasm.discoverySharedCompact.v1",
    dictionary_version: version,
    state_version: state.state_version + 1,
    discoverer_counts_b64: uint32ToBase64(discoverers),
    encounter_counts_b64: uint32ToBase64(encounters),
    first_at_b64: uint32ToBase64(firstAt),
    latest_at_b64: uint32ToBase64(latestAt),
  }
}

// Full ordinal summaries for read models and repairs. One compact shared row
// yields every non-zero discoverer entry without touching per-user rows.
export function readSharedDiscoveryOrdinalSummaries(rawState) {
  const state = normalizeSharedState(rawState)
  const discoverers = base64ToUint32(state.discoverer_counts_b64)
  const encounters = base64ToUint32(state.encounter_counts_b64)
  const firstAt = base64ToUint32(state.first_at_b64)
  const latestAt = base64ToUint32(state.latest_at_b64)
  const length = Math.max(discoverers.length, encounters.length, firstAt.length, latestAt.length)
  const summaries = []
  for (let ordinal = 0; ordinal < length; ordinal++) {
    if (!discoverers[ordinal]) continue
    summaries.push({
      ordinal,
      discoverer_count: discoverers[ordinal],
      encounter_count: encounters[ordinal] || 0,
      first_at: firstAt[ordinal] || 0,
      latest_at: latestAt[ordinal] || 0,
    })
  }
  return summaries
}

export function readSharedDiscoveryOrdinal(rawState, ordinal) {
  const cleanOrdinal = cleanPositiveInt(ordinal, "discovery ordinal")
  const state = normalizeSharedState(rawState)
  const arrays = [
    base64ToUint32(state.discoverer_counts_b64),
    base64ToUint32(state.encounter_counts_b64),
    base64ToUint32(state.first_at_b64),
    base64ToUint32(state.latest_at_b64),
  ]
  return {
    discoverer_count: arrays[0][cleanOrdinal] || 0,
    encounter_count: arrays[1][cleanOrdinal] || 0,
    first_at: arrays[2][cleanOrdinal] || 0,
    latest_at: arrays[3][cleanOrdinal] || 0,
  }
}
