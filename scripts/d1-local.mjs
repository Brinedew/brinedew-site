// B-1002: the default tool for investigating production D1 data.
//
//   node scripts/d1-local.mjs <database> "<sql>" [--json]
//
// It answers from the newest nightly dump that scripts/backup-d1-rotation.mjs
// leaves in D:\Backups\brinedew-d1\<database>\ (override the folder with
// D1_BACKUP_ROOT). That is a copy up to about five days old, so every answer
// starts with the dump's date, and it costs nothing on Cloudflare: no row of
// the free plan's 5M-a-day D1 read allowance is touched. Agents have no
// production D1 credential on purpose (B-998: one hand-run query read
// 4,287,688 rows, 86% of a day); this is where they look instead.
//
// How it stays harmless:
// - Only SELECT, EXPLAIN, PRAGMA and WITH ... SELECT run, one statement at a
//   time. The checker reads SQL tokens, so "DELETE" inside a string or a
//   comment is fine and a DELETE behind a WITH or a ";" is refused.
// - The unpacked copy is opened read-only with query_only on. That is the real
//   guard; the checker only makes the refusal say why.
// - The dump is gunzipped once into the OS temp directory, named by the sha256
//   in its manifest, and reused until a newer dump replaces it. The gz is
//   hashed while it is unpacked, so a dump that does not match its manifest
//   never becomes a cached copy.
import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import { createGunzip } from "node:zlib"
import { DatabaseSync } from "node:sqlite"

export const DEFAULT_BACKUP_ROOT = "D:\\Backups\\brinedew-d1"
export const MAX_ROWS = 1000
export const MAX_CELL_CHARS = 2000

const DAY_MS = 86_400_000
const DUMP_FILE = /^(\d{4}-\d{2}-\d{2})\.sqlite\.gz$/
const DATABASE_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/
const STALE_PARTIAL_MS = 60 * 60_000
const MAIN_STATEMENTS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "REPLACE", "VALUES"])

// A request this tool will not run. The command line exits 2 for it, 1 for anything else.
export class D1LocalRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = "D1LocalRefusal"
  }
}

const refuse = (message) => new D1LocalRefusal(message)

// Reads SQL the way SQLite does for this purpose: strings, quoted names and
// comments are skipped, so only real keywords are left. Returns the unquoted
// words with their parenthesis depth, and whether a "=" sits at depth 0.
// More than one statement is refused here.
function scanStatement(sql) {
  const words = []
  const n = sql.length
  let depth = 0
  let ended = false
  let assignment = false
  let i = 0
  const token = () => {
    if (ended) throw refuse("One statement at a time: this tool reads, it does not run scripts.")
  }
  while (i < n) {
    const c = sql[i]
    if (/\s/.test(c)) {
      i++
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i)
      i = end === -1 ? n : end + 1
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2)
      if (end === -1) throw refuse("Unterminated /* comment.")
      i = end + 2
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      token()
      const close = c === "[" ? "]" : c
      let j = i + 1
      for (;;) {
        if (j >= n) throw refuse(`Unterminated ${c} quote.`)
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      i = j + 1
    } else if (c === ";") {
      ended = true
      i++
    } else if (/[A-Za-z_]/.test(c)) {
      token()
      let j = i + 1
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++
      words.push({ word: sql.slice(i, j).toUpperCase(), depth })
      i = j
    } else if (/[0-9]/.test(c)) {
      token()
      let j = i + 1
      while (j < n && /[0-9A-Za-z_.]/.test(sql[j])) j++
      i = j
    } else {
      token()
      if (c === "(") {
        depth++
      } else if (c === ")") {
        if (--depth < 0) throw refuse("Unbalanced parenthesis.")
      } else if (c === "=" && depth === 0) {
        assignment = true
      }
      i++
    }
  }
  return { words, assignment }
}

