// Turns ```vega-lite code blocks into interactive charts. The chart module and the
// vendored Vega builds load only on pages that have such a block; see
// quartz/static/charts/vega-charts.js.
const CHART_BLOCK = 'pre > code[data-language="vega-lite"], pre > code.language-vega-lite'
const CHART_MODULE = "/static/charts/vega-charts.js?v=2"

document.addEventListener("nav", async () => {
  if (!document.querySelector(CHART_BLOCK)) return
  const moduleUrl: string = CHART_MODULE
  const { mountCharts } = await import(moduleUrl)
  window.addCleanup(mountCharts(document))
})
