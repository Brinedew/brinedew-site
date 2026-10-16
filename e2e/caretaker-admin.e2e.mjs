// B-1097: the admin's Caretakers tab, in a real browser. The page is the real
// admin shell and the real caretaker-admin-*.js; only the admin API is faked,
// by an in-memory roster that changes the way the server does when a role's
// versions are rolled back. (The server's own rows are proved on the real schema
// by workers/iconoplasm-caretaker-admin-routes.test.js.)
//
// On 2026-10-16 the tab showed the admin internal ids and constant zeros
// ("Head version 0" for a role with three versions), a button called
// "Withdraw them" that named nothing, and a roster 48 px wider than its box.
// Ways it can fail, each asserted below:
// 1. the roster is wider than its box, so a column is cut off;
// 2. a row can't be picked by clicking any of its cells, or by Tab and Enter;
// 3. the detail shows an internal id or field (assignment_, text_, revision_,
//    caretaker_standard, a version of 0);
// 4. the detail doesn't mark the text new images are drawn from, or hides the
//    Original's length beside a cut version;
// 5. "Roll back N versions" shows on a role with nothing to roll back or on an
//    open one; the press sends anything but the role's current version; after
//    it the mark stays on the version, the version isn't marked Withdrawn, or
//    the button stays;
// 6. the end form offers Keep or Roll back to a role that wrote no versions.
//
// Needs an installed Chrome (CI has it; locally the test skips without it).
// Screenshots land in artifacts/e2e/.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "../workers/iconoplasm-admin-html.js"
import { renderIconoplasmAdminHtml } from "../workers/iconoplasm-admin-assets.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const STATIC_ROOT = path.join(ROOT, "quartz", "static", "iconoplasm")
const AUTHOR = "Caretaker 957F16BE"

function role(id, symbol, status, extra = {}) {
  return {
    caretaker_assignment_id: id,
    gene_id: `gene_${symbol}`,
    canonical_symbol: symbol,
    account_id: "account_e2e",
    author_label: AUTHOR,
    account_status: "active",
    status,
    assignment_version: status === "ended" ? 2 : 1,
    terms_version_id: "terms_2026_09_25_v4",
    relinquish_policy: status === "ended" ? "retain" : null,
    created_at: "2026-09-27T17:44:00.000Z",
    started_at: "2026-09-27T17:44:00.000Z",
    suspended_at: null,
    ended_at: status === "ended" ? "2026-09-30T04:00:00.000Z" : null,
    versions: { total: 0, kept: 0, newest: null },
    drawn_from: { kind: "original", characters: 4574 },
    original_characters: 4574,
    ...extra,
  }
}

// ADO as it stood on the 2026-10-14 copy: three versions cut at 4,000
// characters, the newest chosen, its role ended keeping them.
function roster() {
  return [
    role("assignment_ado", "ADO", "ended", {
      versions: { total: 3, kept: 3, newest: { number: 3, characters: 4000 } },
      drawn_from: { kind: "version", number: 3, characters: 4000, own: true, author_label: AUTHOR },
    }),
    role("assignment_nsf", "NSF", "ended"),
    role("assignment_esd", "ESD", "active"),
    role("assignment_rgs3_with_a_long_gene_column", "RGS3", "ended", {
      versions: { total: 1, kept: 1, newest: { number: 1, characters: 4000 } },
      drawn_from: { kind: "version", number: 1, characters: 4000, own: true, author_label: AUTHOR },
      original_characters: 8376,
    }),
  ]
}

