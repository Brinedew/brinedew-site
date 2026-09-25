// B-846: rewrite the Bunny BLOT/{SYMBOL}.WEBP aliases from the current public
// catalog. Each gene's current blot comes from the same publication reader
// the gene page uses (free CDN reads); the Worker endpoint only copies that
// immutable file onto the alias and purges it (3 subrequests, no KV, no D1).
//
//   node scripts/refresh-blot-aliases.mjs --verify TP53 MET   # compare, write nothing
//   node scripts/refresh-blot-aliases.mjs TP53 MET            # refresh named genes
//   node scripts/refresh-blot-aliases.mjs --all [--start N]   # backfill every gene
//
// Needs ICONOPLASM_ADMIN_TOKEN for writes. Progress lands in
// artifacts/b-846/refresh-blot-aliases.jsonl; rerun with --start to resume.
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"

import { createIconoplasmPublicationReader } from "../quartz/static/iconoplasm/publication-reader.js"
import {
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "../workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const CDN = "https://iconoplasmportraits.b-cdn.net"
const BATCH = 10
const args = process.argv.slice(2)
const verify = args.includes("--verify")
const all = args.includes("--all")
const start = Number(args[args.indexOf("--start") + 1]) || 0
const named = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--start")

const reader = createIconoplasmPublicationReader({ fetchImpl: fetch })

async function json(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

async function allSymbols() {
  const head = await json(`${CDN}/api/public/v1/card-current`)
  const manifest = await json(
    `${CDN}/published-cards/v2/immutable/manifests/${head.current.replace(/^ccv2-/, "")}.json`,
  )
  const symbols = []
  for (const shard of manifest.shards) {
    for (const ref of shard.delivery_indexes || []) {
      const index = await json(`${CDN}/${ref.key}`)
      for (const entry of index.entries || []) symbols.push(entry[0])
    }
  }
  return symbols
}

// Mirrors the Worker's /blot resolver (resolveSemanticGeneBlot): the renderer
// key derived from the published card first, then the card's recorded blot.
async function blotKey(symbol) {
  const record = await reader.gene(symbol)
  if (record?.portrait?.status !== "published") return null
  const derived = iconoplasmGeneBlotObjectKey(symbol, iconoplasmGeneBlotFingerprint(record))
  if (derived && (await fetch(`${CDN}/${derived}`, { method: "HEAD" })).ok) return derived
  const url = record?.blot?.status === "ready" ? record.blot.canonical_url : null
  return url ? new URL(url).pathname.replace(/^\/+/, "") : null
}

async function sha(url) {
  const response = await fetch(url)
  if (!response.ok) return `http_${response.status}`
  return createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex")
    .slice(0, 12)
}

const symbols = all ? await allSymbols() : named.map((value) => value.toUpperCase())
if (verify) {
  for (const symbol of symbols) {
    const key = await blotKey(symbol)
    const catalog = key ? await sha(`${CDN}/${key}`) : "no_blot"
    const worker = await sha(`${ORIGIN}/blot/${encodeURIComponent(symbol)}.webp`)
    const alias = await sha(`${CDN}/BLOT/${symbol}.WEBP?cb=${Date.now()}`)
    console.log(`${symbol} catalog=${catalog} worker=${worker} alias=${alias}`)
  }
  process.exit(0)
}

const token = process.env.ICONOPLASM_ADMIN_TOKEN
if (!token) throw new Error("ICONOPLASM_ADMIN_TOKEN is required")
mkdirSync("artifacts/b-846", { recursive: true })
const log = "artifacts/b-846/refresh-blot-aliases.jsonl"
let ok = 0
let failed = 0
for (let index = start; index < symbols.length; index += BATCH) {
  const aliases = []
  for (const symbol of symbols.slice(index, index + BATCH)) {
    const key = await blotKey(symbol).catch(() => null)
    if (key) aliases.push({ symbol, blot_key: key })
  }
  if (!aliases.length) continue
  const response = await fetch(`${ORIGIN}/api/iconoplasm/admin/blot-aliases/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-iconoplasm-admin-token": token },
    body: JSON.stringify({ aliases }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error(`stopped at --start ${index}: HTTP ${response.status}`)
    process.exit(1)
  }
  for (const [symbol, result] of Object.entries(body.results || {})) {
    result.ok ? (ok += 1) : (failed += 1)
    appendFileSync(log, `${JSON.stringify({ index, symbol, ...result })}\n`)
  }
  if ((index / BATCH) % 20 === 0) console.log(`at ${index}/${symbols.length}: ok ${ok}, failed ${failed}`)
}
console.log(`done: ok ${ok}, failed ${failed}`)
