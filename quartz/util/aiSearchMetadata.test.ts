import assert from "node:assert/strict"
import test from "node:test"

import { getAiSearchPageType } from "./aiSearchMetadata"
import { type FullSlug } from "./path"

const licenseSlug = "apps/iconoplasm/license" as FullSlug

test("explicit safe schema type can distinguish an app-owned policy page", () => {
  assert.equal(
    getAiSearchPageType({
      slug: licenseSlug,
      frontmatter: { title: "Image License — Iconoplasm", schemaType: "WebPage" },
    }),
    "WebPage",
  )
})

test("unknown schema type cannot inject arbitrary structured data", () => {
  assert.equal(
    getAiSearchPageType({
      slug: licenseSlug,
      frontmatter: { title: "Image License — Iconoplasm", schemaType: "DangerousThing" },
    }),
    "SoftwareApplication",
  )
})
