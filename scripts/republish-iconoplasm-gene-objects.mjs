#!/usr/bin/env node
// B-859: the one-shot operator script that rewrites every gene's stable object
// (genes/v3/<SYMBOL>.json) after the publisher stopped carrying Tags.
//
// The caretaker panel promises "Tags always stay private". Until this PR the
// public object carried each gene's accepted Tags derivative. New publications
// no longer do, but the roughly 19,023 objects already on the CDN keep the old
// bytes until something rewrites them, and nothing does that for an unchanged
// gene: the Actions catalog publisher only republishes the genes whose winner or
// candidates changed. This script drives the existing admin republish route
// (`admin_publication.republish`, up to eight genes a call, four by default) over
// the catalog. It is a one-shot, not a cron: delete it once `--verify` reports
// every object clean.
//
// WHAT THE FIRST NIGHT (2026-10-03) TAUGHT. About one call in five (3,521 of
// 16,979 at eight genes a call) came back `HTTP 503` with no JSON body. The
// stateful Worker's own analytics count the same calls as `exceededResources`
// with a median CPU of exactly 10 ms, and the Worker had none in the eight hours
// before: it is the free plan's CPU cap killing a call that builds eight stable
// objects. The route is idempotent, and the old script retried a call once, which
// hid a 20% failure rate as a 4% one. So: four genes a call by default
// (`--batch`); a call that gets a 5xx or a network error is retried twice with
// backoff, then its genes are sent one at a time, and only a gene that still
// fails counts as failed. The old "Resume with --from X" named the earliest
// FAILED gene while parallel batches had gone far beyond it, and a shell loop
// that followed it redid hundreds of genes a round. Now the hint names the first
// gene of the earliest batch that did not finish; every batch before it reached a
// final outcome, and the genes that failed are listed apart.
//
// TONIGHT, AFTER 20:00 UTC (each execute needs ICONOPLASM_ADMIN_TOKEN):
//   1. node scripts/republish-iconoplasm-gene-objects.mjs --verify
//        Reads every public object from the CDN (no Worker request, any hour) and
//        writes a receipt listing every gene still carrying Tags.
//   2. node scripts/republish-iconoplasm-gene-objects.mjs --execute --from-verify <that receipt>
//        Republishes exactly those genes.
//   3. Repeat 1 and 2 until `--verify` says clean. A gene that is listed again
//        after two rounds is a real problem, not a retry: read `failed` in the
//        execute receipt. Then delete this script.
//
//   node scripts/republish-iconoplasm-gene-objects.mjs                      # dry run: the plan and its cost
//   node scripts/republish-iconoplasm-gene-objects.mjs --verify             # read every public object
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute            # rewrite every gene
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --from-verify artifacts/iconoplasm-republish/<receipt>.json
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --from X   # resume at symbol X
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --only A,B # re-run named genes
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --batch 2  # genes a call, 1 to 8 (default 4)
//
// Dry run is the default and sends nothing to the Worker. `--execute` needs
// ICONOPLASM_ADMIN_TOKEN, refuses before 20:00 UTC unless an incident reason is
// given (AGENTS.md: spend the daily allowance at the end of the UTC day), stops
// after too many failed genes, prints where to resume, and writes a receipt to
// artifacts/iconoplasm-republish/. Every run is idempotent: the route rewrites a
// gene from D1 and the authoring store as they stand. `--verify` only reads the
// public CDN, so it runs at any hour. `--only` and `--from-verify` take `--from`
// too, to resume inside the same list.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { REPUBLISH_MAX_SYMBOLS } from "../workers/iconoplasm-admin-republish-route.js"

export const LATE_UTC_HOUR = 20
export const ORIGIN = "https://iconoplasm.brinedew.bio"
export const CDN = "https://iconoplasmportraits.b-cdn.net"
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const TAG_KEYS = new Set(["accepted_tags_derivative", "tags_text", "fields_json"])
const MAX_CONCURRENCY = 6
// Genes a call carries. The route takes up to REPUBLISH_MAX_SYMBOLS (a limit, not
// a target); the CPU cap killed about one call in five at eight.
export const DEFAULT_BATCH_SYMBOLS = 4
// Pauses before the first and second retry of a call that got a 5xx or a network
// error.
export const RETRY_DELAYS_MS = Object.freeze([2000, 5000])
// 3,521 of 16,979 calls answered 503 on 2026-10-03 at eight genes a call; this is
// the allowance the dry run adds for retries. Unmeasured at four a call.
const RETRY_ALLOWANCE = 1.3
// A public read-only verify: no Worker request, so it can go wider than a sweep.
const VERIFY_CONCURRENCY = 16
// The pull zone caches a rewritten object for 60 s on top of replication lag
// (bunny/the-only-iconoplasm-pull-zone-policy.json), so a second look 65 s later
// sees what the first one could not.
const VERIFY_RETRIES = 1
const VERIFY_RETRY_DELAY_MS = 65_000

