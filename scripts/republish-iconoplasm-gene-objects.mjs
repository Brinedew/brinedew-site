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
// (`admin_publication.republish`, eight genes a call) over the whole catalog. It
// is a one-shot, not a cron: delete it once `--verify` reports every object
// clean.
//
//   node scripts/republish-iconoplasm-gene-objects.mjs                      # dry run: the plan and its cost
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute            # rewrite every gene
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --from X   # resume at symbol X
//   node scripts/republish-iconoplasm-gene-objects.mjs --execute --only A,B # re-run named genes
//   node scripts/republish-iconoplasm-gene-objects.mjs --verify             # read every public object
//
// Dry run is the default and sends nothing to the Worker. `--execute` needs
// ICONOPLASM_ADMIN_TOKEN, refuses before 20:00 UTC unless an incident reason is
// given (AGENTS.md: spend the daily allowance at the end of the UTC day), stops
// after too many failed genes, prints where to resume, and writes a receipt to
// artifacts/iconoplasm-republish/. Every run is idempotent: the route rewrites a
// gene from D1 and the authoring store as they stand.
import { mkdirSync, writeFileSync } from "node:fs"
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

export function createRoutePoster({ origin = ORIGIN, token, fetchImpl = fetch } = {}) {
  const bearer = String(token ?? "").trim()
  if (!bearer) throw fail("ADMIN_TOKEN_MISSING", "set ICONOPLASM_ADMIN_TOKEN to execute")
  return async function post(symbols) {
    const response = await fetchImpl(`${origin}/api/iconoplasm/admin/publication/republish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

function sweepCost(count) {
  return {
    worker_requests: Math.ceil(count / REPUBLISH_MAX_SYMBOLS),
    bunny_storage_puts: count,
    bunny_storage_reads: count * 2,
    bunny_purge_calls: count,
    d1_rows_read_estimate: count * D1_ROWS_READ_PER_GENE,
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
  concurrency = 3,
  maxFailures = 10,
  retryDelayMs = 2000,
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
  if (only && from) throw fail("ONLY_AND_FROM", "--only and --from cannot be combined")

  let plan
  if (only) {
    const known = new Set(symbols)
    const unknown = only.filter((symbol) => !known.has(symbol))
    if (unknown.length)
      throw fail("ONLY_UNKNOWN_SYMBOL", `not in the catalog: ${unknown.join(", ")}`)
    plan = [...new Set(only)].sort()
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
    published: 0,
    failed: [],
    calls: 0,
    stopped: null,
    early_reason: execute && early ? String(allowEarlyReason).trim() : null,
    cost: sweepCost(targets.length),
    next_from: targets[0] ?? null,
    done: false,
    verify_sample: [],
  }
  if (!execute) return receipt

  const batches = []
  for (let index = 0; index < targets.length; index += REPUBLISH_MAX_SYMBOLS)
    batches.push(targets.slice(index, index + REPUBLISH_MAX_SYMBOLS))

  const rewritten = []
  async function attempt(batch) {
    receipt.calls += 1
    try {
      const reply = await post(batch)
      if (reply?.status === 200 && reply.body?.ok === true && Array.isArray(reply.body.results))
        return { ok: true, results: reply.body.results }
      return {
        ok: false,
        error: `HTTP ${reply?.status}: ${JSON.stringify(reply?.body ?? null).slice(0, 200)}`,
      }
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 200) }
    }
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

  async function runBatch(batch) {
    let outcome = await attempt(batch)
    if (!outcome.ok) {
      await sleep(retryDelayMs)
      outcome = await attempt(batch)
    }
    if (outcome.ok) return record(batch, outcome.results)
    if (batch.length === 1) {
      receipt.failed.push({ symbol: batch[0], error: outcome.error })
      return
    }
    // A call that fails twice may be too heavy for a cold isolate: send the
    // genes one at a time, once each.
    for (const symbol of batch) {
      const single = await attempt([symbol])
      if (single.ok) record([symbol], single.results)
      else receipt.failed.push({ symbol, error: single.error })
    }
  }

  let launched = 0
  // The first batch goes alone and is read back from the CDN. A sweep started
  // before the fixed Worker is deployed would rewrite every gene with its Tags
  // again, so Tags still published stop the run after this one call.
  if (canary && batches.length) {
    launched = 1
    await runBatch(batches[0])
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
      const batch = batches[launched]
      launched += 1
      await runBatch(batch)
      log(`${receipt.published}/${targets.length} rewritten, ${receipt.failed.length} failed`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker))

  const firstFailure = receipt.failed.map((entry) => entry.symbol).sort()[0] ?? null
  if (receipt.stopped === "too_many_failures") receipt.next_from = firstFailure
  else if (receipt.stopped) receipt.next_from = targets[0]
  else receipt.next_from = afterTargets
  receipt.done = receipt.next_from === null
  receipt.verify_sample = evenlySpaced([...rewritten].sort(), 40)
  receipt.elapsed_seconds = Math.round((Date.now() - startedMs) / 1000)
  return receipt
}

export async function verifyGeneObjects({
  symbols,
  fetchObject,
  sleep = defaultSleep,
  retries = 6,
  retryDelayMs = 10_000,
  concurrency = 8,
}) {
  const carrying = []
  const missing = []
  const unreadable = []

  async function check(symbol) {
    let last = null
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(retryDelayMs)
      let reply
      try {
        reply = await fetchObject(symbol, attempt)
      } catch {
        last = unreadable
        continue
      }
      if (reply?.status === 200 && reply.json && typeof reply.json === "object") {
        if (!objectCarriesTags(reply.json)) return
        last = carrying
      } else if (reply?.status === 404) {
        last = missing
      } else {
        last = unreadable
      }
    }
    last?.push(symbol)
  }

  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
      while (next < symbols.length) {
        const symbol = symbols[next]
        next += 1
        await check(symbol)
      }
    }),
  )
  carrying.sort()
  missing.sort()
  unreadable.sort()
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
      { cache: "no-store" },
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
    concurrency: 3,
    allowEarlyReason: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === "--execute") parsed.execute = true
    else if (flag === "--verify") parsed.verify = true
    else if (
      ["--from", "--limit", "--only", "--concurrency", "--allow-early", "--verify-sample"].includes(
        flag,
      )
    ) {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      if (flag === "--from") parsed.from = symbolValue(flag, value)
      else if (flag === "--limit") parsed.limit = wholeNumber(flag, value, { min: 1 })
      else if (flag === "--concurrency")
        parsed.concurrency = wholeNumber(flag, value, { min: 1, max: MAX_CONCURRENCY })
      else if (flag === "--verify-sample")
        parsed.verifySample = wholeNumber(flag, value, { min: 1 })
      else if (flag === "--allow-early") parsed.allowEarlyReason = String(value)
      else {
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

  if (options.verify) {
    const sample = options.verifySample ? evenlySpaced(symbols, options.verifySample) : symbols
    const result = await verifyGeneObjects({ symbols: sample, fetchObject: cdnObjectFetcher() })
    const receipt = { mode: "verify", started_at: new Date().toISOString(), ...result }
    receipt.file = writeReceipt(receiptDir, receipt)
    console.log(
      JSON.stringify({ ...receipt, carrying_tags: receipt.carrying_tags.slice(0, 50) }, null, 2),
    )
    if (!result.clean) process.exitCode = 1
    return
  }

  const post = options.execute
    ? createRoutePoster({ token: process.env.ICONOPLASM_ADMIN_TOKEN })
    : null
  const receipt = await republishGeneObjects({
    symbols,
    post,
    execute: options.execute,
    from: options.from,
    limit: options.limit,
    only: options.only,
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
    console.error(`Not finished. Resume with --execute --from ${receipt.next_from}`)
  if (receipt.failed.length) {
    console.error(
      `Failed genes: ${receipt.failed.map((entry) => entry.symbol).join(",")}. Re-run them with --execute --only <list>`,
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
