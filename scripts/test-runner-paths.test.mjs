import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

test("explicit missing suite fails before tsx can silently skip it", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-tests.mjs",
      "scripts/test-runner-paths.test.mjs",
      "scripts/nonexistent-regression-657a6eb4.test.mjs",
    ],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4096 },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Test paths do not exist: scripts\/nonexistent-regression-/)
  assert.equal(result.stdout, "")
})
