const CDN = "https://iconoplasmportraits.b-cdn.net"
const ORIGIN = "https://iconoplasm.brinedew.bio"
// A healthy Bunny edge answers these small JSON objects in well under a second.
const CDN_TIMEOUT_MS = 4000
const HEAD_PATH = "/api/public/v1/card-current"
const HEAD_STORAGE_KEY = "iconoplasm.publication-head.v1"
const HASH = /^[a-f0-9]{64}$/
const BASE_VERSION = /^ccv2-([a-f0-9]{64})$/
const VIEW_VERSION = /^(ccv2-[a-f0-9]{64})\.c([a-f0-9]{64})$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
// The 19,023-card live publication had 67 compact indexes on 2026-09-24.
// Keep a finite browser fanout ceiling with room for ordinary shard splits.
const MAX_CATALOG_INDEXES = 96
const MAX_SEARCH_RESULTS = 12
const MAX_GALLERY_PAGE_SIZE = 24
const MAX_CANDIDATE_GALLERY_PAGES = 64
// B-898: one stable object per gene at a fixed URL, written by every publication
// with the complete candidate pool inline. It replaces the head -> manifest ->
// indexes -> gene -> delta walk (8 to 15 fetches). The publisher bounds it at
// 1 MiB; a 250-candidate gene is about 260 KiB.
const STABLE_GENE_PATH_PREFIX = "/genes/v3/"
// The same bytes on the canonical origin, for readers whose network cannot
// reach Bunny. Under /api/* so it needs no new static-first route entry.
const STABLE_GENE_ORIGIN_PREFIX = "/api/public/v1/stable-genes/"
const STABLE_GENE_OBJECT_LIMIT = 1024 * 1024
// B-898: ONE stable catalog object for the home grid, the gallery orders, search
// and gene metrics: every gene's name, portrait, score and sort fields in one
// array, built by the Actions publisher. It replaces the head -> manifest ->
// 74 catalog indexes -> catalog pages walk (76 fetches, about 1.8 MB) with one
// fetch of about 1.4 MB compressed. Rows: [symbol, full_name, portrait_sha256,
// color_hex, image_score, uniqueness_rank, weight_kg, age_years,
// first_publication_year, published_at].
const STABLE_CATALOG_PATH = "/catalog/v3/index.json"
const STABLE_CATALOG_ORIGIN_PATH = "/api/public/v1/stable-catalog.json"
const STABLE_CATALOG_OBJECT_LIMIT = 16 * 1024 * 1024
export const PUBLIC_READ_REQUEST_BOUNDS = Object.freeze({
  catalogIndexes: MAX_CATALOG_INDEXES,
  compactIndexBytes: 128 * 1024,
  resultPageBytes: 512 * 1024,
  searchRequests: 2 + MAX_CATALOG_INDEXES + MAX_SEARCH_RESULTS,
  searchBytes:
    2048 + 256 * 1024 + MAX_CATALOG_INDEXES * 128 * 1024 + MAX_SEARCH_RESULTS * 512 * 1024,
  galleryRequests: 2 + MAX_CATALOG_INDEXES + MAX_GALLERY_PAGE_SIZE,
  galleryBytes:
    2048 + 256 * 1024 + MAX_CATALOG_INDEXES * 128 * 1024 + MAX_GALLERY_PAGE_SIZE * 512 * 1024,
})

function normalizedSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return SYMBOL.test(symbol) ? symbol : ""
}

