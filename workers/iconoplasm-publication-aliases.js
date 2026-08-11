export const PUBLICATION_ALIAS_SCHEMA_VERSION = 1
export const MAX_PUBLICATION_ALIAS_COUNT = 500
export const MAX_PUBLICATION_ALIAS_LENGTH = 64

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u

export function expandIconoplasmPublicationAliasForms({
  parts,
  separators = [""],
  suffixes = [""],
}) {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.some(
      (alternatives) =>
        !Array.isArray(alternatives) ||
        alternatives.length === 0 ||
        alternatives.some((value) => typeof value !== "string" || !value),
    ) ||
    !Array.isArray(separators) ||
    separators.length === 0 ||
    separators.some((value) => typeof value !== "string") ||
    !Array.isArray(suffixes) ||
    suffixes.length === 0 ||
    suffixes.some((value) => typeof value !== "string")
  ) {
    throw new TypeError("Publication alias forms require explicit parts, separators, and suffixes")
  }

  let labels = [...parts[0]]
  for (const alternatives of parts.slice(1)) {
    labels = labels.flatMap((prefix) =>
      separators.flatMap((separator) =>
        alternatives.map((alternative) => `${prefix}${separator}${alternative}`),
      ),
    )
  }
  return Object.freeze([
    ...new Set(suffixes.flatMap((suffix) => labels.map((label) => `${label}${suffix}`))),
  ])
}

// This immutable dictionary is the first-deploy bootstrap and normalization
// contract. Routine curated-label authority lives in administrator-managed D1;
// the generated HGNC alias catalog still owns broad biological coverage. Keep
// the bootstrap small and aligned with the migration seed. Maintenance contract:
// docs/ICONOPLASM_PUBLICATION_ALIASES.md
const RAW_PUBLICATION_ALIASES_BY_SYMBOL = Object.freeze({
  BABAM2: Object.freeze(["BRE"]),
  CCNH: Object.freeze(["Cyclin H", "Cyclin-H"]),
  CDH1: expandIconoplasmPublicationAliasForms({
    parts: [["E"], ["cadherin", "Cadherin"]],
    separators: ["-", " "],
    suffixes: ["", "s"],
  }),
  CDH2: expandIconoplasmPublicationAliasForms({
    parts: [["N"], ["cadherin", "Cadherin"]],
    separators: ["-", " "],
    suffixes: ["", "s"],
  }),
  CDK1: Object.freeze(["Cdk1"]),
  CDKN1A: Object.freeze(["p21"]),
  CDKN1B: Object.freeze(["p27"]),
  CDKN1C: Object.freeze(["p57"]),
  CDKN2A: Object.freeze(["p16"]),
  CDKN2B: Object.freeze(["p15"]),
  CDKN2C: Object.freeze(["p18"]),
  CDKN2D: Object.freeze(["p19"]),
  CEBPB: Object.freeze(["C/EBPβ"]),
  CGAS: Object.freeze(["cGAS"]),
  CUL9: Object.freeze(["PARC"]),
  EGR1: Object.freeze(["EGR-1"]),
  ERCC3: Object.freeze(["XPB"]),
  HTT: Object.freeze(["Huntingtin", "Htt"]),
  IL1A: Object.freeze(["IL-1", "IL-1α"]),
  IL1B: Object.freeze(["IL-1β"]),
  MDM2: Object.freeze(["Mdm2"]),
  NOTCH1: Object.freeze(["N1ICD"]),
  RELA: Object.freeze(["p65"]),
  RPRM: Object.freeze(["Reprimo"]),
  TGFB1: Object.freeze(["TGF-β"]),
  TP53: Object.freeze(["p53"]),
  TP63: Object.freeze(["p63"]),
  TP73: Object.freeze(["p73"]),
})

// Retractions are scoped to the canonical owner, so removing a broad source
// alias cannot suppress a same-spelled label intentionally owned by another gene.
const RAW_PUBLICATION_ALIAS_REMOVALS_BY_SYMBOL = Object.freeze({
  CDH17: Object.freeze(["cadherin"]),
})

export function normalizePublicationAliasSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
}

export function normalizePublicationAlias(value) {
  const alias = String(value || "")
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
  if (!alias || alias.length > MAX_PUBLICATION_ALIAS_LENGTH) return ""
  if (CONTROL_CHARACTER_RE.test(alias)) return ""
  if (!/[A-Za-z\u0370-\u03ff]/u.test(alias)) return ""
  return alias
}

export function publicationAliasCollisionKey(value) {
  return normalizePublicationAlias(value).toUpperCase()
}

