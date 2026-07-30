import type { Plugin } from "unified"
import type { Root } from "hast"
import type { VFile } from "vfile"
import type { QuartzTransformerPlugin } from "@quartz-community/types"

const rehypeDraftTag: Plugin<[], Root> = () => {
  return (_tree: Root, file: VFile) => {
    const frontmatter = file.data.frontmatter
    if (!frontmatter) return
    const isDraft = frontmatter.draft === true || frontmatter.draft === "true"
    if (!isDraft) return
    const tags = frontmatter.tags ?? []
    if (!tags.includes("draft")) {
      frontmatter.tags = [...tags, "draft"]
    }
  }
}

export const DraftTagInjector: QuartzTransformerPlugin<undefined> = () => ({
  name: "brinedew-draft-tag-injector",
  htmlPlugins() {
    return [rehypeDraftTag]
  },
})
