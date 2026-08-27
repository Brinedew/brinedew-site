import assert from "node:assert/strict"
import test from "node:test"
import {
  assessBlockedHostStartup,
  measureBlockedHostStartup,
} from "./lib/iconoplasm-startup-benchmark.mjs"

test("startup benchmark fails missing evidence, late highlights, early network and duplicate markup", () => {
  const result = {
    first: { at: 900, fcp: 70, load: 0, highlights: 3, nested: 0 },
    beforeRelease: { state: "interactive", requests: [] },
    afterReleaseRequests: [{ url: "https://iconoplasm.brinedew.bio/api/public/v1/card-current" }],
  }
  assert.equal(assessBlockedHostStartup(result).verdict, "pass")
  for (const change of [
    { first: { ...result.first, at: 2100 } },
    { first: { ...result.first, fcp: null } },
    { first: { ...result.first, nested: 1 } },
    { beforeRelease: { state: "complete", requests: [] } },
    { beforeRelease: { state: "interactive", requests: [{ url: "early" }] } },
    { afterReleaseRequests: [] },
  ]) {
    assert.equal(assessBlockedHostStartup({ ...result, ...change }).verdict, "fail")
  }
  assert.equal(assessBlockedHostStartup(null).verdict, "fail")
})

test("startup benchmark rejects unbounded or impossible test holds before touching the browser", async () => {
  for (const options of [{ holdMs: 60000 }, { holdMs: 1000, timeoutMs: 2000 }, { timeoutMs: 0 }]) {
    await assert.rejects(measureBlockedHostStartup(null, options), /Invalid bounded/)
  }
})
