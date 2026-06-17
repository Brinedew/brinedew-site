import { JSX } from "preact"
import { Node } from "hast"

type StringResource = string | string[] | undefined

interface QuartzPluginData {
  frontmatter?: Record<string, unknown> | null
  slug?: string
  dates?: Record<string, Date>
  defaultDateType?: string
  filePath?: string
  text?: string
  [key: string]: unknown
}

interface GlobalConfiguration {
  pageTitle: string
  pageTitleSuffix?: string
  enableSPA: boolean
  enablePopovers: boolean
  analytics: unknown
  ignorePatterns: string[]
  baseUrl?: string
  theme: unknown
  locale: string
}

interface BuildCtx {
  buildId: string
  cfg: { configuration: GlobalConfiguration; plugins: unknown; externalPlugins?: unknown }
  allSlugs: unknown[]
  allFiles: string[]
  incremental: boolean
  [key: string]: unknown
}

interface StaticResources {
  css: { content: string; inline?: boolean; spaPreserve?: boolean }[]
  js: (({ src: string; contentType: "external" } | { script: string; contentType: "inline" }) & { loadTime: "beforeDOMReady" | "afterDOMReady"; moduleType?: "module"; spaPreserve?: boolean })[]
  additionalHead: (JSX.Element | ((pageData: QuartzPluginData) => JSX.Element))[]
}

export type QuartzComponentProps = {
  ctx: BuildCtx
  externalResources: StaticResources
  fileData: QuartzPluginData
  cfg: GlobalConfiguration
  children: (QuartzComponent | JSX.Element)[]
  tree: Node
  allFiles: QuartzPluginData[]
  displayClass?: "mobile-only" | "desktop-only"
} & JSX.IntrinsicAttributes & { [key: string]: any }

export type QuartzComponent = ((props: QuartzComponentProps) => any) & {
  displayName?: string
  css?: StringResource
  beforeDOMLoaded?: StringResource
  afterDOMLoaded?: StringResource
}

export type QuartzComponentConstructor<Options extends object | undefined = undefined> = (
  opts: Options,
) => QuartzComponent
