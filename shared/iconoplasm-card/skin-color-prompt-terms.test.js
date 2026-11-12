import assert from "node:assert/strict"
import test from "node:test"
import { Hsluv } from "hsluv"

import { skinColorPromptTagsFromHex } from "./skin-color-prompt-terms.js"

test("skin prompt hue words match the B, C, D, and E card labels", () => {
  const tags = skinColorPromptTagsFromHex("#FDF2EF")

  assert.deepEqual(tags, ["near-white skin color", "grayish skin color", "peach skin color"])
  assert.doesNotMatch(tags.join(" "), /vermilion|orange|amber/)
})

test("changing B, C, D, and E leaves every other prompt hue bucket intact", () => {
  const expected =
    "red rosy peach honey golden yellow lime chartreuse spring jade emerald teal cyan azure cerulean blue sapphire indigo violet purple amethyst magenta fuchsia rose cerise crimson".split(
      " ",
    )
  const observed = expected.map((_, index) => {
    const color = new Hsluv()
    color.hpluv_h = index === 0 ? 0 : index <= 3 ? 14 * index : 14 * index + 1
    color.hpluv_p = 60
    color.hpluv_l = 60
    color.hpluvToHex()
    return skinColorPromptTagsFromHex(color.hex).at(-1)?.replace(" skin color", "")
  })

  assert.deepEqual(observed, expected)
})
