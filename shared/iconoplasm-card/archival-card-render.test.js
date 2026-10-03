import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const runtimePath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-runtime.js")

test("real seven-clan KALRN infocard projects PFAM lanes into a 4 plus 3 column layout", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  // Real local source fixture from D:\Coding\Datasets\iconoplasm\proteins_with_demographics.json
  // plus D:\Coding\Datasets\iconoplasm\prompts.db for the paired style labels.
  const model = sharedRuntime.resolveArchivalCardModel({
    symbol: "KALRN",
    full_name: "Kalirin",
    essence: {
      aesthetics_origin: [
        "Immunoglobulin E-set",
        "Protein Kinase",
        "Spectrin",
        "Dbl homology-like",
        "CRAL-TRIO",
        "PH domain",
        "SH3",
      ],
      aesthetics: [
        "Y\u014dkai",
        "Neoclassicism",
        "Sunshine Pop",
        "Ballet",
        "Old Hollywood",
        "Sprezzatura",
        "Flogger",
      ],
    },
  })
  assert.equal(model.stylePairs.length, 7, "mobile and Lit cards need up to seven clan lanes")
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.origin),
    [
      "Immunoglobulin E-set",
      "Protein Kinase",
      "Spectrin",
      "Dbl homology-like",
      "CRAL-TRIO",
      "PH domain",
      "SH3",
    ],
  )
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.note.normalize("NFC")),
    [
      "Y\u014dkai",
      "Neoclassicism",
      "Sunshine Pop",
      "Ballet",
      "Old Hollywood",
      "Sprezzatura",
      "Flogger",
    ],
  )
  assert.deepEqual(
    model.stylePairColumns.map((column) => column.map((pair) => pair.origin)),
    [
      ["Immunoglobulin E-set", "Protein Kinase", "Spectrin", "Dbl homology-like"],
      ["CRAL-TRIO", "PH domain", "SH3"],
    ],
    "5+ clan genes must split after the fourth lane instead of stacking every clan on the left",
  )
  assert.equal(
    model.stylePairs.some((pair) => /\+\d|more clans|mixed/i.test(`${pair.origin} ${pair.note}`)),
    false,
    "seven-clan genes should show the lanes directly, not a lossy overflow summary",
  )
  const html = sharedRuntime.renderLabLabelCardHtml(
    {
      symbol: "KALRN",
      full_name: "Kalirin",
      essence: {
        aesthetics_origin: [
          "Immunoglobulin E-set",
          "Protein Kinase",
          "Spectrin",
          "Dbl homology-like",
          "CRAL-TRIO",
          "PH domain",
          "SH3",
        ],
        aesthetics: [
          "Y\u014dkai",
          "Neoclassicism",
          "Sunshine Pop",
          "Ballet",
          "Old Hollywood",
          "Sprezzatura",
          "Flogger",
        ],
      },
    },
    { layoutVariant: "lit-archival" },
  )
  assert.match(html, /icono-label-style-stack icono-label-style-stack--two-column/)
  const rightColumnIndex = html.indexOf("icono-label-style-column icono-label-style-column--right")
  assert.notEqual(rightColumnIndex, -1, "7-clan real cards must render a right column")
  assert.equal(
    html.slice(0, rightColumnIndex).includes("CRAL-TRIO"),
    false,
    "the fifth real clan must not remain in the left column",
  )
  assert.notEqual(html.slice(rightColumnIndex).indexOf("CRAL-TRIO"), -1)
  assert.notEqual(html.slice(rightColumnIndex).indexOf("SH3"), -1)
})

// ARCHITECTURE FENCE [IPD-003]
test("gene lead portrait is labelled as source material, not the canonical blot", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  const portraitAlt = sharedRuntime.genePortraitAlt("tp53")
  const html = sharedRuntime.renderLabLabelPortraitMediaHtml(
    "TP53",
    "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/medium.webp",
    "https://iconoplasm.brinedew.bio/portraits/v1/aa/asset/full.webp",
    { width: 768, height: 1024 },
    {
      portraitAlt,
      buttonAriaLabel: "Open full-size source portrait for TP53",
      captionText: sharedRuntime.genePortraitCaption("TP53", "tumor protein p53"),
    },
  )

  assert.equal(portraitAlt, "TP53 character portrait used inside the Iconoplasm gene blot")
  assert.match(html, /aria-label="Open full-size source portrait for TP53"/)
  assert.match(
    html,
    /data-iconoplasm-role="source-portrait" data-gene-symbol="TP53"/,
  )
  assert.match(html, /alt="TP53 character portrait used inside the Iconoplasm gene blot"/)
  assert.match(
    html,
    /class="icono-visually-hidden icono-portrait-caption">Source portrait used inside the Iconoplasm gene blot for TP53 \(tumor protein p53\)\.<\/span>/,
  )
  assert.doesNotMatch(html, /alt="TP53 blot"/)
})

