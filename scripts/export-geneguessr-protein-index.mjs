// Exports the GeneGuessr guessable-protein search index as one static asset.
//
// Why: protein autocomplete used to call /api/proteins on every keystroke,
// spending one Worker request plus a D1 FTS query per character typed. That
// path alone made the game unable to survive a traffic spike on the Free plan.
// The guessable set changes rarely (new structures, retired failures), so it
// ships as a static file and search runs in the browser at zero request cost.
//
// Run after the protein set or structure failures change:
//   node scripts/export-geneguessr-protein-index.mjs
// One run reads each protein row once (~19k D1 rows).
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const CONFIG = "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"
export const PROTEIN_INDEX_PATH = "quartz/static/geneguessr/protein-index.json"
export const PROTEIN_INDEX_FIELDS = Object.freeze([
  "uniprot",
  "hgnc",
  "gene_surname",
  "full_name",
  "length",
  "synonyms",
])

// Same eligibility as workers/lib/protein-store.js searchProteins.
const QUERY = `SELECT p.uniprot, p.gene, p.gene_surname, p.full_name, p.length, p.synonyms
  FROM proteins p
  LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
  WHERE p.structure_source IS NOT NULL AND sf.uniprot IS NULL
  ORDER BY p.gene, p.uniprot`

function parseSynonyms(raw, gene) {
  let values = []
  try {
    values = JSON.parse(raw || "[]")
  } catch {
    values = String(raw || "").split(",")
  }
  const seen = new Set([String(gene || "").toUpperCase()])
  const out = []
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").trim()
    if (!text || seen.has(text.toUpperCase())) continue
    seen.add(text.toUpperCase())
    out.push(text)
  }
  return out
}

export function buildProteinIndex(rows) {
  const out = []
  for (const row of rows) {
    const uniprot = String(row?.uniprot || "").trim()
    const hgnc = String(row?.gene || "").trim()
    if (!uniprot || !hgnc) continue
    out.push([
      uniprot,
      hgnc,
      row.gene_surname ? String(row.gene_surname) : null,
      String(row.full_name || ""),
      Number(row.length) || null,
      parseSynonyms(row.synonyms, hgnc),
    ])
  }
  return { schema_version: 1, fields: PROTEIN_INDEX_FIELDS, rows: out }
}

function readRows() {
  // Run Wrangler's entry point directly: a Windows shell would split the SQL.
  const output = execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/wrangler/bin/wrangler.js"),
      "d1",
      "execute",
      "geneguessr",
      "--remote",
      "--config",
      CONFIG,
      "--json",
      "--command",
      QUERY.replace(/\s+/g, " "),
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  const parsed = JSON.parse(output.slice(output.indexOf("[")))
  return parsed?.[0]?.results || []
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = buildProteinIndex(readRows())
  if (index.rows.length < 10000)
    throw new Error(`Refusing a suspiciously small index: ${index.rows.length}`)
  writeFileSync(path.join(root, PROTEIN_INDEX_PATH), JSON.stringify(index) + "\n", "utf8")
  console.log(`Wrote ${index.rows.length} proteins to ${PROTEIN_INDEX_PATH}`)
}
