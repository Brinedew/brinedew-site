#!/usr/bin/env node
// B-898 Stage 2: the vote coordinators against D1, one mode per Worker.
//
//   node scripts/export-iconoplasm-votes-to-d1.mjs --write      # pre-cutover Worker only
//   node scripts/export-iconoplasm-votes-to-d1.mjs --compare    # any Worker since the cutover
//   node scripts/export-iconoplasm-votes-to-d1.mjs --list-only
//
// Lists the existing IconoplasmVoteCoordinator objects through the Cloudflare
// API (so the sweep creates no coordinator) and drives the Worker ten objects
// at a time.
//
// --write copies each coordinator's votes and summaries into D1
// (POST /admin/votes/export-to-d1). Only the Worker that still routes votes to
// the coordinators serves that route; run it once, immediately before the
// cutover deploys. The cutover Worker answers 404, so a late write run cannot
// put stale coordinator state over votes D1 has taken since.
//
// --compare reads both sides and writes nothing
// (POST /admin/votes/compare-coordinators): per gene, the votes D1 lacks, the
// votes only D1 holds, differing values, differing summaries and the caretaker
// supervote. After the cutover, "only in D1" is expected for every new vote.
//
// Writes the receipt to artifacts/b-898-stage2/vote-<mode>-<timestamp>.json.
// Cost, measured 2026-10-02: 2,683 objects, so about 2,700 Durable Object
// requests; --write costs about 5,400 D1 statements and writes only where the
// two differ, --compare reads about 3 D1 rows per stored vote. Run it late in
// the UTC day.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const CLASS = "IconoplasmVoteCoordinator"
const SCRIPT = "geneguessr-api"
const MODES = {
  "--write": { route: "/api/iconoplasm/admin/votes/export-to-d1", name: "export" },
  "--compare": { route: "/api/iconoplasm/admin/votes/compare-coordinators", name: "compare" },
}

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

async function runBatch(route, ids) {
  const response = await fetch(`${ORIGIN}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${need("ICONOPLASM_ADMIN_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ object_ids: ids }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true)
    throw new Error(`${route} failed (${response.status}): ${JSON.stringify(body)}`)
  return body.results
}

const listOnly = process.argv.includes("--list-only")
const flags = Object.keys(MODES).filter((flag) => process.argv.includes(flag))
if (!listOnly && flags.length !== 1) {
  console.error("Choose exactly one of --write, --compare or --list-only")
  process.exit(2)
}
const mode = listOnly ? { name: "list" } : MODES[flags[0]]
const receipt = { started_at: new Date().toISOString(), mode: mode.name }
const { namespace, ids } = await listObjectIds()
Object.assign(receipt, { namespace, objects: ids.length })
console.log(`${ids.length} coordinators listed`)
const results = []
if (!listOnly) {
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10)
    try {
      results.push(...(await runBatch(mode.route, batch)))
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
const summary =
  mode.name === "compare"
    ? {
        compared_v2: results.filter((r) => r.compared).length,
        differing: results.filter((r) => r.differs).length,
        legacy_or_cold: results.filter((r) => r.ok && !r.compared).length,
        failed: results.filter((r) => !r.ok).length,
        votes_missing_in_d1: results.reduce((n, r) => n + Number(r.votes_missing_in_d1 || 0), 0),
        votes_only_in_d1: results.reduce((n, r) => n + Number(r.votes_only_in_d1 || 0), 0),
        votes_value_differs: results.reduce((n, r) => n + Number(r.votes_value_differs || 0), 0),
        summaries_differ: results.reduce((n, r) => n + Number(r.summaries_differ || 0), 0),
        supervotes_differ: results.filter((r) => r.supervote_differs).length,
      }
    : {
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
const file = path.join(dir, `vote-${mode.name}-${receipt.started_at.replace(/[:.]/g, "-")}.json`)
writeFileSync(file, JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(summary, null, 2))
for (const result of results.filter((r) => r.differs).slice(0, 20)) {
  console.log(
    `${result.symbol}: ${result.votes_missing_in_d1} missing in D1, ${result.votes_only_in_d1} only in D1, ${result.votes_value_differs} differ, ${result.summaries_differ} summaries${result.supervote_differs ? ", supervote" : ""}`,
  )
}
console.log(`artifact: ${file}`)
if (summary.failed) process.exitCode = 1
