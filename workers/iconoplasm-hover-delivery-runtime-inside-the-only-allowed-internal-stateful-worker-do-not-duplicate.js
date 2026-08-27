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
    if (value?.storage !== "kv_card_catalog_content_addressed_shards") return null
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
      for (const version of await versions(env)) {
        const refs = ranges(await manifest(env, version))
        const ref = refs?.find(
          (ref) =>
            ref.content_hash === hash && symbol >= ref.first_symbol && symbol <= ref.last_symbol,
        )
        if (ref) {
          selected = ref
          selectedVersion = version
          break
        }
      }
      if (!selected) return failure("card_snapshot_retired", 410)
      const raw = await shard(env, selectedVersion, selected, true)
      const card = raw?.cards?.find((card) => card.symbol === symbol)
      if (!card || !complete(card)) return failure("card_content_unavailable")
      // The shard hash deliberately excludes these fields. Exclude them from
      // transport too, so a reused hash cannot carry an old publication epoch.
      const value = stable(card)
      const record = lane === "genes" ? project(value.payload, null) : stable(locator(value, ""))
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
