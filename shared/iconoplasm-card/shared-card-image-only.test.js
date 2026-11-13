import assert from "node:assert/strict"
import test from "node:test"

import "./shared-card-runtime.js"

const shared = globalThis.IconoplasmCardShared
if (!shared || typeof shared.renderLabLabelCardHtml !== "function") {
  throw new Error("IconoplasmCardShared runtime did not attach to globalThis")
}

function renderImageOnlyCard(caretaker) {
  return shared.renderLabLabelCardHtml(
    {
      symbol: "INS",
      full_name: "insulin",
      portrait: { status: "published" },
      caretaker,
    },
    { layoutVariant: "image-only" },
  )
}

test("image-only card keeps the gene symbol in its caption row", () => {
  const html = renderImageOnlyCard(undefined)

  assert.match(html, /icono-label-name icono-image-only-name">insulin</)
  assert.match(html, /icono-label-symbol icono-image-only-symbol">INS</)
})

test("cards never render caretaker identity, even when the payload carries it", () => {
  // Owner direction (2026-09-02): caretaker identity belongs on the gene page
  // toolbar, never on the gene card — with or without an assigned caretaker.
  const withCaretaker = renderImageOnlyCard({
    username: "caretaker-name",
    avatar_url: "/api/avatar?src=discord:1234",
  })
  const withoutCaretaker = renderImageOnlyCard(undefined)

  for (const html of [withCaretaker, withoutCaretaker]) {
    assert.doesNotMatch(html, /icono-image-only-caretaker/)
    assert.match(html, /icono-label-name icono-image-only-name">insulin</)
    assert.match(html, /icono-label-symbol icono-image-only-symbol">INS</)
  }
})

test("specimen card labels use the skin-safe words and keep every other hue bucket", () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const hueWords =
    "red rosy peach honey golden yellow lime chartreuse spring jade emerald teal cyan azure cerulean blue sapphire indigo violet purple amethyst magenta fuchsia rose cerise crimson".split(
      " ",
    )

  for (const [index, letter] of [...letters].entries()) {
    const expectedHue = hueWords[index]
    const html = shared.renderLabLabelSpecimenFooterHtml({
      symbol: letter === "C" ? "CCL4L1" : `${letter}GENE`,
      color: "#FDF2EF",
      tissue_tau: 0.95,
      loeuf: 1.923,
    })
    assert.ok(html.includes(`icono-label-specimen-hand-analysis">${expectedHue}</span>`))
    assert.doesNotMatch(html, />vermilion<|>orange<|>amber</)
    if (letter === "C") {
      assert.match(html, />letter</)
      assert.match(html, />C</)
      assert.match(html, />0\.95</)
      assert.match(html, />high vibrance</)
      assert.match(html, />1\.923</)
      assert.match(html, />light shade</)
    }
  }
})
