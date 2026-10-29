#!/usr/bin/env node
// B-1190: does the extension's own code run in WebKit, Safari's engine, before
// we pay Apple to find out? Playwright's WebKit can't load an extension, so
// this runs the real files the way Safari would hold them:
//
// * the page is the real Wikipedia Homeobox article, served from a test
//   origin so that the service worker can run beside it as a dedicated worker;
// * service-worker.js and its imports run unchanged in that worker and fetch
//   the real CDN and API (both answer Access-Control-Allow-Origin: *);
// * the content scripts and CSS from manifest.json run unchanged in the page,
//   in manifest order;
// * only what Safari itself provides is stood in: chrome.runtime messaging,
//   chrome.runtime.getURL and chrome.storage.local (one store, in the worker).
//
// Ways it can fail, each checked on a desktop and on an iPhone:
// 1. a script throws while loading (a missing API, a syntax WebKit lacks);
// 2. no gene on the page is recognised (scanner, matcher or catalogue fetch);
// 3. recognised genes get no visible pill (CSS Custom Highlight API, range paint);
// 4. pointing at a gene (mouse) or tapping it (touch) opens no card;
// 5. the card opens without the gene's name or portrait.
//
// Output: artifacts/b-1190-webkit/<device>.png and result.json; exit 1 on failure.
// Run: node scripts/iconoplasm-extension-webkit-probe.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const { webkit, chromium, devices } = await import("playwright-core")
const ENGINE = process.env.PROBE_ENGINE === "chromium" ? chromium : webkit

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const EXTENSION = path.join(ROOT, "iconoplasm-extension")
const OUT = path.join(ROOT, "artifacts", "b-1190-webkit", process.env.PROBE_ENGINE || "webkit")
const ORIGIN = "https://iconoplasm-webkit.test"
const ARTICLE = "https://en.wikipedia.org/wiki/Homeobox"
const GENE = "HOXB1"
const manifest = JSON.parse(readFileSync(path.join(EXTENSION, "manifest.json"), "utf8"))
const pageScripts = manifest.content_scripts.find((entry) => entry.matches.includes("<all_urls>"))

const TYPES = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
}

// The worker: chrome.* as Safari gives it to a service worker, then the real file.
const WORKER = `
const listeners = []
const store = new Map()
const changed = []
const callable = (promise, callback) => (callback ? void promise.then(callback) : promise)
const storageArea = {
  get(keys, callback) {
    const out = {}
    const list = keys == null ? [...store.keys()] : typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
    for (const key of list) {
      if (store.has(key)) out[key] = structuredClone(store.get(key))
      else if (keys && typeof keys === "object" && !Array.isArray(keys)) out[key] = keys[key]
    }
    return callable(Promise.resolve(out), callback)
  },
  set(items, callback) {
    const changes = {}
    for (const [key, value] of Object.entries(items)) {
      changes[key] = { oldValue: store.get(key), newValue: value }
      store.set(key, structuredClone(value))
    }
    self.postMessage({ storageChanged: changes })
    return callable(Promise.resolve(), callback)
  },
  remove(keys, callback) {
    for (const key of [].concat(keys)) store.delete(key)
    return callable(Promise.resolve(), callback)
  },
}
self.chrome = {
  runtime: {
    id: "webkit-probe",
    getURL: (p) => "${ORIGIN}/ext/" + String(p).replace(/^\\//, ""),
    getManifest: () => (${JSON.stringify({ version: manifest.version, manifest_version: 3 })}),
    onMessage: { addListener: (fn) => listeners.push(fn) },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    lastError: undefined,
  },
  storage: { local: storageArea, onChanged: { addListener: (fn) => changed.push(fn) } },
}
self.onmessage = ({ data }) => {
  if (data.storage) {
    Promise.resolve(storageArea[data.storage.op](...data.storage.args)).then((value) =>
      self.postMessage({ id: data.id, value }),
    )
    return
  }
  let answered = false
  const respond = (value) => {
    if (answered) return
    answered = true
    self.postMessage({ id: data.id, value })
  }
  const sender = { id: "webkit-probe", url: data.url, tab: { id: 1, url: data.url }, frameId: 0 }
  let pending = false
  for (const fn of listeners) if (fn(data.message, sender, respond) === true) pending = true
  if (!pending) respond(undefined)
}
// Every request the service worker makes, and what came back, for the report.
const realFetch = self.fetch.bind(self)
self.fetch = async (input, init) => {
  const url = String(input?.url || input)
  try {
    const response = await realFetch(input, init)
    self.postMessage({ fetchLog: response.status + " " + url })
    return response
  } catch (error) {
    self.postMessage({ fetchLog: "FAILED " + url + " (" + error.message + ")" })
    throw error
  }
}
importScripts("${ORIGIN}/ext/service-worker.js")
`

