#!/usr/bin/env node
// B-977: the one-shot operator script that restores the full text of the seed
// manifestations the cutover importer cut at 4,000 characters. The site holds the
// first 4,000 characters of 6,817 genes' texts; the full texts survive only in the
// workstation's prompts.db (table manifestations, status 'generated', frozen since
// 2026-08-30).
//
// This script reads prompts.db READ-ONLY, picks the genes whose text is longer
// than 4,000 and at most 10,000 code points after normalization (NFC, CRLF to LF;
// the 8 longer ones are shortened by hand in the caretaker GUI), and sends them to
// POST /api/iconoplasm/admin/caretakers/restore-seed-prose, ONE gene per call.
// The Worker is the judge, not this script: it refuses any text that is not
// exactly the continuation of the site's cut seed (hash of the first 4,000 code
// points), skips genes a caretaker has touched, appends the text as a new revision
// of the seed, selects it, and carries the seed's Tags over, atomically
// (workers/iconoplasm/caretaker/manifestation-seed-prose-restoration.js has the
// whole design and the fetch count). The change then reaches readers through the
// normal projection and publication of the accepted event; this script publishes
// nothing itself. Delete it with the route and the command once a second pass
// finds no cropped seed left (every gene skipped_not_cropped).
//
// WHAT A NIGHT COSTS. Every D1 write counts the row and each index entry. A local
// run of one restore on the real authority schema (2026-10-04, node:sqlite, every
// migration) inserted 45 rows including index entries in 10 tables, and made 15
// more update and delete operations (the quota counters, the heads, the upload
// intents' adoption, the receipt): about 70 rows written in the authority
// database. Projecting the accepted event to the primary database and recording
// the publication wake adds about 20 (counted from the schema's indexes, not
// run). So AUTHORITY_ROWS_WRITTEN_PER_GENE = 70 and PROJECTION_ROWS_WRITTEN_PER_GENE
// = 20, ROWS_WRITTEN_PER_GENE = 90. The authority part is read back from the
// production D1 on every call (`d1_rows_written` in the route's answer) and the
// receipt prints observed beside estimated, so the canary corrects the guess. A
// gene that is skipped writes no rows. At 90 rows a gene, the 15,000 rows a night
// this script allows by default restore 166 genes, so the whole 6,817 take about
// 42 nights, not two: the row count, not the request count, sets the pace. The
// whole 20,000-row operator allowance would be 222 genes and 31 nights. Worker
// requests are one a gene (plus retries), a rounding error against the 100,000 a
// day; Bunny takes 2 PUTs and 3 GETs a gene when it behaves, at most 37 fetches.
// If the canary shows fewer rows a gene, lower the constants below in a reviewed
// change; do not pass a bigger --max-genes than the budget allows.
//
// TONIGHT, IN THIS ORDER (after 20:00 UTC; each step that sends needs
// ICONOPLASM_ADMIN_TOKEN):
//   1. node scripts/restore-cropped-seed-prose.mjs
//        Dry run: how many genes qualify, what a night costs, nothing sent.
//   2. node scripts/restore-cropped-seed-prose.mjs --execute --max-genes 5
//        The canary. Read the receipt: restored 5, failed 0, and
//        d1_rows_written_authority_observed close to 5 x 70. Then open one of
//        the five gene pages and look at the text and the Tags.
//   3. node scripts/restore-cropped-seed-prose.mjs --execute
//        The night's slice (166 genes), resuming after the canary.
//   Every later night: the same step 3, until the receipt says every gene was
//   visited. To check, run `--execute --from start` once: every gene must come
//   back skipped_not_cropped (a skip writes nothing) and restored must be 0.
//
// Dry run is the default. `--execute` refuses before 20:00 UTC unless
// `--allow-early "<incident reason>"` is given (AGENTS.md: spend the daily
// allowance at the end of the UTC day, never right after the reset). Every call
// carries a command id derived from the gene and its text, so a retry after a
// timeout or a CPU kill is a replay, never a second revision. A run stops when
// too many genes fail (10 by default, --max-failures), when the token is refused,
// when the body quota says 429, or when the night's row budget is spent, saves
// where it can resume, and writes a receipt to artifacts/b977-seed-restore/.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

