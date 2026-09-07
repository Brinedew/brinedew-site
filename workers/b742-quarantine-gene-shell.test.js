import assert from "node:assert/strict"
import test from "node:test"
import runtime from "./b742-quarantine-gene-shell-inside-the-only-allowed-stateful-worker-do-not-duplicate.js"

test("B-742 transition serves gene HTML without touching D1", async () => {
  const originalFetch = globalThis.fetch
  let d1Calls = 0
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://brinedew-bio.pages.dev/apps/iconoplasm/index")
    return new Response(
      '<!doctype html><html><body><div id="iconoplasm-root"></div></body></html>',
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    )
  }
  const forbiddenDb = {
    prepare() {
      d1Calls += 1
      throw new Error("quarantine gene shell touched D1")
    },
  }
  try {
    const response = await runtime.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
      {
        ICONOPLASM_SCHEMA_TRANSITION: "1",
        DB: forbiddenDb,
        ICONOPLASM_DB: forbiddenDb,
        ICONOPLASM_AUTHORING_DB: forbiddenDb,
        ICONOPLASM_AUDIT_DB: forbiddenDb,
      },
      { waitUntil() {} },
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("X-B742-D1-Quarantine"), "gene-shell")
    assert.match(await response.text(), /data-b742-d1-free-gene-shell="TP53"/)
    assert.equal(d1Calls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
