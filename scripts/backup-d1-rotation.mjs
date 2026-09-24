// B-830: nightly off-Cloudflare D1 backup, one database per night.
//
// Why not `wrangler d1 export`: it refuses databases with virtual tables
// (GeneGuessr's FTS5 search), and it blocks the database for the whole export.
// This copies each table in small keyset-paged SELECTs over the D1 HTTP API
// into a local SQLite file, so readers never wait behind one long statement.
//
// Why a rotation: an export reads every row, and D1 Free allows 5M row reads a
// day for the whole account. Measured 2026-09-25 (max(rowid) probes): about
// 874k rows in iconoplasm, 431k authoring, 298k audit, 700k geneguessr plus
// its FTS index. One database per night costs at most ~20% of the day's
// allowance, and the run refuses to start when readers already used 30%.
// D1 Time Travel (7 days on Free) covers point-in-time recovery between dumps.
//
// Not a point-in-time snapshot: tables are copied one after another over a few
// minutes. Use Time Travel for exact-moment restores; use this when Cloudflare
// itself (account, billing, deletion) is the thing that failed.
//
// Restore (rehearsed 2026-09-24 on iconoplasm-audit: 298,005 rows, 11.6 MB
// gzip, 53 s export, 0.3 s gunzip+open, integrity ok): gunzip
// D:\Backups\brinedew-d1\<db>\<date>.sqlite.gz, check the sha256 in the
// sibling .json, then `sqlite3 <file> .dump > restore.sql` and
// `wrangler d1 execute <db> --remote --file restore.sql` into a fresh database.
// Run it daily via scripts/Register-D1BackupTask.ps1; results append to
// D:\Backups\brinedew-d1\backup-log.jsonl.
import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  appendFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import { createGzip } from "node:zlib"
import { DatabaseSync } from "node:sqlite"

import { readAccountBudget } from "./lib/cloudflare-account-budget.mjs"

export const BACKUP_ROTATION = Object.freeze([
  { name: "iconoplasm", id: "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff" },
  { name: "iconoplasm-authoring", id: "1ac27eba-5a08-4d8a-b5b2-99ed4254abd0" },
  { name: "geneguessr", id: "c213abba-394b-42e0-ba15-a1b179cbe7db" },
  { name: "iconoplasm-audit", id: "43f485e3-a933-4345-b2f4-7c5ec1aaee6f" },
  {
    name: "iconoplasm-authority-event-archive-20260831",
    id: "7c867585-5535-4730-8b20-d6883aefd333",
  },
])

const DAILY_READ_CAP = 5_000_000
const DAY_MS = 86_400_000
const quote = (name) => `"${String(name).replaceAll('"', '""')}"`

export function rotationDatabase(now = Date.now()) {
  return BACKUP_ROTATION[Math.floor(now / DAY_MS) % BACKUP_ROTATION.length]
}

function toLocalValue(value) {
  // D1 returns BLOB columns as JSON arrays of byte values.
  return Array.isArray(value) ? Uint8Array.from(value) : value
}

