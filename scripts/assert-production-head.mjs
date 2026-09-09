import { assertCurrentProductionHead } from "./lib/production-head-gate.mjs"

try {
  const sha = await assertCurrentProductionHead({
    repository: process.env.GITHUB_REPOSITORY,
    headSha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  })
  console.log(`[production-source] Current main verified: ${sha}`)
} catch (error) {
  console.error(`[production-source] ${error.message}`)
  process.exit(1)
}
