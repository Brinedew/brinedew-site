#!/usr/bin/env node
// B-859: the one-shot operator script that rewrites the 38,487 encrypted
// manifestation and Tags body objects (19,245 prose and 19,242 Tags, counted on
// 2026-10-03) as plain text in the private Bunny zone.
//
// Bodies are stored as plain text now, and a small reader still opens the old
// envelopes. Only the Worker holds the key and the Bunny password, so the
// rewrite runs there: this script calls the admin route
// POST /api/iconoplasm/admin/caretakers/plaintext-bodies, a few bodies a call.
// For each body the Worker reads the object, opens the envelope, writes the
// plain text to the same object key, reads it back, and puts the old envelope
// back if the read-back shows a damaged object. It writes no D1 row: the cursor
// is the storage row's id, which this script keeps in a local file. It is a
// one-shot, not a cron. Delete it with the route, the conversion and the legacy
// envelope reader once `--verify` reports nothing left (B-958).
//
//   node scripts/convert-authoring-bodies-to-plaintext.mjs                          # dry run: the plan and its cost
//   node scripts/convert-authoring-bodies-to-plaintext.mjs --verify                 # read every object, write nothing
//   node scripts/convert-authoring-bodies-to-plaintext.mjs --execute --max-bodies 1500   # a night's slice
//   node scripts/convert-authoring-bodies-to-plaintext.mjs --execute                # the next night, from the saved cursor
//   node scripts/convert-authoring-bodies-to-plaintext.mjs --execute --from-start   # a full pass again (idempotent)
//
// Dry run is the default and sends nothing to the Worker. `--execute` and
// `--verify` need ICONOPLASM_ADMIN_TOKEN and refuse before 20:00 UTC unless
// `--allow-early "<incident reason>"` is given (AGENTS.md: spend the daily
// allowance at the end of the UTC day, never right after the reset). Every run
// is idempotent: an object that is already plain text is recognised by its hash
// and skipped. A run stops when too many objects fail, when the token is
// refused, or when a slice keeps failing, saves where it stopped, and writes a
// receipt to artifacts/authoring-plaintext-backfill/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { PLAINTEXT_CONVERSION_MAX_BODIES } from "../workers/iconoplasm/caretaker/manifestation-plaintext-conversion.js"

export const LATE_UTC_HOUR = 20
export const ORIGIN = "https://iconoplasm.brinedew.bio"
export const ROUTE = "/api/iconoplasm/admin/caretakers/plaintext-bodies"
export const KINDS = Object.freeze(["revision", "derivative"])
export const DEFAULT_SLICE_BODIES = 3
export const DEFAULT_NIGHT_BODIES = 20_000
export const MAX_NIGHT_BODIES = 50_000
const CURSOR = /^[A-Za-z0-9_-]{0,128}$/
const MAX_LISTED_FAILURES = 200

// Counted on production 2026-10-03 (MAX(rowid) of the two storage tables).
export const MEASURED_BODIES = Object.freeze({
  measured_on: "2026-10-03",
  revision: 19_245,
  derivative: 19_242,
})

// Cost per body. D1 rows read were measured on 2026-10-03 as meta.rows_read of
// the route's two queries on a local workerd D1 holding the real authoring
// schema, at 3 bodies a call: 9 rows for prose (3 a body: the storage row, its
// revision, its manifestation) and 6 for Tags (2 a body: the storage row and
// its derivative). The 2.5 below is that mix over the 19,245 and 19,242 bodies.
// Each receipt reports the real figure the production D1 returned. The Bunny
// requests per body are one read, one write and one read-back; storage requests
// carry no fee. Nothing is written to D1.
const D1_ROWS_READ_PER_BODY = 2.5

