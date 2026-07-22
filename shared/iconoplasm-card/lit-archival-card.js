import { html, nothing, render } from "lit"
import { unsafeHTML } from "lit/directives/unsafe-html.js"

var MODEL_ATTR = "data-icono-lit-archival-model"
var MODEL_SELECTOR = 'script[type="application/json"][data-icono-lit-archival-model]'
var roughLoopSerial = 0

function sharedCardRuntime() {
  return globalThis && globalThis.IconoplasmCardShared ? globalThis.IconoplasmCardShared : null
}

function asObject(value) {
  return value && typeof value === "object" ? value : {}
}

function blankFallback(value) {
  return String(value || "").trim() || " "
}

function normalizeHandwrittenText(value) {
  var text = String(value || "").trim()
  if (!text) return ""
  try {
    return text.normalize("NFD")
  } catch (_error) {
    return text
  }
}

function normalizeCardModelHandwriting(payload) {
  var safePayload = asObject(payload)
  var normalized = Object.assign({}, safePayload)
  normalized.ageNote = normalizeHandwrittenText(safePayload.ageNote)
  normalized.displayedFamilyFeature = normalizeHandwrittenText(safePayload.displayedFamilyFeature)
  normalized.handwrittenWeight = normalizeHandwrittenText(safePayload.handwrittenWeight)
  normalized.politicalNote = normalizeHandwrittenText(safePayload.politicalNote)
  normalized.sexNote = normalizeHandwrittenText(safePayload.sexNote)
  var rawStylePairs = Array.isArray(safePayload.stylePairs) ? safePayload.stylePairs : []
  normalized.stylePairs = rawStylePairs.slice(0, 7).map(function (rawPair) {
    var safePair = asObject(rawPair)
    return {
      origin: blankFallback(safePair.origin),
      note: normalizeHandwrittenText(safePair.note),
    }
  })
  normalized.stylePairColumns = splitStylePairColumns(normalized.stylePairs)
  return normalized
}

function splitStylePairColumns(stylePairs) {
  var pairs = Array.isArray(stylePairs) ? stylePairs.slice(0, 7) : []
  if (pairs.length <= 4) return [pairs]
  return [pairs.slice(0, 4), pairs.slice(4, 7)]
}

function stylePairTemplate(pair) {
  var safePair = asObject(pair)
  return html`<div class="icono-label-style-pair">
    <div class="icono-label-origin-text">${blankFallback(safePair.origin)}</div>
    <div class="icono-label-hand-note icono-label-hand-note--style">
      ${normalizeHandwrittenText(safePair.note)}
    </div>
  </div>`
}

function styleColumnTemplate(column, index) {
  var safeColumn = Array.isArray(column) ? column : []
  var columnClass =
    "icono-label-style-column icono-label-style-column--" + (index === 0 ? "left" : "right")
  return html`<div class=${columnClass}>${safeColumn.map(stylePairTemplate)}</div>`
}

function styleStackTemplate(model) {
  var columns = Array.isArray(model.stylePairColumns)
    ? model.stylePairColumns
    : splitStylePairColumns(model.stylePairs)
  var stackClass = "icono-label-style-stack"
  if (columns.length > 1) stackClass += " icono-label-style-stack--two-column"
  return html`<div class=${stackClass}>${columns.map(styleColumnTemplate)}</div>`
}

function resolveCardModel(payload) {
  var safePayload = asObject(payload)
  if (safePayload.symbol && Array.isArray(safePayload.stylePairs)) {
    return normalizeCardModelHandwriting(safePayload)
  }
  var shared = sharedCardRuntime()
  if (shared && typeof shared.resolveArchivalCardModel === "function") {
    return normalizeCardModelHandwriting(
      shared.resolveArchivalCardModel(safePayload.gene || safePayload, safePayload.options),
    )
  }
  return normalizeCardModelHandwriting(safePayload)
}

function modelOpensInNewTab(model) {
  return String((model && model.titleLinkAttrs) || "").indexOf('target="_blank"') >= 0
}

function penLoopFallbackMarkup() {
  return (
    '<path d="M 8 18 C 8 10, 21 5, 65 5 C 108 5, 124 10, 124 17 C 124 24, 108 29, 66 29 C 22 29, 8 24, 8 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M 12 21 C 15 13, 29 10, 66 10 C 101 10, 114 12, 119 17" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-dasharray="2.5 4"/>'
  )
}

function penLoopSvgMarkup(className, presetName) {
  roughLoopSerial += 1
  var loopSeed = 9001 + roughLoopSerial * 97
  return (
    '<svg class="' +
    String(className || "icono-pen-loop") +
    '" data-icono-rough-loop="true" data-icono-rough-preset="' +
    String(presetName || "default") +
    '" data-icono-rough-seed="' +
    String(loopSeed) +
    '" viewBox="0 0 132 34" preserveAspectRatio="none" aria-hidden="true">' +
    penLoopFallbackMarkup() +
    "</svg>"
  )
}

