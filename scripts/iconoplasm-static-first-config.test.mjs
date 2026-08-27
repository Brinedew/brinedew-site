import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import toml from "toml"
import { assertIconoplasmStaticFirstCacheConfig } from "./lib/iconoplasm-static-first-config.mjs"

// ARCHITECTURE FENCE [IPD-007]: mutation tests exercise parsed TOML, not comment
// matching. A new named environment or cached entrypoint must not evade the gate.
test("current deployment preserves unmetered static asset delivery", () => {
  const config = toml.parse(
    readFileSync(
      new URL(
        "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  assert.doesNotThrow(() => assertIconoplasmStaticFirstCacheConfig(config))
})

for (const [name, source] of [
  ["top-level table", "[cache]\nenabled = true"],
  ["inline table", "cache = { enabled = true }"],
  ["staging override", "[env.staging.cache]\nenabled = true"],
  ["new environment", "[env.preview.cache]\nenabled = true"],
  ["default entrypoint", "[exports.default.cache]\nenabled = true"],
  ["named entrypoint", "[exports.CachedCounter.cache]\nenabled = true"],
  ["environment entrypoint", "[env.staging.exports.CachedCounter.cache]\nenabled = true"],
  ["invalid truthy value", 'cache = { enabled = "true" }'],
]) {
  test(`rejects metered Workers Cache: ${name}`, () => {
    assert.throws(() => assertIconoplasmStaticFirstCacheConfig(toml.parse(source)), /IPD-007/)
  })
}

test("false, omitted, comments and unrelated application settings stay valid", () => {
  const config = toml.parse(`
# cache = { enabled = true } is a warning, not configuration.
cache = { enabled = false }
[exports.default.cache]
enabled = false
[env.staging.cache]
enabled = false
[vars]
CACHE_ENABLED = "true"
`)
  assert.doesNotThrow(() => assertIconoplasmStaticFirstCacheConfig(config))
})
