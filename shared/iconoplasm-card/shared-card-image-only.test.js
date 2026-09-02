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
