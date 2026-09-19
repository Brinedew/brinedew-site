const CDN = "https://iconoplasmportraits.b-cdn.net"
const ORIGIN = "https://iconoplasm.brinedew.bio"
const HEAD_PATH = "/api/public/v1/card-current"
const HEAD_STORAGE_KEY = "iconoplasm.publication-head.v1"
const HASH = /^[a-f0-9]{64}$/
const BASE_VERSION = /^ccv2-([a-f0-9]{64})$/
const VIEW_VERSION = /^(ccv2-[a-f0-9]{64})\.c([a-f0-9]{64})$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

function normalizedSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return SYMBOL.test(symbol) ? symbol : ""
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
    /^published-cards\/v2\/immutable\/(cards|genes|portraits|indexes|catalogs|manifests)\/([a-f0-9]{64})\.json$/,
  )
  if (!match || (expectedKind && match[1] !== expectedKind)) {
    throw new Error("Invalid immutable publication object key")
  }
  return { kind: match[1], hash: match[2], path: `/${match[0]}` }
}

export function immutableBlotByteUrl(blot) {
  for (const value of [blot?.image_url, blot?.accelerator_url, blot?.immutable_url]) {
    const url = String(value || "").trim()
    if (url.startsWith(`${CDN}/`)) return url
  }
  return "/static/iconoplasm/blot-placeholder.svg"
}

function withImmutableMedia(record) {
  if (!record || typeof record !== "object") return record
  const portrait = record.portrait && typeof record.portrait === "object" ? record.portrait : null
  const sha = String(portrait?.asset_sha256 || "").toLowerCase()
  if (!HASH.test(sha) || portrait?.status !== "published") return record
  const prefix = `${CDN}/portraits/v1/${sha.slice(0, 2)}/${sha}`
  return {
    ...record,
    portrait: {
      ...portrait,
      thumb_url: `${prefix}/thumb.webp`,
      medium_url: `${prefix}/medium.webp`,
      hero_url: `${prefix}/full.webp`,
    },
  }
}

function raceWithCancelableHedge(primary, secondary, delayMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    let secondaryStarted = false
    let failures = 0
    const errors = []
    let timer

    const run = (operation, isPrimary) => {
      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            if (settled) return
            failures += 1
            errors.push(error)
            if (isPrimary) startSecondary()
            if (secondaryStarted && failures === 2) {
              settled = true
              reject(new AggregateError(errors, "Every publication source failed"))
            }
          },
        )
    }
    const startSecondary = () => {
      if (settled || secondaryStarted) return
      secondaryStarted = true
      clearTimeout(timer)
      run(secondary, false)
    }

    run(primary, true)
    timer = setTimeout(startSecondary, delayMs)
  })
}