function serveAdmin() {
  return createServer((request, response) => {
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
}

test("the Caretakers tab names texts in History's words and rolls a role back once", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  mkdirSync(OUT, { recursive: true })
  const server = serveAdmin()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${server.address().port}`
  const rows = roster()
  const posts = []

  for (const width of [1280, 1150]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route(`${origin}/api/**`, async (route) => {
      const url = new URL(route.request().url())
      const json = (body, status = 200) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
      const apiPath = url.pathname.replace("/api/iconoplasm/admin/caretakers", "")
      if (apiPath === "/registry") return json({ ok: true, assignments: rows, next_cursor: null })
      const action = apiPath.match(/^\/assignments\/([^/]+)\/(\w+)$/)
      if (action && route.request().method() === "POST") {
        const body = route.request().postDataJSON()
        posts.push({ id: action[1], action: action[2], body })
        const row = rows.find((candidate) => candidate.caretaker_assignment_id === action[1])
        if (action[2] !== "withdraw" || body.expected_assignment_version !== row.assignment_version)
          return json({ error: { code: "ASSIGNMENT_VERSION_CONFLICT", message: "Stale" } }, 409)
        row.assignment_version += 1
        row.relinquish_policy = "withdraw"
        row.versions = { ...row.versions, kept: 0 }
        row.drawn_from = { kind: "original", characters: row.original_characters }
        return json({ ok: true, status: "ended" })
      }
      return json({ ok: true })
    })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${origin}/admin#caretakers`)
    await page.waitForSelector("[data-caretaker-registry-body] tr .caretaker-admin__row-button")

    // 1. The roster fits its box.
    const fit = await page.evaluate(() => {
      const wrap = document.querySelector("#panel-caretakers .table-wrap")
      return {
        scroll: wrap.scrollWidth,
        client: wrap.clientWidth,
        page: document.documentElement.scrollWidth,
        window: innerWidth,
      }
    })
    assert.ok(
      fit.scroll <= fit.client + 1,
      `${width}: roster ${fit.scroll} px in a ${fit.client} px box`,
    )
    assert.ok(fit.page <= fit.window, `${width}: the page scrolls sideways`)
    assert.deepEqual(
      await page.$$eval("#panel-caretakers thead th", (cells) =>
        cells.map((cell) => cell.textContent),
      ),
      ["Gene", "Caretaker", "Status", "Started", "Ended"],
    )

    // 2. Any cell picks its row; so do Tab and Enter on the gene.
    const detail = page.locator("[data-caretaker-detail]")
    await page.locator("tr", { hasText: "NSF" }).locator("td").nth(3).click()
    await assert.doesNotReject(detail.locator("h3", { hasText: "NSF" }).waitFor())
    await page.locator("tr", { hasText: "ESD" }).locator(".caretaker-admin__row-button").focus()
    await page.keyboard.press("Enter")
    await detail.locator("h3", { hasText: "ESD" }).waitFor()

    // 6. A role with no versions has nothing to keep or roll back.
    assert.equal(await detail.locator("input[name='caretaker-relinquish-policy']").count(), 0)
    assert.equal(await detail.getByRole("button", { name: /Roll back/ }).count(), 0)

    await page.locator("tr", { hasText: "NSF" }).locator(".caretaker-admin__row-button").click()
    assert.equal(
      await detail.getByRole("button", { name: /Roll back/ }).count(),
      0,
      "5: nothing to roll back",
    )

    await page.locator("tr", { hasText: "ADO" }).locator(".caretaker-admin__row-button").click()
    await detail.locator("h3", { hasText: "ADO" }).waitFor()
    // 3. No internal ids or fields.
    const text = await detail.innerText()
    assert.doesNotMatch(text, /assignment_|text_|revision_|caretaker_standard|retain|\b0\b/)
    // 4. The cut version carries the mark; the Original's length sits beside it.
    const texts = () =>
      detail.locator(".caretaker-admin__text").evaluateAll((items) =>
        items.map((item) => ({
          text: item.innerText.replace(/\s+/g, " ").trim(),
          source: item.dataset.source === "true",
        })),
      )
    if (width === 1280) {
      assert.deepEqual(await texts(), [
        { text: "Version 3 4,000 characters", source: true },
        { text: "Original 4,574 characters", source: false },
      ])
      await page.screenshot({ path: path.join(OUT, "caretaker-admin-ado-before.png") })

      // 5. One press rolls back exactly this role at its current version.
      await detail.getByRole("button", { name: "Roll back 3 versions" }).click()
      await page.waitForFunction(() =>
        /Reverted versions by/.test(document.querySelector("[data-caretaker-status]").textContent),
      )
      assert.deepEqual(posts, [
        { id: "assignment_ado", action: "withdraw", body: { expected_assignment_version: 2 } },
      ])
      assert.deepEqual(await texts(), [
        { text: "Version 3 4,000 characters Withdrawn", source: false },
        { text: "Original 4,574 characters", source: true },
      ])
      assert.equal(await detail.getByRole("button", { name: /Roll back/ }).count(), 0)
      await page.screenshot({ path: path.join(OUT, "caretaker-admin-ado-after.png") })
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
})
