#!/usr/bin/env node
// B-1087: the daily Bunny balance check (.github/workflows/check-bunny-balance.yml).
//
// Bunny is prepaid, auto-recharge is off, and Bunny takes every service offline four days after
// the balance goes negative: the portraits, the blots and the gene card objects all live there.
// This fails (and GitHub emails the owner) while there are still months to top it up by hand:
// when the balance covers fewer than three months at this month's pace, never less than Bunny's
// $1 monthly minimum.
//
//   ICONOPLASM_ADMIN_TOKEN=... node scripts/check-bunny-balance.mjs
import process from "node:process"

const ROUTE = "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/bunny-account"
const MONTHS_OF_RUNWAY = 3
const BUNNY_MONTHLY_MINIMUM_USD = 1

const token = String(process.env.ICONOPLASM_ADMIN_TOKEN || "").trim()
if (!token) {
  console.error("Missing ICONOPLASM_ADMIN_TOKEN")
  process.exit(1)
}
const response = await fetch(ROUTE, { headers: { Authorization: `Bearer ${token}` } })
const body = await response.json().catch(() => null)
if (!response.ok || body?.ok !== true) {
  console.error(JSON.stringify({ status: response.status, ...body }))
  process.exit(1)
}
const now = new Date()
const day = now.getUTCDate() - 1 + now.getUTCHours() / 24
const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
const monthPace = Math.max(
  BUNNY_MONTHLY_MINIMUM_USD,
  day >= 1 ? (body.this_month_charges_usd / day) * daysInMonth : 0,
)
const months = body.balance_usd / monthPace
const zones = body.storage_zones.map(
  (zone) =>
    `${zone.name}: ${(zone.storage_used_bytes / 1e9).toFixed(2)} GB in ${zone.files_stored} files`,
)
console.log(
  [
    `Balance $${body.balance_usd.toFixed(2)}; this month $${body.this_month_charges_usd.toFixed(2)} so far`,
    `(storage $${body.this_month_storage_usd.toFixed(2)}, traffic $${body.this_month_traffic_usd.toFixed(2)},`,
    `${(body.this_month_bandwidth_bytes / 1e9).toFixed(2)} GB); pace $${monthPace.toFixed(2)} a month,`,
    `${months.toFixed(1)} months left.`,
    ...zones,
  ].join(" "),
)
if (months < MONTHS_OF_RUNWAY) {
  console.error(
    `Top up Bunny: the balance covers ${months.toFixed(1)} months, under ${MONTHS_OF_RUNWAY}. ` +
      "At zero Bunny takes every gene page's images offline within four days.",
  )
  process.exit(1)
}
