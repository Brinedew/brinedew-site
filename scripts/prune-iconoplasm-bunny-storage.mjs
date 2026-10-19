#!/usr/bin/env node
// B-1087: deletes the Bunny storage objects that nothing can show a reader, so storage stops
// pushing the bill past Bunny's $1 monthly minimum. Storage is billed by the byte, immutable
// keys are never overwritten, and before this nothing ever deleted one.
//
//   ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD=... node scripts/prune-iconoplasm-bunny-storage.mjs
//     [--listing <walk.tsv>] [--apply] [--backup <dir>] [--ledger <file.tsv>]
//
// A dry run (the default) prints what each rule would delete. --apply deletes, first copying each
// portrait it deletes into --backup (required with --apply): the Never-lose list keeps images
// even when no reader can see them. The Storage API charges nothing for listing, reading or
// deleting (bunny.net/pricing/storage, "No API fees", "Free API egress").
//
// What goes:
// 1. Retired prefixes nothing reads: published-cards/ (the immutable card tree; the extension
//    stopped reading it in 0.5.9 and the site's minimum extension version is 0.5.9), blot/ and
//    BLOT/ (the /blot alias retired in B-846), portraits/tmp/ (abandoned upload staging).
// 2. Superseded catalogue dumps: every public-dumps/ file except the one the live public
//    metadata names.
// 3. Portraits (portraits/v1/) whose image no database row names (an asset, a person's edit or
//    generation request, a generation job) and no published gene object names, created at least a
//    day before the nightly copy the rows come from, so a row written after that copy can't be
//    missed. Their rows were removed, so no reader can reach them.
// Everything else stays. Old blots (blots/v1/ and blots/v2/) stay even when no gene uses them: the
// developers page promises embedders that a blot's CDN address "never changes" (2,939 v1 blots,
// 0.4 GB, measured 2026-10-17; each v2 blot is about 60 KB).
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"

import { DEFAULT_BACKUP_ROOT, findNewestDump, unpackDump } from "./d1-local.mjs"

const ZONE = "iconoplasm-portraits"
const STORAGE = `https://storage.bunnycdn.com/${ZONE}/`
const METADATA = "https://iconoplasm.brinedew.bio/api/public/v1/metadata"
const RETIRED_PREFIXES = Object.freeze(["published-cards/", "blot/", "BLOT/", "portraits/tmp/"])
const REFERENCED_PREFIXES = Object.freeze(["portraits/v1/"])
const REFERENCED_KEY = /portraits\/v1\/[A-Za-z0-9/_.-]+\.(?:webp|png|jpe?g)/g
const DAY_MS = 86_400_000

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}
const apply = args.includes("--apply")
const backupDir = option("--backup")
const ledgerPath = option("--ledger")
const key = String(process.env.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD || "").trim()
if (!key) throw new Error("Missing ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD")
if (apply && !backupDir)
  throw new Error("--apply needs --backup <dir> for the portraits it deletes")

async function storage(pathname, init = {}, attempt = 0) {
  try {
    const response = await fetch(STORAGE + pathname, {
      ...init,
      headers: { AccessKey: key, Accept: "application/json", ...(init.headers || {}) },
    })
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`${init.method || "GET"} ${pathname}: ${response.status}`)
    }
    return response
  } catch (error) {
    if (attempt >= 5) throw error
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
    return storage(pathname, init, attempt + 1)
  }
}

async function pool(items, size, work) {
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await work(items[next++])
    }),
  )
}

// Every file in the zone: [key, bytes, created ms].
async function walk() {
  const files = []
  const queue = [""]
  let active = 0
  await new Promise((done, fail) => {
    const pump = () => {
      while (active < 32 && queue.length) {
        const dir = queue.shift()
        active++
        storage(dir)
          .then(async (response) => {
            if (!response.ok) throw new Error(`list ${dir}: ${response.status}`)
            for (const item of await response.json()) {
              const name = dir + item.ObjectName
              if (item.IsDirectory) queue.push(name + "/")
              else files.push([name, Number(item.Length), Date.parse(item.DateCreated + "Z")])
            }
          })
          .then(() => {
            active--
            if (!active && !queue.length) done()
            else pump()
          }, fail)
      }
    }
    pump()
  })
  return files
}

function readListing(file) {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, bytes, created] = line.split("\t")
      return [name, Number(bytes), Date.parse(created.endsWith("Z") ? created : created + "Z")]
    })
}

// The keys the newest nightly copy's rows name, and that copy's date.
async function referencedByRows() {
  const dump = findNewestDump({
    root: process.env.D1_BACKUP_ROOT || DEFAULT_BACKUP_ROOT,
    database: "iconoplasm",
  })
  const file = await unpackDump(dump, path.join(tmpdir(), "brinedew-d1-local"))
  const db = new DatabaseSync(file, { readOnly: true })
  const keys = new Set()
  for (const sql of [
    "SELECT r2_key_full AS k FROM icono_portrait_assets",
    "SELECT r2_key_medium AS k FROM icono_portrait_assets",
    "SELECT r2_key_thumb AS k FROM icono_portrait_assets",
    "SELECT result_r2_key_full AS k FROM icono_image_edit_jobs",
    "SELECT result_r2_key_medium AS k FROM icono_image_edit_jobs",
    "SELECT result_r2_key_thumb AS k FROM icono_image_edit_jobs",
  ]) {
    for (const row of db.prepare(sql).all()) if (row.k) keys.add(String(row.k))
  }
  // Images named only by their hash: every size of that image stays.
  const shas = new Set()
  for (const sql of [
    "SELECT asset_sha256 AS s FROM icono_portrait_assets",
    "SELECT result_asset_sha256 AS s FROM icono_image_edit_jobs",
    "SELECT fulfilled_asset_sha256 AS s FROM icono_generation_requests",
    "SELECT result_asset_sha256 AS s FROM icono_candidate_generation_jobs",
  ]) {
    for (const row of db.prepare(sql).all()) if (row.s) shas.add(String(row.s).toLowerCase())
  }
  db.close()
  return { keys, shas, dumpDate: Date.parse(`${dump.date}T00:00:00Z`), dumpName: dump.date }
}

