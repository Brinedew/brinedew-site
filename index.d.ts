declare module "*.scss" {
  const content: string
  export = content
}

// B-818: the one Iconoplasm title template is a browser module (it ships under
// /static/iconoplasm/), so its types live here rather than in the bundle.
declare module "*/static/iconoplasm/page-title.js" {
  export const ICONOPLASM_SITE_NAME: string
  export const ICONOPLASM_TITLE_SEPARATOR: string
  export const ICONOPLASM_HOME_TITLE: string
  export function iconoplasmPageTitle(page: string): string
  export function iconoplasmGenePageTitle(symbol: string, fullName?: string): string
  export function isIconoplasmGenePageTitle(title: string, symbol: string): boolean
}

// dom custom event
interface CustomEventMap {
  prenav: CustomEvent<{}>
  nav: CustomEvent<{ url: FullSlug }>
  themechange: CustomEvent<{ theme: "light" | "dark" }>
  readermodechange: CustomEvent<{ mode: "on" | "off" }>
  render: CustomEvent<{}>
}

type ContentIndex = Record<FullSlug, ContentDetails>
declare const fetchData: Promise<ContentIndex>
