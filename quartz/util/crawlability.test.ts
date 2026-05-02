import assert from "node:assert/strict"
import test, { describe } from "node:test"
import { FullSlug } from "./path"
import {
  classifyCrawlSection,
  getPublicUrlForSlug,
  isCrawlableFile,
  isNoIndexFile,
} from "./crawlability"

describe("crawlability rules", () => {
  test("draft and noindex files are not crawlable", () => {
    assert.equal(isNoIndexFile({ frontmatter: { title: "Draft", draft: true } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { title: "Draft", draft: "true" } }), true)
    assert.equal(isNoIndexFile({ frontmatter: { title: "Hidden", noindex: true } }), true)
    assert.equal(
      isNoIndexFile({ frontmatter: { title: "Excluded", excludeFromSearch: true } }),
      true,
    )
    assert.equal(isNoIndexFile({ frontmatter: { title: "Public", draft: false } }), false)
  })

  test("crawlable file requires a slug and public frontmatter", () => {
    assert.equal(
      isCrawlableFile({
        slug: "posts/example" as FullSlug,
        frontmatter: { title: "Example" },
        text: "Visible public text",
      }),
      true,
    )
    assert.equal(
      isCrawlableFile({
        slug: "posts/draft" as FullSlug,
        frontmatter: { title: "Draft", draft: true },
        text: "Draft text",
      }),
      false,
    )
    assert.equal(isCrawlableFile({ frontmatter: { title: "Missing slug" } }), false)
    assert.equal(
      isCrawlableFile({
        slug: "Untitled-1" as FullSlug,
        frontmatter: { title: "Untitled 1" },
        text: "",
      }),
      false,
    )
    assert.equal(
      isCrawlableFile({
        slug: "Attachments/Drawing-2025-07-28-12.25.37.excalidraw" as FullSlug,
        frontmatter: { title: "Drawing 2025-07-28 12.25.37.excalidraw" },
        text: "Excalidraw metadata",
      }),
      false,
    )
  })

  test("public URL mapping keeps app subdomains consistent", () => {
    assert.equal(getPublicUrlForSlug("brinedew.bio", "index" as FullSlug), "https://brinedew.bio/")
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "posts/Iconoplasm-FAQ" as FullSlug),
      "https://brinedew.bio/posts/Iconoplasm-FAQ",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/geneguessr" as FullSlug),
      "https://geneguessr.brinedew.bio/",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/geneguessr/privacy" as FullSlug),
      "https://geneguessr.brinedew.bio/privacy",
    )
    assert.equal(
      getPublicUrlForSlug("brinedew.bio", "apps/iconoplasm" as FullSlug),
      "https://iconoplasm.brinedew.bio/",
    )
  })

  test("sections are derived from slugs and tags", () => {
    assert.equal(
      classifyCrawlSection({
        slug: "apps/iconoplasm" as FullSlug,
        frontmatter: { title: "Iconoplasm", tags: ["content/apps"] },
      }),
      "apps",
    )
    assert.equal(
      classifyCrawlSection({
        slug: "posts/Example" as FullSlug,
        frontmatter: { title: "Example", tags: ["topic/cancer"] },
      }),
      "posts",
    )
    assert.equal(
      classifyCrawlSection({
        slug: "wiki/Glossary" as FullSlug,
        frontmatter: { title: "Glossary", tags: ["content/wiki"] },
      }),
      "wiki",
    )
    assert.equal(
      classifyCrawlSection({ slug: "About" as FullSlug, frontmatter: { title: "About" } }),
      "pages",
    )
  })
})
