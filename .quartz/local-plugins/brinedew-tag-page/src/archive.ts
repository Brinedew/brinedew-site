import type { QuartzPluginData, SortFn } from "@quartz-community/types"

export type ArchiveStatus = "published" | "draft"

export function archiveStatus(page: QuartzPluginData): ArchiveStatus {
  const draft = page.frontmatter?.draft
  return draft === true || draft === "true" ? "draft" : "published"
}

export function archiveDate(page: QuartzPluginData): Date | undefined {
  if (!page.defaultDateType) return undefined
  return page.dates?.[page.defaultDateType]
}

export const byArchiveDate: SortFn = (left, right) => {
  const leftDate = archiveDate(left)
  const rightDate = archiveDate(right)

  if (leftDate && rightDate) return rightDate.getTime() - leftDate.getTime()
  if (leftDate) return -1
  if (rightDate) return 1

  const leftTitle = left.frontmatter?.title?.toLowerCase() ?? ""
  const rightTitle = right.frontmatter?.title?.toLowerCase() ?? ""
  return leftTitle.localeCompare(rightTitle)
}

export function partitionArchive(pages: QuartzPluginData[], sort: SortFn = byArchiveDate) {
  const ordered = [...pages].sort(sort)
  return {
    published: ordered.filter((page) => archiveStatus(page) === "published"),
    drafts: ordered.filter((page) => archiveStatus(page) === "draft"),
  }
}
