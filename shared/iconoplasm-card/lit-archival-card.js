import { html, nothing, render } from "lit"
import { unsafeHTML } from "lit/directives/unsafe-html.js"

var MODEL_SELECTOR = 'script[type="application/json"][data-icono-lit-archival-model]'
var roughLoopSerial = 0

function sharedCardRuntime() {
  return globalThis && globalThis.IconoplasmCardShared ? globalThis.IconoplasmCardShared : null
}

function normalizedSymbol(symbol) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.normalizedSymbol === "function") {
    return shared.normalizedSymbol(symbol)
  }
  return String(symbol || "")
    .trim()
    .toUpperCase()
}

function uniqueDisplayValues(values, limit) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.uniqueDisplayValues === "function") {
    return shared.uniqueDisplayValues(values, limit)
  }
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

function normalizePoliticsDisplay(rawPolitics, rawPoliticsOrigin) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.normalizePoliticsDisplay === "function") {
    return shared.normalizePoliticsDisplay(rawPolitics, rawPoliticsOrigin)
  }
  var politics = String(rawPolitics || "").trim()
  var politicsOriginValues = uniqueDisplayValues(rawPoliticsOrigin, 2)
  var politicsOrigin = politicsOriginValues.length
    ? String(politicsOriginValues[0] || "").trim()
    : ""
  var politicsKey = politics.toLowerCase().replace(/\s+/g, " ").trim()
  var originKey = politicsOrigin.toLowerCase().replace(/\s+/g, " ").trim()
  var character = ""
  var molecular = ""

  if (politicsKey === "pro-growth" || politicsKey === "pro growth") character = "pro-growth"
  else if (politicsKey === "pro-control" || politicsKey === "pro control")
    character = "pro-control"
  else if (politicsKey === "turncoat") character = "turncoat"
  else if (politicsKey === "neutral" || politicsKey === "housekeeper") {
    return { character: "", molecular: "", isNeutral: true }
  }

  if (originKey === "oncogene") molecular = "oncogene"
  else if (originKey === "tumor suppressor") molecular = "tumor suppressor"
  else if (originKey === "contextual oncogene/tumor suppressor") {
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

function labLabelCatalogNumber(symbol) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.labLabelCatalogNumber === "function") {
    return shared.labLabelCatalogNumber(symbol)
  }
  var safe = normalizedSymbol(symbol)
  if (!safe) return "00000"
  var hash = 2166136261
  for (var i = 0; i < safe.length; i++) {
    hash ^= safe.charCodeAt(i)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return String(Math.abs(hash >>> 0) % 100000).padStart(5, "0")
}

function labLabelEmulsionNumber(portrait) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.labLabelEmulsionNumber === "function") {
    return shared.labLabelEmulsionNumber(portrait)
  }
  var safePortrait = portrait && typeof portrait === "object" ? portrait : {}
  var explicitArtistId = String(safePortrait.artist_id || safePortrait.emulsion_id || "").trim()
  if (explicitArtistId) return explicitArtistId
  var visionId = String(safePortrait.vision_id || "").trim().toLowerCase()
  if (/^[a-z0-9-]+-v\d+-\d+$/.test(visionId)) {
    var match = visionId.match(/-(\d+)$/)
    if (match) return String(Number.parseInt(match[1], 10) || "")
  }
  var candidateImageId = Number(safePortrait.candidate_image_id)
  if (Number.isFinite(candidateImageId) && candidateImageId > 0) {
    return String(Math.round(candidateImageId))
  }
  return ""
}

