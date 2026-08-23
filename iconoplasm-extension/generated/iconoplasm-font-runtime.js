/* GENERATED FILE. Edit shared/iconoplasm-card/font-contract.json and rerun node scripts/sync-iconoplasm-shared.mjs. */

;(function installIconoplasmExtensionFontRuntime(root) {
  "use strict"

  const FONT_DEFINITIONS = Object.freeze(
    [
      {
        "family": "IBM Plex Mono",
        "path": "fonts/IBMPlexMono-Regular.woff2",
        "weight": "400",
        "style": "normal",
        "display": "swap"
      },
      {
        "family": "IBM Plex Mono",
        "path": "fonts/IBMPlexMono-Medium.woff2",
        "weight": "500",
        "style": "normal",
        "display": "swap"
      },
      {
        "family": "League Spartan",
        "path": "fonts/LeagueSpartan-800.woff2",
        "weight": "800",
        "style": "normal",
        "display": "swap"
      },
      {
        "family": "Special Elite",
        "path": "fonts/SpecialElite-Regular.woff2",
        "weight": "400",
        "style": "normal",
        "display": "swap"
      },
      {
        "family": "Caveat",
        "path": "fonts/Caveat-400.woff2",
        "weight": "400",
        "style": "normal",
        "display": "swap"
      }
    ].map((font) => Object.freeze(font)),
  )
  const installedFontSets = new WeakSet()

  function install(options = {}) {
    try {
      const documentRef = options.documentRef || root.document
      const runtime = options.runtime || root.browser?.runtime || root.chrome?.runtime
      const FontFaceCtor = options.FontFaceCtor || root.FontFace
      const fontSet = options.fontSet || documentRef?.fonts
      if (!runtime || typeof runtime.getURL !== "function") return []
      if (typeof FontFaceCtor !== "function" || !fontSet || typeof fontSet.add !== "function") {
        return []
      }
      if (installedFontSets.has(fontSet)) return []

      const faces = FONT_DEFINITIONS.map((font) => {
        const source = `url(${JSON.stringify(runtime.getURL(font.path))}) format("woff2")`
        return new FontFaceCtor(font.family, source, {
          weight: font.weight,
          style: font.style,
          display: font.display,
        })
      })
      for (const face of faces) fontSet.add(face)
      installedFontSets.add(fontSet)
      return faces
    } catch (error) {
      root.console?.warn?.("[Iconoplasm] Packaged fonts could not be registered", error)
      return []
    }
  }

  const api = Object.freeze({ definitions: FONT_DEFINITIONS, install })
  root.IconoplasmExtensionFonts = api
  install()
})(typeof globalThis !== "undefined" ? globalThis : this)