// Measured on production 2026-10-03 by running the publisher's own SELECTs
// read-only and summing D1's meta.rows_read: 20 rows of point reads for a gene
// (vote version, the joined gene row, projection authority, the authoring
// record, the prose secret, route and enrollment checks) plus 3.65 rows for each
// candidate in its pool; the pool averages 2.97 candidates over a systematic
// sample of 90 genes. The rewrite writes no D1 rows for an unchanged gene.
export const D1_ROWS_READ_PER_GENE = 31

function fail(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code })
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The leak is the key, wherever it sits; a gene whose prose merely says
// "tags_text" is clean.
export function objectCarriesTags(value) {
  if (Array.isArray(value)) return value.some(objectCarriesTags)
  if (!value || typeof value !== "object") return false
  for (const [key, entry] of Object.entries(value)) {
    if (TAG_KEYS.has(key) || objectCarriesTags(entry)) return true
  }
  return false
}

export async function loadCatalogSymbols({ cdn = CDN, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${cdn}/catalog/v3/index.json?cb=${Date.now()}`, {
    cache: "no-store",
  })
  if (!response.ok)
    throw fail("CATALOG_UNAVAILABLE", `the catalog object answered ${response.status}`)
  const catalog = await response.json().catch(() => null)
  if (catalog?.schema !== 3 || !Array.isArray(catalog.genes))
    throw fail("CATALOG_SCHEMA", "the catalog object is not schema 3")
  const symbols = [
    ...new Set(
      catalog.genes
        .map((row) =>
          String(Array.isArray(row) ? row[0] : "")
            .trim()
            .toUpperCase(),
        )
        .filter((symbol) => SYMBOL.test(symbol)),
    ),
  ].sort()
  if (!symbols.length) throw fail("CATALOG_EMPTY", "the catalog object lists no genes")
  return symbols
}

export function createRoutePoster({
  origin = ORIGIN,
  token,
  fetchImpl = fetch,
  timeoutMs = 60_000,
} = {}) {
  const bearer = String(token ?? "").trim()
  if (!bearer) throw fail("ADMIN_TOKEN_MISSING", "set ICONOPLASM_ADMIN_TOKEN to execute")
  return async function post(symbols) {
    const response = await fetchImpl(`${origin}/api/iconoplasm/admin/publication/republish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    // A body-less 503 is Cloudflare's own page (the CPU cap answers
    // "error code: 1102"); keep its start so the receipt says so.
    const raw = await response.text().catch(() => "")
    let body = null
    try {
      body = JSON.parse(raw)
    } catch {
      // not JSON
    }
    return { status: response.status, body, raw: body === null ? raw.slice(0, 120) : "" }
  }
}

function sweepCost(count, batchSize) {
  const calls = Math.ceil(count / batchSize)
  return {
    worker_requests: calls,
    worker_requests_with_retries: Math.ceil(calls * RETRY_ALLOWANCE),
    bunny_storage_puts: count,
    bunny_storage_reads: count * 2,
    d1_rows_read_estimate: count * D1_ROWS_READ_PER_GENE,
    d1_rows_read_with_retries: Math.ceil(count * D1_ROWS_READ_PER_GENE * RETRY_ALLOWANCE),
    d1_rows_written_estimate: 0,
  }
}

function evenlySpaced(items, count) {
  if (items.length <= count) return [...items]
  const picked = []
  for (let index = 0; index < count; index += 1)
    picked.push(items[Math.floor(((index + 0.5) * items.length) / count)])
  return picked
}

