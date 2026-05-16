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

  assert.match(app, /data-icono-image-edit-dialog/)
  assert.match(app, /<sl-dialog/)
  assert.match(app, /<sl-select/)
  assert.match(app, /<sl-checkbox/)
  assert.match(app, /<sl-button/)
  assert.doesNotMatch(app, /<sl-input/)
  assert.doesNotMatch(app, /<sl-color-picker/)
  assert.doesNotMatch(app, /data-icono-image-edit-api-key/)
  assert.doesNotMatch(app, /data-icono-image-edit-save-provider/)
  assert.doesNotMatch(app, /function saveImageEditProvider/)
  assert.match(app, /\.show\(/)
  assert.match(app, /\/api\/iconoplasm\/image-edit\/providers/)
  assert.match(app, /\/api\/iconoplasm\/image-edit\/jobs/)
  assert.match(
    app,
    /\/api\/iconoplasm\/image-edit\/jobs\/" \+ encodeURIComponent\(state\.job\.id\) \+ "\/publish/,
  )
  assert.match(app, /renderEditImageActionMarkup\("canonical", g/)
  assert.match(app, /data-icono-edit-source="candidate"/)
  assert.match(app, /data-icono-source-adjustments/)
  assert.match(app, /function imageEditSourceAdjustmentContext\(genePayload, item\)/)
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
  assert.match(css, /\.icono-image-edit-before-after/)
  assert.match(css, /img-comparison-slider\.rendered/)
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
  assert.doesNotMatch(preferences, /generationApiKey:\s*trimStoredValue|generationApiKey:\s*""/)
  assert.doesNotMatch(bridge, /generationApiKey:\s*trimStoredValue|generationApiKey:\s*""/)
  assert.match(preferences, /hasLegacyIconoplasmProviderSettings/)
  assert.match(bridge, /hasLegacyIconoplasmProviderSettings/)
})
