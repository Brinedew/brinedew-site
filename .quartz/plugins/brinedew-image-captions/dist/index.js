import { visit } from "unist-util-visit"

const ImageCaptions = () => ({
  name: "brinedew-image-captions",
  htmlPlugins() {
    return [() => (tree) => {
      visit(tree, "element", (node, index, parent) => {
        if (!parent || index === undefined) return
        if (node.tagName !== "p") return
        if (node.children.length !== 1) return
        const img = node.children[0]
        if (img.type !== "element" || img.tagName !== "img") return
        const alt = (img.properties?.alt) || ""
        if (!alt) return

        // Clear alt on img — caption is now visible as figcaption
        img.properties.alt = ""

        const figcaption = {
          type: "element",
          tagName: "figcaption",
          properties: {},
          children: [{ type: "text", value: alt }],
        }

        const figure = {
          type: "element",
          tagName: "figure",
          properties: {},
          children: [img, figcaption],
        }

        parent.children.splice(index, 1, figure)
      })
    }]
  },
})

export { ImageCaptions }
