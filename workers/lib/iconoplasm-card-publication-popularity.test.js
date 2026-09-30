import assert from "node:assert/strict"
import test from "node:test"

import { publicCatalogEntry } from "./iconoplasm-card-publication.js"

// B-886 (27 Sep 2026): every published gallery entry carried popularity 0, so
// the public "Most popular" order and every popularity tie-break were really
// votes-then-date. The composed card never sets popularity_score; the only
// source is the Wikipedia page-view table the browser already uses.
// Failure modes: (1) a well-known gene publishes 0; (2) the ranking among
// real genes inverts; (3) an explicit record value is overwritten.
test("published catalog entries carry Wikipedia popularity (B-886)", () => {
  const entry = (symbol, extra = {}) =>
    publicCatalogEntry({ symbol, payload: { symbol, ...extra } }).popularity_score
  assert.equal(entry("INS") > 0, true)
  assert.equal(entry("INS") > entry("ACTB"), true)
  assert.equal(entry("ACTB") > 0, true)
  assert.equal(entry("NOT-A-GENE"), 0)
  assert.equal(entry("INS", { popularity_score: 7 }), 7)
})
