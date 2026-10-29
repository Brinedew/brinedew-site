// B-1063: checks buildStableGeneObject against the gene objects readers get today.
//
//   node scripts/compare-stable-gene-object-builder.mjs --symbols TP53,WEE1
//   node scripts/compare-stable-gene-object-builder.mjs --all [--concurrency 16]
//
// For each gene it downloads the live genes/v3/<SYMBOL>.json from the CDN,
// splits it back into the builder's two inputs (the factory's content and the
// readers' facts), rebuilds it and reports:
//   - winner: whether the winner rule, run on the object's own vote counts and
//     supervote, picks the portrait the object shows. A mismatch is either an
//     administrator's pin or a stored winner the D1 path never re-elected;
//   - fields: every path where the rebuilt object differs from the live one,
//     with the live object's portrait pinned so the winner can't explain it.
// Nothing is written anywhere. Reading costs CDN bandwidth only (about 10 KB per
// gene object).
import { pathToFileURL } from "node:url"

import { buildStableGeneObject } from "../workers/lib/iconoplasm-stable-gene-object.js"

const CDN = "https://iconoplasmportraits.b-cdn.net"

const CONTENT_PORTRAIT_FIELDS = [
  "asset_sha256",
  "width",
  "height",
  "status",
  "autopick_eligible",
  "created_at",
  "candidate_image_id",
  "vision_id",
  "emulsion_id",
  "emulsion_label",
  "sample_label",
  "sample_number",
  "sample_text_hash",
  "artist_id",
]
const TOP_LEVEL_ESSENCE_FIELDS = [
  "molecular_weight_kda",
  "first_publication_year",
  "primary_tissue",
]

// The live gene object, taken apart into what the factory made and what readers did.
// Stale and legacy flags never reach a gene object, so every portrait counts as fresh.
export function inputsFromGeneObject(geneObject) {
  const essence = { ...(geneObject.essence || {}) }
  const sexOrigin = Array.isArray(essence.sex_origin) ? essence.sex_origin[0] : null
  delete essence.name
  delete essence.politics
  delete essence.sex_origin
  for (const field of TOP_LEVEL_ESSENCE_FIELDS) {
    if (geneObject[field] !== undefined) essence[field] = geneObject[field]
  }
  if (geneObject.uniqueness_rank !== undefined) essence.leakage_percent = geneObject.uniqueness_rank
  if (geneObject.weight_kg !== undefined && essence.weight_kg === undefined)
    essence.weight_kg = geneObject.weight_kg
  const portraits = (geneObject.portrait_candidates || []).map((candidate) =>
    Object.fromEntries(CONTENT_PORTRAIT_FIELDS.map((field) => [field, candidate[field] ?? null])),
  )
  const supervoted = (geneObject.portrait_candidates || []).find(
    (candidate) => candidate.caretaker_supervote,
  )
  const manifestation = geneObject.canonical_manifestation
    ? { ...geneObject.canonical_manifestation }
    : (geneObject.canonical_manifestation ?? null)
  if (manifestation) delete manifestation.accepted_tags_derivative
  return {
    content: {
      symbol: geneObject.symbol,
      catalog: {
        full_name: geneObject.full_name,
        color_hex: geneObject.color,
        tmh: sexOrigin === "Transmembrane" ? true : sexOrigin === "Soluble" ? false : null,
      },
      essence,
      portraits,
    },
    facts: {
      votes: (geneObject.portrait_candidates || []).map((candidate) => ({
        asset_sha256: candidate.asset_sha256,
        upvotes: candidate.image_upvotes,
        downvotes: candidate.image_downvotes,
        score: candidate.image_score,
      })),
      supervote: supervoted
        ? {
            asset_sha256: supervoted.asset_sha256,
            direction: supervoted.caretaker_supervote_direction ?? 1,
          }
        : null,
      pin: null,
      previous_winner: geneObject.portrait?.asset_sha256 || null,
      manifestation,
      caretaker: geneObject.caretaker ?? null,
      vote_version: geneObject.vote_version ?? null,
    },
  }
}