function fail(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function conversionCost(bodies) {
  return {
    bodies,
    worker_requests: Math.ceil(bodies / DEFAULT_SLICE_BODIES),
    bunny_storage_gets: bodies * 2,
    bunny_storage_puts: bodies,
    d1_rows_read_estimate: Math.round(bodies * D1_ROWS_READ_PER_BODY),
    d1_rows_written: 0,
  }
}

export function createRoutePoster({ origin = ORIGIN, token, fetchImpl = fetch } = {}) {
  const bearer = String(token ?? "").trim()
  if (!bearer) throw fail("ADMIN_TOKEN_MISSING", "set ICONOPLASM_ADMIN_TOKEN to execute or verify")
  return async function post({ kind, after, limit, execute }) {
    const response = await fetchImpl(`${origin}${ROUTE}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind, after, limit, execute }),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

export function loadState(file) {
  if (!existsSync(file)) return { revision: "", derivative: "" }
  let value
  try {
    value = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    throw fail("CURSOR_FILE_DAMAGED", `the cursor file ${file} is not JSON; fix or delete it`)
  }
  for (const kind of KINDS) {
    if (typeof value?.[kind] !== "string" || !CURSOR.test(value[kind])) {
      throw fail("CURSOR_FILE_DAMAGED", `the cursor file ${file} has no valid ${kind} cursor`)
    }
  }
  return { revision: value.revision, derivative: value.derivative }
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify({ revision: state.revision, derivative: state.derivative }, null, 2)}\n`,
  )
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

// One lane per kind. A slice is retried, then retried at one body, then the
// lane stops: a Worker that fails three times in a row is not helped by a
// fourth. A refused token stops everything.
export async function convertBodies({
  post = null,
  mode = "dry-run",
  state = {},
  now = new Date(),
  sleep = defaultSleep,
  maxBodies = null,
  maxFailures = 10,
  allowEarlyReason = null,
  retryDelayMs = 2000,
  onProgress = () => {},
  log = () => {},
} = {}) {
  if (!["dry-run", "execute", "verify"].includes(mode)) throw fail("MODE_INVALID", String(mode))
  const startedAt = new Date().toISOString()
  const execute = mode === "execute"
  const verify = mode === "verify"
  const early = now.getUTCHours() < LATE_UTC_HOUR
  if (mode !== "dry-run") {
    if (typeof post !== "function")
      throw fail("POSTER_REQUIRED", `${mode} needs a way to call the conversion route`)
    if (early && !String(allowEarlyReason || "").trim())
      throw fail(
        "RUN_LATE_IN_THE_UTC_DAY",
        `${mode} runs at or after ${LATE_UTC_HOUR}:00 UTC; now is ${now.toISOString()}. During an incident, pass --allow-early with the reason`,
      )
  }
  const total = MEASURED_BODIES.revision + MEASURED_BODIES.derivative
  const planned = mode === "execute" ? Math.min(maxBodies ?? DEFAULT_NIGHT_BODIES, total) : total
  const receipt = {
    mode,
    started_at: startedAt,
    early_reason: mode !== "dry-run" && early ? String(allowEarlyReason).trim() : null,
    measured: MEASURED_BODIES,
    max_bodies: maxBodies,
    calls: 0,
    retries: 0,
    scanned: { revision: 0, derivative: 0 },
    plaintext: 0,
    converted: 0,
    legacy: 0,
    unverified: 0,
    failed: [],
    d1_rows_read: 0,
    stopped: null,
    done: { revision: false, derivative: false },
    next_after: { revision: state.revision ?? "", derivative: state.derivative ?? "" },
    cost: conversionCost(mode === "dry-run" ? total : planned),
  }
  if (mode === "dry-run") {
    receipt.plan = nightsPlan(total)
    return receipt
  }

  const cursors = verify
    ? { revision: "", derivative: "" }
    : { revision: state.revision ?? "", derivative: state.derivative ?? "" }
  const budget = { left: verify ? (maxBodies ?? Infinity) : planned }
  let stopped = null

  async function slice(kind, after, limit) {
    let size = limit
    let lastStatus = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      receipt.calls += 1
      let reply
      try {
        reply = await post({ kind, after, limit: size, execute })
      } catch (error) {
        reply = { status: 0, body: null, error: String(error?.message || error).slice(0, 120) }
      }
      lastStatus = reply.status
      if (reply.status === 200 && reply.body?.ok === true) return reply.body
      if (reply.status === 401 || reply.status === 403) throw fail("UNAUTHORIZED", "token refused")
      if (reply.status === 400)
        throw fail("ROUTE_REFUSED", JSON.stringify(reply.body ?? null).slice(0, 200))
      receipt.retries += 1
      if (attempt === 1) await sleep(retryDelayMs)
      else if (attempt === 2) {
        size = 1
        await sleep(retryDelayMs * 2)
      }
    }
    throw fail("SLICE_FAILED", `${kind} after ${after || "(start)"}: last status ${lastStatus}`)
  }

  async function lane(kind) {
    for (;;) {
      if (stopped) return
      if (receipt.failed.length >= maxFailures) {
        stopped ??= "too_many_failures"
        return
      }
      const limit = Math.min(DEFAULT_SLICE_BODIES, budget.left)
      if (limit < 1) {
        stopped ??= "max_bodies"
        return
      }
      budget.left -= limit
      let body
      try {
        body = await slice(kind, cursors[kind], limit)
      } catch (error) {
        budget.left += limit
        stopped ??= error.code === "UNAUTHORIZED" ? "unauthorized" : "slice_failed"
        if (stopped === "slice_failed") log(error.message)
        return
      }
      budget.left += limit - body.scanned
      receipt.scanned[kind] += body.scanned
      receipt.plaintext += body.plaintext
      receipt.converted += body.converted
      receipt.legacy += body.legacy
      receipt.unverified += body.unverified
      receipt.d1_rows_read += Number(body.d1_rows_read) || 0
      for (const entry of body.failed)
        if (receipt.failed.length < MAX_LISTED_FAILURES)
          receipt.failed.push({ kind, id: String(entry.id), code: String(entry.code) })
      cursors[kind] = body.next_after
      if (!verify) {
        state[kind] = body.next_after
        onProgress(state)
      }
      log(
        `${kind}: ${receipt.scanned[kind]} scanned, ${receipt.converted} converted in total, ${receipt.failed.length} failed`,
      )
      if (body.done) {
        receipt.done[kind] = true
        return
      }
    }
  }

  await Promise.all(KINDS.map(lane))
  receipt.stopped = stopped
  receipt.next_after = { ...cursors }
  receipt.finished_at = new Date().toISOString()
  if (verify) {
    receipt.complete = receipt.done.revision && receipt.done.derivative
    receipt.clean =
      receipt.complete && receipt.legacy === 0 && receipt.failed.length === 0 && stopped === null
  }
  return receipt
}

// What a night is, for the dry run: the canary first, then the rest.
function nightsPlan(total) {
  const nights = []
  let remaining = total
  for (const bodies of [1500, DEFAULT_NIGHT_BODIES, DEFAULT_NIGHT_BODIES, DEFAULT_NIGHT_BODIES]) {
    if (remaining <= 0) break
    const take = Math.min(bodies, remaining)
    nights.push({ night: nights.length + 1, bodies: take, ...conversionCost(take) })
    remaining -= take
  }
  return nights
}

function wholeNumber(flag, value, { min, max }) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${flag} must be a whole number from ${min} to ${max}`)
  return number
}

export function parseConvertArgs(argv) {
  const parsed = {
    execute: false,
    verify: false,
    maxBodies: null,
    maxFailures: 10,
    fromStart: false,
    allowEarlyReason: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--execute") parsed.execute = true
    else if (flag === "--verify") parsed.verify = true
    else if (flag === "--from-start") parsed.fromStart = true
    else if (["--max-bodies", "--max-failures", "--allow-early"].includes(flag)) {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      if (flag === "--max-bodies")
        parsed.maxBodies = wholeNumber(flag, value, { min: 1, max: MAX_NIGHT_BODIES })
      else if (flag === "--max-failures")
        parsed.maxFailures = wholeNumber(flag, value, { min: 1, max: 1000 })
      else if (!String(value).trim()) throw new Error("--allow-early needs a reason")
      else parsed.allowEarlyReason = String(value)
    } else {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
  if (parsed.verify && parsed.execute) throw new Error("--verify reads only; drop --execute")
  return parsed
}

async function main() {
  const options = parseConvertArgs(process.argv.slice(2))
  const here = path.dirname(fileURLToPath(import.meta.url))
  const dir = path.join(here, "..", "artifacts", "authoring-plaintext-backfill")
  const cursorFile = path.join(dir, "cursor.json")
  const mode = options.execute ? "execute" : options.verify ? "verify" : "dry-run"
  const post =
    mode === "dry-run" ? null : createRoutePoster({ token: process.env.ICONOPLASM_ADMIN_TOKEN })
  const state = options.fromStart ? { revision: "", derivative: "" } : loadState(cursorFile)
  const receipt = await convertBodies({
    post,
    mode,
    state,
    maxBodies: options.maxBodies,
    maxFailures: options.maxFailures,
    allowEarlyReason: options.allowEarlyReason,
    onProgress: (snapshot) => saveState(cursorFile, snapshot),
    log: (line) => console.error(line),
  })
  receipt.args = { ...options, allowEarlyReason: options.allowEarlyReason ? "(given)" : null }
  if (mode === "execute") saveState(cursorFile, state)
  receipt.file = writeReceipt(dir, receipt)
  console.log(JSON.stringify(receipt, null, 2))
  if (mode === "execute") {
    if (receipt.stopped)
      console.error(`Stopped (${receipt.stopped}). Run it again to resume from the saved cursor.`)
    else if (!(receipt.done.revision && receipt.done.derivative))
      console.error("Night's slice finished. Run it again tomorrow night to continue.")
    else console.error("Every body was visited. Run --verify to confirm nothing is left.")
    if (receipt.failed.length || receipt.stopped) process.exitCode = 1
  }
  if (mode === "verify" && !receipt.clean) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
