// Failure modes of the budgeted-backup lane in the D1 statement burn watch,
// written before the code:
// 1. A backup page statement under the ceiling passes, even when it alone is
//    far over the 125,000-read per-statement cap, and its reads still show up
//    in the report's budgeted_backup section.
// 2. Backup statements whose window total is above the ceiling fail the run.
// 3. An ordinary statement over 125,000 still fails, also when a budgeted
//    backup ran in the same window.
// 4. A statement that only resembles the backup is not exempted: __bk_rowid
//    inside an unrelated query, an extra predicate, unquoted keyset paging,
//    mismatched keys or placeholders, or the unkeyed first page.
// 5. The matcher drifts from what the backup sends: every paging statement the
//    real exporter emits (rowid tables, INTEGER PRIMARY KEY, WITHOUT ROWID
//    composite keys, quoted names, FTS) must be recognised in the raw
//    multi-line text D1 analytics groups by, and nothing else it sends may be.
// 6. A broken ceiling setting watches nothing instead of failing closed.
import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { exportD1Database } from "./backup-d1-rotation.mjs"
import {
  BUDGETED_BACKUP_READ_CEILING,
  budgetedBackupBurn,
  isBudgetedBackupStatement,
  statementBurnViolations,
  statementBurnWindow,
} from "./check-iconoplasm-d1-statement-burns.mjs"

const AUDIT_DB = "43f485e3-a933-4345-b2f4-7c5ec1aaee6f"
const ICONOPLASM_DB = "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff"
const GENEGUESSR_DB = "c213abba-394b-42e0-ba15-a1b179cbe7db"

const row = (databaseId, query, reads, returned = reads) => ({
  dimensions: { databaseId, query },
  sum: { rowsRead: reads, rowsReturned: returned },
})

// The exact text backup-d1-rotation.mjs sends for a rowid table, newline and
// indentation included.
const rowidPage = (table) =>
  `SELECT rowid AS __bk_rowid, * FROM "${table}"\n             WHERE rowid > ? ORDER BY rowid LIMIT ?`

// Run 37008389811 (2026-10-02 12:43Z): the nightly iconoplasm-audit export,
// 301,505 rows copied, reported by D1 analytics as 315,505 reads.
const AUDIT_BACKUP = row(AUDIT_DB, rowidPage("icono_publish_events"), 315505)

// Run 36970365248 (2026-10-02 05:45Z): a GeneGuessr daily-pool scan.
const GENEGUESSR_SCAN = row(
  GENEGUESSR_DB,
  "SELECT p.uniprot, p.gene_surname FROM proteins p WHERE p.structure_source IS NOT NULL AND LOWER(TRIM(p.structure_source)) <> 'alphafold' AND p.gene_summary IS NOT NULL ORDER BY p.gene_surname ASC, p.uniprot ASC",
  264798,
  92808,
)

const window = statementBurnWindow({ now: Date.parse("2026-10-02T12:44:00Z"), hours: 6 })

test("1: a backup page under the ceiling passes and is still reported", () => {
  assert.equal(window.cap, 125000)
  assert.ok(AUDIT_BACKUP.sum.rowsRead > window.cap)
  assert.deepEqual(
    statementBurnViolations([AUDIT_BACKUP, row(AUDIT_DB, "SELECT 1", 40)], window),
    [],
  )
  const backup = budgetedBackupBurn([AUDIT_BACKUP, row(AUDIT_DB, "SELECT 1", 40)])
  assert.equal(backup.ok, true)
  assert.equal(backup.reads, 315505)
  assert.equal(backup.ceiling, BUDGETED_BACKUP_READ_CEILING)
  assert.equal(backup.statements.length, 1)
  assert.equal(backup.statements[0].database_id, AUDIT_DB)
  assert.match(
    backup.statements[0].query,
    /^SELECT rowid AS __bk_rowid, \* FROM "icono_publish_events" WHERE/,
  )
})

test("1: the ceiling covers the largest measured export with room to grow", () => {
  // Largest measured export: iconoplasm, 571,897 reads (2026-09-29).
  assert.ok(BUDGETED_BACKUP_READ_CEILING >= 571897 * 1.5)
  assert.ok(BUDGETED_BACKUP_READ_CEILING <= 5_000_000 * 0.2)
})

