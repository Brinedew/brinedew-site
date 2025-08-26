import { Plugin } from "unified"
import { Root, Element, Parent, Content } from "hast"

interface Options {
  attribute?: string            // defaults to "data-lineage-section"
  minDepthToShow?: number       // defaults to 3 (keep 3+ dots)
}

export default function rehypeLineageFilter(
  opts: Options = {}
): Plugin<[Options?], Root> {
  const attr = opts.attribute ?? "data-lineage-section"
  const minDepth = opts.minDepthToShow ?? 3

  const isMarker = (n: any): n is Element =>
    n?.type === "element" &&
    n.tagName === "span" &&
    n.properties &&
    typeof (n.properties as any)[attr] === "string"

  const depthOf = (n: Element): number => {
    const id = String((n.properties as any)[attr] ?? "")
    return id ? id.split(".").length : 0
  }

  const process = (parent: Parent): void => {
    if (!Array.isArray(parent.children)) return
    const kids = parent.children
    const out: Content[] = []

    for (let i = 0; i < kids.length; ) {
      const node = kids[i] as any
      if (isMarker(node)) {
        const d = depthOf(node)
        // find next marker
        let j = i + 1
        while (j < kids.length && !isMarker(kids[j] as any)) j++

        if (d >= minDepth) {
          for (let k = i + 1; k < j; k++) out.push(kids[k] as Content)
        }
        // drop marker and (maybe) its range
        i = j
      } else {
        out.push(kids[i] as Content)
        const child: any = kids[i]
        if (Array.isArray(child?.children)) process(child as Parent)
        i++
      }
    }

    parent.children = out
  }

  return () => (tree: Root, file: any) => {
    // Aggressive debugging - always log when processing any file
    console.log(`[rehypeLineageFilter] PRODUCTION: Processing file: ${file?.path || 'unknown'}`)
    console.log(`[rehypeLineageFilter] PRODUCTION: Tree type: ${tree.type}, children count: ${tree.children?.length || 0}`)
    
    // Count markers before processing
    const countMarkers = (parent: Parent): number => {
      let count = 0
      if (!Array.isArray(parent.children)) return count
      
      for (const child of parent.children) {
        if (isMarker(child as any)) count++
        if (Array.isArray((child as any)?.children)) {
          count += countMarkers(child as Parent)
        }
      }
      return count
    }
    
    const markersBefore = countMarkers(tree as Parent)
    console.log(`[rehypeLineageFilter] PRODUCTION: Found ${markersBefore} markers before processing`)
    
    process(tree as Parent)
    
    const markersAfter = countMarkers(tree as Parent)
    console.log(`[rehypeLineageFilter] PRODUCTION: Found ${markersAfter} markers after processing (should be 0)`)
    console.log(`[rehypeLineageFilter] PRODUCTION: Final tree children count: ${tree.children?.length || 0}`)
  }
}