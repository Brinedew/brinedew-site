// Failure modes 9 to 11 and 14 to 16 in e2e/geneguessr-direct-structures.shared.mjs, which
// holds the scene, the setup and the helpers. The GeneGuessr browser tests are four files so
// that they run side by side: as one file they took about 490 s, the E2E lane's whole wait.
// E2E scope: quartz/static/geneguessr/ quartz/static/vendor/ !workers/iconoplasm
import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_GRAPHICS_SETTINGS } from "../workers/admin.js"
import { getBlendedSimilarity } from "../workers/lib/protein-store.js"
import {
  BOARD_READ,
  DESKTOP,
  LEADERBOARD,
  PHONE,
  RANKED,
  board,
  budget,
  chromeAndMolstar,
  counts,
  db,
  harness,
  leaderboardPictures,
  leaderboardShown,
  openGame,
  openVisitor,
  origin,
  picturesDecoded,
  requests,
  resetRequests,
  rows,
  rowsShown,
  saveBudget,
  setRewrite,
  settle,
  visit,
} from "./geneguessr-direct-structures.shared.mjs"

test("each card shows the similarity score the Worker computes, at once and never as a spinner", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { result, page, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-scores",
      viewport: DESKTOP,
    })
    const shown = await page.evaluate(() => ({
      pending: window.__pendingMarks,
      cards: [...document.querySelectorAll('.pg-feedback-card[id^="guess-card-"]')].map((card) => ({
        gene: card.querySelector(".pg-feedback-gene")?.textContent,
        score: card.querySelector(".pg-feedback-score")?.textContent,
        bar: card.querySelector(".pg-bar-fill")?.style.width,
      })),
    }))
    await context.close()
    const target = rows.find((row) => row.uniprot === result.target)
    assert.equal(shown.cards.length, 3)
    for (const card of shown.cards) {
      const guessed = rows.find((row) => row.gene === card.gene)
      const expected = (await getBlendedSimilarity(db, guessed.gene, target.gene)).blended
      assert.equal(typeof expected, "number", `${card.gene}: the seeded embeddings score`)
      assert.equal(card.score, `${expected}%`, `${card.gene}: the number on the card`)
      assert.equal(card.bar, `${expected}%`, `${card.gene}: the bar`)
    }
    assert.equal(shown.pending, 0, "no spinner or pending mark was ever added to the page")
  } finally {
    await browser.close()
  }
})

test("the page is styled with the settings the bootstrap carries, with no request of their own", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  const tuned = {
    ...DEFAULT_GRAPHICS_SETTINGS,
    camera: { ...DEFAULT_GRAPHICS_SETTINGS.camera, mode: "orthographic" },
  }
  const cameraMode = async (stored) => {
    if (stored) harness.kv.set("graphics_settings", JSON.stringify(stored))
    else harness.kv.delete("graphics_settings")
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: `geneguessr_session=e2e-graphics-${stored ? "tuned" : "default"}`,
      viewport: DESKTOP,
    })
    resetRequests()
    // `molstar_debug` hands the page's last viewer to the test.
    await page.goto(`${origin}/?molstar_debug&gg_api=${encodeURIComponent(origin)}`)
    await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
    await settle(page, tracker, 1)
    await page.waitForTimeout(1500) // the stylization steps wait 100 to 300 ms each
    const mode = await page.evaluate(
      () => globalThis.__GeneguessrMolstarDebug?.viewer?.plugin?.canvas3d?.props?.camera?.mode,
    )
    const seen = counts(requests)
    await context.close()
    return { mode, seen }
  }
  try {
    setRewrite({ directUrls: true })
    const withStored = await cameraMode(tuned)
    const withDefault = await cameraMode(null)
    budget.graphicsSettings = { withStored, withDefault }
    assert.equal(withStored.mode, "orthographic", "the stored value styled the first viewer")
    assert.equal(withDefault.mode, "perspective", "the control: with no stored value, the default")
    assert.equal(withStored.seen.graphicsSettings, 0, "no settings request with a stored value")
    assert.equal(withDefault.seen.graphicsSettings, 0, "none without one")
  } finally {
    harness.kv.delete("graphics_settings")
    saveBudget()
    await browser.close()
  }
})

test("a phone reads the leaderboard when its section nears the screen, and it looks as it always did", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-phone",
      viewport: PHONE,
    })
    resetRequests()
    await openGame(page)
    await page.waitForTimeout(2000)
    const before = {
      counts: counts(requests),
      shown: await leaderboardShown(page),
      cdn: [...tracker.cdn],
    }
    const offScreen = await page.evaluate(() => {
      const top = document.getElementById("pg-sidebar-leaderboard").getBoundingClientRect().top
      return top - window.innerHeight
    })
    await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    // Away and back: the rows are already there, so no second read.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
    await page.waitForTimeout(1000)
    const after = {
      counts: counts(requests),
      shown: await leaderboardShown(page),
      cdn: [...tracker.cdn],
    }
    await context.close()
    budget.leaderboardPhone = { before, after, pixelsBelowTheScreenAtLoad: Math.round(offScreen) }

    assert.ok(offScreen > 400, `the section starts ${offScreen} px below the screen at load`)
    assert.deepEqual(before.cdn, [], "not read while off screen")
    assert.deepEqual(before.shown.texts, ["Loading leaderboard..."], "the first paint")
    assert.deepEqual(after.cdn, [BOARD_READ], "read once, however often it is scrolled to")
    assert.equal(
      after.counts.leaderboard + after.counts.avatar,
      0,
      "no Worker request for the board or its pictures",
    )
    assert.deepEqual({ names: after.shown.names, streaks: after.shown.streaks }, RANKED)
    assert.ok(
      !after.shown.texts.includes("No public streaks yet."),
      `the empty text never flashed: ${JSON.stringify(after.shown.texts)}`,
    )
    assert.equal(after.shown.texts.length, 2, "loading, then the rows")
  } finally {
    saveBudget()
    await browser.close()
  }
})

