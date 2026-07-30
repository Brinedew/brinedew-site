import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { parseHTML } from "linkedom"

const tutorialSource = await readFile(new URL("./tutorial.js", import.meta.url), "utf8")
const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8")
const stylesSource = await readFile(new URL("./styles.css", import.meta.url), "utf8")

function createStorage() {
  const values = new Map()
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

function installDialogContract(window) {
  let activeElement = null

  Object.defineProperty(window.document, "activeElement", {
    configurable: true,
    get() {
      return activeElement
    },
  })

  window.HTMLElement.prototype.focus = function () {
    activeElement = this
  }

  window.HTMLElement.prototype.showModal = function () {
    assert.equal(this.tagName, "DIALOG")
    assert.equal(Boolean(this.open), false)
    this.previouslyFocusedElement = activeElement
    this.open = true
    this.setAttribute("open", "")
  }

  window.HTMLElement.prototype.close = function () {
    if (!this.open) return
    this.open = false
    this.removeAttribute("open")
    this.dispatchEvent(new window.Event("close"))
    this.previouslyFocusedElement?.focus()
  }
}

function requestNativeCancel(window, dialog) {
  const cancelEvent = new window.Event("cancel", { cancelable: true })
  if (dialog.dispatchEvent(cancelEvent)) {
    dialog.close()
  }
  return cancelEvent
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function createTutorialHarness() {
  const { window } = parseHTML(
    '<html><body><button id="tutorial-invoker" type="button">Help</button></body></html>',
  )
  const localStorage = createStorage()
  installDialogContract(window)

  const sandbox = {
    document: window.document,
    localStorage,
    Image: class {
      decode() {
        return Promise.resolve()
      }
    },
    URL,
    console,
    setTimeout,
    clearTimeout,
    location: new URL("https://brinedew.bio/Geneguessr"),
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox

  vm.runInContext(tutorialSource, vm.createContext(sandbox))
  return { domWindow: window, localStorage, tutorial: sandbox.GeneGuessrTutorial }
}

test("tutorial dialog preserves navigation, completion, and invoker focus", async () => {
  const { domWindow, localStorage, tutorial } = createTutorialHarness()
  const invoker = domWindow.document.getElementById("tutorial-invoker")
  invoker.focus()

  tutorial.openFull()
  await settle()

  const dialog = domWindow.document.querySelector("dialog.pg-tutorial-dialog")
  assert.ok(dialog)
  assert.equal(dialog.open, true)
  assert.equal(dialog.getAttribute("aria-labelledby"), "pg-tutorial-title")
  assert.equal(dialog.querySelector("#pg-tutorial-title")?.tagName, "H2")
  assert.equal(domWindow.document.activeElement?.textContent, "Skip")
  assert.match(dialog.querySelector(".pg-tutorial-status").textContent, /Step 1 of 3/)
  assert.equal(dialog.querySelector(".pg-tutorial-back")?.getAttribute("aria-label"), "Back")
  assert.equal(dialog.querySelector(".pg-tutorial-forward")?.getAttribute("aria-label"), "Next")
  assert.equal(dialog.querySelector("[role='dialog']"), null)

  dialog.querySelector(".pg-tutorial-forward").click()
  await settle()
  assert.match(dialog.querySelector(".pg-tutorial-status").textContent, /Step 2 of 3/)

  dialog.querySelector(".pg-tutorial-forward").click()
  await settle()
  assert.match(dialog.querySelector(".pg-tutorial-status").textContent, /Step 3 of 3/)
  assert.equal(dialog.querySelector(".pg-tutorial-forward")?.getAttribute("aria-label"), "Got it")

  dialog.querySelector(".pg-tutorial-forward").click()
  assert.equal(dialog.open, false)
  assert.equal(localStorage.getItem("gg_tut"), "7")
  assert.equal(domWindow.document.activeElement, invoker)
})

test("native tutorial cancellation closes contextual help and records the seen step", async () => {
  const { domWindow, localStorage, tutorial } = createTutorialHarness()
  const invoker = domWindow.document.getElementById("tutorial-invoker")
  invoker.focus()

  tutorial.maybeShowStep(1)
  await settle()

  const dialog = domWindow.document.querySelector("dialog.pg-tutorial-dialog")
  const cancelEvent = requestNativeCancel(domWindow, dialog)

  assert.equal(cancelEvent.defaultPrevented, false)
  assert.equal(dialog.open, false)
  assert.equal(localStorage.getItem("gg_tut"), "1")
  assert.equal(domWindow.document.activeElement, invoker)
})

test("practice dialog uses the browser modal lifecycle and returns focus", async () => {
  const { window } = parseHTML(
    '<html><body><button id="practice-invoker" type="button">Practice Mode</button></body></html>',
  )
  window.location = new URL("https://brinedew.bio/Geneguessr")
  installDialogContract(window)

  const replacedGlobals = new Map()
  const quietConsole = {
    ...console,
    debug() {},
    error() {},
    info() {},
    log() {},
    warn() {},
  }
  const globals = {
    window,
    document: window.document,
    localStorage: createStorage(),
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    console: quietConsole,
    fetch: async () => ({
      ok: false,
      async json() {
        return {}
      },
    }),
    Image: class {
      decode() {
        return Promise.resolve()
      }
    },
  }

  for (const [name, value] of Object.entries(globals)) {
    replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    })
  }

  try {
    await import(`./app.js?native-dialog-test=${Date.now()}`)
    const invoker = window.document.getElementById("practice-invoker")
    invoker.focus()

    window.geneguessrOpenPracticeList()
    const dialog = window.document.querySelector("dialog.pg-practice-dialog")
    assert.ok(dialog)
    assert.equal(dialog.open, true)
    assert.equal(dialog.getAttribute("aria-labelledby"), "pg-practice-title")
    assert.equal(window.document.activeElement, dialog.querySelector(".pg-practice-textarea"))
    assert.equal(
      dialog.querySelector(".pg-practice-label")?.getAttribute("for"),
      "pg-practice-genes",
    )
    assert.equal(dialog.querySelector(".pg-practice-textarea")?.id, "pg-practice-genes")
    assert.equal(dialog.querySelector(".pg-practice-results")?.getAttribute("role"), "status")
    assert.equal(dialog.querySelector(".pg-practice-results")?.getAttribute("aria-live"), "polite")
    assert.equal(dialog.querySelector("[role='dialog']"), null)

    dialog
      .querySelector(".pg-practice-card")
      .dispatchEvent(new window.Event("click", { bubbles: true }))
    assert.equal(dialog.open, true)

    const cancelEvent = requestNativeCancel(window, dialog)
    assert.equal(cancelEvent.defaultPrevented, false)
    assert.equal(dialog.open, false)
    assert.equal(window.document.activeElement, invoker)

    window.geneguessrOpenPracticeList()
    dialog.dispatchEvent(new window.Event("click", { bubbles: true }))
    assert.equal(dialog.open, false)
    assert.equal(window.document.activeElement, invoker)
    await settle()
  } finally {
    for (const [name, descriptor] of replacedGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor)
      } else {
        delete globalThis[name]
      }
    }
  }
})

