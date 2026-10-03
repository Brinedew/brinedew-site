import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

test("generation retry lookup is an exact indexed probe even with a long requester history", () => {
  const source = readFileSync(
    new URL(
      "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
      import.meta.url,
    ),
    "utf8",
  )
  const queries = [
    ...source.matchAll(
      /`(SELECT id, COALESCE\(generation_request_contract_sha256,[\s\S]*?LIMIT 1)`/g,
    ),
  ].map((match) => match[1])
  assert.equal(queries.length, 2)
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(`CREATE TABLE icono_generation_requests(id INTEGER PRIMARY KEY, requester_user_id TEXT, generation_request_contract_sha256 TEXT);
      ${readFileSync(new URL("../migrations-iconoplasm/0055_generation_request_batch_idempotency.sql", import.meta.url), "utf8")}
      WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_generation_requests SELECT n, 'requester', 'contract-'||n, 'client-'||n FROM ids;`)
    for (const sql of queries) {
      assert.equal(db.prepare(sql).get("requester", "client-20000").id, 20000)
      assert.equal(db.prepare(sql).get("requester", "unknown"), undefined)
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all("requester", "unknown")
      assert.ok(
        plan.some(
          ({ detail }) =>
            detail.includes("SEARCH") &&
            detail.includes("idx_icono_generation_requests_client_request"),
        ),
      )
      assert.ok(plan.every(({ detail }) => !detail.includes("SCAN")))
    }
  } finally {
    db.close()
  }
})

test("both copies of the Anima allocation contract carry numeric facts but no private artist identities", () => {
  for (const path of [
    "./generated/iconoplasm-anima-emulsion-slot-contract.js",
    "../quartz/static/iconoplasm/generated/anima-emulsion-slot-contract.js",
  ]) {
    const contract = readFileSync(new URL(path, import.meta.url), "utf8")
    assert.doesNotMatch(contract, /@[a-z0-9_()]+/i, path)
    assert.doesNotMatch(contract, /pablo|suerte|uchida/i, path)
  }
})
