import { QuartzTransformerPlugin } from "../types"
import { Root, Content } from "mdast"

/**
 * Remove "column 1 & 2" content delineated by Gingko markers.
 * Markers supported:
 *   - <span data-lineage-section="1.2.3"></span>
 *   - <!--section: 1.2.3-->
 *
 * Rule: keep sections with depth >= minDepthToShow (default 3), drop others.
 */
interface Options {
  minDepthToShow?: number
}

const SPAN_RE = /<span[^>]*\bdata-lineage-section=["']?([0-9]+(?:\.[0-9]+)*)["']?[^>]*>\s*$/i
const COMMENT_RE = /<!--\s*section:\s*([0-9]+(?:\.[0-9]+)*)\s*-->\s*$/i

function markerDepth(node: any): number | null {
  if (!node || node.type !== "html" || typeof node.value !== "string") return null
  const v = node.value.trim()
  const m1 = v.match(SPAN_RE)
  if (m1) return m1[1].split(".").length
  const m2 = v.match(COMMENT_RE)
  if (m2) return m2[1].split(".").length
  return null
}

export const LineageFilter: QuartzTransformerPlugin<Options> = (opts?: Options) => {
  const minDepth = opts?.minDepthToShow ?? 3

  return {
    name: "LineageFilter",
    markdownPlugins() {
      return [
        () => {
          return (tree: Root, file: any) => {
            // Simple production check - will show in GitHub Actions logs
            if (file.path?.includes('the-price-of-not-being-cancer-v3')) {
              const beforeCount = tree.children?.length || 0
              console.log(`[LineageFilter] PRODUCTION: Processing ${file.path} - ${beforeCount} children before`)
            }
            
            function process(parent: any): void {
              if (!parent || !Array.isArray(parent.children)) return
              const kids: Content[] = parent.children as Content[]
              const out: Content[] = []

              for (let i = 0; i < kids.length; ) {
                const d = markerDepth(kids[i])
                if (d !== null) {
                  // find the next marker boundary
                  let j = i + 1
                  while (j < kids.length && markerDepth(kids[j]) === null) j++

                  if (d >= minDepth) {
                    // keep content between markers; drop the marker itself
                    for (let k = i + 1; k < j; k++) out.push(kids[k])
                  }
                  // else: drop everything in this range (marker + content)

                  i = j // continue from next marker
                } else {
                  // normal node: keep, and recurse if it has children
                  const node: any = kids[i]
                  out.push(node)
                  if (Array.isArray((node as any).children)) process(node)
                  i++
                }
              }

              parent.children = out
            }

            process(tree)
            
            if (file.path?.includes('the-price-of-not-being-cancer-v3')) {
              const afterCount = tree.children?.length || 0
              console.log(`[LineageFilter] PRODUCTION: ${file.path} - ${afterCount} children after filtering`)
            }
          }
        },
      ]
    },
  }
}