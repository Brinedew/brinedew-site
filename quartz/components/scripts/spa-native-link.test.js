import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import test from "node:test"
import { build } from "esbuild"
import { parseHTML } from "linkedom"

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./spa.inline.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
})

function clickLink(href, attributes = {}) {
  const { window } = parseHTML("<html><head><title>Fixture</title></head><body></body></html>")
  const { document, Event } = window
  const location = new URL("https://example.test/current")
  window.location = location
  const requests = []
  runInNewContext(bundle.outputFiles[0].text, {
    window,
    document,
    URL,
    console,
    HTMLElement: window.HTMLElement,
    customElements: window.customElements,
    CustomEvent: window.CustomEvent,
    DOMParser: window.DOMParser,
    fetch: (url) => {
      requests.push(String(url))
      return new Promise(() => {})
    },
    setTimeout,
    clearTimeout,
  })
  const anchor = document.createElement("a")
  anchor.href = href
  for (const [key, value] of Object.entries(attributes)) anchor.setAttribute(key, value)
  const child = document.createElement("span")
  anchor.append(child)
  document.body.append(anchor)
  const event = new Event("click", { bubbles: true, cancelable: true })
  child.dispatchEvent(event)
  return { prevented: event.defaultPrevented, requests }
}

test("router preserves native downloads, including an empty download attribute", () => {
  for (const href of ["https://example.test/export.svg", "blob:https://example.test/export"]) {
    for (const download of ["", "diagram.svg"]) {
      assert.deepEqual(clickLink(href, { download }), { prevented: false, requests: [] })
    }
  }
})

test("same-origin blob URLs are not HTML page routes", () => {
  assert.deepEqual(clickLink("blob:https://example.test/export"), {
    prevented: false,
    requests: [],
  })
})

test("ordinary same-origin page clicks still belong to Quartz", () => {
  const result = clickLink("https://example.test/next")
  assert.equal(result.prevented, true)
  assert.deepEqual(result.requests, ["https://example.test/next"])
})
