#!/usr/bin/env node
// B-898 Stage 2, step 1: copy every vote coordinator's votes and summaries
// into D1 so D1 is the one copy before the coordinators are deleted.
//
//   node scripts/export-iconoplasm-votes-to-d1.mjs            # list + export
//   node scripts/export-iconoplasm-votes-to-d1.mjs --list-only
//
// Lists the existing IconoplasmVoteCoordinator objects through the Cloudflare
// API (so no coordinator is created by the sweep), then asks the Worker to
// export them ten at a time (POST /admin/votes/export-to-d1). Writes the
// receipt to artifacts/b-898-stage2/<timestamp>.json. Cost, measured
// 2026-10-02: 2,683 objects, so about 2,700 Durable Object requests, about
// 5,400 D1 statements, and D1 writes only where the coordinator and D1 differ.
// Run it late in the UTC day.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const CLASS = "IconoplasmVoteCoordinator"
const SCRIPT = "geneguessr-api"

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function cf(pathname) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}${pathname}`,
    {
      headers: { Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}` },
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true)
    throw new Error(
      `Cloudflare API ${pathname} failed (${response.status}): ${JSON.stringify(body?.errors || body)}`,
    )
  return body
}

async function listObjectIds() {
  const namespaces = (await cf("/workers/durable_objects/namespaces")).result || []
  const namespace = namespaces.find((item) => item.class === CLASS && item.script === SCRIPT)
  if (!namespace) throw new Error(`No ${CLASS} namespace on ${SCRIPT}`)
  const ids = []
  let cursor = ""
  for (;;) {
    const page = await cf(
      `/workers/durable_objects/namespaces/${namespace.id}/objects?limit=1000${cursor ? `&cursor=${cursor}` : ""}`,
    )
    for (const item of page.result || []) if (item.hasStoredData) ids.push(item.id)
    cursor = page.result_info?.cursor || ""
    if (!cursor) break
  }
  return { namespace: namespace.id, ids }
}

async function exportBatch(ids) {
  const response = await fetch(`${ORIGIN}/api/iconoplasm/admin/votes/export-to-d1`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${need("ICONOPLASM_ADMIN_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ object_ids: ids }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true)
    throw new Error(`Export failed (${response.status}): ${JSON.stringify(body)}`)
  return body.results
}

const receipt = { started_at: new Date().toISOString() }
const { namespace, ids } = await listObjectIds()
Object.assign(receipt, { namespace, objects: ids.length })
console.log(`${ids.length} coordinators listed`)
const results = []
if (!process.argv.includes("--list-only")) {
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10)
    try {
      results.push(...(await exportBatch(batch)))
    } catch (error) {
      results.push(
        ...batch.map((id) => ({
          ok: false,
          object_id: id,
          error: String(error?.message || error),
        })),
      )
    }
    if ((index / 10) % 20 === 0) console.log(`${Math.min(index + 10, ids.length)} / ${ids.length}`)
  }
}
const summary = {
  exported_v2: results.filter((r) => r.exported).length,
  legacy_or_cold: results.filter((r) => r.ok && !r.exported).length,
  failed: results.filter((r) => !r.ok).length,
  votes_in_coordinators: results.reduce((n, r) => n + Number(r.votes_in_coordinator || 0), 0),
  votes_changed: results.reduce((n, r) => n + Number(r.votes_changed || 0), 0),
  votes_deleted: results.reduce((n, r) => n + Number(r.votes_deleted || 0), 0),
}
Object.assign(receipt, { ...summary, finished_at: new Date().toISOString(), results })
const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "b-898-stage2",
)
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `vote-export-${receipt.started_at.replace(/[:.]/g, "-")}.json`)
writeFileSync(file, JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(summary, null, 2))
console.log(`artifact: ${file}`)
if (summary.failed) process.exitCode = 1
