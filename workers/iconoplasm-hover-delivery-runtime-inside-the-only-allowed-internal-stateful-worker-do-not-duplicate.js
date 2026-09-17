import { publishedCardObjectKey } from "./lib/iconoplasm-published-card-objects.js"
import {
  parsePublishedViewId,
  readAdvertisedGeneDeltaView,
  readGeneDeltaChain,
} from "./lib/iconoplasm-card-reader-view.js"

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
  const readObject = (env) => (key, validate) => object(env, key, validate)
  const laneReceipt = { genes: "gene", portraits: "portrait" }
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
  async function baseRecord(env, version, catalog, ref, lane, symbol) {
    if (catalog.storage === "bunny_card_catalog_v2") {
      return bunnyRecord(env, ref, lane, symbol)
    }
    const raw = await shard(env, version, ref, true)
    const card = raw?.cards?.find((card) => card.symbol === symbol)
    if (!card || !complete(card)) return null
    // The shard hash excludes publication epochs; so must its projection.
    const value = stable(card)
    return lane === "genes" ? project(value.payload, null) : stable(locator(value, ""))
  }

  async function baseRefFor(env, version, symbol) {
    const catalog = await manifest(env, version)
    const refs = ranges(catalog)
    const ref = refs?.find((ref) => symbol >= ref.first_symbol && symbol <= ref.last_symbol)
    return ref ? { catalog, ref } : null
  }

  return {
    async index({ env, match }) {
      const version = match.params.snapshot
      const view = parsePublishedViewId(version)
      const published = await versions(env)
      if (view.chainHash) {
        // A delta view's ranges all carry the exact chain hash: per-symbol
        // content resolution server-side, never a second selection pointer.
        const chain = await readGeneDeltaChain({
          readObject: readObject(env),
          chainHash: view.chainHash,
          base: view.base,
        })
        if (!chain.ok) {
          // B-762: an immutable object that is missing from every read source
          // for the requested view is an availability failure, not a retired
          // identity. Only a structurally invalid id/chain relationship is
          // permanently gone. Temporary failures are no-store 503.
          const retired = chain.code === "CHAIN_INVALID" || chain.code === "CHAIN_BASE_MISMATCH"
          return retired
            ? failure("card_snapshot_retired", 410)
            : failure("card_delivery_index_unavailable")
        }
        if (!published.includes(chain.chain.base)) return failure("card_snapshot_retired", 410)
        const refs = ranges(await manifest(env, chain.chain.base))
        if (!refs) return failure("card_delivery_index_unavailable")
        return json(
          {
            schema_version: 1,
            snapshot_version: version,
            ranges: refs.map((ref) => [ref.first_symbol, ref.last_symbol, view.chainHash]),
          },
          200,
          { "Cache-Control": IMMUTABLE },
        )
      }
      if (!published.includes(version)) return failure("card_snapshot_retired", 410)
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
      const published = await versions(env)
      let record = null
      let selected = null
      let selectedVersion = null
      let selectedCatalog = null
      for (const version of published) {
        const catalog = await manifest(env, version)
        const refs = ranges(catalog)
        const ref = refs?.find(
          (ref) =>
            ref.content_hash === hash && symbol >= ref.first_symbol && symbol <= ref.last_symbol,
        )
        if (ref) {
          selected = ref
          selectedVersion = version
          selectedCatalog = catalog
          break
        }
      }
      if (selected) {
        record = await baseRecord(env, selectedVersion, selectedCatalog, selected, lane, symbol)
      } else {
        // The hash is not a published base shard hash, so it must name this
        // view's exact immutable chain. Newer-wins wins over segments and
        // tombstones survive; untouched symbols keep the exact base content of
        // the chain's named base epoch.
        const chain = await readGeneDeltaChain({
          readObject: readObject(env),
          chainHash: hash,
          base: null,
        })
        if (!chain.ok) {
          // B-762: a missing immutable object is temporary for the currently
          // advertised view's exact chain. An unknown hash that is not the
          // advertised dependency and never resolves stays retired.
          const advertised = await readAdvertisedGeneDeltaView(env)
          const advertisedChain = advertised
            ? parsePublishedViewId(advertised.view).chainHash
            : null
          const availability =
            chain.code === "CHAIN_READ_FAILED" ||
            chain.code === "SEGMENT_READ_FAILED" ||
            chain.code === "SEGMENT_UNAVAILABLE" ||
            (chain.code === "CHAIN_UNAVAILABLE" && advertisedChain === hash)
          return availability
            ? failure("card_content_unavailable")
            : failure("card_snapshot_retired", 410)
        }
        if (!published.includes(chain.chain.base)) return failure("card_snapshot_retired", 410)
        const entry = chain.entries.get(symbol)
        if (entry?.status === "committed") {
          record = await object(
            env,
            publishedCardObjectKey(lane, entry[laneReceipt[lane]].hash),
            (value) => value?.symbol === symbol,
          )
        } else if (entry?.status === "withdrawn") {
          return failure("card_content_unavailable")
        } else {
          const base = await baseRefFor(env, chain.chain.base, symbol)
          if (base) {
            record = await baseRecord(env, chain.chain.base, base.catalog, base.ref, lane, symbol)
          }
        }
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
