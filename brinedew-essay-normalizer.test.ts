import assert from "node:assert/strict"
import test from "node:test"
import type { Element, Root, RootContent } from "hast"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { EssayNormalizer } from "./.quartz/plugins/brinedew-components/src/plugins/essayNormalizer"

// Golden lines from real notes, run through remark → rehype → EssayNormalizer.
// Before 2026-10-12 the normalizer dropped every whitespace-only text node inside
// <p> and <li>, so "**Gompertz slope** $b$" rendered as "Gompertz slopeb".
async function render(markdown: string): Promise<Root> {
  const tree = (await unified()
    .use(remarkRehype)
    .run(unified().use(remarkParse).parse(markdown))) as Root
  for (const plugin of EssayNormalizer({} as never).htmlPlugins!({} as never)) {
    ;(plugin as () => (tree: Root) => void)()(tree)
  }
  return tree
}

function visibleText(node: Root | RootContent): string {
  if (node.type === "text") return node.value
  if (node.type === "root" || node.type === "element")
    return node.children.map(visibleText).join("")
  return ""
}

const cases: Array<[string, string, string]> = [
  // wiki/Mortality rate models.md (math renders inside an inline span, like this code span)
  [
    "The **Gompertz slope** `b` is how fast it rises.",
    "The Gompertz slope b is how fast it rises.",
    "bold then inline math",
  ],
  [
    "the *central death rate* `m_x`: deaths at age x",
    "the central death rate m_x: deaths at age x",
    "italic then inline math",
  ],
  // posts/criticism-of-dwarkesh-podcast.md
  ["**Dwarkesh Patel** *00:06:44*", "Dwarkesh Patel 00:06:44", "bold then italic"],
  // wiki/research-gaps.md, a list item
  [
    "- **Rule:** **Any** detectable reversal",
    "Rule: Any detectable reversal",
    "two bold runs in a list item",
  ],
]

for (const [markdown, expected, label] of cases) {
  test(`keeps the word space: ${label}`, async () => {
    assert.equal(visibleText(await render(markdown)).trim(), expected)
  })
}

test("still drops whitespace between block children of a list item", async () => {
  const tree = await render("- **Lead** *term*\n\n  Second paragraph\n\n  - nested\n")
  const item = (tree.children.find((n) => n.type === "element") as Element).children.find(
    (n) => n.type === "element",
  ) as Element
  assert.equal(item.tagName, "li")
  const blankBesideBlock = item.children.some((child, i) => {
    if (child.type !== "text" || child.value.trim()) return false
    const near = [item.children[i - 1], item.children[i + 1]]
    return near.some((n) => n?.type === "element" && ["p", "ul"].includes(n.tagName))
  })
  assert.equal(blankBesideBlock, false)
  assert.match(visibleText(item), /Lead term/)
})