function nullableNumber(value) {
  if (value == null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function randomRank(seed, symbol) {
  const input = `${seed || "iconoplasm"}|${symbol}`
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function parseHead(value) {
  if (!value || value.schema_version !== 2 || !BASE_VERSION.test(String(value.current || ""))) {
    return null
  }
  if (value.reader_view != null && !VIEW_VERSION.test(String(value.reader_view))) return null
  return value
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function objectIdentity(key, expectedKind = "") {
  const match = String(key || "").match(
    /^published-cards\/v2\/immutable\/(cards|genes|galleries|portraits|indexes|catalogindexes|catalogs|manifests)\/([a-f0-9]{64})\.json$/,
  )
  if (!match || (expectedKind && match[1] !== expectedKind)) {
    throw new Error("Invalid immutable publication object key")
  }
  return { kind: match[1], hash: match[2], path: `/${match[0]}` }
}

function withImmutableMedia(record) {
  if (!record || typeof record !== "object") return record
  // B-793: a record with a gallery reference must not carry a fabricated empty
  // pool — that would read as "no candidates" instead of "fetch the pages".
  const projected = record.candidate_gallery
    ? { ...record }
    : {
        ...record,
        portrait_candidates: Array.isArray(record.portrait_candidates)
          ? record.portrait_candidates
          : [],
      }
  const portrait = record.portrait && typeof record.portrait === "object" ? record.portrait : null
  const sha = String(portrait?.asset_sha256 || "").toLowerCase()
  if (!HASH.test(sha) || portrait?.status !== "published") return projected
  const prefix = `${CDN}/portraits/v1/${sha.slice(0, 2)}/${sha}`
  return {
    ...projected,
    portrait: {
      ...portrait,
      thumb_url: `${prefix}/thumb.webp`,
      medium_url: `${prefix}/medium.webp`,
      hero_url: `${prefix}/full.webp`,
    },
  }
}

// The vote view owns the selected portrait. The candidate pool belongs to
// whichever side is newer, and that can be either: delta segments are carried
// across catalog rebuilds, so a vote overlay can outlive a catalog publish
// (#257: its old gallery would hide a fulfilled generation), and a delta
// committed after the catalog carries uploads the catalog has never seen
// (B-865: ARCN1 showed 1 of 8 candidates for over an hour). The catalog pool
// stays primary; the overlay's pool rides along and candidateGallery() picks
// the one holding the newest candidate.
export function mergePublishedGeneOverlay(base, overlay) {
  if (!base || !overlay) return overlay
  const merged = { ...overlay }
  delete merged.candidate_count
  delete merged.candidate_gallery
  delete merged.portrait_candidates
  if (overlay.candidate_gallery || Array.isArray(overlay.portrait_candidates)) {
    merged.overlay_candidate_pool = {
      candidate_count: overlay.candidate_count,
      candidate_gallery: overlay.candidate_gallery || null,
      ...(Array.isArray(overlay.portrait_candidates)
        ? { portrait_candidates: overlay.portrait_candidates }
        : {}),
    }
  }
  if ("candidate_count" in base) merged.candidate_count = base.candidate_count
  if ("candidate_gallery" in base) merged.candidate_gallery = base.candidate_gallery
  if (Array.isArray(base.portrait_candidates)) {
    const selected = String(overlay.portrait?.asset_sha256 || "").toLowerCase()
    merged.portrait_candidates = base.portrait_candidates.map((item) => ({
      ...item,
      is_current: selected
        ? String(item.asset_sha256 || "").toLowerCase() === selected
        : item.is_current,
    }))
  }
  return merged
}

export function createIconoplasmPublicationReader(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis)
  const storage = options.storage ?? globalThis.localStorage ?? null
  const cdnTimeoutMs = Number(options.cdnTimeoutMs) || CDN_TIMEOUT_MS
  const objects = new Map()
  let headPromise = null
  let catalogPromise = null
  let geneMetricsCache = null
  let stableCatalogPromise = null

  if (!fetchImpl) throw new Error("Iconoplasm publication reader requires fetch")

  function storedHead(scope = "") {
    try {
      const scoped = scope ? storage?.getItem?.(`${HEAD_STORAGE_KEY}.${scope}`) : null
      return parseHead(JSON.parse(scoped || storage?.getItem?.(HEAD_STORAGE_KEY) || "null"))
    } catch {
      return null
    }
  }

  function rememberHead(head, scope) {
    try {
      storage?.setItem?.(`${HEAD_STORAGE_KEY}.${scope}`, JSON.stringify(head))
    } catch {
      // Storage is an availability optimization; immutable identity is in the value.
    }
  }

  async function fetchFrom(origin, path, limit, timeoutMs) {
    // A plain timer, cleared once the body has arrived. AbortSignal.timeout()
    // uses an unreferenced timer in Node, so a hung request let the test
    // process exit mid-read.
    const controller = timeoutMs ? new AbortController() : null
    const timer = controller
      ? setTimeout(() => controller.abort(new Error("Publication request timed out")), timeoutMs)
      : null
    let response
    let text
    try {
      response = await fetchImpl(origin + path, {
        method: "GET",
        credentials: "omit",
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (!response.ok) throw new Error(`Publication HTTP ${response.status}`)
      text = await response.text()
    } finally {
      clearTimeout(timer)
    }
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw new Error("Publication object exceeds browser limit")
    }
    return { value: JSON.parse(text), text }
  }

  // IPD-001 (architecture-fences.json): Bunny accelerates; the first-party origin is
  // canonical, and a failed accelerator affects only this reader. On 27 Sep 2026
  // an ISP resolver failed to resolve the Bunny host and a first-time reader got
  // "Gene page temporarily unavailable". A failed Bunny request now retries the
  // same public path on the canonical origin, and after a network failure or
  // timeout the rest of this page skips Bunny. Healthy readers never touch the
  // origin, and immutable bytes are hash-checked whichever source served them.
  // A reader that already holds a coherent head never needs the origin for it:
  // the stored head is free and exact. Only a reader with nothing stored falls
  // through to the origin for the head, so a Bunny head outage does not fan
  // returning readers into Worker requests.
  let cdnUnreachable = false
  async function fromCdn(path, limit) {
    if (cdnUnreachable) throw new Error("Publication CDN unreachable")
    try {
      return await fetchFrom(CDN, path, limit, cdnTimeoutMs)
    } catch (error) {
      if (!String(error?.message || "").startsWith("Publication HTTP")) cdnUnreachable = true
      throw error
    }
  }

  async function fetchJson(path, limit) {
    try {
      return await fromCdn(path, limit)
    } catch {
      return fetchFrom(ORIGIN, path, limit)
    }
  }

  async function currentHead() {
    if (headPromise) return headPromise
    headPromise = (async () => {
      try {
        const head = parseHead((await fromCdn(HEAD_PATH, 2048)).value)
        if (!head) throw new Error("Invalid publication head")
        return head
      } catch {
        const prior = storedHead()
        if (prior) return prior
        try {
          const head = parseHead((await fetchFrom(ORIGIN, HEAD_PATH, 2048)).value)
          if (head) return head
        } catch {
          // Both sources failed; report the reader-facing condition below.
        }
        throw new Error("No coherent Iconoplasm publication is available")
      }
    })().finally(() => {
      headPromise = null
    })
    return headPromise
  }

  async function immutableObject(kind, hash) {
    if (!HASH.test(hash)) throw new Error("Invalid immutable publication hash")
    const cacheKey = `${kind}/${hash}`
    if (objects.has(cacheKey)) return objects.get(cacheKey)
    const path = `/published-cards/v2/immutable/${cacheKey}.json`
    const promise = (async () => {
      // B-792/B-793/B-892: cards, genes, gallery pages and the root manifest
      // share the publisher's 256 KiB bound. Other kinds keep theirs.
      const { value, text } = await fetchJson(
        path,
        kind === "cards" || kind === "genes" || kind === "galleries" || kind === "manifests"
          ? 256 * 1024
          : kind === "catalogs"
            ? 512 * 1024
            : kind === "catalogindexes"
              ? 128 * 1024
              : 65536,
      )
      if ((await sha256(text)) !== hash) throw new Error("Publication hash mismatch")
      return value
    })()
    objects.set(cacheKey, promise)
    try {
      return await promise
    } catch (error) {
      objects.delete(cacheKey)
      throw error
    }
  }

  async function publication(head) {
    const base = VIEW_VERSION.exec(String(head.reader_view || ""))?.[1] || head.current
    const manifestHash = BASE_VERSION.exec(base)?.[1]
    if (!manifestHash) throw new Error("Invalid publication base")
    const manifest = await immutableObject("manifests", manifestHash)
    if (manifest?.storage !== "bunny_card_catalog_v2" || !Array.isArray(manifest.shards)) {
      throw new Error("Invalid publication manifest")
    }
    return { head, base, manifest }
  }

  async function fromCoherentPublication(scope, operation) {
    const prior = storedHead(scope)
    let candidate = null
    let candidateError = null
    try {
      candidate = await currentHead()
      const result = await operation(candidate)
      rememberHead(candidate, scope)
      return result
    } catch (error) {
      candidateError = error
    }
    if (prior && JSON.stringify(prior) !== JSON.stringify(candidate)) {
      return operation(prior)
    }
    throw candidateError
  }

  async function viewEntry(head, symbol) {
    const view = VIEW_VERSION.exec(String(head.reader_view || ""))
    if (!view) return undefined
    const chain = await immutableObject("indexes", view[2])
    if (chain?.kind !== "gene_delta_chain" || chain.base !== view[1]) {
      throw new Error("Invalid publication delta chain")
    }
    for (const segmentRef of [...(chain.segments || [])].reverse()) {
      const identity = objectIdentity(segmentRef.key, "indexes")
      const segment = await immutableObject("indexes", identity.hash)
      const entry = segment?.entries?.[symbol]
      if (entry) return entry
    }
    return undefined
  }

  async function baseGene(manifest, symbol) {
    const shard = manifest.shards.find(
      (candidate) => symbol >= candidate.first_symbol && symbol <= candidate.last_symbol,
    )
    const indexRef = shard?.delivery_indexes?.find(
      (candidate) => symbol >= candidate.first_symbol && symbol <= candidate.last_symbol,
    )
    if (!indexRef) return null
    const indexIdentity = objectIdentity(indexRef.key, "indexes")
    const index = await immutableObject("indexes", indexIdentity.hash)
    const entry = index?.entries?.find((candidate) => candidate[0] === symbol)
    if (!entry || entry.length !== 4) return null
    const record = await immutableObject("genes", entry[2])
    return record?.symbol === symbol ? record : null
  }

  async function geneFromPublication(head, key) {
    const { manifest } = await publication(head)
    const delta = await viewEntry(head, key)
    if (delta?.status === "withdrawn") return null
    if (delta?.status === "committed") {
      const identity = objectIdentity(delta.gene?.key, "genes")
      const record = await immutableObject("genes", identity.hash)
      if (record?.symbol !== key) return null
      const base = await baseGene(manifest, key)
      return withImmutableMedia(mergePublishedGeneOverlay(base, record))
    }
    return withImmutableMedia(await baseGene(manifest, key))
  }

  function validStableGene(value, key) {
    return (
      value &&
      typeof value === "object" &&
      value.stable_object_version === 3 &&
      normalizedSymbol(value.symbol) === key &&
      Array.isArray(value.portrait_candidates) &&
      "portrait" in value
    )
  }

  // Bunny first. A CDN 404 (not yet backfilled) or malformed object falls back
  // to the immutable tree without touching the origin, so the transition never
  // adds Worker requests. Only an unreachable CDN hedges to the canonical
  // origin's first-party copy of the same object.
  async function stableGene(key) {
    const path = `${STABLE_GENE_PATH_PREFIX}${key}.json`
    let value
    try {
      value = (await fromCdn(path, STABLE_GENE_OBJECT_LIMIT)).value
    } catch (error) {
      if (String(error?.message || "").startsWith("Publication HTTP")) return undefined
      try {
        value = (
          await fetchFrom(
            ORIGIN,
            `${STABLE_GENE_ORIGIN_PREFIX}${key}.json`,
            STABLE_GENE_OBJECT_LIMIT,
          )
        ).value
      } catch {
        return undefined
      }
    }
    return validStableGene(value, key) ? withImmutableMedia(value) : undefined
  }

  async function gene(symbol) {
    const key = normalizedSymbol(symbol)
    if (!key) return null
    const stable = await stableGene(key)
    if (stable !== undefined) return stable
    return fromCoherentPublication(`gene:${key}`, (head) => geneFromPublication(head, key))
  }

  function stableCatalogEntry(row) {
    const [
      symbol,
      fullName,
      portraitSha,
      color,
      score,
      uniqueness,
      weight,
      age,
      firstPublicationYear,
      publishedAt,
    ] = row
    const sha = String(portraitSha || "").toLowerCase()
    const published = HASH.test(sha)
    const prefix = `${CDN}/portraits/v1/${sha.slice(0, 2)}/${sha}`
    return {
      symbol: String(symbol),
      canonical_symbol: String(symbol),
      full_name: String(fullName || ""),
      color: String(color || ""),
      image_score: Number(score || 0),
      uniqueness_rank: nullableNumber(uniqueness),
      weight_kg: nullableNumber(weight),
      age_years: nullableNumber(age),
      first_publication_year: nullableNumber(firstPublicationYear),
      published_at: String(publishedAt || ""),
      // The published popularity column is 0 for every gene (B-886); the
      // page-view table is the one source and gallery() applies it.
      popularity_score: 0,
      portrait: published
        ? {
            status: "published",
            asset_sha256: sha,
            thumb_url: `${prefix}/thumb.webp`,
            medium_url: `${prefix}/medium.webp`,
            hero_url: `${prefix}/full.webp`,
          }
        : null,
    }
  }

  // Bunny first; a 404 (not yet published) or a malformed object means the
  // immutable tree, with no origin request. Only an unreachable CDN hedges to
  // the canonical origin's copy. One fetch per page: the parsed index stays in
  // memory for every later gallery page, search and metrics read.
  function stableCatalog() {
    if (stableCatalogPromise) return stableCatalogPromise
    stableCatalogPromise = (async () => {
      let value
      try {
        value = (await fromCdn(STABLE_CATALOG_PATH, STABLE_CATALOG_OBJECT_LIMIT)).value
      } catch (error) {
        if (String(error?.message || "").startsWith("Publication HTTP")) return null
        try {
          value = (await fetchFrom(ORIGIN, STABLE_CATALOG_ORIGIN_PATH, STABLE_CATALOG_OBJECT_LIMIT))
            .value
        } catch {
          return null
        }
      }
      if (value?.schema !== 3 || !Array.isArray(value.genes)) return null
      const entries = value.genes
        .filter((row) => Array.isArray(row) && normalizedSymbol(row[0]))
        .map(stableCatalogEntry)
      return {
        version: `catalog-v3:${Number(value.watermark_event_id || 0)}`,
        generated_at: String(value.generated_at || ""),
        entries,
        bySymbol: new Map(entries.map((entry) => [entry.symbol, entry])),
      }
    })().catch(() => null)
    return stableCatalogPromise
  }

  // B-793: the gene record stays small; its complete candidate pool lives in
  // immutable gallery pages reached from `candidate_gallery`. A core gene
  // render never fetches a page — only a gallery that actually renders one
  // calls this. Pages are content-addressed and immutable, so the existing
  // object cache makes a repeat call free. A failed or malformed page throws:
  // callers show an unavailable/error state, never "no candidates".
  async function candidateGallery(record) {
    const primary = await candidatePool(record)
    const alternate = record?.overlay_candidate_pool
    if (!alternate) return primary
    const overlay = await candidatePool({
      symbol: record.symbol,
      portrait: record.portrait,
      ...alternate,
    })
    // B-865: candidate ids only grow, so the pool holding the higher id is the
    // later snapshot. A tie is no evidence the overlay is newer: keep the catalog.
    const newest = (pool) =>
      pool.candidates.reduce((max, item) => Math.max(max, Number(item?.candidate_image_id) || 0), 0)
    return newest(overlay) > newest(primary) ? overlay : primary
  }

  async function candidatePool(record) {
    const symbol = normalizedSymbol(record?.symbol)
    if (!symbol) throw new Error("Invalid candidate gallery symbol")
    let reference = record?.candidate_gallery || null
    if (!reference && Array.isArray(record?.portrait_candidates)) {
      // Transition compatibility: records published before the split embed
      // their pool directly.
      return { candidates: record.portrait_candidates, count: record.portrait_candidates.length }
    }
    const declared = Number.isSafeInteger(record?.candidate_count)
      ? Number(record.candidate_count)
      : null
    const candidates = []
    let page = 0
    while (reference) {
      if (page >= MAX_CANDIDATE_GALLERY_PAGES)
        throw new Error("Candidate gallery chain exceeds its page bound")
      const identity = objectIdentity(reference.key, "galleries")
      const value = await immutableObject("galleries", identity.hash)
      if (
        value?.schema_version !== 1 ||
        value.symbol !== symbol ||
        value.page !== page ||
        !Array.isArray(value.candidates)
      ) {
        throw new Error("Invalid candidate gallery page")
      }
      candidates.push(...value.candidates)
      reference = value.next
      page += 1
    }
    if (declared != null && candidates.length !== declared) {
      throw new Error("Candidate gallery count mismatch")
    }
    const selected = String(record?.portrait?.asset_sha256 || "").toLowerCase()
    return {
      candidates: selected
        ? candidates.map((item) => ({
            ...item,
            is_current: String(item.asset_sha256 || "").toLowerCase() === selected,
          }))
        : candidates,
      count: candidates.length,
    }
  }

  async function genes(symbols) {
    const keys = [...new Set((Array.isArray(symbols) ? symbols : []).map(normalizedSymbol))]
      .filter(Boolean)
      .slice(0, MAX_GALLERY_PAGE_SIZE)
    if (!keys.length) return []
    return fromCoherentPublication(`genes:${keys.join(",")}`, async (head) =>
      (await Promise.all(keys.map((key) => geneFromPublication(head, key)))).filter(Boolean),
    )
  }

  async function catalogIndexes(head) {
    const { base, manifest } = await publication(head)
    if (manifest.shards.length > MAX_CATALOG_INDEXES) {
      throw new Error("Public catalog exceeds its compact-index request bound")
    }
    if (catalogPromise?.version === base) {
      return { version: base, indexes: await catalogPromise.value }
    }
    const value = Promise.all(
      manifest.shards.map(async (shard) => {
        const identity = objectIdentity(shard.catalog_index?.key, "catalogindexes")
        const index = await immutableObject("catalogindexes", identity.hash)
        if (
          index?.schema_version !== 2 ||
          !Array.isArray(index.pages) ||
          !Array.isArray(index.search_entries) ||
          !Array.isArray(index.gallery_entries)
        ) {
          throw new Error("Public catalog projection is not activated")
        }
        return index
      }),
    )
    catalogPromise = { version: base, value }
    try {
      return { version: base, indexes: await value }
    } catch (error) {
      catalogPromise = null
      throw error
    }
  }

  async function catalogEntriesAt(indexes, locations) {
    const pages = new Map()
    for (const location of locations) {
      const index = indexes[location.index]
      const pageRef = index?.pages?.[location.page]
      if (!pageRef) throw new Error("Invalid compact catalog location")
      if (!pages.has(pageRef.key)) {
        const identity = objectIdentity(pageRef.key, "catalogs")
        pages.set(
          pageRef.key,
          immutableObject("catalogs", identity.hash).then((page) => {
            if (page?.schema_version !== 1 || !Array.isArray(page.entries)) {
              throw new Error("Invalid public catalog page")
            }
            return page.entries
          }),
        )
      }
    }
    return Promise.all(
      locations.map(async (location) => {
        const pageRef = indexes[location.index].pages[location.page]
        const entries = await pages.get(pageRef.key)
        return withImmutableMedia(entries[location.offset])
      }),
    )
  }

  function searchRank(needle, rawSymbol, rawName) {
    const symbol = String(rawSymbol || "").toLowerCase()
    const name = String(rawName || "").toLowerCase()
    if (symbol === needle) return 1
    if (symbol.startsWith(needle)) return 2
    if (name.startsWith(needle)) return 3
    if (symbol.includes(needle)) return 4
    if (name.includes(needle)) return 5
    return 0
  }

  async function search(query, { limit = 12, symbols = null } = {}) {
    const needle = String(query || "")
      .trim()
      .toLowerCase()
    if (!needle) return { genes: [], query: "" }
    const allowed = symbols ? new Set(symbols.map(normalizedSymbol).filter(Boolean)) : null
    const size = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(limit) || 12))
    const allowedIdentity = allowed ? [...allowed].sort().join(",") : "*"
    const scope = `search:${encodeURIComponent(needle)}:${size}:${allowedIdentity}`
    const stable = await stableCatalog()
    if (stable) {
      const ranked = []
      for (const entry of stable.entries) {
        if (allowed && !allowed.has(entry.symbol)) continue
        const rank = searchRank(needle, entry.symbol, entry.full_name)
        if (rank) ranked.push({ rank, entry })
      }
      ranked.sort(
        (left, right) =>
          left.rank - right.rank || left.entry.symbol.localeCompare(right.entry.symbol),
      )
      return { genes: ranked.slice(0, size).map((item) => item.entry), query: needle.toUpperCase() }
    }
    return fromCoherentPublication(scope, async (head) => {
      const { indexes } = await catalogIndexes(head)
      const ranked = []
      indexes.forEach((index, indexNumber) => {
        index.search_entries.forEach(([rawSymbol, rawName, page, offset]) => {
          if (allowed && !allowed.has(rawSymbol)) return
          const rank = searchRank(needle, rawSymbol, rawName)
          if (rank) ranked.push({ symbol: rawSymbol, rank, index: indexNumber, page, offset })
        })
      })
      ranked.sort(
        (left, right) => left.rank - right.rank || left.symbol.localeCompare(right.symbol),
      )
      const selected = ranked.slice(0, size)
      const genes = await catalogEntriesAt(indexes, selected)
      return { genes, query: needle.toUpperCase() }
    })
  }

  // B-885: the home sort fields, per gene, from the compact catalog indexes
  // this page already loads for search and the gallery. A signed-in shelf
  // sorts on these in the browser instead of asking the server to enrich
  // every discovered gene. Keyed by upper-case symbol (discoveries are
  // upper-case; the catalog keeps "C1orf112"). Popularity is not here: the
  // published cards carry 0 for every gene (measured 27 Sep), so the page
  // takes it from wiki-pageviews.js, the table the server enrichment used.
  async function geneMetrics() {
    const stable = await stableCatalog()
    if (stable) {
      if (geneMetricsCache?.version === stable.version) return geneMetricsCache.value
      const bySymbol = new Map()
      for (const entry of stable.entries) {
        bySymbol.set(entry.symbol.toUpperCase(), {
          full_name: entry.full_name,
          image_score: entry.image_score,
          published_at: entry.published_at,
          uniqueness_rank: entry.uniqueness_rank,
          weight_kg: entry.weight_kg,
          age_years: entry.age_years,
        })
      }
      geneMetricsCache = { version: stable.version, value: bySymbol }
      return bySymbol
    }
    return fromCoherentPublication("gene-metrics", async (head) => {
      const { version, indexes } = await catalogIndexes(head)
      if (geneMetricsCache?.version === version) return geneMetricsCache.value
      const bySymbol = new Map()
      for (const index of indexes) {
        const names = new Map(index.search_entries.map(([symbol, name]) => [symbol, name]))
        for (const [
          symbol,
          ,
          ,
          ,
          votes,
          publishedAt,
          ,
          uniqueness,
          weight,
          age,
        ] of index.gallery_entries) {
          bySymbol.set(String(symbol).toUpperCase(), {
            full_name: String(names.get(symbol) || ""),
            image_score: Number(votes || 0),
            published_at: String(publishedAt || ""),
            uniqueness_rank: nullableNumber(uniqueness),
            weight_kg: nullableNumber(weight),
            age_years: nullableNumber(age),
          })
        }
      }
      geneMetricsCache = { version, value: bySymbol }
      return bySymbol
    })
  }

  async function gallery({ order = "votes", offset = 0, limit = 24, seed = "" } = {}) {
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Math.min(MAX_GALLERY_PAGE_SIZE, Number(limit) || 24))
    const scope = `gallery:${encodeURIComponent(order)}:${start}:${size}:${encodeURIComponent(seed)}`
    // B-886: the published popularity column is 0 for every gene. The static
    // page-view table is the one source; it loads only for the order that
    // needs it, so other guest views never pay its bytes.
    const pageviews = ["popular", "popularity"].includes(order)
      ? (await import("./wiki-pageviews.js?v=cb3a800cea17433a")).ICONOPLASM_WIKI_PAGEVIEWS
      : null
    const stable = await stableCatalog()
    if (stable) {
      const rows = stable.entries.map((entry) => ({
        symbol: entry.symbol,
        entry,
        popularity: Number(pageviews?.[entry.symbol.toUpperCase()] || 0),
        votes: entry.image_score,
        publishedAt: entry.published_at,
        nameLength: entry.full_name.length || entry.symbol.length,
        uniqueness: entry.uniqueness_rank,
        weight: entry.weight_kg,
        age: entry.age_years,
        published: entry.portrait !== null,
      }))
      sortGalleryRows(rows, order, seed)
      const selected = rows.slice(start, start + size)
      return {
        order,
        total: rows.length,
        published_total: rows.filter((row) => row.published).length,
        offset: start,
        limit: size,
        has_more: start + size < rows.length,
        snapshot_version: stable.version,
        items: selected.map((row) => row.entry),
      }
    }
    return fromCoherentPublication(scope, async (head) => {
      const { version, indexes } = await catalogIndexes(head)
      const rows = indexes.flatMap((index, indexNumber) =>
        index.gallery_entries.map(
          ([
            symbol,
            page,
            itemOffset,
            popularity,
            votes,
            publishedAt,
            nameLength,
            uniqueness,
            weight,
            age,
            published,
          ]) => ({
            symbol,
            page,
            offset: itemOffset,
            popularity: Number(pageviews?.[String(symbol).toUpperCase()] || popularity || 0),
            votes: Number(votes || 0),
            publishedAt: String(publishedAt || ""),
            nameLength: Number(nameLength || symbol.length),
            uniqueness: nullableNumber(uniqueness),
            weight: nullableNumber(weight),
            age: nullableNumber(age),
            published: Number(published || 0) === 1,
            index: indexNumber,
          }),
        ),
      )
      sortGalleryRows(rows, order, seed)
      const selected = rows.slice(start, start + size)
      const items = await catalogEntriesAt(indexes, selected)
      return {
        order,
        total: rows.length,
        published_total: rows.filter((row) => row.published).length,
        offset: start,
        limit: size,
        has_more: start + size < rows.length,
        snapshot_version: version,
        items,
      }
    })
  }

  function sortGalleryRows(rows, order, seed) {
    if (["symbol", "alphabetical"].includes(order))
      rows.sort((a, b) => a.symbol.localeCompare(b.symbol))
    else if (order === "shortest")
      rows.sort((a, b) => a.nameLength - b.nameLength || a.symbol.localeCompare(b.symbol))
    else if (order === "newest")
      rows.sort(
        (a, b) =>
          b.publishedAt.localeCompare(a.publishedAt) ||
          b.popularity - a.popularity ||
          a.symbol.localeCompare(b.symbol),
      )
    else if (order === "random")
      rows.sort(
        (a, b) =>
          randomRank(seed, a.symbol) - randomRank(seed, b.symbol) ||
          a.symbol.localeCompare(b.symbol),
      )
    else if (order === "uniqueness")
      rows.sort(
        (a, b) =>
          (a.uniqueness == null) - (b.uniqueness == null) ||
          (a.uniqueness ?? 0) - (b.uniqueness ?? 0) ||
          b.popularity - a.popularity ||
          a.symbol.localeCompare(b.symbol),
      )
    else if (["heaviest", "lightest"].includes(order))
      rows.sort(
        (a, b) =>
          (a.weight == null) - (b.weight == null) ||
          (order === "heaviest"
            ? (b.weight ?? 0) - (a.weight ?? 0)
            : (a.weight ?? 0) - (b.weight ?? 0)) ||
          b.popularity - a.popularity ||
          a.symbol.localeCompare(b.symbol),
      )
    else if (["oldest", "youngest"].includes(order))
      rows.sort(
        (a, b) =>
          (a.age == null) - (b.age == null) ||
          (order === "oldest" ? (b.age ?? 0) - (a.age ?? 0) : (a.age ?? 0) - (b.age ?? 0)) ||
          b.popularity - a.popularity ||
          a.symbol.localeCompare(b.symbol),
      )
    else if (["popular", "popularity"].includes(order))
      rows.sort((a, b) => b.popularity - a.popularity || a.symbol.localeCompare(b.symbol))
    else rows.sort((a, b) => b.votes - a.votes || a.symbol.localeCompare(b.symbol))
  }

  async function metadata() {
    const stable = await stableCatalog()
    if (stable) {
      return { card_snapshot_version: stable.version, publication_source: "stable_v3" }
    }
    return fromCoherentPublication("metadata", async (head) => {
      await publication(head)
      return {
        card_snapshot_version: head.reader_view || head.current,
        publication_source: "immutable_sysop_v2",
      }
    })
  }

  return { currentHead, gene, genes, candidateGallery, search, gallery, geneMetrics, metadata }
}

export const iconoplasmPublicationReader = createIconoplasmPublicationReader()
