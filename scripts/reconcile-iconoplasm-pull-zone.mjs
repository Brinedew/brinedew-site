#!/usr/bin/env node
// B-898: apply bunny/the-only-iconoplasm-pull-zone-policy.json to the Bunny
// pull zone through the Worker, which holds the account key. Runs from the
// production deploy after the stateful Worker is live, and by hand:
//
//   ICONOPLASM_ADMIN_TOKEN=... node scripts/reconcile-iconoplasm-pull-zone.mjs
//
// Prints the before/after settings and exits non-zero when Bunny refused.
import { readFile } from "node:fs/promises"
import process from "node:process"

const POLICY_URL = new URL("../bunny/the-only-iconoplasm-pull-zone-policy.json", import.meta.url)
const ROUTE = "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/publication/reconcile-pull-zone"

const token = String(process.env.ICONOPLASM_ADMIN_TOKEN || "").trim()
if (!token) {
  console.error("Missing ICONOPLASM_ADMIN_TOKEN")
  process.exit(1)
}
const policy = JSON.parse(await readFile(POLICY_URL, "utf8"))
const response = await fetch(ROUTE, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(policy),
})
const body = await response.json().catch(() => null)
console.log(JSON.stringify({ status: response.status, ...body }, null, 2))
if (!response.ok || body?.ok !== true) process.exit(1)
