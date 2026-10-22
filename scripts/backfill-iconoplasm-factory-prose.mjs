#!/usr/bin/env node
// B-1156, one time: copy every factory text the site holds onto Bunny Storage,
// where workers/lib/iconoplasm-factory-prose.js keeps it from now on. New texts
// already go there on their way in (PUT /api/iconoplasm/admin/genes/:symbol/text);
// this covers the 20,155 that arrived before. Delete this script and its
// workflow once the prose column is gone from icono_gene_texts.
//
// It walks GET /api/iconoplasm/admin/texts?chosen=factory (about 101 pages of
// 200, about 20,000 D1 rows read, nothing written) and stores each text under its
// hash. A text already on Bunny costs one read, so a rerun resumes where a broken
// run stopped. Runs in GitHub Actions, which holds the storage password.
import { mkdirSync, writeFileSync } from "node:fs"

import { writeFactoryProse } from "../workers/lib/iconoplasm-factory-prose.js"
import { sha256Hex } from "../workers/lib/iconoplasm-sha256.js"

const SITE = "https://iconoplasm.brinedew.bio"
const PARALLEL = 8

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const env = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST: "storage.bunnycdn.com",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "iconoplasm-portraits",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: need(
    "ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD",
  ),
}
const adminToken = need("ICONOPLASM_ADMIN_TOKEN")

async function page(after) {
  const query = new URLSearchParams({ chosen: "factory", ...(after ? { after } : {}) })
  const response = await fetch(`${SITE}/api/iconoplasm/admin/texts?${query}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) {
    throw new Error(
      `texts page after ${after || "start"} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

const counts = { texts: 0, written: 0, already: 0, failed: 0 }
const failures = []

async function store(text) {
  try {
    if ((await sha256Hex(text.text)) !== text.text_sha256)
      throw new Error("text does not match its hash")
    const result = await writeFactoryProse(env, text.symbol, text.text)
    counts[result.written ? "written" : "already"] += 1
  } catch (error) {
    counts.failed += 1
    failures.push({ symbol: text.symbol, error: String(error?.message || error) })
  }
}

let after = null
do {
  const body = await page(after)
  counts.texts += body.texts.length
  for (let index = 0; index < body.texts.length; index += PARALLEL) {
    await Promise.all(body.texts.slice(index, index + PARALLEL).map(store))
  }
  after = body.next_after
  console.log(JSON.stringify({ after, ...counts }))
} while (after)

mkdirSync("artifacts/iconoplasm-factory-prose", { recursive: true })
writeFileSync(
  "artifacts/iconoplasm-factory-prose/backfill.json",
  JSON.stringify({ ...counts, failures }, null, 2),
)
console.log(JSON.stringify({ done: true, ...counts, failures: failures.slice(0, 20) }))
if (counts.failed) process.exit(1)
