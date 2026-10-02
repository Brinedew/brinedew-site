#!/usr/bin/env node
// B-898 Stage 2: the vote coordinators against D1, one mode per Worker.
//
//   node scripts/export-iconoplasm-votes-to-d1.mjs --write      # pre-cutover Worker only
//   node scripts/export-iconoplasm-votes-to-d1.mjs --compare    # any Worker since the cutover
//   node scripts/export-iconoplasm-votes-to-d1.mjs --compare --all-samples
//   node scripts/export-iconoplasm-votes-to-d1.mjs --compare --replay-since=<write started_at>
//   node scripts/export-iconoplasm-votes-to-d1.mjs --list-only
//
// Lists the existing IconoplasmVoteCoordinator objects through the Cloudflare
// API (so the sweep creates no coordinator) and drives the Worker ten objects
// at a time.
//
// --write copies each coordinator's votes and summaries into D1
// (POST /admin/votes/export-to-d1, served only by the Worker that still routes
// votes to the coordinators). It replaces D1's votes for every upgraded gene
// with the coordinator's, so it must never run once D1 has taken votes of its
// own: before listing anything it asks D1 whether icono_gene_vote_version
// (migration 0113, written by every vote since the cutover) has a row, and
// refuses if it has one, or if D1 cannot answer. A rollback followed by a
// "safety" export therefore cannot delete the votes cast since the cutover.
// Run it once, immediately before the cutover deploys, and merge only when
// its receipt says failed: 0.
//
// --compare reads both sides and writes nothing
// (POST /admin/votes/compare-coordinators): per gene, the votes D1 lacks, the
// votes only D1 holds, differing values, differing summaries, the published
// winner, the caretaker assignment and the caretaker supervote, with each
// side's vision_id and updated_at in the samples. After the cutover, "only in
// D1" is expected for every new vote. --all-samples lifts the 20-per-category
// sample cap.
//
// --replay-since=<ISO time> (with --compare; implies --all-samples) writes the
// votes the cutover missed into the receipt as `replay_items`, ready for
// POST /api/iconoplasm/admin/votes/import. Pass the --write receipt's
// started_at. An item is a coordinator vote changed after that time where D1
// holds an older row, or holds none and recorded no later change for it; or a
// clear (vote_value 0) for a row only D1 holds whose last D1 write is older
// than that time, which the coordinator deleted after the export. Anything
// else is left alone and listed as skipped.
//
// Writes the receipt to artifacts/b-898-stage2/vote-<mode>-<timestamp>.json.
// Cost, measured 2026-10-02: 2,683 objects, so about 2,700 Durable Object
// requests; --write costs about 5,400 D1 statements and writes only where the
// two differ, --compare reads about 3 D1 rows per stored vote. Run it late in
// the UTC day.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const CLASS = "IconoplasmVoteCoordinator"
const SCRIPT = "geneguessr-api"
// Production ICONOPLASM_DB (wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml).
const D1_DATABASE_ID = "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff"
const MODES = {
  "--write": { route: "/api/iconoplasm/admin/votes/export-to-d1", name: "export" },
  "--compare": { route: "/api/iconoplasm/admin/votes/compare-coordinators", name: "compare" },
}

// At most one row read: does any gene have a vote version?
export const CUTOVER_VOTES_SQL =
  "SELECT COUNT(*) AS n FROM (SELECT 1 FROM icono_gene_vote_version LIMIT 1)"

/**
 * Throws unless D1 provably holds no vote cast since the cutover. A missing
 * icono_gene_vote_version table is the pre-cutover state and passes; a row in
 * it, or any other D1 failure, refuses.
 */
export async function assertNoVotesSinceCutover(queryD1) {
  let rows
  try {
    rows = await queryD1(CUTOVER_VOTES_SQL)
  } catch (error) {
    const message = String(error?.message || error)
    if (/no such table:?\s*icono_gene_vote_version/i.test(message)) return { table: false }
    throw new Error(
      `Refusing --write: D1 could not show that it holds no votes since the cutover (${message})`,
    )
  }
  if (Number(rows?.[0]?.n || 0) > 0) {
    throw new Error(
      "Refusing --write: icono_gene_vote_version has rows, so D1 has taken votes since the cutover. " +
        "An export now would replace them with the coordinators' older state. " +
        "Use --compare (and --replay-since) instead.",
    )
  }
  return { table: true }
}

// SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) and ISO strings both
// appear on the two sides.
export function timestampMs(value) {
  const text = String(value || "").trim()
  if (!text) return Number.NaN
  return Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
      ? `${text.replace(" ", "T")}Z`
      : text,
  )
}

/**
 * The votes the cutover missed, from complete --compare results. See the
 * header for the rule; every row it does not replay is returned as skipped
 * with the reason, for a human to read.
 */
