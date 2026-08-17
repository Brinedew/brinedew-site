;(function (root) {
  "use strict"

  const records = new Map()
  const MAX_AGE_MS = 10 * 60 * 1000

  function prune(now = Date.now()) {
    for (const [id, record] of records) {
      if (now - record.createdAt > MAX_AGE_MS) records.delete(id)
    }
  }

  function create(metadata) {
    prune()
    const id = crypto.randomUUID()
    records.set(id, {
      createdAt: Date.now(),
      metadata: Object.freeze({ ...(metadata || {}) }),
      parts: [],
      bytes: null,
      size: 0,
    })
    return id
  }

  function append(id, value) {
    const record = records.get(id)
    if (!record || record.bytes) throw new Error("PDF byte record is unavailable or sealed")
    const part = value instanceof Uint8Array ? value.slice() : new Uint8Array(value).slice()
    record.parts.push(part)
    record.size += part.byteLength
  }

  function seal(id) {
    const record = records.get(id)
    if (!record) throw new Error("PDF byte record is unavailable")
    if (record.bytes) return record.size
    const bytes = new Uint8Array(record.size)
    let offset = 0
    for (const part of record.parts) {
      bytes.set(part, offset)
      offset += part.byteLength
    }
    record.parts = []
    record.bytes = bytes
    return record.size
  }

  function describe(id) {
    const record = records.get(id)
    if (!record?.bytes) return null
    return { id, size: record.size, metadata: record.metadata }
  }

  function read(id, offset, length) {
    const record = records.get(id)
    if (!record?.bytes) return null
    const start = Math.max(0, Number(offset) || 0)
    const end = Math.min(record.size, start + Math.max(0, Number(length) || 0))
    return record.bytes.slice(start, end).buffer
  }

  function dispose(id) {
    return records.delete(id)
  }

  root.IconoplasmPdfByteStore = Object.freeze({ create, append, seal, describe, read, dispose })
})(globalThis)
