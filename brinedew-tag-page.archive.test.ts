import assert from "node:assert/strict"
import test from "node:test"
import type { QuartzPluginData } from "@quartz-community/types"
import {
  archiveStatus,
  partitionArchive,
} from "./.quartz/local-plugins/brinedew-tag-page/src/archive"

function page(title: string, date: string, draft: boolean | string = false): QuartzPluginData {
  const published = new Date(date)
  return {
    slug: title.toLowerCase().replaceAll(" ", "-") as QuartzPluginData["slug"],
    frontmatter: { title, draft },
    dates: { created: published, modified: published, published },
    defaultDateType: "published",
  } as QuartzPluginData
}

test("archiveStatus reads canonical boolean and string draft metadata", () => {
  assert.equal(archiveStatus(page("Published", "2026-01-01")), "published")
  assert.equal(archiveStatus(page("Boolean draft", "2026-01-01", true)), "draft")
  assert.equal(archiveStatus(page("String draft", "2026-01-01", "true")), "draft")
})

test("partitionArchive separates states and keeps each section newest first", () => {
  const result = partitionArchive([
    page("Old draft", "2025-01-01", true),
    page("New published", "2026-06-01"),
    page("New draft", "2026-07-01", true),
    page("Old published", "2024-03-01"),
  ])

  assert.deepEqual(
    result.published.map((item) => item.frontmatter?.title),
    ["New published", "Old published"],
  )
  assert.deepEqual(
    result.drafts.map((item) => item.frontmatter?.title),
    ["New draft", "Old draft"],
  )
})
