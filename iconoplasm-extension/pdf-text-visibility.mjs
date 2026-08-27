// PDF text extraction is not a visibility API. In particular, a Form XObject
// can contain a whole page while painting only the figure inside its BBox.
// Keep the upstream PDF.js renderer untouched: this read-only sidecar carries
// explicit operator clipping to the exact extracted text, never guessed pixels.
const identity = [1, 0, 0, 1, 0, 0]
const normalize = (text) =>
  String(text || "")
    .normalize("NFKC")
    .replace(/\s/gu, "")
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]
const transformPoint = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function buildTextVisibilityIndex(operatorList, textContent, ops, optionalContent = null) {
  let state = { font: null, matrix: identity, clips: [], mode: 0, fillAlpha: 1, strokeAlpha: 1 }
  const stack = [],
    marked = [],
    fonts = new Map()
  let characterCount = 0
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const op = operatorList.fnArray[i],
      args = operatorList.argsArray[i] || []
    if (op === ops.save || op === ops.paintFormXObjectBegin) {
      stack.push(state)
      state = { ...state }
      if (op === ops.paintFormXObjectBegin) {
        if (args[0]) state.matrix = multiply(state.matrix, args[0])
        if (args[1]) {
          const [x0, y0, x1, y1] = args[1]
          const polygon = [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
          ].map((p) => transformPoint(state.matrix, p))
          state.clips = [...state.clips, polygon]
        }
      }
    } else if (op === ops.restore || op === ops.paintFormXObjectEnd) {
      if (!stack.length) throw new Error("Unbalanced PDF visibility state")
      state = stack.pop()
    } else if (op === ops.transform) state = { ...state, matrix: multiply(state.matrix, args) }
    else if (op === ops.setFont) state = { ...state, font: args[0] }
    else if (op === ops.setTextRenderingMode) state = { ...state, mode: args[0] }
    else if (op === ops.setGState) {
      state = { ...state }
      for (const [key, value] of args[0] || []) {
        if (key === "ca") state.fillAlpha = value
        if (key === "CA") state.strokeAlpha = value
        if (key === "Font") state.font = value[0]
      }
    } else if (op === ops.beginMarkedContent || op === ops.beginMarkedContentProps) {
      marked.push(args[0] !== "OC" || Boolean(optionalContent?.isVisible(args[1])))
    } else if (op === ops.endMarkedContent) {
      if (!marked.length) throw new Error("Unbalanced PDF marked content")
      marked.pop()
    } else if (
      op === ops.showText ||
      op === ops.showSpacedText ||
      op === ops.nextLineShowText ||
      op === ops.nextLineSetSpacingShowText
    ) {
      const glyphs = args.at(-1)
      if (!Array.isArray(glyphs)) throw new Error("Unsupported PDF text operator")
      const text = normalize(
        glyphs
          .filter((g) => g && typeof g === "object")
          .map((g) => g.unicode || "")
          .join(""),
      )
      const mode = state.mode & 3
      const visible =
        marked.every(Boolean) &&
        (((mode === 0 || mode === 2) && state.fillAlpha > 0) ||
          ((mode === 1 || mode === 2) && state.strokeAlpha > 0))
      const rule = { visible, clips: state.clips }
      let font = fonts.get(state.font)
      if (!font) fonts.set(state.font, (font = { text: "", rules: [], cursor: 0, valid: true }))
      font.text += text
      for (const _char of text) font.rules.push(rule)
      characterCount += text.length
      if (characterCount > 500000) throw new Error("PDF visibility character limit exceeded")
    }
  }
  if (stack.length || marked.length) throw new Error("Unbalanced PDF visibility state")

  // PDF.js may combine many showText operations into one item and insert spaces.
  // Verify the ENTIRE normalized per-font stream before trusting any association.
  // A mismatch is unknown, not permission to pick the nearest duplicate string.
  const extracted = new Map()
  const nonAdditiveFonts = new Set()
  for (const item of textContent.items) {
    if (typeof item.str !== "string") continue
    if ([...item.str].map(normalize).join("") !== normalize(item.str))
      nonAdditiveFonts.add(item.fontName)
    extracted.set(item.fontName, (extracted.get(item.fontName) || "") + normalize(item.str))
  }
  const unmatchedFonts = []
  for (const [name, text] of extracted) {
    const font = fonts.get(name)
    if (!font || font.text !== text || nonAdditiveFonts.has(name)) {
      if (font) font.valid = false
      if (text) unmatchedFonts.push(name)
    }
  }
  const items = textContent.items
    .filter((item) => typeof item.str === "string")
    .map((item) => {
      const font = fonts.get(item.fontName)
      if (!font?.valid) return { text: item.str, rules: null }
      const rules = []
      for (const char of item.str) {
        const normalized = normalize(char)
        const charRules = font.rules.slice(font.cursor, font.cursor + [...normalized].length)
        font.cursor += [...normalized].length
        // Offsets supplied by DOM Range and the matcher are UTF-16, not code points.
        for (let unit = 0; unit < char.length; unit++) rules.push(charRules)
      }
      return { text: item.str, rules }
    })
  return { items, unmatchedFonts }
}

// Convex clipping works for transformed/nested Form BBoxes, including rotation.
export function intersectConvexPolygons(subject, clip) {
  let result = subject
  const area = clip.reduce((sum, p, i) => {
    const q = clip[(i + 1) % clip.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0)
  const direction = area >= 0 ? 1 : -1
  if (Math.abs(area) < 1e-7) return []
  for (let i = 0; i < clip.length && result.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length]
    const side = (p) => direction * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    const input = result
    result = []
    let previous = input.at(-1),
      previousSide = side(previous)
    for (const point of input) {
      const pointSide = side(point)
      if (pointSide >= 0 !== previousSide >= 0) {
        const t = previousSide / (previousSide - pointSide)
        result.push([
          previous[0] + t * (point[0] - previous[0]),
          previous[1] + t * (point[1] - previous[1]),
        ])
      }
      if (pointSide >= 0) result.push(point)
      previous = point
      previousSide = pointSide
    }
  }
  return result
}

export function clipTextMatch(item, start, end, bounds, viewportTransform) {
  if (!item?.rules || start < 0 || end <= start || end > item.rules.length) return null
  const rules = item.rules.slice(start, end).flat()
  if (!rules.length || rules.some((rule) => !rule.visible)) return null
  const clips = [...new Set(rules.flatMap((rule) => rule.clips))].map((polygon) =>
    polygon.map((p) => transformPoint(viewportTransform, p)),
  )
  let polygon = [
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.right, bounds.bottom],
    [bounds.left, bounds.bottom],
  ]
  for (const clip of clips) polygon = intersectConvexPolygons(polygon, clip)
  if (polygon.length < 3) return null
  const clipped = {
    left: Math.min(...polygon.map((p) => p[0])),
    top: Math.min(...polygon.map((p) => p[1])),
    right: Math.max(...polygon.map((p) => p[0])),
    bottom: Math.max(...polygon.map((p) => p[1])),
  }
  if (clipped.right - clipped.left < 0.5 || clipped.bottom - clipped.top < 0.5) return null
  return { bounds: clipped, polygon, clips }
}

export function pointInConvexPolygon(polygon, point) {
  let direction = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length]
    const side = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
    if (Math.abs(side) < 1e-7) continue
    const sign = Math.sign(side)
    if (direction && direction !== sign) return false
    direction = sign
  }
  return polygon.length >= 3
}
