// Core parsing and normalization functions for Lineage grouped-by-depth workflow
// Based on consultant's architecture for bidirectional editing

export type Section = {
  uid: string
  path: string        // "1.2.3" (display path)
  depth: number
  start: number       // marker start index in file
  after: number       // index right after marker close
  end: number         // start index of next marker or EOF
  content: string
}

// Match both UID and section markers in any order
const MARKER_RX = /<span[^>]*\bdata-lineage-uid=["']?([0-9a-fA-F-]{8,})["'][^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["'][^>]*>\s*<\/span>/ig
const SECTION_ONLY_RX = /<span[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["'][^>]*>\s*<\/span>/ig
const UID_CHECK_RX = /\bdata-lineage-uid=["'][0-9a-fA-F-]{8,}["']/i

/**
 * Parse all sections from document, ignoring physical order.
 * Returns sections sorted by their position in the document (not by path).
 */
export function parseSections(src: string): Section[] {
  const hits: { uid: string; path: string; s: number; e: number }[] = []
  MARKER_RX.lastIndex = 0
  let m: RegExpExecArray | null
  
  while ((m = MARKER_RX.exec(src)) !== null) {
    hits.push({ uid: m[1], path: m[2], s: m.index, e: MARKER_RX.lastIndex })
  }
  
  const out: Section[] = []
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]
    const nextS = i + 1 < hits.length ? hits[i + 1].s : src.length
    out.push({
      uid: cur.uid,
      path: cur.path,
      depth: cur.path.split(".").length,
      start: cur.s,
      after: cur.e,
      end: nextS,
      content: src.slice(cur.e, nextS),
    })
  }
  
  return out
}

/**
 * Check if document already has UIDs assigned to markers.
 */
export function hasUids(src: string): boolean {
  return UID_CHECK_RX.test(src)
}

/**
 * Assign stable UIDs to any markers missing them.
 * Uses timestamp + counter for deterministic but unique IDs.
 */
export function assignUidsOnce(src: string): string {
  if (hasUids(src)) return src
  
  const timestamp = Date.now().toString(16)
  let counter = 0
  
  return src.replace(SECTION_ONLY_RX, (match, path) => {
    const uid = `${timestamp}-${(counter++).toString(16).padStart(4, '0')}`
    return match.replace('<span', `<span data-lineage-uid="${uid}"`)
  })
}

/**
 * Numeric comparison for dot-separated paths (1.2.10 comes after 1.2.2)
 */
export function numericPathCompare(a: string, b: string): number {
  const aParts = a.split(".").map(Number)
  const bParts = b.split(".").map(Number)
  
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] ?? 0
    const bPart = bParts[i] ?? 0
    if (aPart !== bPart) return aPart - bPart
  }
  
  return 0
}

/**
 * Split document into frontmatter and body
 */
export function splitFrontmatter(src: string): { head: string; body: string } {
  if (!src.startsWith("---")) return { head: "", body: src }
  
  const endIndex = src.indexOf("\n---", 3)
  if (endIndex < 0) return { head: "", body: src }
  
  const frontmatterEnd = endIndex + 4
  return {
    head: src.slice(0, frontmatterEnd) + "\n\n",
    body: src.slice(frontmatterEnd)
  }
}

/**
 * Emit a section as HTML marker + content
 */
function emitSection(section: Section): string {
  return `<span data-lineage-uid="${section.uid}" data-lineage-section="${section.path}"></span>\n` +
         section.content.trimStart() + "\n\n"
}

export interface NormalizeOptions {
  sortScaffold?: boolean  // Sort scaffold sections numerically vs preserve order
  addComments?: boolean   // Add <!-- lineage:scaffold start --> style comments
}

/**
 * Normalize document into grouped-by-depth layout:
 * - Frontmatter (preserved)
 * - Scaffold block (depths 1-2) 
 * - Content block (depths 3+)
 * 
 * This is idempotent - running it multiple times produces the same result.
 */
export function normalizeGrouped(src: string, options: NormalizeOptions = {}): string {
  const { head, body } = splitFrontmatter(src)
  const sections = parseSections(body)
  
  if (sections.length === 0) return src // Nothing to normalize
  
  // Split by depth
  const scaffoldSections = sections.filter(s => s.depth <= 2)
  const contentSections = sections.filter(s => s.depth >= 3)
  
  // Sort scaffold if requested, otherwise preserve document order
  if (options.sortScaffold) {
    scaffoldSections.sort((a, b) => numericPathCompare(a.path, b.path))
  }
  
  // Build normalized document
  const parts: string[] = [head]
  
  if (options.addComments) {
    parts.push("<!-- lineage:scaffold start -->\n\n")
  }
  
  for (const section of scaffoldSections) {
    parts.push(emitSection(section))
  }
  
  if (options.addComments) {
    parts.push("<!-- lineage:scaffold end -->\n\n")
  }
  
  if (contentSections.length > 0) {
    if (options.addComments) {
      parts.push("<!-- lineage:content start -->\n\n")
    }
    
    for (const section of contentSections) {
      parts.push(emitSection(section))
    }
    
    if (options.addComments) {
      parts.push("<!-- lineage:content end -->\n")
    }
  }
  
  return parts.join("")
}

/**
 * Build tree structure ignoring document order (for Lineage integration)
 */
export type LineageNode = {
  id: string
  path: string
  depth: number
  title?: string
  content: string
  children: LineageNode[]
}

export function buildTreeIgnoringOrder(src: string): LineageNode[] {
  const sections = parseSections(src)
  const nodeMap = new Map<string, LineageNode>()
  
  // Create all nodes
  for (const section of sections) {
    nodeMap.set(section.path, {
      id: section.uid,
      path: section.path,
      depth: section.depth,
      title: deriveTitle(section.content),
      content: section.content,
      children: []
    })
  }
  
  // Ensure parent nodes exist (create placeholders if needed)
  for (const path of Array.from(nodeMap.keys())) {
    const parts = path.split(".")
    while (parts.length > 1) {
      parts.pop()
      const parentPath = parts.join(".")
      if (!nodeMap.has(parentPath)) {
        nodeMap.set(parentPath, {
          id: `placeholder-${parentPath}`,
          path: parentPath,
          depth: parts.length,
          content: "",
          children: []
        })
      }
    }
  }
  
  // Build parent-child relationships
  for (const [path, node] of nodeMap) {
    const parts = path.split(".")
    if (parts.length === 1) continue // Root node
    
    const parentPath = parts.slice(0, -1).join(".")
    const parent = nodeMap.get(parentPath)
    if (parent) {
      parent.children.push(node)
    }
  }
  
  // Sort children numerically at each level
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => numericPathCompare(a.path, b.path))
  }
  
  // Return root nodes (depth 1)
  const roots = Array.from(nodeMap.values())
    .filter(n => n.depth === 1)
    .sort((a, b) => numericPathCompare(a.path, b.path))
  
  return roots
}

/**
 * Extract title from content (first heading or strong text)
 */
function deriveTitle(content: string): string | undefined {
  // Try to find first heading
  const headingMatch = content.match(/^\s*#{2,6}\s+(.+)$/m)
  if (headingMatch) return headingMatch[1].trim()
  
  // Try to find first strong text
  const strongMatch = content.match(/\*\*(.+?)\*\*/)
  if (strongMatch) return strongMatch[1].trim()
  
  // Fall back to first line
  const firstLine = content.trim().split('\n')[0]
  if (firstLine && firstLine.length < 100) {
    return firstLine.replace(/[#*\[\]]/g, '').trim()
  }
  
  return undefined
}