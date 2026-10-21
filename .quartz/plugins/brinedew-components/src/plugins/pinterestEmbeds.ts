import type { QuartzTransformerPlugin } from "@quartz-community/types"
import type { Root, Element, ElementContent, RootContent } from "hast"

// A Pinterest pin link alone on its own line becomes Pinterest's own embed,
// the way Obsidian turns a lone YouTube link into a player. The author pastes
// the link; the frame and its size come from Pinterest's oEmbed answer at
// build time. A pin oEmbed can't describe (deleted, private, network down)
// stays a plain link.
const PIN_LINK = /^https?:\/\/(?:(?:[a-z]{2,3}\.|www\.)?pinterest\.[a-z.]+\/pin\/[^\s]+|pin\.it\/[A-Za-z0-9]+\/?)$/i
const EMBED_ID = /assets\.pinterest\.com\/ext\/embed\.html\?id=(\d+)/

type Container = Root | Element

interface PinFrame {
  id: string
  width: number
  height: number
}

function isElement(node: RootContent | ElementContent | undefined): node is Element {
  return !!node && node.type === "element"
}

function barePinLink(node: ElementContent): string | undefined {
  if (!isElement(node) || node.tagName !== "a") return undefined
  const href = String(node.properties.href ?? "")
  const text = node.children.map((child) => (child.type === "text" ? child.value : "")).join("")
  // Only a bare pasted URL embeds; a captioned [text](pin) stays a link.
  return text.trim() === href && PIN_LINK.test(href) ? href : undefined
}

/**
 * The pin URLs when `node` holds nothing but bare pin links, one per line.
 * Pins pasted on consecutive lines share a paragraph, split by <br>.
 */
function lonePinLinks(node: Element): string[] | undefined {
  const lines = node.children.filter(
    (child) =>
      !(child.type === "text" && !child.value.trim()) && !(isElement(child) && child.tagName === "br"),
  )
  const urls = lines.map(barePinLink)
  if (urls.length === 0 || urls.some((url) => !url)) return undefined
  return urls as string[]
}

const frames = new Map<string, Promise<PinFrame | undefined>>()

function pinFrame(url: string): Promise<PinFrame | undefined> {
  let frame = frames.get(url)
  if (!frame) {
    frame = (async () => {
      try {
        const response = await fetch(
          `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`,
          { signal: AbortSignal.timeout(10_000) },
        )
        if (!response.ok) return undefined
        const body = (await response.json()) as { html?: string; width?: number; height?: number }
        const id = EMBED_ID.exec(body.html ?? "")?.[1]
        if (!id) return undefined
        return { id, width: body.width ?? 450, height: body.height ?? 600 }
      } catch {
        return undefined
      }
    })()
    frames.set(url, frame)
  }
  return frame
}

function iframeFor(frame: PinFrame): Element {
  return {
    type: "element",
    tagName: "iframe",
    properties: {
      src: `https://assets.pinterest.com/ext/embed.html?id=${frame.id}`,
      width: frame.width,
      height: frame.height,
      frameBorder: "0",
      scrolling: "no",
      loading: "lazy",
      title: "Pinterest pin",
      className: ["pinterest-embed"],
    },
    children: [],
  }
}

async function embedPins(parent: Container): Promise<void> {
  for (const node of parent.children) {
    if (!isElement(node)) continue
    const urls = node.tagName === "p" || node.tagName === "li" ? lonePinLinks(node) : undefined
    if (!urls) {
      await embedPins(node)
      continue
    }
    const pinFrames = await Promise.all(urls.map(pinFrame))
    node.children = node.children.map((child) => {
      const index = urls.indexOf(barePinLink(child) ?? "")
      const frame = index >= 0 ? pinFrames[index] : undefined
      return frame ? iframeFor(frame) : child
    })
  }
}

export const PinterestEmbeds: QuartzTransformerPlugin = () => {
  return {
    name: "brinedew-pinterest-embeds",
    htmlPlugins() {
      return [() => async (tree: Root) => embedPins(tree)]
    },
  }
}
