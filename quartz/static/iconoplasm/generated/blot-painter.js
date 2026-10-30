/* GENERATED FILE. Edit shared/iconoplasm-card/blot-painter.js and rerun node scripts/sync-iconoplasm-shared.mjs. */

// The blot painter: one picture of the gene's current portrait with the card's
// name, symbol and shading baked into its pixels. The layout comes from the
// shared card itself, laid out on the blot's 384x512 borderless artboard in an
// isolated frame (so the page's own styles can't move it). Two callers, one
// painter (B-1068, B-1131):
// - the print button paints in the reader's browser at the portrait's own size,
//   copying its pixels 1:1;
// - scripts/draw-iconoplasm-blots.mjs paints every gene's published blot at a
//   fixed width (options.width, 768) in headless Chrome.
;(function () {
  const ARTBOARD_WIDTH = 384
  const ARTBOARD_HEIGHT = 512
  // The card's faces, filled in from font-contract.json by
  // scripts/sync-iconoplasm-shared.mjs: [{ family, url, weight }].
  const FONT_FACES = [{"family":"IBM Plex Mono","url":"/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2","weight":400},{"family":"IBM Plex Mono","url":"/static/iconoplasm/fonts/IBMPlexMono-Medium.woff2","weight":500},{"family":"League Spartan","url":"/static/iconoplasm/fonts/LeagueSpartan-800.woff2","weight":800},{"family":"Special Elite","url":"/static/iconoplasm/fonts/SpecialElite-Regular.woff2","weight":400},{"family":"Delicious Handrawn","url":"/static/iconoplasm/fonts/DeliciousHandrawn-400.woff2","weight":400}]

  // Split "a(b, c) d, e" at top-level commas.
  function splitTopLevel(value) {
    const parts = []
    let depth = 0
    let start = 0
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index]
      if (char === "(") depth += 1
      else if (char === ")") depth -= 1
      else if (char === "," && depth === 0) {
        parts.push(value.slice(start, index).trim())
        start = index + 1
      }
    }
    parts.push(value.slice(start).trim())
    return parts.filter(Boolean)
  }

  function parseColor(context, value) {
    // The canvas normalises any CSS colour; read it back as rgba numbers.
    context.fillStyle = "#000"
    context.fillStyle = value
    const normal = String(context.fillStyle)
    const hex = /^#([0-9a-f]{6})$/i.exec(normal)
    if (hex) {
      const n = Number.parseInt(hex[1], 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
    }
    const rgba = /rgba?\(([^)]+)\)/i.exec(normal)
    const [r, g, b, a = "1"] = rgba ? rgba[1].split(/[\s,/]+/).filter(Boolean) : ["0", "0", "0", "0"]
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) }
  }

  const rgbaText = (c, a = c.a) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`

  // CSS linear-gradient(...) from computed style, painted on the canvas.
  function paintLinearGradient(context, value, width, height) {
    const inner = /^linear-gradient\((.*)\)$/s.exec(value.trim())
    if (!inner) return false
    const parts = splitTopLevel(inner[1])
    let angle = 180
    const angleMatch = /^(-?[\d.]+)deg$/.exec(parts[0])
    if (angleMatch) {
      angle = Number(angleMatch[1])
      parts.shift()
    } else if (/^to /.test(parts[0])) {
      const side = parts.shift().slice(3).trim()
      angle = { top: 0, right: 90, bottom: 180, left: 270 }[side] ?? 180
    }
    const stops = parts.map((part) => {
      const match = /^(.*?)(?:\s+(-?[\d.]+)%)?$/.exec(part)
      return { color: parseColor(context, match[1]), at: match[2] == null ? null : Number(match[2]) / 100 }
    })
    if (stops[0].at == null) stops[0].at = 0
    if (stops[stops.length - 1].at == null) stops[stops.length - 1].at = 1
    for (let index = 1; index < stops.length - 1; index += 1) {
      if (stops[index].at != null) continue
      let next = index
      while (stops[next].at == null) next += 1
      const from = stops[index - 1].at
      const step = (stops[next].at - from) / (next - index + 1)
      for (let fill = index; fill < next; fill += 1) stops[fill].at = from + step * (fill - index + 1)
    }
    // The CSS gradient line for this angle, centred on the box.
    const radians = (angle * Math.PI) / 180
    const length = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
    const dx = (Math.sin(radians) * length) / 2
    const dy = (-Math.cos(radians) * length) / 2
    const gradient = context.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy)
    // CSS mixes colours premultiplied; a canvas does not. A fully transparent
    // stop takes its neighbour's colour on each side so the two match.
    stops.forEach((stop, index) => {
      const at = Math.min(1, Math.max(0, stop.at))
      if (stop.color.a > 0) {
        gradient.addColorStop(at, rgbaText(stop.color))
        return
      }
      const before = stops[index - 1]?.color
      const after = stops[index + 1]?.color
      gradient.addColorStop(at, rgbaText(before && before.a > 0 ? before : after || stop.color, 0))
      gradient.addColorStop(at, rgbaText(after && after.a > 0 ? after : before || stop.color, 0))
    })
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
    return true
  }

  function parseTextShadows(value) {
    if (!value || value === "none") return []
    return splitTopLevel(value).map((shadow) => {
      const color = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+\([^)]*\))/i.exec(shadow)?.[1] || "rgba(0,0,0,1)"
      const lengths = shadow.replace(color, "").trim().split(/\s+/).map((v) => Number.parseFloat(v) || 0)
      return { color, x: lengths[0] || 0, y: lengths[1] || 0, blur: lengths[2] || 0 }
    })
  }

  async function artboardFrame(stylesheetHref) {
    const frame = document.createElement("iframe")
    frame.setAttribute("aria-hidden", "true")
    frame.tabIndex = -1
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${ARTBOARD_WIDTH}px;height:${ARTBOARD_HEIGHT}px;border:0;visibility:hidden;pointer-events:none`
    const faces = FONT_FACES.map(
      ({ family, url, weight }) =>
        `@font-face{font-family:"${family}";src:url("${url}") format("woff2");font-weight:${weight};font-style:normal;font-display:block}`,
    ).join("")
    frame.srcdoc =
      '<!doctype html><html><head><meta charset="utf-8">' +
      `<link rel="stylesheet" href="${stylesheetHref}">` +
      `<style>${faces}html,body{margin:0;width:${ARTBOARD_WIDTH}px;height:${ARTBOARD_HEIGHT}px;overflow:hidden;color-scheme:light;` +
      "--light:oklch(96% 0.015 75);--dark:oklch(20% 0.035 50)}" +
      `#artboard>.icono-card{width:${ARTBOARD_WIDTH}px;height:${ARTBOARD_HEIGHT}px;max-width:none;box-sizing:border-box;border:0}</style>` +
      '</head><body><main id="artboard"></main></body></html>'
    const loaded = new Promise((resolve, reject) => {
      frame.addEventListener("load", resolve, { once: true })
      frame.addEventListener("error", () => reject(new Error("blot artboard failed to load")), { once: true })
    })
    document.body.appendChild(frame)
    await loaded
    return frame
  }

  // One run of text: each character drawn where the card's own layout put it.
  function paintText(context, element, k) {
    const view = element.ownerDocument.defaultView
    const style = view.getComputedStyle(element)
    const font = `${style.fontStyle} ${style.fontWeight} ${Number.parseFloat(style.fontSize) * k}px ${style.fontFamily}`
    context.font = font
    // Where the layout puts the baseline inside a line's box: a zero-size
    // inline-block sits on the baseline. Canvas font metrics disagree with the
    // layout's by up to half a CSS pixel, so the layout is asked directly.
    // The probe goes in a one-line twin with the same font, so the card's own
    // line breaking is never disturbed.
    const doc = element.ownerDocument
    const twin = doc.createElement("div")
    twin.style.cssText =
      "position:absolute;left:0;top:0;white-space:nowrap;visibility:hidden;" +
      ["font-family", "font-size", "font-weight", "font-style", "font-stretch", "line-height", "letter-spacing"]
        .map((name) => `${name}:${style.getPropertyValue(name)}`)
        .join(";")
    twin.textContent = "H"
    const probe = doc.createElement("span")
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"
    twin.appendChild(probe)
    doc.body.appendChild(twin)
    const twinRange = doc.createRange()
    twinRange.selectNodeContents(twin.firstChild)
    const baseline = probe.getBoundingClientRect().top - twinRange.getClientRects()[0].top
    twin.remove()
    const glyphs = []
    const walker = element.ownerDocument.createTreeWalker(element, view.NodeFilter.SHOW_TEXT)
    const range = element.ownerDocument.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue || ""
      for (let index = 0; index < text.length; ) {
        const code = text.codePointAt(index)
        const size = code > 0xffff ? 2 : 1
        const char = text.slice(index, index + size)
        range.setStart(node, index)
        range.setEnd(node, index + size)
        const rect = [...range.getClientRects()].find((r) => r.width > 0 || r.height > 0)
        if (rect && char.trim()) glyphs.push({ char, x: rect.left * k, y: Math.round((rect.top + baseline) * k) })
        index += size
      }
    }
    const color = style.color
    const draw = () => glyphs.forEach((g) => context.fillText(g.char, g.x, g.y))
    // CSS paints every shadow under the text, then the text once on top. A
    // canvas shadow is cast by a fill, so each shadow is cast by text drawn far
    // off the canvas, with the shadow offset bringing it back into place.
    const away = context.canvas.width * 4
    for (const shadow of parseTextShadows(style.textShadow).reverse()) {
      context.save()
      context.shadowColor = shadow.color
      context.shadowBlur = shadow.blur * k
      context.shadowOffsetX = shadow.x * k + away
      context.shadowOffsetY = shadow.y * k
      context.translate(-away, 0)
      context.fillStyle = "#000"
      draw()
      context.restore()
    }
    context.fillStyle = color
    draw()
  }

  async function paintIconoplasmBlot(card, options = {}) {
    const shared = globalThis.IconoplasmCardShared
    if (!shared || typeof shared.renderLabLabelCardHtml !== "function") {
      throw new Error("Iconoplasm shared card renderer is unavailable")
    }
    const portraitUrl = String(options.portraitUrl || card?.portrait?.hero_url || "")
    if (!portraitUrl) throw new Error("This card has no published portrait")
    const response = await fetch(portraitUrl, { mode: "cors", credentials: "omit" })
    if (!response.ok) throw new Error(`Portrait download failed (HTTP ${response.status})`)
    const portrait = await createImageBitmap(await response.blob())
    // The page's own copy of the card stylesheet, cache key included.
    const pageStylesheet = document.querySelector('link[rel="stylesheet"][href*="shared-card-label.css"]')
    const frame = await artboardFrame(
      options.stylesheetHref ||
        pageStylesheet?.href ||
        "/static/iconoplasm/generated/shared-card-label.css",
    )
    try {
      const doc = frame.contentDocument
      const symbol = shared.normalizedSymbol(card.symbol || card.canonical_symbol)
      const color = card.color || card.color_hex || "#888888"
      const body = shared.renderLabLabelCardHtml(card, {
        layoutVariant: "image-only",
        mode: "brick",
        portraitAlt: `${symbol} portrait`,
        // Layout never depends on the picture; a blank pixel keeps the frame
        // from downloading the portrait a second time.
        portraitSrc: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
        titleHref: "",
        voteHtml: "",
      })
      doc.getElementById("artboard").innerHTML =
        `<article class="icono-card icono-card--brick icono-card--variant-image-only" data-icono-card-variant="image-only" style="--width:${ARTBOARD_WIDTH};--height:${ARTBOARD_HEIGHT};--icono-card-accent:${color}">${body}</article>`
      doc.querySelector(".icono-image-only-photo")?.classList.add("icono-image-only-photo--loaded")
      doc.querySelector(".icono-image-only-media-stage")?.classList.add("icono-image-only-media-stage--loaded")
      const link = doc.querySelector(".icono-image-only-link")
      link?.classList.add("icono-image-only-link--loaded")
      await doc.fonts.ready
      await Promise.all([...doc.fonts].map((face) => face.load().catch(() => null)))
      // A published blot is never drawn in a fallback face: the drawing script
      // asks for every face, and a face that failed to load stops the paint.
      if (options.requireFonts && [...doc.fonts].some((face) => face.status !== "loaded")) {
        throw new Error("A card font failed to load")
      }

      // The photo fills the borderless card (the card CSS fences any inset).
      const view = doc.defaultView
      const cardBox = doc.querySelector("#artboard>.icono-card").getBoundingClientRect()
      const photoBox = doc.querySelector(".icono-image-only-photo")?.getBoundingClientRect()
      if (!photoBox || photoBox.left !== cardBox.left || photoBox.top !== cardBox.top || photoBox.width !== cardBox.width || photoBox.height !== cardBox.height) {
        throw new Error("The image-only card no longer fills its artboard with the portrait")
      }
      // A portrait that isn't 3:4 is trimmed the way object-fit: cover trims it
      // on the card. Without options.width the blot is the portrait's own
      // pixels, copied 1:1, as large as the portrait allows; with it, the same
      // trim is drawn at that width.
      const native = Math.min(portrait.width / ARTBOARD_WIDTH, portrait.height / ARTBOARD_HEIGHT)
      const sourceWidth = Math.round(ARTBOARD_WIDTH * native)
      const sourceHeight = Math.round(ARTBOARD_HEIGHT * native)
      const k = Number(options.width) > 0 ? Number(options.width) / ARTBOARD_WIDTH : native
      const width = Math.round(ARTBOARD_WIDTH * k)
      const height = Math.round(ARTBOARD_HEIGHT * k)
      const canvas = doc.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      context.imageSmoothingQuality = "high"
      const sx = Math.round((portrait.width - sourceWidth) / 2)
      const sy = Math.round((portrait.height - sourceHeight) / 2)
      context.drawImage(portrait, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height)
      const shade = link ? view.getComputedStyle(link, "::after") : null
      if (shade && Number(shade.opacity) > 0 && shade.backgroundImage !== "none") {
        context.save()
        context.globalAlpha = Number(shade.opacity)
        // Layers list front to back; paint back to front.
        for (const layer of splitTopLevel(shade.backgroundImage).reverse()) paintLinearGradient(context, layer, width, height)
        context.restore()
      }
      for (const selector of [".icono-image-only-name", ".icono-image-only-symbol"]) {
        const element = doc.querySelector(selector)
        if (element) paintText(context, element, k)
      }
      // Hand back a canvas of this document: the frame goes away below.
      const out = document.createElement("canvas")
      out.width = width
      out.height = height
      out.getContext("2d").drawImage(canvas, 0, 0)
      return out
    } finally {
      frame.remove()
      portrait.close?.()
    }
  }

  globalThis.IconoplasmBlot = { paint: paintIconoplasmBlot }
})()
