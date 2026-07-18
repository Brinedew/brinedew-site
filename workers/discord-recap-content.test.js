import assert from "node:assert/strict"
import test from "node:test"

import { buildDiscordRecapContent } from "./discord.js"

function recap(overrides = {}) {
  return {
    day: "2026-07-17",
    target: { gene: "IMMP2L", full_name: "Mitochondrial inner membrane protease subunit 2" },
    winners_count: 0,
    total_guesses: 0,
    top_guesses: [],
    ...overrides,
  }
}

test("zero-activity recap reports only what was recorded", () => {
  const content = buildDiscordRecapContent(recap())
  assert.match(content, /No guesses were recorded\./)
  assert.doesNotMatch(content, /No one solved it/)
})

test("attempted but unsolved recap distinguishes guesses from a solve", () => {
  const content = buildDiscordRecapContent(recap({ total_guesses: 7 }))
  assert.match(content, /No solve was recorded\./)
})

test("solved recap retains the winner count", () => {
  const content = buildDiscordRecapContent(recap({ winners_count: 2, total_guesses: 9 }))
  assert.match(content, /2 players solved it!/)
})