export function createIconoplasmPublicationReader(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis)
  const storage = options.storage ?? globalThis.localStorage ?? null
  const hedgeMs = Math.max(0, Number(options.hedgeMs ?? 350) || 0)
  const objects = new Map()
  let headPromise = null
  let catalogPromise = null

  if (!fetchImpl) throw new Error("Iconoplasm publication reader requires fetch")

  function storedHead() {
    try {
      return parseHead(JSON.parse(storage?.getItem?.(HEAD_STORAGE_KEY) || "null"))
    } catch {
      return null
    }
  }

  function rememberHead(head) {
    try {
      storage?.setItem?.(HEAD_STORAGE_KEY, JSON.stringify(head))
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
        const head = await raceWithCancelableHedge(
          async () => {
            const parsed = parseHead((await fetchJson(CDN + HEAD_PATH, 2048)).value)
            if (!parsed) throw new Error("Invalid publication head")
            return parsed
          },
          async () => {
            const parsed = parseHead((await fetchJson(ORIGIN + HEAD_PATH, 2048)).value)
            if (!parsed) throw new Error("Invalid publication head")
            return parsed
          },
          hedgeMs,
        )
        rememberHead(head)
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
      const read = async (origin) => {
        const { value, text } = await fetchJson(
          origin + path,
          kind === "catalogs" ? 512 * 1024 : 65536,
        )
        if ((await sha256(text)) !== hash) throw new Error("Publication hash mismatch")
        return value
      }
      return raceWithCancelableHedge(
        () => read(CDN),
        () => read(ORIGIN),
        hedgeMs,
      )
    })()
    objects.set(cacheKey, promise)
    try {
      return await promise
    } catch (error) {
      objects.delete(cacheKey)
      throw error
    }
  }

  async function publication() {
    const head = await currentHead()
    const base = VIEW_VERSION.exec(String(head.reader_view || ""))?.[1] || head.current
    const manifestHash = BASE_VERSION.exec(base)?.[1]
    if (!manifestHash) throw new Error("Invalid publication base")
    const manifest = await immutableObject("manifests", manifestHash)
    if (manifest?.storage !== "bunny_card_catalog_v2" || !Array.isArray(manifest.shards)) {
      throw new Error("Invalid publication manifest")
    }
    return { head, base, manifest }
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

  async function gene(symbol) {
    const key = normalizedSymbol(symbol)
    if (!key) return null
    const { head, manifest } = await publication()
    const delta = await viewEntry(head, key)
    if (delta?.status === "withdrawn") return null
    if (delta?.status === "committed") {
      const identity = objectIdentity(delta.gene?.key, "genes")
      const record = await immutableObject("genes", identity.hash)
      return record?.symbol === key ? withImmutableMedia(record) : null
    }
    return withImmutableMedia(await baseGene(manifest, key))
  }

  async function catalog() {
    if (catalogPromise) return catalogPromise
    catalogPromise = (async () => {
      const { base, manifest } = await publication()
      const catalogIndexes = await Promise.all(
        manifest.shards.map(async (shard) => {
          const identity = objectIdentity(shard.catalog_index?.key, "catalogs")
          const index = await immutableObject("catalogs", identity.hash)
          if (index?.schema_version !== 1 || !Array.isArray(index.pages)) {
            throw new Error("Invalid public catalog index")
          }
          return index.pages
        }),
      )
      const pages = await Promise.all(
        catalogIndexes.flat().map(async (pageRef) => {
          const identity = objectIdentity(pageRef.key, "catalogs")
          const page = await immutableObject("catalogs", identity.hash)
          if (page?.schema_version !== 1 || !Array.isArray(page.entries)) {
            throw new Error("Invalid public catalog page")
          }
          return page.entries.map(withImmutableMedia)
        }),
      )
      return { version: base, entries: pages.flat() }
    })()
    try {
      return await catalogPromise
    } catch (error) {
      catalogPromise = null
      throw error
    }
  }

  async function search(query, { limit = 12, symbols = null } = {}) {
    const needle = String(query || "")
      .trim()
      .toLowerCase()
    if (!needle) return { genes: [], query: "" }
    const allowed = symbols ? new Set(symbols.map(normalizedSymbol).filter(Boolean)) : null
    const { entries } = await catalog()
    const ranked = []
    for (const entry of entries) {
      if (allowed && !allowed.has(entry.symbol)) continue
      const symbol = String(entry.symbol || "").toLowerCase()
      const name = String(entry.full_name || "").toLowerCase()
      let rank = 0
      if (symbol === needle) rank = 1
      else if (symbol.startsWith(needle)) rank = 2
      else if (name.startsWith(needle)) rank = 3
      else if (symbol.includes(needle)) rank = 4
      else if (name.includes(needle)) rank = 5
      if (rank) ranked.push({ ...entry, match_rank: rank })
    }
    ranked.sort(
      (left, right) =>
        left.match_rank - right.match_rank || left.symbol.localeCompare(right.symbol),
    )
    return {
      genes: ranked.slice(0, Math.max(1, Math.min(100, Number(limit) || 12))),
      query: needle.toUpperCase(),
    }
  }

  async function gallery({ order = "votes", offset = 0, limit = 24 } = {}) {
    const { version, entries } = await catalog()
    const sorted = entries.slice()
    if (order === "alphabetical") sorted.sort((a, b) => a.symbol.localeCompare(b.symbol))
    else if (order === "popular")
      sorted.sort(
        (a, b) =>
          Number(b.popularity_score || 0) - Number(a.popularity_score || 0) ||
          a.symbol.localeCompare(b.symbol),
      )
    else
      sorted.sort(
        (a, b) =>
          Number(b.image_score || 0) - Number(a.image_score || 0) ||
          a.symbol.localeCompare(b.symbol),
      )
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Math.min(100, Number(limit) || 24))
    return {
      order,
      total: sorted.length,
      published_total: sorted.filter((entry) => entry.portrait?.status === "published").length,
      offset: start,
      limit: size,
      has_more: start + size < sorted.length,
      snapshot_version: version,
      items: sorted.slice(start, start + size),
    }
  }

  async function metadata() {
    const head = await currentHead()
    return {
      card_snapshot_version: head.reader_view || head.current,
      publication_source: "immutable_sysop_v2",
    }
  }

  return { currentHead, gene, search, gallery, metadata }
}

export const iconoplasmPublicationReader = createIconoplasmPublicationReader()
