;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: decorations share the host's own painting surface. Glyphs are never
  // hidden or copied, and scrolling requires no JavaScript position updates.
  function createRangePaint({ documentRef: doc, highlightRuntime: runtime }) {
    const win = doc.defaultView
    const surfaces = new Map()
    const properties = [
      "image",
      "position-x",
      "position-y",
      "size",
      "repeat",
      "origin",
      "clip",
      "attachment",
    ]
    const ownStyles = new WeakMap()
    const dirty = new Set()

    function restore(surface) {
      for (const property of properties) {
        const name = `background-${property}`
        if (surface.element.style.getPropertyValue(name) !== surface.applied[property]) continue
        const original = surface.original[property]
        if (original.value)
          surface.element.style.setProperty(name, original.value, original.priority)
        else surface.element.style.removeProperty(name)
      }
      ownStyles.set(surface.element, surface.element.getAttribute("style"))
    }

    function selectSurface(parent, rect, bleed) {
      let selected = parent
      for (let element = parent; element; element = element.parentElement) {
        const style = win.getComputedStyle(element)
        const box = element.getBoundingClientRect()
        selected = element
        const opaque =
          style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent"
        const scrolling = /(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)
        const independentlyPositioned =
          style.position === "fixed" || style.position === "sticky" || style.transform !== "none"
        const fits =
          style.display !== "inline" &&
          box.left <= rect.left - bleed &&
          box.right >= rect.right + bleed &&
          box.top <= rect.top - bleed &&
          box.bottom >= rect.bottom + bleed
        const backgroundImage = surfaces.get(element)?.baseImage ?? style.backgroundImage
        if (
          opaque ||
          backgroundImage !== "none" ||
          scrolling ||
          independentlyPositioned ||
          fits ||
          element === doc.body
        )
          break
      }
      return selected
    }

    function svgShape(rect, em, color, seed, labelLength) {
      const shape = runtime.getCanvasShape()
      const mode = shape.kind
      let bx = em * 0.2,
        by = em * 0.2
      if (mode === "ellipse") {
        const inline = Math.max(
          2,
          Math.max(em * 0.24, rect.width / Math.max(1, labelLength)) *
            shape.inlineBleedCharsPerSide,
        )
        const vertical = Math.max(2, em * shape.verticalBleedEm)
        const transfer = (rect.height + vertical * 2) * shape.crossToInlineTransferRatio
        bx = inline + transfer / 2
        by = vertical - transfer / 2
      }
      const width = rect.width + bx * 2,
        height = rect.height + by * 2
      const svg =
        mode === "ellipse"
          ? runtime.createRoughEllipseNode(width, height, { seed })
          : doc.createElementNS("http://www.w3.org/2000/svg", "svg")
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
      svg.setAttribute("data-iconoplasm-decoration", "v1")
      svg.setAttribute("width", width)
      svg.setAttribute("height", height)
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
      svg.style.color = color
      function rectangle(spread, fill, alpha = 1, stroke = null, strokeWidth = 0, strokeAlpha = 1) {
        const node = doc.createElementNS("http://www.w3.org/2000/svg", "rect")
        for (const [name, value] of Object.entries({
          x: bx - spread,
          y: by - spread,
          width: rect.width + spread * 2,
          height: rect.height + spread * 2,
          rx: em * (shape.radiusEm || 0) + spread,
          fill,
          "fill-opacity": alpha,
          stroke: stroke || "none",
          "stroke-width": strokeWidth,
          "stroke-opacity": strokeAlpha,
        }))
          node.setAttribute(name, value)
        svg.append(node)
      }
      if (mode === "pill") {
        const ringWidth = em * (shape.ringSpreadEm - shape.fillSpreadEm)
        rectangle(em * shape.fillSpreadEm + ringWidth / 2, "none", 1, shape.ringColor, ringWidth)
        rectangle(em * shape.fillSpreadEm, color, shape.fillAlpha)
      } else if (mode === "pill-outline") {
        rectangle(
          (em * shape.outerSpreadEm) / 2,
          "none",
          1,
          color,
          em * shape.outerSpreadEm,
          shape.outerAlpha,
        )
        rectangle(
          (-em * shape.innerSpreadEm) / 2,
          "none",
          1,
          shape.innerColor,
          em * shape.innerSpreadEm,
        )
      } else if (mode === "underline") {
        const node = doc.createElementNS("http://www.w3.org/2000/svg", "rect")
        for (const [name, value] of Object.entries({
          x: bx,
          y: by + rect.height - em * (shape.bottomInsetEm + shape.thicknessEm),
          width: rect.width,
          height: em * shape.thicknessEm,
          fill: color,
        }))
          node.setAttribute(name, value)
        svg.append(node)
      }
      return {
        image: `url("data:image/svg+xml,${encodeURIComponent(new win.XMLSerializer().serializeToString(svg))}")`,
        width,
        height,
        bx,
        by,
      }
    }

    function commit(surface) {
      restore(surface)
      if (!surface.items.size) {
        surfaces.delete(surface.element)
        return
      }
      const style = win.getComputedStyle(surface.element)
      const base = Object.fromEntries(
        properties.map((property) => [property, style.getPropertyValue(`background-${property}`)]),
      )
      surface.baseImage = base.image
      for (const property of properties) {
        const name = `background-${property}`
        surface.original[property] = {
          value: surface.element.style.getPropertyValue(name),
          priority: surface.element.style.getPropertyPriority(name),
        }
        const layers = [...surface.items.values()].map((item) => item[property]).join(", ")
        surface.element.style.setProperty(name, `${layers}, ${base[property]}`, "important")
        surface.applied[property] = surface.element.style.getPropertyValue(name)
      }
      // Materialize our local image values while the extension's isolated-world
      // policy owns the style calculation. A later host read can otherwise
      // resolve these extension-generated images under the page's img-src policy.
      // This is a style read, not a layout/scroll-position synchronization loop.
      win.getComputedStyle(surface.element).backgroundImage
      ownStyles.set(surface.element, surface.element.getAttribute("style"))
    }

    function remove(item) {
      const surface = item.paintSurface
      if (!surface) return
      surface.items.delete(item)
      item.paintSurface = null
      dirty.add(surface)
    }

    function paint(item, color, seed) {
      const range = item.range
      const parent = range.startContainer.parentElement
      const em = parseFloat(win.getComputedStyle(parent).fontSize) || 16
      const rectangles = [...range.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0,
      )
      // A surface can carry multiple line fragments as independent small images.
      // It never allocates a bitmap as tall as the document.
      const bounds = range.getBoundingClientRect()
      const element = selectSurface(parent, bounds, em)
      if (item.paintSurface?.element !== element) remove(item)
      let surface = surfaces.get(element)
      if (!surface) {
        surface = { element, items: new Map(), original: {}, applied: {} }
        surfaces.set(element, surface)
      }
      const rootStyle = win.getComputedStyle(doc.documentElement)
      const rootImage = surfaces.get(doc.documentElement)?.baseImage ?? rootStyle.backgroundImage
      const bodyCanvas =
        element === doc.body &&
        rootImage === "none" &&
        (rootStyle.backgroundColor === "rgba(0, 0, 0, 0)" ||
          rootStyle.backgroundColor === "transparent")
      const canvas = bodyCanvas ? doc.documentElement : element
      const box = canvas.getBoundingClientRect()
      const documentCanvas = canvas === doc.documentElement
      const scrollLeft = documentCanvas ? 0 : element.scrollLeft
      const scrollTop = documentCanvas ? 0 : element.scrollTop
      const layers = rectangles.map((rect) => {
        const shape = svgShape(rect, em, color, seed, range.toString().length)
        return {
          image: shape.image,
          size: `${shape.width}px ${shape.height}px`,
          "position-x": `${rect.left - box.left + scrollLeft - canvas.clientLeft - shape.bx}px`,
          "position-y": `${rect.top - box.top + scrollTop - canvas.clientTop - shape.by}px`,
          repeat: "no-repeat",
          origin: "padding-box",
          clip: "border-box",
          attachment: "local",
        }
      })
      if (!layers.length) {
        remove(item)
        return
      }
      surface.items.set(
        item,
        Object.fromEntries(
          properties.map((property) => [
            property,
            layers.map((layer) => layer[property]).join(", "),
          ]),
        ),
      )
      item.paintSurface = surface
      dirty.add(surface)
    }

    function flush() {
      for (const surface of dirty) commit(surface)
      dirty.clear()
    }

    return {
      paint,
      remove,
      flush,
      ownsMutation: (record) =>
        record.type === "attributes" &&
        record.attributeName === "style" &&
        ownStyles.has(record.target) &&
        ownStyles.get(record.target) === record.target.getAttribute("style"),
    }
  }
  root.IconoplasmRangePaint = { createRangePaint }
})(globalThis)
