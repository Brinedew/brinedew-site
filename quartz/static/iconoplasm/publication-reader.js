const CDN = "https://img.brinedew.bio"
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
// The names readers type for a gene (HER2, PD-L1, p21, TIPE2): HGNC's alias and
// previous symbols, published by the workstation (Iconoplasm core/alias_publication.py).
// On 2026-10-17 the search box answered "No results" for HER2 and PD-L1, and
// "p21" listed PAK1 before CDKN1A.
const STABLE_ALIASES_PATH = "/catalog/v3/aliases.json"
const STABLE_ALIASES_OBJECT_LIMIT = 4 * 1024 * 1024
const STABLE_SHARED_DISCOVERIES_PATH = "/catalog/v3/shared-discoveries.json"
const STABLE_SHARED_DISCOVERIES_ORIGIN_PATH = "/api/public/v1/shared-discoveries.json"
const STABLE_SHARED_DISCOVERIES_OBJECT_LIMIT = 2 * 1024 * 1024
const STABLE_RESOLVER_PATH = "/catalog/v3/resolve.json"
const STABLE_RESOLVER_OBJECT_LIMIT = 8 * 1024 * 1024

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
      small_url: `${prefix}/small.webp`,
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
  let aliasIndexPromise = null
  let aliasBootstrapPromise = null
  let sharedDiscoveriesPromise = null
  let cdnResolverPromise = null
  let compactResolverHelperPromise = null

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

  async function originFirstObject(cdnPath, originPath, limit, unavailable) {
    try {
      return await fetchFrom(ORIGIN, originPath, limit, undefined, STABLE_FETCH)
    } catch (error) {
      if (isHttpError(error) && error.message.endsWith(" 404")) return null
    }
    return stableObject(cdnPath, originPath, limit, unavailable)
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

  // B-1161: a gene's own address starts this same request from the stub page
  // (scripts/prepare-iconoplasm-edge-assets.mjs, SHELL_STUB_BOOT), seconds
  // before the app has downloaded. The first read of that gene takes the
  // answer once; any miss or failure falls through to the ordinary read.
  async function prefetchedGene(key) {
    const boot = typeof window === "undefined" ? null : window.__iconoplasmGenePrefetch
    if (!boot || boot.key !== key) return null
    window.__iconoplasmGenePrefetch = null
    try {
      const text = await boot.text
      if (!text || new TextEncoder().encode(text).byteLength > STABLE_GENE_OBJECT_LIMIT) return null
      const value = JSON.parse(text)
      return validStableGene(value, key) ? value : null
    } catch (_error) {
      return null
    }
  }

  // fromOrigin: the reader who just changed this gene. Bunny's edge keeps the
  // object up to 60 s after a rewrite, so that one reader reads the canonical
  // origin's copy (one Worker request) and sees the change at once.
  async function gene(symbol, { fromOrigin = false } = {}) {
    const key = normalizedSymbol(symbol)
    if (!key) return null
    if (!fromOrigin) {
      const early = await prefetchedGene(key)
      if (early) return withImmutableMedia(early)
    }
    const cdnPath = `${STABLE_GENE_PATH_PREFIX}${key}.json`
    const originPath = `${STABLE_GENE_ORIGIN_PREFIX}${key}.json`
    const unavailable = "The published gene object is unavailable"
    const value = fromOrigin
      ? await originFirstObject(cdnPath, originPath, STABLE_GENE_OBJECT_LIMIT, unavailable)
      : await stableObject(cdnPath, originPath, STABLE_GENE_OBJECT_LIMIT, unavailable)
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
            small_url: `${prefix}/small.webp`,
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

  // Fetched on the first search only, so a page that never searches loads
  function aliasBootstrap() {
    if (aliasBootstrapPromise) return aliasBootstrapPromise
    aliasBootstrapPromise = import("./generated/publication-alias-bootstrap.js?v=53603570fb701510")
      .then((mod) => mod?.ICONOPLASM_PUBLICATION_ALIAS_BOOTSTRAP || null)
      .catch(() => null)
    return aliasBootstrapPromise
  }

  function compactResolverHelper() {
    if (compactResolverHelperPromise) return compactResolverHelperPromise
    compactResolverHelperPromise = import("./generated/resolver-index.js?v=9135a2db1264bd40").catch(
      () => null,
    )
    return compactResolverHelperPromise
  }

  function cdnResolverIndex() {
    if (cdnResolverPromise) return cdnResolverPromise
    cdnResolverPromise = fromCdn(STABLE_RESOLVER_PATH, STABLE_RESOLVER_OBJECT_LIMIT).catch(
      () => null,
    )
    return cdnResolverPromise
  }

  function normalizeAliasInput(value) {
    return String(value ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 64)
  }

  // The names biologists type: Bunny's static aliases file plus the small curated
  // bootstrap policy (E-cadherin, Cyclin H, cadherin retraction). When the CDN
  // file is unreachable, search retries on the next call rather than pinning a
  // failed read.
  async function aliasData() {
    if (aliasIndexPromise) return aliasIndexPromise
    const promise = Promise.all([
      fromCdn(STABLE_ALIASES_PATH, STABLE_ALIASES_OBJECT_LIMIT)
        .then((value) => {
          if (value?.schema !== 1 || !value.aliases || typeof value.aliases !== "object")
            throw new Error("Invalid published Iconoplasm alias file")
          return { ok: true, aliases: value.aliases }
        })
        .catch(() => ({ ok: false, aliases: {} })),
      aliasBootstrap(),
    ]).then(([cdnResult, bootstrap]) => {
      if (!cdnResult.ok) aliasIndexPromise = null
      const rawMap = new Map()
      for (const [symbol, names] of Object.entries(cdnResult.aliases)) {
        const key = normalizedSymbol(symbol)
        if (!key || !Array.isArray(names)) continue
        rawMap.set(key, names.map((name) => normalizeAliasInput(name)).filter(Boolean))
      }
      if (bootstrap?.remove_by_symbol) {
        for (const [symbol, removed] of Object.entries(bootstrap.remove_by_symbol)) {
          const key = normalizedSymbol(symbol)
          if (!key || !Array.isArray(removed)) continue
          const drop = new Set(removed.map((item) => normalizeAliasInput(item)).filter(Boolean))
          const current = rawMap.get(key)
          if (current)
            rawMap.set(
              key,
              current.filter((item) => !drop.has(item)),
            )
        }
      }
      if (bootstrap?.by_symbol) {
        for (const [symbol, added] of Object.entries(bootstrap.by_symbol)) {
          const key = normalizedSymbol(symbol)
          if (!key || !Array.isArray(added)) continue
          const current = rawMap.get(key) || []
          const seen = new Set(current)
          for (const raw of added) {
            const cleaned = normalizeAliasInput(raw)
            if (!cleaned || seen.has(cleaned)) continue
            seen.add(cleaned)
            current.push(cleaned)
          }
          rawMap.set(key, current)
        }
      }
      const bySymbol = new Map()
      const exactOwners = new Map()
      const foldedOwners = new Map()
      for (const [key, list] of rawMap) {
        if (!list.length) continue
        const lower = list.map((name) => name.toLowerCase())
        bySymbol.set(key, { names: lower, compact: new Set(lower.map(compactName)) })
        for (const alias of list) {
          const priorExact = exactOwners.get(alias)
          if (priorExact === undefined) exactOwners.set(alias, key)
          else if (priorExact !== key) exactOwners.set(alias, null)
          const folded = compactName(alias.toLowerCase())
          if (folded) {
            const priorFolded = foldedOwners.get(folded)
            if (priorFolded === undefined) foldedOwners.set(folded, key)
            else if (priorFolded !== key) foldedOwners.set(folded, null)
          }
        }
      }
      return { bySymbol, exactOwners, foldedOwners }
    })
    aliasIndexPromise = promise
    return promise
  }

  // "PD-L1", "pdl1" and "PD L1" are one name.
  function compactName(value) {
    return value.replace(/[^a-z0-9\u0370-\u03ff]/gu, "")
  }

  function searchRank(needle, compact, rawSymbol, rawName, aliases) {
    const symbol = String(rawSymbol || "").toLowerCase()
    const name = String(rawName || "").toLowerCase()
    // An exact full name ("insulin" for INS) is as good as an exact symbol; ranked with the
    // prefix matches it sorted after "insulin degrading enzyme" and every IGF gene.
    if (symbol === needle || name === needle) return 1
    // An exact alias names the gene as surely ("p53" is TP53), ahead of every gene
    // whose name merely starts with it (PDRG1, "p53 and DNA damage regulated 1").
    if (aliases && compact && aliases.compact.has(compact)) return 2
    if (symbol.startsWith(needle)) return 3
    if (name.startsWith(needle)) return 4
    if (aliases && needle.length > 1 && aliases.names.some((alias) => alias.startsWith(needle)))
      return 5
    if (symbol.includes(needle)) return 6
    if (name.includes(needle)) return 7
    return 0
  }

  async function search(query, { limit = 12, symbols = null } = {}) {
    const needle = String(query || "")
      .trim()
      .toLowerCase()
    if (!needle) return { genes: [], query: "" }
    const allowed = symbols ? new Set(Array.from(symbols, normalizedSymbol).filter(Boolean)) : null
    const size = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(limit) || 12))
    const [stable, aliasState] = await Promise.all([stableCatalog(), aliasData().catch(() => null)])
    const aliases = aliasState?.bySymbol || null
    const compact = compactName(needle)
    const ranked = []
    for (const entry of stable.entries) {
      if (allowed && !allowed.has(normalizedSymbol(entry.symbol))) continue
      // The catalogue keeps "C1orf112"; the alias file is keyed upper-case.
      const geneAliases = aliases?.get(normalizedSymbol(entry.symbol))
      const rank = searchRank(needle, compact, entry.symbol, entry.full_name, geneAliases)
      if (rank) ranked.push({ rank, entry })
    }
    ranked.sort(
      (left, right) =>
        left.rank - right.rank || left.entry.symbol.localeCompare(right.entry.symbol),
    )
    return { genes: ranked.slice(0, size).map((item) => item.entry), query: needle.toUpperCase() }
  }

  // B-1136: shared-discovery symbols published hourly to catalog/v3/shared-discoveries.json
  // with a one-time origin fallback only if the CDN does not have it yet.
  async function sharedDiscoverySymbols() {
    if (sharedDiscoveriesPromise) return sharedDiscoveriesPromise
    sharedDiscoveriesPromise = (async () => {
      let value = null
      try {
        value = await fromCdn(
          STABLE_SHARED_DISCOVERIES_PATH,
          STABLE_SHARED_DISCOVERIES_OBJECT_LIMIT,
        )
      } catch {
        value = await fetchFrom(
          ORIGIN,
          STABLE_SHARED_DISCOVERIES_ORIGIN_PATH,
          STABLE_SHARED_DISCOVERIES_OBJECT_LIMIT,
          undefined,
          STABLE_FETCH,
        )
      }
      if (!Array.isArray(value?.symbols)) {
        throw new Error("Invalid published Iconoplasm shared-discovery list")
      }
      return Array.from(new Set(value.symbols.map(normalizedSymbol).filter(Boolean)))
    })()
    sharedDiscoveriesPromise.catch(() => {
      sharedDiscoveriesPromise = null
    })
    return sharedDiscoveriesPromise
  }

  // B-1136: resolve gene symbols, aliases and UniProt accessions directly from
  // the CDN catalog + aliases files (and resolve.json only when needed for UniProt
  // or uncached aliases), avoiding stateful Worker cold-start scans.
  async function resolve(identifiers) {
    const requestedList = Array.from(identifiers || [], (item) => String(item ?? "").trim())
    if (!requestedList.length) return []
    const stable = await stableCatalog()
    if (!stable.symbolSet) {
      stable.symbolSet = new Set(
        stable.entries.map((entry) => normalizedSymbol(entry.symbol)).filter(Boolean),
      )
    }
    const results = requestedList.map((requested) => {
      const symbol = normalizedSymbol(requested)
      if (symbol && stable.symbolSet.has(symbol)) {
        return { requested, canonical_symbol: symbol, matched_by: "symbol", found: true }
      }
      return null
    })
    if (results.every(Boolean)) return results

    const { exactOwners, foldedOwners } = await aliasData()
    for (let index = 0; index < requestedList.length; index += 1) {
      if (results[index]) continue
      const aliasKey = normalizeAliasInput(requestedList[index])
      if (!aliasKey) continue
      const exact = exactOwners.get(aliasKey)
      if (exact && stable.symbolSet.has(exact)) {
        results[index] = {
          requested: requestedList[index],
          canonical_symbol: exact,
          matched_by: "alias",
          found: true,
        }
        continue
      }
      if (exact === undefined) {
        const folded = compactName(aliasKey.toLowerCase())
        const foldedOwner = folded ? foldedOwners.get(folded) : null
        if (foldedOwner && stable.symbolSet.has(foldedOwner)) {
          results[index] = {
            requested: requestedList[index],
            canonical_symbol: foldedOwner,
            matched_by: "alias",
            found: true,
          }
        }
      }
    }
    if (results.every(Boolean)) return results

    const [compactIndex, helper, bootstrap] = await Promise.all([
      cdnResolverIndex(),
      compactResolverHelper(),
      aliasBootstrap(),
    ])
    const compactOverlay =
      compactIndex && helper?.buildCompactResolverOverlay && bootstrap
        ? helper.buildCompactResolverOverlay(compactIndex, bootstrap)
        : null
    for (let index = 0; index < requestedList.length; index += 1) {
      if (results[index]) continue
      const requested = requestedList[index]
      if (
        compactIndex &&
        helper?.isValidCompactResolverIndex?.(compactIndex) &&
        typeof helper.resolveIdentifierFromCompactIndex === "function"
      ) {
        const match = helper.resolveIdentifierFromCompactIndex(
          compactIndex,
          requested,
          compactOverlay,
        )
        if (match?.found) {
          results[index] = match
          continue
        }
      }
      results[index] = {
        requested,
        canonical_symbol: null,
        matched_by: null,
        found: false,
      }
    }
    return results
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
      ? (
          await import("./wiki-pageviews.js?v=cb3a800cea17433a").catch((error) => {
            // A release removed it after this page opened: reload once (Head.tsx).
            globalThis.__iconoplasmReloadForRelease?.(error)
            throw error
          })
        ).ICONOPLASM_WIKI_PAGEVIEWS
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

  // B-1098: every gene, in catalogue order, for /genes and /caretakers. The
  // genes table shows symbol and name only (portraits are what discovering a
  // gene earns); the caretakers list shows the thumbnail of each caretaker's gene.
  async function catalogIndex() {
    const stable = await stableCatalog()
    return stable.entries.map((entry) => ({
      symbol: entry.symbol,
      full_name: entry.full_name,
      small_url: entry.portrait ? entry.portrait.small_url : "",
    }))
  }

  async function metadata() {
    const stable = await stableCatalog()
    return { card_snapshot_version: stable.version, publication_source: "stable_v3" }
  }

  // B-1147: the gene as its object will read once a vote has made `winner`
  // ({ asset_sha256, vote_version }, from the vote's reply) the winner, built
  // from the candidate the object already holds, field for field as the
  // builder's winnerPortrait (workers/lib/iconoplasm-stable-gene-object.js)
  // does. `tally` (the reply's snapshot of the voted portrait) brings that
  // candidate's counts up to date. The republish that writes the real object
  // lands about a second later. Null when the candidate isn't in this object.
  function withWinner(record, winner, tally = null) {
    const pick = (value) => String(value || "").toLowerCase()
    const winnerSha = pick(winner?.asset_sha256)
    const pool = Array.isArray(record?.portrait_candidates) ? record.portrait_candidates : []
    const candidate = HASH.test(winnerSha)
      ? pool.find((entry) => pick(entry?.asset_sha256) === winnerSha)
      : null
    if (!candidate) return null
    const votedSha = pick(tally?.asset_sha256)
    const counted = (entry) =>
      votedSha && pick(entry.asset_sha256) === votedSha
        ? {
            ...entry,
            image_upvotes: Number(tally.image_upvotes || 0),
            image_downvotes: Number(tally.image_downvotes || 0),
            image_score: Number(tally.image_score || 0),
            weighted_score: Number(tally.weighted_score ?? tally.image_score ?? 0),
          }
        : entry
    const rest = pool.filter((entry) => entry !== candidate)
    return withImmutableMedia({
      ...record,
      vote_version: Number(winner.vote_version ?? record.vote_version) || 0,
      portrait: {
        status: "published",
        hero_url: candidate.full_url,
        medium_url: candidate.medium_url,
        small_url: candidate.small_url,
        width: candidate.width ?? null,
        height: candidate.height ?? null,
        asset_sha256: candidate.asset_sha256,
        candidate_image_id: candidate.candidate_image_id,
        vision_id: candidate.vision_id,
        emulsion_id: candidate.emulsion_id,
        emulsion_label: candidate.emulsion_label,
        sample_label: candidate.sample_label,
        sample_number: candidate.sample_number,
        sample_text_hash: candidate.sample_text_hash,
        artist_id: candidate.artist_id,
      },
      // The winner leads the pool, as in the builder's reading order.
      portrait_candidates: [candidate, ...rest].map((entry) => ({
        ...counted(entry),
        is_current: entry === candidate,
      })),
    })
  }

  return {
    gene,
    genes,
    search,
    sharedDiscoverySymbols,
    resolve,
    gallery,
    geneMetrics,
    metadata,
    catalogIndex,
    withWinner,
  }
}

export const iconoplasmPublicationReader = createIconoplasmPublicationReader()
