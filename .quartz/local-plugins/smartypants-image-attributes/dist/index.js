import { unified } from "unified"
import { visit } from "unist-util-visit"
import { GitHubFlavoredMarkdown } from "../../../plugins/github-flavored-markdown/dist/index.js"

function canonicalSmartypantsPlugin() {
  const upstream = GitHubFlavoredMarkdown({ enableSmartyPants: true, linkHeadings: false })
  const plugins = upstream.markdownPlugins?.({}) ?? []
  const plugin = plugins[1]

  if (typeof plugin !== "function") {
    throw new Error("GitHubFlavoredMarkdown no longer exposes SmartyPants as its second plugin")
  }

  return plugin
}

export const SmartypantsImageAttributes = () => ({
  name: "brinedew-smartypants-image-attributes",
  markdownPlugins() {
    const processor = unified().use(canonicalSmartypantsPlugin()).freeze()

    const normalize = (value) => {
      const text = { type: "text", value }
      const tree = {
        type: "root",
        children: [{ type: "paragraph", children: [text] }],
      }
      processor.runSync(tree)
      return text.value
    }

    return [
      () => (tree) => {
        visit(tree, "image", (node) => {
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
