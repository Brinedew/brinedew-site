import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { openVoteLoginDialog } from "./vote-login-dialog.js"

function createDialogHarness() {
  const { document, window } = parseHTML(
    '<main><button type="button" data-vote-control>Vote</button></main>',
  )
  const createdDialogs = []
  const focusCalls = []
  const showModalCalls = []
  const documentListenerTypes = []
  const createElement = document.createElement.bind(document)
  const addDocumentEventListener = document.addEventListener.bind(document)

  document.addEventListener = function (type, ...args) {
    documentListenerTypes.push(type)
    return addDocumentEventListener(type, ...args)
  }

  document.createElement = function (tagName) {
    const element = createElement(tagName)
    if (String(tagName).toLowerCase() === "dialog") {
      element.showModal = function () {
        showModalCalls.push(this)
        this.open = true
        this.setAttribute("open", "")
      }
      element.close = function (returnValue = "") {
        if (!this.open) return
        this.open = false
        this.returnValue = returnValue
        this.removeAttribute("open")
        this.dispatchEvent(new window.Event("close"))
      }
      element.getBoundingClientRect = function () {
        return { left: 100, top: 100, right: 400, bottom: 300, width: 300, height: 200 }
      }
      createdDialogs.push(element)
    }
    return element
  }

  window.HTMLElement.prototype.focus = function (options) {
    focusCalls.push({ element: this, options })
  }

  return {
    document,
    window,
    source: document.querySelector("[data-vote-control]"),
    createdDialogs,
    focusCalls,
    showModalCalls,
    documentListenerTypes,
  }
}

function clickAt(window, element, clientX, clientY) {
  const event = new window.Event("click", { bubbles: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  element.dispatchEvent(event)
}

test("guest voting opens one native modal and deliberately focuses the Discord action", () => {
  const harness = createDialogHarness()
  const dialog = openVoteLoginDialog({
    document: harness.document,
    loginUrl: "/api/auth/discord?return_to=%2Fgenes%2FTP53",
    returnFocus: harness.source,
  })

  assert.equal(dialog.tagName, "DIALOG")
  assert.equal(dialog.open, true, "showModal must put the dialog in the top layer")
  assert.deepEqual(harness.showModalCalls, [dialog])
  assert.equal(harness.createdDialogs.length, 1)
  assert.equal(harness.document.body.lastElementChild, dialog)
  assert.equal(dialog.getAttribute("aria-labelledby"), "icono-vote-login-title")
  assert.equal(dialog.querySelector("h2")?.textContent, "Log in with Discord to vote")
  assert.deepEqual(
    harness.documentListenerTypes,
    [],
    "the dialog must not install global Escape or focus-trap listeners",
  )
  assert.equal(harness.document.documentElement.className, "")
  assert.equal(harness.document.body.className, "")

  const loginLink = dialog.querySelector("[data-icono-vote-login-link]")
  assert.equal(loginLink?.getAttribute("href"), "/api/auth/discord?return_to=%2Fgenes%2FTP53")
  assert.deepEqual(harness.focusCalls.at(-1), {
    element: loginLink,
    options: { preventScroll: true },
  })

  const repeated = openVoteLoginDialog({
    document: harness.document,
    loginUrl: "/ignored-while-open",
    returnFocus: harness.source,
  })
  assert.equal(repeated, dialog)
  assert.equal(harness.createdDialogs.length, 1, "repeated auth failures must not stack modals")
})

test("native close and cancel lifecycles remove the modal and restore its vote control", () => {
  const harness = createDialogHarness()
  const dialog = openVoteLoginDialog({
    document: harness.document,
    loginUrl: "/api/auth/discord",
    returnFocus: harness.source,
  })

  dialog.querySelector(".icono-vote-login-close")?.dispatchEvent(new harness.window.Event("click"))

  assert.equal(harness.document.querySelector("[data-icono-vote-login-prompt]"), null)
  assert.equal(dialog.returnValue, "dismiss")
  assert.deepEqual(harness.focusCalls.at(-1), {
    element: harness.source,
    options: { preventScroll: true },
  })

  const reopened = openVoteLoginDialog({
    document: harness.document,
    loginUrl: "/api/auth/discord",
    returnFocus: harness.source,
  })
  const cancel = new harness.window.Event("cancel", { cancelable: true })
  assert.equal(reopened.dispatchEvent(cancel), true, "Escape must remain on the native cancel path")
  reopened.close()

  assert.equal(harness.document.querySelector("[data-icono-vote-login-prompt]"), null)
  assert.equal(harness.focusCalls.at(-1)?.element, harness.source)
})

test("clicking the backdrop dismisses, while clicks inside the card stay open", () => {
  const harness = createDialogHarness()
  const inside = openVoteLoginDialog({
    document: harness.document,
    loginUrl: "/api/auth/discord",
    returnFocus: harness.source,
  })

  clickAt(harness.window, inside, 150, 150)
  assert.equal(inside.open, true, "dialog padding is part of the card, not the backdrop")

  clickAt(harness.window, inside.querySelector("h2"), 50, 50)
  assert.equal(inside.open, true, "content clicks must not dismiss even with outside coordinates")

  clickAt(harness.window, inside, 50, 50)
  assert.equal(harness.document.querySelector("[data-icono-vote-login-prompt]"), null)
  assert.equal(inside.returnValue, "dismiss")
  assert.equal(harness.focusCalls.at(-1)?.element, harness.source)
})

test("the modal refuses to create a dead Discord action", () => {
  const harness = createDialogHarness()

  assert.throws(
    () => openVoteLoginDialog({ document: harness.document, loginUrl: "  " }),
    /Discord login URL is required/,
  )
  assert.equal(harness.createdDialogs.length, 0)
})
