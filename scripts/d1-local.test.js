import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { gzipSync } from "node:zlib"

import { D1LocalRefusal, d1Local } from "./d1-local.mjs"

// B-1002 failure list, written before scripts/d1-local.mjs:
// 1. Any statement that writes (INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, ATTACH, VACUUM,
//    REPLACE, BEGIN, PRAGMA ... = ...) must be refused, and the unpacked copy stays byte-identical.
// 2. A write hidden behind a read must be refused: a second statement after ";", a comment
//    that looks like a SELECT, a WITH whose main statement is a DELETE or INSERT.
// 3. The refusal must not be a keyword grep: a read that merely mentions DROP or DELETE in a
//    string, a quoted identifier or a comment still runs.
// 4. A write the checker cannot see must still fail, because the copy is opened read-only.
// 5. Output starts with the dump's date and says it is not live data, in text and in JSON.
// 6. The newest dump is chosen by the date in its name, not by file time; a dump without its
//    manifest (still being written) and a .partial file are never chosen.
// 7. The gunzip happens once per dump: a second run reuses the cached copy untouched.
// 8. A dump whose bytes do not match the manifest sha256, or a truncated one, is refused and
//    leaves no file in the cache that looks finished.
// 9. A new dump replaces the cached copy of the older one for the same database only
//    ("iconoplasm" must not delete the copy of "iconoplasm-authoring").
// 10. A database name that is not a plain name (path traversal) or has no dump is refused and
//     the refusal lists the databases that do have dumps.
// 11. A result of 1,000+ rows is cut at 1,000 and says so; one huge text cell is cut too.
// 12. BLOBs, NULLs and integers past 2^53 print without throwing or losing digits.

const SCRIPT = fileURLToPath(new URL("./d1-local.mjs", import.meta.url))
const BIG = "9007199254740993" // 2^53 + 1

let work
let root
let cacheDir

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

// A real SQLite file, gzipped exactly the way scripts/backup-d1-rotation.mjs stores a dump.
function writeDump(database, date, setup, { manifest = true, bytes } = {}) {
  const dir = path.join(root, database)
  mkdirSync(dir, { recursive: true })
  let gz = bytes
  if (!gz) {
    const file = path.join(work, `${database}-${date}.sqlite`)
    const db = new DatabaseSync(file)
    db.exec(setup)
    db.close()
    gz = gzipSync(readFileSync(file))
    rmSync(file)
  }
  const gzPath = path.join(dir, `${date}.sqlite.gz`)
  writeFileSync(gzPath, gz)
  if (manifest) {
    writeFileSync(
      path.join(dir, `${date}.json`),
      JSON.stringify({ database, date, bytes: gz.length, sha256: sha256(gz) }),
    )
  }
  return { gzPath, sha256: sha256(gz), bytes: gz }
}

const NEW_DUMP = `
  CREATE TABLE genes (id INTEGER PRIMARY KEY, symbol TEXT, votes INTEGER, art BLOB, note TEXT);
  INSERT INTO genes VALUES (1, 'TP53', 5, x'0102ff', NULL);
  INSERT INTO genes VALUES (2, 'BRCA1', ${BIG}, NULL, 'a' || char(9) || 'b');
  INSERT INTO genes VALUES (3, 'PRL', 0, NULL, replace(hex(zeroblob(2500)), '0', 'z'));
  CREATE TABLE numbers (n INTEGER PRIMARY KEY);
  WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 1500)
    INSERT INTO numbers SELECT n FROM c;
`
const OLD_DUMP = `
  CREATE TABLE genes (id INTEGER PRIMARY KEY, symbol TEXT, votes INTEGER, art BLOB, note TEXT);
  INSERT INTO genes VALUES (1, 'OLD', 1, NULL, NULL);
`

function cacheFiles() {
  return existsSync(cacheDir) ? readdirSync(cacheDir).sort() : []
}

function cachedCopy(database, sha) {
  return path.join(cacheDir, `${database}-${sha}.sqlite`)
}

const NOW = Date.parse("2026-10-04T10:00:00Z")
const run = (database, sql, extra = {}) =>
  d1Local({ database, sql, root, cacheDir, now: NOW, ...extra })

let newest

