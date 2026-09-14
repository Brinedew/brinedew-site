const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

function symbol(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(normalized)) throw new TypeError("Invalid discovery dictionary symbol")
  return normalized
}

function aliases(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(symbol))].sort()
}

function normalizedPrevious(raw) {
  const entries = Array.isArray(raw?.entries) ? raw.entries : []
  const seenOrdinals = new Set()
  const seenNames = new Map()
  const normalized = entries.map((entry) => {
    const ordinal = Number(entry?.ordinal)
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 1_000_000)
      throw new TypeError("Invalid discovery ordinal")
    if (seenOrdinals.has(ordinal)) throw new TypeError("Duplicate discovery ordinal")
    seenOrdinals.add(ordinal)
    const canonical = symbol(entry?.symbol)
    const historical = aliases(entry?.aliases).filter((name) => name !== canonical)
    for (const name of [canonical, ...historical]) {
      const prior = seenNames.get(name)
      if (prior != null && prior !== ordinal)
        throw new TypeError(`Discovery dictionary name is ambiguous: ${name}`)
      seenNames.set(name, ordinal)
    }
    return {
      ordinal,
      symbol: canonical,
      aliases: historical,
      active: entry?.active !== false,
    }
  })
  normalized.sort((left, right) => left.ordinal - right.ordinal)
  return {
    schema: "iconoplasm.discoveryOrdinalDictionary.v1",
    version: Math.max(0, Number(raw?.version || 0)),
    entries: normalized,
  }
}

function aliasMap(rawAliases) {
  const map = new Map()
  const pairs =
    rawAliases instanceof Map
      ? [...rawAliases.entries()]
      : rawAliases && typeof rawAliases === "object"
        ? Object.entries(rawAliases)
        : []
  for (const [rawAlias, rawCanonical] of pairs) {
    const alias = symbol(rawAlias)
    const canonical = symbol(rawCanonical)
    if (alias === canonical) continue
    const prior = map.get(alias)
    if (prior && prior !== canonical)
      throw new TypeError(`Discovery alias has multiple canonical targets: ${alias}`)
    map.set(alias, canonical)
  }
  return map
}

function stableEntry(entry) {
  return {
    ordinal: entry.ordinal,
    symbol: entry.symbol,
    aliases: [...entry.aliases].sort(),
    active: Boolean(entry.active),
  }
}

function signature(entries) {
  return JSON.stringify(entries.map(stableEntry))
}

export function evolveDiscoveryOrdinalDictionary({ previous = null, symbols = [], aliases = {} } = {}) {
  const prior = normalizedPrevious(previous)
  const current = new Set((Array.isArray(symbols) ? symbols : []).map(symbol))
  const redirects = aliasMap(aliases)
  const claimedCurrent = new Map()
  const entries = prior.entries.map((entry) => {
    let canonical = entry.symbol
    const historical = new Set(entry.aliases)
    if (!current.has(canonical)) {
      const redirected = redirects.get(canonical)
      if (redirected && current.has(redirected)) {
        historical.add(canonical)
        canonical = redirected
      }
    }
    for (const oldName of [...historical]) {
      const redirected = redirects.get(oldName)
      if (redirected && current.has(redirected) && !current.has(canonical)) canonical = redirected
    }
    const active = current.has(canonical)
    if (active) {
      const owner = claimedCurrent.get(canonical)
      if (owner != null && owner !== entry.ordinal)
        throw new TypeError(`Two discovery ordinals resolve to current symbol ${canonical}`)
      claimedCurrent.set(canonical, entry.ordinal)
    }
    historical.delete(canonical)
    return {
      ordinal: entry.ordinal,
      symbol: canonical,
      aliases: [...historical].sort(),
      active,
    }
  })

  let nextOrdinal = entries.length
    ? Math.max(...entries.map((entry) => entry.ordinal)) + 1
    : 0
  for (const currentSymbol of [...current].sort()) {
    if (claimedCurrent.has(currentSymbol)) continue
    const oldEntry = entries.find(
      (entry) => entry.aliases.includes(currentSymbol) || entry.symbol === currentSymbol,
    )
    if (oldEntry) {
      if (oldEntry.active && oldEntry.symbol !== currentSymbol)
        throw new TypeError(`Discovery symbol ${currentSymbol} is already claimed as an alias`)
      oldEntry.symbol = currentSymbol
      oldEntry.aliases = oldEntry.aliases.filter((name) => name !== currentSymbol)
      oldEntry.active = true
      claimedCurrent.set(currentSymbol, oldEntry.ordinal)
      continue
    }
    entries.push({ ordinal: nextOrdinal++, symbol: currentSymbol, aliases: [], active: true })
    claimedCurrent.set(currentSymbol, entries.at(-1).ordinal)
  }
  entries.sort((left, right) => left.ordinal - right.ordinal)

  const changed = signature(entries) !== signature(prior.entries)
  return {
    schema: "iconoplasm.discoveryOrdinalDictionary.v1",
    version: prior.version || 1 ? (prior.version ? prior.version + (changed ? 1 : 0) : 1) : 1,
    entries,
  }
}

export function discoveryOrdinalLookup(dictionary) {
  const normalized = normalizedPrevious(dictionary)
  const byName = new Map()
  const byOrdinal = new Map()
  for (const entry of normalized.entries) {
    byOrdinal.set(entry.ordinal, stableEntry(entry))
    for (const name of [entry.symbol, ...entry.aliases]) {
      const prior = byName.get(name)
      if (prior != null && prior !== entry.ordinal)
        throw new TypeError(`Discovery dictionary name is ambiguous: ${name}`)
      byName.set(name, entry.ordinal)
    }
  }
  return { version: normalized.version, byName, byOrdinal }
}
