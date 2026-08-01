import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8")

// ARCHITECTURE FENCE [IPD-009]
test("IPD-009 keeps the protected filenames and one-owner topology executable", () => {
  const topology = JSON.parse(read("cloudflare/deployment-topology.json"))
  assert.equal(topology.architectureFence, "IPD-009")
  assert.equal(topology.stateOwner.cloudflareScript, "geneguessr-api")
  assert.equal(topology.staticFirst.dynamicInvocationCount, 1)
  assert.equal(topology.staticFirst.staticAssetsBypassWorker, true)
  assert.deepEqual(
    topology.protectedEntrypoints.map((entry) => entry.path),
    [
      "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    ],
  )

  const config = read("wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")
  assert.match(config, /name\s*=\s*"geneguessr-api"/)
  assert.match(config, /pattern = "iconoplasm\.brinedew\.bio\/\*"/)
  assert.match(config, /directory = "\.\/public-iconoplasm-edge"/)
  assert.doesNotMatch(config, /iconoplasm-web|public-worker/)

  const lifecycle = read("docs/ICONOPLASM_REQUEST_LIFECYCLE.md")
  assert.match(lifecycle, /ARCHITECTURE FENCE \[IPD-009\]|IPD-009/)
  assert.match(lifecycle, /cache lookup must precede/i)
  assert.match(lifecycle, /icono_published_gene_routes/)
})