before(() => {
  work = mkdtempSync(path.join(tmpdir(), "d1local-test-"))
  root = path.join(work, "backups")
  cacheDir = path.join(work, "cache")
  mkdirSync(root, { recursive: true })
  const older = writeDump("fixturedb", "2026-09-20", OLD_DUMP)
  newest = writeDump("fixturedb", "2026-09-29", NEW_DUMP)
  // The older dump gets the newer file time: the date in the name decides (6).
  utimesSync(older.gzPath, new Date("2026-10-03T00:00:00Z"), new Date("2026-10-03T00:00:00Z"))
  utimesSync(newest.gzPath, new Date("2026-09-29T20:00:00Z"), new Date("2026-09-29T20:00:00Z"))
  // A later dump still being written: gz present, manifest not yet (6).
  writeDump("fixturedb", "2026-10-02", null, {
    manifest: false,
    bytes: Buffer.from("not finished"),
  })
  writeFileSync(path.join(root, "fixturedb", "2026-10-03.sqlite.gz.partial"), "x")
})

after(() => rmSync(work, { recursive: true, force: true }))

test("5,6: text output starts with the dump date and rows come from the newest complete dump", () => {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, "fixturedb", "SELECT symbol FROM genes ORDER BY id"],
    {
      encoding: "utf8",
      env: { ...process.env, D1_BACKUP_ROOT: root, TMPDIR: work, TEMP: work, TMP: work },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trimEnd().split("\n")
  assert.match(lines[0], /^# NOT LIVE DATA: fixturedb nightly dump of 2026-09-29 \(\d+ days? old\)/)
  assert.deepEqual(lines.slice(1, 5), ["symbol", "TP53", "BRCA1", "PRL"])
  assert.match(lines.at(-1), /^# 3 rows/)
})

test("5,12: --json puts the dump first and prints blobs, nulls and huge integers safely", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "fixturedb",
      "SELECT symbol, votes, art, note FROM genes WHERE id <= 2 ORDER BY id",
      "--json",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, D1_BACKUP_ROOT: root, TMPDIR: work, TEMP: work, TMP: work },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.equal(Object.keys(parsed)[0], "dump")
  assert.equal(parsed.dump.date, "2026-09-29")
  assert.equal(parsed.dump.live, false)
  assert.deepEqual(parsed.columns, ["symbol", "votes", "art", "note"])
  assert.deepEqual(parsed.rows, [
    { symbol: "TP53", votes: 5, art: "<blob 3 bytes 0102ff>", note: null },
    { symbol: "BRCA1", votes: BIG, art: null, note: "a\tb" },
  ])
  assert.equal(parsed.truncated, false)
})

test("1,2: every statement that writes is refused and the unpacked copy is unchanged", async () => {
  await run("fixturedb", "SELECT 1")
  const copy = cachedCopy("fixturedb", newest.sha256)
  const before = sha256(readFileSync(copy))
  const writes = [
    "INSERT INTO genes (symbol) VALUES ('X')",
    "UPDATE genes SET votes = 0",
    "DELETE FROM genes",
    "DROP TABLE genes",
    "CREATE TABLE t (a)",
    "ALTER TABLE genes ADD COLUMN x",
    "ATTACH DATABASE ':memory:' AS m",
    "VACUUM",
    "REPLACE INTO genes (id, symbol) VALUES (1, 'X')",
    "BEGIN",
    "PRAGMA user_version = 9",
    "SELECT 1; DROP TABLE genes",
    "SELECT 1;DELETE FROM genes",
    "SELECT 1 /* ; */ ; DELETE FROM genes;",
    "/* SELECT */ DELETE FROM genes",
    "-- select\nDELETE FROM genes",
    "WITH t AS (SELECT 1) DELETE FROM genes",
    "WITH RECURSIVE t(n) AS (SELECT 1) INSERT INTO genes (symbol) SELECT 'X' FROM t",
    "SELECT 'unterminated",
    "",
  ]
  for (const sql of writes) {
    await assert.rejects(run("fixturedb", sql), D1LocalRefusal, `must refuse: ${sql}`)
  }
  assert.equal(sha256(readFileSync(copy)), before)
  assert.equal((await run("fixturedb", "SELECT count(*) AS n FROM genes")).rows[0].n, 3)
})

test("3: reads that only mention write keywords still run", async () => {
  const reads = [
    "SELECT 'DROP TABLE genes; DELETE FROM genes' AS note",
    'SELECT symbol AS "delete" FROM genes',
    "SELECT 1 -- ; DROP TABLE genes",
    "SELECT 1 /* DELETE */",
    "WITH t AS (SELECT 1 AS n) SELECT n FROM t",
    "EXPLAIN QUERY PLAN SELECT * FROM genes WHERE id = 1",
    "PRAGMA table_info(genes)",
    "SELECT symbol FROM genes WHERE id = 1;",
  ]
  for (const sql of reads) {
    const result = await run("fixturedb", sql)
    assert.ok(Array.isArray(result.rows), sql)
  }
  assert.equal((await run("fixturedb", "PRAGMA table_info(genes)")).rows.length, 5)
})

