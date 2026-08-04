import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Root, Element, ElementContent, RootContent, Text } from "hast"

type Container = Root | Element

function isElement(node: RootContent | ElementContent | undefined): node is Element {
  return !!node && node.type === "element"
}

function isWhitespaceText(node: RootContent | ElementContent | undefined): node is Text {
  return !!node && node.type === "text" && !node.value.trim()
}

function imageInside(node: ElementContent): Element | undefined {
  if (!isElement(node)) return undefined
  if (node.tagName === "img") return node
  if (node.tagName !== "a") return undefined

  const meaningful = node.children.filter((child) => !isWhitespaceText(child))
  if (meaningful.length !== 1) return undefined
  const child = meaningful[0]
  return isElement(child) && child.tagName === "img" ? child : undefined
}

function trimmedPhrasing(nodes: ElementContent[]): ElementContent[] {
  const next = [...nodes]
  const first = next[0]
  const last = next[next.length - 1]

  if (first?.type === "text") first.value = first.value.replace(/^\s+/, "")
  if (last?.type === "text") last.value = last.value.replace(/\s+$/, "")
  return next.filter((node) => !isWhitespaceText(node))
}

function captionFor(img: Element): string {
  const properties = img.properties
  let alt = typeof properties.alt === "string" ? properties.alt.trim() : ""
  const width = String(properties.width ?? "")
  const height = String(properties.height ?? "")

  // The upstream Obsidian parser mistakes a four-digit year at the end of an
  // alias for an image width (for example "From Miller et al., 2007"). Repair
  // only that unambiguous citation shape; real numeric width/height requests
  // remain intact.
  if (alt.endsWith(",") && /^(?:18|19|20)\d{2}$/.test(width) && (!height || height === "auto")) {
    alt = `${alt} ${width}`
    delete properties.width
  }

  // `auto` is a CSS value, not a valid HTML width/height attribute. Leaving it
  // on an image can resolve to a zero-sized replaced element in the browser.
  if (properties.width === "auto") delete properties.width
  if (properties.height === "auto") delete properties.height

  return alt
}

function figureFor(media: Element, img: Element): Element {
  const caption = captionFor(img)
  const children: ElementContent[] = [media]

  if (caption) {
    // Caption is visible as figcaption; keep alt empty to avoid an SR double-read.
    img.properties.alt = ""
    children.push({
      type: "element",
      tagName: "figcaption",
      properties: {},
      children: [{ type: "text", value: caption }],
    })
  }

  return {
    type: "element",
    tagName: "figure",
    properties: { className: [caption ? "image-with-caption" : "image-without-caption"] },
    children,
  }
}

function splitImageParagraph(paragraph: Element): Element[] | undefined {
  if (!paragraph.children.some((child) => imageInside(child))) return undefined

  const replacement: Element[] = []
  let phrasing: ElementContent[] = []
  const flushPhrasing = () => {
    const children = trimmedPhrasing(phrasing)
    phrasing = []
    if (children.length === 0) return
    replacement.push({
      type: "element",
      tagName: "p",
      properties: { ...paragraph.properties },
      children,
    })
  }

  for (const child of paragraph.children) {
    const img = imageInside(child)
    if (!img) {
      phrasing.push(child)
      continue
    }

    flushPhrasing()
    replacement.push(figureFor(child as Element, img))
  }
  flushPhrasing()
  return replacement
}

/**
 * Convert every Markdown image into a top-level figure within its current
 * container. CommonMark legally merges adjacent source lines into one
 * paragraph, so this intentionally handles prose-image-prose and consecutive
 * images instead of depending on authors to surround embeds with blank lines.
 */
export function normalizeImageCaptions(parent: Container): void {
  for (let index = 0; index < parent.children.length; index++) {
    const node = parent.children[index]
    if (!isElement(node)) continue
    if (node.tagName === "figure") continue

    if (node.tagName === "p") {
      const replacement = splitImageParagraph(node)
      if (replacement) {
        parent.children.splice(index, 1, ...replacement)
        index += replacement.length - 1
        continue
      }
    }

    normalizeImageCaptions(node)
  }
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
          normalizeImageCaptions(tree)
        },
      ]
    },
  }
}
