;(function (root) {
  "use strict"
  // ARCHITECTURE FENCE [IPD-008] + [IPD-011]: this is byte delivery only.
  // The snapshot's existing shard hash selects content. Never elect a portrait,
  // fetch whole card shards, or let one tab's CDN failure disable other tabs.
  const ORIGIN = "https://iconoplasm.brinedew.bio"
  const CDN = "https://iconoplasmportraits.b-cdn.net"
  const HASH = /^[a-f0-9]{64}$/
  const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

  function createMetadataDelivery({
    fetchImpl,
    hedgeMs = 350,
    indexTimeoutMs = 800,
    sourceTimeoutMs = 2500,
  } = {}) {
    const indexes = new Map()
    const pendingIndexes = new Map()
    const failedIndexes = new Map()
    const objects = new Map()
    const pendingObjects = new Map()
    const tabs = new Map()
    const boundedSet = (map, key, value, limit) => {
      map.delete(key)
      map.set(key, value)
      while (map.size > limit) map.delete(map.keys().next().value)
    }
    const abortError = () =>
      Object.assign(new Error("Metadata request aborted"), { name: "AbortError" })
    function abortable(promise, signal) {
      if (!signal) return promise
      return new Promise((resolve, reject) => {
        const abort = () => reject(abortError())
        if (signal.aborted) {
          abort()
          return
        }
        signal.addEventListener("abort", abort, { once: true })
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      })
    }
    async function readJson(url, init, limit, expectedHash = "") {
      const response = await fetchImpl(url, init)
      if (!response.ok) throw new Error(`Metadata HTTP ${response.status}`)
      const reader = response.body?.getReader?.()
      let text = ""
      if (reader) {
        const decoder = new TextDecoder()
        let bytes = 0
        try {
          for (;;) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > limit) throw new Error("Metadata body exceeds limit")
            text += decoder.decode(chunk.value, { stream: true })
          }
          text += decoder.decode()
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      } else {
        text = await response.text()
        if (new TextEncoder().encode(text).byteLength > limit)
          throw new Error("Metadata body exceeds limit")
      }
      if (expectedHash) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
        const actual = [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
        if (actual !== expectedHash) throw new Error("Metadata content hash mismatch")
      }
      return JSON.parse(text)
    }
    async function indexFor(version, headers) {
      if (indexes.has(version)) return indexes.get(version)
      if ((failedIndexes.get(version) || 0) > Date.now()) return null
      if (pendingIndexes.has(version)) return pendingIndexes.get(version)
      if (pendingIndexes.size >= 2) return null
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), indexTimeoutMs)
      const promise = (async () => {
        try {
          const data = await abortable(
            readJson(
              `${ORIGIN}/api/public/v1/card-snapshots/${version}/delivery-index`,
              { headers, credentials: "omit", signal: controller.signal },
              16384,
            ),
            controller.signal,
          )
          if (
            data?.schema_version !== 1 ||
            data.snapshot_version !== version ||
            !Array.isArray(data.ranges) ||
            !data.ranges.length ||
            data.ranges.length > 64
          )
            return null
          let previous = ""
          for (const range of data.ranges) {
            if (
              !Array.isArray(range) ||
              range.length !== 3 ||
              !SYMBOL.test(range[0]) ||
              !SYMBOL.test(range[1]) ||
              !HASH.test(range[2]) ||
              range[0] > range[1] ||
              (previous && range[0] <= previous)
            )
              return null
            previous = range[1]
          }
          boundedSet(indexes, version, data, 2)
          return data
        } catch {
          return null
        } finally {
          clearTimeout(timer)
          pendingIndexes.delete(version)
        }
      })()
      pendingIndexes.set(version, promise)
      const result = await promise
      if (!result) boundedSet(failedIndexes, version, Date.now() + 30000, 2)
      return result
    }
    function fromEitherSource(
      path,
      headers,
      signal,
      tab,
      validate,
      { limit = 65536, hash = "" } = {},
    ) {
      return new Promise((resolve, reject) => {
        let settled = false
        // Another lane may update the tab while this race is running. Its result
        // must not change how many sources this request is waiting for.
        const canonicalOnly = tabs.get(tab) === ORIGIN
        let canonicalStarted = false
        let failures = 0
        let hedge
        const controllers = []
        const finish = (error, value, source) => {
          if (settled) return
          settled = true
          clearTimeout(hedge)
          signal?.removeEventListener("abort", onAbort)
          for (const controller of controllers) controller.abort()
          if (source) boundedSet(tabs, tab, source, 128)
          if (error) reject(error)
          else resolve(value)
        }
        const onAbort = () => finish(abortError())
        const start = async (origin) => {
          if (settled || (origin === ORIGIN && canonicalStarted)) return
          if (origin === ORIGIN) canonicalStarted = true
          const controller = new AbortController()
          controllers.push(controller)
          const timer = setTimeout(() => controller.abort(), sourceTimeoutMs)
          try {
            const value = await abortable(
              readJson(
                origin + path,
                { headers, credentials: "omit", signal: controller.signal },
                limit,
                hash,
              ),
              controller.signal,
            )
            if (!validate(value)) throw new Error("Metadata identity mismatch")
            finish(null, value, origin)
          } catch (error) {
            if (settled) return
            failures += 1
            if (origin === CDN) start(ORIGIN)
            if (failures >= (canonicalOnly ? 1 : 2)) finish(error)
          } finally {
            clearTimeout(timer)
          }
        }
        if (signal?.aborted) {
          onAbort()
          return
        }
        signal?.addEventListener("abort", onAbort, { once: true })
        if (canonicalOnly) start(ORIGIN)
        else {
          hedge = setTimeout(() => start(ORIGIN), hedgeMs)
          start(CDN)
        }
      })
    }
    async function immutableObject(kind, hash, signal, tab) {
      if (!HASH.test(hash)) throw new Error("Invalid metadata object hash")
      const key = `${kind}/${hash}`
      if (objects.has(key)) return objects.get(key)
      let pending = pendingObjects.get(key)
      if (!pending) {
        if (pendingObjects.size >= 32) throw new Error("Metadata concurrency limit")
        const controller = new AbortController()
        pending = { controller, users: 0, promise: null }
        pending.promise = fromEitherSource(
          `/published-cards/v2/immutable/${key}.json`,
          {},
          controller.signal,
          tab,
          (value) => Boolean(value && typeof value === "object"),
          { hash },
        )
          .then((value) => {
            if (kind === "manifests" || kind === "indexes") boundedSet(objects, key, value, 16)
            return value
          })
          .finally(() => {
            if (pendingObjects.get(key) === pending) pendingObjects.delete(key)
          })
        pendingObjects.set(key, pending)
      }
      pending.users++
      try {
        return await abortable(pending.promise, signal)
      } finally {
        pending.users--
        if (pending.users === 0) pending.controller.abort()
      }
    }
    const objectHash = (key, kind) => {
      const match = String(key || "").match(
        new RegExp(`^published-cards/v2/immutable/${kind}/([a-f0-9]{64})\\.json$`),
      )
      if (!match) throw new Error("Invalid metadata object key")
      return match[1]
    }
    async function v2Record(version, lane, symbol, signal, tab) {
      const root = await immutableObject("manifests", version.slice(5), signal, tab)
      if (
        root.storage !== "bunny_card_catalog_v2" ||
        !Array.isArray(root.shards) ||
        root.shards.length > 64
      )
        throw new Error("Invalid card manifest")
      const shard = root.shards.find(
        (ref) => symbol >= ref.first_symbol && symbol <= ref.last_symbol,
      )
      const index = shard?.delivery_indexes?.find(
        (ref) => symbol >= ref.first_symbol && symbol <= ref.last_symbol,
      )
      if (!index) return null
      const directory = await immutableObject(
        "indexes",
        objectHash(index.key, "indexes"),
        signal,
        tab,
      )
      if (
        directory.schema_version !== 2 ||
        !Array.isArray(directory.entries) ||
        directory.entries.length > 128
      )
        throw new Error("Invalid card directory")
      const entry = directory.entries.find((entry) => entry[0] === symbol)
      if (!entry || entry.length !== 4) return null
      const value = await immutableObject(lane, entry[lane === "genes" ? 2 : 3], signal, tab)
      if (value.symbol !== symbol) throw new Error("Card symbol mismatch")
      return value
    }
    const envelope = (version, lane, record) =>
      new Response(
        JSON.stringify({
          snapshot_version: version,
          canonical_key: "symbol",
          [lane === "genes" ? "gene" : "portrait_locator"]:
            lane === "portraits" ? { ...record, snapshot_version: version } : record,
          missing: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    return {
      async current(tab, signal) {
        // Connectivity is reconsidered on a new article/reload (including a
        // newly enabled VPN), but never retried on every hover in that article.
        tabs.delete(tab)
        try {
          return await fromEitherSource(
            "/api/public/v1/card-current",
            {},
            signal,
            tab,
            (value) =>
              value?.schema_version === 2 && /^[A-Za-z0-9._:-]{1,100}$/.test(value.current),
            { limit: 1024 },
          )
        } catch {
          return null
        }
      },
      forgetTab(tab) {
        tabs.delete(tab)
      },
      async fetch(url, init, tab) {
        const parsed = new URL(url)
        const match = parsed.pathname.match(
          /^\/api\/public\/v1\/card-snapshots\/([A-Za-z0-9._:-]+)\/(genes|portraits)\/([A-Z0-9][A-Z0-9._-]{0,63})$/,
        )
        if (
          parsed.origin !== ORIGIN ||
          !match ||
          parsed.search ||
          (init.method || "GET") !== "GET" ||
          init.credentials === "include" ||
          init.body ||
          new Headers(init.headers).has("Authorization")
        )
          return null
        const [, version, lane, symbol] = match
        if (/^ccv2-[a-f0-9]{64}$/.test(version)) {
          try {
            const record = await v2Record(version, lane, symbol, init.signal, tab)
            return record ? envelope(version, lane, record) : null
          } catch (error) {
            if (init.signal?.aborted) throw abortError()
            return null
          }
        }
        const headers = {
          "X-Iconoplasm-Extension-Version":
            new Headers(init.headers).get("X-Iconoplasm-Extension-Version") || "",
        }
        const index = await abortable(indexFor(version, headers), init.signal)
        if (init.signal?.aborted) throw abortError()
        const range = index?.ranges.find(([first, last]) => symbol >= first && symbol <= last)
        if (!range) return null
        const hash = range[2]
        try {
          const data = await fromEitherSource(
            `/api/public/v1/card-content/v1/${hash}/${lane}/${symbol}`,
            headers,
            init.signal,
            tab,
            (data) =>
              data?.schema_version === 1 &&
              data.content_hash === hash &&
              data.symbol === symbol &&
              data.lane === lane &&
              data.record?.symbol === symbol &&
              (lane !== "portraits" || HASH.test(data.record.portrait?.asset_sha256 || "")),
          )
          const record =
            lane === "portraits" ? { ...data.record, snapshot_version: version } : data.record
          return new Response(
            JSON.stringify({
              snapshot_version: version,
              canonical_key: "symbol",
              [lane === "genes" ? "gene" : "portrait_locator"]: record,
              missing: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        } catch (error) {
          if (init.signal?.aborted) throw abortError()
          return null // Existing exact-snapshot recovery remains authoritative.
        }
      },
    }
  }
  root.IconoplasmMetadataDelivery = { createMetadataDelivery }
})(typeof globalThis !== "undefined" ? globalThis : this)
