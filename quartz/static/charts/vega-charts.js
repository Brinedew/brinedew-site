// Interactive charts written as ```vega-lite code blocks in notes.
//
// A note carries the chart as a Vega-Lite spec (https://vega.github.io/vega-lite/),
// sliders included (params bound to range inputs), so Obsidian shows the source and
// the site shows the chart. This module replaces each block with the rendered chart,
// loads the vendored Vega builds only when a chart is near the viewport, takes its
// colours and font from the site theme, and redraws on theme toggles and on resizes
// that cross the phone breakpoint, keeping the reader's slider positions.
//
// Theme hooks for specs: mark styles "observed", "observed-label", "model",
// "model-point", "model-label", "alt", "alt-label" and "guide". The spec's top-level
// "description" becomes the figure caption.

const VENDOR = "/static/vendor/vega"
const VERSION = "6.4.0-6.5.0-7.3.0"
const NARROW = 560
const BLOCK_SELECTOR = 'pre > code[data-language="vega-lite"], pre > code.language-vega-lite'

let librariesPromise = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `${src}?v=${VERSION}`
    script.async = false
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`could not load ${src}`))
    document.head.appendChild(script)
  })
}

function loadLibraries() {
  if (window.vegaEmbed) return Promise.resolve(window.vegaEmbed)
  librariesPromise ??= loadScript(`${VENDOR}/vega.min.js`)
    .then(() => loadScript(`${VENDOR}/vega-lite.min.js`))
    .then(() => loadScript(`${VENDOR}/vega-embed.min.js`))
    .then(() => window.vegaEmbed)
  return librariesPromise
}

// Vega parses colours with d3-color, which does not read oklch(); resolve every
// theme colour to rgb through a 1x1 canvas.
function resolveColor(cssValue) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  ctx.fillStyle = "#000"
  ctx.fillStyle = cssValue
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `rgb(${r}, ${g}, ${b})`
}

function themeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return resolveColor(value || fallback)
}

function themeConfig() {
  const text = themeColor("--darkgray", "#444")
  const muted = themeColor("--gray", "#888")
  const faint = themeColor("--lightgray", "#ddd")
  const accent = themeColor("--accent", "teal")
  const alt = themeColor("--secondary", "#864")
  const font = getComputedStyle(document.body).fontFamily
  return {
    background: null,
    font,
    view: { stroke: null },
    padding: { left: 4, right: 12, top: 8, bottom: 4 },
    axis: {
      labelColor: text,
      titleColor: text,
      labelFont: font,
      titleFont: font,
      labelFontSize: 13,
      titleFontSize: 13,
      titleFontWeight: "normal",
      titlePadding: 10,
      gridColor: faint,
      gridOpacity: 0.6,
      domainColor: muted,
      tickColor: muted,
    },
    text: { font, fontSize: 13 },
    style: {
      observed: { color: muted, opacity: 0.75 },
      "observed-label": { color: muted, fontSize: 13 },
      model: { color: accent, strokeWidth: 2.75 },
      "model-point": { color: accent, opacity: 1 },
      "model-label": { color: accent, fontSize: 13, fontWeight: 600 },
      alt: { color: alt, strokeWidth: 2.25, strokeDash: [6, 4] },
      "alt-label": { color: alt, fontSize: 13, fontWeight: 600 },
      guide: { color: muted, strokeDash: [3, 3], opacity: 0.8 },
    },
  }
}

// Vega-Lite cannot size concatenated views to their container, so the module sets
// panel widths from the chart's own width and stacks side-by-side panels on phones.
function fitToWidth(spec, width) {
  const fitted = structuredClone(spec)
  const axisAllowance = 78
  if (Array.isArray(fitted.hconcat) && width < NARROW) {
    fitted.vconcat = fitted.hconcat
    delete fitted.hconcat
  }
  if (Array.isArray(fitted.hconcat)) {
    const panel = Math.floor(
      (width - fitted.hconcat.length * axisAllowance) / fitted.hconcat.length,
    )
    for (const view of fitted.hconcat) view.width = Math.max(140, panel)
  } else if (Array.isArray(fitted.vconcat)) {
    for (const view of fitted.vconcat) view.width = Math.max(200, width - axisAllowance)
  } else {
    fitted.width = Math.max(200, width - axisAllowance)
  }
  return fitted
}

