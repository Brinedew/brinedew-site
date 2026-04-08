import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

test("Iconoplasm request picker uses an explicit combobox/listbox contract", () => {
  assert.match(app, /class="icono-search-input icono-request-picker-input"/, "request picker should reuse the shared Iconoplasm search input styling")
  assert.match(app, /role="combobox"/, "request picker input should expose combobox semantics")
  assert.match(app, /aria-autocomplete="list"/, "request picker input should announce list autocomplete")
  assert.match(app, /aria-haspopup="listbox"/, "request picker input should announce a listbox popup")
  assert.match(app, /role="listbox"/, "request picker popup should expose listbox semantics")
  assert.match(app, /role="option" aria-selected="/, "request picker rows should expose option semantics")
  assert.match(app, /Random emulsion/, "request picker should present Random emulsion as the default first option")
})
