import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

test("candidate lightbox uses declared full-image dimensions before thumbnail natural size", () => {
  const helperStart = app.indexOf("function lightboxDimensionsForLink")
  const helperEnd = app.indexOf("function refreshPortraitLightbox", helperStart)
  const refreshStart = app.indexOf("function refreshPortraitLightbox")
  const refreshEnd = app.indexOf("function consumeBootstrapGallery", refreshStart)
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  assert.notEqual(refreshStart, -1)
  assert.notEqual(refreshEnd, -1)
  const helper = app.slice(helperStart, helperEnd)
  const refresh = app.slice(refreshStart, refreshEnd)
  const declaredDimensionRead = helper.indexOf('getAttribute("data-pswp-width")')
  const imageFallbackRead = helper.indexOf('querySelector("img")')

  assert.ok(declaredDimensionRead >= 0)
  assert.ok(imageFallbackRead >= 0)
  assert.ok(declaredDimensionRead < imageFallbackRead)
  assert.match(
    helper,
    /if\s*\(width > 0 && height > 0\)\s*\{\s*return\s*\{\s*width:\s*width,\s*height:\s*height\s*\}/,
  )
  assert.match(helper, /querySelector\("img"\)/)
  assert.match(helper, /img\.naturalWidth/)
  assert.match(helper, /img\.naturalHeight/)
  assert.match(
    helper,
    /return\s*\{\s*width:\s*img\.naturalWidth,\s*height:\s*img\.naturalHeight\s*\}/,
  )
  assert.match(helper, /getAttribute\("data-pswp-width"\)/)
  assert.match(helper, /getAttribute\("data-pswp-height"\)/)
  assert.match(refresh, /var dimensions = lightboxDimensionsForLink\(link\)/)
  assert.match(refresh, /width:\s*dimensions\.width/)
  assert.match(refresh, /height:\s*dimensions\.height/)
  assert.match(refresh, /measureLightboxSourceDimensions\(items\[index\] && items\[index\]\.src\)/)
  assert.match(refresh, /items\[index\]\.width = measuredDimensions\.width/)
  assert.match(refresh, /items\[index\]\.height = measuredDimensions\.height/)
  assert.match(
    refresh,
    /trigger\.setAttribute\("data-pswp-width", String\(measuredDimensions\.width\)\)/,
  )
  assert.match(
    refresh,
    /trigger\.setAttribute\("data-pswp-height", String\(measuredDimensions\.height\)\)/,
  )
})
