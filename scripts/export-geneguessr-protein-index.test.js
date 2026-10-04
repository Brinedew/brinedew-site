import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { gzipSync } from "node:zlib"

import {
  MAX_DUMP_AGE_DAYS,
  PROTEIN_INDEX_FIELDS,
  buildProteinIndex,
  readRows,
} from "./export-geneguessr-protein-index.mjs"

// B-1002: the protein index is exported from the nightly dump of the geneguessr D1, not from
// production, because no laptop or agent shell has a production D1 credential. This test builds a
// real SQLite dump the way scripts/backup-d1-rotation.mjs stores one (gzip plus a manifest with
// its sha256) and runs the real reader and index builder on it.
//
// Failure modes it is built to catch:
// 1. a protein that is not guessable (no structure, or a structure failure) ends up in the index;
// 2. the rows come back in an order the static index does not expect (gene, then uniprot);
// 3. an older dump is read although a newer complete one exists, or a dump still being written
//    (gz without its manifest) is read;
// 4. a dump past MAX_DUMP_AGE_DAYS is used instead of refused, and the refusal does not say how old;
// 5. the reader does not say that the data is a dump and not live;
// 6. a dump that does not match its manifest sha256 is used.

const NOW = Date.parse("2026-10-04T10:00:00Z")

const DUMP = `
  CREATE TABLE proteins (
    uniprot TEXT PRIMARY KEY, gene TEXT, gene_surname TEXT, full_name TEXT,
    length INTEGER, synonyms TEXT, structure_source TEXT
  );
  CREATE TABLE structure_failures (uniprot TEXT PRIMARY KEY);
  INSERT INTO proteins VALUES ('P04637', 'TP53', 'p53', 'Cellular tumor antigen p53', 393, '["P53","TP53","LFS1"]', 'alphafold');
  INSERT INTO proteins VALUES ('P38398', 'BRCA1', NULL, 'Breast cancer type 1 susceptibility protein', 1863, '["RNF53"]', 'alphafold');
  INSERT INTO proteins VALUES ('P99999', 'AAA', NULL, 'Second isoform with the same gene', 100, NULL, 'pdb');
  INSERT INTO proteins VALUES ('P00001', 'AAA', NULL, 'First isoform with the same gene', 90, 'not json, x', 'pdb');
  INSERT INTO proteins VALUES ('P11111', 'NOSTRUCT', NULL, 'No structure at all', 50, NULL, NULL);
  INSERT INTO proteins VALUES ('P22222', 'BROKEN', NULL, 'Structure failed to load', 60, NULL, 'alphafold');
  INSERT INTO structure_failures VALUES ('P22222');
`

let work
let root
let cacheDir

function writeDump(database, date, { sql = DUMP, manifest = true, tamper = false } = {}) {
  const dir = path.join(root, database)
  mkdirSync(dir, { recursive: true })
  const file = path.join(work, `${database}-${date}.sqlite`)
  const db = new DatabaseSync(file)
  db.exec(sql)
  db.close()
  const gz = gzipSync(readFileSync(file))
  rmSync(file)
  writeFileSync(path.join(dir, `${date}.sqlite.gz`), gz)
  if (manifest) {
    // A tampered dump keeps its bytes but its manifest names a different sha256.
    const sha256 = tamper ? "0".repeat(64) : createHash("sha256").update(gz).digest("hex")
    writeFileSync(
      path.join(dir, `${date}.json`),
      JSON.stringify({ database, date, bytes: gz.length, sha256 }),
    )
  }
}

function read(extra = {}) {
  const lines = []
  return readRows({
    backupRoot: root,
    cacheDir,
    now: NOW,
    log: (line) => lines.push(line),
    ...extra,
  }).then((rows) => ({ rows, lines }))
}

before(() => {
  work = mkdtempSync(path.join(tmpdir(), "protein-index-test-"))
  root = path.join(work, "backups")
  cacheDir = path.join(work, "cache")
  mkdirSync(root, { recursive: true })
})

after(() => rmSync(work, { recursive: true, force: true }))

test("1,2,3,5: the guessable proteins come from the newest complete dump, in index order, and the dump is named", async () => {
  writeDump("geneguessr", "2026-09-25", {
    sql: "CREATE TABLE proteins (uniprot TEXT); CREATE TABLE structure_failures (uniprot TEXT);",
  })
  writeDump("geneguessr", "2026-10-01")
  // A later dump still being written: gz present, manifest not yet.
  writeDump("geneguessr", "2026-10-03", { manifest: false })

  const { rows, lines } = await read()

  assert.match(lines[0], /^# NOT LIVE DATA: geneguessr nightly dump of 2026-10-01 \(3 days old\)/)
  assert.deepEqual(
    rows.map((row) => `${row.gene}/${row.uniprot}`),
    ["AAA/P00001", "AAA/P99999", "BRCA1/P38398", "TP53/P04637"],
    "no structure and structure-failure proteins, ordered by gene then uniprot",
  )

  const index = buildProteinIndex(rows)
  assert.deepEqual(index.fields, PROTEIN_INDEX_FIELDS)
  assert.deepEqual(index.rows[0], [
    "P00001",
    "AAA",
    null,
    "First isoform with the same gene",
    90,
    ["not json", "x"],
  ])
  assert.deepEqual(index.rows[3], [
    "P04637",
    "TP53",
    "p53",
    "Cellular tumor antigen p53",
    393,
    ["P53", "LFS1"],
  ])
})

test("4: a dump past the age limit is refused and the refusal says how old it is", async () => {
  const lateNow = NOW + (MAX_DUMP_AGE_DAYS + 1) * 86_400_000
  await assert.rejects(
    () => read({ now: lateNow }),
    (error) => /geneguessr dump is 10 days old \(limit 6\)/.test(error.message),
  )
})

test("6: a dump whose bytes do not match its manifest is refused", async () => {
  writeDump("geneguessr", "2026-10-04", { tamper: true })
  await assert.rejects(() => read(), /sha256/)
})