export function assertReadOnlyStatement(sql) {
  const { words, assignment } = scanStatement(String(sql ?? ""))
  const first = words[0]?.word
  if (!first) throw refuse("Give one SELECT, EXPLAIN, PRAGMA or WITH ... SELECT statement.")
  if (first === "SELECT" || first === "EXPLAIN") return
  if (first === "PRAGMA") {
    if (assignment) throw refuse("PRAGMA that sets a value is refused: this tool only reads.")
    return
  }
  if (first === "WITH") {
    const main = words.find((entry) => entry.depth === 0 && MAIN_STATEMENTS.has(entry.word))
    if (main?.word === "SELECT") return
    throw refuse(
      `WITH must end in SELECT; this one ends in ${main?.word ?? "nothing"}. This tool only reads.`,
    )
  }
  throw refuse(`This tool only reads (SELECT, EXPLAIN, PRAGMA, WITH ... SELECT); got ${first}.`)
}

function availableDatabases(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

// The newest dump that is complete: the gz and its manifest both exist. A gz
// without a manifest is still being written (the exporter writes the manifest
// last), and "*.partial" never matches.
export function findNewestDump({ root, database }) {
  const known = availableDatabases(root)
  const listing = known.length
    ? `Databases with dumps: ${known.join(", ")}.`
    : `No dumps under ${root}.`
  if (!DATABASE_NAME.test(String(database ?? ""))) {
    throw refuse(`"${database}" is not a database name. ${listing}`)
  }
  const dir = path.join(root, database)
  if (!existsSync(dir)) throw refuse(`No dumps for "${database}". ${listing}`)
  const date = readdirSync(dir)
    .map((name) => DUMP_FILE.exec(name)?.[1])
    .filter((day) => day && existsSync(path.join(dir, `${day}.json`)))
    .sort()
    .at(-1)
  if (!date)
    throw refuse(`"${database}" has no complete dump (a .sqlite.gz with its .json) in ${dir}.`)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, `${date}.json`), "utf8"))
  } catch {
    throw refuse(`The manifest ${date}.json for "${database}" is not readable JSON.`)
  }
  const sha256 = String(manifest?.sha256 ?? "").toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw refuse(`The manifest ${date}.json has no sha256.`)
  return { database, date, sha256, gz: path.join(dir, `${date}.sqlite.gz`) }
}

function pruneCache(cacheDir, database, keep, now) {
  // "iconoplasm" and "iconoplasm-authoring" share a prefix, so match the whole name.
  const mine = new RegExp(`^${database}-[0-9a-f]{64}\\.sqlite(\\.\\d+\\.partial)?$`)
  for (const name of readdirSync(cacheDir)) {
    if (!mine.test(name) || name === keep) continue
    const file = path.join(cacheDir, name)
    try {
      // A partial file of a run that is still writing has a fresh time; leave it alone.
      if (name.endsWith(".partial") && now - statSync(file).mtimeMs < STALE_PARTIAL_MS) continue
      rmSync(file, { force: true })
    } catch {
      // Another process has it open. The next run prunes it.
    }
  }
}

// The unpacked copy of a dump, made once. Returns its path.
export async function unpackDump(dump, cacheDir, { now = Date.now(), log = () => {} } = {}) {
  mkdirSync(cacheDir, { recursive: true })
  const name = `${dump.database}-${dump.sha256}.sqlite`
  const final = path.join(cacheDir, name)
  if (existsSync(final)) return final
  log(`# unpacking ${dump.database} ${dump.date} into ${cacheDir} (once per dump)`)
  const partial = `${final}.${process.pid}.partial`
  const hash = createHash("sha256")
  try {
    await pipeline(
      createReadStream(dump.gz),
      new Transform({
        transform(chunk, _encoding, done) {
          hash.update(chunk)
          done(null, chunk)
        },
      }),
      createGunzip(),
      createWriteStream(partial),
    )
    if (hash.digest("hex") !== dump.sha256) {
      throw refuse(`${dump.gz} does not match the sha256 in its manifest; not using it.`)
    }
    try {
      renameSync(partial, final)
    } catch (error) {
      // Another run finished the same dump first and has it open.
      if (!existsSync(final)) throw error
    }
  } finally {
    rmSync(partial, { force: true })
  }
  pruneCache(cacheDir, dump.database, name, now)
  return final
}

