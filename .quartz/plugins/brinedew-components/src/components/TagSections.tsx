import { classNames } from "../util/lang"
import { FullSlug, resolveRelative } from "../util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const SECTION_CONFIG: Record<string, { displayName: string }> = {
  content: { displayName: "Content" },
  topic: { displayName: "Topics" },
  protein: { displayName: "Proteins" },
  meta: { displayName: "Meta" },
}

type TagInfo = {
  fullPath: string
  displayName: string
}

type Section = {
  key: string
  displayName: string
  tags: TagInfo[]
}

const TagSections: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  if (String(fileData.slug ?? "").startsWith("apps/")) return null

  const isDraft = fileData.frontmatter?.draft === true || fileData.frontmatter?.draft === "true"

  const pageTags: unknown[] = isDraft
    ? ["draft", ...(Array.isArray(fileData.frontmatter?.tags) ? fileData.frontmatter.tags : [])]
    : (fileData.frontmatter?.tags ?? [])

  if (!Array.isArray(pageTags) || pageTags.length === 0) {
    return null
  }

  const sections = new Map<string, TagInfo[]>()

  for (const tag of pageTags) {
    if (typeof tag !== "string") continue
    const normalized = tag.trim().toLowerCase()
    if (!normalized) continue

    const parts = normalized.split("/")
    const prefix = parts[0]
    const displayName = parts.length > 1 ? parts.slice(1).join("/") : normalized
    const sectionKey = parts.length > 1 && SECTION_CONFIG[prefix] ? prefix : "general"

    if (!sections.has(sectionKey)) {
      sections.set(sectionKey, [])
    }

    sections.get(sectionKey)!.push({ fullPath: normalized, displayName })
  }

  for (const tags of sections.values()) {
    tags.sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  const orderedSections: Section[] = []

  for (const key of Object.keys(SECTION_CONFIG)) {
    const tags = sections.get(key)
    if (tags && tags.length > 0) {
      orderedSections.push({ key, displayName: SECTION_CONFIG[key].displayName, tags })
    }
  }

  const generalTags = sections.get("general")
  if (generalTags && generalTags.length > 0) {
    orderedSections.push({ key: "general", displayName: "General", tags: generalTags })
  }

  if (orderedSections.length === 0) {
    return null
  }

  return (
    <nav class={classNames(displayClass, "tag-sections")}>
      {orderedSections.map((section) => {
        const sectionHref =
          section.key !== "general"
            ? resolveRelative(fileData.slug!, `tags/${section.key}` as FullSlug)
            : null

        return (
          <div key={section.key} class="tag-section">
            <h4>
              {sectionHref ? (
                <a href={sectionHref} class="internal section-link">
                  {section.displayName}
                </a>
              ) : (
                section.displayName
              )}
            </h4>
            <ul>
              {section.tags.map((tag) => {
                const href = resolveRelative(fileData.slug!, `tags/${tag.fullPath}` as FullSlug)
                return (
                  <li key={tag.fullPath}>
                    <a href={href} class="internal tag-link">
                      {tag.displayName}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}

TagSections.css = `
.tag-sections .tag-section {
  margin-bottom: 0.75rem;
}

.tag-sections h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 0.25rem 0;
  padding: 0;
}

.tag-sections h4 a.section-link {
  color: var(--secondary);
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections h4 a.section-link:hover {
  color: var(--tertiary);
}

.tag-sections ul {
  list-style: none;
  margin: 0;
  padding: 0;
  padding-left: 0.75rem;
}

.tag-sections li {
  padding: 0.1rem 0;
}

.tag-sections a.tag-link {
  color: var(--dark);
  font-size: 0.9rem;
  text-decoration: none;
  background: none;
  padding: 0;
  border-radius: 0;
}

.tag-sections a.tag-link::before {
  content: none;
}

.tag-sections a.tag-link:hover {
  color: var(--tertiary);
}

@media all and (max-width: 800px) {
  .tag-sections {
    display: none;
    position: fixed;
    top: 4rem;
    left: 0;
    right: 0;
    background: var(--light);
    border-bottom: 1px solid var(--lightgray);
    padding: 0.75rem 1rem;
    z-index: 100;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .tag-sections.mobile-open {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .tag-sections .tag-section {
    margin-bottom: 0;
  }

  .tag-sections ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    padding-left: 0;
  }

  .tag-sections li {
    padding: 0;
  }
}
`

export default (() => TagSections) satisfies QuartzComponentConstructor
