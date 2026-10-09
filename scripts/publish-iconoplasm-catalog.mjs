#!/usr/bin/env node
// B-898 Stage 1: THE ONLY builder of catalog/v3/index.json, the one stable
// catalog object the home, gallery and search pages read from the free CDN.
//
//   node scripts/publish-iconoplasm-catalog.mjs            # incremental
//   node scripts/publish-iconoplasm-catalog.mjs --full     # every gene
//   node scripts/publish-iconoplasm-catalog.mjs --dry-run  # build, no upload
//
// Runs in GitHub Actions (.github/workflows/publish-iconoplasm-catalog.yml).
// Reads D1 through the Cloudflare REST API with the deploy token, builds the
// object in Node (a free-plan Worker request has 10 ms of CPU, this needs all
// 19k genes), and hands the bytes to the Worker's admin route, which holds the
// Bunny storage password and purges the CDN URL. Incremental runs read the
// previous object from the CDN and only the genes with a publication-affecting
// event since that object's watermark (a winner or candidate change; a vote
// republishes its own gene's stable object in the Worker).
//
// Object shape (schema 3): { schema, generated_at, watermark_event_id, genes }
// where each gene row is
//   [symbol, full_name (the gene's HGNC name, iconoplasmGeneName), portrait_sha256 | "", color_hex | "", image_score,
//    uniqueness_rank | null, weight_kg | null, age_years | null,
//    first_publication_year | null, published_at | ""]
import { mkdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { PUBLICATION_AFFECTING_ACTIONS } from "../workers/iconoplasm-catalog-dispatch.js"
import { iconoplasmGeneName } from "../workers/lib/iconoplasm-gene-name.js"

const CDN = "https://iconoplasmportraits.b-cdn.net"
const ORIGIN = "https://iconoplasm.brinedew.bio"
const KEY = "catalog/v3/index.json"
const D1_DATABASE_ID = "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff" // production ICONOPLASM_DB (wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml)
const PAGE = 2000
const MAX_INCREMENTAL_SYMBOLS = 2000
// A gene is listed only once it has a card: publishIconoplasmGeneStableObject adds its
// icono_published_gene_routes row after writing genes/v3/<SYMBOL>.json, and a withdrawal
// deletes it. On 2026-10-09 the catalogue delivery listed 604 new genes while 599 of
// their cards failed ("Canonical manifestation projection was not found"), so readers
// found ~600 genes whose page said "Page not found". Such a gene joins the list when its
// text arrives: the manifestation wake writes manifestation_canonical_changed, which
// republishes the card and dirties the gene for the next run.
export const ROW_SQL = `
  SELECT gc.gene_symbol AS symbol,
         gc.full_name AS catalog_full_name,
         CASE WHEN pa.asset_sha256 IS NOT NULL THEN ps.current_asset_sha256 ELSE '' END AS portrait_sha256,
         COALESCE(gc.color_hex, '') AS color_hex,
         COALESCE(vs.score, 0) AS image_score,
         ge.leakage_percent AS uniqueness_rank,
         ge.weight_kg,
         ge.age_years,
         ge.first_publication_year,
         COALESCE(pa.created_at, '') AS published_at
    FROM icono_gene_catalog gc
    JOIN icono_published_gene_routes pr ON pr.gene_symbol = gc.gene_symbol
    LEFT JOIN icono_gene_essence ge ON ge.gene_symbol = gc.gene_symbol
    LEFT JOIN icono_publish_state ps ON ps.gene_symbol = gc.gene_symbol
    LEFT JOIN icono_portrait_assets pa
      ON pa.gene_symbol = gc.gene_symbol AND pa.asset_sha256 = ps.current_asset_sha256
    LEFT JOIN icono_vote_asset_summary vs
      ON vs.gene_symbol = gc.gene_symbol AND vs.asset_sha256 = ps.current_asset_sha256`

const args = new Set(process.argv.slice(2))
const FULL = args.has("--full")
const DRY_RUN = args.has("--dry-run")

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function d1(sql, params = []) {
  const account = need("CLOUDFLARE_ACCOUNT_ID")
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true) {
    throw new Error(`D1 query failed (${response.status}): ${JSON.stringify(body?.errors || body)}`)
  }
  const first = Array.isArray(body.result) ? body.result[0] : null
  return { rows: first?.results || [], meta: first?.meta || {} }
}

function nullableNumber(value) {
  const number = Number(value)
  return value === null || value === undefined || value === "" || !Number.isFinite(number)
    ? null
    : number
}