function plain(value) {
  if (typeof value === "bigint") {
    const number = Number(value)
    return Number.isSafeInteger(number) ? number : value.toString()
  }
  if (value instanceof Uint8Array) {
    const head = Buffer.from(value.subarray(0, 16)).toString("hex")
    return `<blob ${value.length} bytes ${head}${value.length > 16 ? "..." : ""}>`
  }
  if (typeof value === "string" && value.length > MAX_CELL_CHARS) {
    return `${value.slice(0, MAX_CELL_CHARS)}...[+${value.length - MAX_CELL_CHARS} chars]`
  }
  return value
}

function runOnCopy(file, sql) {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec("PRAGMA query_only = ON")
    const statement = db.prepare(sql)
    statement.setReadBigInts(true)
    const rows = []
    let truncated = false
    for (const row of statement.iterate()) {
      if (rows.length >= MAX_ROWS) {
        truncated = true
        break
      }
      rows.push(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)])))
    }
    const columns =
      typeof statement.columns === "function"
        ? statement.columns().map((column) => column.name)
        : Object.keys(rows[0] ?? {})
    return { columns, rows, truncated }
  } finally {
    db.close()
  }
}

export function dumpDescription(dump, now = Date.now()) {
  const ageDays = Math.max(0, Math.floor((now - Date.parse(`${dump.date}T00:00:00Z`)) / DAY_MS))
  return {
    database: dump.database,
    date: dump.date,
    age_days: ageDays,
    sha256: dump.sha256,
    live: false,
  }
}

export function dumpBanner(description) {
  const days = description.age_days
  return (
    `# NOT LIVE DATA: ${description.database} nightly dump of ${description.date} ` +
    `(${days} day${days === 1 ? "" : "s"} old), sha256 ${description.sha256.slice(0, 12)}`
  )
}

// Everything the command line does, minus printing. Refuses before it touches
// the dump when the statement writes.
export async function d1Local({
  database,
  sql,
  root = process.env.D1_BACKUP_ROOT || DEFAULT_BACKUP_ROOT,
  cacheDir = path.join(tmpdir(), "brinedew-d1-local"),
  now = Date.now(),
  log = () => {},
}) {
  assertReadOnlyStatement(sql)
  const dump = findNewestDump({ root, database })
  const description = dumpDescription(dump, now)
  log(dumpBanner(description))
  const file = await unpackDump(dump, cacheDir, { now, log })
  return { dump: description, ...runOnCopy(file, sql) }
}

// One row per line, tab separated: a tab or newline inside a value prints as \t or \n.
const cell = (value) =>
  value === null ? "NULL" : String(value).replace(/\t/g, "\\t").replace(/\r?\n/g, "\\n")

function formatText(result) {
  const lines = [result.columns.join("\t")]
  for (const row of result.rows)
    lines.push(result.columns.map((name) => cell(row[name])).join("\t"))
  lines.push(
    result.truncated
      ? `# first ${MAX_ROWS} rows only (more matched): narrow it with WHERE or LIMIT, or aggregate`
      : `# ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`,
  )
  return lines.join("\n")
}

const USAGE = `Usage: node scripts/d1-local.mjs <database> "<sql>" [--json]
Reads the newest nightly dump of a production D1 database (SELECT, EXPLAIN, PRAGMA, WITH ... SELECT only).
Databases: the folders under ${process.env.D1_BACKUP_ROOT || DEFAULT_BACKUP_ROOT}.`

export async function main(argv) {
  const json = argv.includes("--json")
  const args = argv.filter((arg) => arg !== "--json")
  if (args.length !== 2 || args.some((arg) => arg.startsWith("--"))) {
    console.error(USAGE)
    return 2
  }
  const [database, sql] = args
  // Text mode prints the dump line on stdout first; JSON keeps stdout valid JSON and carries
  // the same facts in its "dump" key, with the line on stderr for whoever reads that.
  const log = (line) => (json || line.startsWith("# unpacking") ? console.error : console.log)(line)
  try {
    const result = await d1Local({ database, sql, log })
    if (json) {
      const { dump, columns, rows, truncated } = result
      console.log(JSON.stringify({ dump, columns, rows, row_count: rows.length, truncated }))
    } else {
      console.log(formatText(result))
    }
    return 0
  } catch (error) {
    console.error(
      error instanceof D1LocalRefusal ? error.message : `d1-local failed: ${error.message}`,
    )
    return error instanceof D1LocalRefusal ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
