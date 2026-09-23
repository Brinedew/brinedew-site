import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { readIconoplasmReleaseState } from "./read-iconoplasm-release-state.mjs"

const SHA = /^[a-f0-9]{40}$/
// Wrangler route/config edits ship with the tested code. Only data migrations
// and the named account policy/topology owners require a maintenance release.
const MAINTENANCE_PATH =
  /^(?:cloudflare\/(?:operation-cost-migration-plan|deployment-topology|iconoplasm-crawler-policy)\.json$)|\.sql$/i
const MIGRATION_BINDINGS = Object.freeze({
  migrations: "DB",
  "workers/benchmark/migrations": "DB",
  "migrations-iconoplasm": "ICONOPLASM_DB",
  "migrations-iconoplasm-authoring": "ICONOPLASM_AUTHORING_DB",
  "migrations-iconoplasm-event-archive": "ICONOPLASM_AUTHORITY_EVENT_ARCHIVE_DB",
})

function migrationBinding(path) {
  if (!path.endsWith(".sql")) return null
  return MIGRATION_BINDINGS[path.slice(0, path.lastIndexOf("/"))] || null
}

export async function readAppliedChangedMigrations({
  changedPaths,
  accountId,
  token,
  configText = readFileSync(
    new URL(
      "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      import.meta.url,
    ),
    "utf8",
  ),
  fetcher = fetch,
}) {
  const byBinding = new Map()
  for (const path of changedPaths) {
    const binding = migrationBinding(path)
    if (!binding) continue
    if (!existsSync(new URL(`../${path}`, import.meta.url)))
      throw new Error("CODE_RELEASE_REQUIRES_MAINTENANCE")
    const rows = byBinding.get(binding) || []
    rows.push({ path, name: path.slice(path.lastIndexOf("/") + 1) })
    byBinding.set(binding, rows)
  }
  if (byBinding.size === 0) return new Set()
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("CODE_RELEASE_MIGRATION_STATE_UNAVAILABLE")
  const databases = new Map()
  for (const block of configText.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|$)/g) || []) {
    const binding = block.match(/^binding\s*=\s*"([^"]+)"/m)?.[1]
    const id = block.match(/^database_id\s*=\s*"([a-f0-9-]+)"/m)?.[1]
    if (binding && /^[a-f0-9-]{36}$/.test(id || "")) databases.set(binding, id)
  }
  const applied = new Set()
  for (const [binding, rows] of byBinding) {
    const databaseId = databases.get(binding)
    const names = rows.map((row) => row.name)
    if (!databaseId || new Set(names).size !== names.length)
      throw new Error("CODE_RELEASE_MIGRATION_STATE_UNAVAILABLE")
    let response
    try {
      response = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            sql: `SELECT name FROM d1_migrations WHERE name IN (${names.map(() => "?").join(", ")})`,
            params: names,
          }),
          signal: AbortSignal.timeout(8000),
        },
      )
      if (!response.ok) throw new Error("D1 query failed")
      const payload = await response.json()
      const result = payload?.result?.[0]
      if (!payload?.success || result?.success === false || !Array.isArray(result?.results))
        throw new Error("D1 result invalid")
      const present = new Set(result.results.map((row) => row.name))
      for (const row of rows) if (present.has(row.name)) applied.add(row.path)
    } catch {
      throw new Error("CODE_RELEASE_MIGRATION_STATE_UNAVAILABLE")
    }
  }
  return applied
}

export function verifyCodeReleaseScope({
  state,
  headSha,
  changedPaths,
  installedIsAncestor,
  appliedMigrations = new Set(),
}) {
  if (state?.schema_transition || state?.reader_recovery)
    throw new Error("CODE_RELEASE_INCOMPATIBLE_STATE")
  const installed = state?.cache_version
  if (!SHA.test(installed || "")) throw new Error("CODE_RELEASE_INSTALLED_REVISION_UNKNOWN")
  if (!SHA.test(headSha || "")) throw new Error("CODE_RELEASE_HEAD_UNKNOWN")
  if (!installedIsAncestor) throw new Error("CODE_RELEASE_INSTALLED_REVISION_NOT_ANCESTOR")
  if (
    changedPaths.some(
      (path) =>
        MAINTENANCE_PATH.test(path) && (!migrationBinding(path) || !appliedMigrations.has(path)),
    )
  )
    throw new Error("CODE_RELEASE_REQUIRES_MAINTENANCE")
  return { installed_sha: installed, head_sha: headSha, changed_paths: changedPaths }
}

async function main() {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  if (headSha !== process.env.GITHUB_SHA) throw new Error("CODE_RELEASE_HEAD_UNKNOWN")
  const state = await readIconoplasmReleaseState()
  const installed = state.cache_version
  const ancestor = SHA.test(installed || "")
    ? spawnSync("git", ["merge-base", "--is-ancestor", installed, headSha], {
        stdio: "ignore",
      }).status === 0
    : false
  const changedPaths = ancestor
    ? execFileSync("git", ["diff", "--name-only", `${installed}..${headSha}`], {
        encoding: "utf8",
      })
        .split(/\r?\n/)
        .filter(Boolean)
    : []
  const appliedMigrations = await readAppliedChangedMigrations({
    changedPaths,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  })
  const verified = verifyCodeReleaseScope({
    state,
    headSha,
    changedPaths,
    installedIsAncestor: ancestor,
    appliedMigrations,
  })
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, `ICONOPLASM_INSTALLED_SHA=${installed}\n`)
  console.log(JSON.stringify({ ...verified, journaled_migrations: [...appliedMigrations].sort() }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
