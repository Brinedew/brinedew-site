import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { fileURLToPath, pathToFileURL } from "node:url"
import { writeIconoplasmCompatibilityArtifacts } from "./prepare-iconoplasm-edge-assets.mjs"

const CDN = "https://iconoplasmportraits.b-cdn.net"
const HASH = /^[a-f0-9]{64}$/
const MANIFEST = new URL(
  "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  import.meta.url,
)
const VERIFY_INTERVAL_MS = 10_000
const MIGRATION_STALL_MS = 5 * 60_000
const MIGRATION_EXECUTION_WINDOW_MS = 50 * 60_000
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
  // This keeps the current shell and immutable assets unchanged while the sole
  // publisher emits and Bunny proves build-revision 3. The first-party blot
  // route already belongs to the exact-card Worker handler during preparation.
  // Final activation attaches the newly built SPA assets and route list.
  output = output.replace(
    assets[0],
    `\n[unsafe.metadata]\nkeep_assets = true\nassets = { config = { not_found_handling = "none", run_worker_first = ["/api/*", "/blot/*", "/portraits/*", "/published-cards/v2/immutable/*", "/admin*", "/blocklist*", "/artist-styles*", "/health", "/gene/*", "/genes*", "/sitemap*", "/robots.txt", "/llms.txt"] } }\n\n`,
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
  const symbols = new Set()
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
    for (const entry of index.search_entries) {
      const symbol = String(entry?.[0] || "")
        .trim()
        .toUpperCase()
      if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(symbol) || symbols.has(symbol)) {
        throw new Error("public read symbol inventory is invalid")
      }
      symbols.add(symbol)
    }
  }
  if (symbols.size !== manifest.card_count) {
    throw new Error("public read symbol inventory is incomplete")
  }
  return {
    version: head.current,
    geneCount: manifest.card_count,
    indexCount: manifest.shards.length,
    symbols: [...symbols].sort((left, right) => left.localeCompare(right)),
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

function migrationReceipt(status) {
  const buildRevision = Number(status?.build_revision || 0)
  const job = status?.job
  // A full content rematerialization keeps the previous head readable until
  // one verified commit; it must not restart schema migration.
  if (job?.rematerialize === true && buildRevision >= 3) return { complete: true, status }
  if (!job && buildRevision >= 3) return { complete: true, status }
  if (!job) {
    return { complete: false, identity: "pending", progress: [0, 0, 0], status }
  }
  return {
    complete: false,
    identity: String(job.started_at || ""),
    progress: [
      Math.max(0, Number(job.group || 0)),
      Math.max(0, Number(job.offset || 0)),
      Math.max(0, Number(job.seal_offset || 0)),
    ],
    status,
  }
}

export async function startPublicationMigrationIfRequired({
  readStatus,
  startMigration,
  attempts = 6,
  intervalMs = 5_000,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof readStatus !== "function") throw new Error("Migration status reader is required")
  if (typeof startMigration !== "function") throw new Error("Migration starter is required")
  let status
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      status = await readStatus()
      break
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(intervalMs)
    }
  }
  if (!status) throw lastError || new Error("Publication migration status remained unavailable")
  if (migrationReceipt(status).complete) return { started: false, status }
  await startMigration()
  return { started: true, status }
}

function compareProgress(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

export async function waitForPublicationMigration({
  readStatus,
  intervalMs = VERIFY_INTERVAL_MS,
  stallMs = MIGRATION_STALL_MS,
  windowMs = MIGRATION_EXECUTION_WINDOW_MS,
  now = Date.now,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof readStatus !== "function") throw new Error("Migration progress reader is required")
  const startedAt = now()
  let lastProgressAt = startedAt
  let previous = null
  while (true) {
    let status
    try {
      status = await readStatus()
    } catch (error) {
      const failedAt = now()
      if (failedAt - startedAt >= windowMs) {
        throw new Error("Publication migration execution window exhausted; rerun to continue", {
          cause: error,
        })
      }
      if (failedAt - lastProgressAt >= stallMs) {
        throw new Error("Publication migration stalled: owner status remained unavailable", {
          cause: error,
        })
      }
      await wait(
        Math.min(
          intervalMs,
          windowMs - (failedAt - startedAt),
          stallMs - (failedAt - lastProgressAt),
        ),
      )
      continue
    }
    const receipt = migrationReceipt(status)
    if (receipt.complete) return receipt.status
    const observedAt = now()
    if (previous) {
      if (receipt.identity !== previous.identity) {
        throw new Error("Publication migration identity changed before completion")
      }
      const comparison = compareProgress(receipt.progress, previous.progress)
      if (comparison < 0) throw new Error("Publication migration progress regressed")
      if (comparison > 0) lastProgressAt = observedAt
    } else {
      previous = receipt
      lastProgressAt = observedAt
    }
    previous = receipt
    if (observedAt - startedAt >= windowMs) {
      throw new Error("Publication migration execution window exhausted; rerun to continue")
    }
    if (observedAt - lastProgressAt >= stallMs) {
      const failure = receipt.status?.failure?.message || receipt.status?.failure?.code || ""
      throw new Error(`Publication migration stalled${failure ? `: ${failure}` : ""}`)
    }
    await wait(Math.min(intervalMs, windowMs - (observedAt - startedAt)))
  }
}

export async function releasePublicReadCutover({
  deployPreparation,
  startMigration,
  waitForMigration,
  verifyArtifacts,
  prepareStaticCompatibility,
  activate,
}) {
  await deployPreparation()
  await startMigration()
  const migration = await waitForMigration()
  const verification = await verifyArtifacts()
  await prepareStaticCompatibility(verification)
  await activate(verification)
  return { migration, verification }
}

async function runPnpm(args, timeoutMs = 300_000) {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  return execFileAsync(executable, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })
}

async function publicationMigrationStatus(adminToken) {
  const response = await fetch(
    "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/gallery/migrate-card-storage/status",
    {
      method: "GET",
      headers: { "x-iconoplasm-admin-token": adminToken, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!response.ok) throw new Error(`Publication migration status failed (${response.status})`)
  return response.json()
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
        ])
      },
      startMigration: async () => {
        await startPublicationMigrationIfRequired({
          readStatus: () => publicationMigrationStatus(adminToken),
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
        })
      },
      waitForMigration: () =>
        waitForPublicationMigration({
          readStatus: () => publicationMigrationStatus(adminToken),
        }),
      verifyArtifacts: () => waitForPublicReadArtifacts(),
      prepareStaticCompatibility: (verification) =>
        writeIconoplasmCompatibilityArtifacts({ symbols: verification.symbols }),
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
    console.log(JSON.stringify(await waitForPublicReadArtifacts()))
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
