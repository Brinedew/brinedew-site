#!/usr/bin/env node
// B-898 Stage 1 end-to-end check, runnable against production at any time:
//
//   node scripts/iconoplasm-stable-gene-e2e.mjs TP53 A1BG SOX11
//
// For each symbol it drives the real browser reader module twice: once as a
// visitor (stable object first) and once with the stable object forced to 404
// (the immutable tree the page used before). It records every request each
// path made, checks that the visitor path is exactly one CDN fetch that never
// touches the canonical origin, and that both paths agree on the symbol, the
// selected portrait and the candidate set. The result is written to
// artifacts/b-898-stable-gene-e2e/<timestamp>.json and the process exits
// non-zero on any disagreement, so the file is the repeatable artifact.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { createIconoplasmPublicationReader } from "../quartz/static/iconoplasm/publication-reader.js"

const CDN = "https://iconoplasmportraits.b-cdn.net"
const ORIGIN = "https://iconoplasm.brinedew.bio"
const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ["A1BG", "TP53", "SOX11"]

function recordingFetch(requests, { forceStable404 = false } = {}) {
  return async (url, init) => {
    const parsed = new URL(url)
    requests.push(parsed.origin + parsed.pathname)
    if (forceStable404 && parsed.pathname.startsWith("/genes/v3/")) {
      return new Response(null, { status: 404 })
    }
    return fetch(url, { ...init, cache: "no-store" })
  }
}

function candidateSet(record) {
  return (record?.portrait_candidates || [])
    .map((item) => String(item.asset_sha256 || "").toLowerCase())
    .sort()
}

const results = []
let failures = 0
for (const raw of symbols) {
  const symbol = String(raw).trim().toUpperCase()
  const visitorRequests = []
  const treeRequests = []
  const visitor = createIconoplasmPublicationReader({
    storage: null,
    fetchImpl: recordingFetch(visitorRequests),
  })
  const tree = createIconoplasmPublicationReader({
    storage: null,
    fetchImpl: recordingFetch(treeRequests, { forceStable404: true }),
  })
  const startedAt = Date.now()
  const [stableRecord, treeRecord] = await Promise.all([
    visitor.gene(symbol).catch((error) => ({ error: String(error?.message || error) })),
    tree.gene(symbol).catch((error) => ({ error: String(error?.message || error) })),
  ])
  const stablePool = stableRecord?.error ? null : await visitor.candidateGallery(stableRecord)
  const treePool = treeRecord?.error ? null : await tree.candidateGallery(treeRecord)
  const checks = {
    stable_object_served: stableRecord?.stable_object_version === 3,
    visitor_one_cdn_fetch:
      visitorRequests.length === 1 && visitorRequests[0] === `${CDN}/genes/v3/${symbol}.json`,
    visitor_never_hit_origin: visitorRequests.every((url) => !url.startsWith(ORIGIN)),
    same_symbol: stableRecord?.symbol === treeRecord?.symbol,
    same_portrait:
      String(stableRecord?.portrait?.asset_sha256 || "").toLowerCase() ===
      String(treeRecord?.portrait?.asset_sha256 || "").toLowerCase(),
    same_candidates:
      JSON.stringify(
        candidateSet(stablePool ? { portrait_candidates: stablePool.candidates } : null),
      ) ===
      JSON.stringify(candidateSet(treePool ? { portrait_candidates: treePool.candidates } : null)),
  }
  const ok = Object.values(checks).every(Boolean)
  if (!ok) failures += 1
  results.push({
    symbol,
    ok,
    checks,
    elapsed_ms: Date.now() - startedAt,
    stable: stableRecord?.error
      ? { error: stableRecord.error }
      : {
          published_at: stableRecord?.published_at,
          portrait: stableRecord?.portrait?.asset_sha256,
          candidate_count: stablePool?.count,
        },
    tree: treeRecord?.error
      ? { error: treeRecord.error }
      : { portrait: treeRecord?.portrait?.asset_sha256, candidate_count: treePool?.count },
    visitor_requests: visitorRequests,
    tree_request_count: treeRequests.length,
  })
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "b-898-stable-gene-e2e",
)
mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `${stamp}.json`)
const report = { ran_at: new Date().toISOString(), failures, results }
writeFileSync(outFile, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nartifact: ${outFile}`)
process.exit(failures ? 1 : 0)