// ARCHITECTURE FENCE [IPD-003]: match the shared string renderer's accessible
// mapping contract. These alternatives are non-interactive printed decoration;
// the containing field names the resolved molecular and character values.
function optionTemplate(value, selected, extraClass, loopPreset) {
  var classes = "icono-label-option"
  if (extraClass) classes += " " + extraClass
  if (selected) classes += " is-selected"
  return html`<span aria-hidden="true" class=${classes}
    ><span class="icono-label-option-copy" data-icono-rough-copy="true">${value}</span>${selected
      ? unsafeHTML(penLoopSvgMarkup("icono-label-option-loop", loopPreset))
      : nothing}</span
  >`
}

function voteShellTemplate(voteHtml) {
  var resolved = String(voteHtml || "").trim()
  return resolved ? html`${unsafeHTML(resolved)}` : html`<div class="icono-label-qc-empty"></div>`
}

function familyTraitTemplate(familyFeature) {
  if (!String(familyFeature || "").trim()) {
    return html`<div
      class="icono-label-family-trait-field icono-label-family-trait-field--empty"
    ></div>`
  }
  return html`<div class="icono-label-family-trait-field">
    <div class="icono-label-hand-note icono-label-hand-note--family-trait">${familyFeature}</div>
  </div>`
}

function categoryFieldTemplate(selectedCategory) {
  var categoryKey = String(selectedCategory || "")
    .trim()
    .toLowerCase()
  return html`<div
    class="icono-label-category-grid"
    role="img"
    aria-label=${"Molecular category: " + (categoryKey || "not specified")}
  >
    <div class="icono-label-category-option icono-label-category-option--transmembrane">
      ${optionTemplate(
        "TRANSMEMBRANE",
        categoryKey === "transmembrane",
        "",
        "category-transmembrane",
      )}
    </div>
    <div class="icono-label-category-option icono-label-category-option--soluble">
      ${optionTemplate("SOLUBLE", categoryKey === "soluble", "", "category-soluble")}
    </div>
  </div>`
}

function sexNoteTemplate(sexNote, selectedCategory) {
  var note = String(sexNote || "")
    .trim()
    .toLowerCase()
  if (!note) return nothing
  var categoryKey = String(selectedCategory || "")
    .trim()
    .toLowerCase()
  var noteClass =
    "icono-label-hand-note icono-label-hand-note--sex icono-label-hand-note--sex-" +
    (categoryKey || "unselected")
  return html`<div role="note" aria-label=${"Character sex: " + note} class=${noteClass}>
    ${note}
  </div>`
}

function alignmentFieldTemplate(molecularAlignment, politicalNote) {
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
  return html`<div
    class="icono-label-alignment-grid"
    role="group"
    aria-label="Molecular alignment to character alignment mapping"
  >
    <div
      role="img"
      aria-label=${"Molecular alignment: " + (molecularKey || "neither")}
      class=${"icono-label-selector-row icono-label-selector-row--alignment" +
      (isNeither ? " is-neither" : "")}
    >
      ${optionTemplate("ONCOGENE", isOncogene, "", "alignment-oncogene")}
      ${optionTemplate("TUMOR SUPPRESSOR", isTumorSuppressor, "", "alignment-tumor-suppressor")}
      ${isNeither
        ? html`<span class="icono-label-alignment-strike" aria-hidden="true"></span>`
        : nothing}
    </div>
    <div
      role="note"
      aria-label=${"Character alignment: " + (politicalNote || "not specified")}
      class=${noteClass}
    >
      ${politicalNote}
    </div>
  </div>`
}

function titleTemplate(model) {
  var titleInner = html`<div class="icono-label-caption">gene name</div>
    <div class="icono-label-symbol">${model.symbol}</div>
    <div class="icono-label-name">${model.fullName || model.symbol}</div>
    <div class="icono-label-registry-line">
      ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03
    </div>`
  if (model.titleHref) {
    return html`<a
      class="icono-label-title-link"
      href=${model.titleHref}
      target=${modelOpensInNewTab(model) ? "_blank" : nothing}
      rel=${modelOpensInNewTab(model) ? "noopener noreferrer" : nothing}
      >${titleInner}</a
    >`
  }
  return html`<div class="icono-label-title-block">${titleInner}</div>`
}

