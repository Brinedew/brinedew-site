import { getPublicUrlForSlug } from "../util/crawlability"
import { FullSlug } from "../util/path"

export type HomepageApp = {
  slug: FullSlug
  title: string
  description: string
}

export const homepageApps: HomepageApp[] = [
  {
    slug: "apps/iconoplasm/index" as FullSlug,
    title: "Iconoplasm",
    description: "Gene personas and visual identities for human protein-coding genes.",
  },
  {
    slug: "apps/geneguessr/index" as FullSlug,
    title: "GeneGuessr",
    description: "A daily protein guessing game built from structure and function clues.",
  },
]

export function homepageAppHref(baseUrl: string, app: HomepageApp): string {
  return getPublicUrlForSlug(baseUrl, app.slug)
}