export function replayItems(results, since) {
  const sinceMs = timestampMs(since)
  if (!Number.isFinite(sinceMs)) throw new Error(`--replay-since needs an ISO time, got "${since}"`)
  const items = []
  const skipped = []
  for (const result of Array.isArray(results) ? results : []) {
    if (!result?.ok || !result.compared || !result.symbol) continue
    const symbol = result.symbol
    const samples = result.samples || {}
    const vote = (row, value, side) => ({
      symbol,
      asset_sha256: row.asset_sha256,
      user_id: row.user_id,
      vote_value: value,
      ...(side?.vision_id ? { vision_id: side.vision_id } : {}),
    })
    for (const row of samples.missing_in_d1 || []) {
      const coordinatorMs = timestampMs(row.coordinator?.updated_at)
      if (!(coordinatorMs > sinceMs))
        skipped.push({ symbol, ...row, reason: "coordinator vote predates the export" })
      else if (timestampMs(row.d1_last_event_at) >= coordinatorMs)
        skipped.push({ symbol, ...row, reason: "D1 recorded a newer change and cleared it" })
      else items.push(vote(row, row.coordinator.value, row.coordinator))
    }
    for (const row of samples.value_differs || []) {
      const coordinatorMs = timestampMs(row.coordinator?.updated_at)
      const d1Ms = timestampMs(row.d1?.updated_at)
      if (coordinatorMs > sinceMs && d1Ms < coordinatorMs)
        items.push(vote(row, row.coordinator.value, row.coordinator))
      else
        skipped.push({
          symbol,
          ...row,
          reason:
            coordinatorMs > sinceMs
              ? "D1 holds a row as new as the coordinator's"
              : "coordinator vote predates the export",
        })
    }
    for (const row of samples.only_in_d1 || []) {
      if (timestampMs(row.d1?.updated_at) < sinceMs) items.push(vote(row, 0, null))
    }
  }
  return { items, skipped }
}

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

async function cf(pathname, init = {}) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}${pathname}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    },
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success !== true)
    throw new Error(
      `Cloudflare API ${pathname} failed (${response.status}): ${JSON.stringify(body?.errors || body)}`,
    )
  return body
}

async function queryD1(sql) {
  const body = await cf(`/d1/database/${D1_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params: [] }),
  })
  return (Array.isArray(body.result) ? body.result[0] : null)?.results || []
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

async function runBatch(route, ids, extra) {
  const response = await fetch(`${ORIGIN}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${need("ICONOPLASM_ADMIN_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ object_ids: ids, ...extra }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true)
    throw new Error(`${route} failed (${response.status}): ${JSON.stringify(body)}`)
  return body.results
}

const sum = (results, field) => results.reduce((n, r) => n + Number(r[field] || 0), 0)

async function main(argv) {
  const listOnly = argv.includes("--list-only")
  const flags = Object.keys(MODES).filter((flag) => argv.includes(flag))
  if (!listOnly && flags.length !== 1) {
    console.error("Choose exactly one of --write, --compare or --list-only")
    return 2
  }
  const replaySince = argv.find((arg) => arg.startsWith("--replay-since="))?.split("=")[1] || ""
  if (replaySince && flags[0] !== "--compare") {
    console.error("--replay-since works only with --compare")
    return 2
  }
  const mode = listOnly ? { name: "list" } : MODES[flags[0]]
  const receipt = { started_at: new Date().toISOString(), mode: mode.name }
  if (mode.name === "export") {
    receipt.cutover_guard = await assertNoVotesSinceCutover(queryD1)
  }
  const extra =
    mode.name === "compare" && (replaySince || argv.includes("--all-samples"))
      ? { all_samples: true }
      : {}
  const { namespace, ids } = await listObjectIds()
  Object.assign(receipt, { namespace, objects: ids.length })
  console.log(`${ids.length} coordinators listed`)
  const results = []
  if (!listOnly) {
    for (let index = 0; index < ids.length; index += 10) {
      const batch = ids.slice(index, index + 10)
      try {
        results.push(...(await runBatch(mode.route, batch, extra)))
      } catch (error) {
        results.push(
          ...batch.map((id) => ({
            ok: false,
            object_id: id,
            error: String(error?.message || error),
          })),
        )
      }
      if ((index / 10) % 20 === 0)
        console.log(`${Math.min(index + 10, ids.length)} / ${ids.length}`)
    }
  }
  const summary =
    mode.name === "compare"
      ? {
          compared_v2: results.filter((r) => r.compared).length,
          differing: results.filter((r) => r.differs).length,
          legacy_or_cold: results.filter((r) => r.ok && !r.compared).length,
          failed: results.filter((r) => !r.ok).length,
          votes_missing_in_d1: sum(results, "votes_missing_in_d1"),
          votes_only_in_d1: sum(results, "votes_only_in_d1"),
          votes_value_differs: sum(results, "votes_value_differs"),
          summaries_differ: sum(results, "summaries_differ"),
          published_assets_differ: results.filter((r) => r.published_asset_differs).length,
          assignments_differ: results.filter((r) => r.assignment_differs).length,
          supervotes_differ: results.filter((r) => r.supervote_differs).length,
        }
      : {
          exported_v2: results.filter((r) => r.exported).length,
          legacy_or_cold: results.filter((r) => r.ok && !r.exported).length,
          failed: results.filter((r) => !r.ok).length,
          votes_in_coordinators: sum(results, "votes_in_coordinator"),
          votes_changed: sum(results, "votes_changed"),
          votes_deleted: sum(results, "votes_deleted"),
        }
  if (replaySince) {
    const replay = replayItems(results, replaySince)
    Object.assign(summary, {
      replay_since: replaySince,
      replay_items: replay.items.length,
      replay_skipped: replay.skipped.length,
    })
    Object.assign(receipt, { replay_items: replay.items, replay_skipped: replay.skipped })
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
      `${result.symbol}: ${result.votes_missing_in_d1} missing in D1, ${result.votes_only_in_d1} only in D1, ${result.votes_value_differs} differ, ${result.summaries_differ} summaries${result.published_asset_differs ? ", winner" : ""}${result.assignment_differs ? ", assignment" : ""}${result.supervote_differs ? ", supervote" : ""}`,
    )
  }
  console.log(`artifact: ${file}`)
  return summary.failed ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(String(error?.message || error))
      process.exitCode = 3
    },
  )
}
