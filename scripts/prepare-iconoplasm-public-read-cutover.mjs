import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  CARD_PUBLICATION_BATCH,
  CARD_PUBLICATION_PACKED_SHARD_CARD_LIMIT,
} from "../workers/lib/iconoplasm-card-publication.js"
import { CARD_PUBLICATION_ALARM_CADENCE_MS } from "../workers/lib/iconoplasm-card-publication-coordinator.js"

const CDN = "https://iconoplasmportraits.b-cdn.net"
const HASH = /^[a-f0-9]{64}$/
const MANIFEST = new URL(
  "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  import.meta.url,
)
const VERIFY_INTERVAL_MS = 10_000
const CDN_PROPAGATION_MS = 2 * 30_000
const execFileAsync = promisify(execFile)

export function preparePublicReadCutoverConfig(source) {
  let output = String(source)
  if (!/^routes = \[\{ pattern = "iconoplasm\.brinedew\.bio\/\*"/m.test(output))
    throw new Error("Canonical Iconoplasm production route is missing")
  const assets = output.match(/\n\[assets\]\n[\s\S]*?\n(?=\[observability\])/u)
  if (!assets) throw new Error("Canonical Iconoplasm asset routing is missing")
  // Preparation deploys new publisher/runtime code but deliberately retains the
  // exact asset bytes already serving production. The explicit legacy routing
  // config is the pre-cutover topology, not a broad `run_worker_first = true`.
  // This keeps the current site unchanged while the sole publisher emits and
  // Bunny proves build-revision 3. The final canonical deploy is the only step
  // allowed to attach the newly built SPA assets and static-first route list.
  output = output.replace(
    assets[0],
    `\n[unsafe.metadata]\nkeep_assets = true\nassets = { config = { not_found_handling = "none", run_worker_first = ["/api/*", "/portraits/*", "/published-cards/v2/immutable/*", "/admin*", "/blocklist*", "/artist-styles*", "/health", "/gene/*", "/genes*", "/sitemap*", "/robots.txt", "/llms.txt"] } }\n\n`,
  )
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

export async function currentPublicCatalogShape({
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
    !Number.isSafeInteger(manifest?.card_count) ||
    manifest.card_count < 1 ||
    !Array.isArray(manifest.shards) ||
    !manifest.shards.length
  )
    throw new Error("Current public catalog shape is invalid")
  return { cardCount: manifest.card_count, shardCount: manifest.shards.length }
}

export function migrationVerificationPlan(cardCount, shardCount = null) {
  const count = Number(cardCount)
  if (!Number.isSafeInteger(count) || count < 1 || count > 20_000)
    throw new Error("Catalog card count is outside the reviewed bound")
  const measuredShards =
    shardCount == null
      ? Math.ceil(count / CARD_PUBLICATION_PACKED_SHARD_CARD_LIMIT)
      : Number(shardCount)
  if (!Number.isSafeInteger(measuredShards) || measuredShards < 1 || measuredShards > count)
    throw new Error("Catalog shard count is outside the reviewed bound")
  const prepareRounds = Math.ceil(count / CARD_PUBLICATION_BATCH)
  const sealRounds = measuredShards
  const controlRounds = 2
  const deadlineMs =
    (prepareRounds + sealRounds + controlRounds) * CARD_PUBLICATION_ALARM_CADENCE_MS +
    CDN_PROPAGATION_MS
  return {
    cardCount: count,
    prepareRounds,
    sealRounds,
    controlRounds,
    cadenceMs: CARD_PUBLICATION_ALARM_CADENCE_MS,
    propagationMs: CDN_PROPAGATION_MS,
    intervalMs: VERIFY_INTERVAL_MS,
    deadlineMs,
    attempts: Math.ceil(deadlineMs / VERIFY_INTERVAL_MS) + 1,
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

export async function releasePublicReadCutover({
  deployPreparation,
  currentCardCount,
  startMigration,
  verify,
  activate,
}) {
  await deployPreparation()
  const shape = await currentCardCount()
  const cardCount = typeof shape === "number" ? shape : shape.cardCount
  const shardCount = typeof shape === "number" ? null : shape.shardCount
  const plan = migrationVerificationPlan(cardCount, shardCount)
  await startMigration()
  const verification = await verify(plan)
  await activate(verification)
  return { plan, verification }
}

async function runPnpm(args, timeoutMs = 300_000) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  return execFileAsync(executable, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })
}

async function releaseFromCli(cacheBust) {
  const adminToken = String(process.env.ICONOPLASM_ADMIN_TOKEN || "").trim()
  if (!adminToken) throw new Error("ICONOPLASM_ADMIN_TOKEN is required")
  if (!/^[a-f0-9]{7,64}$/i.test(cacheBust)) throw new Error("A release cache identity is required")
  const configPath = "wrangler.iconoplasm-public-read-preparation.generated.toml"
  await writeFile(
    configPath,
    preparePublicReadCutoverConfig(await readFile(MANIFEST, "utf8")),
    "utf8",
  )
  try {
    return await releasePublicReadCutover({
      deployPreparation: async () => {
        await runPnpm([
          "exec",
          "wrangler",
          "deploy",
          "--env=",
          "--config",
          configPath,
          "--var",
          `ICONOPLASM_HTML_SHELL_CACHE_VERSION:${cacheBust}-backend`,
          "--triggers",
          "55 23 * * *",
          "3 0 * * *",
          "6 12 * * *",
        ])
      },
      currentCardCount: () => currentPublicCatalogShape(),
      startMigration: async () => {
        const response = await fetch(
          "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/gallery/migrate-card-storage",
          {
            method: "POST",
            headers: { "x-iconoplasm-admin-token": adminToken },
            signal: AbortSignal.timeout(30_000),
          },
        )
        if (!response.ok)
          throw new Error(`Publication migration request failed (${response.status})`)
      },
      verify: (plan) =>
        waitForPublicReadArtifacts({ attempts: plan.attempts, intervalMs: plan.intervalMs }),
      activate: () =>
        runPnpm([
          "exec",
          "wrangler",
          "deploy",
          "--env=",
          "--config",
          fileURLToPath(MANIFEST),
          "--var",
          `ICONOPLASM_HTML_SHELL_CACHE_VERSION:${cacheBust}-backend`,
          "--triggers",
          "55 23 * * *",
          "3 0 * * *",
          "6 12 * * *",
        ]),
    })
  } finally {
    await rm(configPath, { force: true })
  }
}

async function main() {
  const [mode, outputPath] = process.argv.slice(2)
  if (mode === "--write") {
    if (!outputPath) throw new Error("--write requires an output path")
    const source = await readFile(MANIFEST, "utf8")
    await writeFile(outputPath, preparePublicReadCutoverConfig(source), "utf8")
    return
  }
  if (mode === "--verify") {
    const shape = await currentPublicCatalogShape()
    const plan = migrationVerificationPlan(shape.cardCount, shape.shardCount)
    console.log(
      JSON.stringify(
        await waitForPublicReadArtifacts({ attempts: plan.attempts, intervalMs: plan.intervalMs }),
      ),
    )
    return
  }
  if (mode === "--release") {
    console.log(JSON.stringify(await releaseFromCli(outputPath)))
    return
  }
  throw new Error("Use --write <path>, --verify, or --release <cache-identity>")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
