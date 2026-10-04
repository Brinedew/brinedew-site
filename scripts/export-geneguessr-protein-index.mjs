// Exports the GeneGuessr guessable-protein search index as one static asset.
//
// Why: protein autocomplete used to call /api/proteins on every keystroke,
// spending one Worker request plus a D1 FTS query per character typed. That
// path alone made the game unable to survive a traffic spike on the Free plan.
// The guessable set changes rarely (new structures, retired failures), so it
// ships as a static file and search runs in the browser at zero request cost.
//
// The same file also answers the "paste your own gene list" box (B-934): `rows` are the playable
// symbols and `recognized_unplayable` lists the symbols the catalog knows but cannot play (no
// structure source, or a recorded structure failure), so a paste resolves in the browser with no
// Worker request and no D1 read.
//
// Run after the protein set or structure failures change:
//   node scripts/export-geneguessr-protein-index.mjs
// It reads the newest nightly dump of the geneguessr D1 (written by
// scripts/backup-d1-rotation.mjs, up to a few days old), not production: agents have no
// production D1 credential (B-1002). The dump's date is printed first, and a dump older than
// MAX_DUMP_AGE_DAYS is refused. After a change to the protein set, run this after the next
// nightly backup so the dump holds the change.
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"

import {
  DEFAULT_BACKUP_ROOT,
  dumpBanner,
  dumpDescription,
  findNewestDump,
  unpackDump,
} from "./d1-local.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
// The backup rotation writes one dump per database about every five days.
export const MAX_DUMP_AGE_DAYS = 6
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

// Symbols the catalog knows but a game cannot use: no structure source, or a recorded failure.
const UNPLAYABLE_QUERY = `SELECT DISTINCT p.gene
  FROM proteins p
  LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
  WHERE p.structure_source IS NULL OR sf.uniprot IS NOT NULL`

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

export function buildProteinIndex(rows, unplayableGenes = []) {
  const out = []
  const playableGenes = new Set()
  for (const row of rows) {
    const uniprot = String(row?.uniprot || "").trim()
    const hgnc = String(row?.gene || "").trim()
    if (!uniprot || !hgnc) continue
    playableGenes.add(hgnc.toUpperCase())
    out.push([
      uniprot,
      hgnc,
      row.gene_surname ? String(row.gene_surname) : null,
      String(row.full_name || ""),
      Number(row.length) || null,
      parseSynonyms(row.synonyms, hgnc),
    ])
  }
  // A symbol that is playable through any protein is playable, so it is never listed here.
  const unplayable = new Set()
  for (const gene of unplayableGenes) {
    const symbol = String(gene?.gene ?? gene ?? "")
      .trim()
      .toUpperCase()
    if (symbol && !playableGenes.has(symbol)) unplayable.add(symbol)
  }
  return {
    schema_version: 1,
    fields: PROTEIN_INDEX_FIELDS,
    rows: out,
    recognized_unplayable: [...unplayable].sort(),
  }
}

// The newest nightly dump of the geneguessr D1, opened read-only through the same unpacker
// scripts/d1-local.mjs uses. Nothing here touches Cloudflare, so the free plan's D1 read
// allowance stays whole and no production credential is needed (B-1002).
export async function readRows({
  backupRoot = process.env.D1_BACKUP_ROOT || DEFAULT_BACKUP_ROOT,
  cacheDir = path.join(tmpdir(), "brinedew-d1-local"),
  now = Date.now(),
  log = (line) => console.error(line),
} = {}) {
  const dump = findNewestDump({ root: backupRoot, database: "geneguessr" })
  const description = dumpDescription(dump, now)
  log(dumpBanner(description))
  if (description.age_days > MAX_DUMP_AGE_DAYS) {
    throw new Error(
      `The newest geneguessr dump is ${description.age_days} days old (limit ${MAX_DUMP_AGE_DAYS}). ` +
        "Let the nightly backup (scripts/backup-d1-rotation.mjs) write a newer one, then run this again.",
    )
  }
  const file = await unpackDump(dump, cacheDir, { now, log })
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    database.exec("PRAGMA query_only = ON")
    return {
      rows: database.prepare(QUERY).all(),
      unplayable: database.prepare(UNPLAYABLE_QUERY).all(),
    }
  } finally {
    database.close()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, unplayable } = await readRows()
  const index = buildProteinIndex(rows, unplayable)
  if (index.rows.length < 10000)
    throw new Error(`Refusing a suspiciously small index: ${index.rows.length}`)
  writeFileSync(path.join(root, PROTEIN_INDEX_PATH), JSON.stringify(index) + "\n", "utf8")
  console.log(
    `Wrote ${index.rows.length} proteins and ${index.recognized_unplayable.length} recognized-unplayable symbols to ${PROTEIN_INDEX_PATH}`,
  )
}
