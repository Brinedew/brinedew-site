;(function () {
  "use strict"

  // Canonical Mol* configuration and stylization shared across:
  // - Live game (quartz/static/geneguessr/app.js)
  // - Discord render page (workers/discord.js)
  // - Admin panels (workers/admin-html.js, workers/admin-v2-html.js)

  // PDBeMolstarPlugin is provided by the `pdbe-molstar` package.
  // Note: `pdbe-molstar` versions are NOT the same as upstream `molstar` versions.
  const MOLSTAR_VERSION = "3.8.0"
  const MOLSTAR_FALLBACK_VERSION = "3.7.1"

  // In worker-served contexts (geneguessr subdomain + workers.dev), proxy Mol* assets through the
  // Worker so the page does not depend on the client being able to reach jsDelivr directly.
  // In site-served contexts (brinedew.bio), load directly from jsDelivr.
  const SHOULD_PROXY_MOLSTAR_ASSETS = (() => {
    try {
      const host = String(globalThis.location?.hostname || "").toLowerCase()
      return host === "geneguessr.brinedew.bio" || host.endsWith(".workers.dev")
    } catch {
      return false
    }
  })()

  const MOLSTAR_SCRIPT_URL = SHOULD_PROXY_MOLSTAR_ASSETS
    ? `/static/vendor/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar-plugin.js`
    : `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar-plugin.js`
  const MOLSTAR_FALLBACK_SCRIPT_URL = SHOULD_PROXY_MOLSTAR_ASSETS
    ? `/static/vendor/pdbe-molstar@${MOLSTAR_FALLBACK_VERSION}/build/pdbe-molstar-plugin.js`
    : `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_FALLBACK_VERSION}/build/pdbe-molstar-plugin.js`
  const MOLSTAR_CSS_URL = SHOULD_PROXY_MOLSTAR_ASSETS
    ? `/static/vendor/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar.css`
    : `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar.css`
  const MOLSTAR_PRECONNECT_URL = "https://cdn.jsdelivr.net"

  const DEFAULT_GRAPHICS_SETTINGS = {
    version: 2,
    camera: { mode: "perspective" },
    lighting: { enabled: true, exposure: 1, lights: [] },
    occlusion: { enabled: false, samples: 64, radius: 6, bias: 0.8, blurKernelSize: 7, resolutionScale: 1 },
    antialiasing: { mode: "fxaa", edgeThresholdMin: 0.125, edgeThresholdMax: 0.25, iterations: 2, subpixelQuality: 0.75 },
    fog: { enabled: true, intensity: 0.5, color: "#110c0a" },
    outline: { enabled: true, threshold: 0.33, scale: 1, color: "#110c0a" },
    extras: { hideAxes: true, disableMarking: true },
  }

  let molstarLoaderPromise = null
  let molstarCssLoaded = false
  let molstarPreconnectAdded = false
  let molstarUiCssInjected = false
  let cachedGraphicsSettings = null
  let cachedGraphicsSettingsPromise = null

  function numericOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
  }

  function parseColorString(value, fallback) {
    if (!value) return fallback
    if (String(value).trim().toLowerCase() === "transparent") return fallback
    const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i)
    if (!match) return fallback
    const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1
    if (Number.isFinite(alpha) && alpha <= 0) return fallback
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
    }
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== "string") return null
    const cleaned = hex.trim().replace(/^#/, "")
    if (cleaned.length !== 6) return null
    const r = parseInt(cleaned.slice(0, 2), 16)
    const g = parseInt(cleaned.slice(2, 4), 16)
    const b = parseInt(cleaned.slice(4, 6), 16)
    if (![r, g, b].every((n) => Number.isFinite(n))) return null
    return { r, g, b }
  }

  function toMolstarColor(rgb) {
    const r = Math.max(0, Math.min(255, Math.round(numericOr(rgb && rgb.r, 0))))
    const g = Math.max(0, Math.min(255, Math.round(numericOr(rgb && rgb.g, 0))))
    const b = Math.max(0, Math.min(255, Math.round(numericOr(rgb && rgb.b, 0))))
    return (r << 16) | (g << 8) | b
  }

  function resolveViewerColors(container) {
    // Single source of truth: if the site wants a different background (e.g. light mode),
    // it should set a non-transparent background on the container. Otherwise we default to
    // the live site's dark background (brown).
    const defaultDarkBg = { r: 17, g: 12, b: 10 }
    const defaultLightBg = { r: 248, g: 241, b: 231 }
    const defaultBg = defaultDarkBg

    if (!container) {
      return { background: defaultBg, outline: defaultBg }
    }
    try {
      const style = window.getComputedStyle(container)
      const bg = parseColorString(style.backgroundColor, null) || defaultBg
      const outline = parseColorString(style.color, null) || bg
      return { background: bg, outline }
    } catch {
      return { background: defaultBg, outline: defaultBg }
    }
  }

  function safeApplyCanvasProps(viewer, props, label) {
    try {
      if (!viewer || !viewer.plugin || !viewer.plugin.canvas3d) {
        return false
      }
      // Mol* `setProps` expects nested groups (renderer/postprocessing/etc.) to remain well-formed.
      // In particular, passing a partial `renderer` object too early can wipe required internal
      // sub-props (e.g. multisampling settings) and cause render-loop errors. Always merge into the
      // current props and avoid applying group patches before the group exists.
      const current = viewer.plugin.canvas3d.props || {}
      const next = { ...current, ...props }
      const mergeGroup = (key) => {
        if (!Object.prototype.hasOwnProperty.call(props || {}, key)) return
        const patch = props && props[key]
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) return
        const base = current && current[key]
        if (!base) return
        if (base && typeof base === "object" && !Array.isArray(base)) {
          next[key] = { ...base, ...patch }
        }
      }
      mergeGroup("renderer")
      mergeGroup("camera")
      mergeGroup("cameraFog")
      mergeGroup("marking")
      mergeGroup("postprocessing")
      mergeGroup("trackball")
      viewer.plugin.canvas3d.setProps(next)
      return true
    } catch (err) {
      if (label) {
        console.warn("[MolstarShared] Failed to apply canvas props (" + label + ")", err)
      }
      return false
    }
  }

  function hideMolstarPanels(viewer) {
    try {
      viewer.plugin && viewer.plugin.layout && viewer.plugin.layout.setProps
        ? viewer.plugin.layout.setProps({ isExpanded: false, showControls: false })
        : null
    } catch (err) {
      console.warn("[MolstarShared] Unable to hide Mol* layout controls", err)
    }
  }

  function suppressViewerInteractivity(viewer) {
    try {
      viewer.plugin && viewer.plugin.managers && viewer.plugin.managers.interactivity
        ? viewer.plugin.managers.interactivity.setProps({ granularity: "element", maxFps: 0 })
        : null
      if (viewer.plugin && viewer.plugin.managers && viewer.plugin.managers.interactivity) {
        const m = viewer.plugin.managers.interactivity
        m.lociHighlights && m.lociHighlights.setProps ? m.lociHighlights.setProps({ enabled: false }) : null
        m.lociSelects && m.lociSelects.setProps ? m.lociSelects.setProps({ enabled: false }) : null
      }
    } catch (err) {
      console.warn("[MolstarShared] Unable to set interactivity props", err)
    }

    if (!(viewer && viewer.plugin && viewer.plugin.behaviors && viewer.plugin.behaviors.interaction)) {
      return
    }

    try {
      const hoverSub = viewer.plugin.behaviors.interaction.hover.subscribe(function () {
        try {
          const m = viewer.plugin && viewer.plugin.managers && viewer.plugin.managers.interactivity
          m && m.lociHighlights && m.lociHighlights.clearHighlights
            ? m.lociHighlights.clearHighlights(true)
            : null
        } catch {}
      })
      const clickSub = viewer.plugin.behaviors.interaction.click.subscribe(function () {
        try {
          const m = viewer.plugin && viewer.plugin.managers && viewer.plugin.managers.interactivity
          m && m.lociSelects && m.lociSelects.deselectAll ? m.lociSelects.deselectAll() : null
          m && m.lociHighlights && m.lociHighlights.clearHighlights
            ? m.lociHighlights.clearHighlights(true)
            : null
        } catch {}
      })
      if (!viewer._interactivityGuards) {
        viewer._interactivityGuards = { hoverSub, clickSub }
      }
    } catch (err) {
      console.warn("[MolstarShared] Unable to attach interactivity guards", err)
    }
  }

  function applyViewerThemeColors(viewer, container) {
    const colors = resolveViewerColors(container)

    // Single source of truth: we read the site's intended background from CSS and apply it to the
    // Mol* renderer. This keeps all consumers (game, admin, discord) consistent without hardcoding.
    // `safeApplyCanvasProps` merges into existing renderer props so we do not clobber required sub-props.
    try {
      safeApplyCanvasProps(
        viewer,
        {
          renderer: {
            backgroundColor: toMolstarColor(colors.background),
            ambientColor: toMolstarColor(colors.background),
            ambientIntensity: 0.55,
            interiorDarkening: 0,
          },
        },
        "theme background & ambient",
      )
    } catch {}

    return colors
  }

  async function waitForCanvasPropGroups(viewer, groups, timeoutMs) {
    const timeout = numericOr(timeoutMs, 2000)
    const required = Array.isArray(groups) ? groups : []
    const start = Date.now()
    while (Date.now() - start < timeout) {
      try {
        const props = viewer && viewer.plugin && viewer.plugin.canvas3d && viewer.plugin.canvas3d.props
        if (props && required.every((k) => props[k])) {
          return true
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  async function applyViewerStylizationProfile(viewer, container, options) {
    const graphicsSettings = (options && options.graphicsSettings) || DEFAULT_GRAPHICS_SETTINGS
    const computedDebug = {
      hideAxes: !(graphicsSettings.extras && graphicsSettings.extras.hideAxes === false),
      orthographic: graphicsSettings.camera && graphicsSettings.camera.mode === "orthographic",
      backgroundColor: true,
      lighting: !(graphicsSettings.lighting && graphicsSettings.lighting.enabled === false),
      occlusion: !(graphicsSettings.occlusion && graphicsSettings.occlusion.enabled === false),
      antialiasing: graphicsSettings.antialiasing && graphicsSettings.antialiasing.mode === "fxaa",
      fog: !(graphicsSettings.fog && graphicsSettings.fog.enabled === false),
      outline: !(graphicsSettings.outline && graphicsSettings.outline.enabled === false),
      disableMarking: !(graphicsSettings.extras && graphicsSettings.extras.disableMarking === false),
    }
    const debug = Object.assign(computedDebug, (options && options.debugStylization) || {})
    try {
      const params = new URLSearchParams(globalThis.location && globalThis.location.search ? globalThis.location.search : "")
      if (params.has("molstar_debug")) {
        Object.keys(debug).forEach((key) => {
          if (params.has("no_" + key)) debug[key] = false
          if (params.has("with_" + key)) debug[key] = true
        })
      }
    } catch {}

    hideMolstarPanels(viewer)
    if (options && options.interactive === false) {
      suppressViewerInteractivity(viewer)
    }
    await waitForCanvasPropGroups(viewer, ["renderer", "postprocessing", "camera", "marking"], 2500)
    applyViewerThemeColors(viewer, container)

    const extras = (graphicsSettings && graphicsSettings.extras) || {}
    const camera = (graphicsSettings && graphicsSettings.camera) || {}
    const lighting = (graphicsSettings && graphicsSettings.lighting) || {}
    const occlusion = (graphicsSettings && graphicsSettings.occlusion) || {}
    const antialiasing = (graphicsSettings && graphicsSettings.antialiasing) || {}
    const fog = (graphicsSettings && graphicsSettings.fog) || {}
    const outline = (graphicsSettings && graphicsSettings.outline) || {}

    const steps = [
      {
        name: "hideAxes",
        enabled: Boolean(debug.hideAxes),
        fn: function () {
          safeApplyCanvasProps(viewer, { camera: { helper: { axes: { name: "off" } } } }, "axes")
        },
        delay: 100,
      },
      {
        name: "cameraMode",
        enabled: Boolean(debug.orthographic),
        fn: function () {
          if (camera && camera.mode === "orthographic") {
            safeApplyCanvasProps(viewer, { camera: { mode: "orthographic" } }, "orthographic camera")
          }
        },
        delay: 150,
      },
      {
        name: "backgroundColor",
        enabled: Boolean(debug.backgroundColor),
        fn: function () {
          applyViewerThemeColors(viewer, container)
        },
        delay: 150,
      },
      {
        name: "lighting",
        enabled: Boolean(debug.lighting),
        fn: function () {
          if (!lighting || lighting.enabled === false) {
            safeApplyCanvasProps(viewer, { renderer: { light: [] } }, "lighting disabled")
            return
          }
          const exposure = numericOr(lighting.exposure, 1)
          const lights = Array.isArray(lighting.lights)
            ? lighting.lights.map(function (light, index) {
                const rgb = hexToRgb(light && light.color) || { r: 255, g: 255, b: 255 }
                return {
                  inclination: numericOr(light && light.inclination, 160),
                  azimuth: numericOr(light && light.azimuth, index * 120),
                  color: toMolstarColor(rgb),
                  intensity: numericOr(light && light.intensity, 1) * exposure,
                }
              })
            : []
          if (lights.length) {
            safeApplyCanvasProps(viewer, { renderer: { light: lights } }, "custom lighting")
          }
        },
        delay: 200,
      },
      {
        name: "occlusion",
        enabled: Boolean(debug.occlusion),
        fn: function () {
          const pp = viewer && viewer.plugin && viewer.plugin.canvas3d && viewer.plugin.canvas3d.props && viewer.plugin.canvas3d.props.postprocessing
          const baseOcclusion = pp && pp.occlusion ? pp.occlusion : { name: "off", params: {} }
          const baseParams =
            baseOcclusion && baseOcclusion.params && typeof baseOcclusion.params === "object" ? baseOcclusion.params : {}
          if (!occlusion || occlusion.enabled === false) {
            safeApplyCanvasProps(
              viewer,
              {
                postprocessing: {
                  ...(pp || {}),
                  occlusion: { ...baseOcclusion, name: "off", params: baseParams },
                },
              },
              "occlusion off",
            )
            return
          }
          safeApplyCanvasProps(
            viewer,
            {
              postprocessing: {
                ...(pp || {}),
                occlusion: {
                  ...baseOcclusion,
                  name: "on",
                  params: {
                    ...baseParams,
                    samples: numericOr(occlusion.samples, 64),
                    radius: numericOr(occlusion.radius, 6),
                    bias: numericOr(occlusion.bias, 0.8),
                    blurKernelSize: numericOr(occlusion.blurKernelSize, 7),
                    resolutionScale: numericOr(occlusion.resolutionScale, 1),
                  },
                },
              },
            },
            "occlusion on",
          )
        },
        delay: 200,
      },
      {
        name: "antialiasing",
        enabled: Boolean(debug.antialiasing),
        fn: function () {
          if (!antialiasing || antialiasing.mode !== "fxaa") {
            safeApplyCanvasProps(viewer, { postprocessing: { antialiasing: { name: "off" } } }, "aa off")
            return
          }
          safeApplyCanvasProps(
            viewer,
            {
              postprocessing: {
                antialiasing: {
                  name: "fxaa",
                  params: {
                    edgeThresholdMin: numericOr(antialiasing.edgeThresholdMin, 0.125),
                    edgeThresholdMax: numericOr(antialiasing.edgeThresholdMax, 0.25),
                    iterations: numericOr(antialiasing.iterations, 2),
                    subpixelQuality: numericOr(antialiasing.subpixelQuality, 0.75),
                  },
                },
              },
            },
            "aa fxaa",
          )
        },
        delay: 150,
      },
      {
        name: "fog",
        enabled: Boolean(debug.fog),
        fn: function () {
          if (!fog || fog.enabled === false) {
            safeApplyCanvasProps(viewer, { cameraFog: { name: "off" } }, "fog off")
            return
          }
          const fogColor = hexToRgb(fog.color) || resolveViewerColors(container).background
          const near = numericOr(fog.near, null)
          const far = numericOr(fog.far, null)
          safeApplyCanvasProps(
            viewer,
            {
              cameraFog: {
                name: "on",
                params: {
                  intensity: numericOr(fog.intensity, 0.5),
                  color: toMolstarColor(fogColor),
                  ...(near !== null ? { near } : {}),
                  ...(far !== null ? { far } : {}),
                },
              },
            },
            "fog on",
          )
        },
        delay: 150,
      },
      {
        name: "outline",
        enabled: Boolean(debug.outline),
        fn: function () {
          if (!outline || outline.enabled === false) {
            safeApplyCanvasProps(viewer, { postprocessing: { outline: { name: "off" } } }, "outline off")
            return
          }
          const outlineColor = hexToRgb(outline.color) || resolveViewerColors(container).outline
          safeApplyCanvasProps(
            viewer,
            {
              postprocessing: {
                outline: {
                  name: "on",
                  params: {
                    scale: numericOr(outline.scale, 1),
                    threshold: numericOr(outline.threshold, 0.33),
                    color: toMolstarColor(outlineColor),
                  },
                },
              },
            },
            "outline on",
          )
        },
        delay: 150,
      },
      {
        name: "disableMarking",
        enabled: Boolean(debug.disableMarking),
        fn: function () {
          safeApplyCanvasProps(
            viewer,
            {
              marking: { enabled: false, edgeScale: 0, ghostEdgeStrength: 0, innerEdgeFactor: 0 },
            },
            "marking off",
          )
        },
        delay: 100,
      },
    ]

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!step.enabled) continue
      await new Promise((resolve) => setTimeout(resolve, step.delay))
      step.fn()
    }
  }

  function addMolstarPreconnectOnce() {
    if (molstarPreconnectAdded) return
    try {
      const link = document.createElement("link")
      link.rel = "preconnect"
      link.href = MOLSTAR_PRECONNECT_URL
      document.head.appendChild(link)
    } catch {}
    molstarPreconnectAdded = true
  }

  function appendMolstarCssOnce() {
    if (molstarCssLoaded) return
    try {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = MOLSTAR_CSS_URL
      link.onload = function () {
        molstarCssLoaded = true
      }
      link.onerror = function () {
        console.warn("[MolstarShared] Failed to load Mol* CSS from jsDelivr")
      }
      document.head.appendChild(link)
      molstarCssLoaded = true
    } catch {}
  }

  function ensureMolstarUiSuppressionCssOnce() {
    if (molstarUiCssInjected) return
    try {
      const styleId = "gg-molstar-ui-suppression"
      if (document.getElementById(styleId)) {
        molstarUiCssInjected = true
        return
      }
      const style = document.createElement("style")
      style.id = styleId
      style.type = "text/css"
      style.textContent = `
[data-gg-molstar-root] .msp-viewport-controls,
[data-gg-molstar-root] .msp-viewport-controls * {
  display: none !important;
}

[data-gg-molstar-root] .msp-viewport-info,
[data-gg-molstar-root] .msp-hover-hint,
[data-gg-molstar-root] .msp-controls-wrapper,
[data-gg-molstar-root] .msp-top-left-controls,
[data-gg-molstar-root] .msp-top-center-controls,
[data-gg-molstar-root] .msp-bottom-left-controls,
[data-gg-molstar-root] .msp-bottom-center-controls,
[data-gg-molstar-root] .msp-highlight-info,
[data-gg-molstar-root] .msp-highlight-info-wrapper,
[data-gg-molstar-root] .msp-sequence-wrapper {
  display: none !important;
  pointer-events: none !important;
}
      `.trim()
      document.head.appendChild(style)
      molstarUiCssInjected = true
    } catch {}
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = src
      script.async = true
      script.onload = () => resolve()
      script.onerror = (err) => reject(err || new Error("Failed to load script " + src))
      document.head.appendChild(script)
    })
  }

  function ensureMolstarAssets() {
    addMolstarPreconnectOnce()
    appendMolstarCssOnce()
    ensureMolstarUiSuppressionCssOnce()
    if (window.PDBeMolstarPlugin) {
      return Promise.resolve()
    }
    if (!molstarLoaderPromise) {
      molstarLoaderPromise = (async function () {
        try {
          await loadScriptOnce(MOLSTAR_SCRIPT_URL)
        } catch (primaryErr) {
          console.warn("[MolstarShared] Primary Mol* CDN load failed, trying fallback", primaryErr)
          await loadScriptOnce(MOLSTAR_FALLBACK_SCRIPT_URL)
        }
        if (!window.PDBeMolstarPlugin) {
          throw new Error("PDBeMolstarPlugin unavailable after loading scripts")
        }
      })().catch((err) => {
        molstarLoaderPromise = null
        throw err
      })
    }
    return molstarLoaderPromise
  }

  function normalizeGraphicsSettings(raw) {
    if (!raw || typeof raw !== "object") return JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS))
    // Keep this intentionally conservative: prefer defaults over trusting malformed payloads.
    const base = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS))
    const merged = Object.assign(base, raw)
    merged.camera = Object.assign({}, base.camera, raw.camera || {})
    merged.lighting = Object.assign({}, base.lighting, raw.lighting || {})
    merged.occlusion = Object.assign({}, base.occlusion, raw.occlusion || {})
    merged.antialiasing = Object.assign({}, base.antialiasing, raw.antialiasing || {})
    merged.fog = Object.assign({}, base.fog, raw.fog || {})
    merged.outline = Object.assign({}, base.outline, raw.outline || {})
    merged.extras = Object.assign({}, base.extras, raw.extras || {})
    return merged
  }

  function getGraphicsSettings(apiBase) {
    if (cachedGraphicsSettings) return Promise.resolve(cachedGraphicsSettings)
    if (cachedGraphicsSettingsPromise) return cachedGraphicsSettingsPromise
    const base = apiBase || ""
    const url = base.endsWith("/") ? base + "api/graphics-settings" : base + "/api/graphics-settings"
    cachedGraphicsSettingsPromise = fetch(url, { credentials: "include" })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((json) => {
        cachedGraphicsSettings = normalizeGraphicsSettings(json || null)
        return cachedGraphicsSettings
      })
      .catch(() => {
        cachedGraphicsSettings = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS))
        return cachedGraphicsSettings
      })
      .finally(() => {
        cachedGraphicsSettingsPromise = null
      })
    return cachedGraphicsSettingsPromise
  }

  function waitForLoadComplete(viewer, timeoutMs) {
    const timeout = numericOr(timeoutMs, 60000)
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (ok) => {
        if (settled) return
        settled = true
        resolve({ ok })
      }
      const timer = setTimeout(function () {
        done(false)
      }, timeout)

      try {
        if (viewer && viewer.events && viewer.events.loadComplete && viewer.events.loadComplete.subscribe) {
          viewer.events.loadComplete.subscribe(function () {
            clearTimeout(timer)
            done(true)
          })
        } else {
          // Best-effort fallback: give Mol* a moment.
          setTimeout(function () {
            clearTimeout(timer)
            done(true)
          }, 800)
        }
      } catch (err) {
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  async function initializeViewer(container, renderOptions, options) {
    if (!container) {
      throw new Error("Viewer container missing")
    }

    await ensureMolstarAssets()

    try {
      if (!options || options.showMolstarUi !== true) {
        container.setAttribute("data-gg-molstar-root", "1")
      } else {
        container.removeAttribute("data-gg-molstar-root")
      }
    } catch {}

    const viewer = new window.PDBeMolstarPlugin()
    const background = resolveViewerColors(container).background

    const canonicalRenderOptions = Object.assign(
      {
        hideControls: true,
        hideCanvasControls: [
          "expand",
          "controlToggle",
          "controlInfo",
          "selection",
          "animation",
          "trajectory",
          "screenshot",
          "reset",
        ],
        pdbeLink: false,
        visualStyle: "cartoon",
        lighting: "glossy",
        loadMaps: false,
        selectInteraction: false,
        lowPrecisionCoords: false,
        hideStructureSourceTooltip: true,
      },
      renderOptions || {},
    )

    if (!canonicalRenderOptions.bgColor && background) {
      canonicalRenderOptions.bgColor = { r: background.r, g: background.g, b: background.b }
    }

    await viewer.render(container, canonicalRenderOptions)

    try {
      const params = new URLSearchParams(globalThis.location && globalThis.location.search ? globalThis.location.search : "")
      if (params.has("molstar_debug")) {
        globalThis.__GeneguessrMolstarDebug = { viewer }
      }
    } catch {}

    const loadComplete = waitForLoadComplete(viewer, options && options.loadTimeoutMs)
    loadComplete.then(async function () {
      try {
        if (options && options.skipStylization) {
          return
        }
        const graphicsSettings =
          (options && options.graphicsSettings) ||
          (options && options.fetchGraphicsSettings === false ? DEFAULT_GRAPHICS_SETTINGS : await getGraphicsSettings(options && options.apiBase))
        await applyViewerStylizationProfile(viewer, container, {
          graphicsSettings,
          debugStylization: options && options.debugStylization,
          interactive: options && options.interactive,
        })
      } catch (err) {
        console.warn("[MolstarShared] Post-load stylization failed", err)
      }
    })

    return { viewer, loadComplete }
  }

  window.GeneguessrMolstar = {
    ensureMolstarAssets,
    getGraphicsSettings,
    applyViewerThemeColors,
    applyViewerStylizationProfile,
    initializeViewer,
  }
})()
