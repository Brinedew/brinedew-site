import type { Image, Root, Text } from "mdast"
import { unified } from "unified"
import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "@quartz-community/types"
import { GitHubFlavoredMarkdown } from "../../../plugins/github-flavored-markdown/dist/index.js"

type ImageWithHtmlProperties = Image & {
  data?: {
    hProperties?: Record<string, unknown>
  }
}

function canonicalSmartypantsPlugin() {
  const upstream = GitHubFlavoredMarkdown({ enableSmartyPants: true, linkHeadings: false })
  const plugins = upstream.markdownPlugins?.({} as never) ?? []
  const plugin = plugins[1]

  if (typeof plugin !== "function") {
    throw new Error("GitHubFlavoredMarkdown no longer exposes SmartyPants as its second plugin")
  }

  return plugin
}

/**
 * Extend the configured, maintained SmartyPants processor to image attributes.
 * Obsidian stores embed aliases in `data.hProperties.alt`; remark-smartypants
 * intentionally visits text nodes, so the alias otherwise bypasses it before
 * ImageCaptions promotes that value to visible figcaption text.
 */
export const SmartypantsImageAttributes: QuartzTransformerPlugin = () => ({
  name: "brinedew-smartypants-image-attributes",
  markdownPlugins() {
    const processor = unified().use(canonicalSmartypantsPlugin() as never).freeze()

    const normalize = (value: string): string => {
      const text: Text = { type: "text", value }
      const tree: Root = {
        type: "root",
        children: [{ type: "paragraph", children: [text] }],
      }
      processor.runSync(tree)
      return text.value
    }

    return [
      () => (tree: Root) => {
        visit(tree, "image", (node: ImageWithHtmlProperties) => {
          if (node.alt) node.alt = normalize(node.alt)

          const hProperties = node.data?.hProperties
          if (hProperties && typeof hProperties.alt === "string" && hProperties.alt.length > 0) {
            hProperties.alt = normalize(hProperties.alt)
          }
        })
      },
    ]
  },
})

export default SmartypantsImageAttributes
