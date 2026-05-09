import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const ROOT = new URL("../", import.meta.url)

function read(path) {
  return readFileSync(new URL(path, ROOT), "utf8")
}

test("Iconoplasm Cloudflare ops uses one iconoplasm-admin secret source", () => {
  const workflowPaths = [
    ".github/workflows/deploy-quartz.yml",
    ".github/workflows/deploy-pages-staging.yml",
    ".github/workflows/deploy-preview.yaml",
    ".github/workflows/deploy-benchmark.yml",
    ".github/workflows/refresh-iconoplasm-observability-snapshot.yml",
    ".github/workflows/rotate-iconoplasm-admin-token.yml",
  ]
  for (const workflowPath of workflowPaths) {
    const source = read(workflowPath)
    assert.match(
      source,
      /secrets\.CLOUDFLARE_ICONOPLASM_ADMIN_TOKEN/,
      `${workflowPath} should source Cloudflare auth from iconoplasm-admin`,
    )
    assert.doesNotMatch(
      source,
      /secrets\.CLOUDFLARE_API_TOKEN/,
      `${workflowPath} must not read the old generic Cloudflare token secret`,
    )
  }
})

test("observability snapshot does not recover from Wrangler OAuth", () => {
  const source = read("scripts/generate-iconoplasm-observability-snapshot.mjs")
  assert.match(source, /account-owned iconoplasm-admin token/)
  assert.doesNotMatch(source, /readWranglerOAuthTokenFromCli|readWranglerAccountId/)
  assert.doesNotMatch(source, /wrangler auth token|wrangler whoami/i)
})

test("credential docs retire cache and Wrangler fallback paths", () => {
  const deployDocs = read("docs/ICONOPLASM_DEPLOY_CREDENTIALS.md")
  const operationsDocs = read("docs/ICONOPLASM_OPERATIONS.md")
  assert.match(deployDocs, /account-owned token named `iconoplasm-admin`/)
  assert.match(deployDocs, /cloudflare_auth_cache\.json` is retired/)
  assert.match(operationsDocs, /do not use Wrangler OAuth or `cloudflare_auth_cache\.json`/)
})
