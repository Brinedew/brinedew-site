import assert from "node:assert/strict"
import test from "node:test"
import { buildClueSections, maskClueSections, sanitizeTargetProtein } from "./game-engine.js"

// B-785: the bootstrap payload must not ship unrevealed hint text. The raw text
// stays readable by the Worker's server-side reveal passes but never reaches a
// client before the hint is revealed.
const target = {
  uniprot: "P99999",
  hgnc: "TESTA",
  full_name: "Test protein alpha",
  length: 1575,
  tmh: false,
  secreted: true,
  tissue: { label: "group-enriched", score: 12 },
  first_pub_year: 1994,
  domains: ["IPR000001", "IPR000002"],
  domain_names: ["Kringle-like domain", "TESTA-associated domain"],
  clans: ["Peptidase_S1"],
  go_terms: { mf: ["GO:0004252"], cc: ["GO:0005576"] },
  go_terms_named: {
    mf: ["serine-type endopeptidase activity"],
    cc: ["extracellular region"],
  },
  reactome_pathways: [
    { id: "R-HSA-1", name: "Signaling by TESTA" },
    { id: "R-HSA-2", name: "Metabolism of amino acids" },
  ],
  cath_architecture: ["2.40.10.10"],
  synonyms: ["TESTA_SYN"],
}

const hiddenTexts = [
  "1575 amino acid residues",
  "1994",
  "Soluble",
  "Secreted",
  "group-enriched",
  "Peptidase S1",
  "Kringle-like domain",
  "TESTA-associated domain",
  "serine-type endopeptidase activity",
  "extracellular region",
  "Metabolism of amino acids",
  "Signaling by TESTA",
  "2.40.10.10",
]

function findItem(sections, id) {
  for (const section of sections) {
    for (const item of section.items) {
      if (item?.id === id) {
        return item
      }
    }
  }
  return null
}

test("bootstrap wire payload ships no unrevealed hint text", () => {
  const masked = maskClueSections(buildClueSections(target), new Set())
  const wire = JSON.stringify(masked)

  assert.ok(!wire.includes("fullText"))
  for (const forbidden of hiddenTexts) {
    assert.ok(!wire.includes(forbidden), `wire payload leaked: ${forbidden}`)
  }

  const lengthItem = findItem(masked, "hint-length")
  assert.equal(lengthItem.text, null)
  assert.equal(lengthItem.revealed, false)
  assert.equal(lengthItem.locked, false)
  assert.ok(Number(lengthItem.maskLength) > 0)
  assert.ok(Array.isArray(lengthItem.wordLengths))
})

test("server-side reveal passes keep reading the withheld text", () => {
  const masked = maskClueSections(buildClueSections(target), new Set())
  const lengthItem = findItem(masked, "hint-length")

  assert.equal(lengthItem.fullText, "1575 amino acid residues")
  assert.ok(!Object.keys(lengthItem).includes("fullText"))

  // Mirrors applyMatchReveals: a matched guess reveals the hint in place.
  for (const section of masked) {
    for (const item of section.items) {
      if (!item || !item.fullText || item.locked) continue
      if (item.fullText === "1575 amino acid residues") {
        item.revealed = true
        item.text = item.fullText
      }
    }
  }
  assert.equal(lengthItem.revealed, true)
  assert.equal(lengthItem.text, "1575 amino acid residues")
})

test("revealed hints ship their text and drop redaction masks", () => {
  const masked = maskClueSections(buildClueSections(target), new Set(["hint-length"]))
  const lengthItem = findItem(masked, "hint-length")

  assert.equal(lengthItem.revealed, true)
  assert.equal(lengthItem.text, "1575 amino acid residues")
  assert.equal(lengthItem.wordLengths, undefined)
  assert.equal(lengthItem.maskLength, undefined)
})

test("locked hints never expose text even to server-side passes", () => {
  const masked = maskClueSections(buildClueSections(target), new Set())
  const domainItem = findItem(masked, "hint-domain-1")
  const pathwayItem = findItem(masked, "hint-reactome-0")

  assert.equal(domainItem.locked, true)
  assert.equal(domainItem.fullText, undefined)
  assert.equal(domainItem.text, null)
  assert.equal(pathwayItem.locked, true)
  assert.equal(pathwayItem.fullText, undefined)
  assert.ok(!JSON.stringify(masked).includes("TESTA"))
})

test("sanitizeTargetProtein withholds scalar clue values before reveal", () => {
  const hidden = sanitizeTargetProtein(target)
  const wire = JSON.stringify(hidden)

  assert.equal(hidden.uniprot, null)
  assert.equal(hidden.hgnc, null)
  assert.equal(hidden.full_name, null)
  assert.equal(hidden.length, null)
  assert.equal(hidden.tmh, null)
  assert.equal(hidden.secreted, null)
  assert.deepEqual(hidden.tissue, { label: "unknown", score: null })
  assert.deepEqual(hidden.cath_architecture, [])
  for (const forbidden of ["1575", "group-enriched", "1994", "P99999", "TESTA"]) {
    assert.ok(!wire.includes(forbidden), `sanitized target leaked: ${forbidden}`)
  }
})

test("sanitizeTargetProtein reveals the full record at game over", () => {
  const shown = sanitizeTargetProtein(target, { revealIdentity: true })

  assert.equal(shown.uniprot, "P99999")
  assert.equal(shown.hgnc, "TESTA")
  assert.equal(shown.length, 1575)
  assert.equal(shown.tmh, false)
  assert.equal(shown.secreted, true)
  assert.equal(shown.tissue.label, "group-enriched")
  assert.deepEqual(shown.cath_architecture, ["2.40.10.10"])
  assert.deepEqual(shown.domain_names, ["Kringle-like domain", "TESTA-associated domain"])
})
