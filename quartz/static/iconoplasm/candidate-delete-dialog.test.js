import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"
import { parseHTML } from "linkedom"

import {
  openCandidateDeleteDialog,
  removeCandidateFromPageState,
  showCandidateDeleteNotice,
} from "./candidate-delete-dialog.js"

function createDocument(markup = "<html><body></body></html>") {
  const { document, window } = parseHTML(markup)
  document.defaultView.setTimeout = setTimeout
  document.defaultView.clearTimeout = clearTimeout
  return { document, window }
}

function installDialogLifecycle(dialog, window) {
  dialog.showModal = function () {
    this.setAttribute("open", "")
  }
  dialog.close = function (returnValue = "") {
    this.returnValue = returnValue
    this.removeAttribute("open")
    this.dispatchEvent(new window.Event("close"))
  }
}

test("candidate delete confirmation names the exact asset and starts on the safe action", () => {
  const { document, window } = createDocument()
  let focusedElement = null
  window.HTMLElement.prototype.focus = function () {
    focusedElement = this
  }
  const originalCreateElement = document.createElement.bind(document)
  document.createElement = function (tagName) {
    const element = originalCreateElement(tagName)
    if (String(tagName).toLowerCase() === "dialog") installDialogLifecycle(element, window)
    return element
  }

  const returnFocus = document.createElement("button")
  document.body.appendChild(returnFocus)
  const dialog = openCandidateDeleteDialog({
    document,
    symbol: "CDK1",
    sampleLabel: "CDK1-1t",
    emulsionLabel: "Anima Aesthetic",
    returnFocus,
    onConfirm: async function () {},
  })

  assert.equal(dialog.hasAttribute("open"), true)
  assert.equal(
    dialog.querySelector(".icono-candidate-delete-identity").textContent,
    "CDK1 · CDK1-1t · Anima Aesthetic",
  )
  assert.match(
    dialog.querySelector(".icono-candidate-delete-consequence").textContent,
    /cannot be undone/i,
  )
  assert.equal(
    focusedElement === dialog.querySelector("[data-icono-candidate-delete-cancel]"),
    true,
  )
})

test("candidate delete submits once and closes immediately while deletion continues", async () => {
  const { document, window } = createDocument()
  const originalCreateElement = document.createElement.bind(document)
  document.createElement = function (tagName) {
    const element = originalCreateElement(tagName)
    if (String(tagName).toLowerCase() === "dialog") installDialogLifecycle(element, window)
    return element
  }
  let resolveDelete
  let calls = 0
  const deletion = new Promise((resolve) => {
    resolveDelete = resolve
  })
  const dialog = openCandidateDeleteDialog({
    document,
    symbol: "CDK1",
    onConfirm: function () {
      calls += 1
      return deletion
    },
  })
  const confirmButton = dialog.querySelector("[data-icono-candidate-delete-confirm]")
  confirmButton.click()
  confirmButton.click()

  assert.equal(calls, 1)
  assert.equal(dialog.isConnected, false)

  const nextDialog = openCandidateDeleteDialog({
    document,
    symbol: "MTOR",
    onConfirm: async function () {},
  })
  assert.equal(nextDialog.isConnected, true)
  nextDialog.querySelector("[data-icono-candidate-delete-cancel]").click()

  resolveDelete()
  await deletion
})

test("asynchronous delete failure reports non-modally after the dialog closes", async () => {
  const { document, window } = createDocument()
  const originalCreateElement = document.createElement.bind(document)
  document.createElement = function (tagName) {
    const element = originalCreateElement(tagName)
    if (String(tagName).toLowerCase() === "dialog") installDialogLifecycle(element, window)
    return element
  }
  let failure = null
  const dialog = openCandidateDeleteDialog({
    document,
    symbol: "CDK1",
    onConfirm: async function () {
      throw new Error("The server is busy.")
    },
    onFailure: function (error) {
      failure = error
    },
  })
  dialog.querySelector("[data-icono-candidate-delete-confirm]").click()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(dialog.isConnected, false)
  assert.equal(failure.message, "The server is busy.")
})

test("synchronous delete failure keeps the dialog open for retry", () => {
  const { document, window } = createDocument()
  const originalCreateElement = document.createElement.bind(document)
  document.createElement = function (tagName) {
    const element = originalCreateElement(tagName)
    if (String(tagName).toLowerCase() === "dialog") installDialogLifecycle(element, window)
    return element
  }
  const dialog = openCandidateDeleteDialog({
    document,
    symbol: "CDK1",
    onConfirm: function () {
      throw new Error("The request could not start.")
    },
  })
  dialog.querySelector("[data-icono-candidate-delete-confirm]").click()

  const status = dialog.querySelector("[data-icono-candidate-delete-status]")
  assert.equal(dialog.isConnected, true)
  assert.equal(status.hidden, false)
  assert.match(status.textContent, /Nothing changed\. The request could not start\./)
  assert.equal(dialog.querySelector("[data-icono-candidate-delete-confirm]").disabled, false)
})

test("successful deletion removes only the matching card and updates page state", () => {
  const { document } = createDocument(`
    <html><body>
      <section class="icono-candidate-gallery">
        <div class="icono-candidate-grid">
          <article class="icono-candidate-card" id="first"></article>
          <article class="icono-candidate-card" id="second"></article>
        </div>
      </section>
    </body></html>
  `)
  const genePayload = {
    portrait_candidates: [
      { asset_sha256: "AAA" },
      { asset_sha256: "bbb" },
      { asset_sha256: "current", is_current: true },
    ],
  }

  const count = removeCandidateFromPageState({
    genePayload,
    assetSha: "aaa",
    card: document.querySelector("#first"),
  })

  assert.equal(count, 2)
  assert.deepEqual(
    genePayload.portrait_candidates.map((candidate) => candidate.asset_sha256),
    ["bbb", "current"],
  )
  assert.equal(document.querySelector("#first"), null)
  assert.equal(document.querySelector(".icono-candidate-grid--single") !== null, true)
  assert.equal(document.querySelector("#second") !== null, true)
})

test("success notice is a non-modal live region", async () => {
  const { document } = createDocument()
  const notice = showCandidateDeleteNotice({
    document,
    message: "CDK1-1t candidate deleted.",
    durationMs: 1,
  })

  assert.equal(notice.getAttribute("role"), "status")
  assert.equal(notice.getAttribute("aria-live"), "polite")
  assert.equal(notice.textContent, "CDK1-1t candidate deleted.")
  assert.equal(document.querySelector("dialog"), null)
  await new Promise((resolve) => setTimeout(resolve, 220))
  assert.equal(notice.isConnected, false)
})

test("candidate removal wiring uses the in-place experience without browser dialogs or rerender", () => {
  const source = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8")
  const start = source.indexOf("function wireCandidateRemoveButtons")
  const end = source.indexOf("function wireCandidateCopyForms", start)
  const wiring = source.slice(start, end)

  assert.match(wiring, /openCandidateDeleteDialog\(/)
  assert.match(wiring, /removeCandidateFromPageState\(/)
  assert.match(wiring, /classList\.add\("is-deleting"\)/)
  assert.match(wiring, /classList\.remove\("is-deleting"\)/)
  assert.doesNotMatch(wiring, /window\.(confirm|alert)\(/)
  assert.doesNotMatch(wiring, /rerenderCurrentGeneRoute|location\.reload/)
})
