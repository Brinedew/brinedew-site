// B-859 step 5: the operator script that reaps the authoring D1's one-time
// residue. It exists because of two measured facts (B-859 comment, 2026-10-03):
//
// 1. 38,338 command receipts have no event. Their events were archived and
//    deleted at the sealed event-archive cut (through event 58,078); every
//    command since then keeps an immutable event whose foreign key points at its
//    receipt, so no process makes new orphans. A recurring sweep would find
//    nothing after one run, so this is a one-shot script, not a cron.
// 2. The abandoned cutover backup (artifact `building`, 23,894 of 38,300
//    entries) left 23,895 index rows that no code reads.
//
// The receipt TTL is 30 days. A receipt protects a client that lost the
// response and retries the same command ID: the browser retries within
// minutes, the workstation outbox on its next sync. Past the TTL a stale retry
// runs as a new command and the command's expected-version guard turns it into
// the normal conflict that keeps the draft. Receipts with an event live as long
// as the event.
//
// Dry run is the default and sends only SELECT statements. `--execute` deletes
// in rowid windows, stops at a rows-written cap using the writes D1 reports,
// prints where to resume, and refuses before 20:00 UTC unless an incident
// reason is given (AGENTS.md: spend the daily allowance at the end of the UTC
// day). Every run is idempotent: eligibility is recomputed per window.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const RECEIPT_TTL_DAYS = 30
export const MIN_TTL_DAYS = 7
export const LATE_UTC_HOUR = 20
export const BACKUP_QUIET_DAYS = 7
const DATABASE = "iconoplasm-authoring"
const CONFIG = "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"
const DAY_MS = 86_400_000

const DEFAULTS = Object.freeze({
  execute: false,
  ttlDays: RECEIPT_TTL_DAYS,
  windowSize: 1000,
  maxWrites: 15_000,
  fromRowid: 0,
  allowEarlyReason: null,
  reportFile: null,
})

// writesPerRow is D1's billing rule: one write for the row plus one per index
// entry. Receipts have the primary-key index; backup entries have the primary
// key and the unique package key.
const TARGETS = Object.freeze({
  receipts: Object.freeze({
    table: "icono_authoring_command_receipts",
    writesPerRow: 2,
    where: (from, to, cutoff) =>
      `rowid >= ${from} AND rowid < ${to} AND created_at < '${cutoff}'
       AND NOT EXISTS (SELECT 1 FROM icono_manifestation_events event
                        WHERE event.command_id = icono_authoring_command_receipts.command_id)
       AND NOT EXISTS (SELECT 1 FROM icono_manifestation_storage_mutation_guards guard
                        WHERE guard.command_id = icono_authoring_command_receipts.command_id)`,
  }),
  "backup-entries": Object.freeze({
    table: "icono_manifestation_cutover_backup_entries",
    writesPerRow: 3,
    where: (from, to) => `rowid >= ${from} AND rowid < ${to}`,
  }),
})

function fail(code, message, extra = {}) {
  return Object.assign(new Error(`${code}: ${message}`), { code, ...extra })
}

function sqliteTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString().replace("T", " ").slice(0, 19)
}

function requireInteger(value, { code, label, min, max }) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw fail(code, `${label} must be an integer from ${min} to ${max}`)
  return value
}

async function backupPreflight(run, now) {
  const { rows } = await run(
    `SELECT status, updated_at, expected_entries, verified_entries
       FROM icono_manifestation_cutover_backup_artifacts`,
  )
  if (rows.length !== 1)
    throw fail("BACKUP_ARTIFACT_UNEXPECTED", `expected one backup artifact, found ${rows.length}`)
  const [artifact] = rows
  if (!["building", "failed"].includes(artifact.status))
    throw fail(
      "BACKUP_NOT_ABANDONED",
      `the backup artifact is ${artifact.status}; only an abandoned (building or failed) backup is residue`,
    )
  if (String(artifact.updated_at) >= sqliteTimestamp(now.getTime() - BACKUP_QUIET_DAYS * DAY_MS))
    throw fail(
      "BACKUP_STILL_ACTIVE",
      `the backup artifact was touched ${artifact.updated_at}, inside the ${BACKUP_QUIET_DAYS}-day quiet period`,
    )
  return artifact
}

