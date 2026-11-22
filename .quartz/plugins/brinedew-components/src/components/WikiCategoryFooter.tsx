import type { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import { resolveRelative, type FullSlug } from "../util/path"

const CATEGORY_PREFIX = "category/"

function humanizeCategory(tag: string): string {
  const leaf = tag.includes("/") ? tag.slice(tag.lastIndexOf("/") + 1) : tag
  const spaced = leaf.replace(/-/g, " ")
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : tag
}

const WikiCategoryFooter: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const slug = fileData.slug
  if (!slug || slug.startsWith("tags/") || slug === "tags") {
    return null
  }

  const rawTags = fileData.frontmatter?.tags
  if (!Array.isArray(rawTags) || rawTags.length === 0) {
    return null
  }

  const categories = [
    ...new Set(
      rawTags
        .filter((tag): tag is string => typeof tag === "string" && tag.startsWith(CATEGORY_PREFIX))
        .map((tag) => tag.trim()),
    ),
  ].sort((a, b) => humanizeCategory(a).localeCompare(humanizeCategory(b)))

  if (categories.length === 0) {
    return null
  }

  const rootHref = resolveRelative(slug, "tags/category" as FullSlug)

  return (
    <nav class={classNames(displayClass, "wiki-catlinks")} aria-label="Categories">
      <a href={rootHref} class="internal wiki-catlinks__label">
        Categories
      </a>
      <span class="wiki-catlinks__colon">: </span>
      <ul class="wiki-catlinks__list">
        {categories.map((cat) => (
          <li>
            <a href={resolveRelative(slug, `tags/${cat}` as FullSlug)} class="internal">
              {humanizeCategory(cat)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

WikiCategoryFooter.css = `
.wiki-catlinks {
  margin-top: 2rem;
  padding: 0.55rem 0.85rem;
  border: 1px solid var(--lightgray);
  border-radius: 4px;
  background-color: color-mix(in srgb, var(--lightgray) 22%, transparent);
  font-size: 0.9rem;
  line-height: 1.5;
}

.wiki-catlinks__label {
  font-weight: 600;
}

.wiki-catlinks__list {
  display: inline;
  list-style: none;
  margin: 0;
  padding: 0;
}

.wiki-catlinks__list li {
  display: inline;
}

.wiki-catlinks__list li + li::before {
  content: " | ";
  color: var(--gray);
  padding: 0 0.2rem;
}
`

export default (() => WikiCategoryFooter) satisfies QuartzComponentConstructor