export function geneRow(row) {
  const symbol = String(row.symbol || "").toUpperCase()
  return [
    symbol,
    iconoplasmGeneName(row.catalog_full_name, symbol),
    /^[a-f0-9]{64}$/i.test(String(row.portrait_sha256 || ""))
      ? String(row.portrait_sha256).toLowerCase()
      : "",
    String(row.color_hex || ""),
    Number(row.image_score || 0),
    nullableNumber(row.uniqueness_rank),
    nullableNumber(row.weight_kg),
    nullableNumber(row.age_years),
    nullableNumber(row.first_publication_year),
    String(row.published_at || ""),
  ]
}

async function readAllRows() {
  const rows = []
  let after = ""
  let reads = 0
  for (;;) {
    const page = await d1(
      `${ROW_SQL}\n   WHERE gc.gene_symbol > ?\n   ORDER BY gc.gene_symbol ASC LIMIT ${PAGE}`,
      [after],
    )
    reads += Number(page.meta.rows_read || 0)
    rows.push(...page.rows.map(geneRow))
    if (page.rows.length < PAGE) break
    after = page.rows.at(-1).symbol
  }
  return { rows, reads }
}

async function readRowsFor(symbols) {
  const rows = []
  let reads = 0
  for (let index = 0; index < symbols.length; index += 90) {
    const batch = symbols.slice(index, index + 90)
    const page = await d1(
      `${ROW_SQL}\n   WHERE gc.gene_symbol IN (${batch.map(() => "?").join(",")})`,
      batch,
    )
    reads += Number(page.meta.rows_read || 0)
    rows.push(...page.rows.map(geneRow))
  }
  return { rows, reads }
}

async function highWater() {
  const { rows } = await d1(
    `SELECT COALESCE(MAX(id), 0) AS id FROM icono_publish_events WHERE action IN (${PUBLICATION_AFFECTING_ACTIONS.map(() => "?").join(",")})`,
    PUBLICATION_AFFECTING_ACTIONS,
  )
  return Number(rows[0]?.id || 0)
}

async function dirtySymbolsSince(watermark) {
  const { rows, meta } = await d1(
    `SELECT DISTINCT gene_symbol FROM icono_publish_events
      WHERE id > ? AND action IN (${PUBLICATION_AFFECTING_ACTIONS.map(() => "?").join(",")})
      LIMIT ${MAX_INCREMENTAL_SYMBOLS + 1}`,
    [watermark, ...PUBLICATION_AFFECTING_ACTIONS],
  )
  return {
    symbols: rows.map((row) => String(row.gene_symbol || "").toUpperCase()),
    reads: Number(meta.rows_read || 0),
  }
}

async function previousObject() {
  const response = await fetch(`${CDN}/${KEY}?cb=${Date.now()}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Previous catalog object GET failed (${response.status})`)
  const value = await response.json()
  if (value?.schema !== 3 || !Array.isArray(value.genes)) return null
  return value
}

function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(value), "utf8")
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

// B-898 (deletion stage): before the catalog is rebuilt, every changed gene
// gets its stable object rewritten by the Worker, which alone can read the
// authoring store. A gene that fails is reported, never silently skipped, so the
// catalog row and the gene object are rebuilt from the same D1 state.
//
// B-1055: one catalogue delivery dirties a thousand genes at once (613 removed and
// 604 added on 2026-10-09). At eight genes a call about one call in five dies at
// the free plan's 10 ms CPU cap (3,521 of 16,979 on 2026-10-03), so two tries per
// batch made a 150-call run all but certain to throw, and with its watermark held
// every later run would retry the same genes and throw again, freezing the catalog.
// The operator sweep's policy came through 17k genes that night: four genes a call,
// two retries with backoff, then one gene a call. Only a gene that fails all of that
// fails the run, which then repeats on the next dispatch.
export const REPUBLISH_BATCH_SYMBOLS = 4
export const REPUBLISH_RETRY_DELAYS_MS = Object.freeze([2000, 5000])