test("2: backup statements above the ceiling fail the run", () => {
  // A failed iconoplasm export retried two hours later inside one window:
  // 2 x 571,897 measured reads, spread over its biggest tables.
  const retried = [
    row(ICONOPLASM_DB, rowidPage("icono_caretaker_candidate_eligibility_events"), 123214),
    row(ICONOPLASM_DB, rowidPage("icono_portrait_assets"), 118440),
    row(ICONOPLASM_DB, rowidPage("icono_storage_audit_queue"), 99924),
    row(ICONOPLASM_DB, rowidPage("icono_everything_else"), 802216),
  ]
  const backup = budgetedBackupBurn(retried)
  assert.equal(backup.reads, 1143794)
  assert.equal(backup.ok, false)
  const violations = statementBurnViolations(retried, window)
  assert.equal(violations.length, 4)
  assert.ok(violations.every((v) => v.budget === "budgeted_backup"))
  assert.deepEqual(
    violations.map((v) => v.reads),
    [123214, 118440, 99924, 802216],
  )

  const atCeiling = [row(AUDIT_DB, rowidPage("a"), BUDGETED_BACKUP_READ_CEILING)]
  assert.deepEqual(statementBurnViolations(atCeiling, window), [])
  const overByOne = [
    row(AUDIT_DB, rowidPage("a"), BUDGETED_BACKUP_READ_CEILING - 10),
    row(GENEGUESSR_DB, rowidPage("b"), 11),
  ]
  assert.equal(statementBurnViolations(overByOne, window).length, 2)
})

test("3: an ordinary statement over the cap still fails beside a budgeted backup", () => {
  const violations = statementBurnViolations([AUDIT_BACKUP, GENEGUESSR_SCAN], window)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].reads, 264798)
  assert.equal(violations[0].database_id, GENEGUESSR_DB)
  assert.equal(violations[0].budget, undefined)
  assert.equal(statementBurnViolations([row(ICONOPLASM_DB, "SELECT 1", 125000)], window).length, 1)
})

