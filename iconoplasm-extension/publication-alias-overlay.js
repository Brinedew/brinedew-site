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
    return normalizeAlias(value)
  }

  function emptyOverlay() {
    return {
      schema_version: 0,
      version: "",
      alias_count: 0,
      removal_count: 0,
      by_symbol: {},
      remove_by_symbol: {},
    }
  }

  function normalizePublishedAliasOverlay(rawOverlay) {
    if (rawOverlay == null) return emptyOverlay()
    if (!rawOverlay || typeof rawOverlay !== "object" || Array.isArray(rawOverlay)) return null

    const schemaVersion = Number.parseInt(String(rawOverlay.schema_version || 0), 10)
    const version = String(rawOverlay.version || "").trim()
    const rawBySymbol = rawOverlay.by_symbol
    const rawRemoveBySymbol = rawOverlay.remove_by_symbol || {}
    if (
      schemaVersion !== SUPPORTED_SCHEMA_VERSION ||
      !version ||
      !rawBySymbol ||
      typeof rawBySymbol !== "object" ||
      Array.isArray(rawBySymbol) ||
      !rawRemoveBySymbol ||
      typeof rawRemoveBySymbol !== "object" ||
      Array.isArray(rawRemoveBySymbol)
    ) {
      return null
    }

    const bySymbol = {}
    const removeBySymbol = {}
    const aliasOwners = new Map()
    let aliasCount = 0
    let removalCount = 0
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

    for (const rawSymbol of Object.keys(rawRemoveBySymbol).sort()) {
      const symbol = normalizeSymbol(rawSymbol)
      const rawAliases = rawRemoveBySymbol[rawSymbol]
      if (
        !symbol ||
        symbol !== rawSymbol ||
        !Array.isArray(rawAliases) ||
        rawAliases.length === 0
      ) {
        return null
      }

      const removals = []
      const localRemovalKeys = new Set()
      const localAdditionKeys = new Set((bySymbol[symbol] || []).map(aliasCollisionKey))
      for (const rawAlias of rawAliases) {
        const alias = normalizeAlias(rawAlias)
        const key = aliasCollisionKey(alias)
        if (!alias || alias !== rawAlias || !key || localAdditionKeys.has(key)) {
          return null
        }
        if (localRemovalKeys.has(key)) continue
        localRemovalKeys.add(key)
        removals.push(alias)
        removalCount += 1
        if (aliasCount + removalCount > MAX_ALIAS_COUNT) return null
      }
      removeBySymbol[symbol] = removals
    }

    if (
      Number.isFinite(Number(rawOverlay.alias_count)) &&
      Number(rawOverlay.alias_count) !== aliasCount
    ) {
      return null
    }
    if (
      Number.isFinite(Number(rawOverlay.removal_count)) &&
      Number(rawOverlay.removal_count) !== removalCount
    ) {
      return null
    }
    return {
      schema_version: schemaVersion,
      version,
      alias_count: aliasCount,
      removal_count: removalCount,
      by_symbol: bySymbol,
      remove_by_symbol: removeBySymbol,
    }
  }

  function normalizePreviousApplied(previousApplied) {
    if (!previousApplied || typeof previousApplied !== "object") {
      return { added_by_symbol: {}, removed_by_symbol: {} }
    }
    if (previousApplied.added_by_symbol || previousApplied.removed_by_symbol) {
      return {
        added_by_symbol:
          previousApplied.added_by_symbol && typeof previousApplied.added_by_symbol === "object"
            ? previousApplied.added_by_symbol
            : {},
        removed_by_symbol:
          previousApplied.removed_by_symbol && typeof previousApplied.removed_by_symbol === "object"
            ? previousApplied.removed_by_symbol
            : {},
      }
    }
    // Accept the unstructured additions shape during in-place cache migration.
    return { added_by_symbol: previousApplied, removed_by_symbol: {} }
  }

  function revertPreviouslyAppliedPolicy(geneMap, previousApplied) {
    const safeGeneMap = geneMap && typeof geneMap === "object" ? geneMap : {}
    const safeApplied = normalizePreviousApplied(previousApplied)
    for (const [rawSymbol, rawAliases] of Object.entries(safeApplied.added_by_symbol)) {
      const symbol = normalizeSymbol(rawSymbol)
      const entry = safeGeneMap[symbol]
      if (!entry || !Array.isArray(entry.a) || !Array.isArray(rawAliases)) continue
      const removals = new Set(rawAliases.map(normalizeAlias).filter(Boolean))
      const remaining = entry.a.filter((alias) => !removals.has(String(alias || "")))
      if (remaining.length) entry.a = remaining
      else delete entry.a
    }
    for (const [rawSymbol, rawAliases] of Object.entries(safeApplied.removed_by_symbol)) {
      const symbol = normalizeSymbol(rawSymbol)
      const entry = safeGeneMap[symbol]
      if (!entry || !Array.isArray(rawAliases)) continue
      const aliases = Array.isArray(entry.a) ? [...entry.a] : []
      const seen = new Set(aliases)
      for (const alias of rawAliases) {
        const normalized = normalizeAlias(alias)
        if (!normalized || seen.has(normalized)) continue
        seen.add(normalized)
        aliases.push(normalized)
      }
      if (aliases.length) entry.a = aliases
    }
    return safeGeneMap
  }

  function applyPublishedAliasOverlay(geneMap, overlay, previousApplied = {}) {
    const safeGeneMap = revertPreviouslyAppliedPolicy(geneMap, previousApplied)
    const safeOverlay = overlay || emptyOverlay()
    const canonicalSymbols = new Set(Object.keys(safeGeneMap).map(normalizeSymbol).filter(Boolean))
    const errors = []
    const applied = { added_by_symbol: {}, removed_by_symbol: {} }

    for (const [symbol, removals] of Object.entries(safeOverlay.remove_by_symbol || {})) {
      const entry = safeGeneMap[symbol]
      if (!entry) {
        errors.push(`Unknown canonical alias-removal target: ${symbol}`)
        continue
      }
      const removalKeys = new Set(removals.map(aliasCollisionKey).filter(Boolean))
      const existingAliases = Array.isArray(entry.a) ? entry.a : []
      const remainingAliases = []
      for (const alias of existingAliases) {
        if (removalKeys.has(aliasCollisionKey(alias))) {
          if (!applied.removed_by_symbol[symbol]) applied.removed_by_symbol[symbol] = []
          applied.removed_by_symbol[symbol].push(alias)
        } else {
          remainingAliases.push(alias)
        }
      }
      if (remainingAliases.length) entry.a = remainingAliases
      else delete entry.a
    }

    const aliasOwners = new Map()
    for (const [symbol, entry] of Object.entries(safeGeneMap)) {
      for (const alias of Array.isArray(entry && entry.a) ? entry.a : []) {
        const key = aliasCollisionKey(alias)
        if (key && !aliasOwners.has(key)) aliasOwners.set(key, normalizeSymbol(symbol))
      }
    }

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
        if (!applied.added_by_symbol[symbol]) applied.added_by_symbol[symbol] = []
        applied.added_by_symbol[symbol].push(alias)
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