export async function republishGeneObjects({
  symbols,
  post = null,
  execute = false,
  now = new Date(),
  sleep = defaultSleep,
  from = null,
  limit = null,
  only = null,
  batchSize = DEFAULT_BATCH_SYMBOLS,
  concurrency = 3,
  maxFailures = 10,
  retryDelaysMs = RETRY_DELAYS_MS,
  allowEarlyReason = null,
  canary = null,
  log = () => {},
}) {
  const startedMs = Date.now()
  if (!Array.isArray(symbols) || !symbols.length)
    throw fail("SYMBOLS_REQUIRED", "the catalog symbol list is empty")
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1))
    throw fail("LIMIT_INVALID", "limit must be a whole number of at least 1")
  if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= MAX_CONCURRENCY))
    throw fail("CONCURRENCY_INVALID", `concurrency must be 1 to ${MAX_CONCURRENCY}`)
  if (!(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= REPUBLISH_MAX_SYMBOLS))
    throw fail("BATCH_INVALID", `batch must be 1 to ${REPUBLISH_MAX_SYMBOLS} genes a call`)

  let plan
  if (only) {
    const known = new Set(symbols)
    const unknown = only.filter((symbol) => !known.has(symbol))
    if (unknown.length)
      throw fail("ONLY_UNKNOWN_SYMBOL", `not in the catalog: ${unknown.join(", ")}`)
    plan = [...new Set(only)].sort()
    if (from) {
      const start = plan.findIndex((symbol) => symbol >= from)
      plan = start === -1 ? [] : plan.slice(start)
    }
  } else {
    const start = from ? symbols.findIndex((symbol) => symbol >= from) : 0
    plan = start === -1 ? [] : symbols.slice(start)
  }
  const targets = limit === null ? plan : plan.slice(0, limit)
  const afterTargets = plan[targets.length] ?? null

  const early = now.getUTCHours() < LATE_UTC_HOUR
  if (execute) {
    if (typeof post !== "function")
      throw fail("POSTER_REQUIRED", "execute needs a way to call the republish route")
    if (early && !String(allowEarlyReason || "").trim())
      throw fail(
        "RUN_LATE_IN_THE_UTC_DAY",
        `execute runs at or after ${LATE_UTC_HOUR}:00 UTC; now is ${now.toISOString()}. During an incident, pass --allow-early with the reason`,
      )
  }

  const receipt = {
    mode: execute ? "execute" : "dry-run",
    started_at: now.toISOString(),
    catalog_genes: symbols.length,
    planned: targets.length,
    batch_size: batchSize,
    published: 0,
    failed: [],
    calls: 0,
    retries: 0,
    stopped: null,
    early_reason: execute && early ? String(allowEarlyReason).trim() : null,
    cost: sweepCost(targets.length, batchSize),
    next_from: targets[0] ?? null,
    done: false,
    verify_sample: [],
  }
  if (!execute) return receipt

  const batches = []
  for (let index = 0; index < targets.length; index += batchSize)
    batches.push(targets.slice(index, index + batchSize))
  // A batch is finished when every gene in it reached a final outcome: published
  // or listed as failed. The resume hint is built from this, not from failures.
  const finished = batches.map(() => false)

  const rewritten = []
  // One call to the route. `retry` says whether trying again can help: a 5xx,
  // a 429, a network error or an unreadable reply can; a refused token or a
  // refused request cannot. `fatal` ends the whole run.
  async function attempt(batch) {
    receipt.calls += 1
    let reply
    try {
      reply = await post(batch)
    } catch (error) {
      return { ok: false, retry: true, error: String(error?.message || error).slice(0, 200) }
    }
    const status = Number(reply?.status)
    if (status === 200 && reply.body?.ok === true && Array.isArray(reply.body.results))
      return { ok: true, results: reply.body.results }
    const detail = reply?.body
      ? JSON.stringify(reply.body).slice(0, 200)
      : `no JSON body: "${String(reply?.raw ?? "").slice(0, 80)}"`
    const error = `HTTP ${status} (${detail})`
    if (status === 401 || status === 403) return { ok: false, fatal: "unauthorized", error }
    const retry = status >= 500 || status === 429 || status === 408 || status === 200
    return { ok: false, retry, error }
  }

  async function callWithRetries(batch) {
    let outcome
    for (let tries = 0; tries <= retryDelaysMs.length; tries += 1) {
      if (tries > 0) {
        receipt.retries += 1
        await sleep(retryDelaysMs[tries - 1])
      }
      outcome = await attempt(batch)
      if (outcome.ok || outcome.fatal || !outcome.retry) return outcome
    }
    return outcome
  }

  function record(batch, results) {
    const bySymbol = new Map(results.map((result) => [String(result?.symbol || ""), result]))
    for (const symbol of batch) {
      const result = bySymbol.get(symbol)
      if (result?.ok === true && result.withdrawn !== true) {
        receipt.published += 1
        rewritten.push(symbol)
      } else if (result?.ok === true) {
        // The catalog lists the gene but the publisher found no card, so the
        // old object, Tags included, was not rewritten.
        receipt.failed.push({ symbol, error: "withdrawn: the publisher found no card for it" })
      } else {
        receipt.failed.push({
          symbol,
          error: String(result?.error || "the route did not report this gene").slice(0, 300),
        })
      }
    }
  }

  async function runBatch(index) {
    const batch = batches[index]
    const outcome = await callWithRetries(batch)
    if (outcome.fatal) {
      receipt.stopped ??= outcome.fatal
      return
    }
    if (outcome.ok) record(batch, outcome.results)
    else if (batch.length === 1) receipt.failed.push({ symbol: batch[0], error: outcome.error })
    else {
      // A call that failed three times may be too heavy for a cold isolate:
      // send the genes one at a time, each with the same retries.
      for (const symbol of batch) {
        const single = await callWithRetries([symbol])
        if (single.fatal) {
          receipt.stopped ??= single.fatal
          return
        }
        if (single.ok) record([symbol], single.results)
        else receipt.failed.push({ symbol, error: single.error })
      }
    }
    finished[index] = true
  }

  let launched = 0
  // The first batch goes alone and is read back from the CDN. A sweep started
  // before the fixed Worker is deployed would rewrite every gene with its Tags
  // again, so Tags still published stop the run after this one call.
  if (canary && batches.length) {
    launched = 1
    await runBatch(0)
    const check = await verifyGeneObjects({
      symbols: rewritten.slice(0, 3),
      fetchObject: canary.fetchObject,
      sleep,
      retries: canary.retries ?? 6,
      retryDelayMs: canary.retryDelayMs ?? 10_000,
      concurrency: 3,
    })
    receipt.canary = check
    if (!check.clean)
      receipt.stopped = check.carrying_tags.length ? "tags_still_published" : "canary_unreadable"
  }

  async function worker() {
    for (;;) {
      if (receipt.stopped) return
      if (receipt.failed.length >= maxFailures) {
        receipt.stopped = "too_many_failures"
        return
      }
      if (launched >= batches.length) return
      const index = launched
      launched += 1
      await runBatch(index)
      log(
        `${receipt.published}/${targets.length} rewritten, ${receipt.failed.length} failed, ${receipt.retries} retries in ${receipt.calls} calls`,
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  // Where to resume: the first gene of the earliest batch that did not finish.
  // Batches finish out of order, so this is not the earliest failure and not the
  // last batch started; every batch before it reached a final outcome.
  const firstOpen = finished.indexOf(false)
  if (receipt.stopped === "tags_still_published" || receipt.stopped === "canary_unreadable")
    receipt.next_from = targets[0]
  else receipt.next_from = firstOpen === -1 ? afterTargets : batches[firstOpen][0]
  receipt.batches = { total: batches.length, finished: finished.filter(Boolean).length }
  receipt.done = receipt.next_from === null
  receipt.failed.sort((one, other) => (one.symbol < other.symbol ? -1 : 1))
  receipt.verify_sample = evenlySpaced([...rewritten].sort(), 40)
  receipt.elapsed_seconds = Math.round((Date.now() - startedMs) / 1000)
  return receipt
}

// Reads every symbol's public object and reports which still carry Tags, are
// missing or could not be read. A symbol that is not clean is looked at again
// after `retryDelayMs`, up to `retries` times, because the CDN may serve the old
// copy for a minute or two after a rewrite; the wait happens once per round for
// all of them, not once per object.
export async function verifyGeneObjects({
  symbols,
  fetchObject,
  sleep = defaultSleep,
  retries = 6,
  retryDelayMs = 10_000,
  concurrency = 8,
  log = () => {},
}) {
  const verdict = new Map()
  let pending = [...symbols]

  async function read(symbol, round) {
    let reply
    try {
      reply = await fetchObject(symbol, round)
    } catch {
      return "unreadable"
    }
    if (reply?.status === 200 && reply.json && typeof reply.json === "object")
      return objectCarriesTags(reply.json) ? "carrying" : "clean"
    return reply?.status === 404 ? "missing" : "unreadable"
  }

  for (let round = 0; round <= retries && pending.length; round += 1) {
    if (round > 0) await sleep(retryDelayMs)
    const outcomes = new Array(pending.length)
    let next = 0
    let readCount = 0
    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
        while (next < pending.length) {
          const position = next
          next += 1
          outcomes[position] = await read(pending[position], round)
          readCount += 1
          if (readCount % 2000 === 0) log(`round ${round}: ${readCount}/${pending.length} read`)
        }
      }),
    )
    const stillNotClean = []
    pending.forEach((symbol, position) => {
      if (outcomes[position] === "clean") verdict.delete(symbol)
      else {
        verdict.set(symbol, outcomes[position])
        stillNotClean.push(symbol)
      }
    })
    pending = stillNotClean
  }
  const listed = (kind) => symbols.filter((symbol) => verdict.get(symbol) === kind).sort()
  const carrying = listed("carrying")
  const missing = listed("missing")
  const unreadable = listed("unreadable")
  return {
    checked: symbols.length,
    carrying_tags: carrying,
    missing,
    unreadable,
    clean: !carrying.length && !missing.length && !unreadable.length,
  }
}

