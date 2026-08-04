import type { FullSlug, QuartzPageTypePlugin } from "@quartz-community/types"
import { getAllSegmentPrefixes, joinSegments } from "@quartz-community/utils/path"
import TagContent from "./components/TagContent"
import type { TagPageOptions } from "./types"

const defaultDisplayNames: Record<string, string> = {
  "content/post": "Posts",
  "content/wiki": "Wiki",
  "content/apps": "Apps",
  "content/meta": "Meta",
  meta: "Meta",
  draft: "Drafts",
  index: "Tags",
}

function humanizeTag(tag: string, displayNames: Record<string, string>) {
  if (displayNames[tag]) return displayNames[tag]
  const leaf = tag.includes("/") ? tag.slice(tag.lastIndexOf("/") + 1) : tag
  return leaf ? leaf.charAt(0).toUpperCase() + leaf.slice(1) : tag
}

export const TagPage: QuartzPageTypePlugin<TagPageOptions> = (options) => ({
  name: "TagPage",
  priority: 10,
  match: ({ slug }) => slug.startsWith("tags/") || slug === "tags",
  generate({ content }) {
    const allFiles = content.map((entry) => entry[1].data).filter((file) => file.unlisted !== true)
    const displayNames = { ...defaultDisplayNames, ...(options?.displayNames ?? {}) }
    const tags = new Set(
      allFiles.flatMap((file) => file.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes),
    )

    if (
      allFiles.some(
        (file) => file.frontmatter?.draft === true || file.frontmatter?.draft === "true",
      )
    ) {
      tags.add("draft")
    }
    tags.add("index")

    const existing = new Set(
      content
        .map((entry) => entry[1].data.slug)
        .filter((slug): slug is FullSlug => Boolean(slug?.startsWith("tags/"))),
    )

    return [...tags]
      .map((tag) => {
        const slug = joinSegments("tags", tag) as FullSlug
        if (existing.has(slug)) return undefined
        const label = humanizeTag(tag, displayNames)
        return {
          slug,
          title: options?.prefixTags && tag !== "index" ? `Tag: ${label}` : label,
          data: {},
        }
      })
      .filter((page) => page !== undefined)
  },
  layout: "tag",
  body: TagContent,
})
