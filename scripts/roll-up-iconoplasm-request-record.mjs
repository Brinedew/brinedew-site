// B-1157: keep the per-request record (workers/lib/the-only-request-record.js)
// past Workers Logs' 3 days. Every hour, the "Observe Cloudflare capacity"
// workflow runs this script. It asks Cloudflare's Workers Observability API to
// sum yesterday's and today's record lines (people, requests, D1 rows read and
// written, server errors) per route and per `?ref=` channel. Then it writes
// small JSON files to Bunny Storage. The CDN keeps a file for 30 days and
// ignores query strings, so no file is rewritten with different counts:
// ops/requests/v2/<date>.json once the day is over, and the day so far in a new
// file each hour, ops/requests/v2/hours/<date>T<hour>.json.
//
// Each channel also gets its landings: requests for the share link
// /from/<place> (B-1158), counted by Cloudflare's zone analytics, which keep a
// request's path but not its query string on the free plan.
//
// Cost: 8 telemetry queries, 2 GraphQL queries and 2 Bunny PUTs an hour. No
// Worker request, D1 row or KV operation. The files carry counts only: no actor hash, IP or user
// agent. A channel is whatever a visitor put in ?ref=, so a value that isn't a
// plain slug is counted as "(other)" instead of being published.
import process from "node:process"

import { fetchCloudflareJson } from "./lib/cloudflare-json.mjs"

const SCRIPT_NAME = "geneguessr-api" // the internal stateful Worker that writes the record
const STORAGE = "https://storage.bunnycdn.com/iconoplasm-portraits"
const PREFIX = "ops/requests/v2"
const DAY_MS = 86_400_000
const CHANNEL = /^[A-Za-z0-9._-]{1,40}$/
const ZONE = "brinedew.bio"
const SITE_HOST = "iconoplasm.brinedew.bio"
const SHARE_PREFIX = "/from/"

const SUMS = [
  { operator: "count", alias: "requests" },
  { operator: "uniq", key: "actor", keyType: "string", alias: "people" },
  { operator: "sum", key: "rows_read", keyType: "number", alias: "rows_read" },
  { operator: "sum", key: "rows_written", keyType: "number", alias: "rows_written" },
]

function need(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function recordFilters(extra = []) {
  return [
    { key: "$metadata.service", type: "string", operation: "eq", value: SCRIPT_NAME },
    { key: "service", type: "string", operation: "eq", value: "iconoplasm" },
    ...extra,
  ]
}

async function telemetry({ from, to, calculations, groupBys = [], filters = recordFilters() }) {
  const payload = await fetchCloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${need("CLOUDFLARE_ACCOUNT_ID")}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queryId: "iconoplasm-request-rollup",
        timeframe: { from, to },
        view: "calculations",
        dry: true,
        limit: 1000,
        parameters: {
          datasets: ["cloudflare-workers"],
          filterCombination: "and",
          filters,
          calculations,
          // The group limit lives here. Without it the API answers only 10
          // groups, and on 2026-10-26 those were the 10 smallest routes
          // (71 of 3,779 requests). The top-level limit doesn't apply to groups.
          limit: 1000,
          ...(groupBys.length ? { groupBys } : {}),
        },
      }),
    },
    { operation: "Workers Observability request rollup" },
  )
  if (payload?.success === false)
    throw new Error(`Telemetry query failed: ${JSON.stringify(payload.errors)}`)
  return payload?.result || {}
}

async function cloudflare(path, init = {}) {
  const payload = await fetchCloudflareJson(
    `https://api.cloudflare.com/client/v4${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${need("CLOUDFLARE_API_TOKEN")}`,
        "Content-Type": "application/json",
      },
    },
    { operation: `Cloudflare ${path}` },
  )
  if (payload?.success === false || payload?.errors?.length)
    throw new Error(`Cloudflare ${path} failed: ${JSON.stringify(payload.errors)}`)
  return payload
}