function labLabelDisplayName(geneDetail) {
  var shared = sharedCardRuntime()
  if (shared && typeof shared.labLabelDisplayName === "function") {
    return shared.labLabelDisplayName(geneDetail)
  }
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

function resolveCardModel(payload) {
  var safePayload = asObject(payload)
  var safeGeneDetail = asObject(safePayload.gene)
  var safeEssence = asObject(safeGeneDetail.essence)
  var safeOptions = asObject(safePayload.options)
  var safePortrait = asObject(safeGeneDetail.portrait)
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
  if (safeEssence.age) ageNote = String(safeEssence.age).trim()
  else if (safeEssence.age_years != null && Number.isFinite(Number(safeEssence.age_years))) {
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
  var mode = String(safeOptions.mode || "sheet")
    .trim()
    .toLowerCase()
  return {
    color: String(safeGeneDetail.color || "")
      .trim()
      .toUpperCase(),
    displayedFamily: displayedFamily,
    displayedFamilyFeature: displayedFamilyFeature,
    firstNoted: firstNoted,
    fullName: fullName,
    mobileReview: !!safeOptions.mobileReview,
    mode: mode === "brick" ? "brick" : "sheet",
    molecularAlignment: String(politicsDisplay.molecular || "").trim().toLowerCase(),
    politicalNote: String(politicsDisplay.character || "").trim(),
    selectedCategory: selectedCategory,
    serial: serial,
    sexNote: sexNote,
    stylePairs: stylePairs,
    symbol: symbol,
    titleHref: String(safeOptions.titleHref || "").trim(),
    voteHtml: String(safeOptions.voteHtml || ""),
    handwrittenWeight: handwrittenWeight,
    ageNote: addAgeSuffix(ageNote),
  }
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

function optionTemplate(value, selected, extraClass, loopPreset) {
  var classes = "icono-label-option"
  if (extraClass) classes += " " + extraClass
  if (selected) classes += " is-selected"
  return html`<span class=${classes}
    ><span class="icono-label-option-copy" data-icono-rough-copy="true">${value}</span
    >${selected ? unsafeHTML(penLoopSvgMarkup("icono-label-option-loop", loopPreset)) : nothing}</span
  >`
}

function voteShellTemplate(voteHtml) {
  var resolved = String(voteHtml || "").trim()
  return resolved
    ? html`${unsafeHTML(resolved)}`
    : html`<div class="icono-label-qc-empty"></div>`
}

function familyTraitTemplate(familyFeature) {
  if (!String(familyFeature || "").trim()) {
    return html`<div class="icono-label-family-trait-field icono-label-family-trait-field--empty"></div>`
  }
  return html`<div class="icono-label-family-trait-field">
    <div class="icono-label-hand-note icono-label-hand-note--family-trait">${familyFeature}</div>
  </div>`
}

function categoryFieldTemplate(selectedCategory) {
  var categoryKey = String(selectedCategory || "")
    .trim()
    .toLowerCase()
  return html`<div class="icono-label-category-grid">
    <div class="icono-label-category-option icono-label-category-option--transmembrane">
      ${optionTemplate("TRANSMEMBRANE", categoryKey === "transmembrane", "", "category-transmembrane")}
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
  return html`<div class=${noteClass}>${note}</div>`
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
  return html`<div class="icono-label-alignment-grid">
    <div class=${"icono-label-selector-row icono-label-selector-row--alignment" + (isNeither ? " is-neither" : "")}>
      ${optionTemplate("ONCOGENE", isOncogene, "", "alignment-oncogene")}
      ${optionTemplate("TUMOR SUPPRESSOR", isTumorSuppressor, "", "alignment-tumor-suppressor")}
      ${isNeither ? html`<span class="icono-label-alignment-strike" aria-hidden="true"></span>` : nothing}
    </div>
    <div class=${noteClass}>${politicalNote}</div>
  </div>`
}

function titleTemplate(model) {
  var titleInner = html`<div class="icono-label-caption">gene name</div>
    <div class="icono-label-symbol">${model.symbol}</div>
    <div class="icono-label-name">${model.fullName || model.symbol}</div>
    <div class="icono-label-registry-line">ICONOPLASM HUMAN GENE REGISTRY / ACCESSION SHEET 03</div>`
  if (model.titleHref) {
    return html`<a class="icono-label-title-link" href=${model.titleHref} data-icono-nav>${titleInner}</a>`
  }
  return html`<div class="icono-label-title-block">${titleInner}</div>`
}

function footerTemplate(model) {
  var stockTone = model.color || "UNFILED"
  var sheetNo = model.serial || "00000"
  return html`<div class="icono-label-footer-copy">
    <div class="icono-label-footer-copy-main">
      <div class="icono-label-footer-line icono-label-footer-line--caption">labelled / inspected / filed</div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">archive room b / bench 3 / human gene cabinet</div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">
        stock tone ${stockTone} / sheet ${sheetNo} / print run 07
      </div>
      <div class="icono-label-footer-line icono-label-footer-line--typed">seal after review / do not expose to open air</div>
    </div>
    <div class="icono-label-footer-copy-side">
      <div class="icono-label-footer-line icono-label-footer-line--caption">brinedew institute / internal matter</div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">keep away from heat and moisture</div>
      <div class="icono-label-footer-line icono-label-footer-line--caption">registry copy retained in cabinet 5A</div>
    </div>
  </div>`
}

function sheetTemplate(model) {
  var sheetVoteHtml = model.mode === "brick" && model.mobileReview ? "" : model.voteHtml
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
          <div class="icono-label-band-primary">${categoryFieldTemplate(model.selectedCategory)}</div>
          <div class="icono-label-band-secondary">${sexNoteTemplate(model.sexNote, model.selectedCategory)}</div>
        </div>
        <div class="icono-label-band-cell icono-label-band-cell--noted">
          <div class="icono-label-caption">first noted</div>
          <div class="icono-label-band-primary">
            <div class="icono-label-typed-value icono-label-typed-value--band">${blankFallback(model.firstNoted)}</div>
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
                <span class="icono-label-hand-note icono-label-hand-note--mass-number">${model.handwrittenWeight}</span>
              </span>
              <span class="icono-label-typed-value icono-label-typed-value--band icono-label-typed-value--crossed icono-label-typed-value--unit-kda">kDa</span>
              <span class="icono-label-hand-note icono-label-hand-note--unit">kg</span>
            </div>
          </div>
          <div class="icono-label-band-secondary"></div>
        </div>
      </div>
    </div>
    <div class="icono-label-style-row">
      <div class="icono-label-row-label">pfam clans</div>
      <div class="icono-label-style-stack">
        ${model.stylePairs.map(function (pair) {
          return html`<div class="icono-label-style-pair">
            <div class="icono-label-origin-text">${pair.origin}</div>
            <div class="icono-label-hand-note icono-label-hand-note--style">${pair.note}</div>
          </div>`
        })}
      </div>
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
    <button type="button" class="icono-label-mobile-peek-toggle" data-icono-label-mobile-toggle aria-expanded="false">
      <span class="icono-label-mobile-peek-tab" aria-hidden="true">
        <svg class="icono-label-mobile-peek-tab-art" viewBox="0 0 188 72" preserveAspectRatio="none" focusable="false" aria-hidden="true">
          <path class="icono-label-mobile-peek-tab-fill" d="M6 72V44C6 39.6 9.6 36 14 36H51.4C58.6 36 64.7 31.3 69.1 22.1C73.1 13.8 79.6 8 94 8C108.4 8 114.9 13.8 118.9 22.1C123.3 31.3 129.4 36 136.6 36H174C178.4 36 182 39.6 182 44V72H6Z"></path>
          <path class="icono-label-mobile-peek-tab-highlight" d="M17 42.6H50.2C61.5 42.6 70.8 34.9 76.5 22.8C80.1 15.1 84.8 11.8 94 11.8C103.2 11.8 107.9 15.1 111.5 22.8C117.2 34.9 126.5 42.6 137.8 42.6H171"></path>
        </svg>
        <span class="icono-label-mobile-peek-tab-symbol">${model.symbol}</span>
      </span>
      <span class="icono-label-mobile-peek-topline">
        <span class="icono-label-mobile-peek-kicker">full name</span>
        <span class="icono-label-mobile-peek-instruction icono-label-mobile-peek-instruction--closed">tap to open</span>
        <span class="icono-label-mobile-peek-instruction icono-label-mobile-peek-instruction--open">tap to close</span>
      </span>
      <span class="icono-label-mobile-peek-summary">
        <span class="icono-label-mobile-peek-name">${model.fullName}</span>
      </span>
    </button>
    <div class="icono-label-mobile-peek-swipe">${voteShellTemplate(model.voteHtml)}</div>
  </div>`
}

function archivalTemplate(model) {
  if (model.mode === "brick" && model.mobileReview) {
    return html`${mobilePeekTemplate(model)}
      <div class="icono-label-dossier-shell" data-icono-label-dossier-shell>
        <div class="icono-label-dossier-sheet">${sheetTemplate(model)}</div>
      </div>`
  }
  return sheetTemplate(model)
}

function parsePayloadFromNode(node) {
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
      var payloadNode = this.querySelector(MODEL_SELECTOR)
      var payload = parsePayloadFromNode(payloadNode)
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