function footerTemplate(model) {
  return html`<div class="icono-label-footer-copy">
    <div class="icono-label-footer-copy-main">
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        labelled / inspected / filed
      </div>
      <a
        class="icono-label-footer-line icono-label-footer-line--typed icono-label-print-copy-request"
        data-icono-print-copy
        data-icono-print-copy-symbol=${model.symbol || ""}
        role="button"
        aria-disabled="true"
      >
        request print copy
      </a>
      <div class="icono-label-footer-line icono-label-footer-line--typed">
        seal after review / do not expose to open air
      </div>
    </div>
    <div class="icono-label-footer-copy-side">
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        brinedew institute / internal matter
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        keep away from heat and moisture
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">
        registry copy retained in cabinet 5A
      </div>
    </div>
  </div>`
}

function sheetTemplate(model) {
  var sheetVoteHtml = model.voteHtml
  return html`<div class="icono-label-sheet-body">
    <div class="icono-label-header-row">
      ${titleTemplate(model)}
      <div class="icono-label-header-stack">
        <div class="icono-label-header-meta">
          <div class="icono-label-header-meta-cell">
            <div class="icono-label-caption">emulsion no.</div>
            <div class="icono-label-serial">${model.serial}</div>
          </div>
          <div class="icono-label-header-meta-cell">
            <div class="icono-label-caption">family</div>
            <div class="icono-label-family">${model.displayedFamily}</div>
          </div>
        </div>
        <div class="icono-label-filed-block">
          <div class="icono-label-caption">family trait</div>
          ${familyTraitTemplate(model.displayedFamilyFeature)}
        </div>
      </div>
      <div class="icono-label-qc-block">
        <div class="icono-label-caption">qc</div>
        ${voteShellTemplate(sheetVoteHtml)}
        <div class="icono-label-qc-meta">
          <div class="icono-label-qc-meta-item">inspect. A3</div>
          <div class="icono-label-qc-meta-item">plate 7</div>
        </div>
        <div class="icono-label-qc-note" data-icono-qc-note>pending review</div>
      </div>
    </div>
    <div class="icono-label-band-row">
      <div class="icono-label-row-label">field notes</div>
      <div class="icono-label-band-grid">
        <div class="icono-label-band-cell icono-label-band-cell--category">
          <div class="icono-label-caption">category</div>
          <div class="icono-label-band-primary">
            ${categoryFieldTemplate(model.selectedCategory)}
          </div>
          <div class="icono-label-band-secondary">
            ${sexNoteTemplate(model.sexNote, model.selectedCategory)}
          </div>
        </div>
        <div class="icono-label-band-cell icono-label-band-cell--noted">
          <div class="icono-label-caption">first noted</div>
          <div class="icono-label-band-primary">
            <div class="icono-label-typed-value icono-label-typed-value--band">
              ${blankFallback(model.firstNoted)}
            </div>
          </div>
          <div class="icono-label-band-secondary">
            <div class="icono-label-hand-note icono-label-hand-note--age">${model.ageNote}</div>
          </div>
        </div>
        <div class="icono-label-band-cell icono-label-band-cell--mass">
          <div class="icono-label-caption">mass</div>
          <div class="icono-label-band-primary">
            <div class="icono-label-mass-line">
              <span class="icono-label-mass-fill">
                <span class="icono-label-hand-note icono-label-hand-note--mass-number"
                  >${model.handwrittenWeight}</span
                >
              </span>
              <span class="icono-label-mass-unit-stack">
                <span
                  class="icono-label-typed-value icono-label-typed-value--band icono-label-typed-value--crossed icono-label-typed-value--unit-kda"
                  >kDa</span
                >
                <span class="icono-label-hand-note icono-label-hand-note--unit">kg</span>
              </span>
            </div>
          </div>
          <div class="icono-label-band-secondary"></div>
        </div>
      </div>
    </div>
    <div class="icono-label-style-row">
      <div class="icono-label-row-label">pfam clans</div>
      ${styleStackTemplate(model)}
    </div>
    <div class="icono-label-alignment-row">
      <div class="icono-label-row-label">alignment</div>
      <div class="icono-label-alignment-body">
        ${alignmentFieldTemplate(model.molecularAlignment, model.politicalNote)}
      </div>
    </div>
    <div class="icono-label-footer-row">
      <div class="icono-label-row-label">remarks</div>
      ${footerTemplate(model)}
    </div>
  </div>`
}

