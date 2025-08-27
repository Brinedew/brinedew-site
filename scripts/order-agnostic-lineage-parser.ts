// Order-agnostic parser for Obsidian Lineage plugin
// Drop-in replacement that builds trees by numeric path, not scan order
// Can be used to patch Lineage locally or file a PR

type Node = {
  id: string
  depth: number
  title?: string   // optional: derive from first heading line inside content
  content: string
  children: Node[]
}

const MARKER = /<span[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?[^>]*>\s*<\/span>/ig

export function buildTreeIgnoringOrder(src: string): Node[] {
  // 1) collect ranges - each marker owns content up to next marker/EOF
  const ranges: { id: string; depth: number; start: number; end: number; content: string }[] = []
  let m: RegExpExecArray | null
  const hits: { id: string; s: number; e: number }[] = []
  
  MARKER.lastIndex = 0
  while ((m = MARKER.exec(src)) !== null) {
    hits.push({ id: m[1], s: m.index, e: MARKER.lastIndex })
  }
  
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]
    const nextS = i + 1 < hits.length ? hits[i + 1].s : src.length
    const content = src.slice(cur.e, nextS)
    ranges.push({ 
      id: cur.id, 
      depth: cur.id.split(".").length, 
      start: cur.s, 
      end: cur.e, 
      content 
    })
  }

  console.log(`[OrderAgnosticParser] Found ${ranges.length} sections`)

  // 2) create all nodes in a map
  const byId = new Map<string, Node>()
  for (const r of ranges) {
    byId.set(r.id, {
      id: r.id,
      depth: r.depth,
      title: deriveTitle(r.content),
      content: r.content,
      children: [],
    })
  }

  // Ensure parent nodes exist (create placeholder if needed)
  // This handles cases where 1.1.1 exists but 1.1 doesn't
  for (const id of Array.from(byId.keys())) {
    const parts = id.split(".")
    while (parts.length > 1) {
      parts.pop()
      const pid = parts.join(".")
      if (!byId.has(pid)) {
        console.log(`[OrderAgnosticParser] Creating placeholder parent: ${pid}`)
        byId.set(pid, { 
          id: pid, 
          depth: parts.length, 
          content: "", 
          children: [] 
        })
      }
    }
  }

  // 3) build parent-child relationships by numeric hierarchy
  const numericCmp = (a: string, b: string) => {
    const A = a.split(".").map(Number)
    const B = b.split(".").map(Number)
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const ai = A[i] ?? 0
      const bi = B[i] ?? 0
      if (ai !== bi) return ai - bi
    }
    return 0
  }

  // Clear any existing children (in case we're rebuilding)
  for (const n of byId.values()) {
    n.children = []
  }

  // Build parent-child edges based on section ID hierarchy
  for (const [id, node] of byId) {
    const parts = id.split(".")
    if (parts.length === 1) continue // root node
    
    const parentId = parts.slice(0, -1).join(".")
    const parent = byId.get(parentId)
    
    if (parent) {
      parent.children.push(node)
    } else {
      console.warn(`[OrderAgnosticParser] Parent ${parentId} not found for ${id}`)
    }
  }

  // Sort children at every level by numeric order
  for (const n of byId.values()) {
    n.children.sort((a, b) => numericCmp(a.id, b.id))
  }

  // Return root nodes (depth 1) sorted numerically
  const roots = Array.from(byId.values())
    .filter(n => n.depth === 1)
    .sort((a, b) => numericCmp(a.id, b.id))
  
  console.log(`[OrderAgnosticParser] Built tree with ${roots.length} root nodes`)
  
  return roots
}

function deriveTitle(content: string): string | undefined {
  // Extract title from first heading line in content
  // Matches: ## Title, ### Title, - Title, * Title
  const lines = content.split('\n')
  for (const line of lines.slice(0, 5)) { // Check first few lines only
    const match = line.match(/^\s{0,3}(#{1,6}|\-|\*)\s*(.+)$/)
    if (match && match[2].trim()) {
      let title = match[2].trim()
      
      // Remove common bracketed signposting patterns
      title = title.replace(/^\[.*?\]\s*/, '') // Remove [Hook with examples]
      title = title.replace(/\s*\[.*?\]$/, '') // Remove trailing brackets
      
      return title || undefined
    }
  }
  return undefined
}

// Alternative entry point that matches Lineage's expected interface
export const outlineToJson = (input: string): any[] => {
  const nodes = buildTreeIgnoringOrder(input)
  
  // Convert to format Lineage expects (may need adjustment based on actual Lineage schema)
  function convertToLineageFormat(node: Node): any {
    return {
      id: node.id,
      depth: node.depth,
      title: node.title || `Section ${node.id}`,
      content: node.content,
      children: node.children.map(convertToLineageFormat)
    }
  }
  
  return nodes.map(convertToLineageFormat)
}

// Test function to verify the parser works with your specific content
export function testParser(testContent: string) {
  console.log('=== Testing Order-Agnostic Parser ===')
  const result = buildTreeIgnoringOrder(testContent)
  
  function printTree(nodes: Node[], indent = 0) {
    for (const node of nodes) {
      const space = '  '.repeat(indent)
      const title = node.title || 'No title'
      const contentPreview = node.content.slice(0, 50).replace(/\n/g, ' ') + '...'
      console.log(`${space}${node.id} (${title}) - ${contentPreview}`)
      printTree(node.children, indent + 1)
    }
  }
  
  printTree(result)
  return result
}