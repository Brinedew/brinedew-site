// B-1090: the public catalogue release, run from the GitHub catalog job.
//
// Ways it could go wrong, written before the script:
// 1. it writes to another database or KV namespace than the Worker reads
//    (the ids drift from the Worker's wrangler file, or staging's are picked);
// 2. the dump goes to another storage zone or CDN than the Worker's;
// 3. a refusal reaches the job's receipt as a bare message, hiding the terms
//    that caused it, as "BASE" hid for eleven weeks;
// 4. a D1 failure is swallowed and the job goes green with nothing released.
// The full release itself was run against the 2026-10-17 nightly D1 copy:
// 19,381 genes, 58,151 rows read, 1 written, 71 KV writes.

import assert from "node:assert/strict"
import test from "node:test"

import { releaseCatalog, workerBindings } from "./release-iconoplasm-catalog.mjs"

test("the release writes where the production Worker reads, never staging", () => {
  const { d1DatabaseId, kvNamespaceId, vars } = workerBindings()
  assert.equal(d1DatabaseId, "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff")
  assert.equal(kvNamespaceId, "7d59f063885e415ab3df5301393a114d")
  assert.equal(vars.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE, "iconoplasm-portraits")
  assert.equal(vars.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST, "storage.bunnycdn.com")
  assert.equal(vars.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL, "https://img.brinedew.bio")
})

test("a release that can't run says why instead of going green", async () => {
  process.env.CLOUDFLARE_ACCOUNT_ID ||= "account"
  process.env.CLOUDFLARE_API_TOKEN ||= "token"
  process.env.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD ||= "password"
  const refused = await releaseCatalog({
    fetchImpl: async () =>
      Response.json(
        { success: false, errors: [{ code: 7403, message: "not authorized" }] },
        { status: 403 },
      ),
  })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /D1 query failed \(403\).*not authorized/)
})