function mobilePeekTemplate(model) {
  if (!(model.mode === "brick" && model.mobileReview)) return nothing
  return html`<div class="icono-label-mobile-peek">
    <div
      role="button"
      tabindex="0"
      class="icono-label-mobile-peek-toggle"
      data-icono-label-mobile-toggle
      aria-expanded="false"
      aria-label="Show details for ${model.symbol}"
    >
      <span class="icono-label-mobile-peek-tab" aria-hidden="true">
        <span class="icono-label-mobile-peek-tab-symbol">${model.symbol}</span>
      </span>
      <span class="icono-label-mobile-peek-topline">
        <span class="icono-label-mobile-peek-kicker">full name</span>
      </span>
    </div>
    <a
      class="icono-label-mobile-peek-summary icono-label-mobile-open-link"
      href=${model.titleHref}
      data-icono-nav
      aria-label="Open ${model.symbol} gene page"
    >
      <span class="icono-label-mobile-peek-name">${model.fullName}</span>
    </a>
    <span class="icono-label-mobile-peek-swipe">${voteShellTemplate(model.voteHtml)}</span>
  </div>`
}

function archivalTemplate(model) {
  if (model.layoutVariant === "image-only") {
    return imageOnlyTemplate(model)
  }
  if (model.mode === "brick" && model.mobileReview) {
    return html`${mobilePeekTemplate(model)}
      <div class="icono-label-dossier-shell" data-icono-label-dossier-shell>
        <div class="icono-label-dossier-sheet">${sheetTemplate(model)}</div>
      </div>`
  }
  return sheetTemplate(model)
}

function imageOnlyTemplate(model) {
  var href = String(model.titleHref || "").trim()
  var portraitSrc = String(model.portraitSrc || "").trim()
  var portraitAlt =
    String(model.portraitAlt || "").trim() || (model.symbol ? model.symbol + " blot" : "Gene blot")
  var dims = asObject(model.portraitDimensions)
  var width = Number(dims.width || 0)
  var height = Number(dims.height || 0)
  var media = html`<div class="icono-image-only-media-stage">
    <div class="icono-image-only-loading-mark" aria-hidden="true"></div>
    ${portraitSrc
      ? html`<img
          class="icono-image-only-photo"
          src=${portraitSrc}
          alt=${portraitAlt}
          loading="eager"
          decoding="async"
          fetchpriority="high"
          width=${width > 0 ? String(Math.round(width)) : nothing}
          height=${height > 0 ? String(Math.round(height)) : nothing}
          @load=${function (event) {
            var img = event && event.currentTarget
            if (img && img.classList) img.classList.add("icono-image-only-photo--loaded")
            if (img && img.parentElement && img.parentElement.classList) {
              img.parentElement.classList.add("icono-image-only-media-stage--loaded")
            }
            if (img && img.closest) {
              var link = img.closest(".icono-image-only-link")
              if (link && link.classList) link.classList.add("icono-image-only-link--loaded")
            }
          }}
        />`
      : html`<div class="icono-image-only-fallback" aria-hidden="true"></div>`}
  </div>`
  var overlay = html`<div class="icono-image-only-overlay">
    <div class="icono-image-only-caption-row">
      <div class="icono-label-name icono-image-only-name">${model.fullName || model.symbol}</div>
      <div class="icono-label-symbol icono-image-only-symbol">${model.symbol}</div>
    </div>
  </div>`
  if (href) {
    return html`<a
      class="icono-image-only-link"
      href=${href}
      target=${modelOpensInNewTab(model) ? "_blank" : nothing}
      rel=${modelOpensInNewTab(model) ? "noopener noreferrer" : nothing}
      >${media}${overlay}</a
    >`
  }
  return html`<div class="icono-image-only-link">${media}${overlay}</div>`
}

function parsePayloadFromHost(host) {
  if (!host) return null
  var encoded = String(host.getAttribute(MODEL_ATTR) || "").trim()
  if (encoded) {
    try {
      return JSON.parse(decodeURIComponent(encoded))
    } catch (error) {
      console.error("[Iconoplasm] failed to parse lit-archival model attribute:", error)
    }
  }
  var node = host.querySelector(MODEL_SELECTOR)
  if (!node) return null
  try {
    return JSON.parse(node.textContent || "{}")
  } catch (error) {
    console.error("[Iconoplasm] failed to parse lit-archival payload:", error)
    return null
  }
}

class IconoLitArchivalCard extends HTMLElement {
  constructor() {
    super()
    this._model = null
  }

  connectedCallback() {
    if (!this._model) {
      var payload = parsePayloadFromHost(this)
      if (payload) this._model = resolveCardModel(payload)
    }
    this.render()
  }

  set model(value) {
    this._model = resolveCardModel(value)
    this.render()
  }

  get model() {
    return this._model
  }

  render() {
    if (!this._model) return
    render(archivalTemplate(this._model), this)
    var shared = sharedCardRuntime()
    if (shared && typeof shared.hydrateRoughLoops === "function") {
      shared.hydrateRoughLoops(this, true)
    }
  }
}

if (!customElements.get("icono-lit-archival")) {
  customElements.define("icono-lit-archival", IconoLitArchivalCard)
}
