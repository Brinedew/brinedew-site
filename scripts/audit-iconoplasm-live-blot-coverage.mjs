const DEFAULT_ORIGIN = "https://iconoplasm.brinedew.bio"
const DEFAULT_CONCURRENCY = 8
const DEFAULT_TIMEOUT_MS = 15_000

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return text
}

function matches(text, expression) {
  return [...text.matchAll(expression)].map((match) => match[1] ?? match[0])
}

async function mapConcurrent(values, concurrency, task) {
  const results = new Array(values.length)
  let next = 0
  async function worker() {
    while (next < values.length) {
      const index = next++
      results[index] = await task(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

const origin = new URL(option("--origin", DEFAULT_ORIGIN)).origin
const concurrency = positiveInteger(option("--concurrency", DEFAULT_CONCURRENCY), "concurrency")
const timeoutMs = positiveInteger(option("--timeout-ms", DEFAULT_TIMEOUT_MS), "timeout-ms")
const requireComplete = process.argv.includes("--require-complete")
const cacheBust = `coverage-${Date.now()}`

const sitemapIndex = await fetchText(`${origin}/sitemap.xml?v=${cacheBust}`, timeoutMs)
const shardUrls = matches(
  sitemapIndex,
  /<loc>(https:\/\/[^<]+\/sitemaps\/genes\/[^<]+\.xml)<\/loc>/g,
)
if (!shardUrls.length) throw new Error("The sitemap index contains no gene shards")

const shards = await mapConcurrent(shardUrls, concurrency, async (url) => {
  const separator = url.includes("?") ? "&" : "?"
  const xml = await fetchText(`${url}${separator}v=${cacheBust}`, timeoutMs)
  const genes = matches(xml, /<url>/g).length
  const blots = matches(xml, /<image:image>/g).length
  const singularBlots = matches(
    xml,
    /<image:loc>(https:\/\/iconoplasm\.brinedew\.bio\/blot\/[A-Z0-9.-]+\.webp)<\/image:loc>/g,
  ).length
  if (blots !== singularBlots) {
    throw new Error(
      `${url} contains ${blots} blot images but ${singularBlots} singular semantic URLs`,
    )
  }
  return { url, genes, blots }
})

const publishedGenes = shards.reduce((sum, shard) => sum + shard.genes, 0)
const readyBlots = shards.reduce((sum, shard) => sum + shard.blots, 0)
const complete = publishedGenes > 0 && readyBlots === publishedGenes
const result = {
  origin,
  shard_count: shards.length,
  published_genes: publishedGenes,
  ready_blots: readyBlots,
  missing_blots: publishedGenes - readyBlots,
  coverage_fraction: publishedGenes ? readyBlots / publishedGenes : 0,
  complete,
}

console.log(JSON.stringify(result))
if (requireComplete && !complete) process.exitCode = 2
