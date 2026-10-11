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
  assert.doesNotMatch(
    `${read("quartz.config.yaml")}\n${read("quartz/components/frames/DefaultFrame.tsx")}`,
    /\/posts\/Support-me(?:\.html)?/,
  )
})
