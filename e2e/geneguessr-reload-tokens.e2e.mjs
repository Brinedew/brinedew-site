// B-935: a returning player's page load asks for no structure token it already holds, and
// the page keeps nothing in IndexedDB, checked in a real browser.
//
// The scene: a player has made three guesses (a PDB, a SWISS-MODEL and an AlphaFold
// protein) and comes back. The page needs a structure token for each guess to label its
// viewer. The bootstrap carries them, derived from the rows the Worker already loads for
// the guesses, so the page makes one bootstrap request and no `/api/structure-token`
// request, on the first load and on every reload. If a payload carries none (an older
// Worker), the page falls back to one token request per guess.
//
// Ways this can fail, written before the code:
// 1. a reload asks `/api/structure-token?uniprot=` once per guess;
// 2. the tokens the page takes from the bootstrap differ from what the token route returns,
//    so a viewer would load a different structure than the route names;
// 3. the page writes a `geneguessr-structures` IndexedDB database nobody reads;
// 4. the game does not render, or a guess card is missing, once the tokens come from the
//    bootstrap;
// 5. without embedded tokens the fallback no longer asks the route for each guess.
//
// The page is the real quartz/static/geneguessr/app.js; every `/api/*` request goes to the
// real Worker on a real local D1 seeded with the production shape. Mol* is not served (its
// build is not in the repository), so a viewer shows its own error state; the check is on
// the requests the page makes. Needs an installed Chrome. The request counts and a
// screenshot land in artifacts/e2e/.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test, { after, before, mock } from "node:test"

import worker from "../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "../workers/daily-selection-pool-test-d1.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const STATIC = path.join(ROOT, "quartz", "static")
const COOKIE = "geneguessr_session=e2e-returning-player"
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GeneGuessr</title>
<link rel="stylesheet" href="/static/geneguessr/styles.css">
<script src="/static/geneguessr/molstar-shared.js"></script>
</head><body><main><div id="geneguessr-root"></div></main>
<script type="module" src="/static/geneguessr/app.js"></script></body></html>`

let db
let dispose
let rows
let origin
let server
let harness
let stripTokens = false
let requests = []

before(async () => {
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows()
  await seedCatalog(db, rows)
  harness = geneguessrWorkerEnv(db)

  // The providers answer the Worker's own availability probe with a usable file.
  mock.method(globalThis, "fetch", async () => {
    return new Response("data_structure\nHEADER    MODEL\nATOM  1\n", {
      status: 200,
      headers: { "Content-Type": "chemical/x-cif" },
    })
  })
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})

  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://local")
      if (url.pathname.startsWith("/api/")) {
        requests.push(`${request.method} ${url.pathname}${url.search}`)
        const body = request.method === "GET" ? undefined : await readBody(request)
        const answer = await worker.fetch(
          new Request(`${origin}${url.pathname}${url.search}`, {
            method: request.method,
            headers: { Cookie: COOKIE, "Content-Type": "application/json" },
            body,
          }),
          harness.env,
          { waitUntil() {} },
        )
        let text = await answer.text()
        if (stripTokens && url.pathname === "/api/game/bootstrap") {
          const payload = JSON.parse(text)
          for (const guess of payload.guesses) delete guess.structureToken
          text = JSON.stringify(payload)
        }
        response.writeHead(answer.status, {
          "content-type": answer.headers.get("content-type") || "application/json",
        })
        return response.end(text)
      }
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": TYPES[".html"] })
        return response.end(PAGE)
      }
      const file = path.join(STATIC, decodeURIComponent(url.pathname).replace(/^\/static\//, ""))
      if (
        url.pathname.startsWith("/static/") &&
        file.startsWith(STATIC) &&
        statSync(file).isFile()
      ) {
        response.writeHead(200, {
          "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        })
        return response.end(readFileSync(file))
      }
      response.writeHead(404)
      response.end("not found")
    } catch (error) {
      response.writeHead(500)
      response.end(String(error?.stack || error))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`

  // The player's first visit creates the session; their three guesses are then stored in
  // it as the guess handler leaves them.
  await worker.fetch(
    new Request(`${origin}/api/game/bootstrap`, { headers: { Cookie: COOKIE } }),
    harness.env,
    { waitUntil() {} },
  )
  const [[key, state]] = [...harness.sessions.entries()]
  harness.sessions.set(key, {
    ...state,
    guesses: guessed().map((row, index) => ({
      guessId: `g${index + 1}`,
      uniprot: row.uniprot,
      correct: false,
      createdAt: Date.now() + index,
      similarityPending: true,
    })),
  })
})

