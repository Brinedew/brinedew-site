import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"

import { invalidIconoplasmRequiredAliasTermsAgainstScannerContext } from "../workers/iconoplasm-publication-alias-policy.js"
import { buildIconoplasmPublishedAliasRecognitionContext } from "../workers/iconoplasm-publication-aliases.js"

await import("./content-matcher.js")
await import("./content-scanner.js")

// B-1005: the gene PIP was highlighted inside the lipid PIP3, which the page
// writes as PIP<sub>3</sub>, and the admin panel refused "PIP3" as a protected
// phrase. Only a phrase the admin protects may hide a highlight; nothing is
// guessed from markup. Failure modes, written before the code:
// 1. The admin panel refuses "PIP3" (no recognized gene label inside).
// 2. The panel starts accepting phrases with no gene label at all.
// 3. A protected "PIP3" does not hide PIP in PIP<sub>3</sub> or in plain PIP3.
// 4. A protected "PIP3" hides PIP elsewhere: alone, or before another subscript.
// 5. Real gene notation that nobody protected loses its highlight: H2AX written
//    H<sub>2</sub>AX, KRAS<sup>G12D</sup>, TP53<sup>12</sup> (a citation).
// 6. The visible-text walk crosses a block edge (a new list item).

const GENES = { PIP: {}, AKT1: {}, TP53: {}, KRAS: {}, H2AX: {} }

test("the admin panel accepts PIP3 and still refuses a phrase with no gene in it", () => {
  const context = buildIconoplasmPublishedAliasRecognitionContext(GENES)
  const invalid = (terms) =>
    invalidIconoplasmRequiredAliasTermsAgainstScannerContext(context, {}, terms).map(
      (entry) => `${entry.term}:${entry.reason}`,
    )
  assert.deepEqual(invalid(["PIP3", "PIP2", "APC/C PIP"]), [])
  assert.deepEqual(invalid(["PIPELINE"]), ["PIPELINE:not_recognition_target"])
  assert.deepEqual(invalid(["CO2"]), ["CO2:not_recognition_target"])
  assert.deepEqual(invalid(["PIP"]), ["PIP:canonical_symbol"])
})

const nodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }

function highlighted(html, blocklist) {
  const { document } = parseHTML(`<html><body>${html}</body></html>`)
  const matcher = globalThis.IconoplasmContentMatcher.createGeneMatcher(GENES, { blocklist })
  const labels = []
  const scanner = globalThis.IconoplasmContentScanner.createPageScanner({
    documentRef: document,
    windowRef: {},
    nodeFilter,
    getMatcher: () => matcher,
    annotations: {
      update(node, matches) {
        for (const match of matches) {
          labels.push(node.data.slice(match.index, match.index + match.length))
        }
        return matches.length
      },
      remove() {},
    },
  })
  scanner.scanPage(document.body)
  return labels.join(",")
}

const PAGES = [
  ["<li>PIP<sub>3</sub> recruits AKT1</li>", "PIP,AKT1", "AKT1"],
  ["<p>plain PIP3 recruits AKT1</p>", "AKT1", "AKT1"],
  ["<p>PIP is secreted in saliva</p>", "PIP", "PIP"],
  ["<p>AKT1 binds PIP<sub>2</sub></p>", "AKT1,PIP", "AKT1,PIP"],
  ["<p>H<sub>2</sub>AX and H2AX mark breaks</p>", "H2AX", "H2AX"],
  ["<p>KRAS<sup>G12D</sup> mice</p>", "KRAS", "KRAS"],
  ["<p>mutant TP53<sup>12</sup> tumours</p>", "TP53", "TP53"],
  ["<ul><li>secreted PIP</li><li>3 more</li></ul>", "PIP", "PIP"],
]

for (const [html, before, after] of PAGES) {
  test(`${html}: before "${before}", after protecting PIP3 "${after}"`, () => {
    assert.equal(highlighted(html, new Set()), before)
    assert.equal(highlighted(html, new Set(["PIP3"])), after)
  })
}