export const LATE_UTC_HOUR = 20
export const ORIGIN = "https://iconoplasm.brinedew.bio"
export const ROUTE = "/api/iconoplasm/admin/caretakers/restore-seed-prose"
export const DEFAULT_PROMPTS_DB = "D:\\Coding\\Datasets\\iconoplasm\\prompts.db"
// The importer's cut, and the longest text the editor and the authority accept.
export const CROP_CODE_POINTS = 4000
export const MAX_CODE_POINTS = 10_000
// See the header: the authority writes about 70 rows (read back per call), the
// primary-database projection and publication wake about 20 more.
export const AUTHORITY_ROWS_WRITTEN_PER_GENE = 70
export const PROJECTION_ROWS_WRITTEN_PER_GENE = 20
export const ROWS_WRITTEN_PER_GENE =
  AUTHORITY_ROWS_WRITTEN_PER_GENE + PROJECTION_ROWS_WRITTEN_PER_GENE
export const NIGHT_ROW_BUDGET = 15_000
export const MAX_NIGHT_ROW_BUDGET = 20_000
export const DEFAULT_NIGHT_GENES = Math.floor(NIGHT_ROW_BUDGET / ROWS_WRITTEN_PER_GENE)
export const MAX_NIGHT_GENES = Math.floor(MAX_NIGHT_ROW_BUDGET / ROWS_WRITTEN_PER_GENE)
export const CANARY_GENES = 5
const SYMBOL = /^[A-Za-z0-9_.-]{1,128}$/
const MAX_LISTED = 200

function fail(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function normalizeProse(text) {
  return String(text).normalize("NFC").replace(/\r\n?/g, "\n")
}

// A stable id for one gene's one text: the same gene and text always send the same
// command id, so a retry or a second night replays or skips instead of duplicating.
export function commandIdFor(geneSymbol, prose) {
  const digest = createHash("sha256")
    .update(`${geneSymbol}\n${normalizeProse(prose)}`)
    .digest("hex")
  return `b977_restore_${digest.slice(0, 48)}`
}

// Genes whose text qualifies, in symbol order, from prompts.db opened read-only.
// SQL pre-filters on length (pre-normalization characters; CRLF and NFC only ever
// shorten), the exact test is on the normalized text.
export function loadCandidates(dbPath, { after = "" } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare(
        `SELECT gene_symbol, manifestation FROM manifestations
          WHERE status = 'generated' AND length(manifestation) > ? AND length(manifestation) <= ?
            AND gene_symbol > ?
          ORDER BY gene_symbol`,
      )
      .all(CROP_CODE_POINTS, MAX_CODE_POINTS + 2000, after)
    const genes = []
    const over = []
    for (const { gene_symbol: geneSymbol, manifestation } of rows) {
      if (!SYMBOL.test(geneSymbol)) continue
      const codePoints = Array.from(normalizeProse(manifestation)).length
      if (codePoints <= CROP_CODE_POINTS) continue
      if (codePoints > MAX_CODE_POINTS) {
        over.push({ gene_symbol: geneSymbol, code_points: codePoints })
        continue
      }
      genes.push({ gene_symbol: geneSymbol, prose: manifestation, code_points: codePoints })
    }
    const longer = db
      .prepare(
        `SELECT gene_symbol, length(manifestation) AS n FROM manifestations
          WHERE status = 'generated' AND length(manifestation) > ? ORDER BY gene_symbol`,
      )
      .all(MAX_CODE_POINTS + 2000)
    for (const { gene_symbol: geneSymbol, n } of longer)
      if (geneSymbol > after) over.push({ gene_symbol: geneSymbol, code_points: Number(n) })
    return { genes, over }
  } finally {
    db.close()
  }
}

