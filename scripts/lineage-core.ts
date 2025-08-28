// Core parsing and normalization functions for Lineage grouped-by-depth workflow
// Simplified path-only approach - section path IS the identity

export type Section = {
  path: string        // "1.2.3" (path and identity)
  depth: number
  start: number       // marker start index in file
  after: number       // index right after marker close
  end: number         // start index of next marker or EOF
  content: string
}

// Preprocessing patterns for idempotency
const NL_RX = /\r\n?/g
const LINEAGE_WRAPPERS_RX = /(?:\n)?\s*<!--\s*lineage:(?:scaffold|content)\s+(?:start|end)\s*-->\s*(?:\n)?/gi

// Single attribute approach - path is the identity
const MARKER_RX = /<span(?=[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?)[^>]*>\s*<\/span>/ig

/**
 * Normalize newlines to LF and strip any lineage block comments for idempotency.
 */
function prepareForParse(src: string): string {
  return src.replace(NL_RX, "\n").replace(LINEAGE_WRAPPERS_RX, "")
}

/**
 * Parse all sections from document, ignoring physical order.
 * Returns sections sorted by their position in the document (not by path).
 */
export function parseSections(src: string): Section[] {
  const hits: { path: string; s: number; e: number }[] = []
  MARKER_RX.lastIndex = 0
  let m: RegExpExecArray | null
  
  while ((m = MARKER_RX.exec(src)) !== null) {
    const path = m[1]
    hits.push({ path, s: m.index, e: MARKER_RX.lastIndex })
  }
  
  const out: Section[] = []
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]
    const nextStart = i + 1 < hits.length ? hits[i + 1].s : src.length
    out.push({
      path: cur.path,
      depth: cur.path.split(".").length,
      start: cur.s,
      after: cur.e,
      end: nextStart,
      content: src.slice(cur.e, nextStart), // raw slice; trimming handled later
    })
  }
  
  return out
}

// UID assignment removed - path is the identity

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
 * Split document into frontmatter and body with normalized newlines
 */
export function splitFrontmatter(src: string): { head: string; body: string } {
  const s = src.replace(NL_RX, "\n")
  if (!s.startsWith("---\n")) return { head: "", body: s }
  
  const end = s.indexOf("\n---\n", 4)
  if (end === -1) return { head: "", body: s }
  
  const fmEnd = end + 5
  return { head: s.slice(0, fmEnd) + "\n", body: s.slice(fmEnd) }
}

/**
 * Emit a section as HTML marker + content with stable formatting
 */
function emitSection(section: Section): string {
  // Normalize leading newlines to at most one LF so emission is stable
  const canon = section.content.replace(NL_RX, "\n").replace(/^\n+/, "\n")
  return `<span data-lineage-section="${section.path}"></span>\n` +
         canon.trimEnd() + "\n\n"
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
  // 1) Split frontmatter first, then clean the body portion
  const { head, body } = splitFrontmatter(src)
  const cleanedBody = prepareForParse(body)

  // 2) Parse sections (no UID assignment needed - path is the identity)
  const sections = parseSections(cleanedBody)
  if (sections.length === 0) return head + cleanedBody  // nothing to do

  // 3) Partition by depth
  const scaffold = sections.filter(s => s.depth <= 2)
  const content  = sections.filter(s => s.depth >= 3)

  if (options.sortScaffold) scaffold.sort((a, b) => numericPathCompare(a.path, b.path))
  // content order is preserved as edited; if you want numeric, sort here consistently

  // 4) Emit canonical form (LF only; wrappers injected once)
  const out: string[] = [head]

  if (options.addComments) out.push(`<!-- lineage:scaffold start -->\n\n`)
  for (const s of scaffold) out.push(emitSection(s))
  if (options.addComments) out.push(`<!-- lineage:scaffold end -->\n\n`)

  if (content.length > 0) {
    if (options.addComments) out.push(`<!-- lineage:content start -->\n\n`)
    for (const s of content) out.push(emitSection(s))
    if (options.addComments) out.push(`<!-- lineage:content end -->\n`)
  }

  return out.join("")
}

/**
 * Build tree structure ignoring document order (for Lineage integration)
 */
export type LineageNode = {
  id: string           // Uses path as ID
  path: string
  depth: number
  title?: string
  content: string
  children: LineageNode[]
}

export function buildTreeIgnoringOrder(src: string): LineageNode[] {
  const sections = parseSections(src)
  const nodeMap = new Map<string, LineageNode>()
  
  // Create all nodes - path is the ID
  for (const section of sections) {
    nodeMap.set(section.path, {
      id: section.path,    // Path is the identity
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