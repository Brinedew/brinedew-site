import assert from "node:assert/strict"
import test from "node:test"

import { parseHTML } from "linkedom"
import renderToString from "preact-render-to-string"

import { ContactForm as makeContactForm } from "../../../.quartz/plugins/brinedew-components/dist/index.js"

const ContactForm = makeContactForm({ endpoint: "/api/contact" })
const script = String(ContactForm.afterDOMLoaded)
const markup = renderToString(
  ContactForm({
    fileData: { frontmatter: { contact: true } },
  }),
)

function createHarness(initialMarkup = "", url = "https://brinedew.bio/About.html") {
  const { document, window } = parseHTML(
    `<!doctype html><html><body>${initialMarkup}</body></html>`,
  )
  window.location = new URL(url)
  const requests = []
  const fetchStub = async (input, init) => {
    requests.push({ input, init })
    return new Response(JSON.stringify({ ok: true, queued: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  new Function("document", "window", "fetch", script)(document, window, fetchStub)

  function navigate(nextMarkup) {
    document.body.innerHTML = nextMarkup
    document.dispatchEvent(new window.CustomEvent("nav"))
  }

  async function submit() {
    const form = document.querySelector("[data-contact-form]")
    assert.ok(form)
    form.checkValidity = () => true
    form.reportValidity = () => true
    form.reset = () => {}
    const email = form.querySelector("input[name='email']")
    const message = form.querySelector("textarea[name='message']")
    assert.ok(email)
    assert.ok(message)
    email.value = "reader@example.com"
    message.value = "Hello from the lifecycle test."

    const event = new window.Event("submit", { bubbles: true, cancelable: true })
    form.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return event
  }

  return { document, navigate, requests, submit, window }
}

test("the unenhanced form uses POST and native validation without putting fields in the URL", () => {
  const { document } = parseHTML(`<!doctype html><html><body>${markup}</body></html>`)
  const form = document.querySelector("[data-contact-form]")
  const message = form?.querySelector("textarea[name='message']")

  assert.ok(form)
  assert.equal(form.getAttribute("action"), "/api/contact")
  assert.equal(form.getAttribute("method"), "post")
  assert.equal(form.hasAttribute("novalidate"), false)
  assert.equal(message?.getAttribute("minlength"), "3")
  assert.ok(document.querySelector("#contact-sent"))
  assert.ok(document.querySelector("#contact-invalid"))
  assert.equal(new URL(form.action, "https://brinedew.bio").search, "")
})

test("direct load enhances the form on Quartz's initial nav event", async () => {
  const harness = createHarness(markup)

  harness.document.dispatchEvent(new harness.window.CustomEvent("nav"))
  const event = await harness.submit()

  assert.equal(event.defaultPrevented, true)
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].input, "/api/contact")
  assert.equal(harness.requests[0].init.method, "POST")
})

test("forward SPA navigation enhances a newly inserted contact form", async () => {
  const harness = createHarness("<main>Home</main>")

  harness.document.dispatchEvent(new harness.window.CustomEvent("nav"))
  harness.navigate(markup)
  const event = await harness.submit()

  assert.equal(event.defaultPrevented, true)
  assert.equal(harness.requests.length, 1)
})

test("browser Back enhances the replacement form instead of relying on popstate patches", async () => {
  const harness = createHarness(markup)

  harness.document.dispatchEvent(new harness.window.CustomEvent("nav"))
  harness.navigate("<main>Another page</main>")
  harness.navigate(markup)
  const event = await harness.submit()

  assert.equal(event.defaultPrevented, true)
  assert.equal(harness.requests.length, 1)
  assert.equal(script.includes("history.pushState"), false)
  assert.equal(script.includes("quartz:nav"), false)
  assert.equal(script.includes("popstate"), false)
})

test("enhancement consumes a fallback fragment without leaving a contradictory status visible", async () => {
  const harness = createHarness(markup, "https://brinedew.bio/About.html#contact-invalid")

  harness.document.dispatchEvent(new harness.window.CustomEvent("nav"))

  const form = harness.document.querySelector("[data-contact-form]")
  const status = harness.document.querySelector("[data-contact-form-status]")
  const fallback = harness.document.querySelector("#contact-invalid")
  assert.equal(form?.dataset.contactFormEnhanced, "true")
  assert.match(status?.textContent || "", /Check your email address/)
  assert.equal(status?.getAttribute("data-tone"), "error")
  assert.match(
    String(ContactForm.css),
    /data-contact-form-enhanced="true".*contact-form__fallback-status/s,
  )
  assert.ok(fallback)

  await harness.submit()

  assert.match(status?.textContent || "", /Thanks/)
  assert.equal(status?.getAttribute("data-tone"), "ok")
})
