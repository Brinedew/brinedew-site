// B-849: every Iconoplasm dialog is built from the one template in dialog.js.
// These checks read the shipped source (no mocks): a new dialog written some
// other way, or a Shoelace dialog creeping back, fails here.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { dialogMarkup } from "./dialog.js"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const shipped = fs
  .readdirSync(DIR)
  .filter((name) => /\.(js|css)$/.test(name) && !name.endsWith(".test.js"))
  .map((name) => ({ name, text: fs.readFileSync(path.join(DIR, name), "utf8") }))

test("no Shoelace dialog is left in the Iconoplasm static files", () => {
  const offenders = shipped
    .filter(({ text }) => /sl-dialog|slot="footer"|::part\((?:overlay|panel)\)/.test(text))
    .map(({ name }) => name)
  assert.deepEqual(offenders, [])
})

test("only the shared template creates a <dialog>", () => {
  const offenders = shipped
    .filter(({ name }) => name.endsWith(".js") && name !== "dialog.js")
    .filter(({ text }) => /<dialog[\s>]|createElement\(\s*["']dialog["']\s*\)/.test(text))
    .map(({ name }) => name)
  assert.deepEqual(offenders, [], "build dialogs with dialogMarkup/createDialogElement")
})

test("every dialog module imports the template", () => {
  const dialogModules = [
    "app.js",
    "vote-login-dialog.js",
    "candidate-delete-dialog.js",
    "caretaker-manifestations-view.js",
  ]
  for (const name of dialogModules) {
    const text = shipped.find((file) => file.name === name).text
    assert.match(text, /from "\.\/dialog\.js\?v=[0-9a-f]{16}"/, `${name} imports dialog.js`)
  }
})

test("the dialog frame is styled once, from theme variables, with no hardcoded colors", () => {
  const css = shipped.find(({ name }) => name === "styles.css").text
  const frame = css.slice(css.indexOf("/* ───────── Dialogs: the only definition"))
  const end = frame.indexOf("#iconoplasm-root :where(a[href]")
  const block = frame.slice(0, end)
  assert.ok(block.length > 500, "the .icono-dialog block exists")
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "dialog frame colors use variables")
  const definitions = css.match(/^\.icono-dialog\s*\{/gm) || []
  assert.equal(definitions.length, 1, "one .icono-dialog definition")
  assert.doesNotMatch(css, /\.icono-(?:vote-login|candidate-delete|caretaker)-dialog\s*\{/)
})

test("dialogMarkup renders the one header, body and footer shape", () => {
  const html = dialogMarkup({
    id: "demo",
    title: "Delete <this>?",
    size: "compact",
    body: "<p>Body</p>",
    footer: "<button>Go</button>",
  })
  assert.match(
    html,
    /^<dialog class="icono-dialog icono-dialog--compact" aria-labelledby="demo-title" id="demo">/,
  )
  assert.match(
    html,
    /<h2 class="icono-dialog__title" id="demo-title" data-icono-dialog-title>Delete &lt;this&gt;\?<\/h2>/,
  )
  assert.match(
    html,
    /<button type="button" class="icono-button icono-button--icon icono-dialog__close" data-icono-dialog-close aria-label="Close">/,
  )
  assert.match(html, /<div class="icono-dialog__body"><p>Body<\/p><\/div>/)
  assert.match(html, /<footer class="icono-dialog__footer"><button>Go<\/button><\/footer>/)
  const bare = dialogMarkup({ title: "No actions", size: "nonsense" })
  assert.match(bare, /icono-dialog--standard/, "an unknown size falls back to standard")
  assert.doesNotMatch(bare, /icono-dialog__footer/, "no footer without actions")
})
