import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import toml from "toml"
import {
  CANONICAL_CONFIG,
  prepareSchemaTransitionConfig,
} from "./prepare-iconoplasm-schema-transition-config.mjs"

test("schema staging preserves every production binding", () => {
  const source = readFileSync(new URL(`../${CANONICAL_CONFIG}`, import.meta.url), "utf8")
  const canonical = toml.parse(source)
  const prepared = toml.parse(prepareSchemaTransitionConfig(source))
  assert.equal(
    prepared.main,
    "workers/b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js",
  )
  const canonicalState = { ...canonical }
  delete canonicalState.assets
  const { unsafe: preparedUnsafe, ...preparedState } = prepared
  assert.deepEqual({ ...preparedState, main: canonical.main }, canonicalState)
  assert.equal(preparedUnsafe.metadata.keep_assets, true)
  assert.equal(preparedUnsafe.metadata.assets.config.not_found_handling, "none")
})
