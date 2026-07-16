import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
const css = readFileSync(new URL("../quartz/static/iconoplasm/styles.css", import.meta.url), "utf8")

test("Iconoplasm request picker uses an explicit combobox/listbox contract", () => {
  assert.match(
    app,
    /class="icono-search-input icono-request-picker-input"/,
    "request picker should reuse the shared Iconoplasm search input styling",
  )
  assert.match(
    app,
    /class="icono-request-inline-submit"/,
    "request picker should keep the submit control inside the search bar",
  )
  assert.match(
    app,
    /String\(config\.placeholder \|\| "pick an emulsion"\)/,
    "request picker should keep the short placeholder copy",
  )
  assert.doesNotMatch(
    app,
    /Search emulsion code or vision ID\. Leave blank for random\./,
    "request picker should not ship the old verbose placeholder copy",
  )
  assert.match(app, /role="combobox"/, "request picker input should expose combobox semantics")
  assert.match(
    app,
    /aria-autocomplete="list"/,
    "request picker input should announce list autocomplete",
  )
  assert.match(
    app,
    /aria-haspopup="listbox"/,
    "request picker input should announce a listbox popup",
  )
  assert.match(app, /role="listbox"/, "request picker popup should expose listbox semantics")
  assert.match(
    css,
    /\.icono-request-results\[hidden\]\s*\{\s*display:\s*none;/,
    "request picker popup must honor [hidden] so it cannot cover the Image API lane after selection",
  )
  assert.match(
    app,
    /role="option" aria-selected="/,
    "request picker rows should expose option semantics",
  )
  assert.match(
    app,
    /Random emulsion/,
    "request picker should present Random emulsion as the default first option",
  )
  assert.match(
    app,
    /function compareRequestOptionStrength\(left, right\)/,
    "request picker should preserve vote-strength ordering after filtering",
  )
  assert.match(
    app,
    /return compareRequestOptionStrength\(a, b\)/,
    "request picker should not fall back to alphabetical option ordering",
  )
  assert.match(
    app,
    /return String\(item\.medium_url \|\| item\.thumb_url \|\| ""\)\.trim\(\)/,
    "request picker should prefer the less aggressively cropped medium rendition",
  )
  assert.match(
    app,
    /function renderRequestShellMarkup\(symbol\)/,
    "request picker should render an immediate shell instead of waiting for full request state bootstrap",
  )
  assert.doesNotMatch(
    app,
    /Loading request state\.\.\./,
    "request picker should not ship the old blocking loading placeholder",
  )
  assert.match(
    app,
    /var path = "\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(key\) \+ "\/summary"/,
    "gene page should fetch summary from the split summary endpoint",
  )
  assert.match(
    app,
    /var requestOptionsUrl = "\/api\/iconoplasm\/requests\/options"/,
    "gene page should fetch options from the split options endpoint",
  )
  assert.match(
    app,
    /requestOptionsUrl \+= "\?query=" \+ encodeURIComponent\(queryKey\)/,
    "request picker should ask the split options endpoint for query-specific rollup matches",
  )
  assert.doesNotMatch(
    app,
    /fetchJSON\("\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(symbol\),/,
    "gene page should not call the removed one-shot request-state route",
  )
})

test("canonical blot toolbar keeps picker behind a modal trigger", () => {
  assert.match(
    app,
    /function renderCanonicalToolbarMarkup\(genePayload\)/,
    "canonical toolbar should have one renderer instead of assembling unrelated cells inline",
  )
  assert.match(app, /data-icono-canonical-rail/, "gene page should keep a canonical toolbar rail")
  assert.match(
    app,
    /class="icono-candidate-action-btn icono-canonical-edit-btn icono-image-edit-open"/,
    "canonical edit should use the same compact icon-button grammar as candidate edit",
  )
  assert.match(
    app,
    /data-icono-request-dialog-open/,
    "canonical toolbar should expose New candidate as a dialog trigger",
  )
  assert.match(
    app,
    /function renderRequestDialogTriggerMarkup\(symbol\)/,
    "canonical rail should render only the New candidate trigger",
  )
  assert.match(
    app,
    /<sl-dialog class="icono-request-dialog"/,
    "request picker should render inside a modal dialog instead of the visible toolbar rail",
  )
  assert.match(
    app,
    /renderRequestDialogTriggerMarkup\(g\.symbol\) \+[\s\S]*"<\/div>" \+[\s\S]*renderRequestDialogMarkup\(g\.symbol\)/,
    "request picker dialog should be outside the visible canonical toolbar rail",
  )
  assert.match(
    app,
    /function openRequestDialog\(\)/,
    "request panel wiring should open the modal from the toolbar trigger",
  )
  assert.match(css, /\.icono-request-dialog\b/, "request dialog should have dedicated styling")
  assert.match(
    css,
    /\.icono-canonical-new-candidate-btn\b/,
    "New candidate should be styled as the expanded canonical toolbar action",
  )
})

test("new candidate modal exposes separate free queue and configured image API generation paths", () => {
  assert.match(
    app,
    /data-icono-request-lane="queue"[\s\S]*Free generation queue[\s\S]*Queue free/,
    "request modal should expose the free generation queue lane",
  )
  assert.match(
    app,
    /data-icono-request-lane="api"[\s\S]*Direct generation[\s\S]*data-icono-request-image-generate[\s\S]*Generate candidate/,
    "request modal should expose a separate direct Image API lane",
  )
  assert.match(
    css,
    /\.icono-request-lanes\b[\s\S]*\.icono-request-lane\b/,
    "request lanes should be styled with existing Iconoplasm modal primitives",
  )
  assert.match(
    app,
    /data-icono-request-direct-status[\s\S]*No saved image provider[\s\S]*Generate candidate/,
    "direct generation should explain the no-provider disabled state",
  )
  assert.match(
    app,
    /data-icono-request-image-publish hidden disabled/,
    "direct generation should not show publish until a candidate exists",
  )
  assert.match(
    app,
    /slot="footer" class="icono-request-direct-actions"[\s\S]*data-icono-request-image-generate[\s\S]*data-icono-request-image-publish/,
    "direct generation should pin generate and publish in the dialog footer like Edit blot",
  )
  assert.match(
    app,
    /data-icono-request-direct-result[\s\S]*class="icono-request-direct-controls"[\s\S]*data-icono-request-direct-preview/,
    "direct generation should have explicit viewer and controls regions instead of a pseudo-side column",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/candidate-generation\/jobs/,
    "direct generation should use its own candidate-generation job endpoint",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/candidate-generation\/jobs\/"\s*\+\s*encodeURIComponent\(requestDirectState\.job\.id\)\s*\+\s*"\/publish/,
    "direct generation should require an explicit publish action after the image API returns",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/image-edit\/providers/,
    "direct generation should reuse the saved image provider settings instead of adding a second key path",
  )
  assert.match(
    app,
    /request_mode:\s*"novel"/,
    "direct generation should identify API candidates as novel jobs",
  )
  assert.match(
    app,
    /value="prose_sample"[\s\S]*data-icono-request-prompt-body-mode[\s\S]*value="tags_sample"[\s\S]*data-icono-request-prompt-body-mode/,
    "direct generation should expose a prose/tags prompt body switch",
  )
  assert.match(
    app,
    /prompt_body_mode:\s*selectedDirectPromptBodyMode\(\)/,
    "direct generation should send the selected prompt body mode",
  )
  assert.doesNotMatch(
    app,
    /Request body sent to Iconoplasm|Prompt recipe|data-icono-request-payload-preview/,
    "direct generation should not expose internal transport details in the modal",
  )
  assert.doesNotMatch(
    app,
    /data-icono-request-backend-query|data-icono-request-backend-picker/,
    "request modal should not add a grab-bag backend picker",
  )
})

test("direct Image API generation has its own user-emulsion picker separate from the queue picker", () => {
  const directMarkupStart = app.indexOf("function renderRequestDirectGenerationMarkup")
  const directMarkupEnd = app.indexOf("function renderRequestShellMarkup", directMarkupStart)
  const wireStart = app.indexOf("function wireAuthenticatedRequestForm")
  const wireEnd = app.indexOf("function loadSummary", wireStart)
  const submitStart = app.indexOf("function submitDirectCandidateGeneration")
  const submitEnd = app.indexOf("function publishDirectCandidateGeneration", submitStart)
  assert.notEqual(directMarkupStart, -1)
  assert.notEqual(directMarkupEnd, -1)
  assert.notEqual(wireStart, -1)
  assert.notEqual(wireEnd, -1)
  assert.notEqual(submitStart, -1)
  assert.notEqual(submitEnd, -1)
  const directMarkup = app.slice(directMarkupStart, directMarkupEnd)
  const wireAuthenticatedRequestForm = app.slice(wireStart, wireEnd)
  const submitDirectCandidateGeneration = app.slice(submitStart, submitEnd)

  assert.match(directMarkup, /data-icono-request-direct-emulsion-picker/)
  assert.match(directMarkup, /data-icono-request-direct-emulsion-query/)
  assert.match(directMarkup, /data-icono-request-direct-emulsion-results/)
  assert.match(wireAuthenticatedRequestForm, /directEmulsionQuery/)
  assert.match(wireAuthenticatedRequestForm, /directUserEmulsionOptions/)
  assert.match(wireAuthenticatedRequestForm, /\/api\/iconoplasm\/user-emulsion/)
  assert.doesNotMatch(
    wireAuthenticatedRequestForm,
    /filterRequestOptions\([^)]*isDirectUserEmulsionOption/,
    "direct generation must not populate the private emulsion picker from the shared public request options",
  )
  assert.match(submitDirectCandidateGeneration, /selectedDirectUserEmulsionId\(\)/)
  assert.match(
    submitDirectCandidateGeneration,
    /user_emulsion_id:\s*selectedDirectUserEmulsionId\(\)/,
  )
  assert.doesNotMatch(submitDirectCandidateGeneration, /selectedUserEmulsionIdForDirectGeneration/)
})

test("direct user-emulsion options carry option_type so the click handler can read the user_emulsion_id", () => {
  const fromSavedStart = app.indexOf("function directUserEmulsionOptionFromSaved")
  assert.notEqual(fromSavedStart, -1, "directUserEmulsionOptionFromSaved must exist")
  const fromSavedEnd = app.indexOf("\n      function", fromSavedStart + 1)
  const fromSaved = app.slice(fromSavedStart, fromSavedEnd)
  assert.match(
    fromSaved,
    /option_type:\s*"user_emulsion"/,
    'direct user-emulsion options must mark option_type="user_emulsion" so renderRequestOptionButtonMarkup resolves user_emulsion_id (not the empty vision_id fallback)',
  )
  const wireStart = app.indexOf("function wireAuthenticatedRequestForm")
  const wireEnd = app.indexOf("function loadSummary", wireStart)
  const wire = app.slice(wireStart, wireEnd)
  assert.match(wire, /data-icono-request-direct-emulsion-option/)
  const clickHandlerMatch = wire.match(
    /directEmulsionResults\.addEventListener\(\s*"click"[\s\S]*?\}\)\s*\n\s*\}\s*\n/,
  )
  assert.ok(clickHandlerMatch, "direct emulsion click handler must exist")
  assert.match(
    clickHandlerMatch[0],
    /button\.getAttribute\(\s*"data-icono-request-direct-emulsion-option"\s*\)/,
    "click handler must read the rendered user_emulsion_id attribute",
  )
})