// The page: the same chrome.* surface a content script gets, talking to the worker.
const PAGE_SHIM = `(() => {
  const worker = new Worker("${ORIGIN}/ext/__probe-worker.js")
  window.__probeErrors = []
  worker.onerror = (event) => window.__probeErrors.push("worker: " + event.message)
  const waiting = new Map()
  const changed = []
  let next = 0
  window.__probeFetches = []
  worker.onmessage = ({ data }) => {
    if (data.fetchLog) {
      window.__probeFetches.push(data.fetchLog)
      return
    }
    if (data.storageChanged) {
      for (const fn of changed) fn(data.storageChanged, "local")
      return
    }
    const resolve = waiting.get(data.id)
    waiting.delete(data.id)
    resolve?.(data.value)
  }
  const ask = (payload) =>
    new Promise((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      worker.postMessage({ id, url: location.href, ...payload })
    })
  const callable = (promise, callback) => (callback ? void promise.then(callback) : promise)
  const storage = (op) => (...args) => {
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : null
    return callable(ask({ storage: { op, args } }), callback)
  }
  window.chrome = {
    runtime: {
      id: "webkit-probe",
      getURL: (p) => "${ORIGIN}/ext/" + String(p).replace(/^\\//, ""),
      sendMessage: (message, callback) => callable(ask({ message }), callback),
      onMessage: { addListener() {} },
      lastError: undefined,
    },
    storage: {
      local: { get: storage("get"), set: storage("set"), remove: storage("remove") },
      onChanged: { addListener: (fn) => changed.push(fn) },
    },
  }
  window.addEventListener("error", (event) => window.__probeErrors.push(event.message + " @ " + (event.filename || "").split("/").pop() + ":" + event.lineno))
  window.addEventListener("unhandledrejection", (event) => window.__probeErrors.push("rejection: " + (event.reason?.stack || event.reason)))
})()`

