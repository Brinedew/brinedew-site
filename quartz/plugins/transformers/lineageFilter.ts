import { QuartzTransformerPlugin } from "../types"
import rehypeRaw from "rehype-raw"
import rehypeLineageFilter from "./rehypeLineageFilter"

/**
 * Remove "column 1 & 2" content delineated by Gingko markers.
 * Filters at HTML-AST stage to ensure modifications persist to final output.
 * 
 * Rule: keep sections with depth >= minDepthToShow (default 3), drop others.
 */
interface Options {
  minDepthToShow?: number
}

export const LineageFilter: QuartzTransformerPlugin<Options> = (opts?: Options) => {
  return {
    name: "LineageFilter",
    htmlPlugins() {
      return [
        [rehypeRaw, { passThrough: [] }],  // ensure raw HTML is parsed into elements
        [rehypeLineageFilter, { minDepthToShow: opts?.minDepthToShow ?? 3 }],
      ]
    },
  }
}