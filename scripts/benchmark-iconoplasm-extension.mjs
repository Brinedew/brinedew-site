import fs from "node:fs/promises"
import path from "node:path"
import vm from "node:vm"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const extensionDir = path.join(repoRoot, "iconoplasm-extension")
const matcherFile = path.join(extensionDir, "content-matcher.js")
const blocklistFile = path.join(extensionDir, "blocklist-defaults.js")
const host = process.env.ICONO_HOST || "https://iconoplasm.brinedew.bio"

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
  const source = await fs.readFile(blocklistFile, "utf8")
  const context = vm.createContext({})
  vm.runInContext(source, context, { filename: blocklistFile })
  const blocklist = vm.runInContext("Array.from(ICONOPLASM_DEFAULT_BLOCKLIST)", context)
  if (!Array.isArray(blocklist) || blocklist.some((entry) => typeof entry !== "string")) {
    throw new Error("Iconoplasm default blocklist did not evaluate to an array of strings")
  }
  return blocklist
}

async function fetchCatalogGeneMap() {
  const manifestResp = await fetch(`${host}/api/public/v1/catalog/manifest`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!manifestResp.ok) {
    throw new Error(`Catalog manifest fetch failed: HTTP ${manifestResp.status}`)
  }
  const manifest = await manifestResp.json()
  const artifactUrl = String(manifest.scanner_artifact?.artifact_url || "")
  if (!artifactUrl) throw new Error("Catalog manifest is missing the compact scanner artifact")
  const artifactResp = await fetch(artifactUrl, { signal: AbortSignal.timeout(15000) })
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

async function main() {
  // A lexical microbenchmark cannot certify interaction performance. Real
  // browser journeys must use the installed package in Playwright MCP, not a
  // hard-coded headless browser that silently skips when its path is obsolete.
  if (!process.argv.includes("--lexical-only")) {
    throw new Error(
      "Browser benchmark requires Playwright MCP: run scripts/lib/iconoplasm-reader-benchmark.mjs with its existing Page using the source adapter in docs/ICONOPLASM_READER_PERFORMANCE_BENCHMARK.md. Use --lexical-only only for the explicitly separate matcher microbenchmark.",
    )
  }
  const lexical = await runLexicalBenchmark()
  console.log(
    JSON.stringify(
      {
        lexical,
        scope: "lexical-only; no browser performance claim",
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