let zoneTag
async function landingsOf(from, to) {
  zoneTag ||= (await cloudflare(`/zones?name=${ZONE}`)).result?.[0]?.id
  if (!zoneTag) throw new Error(`Zone ${ZONE} not found`)
  const payload = await cloudflare("/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: `query($zone: String!, $from: Time!, $to: Time!, $host: String!, $path: String!) {
        viewer { zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(limit: 1000, filter: {
            datetime_geq: $from, datetime_lt: $to,
            clientRequestHTTPHost: $host, clientRequestPath_like: $path
          }) { count dimensions { clientRequestPath } }
        } }
      }`,
      variables: {
        zone: zoneTag,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        host: SITE_HOST,
        path: `${SHARE_PREFIX}%`,
      },
    }),
  })
  return payload?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups || []
}

// The calculations view answers one list of aggregates per alias. Join them
// into one row per group, keyed by the group's values.
export function rowsOf(result, groupKeys) {
  const rows = new Map()
  for (const calculation of Array.isArray(result?.calculations) ? result.calculations : []) {
    const alias = String(calculation?.alias || "")
    for (const aggregate of Array.isArray(calculation?.aggregates) ? calculation.aggregates : []) {
      const groups = Object.fromEntries(
        (aggregate?.groups || []).map((group) => [String(group?.key || ""), group?.value]),
      )
      const values = groupKeys.map((key) => String(groups[key] ?? ""))
      const id = JSON.stringify(values)
      if (!rows.has(id))
        rows.set(id, Object.fromEntries(groupKeys.map((key, i) => [key, values[i]])))
      rows.get(id)[alias] = Math.round(Number(aggregate?.value ?? aggregate?.count) || 0)
    }
  }
  return [...rows.values()]
}

function counts(row) {
  return {
    requests: row?.requests || 0,
    people: row?.people || 0,
    rows_read: row?.rows_read || 0,
    rows_written: row?.rows_written || 0,
  }
}

// One day's file from the four query results. Channels that aren't plain slugs
// are summed into "(other)"; their people can't be summed (one person may sit
// in two channels), so "(other)" carries the largest of them as a floor.
export function dayRollup({
  date,
  generatedAt,
  complete,
  totals,
  routes,
  channels,
  errors,
  landings = [],
}) {
  const serverErrors = new Map(
    rowsOf(errors, ["route"]).map((row) => [row.route, row.requests || 0]),
  )
  const channelRows = new Map()
  for (const row of rowsOf(channels, ["channel"])) {
    const name = row.channel === "" ? "(none)" : CHANNEL.test(row.channel) ? row.channel : "(other)"
    const seen = channelRows.get(name)
    const next = counts(row)
    channelRows.set(
      name,
      seen
        ? {
            requests: seen.requests + next.requests,
            people: Math.max(seen.people, next.people),
            rows_read: seen.rows_read + next.rows_read,
            rows_written: seen.rows_written + next.rows_written,
          }
        : next,
    )
  }
  const landed = new Map()
  for (const group of landings) {
    // Not decoded: a typed /from/%zz would throw, and a slug has nothing to decode.
    const place = String(group?.dimensions?.clientRequestPath || "")
      .slice(SHARE_PREFIX.length)
      .replace(/\/$/, "")
    const name = CHANNEL.test(place) ? place : "(other)"
    landed.set(name, (landed.get(name) || 0) + (Number(group?.count) || 0))
  }
  for (const name of landed.keys()) if (!channelRows.has(name)) channelRows.set(name, counts(null))
  const byRequests = (a, b) =>
    (b.landings || 0) - (a.landings || 0) || b.requests - a.requests || a.name.localeCompare(b.name)
  return {
    schema: 1,
    date,
    generated_at: generatedAt,
    complete,
    source: "Workers Logs request record (workers/lib/the-only-request-record.js), B-1157",
    totals: {
      ...counts(rowsOf(totals, [])[0]),
      server_errors: [...serverErrors.values()].reduce((a, b) => a + b, 0),
    },
    routes: rowsOf(routes, ["route"])
      .map((row) => ({
        name: row.route,
        ...counts(row),
        server_errors: serverErrors.get(row.route) || 0,
      }))
      .sort(byRequests),
    channels: [...channelRows]
      .map(([name, row]) => ({ name, landings: landed.get(name) || 0, ...row }))
      .sort(byRequests),
  }
}

async function rollUpDay(date, now) {
  const from = Date.parse(`${date}T00:00:00Z`)
  const to = Math.min(from + DAY_MS, now)
  const [totals, routes, channels, errors, landings] = await Promise.all([
    telemetry({ from, to, calculations: SUMS }),
    telemetry({ from, to, calculations: SUMS, groupBys: [{ type: "string", value: "route" }] }),
    telemetry({ from, to, calculations: SUMS, groupBys: [{ type: "string", value: "channel" }] }),
    telemetry({
      from,
      to,
      calculations: [{ operator: "count", alias: "requests" }],
      groupBys: [{ type: "string", value: "route" }],
      filters: recordFilters([{ key: "status", type: "number", operation: "gte", value: 500 }]),
    }),
    landingsOf(from, to),
  ])
  return dayRollup({
    date,
    generatedAt: new Date(now).toISOString(),
    complete: now >= from + DAY_MS,
    totals,
    routes,
    channels,
    errors,
    landings,
  })
}

async function put(name, rollup) {
  const response = await fetch(`${STORAGE}/${PREFIX}/${name}.json`, {
    method: "PUT",
    headers: {
      AccessKey: need("ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD"),
      "Content-Type": "application/json",
    },
    body: `${JSON.stringify(rollup)}\n`,
  })
  if (!response.ok)
    throw new Error(`Bunny Storage PUT ${PREFIX}/${name}.json failed (${response.status})`)
}

async function main() {
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const yesterday = new Date(now - DAY_MS).toISOString().slice(0, 10)
  // Yesterday is rewritten each hour with the same counts once Workers Logs
  // holds its last minutes, so whichever copy the CDN keeps is the final one.
  for (const [date, name] of [
    [yesterday, yesterday],
    [today, `hours/${new Date(now).toISOString().slice(0, 13)}`],
  ]) {
    const rollup = await rollUpDay(date, now)
    if (process.argv.includes("--dry-run")) console.log(JSON.stringify(rollup, null, 2))
    else await put(name, rollup)
    console.log(
      `${date}: ${rollup.totals.requests} requests, ${rollup.totals.people} people, ${rollup.routes.length} routes, ${rollup.channels.length} channels${rollup.complete ? " (complete)" : ""}`,
    )
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("roll-up-iconoplasm-request-record.mjs")
)
  await main()
