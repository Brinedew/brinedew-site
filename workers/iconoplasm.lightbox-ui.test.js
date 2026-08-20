import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
const lightbox = readFileSync(
  new URL("../quartz/static/iconoplasm/lightbox.js", import.meta.url),
  "utf8",
)

test("shared lightbox uses declared full-image dimensions before thumbnail natural size", () => {
  const helperStart = lightbox.indexOf("export function lightboxDimensionsForTrigger")
  const helperEnd = lightbox.indexOf("function measureSourceDimensions", helperStart)
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = lightbox.slice(helperStart, helperEnd)
  const declaredDimensionRead = helper.indexOf('getAttribute("data-pswp-width")')
  const imageFallbackRead = helper.indexOf('querySelector("img")')

  assert.ok(declaredDimensionRead >= 0)
  assert.ok(imageFallbackRead >= 0)
  assert.ok(declaredDimensionRead < imageFallbackRead)
  assert.match(helper, /if \(width > 0 && height > 0\) return \{ width: width, height: height \}/)
  assert.match(helper, /img\.naturalWidth/)
  assert.match(helper, /img\.naturalHeight/)
  assert.match(lightbox, /measureSourceDimensions\(items\[index\] && items\[index\]\.src\)/)
  assert.match(lightbox, /items\[index\]\.width = measured\.width/)
  assert.match(lightbox, /items\[index\]\.height = measured\.height/)
})

test("public pages use the shared delegated Iconoplasm lightbox", () => {
  assert.match(app, /import \{ installIconoplasmLightbox \} from "\.\/lightbox\.js/)
  assert.match(app, /installIconoplasmLightbox\(document\)/)
  assert.match(lightbox, /targetDocument\.addEventListener\("click", handler, true\)/)
  assert.match(lightbox, /event\.target\.closest\("\[data-icono-pswp\]"\)/)
  assert.match(lightbox, /trigger\.closest\("\[data-icono-lightbox\]"\)/)
})