export function validateIconoplasmPublicationAliases(
  rawAliases = RAW_PUBLICATION_ALIASES_BY_SYMBOL,
  { canonicalSymbols = null, rawRemovals = RAW_PUBLICATION_ALIAS_REMOVALS_BY_SYMBOL } = {},
) {
  if (!rawAliases || typeof rawAliases !== "object" || Array.isArray(rawAliases)) {
    throw new TypeError("Iconoplasm publication aliases must be an object")
  }

  const canonicalSet =
    canonicalSymbols == null
      ? null
      : new Set(
          Array.from(canonicalSymbols, (symbol) => normalizePublicationAliasSymbol(symbol)).filter(
            Boolean,
          ),
        )
  const aliasesBySymbol = {}
  const removalsBySymbol = {}
  const aliasOwners = new Map()
  let aliasCount = 0
  let removalCount = 0

  for (const rawSymbol of Object.keys(rawAliases).sort()) {
    const symbol = normalizePublicationAliasSymbol(rawSymbol)
    if (!symbol || symbol !== rawSymbol) {
      throw new TypeError(`Invalid canonical publication-alias symbol: ${rawSymbol}`)
    }
    if (canonicalSet && !canonicalSet.has(symbol)) {
      throw new TypeError(`Unknown canonical publication-alias symbol: ${symbol}`)
    }
    const rawValues = rawAliases[rawSymbol]
    if (!Array.isArray(rawValues) || rawValues.length === 0) {
      throw new TypeError(`Publication aliases for ${symbol} must be a non-empty array`)
    }

    const aliases = []
    const localAliases = new Set()
    for (const rawAlias of rawValues) {
      const alias = normalizePublicationAlias(rawAlias)
      if (!alias || alias !== rawAlias) {
        throw new TypeError(`Invalid publication alias for ${symbol}: ${String(rawAlias || "")}`)
      }
      const key = publicationAliasCollisionKey(alias)
      if (!key || (key === symbol && alias === symbol)) {
        throw new TypeError(
          `Publication alias for ${symbol} duplicates its canonical symbol: ${alias}`,
        )
      }
      if (canonicalSet && canonicalSet.has(key) && key !== symbol) {
        throw new TypeError(`Publication alias for ${symbol} collides with canonical symbol ${key}`)
      }
      const owner = aliasOwners.get(key)
      if (owner && owner !== symbol) {
        throw new TypeError(`Ambiguous publication alias ${alias}: ${owner} and ${symbol}`)
      }
      aliasOwners.set(key, symbol)
      if (localAliases.has(alias)) continue
      localAliases.add(alias)
      aliases.push(alias)
      aliasCount += 1
      if (aliasCount > MAX_PUBLICATION_ALIAS_COUNT) {
        throw new TypeError(
          `Publication alias overlay exceeds ${MAX_PUBLICATION_ALIAS_COUNT} aliases`,
        )
      }
    }
    aliasesBySymbol[symbol] = Object.freeze(aliases)
  }

  if (!rawRemovals || typeof rawRemovals !== "object" || Array.isArray(rawRemovals)) {
    throw new TypeError("Iconoplasm publication alias removals must be an object")
  }
  for (const rawSymbol of Object.keys(rawRemovals).sort()) {
    const symbol = normalizePublicationAliasSymbol(rawSymbol)
    if (!symbol || symbol !== rawSymbol) {
      throw new TypeError(`Invalid canonical publication-alias removal symbol: ${rawSymbol}`)
    }
    if (canonicalSet && !canonicalSet.has(symbol)) {
      throw new TypeError(`Unknown canonical publication-alias removal symbol: ${symbol}`)
    }
    const rawValues = rawRemovals[rawSymbol]
    if (!Array.isArray(rawValues) || rawValues.length === 0) {
      throw new TypeError(`Publication alias removals for ${symbol} must be a non-empty array`)
    }

    const removals = []
    const localRemovalKeys = new Set()
    const localAdditionKeys = new Set(
      (aliasesBySymbol[symbol] || []).map(publicationAliasCollisionKey).filter(Boolean),
    )
    for (const rawAlias of rawValues) {
      const alias = normalizePublicationAlias(rawAlias)
      const key = publicationAliasCollisionKey(alias)
      if (!alias || alias !== rawAlias || !key) {
        throw new TypeError(
          `Invalid publication alias removal for ${symbol}: ${String(rawAlias || "")}`,
        )
      }
      if (localAdditionKeys.has(key)) {
        throw new TypeError(`Publication alias ${alias} cannot be added and removed for ${symbol}`)
      }
      if (localRemovalKeys.has(key)) continue
      localRemovalKeys.add(key)
      removals.push(alias)
      removalCount += 1
      if (aliasCount + removalCount > MAX_PUBLICATION_ALIAS_COUNT) {
        throw new TypeError(
          `Publication alias policy exceeds ${MAX_PUBLICATION_ALIAS_COUNT} operations`,
        )
      }
    }
    removalsBySymbol[symbol] = Object.freeze(removals)
  }

  return Object.freeze({
    schema_version: PUBLICATION_ALIAS_SCHEMA_VERSION,
    alias_count: aliasCount,
    removal_count: removalCount,
    by_symbol: Object.freeze(aliasesBySymbol),
    remove_by_symbol: Object.freeze(removalsBySymbol),
  })
}