test("modal shells use native backdrops and declarative scroll lock without global handlers", () => {
  const practiceDialogStart = appSource.indexOf("// Practice-list dialog (B-247)")
  const practiceDialogEnd = appSource.indexOf(
    "window.geneguessrSetLeaderboardConsent",
    practiceDialogStart,
  )
  const practiceDialogSource = appSource.slice(practiceDialogStart, practiceDialogEnd)

  assert.match(tutorialSource, /document\.createElement\("dialog"\)/)
  assert.match(tutorialSource, /dialog\.showModal\(\)/)
  assert.match(tutorialSource, /dialog\.addEventListener\("close", handleClose\)/)
  assert.doesNotMatch(tutorialSource, /pg-tutorial-backdrop|pg-tutorial-locked|aria-modal/)
  assert.doesNotMatch(tutorialSource, /document\.addEventListener\("keydown"/)
  assert.doesNotMatch(tutorialSource, /event\.key === "Escape"/)

  assert.match(practiceDialogSource, /document\.createElement\("dialog"\)/)
  assert.match(practiceDialogSource, /practiceDialog\.showModal\(\)/)
  assert.match(practiceDialogSource, /practiceDialog\.close\(\)/)
  assert.doesNotMatch(
    practiceDialogSource,
    /pg-tutorial-backdrop|pg-tutorial-locked|aria-modal|aria-hidden/,
  )
  assert.doesNotMatch(practiceDialogSource, /document\.addEventListener|event\.key === "Escape"/)

  assert.match(stylesSource, /\.pg-modal-dialog\[open\]/)
  assert.match(stylesSource, /\.pg-modal-dialog::backdrop/)
  assert.match(stylesSource, /html:has\(\.pg-modal-dialog\[open\]\)/)
  assert.doesNotMatch(stylesSource, /\.pg-tutorial-backdrop|\.pg-tutorial-locked/)
})
