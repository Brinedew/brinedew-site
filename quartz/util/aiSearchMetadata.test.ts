import assert from "node:assert/strict"
import test, { describe } from "node:test"
import { FullSlug } from "./path"
import { buildAiSearchJsonLd, getAiSearchPageType } from "./aiSearchMetadata"

describe("AI/search metadata", () => {
  test("classifies ordinary content without creating AI-specific hacks", () => {
    assert.equal(
      getAiSearchPageType({ slug: "posts/clonal-governance" as FullSlug }),
      "BlogPosting",
    )
    assert.equal(getAiSearchPageType({ slug: "wiki/cellular-senescence" as FullSlug }), "Article")
    assert.equal(
      getAiSearchPageType({ slug: "apps/iconoplasm" as FullSlug }),
      "SoftwareApplication",
    )
    assert.equal(getAiSearchPageType({ slug: "index" as FullSlug }), "WebSite")
  })

  test("builds concise JSON-LD from existing human-facing metadata", () => {
    const jsonLd = buildAiSearchJsonLd({
      baseUrl: "brinedew.bio",
      pageTitle: "Brinedew.bio",
      locale: "en-US",
      fileData: {
        slug: "posts/clonal-governance" as FullSlug,
        frontmatter: {
          title: "Clonal governance",
          description: "Aging as the governance cost of multicellular cooperation.",
          tags: ["content/post", "topic/aging", "topic/cancer"],
          created: "2026-05-01",
          modified: "2026-05-02T00:00:00.000Z",
          published: "2026-05-03T00:00:00.000Z",
        },
        dates: {
          created: new Date("2026-06-01T00:00:00.000Z"),
          modified: new Date("2026-06-02T00:00:00.000Z"),
          published: new Date("2026-06-03T00:00:00.000Z"),
        },
      },
    })

    assert.equal(jsonLd["@context"], "https://schema.org")
    assert.equal(jsonLd["@type"], "BlogPosting")
    assert.equal(jsonLd.headline, "Clonal governance")
    assert.equal(jsonLd.description, "Aging as the governance cost of multicellular cooperation.")
    assert.equal(jsonLd.url, "https://brinedew.bio/posts/clonal-governance")
    assert.equal(jsonLd.mainEntityOfPage, "https://brinedew.bio/posts/clonal-governance")
    const author = jsonLd.author as { name: string }
    const publisher = jsonLd.publisher as { name: string }
    assert.equal(author.name, "Brinedew")
    assert.equal(publisher.name, "Brinedew.bio")
    assert.equal(jsonLd.datePublished, "2026-05-03T00:00:00.000Z")
    assert.equal(jsonLd.dateModified, "2026-05-02T00:00:00.000Z")
    assert.deepEqual(jsonLd.keywords, ["aging", "cancer"])
    assert.equal(Object.hasOwn(jsonLd, "llms.txt"), false)
  })

  test("omits descriptions and dates when the page lacks real metadata", () => {
    const jsonLd = buildAiSearchJsonLd({
      baseUrl: "brinedew.bio",
      pageTitle: "Brinedew.bio",
      locale: "en-US",
      fileData: {
        slug: "wiki/Glossary" as FullSlug,
        frontmatter: { title: "Glossary", tags: ["content/wiki"] },
      },
    })

    assert.equal(jsonLd["@type"], "Article")
    assert.equal(jsonLd.headline, "Glossary")
    assert.equal(Object.hasOwn(jsonLd, "description"), false)
    assert.equal(Object.hasOwn(jsonLd, "datePublished"), false)
    assert.equal(Object.hasOwn(jsonLd, "dateModified"), false)
    assert.equal(Object.hasOwn(jsonLd, "keywords"), false)
  })
})