export const ICONOPLASM_DEFAULT_PUBLICATION_ALIASES = validateIconoplasmPublicationAliases()

export async function iconoplasmPublicationAliasManifestFromPolicy(rawPolicy) {
  const source = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : {}
  const policy = validateIconoplasmPublicationAliases(source.by_symbol || {}, {
    rawRemovals: source.remove_by_symbol || {},
  })
  const versionInput = JSON.stringify(policy)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(versionInput))
  const versionHash = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
  return Object.freeze({
    ...policy,
    version: `v${PUBLICATION_ALIAS_SCHEMA_VERSION}-${versionHash}`,
  })
}

let publicationAliasManifestPromise = null

export async function iconoplasmPublicationAliasManifest() {
  if (!publicationAliasManifestPromise) {
    publicationAliasManifestPromise = iconoplasmPublicationAliasManifestFromPolicy(
      ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
    )
  }
  return publicationAliasManifestPromise
}

export function applyIconoplasmPublicationAliasPolicyToGene(gene, symbol, overlay) {
  const canonicalSymbol = normalizePublicationAliasSymbol(symbol || gene?.s)
  if (!gene) return gene
  const additions = overlay?.by_symbol?.[canonicalSymbol]
  const removals = overlay?.remove_by_symbol?.[canonicalSymbol]
  if (
    (!Array.isArray(additions) || additions.length === 0) &&
    (!Array.isArray(removals) || removals.length === 0)
  ) {
    return gene
  }

  const removalKeys = new Set((removals || []).map(publicationAliasCollisionKey).filter(Boolean))
  const mergedAliases = (Array.isArray(gene.a) ? gene.a : []).filter(
    (alias) => !removalKeys.has(publicationAliasCollisionKey(alias)),
  )
  const seen = new Set(mergedAliases)
  for (const alias of additions || []) {
    if (seen.has(alias)) continue
    seen.add(alias)
    mergedAliases.push(alias)
  }
  const nextGene = { ...gene }
  if (mergedAliases.length) nextGene.a = mergedAliases
  else delete nextGene.a
  return nextGene
}

export function buildIconoplasmPublishedAliasRecognitionContext(genes) {
  const canonicalSymbols = new Set()
  const collisionOwners = new Map()
  const publishedOwners = new Map()
  const publishedKeysByCollisionOwner = new Map()
  for (const [rawSymbol, gene] of Object.entries(genes || {})) {
    const symbol = normalizePublicationAliasSymbol(rawSymbol)
    if (!symbol) continue
    canonicalSymbols.add(symbol)
    for (const rawAlias of Array.isArray(gene?.a) ? gene.a : []) {
      const alias = normalizePublicationAlias(rawAlias)
      const collisionKey = publicationAliasCollisionKey(alias)
      const publishedKey = publishedAliasTermKey(rawAlias)
      if (!alias || !collisionKey || !publishedKey) continue
      if (!collisionOwners.has(collisionKey)) collisionOwners.set(collisionKey, new Set())
      collisionOwners.get(collisionKey).add(symbol)
      if (!publishedOwners.has(publishedKey)) publishedOwners.set(publishedKey, new Set())
      publishedOwners.get(publishedKey).add(symbol)
      if (!publishedKeysByCollisionOwner.has(collisionKey)) {
        publishedKeysByCollisionOwner.set(collisionKey, new Map())
      }
      const byOwner = publishedKeysByCollisionOwner.get(collisionKey)
      if (!byOwner.has(symbol)) byOwner.set(symbol, new Set())
      byOwner.get(symbol).add(publishedKey)
    }
  }
  return Object.freeze({
    canonicalSymbols,
    collisionOwners,
    publishedOwners,
    publishedKeysByCollisionOwner,
  })
}

export function publishedAliasTermKey(value) {
  const term = String(value || "")
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toUpperCase()
  if (!term || term.length > MAX_PUBLICATION_ALIAS_LENGTH || CONTROL_CHARACTER_RE.test(term)) {
    return ""
  }
  return term
}
