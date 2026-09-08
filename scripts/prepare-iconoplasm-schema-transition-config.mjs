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

export function prepareSchemaTransitionConfig(source, { mode = SCHEMA_TRANSITION_MODE } = {}) {
  if (source.split(canonicalMain).length !== 2)
    throw new Error("Expected exactly one canonical stateful Worker entrypoint")
  if (mode !== SCHEMA_TRANSITION_MODE)
    throw new Error(`Unsupported schema-transition mode: ${String(mode || "")}`)
  // B-742: the migration stage is a live deployment. If admission subsequently
  // fails, the already-tested published-card reader must survive that failed stage.
  // Preserve every route, secret binding, Durable Object identity and budget.
  return source.replace(canonicalMain, transitionMain)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url)
  const source = readFileSync(new URL(CANONICAL_CONFIG, root), "utf8")
  writeFileSync(new URL(TRANSITION_CONFIG, root), prepareSchemaTransitionConfig(source), "utf8")
}