test("new and edit image modal previews use candidate masonry-sized medium previews", () => {
  assert.match(
    css,
    /--icono-image-tile-width:\s*384px/,
    "candidate image masonry should expose the canonical tile width",
  )
  assert.match(
    css,
    /\.icono-request-direct-result\s*\{[^}]*width:\s*min\(var\(--icono-image-tile-width\),\s*100%\)/,
    "direct generation result should use the candidate image masonry tile width",
  )
  const directResultCss = css.match(/(?:^|\n)\.icono-request-direct-result\s*\{[^}]*\}/)?.[0] || ""
  const directResultImageCss =
    css.match(/(?:^|\n)\.icono-request-direct-result img\s*\{[^}]*\}/)?.[0] || ""
  assert.match(directResultCss, /aspect-ratio:\s*4\s*\/\s*5/)
  assert.match(directResultImageCss, /position:\s*absolute/)
  assert.match(directResultImageCss, /object-fit:\s*cover/)
  assert.match(
    css,
    /\.icono-image-edit-before-after\s*\{[^}]*width:\s*min\(var\(--icono-image-tile-width\),\s*100%\)/,
    "edit comparison result should use the candidate image masonry tile width",
  )
  assert.match(
    app,
    /function directResultUrl\(job\)[^]*return String\(urls\.medium \|\| urls\.full \|\| urls\.thumb \|\| ""\)\.trim\(\)/,
    "direct generation result should prefer the same medium rendition used by candidate masonry",
  )
  assert.match(
    app,
    /if \(after\)\s*after\.src =\s*\(job && job\.result_urls && job\.result_urls\.medium\) \|\|\s*\(job && job\.result_urls && job\.result_urls\.full\) \|\|\s*\(job && job\.result_urls && job\.result_urls\.thumb\) \|\|\s*""/,
    "edit comparison result should prefer medium with explicit full/thumb fallback",
  )
})