function cdnObjectFetcher(cdn = CDN) {
  return async (symbol, attempt) => {
    const response = await fetch(
      `${cdn}/genes/v3/${encodeURIComponent(symbol)}.json?cb=${Date.now()}-${attempt}`,
      { cache: "no-store", signal: AbortSignal.timeout(30_000) },
    )
    return {
      status: response.status,
      json: response.status === 200 ? await response.json() : null,
    }
  }
}

export function writeReceipt(dir, receipt) {
  mkdirSync(dir, { recursive: true })
  const stamp = String(receipt.started_at || new Date().toISOString()).replace(/[:.]/g, "-")
  const file = path.join(dir, `${stamp}-${receipt.mode || "run"}.json`)
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`)
  return file
}

// The genes a `--verify` receipt listed as carrying Tags, for `--from-verify`.
// It refuses a file that is not a verify receipt, and a clean one, so a typo
// never republishes nothing and says "ok".
export function symbolsFromVerifyReceipt(file, readText = (name) => readFileSync(name, "utf8")) {
  let receipt
  try {
    receipt = JSON.parse(readText(file))
  } catch {
    throw fail("VERIFY_RECEIPT_UNREADABLE", `${file} is missing or is not JSON`)
  }
  if (receipt?.mode !== "verify" || !Array.isArray(receipt.carrying_tags))
    throw fail("NOT_A_VERIFY_RECEIPT", `${file} is not a receipt written by --verify`)
  const symbols = [
    ...new Set(
      receipt.carrying_tags
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter((symbol) => SYMBOL.test(symbol)),
    ),
  ].sort()
  if (!symbols.length)
    throw fail(
      "VERIFY_RECEIPT_CLEAN",
      `${file} lists no gene carrying Tags; there is nothing to do`,
    )
  return symbols
}

function wholeNumber(flag, value, { min, max = Number.MAX_SAFE_INTEGER }) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${flag} must be a whole number from ${min} to ${max}`)
  return number
}

