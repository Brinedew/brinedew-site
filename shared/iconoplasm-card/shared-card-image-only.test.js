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
  assert.match(html, /icono-label-symbol icono-image-only-symbol"[^>]*>INS</)
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
    assert.match(html, /icono-label-symbol icono-image-only-symbol"[^>]*>INS</)
  }
})

// B-1038, golden: the longest symbols still in the catalogue once readthroughs go
// (B-1031). A long symbol splits at a hyphen first, then between a number and the
// letters after it, never inside a run of letters; one with no split stays whole and
// its length sets how far the type shrinks.
test("long symbols take two lines at a hyphen or after a number", () => {
  for (const [symbol, html] of [
    ["PALM2AKAP2", ">PALM2<br>AKAP2<"],
    ["TRAV38-2DV8", ">TRAV38-<br>2DV8<"],
    ["ANKRD13C-DT", ">ANKRD13C-<br>DT<"],
    ["IGHV1-69-2", ">IGHV1-<br>69-2<"],
    ["CSGALNACT1", ">CSGALNACT1<"],
    ["ERVMER34-1", ">ERVMER34-1<"],
    ["GINS3", ">GINS3<"],
  ]) {
    assert.ok(shared.imageOnlySymbolHtml(symbol).includes(html), `${symbol} renders as ${html}`)
  }
  assert.match(shared.imageOnlySymbolHtml("CSGALNACT1"), /--icono-symbol-segment:10"/)
  assert.match(shared.imageOnlySymbolHtml("PALM2AKAP2"), /--icono-symbol-segment:5"/)
  assert.match(shared.imageOnlySymbolHtml("A<B"), />A&lt;B</)
})
