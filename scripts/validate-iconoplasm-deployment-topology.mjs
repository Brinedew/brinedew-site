import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import toml from "toml"
import { assertIconoplasmStaticFirstCacheConfig } from "./lib/iconoplasm-static-first-config.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const topologyPath = path.join(repositoryRoot, "cloudflare", "deployment-topology.json")
const topology = JSON.parse(readFileSync(topologyPath, "utf8"))

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8")
}

function fail(message) {
  throw new Error(`[iconoplasm-topology] ${message}`)
}

if (topology.schemaVersion !== 1 || topology.architectureFence !== "IPD-009") {
  fail("manifest schema or architecture fence is not current")
}

for (const entry of topology.protectedEntrypoints) {
  try {
    statSync(path.join(repositoryRoot, entry.path))
  } catch {
    fail(`protected entrypoint is missing: ${entry.path}`)
  }
  if (!entry.path.startsWith("workers/") || !entry.path.endsWith(".js")) {
    fail(`protected entrypoint is not a Worker source file: ${entry.path}`)
  }
  if (entry.cloudflareScript !== topology.stateOwner.cloudflareScript) {
    fail(`protected entrypoints disagree on Cloudflare script: ${entry.path}`)
  }
}

const config = read(topology.wranglerConfig)
assertIconoplasmStaticFirstCacheConfig(toml.parse(config))
if (!config.match(/^name\s*=\s*"geneguessr-api"$/m)) {
  fail("Wrangler config changed the single state-owner script name")
}
if (
  !config.match(
    /^main\s*=\s*"workers\/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate\.js"$/m,
  )
) {
  fail("Wrangler config no longer points at the protected composition boundary")
}
if (!config.match(/pattern\s*=\s*"iconoplasm\.brinedew\.bio\/\*"/)) {
  fail("Wrangler config no longer declares the direct Iconoplasm route")
}
if (!config.match(/directory\s*=\s*"\.\/public-iconoplasm-edge"/)) {
  fail("Workers Static Assets directory is missing")
}

const forbidden = topology.naming.forbiddenShortNames
const repositoryText = topology.protectedEntrypoints.map((entry) => read(entry.path)).join("\n")
for (const name of forbidden) {
  if (name === "iconoplasm-web") {
    if (repositoryText.includes(name)) {
      fail(`forbidden second-service name appears in protected runtime: ${name}`)
    }
    continue
  }
  if (new RegExp(`(?:^|/)${name.replace(".", "\\.")}$`, "m").test(repositoryText)) {
    fail(`forbidden catch-all name appears in protected runtime: ${name}`)
  }
}

if (
  !topology.staticFirst.staticAssetsBypassWorker ||
  topology.staticFirst.dynamicInvocationCount !== 1
) {
  fail("static-first one-invocation contract is not enabled")
}

console.log(
  "Iconoplasm deployment topology is valid: one state owner, one dynamic invocation, static-first assets.",
)
