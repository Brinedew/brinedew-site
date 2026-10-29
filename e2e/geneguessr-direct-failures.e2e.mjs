// Failure modes 5 to 7 in e2e/geneguessr-direct-structures.shared.mjs, which holds
// the scene, the setup and the helpers. The GeneGuessr browser tests are four files so
// that they run side by side: as one file they took about 490 s, the E2E lane's whole wait.
// E2E scope: quartz/static/geneguessr/ quartz/static/vendor/ !workers/iconoplasm
import assert from "node:assert/strict"
import test from "node:test"
import { MAX_STRUCTURE_FILE_BYTES } from "../quartz/static/geneguessr/structure-bytes.js"
import {
  chromeAndMolstar,
  guess,
  guessRows,
  measured,
  newestTarget,
  openGame,
  openVisitor,
  origin,
  rowWith,
  save,
  setRewrite,
  visit,
} from "./geneguessr-direct-structures.shared.mjs"

test("a provider that fails, answers an error or blocks the browser sends that one guess through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-failing",
      provider: async (url, route) => {
        const { hostname } = new URL(url)
        if (hostname === "models.rcsb.org") {
          await route.abort("connectionreset")
          return true
        }
        if (hostname === "alphafold.ebi.ac.uk") {
          await route.fulfill({
            status: 503,
            body: "busy",
            headers: { "access-control-allow-origin": "*" },
          })
          return true
        }
        // SWISS-MODEL answers a 404 with no CORS header, as the real one does.
        await route.fulfill({ status: 404, body: "no model" })
        return true
      },
    })
    await context.close()
    measured.providersFailing = result

    const key = (path) => `GET /api/structure-cached?key=${encodeURIComponent(path)}`
    assert.deepEqual(
      result.requests.filter((line) => line.includes("structure-cached?key=")).sort(),
      [
        key(`pdb/${rowWith("pdb", result).pdb_id}.bcif`),
        key(`swissmodel/${rowWith("swissmodel", result).uniprot}_tmpl.pdb`),
        key(`alphafold/${rowWith("alphafold", result).uniprot}.cif`),
      ].sort(),
    )
    assert.deepEqual(result.failed, [], "the Worker route shows every viewer")
    assert.equal(result.complete.length, 4)
  } finally {
    save()
    await browser.close()
  }
})

test("a structure that fails to load leaves the clues playable, and a failure after the game rendered cannot replace it", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { page, context } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-structure-failure",
    })
    // The Worker's route for the target's structure answers 500.
    await context.route(
      (url) =>
        url.origin === origin &&
        url.pathname === "/api/structure-cached" &&
        url.searchParams.get("type") === "target",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "structure unavailable" }),
        }),
    )
    await openGame(page)
    const message = page.locator(".pg-structure-error:not([hidden])").first()
    await message.waitFor({ timeout: 30000 })
    assert.match(
      await message.innerText(),
      /You can still play using the clues below\./,
      "the viewer says what is still possible",
    )
    // The clues are there, and a guess is played through to its card.
    assert.ok(await page.locator("#pg-input").isVisible(), "the guess box is on the page")
    await guess(page, guessRows(newestTarget(), 1)[0], 1)

    // A viewer that fails later, after the game rendered, is logged and nothing else: it
    // cannot replace the game with an error page.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("a viewer failed in the background")
      }, 0)
      Promise.reject(new Error("a viewer request was rejected late"))
    })
    await page.waitForTimeout(500)
    assert.equal(await page.locator("body").getAttribute("data-geneguessr-status"), "rendered")
    assert.ok(await page.locator("#pg-input").isVisible(), "the game is still on the page")
    assert.equal(
      await page.locator('.pg-feedback-card[id^="guess-card-"]').count(),
      1,
      "the guess card is still there",
    )
    await context.close()
  } finally {
    await browser.close()
  }
})

test("an empty answer from a provider counts as a failure, not as a structure", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-empty",
      provider: async (url, route) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        // The page puts a HEADER line in front of a SWISS-MODEL file; an empty file is still empty.
        await route.fulfill({
          status: 200,
          body: "",
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        })
        return true
      },
    })
    await context.close()

    assert.equal(result.counts.structureKey, 1, `fallbacks: ${result.requests}`)
    assert.match(
      result.requests.find((line) => line.includes("structure-cached?key=")),
      /swissmodel/,
    )
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    await browser.close()
  }
})

test("a provider that stalls sends that guess through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const started = Date.now()
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-stalled",
      provider: async (url) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        await new Promise(() => {}) // never answers; closing the context ends it
      },
    })
    await context.close()
    measured.providerStalled = { ...result, seconds: Math.round((Date.now() - started) / 1000) }

    assert.equal(result.counts.structureKey, 1, `fallbacks: ${result.requests}`)
    assert.match(
      result.requests.find((line) => line.includes("structure-cached?key=")),
      /swissmodel/,
    )
    assert.deepEqual(result.failed, [])
    assert.equal(result.complete.length, 4)
  } finally {
    save()
    await browser.close()
  }
})

test("an oversize body from a provider is cut off, never reaches Mol*, and is not downloaded a second time", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-oversize",
      provider: async (url, route) => {
        if (new URL(url).hostname !== "swissmodel.expasy.org") return false
        await route.fulfill({
          status: 200,
          body: Buffer.alloc(MAX_STRUCTURE_FILE_BYTES + 1024, 0x41),
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        })
        return true
      },
    })
    await context.close()
    measured.oversize = result

    assert.equal(result.counts.structureKey, 0, "no second download through the Worker")
    assert.equal(result.failed.length, 1, `failed viewers: ${result.failed}`)
    assert.match(result.failed[0], /Could not load the 3D structure/)
    assert.equal(result.complete.length, 3, "the other three viewers render")
  } finally {
    save()
    await browser.close()
  }
})

test("a direct URL that is not a provider URL is never requested and the guess loads through the Worker", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    const bad = [
      "https://evil.example/x.cif",
      "http://models.rcsb.org/v1/1CRN/full?encoding=bcif",
      "https://user:pw@alphafold.ebi.ac.uk/files/AF-X-F1-model_v6.cif",
    ]
    let next = 0
    // Every guess response names a different bad URL, in the order the guesses are made.
    setRewrite({
      directUrls: true,
      offList: (pathname, text) => {
        if (pathname !== "/api/game/guess") return text
        const payload = JSON.parse(text)
        if (payload.guessStructureToken) payload.guessStructureToken.directUrl = bad[next++]
        return JSON.stringify(payload)
      },
    })
    const { result, context, tracker } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-offlist",
    })
    await context.close()
    measured.offList = result

    assert.equal(next, 3)
    assert.deepEqual(result.providerRequests, [], "no request to a provider")
    assert.deepEqual(
      tracker.offOrigin.filter((url) => !/cdn\.jsdelivr\.net/.test(url)),
      [],
      "no request off the page's origin",
    )
    assert.deepEqual(tracker.cspViolations, [], "the page refused them before the policy had to")
    assert.equal(result.counts.structureKey, 3)
    assert.deepEqual(result.failed, [])
  } finally {
    setRewrite({ directUrls: true })
    save()
    await browser.close()
  }
})
