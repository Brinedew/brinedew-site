import { QuartzPluginData } from "../plugins/vfile"
import { FullSlug } from "./path"
import { getPublicUrlForSlug } from "./crawlability"

type JsonLdScalar = string | number | boolean
export type AiSearchJsonLd = Record<
  string,
  | JsonLdScalar
  | JsonLdScalar[]
  | Record<string, JsonLdScalar>
  | Record<string, unknown>
  | Array<Record<string, unknown>>
>

type BuildAiSearchJsonLdArgs = {
  baseUrl: string
  pageTitle: string
  locale: string
  fileData: QuartzPluginData
}

const CONTENT_TAG_PREFIX = "content/"
const EXPLICIT_SCHEMA_TYPES = new Set(["ProfilePage", "WebPage"])
const BRINEDEW_ORIGIN = "https://brinedew.bio"
const BRINEDEW_PERSON_ID = `${BRINEDEW_ORIGIN}/#brinedew`
const BRINEDEW_PROFILE_URL = `${BRINEDEW_ORIGIN}/about`
const BRINEDEW_PERSON_SAME_AS = [
  "https://github.com/Brinedew",
  "https://www.lesswrong.com/users/brinedew",
  "https://addons.mozilla.org/en-US/firefox/user/19832112/",
]
const ICONOPLASM_SAME_AS = [
  "https://addons.mozilla.org/en-US/firefox/addon/iconoplasm-gene-illustrations/",
  "https://microsoftedge.microsoft.com/addons/detail/iconoplasm/ocfhohjhkflpmaiimgjfobdoogdfpmog",
]
const ICONOPLASM_SUBJECT_OF =
  "https://www.lesswrong.com/posts/BJ7AqXeigNKXLqZyx/mnemonic-portraits-for-19-023-human-genes"
const ICONOPLASM_APPLICATION_URL = "https://iconoplasm.brinedew.bio/"

function brinedewPerson(includeSameAs = false): Record<string, unknown> {
  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": BRINEDEW_PERSON_ID,
    name: "Brinedew",
    url: BRINEDEW_PROFILE_URL,
    description: "Wet-lab biologist, researcher, and creator of Brinedew projects.",
  }

  if (includeSameAs) person.sameAs = BRINEDEW_PERSON_SAME_AS
  return person
}

function structuredDataId(type: string, url: string): string {
  if (type === "WebSite") return `${BRINEDEW_ORIGIN}/#website`
  if (type === "ProfilePage") return `${url}#profile`
  if (type === "SoftwareApplication") return `${url}#application`
  if (type === "BlogPosting") return `${url}#article`
  if (type === "FAQPage") return `${url}#faq`
  return `${url}#webpage`
}

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
  const explicitType = asString(fm.schemaType)

  if (explicitType && EXPLICIT_SCHEMA_TYPES.has(explicitType)) return explicitType
  if (slug?.toLowerCase() === "about") return "ProfilePage"
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
  const type = getAiSearchPageType({ slug: fileData.slug, frontmatter: fileData.frontmatter })
  const person = brinedewPerson()

  const jsonLd: AiSearchJsonLd = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": structuredDataId(type, url),
    headline: title,
    name: title,
    url,
    mainEntityOfPage: url,
    inLanguage: locale,
    author: person,
    publisher: person,
  }

  if (description) jsonLd.description = description
  if (keywords) jsonLd.keywords = keywords
  if (datePublished) jsonLd.datePublished = datePublished
  if (dateModified) jsonLd.dateModified = dateModified

  if (type === "ProfilePage") jsonLd.mainEntity = brinedewPerson(true)

  if (type === "SoftwareApplication") {
    jsonLd.applicationCategory = "EducationalApplication"
    jsonLd.operatingSystem = "Web"
    jsonLd.creator = person

    if (url === ICONOPLASM_APPLICATION_URL) {
      jsonLd.sameAs = ICONOPLASM_SAME_AS
      jsonLd.subjectOf = {
        "@type": "Article",
        url: ICONOPLASM_SUBJECT_OF,
        name: "Mnemonic portraits for 19,023 human genes",
      }
    }
  }

  if (type === "FAQPage" && Array.isArray(fm.faq)) {
    jsonLd.mainEntity = (fm.faq as Array<Record<string, unknown>>)
      .filter(
        (entry): entry is Record<string, string> =>
          typeof entry.question === "string" &&
          typeof entry.answer === "string" &&
          entry.question.trim().length > 0 &&
          entry.answer.trim().length > 0,
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
