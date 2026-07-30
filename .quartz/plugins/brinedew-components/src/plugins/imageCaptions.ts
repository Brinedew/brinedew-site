import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Root, Element, Parents } from "hast"

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
              if (node.children.length !== 1) return
              const img = node.children[0]
              if (img.type !== "element" || img.tagName !== "img") return
              const alt = typeof img.properties.alt === "string" ? img.properties.alt : ""
              if (!alt) return

              // Replace <p><img alt="caption"></p> with <figure><img><figcaption>caption</figcaption></figure>
              const figcaption: Element = {
                type: "element",
                tagName: "figcaption",
                properties: {},
                children: [{ type: "text", value: alt }],
              }

              const figure: Element = {
                type: "element",
                tagName: "figure",
                properties: {},
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
