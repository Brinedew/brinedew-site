import { waitForSuccessfulPushCi } from "./lib/github-ci-gate.mjs"
import { appendFileSync } from "node:fs"

try {
  const run = await waitForSuccessfulPushCi({
    repository: process.env.GITHUB_REPOSITORY,
    headSha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  })
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ci_run_id=${run.id}\n`)
  console.log(`[iconoplasm-release-ci] Build and Test ${run.id} succeeded for ${run.head_sha}`)
} catch (error) {
  console.error(`[iconoplasm-release-ci] ${error.message}`)
  process.exit(1)
}
