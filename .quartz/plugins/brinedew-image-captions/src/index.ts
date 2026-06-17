import { visit } from "unist-util-visit"
import { Root, Element, ElementContent } from "hast"

const ImageCaptions = () => {
  return {
    name: "brinedew-image-captions",
    htmlPlugins() {
      return [() => (tree: Root) => {
        visit(tree, "element", (node: Element, index: number | undefined, parent: Element | undefined) => {
          if (!parent || index === undefined) return
          if (node.tagName !== "p") return
          if (node.children.length !== 1) return
          const img = node.children[0]
          if (img.type !== "element" || img.tagName !== "img") return
          const alt = (img.properties?.alt as string) || ""
          if (!alt) return

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

          parent.children.splice(index, 1, figure as ElementContent)
        })
      }]
    },
  }
}

export { ImageCaptions }
