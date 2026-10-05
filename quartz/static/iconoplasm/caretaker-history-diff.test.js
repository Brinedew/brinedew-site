// Golden test: the History preview of a real 4,000-character manifestation edit.
// SOX11 versions 3 and 4 (2026-10-05) differ by about ten words. The old homemade
// diff gave up above 160,000 token pairs and showed the whole text struck out and
// re-added, "+628 −626". String assertions only; no DOM nodes reach an assertion.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { diffMarkup } from "./caretaker-manifestations-view.js"
import { manifestationWordDiff } from "./caretaker-manifestations.js"

const golden = JSON.parse(
  readFileSync(
    new URL("../../../workers/fixtures/caretaker-history-diff-sox11-golden.json", import.meta.url),
    "utf8",
  ),
)

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

test("a ten-word edit of a full-length text shows ten small changes, not one", () => {
  const parts = manifestationWordDiff(golden.before, golden.after)
  const changed = parts.filter((part) => part.kind !== "same")
  const changedLength = changed.reduce((sum, part) => sum + part.text.length, 0)
  assert.equal(golden.before.length >= 4000, true)
  assert.equal(changed.length <= 20, true)
  assert.equal(changedLength < 300, true)
  const removed = changed.filter((part) => part.kind === "removed").map((part) => part.text)
  const added = changed.filter((part) => part.kind === "added").map((part) => part.text)
  assert.equal(removed.includes("slight"), true)
  assert.equal(added.includes("slender"), true)
  assert.equal(added.includes("emerald"), true)
})

test("the preview keeps every word of the newer version, in order", () => {
  const kept = manifestationWordDiff(golden.before, golden.after)
    .filter((part) => part.kind !== "removed")
    .map((part) => part.text)
    .join("")
  assert.equal(kept, golden.after)
})

test("the markup marks only the changed words", () => {
  const html = diffMarkup(golden.before, golden.after, escapeHtml)
  assert.equal(html.includes("<del>slight</del><ins>slender</ins>"), true)
  assert.equal((html.match(/<del>/g) || []).length <= 10, true)
})