test("a desktop reads the leaderboard at load, because its section is on screen, and it looks as it always did", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-desktop",
      viewport: DESKTOP,
    })
    resetRequests()
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    await picturesDecoded(page, LEADERBOARD.length)
    const shown = await leaderboardShown(page)
    const onScreen = await page.evaluate(() => {
      const box = document.getElementById("pg-sidebar-leaderboard").getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    })
    await context.close()
    budget.leaderboardDesktop = { counts: counts(requests), cdn: [...tracker.cdn], shown, onScreen }

    assert.equal(onScreen === true, true, "the section is on the first screen")
    assert.deepEqual(tracker.cdn, [BOARD_READ], "read at load, from the CDN")
    assert.equal(counts(requests).leaderboard + counts(requests).avatar, 0, "no Worker request")
    assert.deepEqual(tracker.cspViolations, [], "the document policy lets the page read it")
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
    assert.equal(shown.texts.length, 2, `loading, then the rows: ${JSON.stringify(shown.texts)}`)
    assert.ok(!shown.texts.includes("No public streaks yet."), "the empty text never flashed")
  } finally {
    saveBudget()
    await browser.close()
  }
})

test("a browser without IntersectionObserver still reads the leaderboard, at load", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-old",
      viewport: PHONE,
      noObserver: true,
    })
    resetRequests()
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    const shown = await leaderboardShown(page)
    await context.close()

    assert.deepEqual(tracker.cdn, [BOARD_READ])
    assert.equal(counts(requests).leaderboard, 0)
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
  } finally {
    await browser.close()
  }
})

test("with the CDN unreachable the page falls back to the Worker route, and a full board costs what it used to: the route and a request for each picture", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    board.mode = "down"
    const { result, page, context } = await visit(browser, {
      visitorCookie: "geneguessr_session=e2e-budget-fallback",
      guesses: 3,
      viewport: DESKTOP,
    })
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    await picturesDecoded(page, LEADERBOARD.length)
    const shown = await leaderboardShown(page)
    const pictures = await leaderboardPictures(page)
    await context.close()
    budget.desktop3WithTheCdnDown = { ...result, pictures }

    assert.deepEqual(result.cdnRequests, [BOARD_READ], "tried once")
    assert.equal(result.counts.leaderboard, 1, "then the route")
    assert.equal(result.counts.avatar, LEADERBOARD.length, "and a request a picture")
    assert.equal(
      result.counts.total,
      2 + 3 + 1 + LEADERBOARD.length,
      `a 3-guess desktop visit with a full board before B-965: ${result.requests}`,
    )
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
    for (const picture of pictures) {
      assert.ok(
        picture.src.startsWith("/api/avatar?src="),
        `the Worker's avatar route: ${picture.src}`,
      )
      assert.ok(picture.decoded)
    }
  } finally {
    board.mode = "up"
    saveBudget()
    await browser.close()
  }
})

test("an answer from the CDN that is not the board sends the page to the Worker route", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    board.mode = "garbage"
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-garbage",
      viewport: DESKTOP,
    })
    resetRequests()
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    const shown = await leaderboardShown(page)
    await context.close()

    assert.deepEqual(tracker.cdn, [BOARD_READ])
    assert.equal(counts(requests).leaderboard, 1, "the route answered")
    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
    assert.ok(!shown.texts.includes("No public streaks yet."), "the empty text never flashed")
  } finally {
    board.mode = "up"
    await browser.close()
  }
})

test("a board object that names a picture address other than a data: image never makes the page request it", async (t) => {
  const browser = await chromeAndMolstar(t)
  if (!browser) return
  try {
    setRewrite({ directUrls: true })
    board.mode = "tampered"
    const { page, context, tracker } = await openVisitor(browser, {
      visitorCookie: "geneguessr_session=e2e-board-tampered",
      viewport: DESKTOP,
    })
    resetRequests()
    await openGame(page)
    await page.waitForFunction(rowsShown, null, { timeout: 10000 })
    await page.waitForTimeout(1500)
    const shown = await leaderboardShown(page)
    const pictures = await leaderboardPictures(page)
    const initials = await page.evaluate(
      () =>
        document.querySelectorAll("#pg-sidebar-leaderboard .pg-leaderboard-avatar-fallback").length,
    )
    await context.close()

    assert.deepEqual({ names: shown.names, streaks: shown.streaks }, RANKED)
    assert.equal(initials, 2, "the two tampered entries show the initial of the name")
    assert.equal(pictures.length, LEADERBOARD.length - 2)
    assert.ok(pictures.every((picture) => picture.src.startsWith("data:image/png;base64")))
    assert.deepEqual(
      tracker.offOrigin.filter((url) => /tracker\.example/.test(url)),
      [],
      "the page never asked for the address",
    )
    assert.deepEqual(tracker.cspViolations, [], "the page refused it before the policy had to")
    assert.equal(counts(requests).avatar, 0)
  } finally {
    board.mode = "up"
    await browser.close()
  }
})
