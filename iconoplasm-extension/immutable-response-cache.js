;(function (root) {
  "use strict"

  // One exact read retrieves bytes. A separate metadata record tracks recency;
  // reading an image never rewrites its blob or hydrates the whole collection.
  function createPersistentStore(name, factory, maxEntries, maxBytes) {
    let opening
    function database() {
      if (opening) return opening
      opening = new Promise((resolve, reject) => {
        if (!factory) return reject(new Error("IndexedDB unavailable"))
        const request = factory.open("iconoplasm-immutable:" + name, 1)
        let blocked = false
        request.onblocked = () => {
          blocked = true
          reject(new Error("Immutable cache database upgrade blocked"))
        }
        request.onerror = () => reject(request.error)
        request.onupgradeneeded = () => {
          const db = request.result
          db.createObjectStore("payloads")
          db.createObjectStore("entries", { keyPath: "key" }).createIndex(
            "lastAccess",
            "lastAccess",
          )
          db.createObjectStore("state")
        }
        request.onsuccess = () => {
          const db = request.result
          if (blocked) {
            db.close()
            return
          }
          db.onversionchange = () => {
            db.close()
            opening = null
          }
          resolve(db)
        }
      }).catch((error) => {
        opening = null
        throw error
      })
      return opening
    }
    async function transaction(stores, mode, run) {
      const db = await database()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode)
        let result
        tx.oncomplete = () => resolve(result)
        tx.onabort = () => reject(tx.error || new Error("Immutable cache transaction aborted"))
        tx.onerror = () => reject(tx.error)
        try {
          run(tx, (value) => {
            result = value
          })
        } catch (error) {
          tx.abort()
          reject(error)
        }
      })
    }
    function totals(tx, callback) {
      const request = tx.objectStore("state").get("totals")
      request.onsuccess = () => callback(request.result || { bytes: 0, count: 0, sequence: 0 })
    }
    return {
      get(key) {
        return transaction(["payloads"], "readonly", (tx, done) => {
          const request = tx.objectStore("payloads").get(key)
          request.onsuccess = () => done(request.result || null)
        })
      },
      touch(key) {
        return transaction(["entries", "state"], "readwrite", (tx) => {
          totals(tx, (state) => {
            const entries = tx.objectStore("entries")
            const request = entries.get(key)
            request.onsuccess = () => {
              if (!request.result) return
              entries.put({ ...request.result, lastAccess: ++state.sequence })
              tx.objectStore("state").put(state, "totals")
            }
          })
        })
      },
      put(key, body, contentType) {
        return transaction(["payloads", "entries", "state"], "readwrite", (tx) => {
          const entries = tx.objectStore("entries")
          const payloads = tx.objectStore("payloads")
          const stateStore = tx.objectStore("state")
          totals(tx, (state) => {
            const previous = entries.get(key)
            previous.onsuccess = () => {
              state.bytes += body.byteLength - (previous.result?.bytes || 0)
              if (!previous.result) state.count++
              payloads.put({ body, contentType }, key)
              entries.put({ key, bytes: body.byteLength, lastAccess: ++state.sequence })
              if (state.bytes <= maxBytes && state.count <= maxEntries) {
                stateStore.put(state, "totals")
                return
              }
              // Eviction and byte accounting commit atomically with the new
              // payload. Only the small recency index is traversed.
              const oldest = entries.index("lastAccess").openCursor()
              oldest.onsuccess = () => {
                const cursor = oldest.result
                if (!cursor || (state.bytes <= maxBytes && state.count <= maxEntries)) {
                  stateStore.put(state, "totals")
                  return
                }
                if (cursor.primaryKey !== key) {
                  state.bytes -= cursor.value.bytes
                  state.count--
                  payloads.delete(cursor.primaryKey)
                  cursor.delete()
                }
                cursor.continue()
              }
            }
          })
        })
      },
    }
  }

  function createImmutableResponseCache({
    name,
    maxEntries,
    maxEntryBytes,
    maxBytes = maxEntries * maxEntryBytes,
    memoryEntries = 48,
    indexedDB = root.indexedDB,
    legacyStorage = root.caches,
  }) {
    if (
      !name ||
      ![maxEntries, maxEntryBytes, maxBytes, memoryEntries].every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ) ||
      maxEntryBytes > maxBytes
    )
      throw new Error("Invalid immutable cache budget")
    const memory = new Map()
    const persistent = createPersistentStore(name, indexedDB, maxEntries, maxBytes)
    const remember = (key, response) => {
      memory.delete(key)
      memory.set(key, response)
      while (memory.size > memoryEntries) memory.delete(memory.keys().next().value)
    }
    const touch = (key) => {
      return persistent.touch(key).catch(() => {})
    }
    async function put(key, bytes, contentType) {
      if (!bytes.byteLength || bytes.byteLength > maxEntryBytes) return false
      const body = new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes)
      remember(key, new Response(body, { headers: { "Content-Type": contentType } }))
      try {
        await persistent.put(key, body, contentType)
        return true
      } catch {
        // Quota/storage failure keeps the bounded in-memory copy. A failed
        // transaction cannot evict old records or corrupt the byte total.
        return false
      }
    }
    return {
      clearMemory() {
        memory.clear()
      },
      touch,
      async get(key) {
        const inMemory = memory.get(key)
        if (inMemory) {
          remember(key, inMemory)
          void touch(key)
          return inMemory.clone()
        }
        try {
          const saved = await persistent.get(key)
          if (saved) {
            const response = new Response(saved.body, {
              headers: { "Content-Type": saved.contentType },
            })
            remember(key, response)
            void touch(key)
            return response.clone()
          }
        } catch {
          // Storage availability never changes canonical identity.
        }
        try {
          // Migrate the exact existing Cache Storage record lazily. Do not
          // discard saved bytes on upgrade or block display on the new write.
          const legacy = await legacyStorage?.open(name)
          const response = await legacy?.match(key)
          if (response) {
            remember(key, response.clone())
            void response
              .clone()
              .arrayBuffer()
              .then(async (body) => {
                if (
                  await put(
                    key,
                    body,
                    response.headers.get("Content-Type") || "application/octet-stream",
                  )
                )
                  await legacy.delete(key)
              })
              .catch(() => {})
            return response
          }
        } catch {
          // An absent/evicted record is a miss, not a cached error.
        }
        return null
      },
      put,
    }
  }

  root.IconoplasmImmutableResponseCache = { createImmutableResponseCache }
})(typeof globalThis !== "undefined" ? globalThis : this)
