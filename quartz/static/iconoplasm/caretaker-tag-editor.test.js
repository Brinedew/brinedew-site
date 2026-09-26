import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { TAG_CATEGORIES, mountCaretakerTagEditor } from "./caretaker-tag-editor.js"

function mount(fields, tagsText) {
  const { document } = parseHTML(
    "<form><textarea data-icono-caretaker-tags></textarea><div data-icono-caretaker-tag-categories></div></form>",
  )
  const form = document.querySelector("form")
  const source = form.querySelector("[data-icono-caretaker-tags]")
  source.value = tagsText
  source.dataset.fieldsJson = JSON.stringify(fields)
  mountCaretakerTagEditor(form)
  const rows = [...form.querySelectorAll("[data-tag-category]")]
  return {
    source,
    names: rows.map((row) => row.dataset.tagCategory),
    values: (name) =>
      [
        ...(rows
          .find((row) => row.dataset.tagCategory === name)
          ?.querySelectorAll("[data-tag-value]") || []),
      ].map((chip) => chip.dataset.tagValue),
  }
}

// B-879: 98% of saved records (18,856 of 19,217) predate the current category
// tree and carry pose_mood and colors; the tree now says pose, with background
// and composition added. Saved JSON also arrives with alphabetical keys.
const oldTree = {
  accessories: ["plastic magnetic buckles"],
  action: ["ground shatter"],
  archetype: ["disruption support"],
  body: ["thick thighs"],
  colors: ["nightshade blue"],
  face: ["flat nosebridge"],
  fantastical: [],
  hair: ["slicked back"],
  outfit: ["circuit stickers"],
  pose: [],
  pose_mood: ["static fist stance", "smug grin"],
  signature: ["formation splitter"],
}
const oldTreeText =
  "plastic magnetic buckles, ground shatter, disruption support, thick thighs, nightshade blue, flat nosebridge, slicked back, circuit stickers, static fist stance, smug grin, formation splitter"

test("an old-tree record shows its pose_mood tags under pose, with no duplicate row (B-879)", () => {
  const editor = mount(oldTree, oldTreeText)
  assert.equal(editor.names.includes("pose_mood"), false, "the retired name is folded away")
  assert.deepEqual(editor.values("pose"), ["static fist stance", "smug grin"])
  assert.equal(editor.names.filter((name) => name === "pose").length, 1)
  assert.deepEqual(JSON.parse(editor.source.dataset.fieldsJson).pose, [
    "static fist stance",
    "smug grin",
  ])
  assert.equal("pose_mood" in JSON.parse(editor.source.dataset.fieldsJson), false)
})

test("rows follow the category tree, and the retired colors category never shows (B-879)", () => {
  // A row that shows now and vanishes after the gene is re-tagged is the same
  // pop-in B-872 removed, and colour tags pull image generation off course.
  const editor = mount(oldTree, oldTreeText)
  assert.deepEqual(editor.names, TAG_CATEGORIES)
  assert.equal(editor.values("uncategorized").length, 0, "colors tags don't resurface as ungrouped")
})

test("the retired colors tags leave the flat list too, so the next save drops them (B-879)", () => {
  const editor = mount(oldTree, oldTreeText)
  assert.equal(editor.source.value.includes("nightshade blue"), false)
  assert.equal(editor.source.value.includes("static fist stance"), true)
})

test("opening an old-tree record does not count as an edit (B-879)", () => {
  const editor = mount(oldTree, oldTreeText)
  assert.equal(
    editor.source.dataset.initialFieldsJson === editor.source.dataset.fieldsJson,
    true,
    "the folded shape is the baseline, so autosave has nothing to send",
  )
})

test("a new-tree record gets no colors row (B-879)", () => {
  const editor = mount({ pose: ["wide stance"], background: ["storm"] }, "wide stance, storm")
  assert.deepEqual(editor.names, TAG_CATEGORIES)
})

test("a record with both names keeps every tag once, under pose (B-879)", () => {
  const editor = mount(
    { pose: ["wide stance", "smug grin"], pose_mood: ["smug grin", "hunched"] },
    "wide stance, smug grin, hunched",
  )
  assert.deepEqual(editor.values("pose"), ["wide stance", "smug grin", "hunched"])
})