after(async () => {
  mock.restoreAll()
  await new Promise((resolve) => server?.close(resolve))
  await dispose?.()
})

const pickRow = (source) => rows.find((row) => row.structure_source === source && row.gene_summary)
const guessed = () => [pickRow("pdb"), pickRow("swissmodel"), pickRow("alphafold")]
const readBody = async (request) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
// One element per guess card; the card's own parts carry longer ids (`-structure`, ...).
const countGuessCards = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[id^="guess-card-"]')].filter((el) =>
        /^guess-card-[^-]+$/.test(el.id),
      ).length,
  )
const tokenRequests = () =>
  requests.filter((line) => line.includes("/api/structure-token?uniprot="))
const bootstrapRequests = () =>
  requests.filter((line) => line.startsWith("GET /api/game/bootstrap"))

// Nothing leaves the machine: the CDN fallbacks for Mol* and fonts are refused.
async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  )
  return context.newPage()
}

async function load(page) {
  requests = []
  await page.goto(`${origin}/?gg_api=${encodeURIComponent(origin)}`)
  await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
  // Token hydration and viewer setup run after the first render.
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(2500)
}

test("a returning player's load and reload ask for no guess token, and nothing is kept in IndexedDB", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  mkdirSync(OUT, { recursive: true })
  const page = await newPage(browser)
  try {
    stripTokens = false
    await load(page)
    const first = { bootstrap: bootstrapRequests().length, tokens: tokenRequests().length }
    await page.screenshot({ path: path.join(OUT, "geneguessr-reload-tokens.png"), fullPage: true })
    const guessCards = await countGuessCards(page)
    const rendered = await page.evaluate(() => document.body.dataset.geneguessrStatus)

    await load(page)
    const reload = { bootstrap: bootstrapRequests().length, tokens: tokenRequests().length }
    const databases = await page.evaluate(async () =>
      (await indexedDB.databases()).map((database) => database.name),
    )

    // What the page took from the bootstrap is what the route returns.
    const payload = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/api/game/bootstrap`, { credentials: "include" })
      return response.json()
    }, origin)
    const compared = []
    for (const guess of payload.guesses) {
      const route = await page.evaluate(
        async ({ base, uniprot }) => {
          const response = await fetch(`${base}/api/structure-token?uniprot=${uniprot}`)
          return response.json()
        },
        { base: origin, uniprot: guess.uniprot },
      )
      compared.push({
        uniprot: guess.uniprot,
        same: JSON.stringify(guess.structureToken) === JSON.stringify(route),
      })
    }

    writeFileSync(
      path.join(OUT, "geneguessr-reload-tokens.json"),
      JSON.stringify(
        { guesses: guessed().length, first, reload, guessCards, databases, compared },
        null,
        2,
      ),
    )

    assert.equal(rendered, "rendered")
    assert.equal(guessCards, 3, "the three guess cards render")
    assert.deepEqual(first, { bootstrap: 1, tokens: 0 }, "the first load asks for no token")
    assert.deepEqual(reload, { bootstrap: 1, tokens: 0 }, "a reload asks for no token")
    assert.ok(!databases.includes("geneguessr-structures"), `IndexedDB holds ${databases}`)
    assert.ok(
      compared.length === 3 && compared.every((entry) => entry.same),
      "same token as the route",
    )
  } finally {
    await browser.close()
  }
})

test("without embedded tokens the page falls back to one token request per guess", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const page = await newPage(browser)
  try {
    stripTokens = true
    await load(page)
    const asked = [
      ...new Set(tokenRequests().map((line) => line.match(/uniprot=([A-Z0-9]+)/)?.[1])),
    ].sort()
    assert.deepEqual(
      asked,
      guessed()
        .map((row) => row.uniprot)
        .sort(),
    )
    assert.equal(await countGuessCards(page), 3)
  } finally {
    stripTokens = false
    await browser.close()
  }
})
