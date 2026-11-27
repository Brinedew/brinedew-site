import path from "node:path"
import { fileURLToPath } from "node:url"
import { INDEXNOW_KEY, parseSitemapUrls, submitIndexNowHost } from "./lib/indexnow.mjs"

export const ICONOPLASM_FLAGSHIP_GENES = Object.freeze([
  "TP53",
  "BRCA1",
  "EGFR",
  "KRAS",
  "MYC",
  "APOE",
  "INS",
  "CFTR",
  "BRCA2",
  "AKT1",
])

const ICONOPLASM_FLAGSHIP_SET = new Set(ICONOPLASM_FLAGSHIP_GENES)
const ICONOPLASM_LEGAL_PATHS = new Set(["/privacy", "/license", "/caretaker-terms"])

export function isCanonicalBrinedewUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname !== "brinedew.bio") return false
    const p = parsed.pathname.replace(/^\/+|\/+$/g, "")
    return p === "" || p === "about" || p.startsWith("posts/") || p.startsWith("wiki/")
  } catch {
    return false
  }
}

export function selectIconoplasmIndexNowUrls(sitemapUrls, { includeAllGenes = false } = {}) {
  const selected = []
  for (const rawUrl of sitemapUrls) {
    let parsed
    try {
      parsed = new URL(rawUrl)
    } catch {
      continue
    }
    if (parsed.hostname !== "iconoplasm.brinedew.bio") continue
    const p = parsed.pathname.replace(/\/+$/, "") || "/"
    if (ICONOPLASM_LEGAL_PATHS.has(p)) continue
    if (includeAllGenes) {
      selected.push(parsed.toString())
      continue
    }
    if (p === "/" || p === "/developers" || p === "/docs" || p.startsWith("/docs/")) {
      selected.push(parsed.toString())
      continue
    }
    if (p.startsWith("/gene/")) {
      const symbol = p.slice("/gene/".length)
      if (ICONOPLASM_FLAGSHIP_SET.has(symbol)) {
        selected.push(parsed.toString())
      }
    }
  }
  return selected
}

async function fetchSitemapUrls(sitemapUrl, filterFn = () => true) {
  const response = await fetch(sitemapUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch sitemap ${sitemapUrl}: HTTP ${response.status}`)
  }
  const xml = await response.text()
  return parseSitemapUrls(xml).filter(filterFn)
}

export function createIndexNowTargets({ includeAllGenes = false } = {}) {
  return [
    {
      host: "brinedew.bio",
      getUrls: () => fetchSitemapUrls("https://brinedew.bio/sitemap.xml", isCanonicalBrinedewUrl),
    },
    {
      host: "iconoplasm.brinedew.bio",
      getUrls: async () =>
        selectIconoplasmIndexNowUrls(
          await fetchSitemapUrls("https://iconoplasm.brinedew.bio/sitemap.xml"),
          { includeAllGenes },
        ),
    },
    {
      host: "geneguessr.brinedew.bio",
      getUrls: async () => ["https://geneguessr.brinedew.bio/"],
    },
  ]
}

export const INDEXNOW_TARGETS = createIndexNowTargets()

function parseArgs(argv) {
  let dryRun = false
  let includeAllGenes = false
  let hostFilter = null
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--include-all-genes") {
      includeAllGenes = true
    } else if (arg.startsWith("--host=")) {
      hostFilter = arg.slice("--host=".length).trim()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { dryRun, includeAllGenes, hostFilter }
}

async function main() {
  const { dryRun, includeAllGenes, hostFilter } = parseArgs(process.argv.slice(2))
  const allTargets = createIndexNowTargets({ includeAllGenes })
  const targets = hostFilter
    ? allTargets.filter((target) => target.host === hostFilter)
    : allTargets

  if (targets.length === 0) {
    throw new Error(`No matching IndexNow target for --host=${hostFilter}`)
  }

  const rows = []
  let hasFailure = false

  for (const target of targets) {
    const urls = await target.getUrls()

    try {
      const result = await submitIndexNowHost({
        host: target.host,
        key: INDEXNOW_KEY,
        urlList: urls,
        dryRun,
      })
      rows.push({
        host: result.host,
        keyLive: result.keyLive,
        urlCount: result.totalUrls,
        batches: result.batches,
        status: dryRun
          ? result.keyLive
            ? "dry-run ready"
            : `dry-run (key not live: HTTP ${result.keyStatus})`
          : `submitted (${result.statuses.join(", ")})`,
      })
    } catch (error) {
      hasFailure = true
      rows.push({
        host: target.host,
        keyLive: false,
        urlCount: urls.length,
        batches: Math.ceil(urls.length / 10_000),
        status: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  console.table(rows)
  if (hasFailure) {
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
