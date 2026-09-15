;(function (root) {
  "use strict"

  const STATE_SCHEMA = "iconoplasm.discoveryClientQueue.v1"
  const DEFAULT_STATE_KEY = "iconoplasm_discovery_client_queue_v1"
  const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/
  const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

  function normalizeEncounter(raw) {
    const symbol = String(raw?.symbol || "")
      .trim()
      .toUpperCase()
    if (!SYMBOL.test(symbol)) throw new TypeError("Invalid discovery symbol")
    const at = Math.floor(Number(raw?.at))
    if (!Number.isFinite(at) || at < 0 || at > 0xffffffff)
      throw new TypeError("Invalid discovery timestamp")
    return {
      symbol,
      at,
      source: String(raw?.source || "").slice(0, 80),
      trigger: String(raw?.trigger || "").slice(0, 80),
      dwell_ms:
        raw?.dwell_ms == null
          ? null
          : Math.max(0, Math.min(86_400_000, Math.floor(Number(raw.dwell_ms) || 0))),
    }
  }

  function normalizeState(raw, makeDeviceId) {
    const value = raw && typeof raw === "object" ? raw : {}
    const deviceId = DEVICE_ID.test(String(value.device_id || ""))
      ? String(value.device_id)
      : String(makeDeviceId())
    if (!DEVICE_ID.test(deviceId)) throw new TypeError("Invalid discovery device id")
    const nextSequence = Number(value.next_sequence || 1)
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1)
      throw new TypeError("Invalid discovery queue sequence")
    const pending = Array.isArray(value.pending) ? value.pending.map(normalizeEncounter) : []
    let inflight = null
    if (value.inflight && typeof value.inflight === "object") {
      const sequence = Number(value.inflight.sequence)
      const batchId = String(value.inflight.batch_id || "")
      const expectedBatchId = `${deviceId}:${sequence}`
      if (
        !Number.isSafeInteger(sequence) ||
        sequence < 1 ||
        batchId !== expectedBatchId ||
        !Array.isArray(value.inflight.encounters) ||
        !value.inflight.encounters.length
      )
        throw new TypeError("Invalid discovery inflight batch")
      inflight = {
        sequence,
        batch_id: batchId,
        encounters: value.inflight.encounters.map(normalizeEncounter),
      }
    }
    return {
      schema: STATE_SCHEMA,
      device_id: deviceId,
      next_sequence: nextSequence,
      pending,
      inflight,
    }
  }

  function createDiscoveryBatchQueue({
    storage,
    sendBatch,
    stateKey = DEFAULT_STATE_KEY,
    maxBatchSize = 64,
    maxPending = 4096,
    makeDeviceId = () => {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    },
  } = {}) {
    if (!storage?.get || !storage?.set) throw new TypeError("Discovery queue storage is required")
    if (typeof sendBatch !== "function") throw new TypeError("Discovery queue sender is required")
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 256)
      throw new TypeError("Invalid discovery batch size")
    if (!Number.isInteger(maxPending) || maxPending < maxBatchSize || maxPending > 65536)
      throw new TypeError("Invalid discovery pending bound")

    let serial = Promise.resolve()
    const exclusive = (task) => {
      const run = serial.then(task, task)
      serial = run.catch(() => {})
      return run
    }
    async function load() {
      const stored = await storage.get([stateKey])
      return normalizeState(stored?.[stateKey], makeDeviceId)
    }
    async function save(state) {
      await storage.set({ [stateKey]: state })
      return state
    }
    async function ensurePersisted() {
      const state = await load()
      await save(state)
      return state
    }

    async function enqueue(rawEncounter) {
      const encounter = normalizeEncounter(rawEncounter)
      return exclusive(async () => {
        const state = await load()
        if (state.pending.length >= maxPending)
          throw Object.assign(new Error("Discovery queue capacity exceeded"), {
            code: "DISCOVERY_QUEUE_FULL",
          })
        state.pending.push(encounter)
        await save(state)
        return {
          queued: true,
          pending: state.pending.length,
          inflight: Boolean(state.inflight),
          device_id: state.device_id,
        }
      })
    }

    async function flush({ maxBatches = 1 } = {}) {
      if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 64)
        throw new TypeError("Invalid discovery flush batch bound")
      return exclusive(async () => {
        let sent = 0
        let acknowledged = 0
        let state = await load()
        for (let index = 0; index < maxBatches; index++) {
          if (!state.inflight) {
            if (!state.pending.length) break
            const sequence = state.next_sequence
            const encounters = state.pending.splice(0, maxBatchSize)
            state.inflight = {
              sequence,
              batch_id: `${state.device_id}:${sequence}`,
              encounters,
            }
            state.next_sequence += 1
            // The batch identity and bytes are durable before the network call.
            await save(state)
          }
          const batch = structuredClone(state.inflight)
          let receipt
          try {
            sent += 1
            receipt = await sendBatch(batch)
          } catch (error) {
            return {
              ok: false,
              error,
              sent,
              acknowledged,
              batch_id: batch.batch_id,
              pending: state.pending.length,
            }
          }
          if (
            !receipt ||
            receipt.ok !== true ||
            String(receipt.batch_id || "") !== batch.batch_id
          ) {
            return {
              ok: false,
              error: new Error("Discovery batch receipt identity mismatch"),
              sent,
              acknowledged,
              batch_id: batch.batch_id,
              pending: state.pending.length,
            }
          }
          state = await load()
          if (!state.inflight || state.inflight.batch_id !== batch.batch_id)
            throw new Error("Discovery queue inflight identity changed during send")
          state.inflight = null
          acknowledged += 1
          await save(state)
        }
        return {
          ok: true,
          sent,
          acknowledged,
          pending: state.pending.length,
          inflight: Boolean(state.inflight),
        }
      })
    }

    async function status() {
      return exclusive(async () => {
        const state = await ensurePersisted()
        return {
          device_id: state.device_id,
          next_sequence: state.next_sequence,
          pending: state.pending.length,
          inflight_batch_id: state.inflight?.batch_id || null,
          inflight_size: state.inflight?.encounters.length || 0,
        }
      })
    }

    return { enqueue, flush, status }
  }

  root.IconoplasmDiscoveryBatchQueue = {
    createDiscoveryBatchQueue,
    normalizeEncounter,
    stateSchema: STATE_SCHEMA,
    defaultStateKey: DEFAULT_STATE_KEY,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
