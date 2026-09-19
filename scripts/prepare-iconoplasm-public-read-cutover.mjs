import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

const CDN = "https://iconoplasmportraits.b-cdn.net"
const HASH = /^[a-f0-9]{64}$/
export function preparePublicReadCutoverConfig(source) {
  let output = String(source).replace(
    'not_found_handling = "single-page-application"',
    'not_found_handling = "none"',
  )
  const runWorkerFirst = /run_worker_first = \[[\s\S]*?\n\]/
  if (!runWorkerFirst.test(output))
    throw new Error("Canonical assets run_worker_first list is missing")
  // This is deliberately all routes, not a guessed legacy-route inventory.
  // The new browser bundle is uploaded but cannot become the anonymous read
  // path until Bunny proves every compact artifact is coherent.
  output = output.replace(runWorkerFirst, "run_worker_first = true")
  return output
}

async function exactJson(fetchImpl, url, expectedHash = null, verifyHash = true) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error(`Public read artifact HTTP ${response.status}`)
  const text = await response.text()
  if (verifyHash && expectedHash) {
    const actual = createHash("sha256").update(text).digest("hex")
    if (actual !== expectedHash) throw new Error("Public read artifact hash mismatch")
  }
  return JSON.parse(text)
}

export async function verifyPublicReadArtifacts({
  fetchImpl = globalThis.fetch,
  verifyHash = true,
} = {}) {
  const head = await exactJson(fetchImpl, `${CDN}/api/public/v1/card-current`, null, false)
  const match = /^ccv2-([a-f0-9]{64})$/.exec(String(head?.current || ""))
  if (!match) throw new Error("Public read head is unavailable")
  const manifest = await exactJson(
    fetchImpl,
    `${CDN}/published-cards/v2/immutable/manifests/${match[1]}.json`,
    match[1],
    verifyHash,
  )
  if (
    manifest?.storage !== "bunny_card_catalog_v2" ||
    Number(manifest.build_revision) < 3 ||
    !Number.isSafeInteger(manifest.card_count) ||
    manifest.card_count < 1 ||
    !Array.isArray(manifest.shards) ||
    manifest.shards.some((shard) => !shard?.catalog_index?.key)
  ) {
    throw new Error("public read artifacts are not activated")
  }
  for (const shard of manifest.shards) {
    const identity = String(shard.catalog_index.key).match(
      /^published-cards\/v2\/immutable\/catalogindexes\/([a-f0-9]{64})\.json$/,
    )
    if (!identity || !HASH.test(identity[1])) throw new Error("Invalid public read catalog index")
    const index = await exactJson(
      fetchImpl,
      `${CDN}/${shard.catalog_index.key}`,
      identity[1],
      verifyHash,
    )
    if (
      index?.schema_version !== 2 ||
      !Array.isArray(index.pages) ||
      !Array.isArray(index.search_entries) ||
      !Array.isArray(index.gallery_entries)
    )
      throw new Error("public read artifacts are not activated")
  }
  return {
    version: head.current,
    geneCount: manifest.card_count,
    indexCount: manifest.shards.length,
  }
}

export async function waitForPublicReadArtifacts({
  attempts = 24,
  intervalMs = 10_000,
  verify = verifyPublicReadArtifacts,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verify()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(intervalMs)
    }
  }
  throw lastError
}

async function main() {
  const [mode, outputPath] = process.argv.slice(2)
  if (mode === "--write") {
    if (!outputPath) throw new Error("--write requires an output path")
    const source = await readFile(
      new URL(
        "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        import.meta.url,
      ),
      "utf8",
    )
    await writeFile(outputPath, preparePublicReadCutoverConfig(source), "utf8")
    return
  }
  if (mode === "--verify") {
    console.log(JSON.stringify(await waitForPublicReadArtifacts()))
    return
  }
  throw new Error("Use --write <path> or --verify")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
