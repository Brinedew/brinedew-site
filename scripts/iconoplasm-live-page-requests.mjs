#!/usr/bin/env node
// B-898 live check: open production pages in a real Chrome and count what each
// page fetched from the CDN and from the Worker. Writes an artifact and exits
// non-zero when a page made a Worker request it should not have or missed the
// stable object it should have read.
//
//   node scripts/iconoplasm-live-page-requests.mjs /gene/A1BG /gene/TP53 /
//
// The workstation's resolver cannot resolve Bunny hosts (see the delivery
// runbook); the script resolves them through Cloudflare DoH and pins them with
// --host-resolver-rules so the browser sees the real CDN.
import dns from "node:dns/promises"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const ORIGIN = "https://iconoplasm.brinedew.bio"
const CDN_HOST = "iconoplasmportraits.b-cdn.net"
const pages = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/gene/A1BG", "/gene/TP53", "/"]

// The system resolver (what curl uses here) returns the nearest Bunny edge;
// Cloudflare DoH returned a distant one that took 2 to 25 s per cold object.
// Chrome's own resolver fails on this workstation, hence the pin.
async function resolve(host) {
  try {
    return (await dns.lookup(host, { family: 4 })).address
  } catch {
    const response = await fetch(`https://1.1.1.1/dns-query?name=${host}&type=A`, {
      headers: { Accept: "application/dns-json" },
    })
    const answer = (await response.json()).Answer?.find((item) => item.type === 1)
    if (!answer) throw new Error(`No A record for ${host}`)
    return answer.data
  }
}

const rules = `MAP ${CDN_HOST} ${await resolve(CDN_HOST)}, MAP iconoplasm.brinedew.bio ${await resolve("iconoplasm.brinedew.bio")}`
const browser = await chromium.launch({
  channel: "chrome",
  args: [`--host-resolver-rules=${rules}`],
})
const results = []
let failures = 0
for (const pagePath of pages) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const requests = []
  page.on("response", (response) => {
    const url = new URL(response.url())
    if (url.host === CDN_HOST || (url.origin === ORIGIN && url.pathname.startsWith("/api/")))
      requests.push({ status: response.status(), url: url.origin + url.pathname })
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)))
  page.on("requestfailed", (request) =>
    errors.push(
      `request failed: ${request.url().slice(0, 120)} :: ${request.failure()?.errorText || ""}`,
    ),
  )
  await page.goto(`${ORIGIN}${pagePath}?cb=${Date.now()}`, { waitUntil: "networkidle" })
  await page.waitForTimeout(5000)
  const worker = requests.filter((r) => r.url.startsWith(ORIGIN))
  const cdn = requests.filter((r) => !r.url.startsWith(ORIGIN))
  const stableGene = cdn.filter((r) => r.url.includes("/genes/v3/"))
  const stableCatalog = cdn.filter((r) => r.url.includes("/catalog/v3/"))
  const tree = cdn.filter(
    (r) => r.url.includes("/published-cards/") || r.url.endsWith("/card-current"),
  )
  const isGene = pagePath.startsWith("/gene/")
  const checks = {
    zero_worker_requests: worker.length === 0,
    ...(isGene
      ? { one_stable_gene_fetch: stableGene.length === 1 && stableGene[0].status === 200 }
      : {}),
    no_page_errors: errors.length === 0,
  }
  const ok = Object.values(checks).every(Boolean)
  if (!ok) failures += 1
  results.push({
    page: pagePath,
    ok,
    checks,
    worker,
    stable_gene: stableGene,
    stable_catalog: stableCatalog,
    tree_reads: tree.length,
    cdn_total: cdn.length,
    errors,
  })
  await context.close()
}
await browser.close()
const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "artifacts",
  "b-898-live-page-requests",
)
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
const report = { ran_at: new Date().toISOString(), failures, results }
writeFileSync(file, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`artifact: ${file}`)
process.exit(failures ? 1 : 0)
