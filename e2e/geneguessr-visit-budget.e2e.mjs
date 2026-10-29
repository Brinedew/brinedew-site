// Failure modes 9 to 13 in e2e/geneguessr-direct-structures.shared.mjs, which holds
// the scene, the setup and the helpers. The GeneGuessr browser tests are four files so
// that they run side by side: as one file they took about 490 s, the E2E lane's whole wait.
// E2E scope: quartz/static/geneguessr/ quartz/static/vendor/ !workers/iconoplasm
import assert from "node:assert/strict"
import test from "node:test"
import {
  counts,
  BOARD_READ,
  DESKTOP,
  LEADERBOARD,
  PHONE,
  budget,
  chromeAndMolstar,
  leaderboardPictures,
  picturesDecoded,
  requests,
  rowsShown,
  saveBudget,
  setRewrite,
  visit,
} from "./geneguessr-direct-structures.shared.mjs"

for (const [layout, viewport] of [
  ["desktop", DESKTOP],
  ["phone", PHONE],
]) {
  for (const guesses of [3, 6]) {
    const expectedTotal = 2 + guesses
    test(`a ${layout} visit, page load plus ${guesses} guesses, costs ${expectedTotal} Worker requests, none of them the board or its pictures`, async (t) => {
      const browser = await chromeAndMolstar(t)
      if (!browser) return
      try {
        setRewrite({ directUrls: true })
        const { result, page, context, tracker } = await visit(browser, {
          visitorCookie: `geneguessr_session=e2e-budget-${layout}-${guesses}`,
          guesses,
          viewport,
        })
        // The visit's own measurements first: a visitor on a phone has not scrolled to the
        // sidebar, a desktop visitor has it on screen.
        const marks = await page.evaluate(() => window.__pendingMarks)
        const entry = { ...result, pendingMarks: marks }
        budget[`${layout}${guesses}`] = entry
        if (layout === "phone") {
          // Then the visitor scrolls down to the sidebar: the section is read once.
          await page.locator("#pg-sidebar-leaderboard").scrollIntoViewIfNeeded()
          await page.waitForFunction(rowsShown, null, { timeout: 10000 })
          entry.afterScroll = { ...counts(requests), cdn: [...tracker.cdn] }
        } else {
          await page.waitForFunction(rowsShown, null, { timeout: 10000 })
        }
        await picturesDecoded(page, LEADERBOARD.length)
        entry.pictures = await leaderboardPictures(page)
        await context.close()

        const c = result.counts
        assert.equal(c.bootstrap, 1, `bootstrap: ${result.requests}`)
        assert.equal(c.structureTarget, 1, "the target is one Worker view")
        assert.equal(c.guess, guesses, "one request a guess")
        assert.equal(c.similarity, 0, "no request for a similarity score")
        assert.equal(c.graphicsSettings, 0, "no request for the graphics settings")
        assert.equal(c.structureKey, 0, "no guess view through the Worker")
        assert.equal(c.structureToken, 0, "no token request")
        assert.equal(c.other, 0, `nothing else: ${result.requests}`)
        assert.equal(c.leaderboard, 0, "the board is not a Worker request")
        assert.equal(c.avatar, 0, "nor are its pictures")
        assert.equal(c.total, expectedTotal, `${result.requests}`)
        assert.deepEqual(
          result.cdnRequests,
          layout === "desktop" ? [BOARD_READ] : [],
          "one CDN read on a desktop, none on a phone before its section is reached",
        )
        assert.equal(marks, 0, "a score never shows as pending")
        // D1 rows (B-960, B-959): the receipts of every statement the visit ran.
        const receipts = result.meters.d1Receipts
        assert.deepEqual(
          receipts.filter((receipt) => /game_session_write_/.test(receipt.sql)),
          [],
          "a successful session write records nothing",
        )
        assert.deepEqual(
          receipts
            .filter((receipt) => receipt.rowsWritten && !/daily_guess_aggregate/.test(receipt.sql))
            .map((receipt) => receipt.sql),
          [],
          "the only rows a visit writes are the aggregates",
        )
        assert.equal(result.meters.d1RowsWritten, guesses, "1 row a guess")
        assert.deepEqual(
          receipts.filter((receipt) => /leaderboard_streaks/.test(receipt.sql)),
          [],
          "a visit reads no board from D1",
        )
        assert.deepEqual(result.failed, [], "no viewer failed")
        assert.equal(result.complete.length, 1 + guesses, `rendered viewers: ${result.complete}`)
        assert.deepEqual(tracker.cspViolations, [])
        if (layout === "phone") {
          assert.deepEqual(
            entry.afterScroll.cdn,
            [BOARD_READ],
            "scrolling to the section reads the object once",
          )
          assert.equal(entry.afterScroll.leaderboard + entry.afterScroll.avatar, 0)
          assert.equal(entry.afterScroll.total, expectedTotal)
        }
        assert.equal(entry.pictures.length, LEADERBOARD.length, "a picture for every entry")
        for (const picture of entry.pictures) {
          assert.ok(
            picture.src.startsWith("data:image/png;base64"),
            `a data: image: ${picture.src}`,
          )
          assert.ok(picture.decoded, "the browser decoded it")
        }
      } finally {
        saveBudget()
        await browser.close()
      }
    })
  }
}