test("4: a write the checker lets through still fails on the read-only copy", async () => {
  const copy = cachedCopy("fixturedb", newest.sha256)
  const before = sha256(readFileSync(copy))
  await assert.rejects(run("fixturedb", "PRAGMA user_version(7)"), (error) => {
    assert.ok(!(error instanceof D1LocalRefusal))
    assert.match(String(error.message), /readonly|read-only|read only/i)
    return true
  })
  assert.equal(sha256(readFileSync(copy)), before)
})

test("7: the dump is unpacked once and the cached copy is reused untouched", async () => {
  await run("fixturedb", "SELECT 1")
  const copy = cachedCopy("fixturedb", newest.sha256)
  const first = statSync(copy)
  await run("fixturedb", "SELECT symbol FROM genes")
  const second = statSync(copy)
  assert.equal(second.mtimeMs, first.mtimeMs)
  assert.equal(second.ino, first.ino)
  assert.deepEqual(
    cacheFiles().filter((name) => name.startsWith("fixturedb-")),
    [`fixturedb-${newest.sha256}.sqlite`],
  )
})

test("8: a dump that does not match its manifest, or is truncated, leaves no cached copy", async () => {
  const good = writeDump("baddb", "2026-09-29", OLD_DUMP)
  writeFileSync(
    path.join(root, "baddb", "2026-09-29.json"),
    JSON.stringify({ sha256: "0".repeat(64) }),
  )
  await assert.rejects(run("baddb", "SELECT 1"), /sha256/)
  assert.deepEqual(
    cacheFiles().filter((name) => name.startsWith("baddb-")),
    [],
  )

  const cut = good.bytes.subarray(0, Math.floor(good.bytes.length / 2))
  writeDump("cutdb", "2026-09-29", null, { bytes: cut })
  await assert.rejects(run("cutdb", "SELECT 1"))
  assert.deepEqual(
    cacheFiles().filter((name) => name.startsWith("cutdb-")),
    [],
  )
})

test("9: a new dump replaces the cached copy of the older one for that database only", async () => {
  const first = writeDump("iconoplasm", "2026-09-20", OLD_DUMP)
  const neighbour = writeDump("iconoplasm-authoring", "2026-09-20", OLD_DUMP)
  await run("iconoplasm", "SELECT 1")
  await run("iconoplasm-authoring", "SELECT 1")
  assert.ok(existsSync(cachedCopy("iconoplasm", first.sha256)))

  const second = writeDump("iconoplasm", "2026-09-27", NEW_DUMP)
  await run("iconoplasm", "SELECT 1")
  assert.ok(existsSync(cachedCopy("iconoplasm", second.sha256)))
  assert.equal(existsSync(cachedCopy("iconoplasm", first.sha256)), false)
  assert.ok(existsSync(cachedCopy("iconoplasm-authoring", neighbour.sha256)))
})

test("10: a database without dumps, or with an unsafe name, is refused and the refusal lists what exists", async () => {
  for (const name of ["nope", "../fixturedb", "fixturedb/..", "FIXTUREDB", ""]) {
    await assert.rejects(run(name, "SELECT 1"), (error) => {
      assert.ok(error instanceof D1LocalRefusal, name)
      assert.match(error.message, /fixturedb/, name)
      return true
    })
  }
})

test("11: a long result is cut at 1,000 rows and a huge cell is cut, both said out loud", async () => {
  const rows = await run("fixturedb", "SELECT n FROM numbers ORDER BY n")
  assert.equal(rows.rows.length, 1000)
  assert.equal(rows.truncated, true)
  const cell = await run("fixturedb", "SELECT note FROM genes WHERE id = 3")
  assert.match(cell.rows[0].note, /\.\.\.\[\+\d+ chars\]$/)
  assert.ok(cell.rows[0].note.length < 2100)
  const text = spawnSync(
    process.execPath,
    [SCRIPT, "fixturedb", "SELECT n FROM numbers ORDER BY n"],
    {
      encoding: "utf8",
      env: { ...process.env, D1_BACKUP_ROOT: root, TMPDIR: work, TEMP: work, TMP: work },
    },
  )
  assert.match(text.stdout.trimEnd().split("\n").at(-1), /^# first 1000 rows only/)
})

test("1: the command line refuses a write with exit code 2 and prints why", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "fixturedb", "DELETE FROM genes"], {
    encoding: "utf8",
    env: { ...process.env, D1_BACKUP_ROOT: root, TMPDIR: work, TEMP: work, TMP: work },
  })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /only reads/i)
  assert.equal(result.stdout.includes("DELETE"), false)
})