// The keys the published gene objects name: what readers are shown right now.
async function referencedByGeneObjects(files) {
  const keys = new Set()
  const objects = files.filter(([name]) => /^genes\/v3\/[^/]+\.json$/.test(name)).map(([n]) => n)
  await pool(objects, 32, async (name) => {
    const response = await storage(name)
    if (!response.ok) throw new Error(`read ${name}: ${response.status}`)
    for (const match of (await response.text()).matchAll(REFERENCED_KEY)) keys.add(match[0])
  })
  return { keys, objects: objects.length }
}

function classify(files, { rowKeys, rowShas, objectKeys, dumpDate, currentDump }) {
  const doomed = []
  for (const [name, bytes, created] of files) {
    let rule = null
    if (RETIRED_PREFIXES.some((prefix) => name.startsWith(prefix))) rule = "retired prefix"
    else if (name.startsWith("public-dumps/") && name !== currentDump) rule = "superseded dump"
    else if (
      REFERENCED_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
      !rowKeys.has(name) &&
      !rowShas.has(name.split("/")[3]) &&
      !objectKeys.has(name) &&
      created < dumpDate - DAY_MS
    )
      rule = "unreferenced portrait"
    if (rule) doomed.push({ name, bytes, rule })
  }
  return doomed
}

const files = option("--listing") ? readListing(option("--listing")) : await walk()
const rows = await referencedByRows()
const objects = await referencedByGeneObjects(files)
const metadata = await (await fetch(METADATA)).json()
if (!/^[0-9a-f]{12}$/.test(String(metadata?.catalog_hash || ""))) {
  throw new Error("Live metadata names no catalogue dump; refusing to judge public-dumps/")
}
const currentDump = `public-dumps/catalog.${metadata.catalog_hash}.jsonl`
if (!files.some(([name]) => name === currentDump)) {
  throw new Error(`The live dump ${currentDump} is not in the listing; refusing`)
}
// A gene object naming a key that isn't stored, or a row set far smaller than what readers are
// shown, means the inputs are wrong: stop rather than delete on them.
if (rows.keys.size < objects.keys.size) {
  throw new Error(
    `Rows name ${rows.keys.size} keys but gene objects ${objects.keys.size}; refusing`,
  )
}
const doomed = classify(files, {
  rowKeys: rows.keys,
  rowShas: rows.shas,
  objectKeys: objects.keys,
  dumpDate: rows.dumpDate,
  currentDump,
})

const total = (list) => list.reduce((sum, item) => sum + item.bytes, 0)
const byRule = {}
for (const item of doomed) {
  byRule[item.rule] ||= { files: 0, bytes: 0 }
  byRule[item.rule].files++
  byRule[item.rule].bytes += item.bytes
}
const stored = files.reduce((sum, [, bytes]) => sum + bytes, 0)
console.log(
  JSON.stringify(
    {
      zone_files: files.length,
      zone_gb: +(stored / 1e9).toFixed(3),
      nightly_copy: rows.dumpName,
      row_keys: rows.keys.size,
      gene_objects: objects.objects,
      gene_object_keys: objects.keys.size,
      current_dump: currentDump,
      delete: Object.fromEntries(
        Object.entries(byRule).map(([rule, sum]) => [
          rule,
          { files: sum.files, gb: +(sum.bytes / 1e9).toFixed(3) },
        ]),
      ),
      delete_gb: +(total(doomed) / 1e9).toFixed(3),
      keep_gb: +((stored - total(doomed)) / 1e9).toFixed(3),
      apply,
    },
    null,
    2,
  ),
)

if (apply) {
  const ledger = ledgerPath || path.join(backupDir, "deleted.tsv")
  mkdirSync(path.dirname(ledger), { recursive: true })
  writeFileSync(ledger, "key\tbytes\trule\n")
  let deleted = 0
  const failed = []
  await pool(doomed, 16, async (item) => {
    try {
      await prune(item)
    } catch (error) {
      // One object Bunny keeps refusing doesn't stop the rest; the run reports it and fails.
      failed.push(item.name)
      console.error(String(error?.message || error))
    }
  })
  async function prune(item) {
    if (item.name.startsWith("portraits/v1/")) {
      const target = path.join(backupDir, ...item.name.split("/"))
      mkdirSync(path.dirname(target), { recursive: true })
      const response = await storage(item.name, { headers: { Accept: "*/*" } })
      if (!response.ok) throw new Error(`backup ${item.name}: ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length !== item.bytes) throw new Error(`backup ${item.name}: short read`)
      await new Promise((resolve, reject) =>
        createWriteStream(target).on("error", reject).end(bytes, resolve),
      )
    }
    const response = await storage(item.name, { method: "DELETE" })
    if (!response.ok && response.status !== 404) {
      throw new Error(`delete ${item.name}: ${response.status}`)
    }
    appendFileSync(ledger, `${item.name}\t${item.bytes}\t${item.rule}\n`)
    if (++deleted % 5000 === 0) console.log(`deleted ${deleted} of ${doomed.length}`)
  }
  console.log(
    `deleted ${deleted} of ${doomed.length} files; ${failed.length} refused; ledger ${ledger}`,
  )
  if (failed.length) process.exitCode = 1
}