test("direct generation result uses edit-modal geometry instead of a handmade side column", () => {
  assert.match(
    css,
    /\.icono-request-dialog\s*\{[^}]*--width:\s*min\(68rem,\s*calc\(100vw - 2rem\)\)/,
    "new candidate dialog should use the same desktop modal width class as the edit dialog",
  )
  assert.match(
    css,
    /\.icono-request-direct-controls\s*\{[^}]*display:\s*grid[^}]*align-content:\s*start/,
    "direct generation controls should be a coherent controls stack like the edit modal controls",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-controls\s*\{[^}]*grid-template-columns:\s*1fr/,
    "desktop direct generation controls should stack as a single column instead of side-by-side with the action row",
  )
  assert.match(
    css,
    /\.icono-request-direct-controls\s*\{[^}]*grid-template-areas:\s*"provider"\s*"picker"\s*"preview"\s*"status"/,
    "desktop direct generation controls should keep sample and prompt controls in a clean control stack",
  )
  assert.match(
    css,
    /\.icono-request-direct-actions\s*\{[^}]*display:\s*flex[^}]*justify-content:\s*space-between/,
    "generate and publish actions should live in the dialog footer, spaced like the edit dialog",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-panel\s*\{[^}]*grid-template-columns:\s*minmax\(18rem,\s*var\(--icono-image-tile-width\)\)\s*minmax\(22rem,\s*1fr\)/,
    "the direct generation panel should reserve a fixed viewer-plus-controls layout from the start so the result does not shift the form on arrival",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-controls\s*\{[^}]*grid-template-columns:\s*1fr[^}]*"provider"[^}]*"picker"/,
    "the direct generation controls should sit beside the viewer in a fixed stack so the form does not reorganize when the result arrives",
  )
  assert.doesNotMatch(
    css,
    /\.icono-request-direct-side/,
    "direct generation should not keep the old pseudo-side column",
  )
  assert.match(
    css,
    /--icono-action-primary-bg:\s*color-mix\(in srgb,\s*oklch\(24% 0\.035 50\) 88%,\s*var\(--accent\) 12%\)/,
    "primary action color should live in a shared Iconoplasm action token that does not invert in dark mode",
  )
  assert.match(
    css,
    /--icono-action-font:\s*"IBM Plex Mono", monospace/,
    "modal and toolbar action buttons should not inherit the page's display fonts",
  )
  assert.match(
    css,
    /\.icono-request-direct-publish\s*\{[^}]*background:\s*var\(--icono-action-primary-bg\)/,
    "publish candidate should be the primary action token; generate is the secondary token when no image is ready",
  )
  assert.match(
    css,
    /\.icono-canonical-new-candidate-btn\s*\{[^}]*background:\s*var\(--icono-action-primary-bg\)[^}]*font-family:\s*var\(--icono-action-font\)\s*!important/,
    "canonical toolbar action should use the same font and primary action token as direct generation and beat global button typography",
  )
  assert.match(
    css,
    /\.icono-request-provider-select\s*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--light\) 94%,\s*var\(--dark\) 6%\)/,
    "request modal provider select should use Iconoplasm theme tokens instead of default white controls",
  )
  assert.match(
    app,
    /<select class="icono-request-provider-select" data-icono-request-provider><\/select>/,
    "direct generation provider should be a native select so the selected provider is visibly rendered",
  )
  assert.match(
    app,
    /var selectedValue = lastUsedValue \|\| \(options\.length \? options\[0\]\.value : ""\)/,
    "direct generation should restore the last compound provider_id:model option and otherwise use the first available option",
  )
  assert.match(
    app,
    /if \(\s*selectedValue\s*&&\s*!options\.some\(function \(opt\) \{\s*return opt\.value === selectedValue\s*\}\)\s*\) \{\s*selectedValue = options\.length \? options\[0\]\.value : ""/,
    "a removed last-used provider should fall back to the first currently available compound option",
  )
  assert.match(
    css,
    /\.icono-request-direct-generate:disabled,\s*\.icono-request-direct-publish:disabled\s*\{[^}]*background:\s*transparent[^}]*opacity:\s*1/,
    "disabled direct actions should become neutral outline controls instead of translucent green pills",
  )
  assert.match(
    app,
    /function hasDirectGeneratedImage\(\)[^]*return Boolean\([^)]*directResultUrl\(requestDirectState\.job\)[^]*\)/,
    "publish availability should be based on a generated image URL, not a fragile status string alone",
  )
})