function symbolValue(flag, value) {
  const symbol = String(value).trim().toUpperCase()
  if (!SYMBOL.test(symbol)) throw new Error(`${flag} needs a gene symbol, got "${value}"`)
  return symbol
}

export function parseRepublishArgs(argv) {
  const parsed = {
    execute: false,
    verify: false,
    verifySample: null,
    from: null,
    limit: null,
    only: null,
    fromVerify: null,
    batch: DEFAULT_BATCH_SYMBOLS,
    concurrency: 3,
    allowEarlyReason: null,
  }
  const valued = [
    "--from",
    "--limit",
    "--only",
    "--from-verify",
    "--batch",
    "--concurrency",
    "--allow-early",
    "--verify-sample",
  ]
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--execute") parsed.execute = true
    else if (flag === "--verify") parsed.verify = true
    else if (valued.includes(flag)) {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      if (flag === "--from") parsed.from = symbolValue(flag, value)
      else if (flag === "--limit") parsed.limit = wholeNumber(flag, value, { min: 1 })
      else if (flag === "--batch")
        parsed.batch = wholeNumber(flag, value, { min: 1, max: REPUBLISH_MAX_SYMBOLS })
      else if (flag === "--concurrency")
        parsed.concurrency = wholeNumber(flag, value, { min: 1, max: MAX_CONCURRENCY })
      else if (flag === "--verify-sample")
        parsed.verifySample = wholeNumber(flag, value, { min: 1 })
      else if (flag === "--allow-early") parsed.allowEarlyReason = String(value)
      else if (flag === "--from-verify") {
        if (!String(value).trim()) throw new Error("--from-verify needs a receipt file")
        parsed.fromVerify = String(value)
      } else {
        const only = String(value)
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((entry) => symbolValue(flag, entry))
        if (!only.length) throw new Error("--only needs at least one gene symbol")
        parsed.only = only
      }
    } else {
      throw new Error(`Unknown option: ${flag}`)
    }
  }
  if (parsed.verify && parsed.execute) throw new Error("--verify reads only; drop --execute")
  if (parsed.only && parsed.fromVerify)
    throw new Error("--only and --from-verify both name the genes; use one")
  if (parsed.verify && (parsed.only || parsed.fromVerify))
    throw new Error("--verify checks the whole catalog; drop --only and --from-verify")
  return parsed
}

