import assert from "node:assert/strict"
import test from "node:test"
import { SmartypantsImageAttributes } from "./.quartz/local-plugins/smartypants-image-attributes/dist/index.js"

type MarkdownNode = {
  type: string
  alt?: string
  data?: { hProperties?: Record<string, unknown> }
  children?: MarkdownNode[]
}

test("the maintained SmartyPants processor reaches Obsidian caption attributes", () => {
  const plugin = SmartypantsImageAttributes()
  const markdownPlugins = plugin.markdownPlugins?.({} as never) ?? []
  const captionTypography = markdownPlugins[0]

  assert.equal(typeof captionTypography, "function")

  const tree: MarkdownNode = {
    type: "root",
    children: [
      {
        type: "image",
        alt: 'A standard image\'s "caption"',
        data: {
          hProperties: {
            alt: "They don't know about Bogdanov's \"cleanest row\"",
          },
        },
      },
    ],
  }

  const transform = (captionTypography as () => (tree: MarkdownNode) => void)()
  transform(tree)

  const image = tree.children?.[0]
  assert.equal(image?.alt, "A standard image’s “caption”")
  assert.equal(image?.data?.hProperties?.alt, "They don’t know about Bogdanov’s “cleanest row”")
})