async function probe(browser, name, contextOptions, touch) {
  const context = await browser.newContext(contextOptions)
  const article = await (await fetch(ARTICLE)).text()
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/ext/__probe-worker.js")
      return route.fulfill({ contentType: "text/javascript", body: WORKER })
    if (url.pathname.startsWith("/ext/")) {
      const file = path.join(EXTENSION, decodeURIComponent(url.pathname.slice(5)))
      try {
        return route.fulfill({
          contentType: TYPES[path.extname(file)] || "application/octet-stream",
          body: readFileSync(file),
        })
      } catch {
        return route.fulfill({ status: 404, body: "" })
      }
    }
    // The article itself, with its own stylesheets and images still loading from Wikipedia.
    return route.fulfill({
      contentType: "text/html",
      body: article.replace("<head>", '<head><base href="https://en.wikipedia.org/wiki/Homeobox">'),
    })
  })
  const page = await context.newPage()
  const consoleLines = []
  page.on("console", (line) => consoleLines.push(line.type() + ": " + line.text()))
  page.on("pageerror", (error) => consoleLines.push("pageerror: " + error.message))
  await page.goto(`${ORIGIN}/wiki/Homeobox`, { waitUntil: "domcontentloaded" })
  await page.evaluate(PAGE_SHIM)
  for (const css of pageScripts.css) await page.addStyleTag({ url: `${ORIGIN}/ext/${css}` })
  for (const js of pageScripts.js) await page.addScriptTag({ url: `${ORIGIN}/ext/${js}` })

  const result = { name, engine: browser.version() }
  // 2 and 3: genes recognised and painted.
  await page
    .waitForFunction(() => (CSS.highlights?.get("iconoplasm-gene-ranges")?.size || 0) > 0, null, {
      timeout: 30_000,
    })
    .catch(() => {})
  Object.assign(
    result,
    await page.evaluate(() => ({
      highlightApi: typeof Highlight === "function" && !!CSS.highlights,
      idleCallback: typeof requestIdleCallback === "function",
      geneRanges: CSS.highlights?.get("iconoplasm-gene-ranges")?.size || 0,
      highlightNames: CSS.highlights ? [...CSS.highlights.keys()] : [],
    })),
  )
  // 4 and 5: point at or tap the gene, then read the card.
  const word = page.getByText(GENE, { exact: true }).first()
  await word.scrollIntoViewIfNeeded().catch(() => {})
  const box = await word.boundingBox().catch(() => null)
  result.geneOnPage = !!box
  if (box) {
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    if (touch) {
      await page.evaluate(() => {
        window.__probeTap = []
        document.addEventListener(
          "pointerup",
          (event) => {
            const hit = document.caretRangeFromPoint?.(event.clientX, event.clientY)
            window.__probeTap.push({
              type: event.pointerType,
              x: Math.round(event.clientX),
              y: Math.round(event.clientY),
              word:
                hit?.startContainer?.data?.slice(hit.startOffset - 3, hit.startOffset + 5) || null,
            })
          },
          true,
        )
      })
      // Wikipedia's desktop page has no mobile viewport, so the phone shows it
      // zoomed out. WebKit's tap takes screen points while boundingBox gives
      // page points; scale them, or the tap lands far off the word.
      const scale = await page.evaluate(() => visualViewport?.scale || 1)
      await page.touchscreen.tap(x * scale, y * scale)
      result.tap = await page.evaluate(() => window.__probeTap)
      result.tapFrame = {
        box: { x: Math.round(x), y: Math.round(y) },
        ...(await word.evaluate((el) => {
          const r = el.getBoundingClientRect()
          return {
            rect: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
            inner: [innerWidth, innerHeight],
            scale: visualViewport?.scale,
            scroll: [Math.round(scrollX), Math.round(scrollY)],
          }
        })),
      }
    } else {
      await page.mouse.move(x - 40, y)
      await page.mouse.move(x, y, { steps: 4 })
    }
    await page
      .waitForSelector(".iconoplasm-tooltip", { state: "visible", timeout: 15_000 })
      .catch(() => {})
    await page
      .waitForFunction(
        () => {
          const tip = document.querySelector(".iconoplasm-tooltip")
          const root = tip?.querySelector("iframe")?.contentDocument?.body || tip
          return [...(root?.querySelectorAll("img") || [])].some(
            (img) => img.complete && img.naturalWidth > 0,
          )
        },
        null,
        { timeout: 20_000 },
      )
      .catch(() => {})
    Object.assign(
      result,
      await page.evaluate((gene) => {
        // The card is drawn inside the extension's own frame (same test origin
        // here), so its text and portrait are read from that document.
        const tip = document.querySelector(".iconoplasm-tooltip")
        const frame = tip?.querySelector("iframe")
        const inner = frame?.contentDocument?.body
        const text = ((tip?.innerText || "") + " " + (inner?.innerText || "")).trim()
        const portrait = [
          ...(inner || tip || document.createElement("i")).querySelectorAll("img"),
        ].find((img) => img.complete && img.naturalWidth > 0)
        const visible =
          !!tip &&
          getComputedStyle(tip).display !== "none" &&
          tip.getBoundingClientRect().height > 0 &&
          (text.length > 0 || !!portrait)
        return {
          cardOpen: visible,
          cardText: visible ? text.slice(0, 160) : "",
          cardNamesGene: visible && text.toUpperCase().includes(gene),
          cardHasFrame: !!frame,
          cardPortrait: !!portrait,
          cardImages: [
            ...(inner || tip || document.createElement("i")).querySelectorAll("img"),
          ].map(
            (img) =>
              `${img.complete ? "done" : "loading"} ${img.naturalWidth}px ${String(img.currentSrc || img.src).slice(0, 90)}`,
          ),
        }
      }, GENE),
    )
  }
  result.errors = await page.evaluate(() => window.__probeErrors || ["page navigated away"])
  result.fetches = await page.evaluate(() =>
    (window.__probeFetches || []).map((line) => line.replace(/[0-9a-f]{64}/, "<sha>")),
  )
  result.console = consoleLines
    .filter((line) => !/^(debug|log): (?!\[Iconoplasm\])/.test(line))
    .slice(0, 30)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  // 6. On a phone, the gene is a link: the first tap opened the card above;
  // a second tap on the same word follows the link.
  if (touch && box && result.cardOpen) {
    const target = await word.boundingBox()
    const scale = await page.evaluate(() => visualViewport?.scale || 1)
    await Promise.all([
      page.waitForURL((url) => !url.href.startsWith(ORIGIN), { timeout: 15_000 }).catch(() => {}),
      page.touchscreen.tap(
        (target.x + target.width / 2) * scale,
        (target.y + target.height / 2) * scale,
      ),
    ])
    result.secondTapFollowsLink = !page.url().startsWith(ORIGIN)
  }
  await context.close()
  return result
}

mkdirSync(OUT, { recursive: true })
const browser = await ENGINE.launch(ENGINE === chromium ? { channel: "chrome" } : {})
const results = []
try {
  results.push(await probe(browser, "desktop", { viewport: { width: 1280, height: 900 } }, false))
  results.push(await probe(browser, "iphone", { ...devices["iPhone 15"] }, true))
} finally {
  await browser.close()
}
writeFileSync(path.join(OUT, "result.json"), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
const failed = results.filter(
  (r) =>
    r.errors?.length ||
    !r.geneRanges ||
    !r.cardOpen ||
    !r.cardNamesGene ||
    !r.cardPortrait ||
    r.secondTapFollowsLink === false ||
    r.fetches.some((line) => /^FAILED https:\/\/img\./.test(line)),
)
process.exit(failed.length ? 1 : 0)
