import type {
  FullSlug,
  QuartzComponent,
  QuartzComponentProps,
  QuartzPluginData,
} from "@quartz-community/types"
import { getAllSegmentPrefixes, resolveRelative, simplifySlug } from "@quartz-community/utils/path"
import type { TagPageOptions } from "../types"
import style from "../styles/tagPage.scss"
import { ArchiveIndex } from "./ArchiveIndex"
import { PageList } from "./PageList"

const editorialArchiveTags = new Set(["content/post", "content/wiki"])

function isListed(file: QuartzPluginData) {
  return file.unlisted !== true
}

function humanizeCategory(tag: string, displayNames?: Record<string, string>): string {
  if (displayNames?.[tag]) return displayNames[tag]
  if (tag === "category") return "Categories"
  const leaf = tag.includes("/") ? tag.slice(tag.lastIndexOf("/") + 1) : tag
  const spaced = leaf.replace(/-/g, " ")
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : tag
}

function getSortKey(file: QuartzPluginData): string {
  const fm = file.frontmatter as Record<string, unknown> | undefined
  if (typeof fm?.sort_key === "string" && fm.sort_key.trim()) return fm.sort_key.trim()
  if (typeof fm?.title === "string" && fm.title.trim()) return fm.title.trim()
  return String(file.slug ?? "")
}

function getInitialBucket(sortKey: string): string {
  const first = sortKey.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(first) ? first : "#"
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

    if (tag === "category" || tag.startsWith("category/")) {
      const listedFiles = allFiles.filter(isListed)
      const prefix = `${tag}/`
      const allCategoryTags = new Set(
        listedFiles
          .flatMap((file) => file.frontmatter?.tags ?? [])
          .flatMap(getAllSegmentPrefixes)
          .filter((t) => t.startsWith("category/")),
      )

      const subcategories = [...allCategoryTags]
        .filter((t) => t.startsWith(prefix) && !t.slice(prefix.length).includes("/"))
        .sort((a, b) =>
          humanizeCategory(a, options?.displayNames).localeCompare(
            humanizeCategory(b, options?.displayNames),
          ),
        )
        .map((sub) => ({
          tag: sub,
          label: humanizeCategory(sub, options?.displayNames),
          count: pagesFor(sub).length,
          href: resolveRelative(slug, `tags/${sub}` as FullSlug),
        }))

      const directPages =
        tag === "category"
          ? []
          : listedFiles
              .filter((file) => (file.frontmatter?.tags ?? []).includes(tag))
              .sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))

      const pagesToShow =
        directPages.length > 0 || subcategories.length > 0
          ? directPages
          : pagesFor(tag).sort((a, b) => getSortKey(a).localeCompare(getSortKey(b)))

      const groups = new Map<string, QuartzPluginData[]>()
      for (const page of pagesToShow) {
        const bucket = getInitialBucket(getSortKey(page))
        const list = groups.get(bucket) ?? []
        list.push(page)
        groups.set(bucket, list)
      }
      const sortedBuckets = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))

      const parentTag =
        tag === "category"
          ? null
          : tag.includes("/")
            ? tag.slice(0, tag.lastIndexOf("/"))
            : null

      const heading =
        tag === "category"
          ? "Wiki categories"
          : `Category: ${humanizeCategory(tag, options?.displayNames)}`

      return (
        <main class="wiki-category-page popover-hint">
          <header class="wiki-category-page__header">
            <h1>{heading}</h1>
          </header>

          {subcategories.length > 0 && (
            <section class="wiki-category-page__section">
              <h2>Subcategories</h2>
              <p class="wiki-category-page__summary">
                This category has {subcategories.length}{" "}
                {subcategories.length === 1 ? "subcategory" : "subcategories"}.
              </p>
              <ul class="wiki-category-page__subcats">
                {subcategories.map((sub) => (
                  <li>
                    <a class="internal" href={sub.href}>
                      {sub.label}
                    </a>{" "}
                    <span class="wiki-category-page__count">({sub.count})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {pagesToShow.length > 0 && (
            <section class="wiki-category-page__section">
              <h2>Pages in category "{humanizeCategory(tag, options?.displayNames)}"</h2>
              <p class="wiki-category-page__summary">
                The following {pagesToShow.length}{" "}
                {pagesToShow.length === 1 ? "page is" : "pages are"} in this category.
              </p>
              <div class="wiki-category-page__columns">
                {sortedBuckets.map(([letter, bucketPages]) => (
                  <div class="wiki-category-page__group">
                    <h3>{letter}</h3>
                    <ul>
                      {bucketPages.map((page) => (
                        <li>
                          <a
                            class="internal"
                            href={resolveRelative(slug, page.slug as FullSlug)}
                          >
                            {page.frontmatter?.title ?? page.slug}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {parentTag && (
            <nav class="wiki-catlinks" aria-label="Categories">
              <a
                class="internal wiki-catlinks__label"
                href={resolveRelative(slug, "tags/category" as FullSlug)}
              >
                Categories
              </a>
              <span class="wiki-catlinks__colon">: </span>
              <ul class="wiki-catlinks__list">
                <li>
                  <a
                    class="internal"
                    href={resolveRelative(slug, `tags/${parentTag}` as FullSlug)}
                  >
                    {humanizeCategory(parentTag, options?.displayNames)}
                  </a>
                </li>
              </ul>
            </nav>
          )}
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
