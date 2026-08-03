import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

test("newly shown cards wait 500ms before they can navigate", async () => {
  const [content, frame, css] = await Promise.all([
    readFile(new URL("./content.js", import.meta.url), "utf8"),
    readFile(new URL("./lit-archival-frame.js", import.meta.url), "utf8"),
    readFile(new URL("./content.css", import.meta.url), "utf8"),
  ])

  assert.match(content, /TOOLTIP_NAVIGATION_DELAY_MS = 500/)
  assert.match(content, /tooltipNavigationArmedAt = Date\.now\(\) \+ TOOLTIP_NAVIGATION_DELAY_MS/)
  assert.match(content, /Date\.now\(\) < tooltipNavigationArmedAt/)
  assert.match(content, /navigationArmedAt: tooltipNavigationArmedAt/)
  assert.match(frame, /Date\.now\(\) < Number\([\s\S]*navigationArmedAt/)
  assert.doesNotMatch(css, /touch-sheet|tooltip-backdrop/)
})

test("extension hover-card fonts never hide text while packaged fonts load", async () => {
  const css = await readFile(new URL("./generated/shared-card-label.css", import.meta.url), "utf8")
  assert.match(css, /font-display:\s*swap;/)
  assert.doesNotMatch(css, /font-display:\s*block;/)
})
