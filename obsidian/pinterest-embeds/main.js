// Brinedew Pinterest Embeds: a Pinterest pin link alone on its own line shows
// as the pin's embed, in reading view and in live preview. The site does the
// same at build time (.quartz/plugins/brinedew-components/src/plugins/
// pinterestEmbeds.ts), so a pasted link looks the same in both places.
// The note keeps the plain link; nothing is written back.
const { Plugin, requestUrl } = require("obsidian")
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view")
const { RangeSetBuilder } = require("@codemirror/state")

const PIN_LINK =
  /^https?:\/\/(?:(?:[a-z]{2,3}\.|www\.)?pinterest\.[a-z.]+\/pin\/[^\s]+|pin\.it\/[A-Za-z0-9]+\/?)$/i
const EMBED_ID = /assets\.pinterest\.com\/ext\/embed\.html\?id=(\d+)/

const frames = new Map()

/** Pinterest's oEmbed answer for `url`: { id, width, height }, or null. */
function pinFrame(url) {
  if (!frames.has(url)) {
    frames.set(
      url,
      requestUrl({ url: `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}` })
        .then((response) => {
          const body = response.json
          const id = EMBED_ID.exec(body.html ?? "")?.[1]
          return id ? { id, width: body.width ?? 450, height: body.height ?? 600 } : null
        })
        .catch(() => null),
    )
  }
  return frames.get(url)
}

function iframeFor(frame) {
  const iframe = document.createElement("iframe")
  iframe.src = `https://assets.pinterest.com/ext/embed.html?id=${frame.id}`
  iframe.width = String(frame.width)
  iframe.height = String(frame.height)
  iframe.title = "Pinterest pin"
  iframe.setAttribute("frameborder", "0")
  iframe.setAttribute("scrolling", "no")
  iframe.style.display = "block"
  iframe.style.maxWidth = "100%"
  return iframe
}

/** Swaps `placeholder` for the pin's frame once Pinterest answers. */
function mountPin(url, placeholder) {
  pinFrame(url).then((frame) => {
    if (frame && placeholder.isConnected) placeholder.replaceWith(iframeFor(frame))
  })
}

function barePinLink(node) {
  if (!(node instanceof HTMLAnchorElement)) return null
  const href = node.getAttribute("href") ?? ""
  // Only a bare pasted URL embeds; a captioned [text](pin) stays a link.
  return node.textContent.trim() === href && PIN_LINK.test(href) ? href : null
}

function embedReadingView(el) {
  for (const block of el.querySelectorAll("p, li")) {
    const lines = [...block.childNodes].filter(
      (node) =>
        !(node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) && node.nodeName !== "BR",
    )
    if (lines.length === 0 || !lines.every(barePinLink)) continue
    for (const link of lines) mountPin(barePinLink(link), link)
  }
}

class PinWidget extends WidgetType {
  constructor(url) {
    super()
    this.url = url
  }
  eq(other) {
    return other.url === this.url
  }
  toDOM() {
    const holder = document.createElement("span")
    holder.textContent = this.url
    const wrap = document.createElement("span")
    wrap.style.display = "inline-block"
    wrap.appendChild(holder)
    mountPin(this.url, holder)
    return wrap
  }
}

// Live preview: a line that is only a pin link (indentation and a list marker
// allowed) shows the pin unless the cursor is on it, like Obsidian's own embeds.
const LINE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?)(\S+)\s*$/

function decorations(view) {
  const builder = new RangeSetBuilder()
  const selection = view.state.selection
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      const match = LINE.exec(line.text)
      if (match && PIN_LINK.test(match[2])) {
        const start = line.from + match[1].length
        const end = start + match[2].length
        const touched = selection.ranges.some(
          (range) => range.from <= line.to && range.to >= line.from,
        )
        if (!touched)
          builder.add(start, end, Decoration.replace({ widget: new PinWidget(match[2]) }))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const livePreviewPins = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = decorations(view)
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = decorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

module.exports = class PinterestEmbeds extends Plugin {
  onload() {
    this.registerMarkdownPostProcessor(embedReadingView)
    this.registerEditorExtension(livePreviewPins)
  }
}
