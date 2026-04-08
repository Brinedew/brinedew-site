import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

test("Iconoplasm request picker uses an explicit combobox/listbox contract", () => {
  assert.match(app, /class="icono-search-input icono-request-picker-input"/, "request picker should reuse the shared Iconoplasm search input styling")
  assert.match(app, /class="icono-request-inline-submit"/, "request picker should keep the submit control inside the search bar")
  assert.match(app, /role="combobox"/, "request picker input should expose combobox semantics")
  assert.match(app, /aria-autocomplete="list"/, "request picker input should announce list autocomplete")
  assert.match(app, /aria-haspopup="listbox"/, "request picker input should announce a listbox popup")
  assert.match(app, /role="listbox"/, "request picker popup should expose listbox semantics")
  assert.match(app, /role="option" aria-selected="/, "request picker rows should expose option semantics")
  assert.match(app, /Random emulsion/, "request picker should present Random emulsion as the default first option")
  assert.match(app, /function renderRequestShellMarkup\(symbol\)/, "request picker should render an immediate shell instead of waiting for full request state bootstrap")
  assert.doesNotMatch(app, /Loading request state\.\.\./, "request picker should not ship the old blocking loading placeholder")
  assert.match(app, /requests\/gene\/" \+ encodeURIComponent\(symbol\) \+ "\/summary"/, "gene page should fetch summary from the split summary endpoint")
  assert.match(app, /fetchJSON\("\/api\/iconoplasm\/requests\/options"/, "gene page should fetch options from the split options endpoint")
  assert.doesNotMatch(app, /fetchJSON\("\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(symbol\),/, "gene page should not call the removed one-shot request-state route")
})
