import type { SortFn } from "@quartz-community/types"

export interface TagPageOptions {
  sort?: SortFn
  numPages?: number
  prefixTags?: boolean
  displayNames?: Record<string, string>
}