export async function exportD1Database({
  query,
  outFile,
  pageSize = 2000,
  readCeiling = 2_000_000,
}) {
  const started = Date.now()
  const partial = `${outFile}.partial`
  rmSync(partial, { force: true })
  let reads = 0
  const remote = async (sql, params = []) => {
    const response = await query(sql, params)
    reads += Number(response?.meta?.rows_read || 0)
    if (reads > readCeiling) throw new Error(`D1_BACKUP_READ_CEILING ${reads} > ${readCeiling}`)
    return Array.isArray(response?.results) ? response.results : []
  }
  const local = new DatabaseSync(partial)
  try {
    const schema = await remote(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       ORDER BY rowid`,
    )
    const virtualNames = schema
      .filter((row) => row.type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql))
      .map((row) => row.name)
    const isShadow = (name) => virtualNames.some((vt) => name !== vt && name.startsWith(`${vt}_`))
    const tables = schema.filter((row) => row.type === "table" && !isShadow(row.name))
    for (const table of tables) local.exec(table.sql)

    const counts = {}
    for (const table of tables) {
      const columns = local.prepare(`PRAGMA table_info(${quote(table.name)})`).all()
      const pk = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
      const withoutRowid = /WITHOUT\s+ROWID/i.test(table.sql)
      const rowidAlias = pk.length === 1 && String(pk[0].type).toUpperCase() === "INTEGER"
      const names = columns.map((c) => c.name)
      let fetched = 0
      let cursor = null
      for (;;) {
        let rows
        if (withoutRowid) {
          const keys = pk.map((c) => quote(c.name)).join(", ")
          const where = cursor ? `WHERE (${keys}) > (${pk.map(() => "?").join(", ")})` : ""
          rows = await remote(
            `SELECT * FROM ${quote(table.name)} ${where} ORDER BY ${keys} LIMIT ?`,
            [...(cursor || []), pageSize],
          )
        } else {
          rows = await remote(
            `SELECT rowid AS __bk_rowid, * FROM ${quote(table.name)}
             WHERE rowid > ? ORDER BY rowid LIMIT ?`,
            [cursor ?? Number.MIN_SAFE_INTEGER, pageSize],
          )
        }
        if (!rows.length) break
        const insertColumns = withoutRowid || rowidAlias ? names : ["rowid", ...names]
        const insert = local.prepare(
          `INSERT INTO ${quote(table.name)} (${insertColumns.map(quote).join(", ")})
           VALUES (${insertColumns.map(() => "?").join(", ")})`,
        )
        local.exec("BEGIN")
        for (const row of rows) {
          insert.run(
            ...insertColumns.map((c) => toLocalValue(c === "rowid" ? row.__bk_rowid : row[c])),
          )
        }
        local.exec("COMMIT")
        fetched += rows.length
        const last = rows[rows.length - 1]
        cursor = withoutRowid ? pk.map((c) => last[c.name]) : last.__bk_rowid
        if (rows.length < pageSize) break
      }
      counts[table.name] = fetched
    }

    // Indexes, views and triggers last, so triggers do not fire on the copy.
    for (const row of schema) {
      if (row.type === "table" || isShadow(row.name)) continue
      local.exec(row.sql)
    }

    const integrity = local.prepare("PRAGMA integrity_check").get()?.integrity_check
    if (integrity !== "ok") throw new Error(`D1_BACKUP_INTEGRITY ${integrity}`)
    for (const [name, fetched] of Object.entries(counts)) {
      const stored = local.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n
      if (stored !== fetched)
        throw new Error(`D1_BACKUP_COUNT_MISMATCH ${name} ${stored}/${fetched}`)
    }
    local.close()
    renameSync(partial, outFile)
    return { tables: counts, reads, integrity, duration_ms: Date.now() - started }
  } catch (error) {
    try {
      local.close()
    } catch {}
    rmSync(partial, { force: true })
    throw error
  }
}

export function pruneBackups(dir, { now = Date.now(), keepDays = 30, keepNewest = 2 } = {}) {
  if (!existsSync(dir)) return []
  const dumps = readdirSync(dir)
    .filter((f) => f.endsWith(".sqlite.gz"))
    .map((f) => ({ f, mtime: statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  const removed = []
  for (const [index, dump] of dumps.entries()) {
    if (index < keepNewest || now - dump.mtime <= keepDays * DAY_MS) continue
    rmSync(path.join(dir, dump.f), { force: true })
    rmSync(path.join(dir, dump.f.replace(/\.sqlite\.gz$/, ".json")), { force: true })
    removed.push(dump.f)
  }
  return removed
}

async function sha256File(file) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export async function runRotation({
  root,
  now = Date.now(),
  database = rotationDatabase(now),
  queryFor,
  readUsage,
  pageSize,
  readShareLimit = 0.3,
}) {
  const dir = path.join(root, database.name)
  const date = new Date(now).toISOString().slice(0, 10)
  const final = path.join(dir, `${date}.sqlite.gz`)
  if (existsSync(final)) return { status: "already_done", database: database.name, file: final }
  let usage
  try {
    usage = await readUsage()
  } catch (error) {
    return { status: "skipped_budget_unknown", database: database.name, error: error.message }
  }
  const used = Number(usage?.rows_read)
  if (!Number.isFinite(used) || used >= readShareLimit * DAILY_READ_CAP)
    return { status: "skipped_budget", database: database.name, rows_read: used }

  mkdirSync(dir, { recursive: true })
  const raw = path.join(dir, `${date}.sqlite`)
  const report = await exportD1Database({ query: queryFor(database), outFile: raw, pageSize })
  const gzPartial = `${final}.partial`
  await pipeline(createReadStream(raw), createGzip({ level: 6 }), createWriteStream(gzPartial))
  renameSync(gzPartial, final)
  rmSync(raw, { force: true })
  const manifest = {
    database: database.name,
    database_id: database.id,
    date,
    reads_before: used,
    ...report,
    bytes: statSync(final).size,
    sha256: await sha256File(final),
  }
  writeFileSync(path.join(dir, `${date}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
  const pruned = pruneBackups(dir, { now })
  return { status: "exported", database: database.name, file: final, report: manifest, pruned }
}

export function d1HttpQuery({ accountId, token, databaseId, fetcher = fetch }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`
  return async (sql, params = []) => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetcher(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(60000),
      })
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
        continue
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success)
        throw new Error(
          `D1_BACKUP_HTTP_${response.status} ${String(payload?.errors?.[0]?.message || "").slice(0, 160)}`,
        )
      return payload.result[0]
    }
  }
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) throw new Error("D1_BACKUP_CREDENTIALS_MISSING")
  const root = process.env.D1_BACKUP_ROOT || "D:\\Backups\\brinedew-d1"
  const only = process.argv.find((a) => a.startsWith("--db="))?.slice(5)
  const database = only ? BACKUP_ROTATION.find((d) => d.name === only) : undefined
  if (only && !database) throw new Error(`D1_BACKUP_UNKNOWN_DB ${only}`)
  mkdirSync(root, { recursive: true })
  const result = await runRotation({
    root,
    ...(database ? { database } : {}),
    queryFor: (db) => d1HttpQuery({ accountId, token, databaseId: db.id }),
    readUsage: () => readAccountBudget({ accountId, token }),
  })
  const line = { at: new Date().toISOString(), ...result }
  appendFileSync(path.join(root, "backup-log.jsonl"), `${JSON.stringify(line)}\n`)
  console.log(JSON.stringify(line, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const root = process.env.D1_BACKUP_ROOT || "D:\\Backups\\brinedew-d1"
    try {
      mkdirSync(root, { recursive: true })
      appendFileSync(
        path.join(root, "backup-log.jsonl"),
        `${JSON.stringify({ at: new Date().toISOString(), status: "failed", error: error.message })}\n`,
      )
    } catch {}
    console.error(error.message)
    process.exitCode = 1
  })
}
