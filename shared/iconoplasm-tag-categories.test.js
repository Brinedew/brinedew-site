import assert from "node:assert/strict"
import test from "node:test"

import {
  RETIRED_TAG_CATEGORIES,
  TAG_CATEGORIES,
  TAG_CATEGORY_ALIASES,
  promptTagsWithoutRetired,
  retiredTagSet,
  upcastTagFields,
} from "./iconoplasm-tag-categories.js"

// B-879: 18,856 of 19,217 saved records predate the current tree. Their "colors"
// tags are parasitic in image prompts (the owner retired the category for that
// reason) and made up a median 9.5% of each gene's flat tag list.

test("the rename and the retirement both point out of the current tree", () => {
  for (const [retired, successor] of Object.entries(TAG_CATEGORY_ALIASES)) {
    assert.equal(TAG_CATEGORIES.includes(retired), false)
    assert.equal(TAG_CATEGORIES.includes(successor), true)
  }
  for (const retired of RETIRED_TAG_CATEGORIES)
    assert.equal(TAG_CATEGORIES.includes(retired), false)
})

test("upcasting folds pose_mood into pose, drops colors, and follows the tree order", () => {
  const fields = upcastTagFields({
    colors: ["indigo", "burgundy"],
    pose: ["wide stance"],
    pose_mood: ["smug grin", "wide stance"],
    accessories: ["iron ring"],
    uncategorized: ["loose tag"],
  })
  assert.deepEqual(Object.keys(fields), [...TAG_CATEGORIES, "uncategorized"])
  assert.deepEqual(fields.pose, ["wide stance", "smug grin"])
  assert.equal("colors" in fields, false)
  assert.equal("pose_mood" in fields, false)
})

test("the prompt keeps every tag except the retired colors", () => {
  const fields = { colors: ["indigo", "burgundy"], body: ["thick thighs"] }
  assert.equal(
    promptTagsWithoutRetired("thick thighs, indigo, iron ring, burgundy", fields),
    "thick thighs, iron ring",
  )
})

test("colors saved as one comma-joined string are still recognised (13 of 18,886 records)", () => {
  const fields = { colors: ["black, hot_pink, chrome"], body: ["monstrous"] }
  assert.equal(promptTagsWithoutRetired("monstrous, black, hot_pink, chrome", fields), "monstrous")
})

test("matching ignores case and surrounding space", () => {
  assert.equal(promptTagsWithoutRetired("Indigo ,  tall", { colors: ["indigo "] }), "tall")
})

test("fields may arrive as a JSON string, as null, or unparseable; the prompt never breaks", () => {
  assert.equal(promptTagsWithoutRetired("a, indigo", JSON.stringify({ colors: ["indigo"] })), "a")
  assert.equal(promptTagsWithoutRetired("a, indigo", null), "a, indigo")
  assert.equal(promptTagsWithoutRetired("a, indigo", "{not json"), "a, indigo")
  assert.equal(promptTagsWithoutRetired("", { colors: ["indigo"] }), "")
})

test("a colour word that also lives in a kept category stays in the prompt", () => {
  // "silver hair" under hair is a hair tag, not the retired colors category.
  const fields = { colors: ["silver"], hair: ["silver"] }
  assert.equal(promptTagsWithoutRetired("silver, buzz cut", fields), "silver, buzz cut")
  assert.deepEqual([...retiredTagSet(fields)], [])
})