async function postRepublish(symbols) {
  const response = await fetch(`${ORIGIN}/api/iconoplasm/admin/publication/republish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${need("ICONOPLASM_ADMIN_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbols }),
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok && body?.ok === true, status: response.status, body }
}

export async function republishGenes(
  symbols,
  {
    post = postRepublish,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    batchSize = REPUBLISH_BATCH_SYMBOLS,
    retryDelaysMs = REPUBLISH_RETRY_DELAYS_MS,
  } = {},
) {
  const failed = []
  let published = 0
  let calls = 0
  async function attempt(batch) {
    let last = null
    for (let tryIndex = 0; tryIndex <= retryDelaysMs.length; tryIndex += 1) {
      if (tryIndex > 0) await sleep(retryDelaysMs[tryIndex - 1])
      calls += 1
      last = await post(batch).catch((error) => ({ ok: false, status: 0, body: String(error) }))
      if (last.ok) return { reply: last.body, last }
    }
    return { reply: null, last }
  }
  for (let index = 0; index < symbols.length; index += batchSize) {
    const batch = symbols.slice(index, index + batchSize)
    const replies = []
    const whole = await attempt(batch)
    if (whole.reply) replies.push(whole.reply)
    else {
      for (const symbol of batch) {
        const single = batch.length > 1 ? await attempt([symbol]) : whole
        if (!single.reply)
          throw new Error(
            `Republish of ${symbol} failed after retries (${single.last?.status}): ${JSON.stringify(single.last?.body)}`,
          )
        replies.push(single.reply)
      }
    }
    for (const reply of replies) {
      published += Number(reply.published || 0)
      for (const result of reply.results || []) if (result.ok !== true) failed.push(result)
    }
  }
  return { published, failed, calls }
}

async function upload(bytes) {
  const response = await fetch(`${ORIGIN}/api/iconoplasm/admin/publication/catalog-object`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${need("ICONOPLASM_ADMIN_TOKEN")}`,
      "Content-Type": "application/json",
      "Content-Length": String(bytes.byteLength),
    },
    body: bytes,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Catalog upload failed (${response.status}): ${JSON.stringify(body)}`)
  }
  return body
}

// The purge is asynchronous on Bunny's side; poll the public URL until the
// exact bytes are served, bounded, so the receipt states what readers get.
async function verifyOnCdn(expectedHash, { attempts = 18, delayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(`${CDN}/${KEY}`, { cache: "no-store" })
    if (response.ok) {
      const hash = sha256(Buffer.from(await response.arrayBuffer()))
      if (hash === expectedHash) return { verified: true, attempt }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return { verified: false, attempt: attempts }
}

async function main() {
  const startedAt = new Date()
  const receipt = { started_at: startedAt.toISOString(), mode: FULL ? "full" : "incremental" }
  const watermark = await highWater()
  receipt.watermark_event_id = watermark
  const previous = FULL ? null : await previousObject()
  let genes
  let reads = 0
  if (!previous) {
    receipt.mode = previous === null && !FULL ? "full (no previous object)" : receipt.mode
    const all = await readAllRows()
    genes = all.rows
    reads += all.reads
  } else {
    const dirty = await dirtySymbolsSince(Number(previous.watermark_event_id || 0))
    reads += dirty.reads
    receipt.previous_watermark_event_id = Number(previous.watermark_event_id || 0)
    receipt.dirty_symbols = dirty.symbols.length
    if (!dirty.symbols.length && Number(previous.watermark_event_id || 0) === watermark) {
      receipt.result = "unchanged"
      receipt.d1_rows_read = reads
      finish(receipt)
      return
    }
    if (dirty.symbols.length > MAX_INCREMENTAL_SYMBOLS) {
      receipt.mode = `full (${dirty.symbols.length} dirty symbols)`
      const all = await readAllRows()
      genes = all.rows
      reads += all.reads
    } else {
      if (!DRY_RUN) receipt.republish = await republishGenes(dirty.symbols)
      const changed = await readRowsFor(dirty.symbols)
      reads += changed.reads
      const bySymbol = new Map(previous.genes.map((row) => [row[0], row]))
      for (const symbol of dirty.symbols) bySymbol.delete(symbol) // a deleted gene disappears
      for (const row of changed.rows) bySymbol.set(row[0], row)
      genes = [...bySymbol.values()]
    }
  }
  genes.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const object = {
    schema: 3,
    generated_at: new Date().toISOString(),
    watermark_event_id: watermark,
    genes,
  }
  const bytes = canonicalBytes(object)
  const hash = sha256(bytes)
  Object.assign(receipt, {
    d1_rows_read: reads,
    gene_count: genes.length,
    with_portrait: genes.filter((row) => row[2]).length,
    bytes: bytes.byteLength,
    sha256: hash,
  })
  if (DRY_RUN) {
    receipt.result = "dry-run"
    finish(receipt, bytes)
    return
  }
  const uploaded = await upload(bytes)
  receipt.upload = uploaded
  receipt.cdn = await verifyOnCdn(hash)
  receipt.result = receipt.cdn.verified
    ? "published"
    : "uploaded, CDN not yet serving the new bytes"
  finish(receipt)
  if (!receipt.cdn.verified) process.exitCode = 1
}

function finish(receipt, bytes = null) {
  receipt.finished_at = new Date().toISOString()
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "artifacts",
    "iconoplasm-catalog",
  )
  mkdirSync(dir, { recursive: true })
  const stamp = receipt.started_at.replace(/[:.]/g, "-")
  writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(receipt, null, 2))
  if (bytes) writeFileSync(path.join(dir, `${stamp}.index.json`), bytes)
  console.log(JSON.stringify(receipt, null, 2))
}

// Importable by the tests that prove the row shape; only a direct run publishes.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || String(error))
    process.exit(1)
  })
}
