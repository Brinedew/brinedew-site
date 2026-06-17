;(function (root) {
  "use strict"

  const storageKeys = Object.freeze({
    highlightMode: "iconoplasm_highlight_mode",
    highlightVisibility: "iconoplasm_highlight_visibility",
    cardVariant: "iconoplasm_card_variant",
    guestDiscoveries: "iconoplasm_guest_discoveries_v1",
    removedDefaults: "iconoplasm_removed_defaults",
    userBlocklist: "iconoplasm_user_blocklist",
  })

  function normalizeCardVariant(raw, cardShared) {
    if (cardShared && typeof cardShared.normalizeCardVariant === "function") {
      const normalized = cardShared.normalizeCardVariant(raw)
      return normalized === "simple" && raw == null ? "image-only" : normalized
    }
    return "image-only"
  }

  function buildEffectiveBlocklist(defaults, userEntries, removedDefaults) {
    const defaultSet = new Set()
    const removed = new Set(Array.isArray(removedDefaults) ? removedDefaults : [])
    const effective = new Set()
    for (const rawSymbol of Array.isArray(defaults) ? defaults : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (symbol) defaultSet.add(symbol)
      if (symbol && !removed.has(symbol)) effective.add(symbol)
    }
    for (const rawSymbol of Array.isArray(userEntries) ? userEntries : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (defaultSet.has(symbol)) continue
      if (symbol) effective.add(symbol)
    }
    return effective
  }

  root.IconoplasmContentSettings = {
    storageKeys,
    normalizeCardVariant,
    buildEffectiveBlocklist,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
