// B-903: the admin Styles scorecard, driven in a real browser. The page is the
// real admin shell and the real admin.js; only the admin API is faked, by an
// in-memory list that pages the way the server's keyset cursors do. (The
// server's own cost is proved by workers/iconoplasm/vision-stats-read-cost.test.js
// on real migrations; this checks what the browser asks for.)
//
// Ways the tab has broken or could break, each asserted below:
// 1. it asks for the whole scorecard (`scope=all`), or for more than one page per click;
// 2. a page flip asks again for the artist-tag queue or the blocklist;
// 3. Next, Previous, First and Last land on the wrong rows, or leave a button
//    enabled that has nowhere to go;
// 4. a sort or page-size change keeps the old cursor;
// 5. the examples for a vision the server has none for are asked for again after
//    every render, forever (found in B-903: 490 requests in a minute, each one a
//    D1 read, until the tab was closed).
//
// Needs an installed Chrome (CI has it; locally the test skips without it). The
// requests the page made land in artifacts/e2e/admin-styles-scorecard.json.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "../workers/iconoplasm-admin-html.js"
import { renderIconoplasmAdminHtml } from "../workers/iconoplasm-admin-assets.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const STATIC_ROOT = path.join(ROOT, "quartz", "static", "iconoplasm")
const IDS = Array.from({ length: 30 }, (_, index) => `v${String(index + 1).padStart(2, "0")}`)
const label = (id) => `Artist ${id.slice(1)}`
const NO_EXAMPLES = "v20"

function fakePage(searchParams) {
  const sort = searchParams.get("sort") || "live"
  const naturalDir = sort === "vision" ? "asc" : "desc"
  const dir = searchParams.get("dir") || naturalDir
  const limit = Number(searchParams.get("limit") || 50)
  const natural = sort === "vision" ? [...IDS] : [...IDS].reverse()
  const display = dir === naturalDir ? natural : [...natural].reverse()
  const after = searchParams.get("after")
  const before = searchParams.get("before")
  let start
  let end
  if (after) {
    start = display.indexOf(after) + 1
    end = start + limit
  } else if (before) {
    end = display.indexOf(before)
    start = Math.max(0, end - limit)
  } else if (searchParams.get("from") === "end") {
    end = display.length
    start = Math.max(0, end - limit)
  } else {
    start = 0
    end = limit
  }
  const rows = display.slice(start, end).map((id) => ({
    vision_id: id,
    artist_tag: `tag_${id}`,
    artist_name: label(id),
    emulsion_id: "0-1",
    image_count: 1,
    avg_vote: 0,
    rejection_rate: 0,
    live_count: 0,
    blacklisted: false,
  }))
  const cursorless = !after && !before
  return {
    ok: true,
    count: rows.length,
    sort,
    dir,
    limit,
    rows,
    next_cursor: end < display.length && rows.length ? rows.at(-1).vision_id : null,
    prev_cursor: start > 0 && rows.length ? rows[0].vision_id : null,
    ...(cursorless ? { blacklisted: [] } : {}),
  }
}