test("4: statements that only resemble the backup are not exempted", () => {
  const lookalikes = [
    `SELECT rowid AS __bk_rowid, * FROM "icono_publish_events" WHERE rowid > ? OR 1 = 1 ORDER BY rowid LIMIT ?`,
    `SELECT __bk_rowid FROM icono_publish_events`,
    `WITH t AS (SELECT rowid AS __bk_rowid, * FROM "a" WHERE rowid > ? ORDER BY rowid LIMIT ?) SELECT * FROM t JOIN b`,
    `SELECT rowid AS __bk_rowid, * FROM "a" WHERE rowid > ? ORDER BY rowid LIMIT ?; DELETE FROM b`,
    `SELECT rowid AS __bk_rowid, * FROM icono_publish_events WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    `select rowid as __bk_rowid, * from "a" where rowid > ? order by rowid limit ?`,
    // workers/iconoplasm/discovery-compact-migrate.js pages with unquoted keys.
    `SELECT * FROM icono_discovery_user_state_v2 WHERE (user_id, gene_symbol) > (?, ?) ORDER BY user_id, gene_symbol LIMIT ?`,
    `SELECT * FROM "votes" WHERE ("gene", "voter") > (?, ?) ORDER BY "created_at" LIMIT ?`,
    `SELECT * FROM "votes" WHERE ("gene", "voter") > (?) ORDER BY "gene", "voter" LIMIT ?`,
    `SELECT * FROM "votes" WHERE ("gene") > (?, ?) ORDER BY "gene" LIMIT ?`,
    // The unkeyed first page reads at most one page from a primary key, so it
    // never needs the lane; the same text on a non-key column is a full scan.
    `SELECT * FROM "icono_portrait_assets" ORDER BY "created_at" LIMIT ?`,
  ]
  for (const query of lookalikes) {
    assert.equal(isBudgetedBackupStatement(query), false, query)
    const violations = statementBurnViolations([row(ICONOPLASM_DB, query, 300000)], window)
    assert.equal(violations.length, 1, query)
    assert.equal(violations[0].budget, undefined, query)
  }
  assert.equal(isBudgetedBackupStatement(null), false)
  assert.equal(isBudgetedBackupStatement(""), false)
})

// Records every statement the real exporter sends to a fake D1, grouped by
// text the way d1QueriesAdaptiveGroups groups them.
async function recordedExport() {
  const remote = new DatabaseSync(":memory:")
  remote.exec(`
    CREATE TABLE icono_publish_events (event_id TEXT, payload TEXT);
    CREATE TABLE genes (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL);
    CREATE TABLE "odd ""name"", here" (v TEXT);
    CREATE TABLE routes (symbol TEXT PRIMARY KEY, target TEXT) WITHOUT ROWID;
    CREATE TABLE pairs ("a, b" TEXT, "c""d" TEXT, n INTEGER, PRIMARY KEY ("a, b", "c""d")) WITHOUT ROWID;
    CREATE VIRTUAL TABLE search USING fts5(name);
  `)
  for (let i = 0; i < 9; i++) {
    remote.prepare("INSERT INTO icono_publish_events VALUES (?, ?)").run(`e${i}`, "{}")
    remote.prepare("INSERT INTO genes VALUES (?, ?)").run(i * 5 + 1, `G${i}`)
    remote.prepare(`INSERT INTO "odd ""name"", here" VALUES (?)`).run(`v${i}`)
    remote.prepare("INSERT INTO routes VALUES (?, ?)").run(`S${i}`, `/g/${i}`)
    remote.prepare("INSERT INTO pairs VALUES (?, ?, ?)").run(`k${i % 3}`, `u${i}`, i)
    remote.prepare("INSERT INTO search (name) VALUES (?)").run(`protein ${i}`)
  }
  const pageSize = 4
  const calls = []
  const query = async (sql, params = []) => {
    const results = remote.prepare(sql).all(...params)
    calls.push({ sql, params, rows: results.length })
    return { results, meta: { rows_read: Math.max(results.length, 1) } }
  }
  const dir = mkdtempSync(path.join(tmpdir(), "d1burn-"))
  await exportD1Database({ query, outFile: path.join(dir, "x.sqlite"), pageSize })
  remote.close()
  const groups = new Map()
  for (const call of calls) {
    const group = groups.get(call.sql) || { sql: call.sql, reads: 0, page: false }
    group.reads += Math.max(call.rows, 1)
    // A keyed page carries a cursor before the page size.
    group.page ||= call.params.length >= 2 && call.params.at(-1) === pageSize
    groups.set(call.sql, group)
  }
  return [...groups.values()]
}

test("5: every keyed page the real exporter sends is recognised, nothing else is", async () => {
  const groups = await recordedExport()
  const pages = groups.filter((g) => g.page)
  for (const group of groups)
    assert.equal(isBudgetedBackupStatement(group.sql), group.page, group.sql)
  assert.ok(pages.some((g) => g.sql.includes("__bk_rowid") && g.sql.includes("\n")))
  assert.ok(pages.some((g) => g.sql.includes(`FROM "odd ""name"", here"`)))
  assert.ok(pages.some((g) => g.sql.includes(`FROM "search"`)))
  assert.ok(pages.some((g) => g.sql.includes(`WHERE ("symbol") > (?)`)))
  assert.ok(pages.some((g) => g.sql.includes(`WHERE ("a, b", "c""d") > (?, ?)`)))
  assert.equal(pages.length, 6)

  // With a per-statement cap of 1, every ordinary statement trips and no
  // backup page does; with a backup ceiling of 1, the pages trip too.
  const rows = groups.map((g) => row(AUDIT_DB, g.sql, g.reads))
  const ordinary = statementBurnViolations(rows, { cap: 1 })
  assert.equal(ordinary.length, groups.length - pages.length)
  assert.ok(ordinary.every((v) => !isBudgetedBackupStatement(v.query)))
  const tight = statementBurnViolations(rows, { cap: 1, backupCeiling: 1 })
  assert.equal(tight.length, groups.length)
  assert.equal(tight.filter((v) => v.budget === "budgeted_backup").length, pages.length)
})

test("6: an invalid backup ceiling fails closed", () => {
  for (const backupCeiling of [0, -1, Number.NaN, "lots"])
    assert.throws(
      () => statementBurnViolations([AUDIT_BACKUP], { cap: 125000, backupCeiling }),
      /D1_STATEMENT_BURN_BACKUP_CEILING_INVALID/,
    )
  assert.throws(() => budgetedBackupBurn([], { ceiling: 0 }), /BACKUP_CEILING_INVALID/)
})
