;(function (root) {
  "use strict"

  const SUPPORTED_SCHEMA_VERSION = 1
  const MAX_ALIAS_COUNT = 500
  const MAX_ALIAS_LENGTH = 64

  function normalizeSymbol(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
  }

  function normalizeAlias(value) {
    const alias = String(value || "")
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\s+/g, " ")
    if (!alias || alias.length > MAX_ALIAS_LENGTH) return ""
    if (!/[A-Za-z\u0370-\u03ff]/u.test(alias)) return ""
    return alias
  }

  function aliasCollisionKey(value) {
    return normalizeAlias(value).toUpperCase()
  }

  function emptyOverlay() {
    return {
      schema_version: 0,
      version: "",
      alias_count: 0,
      by_symbol: {},
    }
  }

  function normalizePublishedAliasOverlay(rawOverlay) {
    if (rawOverlay == null) return emptyOverlay()
    if (!rawOverlay || typeof rawOverlay !== "object" || Array.isArray(rawOverlay)) return null

    const schemaVersion = Number.parseInt(String(rawOverlay.schema_version || 0), 10)
    const version = String(rawOverlay.version || "").trim()
    const rawBySymbol = rawOverlay.by_symbol
    if (
      schemaVersion !== SUPPORTED_SCHEMA_VERSION ||
      !version ||
      !rawBySymbol ||
      typeof rawBySymbol !== "object" ||
      Array.isArray(rawBySymbol)
    ) {
      return null
    }

    const bySymbol = {}
    const aliasOwners = new Map()
    let aliasCount = 0
    for (const rawSymbol of Object.keys(rawBySymbol).sort()) {
      const symbol = normalizeSymbol(rawSymbol)
      const rawAliases = rawBySymbol[rawSymbol]
      if (
        !symbol ||
        symbol !== rawSymbol ||
        !Array.isArray(rawAliases) ||
        rawAliases.length === 0
      ) {
        return null
      }

      const aliases = []
      const localAliases = new Set()
      for (const rawAlias of rawAliases) {
        const alias = normalizeAlias(rawAlias)
        const key = aliasCollisionKey(alias)
        if (!alias || alias !== rawAlias || !key || (key === symbol && alias === symbol))
          return null
        const owner = aliasOwners.get(key)
        if (owner && owner !== symbol) return null
        aliasOwners.set(key, symbol)
        if (localAliases.has(alias)) continue
        localAliases.add(alias)
        aliases.push(alias)
        aliasCount += 1
        if (aliasCount > MAX_ALIAS_COUNT) return null
      }
      bySymbol[symbol] = aliases
    }

    if (
      Number.isFinite(Number(rawOverlay.alias_count)) &&
      Number(rawOverlay.alias_count) !== aliasCount
    ) {
      return null
    }
    return {
      schema_version: schemaVersion,
      version,
      alias_count: aliasCount,
      by_symbol: bySymbol,
    }
  }

  function removePreviouslyAppliedAliases(geneMap, previousApplied) {
    const safeGeneMap = geneMap && typeof geneMap === "object" ? geneMap : {}
    const safeApplied =
      previousApplied && typeof previousApplied === "object" ? previousApplied : {}
    for (const [rawSymbol, rawAliases] of Object.entries(safeApplied)) {
      const symbol = normalizeSymbol(rawSymbol)
      const entry = safeGeneMap[symbol]
      if (!entry || !Array.isArray(entry.a) || !Array.isArray(rawAliases)) continue
      const removals = new Set(rawAliases.map(normalizeAlias).filter(Boolean))
      const remaining = entry.a.filter((alias) => !removals.has(String(alias || "")))
      if (remaining.length) entry.a = remaining
      else delete entry.a
    }
    return safeGeneMap
  }

  function applyPublishedAliasOverlay(geneMap, overlay, previousApplied = {}) {
    const safeGeneMap = removePreviouslyAppliedAliases(geneMap, previousApplied)
    const safeOverlay = overlay || emptyOverlay()
    const canonicalSymbols = new Set(Object.keys(safeGeneMap).map(normalizeSymbol).filter(Boolean))
    const aliasOwners = new Map()
    const errors = []

    for (const [symbol, entry] of Object.entries(safeGeneMap)) {
      for (const alias of Array.isArray(entry && entry.a) ? entry.a : []) {
        const key = aliasCollisionKey(alias)
        if (key && !aliasOwners.has(key)) aliasOwners.set(key, normalizeSymbol(symbol))
      }
    }

    const applied = {}
    for (const [symbol, aliases] of Object.entries(safeOverlay.by_symbol || {})) {
      const entry = safeGeneMap[symbol]
      if (!entry) {
        errors.push(`Unknown canonical alias target: ${symbol}`)
        continue
      }
      const existingAliases = Array.isArray(entry.a) ? [...entry.a] : []
      const exactAliases = new Set(existingAliases)
      for (const alias of aliases) {
        const key = aliasCollisionKey(alias)
        if (canonicalSymbols.has(key) && key !== symbol) {
          errors.push(`Alias ${alias} for ${symbol} collides with canonical symbol ${key}`)
          continue
        }
        const owner = aliasOwners.get(key)
        if (owner && owner !== symbol) {
          errors.push(`Alias ${alias} is already owned by ${owner}`)
          continue
        }
        aliasOwners.set(key, symbol)
        if (exactAliases.has(alias)) continue
        exactAliases.add(alias)
        existingAliases.push(alias)
        if (!applied[symbol]) applied[symbol] = []
        applied[symbol].push(alias)
      }
      if (existingAliases.length) entry.a = existingAliases
    }

    return { genes: safeGeneMap, applied, errors }
  }

  root.IconoplasmPublicationAliasOverlay = {
    normalizePublishedAliasOverlay,
    applyPublishedAliasOverlay,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
