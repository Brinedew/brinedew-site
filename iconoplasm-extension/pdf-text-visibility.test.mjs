import assert from "node:assert/strict"
import test from "node:test"
import {
  buildTextVisibilityIndex,
  clipTextMatch,
  intersectConvexPolygons,
  pointInConvexPolygon,
} from "./pdf-text-visibility.mjs"

const names = [
  "save",
  "restore",
  "paintFormXObjectBegin",
  "paintFormXObjectEnd",
  "transform",
  "setFont",
  "setTextRenderingMode",
  "setGState",
  "beginMarkedContent",
  "beginMarkedContentProps",
  "endMarkedContent",
  "showText",
  "showSpacedText",
  "nextLineShowText",
  "nextLineSetSpacingShowText",
]
const ops = Object.fromEntries(names.map((name, i) => [name, i + 1]))
const id = [1, 0, 0, 1, 0, 0]
const glyphs = (text) => [...text].map((unicode) => ({ unicode }))
const show = (text) => ["showText", [glyphs(text)]]
const item = (str, fontName = "f1") => ({ str, fontName })
const box = (left, top, right, bottom) => ({ left, top, right, bottom })
function index(commands, items, optional) {
  return buildTextVisibilityIndex(
    { fnArray: commands.map(([name]) => ops[name]), argsArray: commands.map(([, args]) => args) },
    { items },
    ops,
    optional,
  )
}
const clipped = (entry, bounds, transform = id) =>
  clipTextMatch(entry, 0, entry.text.length, bounds, transform)

test("clipped Form duplicate does not create ghost highlights; same-font original survives", () => {
  const result = index(
    [
      ["setFont", ["f1", 10]],
      show("EZH2"),
      ["paintFormXObjectBegin", [null, [100, 100, 200, 200]]],
      show("EZH2"),
      show("MDM2"),
      ["paintFormXObjectEnd", []],
      show("TP53"),
    ],
    [item("EZH2"), item("EZH2"), item("MDM2"), item("TP53")],
  )
  assert.deepEqual(result.unmatchedFonts, [])
  assert.ok(clipped(result.items[0], box(0, 0, 40, 10)))
  assert.equal(clipped(result.items[1], box(0, 0, 40, 10)), null)
  assert.ok(clipped(result.items[2], box(110, 110, 150, 120)))
  assert.ok(clipped(result.items[3], box(0, 0, 40, 10)))
})

test("nested translated Forms and viewport rotation clip exact Range bounds", () => {
  const result = index(
    [
      ["setFont", ["f1", 10]],
      ["save", []],
      ["transform", [1, 0, 0, 1, 10, 20]],
      ["paintFormXObjectBegin", [null, [0, 0, 20, 20]]],
      [
        "paintFormXObjectBegin",
        [
          [1, 0, 0, 1, 5, 5],
          [0, 0, 20, 20],
        ],
      ],
      show("EZH2"),
      ["paintFormXObjectEnd", []],
      ["paintFormXObjectEnd", []],
      ["restore", []],
      show("TP53"),
    ],
    [item("EZH2"), item("TP53")],
  )
  assert.deepEqual(clipped(result.items[0], box(0, 0, 100, 100)).bounds, box(15, 25, 30, 40))
  assert.deepEqual(
    clipped(result.items[0], box(-100, 0, 0, 100), [0, 1, -1, 0, 0, 0]).bounds,
    box(-40, 15, -25, 30),
  )
  assert.deepEqual(clipped(result.items[1], box(0, 0, 100, 100)).bounds, box(0, 0, 100, 100))
})

test("all rendering modes obey fill/stroke alpha, with state restored", () => {
  for (let mode = 0; mode < 8; mode++) {
    for (const [fill, stroke] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      const result = index(
        [
          ["setFont", ["f1", 10]],
          ["save", []],
          ["setTextRenderingMode", [mode]],
          [
            "setGState",
            [
              [
                ["ca", fill],
                ["CA", stroke],
              ],
            ],
          ],
          show("EZH2"),
          ["restore", []],
          show("TP53"),
        ],
        [item("EZH2"), item("TP53")],
      )
      const paint = mode & 3
      const visible =
        ((paint === 0 || paint === 2) && fill > 0) || ((paint === 1 || paint === 2) && stroke > 0)
      assert.equal(
        Boolean(clipped(result.items[0], box(0, 0, 40, 10))),
        visible,
        `${mode}/${fill}/${stroke}`,
      )
      assert.ok(clipped(result.items[1], box(0, 0, 40, 10)))
    }
  }
})

