import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./repair-iconoplasm-newer-tie-canon.mjs", import.meta.url))
const retiredCode = "LEGACY_GLOBAL_REPAIR_RETIRED"

test("retired repair has no remaining network, D1, or publication implementation", () => {
  const source = readFileSync(script, "utf8")
  assert.doesNotMatch(source, /\b(?:fetch|d1Query|adminPost|applyD1Repair|syncReadModels)\s*\(/)
  assert.doesNotMatch(source, /\b(?:import|require)\s*(?:\(|[{'"*])/)
})

for (const args of [
  [],
  ["--verify-only"],
  ["--apply-d1"],
  ["--sync-events"],
  ["--apply-d1", "--sync-events"],
]) {
  test(`retired repair refuses ${args.join(" ") || "default invocation"} before production access`, () => {
    const networkTrap = `
      globalThis.fetch = () => {
        console.error("FORBIDDEN_PRODUCTION_FETCH");
        process.exit(97);
      };
    `
    const result = spawnSync(
      process.execPath,
      ["--import", `data:text/javascript,${encodeURIComponent(networkTrap)}`, script, ...args],
      {
        encoding: "utf8",
        timeout: 5000,
        env: {
          ...process.env,
          CLOUDFLARE_ACCOUNT_ID: "test-account",
          CLOUDFLARE_API_TOKEN: "test-token",
          ICONOPLASM_ADMIN_TOKEN: "test-admin-token",
        },
      },
    )
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(retiredCode))
    assert.doesNotMatch(result.stderr, /FORBIDDEN_PRODUCTION_FETCH/)
    assert.equal(result.stdout, "")
  })
}
