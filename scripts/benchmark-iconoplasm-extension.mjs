import fs from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = path.join(repoRoot, "iconoplasm-extension")
const matcherFile = path.join(extensionDir, "content-matcher.js")
const contentFile = path.join(extensionDir, "content.js")
const host = process.env.ICONO_HOST || "https://iconoplasm.brinedew.bio"
const testPageUrl = process.env.ICONO_TEST_URL || "http://127.0.0.1:41731/test-page"
const playwrightCorePath =
  process.env.PLAYWRIGHT_CORE_PATH ||
  path.join(repoRoot, "tmp", "pw-runner", "node_modules", "playwright-core")
const chromiumExecutable =
  process.env.PLAYWRIGHT_EXECUTABLE ||
  "C:/Users/Admin/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe"

function loadMatcherApi(source) {
  const context = {
    globalThis: {},
    console,
  }
  context.global = context.globalThis
  context.self = context.globalThis
  vm.runInNewContext(source, context, { filename: matcherFile })
  return context.globalThis.IconoplasmContentMatcher
}

async function loadBlocklist() {
  const contentSource = await fs.readFile(contentFile, "utf8")
  const match = contentSource.match(/const BLOCKLIST = new Set\(\[([\s\S]*?)\]\)/)
  if (!match) throw new Error("Could not extract BLOCKLIST from content.js")
  return vm.runInNewContext("([" + match[1] + "])", {})
}

async function fetchCatalogGeneMap() {
  const manifestResp = await fetch(`${host}/api/public/v1/catalog/manifest`)
  if (!manifestResp.ok) {
    throw new Error(`Catalog manifest fetch failed: HTTP ${manifestResp.status}`)
  }
  const manifest = await manifestResp.json()
  const artifactUrl = String(manifest.scanner_artifact?.artifact_url || "")
  if (!artifactUrl) throw new Error("Catalog manifest is missing the compact scanner artifact")
  const artifactResp = await fetch(artifactUrl)
  if (!artifactResp.ok) {
    throw new Error(`Catalog artifact fetch failed: HTTP ${artifactResp.status}`)
  }
  const artifact = await artifactResp.json()
  const geneMap = {}
  for (const [rawSymbol, gene] of Object.entries(
    artifact.genes && typeof artifact.genes === "object" ? artifact.genes : {},
  )) {
    const symbol = String(rawSymbol || "")
      .trim()
      .toUpperCase()
    if (!symbol) continue
    geneMap[symbol] = gene
  }
  return geneMap
}

function lexicalCorpus() {
  return [
    {
      label: "biomedical-basic",
      text: "TP53 and BRCA1 cooperate in DNA damage responses while EGFR signals upstream.",
      expectedSymbols: ["TP53", "BRCA1", "EGFR"],
    },
    {
      label: "biomedical-punctuation",
      text: "KRAS-driven tumors can recruit AKT1, MTOR, and CTNNB1-dependent programs.",
      expectedSymbols: ["KRAS", "AKT1", "MTOR", "CTNNB1"],
    },
    {
      label: "hostile-common-words",
      text: "THIS TEAM WILL WORK WITH YOUR GROUP NEXT WEEK WHILE THEY PLAN THE TASK.",
      expectedSymbols: [],
    },
    {
      label: "mixed-ambiguous",
      text: "The study mentions MAPK1, but TEAM and WORK should never become hover genes.",
      expectedSymbols: ["MAPK1"],
    },
    {
      label: "hyphenated",
      text: "HLA-DRA can appear beside HLA-A on immunology pages.",
      expectedSymbols: ["HLA-DRA", "HLA-A"],
    },
    {
      label: "false-positive-pressure",
      text: "SITE, TYPE, STEM, and NOTE are all English here, not biology.",
      expectedSymbols: [],
    },
  ]
}

function summarizeLexicalCase(sample, matches) {
  const observed = matches.map((match) => match.symbol)
  const observedSet = new Set(observed)
  const expectedSet = new Set(sample.expectedSymbols)
  const truePositives = sample.expectedSymbols.filter((symbol) => observedSet.has(symbol))
  const falseNegatives = sample.expectedSymbols.filter((symbol) => !observedSet.has(symbol))
  const falsePositives = observed.filter((symbol) => !expectedSet.has(symbol))
  return {
    label: sample.label,
    expected: sample.expectedSymbols,
    observed,
    truePositives,
    falseNegatives,
    falsePositives,
  }
}

async function runLexicalBenchmark() {
  const [matcherSource, blocklist, geneMap] = await Promise.all([
    fs.readFile(matcherFile, "utf8"),
    loadBlocklist(),
    fetchCatalogGeneMap(),
  ])
  const matcherApi = loadMatcherApi(matcherSource)
  if (!matcherApi || typeof matcherApi.createGeneMatcher !== "function") {
    throw new Error("Matcher API did not load correctly")
  }

  const matcher = matcherApi.createGeneMatcher(geneMap, { blocklist: new Set(blocklist) })
  const samples = lexicalCorpus()
  const started = performance.now()
  const cases = samples.map((sample) =>
    summarizeLexicalCase(sample, matcher.findMatches(sample.text)),
  )
  const elapsedMs = Number((performance.now() - started).toFixed(3))
  const totals = cases.reduce(
    (acc, entry) => {
      acc.truePositives += entry.truePositives.length
      acc.falseNegatives += entry.falseNegatives.length
      acc.falsePositives += entry.falsePositives.length
      return acc
    },
    { truePositives: 0, falseNegatives: 0, falsePositives: 0 },
  )

  return {
    catalogGeneCount: Object.keys(geneMap).length,
    elapsedMs,
    totals,
    cases,
  }
}

async function runBrowserBenchmark() {
  try {
    const playwright = require(playwrightCorePath)
    const { chromium } = playwright
    await fs.access(chromiumExecutable)
    const userDataDir = path.join(repoRoot, "tmp", "playwright-iconoplasm-benchmark")
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      executablePath: chromiumExecutable,
      viewport: { width: 1440, height: 1100 },
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    })
    try {
      let [serviceWorker] = context.serviceWorkers()
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent("serviceworker", { timeout: 30000 })
      }
      await serviceWorker.evaluate(() =>
        chrome.storage.local.set({
          iconoplasm_card_variant: "simple",
          iconoplasm_tooltip_theme: "light",
        }),
      )
      const page = context.pages()[0] || (await context.newPage())
      await page.goto(testPageUrl, { waitUntil: "domcontentloaded" })
      await page.waitForSelector(".iconoplasm-gene", { timeout: 30000 })
      const target = page.locator(".iconoplasm-gene").first()
      const hoverStart = performance.now()
      await target.hover()
      await page.waitForSelector(".iconoplasm-tooltip.iconoplasm-tooltip-visible", {
        timeout: 15000,
      })
      await page.waitForSelector(".iconoplasm-tooltip-symbol", { timeout: 15000 })
      await page.waitForSelector(".iconoplasm-tooltip-meta-row, .iconoplasm-tooltip-meta-pairs", {
        timeout: 15000,
      })
      return {
        executed: true,
        hoverToMetaMs: Number((performance.now() - hoverStart).toFixed(3)),
        page: testPageUrl,
      }
    } finally {
      await context.close()
    }
  } catch (error) {
    return {
      executed: false,
      skippedReason: String(error && error.message ? error.message : error),
    }
  }
}

async function main() {
  const lexical = await runLexicalBenchmark()
  const browser = await runBrowserBenchmark()
  console.log(
    JSON.stringify(
      {
        lexical,
        browser,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