export async function reapAuthoringResidue({
  target,
  run,
  execute = DEFAULTS.execute,
  now = new Date(),
  ttlDays = DEFAULTS.ttlDays,
  windowSize = DEFAULTS.windowSize,
  maxWrites = DEFAULTS.maxWrites,
  fromRowid = DEFAULTS.fromRowid,
  allowEarlyReason = DEFAULTS.allowEarlyReason,
  log = () => {},
}) {
  const spec = TARGETS[target]
  if (!spec)
    throw fail("TARGET_INVALID", `--target must be one of ${Object.keys(TARGETS).join(", ")}`)
  requireInteger(ttlDays, { code: "TTL_INVALID", label: "ttlDays", min: MIN_TTL_DAYS, max: 3650 })
  requireInteger(windowSize, { code: "WINDOW_INVALID", label: "windowSize", min: 1, max: 2000 })
  requireInteger(maxWrites, { code: "CAP_INVALID", label: "maxWrites", min: 1, max: 100_000 })
  requireInteger(fromRowid, { code: "FROM_INVALID", label: "fromRowid", min: 0, max: 2 ** 40 })
  const costOfOneWindow = windowSize * spec.writesPerRow
  const early = now.getUTCHours() < LATE_UTC_HOUR
  if (execute) {
    if (maxWrites < costOfOneWindow)
      throw fail(
        "CAP_BELOW_WINDOW",
        `maxWrites ${maxWrites} is below one window (${costOfOneWindow})`,
      )
    if (early && !String(allowEarlyReason || "").trim())
      throw fail(
        "RUN_LATE_IN_THE_UTC_DAY",
        `execute runs at or after ${LATE_UTC_HOUR}:00 UTC; now is ${now.toISOString()}. During an incident, pass an allow-early reason`,
      )
  }

  const cutoff = sqliteTimestamp(now.getTime() - ttlDays * DAY_MS)
  const totals = { deleted: 0, eligible: 0, rows_read: 0, rows_written: 0, windows: 0 }
  let cursor = fromRowid
  const send = async (sql) => {
    try {
      return await run(sql.replace(/\s+/g, " ").trim())
    } catch (error) {
      throw fail("D1_STATEMENT_FAILED", String(error?.message || error).slice(0, 400), {
        partial: { ...totals, next_from_rowid: cursor },
      })
    }
  }

  const artifact = target === "backup-entries" ? await backupPreflight(send, now) : null
  const {
    rows: [{ max_rowid: maxRowid }],
  } = await send(`SELECT COALESCE(MAX(rowid), 0) AS max_rowid FROM ${spec.table}`)

  while (cursor <= maxRowid) {
    if (execute && totals.rows_written + costOfOneWindow > maxWrites) break
    const to = cursor + windowSize
    const where = spec.where(cursor, to, cutoff)
    if (execute) {
      const { meta } = await send(`DELETE FROM ${spec.table} WHERE ${where}`)
      totals.deleted += Number(meta.changes || 0)
      totals.rows_written += Number(meta.rows_written || 0)
      totals.rows_read += Number(meta.rows_read || 0)
      log(
        `deleted ${meta.changes || 0} in rowid [${cursor}, ${to}), ${meta.rows_written || 0} rows written`,
      )
    } else {
      const { rows, meta } = await send(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${where}`)
      totals.eligible += Number(rows[0].n)
      totals.rows_read += Number(meta.rows_read || 0)
      log(`eligible ${rows[0].n} in rowid [${cursor}, ${to})`)
    }
    totals.windows += 1
    cursor = to
  }

  const done = cursor > maxRowid
  return {
    target,
    mode: execute ? "execute" : "dry-run",
    cutoff: target === "receipts" ? cutoff : null,
    ttl_days: target === "receipts" ? ttlDays : null,
    window_size: windowSize,
    max_rowid: maxRowid,
    ...totals,
    next_from_rowid: done ? null : cursor,
    done,
    early_reason: execute && early ? String(allowEarlyReason).trim() : null,
    artifact_status: artifact?.status ?? null,
  }
}

const OPTIONS = Object.freeze({
  "--target": ["target", (value) => value],
  "--ttl-days": ["ttlDays", Number],
  "--window": ["windowSize", Number],
  "--max-writes": ["maxWrites", Number],
  "--from-rowid": ["fromRowid", Number],
  "--allow-early": ["allowEarlyReason", (value) => value],
  "--report-file": ["reportFile", (value) => value],
})

export function parseReaperArgs(argv) {
  const parsed = { target: null, ...DEFAULTS }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--execute") {
      parsed.execute = true
      continue
    }
    const option = OPTIONS[flag]
    if (!option) throw new Error(`Unknown option: ${flag}`)
    const value = argv[(index += 1)]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    const [key, convert] = option
    parsed[key] = convert(value)
    if (Number.isNaN(parsed[key])) throw new Error(`${flag} must be a number (ttl ${value})`)
  }
  if (!TARGETS[parsed.target])
    throw new Error(`--target must be one of ${Object.keys(TARGETS).join(", ")}`)
  return parsed
}

// Production executor: the signed-in wrangler session, remote D1. Statements
// carry only validated integers and one generated timestamp, never user text.
export function createWranglerExecutor({
  cwd = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  execFile = execFileSync,
} = {}) {
  const wrangler = path.join(
    path.dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
    "bin",
    "wrangler.js",
  )
  return async (sql) => {
    const stdout = execFile(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        DATABASE,
        "--remote",
        "--config",
        CONFIG,
        "--json",
        "--command",
        sql,
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    const parsed = JSON.parse(stdout)
    const result = Array.isArray(parsed) ? parsed[0] : parsed
    if (!result || result.success === false) throw new Error("D1 reported a failed statement")
    return { rows: result.results ?? [], meta: result.meta ?? {} }
  }
}

async function main() {
  const options = parseReaperArgs(process.argv.slice(2))
  const report = await reapAuthoringResidue({
    ...options,
    run: createWranglerExecutor(),
    log: (line) => console.error(line),
  })
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (options.reportFile) writeFileSync(options.reportFile, text)
  process.stdout.write(text)
  if (!report.done)
    console.error(`Not finished. Resume with --from-rowid ${report.next_from_rowid}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    if (error.partial) console.error(`Progress so far: ${JSON.stringify(error.partial)}`)
    process.exit(1)
  })
}
