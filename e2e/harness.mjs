// Shared browser harness for the E2E checks (B-839). It serves the built
// public-iconoplasm-edge site, routes the production host to it, and mocks
// only the signed-in /api/* calls a test names. Public reads stay real.
import { createServer } from "node:http"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

export const ROOT = fileURLToPath(new URL("..", import.meta.url))
export const SITE = process.env.E2E_SITE || path.join(ROOT, "public-iconoplasm-edge")
// CI uploads artifacts/e2e; a run for one issue can point E2E_OUT at artifacts/<issue>.
export const OUT = process.env.E2E_OUT || path.join(ROOT, "artifacts", "e2e")
export const HOST = "https://iconoplasm.brinedew.bio"
export const VIEWPORTS = [
  [1280, 860, "desktop"],
  [400, 820, "phone"],
]
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
}

function siteFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "")
  for (const candidate of [clean, `${clean}.html`, path.posix.join(clean, "index.html")]) {
    const file = path.join(SITE, candidate)
    if (!file.startsWith(SITE)) continue
    try {
      if (statSync(file).isFile()) return file
    } catch {}
  }
  // Single-page application fallback, like the production static assets.
  return path.join(SITE, "index.html")
}

export async function startSite() {
  const server = createServer((request, response) => {
    const file = siteFile(new URL(request.url, "http://local").pathname)
    response.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
    })
    response.end(readFileSync(file))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

// Pages here load under the production hostname, so Cloudflare's Web Analytics
// beacon counted every CI run as a visitor: US "visits" rose with the CI runs
// to about 130 on 2026-10-29, nearly all on the Iconoplasm homepage. Every context
// answers the beacon locally; a test that watches it registers its own route,
// which wins.
const BEACON = /^https:\/\/(static\.)?cloudflareinsights\.com\//

// Locally without Chrome this is a skip; CI always has it.
export async function launchChrome(t) {
  try {
    const browser = await chromium.launch({ channel: "chrome" })
    const newContext = browser.newContext.bind(browser)
    browser.newContext = async (options) => {
      const context = await newContext(options)
      await context.route(BEACON, (route) => route.fulfill({ status: 204, body: "" }))
      return context
    }
    return browser
  } catch (error) {
    if (!process.env.CI) {
      t.skip(`Chrome is not available: ${error.message}`)
      return null
    }
    throw error
  }
}

// `api(pathname, request)` returns a JSON body to mock that call, or
// undefined to fall through: a signed-in /api/auth/me, real public reads,
// and {} for everything else.
// A mocked API answer with a non-200 status, e.g. `new HttpStatus(503, {...})`.
export class HttpStatus {
  constructor(status, body = {}) {
    this.status = status
    this.body = body
  }
}

export async function routeProduction(
  context,
  localOrigin,
  api = () => undefined,
  { session = true } = {},
) {
  // `session: false` is an anonymous reader: no signed-in hint cookie.
  if (session) {
    await context.addCookies([
      {
        name: "brinedew_session_present",
        value: "1",
        domain: "iconoplasm.brinedew.bio",
        path: "/",
        secure: true,
        sameSite: "Lax",
      },
    ])
  }
  await context.route(`${HOST}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith("/api/")) {
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
      // A mock may answer late (a Promise), like a slow server.
      const mocked = await api(url.pathname, route.request())
      if (mocked instanceof HttpStatus) {
        return route.fulfill({
          status: mocked.status,
          contentType: "application/json",
          body: JSON.stringify(mocked.body),
        })
      }
      if (mocked !== undefined) return json(mocked)
      if (url.pathname === "/api/auth/me") {
        return json({
          authenticated: true,
          user: { id: "u1", user_id: "u1", account_id: "u1", username: "e2e", display_name: "E2E" },
        })
      }
      if (url.pathname.startsWith("/api/public/")) return route.continue()
      return json({})
    }
    // A page can still be loading a module when its test closes the context and the
    // local server; that late fetch fails, and unhandled it failed a passing test (#652).
    try {
      const local = await fetch(`${localOrigin}${url.pathname}`)
      return await route.fulfill({
        status: local.status,
        contentType: local.headers.get("content-type") || undefined,
        body: Buffer.from(await local.arrayBuffer()),
      })
    } catch {
      return route.abort().catch(() => {})
    }
  })
}

// Runs in the page: every visible button inside `root`, with its box, font,
// rendered line count and computed colours.
// A caretaker can show or hide a gene's lore at any moment, so a test that
// expects no lore pins it hidden instead of trusting today's live object
// (2026-10-21: TP53's caretaker turned its lore on and two tests went red).
export async function fulfillWithoutLore(route) {
  const response = await route.fetch()
  const gene = await response.json()
  gene.canonical_manifestation = {
    ...gene.canonical_manifestation,
    public_page_visible: false,
    prose: null,
  }
  await route.fulfill({ response, json: gene })
}

export function measureButtons(rootSelector) {
  const root = document.querySelector(rootSelector)
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }
  // Any CSS colour (oklch, color(srgb ...), rgba) as [r, g, b, a] in 0-255.
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data]
  }
  const buttons = [...root.querySelectorAll("button, .icono-button")]
    .filter((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0)
    .map((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const lines = new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
      const style = getComputedStyle(el)
      return {
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 32),
        className: String(el.className),
        disabled: el.disabled === true,
        lines,
        font: style.fontFamily,
        background: style.backgroundColor,
        backgroundRgba: rgba(style.backgroundColor),
        color: style.color,
        ...box(el),
      }
    })
  return { viewport: innerWidth, root: box(root), buttons }
}

// B-849: the one dialog frame. Runs in the page; every Iconoplasm dialog must
// return the same radius, header height, close-button size and title face.
export function measureDialogFrame(rootSelector) {
  const dialog = document.querySelector(rootSelector)
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }
  }
  const header = dialog.querySelector(".icono-dialog__header")
  const title = dialog.querySelector(".icono-dialog__title")
  const close = dialog.querySelector(".icono-dialog__close")
  const body = dialog.querySelector(".icono-dialog__body")
  const footer = dialog.querySelector(".icono-dialog__footer")
  const style = getComputedStyle(dialog)
  return {
    isNativeDialog: dialog.tagName === "DIALOG" && dialog.classList.contains("icono-dialog"),
    modal: dialog.matches(":modal"),
    viewport: innerWidth,
    radius: style.borderTopLeftRadius,
    dialog: box(dialog),
    header: header ? box(header) : null,
    close: close ? box(close) : null,
    closeLabel: close?.getAttribute("aria-label") || null,
    titleFont: title ? getComputedStyle(title).fontFamily : null,
    titleSize: title ? getComputedStyle(title).fontSize : null,
    bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
    footerVisible: footer ? footer.checkVisibility() : false,
    pageScrollLocked: getComputedStyle(document.documentElement).overflow === "hidden",
  }
}