async function main() {
  const options = parseRepublishArgs(process.argv.slice(2))
  const symbols = await loadCatalogSymbols()
  const receiptDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "artifacts",
    "iconoplasm-republish",
  )
  const scriptName = "node scripts/republish-iconoplasm-gene-objects.mjs"

  if (options.verify) {
    const sample = options.verifySample ? evenlySpaced(symbols, options.verifySample) : symbols
    const result = await verifyGeneObjects({
      symbols: sample,
      fetchObject: cdnObjectFetcher(),
      concurrency: VERIFY_CONCURRENCY,
      retries: VERIFY_RETRIES,
      retryDelayMs: VERIFY_RETRY_DELAY_MS,
      log: (line) => console.error(line),
    })
    const receipt = { mode: "verify", started_at: new Date().toISOString(), ...result }
    receipt.file = writeReceipt(receiptDir, receipt)
    console.log(
      JSON.stringify({ ...receipt, carrying_tags: receipt.carrying_tags.slice(0, 50) }, null, 2),
    )
    if (!result.clean) {
      process.exitCode = 1
      if (result.carrying_tags.length)
        console.error(
          `${result.carrying_tags.length} genes still carry Tags; the receipt lists every one. Republish exactly those with: ${scriptName} --execute --from-verify "${receipt.file}"`,
        )
      if (result.missing.length || result.unreadable.length)
        console.error(
          `${result.missing.length} genes have no public object and ${result.unreadable.length} could not be read; the receipt lists them.`,
        )
    }
    return
  }

  const post = options.execute
    ? createRoutePoster({ token: process.env.ICONOPLASM_ADMIN_TOKEN })
    : null
  const only = options.fromVerify ? symbolsFromVerifyReceipt(options.fromVerify) : options.only
  const receipt = await republishGeneObjects({
    symbols,
    post,
    execute: options.execute,
    from: options.from,
    limit: options.limit,
    only,
    batchSize: options.batch,
    concurrency: options.concurrency,
    allowEarlyReason: options.allowEarlyReason,
    canary: options.execute ? { fetchObject: cdnObjectFetcher() } : null,
    log: (line) => console.error(line),
  })
  if (options.execute && receipt.verify_sample.length) {
    receipt.verification = await verifyGeneObjects({
      symbols: receipt.verify_sample,
      fetchObject: cdnObjectFetcher(),
    })
  }
  receipt.args = { ...options, allowEarlyReason: options.allowEarlyReason ? "(given)" : null }
  receipt.file = writeReceipt(receiptDir, receipt)
  console.log(JSON.stringify(receipt, null, 2))
  if (!receipt.done && options.execute)
    console.error(
      `Not finished (${receipt.stopped ?? "limit"}). Resume with the same options plus --from ${receipt.next_from}. Every batch before that gene reached a final outcome.`,
    )
  if (receipt.failed.length) {
    console.error(
      `${receipt.failed.length} genes failed (first ${Math.min(20, receipt.failed.length)}: ${receipt.failed
        .slice(0, 20)
        .map((entry) => entry.symbol)
        .join(
          ",",
        )}). --from does not cover them. Run ${scriptName} --verify, then --execute --from-verify <its receipt>; the errors are in ${receipt.file}.`,
    )
    process.exitCode = 1
  }
  if (receipt.verification && !receipt.verification.clean) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
