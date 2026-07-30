import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Element, ElementContent, Parents, Root, RootContent, Text } from "hast"

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "figure",
  "figcaption",
  "hr",
  "section",
  "article",
  "div",
  "dl",
  "dt",
  "dd",
])

const isElement = (node: RootContent | ElementContent | undefined): node is Element =>
  !!node && node.type === "element"

const isWhitespaceText = (node: RootContent | ElementContent | undefined): node is Text =>
  !!node && node.type === "text" && !node.value.trim()

const isBreak = (node: RootContent | ElementContent | undefined): boolean =>
  isElement(node) && node.tagName === "br"

/**
 * Collapse Obsidian single-enter / double-enter noise into a single web-essay
 * block rhythm: strip hard <br> outside pre/code, drop empty paragraphs, and
 * keep one consistent separation between real blocks via CSS (not source breaks).
 */
function normalizeSpacing(tree: Root): void {
  visit(
    tree,
    "element",
    (node: Element, index: number | undefined, parent: Parents | undefined) => {
      if (!parent || index === undefined) return
      if (node.tagName === "pre" || node.tagName === "code") return

      // Empty paragraphs from stray blank lines
      if (node.tagName === "p") {
        const meaningful = node.children.filter((child) => {
          if (child.type === "text") return child.value.trim().length > 0
          if (isBreak(child)) return false
          return true
        })
        if (meaningful.length === 0) {
          parent.children.splice(index, 1)
          return
        }
        node.children = meaningful as ElementContent[]
      }

      // Strip hard line breaks that remark-breaks injects for single Enter in Obsidian.
      // Inside list items / paragraphs they become space; between blocks they disappear.
      if (node.children.some(isBreak)) {
        const next: ElementContent[] = []
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i]
          if (!isBreak(child)) {
            next.push(child)
            continue
          }
          const prev = next[next.length - 1]
          const following = node.children[i + 1]
          const prevIsBlock = isElement(prev) && BLOCK_TAGS.has(prev.tagName)
          const nextIsBlock = isElement(following) && BLOCK_TAGS.has(following.tagName)
          if (prevIsBlock || nextIsBlock) continue
          if (isWhitespaceText(prev) || isWhitespaceText(following)) continue
          const prevAsUnknown = prev as unknown
          if (
            prevAsUnknown &&
            typeof prevAsUnknown === "object" &&
            (prevAsUnknown as Text).type === "text"
          ) {
            const textNode = prevAsUnknown as Text
            if (!textNode.value.endsWith(" ")) textNode.value += " "
          } else {
            next.push({ type: "text", value: " " })
          }
        }
        node.children = next
      }
    },
  )
}

/**
 * One H1 = document title (first heading in the body). Extra H1s from Obsidian
 * sectioning are demoted to H2+. Relative depth is preserved; overshoot caps at H6.
 */
function normalizeHeadings(tree: Root): void {
  let sawTitle = false
  visit(tree, "element", (node: Element) => {
    const match = /^h([1-6])$/.exec(node.tagName)
    if (!match) return
    const level = Number(match[1])

    if (!sawTitle) {
      sawTitle = true
      // First heading is the page title — force H1 even if author used ##.
      node.tagName = "h1"
      return
    }

    if (level <= 1) {
      node.tagName = "h2"
      return
    }

    node.tagName = `h${Math.min(6, level)}`
  })
}

export const EssayNormalizer: QuartzTransformerPlugin = () => {
  return {
    name: "brinedew-essay-normalizer",
    htmlPlugins() {
      return [
        () => (tree: Root) => {
          normalizeSpacing(tree)
          normalizeHeadings(tree)
        },
      ]
    },
  }
}
