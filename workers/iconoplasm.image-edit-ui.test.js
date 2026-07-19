import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("B-517 edit blot UI uses one dialog modal and the direct image-edit APIs", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const head = readFileSync(new URL("../quartz/components/Head.tsx", import.meta.url), "utf8")
  const css = readFileSync(
    new URL("../quartz/static/iconoplasm/styles.css", import.meta.url),
    "utf8",
  )
  const dialogStart = app.indexOf("function renderImageEditDialogMarkup")
  const dialogEnd = app.indexOf("function ensureImageEditDialog")
  assert.notEqual(dialogStart, -1)
  assert.notEqual(dialogEnd, -1)
  const dialogMarkup = app.slice(dialogStart, dialogEnd)
  const adjustmentListCss =
    css.match(/(?:^|\n)\.icono-image-edit-adjustments\s*\{[^}]*\}/)?.[0] || ""
  const adjustmentRowCss =
    css.match(/(?:^|\n)\.icono-image-edit-adjustment-row\s*\{[^}]*\}/)?.[0] || ""
  const adjustmentCheckboxCss =
    css.match(/(?:^|\n)\.icono-image-edit-adjustment-row sl-checkbox\s*\{[^}]*\}/)?.[0] || ""
  const adjustmentCheckboxLabelCss =
    css.match(
      /(?:^|\n)\.icono-image-edit-adjustment-row sl-checkbox::part\(label\)\s*\{[^}]*\}/,
    )?.[0] || ""
  const adjustmentValueCss =
    css.match(/(?:^|\n)\.icono-image-edit-adjustment-value\s*\{[^}]*\}/)?.[0] || ""
  const modalControlCss =
    css.match(
      /(?:^|\n)\.icono-image-edit-dialog sl-select,\s*\n\.icono-image-edit-dialog sl-button,\s*\n\.icono-image-edit-dialog sl-checkbox\s*\{[^}]*\}/,
    )?.[0] || ""
  const modalLabelPartCss =
    css.match(
      /(?:^|\n)\.icono-image-edit-dialog sl-select::part\(form-control-label\),\s*\n\.icono-image-edit-dialog sl-button::part\(base\),\s*\n\.icono-image-edit-dialog sl-checkbox::part\(label\)\s*\{[^}]*\}/,
    )?.[0] || ""
  const modalVariablePartCss =
    css.match(
      /(?:^|\n)\.icono-image-edit-dialog sl-select::part\(combobox\),\s*\n\.icono-image-edit-dialog sl-select::part\(display-input\),\s*\n\.icono-image-edit-dialog sl-option::part\(label\)\s*\{[^}]*\}/,
    )?.[0] || ""
  assert.ok(adjustmentListCss)
  assert.ok(adjustmentRowCss)
  assert.ok(adjustmentCheckboxCss)
  assert.ok(adjustmentCheckboxLabelCss)
  assert.ok(adjustmentValueCss)
  assert.ok(modalControlCss)
  assert.ok(modalLabelPartCss)
  assert.ok(modalVariablePartCss)

  assert.match(app, /data-icono-image-edit-dialog/)
  assert.match(app, /<sl-dialog/)
  assert.match(app, /<sl-select/)
  assert.match(app, /<sl-checkbox/)
  assert.match(app, /data-icono-image-edit-submit/)
  assert.doesNotMatch(dialogMarkup, /data-icono-image-edit-cancel/)
  assert.doesNotMatch(app, /<sl-input/)
  assert.doesNotMatch(app, /<sl-color-picker/)
  assert.doesNotMatch(dialogMarkup, /<sl-alert/)
  assert.doesNotMatch(dialogMarkup, /textarea/i)
  assert.doesNotMatch(dialogMarkup, /data-icono-image-edit-prompt/)
  assert.doesNotMatch(dialogMarkup, /api key/i)
  assert.match(
    dialogMarkup,
    /<button type="button" class="icono-image-edit-action-button icono-image-edit-action-button--primary" data-icono-image-edit-submit disabled>Edit<\/button>/,
  )
  assert.match(
    dialogMarkup,
    /<button type="button" class="icono-image-edit-action-button" data-icono-image-edit-publish hidden disabled>Publish<\/button>/,
  )
  assert.ok(
    dialogMarkup.indexOf("data-icono-image-edit-submit") <
      dialogMarkup.indexOf("data-icono-image-edit-publish"),
  )
  assert.doesNotMatch(app, /data-icono-image-edit-api-key/)
  assert.doesNotMatch(app, /data-icono-image-edit-save-provider/)
  assert.doesNotMatch(app, /function saveImageEditProvider/)
  assert.match(app, /\.show\(/)
  assert.match(app, /\/api\/iconoplasm\/image-edit\/providers/)
  assert.match(app, /\/api\/iconoplasm\/image-edit\/jobs/)
  assert.match(
    app,
    /selectedValue = lastUsedValue \|\| \(options\.length \? options\[0\]\.value : ""\)/,
  )
  assert.match(
    app,
    /options\.sort\(function \(a, b\) \{\s*return a\.label\.localeCompare\(b\.label, undefined, \{ sensitivity: "base", numeric: true \}\)\s*\}\)/,
  )
  assert.match(app, /last used/)
  assert.doesNotMatch(app, /options\.unshift\(\{ value: lastUsedValue/)
  assert.match(app, /payload\.last_used/)
  assert.match(app, /function setImageEditProviderValue\(select, providerId\)/)
  assert.match(app, /customElements\.whenDefined\("sl-select"\)/)
  assert.match(app, /select\.updateComplete\.then\(function \(\) \{/)
  assert.match(
    app,
    /\/api\/iconoplasm\/image-edit\/jobs\/" \+ encodeURIComponent\(state\.job\.id\) \+ "\/publish/,
  )
  assert.match(app, /renderEditImageActionMarkup\("canonical", g/)
  assert.match(app, /data-icono-edit-source="candidate"/)
  assert.match(app, /data-icono-source-adjustments/)
  assert.match(app, /function imageEditSourceAdjustmentContext\(genePayload, item\)/)
  assert.match(dialogMarkup, />Sex<\/sl-checkbox>/)
  assert.match(dialogMarkup, />Feature<\/sl-checkbox>/)
  assert.doesNotMatch(dialogMarkup, /Sex presentation/)
  assert.doesNotMatch(dialogMarkup, /Humanize feature/)
  assert.match(app, /imageEditFirstTextValue\(context\.sex\)/)
  assert.match(app, /imageEditFirstNumberValue\(source\.age_years\)/)
  assert.match(app, /imageEditFirstTextListValue\(source\.fashion_styles\)/)
  assert.match(app, /img-comparison-slider\.js/)
  assert.match(app, /<img-comparison-slider/)
  assert.match(head, /shoelace-autoloader\.js/)
  assert.match(head, /shoelace\/cdn\/themes\/light\.css/)
  assert.doesNotMatch(app, /Small correction prompt/)
  assert.doesNotMatch(app, /request_kind: "edit_image"/)
  assert.match(css, /\.icono-image-edit-dialog::part\(panel\)/)
  assert.match(css, /\.icono-image-edit-dialog::part\(overlay\)/)
  assert.match(css, /--sl-font-sans:\s*"IBM Plex Mono", monospace/)
  assert.match(css, /--icono-action-font:\s*"IBM Plex Mono", monospace/)
  assert.match(modalControlCss, /font-family:\s*var\(--icono-action-font\)\s*!important/)
  assert.match(modalLabelPartCss, /font-family:\s*var\(--icono-action-font\)\s*!important/)
  assert.doesNotMatch(modalLabelPartCss, /Special Elite/)
  assert.match(css, /\.icono-image-edit-action-button\s*\{/)
  assert.match(css, /\.icono-image-edit-action-button--primary\s*\{/)
  assert.match(css, /\.icono-image-edit-action-button\[hidden\]\s*\{/)
  assert.match(css, /font-family:\s*var\(--icono-action-font\)\s*!important/)
  assert.doesNotMatch(dialogMarkup, /icono-image-edit-action-step-number/)
  assert.match(modalVariablePartCss, /font-family:\s*"Special Elite", Georgia, serif/)
  assert.doesNotMatch(modalVariablePartCss, /IBM Plex Mono/)
  assert.match(adjustmentListCss, /grid-template-columns:\s*1fr/)
  assert.match(adjustmentRowCss, /grid-template-columns:\s*max-content minmax\(0, 1fr\)/)
  assert.match(adjustmentCheckboxCss, /overflow:\s*visible/)
  assert.match(adjustmentCheckboxLabelCss, /font-family:\s*"IBM Plex Mono", monospace/)
  assert.doesNotMatch(adjustmentCheckboxLabelCss, /Special Elite/)
  assert.match(adjustmentCheckboxLabelCss, /text-overflow:\s*clip/)
  assert.match(adjustmentValueCss, /font-family:\s*"Special Elite", Georgia, serif/)
  assert.doesNotMatch(adjustmentValueCss, /IBM Plex Mono/)
  assert.match(adjustmentValueCss, /white-space:\s*nowrap/)
  assert.match(adjustmentValueCss, /text-overflow:\s*ellipsis/)
  assert.match(adjustmentValueCss, /overflow:\s*hidden/)
  assert.doesNotMatch(
    adjustmentListCss,
    /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
  )
  assert.doesNotMatch(adjustmentRowCss, /border-radius:\s*8px/)
  assert.match(css, /\.icono-image-edit-before-after/)
  assert.match(css, /img-comparison-slider\.rendered/)
  assert.match(
    head,
    /setAttribute\(['"]data-shoelace['"],\s*['"]\/static\/iconoplasm\/vendor\/shoelace\/cdn['"]\)/,
  )
  assert.doesNotMatch(head, /data-shoelace=\{joinSegments/)
})

test("publish failures show what was preserved, the recovery action, and a reference", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const css = readFileSync(
    new URL("../quartz/static/iconoplasm/styles.css", import.meta.url),
    "utf8",
  )
  const formatterStart = app.indexOf("function publishFailureMessage")
  const formatterEnd = app.indexOf("var iconoplasmQueryInflight", formatterStart)
  const imagePublishStart = app.indexOf("function publishImageEditJob")
  const imagePublishEnd = app.indexOf("function wireImageEditDialog", imagePublishStart)
  const directPublishStart = app.indexOf("function publishDirectCandidateGeneration")
  const directPublishEnd = app.indexOf("function closeResults", directPublishStart)
  assert.notEqual(formatterStart, -1)
  assert.notEqual(formatterEnd, -1)
  assert.notEqual(imagePublishStart, -1)
  assert.notEqual(imagePublishEnd, -1)
  assert.notEqual(directPublishStart, -1)
  assert.notEqual(directPublishEnd, -1)
  const formatter = app.slice(formatterStart, formatterEnd)
  const imagePublish = app.slice(imagePublishStart, imagePublishEnd)
  const directPublish = app.slice(directPublishStart, directPublishEnd)

  assert.match(formatter, /failure\.preserved_message/)
  assert.match(formatter, /failure\.next_action/)
  assert.match(formatter, /Reference:/)
  assert.match(formatter, /failure\.job_id/)
  assert.match(formatter, /Check your connection, then retry Publish/)
  assert.match(formatter, /The image will not be regenerated/)
  assert.match(
    imagePublish,
    /publishFailureMessage\(error, "Could not publish edit\.", "edited image"\)/,
  )
  assert.match(
    directPublish,
    /publishFailureMessage\(error, "Could not publish candidate\.", "generated image"\)/,
  )
  assert.match(imagePublish, /state\.job = error\.payload\.job/)
  assert.match(directPublish, /requestDirectState\.job = error\.payload\.job/)
  assert.match(css, /\.icono-image-edit-status\s*\{[^}]*white-space:\s*pre-line/s)
  assert.match(css, /\[data-icono-request-note\]\s*\{[^}]*white-space:\s*pre-line/s)
})

test("B-517 removes image provider secrets from browser settings storage", () => {
  const settings = readFileSync(
    new URL("../quartz/static/site-settings/app.js", import.meta.url),
    "utf8",
  )
  const preferences = readFileSync(
    new URL("../quartz/static/site-preferences.js", import.meta.url),
    "utf8",
  )
  const bridge = readFileSync(
    new URL("../quartz/static/site-preferences/bridge.html", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(settings, /site-settings-api-key|generationApiKey/)
  assert.match(settings, /site-settings-image-api-provider/)
  assert.doesNotMatch(settings, /site-settings-image-api-model/)
  assert.doesNotMatch(settings, /site-settings-image-api-price/)
  assert.match(settings, /\/api\/iconoplasm\/image-edit\/providers/)
  assert.doesNotMatch(preferences, /generationApiKey:\s*trimStoredValue|generationApiKey:\s*""/)
  assert.doesNotMatch(bridge, /generationApiKey:\s*trimStoredValue|generationApiKey:\s*""/)
  assert.match(preferences, /hasLegacyIconoplasmProviderSettings/)
  assert.match(bridge, /hasLegacyIconoplasmProviderSettings/)
})

test("Iconoplasm settings exposes user emulsion editing without showing generation transport details", () => {
  const settings = readFileSync(
    new URL("../quartz/static/site-settings/app.js", import.meta.url),
    "utf8",
  )
  const css = readFileSync(
    new URL("../quartz/static/site-settings/styles.css", import.meta.url),
    "utf8",
  )

  assert.match(settings, /site-settings-user-emulsion/)
  assert.match(settings, /site-settings-user-emulsion-version/)
  assert.match(settings, /\/api\/iconoplasm\/user-emulsion/)
  assert.match(settings, /maxlength="140"/)
  assert.match(settings, /Emulsion/)
  assert.doesNotMatch(settings, /Autosaving emulsion|Waiting to autosave|Emulsion autosaved/)
  assert.doesNotMatch(settings, /Novel API generation/)
  assert.doesNotMatch(settings, /Reference images/)
  assert.match(css, /\.site-settings-emulsion-meter/)
})

test("direct API generation can submit a selected shared user emulsion from its own picker", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const directStart = app.indexOf("function submitDirectCandidateGeneration")
  const directEnd = app.indexOf("function publishDirectCandidateGeneration", directStart)
  assert.notEqual(directStart, -1)
  assert.notEqual(directEnd, -1)
  const direct = app.slice(directStart, directEnd)

  assert.match(app, /option_type/)
  assert.match(app, /user_emulsion_id/)
  assert.match(app, /data-icono-request-direct-emulsion-picker/)
  assert.match(direct, /selectedDirectUserEmulsionId\(\)/)
  assert.match(direct, /user_emulsion_id:\s*selectedDirectUserEmulsionId\(\)/)
})

test("request dialog opens idle instead of focusing and opening the emulsion picker", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const openStart = app.indexOf("function openRequestDialog")
  const openEnd = app.indexOf("if (dialogOpenButton)", openStart)
  assert.notEqual(openStart, -1)
  assert.notEqual(openEnd, -1)
  const openRequestDialog = app.slice(openStart, openEnd)

  assert.doesNotMatch(openRequestDialog, /data-icono-request-query/)
  assert.doesNotMatch(openRequestDialog, /\.focus\(/)
  assert.doesNotMatch(openRequestDialog, /requestAnimationFrame/)
})

test("edit blot controls rehydrate adjustment context when rich gene essence arrives", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const refreshStart = app.indexOf("function refreshGeneEditImageAdjustmentContext")
  const refreshEnd = app.indexOf("function wireGeneEditImagePanel", refreshStart)
  const wireStart = app.indexOf("function wireGeneEditImagePanel")
  const wireEnd = app.indexOf("function wireGeneRequestPanel", wireStart)
  const geneWireStart = app.indexOf("function wireGeneContent")
  const geneWireEnd = app.indexOf("/* ─── Gene page: resampling suggestions", geneWireStart)
  assert.notEqual(refreshStart, -1)
  assert.notEqual(refreshEnd, -1)
  assert.notEqual(wireStart, -1)
  assert.notEqual(wireEnd, -1)
  assert.notEqual(geneWireStart, -1)
  assert.notEqual(geneWireEnd, -1)
  const refreshGeneEditImageAdjustmentContext = app.slice(refreshStart, refreshEnd)
  const wireGeneEditImagePanel = app.slice(wireStart, wireEnd)
  const wireGeneContent = app.slice(geneWireStart, geneWireEnd)

  assert.match(
    refreshGeneEditImageAdjustmentContext,
    /setAttribute\(\s*"data-icono-source-adjustments"/,
  )
  assert.match(
    refreshGeneEditImageAdjustmentContext,
    /imageEditSourceAdjustmentContext\(genePayload,\s*sourceItem/,
  )
  assert.match(
    wireGeneEditImagePanel,
    /refreshGeneEditImageAdjustmentContext\(container,\s*genePayload\)/,
  )
  assert.match(wireGeneEditImagePanel, /data-icono-edit-wired/)
  assert.match(wireGeneContent, /wireGeneEditImagePanel\(container,\s*genePayload\)/)
})

test("edit blot mass adjustment accepts titan-scale gene essence mass", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const availableStart = app.indexOf("function imageEditContextValueAvailable")
  const availableEnd = app.indexOf("function imageEditContextValueLabel", availableStart)
  assert.notEqual(availableStart, -1)
  assert.notEqual(availableEnd, -1)
  const available = app.slice(availableStart, availableEnd)

  assert.match(available, /kind === "mass_kg"/)
  assert.match(available, /value > 0/)
  assert.doesNotMatch(available, /value <= 500/)
})

test("edit blot preview swaps the source viewer for the comparison viewer after an edit", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const css = readFileSync(
    new URL("../quartz/static/iconoplasm/styles.css", import.meta.url),
    "utf8",
  )
  const dialogStart = app.indexOf("function renderImageEditDialogMarkup")
  const dialogEnd = app.indexOf("function ensureImageEditDialog", dialogStart)
  const renderActionStart = app.indexOf("function renderEditImageActionMarkup")
  const renderActionEnd = app.indexOf("var imageEditDialogState", renderActionStart)
  const openStart = app.indexOf("function openImageEditDialog")
  const openEnd = app.indexOf("function sourceFromEditButton", openStart)
  const sourceStart = app.indexOf("function sourceFromEditButton")
  const sourceEnd = app.indexOf("function submitImageEdit", sourceStart)
  const submitStart = app.indexOf("function submitImageEdit")
  const submitEnd = app.indexOf("function publishImageEditJob", submitStart)
  assert.notEqual(dialogStart, -1)
  assert.notEqual(dialogEnd, -1)
  assert.notEqual(renderActionStart, -1)
  assert.notEqual(renderActionEnd, -1)
  assert.notEqual(openStart, -1)
  assert.notEqual(openEnd, -1)
  assert.notEqual(sourceStart, -1)
  assert.notEqual(sourceEnd, -1)
  assert.notEqual(submitStart, -1)
  assert.notEqual(submitEnd, -1)
  const dialogMarkup = app.slice(dialogStart, dialogEnd)
  const renderEditImageActionMarkup = app.slice(renderActionStart, renderActionEnd)
  const openImageEditDialog = app.slice(openStart, openEnd)
  const sourceFromEditButton = app.slice(sourceStart, sourceEnd)
  const submitImageEdit = app.slice(submitStart, submitEnd)
  const artboardCss = css.match(/(?:^|\n)\.icono-image-edit-artboard\s*\{[^}]*\}/)?.[0] || ""
  const beforeAfterCss = css.match(/(?:^|\n)\.icono-image-edit-before-after\s*\{[^}]*\}/)?.[0] || ""
  const comparisonCss = css.match(/(?:^|\n)\.icono-image-edit-comparison\s*\{[^}]*\}/)?.[0] || ""
  const previewImageCss =
    css.match(
      /(?:^|\n)\.icono-image-edit-artboard > img,\s*\n\.icono-image-edit-before-after img\s*\{[^}]*\}/,
    )?.[0] || ""

  assert.match(dialogMarkup, /data-icono-image-edit-source-viewer/)
  assert.match(dialogMarkup, /data-icono-image-edit-source-img/)
  assert.match(dialogMarkup, /data-icono-image-edit-result hidden/)
  assert.match(openImageEditDialog, /sourceViewer\.hidden = false/)
  assert.match(openImageEditDialog, /result\.hidden = true/)
  assert.match(submitImageEdit, /sourceViewer\.hidden = false/)
  assert.match(submitImageEdit, /result\.hidden = true/)
  assert.match(submitImageEdit, /sourceViewer\.hidden = true/)
  assert.match(submitImageEdit, /result\.hidden = false/)
  assert.match(renderEditImageActionMarkup, /data-icono-source-width/)
  assert.match(renderEditImageActionMarkup, /data-icono-source-height/)
  assert.match(sourceFromEditButton, /width:\s*Number/)
  assert.match(sourceFromEditButton, /height:\s*Number/)
  assert.match(openImageEditDialog, /applyImageEditAspectRatio\(dialog,\s*source\)/)
  assert.match(submitImageEdit, /applyImageEditAspectRatio\(dialog,\s*source\)/)
  assert.match(
    css,
    /\.icono-image-edit-artboard\[hidden\],\s*\n\.icono-image-edit-before-after\[hidden\]/,
  )
  assert.match(artboardCss, /width:\s*min\(var\(--icono-image-tile-width\),\s*100%\)/)
  assert.match(artboardCss, /aspect-ratio:\s*var\(--icono-image-edit-aspect-ratio,\s*4\s*\/\s*5\)/)
  assert.match(
    beforeAfterCss,
    /aspect-ratio:\s*var\(--icono-image-edit-aspect-ratio,\s*4\s*\/\s*5\)/,
  )
  assert.match(comparisonCss, /display:\s*block/)
  assert.match(comparisonCss, /aspect-ratio:\s*inherit/)
  assert.doesNotMatch(comparisonCss, /max-height/)
  assert.doesNotMatch(artboardCss, /min-height|padding:|border:|radial-gradient|box-shadow/)
  assert.match(previewImageCss, /height:\s*100%/)
  assert.match(previewImageCss, /object-fit:\s*cover/)
  assert.doesNotMatch(previewImageCss, /object-fit:\s*contain|background:|border:|max-height/)
})

test("publish success closes the edit dialog so the refreshed candidates are visible", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const closeStart = app.indexOf("function closeImageEditDialog")
  const closeEnd = app.indexOf("function publishImageEditJob", closeStart)
  const publishStart = app.indexOf("function publishImageEditJob")
  const publishEnd = app.indexOf("function wireImageEditDialog", publishStart)
  assert.notEqual(closeStart, -1)
  assert.notEqual(closeEnd, -1)
  assert.notEqual(publishStart, -1)
  assert.notEqual(publishEnd, -1)
  const closeImageEditDialog = app.slice(closeStart, closeEnd)
  const publishImageEditJob = app.slice(publishStart, publishEnd)

  assert.match(closeImageEditDialog, /dialog\.hide/)
  assert.match(publishImageEditJob, /closeImageEditDialog\(\)/)
  assert.match(publishImageEditJob, /seedPublisherVoteSnapshotAfterImageEditPublish\(payload\)/)
  assert.match(publishImageEditJob, /renderGene\(root,\s*state\.source\.symbol/)
  // Failures must keep the dialog open with an error status.
  assert.match(publishImageEditJob, /\.catch\(function \(error\)/)
  assert.match(publishImageEditJob, /Could not publish edit/)
  assert.doesNotMatch(
    publishImageEditJob.slice(publishImageEditJob.indexOf(".catch")),
    /closeImageEditDialog\(\)/,
  )
})

test("image-edit publish keeps a real publisher upvote and hydrates the vote UI", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const seedStart = app.indexOf("function seedPublisherVoteSnapshotAfterImageEditPublish")
  const seedEnd = app.indexOf("function publishImageEditJob", seedStart)
  const wireStart = app.indexOf("function wireCandidateVoteBoxes")
  const wireEnd = app.indexOf("function wireCandidateRemoveButtons", wireStart)
  assert.notEqual(seedStart, -1)
  assert.notEqual(seedEnd, -1)
  assert.notEqual(wireStart, -1)
  assert.notEqual(wireEnd, -1)
  const seed = app.slice(seedStart, seedEnd)
  const wire = app.slice(wireStart, wireEnd)

  assert.match(seed, /iconoplasm\.vote\.a:/)
  assert.match(seed, /user_vote:\s*1/)
  assert.match(seed, /refreshGeneWhenCanonicalDetailMatchesVote\(symbol,\s*assetSha\)/)
  assert.match(wire, /handle\.ensureSnapshot\(\)/)
})

test("server candidate action islands wire edit buttons without replacing public cards", () => {
  const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
  const hydrateStart = app.indexOf("function hydrateServerCandidateActionIslands")
  const hydrateEnd = app.indexOf("function syncServerGenePortraitUrls", hydrateStart)
  const wireStart = app.indexOf("function wireGeneContent")
  const wireEnd = app.indexOf("/* ─── Gene page: resampling suggestions", wireStart)
  assert.notEqual(hydrateStart, -1)
  assert.notEqual(hydrateEnd, -1)
  assert.notEqual(wireStart, -1)
  assert.notEqual(wireEnd, -1)
  const hydrateCandidateActions = app.slice(hydrateStart, hydrateEnd)
  const wireGeneContent = app.slice(wireStart, wireEnd)

  assert.match(
    hydrateCandidateActions,
    /querySelectorAll\("\[data-icono-candidate-actions-island\]"\)/,
  )
  assert.match(hydrateCandidateActions, /sourcesByAsset = new Map\(\)/)
  assert.match(hydrateCandidateActions, /sourcesByAsset\.get\(targetAsset\)/)
  assert.match(hydrateCandidateActions, /targets\[j\]\.innerHTML = source/)
  assert.doesNotMatch(hydrateCandidateActions, /outerHTML/)
  assert.match(wireGeneContent, /wireGeneEditImagePanel\(container,\s*genePayload\)/)
})

test("B-517 live Shoelace components can load icons under the production CSP", () => {
  const worker = readFileSync(
    new URL(
      "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const helperStart = worker.indexOf("function shouldAllowIconoplasmShoelaceDataIcons")
  const helperEnd = worker.indexOf("function isSiteSettingsBridgeRequest")
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = worker.slice(helperStart, helperEnd)
  const cspStart = worker.indexOf("function buildContentSecurityPolicy")
  const cspEnd = worker.indexOf("function crossOriginResourcePolicyForRequest")
  assert.notEqual(cspStart, -1)
  assert.notEqual(cspEnd, -1)
  const csp = worker.slice(cspStart, cspEnd)

  assert.match(helper, /Shoelace's bundled system icon library/)
  assert.match(helper, /host === ICONOPLASM_HOST/)
  assert.match(helper, /path === "\/apps\/iconoplasm"/)
  assert.match(helper, /path\.startsWith\("\/apps\/iconoplasm\/"\)/)
  assert.match(csp, /allowIconoplasmShoelaceDataIcons/)
  assert.match(
    csp,
    /allowIconoplasmShoelaceDataIcons\s*\?\s*"connect-src 'self' data: https:\/\/brinedew\.bio/,
  )
  assert.doesNotMatch(
    csp,
    /allowIconoplasmShoelaceDataIcons\s*\?\s*"connect-src 'self' data: blob:/,
  )
})
