import type {
  FullSlug,
  QuartzComponentProps,
  QuartzPluginData,
  SortFn,
} from "@quartz-community/types"
import { resolveRelative } from "@quartz-community/utils/path"
import { archiveDate, byArchiveDate } from "../archive"

interface PageListProps extends QuartzComponentProps {
  pages?: QuartzPluginData[]
  limit?: number
  sort?: SortFn
}

export function PageList({ fileData, allFiles, pages, limit, sort }: PageListProps) {
  const ordered = [...(pages ?? allFiles)].sort(sort ?? byArchiveDate)
  const list = limit ? ordered.slice(0, limit) : ordered

  return (
    <ul class="tag-page-list">
      {list.map((page) => {
        const date = archiveDate(page)
        return (
          <li>
            <a
              class="internal internal-link"
              href={resolveRelative(fileData.slug!, page.slug as FullSlug)}
            >
              <span>{page.frontmatter?.title}</span>
              {date && <time datetime={date.toISOString()}>{date.getFullYear()}</time>}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
