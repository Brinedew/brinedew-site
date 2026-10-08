import assert from "node:assert/strict"
import { statSync } from "node:fs"
import test from "node:test"

import { lineEndPoint, lineEnds } from "./diagram-document.js"
import {
  DIAGRAM_TEMPLATES,
  buildTemplateDocument,
  templateSymbols,
  templateThumbnail,
} from "./diagram-templates.js"

// B-1050, the owner's QC for a faction chart, applied to every template:
// 1. no two shapes collide;
// 2. arrows never overlap along a segment, only point crossings are allowed;
// and two checks that follow from them:
// 3. no arrow runs through a portrait or molecule it does not join;
// 4. everything sits on the page.
// Plus: 5. faction and control variable charts use only the two arrow kinds,
// and 6. a gene the resolver could not find drops out with its arrows.

const assetsFor = (id) =>
  new Map(
    templateSymbols(id).map((symbol) => [
      symbol,
      { canonical_url: `https://example.test/${symbol}.webp`, width: 768, height: 1024 },
    ]),
  )

const centre = (node) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 })

// Shapes are portraits, molecules and text: compartments and faction bins are
// background layers that shapes are meant to sit on.
const shapes = (document) => document.nodes.filter((node) => node.type !== "compartment")

function boxesOverlap(a, b, gap = 8) {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  )
}

// The drawn line runs through the waypoints from each end: the point its side
// attaches at when the page's lines give it one (B-1051), or the centre, where
// X6 clips it at the box's boundary.
function segments(document, edge) {
  const from = document.nodes.find((node) => node.id === edge.from)
  const to = document.nodes.find((node) => node.id === edge.to)
  const ends = lineEnds(document).get(edge.id)
  const start = ends.source ? lineEndPoint(from, ends.source) : centre(from)
  const finish = ends.target ? lineEndPoint(to, ends.target) : centre(to)
  const points = [start, ...edge.vertices, finish]
  return points.slice(1).map((point, index) => [points[index], point])
}

function segmentHitsBox([a, b], box, inset = 6) {
  const left = box.x + inset
  const right = box.x + box.width - inset
  const top = box.y + inset
  const bottom = box.y + box.height - inset
  // Liang-Barsky clipping: does any part of a-b fall inside the box?
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [
    [-dx, a.x - left],
    [dx, right - a.x],
    [-dy, a.y - top],
    [dy, bottom - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return false
  }
  return true
}

// Two segments overlap along a stretch when they are parallel, on the same
// line and their projections share more than a few units.
function segmentsOverlap([a, b], [c, d]) {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const length = Math.hypot(ux, uy)
  if (!length) return false
  const cross = (px, py) => (ux * py - uy * px) / length
  if (Math.abs(cross(c.x - a.x, c.y - a.y)) > 3 || Math.abs(cross(d.x - a.x, d.y - a.y)) > 3)
    return false
  const project = (point) => ((point.x - a.x) * ux + (point.y - a.y) * uy) / length
  const [low, high] = [project(c), project(d)].sort((x, y) => x - y)
  return Math.min(length, high) - Math.max(0, low) > 4
}

for (const template of DIAGRAM_TEMPLATES) {
  test(`${template.name}: shapes never collide and stay on the page`, () => {
    const document = buildTemplateDocument(template.id, assetsFor(template.id))
    const list = shapes(document)
    for (const node of list) {
      assert.ok(node.x >= 0 && node.y >= 0, `${node.id} starts off the page`)
      assert.ok(node.x + node.width <= document.width, `${node.id} runs past the right edge`)
      assert.ok(node.y + node.height <= document.height, `${node.id} runs past the bottom`)
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        assert.ok(!boxesOverlap(list[i], list[j]), `${list[i].id} collides with ${list[j].id}`)
  })

  test(`${template.name}: arrows only cross at points and never run through a portrait`, () => {
    const document = buildTemplateDocument(template.id, assetsFor(template.id))
    assert.equal(document.edges.length, template.edges.length, "every relationship was drawn")
    const actors = document.nodes.filter((node) => node.type === "gene" || node.type === "molecule")
    const drawn = document.edges.map((edge) => ({ edge, parts: segments(document, edge) }))
    for (const { edge, parts } of drawn) {
      for (const actor of actors) {
        if (actor.id === edge.from || actor.id === edge.to) continue
        for (const part of parts)
          assert.ok(
            !segmentHitsBox(part, actor),
            `${edge.from}→${edge.to} runs through ${actor.id}`,
          )
      }
    }
    for (let i = 0; i < drawn.length; i++)
      for (let j = i + 1; j < drawn.length; j++)
        for (const left of drawn[i].parts)
          for (const right of drawn[j].parts)
            assert.ok(
              !segmentsOverlap(left, right),
              `${drawn[i].edge.from}→${drawn[i].edge.to} runs along ${drawn[j].edge.from}→${drawn[j].edge.to}`,
            )
  })
}

test("faction and control variable charts use only activation and inhibition", () => {
  for (const id of ["faction", "control-variable"]) {
    const document = buildTemplateDocument(id, assetsFor(id))
    assert.deepEqual(
      [...new Set(document.edges.map((edge) => edge.kind))].sort(),
      ["activation", "inhibition"],
      id,
    )
  }
})

test("the control variable sits in the middle with four quadrants around it", () => {
  const document = buildTemplateDocument("control-variable", assetsFor("control-variable"))
  const variable = document.nodes.find((node) => node.type === "molecule")
  const bins = document.nodes.filter((node) => node.shape === "faction")
  const middle = centre(variable)
  assert.equal(bins.length, 4)
  const quadrants = bins.map((bin) => {
    const c = centre(bin)
    return `${c.y < middle.y ? "upstream" : "downstream"}-${c.x < middle.x ? "left" : "right"}`
  })
  assert.deepEqual(quadrants.sort(), [
    "downstream-left",
    "downstream-right",
    "upstream-left",
    "upstream-right",
  ])
  // Every relationship touches the variable: in from upstream, out downstream.
  for (const edge of document.edges) {
    assert.ok(edge.from === variable.id || edge.to === variable.id)
    const other = document.nodes.find(
      (node) => node.id === (edge.from === variable.id ? edge.to : edge.from),
    )
    assert.equal(edge.to === variable.id, centre(other).y < middle.y)
  }
})

test("a gene the resolver cannot find drops out with its relationships", () => {
  const assets = assetsFor("faction")
  assets.delete("MDM2")
  const document = buildTemplateDocument("faction", assets)
  assert.ok(!document.nodes.some((node) => node.symbol === "MDM2"))
  assert.equal(
    document.edges.length,
    DIAGRAM_TEMPLATES.find((item) => item.id === "faction").edges.length - 2,
  )
})

// The template library shows each template's picture (the Studio's own PNG
// export, scaled down); a template without one would be a blank tile.
test("every template has its library picture", () => {
  for (const template of DIAGRAM_TEMPLATES) {
    const file = new URL(templateThumbnail(template.id))
    assert.ok(statSync(file).size > 8_000, `${template.id} has no real picture`)
    assert.ok(template.category, `${template.id} has no library category`)
  }
})
