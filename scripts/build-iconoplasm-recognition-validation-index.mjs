#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { buildIconoplasmRecognitionValidationIndex } from "../workers/iconoplasm-recognition-validation-index.js"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)

function argument(name, fallback = null) {
  const index = args.indexOf(name)
  return index >= 0 ? String(args[index + 1] || "") : fallback
}

const manifestUrl = argument(
  "--manifest-url",
  "https://iconoplasm.brinedew.bio/api/public/v1/catalog/manifest",
)
const output = argument("--output")
if (!output) throw new Error("--output is required")

const manifestResponse = await fetch(manifestUrl, { headers: { accept: "application/json" } })
if (!manifestResponse.ok) {
  throw new Error(`Catalog manifest returned HTTP ${manifestResponse.status}`)
}
const manifest = await manifestResponse.json()
const scannerVersion = String(manifest?.scanner_artifact?.build_version || "").trim()
const scannerUrl = new URL(String(manifest?.scanner_artifact?.artifact_url || ""), manifestUrl).href
if (!scannerVersion || !scannerUrl) throw new Error("Catalog manifest has no scanner artifact")

const scannerResponse = await fetch(scannerUrl, { headers: { accept: "application/json" } })
if (!scannerResponse.ok) throw new Error(`Scanner artifact returned HTTP ${scannerResponse.status}`)
const scanner = await scannerResponse.json()
if (!scanner?.genes || typeof scanner.genes !== "object" || Array.isArray(scanner.genes)) {
  throw new Error("Scanner artifact has no genes object")
}

const index = buildIconoplasmRecognitionValidationIndex(scanner.genes, { scannerVersion })
const entries = [
  ...index.shards.map((shard) => ({ key: shard.key, value: shard.value })),
  { key: index.manifestKey, value: index.manifestValue },
]
const target = resolve(repoRoot, output)
await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(entries)}\n`, "utf8")
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    scanner_version: scannerVersion,
    canonical_count: index.manifest.canonical_count,
    collision_key_count: index.manifest.collision_key_count,
    published_key_count: index.manifest.published_key_count,
    shard_count: index.manifest.shard_count,
    max_shard_bytes: Math.max(...index.manifest.shard_byte_sizes),
    output: target,
  })}\n`,
)
