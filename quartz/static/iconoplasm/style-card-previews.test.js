import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { assignStyleCardPreviews } from "./style-card-previews.js"

// B-896 golden: the owner's own Free queue picker on 2026-10-05, the morning
// they saw ACVR2B three times in Favorites. Ways the assignment can fail,
// written before the code:
// 1. a gene shows on two cards while a card had a free gene to show instead;
// 2. a card shows a candidate before one of its own canonical portraits;
// 3. a card shows a candidate while one of its own canonical portraits is
//    left out;
// 4. another card's canonical gene is taken as somebody's candidate;
// 5. a card shows two or three portraits (the art is a 2x2 mosaic or one);
// 6. a style with portraits ends up with an empty card;
// 7. a card that falls back takes a later card's own canonical portrait away
//    (2026-10-05: three tiny styles fell back to STAT5A, shown 4 times);
// 8. fallbacks pile onto one gene instead of spreading.
const { options } = JSON.parse(
  readFileSync(
    new URL("../../../workers/fixtures/style-picker-options-2026-10-05.json", import.meta.url),
    "utf8",
  ),
)

function geneOf(preview) {
  return preview.gene_symbol
}

function check(list) {
  const shown = assignStyleCardPreviews(list)
  assert.equal(shown.length, list.length)
  const canonicalOwner = new Map()
  list.forEach((option, index) => {
    for (const preview of option.preview_assets) {
      if (preview.is_current && !canonicalOwner.has(geneOf(preview)))
        canonicalOwner.set(geneOf(preview), index)
    }
  })
  const cardsByGene = new Map()
  // 7. Every card shows its own best canonical portrait.
  list.forEach((option, index) => {
    const own = option.preview_assets.find(
      (preview) => preview.is_current && canonicalOwner.get(geneOf(preview)) === index,
    )
    if (own) assert.equal(shown[index][0]?.asset_sha256, own.asset_sha256, `card ${index}`)
  })
  shown.forEach((previews, index) => {
    assert.ok([0, 1, 4].includes(previews.length), `card ${index}: ${previews.length} portraits`)
    if (list[index].preview_assets.length) assert.ok(previews.length > 0, `card ${index} empty`)
    const genes = previews.map(geneOf)
    assert.equal(new Set(genes).size, genes.length, `card ${index} repeats a gene`)
    const firstCandidate = previews.findIndex((preview) => !preview.is_current)
    if (firstCandidate >= 0) {
      assert.ok(
        previews.slice(firstCandidate).every((preview) => !preview.is_current),
        `card ${index}: candidate before canonical`,
      )
    }
    for (const gene of genes) cardsByGene.set(gene, [...(cardsByGene.get(gene) || []), index])
  })
  // A repeat is only allowed on a card that had nothing free: it shows one
  // portrait, and every gene it has is on another card or is another card's
  // canonical.
  const nothingFree = (index) =>
    shown[index].length === 1 &&
    list[index].preview_assets.map(geneOf).every((gene) => {
      const elsewhere = (cardsByGene.get(gene) || []).some((other) => other !== index)
      const owned = canonicalOwner.has(gene) && canonicalOwner.get(gene) !== index
      return elsewhere || owned
    })
  const repeats = []
  for (const [gene, cards] of cardsByGene) {
    if (cards.length < 2) continue
    repeats.push(gene)
    const forced = cards.filter(nothingFree)
    assert.ok(forced.length >= cards.length - 1, `${gene} repeats on cards ${cards.join(", ")}`)
  }
  shown.forEach((previews, index) => {
    if (nothingFree(index)) return
    for (const preview of previews) {
      if (preview.is_current) continue
      const owner = canonicalOwner.get(geneOf(preview))
      assert.ok(owner === undefined || owner === index, `card ${index} took ${geneOf(preview)}`)
    }
  })
  return { shown, repeats }
}

test("Favorites: the owner's sixteen styles show each gene once", () => {
  const favorites = options.filter((option) => option.is_favorite)
  assert.equal(favorites.length, 16)
  const { shown, repeats } = check(favorites)
  // Before: STAT5A x4, ACVR2B x3, SRC x3 and seven more genes on two cards.
  // After: only the 2- to 7-blot styles whose every gene is already on screen
  // repeat one, and 8. no gene shows more than twice.
  assert.deepEqual(repeats.sort(), ["ATR", "GAB1", "STAT5A"])
  const times = (gene) => shown.flat().filter((preview) => preview.gene_symbol === gene).length
  for (const gene of repeats) assert.ok(times(gene) <= 2, `${gene} shows ${times(gene)} times`)
  const acvr2b = shown.flat().filter((preview) => preview.gene_symbol === "ACVR2B")
  assert.equal(acvr2b.length, 1)
  // 0-255 and 0-343 have four canonical portraits each and keep them all.
  for (const family of ["0-255", "0-343"]) {
    const index = favorites.findIndex((option) => option.emulsion_family_id === family)
    assert.equal(shown[index].length, 4)
    assert.ok(shown[index].every((preview) => preview.is_current))
  }
})

test("All styles: 127 cards, no repeats beyond the tiny shared-gene styles", () => {
  const { shown, repeats } = check(options)
  assert.deepEqual(repeats.sort(), ["ATR", "GAB1", "STAT5A"])
  assert.ok(shown.filter((previews) => previews.length === 4).length >= 100)
})

test("a gene canonical in one style is never another style's candidate", () => {
  const list = [
    {
      preview_assets: [
        { gene_symbol: "A", asset_sha256: "a1", is_current: true },
        { gene_symbol: "X", asset_sha256: "x1", is_current: false },
        { gene_symbol: "B", asset_sha256: "b1", is_current: false },
        { gene_symbol: "C", asset_sha256: "c1", is_current: false },
        { gene_symbol: "D", asset_sha256: "d1", is_current: false },
      ],
    },
    {
      preview_assets: [
        { gene_symbol: "E", asset_sha256: "e1", is_current: false },
        { gene_symbol: "X", asset_sha256: "x2", is_current: true },
        { gene_symbol: "F", asset_sha256: "f1", is_current: false },
        { gene_symbol: "G", asset_sha256: "g1", is_current: false },
      ],
    },
  ]
  const shown = assignStyleCardPreviews(list)
  assert.deepEqual(
    shown.map((previews) => previews.map((preview) => preview.asset_sha256)),
    [
      ["a1", "b1", "c1", "d1"],
      ["x2", "e1", "f1", "g1"],
    ],
  )
})
