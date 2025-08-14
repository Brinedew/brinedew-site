import { FullSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"

const PageTags: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const tags = fileData.frontmatter?.tags
  if (tags && tags.length > 0) {
    return (
      <div class={classNames(displayClass, "page-tags-section")}>
        <h3>Tags</h3>
        <ul class="tags">
          {tags.map((tag) => {
            const linkDest = resolveRelative(fileData.slug!, `tags/${tag}` as FullSlug)
            return (
              <li>
                <a href={linkDest} class="internal tag-link">
                  {tag}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    )
  } else {
    return null
  }
}

PageTags.css = `
.page-tags-section {
  margin: 1rem 0;
}

.page-tags-section h3 {
  font-size: 1rem;
  margin: 0 0 0.5rem 0;
  color: var(--dark);
  font-weight: normal;
}

.tags {
  list-style: none;
  display: flex;
  padding-left: 0;
  gap: 0.4rem;
  margin: 0;
  flex-wrap: wrap;
}

.tags > li {
  display: inline-block;
  white-space: nowrap;
  margin: 0;
  overflow-wrap: normal;
}

a.internal.tag-link {
  border-radius: 8px;
  background-color: var(--highlight);
  padding: 0.2rem 0.4rem;
  margin: 0 0.1rem;
  font-size: 0.8rem;
}
`

export default (() => PageTags) satisfies QuartzComponentConstructor