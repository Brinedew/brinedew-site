import { QuartzPluginData } from "../plugins/vfile"
import { FullSlug, SimpleSlug, joinSegments, simplifySlug } from "./path"

type FrontmatterLike = Record<string, unknown>

const truthyFrontmatter = (value: unknown): boolean => value === true || value === "true"

const subdomainMappings: Record<string, string> = {
  "apps/geneguessr": "geneguessr.brinedew.bio",
  "apps/iconoplasm": "iconoplasm.brinedew.bio",
}

export type CrawlSection = "apps" | "posts" | "wiki" | "pages" | "drafts"

export function isNoIndexFile(file: { frontmatter?: FrontmatterLike | null }): boolean {
  const fm = file.frontmatter ?? {}
  return (
    truthyFrontmatter(fm.noindex) ||
    truthyFrontmatter(fm.excludeFromSearch)
  )
}

export function isCrawlableFile(file: QuartzPluginData): boolean {
  if (typeof file.slug !== "string" || file.slug.length === 0 || isNoIndexFile(file)) {
    return false
  }

  if (file.slug.startsWith("Attachments/") || file.slug.includes(".excalidraw")) {
    return false
  }

  if (typeof file.text === "string" && file.text.trim().length === 0) {
    return false
  }

  return true
}

export function getPublicUrlForSlug(baseUrl: string, slug: FullSlug | SimpleSlug): string {
  const simpleSlug = simplifySlug(slug as FullSlug)
  if (simpleSlug === "/" || simpleSlug === "index") {
    return `https://${baseUrl}/`
  }

  for (const [pathPrefix, subdomain] of Object.entries(subdomainMappings)) {
    if (simpleSlug === pathPrefix || simpleSlug.startsWith(pathPrefix + "/")) {
      if (simpleSlug === pathPrefix) {
        return `https://${subdomain}/`
      }
      return `https://${subdomain}${simpleSlug.slice(pathPrefix.length)}`
    }
  }

  return `https://${joinSegments(baseUrl, encodeURI(simpleSlug))}`
}

export function isPublicUrlOwnedByHost(baseUrl: string, slug: FullSlug | SimpleSlug): boolean {
  return new URL(getPublicUrlForSlug(baseUrl, slug)).hostname === baseUrl
}

export function classifyCrawlSection(file: QuartzPluginData): CrawlSection {
  const slug = String(file.slug ?? "")
  const tags = Array.isArray(file.frontmatter?.tags) ? file.frontmatter.tags : []
  const isDraft = file.frontmatter?.draft === true || file.frontmatter?.draft === "true"

  if (isDraft) return "drafts"
  if (slug.startsWith("apps/") || tags.includes("content/apps")) return "apps"
  if (slug.startsWith("posts/") || tags.includes("content/post")) return "posts"
  if (slug.startsWith("wiki/") || tags.includes("content/wiki")) return "wiki"

  return "pages"
}
