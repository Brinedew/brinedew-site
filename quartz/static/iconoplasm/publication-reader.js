const CDN = "https://iconoplasmportraits.b-cdn.net"
const ORIGIN = "https://iconoplasm.brinedew.bio"
// Bunny answers a warm object in well under a second; a hung connection is the
// case this bounds, not a slow body.
const CDN_TIMEOUT_MS = 4000
const HASH = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const MAX_SEARCH_RESULTS = 12
const MAX_GALLERY_PAGE_SIZE = 24

// B-898: the two published objects. One stable, mutable object per gene,
// rewritten in place by the Website's per-gene publisher and purged on the
// CDN, and one catalog object rebuilt by the GitHub Actions publisher. A
// missing or malformed object is a reader error the page shows, never a
// silent fallback to older state.
const STABLE_GENE_PATH_PREFIX = "/genes/v3/"
// The same object on the canonical origin, for a reader whose network cannot
// reach Bunny (an ISP resolver failed to resolve the Bunny host on 27 Sep
// 2026). One metered Worker request only on that failure.
const STABLE_GENE_ORIGIN_PREFIX = "/api/public/v1/stable-genes/"
const STABLE_GENE_OBJECT_LIMIT = 1024 * 1024
// The CDN stamps the stable objects with a 30-day max-age so Bunny's edge
// keeps them; the Website purges the exact URL on every rewrite. The
// browser's own HTTP cache would not see that purge, so the reader asks it to
// revalidate on every read (one conditional request, a 304 when unchanged).
const STABLE_FETCH = Object.freeze({ cache: "no-cache" })
const STABLE_CATALOG_PATH = "/catalog/v3/index.json"
const STABLE_CATALOG_ORIGIN_PATH = "/api/public/v1/stable-catalog.json"
const STABLE_CATALOG_OBJECT_LIMIT = 16 * 1024 * 1024

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

function isHttpError(error) {
  return String(error?.message || "").startsWith("Publication HTTP")
}

