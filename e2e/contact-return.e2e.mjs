// B-906: the main site links its About page directly, and the contact form's no-JavaScript
// return lands on that page with its notice showing, checked in a real browser.
//
// The scene: a reader clicks "About" in any page footer, or sends the contact form from a
// browser without JavaScript and is sent back with #contact-sent. Both used to go through
// /About.html, which reaches /about only through a 308 and a meta-refresh stub: three
// requests, an address bar left on /About.html, and (for the form) a stub that drops the
// fragment, so the "Thanks" notice stayed hidden.
//
// Ways this can fail, written before the code:
// 1. a main-site footer links /About.html (or anything but /about);
// 2. the footer click costs more than one request for the page, or leaves the address bar
//    somewhere other than /about;
// 3. the worker answers the form post with a redirect that is not /about#contact-<state>;
// 4. after that redirect the notice for the state (sent, invalid, limited) is hidden: the
//    fragment was lost on the way, or the page was not reached directly;
// 5. the redirect chain after the post has more than the 303 and the page itself.
//
// The redirect comes from the real `handleContactSubmission` in workers/contact-form.js, fed
// the browser's own POST, with in-memory bindings: nothing is sent anywhere.
//
// Needs `pnpm run build` (public) and an installed Chrome. The request chains and
// screenshots land in artifacts/e2e/.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { handleContactSubmission } from "../workers/contact-form.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const SITE = process.env.E2E_MAIN_SITE || path.join(ROOT, "public")
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".xml": "application/xml",
}

// Case-sensitive, like the production static assets, even on a case-insensitive disk.
function fileExactly(file) {
  try {
    if (!statSync(file).isFile()) return false
    return readdirSync(path.dirname(file)).includes(path.basename(file))
  } catch {
    return false
  }
}

// Cloudflare Pages: /x.html answers 308 to /x, /x serves x.html, /x/ serves x/index.html.
async function startMainSite() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://local")
    const clean = decodeURIComponent(url.pathname).replace(/^\/+/, "")
    if (/\.html$/.test(clean) && !/(^|\/)index\.html$/.test(clean)) {
      response.writeHead(308, { location: `/${clean.slice(0, -5)}${url.search}` })
      return response.end()
    }
    for (const candidate of [clean, `${clean}.html`, path.posix.join(clean, "index.html")]) {
      const file = path.join(SITE, candidate)
      if (!file.startsWith(SITE) || !fileExactly(file)) continue
      response.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      })
      return response.end(readFileSync(file))
    }
    response.writeHead(404, { "content-type": "text/plain" })
    response.end("not found")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

function contactBindings({ limited = false } = {}) {
  return {
    PUBLIC_RATE_LIMIT_5: { limit: async () => ({ success: !limited }) },
    CONTACT_EMAIL: { send: async () => ({ messageId: "e2e" }) },
  }
}

test("the footer About link reaches /about in one request", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startMainSite()
  mkdirSync(OUT, { recursive: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } })
    const page = await context.newPage()
    const chain = []
    page.on("response", (response) => {
      const request = response.request()
      const { pathname } = new URL(response.url())
      if (!/^\/about(\.html)?$/i.test(pathname)) return
      if (!["document", "fetch"].includes(request.resourceType())) return
      chain.push(`${response.status()} ${pathname}`)
    })
    await page.goto(`${origin}/`, { waitUntil: "load" })
    const link = page.locator("footer a", { hasText: "About" }).first()
    // 1. The footer links /about.
    assert.equal(await link.getAttribute("href"), "/about")
    chain.length = 0
    await link.click()
    await page.waitForSelector("[data-contact-form]", { timeout: 15_000 })
    await page.waitForTimeout(500)
    // 2. One request, and the address bar says /about.
    assert.deepEqual(chain, ["200 /about"], "requests for the About page after one click")
    assert.equal(new URL(page.url()).pathname, "/about")
    writeFileSync(path.join(OUT, "contact-return-footer.json"), JSON.stringify({ chain }, null, 2))
  } finally {
    server.close()
    await browser.close()
  }
})

test("the no-JavaScript contact form returns to /about with its notice showing", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startMainSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    const cases = [
      { state: "sent", message: "Hello from the browser check.", limited: false },
      // Whitespace passes the browser's own `required` check; the worker trims it to nothing.
      { state: "invalid", message: "   ", limited: false },
      { state: "limited", message: "Hello again.", limited: true },
    ]
    for (const { state, message, limited } of cases) {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 1100, height: 900 },
      })
      const page = await context.newPage()
      const chain = []
      let posted = 0
      // The browser's own POST goes to the real handler; its answer goes back to the browser.
      await context.route(/\/api\/contact$/, async (route) => {
        posted += 1
        const original = route.request()
        const answer = await handleContactSubmission(
          new Request(original.url(), {
            method: "POST",
            // Cloudflare adds the client address at the edge; the handler keys its limit on it.
            headers: { ...original.headers(), "cf-connecting-ip": "203.0.113.42" },
            body: original.postData(),
          }),
          contactBindings({ limited }),
          {},
          {},
        )
        await route.fulfill({
          status: answer.status,
          headers: { location: answer.headers.get("Location") || "" },
          body: "",
        })
      })
      page.on("response", (response) => {
        if (response.request().isNavigationRequest()) {
          chain.push(`${response.status()} ${new URL(response.url()).pathname}`)
        }
      })
      await page.goto(`${origin}/about`, { waitUntil: "load" })
      await page.fill("input[name='email']", "reader@example.com")
      await page.fill("textarea[name='message']", message)
      chain.length = 0
      await page.click("[data-contact-form-submit]")
      await page.waitForTimeout(1500)

      const where = `state ${state}`
      assert.equal(posted, 1, `${where}: the form must post exactly once`)
      // 3 + 4. Back on /about with the state's fragment, and its notice showing.
      const final = new URL(page.url())
      assert.equal(final.pathname, "/about", `${where}: final path`)
      assert.equal(final.hash, `#contact-${state}`, `${where}: final fragment`)
      const notice = await page.evaluate((id) => {
        const el = document.getElementById(id)
        if (!el) return null
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        return {
          isTarget: el.matches(":target"),
          shown: style.display !== "none" && box.width > 0 && box.height > 0,
          text: el.textContent.trim(),
        }
      }, `contact-${state}`)
      assert.notEqual(notice, null, `${where}: the notice is missing from the page`)
      assert.equal(notice.isTarget, true, `${where}: the notice is not the fragment target`)
      assert.equal(notice.shown, true, `${where}: the notice is hidden`)
      assert.ok(notice.text.length > 10, `${where}: the notice is empty`)
      // 5. The 303 and the page, nothing between.
      assert.deepEqual(chain, ["303 /api/contact", "200 /about"], `${where}: redirect chain`)

      await page.screenshot({ path: path.join(OUT, `contact-return-${state}.png`) })
      report.push({ state, chain, finalUrl: page.url(), notice })
      await context.close()
    }
  } finally {
    writeFileSync(path.join(OUT, "contact-return.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
