import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { readIconoplasmReleaseState } from "./read-iconoplasm-release-state.mjs"

const SHA = /^[a-f0-9]{40}$/
const MAINTENANCE_PATH =
  /^(?:migrations[^/]*\/|cloudflare\/(?:operation-cost-migration-plan|deployment-topology|iconoplasm-crawler-policy)\.json$|wrangler[^/]*\.toml$)|\.sql$/i

export function verifyCodeReleaseScope({ state, headSha, changedPaths, installedIsAncestor }) {
  if (state?.schema_transition || state?.reader_recovery)
    throw new Error("CODE_RELEASE_INCOMPATIBLE_STATE")
  const installed = state?.cache_version
  if (!SHA.test(installed || "")) throw new Error("CODE_RELEASE_INSTALLED_REVISION_UNKNOWN")
  if (!SHA.test(headSha || "")) throw new Error("CODE_RELEASE_HEAD_UNKNOWN")
  if (!installedIsAncestor) throw new Error("CODE_RELEASE_INSTALLED_REVISION_NOT_ANCESTOR")
  if (changedPaths.some((path) => MAINTENANCE_PATH.test(path)))
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
  const verified = verifyCodeReleaseScope({
    state,
    headSha,
    changedPaths,
    installedIsAncestor: ancestor,
  })
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, `ICONOPLASM_INSTALLED_SHA=${installed}\n`)
  console.log(JSON.stringify(verified))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
