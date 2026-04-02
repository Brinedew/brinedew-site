;(function (global) {
  "use strict"

  var ICONO_SHARED_RUNTIME_VERSION = "20260321a"
  var forceSiteOwnership = !!(global && global.__iconoSiteOwnsSharedRuntime)
  var existingShared = global && global.IconoplasmCardShared ? global.IconoplasmCardShared : null
  var existingMeta =
    existingShared && existingShared.__meta && typeof existingShared.__meta === "object"
      ? existingShared.__meta
      : null
  var existingOwner = String((existingMeta && existingMeta.owner) || "")
    .trim()
    .toLowerCase()

  if (existingShared) {
    // Chesterton's fence: keep the duplicate-init guard, but make it ownership-aware.
    // The extension reuses this shared runtime on arbitrary pages, while the site must own it on
    // iconoplasm.brinedew.bio itself. If a stale extension/runtime copy arrives first, the site
    // must replace it instead of silently accepting drift forever.
    if (!forceSiteOwnership || existingOwner === "site") return
    if (typeof existingShared.__dispose === "function") {
      try {
        existingShared.__dispose()
      } catch (_error) {
        // Ignore stale-runtime cleanup failures and proceed with site takeover.
      }
    }
    try {
      delete global.IconoplasmCardShared
    } catch (_deleteError) {
      global.IconoplasmCardShared = null
    }
  }

  var ICONO_CHECK_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10.5 8.25 13.75 15 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  var ICONO_CROSS_ICON =
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 6 14 14M14 6 6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  var ICONO_ROUGH_LOOP_VIEWBOX_WIDTH = 132
  var ICONO_ROUGH_LOOP_VIEWBOX_HEIGHT = 34
  var iconoRoughLoopSerial = 0
  var ICONO_ROUGH_LOOP_STANDARD = {
    width: 116,
    height: 24,
    strokeWidth: 1.82,
    roughness: 1.62,
    bowing: 0.79,
    maxRandomnessOffset: 1.5,
    curveFitting: 0.82,
    curveStepCount: 9,
    widthMultiplier: 1.5,
    paddingCharWidth: 2,
    heightMultiplier: 2,
  }
  var ICONO_ROUGH_LOOP_INLINE_GENE = {
    strokeWidth: 1.56,
    roughness: 1.34,
    bowing: 0.62,
    maxRandomnessOffset: 1.08,
    curveFitting: 0.9,
    curveStepCount: 8,
    widthMultiplier: 1.16,
    // Fence: keep breathing room in the measurement preset, not in content.css.
    // The runtime rehydrates these loops from live text bounds, so CSS-only SVG
    // box tweaks get overwritten on the next pass and appear to do nothing.
    paddingCharWidth: 1.22,
    heightMultiplier: 1.24,
  }
  var ICONO_ROUGH_LOOP_PRESETS = {
    default: ICONO_ROUGH_LOOP_STANDARD,
    "vote-approve": ICONO_ROUGH_LOOP_STANDARD,
    "vote-reject": ICONO_ROUGH_LOOP_STANDARD,
    "category-transmembrane": ICONO_ROUGH_LOOP_STANDARD,
    "category-soluble": ICONO_ROUGH_LOOP_STANDARD,
    "alignment-oncogene": ICONO_ROUGH_LOOP_STANDARD,
    "alignment-tumor-suppressor": ICONO_ROUGH_LOOP_STANDARD,
    "inline-gene": ICONO_ROUGH_LOOP_INLINE_GENE,
  }

  function iconoPenLoopFallbackMarkup() {
    return (
      '<path d="M 8 18 C 8 10, 21 5, 65 5 C 108 5, 124 10, 124 17 C 124 24, 108 29, 66 29 C 22 29, 8 24, 8 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 12 21 C 15 13, 29 10, 66 10 C 101 10, 114 12, 119 17" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-dasharray="2.5 4"/>'
    )
  }

  function iconoPenLoopSvg(className, presetName) {
    iconoRoughLoopSerial += 1
    var loopSeed = 9001 + iconoRoughLoopSerial * 97
    return (
      '<svg class="' +
      String(className || "icono-pen-loop") +
      '" data-icono-rough-loop="true" data-icono-rough-preset="' +
      escapeHtml(String(presetName || "default")) +
      '" data-icono-rough-seed="' +
      String(loopSeed) +
      '" viewBox="0 0 132 34" preserveAspectRatio="none" aria-hidden="true">' +
      iconoPenLoopFallbackMarkup() +
      "</svg>"
    )
  }

  function iconoResolveRough() {
    return global && global.rough && typeof global.rough.svg === "function" ? global.rough : null
  }

  function iconoRoughLoopPreset(name) {
    var key = String(name || "default")
      .trim()
      .toLowerCase()
    var preset = ICONO_ROUGH_LOOP_PRESETS[key] || ICONO_ROUGH_LOOP_PRESETS.default
    var base = ICONO_ROUGH_LOOP_PRESETS.default
    var resolved = {}
    for (var prop in base) resolved[prop] = base[prop]
    for (var presetProp in preset) resolved[presetProp] = preset[presetProp]
    return resolved
  }

  function iconoRoughLoopTarget(loopSvg) {
    if (!loopSvg || !loopSvg.parentElement) return null
    var target = loopSvg.parentElement.querySelector("[data-icono-rough-copy]")
    return target || null
  }

  function iconoMeasureRoughLoop(loopSvg, preset) {
    var target = iconoRoughLoopTarget(loopSvg)
    var host = loopSvg && loopSvg.parentElement ? loopSvg.parentElement : null
    if (!target || !host || typeof target.getBoundingClientRect !== "function") return null
    var hostRect = host.getBoundingClientRect()
    var targetRect = target.getBoundingClientRect()
    var text = String(target.textContent || "").trim()
    var charCount = Math.max(text.length, 1)
    var textWidth = Math.max(targetRect.width, 1)
    var textHeight = Math.max(targetRect.height, 1)
    var averageCharWidth = textWidth / charCount
    var paddedWidth = textWidth + averageCharWidth * Number(preset.paddingCharWidth || 2)
    var measuredWidth = Math.max(textWidth * Number(preset.widthMultiplier || 1.5), paddedWidth)
    var measuredHeight = textHeight * Number(preset.heightMultiplier || 2)
    var left = targetRect.left - hostRect.left + (textWidth - measuredWidth) / 2
    var top = targetRect.top - hostRect.top + (textHeight - measuredHeight) / 2
    return {
      width: measuredWidth,
      height: measuredHeight,
      left: left,
      top: top,
    }
  }

  function iconoRenderRoughLoop(loopSvg, force) {
    if (!loopSvg) return true
    if (!force && loopSvg.getAttribute("data-icono-rough-ready") === "true") return true
    var roughImpl = iconoResolveRough()
    if (!roughImpl) return false
    var preset = iconoRoughLoopPreset(loopSvg.getAttribute("data-icono-rough-preset"))
    var seed = Number(loopSvg.getAttribute("data-icono-rough-seed"))
    var measurement = iconoMeasureRoughLoop(loopSvg, preset)
    var roughSvg = roughImpl.svg(loopSvg)
    loopSvg.setAttribute("overflow", "visible")
    loopSvg.style.overflow = "visible"
    if (measurement) {
      loopSvg.setAttribute("viewBox", "0 0 " + measurement.width + " " + measurement.height)
      loopSvg.style.left = measurement.left + "px"
      loopSvg.style.top = measurement.top + "px"
      loopSvg.style.width = measurement.width + "px"
      loopSvg.style.height = measurement.height + "px"
    }
    while (loopSvg.firstChild) loopSvg.removeChild(loopSvg.firstChild)
    var ellipseWidth = measurement ? measurement.width : preset.width
    var ellipseHeight = measurement ? measurement.height : preset.height * 2
    var ellipse = roughSvg.ellipse(
      ellipseWidth / 2,
      ellipseHeight / 2,
      ellipseWidth,
      ellipseHeight,
      {
        stroke: "currentColor",
        fill: "none",
        seed: Number.isFinite(seed) ? seed : undefined,
        strokeWidth: preset.strokeWidth,
        roughness: preset.roughness,
        bowing: preset.bowing,
        maxRandomnessOffset: preset.maxRandomnessOffset,
        curveFitting: preset.curveFitting,
        curveStepCount: preset.curveStepCount,
        disableMultiStroke: !!preset.disableMultiStroke,
      },
    )
    ellipse.setAttribute("fill", "none")
    ellipse.setAttribute("stroke-linecap", "round")
    ellipse.setAttribute("stroke-linejoin", "round")
    ellipse.setAttribute("vector-effect", "non-scaling-stroke")
    ellipse.setAttribute("overflow", "visible")
    loopSvg.appendChild(ellipse)
    loopSvg.setAttribute("data-icono-rough-ready", "true")
    return true
  }

  function iconoCollectRoughLoops(root, force) {
    var nodes = []
    if (!root || typeof root.querySelectorAll !== "function") return nodes
    if (typeof root.matches === "function" && root.matches("[data-icono-rough-loop]")) {
      nodes.push(root)
    }
    var selector = force
      ? "[data-icono-rough-loop]"
      : '[data-icono-rough-loop]:not([data-icono-rough-ready="true"])'
    var found = root.querySelectorAll(selector)
    for (var i = 0; i < found.length; i++) nodes.push(found[i])
    return nodes
  }

  function hydrateRoughLoops(root, force) {
    var scope = root || (global && global.document)
    var loops = iconoCollectRoughLoops(scope, !!force)
    for (var i = 0; i < loops.length; i++) iconoRenderRoughLoop(loops[i], !!force)
  }

  function startRoughLoopObserver() {
    if (!global || !global.document) return
    if (typeof MutationObserver !== "function") {
      hydrateRoughLoops(global.document, true)
      return
    }
    if (global.__iconoRoughLoopObserverStarted) return
    global.__iconoRoughLoopObserverStarted = true
    var schedule = function (root, force) {
      if (typeof global.requestAnimationFrame === "function") {
        global.requestAnimationFrame(function () {
          hydrateRoughLoops(root, !!force)
        })
        return
      }
      global.setTimeout(function () {
        hydrateRoughLoops(root, !!force)
      }, 0)
    }
    if (global.document.readyState === "loading") {
      global.document.addEventListener(
        "DOMContentLoaded",
        function () {
          schedule(global.document, true)
        },
        { once: true },
      )
    } else {
      schedule(global.document, true)
    }
    if (global.document.fonts && global.document.fonts.ready) {
      global.document.fonts.ready.then(function () {
        schedule(global.document, true)
      })
    }
    if (typeof global.addEventListener === "function") {
      global.addEventListener("resize", function () {
        schedule(global.document, true)
      })
    }
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i] && mutations[i].addedNodes ? mutations[i].addedNodes : []
        for (var j = 0; j < addedNodes.length; j++) {
          var node = addedNodes[j]
          if (!node || node.nodeType !== 1) continue
          schedule(node, false)
        }
      }
    })
    observer.observe(global.document.documentElement, {
      childList: true,
      subtree: true,
    })
    global.__iconoRoughLoopObserverState = {
      observer: observer,
    }
  }

  function stopRoughLoopObserver() {
    if (!global) return
    var state =
      global.__iconoRoughLoopObserverState &&
      typeof global.__iconoRoughLoopObserverState === "object"
        ? global.__iconoRoughLoopObserverState
        : null
    if (state && state.observer && typeof state.observer.disconnect === "function") {
      try {
        state.observer.disconnect()
      } catch (_observerError) {
        // Ignore cleanup failures from stale runtimes.
      }
    }
    global.__iconoRoughLoopObserverState = null
    global.__iconoRoughLoopObserverStarted = false
  }

  function resolveApiBase(explicitBase) {
    var value = String(explicitBase || "").trim()
    if (value) return value.replace(/\/+$/, "")
    if (typeof window !== "undefined") {
      var host = String((window.location && window.location.hostname) || "").toLowerCase()
      if (host === "iconoplasm.brinedew.bio" || host === "staging.brinedew.bio") {
        return window.location.origin
      }
    }
    return "https://iconoplasm.brinedew.bio"
  }

  function fetchJSON(path, init, options) {
    var opts = options || {}
    var fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(global) : null)
    if (!fetchImpl) {
      return Promise.reject(new Error("fetch is unavailable in this runtime"))
    }
    var base = resolveApiBase(opts.apiBaseUrl)
    return fetchImpl(base + path, init || {}).then(function (response) {
      return response.text().then(function (raw) {
        var payload = null
        if (raw) {
          try {
            payload = JSON.parse(raw)
          } catch (_err) {
            payload = null
          }
        }
        if (!response.ok) {
          var err = new Error((payload && payload.error) || "HTTP " + response.status)
          err.status = response.status
          err.payload = payload
          throw err
        }
        return payload
      })
    })
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  function jsonScriptSafeString(value) {
    return JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  }

  function jsonAttributeSafeString(value) {
    return encodeURIComponent(JSON.stringify(value))
  }

  function normalizedSymbol(symbol) {
    return String(symbol || "")
      .trim()
      .toUpperCase()
  }

  function uniqueDisplayValues(values, limit) {
    var out = []
    var seen = Object.create(null)
    var source = Array.isArray(values) ? values : [values]
    for (var i = 0; i < source.length; i++) {
      var value = String(source[i] || "").trim()
      if (!value) continue
      var key = value.toLowerCase()
      if (seen[key]) continue
      seen[key] = true
      out.push(value)
      if (out.length >= (limit || 4)) break
    }
    return out
  }

  function normalizeCardVariant(raw) {
    var value = String(raw || "")
      .trim()
      .toLowerCase()
    if (value === "image-only") return "image-only"
    if (value === "lab-label" || value === "lit-archival") return "lit-archival"
    if (value === "classic" || value === "simple") return "simple"
    return "simple"
  }

  function normalizePoliticsDisplay(rawPolitics, rawPoliticsOrigin) {
    var politics = String(rawPolitics || "").trim()
    var politicsOriginValues = uniqueDisplayValues(rawPoliticsOrigin, 2)
    var politicsOrigin = politicsOriginValues.length
      ? String(politicsOriginValues[0] || "").trim()
      : ""
    // Clean cutover guardrail: the shared card accepts only canonical website
    // labels. If production still shows legacy names, fix D1 / sync data rather
    // than reintroducing renderer-side semantic fallbacks.
    var politicsKey = politics.toLowerCase().replace(/\s+/g, " ").trim()
    var originKey = politicsOrigin.toLowerCase().replace(/\s+/g, " ").trim()
    var character = ""
    var molecular = ""

    if (politicsKey === "pro-growth" || politicsKey === "pro growth") {
      character = "pro-growth"
    } else if (politicsKey === "pro-control" || politicsKey === "pro control") {
      character = "pro-control"
    } else if (politicsKey === "turncoat") {
      character = "turncoat"
    } else if (politicsKey === "neutral" || politicsKey === "housekeeper") {
      return { character: "", molecular: "", isNeutral: true }
    }

    if (originKey === "oncogene") {
      molecular = "oncogene"
    } else if (originKey === "tumor suppressor") {
      molecular = "tumor suppressor"
    } else if (originKey === "contextual oncogene/tumor suppressor") {
      molecular = "contextual oncogene/tumor suppressor"
    } else if (originKey === "neutral" || originKey === "housekeeper") {
      return { character: "", molecular: "", isNeutral: true }
    }

    return {
      character: character,
      molecular: molecular,
      isNeutral: false,
    }
  }

  function renderTooltipMetaPairsHtml(pairs) {
    var safePairs = Array.isArray(pairs) ? pairs : []
    if (!safePairs.length) return ""
    var html = '<div class="iconoplasm-tooltip-meta-pairs">'
    for (var i = 0; i < safePairs.length; i++) {
      var pair = safePairs[i] || {}
      var character = String(pair.character || "").trim()
      var molecular = String(pair.molecular || "").trim()
      if (!character || !molecular) continue
      html +=
        '<div class="iconoplasm-tooltip-meta-pair-row">' +
        '<div class="iconoplasm-tooltip-meta-pair-cell">' +
        '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
        escapeHtml(character) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta-pair-cell iconoplasm-tooltip-meta-pair-cell--origin">' +
        '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
        escapeHtml(molecular) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    html += "</div>"
    return html
  }

  function buildTooltipTraitOriginRows(essence) {
    var rows = []
    var safeEssence = essence && typeof essence === "object" ? essence : {}
    var aesthetics = uniqueDisplayValues(safeEssence.aesthetics, 4)
    var aestheticsOrigin = uniqueDisplayValues(safeEssence.aesthetics_origin, 4)
    var politicsRaw = safeEssence.politics || safeEssence.faction || ""
    var politicsDisplay = normalizePoliticsDisplay(politicsRaw, safeEssence.politics_origin)
    var politics = politicsDisplay.character
    var politicsOrigin = politicsDisplay.molecular ? [politicsDisplay.molecular] : []

    var pairedAestheticCount = Math.min(aesthetics.length, aestheticsOrigin.length)
    // Renderer guardrail: public cards intentionally render clan/origin rows
    // only when the website payload already contains paired aesthetics +
    // aesthetics_origin values. If NiceGUI Mapping/Demographics says a gene has
    // clans but the card shows nothing here, debug the payload projection first
    // (iconoplasm.py), not just this shared renderer.
    if (pairedAestheticCount > 0) {
      var pairs = []
      for (var i = 0; i < pairedAestheticCount; i++) {
        pairs.push({
          character: aesthetics[i],
          molecular: aestheticsOrigin[i],
        })
      }
      rows.push({ pairs: pairs })
    }

    var missingAestheticOrigins = aesthetics.length > pairedAestheticCount
    var missingPoliticsOrigins =
      Boolean(politicsRaw) && !politicsDisplay.isNeutral && !politicsOrigin.length
    if (politics && politicsOrigin.length) {
      rows.push({
        character: politics,
        molecular: politicsOrigin.join(", "),
      })
    }

    return {
      rows: rows,
      missingOrigins: missingAestheticOrigins || missingPoliticsOrigins,
    }
  }

  function collectTooltipMetaRows(geneDetail, options) {
    var opts = options || {}
    var safeGeneDetail = geneDetail && typeof geneDetail === "object" ? geneDetail : {}
    var essence =
      safeGeneDetail.essence && typeof safeGeneDetail.essence === "object"
        ? safeGeneDetail.essence
        : {}
    var rows = []

    var sexText = String(essence.sex || "").trim()
    var sexOrigin = uniqueDisplayValues(
      essence.sex_origin ||
        essence.gender_origin ||
        safeGeneDetail.sex_origin ||
        safeGeneDetail.gender_origin,
      2,
    )
    if (sexText) {
      rows.push({
        character: sexText,
        molecular: sexOrigin.length ? sexOrigin.join(", ") : "unknown",
      })
    }

    var ageText = ""
    if (essence.age) {
      ageText = String(essence.age)
    } else if (essence.age_years != null && Number.isFinite(Number(essence.age_years))) {
      ageText = String(Math.round(Number(essence.age_years)))
    }
    var firstPublicationYear = Number(safeGeneDetail.first_publication_year)
    if (ageText && Number.isFinite(firstPublicationYear) && firstPublicationYear > 0) {
      rows.push({
        character: ageText + " years old",
        molecular: "discovered in " + String(Math.round(firstPublicationYear)),
      })
    }

    var weightKg = Number(essence.weight_kg)
    var molecularWeightKda = Number(safeGeneDetail.molecular_weight_kda)
    if (
      Number.isFinite(weightKg) &&
      weightKg > 0 &&
      Number.isFinite(molecularWeightKda) &&
      molecularWeightKda > 0
    ) {
      rows.push({
        character: String(Math.round(weightKg)) + " kg",
        molecular: String(Math.round(molecularWeightKda)) + " kDa",
      })
    }

    var tissue = safeGeneDetail.primary_tissue ? String(safeGeneDetail.primary_tissue).trim() : ""
    if ((essence.skin_hex || essence.skin_name) && tissue) {
      var skinDisplay = ""
      if (essence.skin_hex) {
        skinDisplay +=
          '<span class="iconoplasm-tooltip-skin-dot" style="background:' +
          String(essence.skin_hex) +
          '"></span>'
      }
      skinDisplay += String(essence.skin_name || essence.skin_hex || "")
      rows.push({
        character: skinDisplay,
        molecular: tissue,
        characterIsHtml: true,
      })
    }

    var traitOriginRows = buildTooltipTraitOriginRows(essence)
    if (traitOriginRows.missingOrigins && typeof opts.onMissingOrigins === "function") {
      var warnKey =
        String(safeGeneDetail.symbol || safeGeneDetail.canonical_symbol || "").trim() || "(unknown)"
      opts.onMissingOrigins(warnKey, safeGeneDetail)
    }
    for (var i = 0; i < traitOriginRows.rows.length; i++) {
      rows.push(traitOriginRows.rows[i])
    }

    return rows
  }

  function labLabelCatalogNumber(symbol) {
    var safe = normalizedSymbol(symbol)
    if (!safe) return "00000"
    var hash = 2166136261
    for (var i = 0; i < safe.length; i++) {
      hash ^= safe.charCodeAt(i)
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    return String(Math.abs(hash >>> 0) % 100000).padStart(5, "0")
  }

  function labLabelArtistIdFromVision(rawVisionId) {
    var visionId = String(rawVisionId || "").trim().toLowerCase()
    if (!/^[a-z0-9-]+-v\d+-\d+$/.test(visionId)) return ""
    var match = visionId.match(/-(\d+)$/)
    return match ? String(Number.parseInt(match[1], 10) || "") : ""
  }

  function labLabelEmulsionNumber(portrait) {
    var safePortrait = portrait && typeof portrait === "object" ? portrait : {}
    var explicitArtistId = String(safePortrait.artist_id || safePortrait.emulsion_id || "").trim()
    if (explicitArtistId) return explicitArtistId
    var visionArtistId = labLabelArtistIdFromVision(safePortrait.vision_id)
    if (visionArtistId) return visionArtistId
    var candidateImageId = Number(safePortrait.candidate_image_id)
    if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
      return String(Math.round(candidateImageId))
    }
    return ""
  }

  function labLabelDisplayName(geneDetail) {
    var safeGeneDetail = geneDetail && typeof geneDetail === "object" ? geneDetail : {}
    var safeEssence =
      safeGeneDetail.essence && typeof safeGeneDetail.essence === "object"
        ? safeGeneDetail.essence
        : {}
    return (
      String(safeGeneDetail.full_name || safeEssence.name || safeGeneDetail.symbol || "").trim() ||
      normalizedSymbol(safeGeneDetail.symbol)
    )
  }

  function asObject(value) {
    return value && typeof value === "object" ? value : {}
  }

  function addAgeSuffix(ageNote) {
    var value = String(ageNote || "").trim()
    if (!value) return ""
    if (/\by\.?o\.?\b/i.test(value) || /\byears?\s+old\b/i.test(value)) return value
    return value + " y.o."
  }

  function blankFallback(value) {
    return String(value || "").trim() || " "
  }

  function renderLabLabelOptionHtml(value, selected, extraClass, loopPreset) {
    var classes = "icono-label-option"
    if (extraClass) classes += " " + extraClass
    if (selected) classes += " is-selected"
    return (
      '<span class="' +
      classes +
      '">' +
      '<span class="icono-label-option-copy" data-icono-rough-copy="true">' +
      escapeHtml(value) +
      "</span>" +
      (selected ? iconoPenLoopSvg("icono-label-option-loop", loopPreset) : "") +
      "</span>"
    )
  }

  function renderLabLabelVoteShell(voteHtml) {
    return String(voteHtml || "").trim() ? voteHtml : '<div class="icono-label-qc-empty"></div>'
  }

  function renderLabLabelCategoryFieldHtml(selectedCategory, sexNote) {
    var categoryKey = String(selectedCategory || "")
      .trim()
      .toLowerCase()
    return (
      '<div class="icono-label-category-grid">' +
      '<div class="icono-label-category-option icono-label-category-option--transmembrane">' +
      renderLabLabelOptionHtml(
        "TRANSMEMBRANE",
        categoryKey === "transmembrane",
        "",
        "category-transmembrane",
      ) +
      "</div>" +
      '<div class="icono-label-category-option icono-label-category-option--soluble">' +
      renderLabLabelOptionHtml("SOLUBLE", categoryKey === "soluble", "", "category-soluble") +
      "</div>" +
      "</div>"
    )
  }

  function renderLabLabelSexNoteHtml(sexNote, selectedCategory) {
    var note = String(sexNote || "")
      .trim()
      .toLowerCase()
    if (!note) return ""
    var categoryKey = String(selectedCategory || "")
      .trim()
      .toLowerCase()
    return (
      '<div class="icono-label-hand-note icono-label-hand-note--sex icono-label-hand-note--sex-' +
      escapeHtml(categoryKey || "unselected") +
      '">' +
      escapeHtml(note) +
      "</div>"
    )
  }

  function renderLabLabelAlignmentFieldHtml(molecularAlignment, politicalNote) {
    var molecularKey = String(molecularAlignment || "")
      .trim()
      .toLowerCase()
    var isContextual = molecularKey === "contextual oncogene/tumor suppressor"
    var isOncogene = molecularKey === "oncogene" || isContextual
    var isTumorSuppressor = molecularKey === "tumor suppressor" || isContextual
    var isNeither = !molecularKey
    var noteClass = "icono-label-hand-note icono-label-hand-note--politics"
    if (isContextual) noteClass += " icono-label-hand-note--politics-contextual"
    else if (isOncogene) noteClass += " icono-label-hand-note--politics-oncogene"
    else if (isTumorSuppressor) noteClass += " icono-label-hand-note--politics-tumor-suppressor"
    else noteClass += " icono-label-hand-note--politics-neutral"
    return (
      '<div class="icono-label-alignment-grid">' +
      '<div class="icono-label-selector-row icono-label-selector-row--alignment' +
      (isNeither ? " is-neither" : "") +
      '">' +
      renderLabLabelOptionHtml("ONCOGENE", isOncogene, "", "alignment-oncogene") +
      renderLabLabelOptionHtml(
        "TUMOR SUPPRESSOR",
        isTumorSuppressor,
        "",
        "alignment-tumor-suppressor",
      ) +
      (isNeither ? '<span class="icono-label-alignment-strike" aria-hidden="true"></span>' : "") +
      "</div>" +
      '<div class="' +
      noteClass +
      '">' +
      escapeHtml(politicalNote || "") +
      "</div>" +
      "</div>"
    )
  }

  function renderLabLabelTitleHtml(symbol, fullName, options) {
    var opts = options || {}
    var registryLine = String(
      opts.registryLine || "ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03",
    ).trim()
    var titleInner =
      '<div class="icono-label-caption">gene name</div>' +
      '<div class="icono-label-symbol">' +
      escapeHtml(symbol) +
      "</div>" +
      '<div class="icono-label-name">' +
      escapeHtml(fullName || symbol) +
      "</div>" +
      '<div class="icono-label-registry-line">' +
      escapeHtml(registryLine) +
      "</div>"
    if (opts.titleHref) {
      return (
        '<a class="icono-label-title-link" href="' +
        escapeHtml(opts.titleHref) +
        '"' +
        (opts.titleLinkAttrs ? " " + String(opts.titleLinkAttrs) : "") +
        ">" +
        titleInner +
        "</a>"
      )
    }
    return '<div class="icono-label-title-block">' + titleInner + "</div>"
  }

  function hexToHsv(hex) {
    var value = String(hex || "").trim()
    if (!/^#?[a-f0-9]{6}$/i.test(value)) return null
    if (value.charAt(0) !== "#") value = "#" + value
    var r = parseInt(value.slice(1, 3), 16) / 255
    var g = parseInt(value.slice(3, 5), 16) / 255
    var b = parseInt(value.slice(5, 7), 16) / 255
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    var delta = max - min
    var hue = 0
    if (delta > 0) {
      if (max === r) hue = ((g - b) / delta) % 6
      else if (max === g) hue = (b - r) / delta + 2
      else hue = (r - g) / delta + 4
      hue *= 60
      if (hue < 0) hue += 360
    }
    var saturation = max === 0 ? 0 : delta / max
    return {
      h: Math.round(hue),
      s: Math.round(saturation * 100),
      v: Math.round(max * 100),
    }
  }

  function describeHueWord(hue) {
    /* 26 hue zones matching pipeline letter→hue mapping
       (Datasets/iconoplasm/demographic_mappings.json).
       Boundaries are midpoints between adjacent letter hues. */
    var h = Number(hue)
    if (!Number.isFinite(h)) return "unknown"
    h = ((h % 360) + 360) % 360
    if (h < 7 || h >= 353) return "red"
    if (h < 21) return "vermilion"
    if (h < 35) return "orange"
    if (h < 49) return "amber"
    if (h < 62) return "gold"
    if (h < 76) return "yellow"
    if (h < 90) return "lime"
    if (h < 104) return "chartreuse"
    if (h < 118) return "spring"
    if (h < 132) return "jade"
    if (h < 145) return "emerald"
    if (h < 159) return "teal"
    if (h < 173) return "cyan"
    if (h < 187) return "azure"
    if (h < 201) return "cerulean"
    if (h < 215) return "blue"
    if (h < 229) return "sapphire"
    if (h < 242) return "indigo"
    if (h < 256) return "violet"
    if (h < 270) return "purple"
    if (h < 284) return "amethyst"
    if (h < 298) return "magenta"
    if (h < 312) return "fuchsia"
    if (h < 325) return "rose"
    if (h < 339) return "cerise"
    return "crimson"
  }

  function describeLevelWord(raw) {
    var n = Number(raw)
    if (!Number.isFinite(n)) return "unknown"
    if (n < 34) return "low"
    if (n < 67) return "medium"
    return "high"
  }

  function describeBandInRange(raw, min, max, lowLabel, midLabel, highLabel) {
    var n = Number(raw)
    var lower = Number(min)
    var upper = Number(max)
    if (
      !Number.isFinite(n) ||
      !Number.isFinite(lower) ||
      !Number.isFinite(upper) ||
      upper <= lower
    ) {
      return "unknown"
    }
    var clamped = Math.min(Math.max(n, lower), upper)
    var ratio = (clamped - lower) / (upper - lower)
    if (ratio < 1 / 3) return lowLabel
    if (ratio < 2 / 3) return midLabel
    return highLabel
  }

  function formatMetricNumber(raw, digits) {
    var n = Number(raw)
    if (!Number.isFinite(n)) return ""
    return n
      .toFixed(Math.max(0, Number(digits || 0)))
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1")
  }

  function renderLabLabelSpecimenMicrographicsHtml(geneDetail) {
    var safeGeneDetail = geneDetail && typeof geneDetail === "object" ? geneDetail : {}
    var color = String(safeGeneDetail.color || "")
      .trim()
      .toUpperCase()
    var hsv = hexToHsv(color)
    var essence =
      safeGeneDetail.essence && typeof safeGeneDetail.essence === "object"
        ? safeGeneDetail.essence
        : {}
    var colorName = String(essence.skin_name || "").trim()
    var symbol = String(safeGeneDetail.symbol || safeGeneDetail.canonical_symbol || "").trim()
    var firstLetter = (symbol.charAt(0) || "?").toUpperCase()
    var tauRaw = safeGeneDetail.tissue_tau != null ? safeGeneDetail.tissue_tau : essence.tissue_tau
    var loeufRaw = safeGeneDetail.loeuf != null ? safeGeneDetail.loeuf : essence.loeuf
    var tau = formatMetricNumber(tauRaw, 2)
    var loeuf = formatMetricNumber(loeufRaw, 3)
    /* Hue word comes from first letter directly (not hex back-conversion),
       because OKHsv→sRGB→standard-HSV shifts the hue angle. */
    var letterHueWords = {
      A: "red",
      B: "vermilion",
      C: "orange",
      D: "amber",
      E: "gold",
      F: "yellow",
      G: "lime",
      H: "chartreuse",
      I: "spring",
      J: "jade",
      K: "emerald",
      L: "teal",
      M: "cyan",
      N: "azure",
      O: "cerulean",
      P: "blue",
      Q: "sapphire",
      R: "indigo",
      S: "violet",
      T: "purple",
      U: "amethyst",
      V: "magenta",
      W: "fuchsia",
      X: "rose",
      Y: "cerise",
      Z: "crimson",
    }
    var hueLabel = letterHueWords[firstLetter] || (hsv ? describeHueWord(hsv.h) : "unknown")
    var saturationLabel = describeBandInRange(
      tauRaw,
      0,
      1,
      "low vibrance",
      "mid vibrance",
      "high vibrance",
    )
    var lightnessLabel = describeBandInRange(
      loeufRaw,
      0,
      2,
      "dark shade",
      "mid shade",
      "light shade",
    )
    var metrics = ["letter", "HPA tau", "gnomAD LOEUF"]
    var values = [firstLetter, tau || "n/a", loeuf || "n/a"]
    var handNotes = [hueLabel, saturationLabel, lightnessLabel]
    var decompositionHtml = ""
    for (var i = 0; i < metrics.length; i++) {
      var rowClass = " icono-label-specimen-cell--row-" + String(i + 1)
      decompositionHtml +=
        '<span class="icono-label-specimen-cell icono-label-specimen-cell--metric' +
        rowClass +
        '"><span class="icono-label-specimen-metric">' +
        escapeHtml(metrics[i]) +
        "</span></span>" +
        '<span class="icono-label-specimen-cell icono-label-specimen-cell--value' +
        rowClass +
        '"><span class="icono-label-specimen-metric-value">' +
        escapeHtml(values[i]) +
        "</span></span>" +
        '<span class="icono-label-specimen-cell icono-label-specimen-cell--hand' +
        rowClass +
        '"><span class="icono-label-specimen-hand-analysis">' +
        escapeHtml(handNotes[i]) +
        "</span></span>"
    }
    /* Row 1 = full color (prominent). Rows 2-4 = decomposition (subordinate).
       Source of truth: Datasets/iconoplasm/src/apply_demographic_mappings.py.
       first_letter -> hue, tissue_tau -> saturation note, LOEUF -> lightness note. */
    return (
      '<div class="icono-label-specimen-micro">' +
      '<div class="icono-label-specimen-color-row">' +
      '<span class="icono-label-specimen-swatch-hex">' +
      '<span class="icono-label-specimen-swatch" style="background:' +
      escapeHtml(color || "#000000") +
      '"></span>' +
      '<span class="icono-label-specimen-metric-value">' +
      escapeHtml(color || "UNFILED") +
      "</span>" +
      "</span>" +
      (colorName
        ? '<span class="icono-label-specimen-color-name">' + escapeHtml(colorName) + "</span>"
        : "") +
      "</div>" +
      '<div class="icono-label-specimen-decomposition">' +
      decompositionHtml +
      "</div>" +
      "</div>"
    )
  }

  function renderLabLabelSpecimenFooterHtml(geneDetail) {
    return (
      '<div class="icono-label-specimen-footer">' +
      '<div class="icono-label-specimen-notes">' +
      '<div class="icono-label-specimen-note">emulsion note / glass plate spectral analysis</div>' +
      "</div>" +
      renderLabLabelSpecimenMicrographicsHtml(geneDetail) +
      "</div>"
    )
  }

  function renderLabLabelFamilyTraitFieldHtml(familyFeature) {
    var trait = String(familyFeature || "").trim()
    if (!trait) {
      return '<div class="icono-label-family-trait-field icono-label-family-trait-field--empty"></div>'
    }
    return (
      '<div class="icono-label-family-trait-field">' +
      '<div class="icono-label-hand-note icono-label-hand-note--family-trait">' +
      escapeHtml(trait) +
      "</div>" +
      "</div>"
    )
  }

  function portraitDimensions(geneDetail) {
    var portrait = geneDetail && geneDetail.portrait
    var assetSha = String((portrait && portrait.asset_sha256) || "")
      .trim()
      .toLowerCase()
    var candidates = Array.isArray(geneDetail && geneDetail.portrait_candidates)
      ? geneDetail.portrait_candidates
      : []
    var matchedCandidate = null
    if (assetSha) {
      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i]
        var candidateSha = String((candidate && candidate.asset_sha256) || "")
          .trim()
          .toLowerCase()
        if (candidateSha && candidateSha === assetSha) {
          matchedCandidate = candidate
          break
        }
      }
    }
    var width = Number(
      (portrait && (portrait.width || portrait.image_width)) ||
        (matchedCandidate && (matchedCandidate.width || matchedCandidate.image_width)) ||
        (geneDetail && geneDetail.width) ||
        0,
    )
    var height = Number(
      (portrait && (portrait.height || portrait.image_height)) ||
        (matchedCandidate && (matchedCandidate.height || matchedCandidate.image_height)) ||
        (geneDetail && geneDetail.height) ||
        0,
    )
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      return { width: 1, height: 1 }
    }
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }
  }

  function renderLabLabelPortraitMediaHtml(
    symbol,
    portraitUrl,
    portraitFullUrl,
    dims,
    options,
  ) {
    var opts = options || {}
    var resolvedSymbol = normalizedSymbol(symbol)
    var size = portraitDimensions(dims)
    var extraButtonAttrs = String(opts.buttonAttrs || "").trim()
    var buttonClassName =
      "iconoplasm-tooltip-portrait-media icono-brick-media-link" +
      (opts.extraButtonClass ? " " + String(opts.extraButtonClass).trim() : "")
    var loading = String(opts.loading || "eager").trim() || "eager"
    var fetchPriority = String(opts.fetchPriority || "low").trim() || "low"
    // Fence: the archival portrait rail is a shared visual contract. The website and browser
    // extension must render the same button/img/fallback structure or they drift on width, crop,
    // and loading behavior the next time one side evolves.
    if (!portraitUrl) {
      return (
        '<div class="iconoplasm-tooltip-portrait-fallback">' +
        '<div class="iconoplasm-tooltip-portrait-status">Portrait pending</div>' +
        '<div class="iconoplasm-tooltip-portrait-symbol">' +
        escapeHtml(resolvedSymbol) +
        "</div>" +
        "</div>"
      )
    }
    return (
      '<button type="button" class="' +
      escapeHtml(buttonClassName) +
      '"' +
      (extraButtonAttrs ? " " + extraButtonAttrs : "") +
      ' aria-label="Open full-size portrait for ' +
      escapeHtml(resolvedSymbol) +
      ' portrait">' +
      '<img class="iconoplasm-tooltip-portrait-img" src="' +
      escapeHtml(portraitUrl) +
      '" alt="' +
      escapeHtml(resolvedSymbol) +
      ' portrait" loading="' +
      escapeHtml(loading) +
      '" decoding="async" fetchpriority="' +
      escapeHtml(fetchPriority) +
      '" width="' +
      size.width +
      '" height="' +
      size.height +
      '">' +
      "</button>"
    )
  }

  function renderLabLabelSpecimenRailHtml(mediaHtml, geneDetail) {
    return (
      '<div class="icono-label-specimen-viewport">' +
      String(mediaHtml || "") +
      "</div>" +
      renderLabLabelSpecimenFooterHtml(geneDetail) +
      '<div class="iconoplasm-tooltip-portrait-fade"></div>'
    )
  }

  function renderLabLabelFiledLines(familyFeature) {
    var lead = String(familyFeature || "").trim()
    var lines = []
    if (lead) lines.push(lead)
    else lines.push("receptor plate / archive")
    lines.push("box 5 / filed by h.g.")
    lines.push("section")
    var html = ""
    for (var i = 0; i < lines.length; i++) {
      html += '<div class="icono-label-filed-copy">' + escapeHtml(lines[i]) + "</div>"
    }
    return html
  }

  function renderLabLabelFooterHtml(color, serial) {
    var stockTone =
      String(color || "")
        .trim()
        .toUpperCase() || "UNFILED"
    var sheetNo = String(serial || "").trim() || "00000"
    return (
      '<div class="icono-label-footer-copy">' +
      '<div class="icono-label-footer-copy-main">' +
      '<div class="icono-label-footer-line icono-label-footer-line--caption">labelled / inspected / filed</div>' +
      '<div class="icono-label-footer-line icono-label-footer-line--typed">archive room b / bench 3 / human gene cabinet</div>' +
      '<div class="icono-label-footer-line icono-label-footer-line--typed">stock tone ' +
      escapeHtml(stockTone) +
      " / sheet " +
      escapeHtml(sheetNo) +
      " / print run 07</div>" +
      '<div class="icono-label-footer-line icono-label-footer-line--typed">seal after review / do not expose to open air</div>' +
      "</div>" +
      '<div class="icono-label-footer-copy-side">' +
      '<div class="icono-label-footer-line icono-label-footer-line--caption">brinedew institute / internal matter</div>' +
      '<div class="icono-label-footer-line icono-label-footer-line--caption">keep away from heat and moisture</div>' +
      '<div class="icono-label-footer-line icono-label-footer-line--caption">registry copy retained in cabinet 5A</div>' +
      "</div>" +
      "</div>"
    )
  }

  function resolveArchivalCardModel(geneDetail, options) {
    var safeGeneDetail = asObject(geneDetail)
    var safeEssence = asObject(safeGeneDetail.essence)
    var safePortrait = asObject(safeGeneDetail.portrait)
    var opts = options || {}
    var symbol = normalizedSymbol(safeGeneDetail.symbol || safeGeneDetail.canonical_symbol)
    var fullName = labLabelDisplayName(safeGeneDetail)
    var emulsionNumber = labLabelEmulsionNumber(safePortrait)
    var serial = emulsionNumber || labLabelCatalogNumber(symbol)
    var family = String(safeEssence.family_surname || "").trim()
    var familyFeature = String(safeEssence.family_feature || "").trim()
    var familyMembers = Number(safeEssence.family_members)
    var hasRealFamily =
      (Number.isFinite(familyMembers) && familyMembers > 1) ||
      (!Number.isFinite(familyMembers) && family && family.toUpperCase() !== symbol)
    var displayedFamily = hasRealFamily ? family : ""
    var displayedFamilyFeature = hasRealFamily ? familyFeature : ""
    var sexOriginValues = uniqueDisplayValues(
      safeEssence.sex_origin ||
        safeEssence.gender_origin ||
        safeGeneDetail.sex_origin ||
        safeGeneDetail.gender_origin,
      2,
    )
    var selectedCategory = String(sexOriginValues[0] || "")
      .trim()
      .toLowerCase()
    var sexNote = String(safeEssence.sex || "")
      .trim()
      .toLowerCase()
    var firstPublicationYear = Number(safeGeneDetail.first_publication_year)
    var firstNoted =
      Number.isFinite(firstPublicationYear) && firstPublicationYear > 0
        ? String(Math.round(firstPublicationYear))
        : ""
    var ageNote = ""
    if (safeEssence.age) {
      ageNote = String(safeEssence.age).trim()
    } else if (safeEssence.age_years != null && Number.isFinite(Number(safeEssence.age_years))) {
      ageNote = String(Math.round(Number(safeEssence.age_years)))
    }
    var weightKg = Number(safeEssence.weight_kg)
    var handwrittenWeight =
      Number.isFinite(weightKg) && weightKg > 0 ? String(Math.round(weightKg)) : ""
    var aesthetics = uniqueDisplayValues(safeEssence.aesthetics, 4)
    var aestheticsOrigin = uniqueDisplayValues(safeEssence.aesthetics_origin, 4)
    var maxStyleRows = Math.max(aesthetics.length, aestheticsOrigin.length, 3)
    var stylePairs = []
    for (var i = 0; i < maxStyleRows; i++) {
      stylePairs.push({
        origin: blankFallback(aestheticsOrigin[i]),
        note: String(aesthetics[i] || "").trim(),
      })
    }
    var politicsDisplay = normalizePoliticsDisplay(
      safeEssence.politics || safeEssence.faction || "",
      safeEssence.politics_origin,
    )
    var mode = String(opts.mode || "sheet")
      .trim()
      .toLowerCase()
    var layoutVariant = normalizeCardVariant(opts.layoutVariant || "lit-archival")
    return {
      ageNote: addAgeSuffix(ageNote),
      color: String(safeGeneDetail.color || "")
        .trim()
        .toUpperCase(),
      displayedFamily: displayedFamily,
      displayedFamilyFeature: displayedFamilyFeature,
      firstNoted: firstNoted,
      fullName: fullName,
      handwrittenWeight: handwrittenWeight,
      layoutVariant: layoutVariant,
      mobileReview: !!opts.mobileReview,
      mode: mode === "brick" ? "brick" : "sheet",
      molecularAlignment: String(politicsDisplay.molecular || "").trim().toLowerCase(),
      politicalNote: String(politicsDisplay.character || "").trim(),
      portraitAlt:
        String(opts.portraitAlt || "").trim() || (symbol ? symbol + " portrait" : "Gene portrait"),
      portraitDimensions: portraitDimensions(
        Object.keys(safePortrait).length ? safeGeneDetail : Object.assign({}, safeGeneDetail, { portrait: {} }),
      ),
      portraitSrc: String(opts.portraitSrc || "").trim(),
      selectedCategory: selectedCategory,
      serial: serial,
      sexNote: sexNote,
      stylePairs: stylePairs,
      symbol: symbol,
      titleHref: String(opts.titleHref || "").trim(),
      titleLinkAttrs: String(opts.titleLinkAttrs || "").trim(),
      voteHtml: String(opts.voteHtml || ""),
    }
  }

  function renderLabLabelCardHtml(geneDetail, options) {
    // Canonical archival card contract for both the legacy string renderer and the Lit host.
    // If archival field mapping changes, do it in resolveArchivalCardModel(...) instead of
    // splitting by shell or surface again.
    var model = resolveArchivalCardModel(geneDetail, options)
    var titleHtml = renderLabLabelTitleHtml(model.symbol, model.fullName, {
      titleHref: model.titleHref,
      titleLinkAttrs: model.titleLinkAttrs,
    })
    var voteHtml = renderLabLabelVoteShell(model.voteHtml)
    var stylePairsHtml = ""
    for (var i = 0; i < model.stylePairs.length; i++) {
      var pair = model.stylePairs[i] || {}
      stylePairsHtml +=
        '<div class="icono-label-style-pair">' +
        '<div class="icono-label-origin-text">' +
        escapeHtml(blankFallback(pair.origin)) +
        "</div>" +
        '<div class="icono-label-hand-note icono-label-hand-note--style">' +
        escapeHtml(String(pair.note || "").trim()) +
        "</div>" +
        "</div>"
    }

    return (
      '<div class="icono-label-sheet-body">' +
      '<div class="icono-label-header-row">' +
      titleHtml +
      '<div class="icono-label-header-stack">' +
      '<div class="icono-label-header-meta">' +
      '<div class="icono-label-header-meta-cell">' +
      '<div class="icono-label-caption">emulsion no.</div>' +
      '<div class="icono-label-serial">' +
      escapeHtml(model.serial) +
      "</div>" +
      "</div>" +
      '<div class="icono-label-header-meta-cell">' +
      '<div class="icono-label-caption">family</div>' +
      '<div class="icono-label-family">' +
      escapeHtml(model.displayedFamily) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="icono-label-filed-block">' +
      '<div class="icono-label-caption">family trait</div>' +
      renderLabLabelFamilyTraitFieldHtml(model.displayedFamilyFeature) +
      "</div>" +
      "</div>" +
      '<div class="icono-label-qc-block">' +
      '<div class="icono-label-caption">qc</div>' +
      voteHtml +
      '<div class="icono-label-qc-meta">' +
      '<div class="icono-label-qc-meta-item">inspect. A3</div>' +
      '<div class="icono-label-qc-meta-item">plate 7</div>' +
      "</div>" +
      '<div class="icono-label-qc-note" data-icono-qc-note>pending review</div>' +
      "</div>" +
      "</div>" +
      '<div class="icono-label-band-row">' +
      '<div class="icono-label-row-label">field notes</div>' +
      '<div class="icono-label-band-grid">' +
      '<div class="icono-label-band-cell icono-label-band-cell--category">' +
      '<div class="icono-label-caption">category</div>' +
      '<div class="icono-label-band-primary">' +
      renderLabLabelCategoryFieldHtml(model.selectedCategory, model.sexNote) +
      "</div>" +
      '<div class="icono-label-band-secondary">' +
      renderLabLabelSexNoteHtml(model.sexNote, model.selectedCategory) +
      "</div>" +
      "</div>" +
      '<div class="icono-label-band-cell icono-label-band-cell--noted">' +
      '<div class="icono-label-caption">first noted</div>' +
      '<div class="icono-label-band-primary">' +
      '<div class="icono-label-typed-value icono-label-typed-value--band">' +
      escapeHtml(model.firstNoted || " ") +
      "</div>" +
      "</div>" +
      '<div class="icono-label-band-secondary">' +
      '<div class="icono-label-hand-note icono-label-hand-note--age">' +
      escapeHtml(model.ageNote) +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="icono-label-band-cell icono-label-band-cell--mass">' +
      '<div class="icono-label-caption">mass</div>' +
      '<div class="icono-label-band-primary">' +
      '<div class="icono-label-mass-line">' +
      '<span class="icono-label-mass-fill">' +
      '<span class="icono-label-hand-note icono-label-hand-note--mass-number">' +
      escapeHtml(model.handwrittenWeight) +
      "</span>" +
      "</span>" +
      '<span class="icono-label-typed-value icono-label-typed-value--band icono-label-typed-value--crossed icono-label-typed-value--unit-kda">kDa</span>' +
      '<span class="icono-label-hand-note icono-label-hand-note--unit">kg</span>' +
      "</div>" +
      "</div>" +
      '<div class="icono-label-band-secondary"></div>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="icono-label-style-row">' +
      '<div class="icono-label-row-label">pfam clans</div>' +
      '<div class="icono-label-style-stack">' +
      stylePairsHtml +
      "</div>" +
      "</div>" +
      '<div class="icono-label-alignment-row">' +
      '<div class="icono-label-row-label">alignment</div>' +
      '<div class="icono-label-alignment-body">' +
      renderLabLabelAlignmentFieldHtml(model.molecularAlignment, model.politicalNote) +
      "</div>" +
      "</div>" +
      '<div class="icono-label-footer-row">' +
      '<div class="icono-label-row-label">remarks</div>' +
      renderLabLabelFooterHtml(model.color, model.serial) +
      "</div>" +
      "</div>"
    )
  }

  function renderLitArchivalCardHtml(geneDetail, options) {
    var model = resolveArchivalCardModel(geneDetail, options)
    return (
      '<icono-lit-archival class="icono-lit-archival-host" data-icono-lit-archival data-icono-lit-archival-model="' +
      escapeHtml(jsonAttributeSafeString(model)) +
      '">' +
      "</icono-lit-archival>"
    )
  }

  function renderTooltipMetaRowsHtml(rows) {
    if (!Array.isArray(rows) || !rows.length) return ""
    var html = ""
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}
      if (Array.isArray(row.pairs) && row.pairs.length) {
        html += renderTooltipMetaPairsHtml(row.pairs)
        continue
      }
      html +=
        '<div class="iconoplasm-tooltip-meta-row">' +
        '<div class="iconoplasm-tooltip-meta-cell">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.characterIsHtml ? row.character : escapeHtml(row.character || "")) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-meta-cell iconoplasm-tooltip-meta-cell--origin">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.molecularIsHtml ? row.molecular : escapeHtml(row.molecular || "")) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    return html
  }

  function renderTooltipMetaSkeletonHtml() {
    return (
      '<div class="iconoplasm-tooltip-meta iconoplasm-tooltip-meta--skeleton">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-row">' +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-meta-skeleton-cell iconoplasm-tooltip-meta-skeleton-cell--origin">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function renderTooltipMobileRowGridHtml(rows, extraAttrs) {
    var safeRows = Array.isArray(rows) ? rows : []
    var attrs = extraAttrs ? " " + extraAttrs : ""
    if (!safeRows.length)
      return '<div class="iconoplasm-tooltip-mobile-rowgrid"' + attrs + "></div>"
    var html = '<div class="iconoplasm-tooltip-mobile-rowgrid"' + attrs + ">"
    for (var i = 0; i < safeRows.length; i++) {
      var row = safeRows[i] || {}
      if (Array.isArray(row.pairs) && row.pairs.length) {
        for (var j = 0; j < row.pairs.length; j++) {
          html +=
            '<div class="iconoplasm-tooltip-mobile-row">' +
            '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
            '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
            escapeHtml(row.pairs[j].character) +
            "</span>" +
            "</div>" +
            '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
            '<span class="iconoplasm-tooltip-meta-value iconoplasm-tooltip-meta-value--compact">' +
            escapeHtml(row.pairs[j].molecular) +
            "</span>" +
            "</div>" +
            "</div>"
        }
        continue
      }
      if (!row.character && !row.molecular) continue
      html +=
        '<div class="iconoplasm-tooltip-mobile-row">' +
        '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.characterIsHtml ? row.character : escapeHtml(row.character || "")) +
        "</span>" +
        "</div>" +
        '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
        '<span class="iconoplasm-tooltip-meta-value">' +
        (row.molecularIsHtml ? row.molecular : escapeHtml(row.molecular || "")) +
        "</span>" +
        "</div>" +
        "</div>"
    }
    html += "</div>"
    return html
  }

  function renderTooltipMobileSkeletonHtml(extraAttrs) {
    var attrs = extraAttrs ? " " + extraAttrs : ""
    return (
      '<div class="iconoplasm-tooltip-mobile-rowgrid iconoplasm-tooltip-mobile-rowgrid--skeleton"' +
      attrs +
      ">" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line"></span>' +
      "</div>" +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-row">' +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--character">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      '<div class="iconoplasm-tooltip-mobile-cell iconoplasm-tooltip-mobile-cell--molecular">' +
      '<span class="iconoplasm-tooltip-skeleton-line iconoplasm-tooltip-skeleton-line--short"></span>' +
      "</div>" +
      "</div>" +
      "</div>"
    )
  }

  function voteBoxMarkup(extraAttrs, options) {
    var attrs = extraAttrs ? " " + extraAttrs : ""
    var opts = options || {}
    var variant = String(opts.variant || "").trim()
    var isBrick = variant === "brick"
    var isLabel = variant === "label"
    var showArrows = isLabel && !!opts.showArrows
    var approveArrow = showArrows
      ? '<svg class="icono-vote-btn-arrow icono-vote-btn-arrow--right" viewBox="0 0 60 60" aria-hidden="true" focusable="false"><path d="M29 43l-3 3-16-16 16-16 3 3-13 13 13 13z" transform="translate(60 0) scale(-1 1)"></path></svg>'
      : ""
    var rejectArrow = showArrows
      ? '<svg class="icono-vote-btn-arrow icono-vote-btn-arrow--left" viewBox="0 0 60 60" aria-hidden="true" focusable="false"><path d="M29 43l-3 3-16-16 16-16 3 3-13 13 13 13z"></path></svg>'
      : ""
    var approveInner = isLabel
      ? '<span class="icono-vote-btn-copy-stack"><span class="icono-vote-btn-copy" data-icono-rough-copy="true">FIT</span>' +
        approveArrow +
        "</span>" +
        iconoPenLoopSvg("icono-vote-btn-loop", "vote-approve")
      : ICONO_CHECK_ICON
    var rejectInner = isLabel
      ? '<span class="icono-vote-btn-copy-stack">' +
        rejectArrow +
        '<span class="icono-vote-btn-copy" data-icono-rough-copy="true">MISFIT</span>' +
        "</span>" +
        iconoPenLoopSvg("icono-vote-btn-loop", "vote-reject")
      : ICONO_CROSS_ICON
    return (
      '<div class="icono-vote-box' +
      (isBrick ? " icono-vote-box--brick" : "") +
      (isLabel ? " icono-vote-box--label" : "") +
      '" data-icono-vote-box' +
      attrs +
      ">" +
      '<button type="button" class="icono-vote-btn icono-vote-btn--approve" data-icono-vote-up aria-label="Approve portrait" title="Approve portrait">' +
      approveInner +
      "</button>" +
      '<button type="button" class="icono-vote-btn icono-vote-btn--reject" data-icono-vote-down aria-label="Reject portrait" title="Reject portrait">' +
      rejectInner +
      "</button>" +
      "</div>"
    )
  }

  function voteSummaryText(snapshot) {
    return String(Number((snapshot || {}).image_score || 0))
  }

  function voteSummaryDetails(snapshot) {
    var data = snapshot || {}
    var up = Number(data.image_upvotes || 0)
    var down = Number(data.image_downvotes || 0)
    var score = Number(data.image_score || 0)
    var sign = score > 0 ? "+" : ""
    return "Score " + sign + score + " (" + up + " approvals / " + down + " rejections)"
  }

  function setVoteBoxState(box, opts) {
    if (!box) return
    var statsEl = box.querySelector("[data-icono-vote-stats]")
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")
    var snapshot = (opts && opts.snapshot) || {}
    var pending = !!(opts && opts.pending)
    var userVote = Number(snapshot.user_vote || 0)
    if (statsEl) {
      statsEl.textContent = voteSummaryText(snapshot)
      statsEl.setAttribute("title", voteSummaryDetails(snapshot))
    }
    if (!statsEl) {
      box.setAttribute("title", voteSummaryDetails(snapshot))
    }
    if (upBtn) {
      upBtn.disabled = pending
      upBtn.classList.toggle("active", userVote === 1)
    }
    if (downBtn) {
      downBtn.disabled = pending
      downBtn.classList.toggle("active", userVote === -1)
    }
    var qcBlock = box.closest ? box.closest(".icono-label-qc-block") : null
    if (qcBlock) {
      var qcNote = qcBlock.querySelector("[data-icono-qc-note]")
      if (qcNote) {
        var qcCopy = "pending review"
        if (userVote === 1) qcCopy = "looks viable"
        else if (userVote === -1) qcCopy = "flagged misfit"
        qcNote.textContent = qcCopy
      }
    }
  }

  function wireVoteBox(box, config) {
    if (!box) return null
    if (box.getAttribute("data-icono-vote-wired") === "true") return null
    var cfg = config || {}
    var symbol = normalizedSymbol(cfg.symbol)
    var assetSha = String(cfg.assetSha || "")
      .trim()
      .toLowerCase()
    var visionId = String(cfg.visionId || "").trim()
    if (!symbol || !assetSha) return null
    box.setAttribute("data-icono-vote-wired", "true")
    var state = {
      authenticated: false,
      pending: false,
      snapshot: {
        image_upvotes: 0,
        image_downvotes: 0,
        image_score: 0,
        user_vote: 0,
      },
    }
    var snapshotPrimed = false
    var visibilityObserver = null
    var candidateRef = "a:" + symbol + "|" + assetSha
    var candidateImageId = Number(cfg.candidateImageId || 0)
    if (!Number.isFinite(candidateImageId) || candidateImageId <= 0) candidateImageId = 0
    var upBtn = box.querySelector("[data-icono-vote-up]")
    var downBtn = box.querySelector("[data-icono-vote-down]")

    function render() {
      setVoteBoxState(box, state)
    }

    function notifySnapshot() {
      if (typeof cfg.onSnapshot === "function") {
        cfg.onSnapshot(state.snapshot, state)
      }
    }

    function cloneSnapshot(snapshot) {
      var safe = snapshot || {}
      return {
        image_upvotes: Number(safe.image_upvotes || 0),
        image_downvotes: Number(safe.image_downvotes || 0),
        image_score: Number(safe.image_score || 0),
        user_vote: Number(safe.user_vote || 0),
      }
    }

    function optimisticSnapshot(nextVote) {
      var base = cloneSnapshot(state.snapshot)
      var currentVote = Number(base.user_vote || 0)
      var resolvedVote = Number(nextVote || 0)
      if (currentVote === 1) base.image_upvotes = Math.max(0, Number(base.image_upvotes || 0) - 1)
      if (currentVote === -1)
        base.image_downvotes = Math.max(0, Number(base.image_downvotes || 0) - 1)
      if (resolvedVote === 1) base.image_upvotes += 1
      if (resolvedVote === -1) base.image_downvotes += 1
      base.user_vote = resolvedVote
      base.image_score = Number(base.image_upvotes || 0) - Number(base.image_downvotes || 0)
      return base
    }

    function refreshSnapshot() {
      state.pending = true
      render()
      return fetchJSON(
        "/api/iconoplasm/votes/snapshot",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_ref: candidateRef,
            symbol: symbol,
            asset_sha256: assetSha,
            candidate_image_id: candidateImageId || undefined,
            vision_id: visionId,
          }),
        },
        {
          apiBaseUrl: cfg.apiBaseUrl,
          fetchImpl: cfg.fetchImpl,
        },
      )
        .then(function (data) {
          state.authenticated = !!(data && data.authenticated)
          state.snapshot = (data && data.snapshot) || state.snapshot
          notifySnapshot()
        })
        .catch(function (err) {
          if (typeof cfg.onError === "function") cfg.onError("snapshot", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    function submitVote(voteValue) {
      // Source: C:\Users\Admin\.codex\skills\optimize\SKILL.md (Optimistic UI) +
      // C:\Users\Admin\.codex\skills\polish\SKILL.md (Interaction states).
      // Keep the selected vote lit on click, not after the network round-trip. This is shared
      // by both the website and extension, so sluggish feedback here propagates everywhere.
      var previousSnapshot = cloneSnapshot(state.snapshot)
      var currentVote = Number(previousSnapshot.user_vote || 0)
      var requestedVote = Number(voteValue || 0)
      var nextVote = currentVote === requestedVote ? 0 : requestedVote
      state.snapshot = optimisticSnapshot(nextVote)
      state.pending = true
      notifySnapshot()
      render()
      fetchJSON(
        "/api/iconoplasm/votes/set",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidate_ref: candidateRef,
            symbol: symbol,
            asset_sha256: assetSha,
            candidate_image_id: candidateImageId || undefined,
            vision_id: visionId,
            vote_value: nextVote,
          }),
        },
        {
          apiBaseUrl: cfg.apiBaseUrl,
          fetchImpl: cfg.fetchImpl,
        },
      )
        .then(function (data) {
          state.authenticated = true
          state.snapshot = (data && data.snapshot) || state.snapshot
          notifySnapshot()
        })
        .catch(function (err) {
          state.snapshot = previousSnapshot
          if (
            Number((err && err.status) || 0) === 401 ||
            (err && err.payload && err.payload.code === "AUTH_REQUIRED")
          ) {
            state.authenticated = false
            notifySnapshot()
            if (typeof cfg.onAuthRequired === "function") cfg.onAuthRequired(err)
            return
          }
          notifySnapshot()
          if (typeof cfg.onError === "function") cfg.onError("set", err)
        })
        .finally(function () {
          state.pending = false
          render()
        })
    }

    function disconnectObserver() {
      if (!visibilityObserver) return
      visibilityObserver.disconnect()
      visibilityObserver = null
    }

    function ensureSnapshot() {
      if (snapshotPrimed) return
      snapshotPrimed = true
      disconnectObserver()
      void refreshSnapshot()
    }

    function primeSnapshotOnVisibility() {
      if (snapshotPrimed || typeof IntersectionObserver !== "function") return
      visibilityObserver = new IntersectionObserver(
        function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i] && entries[i].isIntersecting) {
              ensureSnapshot()
              return
            }
          }
        },
        {
          rootMargin: String(cfg.visibleRootMargin || "240px 0px"),
        },
      )
      visibilityObserver.observe(box)
    }

    if (upBtn) {
      upBtn.addEventListener("click", function (event) {
        event.stopPropagation()
        submitVote(1)
      })
    }
    if (downBtn) {
      downBtn.addEventListener("click", function (event) {
        event.stopPropagation()
        submitVote(-1)
      })
    }

    render()

    if (cfg.deferSnapshot) {
      primeSnapshotOnVisibility()
      box.addEventListener("pointerenter", ensureSnapshot, { once: true })
      box.addEventListener("focusin", ensureSnapshot, { once: true })
      box.addEventListener("touchstart", ensureSnapshot, { once: true, passive: true })
      return { ensureSnapshot: ensureSnapshot }
    }

    ensureSnapshot()
    return { ensureSnapshot: ensureSnapshot }
  }

  startRoughLoopObserver()

  global.IconoplasmCardShared = {
    __meta: {
      owner: forceSiteOwnership ? "site" : "shared",
      version: ICONO_SHARED_RUNTIME_VERSION,
    },
    __dispose: stopRoughLoopObserver,
    icons: {
      check: ICONO_CHECK_ICON,
      cross: ICONO_CROSS_ICON,
    },
    resolveApiBase: resolveApiBase,
    fetchJSON: fetchJSON,
    escapeHtml: escapeHtml,
    normalizedSymbol: normalizedSymbol,
    uniqueDisplayValues: uniqueDisplayValues,
    normalizeCardVariant: normalizeCardVariant,
    normalizePoliticsDisplay: normalizePoliticsDisplay,
    labLabelCatalogNumber: labLabelCatalogNumber,
    labLabelEmulsionNumber: labLabelEmulsionNumber,
    labLabelDisplayName: labLabelDisplayName,
    portraitDimensions: portraitDimensions,
    resolveArchivalCardModel: resolveArchivalCardModel,
    buildTooltipTraitOriginRows: buildTooltipTraitOriginRows,
    collectTooltipMetaRows: collectTooltipMetaRows,
    renderLabLabelPortraitMediaHtml: renderLabLabelPortraitMediaHtml,
    renderLabLabelSpecimenFooterHtml: renderLabLabelSpecimenFooterHtml,
    renderLabLabelSpecimenRailHtml: renderLabLabelSpecimenRailHtml,
    renderLabLabelCardHtml: renderLabLabelCardHtml,
    renderLitArchivalCardHtml: renderLitArchivalCardHtml,
    renderTooltipMetaRowsHtml: renderTooltipMetaRowsHtml,
    renderTooltipMetaSkeletonHtml: renderTooltipMetaSkeletonHtml,
    renderTooltipMobileRowGridHtml: renderTooltipMobileRowGridHtml,
    renderTooltipMobileSkeletonHtml: renderTooltipMobileSkeletonHtml,
    voteBoxMarkup: voteBoxMarkup,
    setVoteBoxState: setVoteBoxState,
    wireVoteBox: wireVoteBox,
    voteSummaryDetails: voteSummaryDetails,
    hydrateRoughLoops: hydrateRoughLoops,
  }
})(typeof globalThis !== "undefined" ? globalThis : window)
