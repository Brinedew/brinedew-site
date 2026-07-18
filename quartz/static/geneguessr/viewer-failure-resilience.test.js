import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(new URL("./app.js", import.meta.url), "utf8")

test("background viewer errors cannot replace an already-rendered game", () => {
  assert.match(
    source,
    /if \(window\.__geneguessrStatus === "rendered"\) \{[\s\S]*?Non-fatal[\s\S]*?return/,
  )
  assert.match(source, /reportUnhandledError\("unhandled-rejection", message\)/)
})

test("target structure responses are validated before Molstar receives them", () => {
  assert.match(source, /no cacheKey - validating target structure response/)
  assert.match(source, /if \(!resp\.ok\) \{[\s\S]*?Structure request failed/)
  assert.match(source, /You can still play using the clues below\./)
})
