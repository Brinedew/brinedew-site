import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { classNames } from "../util/lang"
import style from "./styles/tagSections.scss"

// Section display names for top-level tag prefixes
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

export default (() => {
  function TagSections({ fileData, displayClass }: QuartzComponentProps) {
    // Get tags from current page only
    const pageTags = fileData.frontmatter?.tags
    if (!pageTags || !Array.isArray(pageTags) || pageTags.length === 0) {
      return null
    }

    // Group current page's tags by top-level prefix
    const sections = new Map<string, TagInfo[]>()

    for (const tag of pageTags) {
      if (typeof tag !== "string") continue
      const normalized = tag.trim().toLowerCase()
      if (!normalized) continue

      const parts = normalized.split("/")
      const prefix = parts[0]
      
      // Display name is the part after the prefix (or full tag if no prefix)
      const displayName = parts.length > 1 ? parts.slice(1).join("/") : normalized

      // Determine section key
      const sectionKey = (parts.length > 1 && SECTION_CONFIG[prefix]) ? prefix : "general"

      if (!sections.has(sectionKey)) {
        sections.set(sectionKey, [])
      }

      sections.get(sectionKey)!.push({
        fullPath: normalized,
        displayName,
      })
    }

    // Sort tags within each section alphabetically
    for (const tags of sections.values()) {
      tags.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }

    // Order sections: known sections first, then general
    const orderedSections: Section[] = []

    for (const key of Object.keys(SECTION_CONFIG)) {
      const tags = sections.get(key)
      if (tags && tags.length > 0) {
        orderedSections.push({
          key,
          displayName: SECTION_CONFIG[key].displayName,
          tags,
        })
      }
    }

    // Add general section last (tags without known prefix)
    const generalTags = sections.get("general")
    if (generalTags && generalTags.length > 0) {
      orderedSections.push({
        key: "general",
        displayName: "General",
        tags: generalTags,
      })
    }

    if (orderedSections.length === 0) {
      return null
    }

    return (
      <nav class={classNames(displayClass, "tag-sections")}>
        {orderedSections.map((section) => {
          // Section header links to the parent tag (e.g., /tags/content)
          const sectionHref = section.key !== "general" 
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

  TagSections.css = style

  return TagSections
}) satisfies QuartzComponentConstructor
