const CDN = "https://iconoplasmportraits.b-cdn.net"
const HEAD_PATH = "/api/public/v1/card-current"
const HEAD_STORAGE_KEY = "iconoplasm.publication-head.v1"
const HASH = /^[a-f0-9]{64}$/
const BASE_VERSION = /^ccv2-([a-f0-9]{64})$/
const VIEW_VERSION = /^(ccv2-[a-f0-9]{64})\.c([a-f0-9]{64})$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const MAX_CATALOG_INDEXES = 32
const MAX_SEARCH_RESULTS = 12
const MAX_GALLERY_PAGE_SIZE = 24
const MAX_CANDIDATE_GALLERY_PAGES = 64
export const PUBLIC_READ_REQUEST_BOUNDS = Object.freeze({
  catalogIndexes: MAX_CATALOG_INDEXES,
  compactIndexBytes: 128 * 1024,
  resultPageBytes: 512 * 1024,
  searchRequests: 2 + MAX_CATALOG_INDEXES + MAX_SEARCH_RESULTS,
  searchBytes: 2048 + 65536 + MAX_CATALOG_INDEXES * 128 * 1024 + MAX_SEARCH_RESULTS * 512 * 1024,
  galleryRequests: 2 + MAX_CATALOG_INDEXES + MAX_GALLERY_PAGE_SIZE,
  galleryBytes:
    2048 + 65536 + MAX_CATALOG_INDEXES * 128 * 1024 + MAX_GALLERY_PAGE_SIZE * 512 * 1024,
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

export function createIconoplasmPublicationReader(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis)
  const storage = options.storage ?? globalThis.localStorage ?? null
  const objects = new Map()
  let headPromise = null
  let catalogPromise = null

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

  async function fetchJson(url, limit) {
    const response = await fetchImpl(url, { method: "GET", credentials: "omit" })
    if (!response.ok) throw new Error(`Publication HTTP ${response.status}`)
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw new Error("Publication object exceeds browser limit")
    }
    return { value: JSON.parse(text), text }
  }

  async function currentHead() {
    if (headPromise) return headPromise
    headPromise = (async () => {
      try {
        const head = parseHead((await fetchJson(CDN + HEAD_PATH, 2048)).value)
        if (!head) throw new Error("Invalid publication head")
        return head
      } catch {
        const prior = storedHead()
        if (prior) return prior
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
      // B-792/B-793: cards, genes and immutable candidate gallery pages share
      // the publisher's 256 KiB bound. Other kinds keep theirs.
      const { value, text } = await fetchJson(
        CDN + path,
        kind === "cards" || kind === "genes" || kind === "galleries"
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
      return record?.symbol === key ? withImmutableMedia(record) : null
    }
    return withImmutableMedia(await baseGene(manifest, key))
  }

  async function gene(symbol) {
    const key = normalizedSymbol(symbol)
    if (!key) return null
    return fromCoherentPublication(`gene:${key}`, (head) => geneFromPublication(head, key))
  }

  // B-793: the gene record stays small; its complete candidate pool lives in
  // immutable gallery pages reached from `candidate_gallery`. A core gene
  // render never fetches a page — only a gallery that actually renders one
  // calls this. Pages are content-addressed and immutable, so the existing
  // object cache makes a repeat call free. A failed or malformed page throws:
  // callers show an unavailable/error state, never "no candidates".
  async function candidateGallery(record) {
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
    return { candidates, count: candidates.length }
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

  async function search(query, { limit = 12, symbols = null } = {}) {
    const needle = String(query || "")
      .trim()
      .toLowerCase()
    if (!needle) return { genes: [], query: "" }
    const allowed = symbols ? new Set(symbols.map(normalizedSymbol).filter(Boolean)) : null
    const size = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(limit) || 12))
    const allowedIdentity = allowed ? [...allowed].sort().join(",") : "*"
    const scope = `search:${encodeURIComponent(needle)}:${size}:${allowedIdentity}`
    return fromCoherentPublication(scope, async (head) => {
      const { indexes } = await catalogIndexes(head)
      const ranked = []
      indexes.forEach((index, indexNumber) => {
        index.search_entries.forEach(([rawSymbol, rawName, page, offset]) => {
          if (allowed && !allowed.has(rawSymbol)) return
          const symbol = String(rawSymbol || "").toLowerCase()
          const name = String(rawName || "").toLowerCase()
          let rank = 0
          if (symbol === needle) rank = 1
          else if (symbol.startsWith(needle)) rank = 2
          else if (name.startsWith(needle)) rank = 3
          else if (symbol.includes(needle)) rank = 4
          else if (name.includes(needle)) rank = 5
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

  async function gallery({ order = "votes", offset = 0, limit = 24, seed = "" } = {}) {
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Math.min(MAX_GALLERY_PAGE_SIZE, Number(limit) || 24))
    const scope = `gallery:${encodeURIComponent(order)}:${start}:${size}:${encodeURIComponent(seed)}`
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
            popularity: Number(popularity || 0),
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

  async function metadata() {
    return fromCoherentPublication("metadata", async (head) => {
      await publication(head)
      return {
        card_snapshot_version: head.reader_view || head.current,
        publication_source: "immutable_sysop_v2",
      }
    })
  }

  return { currentHead, gene, genes, candidateGallery, search, gallery, metadata }
}

export const iconoplasmPublicationReader = createIconoplasmPublicationReader()
