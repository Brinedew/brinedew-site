import { publishedCardObjectKey } from "./lib/iconoplasm-published-card-objects.js"

// ARCHITECTURE FENCE [IPD-008] + [IPD-011]: transport projections, not a
// publisher. The existing gallery barrier admits hashes; unchanged hashes
// survive votes. Never add D1 selection, a second pointer, or reader writes.
const HASH = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const IMMUTABLE = "public, max-age=31536000, immutable"

export function createHoverDeliveryHandlers({
  barrier,
  manifest,
  shard,
  object,
  complete,
  stable,
  project,
  locator,
  json,
}) {
  const failure = (code, status = 503) => json({ code }, status, { "Cache-Control": "no-store" })
  const versions = async (env) => {
    const value = await barrier(env)
    return [...new Set([value.current, value.previous].filter(Boolean))]
  }
  function ranges(value) {
    if (
      !["kv_card_catalog_content_addressed_shards", "bunny_card_catalog_v2"].includes(
        value?.storage,
      )
    )
      return null
    const refs = value.shards
    if (!Array.isArray(refs) || !refs.length || refs.length > 64) return null
    let previous = ""
    for (const ref of refs) {
      if (
        !HASH.test(ref.content_hash) ||
        !SYMBOL.test(ref.first_symbol) ||
        !SYMBOL.test(ref.last_symbol) ||
        ref.first_symbol > ref.last_symbol ||
        (previous && ref.first_symbol <= previous)
      )
        return null
      previous = ref.last_symbol
    }
    return refs
  }

  async function bunnyRecord(env, ref, lane, symbol) {
    // Released 0.5.3 speaks the v1 envelope even when the publisher uses v2.
    // The admitted shard hash is a range identity, NOT a request for its bytes.
    // Read one small directory and the exact lane object; a slow rich card must
    // not become a prerequisite for the independently stored portrait locator.
    const directoryRef = ref.delivery_indexes?.find(
      (index) => symbol >= index.first_symbol && symbol <= index.last_symbol,
    )
    if (
      !/^published-cards\/v2\/immutable\/indexes\/[a-f0-9]{64}\.json$/.test(directoryRef?.key || "")
    )
      return null
    const directory = await object(
      env,
      directoryRef.key,
      (value) =>
        value?.schema_version === 2 && Array.isArray(value.entries) && value.entries.length <= 128,
    )
    const entry = directory?.entries?.find((entry) => Array.isArray(entry) && entry[0] === symbol)
    const hash = entry?.[lane === "genes" ? 2 : 3]
    if (entry?.length !== 4 || !HASH.test(hash || "")) return null
    return object(env, publishedCardObjectKey(lane, hash), (value) => value?.symbol === symbol)
  }
  return {
    async index({ env, match }) {
      const version = match.params.snapshot
      if (!(await versions(env)).includes(version)) return failure("card_snapshot_retired", 410)
      const refs = ranges(await manifest(env, version))
      if (!refs) return failure("card_delivery_index_unavailable")
      // Separate from the <=4 KiB scanner manifest; fetched only on demand,
      // shared across both lanes/tabs, and never includes portraits or cards.
      return json(
        {
          schema_version: 1,
          snapshot_version: version,
          ranges: refs.map((ref) => [ref.first_symbol, ref.last_symbol, ref.content_hash]),
        },
        200,
        { "Cache-Control": IMMUTABLE },
      )
    },
    async content({ request, env, ctx, match }) {
      const { hash, lane, symbol } = match.params
      if (!HASH.test(hash) || !SYMBOL.test(symbol) || !["genes", "portraits"].includes(lane)) {
        return failure("invalid_card_content_path", 400)
      }
      const cache = globalThis.caches?.default
      const url = new URL(request.url)
      url.search = ""
      const key = new Request(url, { method: "GET" })
      const cached = await cache?.match(key)
      if (cached) return cached
      // Only published hashes can fill a cache. An immutable cached response
      // remains valid as historical content, just like the browser HTTP cache.
      let selected = null
      let selectedVersion = null
      let selectedStorage = null
      for (const version of await versions(env)) {
        const catalog = await manifest(env, version)
        const refs = ranges(catalog)
        const ref = refs?.find(
          (ref) =>
            ref.content_hash === hash && symbol >= ref.first_symbol && symbol <= ref.last_symbol,
        )
        if (ref) {
          selected = ref
          selectedVersion = version
          selectedStorage = catalog.storage
          break
        }
      }
      if (!selected) return failure("card_snapshot_retired", 410)
      let record
      if (selectedStorage === "bunny_card_catalog_v2") {
        record = await bunnyRecord(env, selected, lane, symbol)
      } else {
        const raw = await shard(env, selectedVersion, selected, true)
        const card = raw?.cards?.find((card) => card.symbol === symbol)
        if (!card || !complete(card)) return failure("card_content_unavailable")
        // The shard hash excludes publication epochs; so must its projection.
        const value = stable(card)
        record = lane === "genes" ? project(value.payload, null) : stable(locator(value, ""))
      }
      if (!record) return failure("card_content_unavailable")
      const response = json({ schema_version: 1, content_hash: hash, symbol, lane, record }, 200, {
        "Cache-Control": IMMUTABLE,
        ETag: `"hover-v1-${hash}-${lane}-${symbol}"`,
        "X-Iconoplasm-Data-Source": "published-card-content",
      })
      if (cache) ctx?.waitUntil?.(cache.put(key, response.clone()))
      return response
    },
  }
}
