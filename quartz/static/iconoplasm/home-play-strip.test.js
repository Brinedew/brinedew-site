// B-1173: the homepage strip marks gene symbols the way the add-on marks them
// on other websites. These are golden checks on the four real starters, plus a
// guard that the strip's copy of the add-on's ink rule has not drifted.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { HOME_PLAY_APCA, HOME_STARTERS, homePlayPillInk } from "./home-play-strip.js"

// Published colours on 2026-10-27 (stable-genes), and the ink that the add-on
// prints on each pill.
const GOLDEN = [
  ["INS", "#7b995f", "light"],
  ["RHO", "#42718e", "light"],
  ["PRL", "#57bfcf", "dark"],
  ["CD4", "#5d4b46", "light"],
]

test("the starters get the add-on's pill ink", () => {
  assert.deepEqual(
    GOLDEN.map(([symbol]) => symbol),
    HOME_STARTERS.map((starter) => starter.symbol),
  )
  for (const [symbol, hex, ink] of GOLDEN) {
    assert.equal(homePlayPillInk(hex), ink, symbol)
  }
  // Each line opens on its own symbol, which becomes the pill.
  for (const starter of HOME_STARTERS) assert.ok(starter.line.startsWith(starter.symbol + " "))
})

test("the strip's ink constants are the add-on's", () => {
  const source = readFileSync(
    new URL("../../../iconoplasm-extension/content.js", import.meta.url),
    "utf8",
  )
  const read = (name) => {
    const match = source.match(new RegExp(`const ${name} = ([^\\n]+)`))
    assert.ok(match, `${name} is no longer in content.js`)
    return match[1]
      .replace(/^Object\.freeze\(/, "")
      .replace(/\)$/, "")
      .trim()
  }
  const number = (name) => Number(read(name))
  assert.deepEqual(
    {
      darkInk: JSON.parse(read("DARK_TEXT_RGB")),
      lightInk: JSON.parse(read("LIGHT_TEXT_RGB")),
      deltaYMin: number("APCA_DELTA_Y_MIN"),
      minContrast: number("APCA_MIN_CONTRAST"),
      contrastOffset: number("APCA_CONTRAST_OFFSET"),
      scale: number("APCA_SCALE"),
      blackThreshold: number("APCA_BLACK_THRESHOLD"),
      blackClampExp: number("APCA_BLACK_CLAMP_EXP"),
      whiteWinMargin: number("WHITE_TEXT_WIN_MARGIN_APCA"),
    },
    { ...HOME_PLAY_APCA },
  )
})
