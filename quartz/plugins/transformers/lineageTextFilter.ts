import type { QuartzTransformerPlugin } from "../types"

interface Options { minDepthToShow?: number; attribute?: string }

/**
 * Keep only content that follows markers with depth >= minDepthToShow.
 * Markers are <span data-lineage-section="1.2.3"></span>
 */
export const LineageTextFilter: QuartzTransformerPlugin<Options> = (opts) => {
  const keepDepth = opts?.minDepthToShow ?? 3
  const attr = opts?.attribute ?? "data-lineage-section"

  // Matches a closed span marker: <span ... data-lineage-section="1.2.3" ...></span>
  const MARKER = new RegExp(
    `<span[^>]*\\b${attr}=["']?([0-9]+(?:\\.[0-9]+)*)["']?[^>]*>\\s*</span>`,
    "ig",
  )

  return {
    name: "LineageTextFilter",
    textTransform(_ctx, src) {
      const hasMarkers = src.includes('data-lineage-section')
      
      // Only process files that have markers to avoid unnecessary work
      if (!hasMarkers) {
        return src
      }
      
      const out: string[] = []
      let idx = 0
      let m: RegExpExecArray | null

      const depth = (id: string) => id.split(".").length

      // Reset regex state
      MARKER.lastIndex = 0

      while ((m = MARKER.exec(src)) !== null) {
        const start = m.index
        const end = MARKER.lastIndex
        const markerDepth = depth(m[1])
        
        // push untouched text before marker
        out.push(src.slice(idx, start))

        // find next marker boundary
        const nextMatch = MARKER.exec(src)
        const nextStart = nextMatch ? nextMatch.index : src.length

        if (markerDepth >= keepDepth) {
          // keep content between markers (exclude the marker itself)
          out.push(src.slice(end, nextStart))
        }
        // else: filter out this section entirely

        // continue from next marker (or EOF)
        idx = nextStart
        if (!nextMatch) break
        
        // Reset for next iteration - we already found the next match
        MARKER.lastIndex = nextMatch.index
      }

      // tail
      out.push(src.slice(idx))
      
      return out.join("")
    },
  }
}