test("the Styles scorecard asks for one page per click and never loops", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url, "http://local")
    if (pathname === "/admin") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return response.end(renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, {}))
    }
    const match = pathname.match(/^\/static\/iconoplasm\/([A-Za-z0-9._-]+)$/)
    if (match) {
      try {
        const body = readFileSync(path.join(STATIC_ROOT, match[1]))
        response.writeHead(200, {
          "content-type": match[1].endsWith(".css") ? "text/css" : "text/javascript",
        })
        return response.end(body)
      } catch {}
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  const calls = []
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route(`${origin}/api/iconoplasm/admin/**`, async (route) => {
    const url = new URL(route.request().url())
    const apiPath = url.pathname.replace("/api/iconoplasm/admin", "")
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (apiPath === "/votes/vision-stats") {
      calls.push({ kind: "stats", search: url.search })
      return json(fakePage(url.searchParams))
    }
    if (apiPath === "/votes/vision-previews") {
      calls.push({ kind: "previews", search: url.search })
      // Every vision answers except the one with no examples, which the server
      // simply leaves out of its reply.
      const ids = url.searchParams.get("vision_ids").split(",")
      return json({
        ok: true,
        rows: ids.filter((id) => id !== NO_EXAMPLES).map((id) => ({ vision_id: id, assets: [] })),
      })
    }
    if (apiPath === "/artist-blacklist-submissions/pending") {
      calls.push({ kind: "pending", search: url.search })
      return json({ ok: true, requests: [] })
    }
    calls.push({ kind: "other", search: apiPath })
    return json({})
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on("pageerror", (error) => consoleErrors.push(String(error)))

  const statsCalls = () => calls.filter((call) => call.kind === "stats")
  const names = () =>
    page.$$eval("#vision-stats-list .vision-open-btn strong", (nodes) =>
      nodes.map((node) => node.textContent),
    )
  const buttons = () =>
    page.evaluate(() =>
      Object.fromEntries(
        ["first", "prev", "next", "last"].map((name) => [
          name,
          document.getElementById(`vision-page-${name}`).disabled,
        ]),
      ),
    )
  // One click, exactly one scorecard request, then the rows it returned. The
  // click replaces the list with a loading row at once, so waiting for the
  // response and then for a first row cannot see the page that was already there.
  async function click(selector, expectFirst) {
    const before = statsCalls().length
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/votes/vision-stats")),
      page.click(selector),
    ])
    await page.waitForFunction(
      (first) =>
        document.querySelector("#vision-stats-list .vision-open-btn strong")?.textContent === first,
      expectFirst,
    )
    assert.equal(statsCalls().length - before, 1, `${selector}: one scorecard request per click`)
    return statsCalls().at(-1).search
  }

  try {
    await page.goto(`${origin}/admin#styles`)
    await page.waitForSelector("#vision-stats-list tr.vision-table-row")

    // 1. Opening asks for one page, never the whole scorecard.
    assert.equal(statsCalls().length, 1)
    assert.equal(statsCalls()[0].search, "?sort=live&dir=desc&limit=12")
    assert.deepEqual(await names(), IDS.slice(18).reverse().map(label))
    assert.deepEqual(await buttons(), { first: true, prev: true, next: false, last: false })
    assert.equal(calls.filter((call) => call.kind === "pending").length, 1)

    // 3. Next, Previous, Last and First land on the right rows.
    let search = await click("#vision-page-next", label("v18"))
    assert.match(search, /[?&]after=v19(&|$)/)
    assert.deepEqual(await names(), IDS.slice(6, 18).reverse().map(label))
    assert.deepEqual(await buttons(), { first: false, prev: false, next: false, last: false })
    search = await click("#vision-page-next", label("v06"))
    assert.match(search, /[?&]after=v07(&|$)/)
    assert.deepEqual(await names(), IDS.slice(0, 6).reverse().map(label))
    assert.deepEqual(await buttons(), { first: false, prev: false, next: true, last: true })
    search = await click("#vision-page-prev", label("v18"))
    assert.match(search, /[?&]before=v06(&|$)/)
    assert.deepEqual(await names(), IDS.slice(6, 18).reverse().map(label))
    search = await click("#vision-page-last", label("v12"))
    assert.match(search, /[?&]from=end(&|$)/)
    assert.deepEqual(await names(), IDS.slice(0, 12).reverse().map(label))
    assert.deepEqual(await buttons(), { first: false, prev: false, next: true, last: true })
    search = await click("#vision-page-first", label("v30"))
    assert.equal(search, "?sort=live&dir=desc&limit=12")
    assert.deepEqual(await buttons(), { first: true, prev: true, next: false, last: false })

    // 4. A sort or page-size change starts again from the first page.
    search = await click('[data-vision-sort="live"]', label("v01"))
    assert.equal(search, "?sort=live&dir=asc&limit=12")
    search = await click('[data-vision-sort="vision"]', label("v01"))
    assert.equal(search, "?sort=vision&dir=asc&limit=12")
    search = await click("#vision-page-next", label("v13"))
    assert.match(search, /^\?sort=vision&dir=asc&limit=12&after=v12$/)
    const before = statsCalls().length
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/votes/vision-stats")),
      page.selectOption("#vision-page-size", "25"),
    ])
    await page.waitForFunction(
      () => document.querySelectorAll("#vision-stats-list tr.vision-table-row").length === 25,
    )
    assert.equal(statsCalls().length - before, 1)
    assert.equal(statsCalls().at(-1).search, "?sort=vision&dir=asc&limit=25")

    // 2. Across every flip the artist-tag queue was asked for once, at the open.
    assert.equal(calls.filter((call) => call.kind === "pending").length, 1)

    // 1. Nothing ever asked for the old whole-scorecard form.
    for (const call of statsCalls()) {
      assert.doesNotMatch(call.search, /scope=/)
      assert.ok(Number(new URLSearchParams(call.search).get("limit")) <= 200)
    }

    // 5. The examples the server cannot answer are not asked for again and again.
    await page.waitForTimeout(1500)
    const settled = calls.filter((call) => call.kind === "previews").length
    await page.waitForTimeout(2500)
    assert.equal(
      calls.filter((call) => call.kind === "previews").length,
      settled,
      "the page keeps re-requesting examples while idle",
    )
    assert.deepEqual(consoleErrors, [])
  } finally {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(
      path.join(OUT, "admin-styles-scorecard.json"),
      JSON.stringify({ calls, consoleErrors }, null, 2),
    )
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
})
