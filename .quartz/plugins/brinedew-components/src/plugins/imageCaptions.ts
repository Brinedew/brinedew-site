import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Root, Element, ElementContent, Parents } from "hast"

function isWhitespaceText(node: ElementContent): boolean {
  return node.type === "text" && !node.value.trim()
}

/**
 * Turn Obsidian image paragraphs into real <figure>/<figcaption> boxes.
 * Runs as an htmlPlugin so captions are structure, not CSS afterthoughts.
 */
export const ImageCaptions: QuartzTransformerPlugin = () => {
  return {
    name: "brinedew-image-captions",
    htmlPlugins() {
      return [
        () => (tree: Root) => {
          visit(
            tree,
            "element",
            (node: Element, index: number | undefined, parent: Parents | undefined) => {
              if (!parent || index === undefined) return
              if (node.tagName !== "p") return

              // Allow whitespace text siblings around the single <img>.
              const meaningful = node.children.filter((child) => !isWhitespaceText(child))
              if (meaningful.length !== 1) return
              const img = meaningful[0]
              if (img.type !== "element" || img.tagName !== "img") return

              const alt = typeof img.properties.alt === "string" ? img.properties.alt.trim() : ""
              if (!alt) return

              // Caption is visible as figcaption; keep alt empty to avoid SR double-read.
              img.properties.alt = ""

              const figcaption: Element = {
                type: "element",
                tagName: "figcaption",
                properties: {},
                children: [{ type: "text", value: alt }],
              }

              const figure: Element = {
                type: "element",
                tagName: "figure",
                properties: { className: ["image-with-caption"] },
                children: [img, figcaption],
              }

              parent.children.splice(index, 1, figure)
            },
          )
        },
      ]
    },
  }
}