// ARCHITECTURE FENCE [IPD-003]
test("archival cards expose one labelled accessible equivalent of the visual character facts", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  const fixture = {
    symbol: "TP53",
    full_name: "tumor protein p53",
    color: "#35353C",
    tissue_tau: 0.26,
    loeuf: 0.449,
    first_publication_year: 1976,
    portrait: { emulsion_id: "0-15527-e" },
    essence: {
      age_years: 44,
      aesthetics: ["Kingcore"],
      aesthetics_origin: ["p53-like"],
      family_feature: "DNA damage response",
      family_members: 2,
      family_surname: "TP",
      politics: "pro-control",
      politics_origin: "tumor suppressor",
      sex: "female",
      sex_origin: "transmembrane",
      weight_kg: 44,
    },
  }

  const html = sharedRuntime.renderLabLabelCardHtml(fixture, {
    includeCharacterProfile: true,
    layoutVariant: "lit-archival",
  })
  assert.equal(
    sharedRuntime.labLabelEmulsionNumber(fixture.portrait),
    "0-15527-e",
    "historical lookup identity must not masquerade as recorded A1 factory lineage",
  )
  assert.equal(
    sharedRuntime.labLabelEmulsionNumber({
      emulsion_id: "C9-15527-e",
    }),
    "C9-15527-e",
    "recorded immutable factory lineage must remain visible",
  )
  assert.doesNotMatch(
    sharedRuntime.renderLabLabelCardHtml(fixture, { layoutVariant: "lit-archival" }),
    /icono-card-semantic-profile/,
    "bounded gallery cards must not duplicate their visual card facts unless a page opts in",
  )
  const profileStart = html.indexOf('<section class="icono-card-semantic-profile"')
  assert.notEqual(profileStart, -1, "the card must carry an accessible fact profile")
  const profileEnd = html.indexOf("</section>", profileStart)
  assert.notEqual(profileEnd, -1, "the accessible fact profile must close its semantic section")
  const profile = html.slice(profileStart, profileEnd + "</section>".length)

  assert.match(
    html,
    /class="icono-label-category-grid" role="img" aria-label="Molecular category: transmembrane"/,
  )
  assert.match(
    html,
    /role="note" aria-label="Character sex: female" class="icono-label-hand-note icono-label-hand-note--sex/,
  )
  assert.match(
    html,
    /class="icono-label-alignment-grid" role="group" aria-label="Molecular alignment to character alignment mapping"/,
  )
  assert.match(
    html,
    /role="img" aria-label="Molecular alignment: tumor suppressor" class="icono-label-selector-row/,
  )
  assert.match(
    html,
    /role="note" aria-label="Character alignment: pro-control" class="icono-label-hand-note icono-label-hand-note--politics/,
  )
  assert.equal(
    (html.match(/<span aria-hidden="true" class="icono-label-option/g) || []).length,
    4,
    "the two category and two alignment alternatives must remain visual-only ink",
  )
  assert.doesNotMatch(
    html,
    />(?:TRANSMEMBRANE|SOLUBLE|ONCOGENE|TUMOR SUPPRESSOR)</,
    "decorative alternatives must not survive as peer DOM text",
  )
  assert.doesNotMatch(html, /aria-(?:checked|selected)=/)

  assert.match(profile, /aria-label="Character profile for TP53"/)
  assert.match(profile, /<h2>Character profile for TP53<\/h2>/)
  assert.match(profile, /<dt>Gene identity<\/dt><dd>TP53 — tumor protein p53<\/dd>/)
  assert.match(
    profile,
    /<dt>Card color mapping<\/dt><dd>Hex color: #35353C → Card color name: Shearwater Black<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>Letter-to-hue mapping<\/dt><dd>Letter: T → Hue: purple<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>HPA tau-to-vibrance mapping<\/dt><dd>HPA tau: 0\.26 → Character vibrance: low vibrance<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>gnomAD LOEUF-to-shade mapping<\/dt><dd>gnomAD LOEUF: 0\.449 → Character shade: dark shade<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>Molecular category-to-character sex mapping<\/dt><dd>Molecular category: transmembrane → Character sex: female<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>First-noted-to-character-age mapping<\/dt><dd>First noted: 1976 → Character age: 44 y\.o\.<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>Molecular-mass-to-character-mass mapping<\/dt><dd>Molecular mass: 44 kDa → Character mass: 44 kg<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>PFAM-clan-to-character-aesthetic mapping<\/dt><dd>PFAM clan: p53-like → Character aesthetic: Kingcore<\/dd>/,
  )
  assert.match(
    profile,
    /<dt>Molecular-alignment-to-character-alignment mapping<\/dt><dd>Molecular alignment: tumor suppressor → Character alignment: pro-control<\/dd>/,
  )
  assert.doesNotMatch(profile, /\b(?:aria-hidden|hidden)\b/)

})