export function createRoutePoster({ origin = ORIGIN, token, fetchImpl = fetch } = {}) {
  const bearer = String(token ?? "").trim()
  if (!bearer) throw fail("ADMIN_TOKEN_MISSING", "set ICONOPLASM_ADMIN_TOKEN to execute")
  return async function post({ commandId, geneSymbol, prose }) {
    const response = await fetchImpl(`${origin}${ROUTE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command_id: commandId, gene_symbol: geneSymbol, prose }),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

export function loadCursor(file) {
  if (!existsSync(file)) return ""
  let value
  try {
    value = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw fail("CURSOR_FILE_DAMAGED", `the cursor file ${file} is not JSON; fix or delete it`)
  }
  if (typeof value?.after !== "string" || (value.after && !SYMBOL.test(value.after)))
    throw fail("CURSOR_FILE_DAMAGED", `the cursor file ${file} has no valid cursor`)
  return value.after
}

export function saveCursor(file, after) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ after }, null, 2)}\n`)
}

export function writeReceipt(dir, receipt) {
  mkdirSync(dir, { recursive: true })
  const stamp = String(receipt.started_at || new Date().toISOString()).replace(/[:.]/g, "-")
  for (let attempt = 1; ; attempt += 1) {
    const file = path.join(dir, `${stamp}-${receipt.mode}${attempt > 1 ? `-${attempt}` : ""}.json`)
    if (existsSync(file)) continue
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`)
    return file
  }
}

// What `genes` restores cost, as an estimate: one Worker request each (plus
// retries), 2 Bunny PUTs and 3 GETs when Bunny behaves (at most 37 fetches), and
// ROWS_WRITTEN_PER_GENE D1 rows written.
export function restoreCost(genes) {
  return {
    genes,
    worker_requests: genes,
    d1_rows_written_estimate: genes * ROWS_WRITTEN_PER_GENE,
    bunny_storage_puts: genes * 2,
    bunny_storage_gets: genes * 3,
    nights_at_default: Math.ceil(genes / DEFAULT_NIGHT_GENES),
  }
}

export async function restoreGenes({
  genes = [],
  post = null,
  mode = "dry-run",
  now = new Date(),
  sleep = defaultSleep,
  maxGenes = null,
  maxFailures = 10,
  rowBudget = NIGHT_ROW_BUDGET,
  allowEarlyReason = null,
  retryDelayMs = 2000,
  onProgress = () => {},
  log = () => {},
} = {}) {
  if (!["dry-run", "execute"].includes(mode)) throw fail("MODE_INVALID", String(mode))
  const startedAt = new Date().toISOString()
  const execute = mode === "execute"
  const early = now.getUTCHours() < LATE_UTC_HOUR
  if (execute) {
    if (typeof post !== "function") throw fail("POSTER_REQUIRED", "execute needs the route poster")
    if (early && !String(allowEarlyReason || "").trim())
      throw fail(
        "RUN_LATE_IN_THE_UTC_DAY",
        `execute runs at or after ${LATE_UTC_HOUR}:00 UTC; now is ${now.toISOString()}. During an incident, pass --allow-early with the reason`,
      )
  }
  const planned = Math.min(maxGenes ?? DEFAULT_NIGHT_GENES, genes.length)
  const receipt = {
    mode,
    started_at: startedAt,
    early_reason: execute && early ? String(allowEarlyReason).trim() : null,
    eligible_genes: genes.length,
    max_genes: maxGenes,
    row_budget: rowBudget,
    calls: 0,
    retries: 0,
    restored: 0,
    restored_projection_pending: 0,
    skipped_not_cropped: 0,
    skipped_caretaker_canonical: 0,
    failed: [],
    different_text: [],
    bunny_fetches: 0,
    d1_rows_written_authority_observed: 0,
    d1_rows_written_estimated: 0,
    stopped: null,
    next_after: null,
    cost_estimate: restoreCost(execute ? planned : genes.length),
  }
  if (!execute) {
    receipt.plan = nightsPlan(genes.length)
    return receipt
  }

  let firstFailure = null
  let lastVisited = null
  async function send(gene) {
    const commandId = commandIdFor(gene.gene_symbol, gene.prose)
    let reply = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      receipt.calls += 1
      try {
        reply = await post({ commandId, geneSymbol: gene.gene_symbol, prose: gene.prose })
      } catch (error) {
        reply = { status: 0, body: null, error: String(error?.message || error).slice(0, 120) }
      }
      // 5xx (a free-plan Worker killed at its CPU cap, Bunny not serving yet) and a
      // network error are retried with the SAME command id: a retry after the commit
      // is a replay, never a second revision.
      if (reply.status !== 0 && reply.status < 500) return reply
      receipt.retries += 1
      if (attempt < 4) await sleep(retryDelayMs * attempt)
    }
    return reply
  }

  for (const gene of genes.slice(0, planned)) {
    if (receipt.failed.length >= maxFailures) {
      receipt.stopped = "too_many_failures"
      break
    }
    if (
      receipt.d1_rows_written_estimated + ROWS_WRITTEN_PER_GENE > rowBudget &&
      receipt.restored > 0
    ) {
      receipt.stopped = "row_budget"
      break
    }
    const reply = await send(gene)
    lastVisited = gene.gene_symbol
    const body = reply.body ?? {}
    if (reply.status === 401 || reply.status === 403) {
      receipt.stopped = "unauthorized"
      break
    }
    if (reply.status === 429) {
      receipt.stopped = "body_quota"
      break
    }
    receipt.bunny_fetches += Number(body.bunny_fetches) || 0
    if ((reply.status === 200 || reply.status === 202) && body.status === "restored") {
      receipt.restored += 1
      if (reply.status === 202) receipt.restored_projection_pending += 1
      receipt.d1_rows_written_authority_observed += Number(body.d1_rows_written) || 0
      receipt.d1_rows_written_estimated += ROWS_WRITTEN_PER_GENE
    } else if (reply.status === 200 && body.status === "skipped_not_cropped") {
      receipt.skipped_not_cropped += 1
      if (body.reason === "different_text" && receipt.different_text.length < MAX_LISTED)
        receipt.different_text.push(gene.gene_symbol)
    } else if (reply.status === 200 && body.status === "skipped_caretaker_canonical") {
      receipt.skipped_caretaker_canonical += 1
    } else {
      firstFailure ??= gene.gene_symbol
      if (receipt.failed.length < MAX_LISTED)
        receipt.failed.push({
          gene_symbol: gene.gene_symbol,
          status: reply.status,
          code: String(body?.error?.code || reply.error || "no_answer").slice(0, 80),
        })
      else receipt.failed.push(null)
    }
    // The cursor stops before the first failure so the next night visits it again.
    if (!firstFailure) {
      receipt.next_after = gene.gene_symbol
      onProgress(gene.gene_symbol)
    }
    const visited =
      receipt.restored +
      receipt.skipped_not_cropped +
      receipt.skipped_caretaker_canonical +
      receipt.failed.length
    if (visited % 25 === 0 || reply.status !== 200)
      log(
        `${visited}/${planned}: ${receipt.restored} restored, ${receipt.skipped_not_cropped} not cropped, ${receipt.skipped_caretaker_canonical} caretaker canonical, ${receipt.failed.length} failed (at ${gene.gene_symbol})`,
      )
  }
  receipt.failed = receipt.failed.filter(Boolean)
  receipt.visited_through = lastVisited
  receipt.complete = receipt.stopped === null && planned === genes.length
  receipt.finished_at = new Date().toISOString()
  receipt.elapsed_seconds = Math.round(
    (Date.parse(receipt.finished_at) - Date.parse(startedAt)) / 1000,
  )
  return receipt
}

// What the whole job is, for the dry run.
function nightsPlan(total) {
  const full = restoreCost(total)
  return {
    summary: `${total.toLocaleString("en-US")} genes qualify. At about ${ROWS_WRITTEN_PER_GENE} D1 rows written a gene, a night of up to ${NIGHT_ROW_BUDGET.toLocaleString("en-US")} rows restores ${DEFAULT_NIGHT_GENES} genes, so the job takes ${full.nights_at_default} nights; at the whole ${MAX_NIGHT_ROW_BUDGET.toLocaleString("en-US")}-row operator allowance (${MAX_NIGHT_GENES} genes) it takes ${Math.ceil(total / MAX_NIGHT_GENES)}. Worker requests are not the limit (${total.toLocaleString("en-US")} in all). Every night starts after ${LATE_UTC_HOUR}:00 UTC.`,
    canary: `First: --execute --max-genes ${CANARY_GENES}, then compare the receipt's d1_rows_written_authority_observed with ${CANARY_GENES} x ${AUTHORITY_ROWS_WRITTEN_PER_GENE}.`,
  }
}

function wholeNumber(flag, value, { min, max }) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${flag} must be a whole number from ${min} to ${max}`)
  return number
}

export function parseRestoreArgs(argv) {
  const parsed = {
    execute: false,
    maxGenes: null,
    maxFailures: 10,
    from: null,
    db: DEFAULT_PROMPTS_DB,
    allowEarlyReason: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--execute") parsed.execute = true
    else if (["--max-genes", "--max-failures", "--from", "--db", "--allow-early"].includes(flag)) {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      if (flag === "--max-genes")
        parsed.maxGenes = wholeNumber(flag, value, { min: 1, max: MAX_NIGHT_GENES })
      else if (flag === "--max-failures")
        parsed.maxFailures = wholeNumber(flag, value, { min: 1, max: 1000 })
      else if (flag === "--from") {
        if (value !== "start" && !SYMBOL.test(value))
          throw new Error("--from needs a gene symbol, or the word start")
        parsed.from = value
      } else if (flag === "--db") parsed.db = String(value)
      else if (!String(value).trim()) throw new Error("--allow-early needs a reason")
      else parsed.allowEarlyReason = String(value)
    } else {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
  return parsed
}

async function main() {
  const options = parseRestoreArgs(process.argv.slice(2))
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.join(here, "..", "artifacts", "b977-seed-restore")
  const cursorFile = path.join(dir, "cursor.json")
  const mode = options.execute ? "execute" : "dry-run"
  const after =
    options.from === "start"
      ? ""
      : (options.from ?? (mode === "execute" ? loadCursor(cursorFile) : ""))
  const { genes, over } = loadCandidates(options.db, { after })
  const post =
    mode === "dry-run" ? null : createRoutePoster({ token: process.env.ICONOPLASM_ADMIN_TOKEN })
  const receipt = await restoreGenes({
    genes,
    post,
    mode,
    maxGenes: options.maxGenes,
    maxFailures: options.maxFailures,
    allowEarlyReason: options.allowEarlyReason,
    onProgress: (symbol) => saveCursor(cursorFile, symbol),
    log: (line) => console.error(line),
  })
  receipt.args = { ...options, allowEarlyReason: options.allowEarlyReason ? "(given)" : null }
  receipt.start_after = after
  receipt.over_limit_left_for_the_gui = over
  receipt.file = writeReceipt(dir, receipt)
  console.log(JSON.stringify(receipt, null, 2))
  if (mode === "dry-run") console.error(receipt.plan.summary)
  else {
    console.error(
      `${receipt.restored} restored, ${receipt.skipped_not_cropped} not cropped, ${receipt.skipped_caretaker_canonical} caretaker canonical, ${receipt.failed.length} failed; authority rows written ${receipt.d1_rows_written_authority_observed} observed, ${receipt.d1_rows_written_estimated} estimated for the whole path, in ${receipt.elapsed_seconds} s.`,
    )
    if (receipt.stopped) console.error(`Stopped (${receipt.stopped}). Run it again to resume.`)
    else if (receipt.complete) console.error("Every gene was visited.")
    else console.error("Night's slice finished. Run it again tomorrow night to continue.")
    if (receipt.failed.length || receipt.stopped) process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
