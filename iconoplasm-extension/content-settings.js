;(function (root) {
  "use strict"

  const storageKeys = Object.freeze({
    highlightMode: "iconoplasm_highlight_mode",
    highlightVisibility: "iconoplasm_highlight_visibility",
    pdfHighlightingEnabled: "iconoplasm_pdf_highlighting_enabled",
    cardVariant: "iconoplasm_card_variant",
    guestDiscoveries: "iconoplasm_guest_discoveries_v1",
    removedDefaults: "iconoplasm_removed_defaults",
    sharedBlocklist: "iconoplasm_extension_blocklist",
    userBlocklist: "iconoplasm_user_blocklist",
  })

  const SHARED_BLOCKLIST_SCHEMA_VERSION = 1
  const SHARED_BLOCKLIST_CONTRACT_REVISION = 1
  const SHARED_BLOCKLIST_MAX_TERMS = 500
  const SHARED_BLOCKLIST_MAX_TERM_LENGTH = 64
  const SHARED_BLOCKLIST_MAX_BYTES = 48 * 1024

  function normalizeHighlightMode(raw) {
    const value = String(raw || "")
      .trim()
      .toLowerCase()
    return value === "underline" ||
      value === "pill" ||
      value === "pill-outline" ||
      value === "ellipse"
      ? value
      : "pill"
  }

  function normalizeHighlightVisibility(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase() === "hover"
      ? "hover"
      : "always"
  }

  function normalizeBlocklistTerm(rawTerm) {
    return String(rawTerm || "")
      .trim()
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .toUpperCase()
  }

  function normalizeBlocklistTerms(rawTerms) {
    const terms = new Set()
    for (const rawTerm of Array.isArray(rawTerms) ? rawTerms : []) {
      const term = normalizeBlocklistTerm(rawTerm)
      if (term) terms.add(term)
    }
    return [...terms].sort()
  }

  function utf8JsonByteLength(value) {
    let bytes = 0
    for (const character of JSON.stringify(value)) {
      const codePoint = character.codePointAt(0)
      bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    }
    return bytes
  }

  function normalizeSharedBlocklistProjection(rawProjection) {
    if (!rawProjection || typeof rawProjection !== "object" || Array.isArray(rawProjection)) {
      return null
    }
    if (rawProjection.schema_version !== SHARED_BLOCKLIST_SCHEMA_VERSION) return null
    const revision = rawProjection.revision
    if (!Number.isSafeInteger(revision) || revision < 1) return null
    if (
      typeof rawProjection.version !== "string" ||
      !/^ebl1-[0-9a-f]{16}$/.test(rawProjection.version.trim()) ||
      !Number.isSafeInteger(rawProjection.term_count) ||
      !Array.isArray(rawProjection.terms) ||
      rawProjection.terms.length > SHARED_BLOCKLIST_MAX_TERMS
    ) {
      return null
    }

    const terms = []
    const seen = new Set()
    for (const rawTerm of rawProjection.terms) {
      if (typeof rawTerm !== "string") return null
      const term = normalizeBlocklistTerm(rawTerm)
      if (
        !term ||
        term.length > SHARED_BLOCKLIST_MAX_TERM_LENGTH ||
        /[\u0000-\u001f\u007f]/u.test(term)
      ) {
        return null
      }
      if (seen.has(term)) continue
      seen.add(term)
      terms.push(term)
    }
    terms.sort()

    if (rawProjection.term_count !== terms.length) {
      return null
    }

    const projection = {
      schema_version: SHARED_BLOCKLIST_SCHEMA_VERSION,
      revision,
      version: rawProjection.version.trim(),
      term_count: terms.length,
      terms,
    }
    if (utf8JsonByteLength(projection) > SHARED_BLOCKLIST_MAX_BYTES) return null
    return projection
  }

  function resolveSharedBlocklistDefaults(storedProjection, packagedDefaults) {
    const projection = normalizeSharedBlocklistProjection(storedProjection)
    return projection ? projection.terms.slice() : normalizeBlocklistTerms(packagedDefaults)
  }

  function normalizeCardVariant(raw, cardShared) {
    if (cardShared && typeof cardShared.normalizeCardVariant === "function") {
      const normalized = cardShared.normalizeCardVariant(raw)
      return normalized === "simple" && raw == null ? "image-only" : normalized
    }
    if (raw === "simple") return "simple"
    if (raw === "image-only") return "image-only"
    if (raw === "lab-label" || raw === "lit-archival") return "lit-archival"
    return "image-only"
  }

  function normalizeBooleanSetting(raw, defaultValue = false) {
    return typeof raw === "boolean" ? raw : Boolean(defaultValue)
  }

  function buildEffectiveBlocklist(defaults, userEntries, removedDefaults) {
    const defaultSet = new Set()
    const removed = new Set(normalizeBlocklistTerms(removedDefaults))
    const effective = new Set()
    for (const symbol of normalizeBlocklistTerms(defaults)) {
      if (symbol) defaultSet.add(symbol)
      if (symbol && !removed.has(symbol)) effective.add(symbol)
    }
    for (const symbol of normalizeBlocklistTerms(userEntries)) {
      if (defaultSet.has(symbol)) continue
      if (symbol) effective.add(symbol)
    }
    return effective
  }

  function removeBlocklistEntry(defaults, userEntries, removedDefaults, rawTerm) {
    const term = normalizeBlocklistTerm(rawTerm)
    const defaultSet = new Set(normalizeBlocklistTerms(defaults))
    const normalizedUsers = normalizeBlocklistTerms(userEntries)
    const normalizedRemoved = normalizeBlocklistTerms(removedDefaults)
    if (!term) {
      return { userEntries: normalizedUsers, removedDefaults: normalizedRemoved }
    }
    if (defaultSet.has(term)) {
      return {
        // A custom term can later be promoted into the authoritative defaults. If
        // the user removes it in that state, delete the stale custom copy too so
        // a later policy demotion cannot silently resurrect it.
        userEntries: normalizedUsers.filter((entry) => entry !== term),
        removedDefaults: normalizeBlocklistTerms([...normalizedRemoved, term]),
      }
    }
    return {
      userEntries: normalizedUsers.filter((entry) => entry !== term),
      removedDefaults: normalizedRemoved,
    }
  }

  function addBlocklistEntries(defaults, userEntries, removedDefaults, rawTerms) {
    const defaultSet = new Set(normalizeBlocklistTerms(defaults))
    const normalizedUsers = new Set(normalizeBlocklistTerms(userEntries))
    const normalizedRemoved = new Set(normalizeBlocklistTerms(removedDefaults))
    for (const term of normalizeBlocklistTerms(rawTerms)) {
      // An explicit Add is the user's newest decision. Clear any historical
      // default-removal tombstone even while the term is temporarily absent from
      // the authoritative defaults, otherwise a later promotion would suppress
      // the custom entry that the user just restored.
      normalizedRemoved.delete(term)
      if (defaultSet.has(term)) normalizedUsers.delete(term)
      else normalizedUsers.add(term)
    }
    return {
      userEntries: [...normalizedUsers].sort(),
      removedDefaults: [...normalizedRemoved].sort(),
    }
  }

  function parseUserBlocklistInput(rawInput) {
    return normalizeBlocklistTerms(String(rawInput || "").split(/[\s,;]+/)).filter((term) =>
      /^[A-Z0-9]{1,12}(-[A-Z0-9]{1,4})?$/.test(term),
    )
  }

  root.IconoplasmContentSettings = {
    storageKeys,
    sharedBlocklistSchemaVersion: SHARED_BLOCKLIST_SCHEMA_VERSION,
    sharedBlocklistContractRevision: SHARED_BLOCKLIST_CONTRACT_REVISION,
    sharedBlocklistMaxTerms: SHARED_BLOCKLIST_MAX_TERMS,
    sharedBlocklistMaxTermLength: SHARED_BLOCKLIST_MAX_TERM_LENGTH,
    sharedBlocklistMaxBytes: SHARED_BLOCKLIST_MAX_BYTES,
    normalizeHighlightMode,
    normalizeHighlightVisibility,
    normalizeCardVariant,
    normalizeBooleanSetting,
    normalizeBlocklistTerm,
    normalizeBlocklistTerms,
    normalizeSharedBlocklistProjection,
    resolveSharedBlocklistDefaults,
    buildEffectiveBlocklist,
    removeBlocklistEntry,
    addBlocklistEntries,
    parseUserBlocklistInput,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
