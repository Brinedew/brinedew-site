import { QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { FullSlug, resolveRelative } from "../util/path"
import { classNames } from "../util/lang"
import style from "./styles/tagSections.scss"

type Options = {
  minCount?: number
  showCounts?: boolean
}

const defaultOpts: Options = {
  minCount: 1,
  showCounts: true,
}

// Section display names for top-level tag prefixes
const SECTION_NAMES: Record<string, string> = {
  content: "Content",
  topic: "Topics", 
  protein: "Proteins",
  meta: "Meta",
}

type TagInfo = {
  fullPath: string
  displayName: string
  count: number
}

type Section = {
  name: string
  tags: TagInfo[]
}

export default ((opts?: Options) => {
  const options = { ...defaultOpts, ...opts }

  function TagSections({ allFiles, fileData, displayClass }: QuartzComponentProps) {
    // Count all tags across all files
    const tagCounts = new Map<string, number>()
    
    for (const file of allFiles) {
      const tags = file.frontmatter?.tags
      if (!Array.isArray(tags)) continue
      
      for (const tag of tags) {
        if (typeof tag !== "string") continue
        const normalized = tag.trim().toLowerCase()
        if (!normalized) continue
        tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1)
      }
    }

    // Group tags by top-level prefix
    const sections = new Map<string, TagInfo[]>()
    
    for (const [fullPath, count] of tagCounts) {
      if (count < options.minCount) continue
      
      const parts = fullPath.split("/")
      const prefix = parts[0]
      const displayName = parts.length > 1 ? parts.slice(1).join("/") : fullPath
      
      // Determine section
      let sectionKey: string
      if (parts.length > 1 && SECTION_NAMES[prefix]) {
        sectionKey = prefix
      } else {
        sectionKey = "general"
      }
      
      if (!sections.has(sectionKey)) {
        sections.set(sectionKey, [])
      }
      
      sections.get(sectionKey)!.push({
        fullPath,
        displayName,
        count,
      })
    }

    // Sort tags within each section by count (descending)
    for (const tags of sections.values()) {
      tags.sort((a, b) => b.count - a.count)
    }

    // Order sections: known sections first (in SECTION_NAMES order), then general
    const orderedSections: Section[] = []
    
    // Add known sections in order
    for (const key of Object.keys(SECTION_NAMES)) {
      const tags = sections.get(key)
      if (tags && tags.length > 0) {
        orderedSections.push({
          name: SECTION_NAMES[key],
          tags,
        })
      }
    }
    
    // Add general section last
    const generalTags = sections.get("general")
    if (generalTags && generalTags.length > 0) {
      orderedSections.push({
        name: "General",
        tags: generalTags,
      })
    }

    if (orderedSections.length === 0) {
      return null
    }

    return (
      <nav class={classNames(displayClass, "tag-sections")}>
        {orderedSections.map((section) => (
          <div key={section.name}>
            <h4>{section.name}</h4>
            <ul>
              {section.tags.map((tag) => {
                const href = resolveRelative(fileData.slug!, `tags/${tag.fullPath}` as FullSlug)
                return (
                  <li key={tag.fullPath}>
                    <a href={href} class="internal">
                      {tag.displayName}
                    </a>
                    {options.showCounts && (
                      <span class="tag-count">{tag.count}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    )
  }

  TagSections.css = style

  return TagSections
}) satisfies QuartzComponentConstructor
