import { QuartzPluginData } from "../plugins/vfile"
import { FullSlug } from "./path"
import { getPublicUrlForSlug } from "./crawlability"

type JsonLdScalar = string | number | boolean
export type AiSearchJsonLd = Record<
  string,
  JsonLdScalar | JsonLdScalar[] | Record<string, JsonLdScalar>
>

type BuildAiSearchJsonLdArgs = {
  baseUrl: string
  pageTitle: string
  locale: string
  fileData: QuartzPluginData
}

const CONTENT_TAG_PREFIX = "content/"

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function dateIso(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
  }
  return undefined
}

function frontmatterRecord(fileData: { frontmatter?: unknown }): Record<string, unknown> {
  return fileData.frontmatter && typeof fileData.frontmatter === "object"
    ? (fileData.frontmatter as Record<string, unknown>)
    : {}
}

function cleanKeywords(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined
  const keywords = tags
    .filter((tag): tag is string => typeof tag === "string")
    .filter((tag) => !tag.startsWith(CONTENT_TAG_PREFIX))
    .map((tag) =>
      tag
        .replace(/^topic\//, "")
        .replace(/[-_]/g, " ")
        .trim(),
    )
    .filter(Boolean)
  return keywords.length ? Array.from(new Set(keywords)) : undefined
}

export function getAiSearchPageType(
  fileData: Partial<Pick<QuartzPluginData, "slug" | "frontmatter">>,
): string {
  const slug = typeof fileData.slug === "string" ? (fileData.slug as FullSlug) : undefined
  const fm = frontmatterRecord({ frontmatter: fileData.frontmatter })
  const tags = Array.isArray(fm.tags) ? fm.tags : []

  if (fm.faqpage === true) return "FAQPage"
  if (slug === "index" || slug === "") return "WebSite"
  if (slug?.startsWith("apps/") || tags.includes("content/apps")) return "SoftwareApplication"
  if (slug?.startsWith("posts/") || tags.includes("content/post")) return "BlogPosting"
  return "Article"
}

export function buildAiSearchJsonLd({
  baseUrl,
  pageTitle,
  locale,
  fileData,
}: BuildAiSearchJsonLdArgs): AiSearchJsonLd {
  const fm = frontmatterRecord({ frontmatter: fileData.frontmatter })
  const title = asString(fm.title) ?? pageTitle
  const description =
    asString(fm.socialDescription) ?? asString(fm.description) ?? asString(fileData.description)
  const slug = (typeof fileData.slug === "string" ? fileData.slug : "index") as FullSlug
  const url = getPublicUrlForSlug(baseUrl, slug)
  const keywords = cleanKeywords(fm.tags)
  // Only frontmatter dates are exposed in JSON-LD. Build/filesystem dates can be
  // unstable, and Google's guidance emphasizes reliable, people-first metadata.
  const datePublished = dateIso(fm.published) ?? dateIso(fm.created) ?? dateIso(fm.date)
  const dateModified = dateIso(fm.modified) ?? dateIso(fm.updated)

  const jsonLd: AiSearchJsonLd = {
    "@context": "https://schema.org",
    "@type": getAiSearchPageType({ slug: fileData.slug, frontmatter: fileData.frontmatter }),
    headline: title,
    name: title,
    url,
    mainEntityOfPage: url,
    inLanguage: locale,
    author: {
      "@type": "Person",
      name: "Brinedew",
      url: "https://brinedew.bio/",
    },
    publisher: {
      "@type": "Organization",
      name: pageTitle,
      url: `https://${baseUrl}/`,
    },
  }

  if (description) jsonLd.description = description
  if (keywords) jsonLd.keywords = keywords
  if (datePublished) jsonLd.datePublished = datePublished
  if (dateModified) jsonLd.dateModified = dateModified

  if (jsonLd["@type"] === "SoftwareApplication") {
    jsonLd.applicationCategory = "EducationalApplication"
    jsonLd.operatingSystem = "Web"
  }

  if (jsonLd["@type"] === "FAQPage" && Array.isArray(fm.faq)) {
    jsonLd.mainEntity = (fm.faq as Array<Record<string, unknown>>)
      .filter((entry): entry is Record<string, string> =>
        typeof entry.question === "string" && typeof entry.answer === "string" &&
        entry.question.trim().length > 0 && entry.answer.trim().length > 0,
      )
      .map((entry) => ({
        "@type": "Question",
        name: entry.question.trim(),
        acceptedAnswer: {
          "@type": "Answer",
          text: entry.answer.trim(),
        },
      }))
  }

  return jsonLd
}

export function serializeJsonLd(jsonLd: AiSearchJsonLd): string {
  return JSON.stringify(jsonLd).replace(/</g, "\\u003c")
}
