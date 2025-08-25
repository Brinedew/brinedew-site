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
    // Debug logging for production
    if (file?.path?.includes('the-price-of-not-being-cancer-v3')) {
      console.log(`[rehypeLineageFilter] Processing ${file.path}`)
    }
    process(tree as Parent)
  }
}