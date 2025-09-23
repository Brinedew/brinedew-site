import { QuartzTransformerPlugin } from "../types"
import { visit } from "unist-util-visit"
import { Element, Root } from "hast"
import { clone } from "../../util/clone"

interface Options {
  /** Only add captions when alt text is non-empty. Default: true */
  requireAlt?: boolean
  /** Optional class to put on the wrapping figure */
  figureClass?: string
}

const defaultOptions: Required<Options> = {
  requireAlt: true,
  figureClass: "image-with-caption",
}

// Wrap <img> in <figure><img/><figcaption>alt</figcaption></figure>
export const ImageCaptions: QuartzTransformerPlugin<Options> = (userOpts) => {
  const opts = { ...defaultOptions, ...(userOpts ?? {}) }

  return {
    name: "ImageCaptions",
    htmlPlugins() {
      return [() => (tree: Root) => {
        visit(tree, "element", (node: Element, index: number | null, parent: Element | Root | null) => {
          if (!parent || index === null) return
          if (node.tagName !== "img") return

          // Skip if already inside a figure
          if ((parent as Element).tagName === "figure") return

          const alt = (node.properties?.["alt"] as string | undefined) ?? ""
          if (opts.requireAlt && alt.trim().length === 0) return

          const imgClone = clone(node) as Element

          const figure: Element = {
            type: "element",
            tagName: "figure",
            properties: { class: opts.figureClass },
            children: [
              imgClone,
              {
                type: "element",
                tagName: "figcaption",
                properties: {},
                children: [{ type: "text", value: alt }],
              },
            ],
          }

          parent.children.splice(index, 1, figure)
        })
      }]
    },
  }
}

