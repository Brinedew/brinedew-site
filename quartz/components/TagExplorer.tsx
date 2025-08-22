import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import style from "./styles/tagExplorer.scss"
// @ts-ignore
import script from "./scripts/tagExplorer.inline"

type Options = {
  title?: string
  minCount?: number
  sort?: "alpha" | "count"
  hierarchical?: boolean
  aggregateCounts?: boolean
  defaultOpenDepth?: number
}

// Hierarchical tag node structure
type TagNode = {
  name: string              // this segment only, e.g., "aging"  
  path: string              // full path, e.g., "topic/aging"
  count: number             // exact count for this path only
  pages: { title: string; slug: string }[]
  children: Map<string, TagNode>
}

const defaultOpts: Required<Options> = {
  title: "Tags", 
  minCount: 1,
  sort: "count",
  hierarchical: true,
  aggregateCounts: true,
  defaultOpenDepth: 1,
}

function normalizeTag(t: unknown): string | null {
  if (typeof t !== "string") return null
  const s = t.trim()
  if (!s.length) return null
  // Clean up hierarchical paths: trim slashes, collapse multiple slashes
  const cleaned = s.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/")
  // Keep original case for display, but use lowercase for processing consistency
  return cleaned.toLowerCase()
}

function splitTagPath(path: string): string[] {
  // "topic/aging" -> ["topic", "aging"]; "solo" -> ["solo"]
  return path.split("/").filter(Boolean)
}

function buildTagTree(allFiles: any[], opts: Required<Options>): TagNode {
  const root: TagNode = { name: "", path: "", count: 0, pages: [], children: new Map() }

  for (const f of allFiles) {
    const title = f.frontmatter?.title ?? f.slug
    const slug = "/" + f.slug

    const tagsRaw = (f.frontmatter?.tags ?? []) as unknown[]
    const tags = (Array.isArray(tagsRaw) ? tagsRaw : [tagsRaw]).map(normalizeTag).filter(Boolean) as string[]
    
    // Dedupe tags per file to avoid double-counting
    const uniqueTags = Array.from(new Set(tags))

    // Handle untagged files
    if (uniqueTags.length === 0) {
      const untaggedParts = ["untagged"]
      let cursor = root
      let accPath = ""

      for (let i = 0; i < untaggedParts.length; i++) {
        const segment = untaggedParts[i]
        accPath = accPath ? `${accPath}/${segment}` : segment

        let child = cursor.children.get(segment)
        if (!child) {
          child = { name: segment, path: accPath, count: 0, pages: [], children: new Map() }
          cursor.children.set(segment, child)
        }

        if (i === untaggedParts.length - 1) {
          child.count++
          child.pages.push({ title, slug })
        }

        cursor = child
      }
      continue
    }

    for (const tag of uniqueTags) {
      if (opts.hierarchical) {
        // Build hierarchical structure
        const parts = splitTagPath(tag)
        if (parts.length === 0) continue

        let cursor = root
        let accPath = ""

        for (let i = 0; i < parts.length; i++) {
          const segment = parts[i]
          accPath = accPath ? `${accPath}/${segment}` : segment

          let child = cursor.children.get(segment)
          if (!child) {
            child = { name: segment, path: accPath, count: 0, pages: [], children: new Map() }
            cursor.children.set(segment, child)
          }

          // Only the final segment receives this page as an exact match
          if (i === parts.length - 1) {
            child.count++
            child.pages.push({ title, slug })
          }

          cursor = child
        }
      } else {
        // Flat structure fallback
        let child = root.children.get(tag)
        if (!child) {
          child = { name: tag, path: tag, count: 0, pages: [], children: new Map() }
          root.children.set(tag, child)
        }
        child.count++
        child.pages.push({ title, slug })
      }
    }
  }

  return root
}

function aggregateCount(node: TagNode): number {
  let sum = node.count
  for (const child of node.children.values()) {
    sum += aggregateCount(child)
  }
  return sum
}

let numTagExplorers = 0
export default ((user?: Options) => {
  const opts = { ...defaultOpts, ...user }

  function TagExplorer({ allFiles, displayClass, cfg }: QuartzComponentProps) {
    // Build hierarchical tag tree
    const root = buildTagTree(allFiles, opts)
    
    // Filter nodes by minimum count and sort
    function sortChildren(a: TagNode, b: TagNode): number {
      // Always put "untagged" at the bottom
      if (a.name === "untagged") return 1
      if (b.name === "untagged") return -1
      
      const ca = opts.aggregateCounts ? aggregateCount(a) : a.count
      const cb = opts.aggregateCounts ? aggregateCount(b) : b.count
      
      if (opts.sort === "alpha") return a.name.localeCompare(b.name)
      return cb - ca || a.name.localeCompare(b.name)
    }
    
    function filterByCount(node: TagNode): boolean {
      const count = opts.aggregateCounts ? aggregateCount(node) : node.count
      return count >= opts.minCount
    }
    
    const filteredChildren = Array.from(root.children.values())
      .filter(filterByCount)
      .sort(sortChildren)

    if (filteredChildren.length === 0) {
      return null
    }

    // Hierarchical rendering function
    function renderNode(node: TagNode, depth: number): JSX.Element {
      const children = Array.from(node.children.values())
        .filter(filterByCount)
        .sort(sortChildren)
      
      const count = opts.aggregateCounts ? aggregateCount(node) : node.count
      const hasChildren = children.length > 0
      const hasPages = node.pages.length > 0
      
      // Determine if this node should be initially open based on depth
      const shouldDefaultOpen = depth < opts.defaultOpenDepth
      
      return (
        <li class="tag-group" data-depth={depth}>
          <div 
            class="tag-container" 
            data-tag={node.path}
            style={{ paddingLeft: `${depth * 12}px` }}
          >
            <span class="tag-name-area">
              <span class="tag-name">{node.name === "untagged" ? "untagged" : node.name}</span>
              <span class="tag-count">({count})</span>
            </span>
            {hasChildren && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="tag-icon"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            )}
          </div>
          <div class="tag-pages-outer" style={{ display: shouldDefaultOpen ? "block" : "none" }}>
            {hasPages && (
              <ul>
                {node.pages
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((p) => (
                    <li><a href={p.slug}>{p.title}</a></li>
                  ))}
              </ul>
            )}
            {hasChildren && (
              <ul class="tag-children" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {children.map((child) => renderNode(child, depth + 1))}
              </ul>
            )}
          </div>
        </li>
      )
    }

    const id = `tag-explorer-${numTagExplorers++}`
    return (
      <div class={classNames(displayClass, "tag-explorer")}>
        <button
          type="button"
          class="tag-explorer-header"
          aria-controls={id}
          aria-expanded="true"
        >
          <h3>{opts.title}</h3>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="fold"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <div id={id} class="tag-explorer-content" role="group">
          <ul class="tag-explorer-root" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {filteredChildren.map((node) => renderNode(node, 0))}
          </ul>
        </div>
      </div>
    )
  }

  TagExplorer.css = style
  TagExplorer.afterDOMLoaded = script

  return TagExplorer
}) satisfies QuartzComponentConstructor