test("hidden optional content stays hidden inside ordinary marked content", () => {
  const result = index(
    [
      ["setFont", ["f1", 10]],
      ["beginMarkedContentProps", ["OC", "hidden"]],
      ["beginMarkedContent", ["Span"]],
      show("EZH2"),
      ["endMarkedContent", []],
      ["endMarkedContent", []],
      show("TP53"),
    ],
    [item("EZH2"), item("TP53")],
    { isVisible: (group) => group !== "hidden" },
  )
  assert.equal(clipped(result.items[0], box(0, 0, 40, 10)), null)
  assert.ok(clipped(result.items[1], box(0, 0, 40, 10)))
})

test("whole-font streams map split operations, inserted spaces, ligatures and UTF16 offsets", () => {
  const result = index([["setFont", ["f1", 10]], show("EZ"), show("H2fi𝑋")], [item("EZ H2 ﬁ𝑋")])
  assert.deepEqual(result.unmatchedFonts, [])
  assert.equal(result.items[0].rules.length, "EZ H2 ﬁ𝑋".length)
  assert.ok(clipTextMatch(result.items[0], 3, 5, box(0, 0, 40, 10), id))
  assert.equal(result.items[0].rules[6].length, 2)
  assert.equal(result.items[0].rules[7].length, 1)
  assert.equal(result.items[0].rules[8].length, 1)
})

test("mismatched stream fails closed for that font, never nearest-string association", () => {
  const result = index(
    [["setFont", ["f1", 10]], show("EZH2EZH2"), ["setFont", ["f2", 10]], show("TP53")],
    [item("EZH2"), item("TP53", "f2")],
  )
  assert.deepEqual(result.unmatchedFonts, ["f1"])
  assert.equal(clipped(result.items[0], box(0, 0, 40, 10)), null)
  assert.ok(clipped(result.items[1], box(0, 0, 40, 10)))
})

test("non-additive Unicode normalization cannot shift association silently", () => {
  const result = index([["setFont", ["f1", 10]], show("éEZH2")], [item("e\u0301EZH2")])
  assert.deepEqual(result.unmatchedFonts, ["f1"])
})

test("rotated clip excludes empty corners from hover hit testing", () => {
  const diamond = [
    [0, 5],
    [5, 0],
    [10, 5],
    [5, 10],
  ]
  const polygon = intersectConvexPolygons(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    diamond,
  )
  assert.equal(pointInConvexPolygon(polygon, [1, 1]), false)
  assert.equal(pointInConvexPolygon(polygon, [5, 5]), true)
  assert.equal(pointInConvexPolygon([...polygon].reverse(), [5, 5]), true)
  assert.deepEqual(
    intersectConvexPolygons(diamond, [
      [0, 0],
      [0, 0],
      [0, 10],
      [0, 10],
    ]),
    [],
  )
})

test("invalid ranges, zero-area clip, unbalanced states and enormous pages fail closed", () => {
  const result = index([["setFont", ["f1", 10]], show("EZH2")], [item("EZH2")])
  assert.equal(clipTextMatch(result.items[0], -1, 4, box(0, 0, 40, 10), id), null)
  assert.equal(clipped(result.items[0], box(0, 0, 0, 10)), null)
  for (const command of [
    ["restore", []],
    ["save", []],
    ["endMarkedContent", []],
    ["beginMarkedContent", ["Span"]],
  ]) {
    assert.throws(() => index([command], []), /Unbalanced/)
  }
  assert.throws(() => index([["setFont", ["f1", 10]], show("A".repeat(500001))], []), /limit/)
})
