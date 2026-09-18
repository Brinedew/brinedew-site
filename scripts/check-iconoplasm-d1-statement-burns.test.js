import assert from "node:assert/strict"
import test from "node:test"
import { statementBurnViolations } from "./check-iconoplasm-d1-statement-burns.mjs"

const row = (reads, returned, query = "SELECT 1") => ({
  dimensions: { databaseId: "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff", query },
  sum: { rowsRead: reads, rowsReturned: returned },
})

test("flags any statement at or above the absolute cap", () => {
  const violations = statementBurnViolations([row(700000, 0), row(100, 100)], { cap: 500000 })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].reads, 700000)
  assert.equal(violations[0].returned, 0)
})

test("case-21: an unseen shape is flagged by measurement alone", () => {
  const novel = row(890000, 12, "SELECT weird FROM some_new_table WHERE something_new = ?")
  const violations = statementBurnViolations([novel], { cap: 500000 })
  assert.equal(violations.length, 1)
  assert.match(violations[0].query, /some_new_table/)
})

test("tolerates empty and invalid results", () => {
  assert.deepEqual(statementBurnViolations([], { cap: 500000 }), [])
  assert.deepEqual(statementBurnViolations(null, { cap: 500000 }), [])
  assert.throws(() => statementBurnViolations([], { cap: 0 }), /D1_STATEMENT_BURN_CAP_INVALID/)
})
