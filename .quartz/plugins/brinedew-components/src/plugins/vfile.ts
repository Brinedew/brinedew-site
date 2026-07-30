import type { Root } from "hast"
import type { ProcessedContent, QuartzPluginData } from "@quartz-community/types"
import { VFile } from "vfile"

export type { ProcessedContent, QuartzPluginData } from "@quartz-community/types"

export function defaultProcessedContent(vfileData: Partial<QuartzPluginData>): ProcessedContent {
  const root: Root = { type: "root", children: [] }
  const file = new VFile()
  Object.assign(file.data, vfileData)
  return [root, file]
}
