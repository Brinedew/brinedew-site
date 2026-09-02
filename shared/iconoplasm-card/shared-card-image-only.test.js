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
  // Without a caretaker there is no caretaker row at all: the card reads
  // exactly like the pre-caretaker identity design.
  assert.doesNotMatch(html, /icono-image-only-caretaker-row/)
})

test("caretaker identity joins the card without displacing the gene symbol", () => {
  const html = renderImageOnlyCard({
    username: "caretaker-name",
    avatar_url: "/api/avatar?src=discord:1234",
  })

  const caretakerRowPosition = html.indexOf("icono-image-only-caretaker-row")
  const captionRowPosition = html.indexOf("icono-image-only-caption-row")
  assert.ok(caretakerRowPosition >= 0, "caretaker row missing")
  assert.ok(captionRowPosition > caretakerRowPosition, "caretaker row must sit above the caption row")
  assert.match(html, /Caretaker caretaker-name/)
  assert.match(html, /icono-label-symbol icono-image-only-symbol">INS</)
})

test("caretaker chips without the sanctioned avatar route never render", () => {
  const html = renderImageOnlyCard({ username: "caretaker-name", avatar_url: "https://evil.example/x.png" })

  assert.doesNotMatch(html, /icono-image-only-caretaker-row/)
  assert.match(html, /icono-label-symbol icono-image-only-symbol">INS</)
})
