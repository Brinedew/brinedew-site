// B-818: the one title template for iconoplasm.brinedew.bio. A page is titled
// "<page> | Iconoplasm"; the home page is the brand page,
// "Iconoplasm | Gene character cards". The separator is the one the 19k static
// gene documents already used. Every producer imports this file: the gene
// documents (scripts/prepare-iconoplasm-edge-assets.mjs), the Quartz pages
// (quartz/components/Head.tsx, which also writes og:title and twitter:title),
// the app's document.title (app.js) and the Worker's gene rewrite. Frontmatter
// titles of the Iconoplasm pages therefore name the page only, never the site.

export const ICONOPLASM_SITE_NAME = "Iconoplasm"
export const ICONOPLASM_TITLE_SEPARATOR = " | "
export const ICONOPLASM_HOME_TITLE = `${ICONOPLASM_SITE_NAME}${ICONOPLASM_TITLE_SEPARATOR}Gene character cards`

export function iconoplasmPageTitle(page) {
  const name = String(page ?? "").trim()
  if (!name || name === ICONOPLASM_SITE_NAME) return ICONOPLASM_SITE_NAME
  return `${name}${ICONOPLASM_TITLE_SEPARATOR}${ICONOPLASM_SITE_NAME}`
}

export function iconoplasmGenePageTitle(symbol, fullName) {
  const name = String(fullName ?? "").trim()
  return iconoplasmPageTitle(name ? `${symbol} — ${name}` : symbol)
}

// True when the title is this gene's page title, with or without its full
// name. The app keeps a title the gene document already set instead of
// replacing it with the symbol-only form while the card loads.
export function isIconoplasmGenePageTitle(title, symbol) {
  const value = String(title ?? "")
  return (
    value === iconoplasmGenePageTitle(symbol) ||
    (value.startsWith(`${symbol} — `) &&
      value.endsWith(`${ICONOPLASM_TITLE_SEPARATOR}${ICONOPLASM_SITE_NAME}`))
  )
}