// Paths where two JSON values differ; arrays compare in order.
export function differences(expected, actual, path = "") {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [path]
    const out = []
    if (expected.length !== actual.length) out.push(`${path}.length`)
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1)
      out.push(...differences(expected[index], actual[index], `${path}[${index}]`))
    return out
  }
  if (expected && actual && typeof expected === "object" && typeof actual === "object") {
    const out = []
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)]))
      out.push(...differences(expected[key], actual[key], path ? `${path}.${key}` : key))
    return out
  }
  return Object.is(expected, actual) ? [] : [path]
}

export function compareGeneObject(geneObject) {
  const { content, facts } = inputsFromGeneObject(geneObject)
  const stamp = () => geneObject.published_at
  const elected = buildStableGeneObject(content, facts, { now: stamp })
  const liveWinner = geneObject.portrait?.asset_sha256 || null
  const pinned = buildStableGeneObject(content, { ...facts, pin: liveWinner }, { now: stamp })
  const expected = structuredClone(geneObject)
  // Gene objects older than B-898 stage 2 carry no vote version, and those
  // written before 2026-10-30 no caretaker; the builder writes null for "none
  // read". Leaked private tags are dropped on purpose (B-859).
  if (!("vote_version" in expected)) expected.vote_version = null
  if (!("caretaker" in expected)) expected.caretaker = null
  if (expected.canonical_manifestation)
    delete expected.canonical_manifestation.accepted_tags_derivative
  return {
    symbol: geneObject.symbol,
    winner_matches: (elected.portrait?.asset_sha256 || null) === liveWinner,
    elected_winner: elected.portrait?.asset_sha256 || null,
    live_winner: liveWinner,
    fields: differences(expected, pinned),
    leaked_tags: Boolean(geneObject.canonical_manifestation?.accepted_tags_derivative),
  }
}

async function fetchJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url)
    if (response.status === 404) return null
    if (response.ok) return response.json()
    if (attempt >= 3) throw new Error(`${url}: HTTP ${response.status}`)
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
  }
}

async function allSymbols() {
  const index = await fetchJson(`${CDN}/catalog/v3/index.json?cb=${Date.now()}`)
  return (index?.genes || []).map((row) => (Array.isArray(row) ? row[0] : row?.s)).filter(Boolean)
}

function argument(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? null : process.argv[at + 1]
}

async function main() {
  const symbols = process.argv.includes("--all")
    ? await allSymbols()
    : String(argument("--symbols") || "")
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
  const concurrency = Number(argument("--concurrency") || 16)
  const stamp = Date.now()
  const results = []
  const missing = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
      while (next < symbols.length) {
        const symbol = symbols[next++]
        const geneObject = await fetchJson(
          `${CDN}/genes/v3/${encodeURIComponent(symbol)}.json?cb=${stamp}`,
        )
        if (!geneObject) missing.push(symbol)
        else results.push(compareGeneObject(geneObject))
      }
    }),
  )
  const fieldCounts = new Map()
  for (const result of results) {
    for (const path of new Set(result.fields.map((field) => field.replace(/\[\d+\]/g, "[]"))))
      fieldCounts.set(path, (fieldCounts.get(path) || 0) + 1)
  }
  const winnerMismatches = results.filter((result) => !result.winner_matches)
  console.log(
    JSON.stringify(
      {
        compared: results.length,
        missing_objects: missing.length,
        identical: results.filter((result) => !result.fields.length).length,
        winner_mismatches: winnerMismatches.length,
        winner_mismatch_examples: winnerMismatches.slice(0, 12).map((result) => result.symbol),
        objects_with_leaked_tags: results.filter((result) => result.leaked_tags).length,
        differing_fields: Object.fromEntries(
          [...fieldCounts.entries()].sort((left, right) => right[1] - left[1]),
        ),
        field_examples: Object.fromEntries(
          [...fieldCounts.keys()].slice(0, 20).map((path) => [
            path,
            results
              .filter((result) =>
                result.fields.some((field) => field.replace(/\[\d+\]/g, "[]") === path),
              )
              .slice(0, 5)
              .map((result) => result.symbol),
          ]),
        ),
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