function withParamValues(spec, values) {
  if (!values || !Array.isArray(spec.params)) return spec
  return {
    ...spec,
    params: spec.params.map((param) =>
      param.name in values ? { ...param, value: values[param.name] } : param,
    ),
  }
}

class Chart {
  constructor(container, spec) {
    this.container = container
    this.spec = spec
    this.view = null
    this.values = null
    this.layoutWidth = 0
    this.rendering = null
  }

  currentValues() {
    if (!this.view || !Array.isArray(this.spec.params)) return this.values
    const values = {}
    for (const param of this.spec.params) {
      if (param.bind) values[param.name] = this.view.signal(param.name)
    }
    return values
  }

  async render() {
    // A container without width yet (a collapsed callout, a hidden tab) would lay
    // the panels out at their minimum; the resize observer renders it once it opens.
    if (this.container.clientWidth < 120) return
    this.rendering ??= this.draw().finally(() => (this.rendering = null))
    return this.rendering
  }

  async draw() {
    const vegaEmbed = await loadLibraries()
    this.values = this.currentValues()
    this.view?.finalize()
    this.layoutWidth = this.container.clientWidth
    const spec = withParamValues(fitToWidth(this.spec, this.layoutWidth), this.values)
    const result = await vegaEmbed(this.container, spec, {
      actions: false,
      renderer: "svg",
      config: themeConfig(),
    })
    this.view = result.view
  }

  resized() {
    const width = this.container.clientWidth
    if (Math.abs(width - this.layoutWidth) < 24) return
    void this.render()
  }

  destroy() {
    this.view?.finalize()
    this.view = null
  }
}

function replaceBlock(code) {
  let spec
  try {
    spec = JSON.parse(code.textContent ?? "")
  } catch (error) {
    console.warn("vega-lite block is not valid JSON", error)
    return null
  }
  const pre = code.closest("pre")
  const outer = pre?.closest("figure[data-rehype-pretty-code-figure]") ?? pre
  const figure = document.createElement("figure")
  figure.className = "vega-figure image-with-caption"
  const container = document.createElement("div")
  container.className = "vega-chart"
  figure.append(container)
  if (typeof spec.description === "string" && spec.description) {
    const caption = document.createElement("figcaption")
    caption.textContent = spec.description
    figure.append(caption)
  }
  delete spec.description
  outer.replaceWith(figure)
  return new Chart(container, spec)
}

export function mountCharts(root = document) {
  const charts = [...root.querySelectorAll(BLOCK_SELECTOR)].map(replaceBlock).filter(Boolean)
  if (charts.length === 0) return () => {}

  const pending = new Map(charts.map((chart) => [chart.container, chart]))
  const visible = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const chart = pending.get(entry.target)
        if (!chart) continue
        pending.delete(entry.target)
        visible.unobserve(entry.target)
        chart.render().catch((error) => console.warn("chart failed to render", error))
      }
    },
    { rootMargin: "600px 0px" },
  )
  for (const chart of charts) visible.observe(chart.container)

  const sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const chart = charts.find((candidate) => candidate.container === entry.target)
      if (!chart || pending.has(chart.container)) continue
      if (chart.view) chart.resized()
      else void chart.render()
    }
  })
  for (const chart of charts) sizes.observe(chart.container)

  const onTheme = () => {
    for (const chart of charts) if (chart.view) void chart.render()
  }
  document.addEventListener("themechange", onTheme)

  return () => {
    visible.disconnect()
    sizes.disconnect()
    document.removeEventListener("themechange", onTheme)
    for (const chart of charts) chart.destroy()
  }
}
