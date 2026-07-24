import { randomUUID } from "crypto"
import { JSX } from "preact/jsx-runtime"
import { QuartzPluginData } from "../plugins/vfile"

export type JSResource = {
  loadTime: "beforeDOMReady" | "afterDOMReady"
  moduleType?: "module"
  spaPreserve?: boolean
} & (
  | {
      src: string
      contentType: "external"
    }
  | {
      script: string
      contentType: "inline"
    }
)

export type CSSResource = {
  content: string
  inline?: boolean
  spaPreserve?: boolean
}

const KATEX_VENDOR_VERSION = "0.16.21"
const KATEX_CDN_CSS =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^/]+\/dist\/katex\.min\.css(?:\?.*)?$/i
const KATEX_CDN_COPY_TEX =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/katex@[^/]+\/dist\/contrib\/copy-tex\.min\.js(?:\?.*)?$/i

export function isKatexCssResource(resource: CSSResource): boolean {
  return (
    (!resource.inline && KATEX_CDN_CSS.test(resource.content)) ||
    resource.content.includes("/static/vendor/katex/")
  )
}

export function isKatexJsResource(resource: JSResource): boolean {
  return (
    resource.contentType === "external" &&
    (KATEX_CDN_COPY_TEX.test(resource.src) || resource.src.includes("/static/vendor/katex/"))
  )
}

function selfHostedJsResource(resource: JSResource): JSResource {
  if (resource.contentType !== "external" || !KATEX_CDN_COPY_TEX.test(resource.src)) {
    return resource
  }
  return {
    ...resource,
    src: `/static/vendor/katex/contrib/copy-tex.min.js?v=${KATEX_VENDOR_VERSION}`,
  }
}

function selfHostedCssResource(resource: CSSResource): CSSResource {
  if (resource.inline || !KATEX_CDN_CSS.test(resource.content)) return resource
  return {
    ...resource,
    content: `/static/vendor/katex/katex.min.css?v=${KATEX_VENDOR_VERSION}`,
  }
}

export function JSResourceToScriptElement(resource: JSResource, preserve?: boolean): JSX.Element {
  const resolved = selfHostedJsResource(resource)
  const scriptType = resolved.moduleType ?? "application/javascript"
  const spaPreserve = preserve ?? resolved.spaPreserve

  if (resolved.contentType === "external") {
    return (
      <script key={resolved.src} src={resolved.src} type={scriptType} data-persist={spaPreserve} />
    )
  } else {
    const content = resolved.script
    return (
      <script
        key={randomUUID()}
        type={scriptType}
        data-persist={spaPreserve}
        dangerouslySetInnerHTML={{ __html: content }}
      ></script>
    )
  }
}

export function CSSResourceToStyleElement(resource: CSSResource, preserve?: boolean): JSX.Element {
  const resolved = selfHostedCssResource(resource)
  const spaPreserve = preserve ?? resolved.spaPreserve
  if (resolved.inline ?? false) {
    return <style dangerouslySetInnerHTML={{ __html: resolved.content }} />
  } else {
    return (
      <link
        key={resolved.content}
        href={resolved.content}
        rel="stylesheet"
        type="text/css"
        data-persist={spaPreserve}
      />
    )
  }
}

export interface StaticResources {
  css: CSSResource[]
  js: JSResource[]
  additionalHead: (JSX.Element | ((pageData: QuartzPluginData) => JSX.Element))[]
}

export type StringResource = string | string[] | undefined

export function normalizeResource(resource: StringResource): string[] {
  if (!resource) return []
  if (Array.isArray(resource)) return resource
  return [resource]
}

export function concatenateResources(...resources: StringResource[]): StringResource {
  return resources
    .filter((resource): resource is string | string[] => resource !== undefined)
    .flat()
}
