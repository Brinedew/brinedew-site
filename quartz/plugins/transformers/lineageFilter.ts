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
  // Aggressive debugging - this will show in GitHub Actions
  console.log(`[LineageFilter] PRODUCTION: Plugin loading with minDepthToShow=${opts?.minDepthToShow ?? 3}`)
  console.log(`[LineageFilter] PRODUCTION: rehypeRaw available:`, typeof rehypeRaw)
  console.log(`[LineageFilter] PRODUCTION: rehypeLineageFilter available:`, typeof rehypeLineageFilter)
  
  return {
    name: "LineageFilter",
    htmlPlugins() {
      console.log(`[LineageFilter] PRODUCTION: htmlPlugins() called, returning array with 2 items`)
      
      try {
        const plugins = [
          [rehypeRaw, { passThrough: [] }],  // ensure raw HTML is parsed into elements
          [rehypeLineageFilter, { minDepthToShow: opts?.minDepthToShow ?? 3 }],
        ]
        console.log(`[LineageFilter] PRODUCTION: Plugin array created successfully`)
        return plugins
      } catch (error) {
        console.error(`[LineageFilter] PRODUCTION: Error creating plugin array:`, error)
        return []
      }
    },
  }
}