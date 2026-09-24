import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, writeFileSync, utimesSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import {
  BACKUP_ROTATION,
  exportD1Database,
  pruneBackups,
  rotationDatabase,
  runRotation,
} from "./backup-d1-rotation.mjs"

// B-830 failure list, written before the exporter:
// 1. The budget gate must skip (and fail closed) when readers could be starved.
// 2. A day's backup already on disk means no second export.
// 3. Paging must survive rowid gaps and WITHOUT ROWID composite keys.
// 4. BLOBs arrive from D1 as byte arrays and must land as bytes.
// 5. FTS shadow tables are skipped; the virtual table's own rows are copied.
// 6. A failed run leaves no file that looks finished.
// 7. The finished file is verified: integrity_check and per-table row counts.
// 8. Retention deletes old dumps but always keeps the newest two.
// 9. A run that reads more than its ceiling aborts.

function fakeRemote(setup) {
  const db = new DatabaseSync(":memory:")
  db.exec(setup)
  let reads = 0
  const query = async (sql, params = []) => {
    const stmt = db.prepare(sql)
    const rows = stmt
      .all(...params)
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? [...v] : v]),
        ),
      )
    reads += Math.max(rows.length, 1)
    return { results: rows, meta: { rows_read: Math.max(rows.length, 1) } }
  }
  return { db, query, reads: () => reads }
}

const SCHEMA = `
  CREATE TABLE genes (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, art BLOB);
  CREATE INDEX idx_genes_symbol ON genes(symbol);
  CREATE TABLE votes (gene TEXT, voter TEXT, v INTEGER, PRIMARY KEY (gene, voter)) WITHOUT ROWID;
  CREATE VIRTUAL TABLE search USING fts5(name);
  CREATE VIEW gene_count AS SELECT count(*) AS n FROM genes;
`

function seed(remote) {
  const ins = remote.db.prepare("INSERT INTO genes (id, symbol, art) VALUES (?, ?, ?)")
  for (let i = 1; i <= 25; i++) ins.run(i * 7, `G${i}`, new Uint8Array([i, 0, 255]))
  const vote = remote.db.prepare("INSERT INTO votes VALUES (?, ?, ?)")
  for (let i = 0; i < 13; i++) vote.run(`G${i % 4}`, `u${i}`, i)
  remote.db.exec("INSERT INTO search (name) VALUES ('tumor protein'), ('kinase')")
}

test("3,4,5,7: pages gaps and composite keys, keeps bytes, copies FTS rows, verifies", async () => {
  const remote = fakeRemote(SCHEMA)
  seed(remote)
  const dir = mkdtempSync(path.join(tmpdir(), "d1bk-"))
  const out = path.join(dir, "x.sqlite")
  const report = await exportD1Database({ query: remote.query, outFile: out, pageSize: 4 })
  const local = new DatabaseSync(out)
  assert.equal(local.prepare("SELECT count(*) n FROM genes").get().n, 25)
  assert.deepEqual([...local.prepare("SELECT art FROM genes WHERE id = 21").get().art], [3, 0, 255])
  assert.equal(local.prepare("SELECT count(*) n FROM votes").get().n, 13)
  assert.equal(
    local.prepare("SELECT count(*) n FROM search WHERE search MATCH 'kinase'").get().n,
    1,
  )
  assert.equal(local.prepare("SELECT n FROM gene_count").get().n, 25)
  assert.ok(local.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_genes_symbol'").get())
  assert.equal(report.tables.genes, 25)
  assert.ok(!("search_data" in report.tables), "FTS shadow tables are not exported")
  assert.equal(report.integrity, "ok")
  local.close()
})

test("9: a run that exceeds its read ceiling aborts and leaves no finished file", async () => {
  const remote = fakeRemote(SCHEMA)
  seed(remote)
  const dir = mkdtempSync(path.join(tmpdir(), "d1bk-"))
  const out = path.join(dir, "x.sqlite")
  await assert.rejects(
    exportD1Database({ query: remote.query, outFile: out, pageSize: 4, readCeiling: 10 }),
    /D1_BACKUP_READ_CEILING/,
  )
  assert.equal(existsSync(out), false)
})

test("1,2,6: the budget gate fails closed and a finished day is not exported twice", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "d1bk-"))
  const remote = fakeRemote(SCHEMA)
  seed(remote)
  const base = {
    root: dir,
    now: Date.parse("2026-09-25T01:00:00Z"),
    queryFor: () => remote.query,
    pageSize: 50,
  }
  const busy = await runRotation({ ...base, readUsage: async () => ({ rows_read: 1600000 }) })
  assert.equal(busy.status, "skipped_budget")
  const broken = await runRotation({
    ...base,
    readUsage: async () => {
      throw new Error("graphql down")
    },
  })
  assert.equal(broken.status, "skipped_budget_unknown")
  const done = await runRotation({ ...base, readUsage: async () => ({ rows_read: 1000 }) })
  assert.equal(done.status, "exported")
  assert.match(done.file, /\.sqlite\.gz$/)
  const again = await runRotation({ ...base, readUsage: async () => ({ rows_read: 1000 }) })
  assert.equal(again.status, "already_done")
  const files = readdirSync(path.dirname(done.file))
  assert.ok(files.every((f) => !f.includes(".partial")))
})

test("rotation visits every database once per cycle", () => {
  const day = Date.parse("2026-09-25T01:00:00Z")
  const seen = new Set()
  for (let i = 0; i < BACKUP_ROTATION.length; i++)
    seen.add(rotationDatabase(day + i * 86400000).name)
  assert.equal(seen.size, BACKUP_ROTATION.length)
})

test("8: retention drops dumps older than 30 days but keeps the newest two", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "d1bk-"))
  const now = Date.parse("2026-09-25T00:00:00Z")
  for (const [name, age] of [
    ["a", 80],
    ["b", 60],
    ["c", 45],
    ["d", 5],
  ]) {
    const f = path.join(dir, `${name}.sqlite.gz`)
    writeFileSync(f, "x")
    const t = (now - age * 86400000) / 1000
    utimesSync(f, t, t)
  }
  pruneBackups(dir, { now, keepDays: 30, keepNewest: 2 })
  assert.deepEqual(readdirSync(dir).sort(), ["c.sqlite.gz", "d.sqlite.gz"])
})
