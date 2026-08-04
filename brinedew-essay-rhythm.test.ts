import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const css = readFileSync(new URL("./quartz/static/custom.css", import.meta.url), "utf8")

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"))
  assert.ok(match, `missing CSS contract for ${selector}`)
  return match[1]
}

test("essay rhythm has explicit leading and parent-owned block gaps", () => {
  const essay = rule(".markdown-preview-view.markdown-rendered")
  assert.match(essay, /--essay-leading:\s*1\.6rem;/)
  assert.match(essay, /--essay-block-gap:\s*0\.9em;/)
  assert.match(essay, /--essay-caption-gap:\s*0\.35em;/)
  assert.match(essay, /gap:\s*var\(--essay-block-gap\);/)
  assert.match(essay, /line-height:\s*var\(--essay-leading\);/)

  const prose = rule(".markdown-preview-view.markdown-rendered :is(p, li, blockquote)")
  assert.match(prose, /line-height:\s*var\(--essay-leading\);/)
})

test("raised and lowered inline annotations cannot enlarge a prose line box", () => {
  const markers = rule(".markdown-preview-view.markdown-rendered :is(sup, sub)")
  assert.match(markers, /position:\s*relative;/)
  assert.match(markers, /vertical-align:\s*baseline;/)
  assert.match(markers, /font-size:\s*0\.75em;/)

  assert.match(
    css,
    /\.markdown-preview-view\.markdown-rendered :is\(sup, sub\),\s*\.markdown-preview-view\.markdown-rendered :is\(sup, sub\) > \*\s*\{\s*line-height:\s*0;/s,
  )
  assert.match(rule(".markdown-preview-view.markdown-rendered sup"), /top:\s*-0\.42em;/)
  assert.match(rule(".markdown-preview-view.markdown-rendered sub"), /bottom:\s*-0\.2em;/)
})

test("figures own centered media and caption geometry", () => {
  const figures = rule(".markdown-preview-view.markdown-rendered figure")
  assert.match(figures, /align-items:\s*center;/)
  assert.match(figures, /gap:\s*var\(--essay-caption-gap\);/)
  assert.match(figures, /width:\s*100%;/)

  const captions = rule(".markdown-preview-view.markdown-rendered figure > figcaption")
  assert.match(captions, /text-align:\s*center;/)
  assert.match(captions, /line-height:\s*1\.35;/)
  assert.match(captions, /max-width:\s*34rem;/)
})
