import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"
import style from "../styles/listPage.scss"
import { PageList, SortFn } from "../PageList"
import { FullSlug, getAllSegmentPrefixes, resolveRelative, simplifySlug } from "../../util/path"
import { QuartzPluginData } from "../../plugins/vfile"
import { Root } from "hast"
import { htmlToJsx } from "../../util/jsx"
import { i18n } from "../../i18n"
import { ComponentChildren } from "preact"
import { concatenateResources } from "../../util/resources"

interface TagContentOptions {
  sort?: SortFn
  numPages: number
}

const defaultOptions: TagContentOptions = {
  numPages: 10,
}

export default ((opts?: Partial<TagContentOptions>) => {
  const options: TagContentOptions = { ...defaultOptions, ...opts }

  const TagContent: QuartzComponent = (props: QuartzComponentProps) => {
    const { tree, fileData, allFiles, cfg } = props
    const slug = fileData.slug

    if (!(slug?.startsWith("tags/") || slug === "tags")) {
      throw new Error(`Component "TagContent" tried to render a non-tag page: ${slug}`)
    }

    const tag = simplifySlug(slug.slice("tags/".length) as FullSlug)
    const allPagesWithTag = (tag: string) =>
      allFiles.filter((file) =>
        (file.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes).includes(tag),
      )

    const content = (
      (tree as Root).children.length === 0
        ? fileData.description
        : htmlToJsx(fileData.filePath!, tree)
    ) as ComponentChildren
    const cssClasses: string[] = fileData.frontmatter?.cssclasses ?? []
    const classes = cssClasses.join(" ")
    if (tag === "/") {
      const tags = [
        ...new Set(
          allFiles.flatMap((data) => data.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes),
        ),
      ].sort((a, b) => a.localeCompare(b))
      const tagItemMap: Map<string, QuartzPluginData[]> = new Map()
      for (const tag of tags) {
        tagItemMap.set(tag, allPagesWithTag(tag))
      }
      return (
        <div class="popover-hint">
          <article class={classes}>
            <p>{content}</p>
          </article>
          <p>{i18n(cfg.locale).pages.tagContent.totalTags({ count: tags.length })}</p>
          <div>
            {tags.map((tag) => {
              const pages = tagItemMap.get(tag)!
              const listProps = {
                ...props,
                allFiles: pages,
              }

              const contentPage = allFiles.filter((file) => file.slug === `tags/${tag}`).at(0)

              const root = contentPage?.htmlAst
              const content =
                !root || root?.children.length === 0
                  ? contentPage?.description
                  : htmlToJsx(contentPage.filePath!, root)

              const tagListingPage = `/tags/${tag}` as FullSlug
              const href = resolveRelative(fileData.slug!, tagListingPage)

              return (
                <div>
                  <h2>
                    <a class="internal tag-link" href={href}>
                      {tag}
                    </a>
                  </h2>
                  {content && <p>{content}</p>}
                  <div class="page-listing">
                    <p>
                      {i18n(cfg.locale).pages.tagContent.itemsUnderTag({ count: pages.length })}
                      {pages.length > options.numPages && (
                        <>
                          {" "}
                          <span>
                            {i18n(cfg.locale).pages.tagContent.showingFirst({
                              count: options.numPages,
                            })}
                          </span>
                        </>
                      )}
                    </p>
                    <PageList limit={options.numPages} {...listProps} sort={options?.sort} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    } else {
      const pages = allPagesWithTag(tag)
      const listProps = {
        ...props,
        allFiles: pages,
      }

      // Find child tags (tags that start with this tag + "/")
      const allTags = [
        ...new Set(
          allFiles.flatMap((data) => data.frontmatter?.tags ?? []).flatMap(getAllSegmentPrefixes),
        ),
      ]
      const childTags = allTags
        .filter((t) => t.startsWith(tag + "/") && t.split("/").length === tag.split("/").length + 1)
        .sort((a, b) => a.localeCompare(b))

      return (
        <div class="popover-hint">
          <article class={classes}>{content}</article>
          
          {/* Show child tags if any exist */}
          {childTags.length > 0 && (
            <div class="child-tags">
              <h3>Sub-tags</h3>
              <ul class="tag-list">
                {childTags.map((childTag) => {
                  const childPages = allPagesWithTag(childTag)
                  const displayName = childTag.slice(tag.length + 1) // Remove parent prefix
                  const href = resolveRelative(fileData.slug!, `tags/${childTag}` as FullSlug)
                  return (
                    <li>
                      <a class="internal tag-link" href={href}>
                        {displayName}
                      </a>
                      <span class="tag-count">({childPages.length})</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div class="page-listing">
            <p>{i18n(cfg.locale).pages.tagContent.itemsUnderTag({ count: pages.length })}</p>
            <div>
              <PageList {...listProps} sort={options?.sort} />
            </div>
          </div>
        </div>
      )
    }
  }

  TagContent.css = concatenateResources(style, PageList.css)
  return TagContent
}) satisfies QuartzComponentConstructor
