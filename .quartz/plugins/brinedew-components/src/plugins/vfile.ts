export interface QuartzPluginData {
  frontmatter?: Record<string, unknown> | null
  slug?: string
  dates?: Record<string, Date>
  defaultDateType?: string
  filePath?: string
  text?: string
  [key: string]: unknown
}

export type ProcessedContent = [unknown, unknown]
export function defaultProcessedContent(vfileData: Partial<QuartzPluginData>): ProcessedContent {
  return [vfileData as any, vfileData as any]
}
