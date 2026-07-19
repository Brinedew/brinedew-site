import { waitForSuccessfulPushCi } from "./lib/github-ci-gate.mjs"

try {
  const run = await waitForSuccessfulPushCi({
    repository: process.env.GITHUB_REPOSITORY,
    headSha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  })
  console.log(`[iconoplasm-release-ci] Build and Test ${run.id} succeeded for ${run.head_sha}`)
} catch (error) {
  console.error(`[iconoplasm-release-ci] ${error.message}`)
  process.exit(1)
}
