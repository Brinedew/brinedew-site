import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

export const CANONICAL_CONFIG =
  "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"
export const TRANSITION_CONFIG = "wrangler.iconoplasm-schema-transition.generated.toml"
export const SCHEMA_TRANSITION_MODE = "reader-recovery"
const canonicalMain =
  'main = "workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"'
const transitionMain =
  'main = "workers/b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js"'

// A containment deploy keeps the exact asset bytes already serving production,
// so the per-gene documents, the crawler documents (robots.txt, sitemap.xml,
// llms.txt) and the /genes redirects are served by the asset layer exactly as in
// production, at no Worker request. Only the Worker's own routes enter the
// quarantine shell. This explicit list is not a broad `run_worker_first = true`.
// The reader-recovery containment deploy is its one user.
export function prepareRetainedAssetsConfig(source) {
  let output = String(source)
  if (!/^routes = \[\{ pattern = "iconoplasm\.brinedew\.bio\/\*"/m.test(output))
    throw new Error("Canonical Iconoplasm production route is missing")
  const assets = output.match(/\n\[assets\]\n[\s\S]*?\n(?=\[observability\])/u)
  if (!assets) throw new Error("Canonical Iconoplasm asset routing is missing")
  output = output.replace(
    assets[0],
    `\n[unsafe.metadata]\nkeep_assets = true\nassets = { config = { not_found_handling = "none", run_worker_first = ["/api/*", "/blot/*", "/portraits/*", "/admin", "/admin/iconoplasm", "/admin/iconoplasm/", "/blocklist", "/blocklist/", "/artist-styles", "/artist-styles/", "/health"] } }\n\n`,
  )
  return output
}

export function prepareSchemaTransitionConfig(source, { mode = SCHEMA_TRANSITION_MODE } = {}) {
  if (source.split(canonicalMain).length !== 2)
    throw new Error("Expected exactly one canonical stateful Worker entrypoint")
  if (mode !== SCHEMA_TRANSITION_MODE)
    throw new Error(`Unsupported schema-transition mode: ${String(mode || "")}`)
  // B-742: the migration stage is a live deployment. If admission subsequently
  // fails, the already-tested published-card reader must survive that failed stage.
  // Preserve every route, secret binding, Durable Object identity and budget.
  return prepareRetainedAssetsConfig(source.replace(canonicalMain, transitionMain))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url)
  const source = readFileSync(new URL(CANONICAL_CONFIG, root), "utf8")
  writeFileSync(new URL(TRANSITION_CONFIG, root), prepareSchemaTransitionConfig(source), "utf8")
}
