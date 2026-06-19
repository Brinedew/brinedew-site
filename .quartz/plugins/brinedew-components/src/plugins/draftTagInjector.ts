import type { Plugin } from "unified"
import type { Root } from "hast"
import type { VFile } from "vfile"
import { QuartzTransformerPlugin } from "../../quartz/plugins/types"

const rehypeDraftTag: Plugin<[], Root> = () => {
  return (_tree: Root, file: VFile) => {
    const fm = file.data?.frontmatter as Record<string, unknown> | undefined
    if (!fm) return
    const isDraft = fm.draft === true || fm.draft === "true"
    if (!isDraft) return
    const tags = Array.isArray(fm.tags) ? fm.tags : []
    if (!tags.includes("draft")) {
      tags.push("draft")
      fm.tags = tags
    }
  }
}

export const DraftTagInjector: QuartzTransformerPlugin<undefined> = () => ({
  name: "brinedew-draft-tag-injector",
  htmlPlugins() {
    return [rehypeDraftTag]
  },
})
