import assert from "node:assert/strict"
import test from "node:test"
import type { Element, Root, Text } from "hast"
import { normalizeImageCaptions } from "./.quartz/plugins/brinedew-components/src/plugins/imageCaptions"

function image(alt: string, properties: Element["properties"] = {}): Element {
  return {
    type: "element",
    tagName: "img",
    properties: { src: "image.png", alt, width: "auto", height: "auto", ...properties },
    children: [],
  }
}

function paragraph(...children: Element["children"]): Element {
  return { type: "element", tagName: "p", properties: {}, children }
}

function textValue(element: Element, index: number): string {
  return (element.children[index] as Text).value
}

test("mixed prose and consecutive images become independent rhythmic blocks", () => {
  const first = image("First caption")
  const second = image("Second caption")
  const tree: Root = {
    type: "root",
    children: [
      paragraph({ type: "text", value: "Before\n" }, first, second, {
        type: "text",
        value: "\nAfter",
      }),
    ],
  }

  normalizeImageCaptions(tree)

  assert.deepEqual(
    tree.children.map((node) => (node as Element).tagName),
    ["p", "figure", "figure", "p"],
  )
  assert.equal(textValue(tree.children[0] as Element, 0), "Before")
  assert.equal(textValue(tree.children[3] as Element, 0), "After")
  assert.equal(textValue((tree.children[1] as Element).children[1] as Element, 0), "First caption")
  assert.equal(first.properties.alt, "")
  assert.equal(first.properties.width, undefined)
  assert.equal(first.properties.height, undefined)
})

test("captionless images still become figures without invented text", () => {
  const tree: Root = { type: "root", children: [paragraph(image(""))] }

  normalizeImageCaptions(tree)

  const figure = tree.children[0] as Element
  assert.equal(figure.tagName, "figure")
  assert.deepEqual(figure.properties.className, ["image-without-caption"])
  assert.equal(figure.children.length, 1)
})

test("repairs citation years misread as widths but preserves explicit dimensions", () => {
  const citation = image("From Miller et al.,", { width: "2007", height: "auto" })
  const sized = image("Diagram", { width: "400", height: "300" })
  const tree: Root = { type: "root", children: [paragraph(citation), paragraph(sized)] }

  normalizeImageCaptions(tree)

  const citationFigure = tree.children[0] as Element
  const sizedFigure = tree.children[1] as Element
  assert.equal(textValue(citationFigure.children[1] as Element, 0), "From Miller et al., 2007")
  assert.equal(citation.properties.width, undefined)
  assert.equal(citation.properties.height, undefined)
  assert.equal(textValue(sizedFigure.children[1] as Element, 0), "Diagram")
  assert.equal(sized.properties.width, "400")
  assert.equal(sized.properties.height, "300")
})
