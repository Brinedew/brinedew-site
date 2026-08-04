import type {
  FullSlug,
  QuartzComponent,
  QuartzComponentProps,
  QuartzPluginData,
} from "@quartz-community/types"
import { getAllSegmentPrefixes, simplifySlug } from "@quartz-community/utils/path"
import type { TagPageOptions } from "../types"
import style from "../styles/tagPage.scss"
import { ArchiveIndex } from "./ArchiveIndex"
import { PageList } from "./PageList"

const editorialArchiveTags = new Set(["content/post", "content/wiki"])

function isListed(file: QuartzPluginData) {
  return file.unlisted !== true
}

export default ((options?: TagPageOptions) => {
  const TagContent: QuartzComponent = (props: QuartzComponentProps) => {
    const { fileData, allFiles, cfg } = props
    const slug = fileData.slug
    if (!(slug?.startsWith("tags/") || slug === "tags")) {
      throw new Error(`Component "TagContent" tried to render a non-tag page: ${slug}`)
    }

    const tag = simplifySlug(slug.slice("tags/".length) as FullSlug)
    const pagesFor = (candidate: string) =>
      allFiles
        .filter(isListed)
        .filter((file) =>
          (file.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes).includes(candidate),
        )

    if (editorialArchiveTags.has(tag)) {
      return (
        <div class="popover-hint archive-index-shell">
          <ArchiveIndex
            tag={tag}
            title={fileData.frontmatter?.title ?? "Archive"}
            pages={pagesFor(tag)}
            currentSlug={slug}
            locale={cfg.locale ?? "en-US"}
            sort={options?.sort}
          />
        </div>
      )
    }

    if (tag === "/") {
      const tags = [
        ...new Set(
          allFiles
            .filter(isListed)
            .flatMap((file) => file.frontmatter?.tags ?? [])
            .flatMap(getAllSegmentPrefixes),
        ),
      ].sort((left, right) => left.localeCompare(right))

      return (
        <main class="tag-index">
          <h1>{fileData.frontmatter?.title ?? "Tags"}</h1>
          <ul>
            {tags.map((item) => (
              <li>
                <a class="internal tag-link" href={`./${item}`}>
                  {item}
                </a>
              </li>
            ))}
          </ul>
        </main>
      )
    }

    const pages = pagesFor(tag)
    const listProps = { ...props, pages, sort: options?.sort }
    return (
      <main class="tag-page-listing popover-hint">
        <header>
          <h1>{fileData.frontmatter?.title ?? tag}</h1>
          <p>{pages.length === 1 ? "1 item" : `${pages.length} items`}</p>
        </header>
        <PageList {...listProps} />
      </main>
    )
  }

  TagContent.css = style
  return TagContent
}) satisfies (options?: TagPageOptions) => QuartzComponent
