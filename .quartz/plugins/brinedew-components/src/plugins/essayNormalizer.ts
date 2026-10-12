import { visit } from "unist-util-visit"
import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Element, ElementContent, Parents, Root, RootContent, Text } from "hast"

const isElement = (node: RootContent | ElementContent | undefined): node is Element =>
  !!node && node.type === "element"

const isWhitespaceText = (node: RootContent | ElementContent | undefined): node is Text =>
  !!node && node.type === "text" && !node.value.trim()

const isBreak = (node: RootContent | ElementContent | undefined): boolean =>
  isElement(node) && node.tagName === "br"

const PHRASING_OK = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "cite",
  "code",
  "del",
  "em",
  "i",
  "img",
  "kbd",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
])

function isPhrasingOnly(nodes: ElementContent[]): boolean {
  return nodes.every((child) => {
    if (child.type === "text") return true
    if (child.type !== "element") return false
    if (!PHRASING_OK.has(child.tagName)) return false
    return isPhrasingOnly(child.children as ElementContent[])
  })
}

const isBlock = (node: RootContent | ElementContent | undefined): boolean =>
  isElement(node) && !PHRASING_OK.has(node.tagName)

function trimEdges(children: ElementContent[]): ElementContent[] {
  let start = 0
  let end = children.length
  while (start < end && isWhitespaceText(children[start])) start++
  while (end > start && isWhitespaceText(children[end - 1])) end--
  return children.slice(start, end)
}

function stripBreaks(children: ElementContent[]): ElementContent[] {
  const next: ElementContent[] = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!isBreak(child)) {
      next.push(child)
      continue
    }
    const prev = next[next.length - 1]
    const following = children[i + 1]
    if (isElement(prev) || isElement(following)) continue
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
  return next
}

/**
 * Make uneven vertical rhythm structurally impossible:
 * - Drop empty paragraphs / hard breaks (Obsidian noise).
 * - Unwrap lone phrasing <p> inside <li> so list items are not p+ul sandwiches
 *   with two independent margin boxes.
 * Spacing between siblings is owned by CSS gap on the parent, not by child margins.
 */
function normalizeStructure(tree: Root): void {
  visit(
    tree,
    "element",
    (node: Element, index: number | undefined, parent: Parents | undefined) => {
      if (!parent || index === undefined) return
      if (node.tagName === "pre" || node.tagName === "code") return

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
        // Keep whitespace between inline pieces: in "**slope** $b$" the lone " "
        // between </strong> and the math is the only space the reader gets.
        node.children = trimEdges(stripBreaks(node.children))

        // Lone phrasing paragraph inside a list item → unwrap to bare phrasing.
        // Prevents <li><p>title</p><ul>…</ul></li> from having an extra block box.
        if (parent.type === "element" && parent.tagName === "li" && isPhrasingOnly(node.children)) {
          parent.children.splice(index, 1, ...node.children)
          return
        }
      }

      if (node.children.some(isBreak)) {
        node.children = stripBreaks(node.children as ElementContent[])
      }

      // Drop pure-whitespace text nodes beside block children so flex gap is the
      // only separator (whitespace text can still create anonymous boxes). A
      // space between two inline children of a list item is a word space; keep it.
      if (
        isElement(node) &&
        (node.tagName === "ul" ||
          node.tagName === "ol" ||
          node.tagName === "li" ||
          node.tagName === "blockquote")
      ) {
        const children = node.children
        node.children = children.filter((child, i) => {
          if (!isWhitespaceText(child)) return true
          const prev = children[i - 1]
          const next = children[i + 1]
          return !!prev && !!next && !isBlock(prev) && !isBlock(next)
        })
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
          normalizeStructure(tree)
          normalizeHeadings(tree)
        },
      ]
    },
  }
}
