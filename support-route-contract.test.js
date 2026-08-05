import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const read = (relative) => readFileSync(path.join(root, relative), "utf8")

test("Support me links use the canonical crawlable route", () => {
  assert.match(read("quartz.config.yaml"), /Support me:\s*\/posts\/support-me\b/)
  assert.match(read("quartz/components/frames/DefaultFrame.tsx"), /href="\/posts\/support-me"/)
  assert.match(
    read("content/wiki/AI doesn't know who the oldest mouse is.md"),
    /https:\/\/brinedew\.bio\/posts\/support-me\b/,
  )
  assert.doesNotMatch(
    `${read("quartz.config.yaml")}\n${read("quartz/components/frames/DefaultFrame.tsx")}\n${read("content/wiki/AI doesn't know who the oldest mouse is.md")}`,
    /\/posts\/Support-me(?:\.html)?/,
  )
})