function withImmutableMedia(record) {
  if (!record || typeof record !== "object") return record
  const projected = {
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
  const cdnTimeoutMs = Number(options.cdnTimeoutMs) || CDN_TIMEOUT_MS
  let geneMetricsCache = null
  let stableCatalogPromise = null

  if (!fetchImpl) throw new Error("Iconoplasm publication reader requires fetch")

  async function fetchFrom(origin, path, limit, timeoutMs, { cache = "default" } = {}) {
    // A plain timer, cleared once the headers have arrived. AbortSignal.timeout()
    // uses an unreferenced timer in Node, so a hung request let the test
    // process exit mid-read.
    const controller = timeoutMs ? new AbortController() : null
    const timer = controller
      ? setTimeout(() => controller.abort(new Error("Publication request timed out")), timeoutMs)
      : null
    let response
    try {
      response = await fetchImpl(origin + path, {
        method: "GET",
        credentials: "omit",
        cache,
        ...(controller ? { signal: controller.signal } : {}),
      })
    } finally {
      // The timeout bounds the time to headers (a hung connection), not the
      // body: the stable catalog object is about 1.4 MB compressed and must
      // not be abandoned, and then hedged to the metered origin, on a slow
      // link that is still delivering it.
      clearTimeout(timer)
    }
    if (!response.ok) throw new Error(`Publication HTTP ${response.status}`)
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw new Error("Publication object exceeds browser limit")
    }
    return JSON.parse(text)
  }

  // IPD-001 (architecture-fences.json): Bunny accelerates; the first-party origin
  // is canonical, and a failed accelerator affects only this reader. After a
  // network failure or timeout the rest of this page skips Bunny. Healthy
  // readers never touch the origin. An HTTP status from Bunny (a 404 for a gene
  // that has no object) is an answer, not an outage, and is never hedged.
  let cdnUnreachable = false
  async function fromCdn(path, limit) {
    if (cdnUnreachable) throw new Error("Publication CDN unreachable")
    try {
      return await fetchFrom(CDN, path, limit, cdnTimeoutMs, STABLE_FETCH)
    } catch (error) {
      if (!isHttpError(error)) cdnUnreachable = true
      throw error
    }
  }

  // Bunny first; only an unreachable CDN hedges to the canonical origin's copy
  // of the same object. Returns the parsed object, or null for an HTTP status
  // (404: no object for this gene), and throws when neither source answers.
  async function stableObject(cdnPath, originPath, limit, unavailable) {
    try {
      return await fromCdn(cdnPath, limit)
    } catch (error) {
      if (isHttpError(error)) return null
    }
    try {
      return await fetchFrom(ORIGIN, originPath, limit, undefined, STABLE_FETCH)
    } catch (error) {
      if (isHttpError(error)) return null
      throw new Error(unavailable)
    }
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

  async function gene(symbol) {
    const key = normalizedSymbol(symbol)
    if (!key) return null
    const value = await stableObject(
      `${STABLE_GENE_PATH_PREFIX}${key}.json`,
      `${STABLE_GENE_ORIGIN_PREFIX}${key}.json`,
      STABLE_GENE_OBJECT_LIMIT,
      "The published gene object is unavailable",
    )
    if (value === null) return null
    if (!validStableGene(value, key)) throw new Error(`Invalid published gene object: ${key}`)
    return withImmutableMedia(value)
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

  // One fetch per page: the parsed index stays in memory for every later
  // gallery page, search and metrics read. A failed read is not remembered, so
  // the next call retries.
  function stableCatalog() {
    if (stableCatalogPromise) return stableCatalogPromise
    stableCatalogPromise = (async () => {
      const value = await stableObject(
        STABLE_CATALOG_PATH,
        STABLE_CATALOG_ORIGIN_PATH,
        STABLE_CATALOG_OBJECT_LIMIT,
        "The published Iconoplasm catalog is unavailable",
      )
      if (value === null) throw new Error("No published Iconoplasm catalog is available")
      if (value?.schema !== 3 || !Array.isArray(value.genes))
        throw new Error("Invalid published Iconoplasm catalog")
      const entries = value.genes
        .filter((row) => Array.isArray(row) && normalizedSymbol(row[0]))
        .map(stableCatalogEntry)
      return {
        version: `catalog-v3:${Number(value.watermark_event_id || 0)}`,
        generated_at: String(value.generated_at || ""),
        entries,
        bySymbol: new Map(entries.map((entry) => [entry.symbol, entry])),
      }
    })()
    stableCatalogPromise.catch(() => {
      stableCatalogPromise = null
    })
    return stableCatalogPromise
  }

  // The stable gene object carries its complete candidate pool inline (B-898);
  // a dossier that renders the gallery reads it from the record it already
  // holds. A record without a pool is a broken publication and fails loudly,
  // never "no candidates".
  async function candidateGallery(record) {
    const symbol = normalizedSymbol(record?.symbol)
    if (!symbol) throw new Error("Invalid candidate gallery symbol")
    if (!Array.isArray(record?.portrait_candidates))
      throw new Error(`Published gene object has no candidate pool: ${symbol}`)
    const selected = String(record?.portrait?.asset_sha256 || "").toLowerCase()
    const candidates = selected
      ? record.portrait_candidates.map((item) => ({
          ...item,
          is_current: String(item.asset_sha256 || "").toLowerCase() === selected,
        }))
      : record.portrait_candidates
    return { candidates, count: candidates.length }
  }

  // A brick needs the name and the portrait, which the catalog row carries;
  // the per-brick hydration fetches the full stable gene object afterwards.
  // One catalog fetch per page.
  async function genes(symbols) {
    const keys = [...new Set((Array.isArray(symbols) ? symbols : []).map(normalizedSymbol))]
      .filter(Boolean)
      .slice(0, MAX_GALLERY_PAGE_SIZE)
    if (!keys.length) return []
    const stable = await stableCatalog()
    return keys.map((key) => stable.bySymbol.get(key)).filter(Boolean)
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
    const stable = await stableCatalog()
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

  // B-885: the home sort fields, per gene, from the catalog this page already
  // loads for search and the gallery. A signed-in shelf sorts on these in the
  // browser instead of asking the server to enrich every discovered gene.
  // Keyed by upper-case symbol (discoveries are upper-case; the catalog keeps
  // "C1orf112"). Popularity is not here: the published column carries 0 for
  // every gene (measured 27 Sep), so the page takes it from wiki-pageviews.js.
  async function geneMetrics() {
    const stable = await stableCatalog()
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

  async function gallery({ order = "votes", offset = 0, limit = 24, seed = "" } = {}) {
    const start = Math.max(0, Number(offset) || 0)
    const size = Math.max(1, Math.min(MAX_GALLERY_PAGE_SIZE, Number(limit) || 24))
    // B-886: the published popularity column is 0 for every gene. The static
    // page-view table is the one source; it loads only for the order that
    // needs it, so other guest views never pay its bytes.
    const pageviews = ["popular", "popularity"].includes(order)
      ? (await import("./wiki-pageviews.js?v=cb3a800cea17433a")).ICONOPLASM_WIKI_PAGEVIEWS
      : null
    const stable = await stableCatalog()
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
    return { card_snapshot_version: stable.version, publication_source: "stable_v3" }
  }

  return { gene, genes, candidateGallery, search, gallery, geneMetrics, metadata }
}

export const iconoplasmPublicationReader = createIconoplasmPublicationReader()
