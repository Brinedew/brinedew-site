;(function (root) {
  "use strict"

  const storageKeys = Object.freeze({
    highlightMode: "iconoplasm_highlight_mode",
    tooltipTheme: "iconoplasm_tooltip_theme",
    cardVariant: "iconoplasm_card_variant",
    guestDiscoveries: "iconoplasm_guest_discoveries_v1",
    removedDefaults: "iconoplasm_removed_defaults",
    userBlocklist: "iconoplasm_user_blocklist",
  })

  function normalizeTooltipTheme(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase() === "dark"
      ? "dark"
      : "light"
  }

  function normalizeCardVariant(raw, cardShared) {
    if (cardShared && typeof cardShared.normalizeCardVariant === "function") {
      return cardShared.normalizeCardVariant(raw)
    }
    return "simple"
  }

  function buildEffectiveBlocklist(defaults, userEntries, removedDefaults) {
    const removed = new Set(Array.isArray(removedDefaults) ? removedDefaults : [])
    const effective = new Set()
    for (const rawSymbol of Array.isArray(defaults) ? defaults : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (symbol && !removed.has(symbol)) effective.add(symbol)
    }
    for (const rawSymbol of Array.isArray(userEntries) ? userEntries : []) {
      const symbol = String(rawSymbol || "")
        .trim()
        .toUpperCase()
      if (symbol) effective.add(symbol)
    }
    return effective
  }

  root.IconoplasmContentSettings = {
    storageKeys,
    normalizeTooltipTheme,
    normalizeCardVariant,
    buildEffectiveBlocklist,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
